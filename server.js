// Kodi Explorer - tiny local server (no dependencies, Node 18+).
// - Serves the UI from ./public
// - Proxies GET /tmdb/* to the TMDB API, adding your key server-side
// - POST /kodi/play {tmdbId} tells Kodi to play that movie via TMDb Helper
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const cfgPath = path.join(__dirname, 'config.json');
if (!fs.existsSync(cfgPath)) {
  console.error('Missing config.json. Copy config.example.json to config.json and fill it in.');
  process.exit(1);
}
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
const PORT = cfg.listenPort || 3000;
// Listen on this computer only. Anything else on the same Wi-Fi could otherwise use your TMDB key and press Play in Kodi.
const HOST = cfg.listenHost || '127.0.0.1';
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
    if (r.status === 401) throw new Error('Kodi rejected the login (HTTP 401). Check kodi.user and kodi.password in config.json.');
    if (!r.ok) throw new Error('Kodi answered with HTTP ' + r.status);
    return await r.json();
  } finally { clearTimeout(timer); }
}

// On macOS, bring the ALREADY RUNNING Kodi window to the front so its dialogs (player choice,
// Seren source select) are visible. We never launch Kodi by name, because with several Kodi
// versions installed macOS may pick the wrong one. Instead we find the running Kodi's .app path
// and activate that exact app. Disable with "bringKodiToFront": false in config.json.
// Optional: set "kodiAppPath" (e.g. "/Applications/Kodi.app") to launch that specific app
// when no Kodi is running.
function findRunningKodiApps(cb) {
  execFile('ps', ['-axww', '-o', 'command='], { maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => {
    if (err) return cb([]);
    const apps = new Set();
    for (const line of stdout.split('\n')) {
      const m = line.match(/^(\/.*?\.app)\/Contents\/MacOS\/Kodi(?:\s|$)/);
      if (m) apps.add(m[1]);
    }
    cb([...apps]);
  });
}

function raiseKodi() {
  if (process.platform !== 'darwin' || cfg.bringKodiToFront === false) return;
  const report = (err) => { if (err) console.log('[kodi] could not raise Kodi window:', err.message); };
  findRunningKodiApps((apps) => {
    if (apps.length > 1) console.log('[kodi] warning: several Kodi apps are running:', apps.join(' | '));
    if (apps.length) {
      console.log('[kodi] raising running Kodi:', apps[0]);
      execFile('open', [apps[0]], report);
    } else if (cfg.kodiAppPath) {
      console.log('[kodi] Kodi is not running; launching', cfg.kodiAppPath);
      execFile('open', [cfg.kodiAppPath], report);
    } else {
      console.log('[kodi] Kodi does not appear to be running. Start it first, or set "kodiAppPath" in config.json.');
    }
  });
}

async function playOnKodi(req, res) {
  res.setHeader('Content-Type', 'application/json');
  try {
    const { tmdbId } = JSON.parse(await readBody(req) || '{}');
    if (!Number.isInteger(tmdbId)) { res.writeHead(400); return res.end(JSON.stringify({ error: 'tmdbId must be an integer' })); }
    const file = `plugin://plugin.video.themoviedb.helper/?info=play&tmdb_type=movie&tmdb_id=${tmdbId}`;
    try {
      console.log('[kodi] Player.Open', file);
      raiseKodi();
      const out = await kodiCall('Player.Open', { item: { file } }, 4000);
      console.log('[kodi] response:', JSON.stringify(out));
      if (out.error) {
        res.writeHead(502);
        return res.end(JSON.stringify({ error: 'Kodi rejected the command: ' + (out.error.message || JSON.stringify(out.error)) }));
      }
      res.writeHead(200); res.end(JSON.stringify({ sent: true, kodi: out }));
    } catch (e) {
      // Player.Open can block until a source is picked/playback starts. A timeout usually means "it's working".
      if (e.name === 'AbortError') {
        console.log('[kodi] no reply within 4s (Kodi may still be resolving sources)');
        res.writeHead(200); return res.end(JSON.stringify({ sent: true, note: 'No reply from Kodi within 4s; it may still be resolving sources.' }));
      }
      throw e;
    }
  } catch (e) {
    const cause = e.cause && e.cause.code ? ` (${e.cause.code})` : '';
    console.log('[kodi] ERROR:', e.message + cause, `| target http://${cfg.kodi.host}:${cfg.kodi.port}`);
    res.writeHead(502); res.end(JSON.stringify({ error: 'Could not reach Kodi: ' + e.message + cause }));
  }
}

const server = http.createServer(async (req, res) => {
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
});
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') console.error(`Port ${PORT} is already in use. Kodi Explorer may already be running (open http://localhost:${PORT}), or change listenPort in config.json.`);
  else console.error('Server error:', e.message);
  process.exit(1);
});
server.listen(PORT, HOST, () => console.log(`Kodi Explorer running at http://localhost:${PORT} (listening on ${HOST} only)`));
