#!/bin/bash
# Stops Kodi Explorer and removes it from your login items. Your project files are not touched.
LABEL="com.kodi-explorer"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
rm -f "$PLIST"
echo "Kodi Explorer will no longer start automatically."
