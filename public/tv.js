// TV show support: episode picker + play, and the list-view pages for shows, networks, years and genres.
// Relies on globals from index.html: tmdb(), card(), chip(), esc(), year(), view, pushTrail(), playOnKodi(), toast().

const TVSEASONS = {};   // "<prefix><showId>" -> [{ n: seasonNumber, count: episodeCount }]

// Season and episode drop-downs plus a Play button. `prefix` keeps the ids unique when the control appears
// in more than one place (g = graph bar, l = list page, d = details panel).
function tvPlayHtml(prefix, id, title, seasons) {
  const list = (seasons || []).filter((s) => s.episode_count > 0).map((s) => ({ n: s.season_number, count: s.episode_count }));
  TVSEASONS[prefix + id] = list;
  const first = list.find((s) => s.n >= 1) || list[0];   // start at season 1 rather than "Specials"
  if (!first) return `<span class="tvnone">No episodes listed yet.</span>`;
  const seasonOpts = list.map((s) => `<option value="${s.n}"${s.n === first.n ? ' selected' : ''}>${s.n === 0 ? 'Specials' : 'Season ' + s.n}</option>`).join('');
  const t = JSON.stringify(title).replace(/"/g, '&quot;');
  return `<span class="tvplay"><select id="${prefix}-s" aria-label="Season" onchange="tvSeasonChanged('${prefix}', ${id})">${seasonOpts}</select>
    <select id="${prefix}-e" aria-label="Episode">${episodeOpts(first.count)}</select>
    <button class="play" onclick="playTv('${prefix}', ${id}, ${t})">▶ Play on Kodi</button></span>`;
}
const episodeOpts = (n) => Array.from({ length: n }, (_, i) => `<option value="${i + 1}">Episode ${i + 1}</option>`).join('');

function tvSeasonChanged(prefix, id) {
  const s = document.getElementById(prefix + '-s'), e = document.getElementById(prefix + '-e');
  const season = (TVSEASONS[prefix + id] || []).find((x) => x.n === +s.value);
  if (season && e) e.innerHTML = episodeOpts(season.count);
}

function playTv(prefix, id, title) {
  const s = document.getElementById(prefix + '-s'), e = document.getElementById(prefix + '-e');
  if (!s || !e) return;
  const season = +s.value, episode = +e.value;                 // read these first: closing the panel clears it
  if (typeof closeDetails === 'function') closeDetails();       // stops a trailer and keeps the toast visible
  playOnKodi(id, `${title} ${season === 0 ? 'Special' : 'S' + season} E${episode}`, { type: 'tv', season, episode });
}

const tvSpan = (t) => {
  const y = year(t.first_air_date), y2 = year(t.last_air_date);
  return !y ? '' : t.in_production ? y + '–' : y2 && y2 !== y ? y + '–' + y2 : y;
};
const tvCard = (r) => card('#/g/tv/' + r.id, r.poster_path, r.name, year(r.first_air_date) + (r.vote_average ? ' · ★' + r.vote_average.toFixed(1) : ''));

async function showTv(id) {
  const t = await tmdb('/tv/' + id, { append_to_response: 'aggregate_credits,recommendations' });
  const cast = ((t.aggregate_credits && t.aggregate_credits.cast) || []).slice(0, 14);
  pushTrail('tv' + id, t.name);
  const y = year(t.first_air_date);
  view.innerHTML = `
    <div class="hero">
      ${t.poster_path ? `<img src="${IMG}w342${t.poster_path}" alt="">` : ''}
      <div>
        <h2>${esc(t.name)}</h2>
        <div class="meta">${y ? chip('#/tvyear/' + y, tvSpan(t), 'year') + ' · ' : ''}${esc([t.number_of_seasons ? t.number_of_seasons + ' season' + (t.number_of_seasons > 1 ? 's' : '') : '', t.number_of_episodes ? t.number_of_episodes + ' episodes' : '', t.vote_average ? '★ ' + t.vote_average.toFixed(1) + ' (' + (t.vote_count || 0) + ' votes)' : ''].filter(Boolean).join(' · '))}</div>
        <div class="overview">${esc(t.overview)}</div>
        <div class="row"><span class="lbl">Creator</span>${(t.created_by || []).map((d) => chip('#/person/' + d.id, d.name)).join('') || '—'}</div>
        <div class="row"><span class="lbl">Cast</span>${cast.map((c) => chip('#/person/' + c.id, c.name)).join('') || '—'}</div>
        <div class="row"><span class="lbl">Network</span>${(t.networks || []).map((n) => chip('#/network/' + n.id, n.name)).join('') || '—'}</div>
        <div class="row"><span class="lbl">Genres</span>${(t.genres || []).map((g) => chip('#/tvgenre/' + g.id + '/' + encodeURIComponent(g.name), g.name)).join('')}</div>
        <div class="tvrow">${tvPlayHtml('l', t.id, t.name, t.seasons)}<button class="alt" onclick="openDetails(${t.id}, 'tv')">ℹ Details &amp; trailer</button></div>
      </div>
    </div>
    <h3>More like this</h3>
    <div class="grid">${((t.recommendations && t.recommendations.results) || []).slice(0, 12).map(tvCard).join('')}</div>`;
}

async function showTvList(key, label, heading, params, extraHead = '') {
  pushTrail(key, label);
  view.innerHTML = '<p class="msg">Loading…</p>';
  const d = await tmdb('/discover/tv', { include_adult: 'false', ...params });
  view.innerHTML = `${extraHead}<h3>${esc(heading)}</h3><div class="grid">${d.results.map(tvCard).join('')}</div>`;
}

async function showNetwork(id) {
  const n = await tmdb('/network/' + id);
  await showTvList('network' + id, n.name, `Top-rated TV shows from ${n.name}`,
    { with_networks: id, sort_by: 'vote_average.desc', 'vote_count.gte': 300 },
    `<div class="hero"><div><h2>${esc(n.name)}</h2><div class="meta">${esc([n.origin_country, n.headquarters].filter(Boolean).join(' · '))}</div></div></div>`);
}
const showTvYear = (y) => showTvList('tvyear' + y, y + ' (TV)', `Highest-rated TV shows that first aired in ${y} (min. 200 votes)`,
  { first_air_date_year: y, sort_by: 'vote_average.desc', 'vote_count.gte': 200 },
  `<div class="hero"><div><h2>${esc(y)}</h2><div class="meta">TV shows</div></div></div>`);
const showTvGenre = (id, name) => showTvList('tvgenre' + id, name + ' (TV)', `Highest-rated ${name} TV shows (min. 500 votes)`,
  { with_genres: id, sort_by: 'vote_average.desc', 'vote_count.gte': 500 });
