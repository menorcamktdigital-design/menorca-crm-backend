import { Request, Response } from 'express';
import { query } from '../db/pool';

const esFecha = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

function filtros(req: Request, colFecha = 'creado_en') {
  const proyecto = req.query.proyecto as string || '';
  const desde = req.query.desde as string || '';
  const hasta = req.query.hasta as string || '';

  const conds: string[] = [];
  const params: any[] = [];

  if (proyecto) {
    params.push(`%${proyecto}%`);
    conds.push(`LOWER(proyecto_interes) LIKE LOWER($${params.length})`);
  }
  if (esFecha(desde)) {
    params.push(desde);
    conds.push(`${colFecha} >= $${params.length}::date`);
  }
  if (esFecha(hasta)) {
    params.push(hasta);
    conds.push(`${colFecha} < $${params.length}::date + INTERVAL '1 day'`);
  }

  return { conds, params };
}

export async function getStats(req: Request, res: Response) {
  const { conds, params } = filtros(req);
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

  const rows = await query(`
    SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE estado='en_conversacion') as conversando,
      COUNT(*) FILTER (WHERE estado='derivado') as derivados,
      COUNT(*) FILTER (WHERE estado='visita_agendada') as visitas
    FROM contactos
    ${where}
  `, params);
  res.json(rows[0]);
}

export async function getStatsProyectos(req: Request, res: Response) {
  const { conds, params } = filtros(req);
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

  const rows = await query(`
    SELECT
      COALESCE(NULLIF(TRIM(proyecto_interes), ''), 'Sin proyecto') as proyecto_interes,
      COUNT(*) as total
    FROM contactos
    ${where}
    GROUP BY COALESCE(NULLIF(TRIM(proyecto_interes), ''), 'Sin proyecto')
    ORDER BY total DESC
  `, params);
  res.json(rows);
}

export async function getStatsActividad(req: Request, res: Response) {
  // el gráfico agrupa por día de actividad, así que el rango filtra sobre ultima_actividad
  const { conds, params } = filtros(req, 'ultima_actividad');

  // sin rango de fechas, mantiene los últimos 14 días
  const desde = req.query.desde as string || '';
  const hasta = req.query.hasta as string || '';
  if (!esFecha(desde) && !esFecha(hasta)) {
    conds.push(`ultima_actividad >= NOW() - INTERVAL '14 days'`);
  }
  const where = `WHERE ${conds.join(' AND ')}`;

  const rows = await query(`
    SELECT
      DATE(ultima_actividad) as fecha,
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE estado='derivado') as derivados
    FROM contactos
    ${where}
    GROUP BY DATE(ultima_actividad)
    ORDER BY fecha ASC
  `, params);
  res.json(rows);
}
