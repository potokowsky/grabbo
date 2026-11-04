import {
  isSupportedSite, cookiesFor, getSettings, native, fmtForQuality, qualityLabel,
  isAdLibrary, adInfoFor, adName, adMeta, safeName, stamp
} from './sites.js';
import { t, initLang } from './i18n.js';

const MAX_ITEMS = 30;
const MIN_FILE_SIZE = 150 * 1024; // mniejsze pliki to zwykle ikonki/podglądy
const IGNORE_RE = /googlevideo\.com|\.(ts|m4s|aac|vtt|srt)(\?|$)/i;
const STRIP_PARAMS = ['bytestart', 'byteend', 'range', 'rn', 'rbuf'];

const icon = (state) => ({
  16: `icons/${state}-16.png`,
  32: `icons/${state}-32.png`,
  48: `icons/${state}-48.png`,
  128: `icons/${state}-128.png`
});

// ---- stan per karta (pamięć + storage.session, bo service worker usypia) ----
const tabs = new Map();
const loading = new Map();

async function ensure(tabId) {
  if (tabs.has(tabId)) return tabs.get(tabId);
  if (!loading.has(tabId)) {
    loading.set(tabId, chrome.storage.session.get('t' + tabId).then((o) => {
      if (!tabs.has(tabId)) tabs.set(tabId, o['t' + tabId] || { items: [], skip: [], url: '' });
      loading.delete(tabId);
      return tabs.get(tabId);
    }));
  }
  return loading.get(tabId);
}

function persist(tabId) {
  const s = tabs.get(tabId);
  if (s) chrome.storage.session.set({ ['t' + tabId]: s }).catch(() => {});
}

async function updateIcon(tabId) {
  const s = await ensure(tabId);
  const active = s.items.length > 0 || isSupportedSite(s.url);
  try {
    await chrome.action.setIcon({ tabId, path: icon(active ? 'on' : 'off') });
    await chrome.action.setBadgeBackgroundColor({ tabId, color: '#16a34a' });
    await chrome.action.setBadgeText({ tabId, text: s.items.length ? String(s.items.length) : '' });
  } catch (_) { /* karta zamknięta */ }
}

function normalize(u) {
  try {
    const url = new URL(u);
    STRIP_PARAMS.forEach((p) => url.searchParams.delete(p));
    return url.href;
  } catch (_) { return u; }
}

// ---- wykrywanie wideo w ruchu sieciowym ----
chrome.webRequest.onHeadersReceived.addListener(
  (d) => {
    if (d.tabId < 0 || d.statusCode >= 400 || IGNORE_RE.test(d.url)) return;
    const h = {};
    for (const x of d.responseHeaders || []) h[x.name.toLowerCase()] = x.value || '';
    const ct = (h['content-type'] || '').toLowerCase();
    const u = d.url;

    let kind = null;
    if (ct.includes('mpegurl') || /\.m3u8(\?|$)/i.test(u)) kind = 'hls';
    else if (ct.includes('dash+xml') || /\.mpd(\?|$)/i.test(u)) kind = 'dash';
    else if (/^video\/(mp4|webm|quicktime|x-m4v)/.test(ct) ||
      (/\.(mp4|m4v|webm|mov)(\?|$)/i.test(u) && !ct.startsWith('text') && !ct.includes('html'))) kind = 'file';
    if (!kind) return;

    let size = 0;
    const cr = h['content-range'];
    if (cr) { const m = cr.match(/\/(\d+)/); if (m) size = +m[1]; }
    else if (h['content-length']) size = +h['content-length'];
    if (kind === 'file' && size && size < MIN_FILE_SIZE) return;

    handle(d.tabId, { url: normalize(u), kind, size, ct });
  },
  { urls: ['<all_urls>'], types: ['media', 'xmlhttprequest', 'other'] },
  ['responseHeaders']
);

// ---- osadzone odtwarzacze (Vimeo, Wistia, Loom, YouTube embed…) — obsłuży je pomocnik ----
const EMBEDS = [
  ['Vimeo', /player\.vimeo\.com\/video\/(\d+)/, (m, u) => {
    const h = new URL(u).searchParams.get('h');
    return `https://player.vimeo.com/video/${m[1]}${h ? '?h=' + h : ''}`;
  }],
  ['Wistia', /fast\.wistia\.(?:net|com)\/embed\/(?:iframe|medias)\/([a-z0-9]{6,})/i,
    (m) => `https://fast.wistia.net/embed/iframe/${m[1]}`],
  ['YouTube', /youtube(?:-nocookie)?\.com\/embed\/([\w-]{11})/, (m) => `https://www.youtube.com/watch?v=${m[1]}`],
  ['Loom', /loom\.com\/embed\/([a-f0-9]{20,})/, (m) => `https://www.loom.com/share/${m[1]}`],
  ['Streamable', /streamable\.com\/[eo]\/(\w+)/, (m) => `https://streamable.com/${m[1]}`],
  ['Dailymotion', /dailymotion\.com\/embed\/video\/(\w+)/, (m) => `https://www.dailymotion.com/video/${m[1]}`],
  ['Vidyard', /play\.vidyard\.com\/([\w-]{10,})/, (m) => `https://play.vidyard.com/${m[1]}`],
  ['Bunny', /iframe\.mediadelivery\.net\/(?:embed|play)\/\d+\/[\w-]+/, (m) => `https://${m[0]}`],
  ['Brightcove', /players\.brightcove\.net\/\d+\/[\w-]+\/index\.html\?videoId=\d+/, (m) => `https://${m[0]}`]
];

chrome.webRequest.onBeforeRequest.addListener(
  (d) => {
    if (d.tabId < 0) return;
    for (const [name, re, build] of EMBEDS) {
      const m = d.url.match(re);
      if (!m) continue;
      let url;
      try { url = build(m, d.url); } catch (_) { return; }
      handle(d.tabId, { url, kind: 'embed', platform: name, size: 0, ct: '' });
      return;
    }
  },
  { urls: ['<all_urls>'], types: ['sub_frame', 'script', 'xmlhttprequest'] }
);

async function handle(tabId, item) {
  let s = await ensure(tabId);
  const existing = s.items.find((i) => i.url === item.url);
  if (existing) {
    if (item.size > existing.size) { existing.size = item.size; persist(tabId); }
    return;
  }
  if (item.kind === 'hls') {
    if (s.skip.includes(item.url)) return;
    try {
      const text = await (await fetch(item.url, { credentials: 'include' })).text();
      if (text.includes('#EXT-X-STREAM-INF')) {
        // master playlist — warianty jakości pokażemy jako jakości, nie osobne pozycje
        const variants = text.split('\n')
          .map((l) => l.trim())
          .filter((l) => l && !l.startsWith('#'))
          .map((l) => normalize(new URL(l, item.url).href));
        s.skip.push(...variants);
        s.items = s.items.filter((i) => !variants.includes(i.url));
        item.master = true;
      } else if (!text.includes('#EXTINF')) {
        return;
      }
    } catch (_) { /* pokażemy i tak */ }
    s = await ensure(tabId);
    if (s.items.some((i) => i.url === item.url) || s.skip.includes(item.url)) return;
  }
  item.time = Date.now();
  s.items.push(item);
  if (s.items.length > MAX_ITEMS) s.items.shift();
  if (s.skip.length > 300) s.skip.splice(0, s.skip.length - 300);
  persist(tabId);
  updateIcon(tabId);
}

// ---- nawigacja: nowa strona = czysta lista ----
chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (info.url || (info.status === 'loading' && tab.url)) {
    const s = await ensure(tabId);
    if (info.url && info.url !== s.url) {
      s.items = []; s.skip = []; s.url = info.url;
      persist(tabId);
    } else if (!s.url) { s.url = tab.url; persist(tabId); }
  }
  if (info.status === 'complete' || info.url) updateIcon(tabId);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  tabs.delete(tabId);
  chrome.storage.session.remove('t' + tabId).catch(() => {});
});

// ---- pobieranie przez przeglądarkę: koniec -> obróbka (storyboard, CSV…); blokada -> plan B przez pomocnika ----
chrome.downloads.onChanged.addListener(async (delta) => {
  const state = delta.state?.current;
  if (state !== 'interrupted' && state !== 'complete') return;
  const { bdl = [] } = await chrome.storage.local.get('bdl');
  const b = bdl.find((x) => x.id === delta.id);
  if (!b) return;

  if (state === 'complete') {
    if (b.posted) return;
    b.posted = true;
    await chrome.storage.local.set({ bdl });
    const [d] = await chrome.downloads.search({ id: delta.id });
    if (d?.filename) {
      native({ action: 'post', path: d.filename, url: b.video, referer: b.referer, label: b.label,
        display: b.title, meta: b.meta, settings: b.settings || await getSettings() });
    }
    return;
  }

  if (b.retried || !b.video) return;
  b.retried = true;
  await chrome.storage.local.set({ bdl });
  const cookies = await cookiesFor([b.video, b.referer]);
  native({
    action: 'download', url: b.video, referer: b.referer, ua: b.ua, cookies, fmt: 'b/bv*+ba',
    label: b.label, title: b.name, display: b.title, meta: b.meta, settings: b.settings || await getSettings()
  });
  chrome.downloads.erase({ id: delta.id }).catch(() => {});
});

// ---- prawy klik: „Grabbo: pobierz…” ----
function buildMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'pv-video', title: t('Grabbo: pobierz to wideo'), contexts: ['video'] });
    chrome.contextMenus.create({ id: 'pv-link', title: t('Grabbo: pobierz wideo z linku'), contexts: ['link'] });
    chrome.contextMenus.create({ id: 'pv-page', title: t('Grabbo: pobierz wideo z tej strony'), contexts: ['page'] });
  });
}
const langReady = initLang(buildMenus); // zmiana języka w ustawieniach -> nowe podpisy menu
chrome.runtime.onInstalled.addListener(() => langReady.then(buildMenus));

async function flashBadge(tabId, text, color) {
  try {
    await chrome.action.setBadgeBackgroundColor({ tabId, color });
    await chrome.action.setBadgeText({ tabId, text });
  } catch (_) { /* */ }
  setTimeout(() => updateIcon(tabId), 2500);
}

async function queueDownload(tab, { url, page, kind }) {
  const settings = await getSettings();
  let title = null, meta = null, display = tab?.title || t('Wideo');
  if (kind === 'file') { // bezpośredni plik — nazwa ze strony albo z Biblioteki reklam
    const ad = isAdLibrary(page) && tab ? await adInfoFor(tab.id, url) : null;
    if (ad) {
      meta = adMeta(ad);
      display = [ad.author, ad.id && `#${ad.id}`].filter(Boolean).join(' · ');
      title = settings.smartNames ? adName(ad) : `${safeName(tab.title)} ${stamp()}`;
    } else title = `${safeName(tab?.title)} ${stamp()}`;
  } else if (kind === 'stream') title = `${safeName(tab?.title)} ${stamp()}`;
  else if (kind === 'link') display = url;

  const q = settings.defaultQuality;
  const cookies = await cookiesFor([url, page]);
  const r = await native({
    action: 'download', url, referer: page, ua: navigator.userAgent, cookies, settings,
    fmt: fmtForQuality(q), audio: q === 'audio', label: qualityLabel(q), title, display, meta
  });
  if (tab?.id >= 0) flashBadge(tab.id, r.ok ? '↓' : '!', r.ok ? '#16a34a' : '#dc2626');
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const page = info.pageUrl || tab?.url;
  if (info.menuItemId === 'pv-link' && info.linkUrl) return queueDownload(tab, { url: info.linkUrl, page, kind: 'link' });
  if (info.menuItemId === 'pv-video' && /^https?:/.test(info.srcUrl || '')) {
    return queueDownload(tab, { url: info.srcUrl, page, kind: 'file' });
  }
  return queueDownload(tab, { url: page, page, kind: 'page' }); // blob: (YouTube itp.) -> cała strona
});

// ---- skrót klawiszowy: strona obsługiwana -> cała strona; inaczej ostatnio wykryty film ----
chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== 'download-current') return;
  tab = tab || (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  if (!tab?.url || !/^https?:/.test(tab.url)) return;
  if (isSupportedSite(tab.url)) return queueDownload(tab, { url: tab.url, page: tab.url, kind: 'page' });
  const s = await ensure(tab.id);
  const last = s.items[s.items.length - 1];
  if (!last) return queueDownload(tab, { url: tab.url, page: tab.url, kind: 'page' });
  return queueDownload(tab, { url: last.url, page: tab.url, kind: last.kind === 'file' ? 'file' : 'stream' });
});

// ---- popup ----
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg.type === 'get') {
    ensure(msg.tabId).then((s) => reply({ items: [...s.items].reverse() }));
    return true;
  }
  if (msg.type === 'clear') {
    ensure(msg.tabId).then((s) => {
      s.items = []; s.skip = []; persist(msg.tabId); updateIcon(msg.tabId); reply({ ok: true });
    });
    return true;
  }
});
