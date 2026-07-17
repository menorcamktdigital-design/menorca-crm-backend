import type { Request, Response } from 'express';
import { query } from '../db/pool.js';

const esFecha = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

// Construye el WHERE de leads_formulario a partir de los filtros. Se usa
// igual para la página (getFormularios) y para el conteo/stats, así todos
// cuentan exactamente lo mismo.
function whereFormularios(req: Request) {
  const proyecto = req.query.proyecto as string || '';
  const campana = req.query.utm_campaign as string || '';
  const desde = req.query.desde as string || '';
  const hasta = req.query.hasta as string || '';

  const conds: string[] = [];
  const params: any[] = [];

  if (proyecto) {
    params.push(`%${proyecto}%`);
    conds.push(`proyecto_nombre ILIKE $${params.length}`);
  }
  if (campana) {
    params.push(`%${campana}%`);
    conds.push(`utm_campaign ILIKE $${params.length}`);
  }
  // creado_en guarda UTC (ver db/pool.ts); el corte de día se convierte de
  // hora de Perú a UTC para que "un día" sea el día local.
  if (esFecha(desde)) {
    params.push(desde);
    conds.push(
      `creado_en >= ($${params.length}::timestamp AT TIME ZONE 'America/Lima' AT TIME ZONE 'UTC')`
    );
  }
  if (esFecha(hasta)) {
    params.push(hasta);
    conds.push(
      `creado_en < (($${params.length}::timestamp + INTERVAL '1 day') AT TIME ZONE 'America/Lima' AT TIME ZONE 'UTC')`
    );
  }

  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  return { where, params };
}

export async function getFormularios(req: Request, res: Response) {
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 500);
  const offset = parseInt(req.query.offset as string) || 0;

  const { where, params } = whereFormularios(req);

  const totalRows = await query(
    `SELECT COUNT(*)::int as total FROM leads_formulario ${where}`,
    params
  );
  const total = totalRows[0]?.total ?? 0;

  const pageParams = [...params, limit, offset];
  const rows = await query(`
    SELECT * FROM leads_formulario
    ${where}
    ORDER BY creado_en DESC
    LIMIT $${pageParams.length - 1} OFFSET $${pageParams.length}
  `, pageParams);

  res.json({ formularios: rows, total });
}

export async function getFormulariosStats(req: Request, res: Response) {
  const { where, params } = whereFormularios(req);

  const rows = await query(`
    SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE derivado = true) AS derivados,
      ROUND(COUNT(*) FILTER (WHERE derivado = true) * 100.0 / NULLIF(COUNT(*), 0), 1) AS ratio_derivacion,
      COUNT(DISTINCT utm_campaign) AS campanas
    FROM leads_formulario
    ${where}
  `, params);

  res.json(rows[0]);
}

// Filas planas agrupadas por campaña → conjunto (utm_term) → anuncio
// (utm_content) → proyecto (proyecto_nombre), con leads y derivados por
// combinación. El frontend arma el árbol de 4 niveles sumando cada nivel a
// partir de estas filas (mismo criterio que /stats/anuncios en
// contactos, que también devuelve plano y arma el árbol en cliente).
// proyecto_nombre se agrupa tal cual está en la BD (TRIM + 'Sin proyecto'
// si viene vacío), sin normalizar contra la lista oficial: mismo criterio
// exacto que /stats/anuncios/proyectos usa sobre contactos.proyecto_interes.
export async function getFormulariosFunnel(req: Request, res: Response) {
  const { where, params } = whereFormularios(req);

  const rows = await query(`
    SELECT
      utm_campaign,
      utm_term,
      utm_content,
      ad_id,
      thumbnail_url,
      video_id,
      COALESCE(NULLIF(TRIM(proyecto_nombre), ''), 'Sin proyecto') AS proyecto_nombre,
      COUNT(*) AS leads,
      COUNT(*) FILTER (WHERE derivado = true) AS derivados
    FROM leads_formulario
    ${where}
    GROUP BY utm_campaign, utm_term, utm_content, ad_id, thumbnail_url, video_id,
      COALESCE(NULLIF(TRIM(proyecto_nombre), ''), 'Sin proyecto')
    ORDER BY leads DESC
  `, params);

  res.json(rows);
}
