// Kodi Explorer - tiny local server (no dependencies, Node 18+).
// - Serves the UI from ./public
// - Proxies GET /tmdb/* to the TMDB API, adding your key server-side
// - POST /kodi/play {tmdbId} tells Kodi to play that movie via TMDb Helper
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
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

// ---- Starting and raising Kodi (macOS) ----
// We never launch Kodi by name, because with several Kodi versions installed macOS may pick the
// wrong one. Instead we find the running Kodi's .app path (or the one installed Kodi app) and open
// that exact app. Set "kodiAppPath" in config.json to choose one explicitly.
const START_TIMEOUT_MS = (cfg.kodiStartTimeoutSec || 90) * 1000;  // how long to wait for Kodi to start answering
const SETTLE_MS = (cfg.kodiSettleSec ?? 6) * 1000;  // extra time after it answers, so its add-ons finish loading
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isLocalHost = (h) => ['127.0.0.1', 'localhost', '::1'].includes(String(h).toLowerCase());

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

// Is Kodi's web server answering? A wrong password is reported, not treated as "down".
async function kodiUp() {
  try { const out = await kodiCall('JSONRPC.Ping', {}, 1500); return !!out && out.result === 'pong'; }
  catch (e) { if (/HTTP 401/.test(e.message)) throw e; return false; }
}

function resolveKodiApp() {
  if (cfg.kodiAppPath) return { path: cfg.kodiAppPath };
  const found = [];
  for (const d of ['/Applications', path.join(os.homedir(), 'Applications')]) {
    let names = [];
    try { names = fs.readdirSync(d); } catch (e) { /* folder missing */ }
    for (const n of names) {
      if (/^Kodi.*\.app$/i.test(n) && fs.existsSync(path.join(d, n, 'Contents', 'MacOS', 'Kodi'))) found.push(path.join(d, n));
    }
  }
  if (found.length === 1) return { path: found[0] };
  if (!found.length) return { error: 'Kodi is not running and no Kodi app was found in /Applications. Start Kodi yourself, or set "kodiAppPath" in config.json.' };
  return { error: 'Kodi is not running and several Kodi apps are installed (' + found.join(', ') + '). Set "kodiAppPath" in config.json to the one to use.' };
}

// Make sure Kodi is up before we send it anything. Resolves true if we had to start it, false if it
// was already up. A shared promise stops a double-click from launching Kodi twice.
let kodiStart = null;
function ensureKodi() {
  if (kodiStart) return kodiStart;
  kodiStart = (async () => {
    if (await kodiUp()) return false;
    const where = `${cfg.kodi.host}:${cfg.kodi.port}`;
    if (process.platform !== 'darwin' || !isLocalHost(cfg.kodi.host)) {
      throw new Error(`Kodi is not answering at ${where}. Start Kodi and check that its web server is enabled.`);
    }
    const apps = await new Promise(findRunningKodiApps);
    if (apps.length) {
      console.log('[kodi] Kodi is running but its web server is not answering yet; waiting');
    } else {
      const r = resolveKodiApp();
      if (r.error) throw new Error(r.error);
      console.log('[kodi] Kodi is not running; launching', r.path);
      await new Promise((res, rej) => execFile('open', [r.path], (e) => (e ? rej(new Error('Could not launch Kodi: ' + e.message)) : res())));
    }
    const t0 = Date.now();
    while (Date.now() - t0 < START_TIMEOUT_MS) {
      await sleep(1000);
      if (await kodiUp()) {
        console.log(`[kodi] Kodi is answering after ${Math.round((Date.now() - t0) / 1000)}s; letting add-ons settle`);
        await sleep(SETTLE_MS);
        return true;
      }
    }
    throw new Error(apps.length
      ? `Kodi is running but its web server did not answer at ${where} within ${START_TIMEOUT_MS / 1000}s. Check Settings > Services > Control > "Allow remote control via HTTP".`
      : `Kodi was launched but did not become ready within ${START_TIMEOUT_MS / 1000}s.`);
  })().finally(() => { kodiStart = null; });
  return kodiStart;
}

// Bring the running Kodi window to the front so its dialogs (Seren source select) are visible.
// Disable with "bringKodiToFront": false in config.json.
function raiseKodi() {
  if (process.platform !== 'darwin' || cfg.bringKodiToFront === false) return;
  const report = (err) => { if (err) console.log('[kodi] could not raise Kodi window:', err.message); };
  findRunningKodiApps((apps) => {
    if (apps.length > 1) console.log('[kodi] warning: several Kodi apps are running:', apps.join(' | '));
    if (apps.length) {
      console.log('[kodi] raising running Kodi:', apps[0]);
      execFile('open', [apps[0]], report);
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
      const started = await ensureKodi();
      console.log('[kodi] Player.Open', file);
      raiseKodi();
      const out = await kodiCall('Player.Open', { item: { file } }, 4000);
      console.log('[kodi] response:', JSON.stringify(out));
      if (out.error) {
        res.writeHead(502);
        return res.end(JSON.stringify({ error: 'Kodi rejected the command: ' + (out.error.message || JSON.stringify(out.error)) }));
      }
      res.writeHead(200); res.end(JSON.stringify({ sent: true, started, kodi: out }));
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
