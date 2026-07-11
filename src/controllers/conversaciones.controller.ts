import type { Request, Response } from 'express';
import { query } from '../db/pool.js';

export async function getConversacion(req: Request, res: Response) {
  const { numero } = req.params;
  const offset = parseInt(req.query.offset as string) || 0;

  const rows = await query(`
    SELECT * FROM (
      SELECT * FROM conversaciones WHERE numero=$1 ORDER BY fecha DESC LIMIT 30 OFFSET $2
    ) s ORDER BY fecha ASC
  `, [numero, offset]);

  res.json(rows);
}

export async function getNuevos(req: Request, res: Response) {
  const { numero, desde } = req.params;
  const rows = await query(`
    SELECT * FROM conversaciones WHERE numero=$1 AND id > $2 ORDER BY fecha ASC
  `, [numero, parseInt(desde as string) || 0]);

  res.json(rows);
}