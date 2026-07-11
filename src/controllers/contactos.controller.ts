import type { Request, Response } from 'express';
import { query } from '../db/pool.js';

export async function getContactos(req: Request, res: Response) {
  const limit = Math.min(parseInt(req.query.limit as string) || 60, 500);
  const offset = parseInt(req.query.offset as string) || 0;
  const estado = req.query.estado as string || '';

  const where = estado ? `WHERE c.estado = $3` : '';
  const params = estado ? [limit, offset, estado] : [limit, offset];

  const rows = await query(`
    SELECT c.*,
      (SELECT COUNT(*) FROM conversaciones WHERE numero=c.numero) as total_mensajes,
      (SELECT mensaje FROM conversaciones WHERE numero=c.numero ORDER BY fecha DESC LIMIT 1) as ultimo_mensaje
    FROM contactos c ${where}
    ORDER BY ultima_actividad DESC
    LIMIT $1 OFFSET $2
  `, params);

  res.json({ contactos: rows });
}