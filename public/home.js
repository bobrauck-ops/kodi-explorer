// Home page: a random selection of highly rated films to start exploring from.
// Relies on globals from index.html: tmdb(), card(), esc(), year(), view, toast().

const HOME = { picks: null, seen: new Set(), totalPages: null, firstPage: null, busy: false, token: 0 };
// "Highly rated" = rated at least minRating by at least minVotes people. The vote floor keeps out obscure
// films with a handful of perfect scores. Raise minVotes for more famous films, lower it for more surprises.
const HOME_RULES = { minRating: 7.5, minVotes: 1000, count: 30, pagesPerPick: 3 };

function homeDiscover(page) {
  return tmdb('/discover/movie', {
    include_adult: 'false', sort_by: 'vote_count.desc',
    'vote_average.gte': HOME_RULES.minRating, 'vote_count.gte': HOME_RULES.minVotes, page,
  });
}

function shuffled(list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// Fetch a few random pages of the qualifying films, then pick from them. Films already shown this session
// are used only if there are not enough new ones.
async function pickMovies() {
  if (!HOME.totalPages) {
    HOME.firstPage = await homeDiscover(1);
    HOME.totalPages = Math.max(1, Math.min(HOME.firstPage.total_pages || 1, 500)); // TMDB serves at most 500 pages
  }
  const T = HOME.totalPages, pages = new Set();
  while (pages.size < Math.min(HOME_RULES.pagesPerPick, T)) pages.add(1 + Math.floor(Math.random() * T));
  const results = await Promise.all([...pages].map((p) => (p === 1 ? HOME.firstPage : homeDiscover(p))));
  const pool = [], ids = new Set();
  for (const r of results) {
    for (const m of r.results || []) {
      if (m.poster_path && !ids.has(m.id)) { ids.add(m.id); pool.push(m); }
    }
  }
  const fresh = pool.filter((m) => !HOME.seen.has(m.id)), repeats = pool.filter((m) => HOME.seen.has(m.id));
  const picks = shuffled(fresh).concat(shuffled(repeats)).slice(0, HOME_RULES.count);
  picks.forEach((m) => HOME.seen.add(m.id));
  return picks;
}

function homeCards(list) {
  return list.map((m, i) => card('#/g/movie/' + m.id, m.poster_path, m.title,
    [year(m.release_date), m.vote_average ? '★ ' + m.vote_average.toFixed(1) : ''].filter(Boolean).join(' · '))
    .replace('class="card"', `class="card" style="animation-delay:${Math.min(i * 18, 360)}ms"`)).join('');
}

function paintHomeGrid() {
  const grid = document.getElementById('homegrid');
  if (!grid) return;
  grid.innerHTML = HOME.picks.length ? homeCards(HOME.picks) : '<p class="msg">No films found. Press New selection to try again.</p>';
}

const onHomePage = () => !location.hash.replace(/^#\/?/, '');

async function showHome() {
  const token = ++HOME.token;
  view.innerHTML = `<div class="homehead">
      <div><h2>Start exploring</h2>
        <p class="homesub">A random selection of highly rated films (rated ${HOME_RULES.minRating} or higher by at least ${HOME_RULES.minVotes.toLocaleString('en-US')} people). Click one to see its cast, director, studio and more.</p></div>
      <button class="shuffle" id="shuffle" onclick="shuffleHome()">↻ New selection</button>
    </div>
    <div id="homegrid" class="grid homegrid"><p class="msg">Picking films…</p></div>`;
  if (!HOME.picks) {
    try { HOME.picks = await pickMovies(); }
    catch (e) {
      if (token !== HOME.token || !onHomePage()) return;
      document.getElementById('homegrid').innerHTML =
        `<p class="msg">Could not load films: ${esc(e.message)} <button class="shuffle" onclick="showHome()">Try again</button></p>`;
      return;
    }
  }
  if (token !== HOME.token || !onHomePage()) return;   // you navigated away while it was loading
  paintHomeGrid();
}

async function shuffleHome() {
  if (HOME.busy) return;
  HOME.busy = true;
  const btn = document.getElementById('shuffle'), grid = document.getElementById('homegrid');
  if (btn) { btn.disabled = true; btn.textContent = 'Shuffling…'; }
  if (grid) grid.style.opacity = '0.45';
  try {
    const picks = await pickMovies();
    if (onHomePage()) { HOME.picks = picks; paintHomeGrid(); }
  } catch (e) { toast('Could not load a new selection: ' + e.message, 5000); }
  finally {
    HOME.busy = false;
    const b = document.getElementById('shuffle'), g = document.getElementById('homegrid');
    if (b) { b.disabled = false; b.textContent = '↻ New selection'; }
    if (g) g.style.opacity = '';
  }
}
