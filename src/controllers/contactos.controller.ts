import type { Request, Response } from 'express';
import { query } from '../db/pool.js';

const esFecha = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

// Misma lista oficial que el frontend (lib/proyectos.ts PROYECTOS). Se
// duplica acá porque "Otros" (texto declarado que no matchea ningún
// proyecto oficial) solo es expresable en SQL negando esta lista completa.
const PROYECTOS_OFICIALES = [
  'Alto Piura', 'Brisas de Ventanilla', 'Caleta San Antonio', 'Costa Linda',
  'El Carbón', 'El Olivar de Pisco', 'La Quebrada', 'Las Rompientes',
  'Lirios de Carabayllo', 'Los Pecanos', 'Mala Comercio',
  'Mirador de San Antonio', 'Posada del Sol Chiclayo', 'Praderas El Olivar 2',
  'Praderas El Olivar 3', 'San Antonio de Chiclayo 3', 'San Antonio de Mala',
  'San Antonio de Pachacamac', 'Villa Posada del Sol Chiclayo',
  'Villas de San Antonio Chorrillos', 'Villas Punta Mar Casas',
  'Villas Punta Mar Lotes',
];

// Un valor único o varios separados por coma (selección múltiple en los
// filtros): "Alto Piura,Brisas de Ventanilla" → ['Alto Piura', ...]
const lista = (v: unknown): string[] =>
  (v as string || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

// Construye el WHERE de contactos a partir de los filtros. Se usa igual
// para la página (getContactos) y para el conteo total, así ambos cuentan
// exactamente lo mismo.
function whereContactos(req: Request) {
  const estados = lista(req.query.estado);
  const origenes = lista(req.query.origen);
  const proyectos = lista(req.query.proyecto);
  const desde = req.query.desde as string || '';
  const hasta = req.query.hasta as string || '';
  const q = req.query.q as string || '';

  const conds: string[] = [];
  const params: any[] = [];

  if (estados.length > 0) {
    params.push(estados);
    conds.push(`c.estado = ANY($${params.length})`);
  }

  // 'sin_atribuir' = first_source_type NULL (fallback del dashboard, no un
  // valor real de la columna); el resto son valores reales de la columna.
  if (origenes.length > 0) {
    const clausulas: string[] = [];
    const reales = origenes.filter((o) => o !== 'sin_atribuir');
    if (origenes.includes('sin_atribuir')) clausulas.push(`c.first_source_type IS NULL`);
    if (reales.length > 0) {
      params.push(reales);
      clausulas.push(`c.first_source_type = ANY($${params.length})`);
    }
    conds.push(`(${clausulas.join(' OR ')})`);
  }

  // proyecto_interes es texto libre: cada proyecto oficial se matchea con
  // LIKE y se combinan con OR. 'Sin proyecto' = campo vacío/NULL. 'Otros' =
  // declaró algo pero no coincide con NINGÚN proyecto oficial (se niega la
  // lista completa) — aproximación por LIKE simple, sin los alias/typos
  // que sí resuelve la normalización más fina del cliente (lib/proyectos.ts).
  if (proyectos.length > 0) {
    const clausulas: string[] = [];
    for (const p of proyectos) {
      if (p === 'Sin proyecto') {
        clausulas.push(`(c.proyecto_interes IS NULL OR TRIM(c.proyecto_interes) = '')`);
      } else if (p === 'Otros') {
        const negaciones = PROYECTOS_OFICIALES.map((oficial) => {
          params.push(`%${oficial}%`);
          return `LOWER(c.proyecto_interes) NOT LIKE LOWER($${params.length})`;
        });
        clausulas.push(
          `(c.proyecto_interes IS NOT NULL AND TRIM(c.proyecto_interes) != '' AND ${negaciones.join(' AND ')})`
        );
      } else {
        params.push(`%${p}%`);
        clausulas.push(`LOWER(c.proyecto_interes) LIKE LOWER($${params.length})`);
      }
    }
    if (clausulas.length > 0) conds.push(`(${clausulas.join(' OR ')})`);
  }

  if (q) {
    params.push(`%${q}%`);
    conds.push(`(c.numero ILIKE $${params.length} OR c.nombre ILIKE $${params.length})`);
  }
  // creado_en guarda el instante en UTC (ver db/pool.ts). El día que elige
  // el usuario es día de Perú, así que el corte de medianoche se convierte
  // de America/Lima a UTC antes de comparar; sin esto "ayer" traía de las
  // 7pm del día anterior a las 7pm del día elegido (hora de Lima).
  if (esFecha(desde)) {
    params.push(desde);
    conds.push(
      `c.creado_en >= ($${params.length}::timestamp AT TIME ZONE 'America/Lima' AT TIME ZONE 'UTC')`
    );
  }
  if (esFecha(hasta)) {
    params.push(hasta);
    conds.push(
      `c.creado_en < (($${params.length}::timestamp + INTERVAL '1 day') AT TIME ZONE 'America/Lima' AT TIME ZONE 'UTC')`
    );
  }

  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  return { where, params };
}

export async function getContactos(req: Request, res: Response) {
  const limit = Math.min(parseInt(req.query.limit as string) || 60, 500);
  const offset = parseInt(req.query.offset as string) || 0;

  const { where, params } = whereContactos(req);

  // Total de la consulta (para "1–50 de N"): mismo WHERE, sin paginar
  const totalRows = await query(
    `SELECT COUNT(*)::int as total FROM contactos c ${where}`,
    params
  );
  const total = totalRows[0]?.total ?? 0;

  const pageParams = [...params, limit, offset];
  const rows = await query(`
    SELECT c.*,
      COALESCE(conv.total_mensajes, 0) as total_mensajes,
      conv.ultimo_mensaje
    FROM contactos c
    LEFT JOIN LATERAL (
      SELECT COUNT(*) as total_mensajes,
        (ARRAY_AGG(mensaje ORDER BY fecha DESC))[1] as ultimo_mensaje
      FROM conversaciones
      WHERE numero = c.numero
    ) conv ON true
    ${where}
    ORDER BY ultima_actividad DESC
    LIMIT $${pageParams.length - 1} OFFSET $${pageParams.length}
  `, pageParams);

  res.json({ contactos: rows, total });
}

// Ficha completa de un lead: datos del contacto + todo su historial de
// atribución (lead_attribution puede tener varias filas por celular, una
// por cada touch/anuncio que vio antes de escribir). is_first_touch=true
// marca el touch que originó el first_ad_id de contactos; el resto son
// touches posteriores (multi-touch) útiles para ver el recorrido completo.
export async function getFichaContacto(req: Request, res: Response) {
  const { numero } = req.params;

  const contactoRows = await query(`
    SELECT c.*, COALESCE(conv.total_mensajes, 0) as total_mensajes
    FROM contactos c
    LEFT JOIN LATERAL (
      SELECT COUNT(*) as total_mensajes FROM conversaciones WHERE numero = c.numero
    ) conv ON true
    WHERE c.numero = $1
  `, [numero]);

  if (contactoRows.length === 0) {
    res.status(404).json({ error: 'Contacto no encontrado' });
    return;
  }

  const touches = await query(`
    SELECT * FROM lead_attribution WHERE celular = $1 ORDER BY created_at ASC
  `, [numero]);

  res.json({ contacto: contactoRows[0], touches });
}
