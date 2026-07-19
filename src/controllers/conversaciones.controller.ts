import type { Request, Response } from 'express';
import { query } from '../db/pool.js';
import https from 'https';

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

export async function getMediaProxy(req: Request, res: Response) {
  const { imagen_id } = req.params;
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) {
    res.status(500).json({ error: 'META_ACCESS_TOKEN no configurado' });
    return;
  }

  const url = `https://graph.facebook.com/v25.0/${imagen_id}?access_token=${token}`;

  // Primero obtenemos la URL de descarga real
  https.get(url, (metaRes) => {
    let body = '';
    metaRes.on('data', (chunk) => (body += chunk));
    metaRes.on('end', () => {
      try {
        const json = JSON.parse(body);
        const downloadUrl = json.url;
        if (!downloadUrl) {
          res.status(404).json({ error: 'URL de imagen no encontrada' });
          return;
        }
        // Hacemos proxy de la imagen real
        https.get(downloadUrl, { headers: { Authorization: `Bearer ${token}` } }, (imgRes) => {
          res.setHeader('Content-Type', imgRes.headers['content-type'] || 'image/jpeg');
          res.setHeader('Cache-Control', 'public, max-age=86400');
          imgRes.pipe(res);
        }).on('error', () => res.status(502).json({ error: 'Error al descargar imagen' }));
      } catch {
        res.status(502).json({ error: 'Respuesta inválida de Meta' });
      }
    });
  }).on('error', () => res.status(502).json({ error: 'Error conectando con Meta' }));
}

// Imagen del creativo de un anuncio en alta resolución vía Graph API.
// Las miniaturas que guarda leads_formulario son de 64px (se pixelean);
// acá se pide el thumbnail grande del adcreative con el token de Meta.
// Caché en memoria por ad_id: una sola llamada a Meta por anuncio único,
// después se redirige directo al CDN (las URLs firmadas duran horas).
const creativoCache = new Map<string, { url: string; exp: number }>();
const CREATIVO_TTL = 1000 * 60 * 60 * 6; // 6h, menor que la vida de la URL firmada

function graphGet(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    https.get(url, (r) => {
      let body = '';
      r.on('data', (c) => (body += c));
      r.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

export async function getCreativoImagen(req: Request, res: Response) {
  const ad_id = String(req.params.ad_id);
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) {
    res.status(500).json({ error: 'META_ACCESS_TOKEN no configurado' });
    return;
  }
  if (!/^\d+$/.test(ad_id)) {
    res.status(400).json({ error: 'ad_id inválido' });
    return;
  }

  const cacheado = creativoCache.get(ad_id);
  if (cacheado && cacheado.exp > Date.now()) {
    res.redirect(302, cacheado.url);
    return;
  }

  try {
    const json = await graphGet(
      `https://graph.facebook.com/v25.0/${ad_id}/adcreatives?fields=thumbnail_url,video_id,image_url,asset_feed_spec{videos{video_id}}&thumbnail_width=720&thumbnail_height=720&access_token=${token}`
    );
    const creative = json?.data?.[0];
    let url: string | undefined = creative?.image_url || creative?.thumbnail_url;

    // Anuncios de video: el thumbnail_url del creative suele venir chico
    // aunque se pidan 720px. El video_id puede estar en la raíz del creative
    // o, en anuncios flexibles (Advantage+), dentro de asset_feed_spec.
    // /{video_id}/thumbnails trae varias resoluciones; se elige la más grande.
    const videoId: string | undefined =
      creative?.video_id || creative?.asset_feed_spec?.videos?.[0]?.video_id;
    if (videoId) {
      try {
        const thumbs = await graphGet(
          `https://graph.facebook.com/v25.0/${videoId}/thumbnails?access_token=${token}`
        );
        const mejor = (thumbs?.data ?? [])
          .sort((a: any, b: any) => (b.height || 0) - (a.height || 0))[0];
        if (mejor?.uri) url = mejor.uri;
      } catch {
        // sin permiso sobre el video: se queda con el thumbnail del creative
      }
    }

    if (!url) {
      res.status(404).json({ error: 'Creativo sin imagen' });
      return;
    }
    creativoCache.set(ad_id, { url, exp: Date.now() + CREATIVO_TTL });
    res.redirect(302, url);
  } catch {
    res.status(502).json({ error: 'Error consultando Meta' });
  }
}

export async function getNuevos(req: Request, res: Response) {
  const { numero, desde } = req.params;
  const rows = await query(`
    SELECT * FROM conversaciones WHERE numero=$1 AND id > $2 ORDER BY fecha ASC
  `, [numero, parseInt(desde as string) || 0]);

  res.json(rows);
}