# Kodi Explorer (Phase 1 prototype)

1. Get a free TMDB API key: themoviedb.org > Settings > API (choose "Developer", non-commercial).
2. Copy config.example.json to config.json and fill in your TMDB key and Kodi host/port/user/password.
3. Run:  node server.js     (needs Node 18+)
4. Open http://localhost:3000

Click any director, actor, studio, year or genre to explore.
"Play on Kodi" sends: plugin://plugin.video.themoviedb.helper/?info=play&tmdb_type=movie&tmdb_id=<id>
(requires TMDb Helper installed with Seren set as its movie player).
Keep config.json private; it holds your key and Kodi password.
