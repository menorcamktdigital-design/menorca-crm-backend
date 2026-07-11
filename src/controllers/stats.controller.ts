import type { Request, Response } from 'express';
import { query } from '../db/pool.js';

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