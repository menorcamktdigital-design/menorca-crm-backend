import { Request, Response } from 'express';
import { query } from '../db/pool';

export async function getStats(req: Request, res: Response) {
  const rows = await query(`
    SELECT 
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE estado='en_conversacion') as conversando,
      COUNT(*) FILTER (WHERE estado='derivado') as derivados,
      COUNT(*) FILTER (WHERE estado='visita_agendada') as visitas
    FROM contactos
  `);
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
  const rows = await query(`
    SELECT 
      DATE(ultima_actividad) as fecha,
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE estado='derivado') as derivados
    FROM contactos
    WHERE ultima_actividad >= NOW() - INTERVAL '14 days'
    GROUP BY DATE(ultima_actividad)
    ORDER BY fecha ASC
  `);
  res.json(rows);
}