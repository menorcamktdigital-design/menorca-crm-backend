import type { Request, Response } from 'express';
import https from 'https';
import fs from 'fs';
import path from 'path';

// Carpeta persistente en disco (se sirve tras la primera descarga desde Meta)
const MEDIA_DIR = path.join(process.cwd(), 'media', 'whatsapp');
fs.mkdirSync(MEDIA_DIR, { recursive: true });

const CT_POR_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  mp4: 'video/mp4',
  ogg: 'audio/ogg',
  mp3: 'audio/mpeg',
  amr: 'audio/amr',
  pdf: 'application/pdf',
  bin: 'application/octet-stream',
};

function extDe(ct: string): string {
  if (ct.includes('jpeg') || ct.includes('jpg')) return 'jpg';
  if (ct.includes('png')) return 'png';
  if (ct.includes('webp')) return 'webp';
  if (ct.includes('mp4')) return 'mp4';
  if (ct.includes('ogg')) return 'ogg';
  if (ct.includes('mpeg') || ct.includes('mp3')) return 'mp3';
  if (ct.includes('amr')) return 'amr';
  if (ct.includes('pdf')) return 'pdf';
  return 'bin';
}

function buscarEnDisco(id: string): string | null {
  try {
    const f = fs.readdirSync(MEDIA_DIR).find((x) => x.startsWith(id + '.'));
    return f ? path.join(MEDIA_DIR, f) : null;
  } catch {
    return null;
  }
}

function servirDeDisco(res: Response, ruta: string) {
  const ext = ruta.split('.').pop() || 'bin';
  res.setHeader('Content-Type', CT_POR_EXT[ext] || 'application/octet-stream');
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  fs.createReadStream(ruta).pipe(res);
}

// GET /media/wa/:media_id  — público (sin auth), id opaco de Meta = imposible de adivinar.
// 1) si ya está en disco lo sirve. 2) si no, lo descarga de Meta, lo guarda y lo sirve.
export async function getMediaWa(req: Request, res: Response) {
  const id = String(req.params.media_id);
  if (!/^\d+$/.test(id)) {
    res.status(400).json({ error: 'media_id inválido' });
    return;
  }

  const enDisco = buscarEnDisco(id);
  if (enDisco) {
    servirDeDisco(res, enDisco);
    return;
  }

  const token = process.env.META_ACCESS_TOKEN;
  if (!token) {
    res.status(500).json({ error: 'META_ACCESS_TOKEN no configurado' });
    return;
  }

  // 1) resolver la URL real de descarga desde el media_id
  https
    .get(`https://graph.facebook.com/v25.0/${id}?access_token=${token}`, (metaRes) => {
      let body = '';
      metaRes.on('data', (c) => (body += c));
      metaRes.on('end', () => {
        let downloadUrl = '';
        try {
          downloadUrl = JSON.parse(body).url;
        } catch {
          res.status(502).json({ error: 'Respuesta inválida de Meta' });
          return;
        }
        if (!downloadUrl) {
          res.status(404).json({ error: 'Media no encontrada (pudo expirar en Meta)' });
          return;
        }

        // 2) descargar el binario a un tmp, renombrar, y servir de disco
        https
          .get(downloadUrl, { headers: { Authorization: `Bearer ${token}` } }, (bin) => {
            const ct = bin.headers['content-type'] || 'application/octet-stream';
            const ext = extDe(ct);
            const destino = path.join(MEDIA_DIR, `${id}.${ext}`);
            const tmp = `${destino}.tmp`;
            const file = fs.createWriteStream(tmp);
            bin.pipe(file);
            file.on('finish', () => {
              file.close(() => {
                fs.rename(tmp, destino, (err) => {
                  if (err) {
                    res.status(500).end();
                    return;
                  }
                  servirDeDisco(res, destino);
                });
              });
            });
            file.on('error', () => {
              try {
                fs.unlinkSync(tmp);
              } catch {}
              res.status(500).end();
            });
          })
          .on('error', () => res.status(502).json({ error: 'Error al descargar de Meta' }));
      });
    })
    .on('error', () => res.status(502).json({ error: 'Error conectando con Meta' }));
}
