/* Explorer: free, keyless APIs, all fetched natively by Agent Hina (no CORS, permission-checked hosts). */

/* =========================== Tabs =========================== */

let currentTab = 'wiki';
const loaded = {};
const loaders = {
  wiki: () => renderBookmarks(),
  dict: () => renderRecentWords(),
  fx: () => loadRates(fx.from),
  countries: () => loadCountries(),
  news: () => loadNews(),
};

function showTab(name, { haptic = true } = {}) {
  currentTab = name;
  document.querySelectorAll('.tab').forEach(s => { s.hidden = s.dataset.tab !== name; });
  document.querySelectorAll('.ag-navbar-item').forEach(b => b.classList.toggle('is-active', b.dataset.tab === name));
  $('#title').textContent = document.querySelector(`.tab[data-tab="${name}"]`).dataset.title;
  sessionStorage.setItem('tab', name);
  if (haptic) AG.device.haptic('selection');
  window.scrollTo(0, 0);
  if (!loaded[name]) { loaded[name] = true; loaders[name]?.(); }
}

document.querySelectorAll('.ag-navbar-item').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));
$('#refresh').addEventListener('click', () => {
  AG.device.haptic('light');
  if (currentTab === 'countries') loadCountries(true);
  else if (currentTab === 'fx') loadRates(fx.from, true);
  else loaders[currentTab]?.();
});

// back: close the open article first, then go to the first tab, then leave
AG.onBack(() => {
  if ($('#wiki-article').childElementCount) { $('#wiki-article').replaceChildren(); return true; }
  if (currentTab !== 'wiki') { showTab('wiki'); return true; }
  return false;
});

/* =========================== Wikipedia =========================== */

const WIKI = 'https://en.wikipedia.org';
let wikiTimer = null;

$('#wiki-q').addEventListener('input', e => {
  clearTimeout(wikiTimer);
  const q = e.target.value.trim();
  if (!q) { $('#wiki-results').replaceChildren(); return; }
  wikiTimer = setTimeout(() => wikiSearch(q), 300);
});

async function wikiSearch(q) {
  const list = $('#wiki-results');
  try {
    const [, titles, descs] = await getJSON(`${WIKI}/w/api.php?action=opensearch&search=${encodeURIComponent(q)}&limit=10&format=json&origin=*`);
    if ($('#wiki-q').value.trim() !== q) return; // a newer search is running
    list.replaceChildren(...(titles.length ? titles.map((t, i) => h('li', { class: 'ag-item ag-clickable ag-enter', onclick: () => openArticle(t) },
      h('span', { class: 'ag-item-lead' }, '📄'),
      h('span', { class: 'ag-item-body' }, h('span', { class: 'ag-item-title' }, t), descs[i] ? h('span', { class: 'ag-item-sub' }, descs[i]) : null),
    )) : [h('li', { class: 'ag-item ag-muted' }, 'No results')]));
  } catch (e) { toastError(e); }
}

$('#wiki-random').addEventListener('click', async () => {
  AG.device.haptic('light');
  const box = $('#wiki-article');
  box.replaceChildren(spinner());
  try { renderArticle(await getJSON(`${WIKI}/api/rest_v1/page/random/summary`)); }
  catch (e) { box.replaceChildren(); toastError(e); }
});

async function openArticle(title) {
  const box = $('#wiki-article');
  $('#wiki-results').replaceChildren();
  box.replaceChildren(spinner());
  try { renderArticle(await getJSON(`${WIKI}/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`)); }
  catch (e) { box.replaceChildren(); toastError(e); }
}

async function renderArticle(a) {
  const url = a.content_urls?.mobile?.page || a.content_urls?.desktop?.page || `${WIKI}/wiki/${encodeURIComponent(a.title)}`;
  const marked = await isBookmarked(a.title);
  const bm = h('button', { class: 'ag-btn ag-btn-tonal ag-btn-sm' }, marked ? '★ Saved' : '☆ Save');
  bm.addEventListener('click', async () => {
    const now = await toggleBookmark({ title: a.title, description: a.description || '', thumb: a.thumbnail?.source || '', url });
    bm.textContent = now ? '★ Saved' : '☆ Save';
    AG.device.haptic(now ? 'success' : 'light');
    renderBookmarks();
  });
  $('#wiki-article').replaceChildren(h('article', { class: 'ag-card article ag-enter' },
    a.thumbnail?.source ? h('img', { class: 'thumb', src: a.thumbnail.source, alt: '', loading: 'lazy' }) : null,
    h('h2', {}, a.title),
    a.description ? h('p', { class: 'desc' }, a.description) : null,
    h('p', { class: 'extract' }, a.extract || ''),
    h('div', { class: 'ag-card-actions' },
      h('button', { class: 'ag-btn ag-btn-sm', onclick: () => AG.device.openUrl(url) }, 'Read full article'),
      bm,
      h('button', { class: 'ag-btn ag-btn-text ag-btn-sm', onclick: () => shareSheet(a.title, a.extract, url) }, 'Share'),
    ),
  ));
  window.scrollTo({ top: $('#wiki-article').offsetTop - 72, behavior: 'smooth' });
}

/* ---- bookmarks in IndexedDB (native SQLite) ---- */

let dbPromise = null;
function db() {
  return dbPromise ||= new Promise((resolve, reject) => {
    const req = indexedDB.open('explorer', 1);
    req.onupgradeneeded = () => {
      const s = req.result.createObjectStore('bookmarks', { keyPath: 'title' });
      s.createIndex('added', 'added');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
const done = req => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });

async function isBookmarked(title) {
  return !!(await done((await db()).transaction('bookmarks').objectStore('bookmarks').get(title)));
}

async function toggleBookmark(item) {
  const store = (await db()).transaction('bookmarks', 'readwrite').objectStore('bookmarks');
  if (await done(store.get(item.title))) { await done(store.delete(item.title)); return false; }
  await done(store.put({ ...item, added: Date.now() }));
  return true;
}

async function renderBookmarks() {
  const list = $('#wiki-bookmarks');
  const d = await db();
  const items = await new Promise((resolve, reject) => {
    const out = [];
    const c = d.transaction('bookmarks').objectStore('bookmarks').index('added').openCursor(null, 'prev');
    c.onsuccess = () => { const cur = c.result; if (cur) { out.push(cur.value); cur.continue(); } else resolve(out); };
    c.onerror = () => reject(c.error);
  });
  if (!items.length) { list.replaceChildren(h('li', { class: 'ag-item ag-muted' }, 'Save articles with ☆ to read them later')); return; }
  list.replaceChildren(...items.map(b => {
    const li = h('li', { class: 'ag-item ag-clickable', onclick: () => openArticle(b.title) },
      b.thumb ? h('img', { class: 'flag', src: b.thumb, alt: '', loading: 'lazy' }) : h('span', { class: 'ag-item-lead' }, '★'),
      h('span', { class: 'ag-item-body' }, h('span', { class: 'ag-item-title' }, b.title), b.description ? h('span', { class: 'ag-item-sub' }, b.description) : null));
    onLongPress(li, async () => {
      const id = await AG.ui.sheet({ title: b.title, items: [
        { id: 'share', label: 'Share', icon: '📤' }, { id: 'open', label: 'Open in browser', icon: '🌐' },
        { id: 'del', label: 'Remove bookmark', icon: '🗑', destructive: true }] });
      if (id === 'share') AG.device.share({ title: b.title, url: b.url });
      else if (id === 'open') AG.device.openUrl(b.url);
      else if (id === 'del') { await toggleBookmark(b); renderBookmarks(); }
    });
    return li;
  }));
}

/* =========================== Dictionary =========================== */

$('#dict-form').addEventListener('submit', e => { e.preventDefault(); lookup($('#dict-q').value); });

async function lookup(word) {
  word = word.trim().toLowerCase();
  if (!word) return;
  $('#dict-q').value = word;
  document.activeElement?.blur();
  const out = $('#dict-out');
  out.replaceChildren(spinner());
  try {
    const entries = await getJSON(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`);
    rememberWord(word);
    renderWord(entries);
  } catch (e) {
    out.replaceChildren(e.status === 404 ? empty('🤷', `No definition for "${word}"`, 'Check the spelling, or try another form of the word.') : empty('⚠️', 'Could not look it up', e.message));
  }
}

function renderWord(entries) {
  const first = entries[0];
  const phon = first.phonetic || first.phonetics?.find(p => p.text)?.text || '';
  const audioUrl = entries.flatMap(e => e.phonetics || []).find(p => p.audio)?.audio;
  const meanings = entries.flatMap(e => e.meanings || []);
  $('#dict-out').replaceChildren(h('div', { class: 'ag-card ag-enter' },
    h('div', { class: 'word-head' },
      h('h2', {}, first.word),
      audioUrl ? h('button', { class: 'ag-btn-icon', 'aria-label': 'Pronounce', onclick: () => { AG.device.haptic('light'); new Audio(audioUrl).play().catch(toastError); } }, '🔊') : null,
      h('span', { class: 'ag-grow' }),
      h('button', { class: 'ag-btn ag-btn-text ag-btn-sm', onclick: () => shareSheet(first.word, `${first.word} ${phon}: ${meanings[0]?.definitions?.[0]?.definition || ''}`, first.sourceUrls?.[0]) }, 'Share'),
    ),
    phon ? h('div', { class: 'phon' }, phon) : null,
    ...meanings.map(m => [
      h('div', { class: 'pos' }, m.partOfSpeech),
      h('ol', { class: 'defs' }, ...m.definitions.slice(0, 4).map(d => h('li', {}, d.definition, d.example ? h('span', { class: 'ex' }, `“${d.example}”`) : null))),
      m.synonyms?.length ? h('div', { class: 'syn' }, ...m.synonyms.slice(0, 8).map(s => h('button', { class: 'ag-chip', onclick: () => lookup(s) }, s))) : null,
    ]),
  ));
}

function rememberWord(word) {
  const recent = AG.storage.get('dict.recent', []).filter(w => w !== word);
  recent.unshift(word);
  AG.storage.set('dict.recent', recent.slice(0, 12));
  renderRecentWords();
}

function renderRecentWords() {
  const recent = AG.storage.get('dict.recent', []);
  $('#dict-recent').replaceChildren(...(recent.length ? recent.map(w => h('button', { class: 'ag-chip', onclick: () => lookup(w) }, w)) : [h('span', { class: 'ag-muted' }, 'Words you look up show here')]));
}

/* =========================== Currency =========================== */

const POPULAR = ['USD', 'EUR', 'GBP', 'INR', 'NPR', 'JPY', 'CNY', 'AUD', 'CAD', 'CHF', 'SGD', 'AED', 'SAR', 'HKD', 'KRW', 'BDT', 'PKR', 'LKR', 'THB', 'MYR', 'BRL', 'MXN', 'ZAR', 'TRY', 'SEK', 'NZD'];
const fx = { from: AG.storage.get('fx.from', 'USD'), to: AG.storage.get('fx.to', 'EUR'), rates: null, base: null };
$('#fx-amount').value = AG.storage.get('fx.amount', 1);

async function loadRates(base, force = false) {
  const key = `fx.${base}`;
  const cached = JSON.parse(localStorage.getItem(key) || 'null');
  if (cached && !force && Date.now() - cached.at < 3600_000) { setRates(base, cached, false); return; }
  $('#fx-status').textContent = 'Loading rates…';
  try {
    const d = await getJSON(`https://open.er-api.com/v6/latest/${base}`);
    if (d.result !== 'success') throw new Error(d['error-type'] || 'Rates not available');
    const entry = { at: Date.now(), updated: d.time_last_update_utc, rates: d.rates };
    localStorage.setItem(key, JSON.stringify(entry));
    setRates(base, entry, false);
  } catch (e) {
    if (cached) setRates(base, cached, true);
    else { $('#fx-status').textContent = `Could not load rates: ${e.message}`; toastError(e); }
  }
}

function setRates(base, entry, offline) {
  fx.base = base;
  fx.rates = entry.rates;
  $('#fx-status').textContent = offline
    ? `Offline: rates from ${new Date(entry.at).toLocaleString()}`
    : `Rates updated ${entry.updated ? new Date(entry.updated).toLocaleString() : new Date(entry.at).toLocaleString()}`;
  renderFx();
}

function renderFx() {
  $('#fx-from').textContent = fx.from;
  $('#fx-to').textContent = fx.to;
  $('#fx-base-label').textContent = fx.from;
  const amount = parseFloat($('#fx-amount').value) || 0;
  const rate = fx.rates?.[fx.to];
  $('#fx-result').textContent = rate != null ? (amount * rate).toLocaleString(undefined, { maximumFractionDigits: 4 }) : '–';
  $('#fx-popular').replaceChildren(...POPULAR.filter(c => c !== fx.from && fx.rates?.[c] != null).slice(0, 12).map(c => {
    const li = h('li', { class: 'ag-item ag-clickable', onclick: () => { fx.to = c; AG.storage.set('fx.to', c); AG.device.haptic('selection'); renderFx(); } },
      h('span', { class: 'ag-item-body' }, h('span', { class: 'ag-item-title' }, c)),
      h('span', { class: 'ag-item-trail' }, (amount * fx.rates[c]).toLocaleString(undefined, { maximumFractionDigits: 3 })));
    onLongPress(li, () => shareSheet(`${fx.from} → ${c}`, `${amount} ${fx.from} = ${(amount * fx.rates[c]).toFixed(3)} ${c}`));
    return li;
  }));
}

async function pickCurrency(current) {
  const codes = fx.rates ? Object.keys(fx.rates) : POPULAR;
  const id = await AG.ui.sheet({ title: 'Currency', items: [
    ...POPULAR.filter(c => codes.includes(c)).map(c => ({ id: c, label: c === current ? `${c}  ✓` : c })),
    { id: '*', label: 'Other code…', icon: '⌨️' }] });
  if (id !== '*') return id;
  const code = (await AG.ui.prompt({ title: 'Currency code', message: `${codes.length} available, e.g. ISK, KES, VND`, placeholder: 'ABC' }) || '').trim().toUpperCase();
  if (!code) return null;
  if (fx.rates && !fx.rates[code]) { AG.ui.toast(`${code} is not available`); return null; }
  return code;
}

$('#fx-from').addEventListener('click', async () => {
  const c = await pickCurrency(fx.from);
  if (!c) return;
  fx.from = c; AG.storage.set('fx.from', c);
  loadRates(c);
});
$('#fx-to').addEventListener('click', async () => {
  const c = await pickCurrency(fx.to);
  if (!c) return;
  fx.to = c; AG.storage.set('fx.to', c);
  renderFx();
});
$('#fx-swap').addEventListener('click', () => {
  [fx.from, fx.to] = [fx.to, fx.from];
  AG.storage.set('fx.from', fx.from); AG.storage.set('fx.to', fx.to);
  AG.device.haptic('light');
  loadRates(fx.from);
});
$('#fx-amount').addEventListener('input', () => { AG.storage.set('fx.amount', parseFloat($('#fx-amount').value) || 0); renderFx(); });

/* =========================== Countries =========================== */

const CN = 'https://countriesnow.space/api/v0.1';
let countries = [];
let countrySort = 'name';
let filterTimer = null;

async function loadCountries(force = false) {
  const status = $('#c-status');
  const cached = JSON.parse(localStorage.getItem('countries.v1') || 'null');
  if (cached && !force && Date.now() - cached.at < 7 * 86400_000) { countries = cached.list; return filterCountries(); }
  $('#c-list').replaceChildren(spinner());
  status.textContent = 'Loading countries…';
  try {
    // two APIs in parallel, joined by ISO code
    const [info, pop] = await Promise.all([
      getJSON(`${CN}/countries/info?returns=capital,currency,iso2,iso3,unicodeFlag,dialCode`),
      getJSON(`${CN}/countries/population`),
    ]);
    const popBy = new Map(pop.data.map(p => [p.iso3, p.populationCounts?.at(-1)]));
    countries = info.data.filter(c => c.iso2).map(c => ({
      name: c.name, capital: c.capital || '', currency: c.currency || '', iso2: c.iso2, iso3: c.iso3,
      emoji: c.unicodeFlag || '', dial: c.dialCode || '', population: popBy.get(c.iso3)?.value ?? null, popYear: popBy.get(c.iso3)?.year ?? null,
    }));
    localStorage.setItem('countries.v1', JSON.stringify({ at: Date.now(), list: countries }));
  } catch (e) {
    if (cached) { countries = cached.list; status.textContent = 'Offline: showing saved countries'; }
    else { $('#c-list').replaceChildren(empty('🌐', 'Could not load countries', e.message)); status.textContent = ''; return; }
  }
  filterCountries();
}

async function filterCountries() {
  const q = $('#c-q').value.trim();
  // filtering and sorting run on another CPU core (Hina.thread): the function is copied there as source
  const list = await AG.thread.run((all, q, sort) => {
    q = q.toLowerCase();
    const r = all.filter(c => !q || c.name.toLowerCase().includes(q) || c.capital.toLowerCase().includes(q) || c.currency.toLowerCase() === q || c.iso2.toLowerCase() === q);
    r.sort(sort === 'pop' ? (a, b) => (b.population || 0) - (a.population || 0) : (a, b) => a.name.localeCompare(b.name));
    return r;
  }, [countries, q, countrySort]);
  $('#c-status').textContent = `${list.length} of ${countries.length} countries · sorted by ${countrySort === 'pop' ? 'population' : 'name'}`;
  $('#c-list').replaceChildren(...list.map(c => h('li', { class: 'ag-item ag-clickable', onclick: () => AG.nav.push('country.html', { code: c.iso2 }) },
    h('img', { class: 'flag', src: `https://flagcdn.com/w80/${c.iso2.toLowerCase()}.png`, alt: c.emoji, loading: 'lazy' }),
    h('span', { class: 'ag-item-body' },
      h('span', { class: 'ag-item-title' }, c.name),
      h('span', { class: 'ag-item-sub' }, [c.capital, c.currency].filter(Boolean).join(' · '))),
    h('span', { class: 'ag-item-trail' }, c.population ? compact(c.population) : ''))));
}

const compact = n => n >= 1e9 ? (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'K' : String(n);

$('#c-q').addEventListener('input', () => { clearTimeout(filterTimer); filterTimer = setTimeout(filterCountries, 150); });
$('#c-sort').addEventListener('click', () => {
  countrySort = countrySort === 'name' ? 'pop' : 'name';
  $('#c-sort').textContent = countrySort === 'pop' ? '↕ Population' : '↕ Name';
  AG.device.haptic('selection');
  filterCountries();
});

/* =========================== Hacker News =========================== */

const HN = 'https://hacker-news.firebaseio.com/v0';

async function loadNews() {
  const list = $('#hn-list');
  list.replaceChildren(spinner());
  try {
    const ids = (await getJSON(`${HN}/topstories.json`)).slice(0, 30);
    // 30 requests at once, all native
    const items = (await Promise.all(ids.map(id => getJSON(`${HN}/item/${id}.json`).catch(() => null)))).filter(Boolean);
    if (items[0]) localStorage.setItem('hn.top', String(items[0].id)); // seen: the digest only tells about a new #1
    list.replaceChildren(...items.map((it, i) => {
      const url = it.url || `https://news.ycombinator.com/item?id=${it.id}`;
      const host = it.url ? new URL(it.url).hostname.replace(/^www\./, '') : 'news.ycombinator.com';
      const li = h('li', { class: 'ag-item ag-clickable', onclick: () => AG.device.openUrl(url) },
        h('span', { class: 'hn-rank' }, i + 1),
        h('span', { class: 'ag-item-body' },
          h('span', { class: 'ag-item-title wrap' }, it.title),
          h('span', { class: 'ag-item-sub hn-meta' }, `${it.score} points · ${it.by} · ${it.descendants ?? 0} comments · ${host}`)));
      onLongPress(li, () => shareSheet(it.title, it.title, url));
      return li;
    }));
  } catch (e) {
    list.replaceChildren(empty('📡', 'Could not load stories', e.message));
  }
  refreshDigestStatus();
}

async function refreshDigestStatus() {
  try {
    const task = (await AG.background.list()).find(t => t.name === 'hn-digest');
    $('#hn-bg-toggle').checked = !!task;
    const last = task?.lastRun;
    $('#hn-bg-status').textContent = !task ? 'Off. Turn on to get the new #1 story every hour, even with the app closed.'
      : `On, ${task.schedule}.` + (last ? ` Last check ${new Date(last.at).toLocaleTimeString()}: ${last.status}${last.detail ? ' (' + last.detail.slice(0, 80) + ')' : ''}` : ' Not run yet.');
  } catch (e) { $('#hn-bg-status').textContent = e.message; }
}

$('#hn-bg-toggle').addEventListener('change', async e => {
  try {
    if (e.target.checked) {
      if (await AG.permissions.request('background') !== 'granted') throw new Error('Background permission denied');
      if (await AG.permissions.request('notifications') !== 'granted') throw new Error('Notifications permission denied');
      await AG.background.register('hn-digest', { every: '1h', network: 'any' });
      AG.ui.toast('Hourly digest on');
    } else {
      await AG.background.cancel('hn-digest');
      AG.ui.toast('Hourly digest off');
    }
  } catch (err) { e.target.checked = !e.target.checked; toastError(err); }
  refreshDigestStatus();
});

$('#hn-bg-run').addEventListener('click', async () => {
  try {
    if (await AG.permissions.request('background') !== 'granted') throw new Error('Background permission denied');
    localStorage.removeItem('hn.top'); // so this run notifies even if #1 didn't change
    await AG.background.run('hn-digest');
    AG.ui.toast('Checking… a notification arrives in a few seconds');
    setTimeout(refreshDigestStatus, 8000);
  } catch (e) { toastError(e); }
});

/* =========================== Start =========================== */

const saved = sessionStorage.getItem('tab');
showTab(saved && loaders[saved] ? saved : 'wiki', { haptic: false });
