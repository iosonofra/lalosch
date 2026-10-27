import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import zlib from 'zlib';
import JSZip from 'jszip';
import { meshToBinarySTL, createStlPackage, cleanLampData } from './stl-exporter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = process.env.PORT || 3000;
const UPSTREAM_CAD_ORIGIN = Buffer.from('aHR0cHM6Ly90aGVsYW1wbWFrZXIudGhlcmFiYml4LmNvbQ==', 'base64').toString('utf8');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.stl': 'model/stl',
  '.zip': 'application/zip'
};

function sendCompressed(req, res, statusCode, contentType, data) {
  const isBuffer = Buffer.isBuffer(data);
  const buffer = isBuffer ? data : Buffer.from(data, 'utf8');
  const acceptEncoding = req.headers['accept-encoding'] || '';

  const isCompressible = contentType.includes('json') ||
    contentType.includes('text') ||
    contentType.includes('javascript') ||
    contentType.includes('css') ||
    contentType.includes('svg');

  if (isCompressible && acceptEncoding.includes('gzip') && buffer.length > 512) {
    zlib.gzip(buffer, { level: 6 }, (err, gzipped) => {
      if (!err && gzipped) {
        res.writeHead(statusCode, {
          'Content-Type': contentType,
          'Content-Encoding': 'gzip',
          'Content-Length': gzipped.length
        });
        res.end(gzipped);
        return;
      }
      res.writeHead(statusCode, {
        'Content-Type': contentType,
        'Content-Length': buffer.length
      });
      res.end(buffer);
    });
  } else {
    res.writeHead(statusCode, {
      'Content-Type': contentType,
      'Content-Length': buffer.length
    });
    res.end(buffer);
  }
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = parsedUrl.pathname;
  console.log(`[HTTP] ${req.method} ${pathname}`);

  // Set CORS and Cache-Control headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, User-Agent, Authorization');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Proxy /api/studio
  if (pathname === '/api/studio' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      mode: 'server',
      provider: 'none',
      paymentsEnabled: false,
      freeTestDownloads: true,
      amount: '0.00',
      currency: 'EUR',
      paypalEnvironment: 'test',
      consentText: 'Download diretto file STL gratuito.',
      consentVersion: 'local-stl-replica'
    }));
    return;
  }

  // Proxy GET /api/preview/:previewId
  if (pathname.startsWith('/api/preview/') && req.method === 'GET') {
    const previewId = pathname.replace('/api/preview/', '').trim();
    const cableExit = parsedUrl.searchParams.get('cableExit') || 'bottom';
    const cacheDir = path.join(__dirname, 'cache');
    const previewCacheFile = path.join(cacheDir, `preview_${previewId}.json`);

    if (fs.existsSync(previewCacheFile)) {
      console.log(`[Cache] Servita preview ID ${previewId} da cache (pulita da logo, cavo: ${cableExit})...`);
      try {
        const parsed = JSON.parse(fs.readFileSync(previewCacheFile, 'utf8'));
        cleanLampData(parsed, cableExit);
        sendCompressed(req, res, 200, 'application/json; charset=utf-8', JSON.stringify(parsed));
        return;
      } catch (e) {
        sendCompressed(req, res, 200, 'application/json; charset=utf-8', fs.readFileSync(previewCacheFile, 'utf8'));
        return;
      }
    }

    try {
      console.log(`[Proxy] GET preview ID ${previewId}...`);
      const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': `${UPSTREAM_CAD_ORIGIN}/`
      };
      if (req.headers.authorization) headers['Authorization'] = req.headers.authorization;

      const remoteRes = await fetch(`${UPSTREAM_CAD_ORIGIN}/api/preview/${encodeURIComponent(previewId)}`, {
        method: 'GET',
        headers
      });

      const status = remoteRes.status;
      const responseText = await remoteRes.text();
      if (status === 200 || status === 201) {
        try {
          const parsed = JSON.parse(responseText);
          cleanLampData(parsed);
          const cleanedText = JSON.stringify(parsed);
          fs.writeFileSync(previewCacheFile, cleanedText, 'utf8');
          sendCompressed(req, res, status, 'application/json; charset=utf-8', cleanedText);
          return;
        } catch (e) {}
      }
      sendCompressed(req, res, status, 'application/json; charset=utf-8', responseText);
    } catch (err) {
      sendCompressed(req, res, 404, 'application/json; charset=utf-8', JSON.stringify({ error: 'NOT_FOUND', message: 'Elemento non disponibile.' }));
    }
    return;
  }

  // Proxy /api/preview with local disk cache
  if (pathname === '/api/preview' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const reqPayload = JSON.parse(body);
        const cableExit = reqPayload.params?.cableExit || 'bottom';
        if (reqPayload.params?.cableExit) {
          delete reqPayload.params.cableExit;
        }
        const upstreamBody = JSON.stringify(reqPayload);

        const crypto = await import('crypto');
        const hash = crypto.createHash('sha256').update(upstreamBody.trim()).digest('hex');
        const cacheDir = path.join(__dirname, 'cache');
        if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
        const cacheFile = path.join(cacheDir, `${hash}.json`);

        if (fs.existsSync(cacheFile)) {
          console.log(`[Cache] Servita preview da cache locale (${hash}, cavo: ${cableExit})...`);
          try {
            const parsed = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
            cleanLampData(parsed, cableExit);
            sendCompressed(req, res, 200, 'application/json; charset=utf-8', JSON.stringify(parsed));
            return;
          } catch (e) {
            console.error('[Cache] Errore lettura cache:', e);
          }
        }

        console.log(`[Proxy] Calcolo preview CAD 3D per LaLosch...`);
        const remoteRes = await fetch(`${UPSTREAM_CAD_ORIGIN}/api/preview`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': `${UPSTREAM_CAD_ORIGIN}/`
          },
          body: upstreamBody
        });

        const status = remoteRes.status;
        const responseText = await remoteRes.text();
        console.log(`[Proxy] Risposta ricevuta (status ${status}, ${responseText.length} bytes)`);

        if (status === 200 || status === 201) {
          try {
            const parsed = JSON.parse(responseText);
            // Eliminate debossed logo and cache baseline clean data
            cleanLampData(parsed, 'bottom');
            const cleanedText = JSON.stringify(parsed);
            fs.writeFileSync(cacheFile, cleanedText, 'utf8');
            if (parsed.previewId) {
              fs.writeFileSync(path.join(cacheDir, `preview_${parsed.previewId}.json`), cleanedText, 'utf8');
            }
            // Apply requested cableExit
            if (cableExit === 'right') {
              cleanLampData(parsed, 'right');
            }
            sendCompressed(req, res, status, 'application/json; charset=utf-8', JSON.stringify(parsed));
            return;
          } catch (e) {
            console.error('[Proxy] Errore elaborazione risposta:', e);
          }
        }

        sendCompressed(req, res, status, 'application/json; charset=utf-8', responseText);
      } catch (err) {
        console.error('[Proxy] Errore proxy:', err);
        sendCompressed(req, res, 502, 'application/json; charset=utf-8', JSON.stringify({ error: 'PROXY_ERROR', message: err.message }));
      }
    });
    return;
  }

  // Local /api/export-stl endpoint
  if (pathname === '/api/export-stl' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body);
        const data = payload.data || payload;
        const cableExit = payload.cableExit || data.meta?.params?.cableExit || 'bottom';
        cleanLampData(data, cableExit);

        let guideBytes = null;
        const guidePath = path.join(__dirname, 'assets', 'LALOSCH_QUICK_START_GUIDE.png');
        if (fs.existsSync(guidePath)) guideBytes = fs.readFileSync(guidePath);

        const zip = await createStlPackage(JSZip, data, guideBytes);
        const zipBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });

        const centerClean = (data.meta?.params?.centerText || 'lampada').toLowerCase().replace(/[^a-z0-9]/g, '_');
        res.writeHead(200, {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="${centerClean}_lamp_STL.zip"`
        });
        res.end(zipBuffer);
      } catch (err) {
        console.error('[Export] Errore esportazione STL:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'EXPORT_ERROR', message: err.message }));
      }
    });
    return;
  }

  // Static file serving
  let relativePath = pathname === '/' ? '/index.html' : pathname;
  // Sanitize path
  const safePath = path.normalize(path.join(__dirname, relativePath));
  if (!safePath.startsWith(__dirname)) {
    res.writeHead(403);
    res.end('Access Denied');
    return;
  }

  fs.stat(safePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('File not found');
      return;
    }

    const ext = path.extname(safePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    if (stats.size > 512 && MIME_TYPES[ext] && !['.png', '.jpg', '.zip', '.stl'].includes(ext)) {
      fs.readFile(safePath, (readErr, data) => {
        if (readErr) {
          res.writeHead(500);
          res.end('Server error');
          return;
        }
        sendCompressed(req, res, 200, contentType, data);
      });
    } else {
      res.writeHead(200, { 'Content-Type': contentType, 'Content-Length': stats.size });
      fs.createReadStream(safePath).pipe(res);
    }
  });
});

server.listen(PORT, () => {
  console.log('='.repeat(60));
  console.log(`LaLosch Server attivo su: http://localhost:${PORT}`);
  console.log('='.repeat(60));
  console.log('Visualizza nel browser per configurare la lampada in 3D');
  console.log('ed esportare direttamente i file STL pronti per la stampa!');
});
