# Kodi Explorer

A personal movie discovery tool. Start from any movie or person, click through
directors, cast, studios, years and genres, and press **Play on Kodi** to start
playback in Kodi (via TMDb Helper and Seren).

Status: Phase 1 prototype (clickable directory with a breadcrumb trail). A radial
graph view is planned.

Data and images: this product uses the TMDB API but is not endorsed or certified
by TMDB. Movie data is provided by [The Movie Database](https://www.themoviedb.org).

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
| `kodi.host` / `kodi.port` | Kodi web server. Use `127.0.0.1` if Kodi is on the same Mac |
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

## 4. Run

```
node server.js
```

Open http://localhost:3000. Press **Play on Kodi** on a movie. In Kodi, choose Seren if asked,
then pick a source.

## Troubleshooting

- **Play does nothing:** read the end of Kodi's log: `tail -n 60 ~/Library/Logs/kodi.log`.
  The server also prints Kodi's reply in the terminal as `[kodi] response:`.
- **Dialog appears but you didn't see it:** the Kodi window was behind the browser. Set
  `bringKodiToFront` to true, or switch to Kodi with Cmd+Tab.
- **TMDB error 401:** the key is wrong or has extra spaces.
- **Could not reach Kodi:** check host, port, username and password, and that the web
  server is enabled.
