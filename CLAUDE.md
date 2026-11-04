# Grabbo

Wtyczka Brave/Chrome do pobierania wideo + pomocnik (native messaging, yt-dlp). Mac + Windows.

**Przeczytaj najpierw `HANDOFF.md`**: pełny kontekst, architektura, historia błędów i uzgodnione następne kroki.

- Użytkownik: Potok. Odpowiadaj po polsku, zwięźle, w punktach z numerowanymi podpunktami; preferuje małe, celowane zmiany.
- Nie zmieniaj `key` w `extension/manifest.json` (stałe ID wtyczki `mblaggcfnacfohhkkkgonhilbmfolbba`).
- Po zmianach w JS: `cp plik.js /tmp/x.mjs && node --check /tmp/x.mjs`, a przy zmianach w tle przetestuj prawdziwą wtyczkę w Chromium (Playwright, `--headless=new`, `--load-extension`).
- Żadnego obchodzenia DRM.
- **Git po angielsku**: commity, tytuły i opisy PR, komentarze na GitHubie. Rozmowa z użytkownikiem dalej po polsku.
- UI wtyczki: domyślnie angielski, przełącznik w ustawieniach. Nowe teksty: `t('tekst po polsku')` + tłumaczenie w `EN` w `extension/i18n.js` (pomocnik: `T()` i `EN` w `grabbo_host.py`).
