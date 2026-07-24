// Descarga y guarda (self-host) las miniaturas de los creativos de TikTok
// para los leads de formulario_tiktok, y apunta la BD a nuestra URL local
// (/api/crm/media/tiktok/...). Así las imágenes no dependen del CDN de
// TikTok, que entrega URLs firmadas que expiran.
//
// El cruce con la cuenta se hace por NOMBRE de anuncio, y se corrige el
// ad_id en la BD usando el valor real de la API de TikTok.
//
// Uso (desde la raíz del backend):
//   node scripts/tiktok-creativos.js           -> simulación (no baja ni escribe)
//   node scripts/tiktok-creativos.js --apply    -> descarga imágenes + actualiza BD
//
// Pensado también para correr semanalmente por cron y refrescar/agregar nuevos.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { Pool } = require('pg');

const APPLY = process.argv.includes('--apply');
const TOKEN = process.env.TIKTOK_ACCESS_TOKEN;
const ADV = process.env.TIKTOK_ADVERTISER_ID;
const MEDIA_DIR = path.join(process.cwd(), 'media', 'tiktok');
const pool = new Pool({
  host: process.env.DB_HOST, port: Number(process.env.DB_PORT),
  user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
});

const getJson = (url) => new Promise((res, rej) => {
  https.get(url, { headers: { 'Access-Token': TOKEN } }, (r) => {
    let b = ''; r.on('data', (c) => (b += c));
    r.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } });
  }).on('error', rej);
});

// Descarga binaria a archivo, siguiendo hasta 3 redirects. http o https según el protocolo.
function download(url, dest, depth = 0) {
  return new Promise((resolve, reject) => {
    if (depth > 3) return reject(new Error('demasiados redirects'));
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, (r) => {
      if ([301, 302, 303, 307, 308].includes(r.statusCode) && r.headers.location) {
        r.resume();
        return resolve(download(r.headers.location, dest, depth + 1));
      }
      if (r.statusCode !== 200) { r.resume(); return reject(new Error('HTTP ' + r.statusCode)); }
      const tmp = dest + '.tmp';
      const f = fs.createWriteStream(tmp);
      r.pipe(f);
      f.on('finish', () => f.close(() => { fs.renameSync(tmp, dest); resolve(true); }));
      f.on('error', reject);
    }).on('error', reject);
  });
}

const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

(async () => {
  if (!TOKEN || !ADV) { console.error('Faltan TIKTOK_ACCESS_TOKEN / TIKTOK_ADVERTISER_ID'); process.exit(1); }
  console.log('MODO:', APPLY ? 'APLICAR' : 'SIMULACION');

  // 1) catálogo de anuncios (todos los estados)
  const filt = encodeURIComponent(JSON.stringify({ primary_status: 'STATUS_ALL' }));
  const ads = []; let page = 1, more = true;
  while (more) {
    const u = `https://business-api.tiktok.com/open_api/v1.3/ad/get/?advertiser_id=${ADV}&page=${page}&page_size=100&fields=["ad_name","video_id","ad_id"]&filtering=${filt}`;
    const r = await getJson(u);
    if (r?.code !== 0) { console.log('ad/get err', r?.message); break; }
    ads.push(...(r?.data?.list || []));
    const total = r?.data?.page_info?.total_number || 0;
    more = page < Math.ceil(total / 100); page++; if (page > 60) break;
  }
  console.log('anuncios en la cuenta:', ads.length);

  // 2) match por nombre -> video_id
  const { rows } = await pool.query(`SELECT DISTINCT ad_name FROM formulario_tiktok WHERE ad_name IS NOT NULL AND ad_name<>''`);
  const elegir = (t0) => { const t = norm(t0); const c = ads.filter((a) => { const n = norm(a.ad_name); return n === t || n.endsWith(t) || n.includes(t); }); return (c.find((a) => a.video_id) || c[0] || null); };
  const items = [];
  const adIdMap = new Map();
  for (const r of rows) { const a = elegir(r.ad_name); if (a) { if (a.ad_id) adIdMap.set(r.ad_name, String(a.ad_id)); if (a.video_id) items.push({ ad_name: r.ad_name, video_id: a.video_id }); } }

  // 3) info de video (cover + preview) por video_id
  const vids = [...new Set(items.map((i) => i.video_id))];
  const vmap = {};
  for (let i = 0; i < vids.length; i += 50) {
    const chunk = vids.slice(i, i + 50);
    const u = `https://business-api.tiktok.com/open_api/v1.3/file/video/ad/info/?advertiser_id=${ADV}&video_ids=${encodeURIComponent(JSON.stringify(chunk))}`;
    const r = await getJson(u);
    for (const v of r?.data?.list || []) vmap[v.video_id] = { cover: v.video_cover_url || v.preview_url || '', preview: v.preview_url || '' };
  }

  console.log('nombres con creativo:', items.length, '| con ad_id:', adIdMap.size, '| sin match:', rows.length - items.length);
  if (!APPLY) { console.log('(SIMULACION: no se descargó ni escribió nada.)'); await pool.end(); return; }

  // 4a) corregir ad_id para todos los matches
  let updIds = 0;
  for (const [adName, adId] of adIdMap) {
    const r = await pool.query(
      `UPDATE formulario_tiktok SET ad_id=$2 WHERE ad_name=$1 AND (ad_id IS NULL OR ad_id<>$2)`,
      [adName, adId]);
    updIds += r.rowCount;
  }
  console.log(`ad_ids corregidos: ${updIds}`);

  // 4b) descargar imágenes + actualizar BD
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
  let bajadas = 0, updLeads = 0, errBajar = 0;
  const yaBajado = new Set();
  for (const it of items) {
    const v = vmap[it.video_id]; if (!v || !v.cover) continue;
    const file = `${it.video_id}.jpg`;
    const dest = path.join(MEDIA_DIR, file);
    if (!yaBajado.has(file)) {
      try { await download(v.cover, dest); bajadas++; yaBajado.add(file); }
      catch (e) { errBajar++; continue; }
    }
    const r = await pool.query(
      `UPDATE formulario_tiktok SET thumbnail_url=$2, video_url=$3 WHERE ad_name=$1`,
      [it.ad_name, `/api/crm/media/tiktok/${file}`, v.preview || null]);
    updLeads += r.rowCount;
  }
  console.log(`imágenes bajadas: ${bajadas} | leads actualizados: ${updLeads} | errores de descarga: ${errBajar}`);
  await pool.end();
})();
