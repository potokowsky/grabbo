// Strony, które obsługuje pomocnik (yt-dlp) — tu ikonka świeci od razu, bez czekania na wykrycie pliku.
export const SITE_PATTERNS = [
  /youtube\.com\/(watch|shorts\/|live\/)/,
  /youtu\.be\//,
  /instagram\.com\/(p|reel|reels|tv)\//,
  /tiktok\.com\/@[^/]+\/video\//,
  /facebook\.com\/.*(videos|reel|watch)/,
  /fb\.watch\//,
  /(twitter|x)\.com\/[^/]+\/status\//,
  /vimeo\.com\/\d+/,
  /linkedin\.com\/(posts|feed\/update)\//
];

// Ciasteczka sesji dla danych adresów — pomocnik (yt-dlp) potrzebuje ich np. na TikToku
export async function cookiesFor(urls) {
  const seen = new Map();
  for (const u of urls) {
    if (!u || !/^https?:/.test(u)) continue;
    try {
      for (const c of await chrome.cookies.getAll({ url: u })) {
        seen.set(`${c.domain}|${c.path}|${c.name}`, {
          domain: c.domain, hostOnly: c.hostOnly, path: c.path, secure: c.secure,
          expirationDate: c.expirationDate, name: c.name, value: c.value
        });
      }
    } catch (_) { /* brak uprawnień do tej domeny */ }
  }
  return [...seen.values()];
}

// Nagłówek Referer dla zapytań bez karty (pobieranie przez przeglądarkę + podgląd w okienku)
export async function allowReferer(mediaUrl, pageUrl) {
  try {
    const host = new URL(mediaUrl).hostname;
    const ref = new URL(pageUrl).origin + '/';
    let id = 7;
    for (const ch of host) id = (id * 31 + ch.charCodeAt(0)) % 1000000007;
    id = (id % 2000000) + 1;
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [id],
      addRules: [{
        id, priority: 1,
        action: { type: 'modifyHeaders', requestHeaders: [{ header: 'Referer', operation: 'set', value: ref }] },
        condition: { requestDomains: [host], tabIds: [chrome.tabs.TAB_ID_NONE] }
      }]
    });
  } catch (_) { /* best effort */ }
}

export const isSupportedSite = (url) => !!url && SITE_PATTERNS.some((re) => re.test(url));

// ---------- ustawienia ----------
export const DEFAULTS = {
  defaultQuality: '720', outDir: '', subs: true, storyboard: true, swipe: true,
  stripMeta: false, smartNames: true, adDays: true
};
export const QUALITIES = [
  ['2160', '2160p (4K)'], ['1440', '1440p'], ['1080', '1080p'], ['720', '720p'],
  ['480', '480p'], ['360', '360p'], ['audio', 'Tylko audio']
];
export async function getSettings() {
  try { return { ...DEFAULTS, ...(await chrome.storage.sync.get(DEFAULTS)) }; } catch (_) { return { ...DEFAULTS }; }
}
// format yt-dlp dla domyślnej jakości (z zapasem, gdy serwis nie podaje rozdzielczości)
export const fmtForQuality = (q) => q === 'audio'
  ? 'ba[ext=m4a]/ba/b'
  : `bv*[height<=${q}]+ba/b[height<=${q}]/bv*+ba/b`;
export const qualityLabel = (q) => q === 'audio' ? 'Tylko audio' : `${q}p`;

export const safeName = (s) => (s || 'wideo').replace(/^\(\d+\+?\)\s*/, '')
  .replace(/[\\/:*?"<>|\n\r]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
export const stamp = () => new Date().toTimeString().slice(0, 8).replace(/:/g, '.');

export const native = (msg) => new Promise((resolve) => {
  chrome.runtime.sendNativeMessage('com.potok.video', msg, (r) => {
    if (chrome.runtime.lastError) resolve({ ok: false, nohost: true, error: chrome.runtime.lastError.message });
    else resolve(r || { ok: false, error: 'Brak odpowiedzi od pomocnika' });
  });
});

// ---------- Biblioteka reklam Meta: reklamodawca, ID, data startu dla każdego filmu ----------
export const isAdLibrary = (url) => /facebook\.com\/ads\/library/.test(url || '');

// Funkcja wstrzykiwana na stronę — musi być samowystarczalna
export function extractAds() {
  const MONTHS = { sty: 1, lut: 2, mar: 3, kwi: 4, maj: 5, cze: 6, lip: 7, sie: 8, wrz: 9, 'paź': 10, paz: 10,
    lis: 11, gru: 12, jan: 1, feb: 2, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  const pad = (n) => String(n).padStart(2, '0');
  const parseDate = (t) => {
    let m = t.match(/(\d{1,2})\s+([^\s\d.,]{3})[^\s\d]*\.?\s+(\d{4})/);
    if (m && MONTHS[m[2].toLowerCase()]) return `${m[3]}-${pad(MONTHS[m[2].toLowerCase()])}-${pad(m[1])}`;
    m = t.match(/([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),\s*(\d{4})/);
    if (m && MONTHS[m[1].toLowerCase()]) return `${m[3]}-${pad(MONTHS[m[1].toLowerCase()])}-${pad(m[2])}`;
    return '';
  };
  const ID_RE = /(?:Identyfikator biblioteki|Library ID)\s*:?\s*(\d{6,})/;
  const ID_RE_G = new RegExp(ID_RE.source, 'g');
  const START_RE = /(?:Rozpoczęcie wyświetlania|Started running on)\s*:?\s*([^\n·]+)/;
  const out = [];
  for (const v of document.querySelectorAll('video')) {
    const src = v.currentSrc || v.src;
    if (!src || src.startsWith('blob:')) continue;
    let node = v, card = null;
    while (node && node !== document.body) {
      const ids = (node.innerText || '').match(ID_RE_G);
      if (ids && ids.length === 1) { card = node; break; }
      if (ids && ids.length > 1) break;
      node = node.parentElement;
    }
    if (!card) continue;
    const t = card.innerText;
    const lines = t.split('\n').map((s) => s.trim()).filter(Boolean);
    const si = lines.findIndex((l) => /^(Sponsorowane|Sponsored)$/i.test(l));
    let path = '';
    try { path = new URL(src).pathname; } catch (_) { continue; }
    out.push({
      path, src,
      id: (t.match(ID_RE) || [])[1] || '',
      start: parseDate((t.match(START_RE) || [])[1] || ''),
      author: si > 0 ? lines[si - 1] : ''
    });
  }
  return out;
}

export async function adInfoFor(tabId, url) {
  try {
    const [res] = await chrome.scripting.executeScript({ target: { tabId }, func: extractAds });
    const ads = res?.result || [];
    if (!url) return ads;
    const path = new URL(url).pathname;
    return ads.find((a) => a.path === path) || null;
  } catch (_) { return url ? null : []; }
}

export function adDays(start) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start || '')) return 0;
  const [y, m, d] = start.split('-').map(Number);
  const now = new Date();
  return Math.floor((Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) - Date.UTC(y, m - 1, d)) / 864e5) + 1;
}

export function adName(ad) {
  const author = safeName(ad.author || 'Reklama').replace(/\s+/g, '');
  return [author, ad.id, ad.start].filter(Boolean).join('_');
}
export function adMeta(ad) {
  return {
    platform: 'Meta Ad Library', author: ad.author, adId: ad.id, adStart: ad.start,
    link: ad.id ? `https://www.facebook.com/ads/library/?id=${ad.id}` : ''
  };
}
