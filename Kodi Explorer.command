#!/bin/bash
# Double-click to open Kodi Explorer. Starts the server if it is not already running.
cd "$(dirname "$0")" || exit 1
PORT="$(node -e "try{console.log(require('./config.json').listenPort||3000)}catch(e){console.log(3000)}")"
if curl -s -o /dev/null --max-time 2 "http://127.0.0.1:$PORT/"; then
  open "http://localhost:$PORT"
  exit 0
fi
echo "Starting Kodi Explorer. Close this window to stop it."
(sleep 1.5; open "http://localhost:$PORT") &
exec node server.js
