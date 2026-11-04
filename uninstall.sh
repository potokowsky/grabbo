#!/bin/bash
# Usuwa pomocnika Potok Video (nie rusza pobranych plików ani yt-dlp/ffmpeg)
rm -rf "$HOME/Library/Application Support/PotokVideo" "$HOME/Documents/Potok Video/wtyczka"
for B in "BraveSoftware/Brave-Browser" "Google/Chrome"; do
  rm -f "$HOME/Library/Application Support/$B/NativeMessagingHosts/com.potok.video.json"
done
echo "✓ Pomocnik usunięty. Wtyczkę usuń w brave://extensions."
