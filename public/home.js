// Home page: a random selection of highly rated films or TV shows to start exploring from.
// Relies on globals from index.html: tmdb(), card(), esc(), year(), view, toast().

// Everything is kept per kind ('movie' or 'tv') so switching tabs does not lose the other selection.
const HOME = { kind: 'movie', picks: {}, seen: { movie: new Set(), tv: new Set() }, totalPages: {}, firstPage: {}, busy: false, token: 0 };
try { if (localStorage.getItem('homeKind') === 'tv') HOME.kind = 'tv'; } catch (e) { /* storage unavailable */ }

// "Highly rated" = rated at least minRating by at least minVotes people. The vote floor keeps out obscure
// titles with a handful of perfect scores. Raise minVotes for more famous picks, lower it for more surprises.
// TV shows collect far fewer votes than films, so their floor is lower.
const HOME_RULES = {
  minRating: 7.5, count: 30, pagesPerPick: 3,
  movie: { minVotes: 1000, endpoint: '/discover/movie', noun: 'films' },
  tv: { minVotes: 300, endpoint: '/discover/tv', noun: 'TV shows' },
};

function homeDiscover(kind, page) {
  return tmdb(HOME_RULES[kind].endpoint, {
    include_adult: 'false', sort_by: 'vote_count.desc',
    'vote_average.gte': HOME_RULES.minRating, 'vote_count.gte': HOME_RULES[kind].minVotes, page,
  });
}

function shuffled(list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// Fetch a few random pages of the qualifying titles, then pick from them. Titles already shown this session
// are used only if there are not enough new ones.
async function pickMovies(kind) {
  if (!HOME.totalPages[kind]) {
    HOME.firstPage[kind] = await homeDiscover(kind, 1);
    HOME.totalPages[kind] = Math.max(1, Math.min(HOME.firstPage[kind].total_pages || 1, 500)); // TMDB serves at most 500 pages
  }
  const T = HOME.totalPages[kind], pages = new Set();
  while (pages.size < Math.min(HOME_RULES.pagesPerPick, T)) pages.add(1 + Math.floor(Math.random() * T));
  const results = await Promise.all([...pages].map((p) => (p === 1 ? HOME.firstPage[kind] : homeDiscover(kind, p))));
  const pool = [], ids = new Set();
  for (const r of results) {
    for (const m of r.results || []) {
      if (m.poster_path && !ids.has(m.id)) { ids.add(m.id); pool.push(m); }
    }
  }
  const seen = HOME.seen[kind];
  const fresh = pool.filter((m) => !seen.has(m.id)), repeats = pool.filter((m) => seen.has(m.id));
  const picks = shuffled(fresh).concat(shuffled(repeats)).slice(0, HOME_RULES.count);
  picks.forEach((m) => seen.add(m.id));
  return picks;
}

function homeCards(list, kind) {
  const tv = kind === 'tv';
  return list.map((m, i) => card((tv ? '#/g/tv/' : '#/g/movie/') + m.id, m.poster_path, tv ? m.name : m.title,
    [year(tv ? m.first_air_date : m.release_date), m.vote_average ? '★ ' + m.vote_average.toFixed(1) : ''].filter(Boolean).join(' · '))
    .replace('class="card"', `class="card" style="animation-delay:${Math.min(i * 18, 360)}ms"`)).join('');
}

function paintHomeGrid() {
  const grid = document.getElementById('homegrid');
  if (!grid) return;
  const list = HOME.picks[HOME.kind] || [];
  grid.innerHTML = list.length ? homeCards(list, HOME.kind) : `<p class="msg">No ${HOME_RULES[HOME.kind].noun} found. Press New selection to try again.</p>`;
}

const onHomePage = () => !location.hash.replace(/^#\/?/, '');

async function showHome() {
  const token = ++HOME.token, kind = HOME.kind, rules = HOME_RULES[kind];
  view.innerHTML = `<div class="homehead">
      <div><h2>Start exploring</h2>
        <div class="hometabs" role="tablist">
          <button role="tab" id="tab-movie" class="${kind === 'movie' ? 'on' : ''}" aria-selected="${kind === 'movie'}" onclick="setHomeKind('movie')">Movies</button>
          <button role="tab" id="tab-tv" class="${kind === 'tv' ? 'on' : ''}" aria-selected="${kind === 'tv'}" onclick="setHomeKind('tv')">TV shows</button>
        </div>
        <p class="homesub">A random selection of highly rated ${rules.noun} (rated ${HOME_RULES.minRating} or higher by at least ${rules.minVotes.toLocaleString('en-US')} people). Click one to see its cast, ${kind === 'tv' ? 'creator, network' : 'director, studio'} and more.</p></div>
      <button class="shuffle" id="shuffle" onclick="shuffleHome()">↻ New selection</button>
    </div>
    <div id="homegrid" class="grid homegrid"><p class="msg">Picking ${rules.noun}…</p></div>`;
  if (!HOME.picks[kind]) {
    try { HOME.picks[kind] = await pickMovies(kind); }
    catch (e) {
      if (token !== HOME.token || !onHomePage()) return;
      document.getElementById('homegrid').innerHTML =
        `<p class="msg">Could not load ${rules.noun}: ${esc(e.message)} <button class="shuffle" onclick="showHome()">Try again</button></p>`;
      return;
    }
  }
  if (token !== HOME.token || !onHomePage()) return;   // you navigated away while it was loading
  paintHomeGrid();
}

function setHomeKind(kind) {
  if (HOME.busy || kind === HOME.kind) return;
  HOME.kind = kind;
  try { localStorage.setItem('homeKind', kind); } catch (e) { /* storage unavailable */ }
  showHome();
}

async function shuffleHome() {
  if (HOME.busy) return;
  HOME.busy = true;
  const kind = HOME.kind;
  const btn = document.getElementById('shuffle'), grid = document.getElementById('homegrid');
  if (btn) { btn.disabled = true; btn.textContent = 'Shuffling…'; }
  if (grid) grid.style.opacity = '0.45';
  try {
    const picks = await pickMovies(kind);
    HOME.picks[kind] = picks;
    if (onHomePage() && HOME.kind === kind) paintHomeGrid();
  } catch (e) { toast('Could not load a new selection: ' + e.message, 5000); }
  finally {
    HOME.busy = false;
    const b = document.getElementById('shuffle'), g = document.getElementById('homegrid');
    if (b) { b.disabled = false; b.textContent = '↻ New selection'; }
    if (g) g.style.opacity = '';
  }
}
