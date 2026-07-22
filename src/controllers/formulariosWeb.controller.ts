import type { Request, Response } from 'express';
import { query } from '../db/pool.js';

const esFecha = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

// WHERE de formulario_web. La campaña vuelve a ser utm_campaign (el form
// web sí llega con UTMs); ademas se puede filtrar por fuente (utm_source:
// menorca_web, googleads, google...).
function whereWeb(req: Request) {
  const fuente = req.query.fuente as string || '';
  const campana = req.query.campana as string || '';
  const desde = req.query.desde as string || '';
  const hasta = req.query.hasta as string || '';

  const conds: string[] = [];
  const params: any[] = [];

  if (fuente) {
    params.push(`%${fuente}%`);
    conds.push(`utm_source ILIKE $${params.length}`);
  }
  if (campana) {
    params.push(`%${campana}%`);
    conds.push(`utm_campaign ILIKE $${params.length}`);
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

export async function getFormulariosWeb(req: Request, res: Response) {
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 500);
  const offset = parseInt(req.query.offset as string) || 0;

  const { where, params } = whereWeb(req);

  const totalRows = await query(
    `SELECT COUNT(*)::int as total FROM formulario_web ${where}`,
    params
  );
  const total = totalRows[0]?.total ?? 0;

  const pageParams = [...params, limit, offset];
  const rows = await query(`
    SELECT * FROM formulario_web
    ${where}
    ORDER BY creado_en DESC
    LIMIT $${pageParams.length - 1} OFFSET $${pageParams.length}
  `, pageParams);

  res.json({ formularios: rows, total });
}

export async function getFormulariosWebStats(req: Request, res: Response) {
  const { where, params } = whereWeb(req);

  const rows = await query(`
    SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE derivado = true) AS derivados,
      ROUND(COUNT(*) FILTER (WHERE derivado = true) * 100.0 / NULLIF(COUNT(*), 0), 1) AS ratio_derivacion,
      COUNT(DISTINCT COALESCE(NULLIF(TRIM(utm_source), ''), '(directo)')) AS fuentes
    FROM formulario_web
    ${where}
  `, params);

  res.json(rows[0]);
}

// Filas planas fuente (utm_source) → medio (utm_medium) → campaña
// (utm_campaign). El lead web puede llegar sin UTMs (tráfico directo):
// esos caen en '(directo)' para que el total del funnel cuadre con stats.
export async function getFormulariosWebFunnel(req: Request, res: Response) {
  const { where, params } = whereWeb(req);

  const rows = await query(`
    SELECT
      COALESCE(NULLIF(TRIM(utm_source), ''), '(directo)') AS utm_source,
      COALESCE(NULLIF(TRIM(utm_medium), ''), '(sin medio)') AS utm_medium,
      COALESCE(NULLIF(TRIM(utm_campaign), ''), '(sin campaña)') AS utm_campaign,
      COUNT(*) AS leads,
      COUNT(*) FILTER (WHERE derivado = true) AS derivados
    FROM formulario_web
    ${where}
    GROUP BY 1, 2, 3
    ORDER BY leads DESC
  `, params);

  res.json(rows);
}
