// Zero-dependency static server for AllMansSky.
// Used by `npm start` locally and by the Railway/Docker deployment.
// Respects $PORT (Railway injects it), gzips text assets, long-caches vendor/.
import { createServer } from 'node:http';
import { stat, readFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createGzip, constants as zc } from 'node:zlib';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.env.PORT ?? 8087);
const HOST = process.env.HOST ?? '0.0.0.0';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.map': 'application/json',
  '.md': 'text/plain; charset=utf-8',
};
const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg', '.map', '.md']);

function cacheHeader(path) {
  if (path.includes('/vendor/')) return 'public, max-age=604800, immutable'; // pinned three.js
  if (path.endsWith('.html') || path === '/') return 'no-cache';
  return 'public, max-age=3600';
}

const server = createServer(async (req, res) => {
  try {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let rel = urlPath === '/' ? '/index.html' : urlPath;
    // resolve inside ROOT only — no traversal
    const file = resolve(join(ROOT, normalize(rel)));
    if (!file.startsWith(resolve(ROOT))) {
      res.writeHead(403); res.end('forbidden'); return;
    }
    const info = await stat(file).catch(() => null);
    if (!info?.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not found');
      return;
    }
    const ext = extname(file).toLowerCase();
    const headers = {
      'Content-Type': MIME[ext] ?? 'application/octet-stream',
      'Cache-Control': cacheHeader(urlPath),
      'X-Content-Type-Options': 'nosniff',
    };
    const wantsGzip = COMPRESSIBLE.has(ext)
      && /\bgzip\b/.test(req.headers['accept-encoding'] ?? '')
      && info.size > 1024;
    if (wantsGzip) {
      headers['Content-Encoding'] = 'gzip';
      headers.Vary = 'Accept-Encoding';
      res.writeHead(200, headers);
      createReadStream(file).pipe(createGzip({ level: zc.Z_BEST_SPEED })).pipe(res);
    } else {
      headers['Content-Length'] = info.size;
      res.writeHead(200, headers);
      createReadStream(file).pipe(res);
    }
  } catch (err) {
    console.error(err);
    res.writeHead(500); res.end('server error');
  }
});

server.listen(PORT, HOST, () => {
  console.log(`AllMansSky serving on http://${HOST}:${PORT}`);
});
