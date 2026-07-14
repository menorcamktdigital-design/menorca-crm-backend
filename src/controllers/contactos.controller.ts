import type { Request, Response } from 'express';
import { query } from '../db/pool.js';

const esFecha = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

export async function getContactos(req: Request, res: Response) {
  const limit = Math.min(parseInt(req.query.limit as string) || 60, 500);
  const offset = parseInt(req.query.offset as string) || 0;
  const estado = req.query.estado as string || '';
  const desde = req.query.desde as string || '';
  const hasta = req.query.hasta as string || '';

  const conds: string[] = [];
  const params: any[] = [];

  if (estado) {
    params.push(estado);
    conds.push(`c.estado = $${params.length}`);
  }
  if (esFecha(desde)) {
    params.push(desde);
    conds.push(`c.creado_en >= $${params.length}::date`);
  }
  if (esFecha(hasta)) {
    params.push(hasta);
    conds.push(`c.creado_en < $${params.length}::date + INTERVAL '1 day'`);
  }

  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  params.push(limit, offset);

  const rows = await query(`
    SELECT c.*,
      (SELECT COUNT(*) FROM conversaciones WHERE numero=c.numero) as total_mensajes,
      (SELECT mensaje FROM conversaciones WHERE numero=c.numero ORDER BY fecha DESC LIMIT 1) as ultimo_mensaje
    FROM contactos c ${where}
    ORDER BY ultima_actividad DESC
    LIMIT $${params.length - 1} OFFSET $${params.length}
  `, params);

  res.json({ contactos: rows });
}
