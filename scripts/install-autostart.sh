#!/bin/bash
# Makes Kodi Explorer start automatically when you log in to your Mac, and restart if it stops.
# Run from anywhere:  bash scripts/install-autostart.sh
# Safe to run again: it replaces the previous setup.
set -e

DIR="$(cd "$(dirname "$0")/.." && pwd)"
NODE="${NODE:-$(command -v node || true)}"
LABEL="com.kodi-explorer"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/kodi-explorer.log"

if [ -z "$NODE" ]; then echo "Could not find Node. Install it first, then run this again."; exit 1; fi
if [ ! -f "$DIR/config.json" ]; then echo "config.json is missing in $DIR. Create it first (see README step 1)."; exit 1; fi
PORT="$("$NODE" -e "try{console.log(require('$DIR/config.json').listenPort||3000)}catch(e){console.log(3000)}")"

mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
cat > "$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>$NODE</string><string>$DIR/server.js</string></array>
  <key>WorkingDirectory</key><string>$DIR</string>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
PLISTEOF
echo "Wrote $PLIST"

if [ -n "$DRY_RUN" ]; then echo "(dry run: not loading it)"; exit 0; fi

UIDN="$(id -u)"
launchctl bootout "gui/$UIDN/$LABEL" 2>/dev/null || true
sleep 1
if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port $PORT is already in use by something else, most likely a Terminal window running 'node server.js'."
  echo "Press Ctrl+C in that window to stop it, then run this script again."
  exit 1
fi
launchctl bootstrap "gui/$UIDN" "$PLIST"
launchctl kickstart -k "gui/$UIDN/$LABEL" >/dev/null 2>&1 || true
sleep 2
CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "http://127.0.0.1:$PORT/" || true)"
if [ "$CODE" = "200" ]; then
  echo "Kodi Explorer is running and will start at every login: http://localhost:$PORT"
  echo "Log file: $LOG"
else
  echo "It did not answer yet (got '$CODE'). Check the log: tail -n 30 \"$LOG\""
  exit 1
fi
