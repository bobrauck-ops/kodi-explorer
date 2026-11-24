# Kodi Explorer

A personal movie discovery tool. Start from any movie or person, click through
directors, cast, studios, years and genres, and press **Play on Kodi** to start
playback in Kodi (via TMDb Helper and Seren).

Status: working prototype with a radial graph view and a list view. Browsing and
Play on Kodi verified end to end on macOS with Kodi 21.

Data and images: this product uses the TMDB API but is not endorsed or certified
by TMDB. Movie data is provided by [The Movie Database](https://www.themoviedb.org).

## Using it

- Search for a movie or person. Results open in the **graph view**: the item sits in the
  centre and its connections (director, cast, studios, year, genres, or a person's films)
  sit on a ring.
- Click any node to re-centre the graph on it. The breadcrumb trail shows where you have been.
- Click **+N more** to expand a group (for example the rest of the cast).
- **Play on Kodi** appears on movie pages.
- **Details & trailer** (next to Play, in both views) opens a panel with the trailer and the
  movie's tagline, overview, release date, runtime, US rating, score, language, countries,
  budget and box office. Nothing is requested from YouTube until you press the trailer's play
  button, and trailers use YouTube's privacy-enhanced player. Esc or a click outside closes it.
- **Size:** the graph starts in **Fit** mode (largest size that fits your window). Use **A+ / A−** in the
  bar above the graph, or the **+ / −** keys, to make everything larger or smaller. Larger sizes
  scroll sideways. **Fit** returns to the default. Your choice is remembered in the browser.
- The **List view / Graph view** button in the header switches between the two views of the
  same item.

## Requirements

- Node.js 18 or newer (no npm packages needed)
- A free TMDB API key (themoviedb.org > Settings > API, "Developer" / non-commercial)
- Kodi 21 with the web server enabled, plus the **TMDb Helper** and **Seren** add-ons

## 1. Configure

```
cp config.example.json config.json
```

Edit `config.json`:

| Key | Meaning |
|---|---|
| `tmdbKey` | TMDB API key or v4 read access token |
| `kodi.host` / `kodi.port` | Kodi web server. Use `127.0.0.1` if Kodi is on the same Mac (that address never changes, whatever network you are on) |
| `kodi.user` / `kodi.password` | Kodi web server login |
| `bringKodiToFront` | macOS only. Raises the already-running Kodi window when you press Play (default true). Never launches Kodi by name |
| `kodiAppPath` | Optional, macOS. Exact app to launch if Kodi is not running, e.g. `/Applications/Kodi.app` |

`config.json` is git-ignored. Never commit it: it holds your key and password.

## 2. Enable Kodi's web server

Kodi > Settings > Services > Control > **Allow remote control via HTTP**. Note the port,
username and password. Test it:

```
curl -u kodi:PASSWORD -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"JSONRPC.Ping","id":1}' http://127.0.0.1:8080/jsonrpc
```

Expected reply: `{"id":1,"jsonrpc":"2.0","result":"pong"}`

## 3. Give TMDb Helper a Seren player (one-time Kodi setup)

TMDb Helper hands movies to other add-ons using small "player" files. If its `players`
folder is empty, Play does nothing (the Kodi log shows "Error getting ... /players/").
Install the Seren player file from this repo (macOS paths):

```
D="$HOME/Library/Application Support/Kodi/userdata/addon_data/plugin.video.themoviedb.helper/players"
mkdir -p "$D"
cp docs/seren.json "$D/seren.json"
```

This file is based on community examples for Seren 3.x and may need adjusting for other
Seren versions. On other systems, use that add-on's `userdata/addon_data/...` folder.

Then make Seren the default so Kodi skips TMDb Helper's player-choice dialog:

1. In Kodi: Add-ons > Video add-ons > TheMovieDb Helper > Settings (context menu).
2. In the list of sections on the left, scroll down past "Trakt" and open **Players**.
   Some skins clip that list without a scroll bar, so the section can be easy to miss.
3. Click the default player for **Movies** and choose **Seren**. Leave the TV default alone
   (the supplied `seren.json` only handles movies).
4. Press OK.

## 4. Run

```
node server.js
```

Open http://localhost:3000. Press **Play on Kodi** on a movie. Kodi comes to the front on
Seren's source list. Pick a source. (If you skipped the default-player step above, Kodi first
asks which player to use. Choose Seren.)

### Optional: start automatically at login (macOS)

From the project folder:

```
bash scripts/install-autostart.sh
```

This installs a macOS launch agent. Kodi Explorer then starts whenever you log in, restarts if it
stops, and needs no Terminal window. Bookmark http://localhost:3000. Its log is
`~/Library/Logs/kodi-explorer.log`. If you used `node server.js` in a Terminal before, press
Ctrl+C there first, because only one copy can use the port. After changing `config.json`, apply it with:

```
launchctl kickstart -k gui/$(id -u)/com.kodi-explorer
```

To remove it: `bash scripts/uninstall-autostart.sh`.

Prefer a manual start? Double-click **Kodi Explorer.command**. It starts the server if needed and
opens the page. (The first time, macOS may require right-click > Open.)

### Network note

The server listens on this computer only (`127.0.0.1`), so other devices on your Wi-Fi cannot reach
it. Only set `listenHost` in `config.json` if you deliberately want access from another device,
and remember anyone on that network could then use your TMDB key and control Kodi.

## Troubleshooting

- **Play does nothing:** read the end of Kodi's log: `tail -n 60 ~/Library/Logs/kodi.log`.
  The server also prints Kodi's reply in the terminal as `[kodi] response:`.
- **Dialog appears but you didn't see it:** the Kodi window was behind the browser. Set
  `bringKodiToFront` to true, or switch to Kodi with Cmd+Tab.
- **TMDB error 401:** the key is wrong or has extra spaces.
- **Could not reach Kodi:** check host, port, username and password, and that the web
  server is enabled.
