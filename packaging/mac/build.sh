#!/bin/bash
# Grabbo — budowanie instalatora .pkg dla macOS (uruchamiane w GitHub Actions na runnerze macOS).
# Wynik: dist/Grabbo-<wersja>-mac-<arm64|intel>.pkg
#   - pomocnik jako binarka (PyInstaller, onedir — szybki start, bez rozpakowywania przy każdym wywołaniu)
#   - yt-dlp (oficjalna binarka standalone, z curl_cffi), ffmpeg + ffprobe (statyczne), deno
#   - wtyczka (folder extension/)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
VERSION="$(python3 -c 'import json; print(json.load(open("extension/manifest.json"))["version"])')"
case "$(uname -m)" in
  arm64)  ARCH=arm64; FF_ARCH=arm64; DENO_ARCH=aarch64 ;;
  x86_64) ARCH=intel; FF_ARCH=amd64; DENO_ARCH=x86_64 ;;
  *) echo "Nieznana architektura: $(uname -m)"; exit 1 ;;
esac

WORK="$ROOT/build/mac"
PAYLOAD="$WORK/payload"
rm -rf "$WORK"
mkdir -p "$PAYLOAD/bin" "$WORK/dl" "$ROOT/dist"

fetch() { curl -fsSL --retry 4 --retry-delay 3 -o "$2" "$1"; }

echo "== yt-dlp"
fetch "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos" "$PAYLOAD/bin/yt-dlp"

echo "== ffmpeg + ffprobe ($FF_ARCH)"
for t in ffmpeg ffprobe; do
  fetch "https://ffmpeg.martin-riedl.de/redirect/latest/macos/$FF_ARCH/release/$t.zip" "$WORK/dl/$t.zip"
  unzip -oq "$WORK/dl/$t.zip" -d "$WORK/dl/$t"
  find "$WORK/dl/$t" -type f -name "$t" -exec cp {} "$PAYLOAD/bin/$t" \;
done

echo "== deno ($DENO_ARCH)"
fetch "https://github.com/denoland/deno/releases/latest/download/deno-$DENO_ARCH-apple-darwin.zip" "$WORK/dl/deno.zip"
unzip -oq "$WORK/dl/deno.zip" -d "$PAYLOAD/bin"

chmod +x "$PAYLOAD/bin/"*
xattr -cr "$PAYLOAD/bin" 2>/dev/null || true

echo "== kontrola narzędzi"
"$PAYLOAD/bin/yt-dlp" --version
"$PAYLOAD/bin/ffmpeg" -hide_banner -version | head -1
"$PAYLOAD/bin/ffprobe" -hide_banner -version | head -1
"$PAYLOAD/bin/deno" --version | head -1
"$PAYLOAD/bin/ffmpeg" -hide_banner -filters 2>/dev/null | grep -q drawtext \
  || echo "⚠️  ffmpeg bez drawtext — storyboard będzie bez znaczników czasu"

echo "== pomocnik (PyInstaller)"
python3 -m PyInstaller --noconfirm --clean --onedir --name grabbo_host \
  --distpath "$WORK/pyi" --workpath "$WORK/pyi-build" --specpath "$WORK" \
  "$ROOT/host/grabbo_host.py"
ditto "$WORK/pyi/grabbo_host" "$PAYLOAD/host"

echo "== test pomocnika (ping przez native messaging)"
OUT="$(python3 - "$PAYLOAD/host/grabbo_host" "$PAYLOAD/bin" <<'EOF'
import json, os, struct, subprocess, sys
exe, bindir = sys.argv[1], sys.argv[2]
env = dict(os.environ, PATH=bindir + ":/usr/bin:/bin")
msg = json.dumps({"action": "ping"}).encode()
r = subprocess.run([exe, "chrome-extension://test/"], input=struct.pack("<I", len(msg)) + msg,
                   capture_output=True, timeout=60, env=env)
n = struct.unpack("<I", r.stdout[:4])[0]
print(r.stdout[4:4 + n].decode())
EOF
)"
echo "$OUT"
echo "$OUT" | grep -q '"ok": true' || { echo "❌ pomocnik nie odpowiada"; exit 1; }

cp -R extension "$PAYLOAD/extension"
cp uninstall.sh "$PAYLOAD/uninstall.sh"
echo "$VERSION" > "$PAYLOAD/VERSION"

echo "== pkg"
chmod +x packaging/mac/scripts/*
PKG="$ROOT/dist/Grabbo-$VERSION-mac-$ARCH.pkg"
pkgbuild --root "$PAYLOAD" --scripts packaging/mac/scripts \
  --identifier com.grabbo.app --version "$VERSION" \
  --install-location "/Library/Application Support/Grabbo/installer" \
  "$PKG"
ls -lh "$PKG"
