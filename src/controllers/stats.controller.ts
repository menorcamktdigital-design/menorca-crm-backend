import { Request, Response } from 'express';
import { query } from '../db/pool';

export async function getStats(req: Request, res: Response) {
  const proyecto = req.query.proyecto as string || '';
  
  const where = proyecto
    ? `WHERE LOWER(proyecto_interes) LIKE LOWER($1)`
    : '';
  const params = proyecto ? [`%${proyecto}%`] : [];

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
  const rows = await query(`
    SELECT 
      COALESCE(NULLIF(TRIM(proyecto_interes), ''), 'Sin proyecto') as proyecto_interes,
      COUNT(*) as total
    FROM contactos
    GROUP BY COALESCE(NULLIF(TRIM(proyecto_interes), ''), 'Sin proyecto')
    ORDER BY total DESC
  `);
  res.json(rows);
}

export async function getStatsActividad(req: Request, res: Response) {
  const proyecto = req.query.proyecto as string || '';

  const where = proyecto
    ? `WHERE ultima_actividad >= NOW() - INTERVAL '14 days' AND LOWER(proyecto_interes) LIKE LOWER($1)`
    : `WHERE ultima_actividad >= NOW() - INTERVAL '14 days'`;
  const params = proyecto ? [`%${proyecto}%`] : [];

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