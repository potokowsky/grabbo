import { DEFAULTS, QUALITIES, getSettings, native } from './sites.js';
import { t, LANGS, setLang, applyI18n } from './i18n.js';

const $ = (id) => document.getElementById(id);
const BOOLS = ['subs', 'storyboard', 'swipe', 'stripMeta', 'smartNames', 'adDays'];
let defaultDir = '';

const flash = () => {
  $('saved').classList.add('show');
  clearTimeout(flash.t);
  flash.t = setTimeout(() => $('saved').classList.remove('show'), 1200);
};
const save = async (patch) => { await chrome.storage.sync.set(patch); flash(); };

function showDir(dir) {
  $('outDirLabel').textContent = dir || (defaultDir ? t('Domyślny — {0}', defaultDir) : t('Domyślny'));
  $('reset').hidden = !dir;
}

(async () => {
  const s = await getSettings();
  setLang(s.lang);
  applyI18n();
  for (const [v, label] of LANGS) $('lang').append(new Option(label, v));
  $('lang').value = s.lang;
  $('lang').onchange = async (e) => {
    setLang(e.target.value);
    applyI18n();
    for (const o of $('defaultQuality').options) o.textContent = t(QUALITIES.find(([v]) => v === o.value)[1]);
    showShortcut();
    showDir((await getSettings()).outDir);
    await save({ lang: e.target.value });
  };
  for (const [v, label] of QUALITIES) $('defaultQuality').append(new Option(t(label), v));
  $('defaultQuality').value = s.defaultQuality;
  $('defaultQuality').onchange = (e) => save({ defaultQuality: e.target.value });

  for (const k of BOOLS) {
    $(k).checked = !!s[k];
    $(k).onchange = (e) => save({ [k]: e.target.checked });
  }

  async function showShortcut() {
    const cmd = (await chrome.commands.getAll()).find((c) => c.name === 'download-current');
    $('shortcut').textContent = cmd?.shortcut || t('brak');
  };
  showShortcut();
  window.addEventListener('focus', showShortcut);
  const isBrave = !!(navigator.brave && await navigator.brave.isBrave().catch(() => false));
  $('changeShortcut').onclick = () => chrome.tabs.create({ url: (isBrave ? 'brave' : 'chrome') + '://extensions/shortcuts' });

  const d = await native({ action: 'defaults' });
  if (d.ok) defaultDir = d.outDir;
  showDir(s.outDir);

  $('pick').onclick = async () => {
    $('pick').disabled = true;
    const r = await native({ action: 'pick_folder' });
    $('pick').disabled = false;
    if (r.ok && r.path) { await save({ outDir: r.path }); showDir(r.path); }
    else if (r.nohost) $('outDirLabel').textContent = t('Pomocnik nie odpowiada — uruchom instalator.');
  };
  $('reset').onclick = async () => { await save({ outDir: DEFAULTS.outDir }); showDir(''); };
})();
