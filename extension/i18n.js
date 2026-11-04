// Tłumaczenia UI. Kluczem jest tekst po polsku; EN = słownik PL -> EN.
// Język wybiera się w ustawieniach (chrome.storage.sync.lang), domyślnie angielski.
export const LANGS = [['en', 'English'], ['pl', 'Polski']];
let LANG = 'en';

const EN = {
  // popup
  'Wyczyść': 'Clear',
  'Wyczyść listę': 'Clear list',
  'Ustawienia': 'Settings',
  'Otwórz folder „Grabbo”': 'Open “Grabbo” folder',
  'Otwórz folder docelowy': 'Open target folder',
  'Otwórz folder Pobrane': 'Open Downloads folder',
  'wszystkie': 'all',
  '{0}+ dni': '{0}+ days',
  'Tylko reklamy aktywne co najmniej tyle dni': 'Only ads active for at least this many days',
  'w Pobranych': 'in Downloads',
  'w Finderze': 'in Finder',
  'Pomocnik nie odpowiada — uruchom instalator z paczki jeszcze raz.': 'The helper is not responding — run the installer from the package again.',
  'Sprawdzam dostępne jakości…': 'Checking available qualities…',
  'Błąd: ': 'Error: ',
  '✂ Fragment': '✂ Clip',
  'od 0:00': 'from 0:00',
  'do 5:00': 'to 5:00',
  'puste „do” = do końca': 'empty “to” = until the end',
  'koniec': 'end',
  'Próbuję przez całą stronę…': 'Trying the whole page…',
  'Brak pomocnika.': 'Helper not installed.',
  'Nie udało się odczytać: ': 'Could not read: ',
  'Napisy SRT': 'SRT subtitles',
  'Pobierz same napisy ({0})': 'Download subtitles only ({0})',
  'Wideo': 'Video',
  'start {0}': 'started {0}',
  '{0} dzień aktywna': '{0} day active',
  '{0} dni aktywna': '{0} days active',
  'Pobierz': 'Download',
  'Pobieram ✓': 'Downloading ✓',
  'Nie wyszło — użyj „przez pomocnika”': 'Failed — use “via helper”',
  'przez pomocnika': 'via helper',
  'Zaznacz do pobrania': 'Select for download',
  '↻ Ponów': '↻ Retry',
  'Spróbuj pobrać jeszcze raz': 'Try downloading again',
  'Ponawiam…': 'Retrying…',
  'Pokaż {0}': 'Show {0}',
  'Gotowe ✓ · kliknij, żeby pokazać {0}': 'Done ✓ · click to show {0}',
  'Łączę obraz i dźwięk…': 'Merging video and audio…',
  'Kończę…': 'Finishing…',
  'Startuję…': 'Starting…',
  'W kolejce': 'Queued',
  ' · przed nim: {0}': ' · ahead: {0}',
  'audio': 'audio',
  'zostało {0}': '{0} left',
  '{0} z {1}': '{0} of {1}',
  'Przerwane — przełączam na pomocnika…': 'Interrupted — switching to the helper…',
  'Pobierane': 'Downloads',
  'Wyczyść gotowe': 'Clear finished',
  'Strona': 'Page',
  '{0} — osadzony film': '{0} — embedded video',
  'Nie wykryto wideo. Odpal film na stronie i otwórz to okienko jeszcze raz.': 'No video detected. Play the video on the page and open this popup again.',
  'Spróbuj całą stronę przez pomocnika': 'Try the whole page via helper',
  'Pobierz zaznaczone ({0})': 'Download selected ({0})',
  'Pobierz wszystkie ({0})': 'Download all ({0})',
  'Startuję pobieranie…': 'Starting downloads…',
  'W kolejce ✓ ({0})': 'Queued ✓ ({0})',
  'Tylko audio': 'Audio only',
  'nieznany błąd': 'unknown error',
  // tło
  'Grabbo: pobierz to wideo': 'Grabbo: download this video',
  'Grabbo: pobierz wideo z linku': 'Grabbo: download video from link',
  'Grabbo: pobierz wideo z tej strony': 'Grabbo: download video from this page',
  // ustawienia
  'Grabbo — ustawienia': 'Grabbo — settings',
  'ustawienia': 'settings',
  'Pobieranie': 'Downloading',
  'Domyślna jakość': 'Default quality',
  'Wyróżniona gwiazdką w okienku; używana przez „Pobierz wszystkie”, prawy klik i skrót klawiszowy.': 'Marked with a star in the popup; used by “Download all”, right-click and the keyboard shortcut.',
  'Folder docelowy': 'Target folder',
  'Domyślny': 'Default',
  'Domyślny — {0}': 'Default — {0}',
  'Wybierz…': 'Choose…',
  'Skrót klawiszowy': 'Keyboard shortcut',
  'Pobiera film z bieżącej karty w domyślnej jakości, bez otwierania okienka.': 'Downloads the video from the current tab in the default quality, without opening the popup.',
  'Zmień': 'Change',
  'brak': 'none',
  'Po pobraniu': 'After download',
  'Napisy SRT razem z filmem': 'SRT subtitles with the video',
  'Gdy serwis je ma (np. YouTube), zapisują się obok pliku.': 'When the site has them (e.g. YouTube), they are saved next to the file.',
  'Czyść metadane': 'Strip metadata',
  'Usuwa z pliku tytuły, komentarze, daty i informację „pobrano z”.': 'Removes titles, comments, dates and the “downloaded from” info from the file.',
  'Do pracy — analiza reklam': 'For work — ad analysis',
  'Storyboard': 'Storyboard',
  'Obrazek z klatkami co kilka sekund (max 36) i czasem na każdej — cała reklama na jednym ekranie.': 'An image with frames every few seconds (max 36), each with a timestamp — the whole ad on one screen.',
  'Swipe file (CSV)': 'Swipe file (CSV)',
  'Każde pobranie dopisuje wiersz do swipe-file.csv w folderze docelowym: link, tytuł, autor, wyświetlenia, daty, długość.': 'Every download adds a row to swipe-file.csv in the target folder: link, title, author, views, dates, length.',
  'Dni aktywności reklamy': 'Ad active days',
  'Ile dni reklama już leci (Biblioteka reklam Meta) — w okienku i w kolumnie CSV. Długo aktywne = zwykle działają.': 'How many days the ad has been running (Meta Ad Library) — in the popup and as a CSV column. Long-running ads usually work.',
  'Mądre nazwy plików': 'Smart file names',
  'Reklamodawca_ID-reklamy_data-startu.mp4 zamiast nazwy strony (Biblioteka reklam Meta).': 'Advertiser_AdID_start-date.mp4 instead of the page title (Meta Ad Library).',
  'Zapisano ✓': 'Saved ✓',
  'Pomocnik nie odpowiada — uruchom instalator.': 'The helper is not responding — run the installer.'
};

export const getLang = () => LANG;
export function setLang(l) {
  LANG = l === 'pl' ? 'pl' : 'en';
  if (typeof document !== 'undefined') document.documentElement.lang = LANG;
}

// t('Pobierz zaznaczone ({0})', 3)
export function t(s, ...args) {
  let r = (LANG === 'en' && EN[s]) || s;
  args.forEach((v, i) => { r = r.split(`{${i}}`).join(v); });
  return r;
}

// Język z ustawień + reakcja na zmianę (tło, popup, ustawienia)
export async function initLang(onChange) {
  try { setLang((await chrome.storage.sync.get({ lang: 'en' })).lang); } catch (_) { setLang('en'); }
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area === 'sync' && ch.lang) { setLang(ch.lang.newValue); onChange?.(); }
  });
  return LANG;
}

// Tłumaczy statyczny HTML: [data-i18n] (tekst), [title], [placeholder]. Oryginał (PL) zostaje w data-*.
export function applyI18n(root = document) {
  for (const e of root.querySelectorAll('[data-i18n]')) {
    e.dataset.i18n ||= e.textContent.trim();
    e.textContent = t(e.dataset.i18n);
  }
  for (const e of root.querySelectorAll('[title]')) {
    e.dataset.title0 ||= e.title;
    e.title = t(e.dataset.title0);
  }
  if (root === document) {
    document.title = t(document.title && (document.documentElement.dataset.title0 ||= document.title));
  }
}
