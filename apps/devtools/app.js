'use strict';
const AG = window.Hina;
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else el.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null) el.append(c.nodeType ? c : document.createTextNode(String(c)));
  return el;
}
function show(id, text, kind = 'ok') {
  const el = document.getElementById(id);
  el.hidden = false;
  el.dataset.kind = kind;
  el.textContent = typeof text === 'string' ? text : JSON.stringify(text, null, 2);
}
const errText = (e) => `${e && e.name ? e.name + ': ' : ''}${(e && e.message) || e}`;
function action(id, fn, outId) {
  document.getElementById(id).addEventListener('click', async (ev) => {
    const b = ev.currentTarget; b.disabled = true;
    try { const r = await fn(b); if (outId && r !== undefined) show(outId, r); }
    catch (e) { console.error(e); if (outId) show(outId, errText(e), 'err'); else AG.ui.toast(errText(e)); }
    finally { b.disabled = false; }
  });
}

/* ============================ tabs & back ============================ */
let tab = 'http';
function showTab(name) {
  tab = name;
  $$('.tab').forEach((s) => { s.hidden = s.dataset.tab !== name; });
  $$('.ag-navbar-item').forEach((b) => b.classList.toggle('is-active', b.dataset.tab === name));
  $('#title').textContent = $(`.tab[data-tab="${name}"]`).dataset.title;
  sessionStorage.setItem('tab', name);
  if (name === 'hina') renderHina();
}
$$('.ag-navbar-item').forEach((b) => b.addEventListener('click', () => { AG.device.haptic('selection'); showTab(b.dataset.tab); }));
AG.onBack(() => { if (tab !== 'http') { showTab('http'); return true; } return false; });
$('#btn-console').addEventListener('click', () => AG.dev.console());

/* ============================ HTTP client ============================ */
// history in IndexedDB (native SQLite underneath)
let dbp = null;
function db() {
  dbp = dbp || new Promise((res, rej) => {
    const o = indexedDB.open('devtools', 1);
    o.onupgradeneeded = () => o.result.createObjectStore('history', { keyPath: 'id', autoIncrement: true }).createIndex('at', 'at');
    o.onsuccess = () => res(o.result);
    o.onerror = () => rej(o.error);
  });
  return dbp;
}
const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
async function addHistory(item) {
  const store = (await db()).transaction('history', 'readwrite').objectStore('history');
  await req(store.add(item));
}
async function loadHistory() {
  const store = (await db()).transaction('history').objectStore('history');
  const all = await req(store.getAll());
  return all.sort((a, b) => b.at - a.at).slice(0, 30);
}
async function renderHistory() {
  const list = $('#h-history');
  const items = await loadHistory();
  list.replaceChildren(...(items.length ? items.map((it) => h('li', { class: 'ag-item ag-clickable hist-item', onclick: () => restore(it) },
    h('span', { class: 'ag-item-body' },
      h('span', { class: 'ag-item-title' }, `${it.method} ${it.url}`),
      h('span', { class: 'ag-item-sub' }, `${it.status || 'error'} · ${it.ms} ms · ${new Date(it.at).toLocaleString()}`)),
  )) : [h('li', { class: 'ag-item ag-muted' }, 'No requests yet')]));
}
function restore(it) {
  $('#h-method').value = it.method; $('#h-url').value = it.url; $('#h-headers').value = it.headers; $('#h-body').value = it.body || '';
  AG.device.haptic('light');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function parseHeaders(text) {
  const hdrs = new Headers();
  for (const line of text.split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) hdrs.append(line.slice(0, i).trim(), line.slice(i + 1).trim());
  }
  return hdrs;
}
$('#h-json').addEventListener('click', () => {
  $('#h-method').value = 'POST';
  if (!/content-type/i.test($('#h-headers').value)) $('#h-headers').value = ($('#h-headers').value.trim() + '\nContent-Type: application/json').trim();
  if (!$('#h-body').value.trim()) $('#h-body').value = JSON.stringify({ hello: 'from Dev Toolbox', at: new Date().toISOString() }, null, 2);
});
action('h-send', async () => {
  const method = $('#h-method').value, url = $('#h-url').value.trim(), headersText = $('#h-headers').value, body = $('#h-body').value;
  const t0 = performance.now();
  const meta = $('#h-meta');
  meta.hidden = false;
  meta.replaceChildren(h('span', { class: 'ag-spinner' }));
  try {
    const res = await fetch(url, {
      method, headers: parseHeaders(headersText),
      body: method === 'GET' || method === 'HEAD' ? undefined : body,
      credentials: $('#h-omit').checked ? 'omit' : 'include',
    });
    const buf = await res.arrayBuffer();
    const ms = Math.round(performance.now() - t0);
    const type = res.headers.get('content-type') || '';
    let text = new TextDecoder().decode(buf);
    if (/json/.test(type) || /^\s*[[{]/.test(text)) { try { text = JSON.stringify(JSON.parse(text), null, 2); } catch {} }
    meta.replaceChildren(
      h('span', { class: `ag-badge ${res.ok ? 'status-ok' : 'status-bad'}` }, `${res.status} ${res.statusText}`),
      h('span', { class: 'ag-badge ag-badge-neutral' }, `${ms} ms`),
      h('span', { class: 'ag-badge ag-badge-neutral' }, `${buf.byteLength.toLocaleString()} B`),
      ...(res.redirected ? [h('span', { class: 'ag-badge ag-badge-warning' }, 'redirected')] : []),
    );
    let hdrs = ''; res.headers.forEach((v, k) => { hdrs += `${k}: ${v}\n`; });
    show('h-resp-headers', hdrs.trim() || '(no headers)');
    show('h-resp', text.length > 200000 ? text.slice(0, 200000) + '\n… (cut)' : text || '(empty body)');
    AG.device.haptic(res.ok ? 'success' : 'warning');
    await addHistory({ method, url, headers: headersText, body, status: res.status, ms, at: Date.now() });
  } catch (e) {
    const ms = Math.round(performance.now() - t0);
    meta.replaceChildren(h('span', { class: 'ag-badge status-bad' }, e.name || 'Error'), h('span', { class: 'ag-badge ag-badge-neutral' }, `${ms} ms`));
    $('#h-resp-headers').hidden = true;
    show('h-resp', errText(e), 'err');
    AG.device.haptic('error');
    await addHistory({ method, url, headers: headersText, body, status: 0, ms, at: Date.now() });
  }
  renderHistory();
});
action('h-clear-hist', async () => {
  if (!(await AG.ui.confirm({ title: 'Clear history?', ok: 'Clear', destructive: true }))) return;
  await req((await db()).transaction('history', 'readwrite').objectStore('history').clear());
  renderHistory();
});
// remember the last request across restarts (native localStorage)
for (const id of ['h-method', 'h-url', 'h-headers', 'h-body']) {
  const el = $('#' + id);
  const saved = localStorage.getItem('dt.' + id);
  if (saved != null) el.value = saved;
  el.addEventListener('change', () => localStorage.setItem('dt.' + id, el.value));
}

const hostUrl = () => { const u = new URL($('#h-url').value.trim()); return `${u.protocol}//${u.host}/`; };
action('c-list', async () => {
  const list = await AG.cookies.list(hostUrl());
  return list.length ? list.map((c) => `${c.name}=${c.value}\n   ${c.domain}${c.path} · ${c.session ? 'session' : 'until ' + new Date(c.expires).toLocaleString()}${c.httpOnly ? ' · HttpOnly' : ''}`).join('\n') : `No cookies for ${hostUrl()}`;
}, 'c-out');
action('c-import', async () => {
  const header = await AG.ui.prompt({ title: 'Import cookies', message: `Paste a "Cookie:" header for ${new URL(hostUrl()).host}`, placeholder: 'name=value; other=value' });
  if (!header) return undefined;
  return `Saved ${await AG.cookies.import(hostUrl(), header)} cookie(s)`;
}, 'c-out');
action('c-clear', async () => `Removed ${await AG.cookies.clear(hostUrl())} cookie(s)`, 'c-out');

/* ============================ WebSocket ============================ */
let ws = null;
function wlog(text, cls = '') {
  const log = $('#w-log');
  const line = h('div', { class: cls }, `${new Date().toLocaleTimeString()}  ${text}`);
  log.append(line);
  log.scrollTop = log.scrollHeight;
}
function wstate(s) {
  $('#w-state').textContent = s;
  $('#w-send').disabled = s !== 'open';
  $('#w-close').disabled = s === 'closed';
  $('#w-connect').disabled = s !== 'closed';
}
$('#w-connect').addEventListener('click', () => {
  try {
    ws = new WebSocket($('#w-url').value.trim());
  } catch (e) { wlog(errText(e), 'sys'); return; }
  wstate('connecting'); wlog(`connecting to ${ws.url}`, 'sys');
  ws.onopen = () => { wstate('open'); wlog('open', 'sys'); AG.device.haptic('success'); };
  ws.onmessage = (e) => wlog(`← ${typeof e.data === 'string' ? e.data : '[binary]'}`, 'in');
  ws.onerror = () => wlog('error', 'sys');
  ws.onclose = (e) => { wstate('closed'); wlog(`closed (${e.code}${e.reason ? ' ' + e.reason : ''})`, 'sys'); };
});
$('#w-send').addEventListener('click', () => { const m = $('#w-msg').value; ws.send(m); wlog(`→ ${m}`); });
$('#w-close').addEventListener('click', () => ws && ws.close());
$('#w-clear').addEventListener('click', () => $('#w-log').replaceChildren());

/* ============================ Tools ============================ */
const b64e = (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
const b64d = (s) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), (c) => c.charCodeAt(0)));
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const ops = {
  json: (s) => JSON.stringify(JSON.parse(s), null, 2),
  jsonmin: (s) => JSON.stringify(JSON.parse(s)),
  b64e, b64d: (s) => b64d(s.trim()),
  urle: (s) => encodeURIComponent(s),
  urld: (s) => decodeURIComponent(s),
  jwt: (s) => {
    const [hd, pl, sig] = s.trim().split('.');
    if (!pl) throw new Error('Not a JWT (header.payload.signature)');
    const payload = JSON.parse(b64d(pl));
    const times = ['iat', 'nbf', 'exp'].filter((k) => payload[k]).map((k) => `${k}: ${new Date(payload[k] * 1000).toLocaleString()}`);
    return `header:\n${JSON.stringify(JSON.parse(b64d(hd)), null, 2)}\n\npayload:\n${JSON.stringify(payload, null, 2)}${times.length ? '\n\n' + times.join('\n') : ''}\n\nsignature: ${sig ? sig.slice(0, 16) + '…' : '(none)'}`;
  },
  sha: async (s) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))),
  uuid: () => crypto.randomUUID(),
  ts: (s) => {
    const v = s.trim();
    if (/^\d{9,13}$/.test(v)) { const ms = v.length <= 10 ? +v * 1000 : +v; const d = new Date(ms); return `${d.toISOString()}\n${d.toLocaleString()}`; }
    const d = v ? new Date(v) : new Date();
    if (isNaN(d)) throw new Error('Not a date or epoch number');
    return `${Math.floor(d.getTime() / 1000)} (seconds)\n${d.getTime()} (ms)\n${d.toISOString()}`;
  },
};
$$('[data-op]').forEach((b) => b.addEventListener('click', async () => {
  try { show('t-out', String(await ops[b.dataset.op]($('#t-in').value))); AG.device.haptic('light'); }
  catch (e) { show('t-out', errText(e), 'err'); AG.device.haptic('error'); }
}));
action('t-copy', async () => { await AG.device.copy($('#t-out').textContent); AG.ui.toast('Copied'); });
action('t-paste', async () => {
  if ((await AG.permissions.request('clipboard')) !== 'granted') throw new Error('Clipboard permission denied');
  $('#t-in').value = await AG.device.paste();
});
$('#t-swap').addEventListener('click', () => { if (!$('#t-out').hidden) $('#t-in').value = $('#t-out').textContent; });

// Runs on another CPU core: it gets only its arguments (copied as source code), so it reads the file itself.
const hashFileOnThread = async (path) => {
  const b64 = await Hina.fs.read(path, { encoding: 'base64' });
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const t0 = Date.now();
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return { size: bytes.length, ms: Date.now() - t0, sha256: Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('') };
};
action('t-file', async () => {
  const files = await AG.fs.pick({ accept: '*/*' });
  if (!files.length) return undefined;
  const f = files[0];
  show('t-file-out', `Hashing ${f.name} on a background thread…`);
  const r = await AG.thread.run(hashFileOnThread, [f.path]);
  AG.fs.delete(f.path).catch(() => {});
  AG.device.haptic('success');
  return `${f.name}\n${r.size.toLocaleString()} bytes · ${r.ms} ms\nSHA-256: ${r.sha256}`;
}, 't-file-out');

/* ============================ Agent Hina ============================ */
action('m-list', async () => {
  const tools = await AG.mcp.list('notes_mcp');
  $('#m-tools').replaceChildren(...tools.map((t) => h('li', { class: 'ag-item ag-clickable', onclick: () => {
    $('#m-tool').value = t.name;
    const props = (t.inputSchema && t.inputSchema.properties) || {};
    $('#m-args').value = JSON.stringify(Object.fromEntries(Object.keys(props).map((k) => [k, ''])), null, 2);
  } }, h('span', { class: 'ag-item-body' }, h('span', { class: 'ag-item-title' }, t.name), h('span', { class: 'ag-item-sub' }, (t.description || '').slice(0, 120))))));
}, 'm-out');
action('m-call', async () => {
  let args;
  try { args = JSON.parse($('#m-args').value || '{}'); } catch (e) { throw new Error('Arguments are not valid JSON: ' + e.message); }
  const r = await AG.mcp.call('notes_mcp', $('#m-tool').value.trim(), args);
  const text = (r.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  try { return JSON.stringify(JSON.parse(text), null, 2); } catch { return text || JSON.stringify(r, null, 2); }
}, 'm-out');

function renderPermissions() {
  const all = AG.permissions.all();
  $('#p-list').replaceChildren(...Object.entries(all).map(([name, state]) => h('li', { class: 'ag-item' },
    h('span', { class: 'ag-item-body' }, h('span', { class: 'ag-item-title' }, name)),
    h('span', { class: 'ag-item-trail' },
      state === 'granted' ? h('span', { class: 'ag-badge ag-badge-success' }, 'granted')
        : h('button', { class: 'ag-btn ag-btn-tonal ag-btn-sm', onclick: async () => { await AG.permissions.request(name); renderPermissions(); } }, state === 'denied' ? 'denied · ask' : 'ask')))));
}
function renderTheme() {
  const colors = (AG.theme && AG.theme.colors) || {};
  $('#th-swatches').replaceChildren(...Object.entries(colors).slice(0, 24).map(([k, v]) => h('div', { class: 'swatch', style: `background:${v}` }, `${k}\n${v}`)));
}
async function renderHina() {
  renderPermissions();
  renderTheme();
  try { show('d-out', { ...(await AG.device.info()), app: AG.app, cores: AG.thread.cores }); } catch (e) { show('d-out', errText(e), 'err'); }
}
AG.on('permission', renderPermissions);
AG.on('theme', renderTheme);
$('#d-console').addEventListener('click', () => AG.dev.console());
$('#d-devtools').addEventListener('click', () => AG.dev.devtools());
$('#d-reload').addEventListener('click', () => AG.reload());

/* ============================ start ============================ */
AG.ui.statusBar({ color: getComputedStyle(document.documentElement).getPropertyValue('--ag-background').trim() || '#263238' });
renderHistory().catch((e) => console.warn('history', e));
showTab(sessionStorage.getItem('tab') || 'http');
