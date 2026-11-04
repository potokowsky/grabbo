import {
  isSupportedSite, cookiesFor, allowReferer, getSettings, fmtForQuality, qualityLabel,
  safeName, stamp, native, isAdLibrary, adInfoFor, adName, adMeta, adDays
} from './sites.js';

const WIN = /Windows/i.test(navigator.userAgent);
const SHOW_IN = WIN ? 'w Pobranych' : 'w Finderze';
const $list = document.getElementById('list');
const $jobs = document.getElementById('jobs');
const $warn = document.getElementById('host-warning');
const $all = document.getElementById('all');
let tab;
let settings;
let hostJobs = [];
let lastHostPoll = 0;
const quickActions = []; // „Pobierz wszystkie” — po jednej funkcji na kartę

const fmtSize = (b) => {
  if (!b) return '';
  if (b > 1e9) return (b / 1e9).toFixed(1) + ' GB';
  if (b > 1e6) return (b > 1e7 ? Math.round(b / 1e6) : (b / 1e6).toFixed(1)) + ' MB';
  return Math.round(b / 1e3) + ' KB';
};
const fmtDur = (s) => {
  if (!s || !isFinite(s)) return '';
  s = Math.round(s);
  const m = Math.floor(s / 60), r = s % 60;
  return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
};
const TIME_RE = /^\d{1,3}(:\d{1,2}){0,2}$/;

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function showHostWarning(error) {
  $warn.hidden = false;
  $warn.textContent = 'Pomocnik nie odpowiada — uruchom instalator z paczki jeszcze raz. ' + (error ? `(${error})` : '');
}

function thumb({ img, video, cls = 'thumb', onMeta }) {
  const box = el('div', cls);
  if (img) {
    const i = el('img');
    i.src = img; i.referrerPolicy = 'no-referrer';
    i.onerror = () => i.remove();
    box.append(i);
  } else if (video) {
    const v = el('video');
    v.muted = true; v.preload = 'metadata'; v.playsInline = true;
    v.src = video + (video.includes('#') ? '' : '#t=0.5');
    if (onMeta) v.addEventListener('loadedmetadata', () => onMeta(v), { once: true });
    v.onerror = () => v.remove();
    box.append(v);
  }
  return box;
}

async function startHelper(msg, onError) {
  const res = await native({ action: 'download', settings, ...msg });
  if (res.ok) { lastHostPoll = 0; refreshJobs(); return true; }
  if (res.nohost) showHostWarning(res.error);
  onError?.(res.error || 'nieznany błąd');
  return false;
}

// ---------- karta obsługiwana przez pomocnika (YouTube, HLS, osadzone itd.) ----------
function helperCard({ tag, title, meta, url, referer, name, extraMeta }) {
  const card = el('div', 'card');
  const $thumb = thumb({});
  const body = el('div', 'body');
  const top = el('div', 'top');
  top.append(el('span', 'tag', tag), el('span', 'title', title));
  const $meta = el('div', 'meta', meta || '');
  const $status = el('div', 'status');
  $status.innerHTML = '<span class="spin"></span>Sprawdzam dostępne jakości…';
  const $opts = el('div', 'opts');
  const $tools = el('div', 'tools');
  body.append(top, $meta, $status);
  card.append($thumb, body, $opts, $tools);

  const base = { url, referer, ua: navigator.userAgent };
  let probe = null;
  let shownTitle = title;
  const cookiesReady = cookiesFor([url, referer]).then((c) => { base.cookies = c; });
  const err = (e) => { $status.className = 'status err'; $status.textContent = 'Błąd: ' + e; };

  // ✂ fragment
  let section = null;
  const fragBtn = el('button', 'tool', '✂ Fragment');
  const fragBox = el('div', 'frag');
  fragBox.hidden = true;
  const from = el('input'); from.placeholder = 'od 0:00';
  const to = el('input'); to.placeholder = 'do 5:00';
  const fragInfo = el('span', 'hint', 'puste „do” = do końca');
  fragBox.append(from, el('span', 'hint', '–'), to, fragInfo);
  const updateSection = () => {
    const a = from.value.trim() || '0:00', b = to.value.trim();
    const okA = TIME_RE.test(a), okB = !b || TIME_RE.test(b);
    from.classList.toggle('bad', !okA); to.classList.toggle('bad', !okB);
    section = (okA && okB && (from.value.trim() || b)) ? `${a}-${b || 'inf'}` : null;
    fragBtn.textContent = section ? `✂ ${a}–${b || 'koniec'}` : '✂ Fragment';
    fragBtn.classList.toggle('on', !!section);
  };
  from.oninput = to.oninput = updateSection;
  fragBtn.onclick = () => { fragBox.hidden = !fragBox.hidden; if (!fragBox.hidden) from.focus(); };

  const dlMsg = (o) => ({
    ...base, fmt: o.fmt, audio: !!o.audio, label: o.label + (section ? ' ✂' : ''),
    title: name ? `${name}` : null, display: shownTitle, thumb: probe?.thumbnail || null,
    subs: probe?.subs || [], section, meta: extraMeta || null
  });

  quickActions.push(async () => {
    await cookiesReady;
    const q = settings.defaultQuality;
    return startHelper(dlMsg({ fmt: fmtForQuality(q), audio: q === 'audio', label: qualityLabel(q) }), err);
  });

  (async () => {
    await cookiesReady;
    let r = await native({ action: 'probe', ...base });
    // plan B: konkretny plik nie przeszedł -> niech yt-dlp przeanalizuje całą stronę
    if (!r.ok && !r.nohost && referer && referer !== url && /^https?:/.test(referer)) {
      $status.innerHTML = '<span class="spin"></span>Próbuję przez całą stronę…';
      const prev = { url: base.url, cookies: base.cookies };
      base.url = referer;
      base.cookies = await cookiesFor([referer]);
      const r2 = await native({ action: 'probe', ...base });
      if (r2.ok) { r = r2; if (!extraMeta) name = null; } else Object.assign(base, prev);
    }
    if (r.ok && r.imp) base.imp = true;
    if (!r.ok) {
      $status.className = 'status err';
      $status.textContent = r.nohost ? 'Brak pomocnika.' : 'Nie udało się odczytać: ' + (r.error || '');
      if (r.nohost) showHostWarning(r.error);
      return;
    }
    probe = r;
    if (!name && r.title) shownTitle = r.title;
    top.querySelector('.title').textContent = shownTitle;
    if (r.thumbnail) $thumb.replaceWith(thumb({ img: r.thumbnail }));
    else if (!/\.(m3u8|mpd)/.test(base.url) && !isSupportedSite(base.url)) $thumb.replaceWith(thumb({ video: base.url }));
    const bits = [r.uploader, fmtDur(r.duration)].filter(Boolean);
    if (bits.length) $meta.textContent = bits.join(' · ');
    $status.textContent = '';

    // domyślna jakość — wyróżniona (albo najbliższa niższa)
    const q = settings.defaultQuality;
    const heights = r.options.map((o) => parseInt(o.label)).filter(Boolean);
    const defLabel = q === 'audio' ? 'Tylko audio'
      : (heights.find((h) => h <= +q) ?? heights[heights.length - 1]) + 'p';
    for (const o of r.options) {
      const b = el('button', 'q' + (o.label === defLabel ? ' def' : ''));
      b.append(document.createTextNode(o.label));
      if (o.size && !section) b.append(el('small', null, '~' + fmtSize(o.size)));
      b.onclick = async () => {
        b.disabled = true;
        if (await startHelper(dlMsg(o), err)) b.classList.add('done');
        b.disabled = false;
      };
      $opts.append(b);
    }
    if (r.duration) $tools.append(fragBtn);
    if (r.subs?.length) {
      const sb = el('button', 'tool', 'Napisy SRT');
      sb.title = 'Pobierz same napisy (' + r.subs.join(', ') + ')';
      sb.onclick = async () => {
        sb.disabled = true;
        if (await startHelper({ ...dlMsg({ fmt: 'b', label: 'SRT' }), subsOnly: true }, err)) sb.classList.add('done');
        sb.disabled = false;
      };
      $tools.append(sb);
    }
    if ($tools.children.length) card.append(fragBox);
  })();
  return card;
}

// ---------- karta zwykłego pliku MP4/WebM ----------
function fileCard(item, ad) {
  const card = el('div', 'card');
  const ext = ((item.url.match(/\.(mp4|m4v|webm|mov)(\?|$)/i) || [])[1] ||
    (item.ct.split('/')[1] || 'mp4').replace('quicktime', 'mov').replace('x-m4v', 'm4v')).toLowerCase();
  const display = ad ? [ad.author, ad.id && `#${ad.id}`].filter(Boolean).join(' · ') : safeName(tab.title);
  const body = el('div', 'body');
  const top = el('div', 'top');
  top.append(el('span', 'tag', ext.toUpperCase()), el('span', 'title', display || 'Wideo'));
  const days = ad && settings.adDays ? adDays(ad.start) : 0;
  const adBit = ad?.start ? `start ${ad.start}${days ? ` · ${days} ${days === 1 ? 'dzień' : 'dni'} aktywna` : ''}` : null;
  const metaBits = [adBit, fmtSize(item.size), !ad && new URL(item.url).hostname].filter(Boolean);
  const $meta = el('div', 'meta', metaBits.join(' · '));
  allowReferer(item.url, tab.url);
  const $thumb = thumb({
    video: item.url,
    onMeta: (v) => {
      const res = v.videoWidth ? `${v.videoWidth}×${v.videoHeight}` : '';
      $meta.textContent = [adBit, fmtDur(v.duration), res, fmtSize(item.size)]
        .filter(Boolean).join(' · ');
    }
  });
  body.append(top, $meta);
  const $status = el('div', 'status');

  const $opts = el('div', 'opts');
  const dl = el('button', 'primary', 'Pobierz');
  const name = ad && settings.smartNames ? adName(ad) : `${safeName(tab.title)} ${stamp()}`;
  const meta = ad ? adMeta(ad) : null;
  // queued = przez pomocnika (kolejka, po jednym) — „Pobierz wszystkie” i własny folder
  const download = (queued = false) => new Promise((resolve) => {
    if (queued === true || settings.outDir) {
      cookiesFor([item.url, tab.url]).then((cookies) => startHelper({
        url: item.url, referer: tab.url, ua: navigator.userAgent, cookies, fmt: 'b/bv*+ba',
        label: ext.toUpperCase(), title: name, display, meta
      }, (e) => { $status.className = 'status err'; $status.textContent = 'Błąd: ' + e; })).then((ok) => {
        if (ok) { dl.classList.add('done'); dl.textContent = 'Pobieram ✓'; }
        resolve(ok);
      });
      return;
    }
    chrome.downloads.download({
      url: item.url, filename: `${WIN ? '' : 'Potok Video/'}${name}.${ext}`, conflictAction: 'uniquify'
    }, async (id) => {
      if (chrome.runtime.lastError || id === undefined) {
        dl.textContent = 'Nie wyszło — użyj „przez pomocnika”';
        return resolve(false);
      }
      dl.classList.add('done');
      dl.textContent = 'Pobieram ✓';
      const { bdl = [] } = await chrome.storage.local.get('bdl');
      // dane do obróbki po pobraniu (storyboard, CSV) i do planu B przez pomocnika
      bdl.unshift({ id, title: display, label: ext.toUpperCase(), video: item.url, started: Date.now(),
        referer: tab.url, name, ua: navigator.userAgent, meta, settings });
      await chrome.storage.local.set({ bdl: bdl.slice(0, 20) });
      refreshJobs();
      resolve(true);
    });
  });
  dl.onclick = () => download();
  quickActions.push(() => download(true));
  const viaHelper = el('button', 'link', 'przez pomocnika');
  viaHelper.onclick = () => card.replaceWith(helperCard({
    tag: ext.toUpperCase(), title: display, url: item.url, referer: tab.url, name, extraMeta: meta
  }));
  $opts.append(dl, viaHelper);
  card.append($thumb, body, $opts, $status);
  return card;
}

// ---------- sekcja „Pobierane” ----------
function jobRow({ title, label, img, video, pct, status, sub, onOpen, error }) {
  const row = el('div', 'job' + (status === 'done' ? ' is-done' : '') + (status === 'error' ? ' is-err' : ''));
  row.append(thumb({ img, video, cls: 'thumb sm' }));
  const body = el('div', 'body');
  const top = el('div', 'top');
  top.append(el('span', 'title', title || 'Wideo'));
  if (label) top.append(el('span', 'tag', label));
  const bar = el('div', 'bar');
  const fill = el('div', 'fill');
  fill.style.width = Math.max(2, Math.min(100, pct || 0)) + '%';
  bar.append(fill);
  body.append(top, bar, el('div', 'jinfo', error || sub || ''));
  row.append(body);
  if (onOpen && status === 'done') { row.classList.add('clickable'); row.title = 'Pokaż ' + SHOW_IN; row.onclick = onOpen; }
  return row;
}

let refreshing = false;
async function refreshJobs() {
  if (refreshing) return;
  refreshing = true;
  try { await doRefreshJobs(); } finally { refreshing = false; }
}

async function doRefreshJobs() {
  const active = hostJobs.some((j) => !['done', 'error'].includes(j.status));
  if (Date.now() - lastHostPoll > (active ? 700 : 4000)) {
    lastHostPoll = Date.now();
    const r = await native({ action: 'jobs' });
    if (r.ok) hostJobs = r.jobs;
  }
  const { bdl = [] } = await chrome.storage.local.get('bdl');
  const browser = bdl.length ? await chrome.downloads.search({}) : [];
  const byId = new Map(browser.map((d) => [d.id, d]));

  const rows = [];
  for (const j of hostJobs) {
    let sub;
    if (j.status === 'done') sub = 'Gotowe ✓ · kliknij, żeby pokazać ' + SHOW_IN;
    else if (j.status === 'merge') sub = 'Łączę obraz i dźwięk…';
    else if (j.status === 'post') sub = j.stage || 'Kończę…';
    else if (j.status === 'start') sub = 'Startuję…';
    else if (j.status === 'queued') sub = 'W kolejce' + (j.ahead ? ` · przed nim: ${j.ahead}` : '');
    else sub = [`${Math.round(j.pct)}%`, j.part > 1 ? 'audio' : null,
      j.speed ? fmtSize(j.speed) + '/s' : null, j.eta ? 'zostało ' + fmtDur(j.eta) : null].filter(Boolean).join(' · ');
    rows.push({ t: j.started * 1000, node: jobRow({
      title: j.title, label: j.label, img: j.thumb, pct: ['merge', 'post'].includes(j.status) ? 100 : j.pct,
      status: j.status, sub, error: j.status === 'error' ? 'Błąd: ' + j.error : null,
      onOpen: () => native({ action: 'reveal', path: j.file })
    }) });
  }
  for (const b of bdl) {
    const d = byId.get(b.id);
    if (!d || b.retried) continue;
    const done = d.state === 'complete';
    const err = d.state === 'interrupted';
    const pct = d.totalBytes > 0 ? (d.bytesReceived / d.totalBytes) * 100 : 0;
    rows.push({ t: b.started, node: jobRow({
      title: b.title, label: b.label, video: b.video, pct: done ? 100 : pct,
      status: done ? 'done' : err ? 'error' : 'download',
      sub: done ? 'Gotowe ✓ · kliknij, żeby pokazać ' + SHOW_IN
        : `${Math.round(pct)}% · ${fmtSize(d.bytesReceived)} z ${fmtSize(d.totalBytes)}`,
      error: err ? 'Przerwane — przełączam na pomocnika…' : null,
      onOpen: () => chrome.downloads.show(b.id)
    }) });
  }

  rows.sort((a, b) => b.t - a.t);
  const shown = rows.slice(0, 6);
  const existing = [...$jobs.querySelectorAll('.job')];
  if (existing.length === shown.length && shown.length) {
    shown.forEach((r, i) => {
      const old = existing[i];
      old.className = r.node.className;
      old.onclick = r.node.onclick; old.title = r.node.title;
      old.querySelector('.fill').style.width = r.node.querySelector('.fill').style.width;
      old.querySelector('.jinfo').textContent = r.node.querySelector('.jinfo').textContent;
    });
  } else {
    $jobs.replaceChildren();
    if (shown.length) {
      const head = el('div', 'jhead');
      head.append(el('span', null, 'Pobierane'));
      const clr = el('button', 'ghost', 'Wyczyść gotowe');
      clr.onclick = async () => {
        await native({ action: 'clear_jobs' });
        const { bdl: list = [] } = await chrome.storage.local.get('bdl');
        const all = await chrome.downloads.search({});
        const st = new Map(all.map((d) => [d.id, d.state]));
        await chrome.storage.local.set({ bdl: list.filter((x) => st.get(x.id) === 'in_progress') });
        lastHostPoll = 0;
        refreshJobs();
      };
      head.append(clr);
      $jobs.append(head, ...shown.map((r) => r.node));
    }
  }
  $jobs.hidden = !shown.length;
}

// ---------- start ----------
async function render() {
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let items = [];
  try {
    const res = await Promise.race([
      chrome.runtime.sendMessage({ type: 'get', tabId: tab.id }),
      new Promise((r) => setTimeout(() => r(null), 1500))
    ]);
    items = res?.items || [];
  } catch (_) { /* tło nie odpowiada — pokażemy przynajmniej stronę */ }
  $list.replaceChildren();
  quickActions.length = 0;

  const ads = isAdLibrary(tab.url) ? await adInfoFor(tab.id) : [];
  const adByPath = new Map(ads.map((a) => [a.path, a]));
  const adFor = (u) => { try { return adByPath.get(new URL(u).pathname) || null; } catch (_) { return null; } };

  if (isSupportedSite(tab.url)) {
    $list.append(helperCard({ tag: 'Strona', title: tab.title, url: tab.url, referer: tab.url }));
  }
  for (const item of items) {
    if (item.kind === 'file') $list.append(fileCard(item, adFor(item.url)));
    else if (item.kind === 'embed') $list.append(helperCard({
      tag: item.platform, title: item.platform + ' — osadzony film', url: item.url, referer: tab.url
    }));
    else $list.append(helperCard({
      tag: item.kind === 'hls' ? 'HLS' : 'DASH', title: safeName(tab.title), meta: new URL(item.url).hostname,
      url: item.url, referer: tab.url, name: `${safeName(tab.title)} ${stamp()}`
    }));
  }

  if (!$list.children.length) {
    const empty = el('div', 'empty');
    empty.append(el('div', null, 'Nie wykryto wideo. Odpal film na stronie i otwórz to okienko jeszcze raz.'));
    const tryBtn = el('button', 'q', 'Spróbuj całą stronę przez pomocnika');
    tryBtn.style.marginTop = '10px';
    tryBtn.onclick = () => $list.replaceChildren(helperCard({ tag: 'Strona', title: tab.title, url: tab.url, referer: tab.url }));
    empty.append(tryBtn);
    $list.append(empty);
  }

  // „Pobierz wszystkie” — gdy jest więcej niż jeden film
  $all.hidden = quickActions.length < 2;
  if (!$all.hidden) {
    const btn = $all.querySelector('button');
    btn.textContent = `Pobierz wszystkie (${quickActions.length}) · ${qualityLabel(settings.defaultQuality)}`;
    btn.disabled = false;
    btn.onclick = async () => {
      btn.disabled = true;
      btn.textContent = 'Startuję pobieranie…';
      for (const fn of [...quickActions]) {
        await fn();
        await new Promise((r) => setTimeout(r, 250));
      }
      btn.textContent = 'Wszystkie w kolejce ✓';
    };
  }
}

document.getElementById('clear').onclick = async () => {
  await chrome.runtime.sendMessage({ type: 'clear', tabId: tab.id });
  render();
};
document.getElementById('settings').onclick = () => chrome.runtime.openOptionsPage();
document.getElementById('open').onclick = async () => {
  const r = await native({ action: 'open', settings });
  if (!r.ok && r.nohost) showHostWarning(r.error);
};

(async () => {
  settings = await getSettings();
  if (settings.outDir) document.getElementById('open').textContent = 'Otwórz folder docelowy';
  else if (WIN) document.getElementById('open').textContent = 'Otwórz folder Pobrane';
  await render();
  refreshJobs();
  setInterval(refreshJobs, 700);
})();
