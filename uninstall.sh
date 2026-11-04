#!/bin/bash
# Usuwa pomocnika Grabbo (nie rusza pobranych plików ani yt-dlp/ffmpeg)
rm -rf "$HOME/Library/Application Support/Grabbo" "$HOME/Documents/Grabbo/wtyczka"
for B in "BraveSoftware/Brave-Browser" "Google/Chrome"; do
  rm -f "$HOME/Library/Application Support/$B/NativeMessagingHosts/com.grabbo.app.json"
done
echo "✓ Pomocnik usunięty. Wtyczkę usuń w brave://extensions."
