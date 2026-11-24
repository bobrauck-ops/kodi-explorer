// Details + trailer panel (modal). Used by both the list view and the graph view.
// Relies on globals from index.html: tmdb(), esc(), IMG, year(), playOnKodi().

const DETAILS = { cache: {}, open: false, current: null };

// Best YouTube videos first: official Trailer, then Teaser, then everything else; newest first.
function pickVideos(videos) {
  const yt = (videos || []).filter((v) => v.site === 'YouTube' && /^[\w-]+$/.test(v.key || ''));
  const rank = (v) => (v.type === 'Trailer' ? 0 : v.type === 'Teaser' ? 1 : 2) * 2 + (v.official ? 0 : 1);
  return yt.sort((a, b) => rank(a) - rank(b) || String(b.published_at || '').localeCompare(String(a.published_at || ''))).slice(0, 6);
}

function certification(rd) {
  const us = ((rd && rd.results) || []).find((r) => r.iso_3166_1 === 'US');
  const hit = us && us.release_dates.find((d) => d.certification);
  return hit ? hit.certification : '';
}

const money = (n) => (n > 0 ? '$' + Math.round(n).toLocaleString('en-US') : '');
function langName(code) {
  if (!code) return '';
  try { return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) || code; } catch (e) { return code; }
}
function fullDate(d) {
  if (!d) return '';
  const t = new Date(d + 'T12:00:00');
  return isNaN(t) ? d : t.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function tvCertification(cr) {
  const us = ((cr && cr.results) || []).find((r) => r.iso_3166_1 === 'US');
  return us ? us.rating || '' : '';
}

async function loadDetailsTv(id) {
  const t = await tmdb('/tv/' + id, { append_to_response: 'videos,content_ratings' });
  const n = t.number_of_seasons, e = t.number_of_episodes;
  const rt = (t.episode_run_time && t.episode_run_time[0]) || 0;
  return {
    type: 'tv', id: t.id, title: t.name, tagline: t.tagline, overview: t.overview,
    released: fullDate(t.first_air_date), lastAired: t.in_production ? '' : fullDate(t.last_air_date),
    seasonsText: [n ? n + ' season' + (n > 1 ? 's' : '') : '', e ? e + ' episodes' : ''].filter(Boolean).join(' · '),
    runtime: rt, cert: tvCertification(t.content_ratings),
    score: t.vote_average, votes: t.vote_count, status: t.status,
    language: langName(t.original_language),
    countries: (t.production_countries || []).map((c) => c.name),
    network: (t.networks || []).map((x) => x.name).join(', '),
    creators: (t.created_by || []).map((x) => x.name).join(', '),
    seasons: t.seasons || [],
    videos: pickVideos(t.videos && t.videos.results),
  };
}

async function loadDetails(id, type) {
  const ck = (type === 'tv' ? 'tv' : 'movie') + id;
  if (DETAILS.cache[ck]) return DETAILS.cache[ck];
  if (type === 'tv') return (DETAILS.cache[ck] = await loadDetailsTv(id));
  const m = await tmdb('/movie/' + id, { append_to_response: 'videos,release_dates' });
  const d = {
    id: m.id, title: m.title, tagline: m.tagline, overview: m.overview,
    released: fullDate(m.release_date), runtime: m.runtime, cert: certification(m.release_dates),
    score: m.vote_average, votes: m.vote_count, status: m.status,
    language: langName(m.original_language),
    countries: (m.production_countries || []).map((c) => c.name),
    budget: money(m.budget), revenue: money(m.revenue),
    videos: pickVideos(m.videos && m.videos.results),
  };
  DETAILS.cache[ck] = d;
  return d;
}

function ensureDialog() {
  let el = document.getElementById('dlg');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'dlg';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.addEventListener('click', (e) => { if (e.target === el) closeDetails(); });
  document.body.appendChild(el);
  return el;
}

function videoHtml(v, autoplay, kind) {
  if (!v) return `<div class="vid novid"><div>No trailer listed on TMDB for this ${kind || 'movie'}.</div></div>`;
  if (autoplay) {
    return `<div class="vid"><iframe src="https://www.youtube-nocookie.com/embed/${v.key}?autoplay=1&rel=0" title="${esc(v.name)}"
      allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>`;
  }
  return `<div class="vid"><img src="https://img.youtube.com/vi/${v.key}/hqdefault.jpg" alt="">
    <button class="pl" data-vid="${v.key}" aria-label="Play ${esc(v.name)}"><span>&#9654;</span></button></div>`;
}

function renderDetails(d, vidKey, autoplay) {
  const v = d.videos.find((x) => x.key === vidKey) || d.videos[0];
  const rows = [
    d.type === 'tv' ? ['First aired', d.released] : ['Released', d.released],
    ['Last aired', d.lastAired], ['Seasons', d.seasonsText], ['Created by', d.creators], ['Network', d.network],
    [d.type === 'tv' ? 'Episode length' : 'Runtime', d.runtime ? d.runtime + ' min' : ''], ['Rated', d.cert],
    ['Score', d.score ? '★ ' + d.score.toFixed(1) + (d.votes ? ' (' + d.votes.toLocaleString('en-US') + ' votes)' : '') : ''],
    ['Language', d.language], ['Made in', d.countries.join(', ')], ['Status', d.status],
    ['Budget', d.budget], ['Box office', d.revenue],
  ].filter((r) => r[1]);
  const others = d.videos.length > 1
    ? `<div class="vlist">${d.videos.map((x) => `<button class="vchip${v && x.key === v.key ? ' on' : ''}" data-vid="${x.key}" data-auto="1" title="${esc(x.name)}">${esc(x.type)}${x.official ? '' : ' (unofficial)'}</button>`).join('')}</div>` : '';
  const el = ensureDialog();
  el.innerHTML = `<div class="dbox">
    <button class="dx" id="dclose" aria-label="Close">&times;</button>
    <h2 class="dtitle">${esc(d.title)}</h2>
    ${d.tagline ? `<div class="dtag">${esc(d.tagline)}</div>` : ''}
    <div class="dgrid">
      <div>${videoHtml(v, autoplay, d.type === 'tv' ? 'show' : 'movie')}${others}</div>
      <div>
        <div class="dover">${esc(d.overview || 'No overview available.')}</div>
        <dl class="dl">${rows.map((r) => `<dt>${esc(r[0])}</dt><dd>${esc(r[1])}</dd>`).join('')}</dl>
        ${d.type === 'tv' ? `<div class="tvrow">${tvPlayHtml('d', d.id, d.title, d.seasons)}</div>` : '<button class="play" id="dplay">▶ Play on Kodi</button>'}
      </div>
    </div>
    <div class="dcredit">Trailers play from YouTube. Details from TMDB.</div>
  </div>`;
  document.getElementById('dclose').onclick = closeDetails;
  const dp = document.getElementById('dplay');
  if (dp) dp.onclick = () => { closeDetails(); playOnKodi(d.id, d.title); }; // close first: stops the trailer and keeps the toast visible (TV: see playTv)
}

async function openDetails(id, type) {
  const el = ensureDialog();
  DETAILS.open = true;
  el.classList.add('open');
  el.innerHTML = '<div class="dbox"><p class="msg">Loading…</p></div>';
  try {
    const d = await loadDetails(id, type);
    if (!DETAILS.open) return; // closed while loading
    DETAILS.current = d;
    renderDetails(d, null, false);
    const c = document.getElementById('dclose'); if (c) c.focus();
  } catch (e) {
    el.innerHTML = `<div class="dbox"><button class="dx" id="dclose" aria-label="Close">&times;</button><p class="msg">Could not load details: ${esc(e.message)}</p></div>`;
    document.getElementById('dclose').onclick = closeDetails;
  }
}

function closeDetails() {
  const el = document.getElementById('dlg');
  DETAILS.open = false; DETAILS.current = null;
  if (el) { el.classList.remove('open'); el.innerHTML = ''; } // clearing removes the iframe, which stops playback
}

if (typeof document !== 'undefined') {
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && DETAILS.open) closeDetails(); });
  window.addEventListener('hashchange', () => { if (DETAILS.open) closeDetails(); });
  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('#dlg [data-vid]');
    if (b && DETAILS.current) renderDetails(DETAILS.current, b.dataset.vid, true);
  });
}
