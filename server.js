// Kodi Explorer - tiny local server (no dependencies, Node 18+).
// - Serves the UI from ./public
// - Proxies GET /tmdb/* to the TMDB API, adding your key server-side
// - POST /kodi/play {tmdbId} tells Kodi to play that movie via TMDb Helper
const http = require('http');
const fs = require('fs');
const path = require('path');

const cfgPath = path.join(__dirname, 'config.json');
if (!fs.existsSync(cfgPath)) {
  console.error('Missing config.json. Copy config.example.json to config.json and fill it in.');
  process.exit(1);
}
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
const PORT = cfg.listenPort || 3000;
const PUBLIC = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

function tmdbHeaders() {
  // A v4 "Read Access Token" is a long JWT; a v3 API key is 32 chars.
  return cfg.tmdbKey.length > 40 ? { Authorization: 'Bearer ' + cfg.tmdbKey } : {};
}

async function proxyTmdb(req, res, url) {
  const target = new URL('https://api.themoviedb.org/3' + url.pathname.replace(/^\/tmdb/, ''));
  url.searchParams.forEach((v, k) => target.searchParams.set(k, v));
  if (cfg.tmdbKey.length <= 40) target.searchParams.set('api_key', cfg.tmdbKey);
  try {
    const r = await fetch(target, { headers: tmdbHeaders() });
    res.writeHead(r.status, { 'Content-Type': 'application/json' });
    res.end(await r.text());
  } catch (e) {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'TMDB request failed: ' + e.message }));
  }
}

function readBody(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => resolve(b));
  });
}

async function kodiCall(method, params, timeoutMs) {
  const k = cfg.kodi;
  const headers = { 'Content-Type': 'application/json' };
  if (k.user) headers.Authorization = 'Basic ' + Buffer.from(`${k.user}:${k.password || ''}`).toString('base64');
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(`http://${k.host}:${k.port}/jsonrpc`, {
      method: 'POST', headers, signal: ctl.signal,
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    return await r.json();
  } finally { clearTimeout(timer); }
}

async function playOnKodi(req, res) {
  res.setHeader('Content-Type', 'application/json');
  try {
    const { tmdbId } = JSON.parse(await readBody(req) || '{}');
    if (!Number.isInteger(tmdbId)) { res.writeHead(400); return res.end(JSON.stringify({ error: 'tmdbId must be an integer' })); }
    const file = `plugin://plugin.video.themoviedb.helper/?info=play&tmdb_type=movie&tmdb_id=${tmdbId}`;
    try {
      const out = await kodiCall('Player.Open', { item: { file } }, 4000);
      res.writeHead(200); res.end(JSON.stringify({ sent: true, kodi: out }));
    } catch (e) {
      // Player.Open can block until a source is picked/playback starts. A timeout usually means "it's working".
      if (e.name === 'AbortError') { res.writeHead(200); return res.end(JSON.stringify({ sent: true, note: 'Command sent; Kodi is still resolving sources (e.g. Seren source select).' })); }
      throw e;
    }
  } catch (e) {
    res.writeHead(502); res.end(JSON.stringify({ error: 'Could not reach Kodi: ' + e.message }));
  }
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'GET' && url.pathname.startsWith('/tmdb/')) return proxyTmdb(req, res, url);
  if (req.method === 'POST' && url.pathname === '/kodi/play') return playOnKodi(req, res);
  if (req.method === 'GET') {
    const file = path.join(PUBLIC, url.pathname === '/' ? 'index.html' : url.pathname);
    if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    return fs.createReadStream(file).pipe(res);
  }
  res.writeHead(405); res.end();
}).listen(PORT, () => console.log(`Kodi Explorer running at http://localhost:${PORT}`));
