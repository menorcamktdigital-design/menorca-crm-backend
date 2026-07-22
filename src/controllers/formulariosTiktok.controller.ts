import type { Request, Response } from 'express';
import { query } from '../db/pool.js';

const esFecha = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

// WHERE de formulario_tiktok a partir de los filtros. Mismo criterio que
// whereFormularios (formularios.controller): la campaña acá es
// campaign_name (TikTok no manda UTMs, el webhook guarda los nombres
// reales de campaña/anuncio).
function whereTiktok(req: Request) {
  const proyecto = req.query.proyecto as string || '';
  const campana = req.query.campana as string || '';
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
    conds.push(`campaign_name ILIKE $${params.length}`);
  }
  // creado_en guarda UTC (ver db/pool.ts); corte de día en hora de Perú
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

export async function getFormulariosTiktok(req: Request, res: Response) {
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 500);
  const offset = parseInt(req.query.offset as string) || 0;

  const { where, params } = whereTiktok(req);

  const totalRows = await query(
    `SELECT COUNT(*)::int as total FROM formulario_tiktok ${where}`,
    params
  );
  const total = totalRows[0]?.total ?? 0;

  const pageParams = [...params, limit, offset];
  const rows = await query(`
    SELECT * FROM formulario_tiktok
    ${where}
    ORDER BY creado_en DESC
    LIMIT $${pageParams.length - 1} OFFSET $${pageParams.length}
  `, pageParams);

  res.json({ formularios: rows, total });
}

export async function getFormulariosTiktokStats(req: Request, res: Response) {
  const { where, params } = whereTiktok(req);

  const rows = await query(`
    SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE derivado = true) AS derivados,
      ROUND(COUNT(*) FILTER (WHERE derivado = true) * 100.0 / NULLIF(COUNT(*), 0), 1) AS ratio_derivacion,
      COUNT(DISTINCT campaign_name) AS campanas
    FROM formulario_tiktok
    ${where}
  `, params);

  res.json(rows[0]);
}

// Filas planas campaña → anuncio → proyecto. TikTok no tiene nivel de
// conjunto en la tabla (solo campaign_name/ad_name/ad_id), así que el árbol
// es de 3 niveles; el frontend lo arma en cliente igual que el de Meta.
export async function getFormulariosTiktokFunnel(req: Request, res: Response) {
  const { where, params } = whereTiktok(req);

  const rows = await query(`
    SELECT
      campaign_name,
      ad_name,
      ad_id,
      COALESCE(NULLIF(TRIM(proyecto_nombre), ''), 'Sin proyecto') AS proyecto_nombre,
      COUNT(*) AS leads,
      COUNT(*) FILTER (WHERE derivado = true) AS derivados
    FROM formulario_tiktok
    ${where}
    GROUP BY campaign_name, ad_name, ad_id,
      COALESCE(NULLIF(TRIM(proyecto_nombre), ''), 'Sin proyecto')
    ORDER BY leads DESC
  `, params);

  res.json(rows);
}
