#!/bin/bash
# Potok Video — instalacja pomocnika na macOS (Brave + Chrome)
set -e

EXT_ID="mblaggcfnacfohhkkkgonhilbmfolbba"
HOST_NAME="com.potok.video"
DIR="$(cd "$(dirname "$0")" && pwd)"
APP="$HOME/Library/Application Support/PotokVideo"
EXT_DEST="$HOME/Documents/Potok Video/wtyczka"

echo ""
echo "== Potok Video: instalacja =="
echo ""

# 1. Homebrew (instalujemy, jeśli go nie ma)
load_brew() {
  for p in /opt/homebrew/bin/brew /usr/local/bin/brew; do
    [ -x "$p" ] && eval "$("$p" shellenv)" && return 0
  done
  return 1
}
command -v brew >/dev/null 2>&1 || load_brew || true
if ! command -v brew >/dev/null 2>&1; then
  echo "Potrzebny jest Homebrew (darmowy instalator narzędzi dla Maca)."
  echo "Za chwilę zapyta o hasło do Maca — przy wpisywaniu nic się nie wyświetla, to normalne."
  read -r -p "Zainstalować teraz? [Enter = tak] " _
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  load_brew || { echo "❌ Homebrew się nie zainstalował. Spróbuj ponownie."; exit 1; }
fi
echo "✓ Homebrew"

# 2. Narzędzia: yt-dlp (pobieranie), ffmpeg (łączenie), deno (wymagany przez yt-dlp do YouTube)
for pkg in yt-dlp ffmpeg deno; do
  if brew list --formula "$pkg" >/dev/null 2>&1; then
    echo "✓ $pkg"
  else
    echo "→ instaluję $pkg…"
    brew install "$pkg"
  fi
done

# 3. Python
PY="$(command -v python3 || true)"
if [ -z "$PY" ] || ! "$PY" -c "import sys; assert sys.version_info >= (3, 8)" >/dev/null 2>&1; then
  echo "→ instaluję Pythona…"
  brew install python
  PY="$(brew --prefix)/bin/python3"
fi
echo "✓ Python ($PY)"

# 4. Pomocnik
mkdir -p "$APP/logs"
sed "1s|.*|#!$PY|" "$DIR/host/potok_host.py" > "$APP/potok_host.py"
chmod +x "$APP/potok_host.py"

# 5. Wtyczka — kopia w stałym miejscu, żeby można było usunąć pobrany folder
mkdir -p "$EXT_DEST"
rm -rf "$EXT_DEST"
cp -R "$DIR/extension" "$EXT_DEST"
echo "✓ wtyczka skopiowana do: Dokumenty/Potok Video/wtyczka"

# 6. Rejestracja pomocnika w przeglądarkach
MANIFEST=$(cat <<EOF
{
  "name": "$HOST_NAME",
  "description": "Potok Video helper",
  "path": "$APP/potok_host.py",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$EXT_ID/"]
}
EOF
)
registered=0
for B in "BraveSoftware/Brave-Browser" "Google/Chrome"; do
  D="$HOME/Library/Application Support/$B"
  if [ -d "$D" ]; then
    mkdir -p "$D/NativeMessagingHosts"
    echo "$MANIFEST" > "$D/NativeMessagingHosts/$HOST_NAME.json"
    echo "✓ zarejestrowano w: ${B%%/*}"
    registered=1
  fi
done
[ $registered = 1 ] || echo "⚠️  Nie znalazłem Brave ani Chrome — uruchom przeglądarkę raz i powtórz instalację."

mkdir -p "$HOME/Downloads/Potok Video"

echo ""
echo "✅ Pomocnik zainstalowany."
echo ""
echo "Ostatni krok — wgraj wtyczkę do przeglądarki:"
echo "  1. Otwórz w Brave/Chrome adres:  brave://extensions  (w Chrome: chrome://extensions)"
echo "  2. Włącz 'Tryb dewelopera' (prawy górny róg)"
echo "  3. Przeciągnij folder 'wtyczka' z okna Findera, które się otworzy, na tę stronę"
echo "     (albo: 'Załaduj rozpakowane' → wskaż ten folder)"
echo "  4. Przypnij ikonkę (puzzel → pinezka) i zrestartuj przeglądarkę (⌘Q)"
echo ""
open "$HOME/Documents/Potok Video" 2>/dev/null || true
