# Grabbo

Wtyczka Brave/Chrome do pobierania wideo + pomocnik (native messaging, yt-dlp). Mac + Windows.

**Przeczytaj najpierw `HANDOFF.md`**: pełny kontekst, architektura, historia błędów i uzgodnione następne kroki.

- Użytkownik: Potok. Odpowiadaj po polsku, zwięźle, w punktach z numerowanymi podpunktami; preferuje małe, celowane zmiany.
- Nie zmieniaj `key` w `extension/manifest.json` (stałe ID wtyczki `mblaggcfnacfohhkkkgonhilbmfolbba`).
- Po zmianach w JS: `cp plik.js /tmp/x.mjs && node --check /tmp/x.mjs`, a przy zmianach w tle przetestuj prawdziwą wtyczkę w Chromium (Playwright, `--headless=new`, `--load-extension`).
- Żadnego obchodzenia DRM.
