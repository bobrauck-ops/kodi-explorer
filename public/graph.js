// Radial "focus" graph view for Kodi Explorer.
// The selected movie/person/studio/year/genre sits in the centre; its connections sit on a ring,
// grouped (Director, Cast, Studio, Year, Genre...). Click a node to re-centre on it.
// Relies on globals defined in index.html: tmdb, IMG, view, esc, year, pushTrail, playOnKodi.

const GRAPH = { cache: {}, expanded: {}, current: null };
const COLORS = { movie: '#f5b83d', person: '#6cb6ff', company: '#b78bff', year: '#ff8f6b', genre: '#5fd1a5', more: '#8b92a6' };

const dedupe = (arr) => [...new Map(arr.map((x) => [x.id, x])).values()];
const short = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + '…' : s || '');
const byVotes = (a, b) => (b.vote_count || 0) - (a.vote_count || 0);

const movieNode = (r, sub) => ({
  kind: 'movie', label: r.title, img: r.poster_path, href: '#/g/movie/' + r.id,
  sub: sub !== undefined ? sub : year(r.release_date) + (r.vote_average ? ' · ★' + r.vote_average.toFixed(1) : ''),
});
const personNode = (id, name, img, sub) => ({ kind: 'person', label: name, img, sub: sub || '', href: '#/g/person/' + id });

async function discoverMovies(params) {
  const d = await tmdb('/discover/movie', { include_adult: 'false', ...params });
  return d.results;
}

// ---------- data: build the "focus" object for any node type ----------
async function loadFocus(type, id, name) {
  const cacheKey = type + ':' + id;
  if (GRAPH.cache[cacheKey]) return GRAPH.cache[cacheKey];
  let f;

  if (type === 'movie') {
    const m = await tmdb('/movie/' + id, { append_to_response: 'credits' });
    const directors = dedupe(m.credits.crew.filter((c) => c.job === 'Director'));
    const y = year(m.release_date);
    f = {
      type, id, title: m.title, img: m.poster_path, tmdbId: m.id, listHref: '#/movie/' + id,
      sub: [y, m.runtime ? m.runtime + ' min' : '', m.vote_average ? '★ ' + m.vote_average.toFixed(1) : ''].filter(Boolean).join(' · '),
      overview: m.overview,
      groups: [
        { key: 'director', label: 'Director', items: directors.map((d) => personNode(d.id, d.name, d.profile_path, 'Director')) },
        { key: 'cast', label: 'Cast', initial: 6, items: m.credits.cast.slice(0, 12).map((c) => personNode(c.id, c.name, c.profile_path, c.character)) },
        { key: 'studio', label: 'Studio', initial: 3, items: m.production_companies.slice(0, 6).map((c) => ({ kind: 'company', label: c.name, href: '#/g/company/' + c.id })) },
        { key: 'year', label: 'Year', items: y ? [{ kind: 'year', label: y, href: '#/g/year/' + y }] : [] },
        { key: 'genre', label: 'Genre', initial: 2, items: m.genres.map((g) => ({ kind: 'genre', label: g.name, href: '#/g/genre/' + g.id + '/' + encodeURIComponent(g.name) })) },
      ],
    };
  } else if (type === 'person') {
    const p = await tmdb('/person/' + id, { append_to_response: 'movie_credits' });
    const directed = dedupe(p.movie_credits.crew.filter((c) => c.job === 'Director' && c.release_date)).sort(byVotes);
    const acted = dedupe(p.movie_credits.cast.filter((c) => c.release_date)).sort(byVotes);
    f = {
      type, id, title: p.name, img: p.profile_path, listHref: '#/person/' + id,
      sub: [p.known_for_department, p.birthday ? 'born ' + year(p.birthday) : ''].filter(Boolean).join(' · '),
      overview: (p.biography || '').slice(0, 600) + ((p.biography || '').length > 600 ? '…' : ''),
      groups: [
        { key: 'directed', label: 'Directed', initial: 6, items: directed.slice(0, 12).map((c) => movieNode(c)) },
        { key: 'acted', label: 'Acted in', initial: 6, items: acted.slice(0, 12).map((c) => movieNode(c, year(c.release_date) + (c.character ? ' · ' + c.character : ''))) },
      ],
    };
    if (p.known_for_department !== 'Directing' && f.groups[0].items.length && f.groups[1].items.length) f.groups.reverse();
  } else if (type === 'company') {
    const c = await tmdb('/company/' + id);
    const films = await discoverMovies({ with_companies: id, sort_by: 'vote_average.desc', 'vote_count.gte': 300 });
    f = {
      type, id, title: c.name, listHref: '#/company/' + id, sub: [c.origin_country, c.headquarters].filter(Boolean).join(' · '),
      overview: 'Top-rated films from this studio (minimum 300 votes).',
      groups: [{ key: 'films', label: 'Top films', initial: 8, items: films.slice(0, 14).map((r) => movieNode(r)) }],
    };
  } else if (type === 'year') {
    const films = await discoverMovies({ primary_release_year: id, sort_by: 'vote_average.desc', 'vote_count.gte': 500 });
    f = {
      type, id, title: String(id), listHref: '#/year/' + id, sub: 'Release year',
      overview: 'Highest-rated movies of ' + id + ' (minimum 500 votes).',
      groups: [{ key: 'films', label: 'Best of ' + id, initial: 8, items: films.slice(0, 14).map((r) => movieNode(r)) }],
    };
  } else if (type === 'genre') {
    const films = await discoverMovies({ with_genres: id, sort_by: 'vote_average.desc', 'vote_count.gte': 1000 });
    f = {
      type, id, title: name || 'Genre', listHref: '#/genre/' + id + '/' + encodeURIComponent(name || 'Genre'), sub: 'Genre',
      overview: 'Highest-rated ' + (name || '') + ' movies (minimum 1000 votes).',
      groups: [{ key: 'films', label: 'Top ' + (name || 'films'), initial: 8, items: films.slice(0, 14).map((r) => movieNode(r)) }],
    };
  } else {
    throw new Error('Unknown node type');
  }
  GRAPH.cache[cacheKey] = f;
  return f;
}

// ---------- drawing ----------
// Sizes are in SVG units; the whole graph is then scaled by the zoom setting (see graphZoom).
function nodeSize(n, scale = 1) {
  if (n.kind === 'movie') return { w: 74 * scale, h: 111 * scale };
  if (n.kind === 'person') return { w: 84 * scale, h: 84 * scale };
  return { w: Math.min(236, Math.max(92, n.label.length * 9.2 + 34)), h: 38 };
}
const capWidth = (n) => Math.max(Math.min((n.label || '').length, 20) * 8.8, Math.min((n.sub || '').length, 24) * 7.4);

let gradId = 0;
function drawNode(n, x, y, scale = 1, noCaption = false, side = 'below') {
  const { w, h } = nodeSize(n, scale);
  const col = COLORS[n.kind] || '#888';
  const id = 'clip' + ++gradId;
  let shape = '';
  if (n.kind === 'movie') {
    shape = `<clipPath id="${id}"><rect x="${x - w / 2}" y="${y - h / 2}" width="${w}" height="${h}" rx="8"/></clipPath>
      <rect x="${x - w / 2}" y="${y - h / 2}" width="${w}" height="${h}" rx="8" fill="#1b1e27"/>
      ${n.img ? `<image href="${IMG}w342${n.img}" x="${x - w / 2}" y="${y - h / 2}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${id})"/>`
        : `<text x="${x}" y="${y}" text-anchor="middle" fill="#8b92a6" font-size="13">${esc(short(n.label, 10))}</text>`}
      <rect x="${x - w / 2}" y="${y - h / 2}" width="${w}" height="${h}" rx="8" fill="none" stroke="${col}" stroke-width="2.5"/>`;
  } else if (n.kind === 'person') {
    const r = w / 2;
    shape = `<clipPath id="${id}"><circle cx="${x}" cy="${y}" r="${r}"/></clipPath>
      <circle cx="${x}" cy="${y}" r="${r}" fill="#1b1e27"/>
      ${n.img ? `<image href="${IMG}w342${n.img}" x="${x - r}" y="${y - r}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${id})"/>`
        : `<text x="${x}" y="${y + 10}" text-anchor="middle" fill="#8b92a6" font-size="30">${esc((n.label || '?')[0])}</text>`}
      <circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="${col}" stroke-width="2.5"/>`;
  } else {
    shape = `<rect x="${x - w / 2}" y="${y - h / 2}" width="${w}" height="${h}" rx="19" fill="#262b39" stroke="${col}" stroke-width="2"/>
      <text x="${x}" y="${y + 5.5}" text-anchor="middle" fill="${n.kind === 'more' ? '#c9cede' : col}" font-size="16">${esc(short(n.label, 22))}</text>`;
  }
  let caption = '';
  if (!noCaption && (n.kind === 'movie' || n.kind === 'person')) {
    let tx = x, ty = y + h / 2 + 20, anchor = 'middle', sy = y + h / 2 + 38;
    if (side === 'right') { tx = x + w / 2 + 10; anchor = 'start'; ty = y - 2; sy = y + 18; }
    if (side === 'left') { tx = x - w / 2 - 10; anchor = 'end'; ty = y - 2; sy = y + 18; }
    caption = `<text x="${tx}" y="${ty}" text-anchor="${anchor}" fill="#e8eaf0" font-size="16" stroke="#12141a" stroke-width="4" paint-order="stroke">${esc(short(n.label, 20))}</text>` +
      (n.sub ? `<text x="${tx}" y="${sy}" text-anchor="${anchor}" fill="#9aa1b5" font-size="13.5" stroke="#12141a" stroke-width="3.5" paint-order="stroke">${esc(short(n.sub, 24))}</text>` : '');
  }
  const attr = n.more ? `data-more="${esc(n.more)}"` : n.href ? `data-href="${esc(n.href)}"` : '';
  return `<g class="node" ${attr}><title>${esc(n.label)}${n.sub ? ' — ' + esc(n.sub) : ''}</title>${shape}${caption}</g>`;
}

// Returns { svg, box } where box = [minX, minY, maxX, maxY] of what the centre node occupies.
function drawCenter(f, cx, cy) {
  const col = COLORS[f.type] || '#888';
  let shape, halfW, bottom;
  if (f.type === 'movie') {
    shape = drawNode({ kind: 'movie', label: f.title, img: f.img }, cx, cy, 130 / 74, true);
    halfW = 65; bottom = cy + 97.5;
  } else if (f.type === 'person') {
    shape = drawNode({ kind: 'person', label: f.title, img: f.img }, cx, cy, 1.9, true);
    halfW = 80; bottom = cy + 80;
  } else {
    shape = `<circle cx="${cx}" cy="${cy}" r="72" fill="#262b39" stroke="${col}" stroke-width="3.5"/>
      <text x="${cx}" y="${cy + 8}" text-anchor="middle" fill="${col}" font-size="${f.title.length > 12 ? 19 : 26}" font-weight="700">${esc(short(f.title, 16))}</text>`;
    halfW = 72; bottom = cy + 72;
  }
  const title = short(f.title, 30), sub = short(f.sub, 44);
  const svg = `<g>${shape}
    <text x="${cx}" y="${bottom + 28}" text-anchor="middle" fill="#fff" font-size="22" font-weight="700" stroke="#12141a" stroke-width="5" paint-order="stroke">${esc(title)}</text>
    <text x="${cx}" y="${bottom + 50}" text-anchor="middle" fill="#9aa1b5" font-size="15" stroke="#12141a" stroke-width="4" paint-order="stroke">${esc(sub)}</text></g>`;
  const halfLabel = Math.max(halfW, title.length * 6.2, sub.length * 4.2);
  return { svg, box: [cx - halfLabel, cy - (f.type === 'movie' ? 97.5 : f.type === 'person' ? 80 : 72), cx + halfLabel, bottom + 58] };
}

// Points evenly spaced by ARC LENGTH around an ellipse (equal angles would bunch nodes up at the sides).
function ellipseTable(cx, cy, rx, ry, n = 720) {
  const pts = [[cx, cy - ry, 0]];
  let len = 0;
  for (let i = 1; i <= n; i++) {
    const t = -Math.PI / 2 + (2 * Math.PI * i) / n;
    const x = cx + rx * Math.cos(t), y = cy + ry * Math.sin(t);
    const [px, py] = pts[pts.length - 1];
    len += Math.hypot(x - px, y - py);
    pts.push([x, y, len]);
  }
  return { pts, len };
}
function ellipseAt(tbl, frac) {
  const target = (((frac % 1) + 1) % 1) * tbl.len;
  let lo = 0, hi = tbl.pts.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (tbl.pts[m][2] <= target) lo = m; else hi = m; }
  const [x0, y0, d0] = tbl.pts[lo], [x1, y1, d1] = tbl.pts[hi];
  const k = d1 > d0 ? (target - d0) / (d1 - d0) : 0;
  return [x0 + (x1 - x0) * k, y0 + (y1 - y0) * k];
}

function graphSvg(f) {
  const key0 = f.type + ':' + f.id + ':';
  const groups = f.groups.filter((g) => g.items.length).map((g) => {
    const expanded = !!GRAPH.expanded[key0 + g.key];
    const n = expanded ? g.items.length : Math.min(g.items.length, g.initial || g.items.length);
    const more = g.items.length - n;
    const list = g.items.slice(0, n);
    if (more > 0) list.push({ kind: 'more', label: '+' + more + ' more', more: key0 + g.key });
    return { ...g, list };
  });
  // Each node takes up room on the ring: wide pills need more than a poster or portrait.
  const weight = (n) => (n.kind === 'movie' || n.kind === 'person' ? 1.3 : Math.max(1, nodeSize(n).w / 115));
  const GAP = 0.9;
  const total = groups.reduce((s, g) => s + g.list.reduce((t, n) => t + weight(n), 0) + GAP, 0) || 1;
  // Grow the ring when there are many nodes so labels don't collide.
  const k = Math.min(1.5, Math.max(1, total / 25));
  const rx = 570, ry = 300 * k, cx = 0, cy = 0;
  const tbl = ellipseTable(cx, cy, rx, ry);
  let acc = total * 0.02; // small offset so the first group starts just right of the top
  const edges = [], nodes = [], labels = [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const grow = (x0, y0, x1, y1) => { minX = Math.min(minX, x0); minY = Math.min(minY, y0); maxX = Math.max(maxX, x1); maxY = Math.max(maxY, y1); };

  for (const g of groups) {
    const gStart = acc;
    for (const n of g.list) {
      const w = weight(n);
      const [x, y] = ellipseAt(tbl, (acc + w / 2) / total);
      const dx = x - cx;
      const side = dx > 0.5 * rx ? 'right' : dx < -0.5 * rx ? 'left' : 'below';
      nodes.push([n, x, y, side]);
      const sz = nodeSize(n);
      const hasCap = (n.kind === 'movie' || n.kind === 'person');
      const cw = hasCap ? capWidth(n) : 0;
      let x0 = x - sz.w / 2, x1 = x + sz.w / 2, y0 = y - sz.h / 2, y1 = y + sz.h / 2;
      if (hasCap) {
        if (side === 'right') x1 += 10 + cw;
        else if (side === 'left') x0 -= 10 + cw;
        else { x0 = Math.min(x0, x - cw / 2); x1 = Math.max(x1, x + cw / 2); y1 += 44; }
      }
      grow(x0, y0, x1, y1);
      acc += w;
    }
    const [mx, my] = ellipseAt(tbl, (gStart + acc) / 2 / total);
    labels.push([g.label, cx + (mx - cx) * 0.6, cy + (my - cy) * 0.6]);
    acc += GAP;
  }
  const center = drawCenter(f, cx, cy);
  grow(...center.box);
  const M = 28; // margin
  const vb = [minX - M, minY - M, maxX - minX + 2 * M, maxY - minY + 2 * M].map((v) => Math.round(v));

  nodes.forEach(([, x, y]) => edges.push(`<line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="#2b3040" stroke-width="2"/>`));
  const labelSvg = labels.map(([t, x, y]) => `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle" fill="#8b92a6" font-size="14" letter-spacing="2" stroke="#12141a" stroke-width="5" paint-order="stroke">${esc(t.toUpperCase())}</text>`).join('');
  const nodeSvg = nodes.map(([n, x, y, side]) => drawNode(n, +x.toFixed(1), +y.toFixed(1), 1, false, side)).join('');
  return `<svg class="graph" viewBox="${vb.join(' ')}" xmlns="http://www.w3.org/2000/svg">${edges.join('')}${labelSvg}${nodeSvg}${center.svg}</svg>`;
}

// ---------- page ----------
// Zoom: the graph is drawn at (viewport height x zoom). "Fit" picks the largest zoom that still fits the
// window width, so nothing is cropped. Above that, the page scrolls sideways; use A+ / A- (or the + / - keys).
const ZOOMS = [0.8, 1, 1.25, 1.5, 1.75, 2, 2.5];
function loadZoom() {
  try {
    const v = localStorage.getItem('kodiExplorerZoom');
    if (v === 'fit') return 'fit';
    const n = parseFloat(v);
    if (ZOOMS.includes(n)) return n;
  } catch (e) { /* storage unavailable */ }
  return 'fit';
}
GRAPH.zoom = loadZoom();

// Largest zoom (0.8..1.6) whose width still fits the container. aspect = viewBox width / height.
function fitZoom(aspect) {
  const box = document.getElementById('gwrap') || view;
  const avail = Math.max(320, (box.clientWidth || view.clientWidth || window.innerWidth - 40));
  const z = avail / (0.76 * window.innerHeight * aspect);
  return Math.max(0.8, Math.min(1.6, +z.toFixed(2)));
}
function effectiveZoom() { return GRAPH.zoom === 'fit' ? (GRAPH.fitZ || 1) : GRAPH.zoom; }

function setZoom(z) {
  GRAPH.zoom = z;
  try { localStorage.setItem('kodiExplorerZoom', String(z)); } catch (e) { /* ignore */ }
  renderGraphPage();
}
function graphZoom(dir) {
  const cur = effectiveZoom();
  if (dir > 0) { const nxt = ZOOMS.find((z) => z > cur + 0.04); if (nxt) setZoom(nxt); }
  else { const prv = [...ZOOMS].reverse().find((z) => z < cur - 0.04); if (prv) setZoom(prv); }
}

function renderGraphPage() {
  const f = GRAPH.current;
  if (!f) return;
  const svg = graphSvg(f);
  const vb = svg.match(/viewBox="(-?\d+) (-?\d+) (\d+) (\d+)"/);
  const aspect = vb ? +vb[3] / +vb[4] : 1.6;
  GRAPH.fitZ = fitZoom(aspect);
  const z = effectiveZoom();
  const play = f.type === 'movie'
    ? `<button class="play" onclick="playOnKodi(${f.tmdbId}, ${JSON.stringify(f.title).replace(/"/g, '&quot;')})">▶ Play on Kodi</button>` : '';
  view.innerHTML = `<div class="gbar">${play}<div class="overview">${esc(short(f.overview || '', 240))}</div>
      <div class="zoom"><button onclick="graphZoom(-1)" title="Smaller (−)">A−</button><span>${GRAPH.zoom === 'fit' ? 'Fit' : Math.round(z * 100) + '%'}</span><button onclick="graphZoom(1)" title="Larger (+)">A+</button>${GRAPH.zoom === 'fit' ? '' : '<button onclick="setZoom(\'fit\')" title="Fit to window">Fit</button>'}</div></div>
    <div class="gwrap" id="gwrap" style="--z:${z}">${svg}</div>
    <div class="ghint">Click a node to re-centre on it. “+N more” expands a group. Use A− / A+ (or the + and − keys) to change the size.</div>`;
  const w = document.getElementById('gwrap');
  if (w) w.scrollLeft = (w.scrollWidth - w.clientWidth) / 2;
}

async function showGraph(type, id, name) {
  const ok = type === 'year' ? /^\d{4}$/.test(id) : /^\d+$/.test(id);
  if (!ok) { view.innerHTML = '<p class="msg">Not a valid item.</p>'; return; }
  const f = await loadFocus(type, id, name);
  GRAPH.current = f;
  pushTrail('g' + type + id, f.title);
  renderGraphPage();
}

if (typeof window !== 'undefined') {
  let rt;
  window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { if (GRAPH.current && GRAPH.zoom === 'fit' && location.hash.startsWith('#/g/')) renderGraphPage(); }, 200); });
}
if (typeof document !== 'undefined') {
  document.addEventListener('keydown', (e) => {
    if (!location.hash.startsWith('#/g/') || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target && /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
    if (e.key === '+' || e.key === '=') graphZoom(1);
    else if (e.key === '-' || e.key === '_') graphZoom(-1);
  });
  document.addEventListener('click', (e) => {
    const t = e.target.closest && e.target.closest('.graph [data-more], .graph [data-href]');
    if (!t) return;
    if (t.dataset.more) { GRAPH.expanded[t.dataset.more] = true; renderGraphPage(); }
    else if (t.dataset.href) location.hash = t.dataset.href;
  });
}
if (typeof module !== 'undefined') module.exports = { graphSvg, GRAPH };
