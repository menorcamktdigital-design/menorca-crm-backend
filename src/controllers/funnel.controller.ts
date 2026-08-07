import type { Request, Response } from 'express';
import { query } from '../db/pool.js';

// Funnel de marketing por plaza: cruza el gasto de los canales pagados con el
// tráfico del sitio. Cada fuente llega ya normalizada a la columna `plaza` desde
// los workflows de n8n, que es lo que permite juntarlas.
//
//   mkt_google_ads  inversión, clics, impresiones, conversiones   (por campaña/día)
//   mkt_ga4         sesiones, usuarios, rebote                    (por página/día)
//
// Las tablas mkt_* usan `fecha DATE` (no timestamp), así que acá no hay que hacer
// la conversión de zona horaria que sí necesitan contactos y formularios.

const esFecha = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

// En mkt_ga4 conviven plazas reales con dos categorías de control:
//   'Otras páginas' → home, blog, legal: tráfico del sitio que no es de ningún proyecto
//   'Sin plaza'     → fichas de proyecto que el mapeo aún no reconoce
// La primera se excluye siempre (inflaría las sesiones de forma engañosa);
// la segunda se deja para poder detectarla desde el dashboard.
const OTRAS_PAGINAS = 'Otras páginas';

// Origen (sessionSourceMedium de GA4) del tráfico pagado de Google: significa
// literalmente "vino de Google y fue pagado". Cubre búsqueda, Performance Max y
// Demand Gen por igual, porque todas etiquetan el clic con medium=cpc.
//
// Se usa este y no el grupo de canal de GA4 ('Paid Search') porque ese grupo
// incluiría Bing o Yahoo si algún día se pauta ahí, y manda Performance Max a un
// grupo aparte ('Cross-network'). El funnel compara estas sesiones contra los
// clics de Google Ads, así que tienen que ser exactamente el mismo tráfico.
const ORIGEN_GOOGLE_PAGADO = 'google / cpc';

type Filtro = { where: string; params: unknown[] };

// Filtros comunes: rango de fechas y lista de plazas separadas por coma
// (?plaza=Costa Linda,El Carbón), igual que ?proyecto= en el resto de la API.
function filtros(
  req: Request,
  extra: string[] = [],
  // Las consultas que atribuyen por campaña ignoran el filtro de plaza: si lo
  // aplicaran, esconderían los eventos de una campaña cuya plaza aún no está
  // mapeada, que es justo la que hay que poder ver.
  opciones: { ignorarPlaza?: boolean } = {}
): Filtro {
  const desde = (req.query.desde as string) || '';
  const hasta = (req.query.hasta as string) || '';
  const plaza = opciones.ignorarPlaza ? '' : ((req.query.plaza as string) || '').trim();

  const conds = [...extra];
  const params: unknown[] = [];

  if (esFecha(desde)) {
    params.push(desde);
    conds.push(`fecha >= $${params.length}::date`);
  }
  if (esFecha(hasta)) {
    params.push(hasta);
    conds.push(`fecha <= $${params.length}::date`);
  }
  if (plaza) {
    const lista = plaza.split(',').map((p) => p.trim()).filter(Boolean);
    if (lista.length > 0) {
      params.push(lista);
      conds.push(`plaza = ANY($${params.length}::text[])`);
    }
  }

  return { where: conds.length ? `WHERE ${conds.join(' AND ')}` : '', params };
}

// Google Ads y GA4 se agregan por separado y recién después se cruzan: un mes
// puede tener inversión sin tráfico mapeado (o al revés), y un INNER JOIN
// perdería esas filas. Por eso FULL OUTER JOIN y COALESCE en las claves.
function sqlFunnel(
  agrupacion: 'mes' | 'plaza',
  filtroAds: Filtro,
  filtroGa4: Filtro,
  filtroEventos: Filtro
) {
  const dimAds = agrupacion === 'mes' ? `to_char(fecha, 'YYYY-MM')` : 'plaza';
  const dimGa4 = dimAds;

  return `
    WITH ads AS (
      SELECT ${dimAds} AS dim,
             SUM(inversion)                       AS inversion,
             SUM(clics)                           AS clics,
             SUM(impresiones)                     AS impresiones,
             SUM(conversiones)                    AS conversiones,
             COUNT(DISTINCT campaign_id)          AS campanas
      FROM mkt_google_ads
      ${filtroAds.where}
      GROUP BY 1
    ),
    ga4 AS (
      SELECT ${dimGa4} AS dim,
             SUM(sesiones)                        AS sesiones,
             SUM(usuarios)                        AS usuarios,
             SUM(nuevos_usuarios)                 AS nuevos_usuarios
      FROM mkt_ga4
      ${filtroGa4.where}
      GROUP BY 1
    ),
    -- Eventos de conversión del sitio: la última etapa medible sin Sperant.
    ev AS (
      SELECT ${dimGa4} AS dim,
             SUM(cantidad) FILTER (WHERE evento = 'form_start')::int    AS form_start,
             SUM(cantidad) FILTER (WHERE evento = 'form_send')::int     AS form_send,
             SUM(cantidad) FILTER (WHERE evento = 'send_whatsapp')::int AS whatsapp,
             SUM(cantidad) FILTER (WHERE evento = 'maps_click')::int    AS maps_click
      FROM mkt_ga4_eventos
      ${filtroEventos.where}
      GROUP BY 1
    )
    SELECT
      COALESCE(ads.dim, ga4.dim, ev.dim)          AS dim,
      COALESCE(ads.inversion, 0)::float           AS inversion,
      COALESCE(ads.clics, 0)::int                 AS clics,
      COALESCE(ads.impresiones, 0)::int           AS impresiones,
      COALESCE(ads.conversiones, 0)::float        AS conversiones,
      COALESCE(ads.campanas, 0)::int              AS campanas,
      COALESCE(ga4.sesiones, 0)::int              AS sesiones,
      COALESCE(ga4.usuarios, 0)::int              AS usuarios,
      COALESCE(ga4.nuevos_usuarios, 0)::int       AS nuevos_usuarios,
      COALESCE(ev.form_start, 0)::int             AS form_start,
      COALESCE(ev.form_send, 0)::int              AS form_send,
      COALESCE(ev.whatsapp, 0)::int               AS whatsapp,
      COALESCE(ev.maps_click, 0)::int             AS maps_click
    FROM ads
    FULL OUTER JOIN ga4 ON ads.dim = ga4.dim
    FULL OUTER JOIN ev  ON COALESCE(ads.dim, ga4.dim) = ev.dim
    ORDER BY 1
  `;
}

// Los dos CTE llevan sus propios $n, así que los params del segundo hay que
// desplazarlos para que no pisen los del primero.
function desplazar(filtro: Filtro, offset: number): Filtro {
  if (offset === 0) return filtro;
  const where = filtro.where.replace(/\$(\d+)/g, (_, n) => `$${Number(n) + offset}`);
  return { where, params: filtro.params };
}

async function funnelPor(req: Request, agrupacion: 'mes' | 'plaza') {
  const soloGooglePagado = [
    `plaza <> '${OTRAS_PAGINAS}'`,
    `origen = '${ORIGEN_GOOGLE_PAGADO}'`,
  ];

  const ads = filtros(req);
  const ga4 = desplazar(filtros(req, soloGooglePagado), ads.params.length);
  const eventos = desplazar(
    filtros(req, soloGooglePagado),
    ads.params.length + ga4.params.length
  );

  const sql = sqlFunnel(agrupacion, ads, ga4, eventos);
  return query(sql, [...ads.params, ...ga4.params, ...eventos.params]);
}

// GET /funnel/resumen?desde=&hasta=&plaza=
// Una fila por mes con el funnel completo del rango.
export async function getFunnelResumen(req: Request, res: Response) {
  const rows = await funnelPor(req, 'mes');
  res.json(rows.map(({ dim, ...resto }) => ({ mes: dim, ...resto })));
}

// GET /funnel/plazas?desde=&hasta=&plaza=
// Una fila por plaza, para comparar proyectos entre sí.
export async function getFunnelPlazas(req: Request, res: Response) {
  const rows = await funnelPor(req, 'plaza');
  res.json(rows.map(({ dim, ...resto }) => ({ plaza: dim, ...resto })));
}

// GET /funnel/campanas?desde=&hasta=&plaza=&limit=
// Campañas de Google Ads ordenadas por inversión.
export async function getFunnelCampanas(req: Request, res: Response) {
  const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);

  const ads = filtros(req);
  // Los eventos no se filtran por plaza: se atribuyen por campaign_id, que es más
  // preciso. Filtrar además por plaza escondería los eventos de una campaña cuya
  // plaza aún no está mapeada.
  const ev = desplazar(filtros(req, [], { ignorarPlaza: true }), ads.params.length);

  const rows = await query(`
    WITH ads AS (
      SELECT
        campaign_id,
        -- El nombre puede haber cambiado durante el rango (están homologando la
        -- nomenclatura): se muestra el más reciente, no uno cualquiera del grupo.
        (ARRAY_AGG(campaign_name ORDER BY fecha DESC))[1] AS campaign_name,
        (ARRAY_AGG(plaza ORDER BY fecha DESC))[1]         AS plaza,
        SUM(inversion)::float                             AS inversion,
        SUM(clics)::int                                   AS clics,
        SUM(impresiones)::int                             AS impresiones,
        SUM(conversiones)::float                          AS conversiones,
        CASE WHEN SUM(impresiones) > 0
             THEN (SUM(clics)::float / SUM(impresiones))
             ELSE 0 END                                   AS ctr,
        CASE WHEN SUM(clics) > 0
             THEN (SUM(inversion)::float / SUM(clics))
             ELSE 0 END                                   AS cpc
      FROM mkt_google_ads
      ${ads.where}
      GROUP BY campaign_id
    ),
    -- GA4 reporta sessionCampaignId con el mismo valor que campaign_id de Google
    -- Ads cuando el etiquetado automático está activo, así que el join es directo.
    ev AS (
      SELECT
        campaign_id,
        SUM(cantidad) FILTER (WHERE evento = 'form_start')::int    AS form_start,
        SUM(cantidad) FILTER (WHERE evento = 'form_send')::int     AS form_send,
        SUM(cantidad) FILTER (WHERE evento = 'send_whatsapp')::int AS whatsapp,
        SUM(cantidad) FILTER (WHERE evento = 'maps_click')::int    AS maps_click
      FROM mkt_ga4_eventos
      ${ev.where}
      GROUP BY campaign_id
    )
    SELECT
      ads.campaign_id,
      ads.campaign_name,
      ads.plaza,
      ads.inversion,
      ads.clics,
      ads.impresiones,
      ads.conversiones,
      ads.ctr,
      ads.cpc,
      COALESCE(ev.form_start, 0)  AS form_start,
      COALESCE(ev.form_send, 0)   AS form_send,
      COALESCE(ev.whatsapp, 0)    AS whatsapp,
      COALESCE(ev.maps_click, 0)  AS maps_click
    FROM ads
    LEFT JOIN ev ON ads.campaign_id = ev.campaign_id
    ORDER BY ads.inversion DESC
    LIMIT $${ads.params.length + ev.params.length + 1}
  `, [...ads.params, ...ev.params, limit]);

  res.json(rows);
}


// GET /funnel/web?desde=&hasta=
// Tráfico del sitio mes a mes y por canal de origen.
//
// Lee mkt_ga4_sitio, NO mkt_ga4. La diferencia importa: mkt_ga4 trae las sesiones
// desglosadas por página, y GA4 cuenta una misma sesión en cada página que visitó
// (quien ve tres fichas aparece en tres filas). Sumar esa tabla infla el total
// ~24%. mkt_ga4_sitio se pide sin la dimensión de página, así que cada sesión
// cuenta una sola vez y el total cuadra con lo que muestra la interfaz de GA4.
export async function getFunnelWeb(req: Request, res: Response) {
  const { where, params } = filtros(req, [], { ignorarPlaza: true });

  const meses = await query(`
    SELECT
      to_char(fecha, 'YYYY-MM')                       AS mes,
      SUM(sesiones)::int                              AS sesiones,
      SUM(usuarios)::int                              AS usuarios,
      SUM(nuevos_usuarios)::int                       AS nuevos_usuarios,
      SUM(sesiones) FILTER (WHERE origen = '${ORIGEN_GOOGLE_PAGADO}')::int
                                                      AS sesiones_google_ads,
      -- El rebote es un promedio: sumarlo no significa nada. Se pondera por
      -- sesiones para que un canal con 20 visitas no pese igual que uno con 5,000.
      CASE WHEN SUM(sesiones) > 0
           THEN SUM(rebote * sesiones) / SUM(sesiones)
           ELSE 0 END::float                          AS rebote
    FROM mkt_ga4_sitio
    ${where}
    GROUP BY 1
    ORDER BY 1
  `, params);

  const canales = await query(`
    SELECT
      canal,
      SUM(sesiones)::int AS sesiones,
      CASE WHEN SUM(sesiones) > 0
           THEN SUM(rebote * sesiones) / SUM(sesiones)
           ELSE 0 END::float AS rebote
    FROM mkt_ga4_sitio
    ${where}
    GROUP BY 1
    ORDER BY sesiones DESC
  `, params);

  res.json({ meses, canales });
}

// GET /funnel/sin-plaza?desde=&hasta=
// Campañas y páginas que el mapeo no reconoció. Es la lista de trabajo para
// corregir la nomenclatura: mientras tengan volumen, el funnel está incompleto.
export async function getFunnelSinPlaza(req: Request, res: Response) {
  const ads = filtros(req, [`plaza = 'Sin plaza'`], { ignorarPlaza: true });
  const campanas = await query(`
    SELECT
      (ARRAY_AGG(campaign_name ORDER BY fecha DESC))[1] AS nombre,
      SUM(inversion)::float                             AS inversion,
      SUM(clics)::int                                   AS clics
    FROM mkt_google_ads
    ${ads.where}
    GROUP BY campaign_id
    ORDER BY inversion DESC
    LIMIT 50
  `, ads.params);

  const ga4 = filtros(req, [`plaza = 'Sin plaza'`], { ignorarPlaza: true });
  const paginas = await query(`
    SELECT pagina AS nombre, SUM(sesiones)::int AS sesiones
    FROM mkt_ga4
    ${ga4.where}
    GROUP BY pagina
    ORDER BY sesiones DESC
    LIMIT 50
  `, ga4.params);

  res.json({ campanas, paginas });
}
