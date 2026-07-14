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

// Nivel 1 (Gerencia): de dónde vienen los leads y qué tan bien convierte cada fuente
export async function getStatsFuentes(req: Request, res: Response) {
  const { conds, params } = filtros(req);
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

  const rows = await query(`
    SELECT
      COALESCE(first_source_type, 'sin_atribuir') as fuente,
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE estado='derivado') as derivados,
      COUNT(*) FILTER (WHERE estado='en_conversacion') as en_conversacion,
      COUNT(*) FILTER (WHERE estado IN ('frio','frio_silencioso')) as frios,
      ROUND(100.0 * COUNT(*) FILTER (WHERE estado='derivado') / NULLIF(COUNT(*),0), 1) as tasa_derivacion_pct
    FROM contactos
    ${where}
    GROUP BY COALESCE(first_source_type, 'sin_atribuir')
    ORDER BY total DESC
  `, params);
  res.json(rows);
}

// Nivel 2 (Marketing): funnel de leads agrupado por campaña de Meta Ads
// El nombre real de campaña vive en lead_attribution (contactos.first_campaign_name
// quedó con el headline del anuncio por un bug de captura en n8n), así que se cruza
// con el primer touch de lead_attribution y se cae a first_campaign_name solo si falta.
export async function getStatsCampanas(req: Request, res: Response) {
  const { conds, params } = filtros(req, 'c.creado_en');
  conds.push(`c.first_source_type = 'meta_ad'`);
  const where = `WHERE ${conds.join(' AND ')}`;

  const rows = await query(`
    SELECT
      COALESCE(NULLIF(TRIM(la.campaign_name), ''), NULLIF(TRIM(c.first_campaign_name), ''), 'Sin campaña') as campana,
      COUNT(*) as total_leads,
      COUNT(*) FILTER (WHERE c.estado='derivado') as derivados,
      COUNT(*) FILTER (WHERE c.estado='en_conversacion') as en_conversacion,
      COUNT(*) FILTER (WHERE c.estado IN ('frio','frio_silencioso')) as frios,
      ROUND(100.0 * COUNT(*) FILTER (WHERE c.estado='derivado') / NULLIF(COUNT(*),0), 1) as tasa_derivacion_pct
    FROM contactos c
    LEFT JOIN LATERAL (
      SELECT * FROM lead_attribution la
      WHERE la.celular = c.numero AND la.is_first_touch = true
      ORDER BY la.created_at DESC LIMIT 1
    ) la ON true
    ${where}
    GROUP BY 1
    ORDER BY total_leads DESC
  `, params);
  res.json(rows);
}

// Nivel 2/3 (Marketing/Comercial): performance detallado campaña → adset → anuncio
export async function getStatsAnuncios(req: Request, res: Response) {
  const { conds, params } = filtros(req, 'c.creado_en');
  conds.push(`c.first_source_type = 'meta_ad'`);
  const where = `WHERE ${conds.join(' AND ')}`;

  const rows = await query(`
    SELECT
      COALESCE(NULLIF(TRIM(la.campaign_name), ''), NULLIF(TRIM(c.first_campaign_name), ''), 'Sin campaña') as campana,
      COALESCE(NULLIF(TRIM(la.adset_name), ''), NULLIF(TRIM(c.first_adset_name), ''), 'Sin adset') as adset,
      COALESCE(NULLIF(TRIM(la.ad_name), ''), NULLIF(TRIM(c.first_ad_name), ''), 'Sin anuncio') as anuncio,
      COUNT(*) as total_leads,
      COUNT(*) FILTER (WHERE c.estado='derivado') as derivados,
      COUNT(*) FILTER (WHERE c.estado='en_conversacion') as en_conversacion,
      COUNT(*) FILTER (WHERE c.estado IN ('frio','frio_silencioso')) as frios,
      ROUND(100.0 * COUNT(*) FILTER (WHERE c.estado='derivado') / NULLIF(COUNT(*),0), 1) as tasa_derivacion_pct
    FROM contactos c
    LEFT JOIN LATERAL (
      SELECT * FROM lead_attribution la
      WHERE la.celular = c.numero AND la.is_first_touch = true
      ORDER BY la.created_at DESC LIMIT 1
    ) la ON true
    ${where}
    GROUP BY 1, 2, 3
    ORDER BY total_leads DESC
  `, params);
  res.json(rows);
}

// Nivel 3 (Comercial): de un anuncio puntual, qué proyectos generan más intención/derivación
// El :anuncio recibido es el nombre real (la.ad_name) que ahora devuelve /stats/anuncios,
// así que se filtra sobre el mismo primer touch de lead_attribution, con fallback a
// contactos.first_ad_name para leads sin registro en lead_attribution.
export async function getStatsAnuncioProyectos(req: Request, res: Response) {
  const { conds, params } = filtros(req, 'c.creado_en');
  conds.push(`c.first_source_type = 'meta_ad'`);
  params.push(req.params.anuncio);
  conds.push(`COALESCE(NULLIF(TRIM(la.ad_name), ''), NULLIF(TRIM(c.first_ad_name), '')) = $${params.length}`);
  const where = `WHERE ${conds.join(' AND ')}`;

  const rows = await query(`
    SELECT
      COALESCE(NULLIF(TRIM(c.proyecto_interes), ''), 'Sin proyecto') as proyecto,
      COUNT(*) as total_leads,
      COUNT(*) FILTER (WHERE c.estado='derivado') as derivados,
      ROUND(100.0 * COUNT(*) FILTER (WHERE c.estado='derivado') / NULLIF(COUNT(*),0), 1) as tasa_derivacion_pct
    FROM contactos c
    LEFT JOIN LATERAL (
      SELECT * FROM lead_attribution la
      WHERE la.celular = c.numero AND la.is_first_touch = true
      ORDER BY la.created_at DESC LIMIT 1
    ) la ON true
    ${where}
    GROUP BY 1
    ORDER BY total_leads DESC
  `, params);
  res.json(rows);
}

// Nivel 3 (Comercial): catálogo de creativos — para mostrar el anuncio real (texto/imagen/video)
// junto a sus métricas, cruzando lead_attribution (detalle del creativo) con contactos (estado/embudo)
export async function getStatsCreativos(req: Request, res: Response) {
  const { conds, params } = filtros(req);
  conds.push(`c.first_source_type = 'meta_ad'`);
  const where = `WHERE ${conds.join(' AND ')}`;

  const rows = await query(`
    SELECT
      c.first_ad_id as ad_id,
      COALESCE(NULLIF(TRIM(la.ad_name), ''), NULLIF(TRIM(c.first_ad_name), ''), 'Sin anuncio') as anuncio,
      COALESCE(NULLIF(TRIM(la.campaign_name), ''), NULLIF(TRIM(c.first_campaign_name), ''), 'Sin campaña') as campana,
      COALESCE(NULLIF(TRIM(la.adset_name), ''), NULLIF(TRIM(c.first_adset_name), ''), 'Sin adset') as adset,
      la.meta_headline as titulo,
      la.meta_body as texto,
      (la.meta_headline LIKE '%{{%' OR la.meta_body LIKE '%{{%') as es_catalogo_dinamico,
      la.meta_media_type as tipo_media,
      la.image_url as imagen_url,
      la.video_url as video_url,
      la.thumbnail_url as thumbnail_url,
      COUNT(*) as total_leads,
      COUNT(*) FILTER (WHERE c.estado='derivado') as derivados,
      COUNT(*) FILTER (WHERE c.estado='en_conversacion') as en_conversacion,
      COUNT(*) FILTER (WHERE c.estado IN ('frio','frio_silencioso')) as frios,
      ROUND(100.0 * COUNT(*) FILTER (WHERE c.estado='derivado') / NULLIF(COUNT(*),0), 1) as tasa_derivacion_pct
    FROM contactos c
    LEFT JOIN LATERAL (
      SELECT * FROM lead_attribution la
      WHERE la.celular = c.numero AND la.is_first_touch = true
      ORDER BY la.created_at DESC LIMIT 1
    ) la ON true
    ${where}
    GROUP BY 1, 2, 3, 4, la.meta_headline, la.meta_body, la.meta_media_type, la.image_url, la.video_url, la.thumbnail_url, es_catalogo_dinamico
    ORDER BY total_leads DESC
  `, params);
  res.json(rows);
}

// Nivel 2 (Marketing): cuántos leads tuvieron más de un touch (vieron/clickearon varios
// anuncios) antes de escribir — mide si la campaña necesita varios impactos para convertir
export async function getStatsMultiTouch(req: Request, res: Response) {
  const { conds, params } = filtros(req, 'c.creado_en');
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

  const rows = await query(`
    WITH touches AS (
      SELECT c.numero, c.estado, COUNT(la.id) as total_touches
      FROM contactos c
      JOIN lead_attribution la ON la.celular = c.numero
      ${where}
      GROUP BY c.numero, c.estado
    )
    SELECT
      CASE WHEN total_touches <= 1 THEN '1 touch' ELSE '2+ touches' END as grupo,
      COUNT(*) as total_leads,
      COUNT(*) FILTER (WHERE estado='derivado') as derivados,
      ROUND(100.0 * COUNT(*) FILTER (WHERE estado='derivado') / NULLIF(COUNT(*),0), 1) as tasa_derivacion_pct
    FROM touches
    GROUP BY 1
    ORDER BY 1
  `, params);
  res.json(rows);
}
