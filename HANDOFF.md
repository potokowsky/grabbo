# Grabbo — przekazanie projektu (handoff)

> Podsumowanie rozmowy z Claude (claude.ai, 3–4 listopada 2026), w której powstała ta wtyczka.
> Cel: kontynuacja pracy w Claude Code bez utraty kontekstu.
> Kod w repo = stan **v2.1.1**, jeszcze pod starą nazwą **„Potok Video”** (zmiana nazwy na Grabbo to pierwsze zadanie, patrz niżej).

---

## 1. Kim jest użytkownik i po co to jest

- **Potok** (GitHub: `potokowsky`), montażysta i content strategist. Pracuje po polsku, woli **zwięzłe odpowiedzi w punktach z numerowanymi podpunktami** i **małe, celowane zmiany** zamiast przebudów.
- Sprzęt: **MacBook + Brave** (główny), do tego PC z Windowsem (Brave). Montuje w DaVinci Resolve.
- Zastosowanie: pobieranie wideo **do analizy**: reklamy (Biblioteka reklam Meta), YouTube, TikTok, Instagram. Zwykle pobiera w niskiej jakości (szybciej).
- Geneza: zamiennik płatnego **Video DownloadHelper** (~30 $). Ma działać jak VDH: zielona ikonka, gdy jest wideo, lista jakości, „Pobierz”.
- Docelowo do testów przez innych ludzi (testerzy, Mac + Windows).
- **Zasady**: żadnego obchodzenia DRM (Netflix itp.), użytkownik tego nie chce i tak ma zostać. Wtyczka przy DRM tylko pokazuje komunikat.

## 2. Architektura

```
extension/          wtyczka MV3 (Brave/Chrome), ładowana jako „rozpakowana” (tryb dewelopera)
host/potok_host.py  „pomocnik” = native messaging host (Python), uruchamiany przez przeglądarkę na żądanie
install.sh / Zainstaluj-Mac.command        instalator macOS (Homebrew: yt-dlp, ffmpeg, deno)
install.ps1 / Zainstaluj-Windows.bat       instalator Windows (winget: yt-dlp, ffmpeg, deno, Python)
uninstall.sh / uninstall.ps1 / Odinstaluj-Windows.bat
INSTRUKCJA.txt      instrukcja dla testerów (PL, CRLF)
```

### Wtyczka (`extension/`)
- **Stały identyfikator**: `mblaggcfnacfohhkkkgonhilbmfolbba` (klucz `key` w `manifest.json`). **Nie zmieniać klucza**, bo od niego zależy `allowed_origins` w rejestracji pomocnika.
- `background.js` (service worker, `type: module`):
  - wykrywanie wideo z ruchu sieciowego (`webRequest.onHeadersReceived`): MP4/WebM/MOV, HLS (m3u8, warianty master playlist zwijane w jedną pozycję), DASH;
  - wykrywanie **osadzonych odtwarzaczy** (`onBeforeRequest`): Vimeo (z hashem `?h=`), Wistia, YouTube embed, Loom, Streamable, Dailymotion, Vidyard, Bunny, Brightcove;
  - stan per karta w pamięci + `storage.session`; ikonka szara/zielona + licznik;
  - pobrania przez przeglądarkę: po zakończeniu → `post` do pomocnika (storyboard/CSV/metadane); przy przerwaniu (np. 403) → automatyczny plan B przez pomocnika;
  - menu kontekstowe (prawy klik: wideo/link/strona) i **skrót `Alt+Shift+D`** (`commands.download-current`) → `queueDownload()`.
- `sites.js`: wspólne helpery: lista obsługiwanych stron, `cookiesFor()` (ciasteczka → pomocnik), `allowReferer()` (reguła DNR ustawiająca Referer dla zapytań bez karty), ustawienia (`DEFAULTS`, `getSettings`), `fmtForQuality`, `native()`, **ekstrakcja danych z Biblioteki reklam Meta** (`extractAds`, wstrzykiwana przez `chrome.scripting`): reklamodawca (linia przed „Sponsorowane/Sponsored”), ID biblioteki, data startu (PL i EN), `adDays`.
- `popup.*`: okienko: sekcja „Pobierane” (postęp, kolejka, klik → pokaż w Finderze/Pobranych), „Pobierz wszystkie” (przez kolejkę), karty filmów z miniaturkami, jakości (★ = domyślna), ✂ fragment, „Napisy SRT”.
- `options.*`: ustawienia w 3 sekcjach: **Pobieranie** (domyślna jakość, folder docelowy przez natywne okno wyboru, skrót), **Po pobraniu** (napisy, czyszczenie metadanych), **Do pracy — analiza reklam** (storyboard, swipe file CSV, dni aktywności, mądre nazwy Meta).
- Uprawnienia: `webRequest, storage, downloads, nativeMessaging, tabs, cookies, declarativeNetRequestWithHostAccess, contextMenus, scripting` + `<all_urls>`.

### Pomocnik (`host/potok_host.py`)
- Nazwa hosta: `com.potok.video`. Protokół native messaging (4 bajty długości + JSON).
- Akcje: `ping`, `probe` (yt-dlp `-J` → lista jakości, rozmiary szacowane z bitrate'u, miniaturka, wybór napisów `pick_subs`), `download`, `post`, `jobs`, `clear_jobs`, `reveal`, `open`, `defaults`, `pick_folder`.
- Pobieranie w **osobnym procesie** (`--worker <plik-json>`; specyfikacja w pliku, bo ciasteczka nie mogą być w linii poleceń), odłączony od przeglądarki (Mac: `start_new_session`; Windows: `DETACHED_PROCESS | CREATE_BREAKAWAY_FROM_JOB` z fallbackiem).
- **Kolejka**: jedno pobieranie naraz. Zadania w `APP_DIR/jobs/*.json`, ID = `time_ns` (kolejność FIFO), heartbeat co 10 s, zadanie bez sygnału >90 s nie blokuje kolejki.
- Postęp: `--progress-template` → plik zadania; popup odpytuje co 0,7 s.
- Ciasteczka z przeglądarki → tymczasowy plik Netscape → `--cookies`, kasowany po użyciu i maskowany w logach.
- Przy 403/429/Cloudflare druga próba z `--impersonate chrome` (działa, jeśli yt-dlp ma curl_cffi).
- Obróbka po pobraniu (`postprocess`): czyszczenie metadanych (ffmpeg `-map_metadata -1`, Mac: `xattr -c`), napisy SRT, **storyboard** (max 36 klatek, `tile`, znacznik czasu `drawtext` z Arial, fallback bez napisów), **swipe-file.csv** (UTF-8 BOM; stary plik z innymi kolumnami odkładany jako „swipe-file (stary …).csv”; plik zablokowany przez Excel → osobny plik z datą).
- Nazwy plików: YouTube itp. `Kanał - Tytuł [720p].mp4`; Meta `Reklamodawca_ID_YYYY-MM-DD.mp4`; inne `Tytuł strony HH.MM.SS.mp4`; fragment → sufiks `[1.00-5.00]`.
- Foldery: Mac `~/Downloads/Potok Video`, **Windows `~/Downloads` bezpośrednio** (prośba użytkownika); ustawienie `outDir` nadpisuje. Dane pomocnika: Mac `~/Library/Application Support/PotokVideo`, Windows `%LOCALAPPDATA%\PotokVideo` (logs/, jobs/, tmp/).
- Auto-aktualizacja yt-dlp co 3 dni (brew / winget) w tle.
- Komunikaty błędów po polsku (`nice_error`): 403, wygasły link, wymaga logowania, DRM, nieobsługiwana strona, nieudany fragment.

## 3. Historia ważnych błędów (żeby się nie powtórzyły)

1. `permission denied` przy `install.sh`: brak bitu wykonywalności w zipie → instalacja przez `bash install.sh`; teraz pliki w zipie mają `chmod +x`.
2. Rozmiary „~17 MB” przy wszystkich jakościach: YouTube nie podaje `filesize` → szacowanie z `tbr × czas`.
3. TikTok 403: wymaga ciasteczek sesji + Referera → `cookiesFor` + reguła DNR + plan B przez pomocnika.
4. **Pusty popup w 2.0.0**: nadmiarowy `});` w `background.js` → service worker nie startował. Lekcja: **sprawdzać składnię jako moduł** (`cp plik.js x.mjs && node --check x.mjs`) i **testować prawdziwą wtyczkę w Chromium** (Playwright, `launchPersistentContext` + `--headless=new` + `--load-extension`), nie tylko popup z mockiem.
5. Sekcja „Pobierane” zgnieciona przy 30 filmach: flex-shrink → `#jobs { flex: 0 0 auto }`.
6. Fragment z serwera bez obsługi Range dawał 324-bajtowy plik → wykrywanie przez ffprobe i czytelny błąd.
7. **0.4.0 `.pkg`: „Python.framework jest uszkodzona”** na Macu. Procesy uruchomione przez Brave dziedziczą kwarantannę, więc jednoplikowy `yt-dlp_macos` (rozpakowuje Pythona do `/var/folders/…/_MEI…` przy każdym starcie) był blokowany przez Gatekeepera. Od 0.4.1 yt-dlp w wersji folderowej (`bin/yt-dlp-dist` + skrypt `bin/yt-dlp`), aktualizowany przez pomocnika (`YTDLP_MAC_UPDATE`), a `postinstall` zdejmuje kwarantannę z każdego pliku. Lekcja: na Macu **żadnych binarek onefile** uruchamianych z pomocnika.

## 4. Testy, które były robione (środowisko bez macOS/Windows)

- Pomocnik: lokalny `http.server` z HLS (master + warianty), MP4, serwer „jak TikTok” (403 bez ciasteczka i Referera), kolejka 3 zadań, storyboard, CSV, metadane, `post`.
- Wtyczka: popup i ustawienia z mockiem `chrome.*` (Playwright, zrzuty) + prawdziwa wtyczka w Chromium (rejestracja listenerów, skrót, wykrywanie MP4).
- **Nie testowane realnie w tej sesji**: instalatory na prawdziwym Macu i Windowsie (testował użytkownik: oba działają), żywa Wistia/Vimeo, napisy z YouTube, `--impersonate`.

## 5. Decyzje użytkownika

- ✅ Zrobione: wszystko z sekcji 2.
- ❌ Odrzucone na teraz: zrzut klatki PNG, profile klientów (osobne foldery/CSV), preset „do montażu” (ProRes/DNxHR), wysyłka do DaVinci, transkrypcja Whisper, synchronizacja z Sheets/Notion.
- ⏸ Na później: playlisty i kanały („ostatnie 20 Shortsów”).
- 💡 Zaproponowane, bez decyzji: historia pobrań z wyszukiwarką, „ponów nieudane”, pauza/anulowanie w kolejce, **filtr „Pobierz wszystkie” po dniach aktywności**, **zaznaczanie checkboxami** (te dwa rekomendowane jako najbardziej przydatne).

## 6. NASTĘPNE KROKI (uzgodnione: „opcja 2”, bez Chrome Web Store)

Sklep odpada: regulamin zabrania pobierania z YouTube, a i tak nie da się z przeglądarki zainstalować pomocnika. Plan:

1. ✅ *(zrobione w 0.2.x: host `com.grabbo.app`, `host/grabbo_host.py`, foldery `Grabbo`)* **Zmiana nazwy na „Grabbo”** wszędzie: `manifest.json` (name, description), popup/options/notyfikacje, foldery (`~/Downloads/Grabbo`, `APP_DIR` → `Grabbo`), host `com.potok.video` → np. `com.grabbo.app`, instalatory, INSTRUKCJA. **Klucz/ID wtyczki zostaje.** Nowy instalator ma **posprzątać starą instalację** „Potok Video” (usunąć `PotokVideo` i rejestracje `com.potok.video` w Brave/Chrome, na Windowsie klucze rejestru HKCU).
2. **Prawdziwe instalatory bez Homebrew/winget/Pythona**:
   - pomocnik jako binarka (PyInstaller) + dołączone yt-dlp (oficjalne binarki standalone, mają curl_cffi), ffmpeg/ffprobe, deno;
   - Mac: `.pkg` (bez podpisu na start → „Otwórz mimo to”; Apple Developer 99 $/rok opcjonalnie później), **najpierw Mac, potem Windows** (`.exe`, np. Inno Setup; SmartScreen → „Uruchom mimo to”);
   - budowanie w **GitHub Actions** (runnery macOS i Windows), wynik jako GitHub Release.
   - ✅ *Mac (2.1)*: `packaging/mac/build.sh` + `packaging/mac/scripts/postinstall`, workflow `.github/workflows/build-mac.yml` (arm64 `macos-15` + Intel `macos-15-intel`). Pakiet instaluje się do `/Library/Application Support/Grabbo/installer`, `postinstall` kopiuje na konto zalogowanego użytkownika: `~/Library/Application Support/Grabbo/{host,bin}` (pomocnik PyInstaller onedir, yt-dlp_macos, ffmpeg/ffprobe z ffmpeg.martin-riedl.de, deno), wtyczkę do `~/Documents/Grabbo/wtyczka`, rejestruje `com.grabbo.app` w Brave/Chrome, sprząta „Potok Video” i starą wersję skryptową. Pomocnik: `FROZEN` (worker = ta sama binarka z `--worker`), `APP_DIR/bin` pierwsze w PATH, aktualizacja yt-dlp przez pobranie nowego `yt-dlp_macos.zip` (od 0.4.1). CI instaluje `.pkg` z kwarantanną jak po pobraniu przez Brave i `.pkg` na runnerze i robi `ping`. Tag `v*` → pliki w GitHub Release. **Do zrobienia**: test na prawdziwym Macu, potem Windows (2.2).
3. **Przycisk „Zainstaluj pomocnika”** w popupie zamiast żółtego błędu, gdy host nie odpowiada (link do najnowszego wydania dla danego systemu).
4. **Automatyczne aktualizacje wtyczki**: pomocnik raz dziennie sprawdza najnowszy Release w `potokowsky/grabbo` (repo **publiczne**, więc bez tokenów), pobiera zip wtyczki, podmienia folder `Dokumenty/Grabbo/wtyczka`, wtyczka robi `chrome.runtime.reload()`. Tester raz wgrywa folder w trybie dewelopera, a potem aktualizacje przychodzą same. yt-dlp aktualizuje się przez `yt-dlp -U` (binarka standalone).

## 7. Repo i konwencje

- Repo: **https://github.com/potokowsky/grabbo** (publiczne, gałąź `main`).
- Commity kończyć liniami atrybucji, jeśli środowisko je podaje.
- Kod i komentarze po polsku; UI po polsku.
- Paczka do wysłania testerom: zip folderu projektu z `chmod +x` na `.command/.sh`; `INSTRUKCJA.txt` z końcami linii CRLF; pliki `.ps1` w UTF-8 z BOM.
- Wersję podbijać w `extension/manifest.json` przy każdej zmianie, którą użytkownik ma przeładować.
- Numeracja od nowa jako **0.x** (Grabbo jeszcze „nie wyszło”): po rename 0.2.3. Stare 2.x „Potok Video” to historia.
