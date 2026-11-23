// Showcase: tries every Mini Apps runtime feature and shows the result (or the error) under each button.

const AG = window.Hina;
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Tiny DOM builder: h('li', {class: 'x', onclick: fn}, 'text', child) */
function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') el.className = value;
    else if (key === 'style') el.style.cssText = value;
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (key === 'svg') el.innerHTML = value; // trusted, static icons only
    else if (value === true) el.setAttribute(key, '');
    else if (value != null && value !== false) el.setAttribute(key, value);
  }
  el.append(...children.flat().filter(c => c != null && c !== false));
  return el;
}

const errorText = e => (e && e.name ? `${e.name}: ${e.message}` : String(e));
const fmtSize = n => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);

/** Shows a result box under a card. kind: 'ok' | 'err' | 'info' */
function show(id, value, kind = 'info') {
  const el = document.getElementById(id);
  el.hidden = false;
  el.dataset.kind = kind;
  el.textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

/** Wires a button: runs the async handler, shows its return value or the error. */
function action(id, handler, outId) {
  document.getElementById(id).addEventListener('click', async event => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const result = await handler(button);
      if (outId && result !== undefined) show(outId, result, 'ok');
    } catch (e) {
      console.error(e);
      if (outId) show(outId, errorText(e), 'err');
      else AG.ui.toast(errorText(e));
    } finally {
      button.disabled = false;
    }
  });
}

if (!AG) {
  document.body.prepend(h('div', { class: 'ag-card ag-card-primary', style: 'margin:16px' },
    'Open this app inside Agent Hina → Mini Apps to use the native APIs.'));
  throw new Error('Agent Hina runtime not found');
}

/* =========================== Tabs & back =========================== */

let currentTab = 'storage';

function showTab(name, { haptic = true } = {}) {
  currentTab = name;
  for (const section of $$('.tab')) {
    const active = section.dataset.tab === name;
    section.hidden = !active;
    if (active) {
      $('#title').textContent = section.dataset.title;
      section.classList.remove('ag-fade');
      void section.offsetWidth; // restart the fade animation
      section.classList.add('ag-fade');
    }
  }
  for (const item of $$('.ag-navbar-item')) {
    item.classList.toggle('is-active', item.dataset.tab === name);
    item.setAttribute('aria-selected', String(item.dataset.tab === name));
  }
  window.scrollTo(0, 0);
  sessionStorage.setItem('tab', name);
  if (haptic) AG.device.haptic('selection');
  if (name === 'system') { renderPermissions(); renderTheme(); }
}

for (const item of $$('.ag-navbar-item')) item.addEventListener('click', () => showTab(item.dataset.tab));

const panel = $('#panel'), scrim = $('#scrim');
const panelOpen = () => panel.classList.contains('is-open');
function setPanel(open) {
  panel.classList.toggle('is-open', open);
  scrim.classList.toggle('is-open', open);
}
$('#panel-open').addEventListener('click', () => setPanel(true));
$('#panel-close').addEventListener('click', () => setPanel(false));
scrim.addEventListener('click', () => setPanel(false));

// Back: close the panel first, then go back to the first tab, then let the app close.
AG.onBack(() => {
  if (panelOpen()) { setPanel(false); return true; }
  if (currentTab !== 'storage') { showTab('storage'); return true; }
  return false;
});

$('#btn-console').addEventListener('click', () => AG.dev.console());
$('#btn-more').addEventListener('click', async () => {
  const choice = await AG.ui.sheet({
    title: 'Showcase',
    items: [
      { id: 'reload', label: 'Reload', icon: '🔄' },
      { id: 'console', label: 'Console', icon: '🖥️' },
      { id: 'devtools', label: 'DevTools', icon: '🛠️' },
      { id: 'close', label: 'Close app', icon: '✖️', destructive: true },
    ],
  });
  if (choice === 'reload') AG.reload();
  if (choice === 'console') AG.dev.console();
  if (choice === 'devtools') AG.dev.devtools();
  if (choice === 'close') AG.nav.close();
});

/* =========================== Storage =========================== */

// localStorage counter (native-backed, shared with detail.html)
function renderCounter(bump = false) {
  const el = $('#counter-value');
  el.textContent = localStorage.getItem('counter') ?? '0';
  if (bump) {
    el.classList.add('bump');
    setTimeout(() => el.classList.remove('bump'), 150);
  }
}
function changeCounter(delta) {
  const next = delta === null ? 0 : Number(localStorage.getItem('counter') ?? 0) + delta;
  localStorage.setItem('counter', String(next));
  AG.device.haptic('light');
  renderCounter(true);
}
$('#counter-inc').addEventListener('click', () => changeCounter(1));
$('#counter-dec').addEventListener('click', () => changeCounter(-1));
$('#counter-reset').addEventListener('click', () => changeCounter(null));

// Hina.storage key-value
action('kv-save', () => {
  const name = $('#kv-name').value.trim();
  AG.storage.set('profile', { name, savedAt: new Date().toISOString() });
  return { saved: AG.storage.get('profile') };
}, 'kv-out');
action('kv-load', () => {
  const profile = AG.storage.get('profile', null);
  if (profile) $('#kv-name').value = profile.name;
  return { profile };
}, 'kv-out');
action('kv-keys', () => ({ keys: AG.storage.keys() }), 'kv-out');

// IndexedDB todos (raw API)
let todoFilter = 'all';
let dbPromise = null;

function openDb() {
  dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('showcase', 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore('todos', { keyPath: 'id', autoIncrement: true });
      store.createIndex('done', 'done'); // 0 or 1: booleans are not valid IndexedDB keys
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { dbPromise = null; reject(request.error); };
  });
  return dbPromise;
}
const requestDone = request => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});
const transactionDone = tx => new Promise((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onerror = () => reject(tx.error);
  tx.onabort = () => reject(tx.error || new DOMException('Transaction aborted', 'AbortError'));
});

async function loadTodos() {
  const db = await openDb();
  const tx = db.transaction('todos', 'readonly');
  const store = tx.objectStore('todos');
  const total = requestDone(store.count());
  const source = todoFilter === 'all' ? store : store.index('done');
  const range = todoFilter === 'all' ? null : IDBKeyRange.only(todoFilter === 'done' ? 1 : 0);
  const items = [];
  const cursorRequest = source.openCursor(range, 'prev'); // newest first
  await new Promise((resolve, reject) => {
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor) return resolve();
      items.push(cursor.value);
      cursor.continue();
    };
    cursorRequest.onerror = () => reject(cursorRequest.error);
  });
  return { items, total: await total };
}

async function renderTodos() {
  try {
    const { items, total } = await loadTodos();
    $('#todo-count').textContent = `${total} total`;
    const list = $('#todo-list');
    list.replaceChildren(...items.map(todo => h('li', { class: `ag-item ag-enter${todo.done ? ' is-done' : ''}` },
      h('input', { type: 'checkbox', class: 'ag-checkbox ag-round', checked: !!todo.done, 'aria-label': 'Done',
        onchange: () => toggleTodo(todo.id) }),
      h('span', { class: 'ag-item-body' },
        h('span', { class: 'ag-item-title' }, todo.text),
        h('span', { class: 'ag-item-sub' }, `#${todo.id} · ${new Date(todo.created).toLocaleString()}`)),
      h('button', { class: 'ag-btn ag-btn-icon', 'aria-label': 'Delete', onclick: () => deleteTodo(todo.id),
        svg: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>' }),
    )));
    if (!items.length) list.append(h('li', { class: 'ag-item ag-muted' }, todoFilter === 'all' ? 'No todos yet. Add one above.' : 'Nothing here.'));
  } catch (e) {
    console.error(e);
    show('todo-out', errorText(e), 'err');
  }
}

async function addTodo(text) {
  const db = await openDb();
  const tx = db.transaction('todos', 'readwrite');
  const done = transactionDone(tx);
  const id = await requestDone(tx.objectStore('todos').add({ text, done: 0, created: Date.now() }));
  await done;
  return id;
}
async function toggleTodo(id) {
  const db = await openDb();
  const tx = db.transaction('todos', 'readwrite');
  const done = transactionDone(tx);
  const store = tx.objectStore('todos');
  const todo = await requestDone(store.get(id));
  if (todo) {
    todo.done = todo.done ? 0 : 1;
    store.put(todo);
    AG.device.haptic(todo.done ? 'success' : 'light');
  }
  await done;
  renderTodos();
}
async function deleteTodo(id) {
  const db = await openDb();
  const tx = db.transaction('todos', 'readwrite');
  const done = transactionDone(tx);
  tx.objectStore('todos').delete(id);
  await done;
  AG.device.haptic('medium');
  renderTodos();
}

$('#todo-form').addEventListener('submit', async event => {
  event.preventDefault();
  const input = $('#todo-text');
  const text = input.value.trim();
  if (!text) return;
  try {
    const id = await addTodo(text);
    input.value = '';
    show('todo-out', `Added todo #${id}`, 'ok');
    renderTodos();
  } catch (e) {
    show('todo-out', errorText(e), 'err');
  }
});
for (const chip of $$('#todo-filter .ag-chip')) {
  chip.addEventListener('click', () => {
    todoFilter = chip.dataset.filter;
    $$('#todo-filter .ag-chip').forEach(c => c.classList.toggle('is-selected', c === chip));
    renderTodos();
  });
}

// App files (data/ is always allowed)
action('fs-write', async () => {
  const text = $('#notes-text').value;
  await AG.fs.write('data/notes.txt', text);
  return `Saved ${text.length} characters to data/notes.txt`;
}, 'fs-out');
action('fs-read', async () => {
  const text = await AG.fs.read('data/notes.txt');
  $('#notes-text').value = text;
  return `Read ${text.length} characters:\n${text.slice(0, 400)}`;
}, 'fs-out');
action('fs-json', async () => {
  await AG.fs.writeJSON('data/state.json', {
    savedAt: new Date().toISOString(),
    counter: Number(localStorage.getItem('counter') ?? 0),
    profile: AG.storage.get('profile', null),
  });
  return { 'data/state.json': await AG.fs.readJSON('data/state.json') };
}, 'fs-out');
action('fs-list', async () => {
  const entries = await AG.fs.list('data/');
  if (!entries.length) return 'data/ is empty';
  return entries.map(e => `${e.type === 'dir' ? '📁' : '📄'} ${e.name}${e.type === 'file' ? `  ${fmtSize(e.size)}` : ''}`).join('\n');
}, 'fs-out');

// /sdcard/Download: needs the storage permission
action('dl-list', async () => {
  const list = $('#dl-items');
  list.replaceChildren();
  $('#dl-out').hidden = true;
  const entries = await AG.fs.list('/sdcard/Download');
  entries.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1));
  list.append(...entries.slice(0, 30).map(e => h('li', { class: 'ag-item ag-enter' },
    h('span', { class: 'ag-item-lead' }, e.type === 'dir' ? '📁' : '📄'),
    h('span', { class: 'ag-item-body' },
      h('span', { class: 'ag-item-title' }, e.name),
      h('span', { class: 'ag-item-sub' }, [e.type === 'file' ? fmtSize(e.size) : 'Folder', new Date(e.mtime).toLocaleDateString()].join(' · '))),
  )));
  return `${entries.length} entries${entries.length > 30 ? ' (showing 30)' : ''}`;
}, 'dl-out');
action('dl-request', async () => `storage: ${await AG.permissions.request('storage')}`, 'dl-out');

// a folder the user chooses in Agent Hina's file explorer (the manifest allows it with "pick": "read")
action('pick-folder', async () => {
  const picked = await AG.fs.pickFolder();
  if (!picked) return 'Cancelled';
  const entries = await AG.fs.list(picked.path);
  return `Access to ${picked.path} (${picked.access})\n${entries.length} entries: ${entries.slice(0, 8).map(e => e.name).join(', ')}${entries.length > 8 ? '…' : ''}`;
}, 'dl-out');

action('my-folders', async () => (await AG.fs.folders()).map(f => `${f.path}  ${f.access}  (${f.source})`).join('\n'), 'dl-out');

/* =========================== Network =========================== */

action('net-github', async () => {
  const res = await fetch('https://api.github.com/repos/torvalds/linux', { headers: { Accept: 'application/vnd.github+json' } });
  const repo = await res.json();
  if (!res.ok) return `HTTP ${res.status}\n${repo.message ?? ''}`;
  return `HTTP ${res.status} ${res.statusText}\n${repo.full_name}\n★ ${repo.stargazers_count.toLocaleString()}   ⑂ ${repo.forks_count.toLocaleString()}\n${repo.description}`;
}, 'net-github-out');

action('net-post', async () => {
  const res = await fetch('https://httpbin.org/post', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hello: 'from a mini app', at: new Date().toISOString() }),
  });
  const body = await res.json();
  return { status: res.status, echoed: body.json, contentType: body.headers['Content-Type'] };
}, 'net-post-out');

action('net-headers', async () => {
  const res = await fetch('https://httpbin.org/headers', {
    headers: { Origin: 'https://example.org', 'User-Agent': 'AgentHinaShowcase/1.0', 'X-Mini-App': 'showcase' },
  });
  const { headers } = await res.json();
  return { Origin: headers.Origin, 'User-Agent': headers['User-Agent'], 'X-Mini-App': headers['X-Mini-App'] };
}, 'net-headers-out');

action('net-xhr', () => new Promise((resolve, reject) => {
  const xhr = new XMLHttpRequest();
  xhr.open('GET', 'https://httpbin.org/get?via=xhr&n=42');
  xhr.responseType = 'json';
  xhr.onload = () => resolve({ status: xhr.status, args: xhr.response?.args, contentType: xhr.getResponseHeader('content-type') });
  xhr.onerror = () => reject(new Error('XHR network error'));
  xhr.send();
}), 'net-xhr-out');

// WebSocket echo
let socket = null;
const wsLines = [];
function wsLog(line) {
  wsLines.push(`${new Date().toLocaleTimeString()}  ${line}`);
  show('ws-log', wsLines.slice(-12).join('\n'));
}
function wsStatus(text, on) {
  const el = $('#ws-status');
  el.textContent = text;
  el.classList.toggle('is-on', on);
}
$('#ws-connect').addEventListener('click', () => {
  if (socket && socket.readyState <= WebSocket.OPEN) return wsLog('Already connected');
  wsStatus('Connecting…', false);
  socket = new WebSocket('wss://ws.postman-echo.com/raw');
  socket.onopen = () => { wsStatus('Connected', true); wsLog('✓ open'); };
  socket.onmessage = e => wsLog(`← ${e.data}`);
  socket.onerror = () => wsLog('✗ error');
  socket.onclose = e => { wsStatus('Disconnected', false); wsLog(`closed (code ${e.code})`); };
});
$('#ws-close').addEventListener('click', () => socket?.close(1000, 'bye'));
$('#ws-form').addEventListener('submit', event => {
  event.preventDefault();
  const text = $('#ws-text').value;
  if (!socket || socket.readyState !== WebSocket.OPEN) return wsLog('Connect first');
  socket.send(text);
  wsLog(`→ ${text}`);
});

// Image over https (fetched natively)
action('net-image', () => new Promise((resolve, reject) => {
  const img = $('#net-image-el');
  const started = performance.now();
  img.onload = () => {
    img.hidden = false;
    resolve(`Loaded ${img.naturalWidth}×${img.naturalHeight} in ${Math.round(performance.now() - started)} ms`);
  };
  img.onerror = () => reject(new Error('Image failed or was blocked'));
  img.src = `https://picsum.photos/400/200?random=${Date.now()}`;
}), 'net-image-out');

// Permission checks
action('net-blocked', async () => {
  try {
    const res = await fetch('https://example.com/');
    throw new Error(`Not blocked! Got HTTP ${res.status}`);
  } catch (e) {
    if (e.name === 'NotAllowedError') return `Blocked as expected\n${errorText(e)}`;
    throw e;
  }
}, 'net-check-out');
action('net-local', async () => {
  const res = await fetch('http://127.0.0.1:8080/');
  const text = await res.text();
  return `HTTP ${res.status} from localhost:8080\n${text.slice(0, 300)}`;
}, 'net-check-out');

/* =========================== Native UI =========================== */

action('web-alert', () => { alert('Hello from alert(). This is a native dialog.'); return 'alert() closed'; }, 'web-dialog-out');
action('web-confirm', () => `confirm() → ${confirm('Do you like native dialogs?')}`, 'web-dialog-out');
action('web-prompt', () => `prompt() → ${JSON.stringify(prompt('What should we call you?', 'Friend'))}`, 'web-dialog-out');

action('ui-alert', async () => {
  await AG.ui.alert({ title: 'Native alert', message: 'Async and themed. The promise resolves when it closes.', ok: 'Got it' });
  return 'Hina.ui.alert closed';
}, 'ui-dialog-out');
action('ui-confirm', async () => {
  const yes = await AG.ui.confirm({ title: 'Delete everything?', message: 'This confirm uses a destructive button.', ok: 'Delete', cancel: 'Keep', destructive: true });
  return `Hina.ui.confirm → ${yes}`;
}, 'ui-dialog-out');
action('ui-prompt', async () => {
  const name = await AG.ui.prompt({ title: 'Rename', message: 'Give this app a nickname.', value: 'Showcase', placeholder: 'Nickname' });
  return `Hina.ui.prompt → ${JSON.stringify(name)}`;
}, 'ui-dialog-out');
action('ui-sheet', async () => {
  const id = await AG.ui.sheet({
    title: 'Photo',
    items: [
      { id: 'share', label: 'Share', icon: '📤' },
      { id: 'edit', label: 'Edit', icon: '✏️' },
      { id: 'favorite', label: 'Add to favorites', icon: '⭐' },
      { id: 'delete', label: 'Delete', icon: '🗑️', destructive: true },
    ],
  });
  return `Hina.ui.sheet → ${JSON.stringify(id)}`;
}, 'ui-dialog-out');

let pickedDate, pickedTime;
action('pick-date', async () => {
  pickedDate = (await AG.ui.pickDate({ value: pickedDate, title: 'Pick a date' })) ?? pickedDate;
  return `Date: ${pickedDate ?? 'cancelled'}`;
}, 'pick-out');
action('pick-time', async () => {
  pickedTime = (await AG.ui.pickTime({ value: pickedTime })) ?? pickedTime;
  return `Time: ${pickedTime ?? 'cancelled'}`;
}, 'pick-out');

$('#toast-short').addEventListener('click', () => AG.ui.toast('Hello from a native toast 👋'));
$('#toast-long').addEventListener('click', () => AG.ui.toast('A long toast stays on screen a little longer.', { long: true }));
$('#haptics').append(...['light', 'medium', 'heavy', 'selection', 'success', 'warning', 'error'].map(kind =>
  h('button', { class: 'ag-chip', onclick: () => AG.device.haptic(kind) }, kind)));

action('dev-copy', async () => {
  const text = `Copied from a mini app at ${new Date().toLocaleTimeString()}`;
  await AG.device.copy(text);
  return `Copied: ${text}`;
}, 'clip-out');
action('dev-paste', async () => `Clipboard: ${JSON.stringify(await AG.device.paste())}`, 'clip-out');
action('dev-share', async () => {
  await AG.device.share({ title: 'Agent Hina Showcase', text: 'Built with Agent Hina Mini Apps ✨' });
  return 'Share sheet opened';
}, 'clip-out');

action('notify-now', async () => {
  await AG.notify.show({ title: 'Showcase', body: 'A native notification from a mini app 🔔', tag: 'now' });
  return 'Notification shown';
}, 'notify-out');
action('notify-later', async () => {
  await AG.notify.schedule({ title: 'Showcase reminder', body: 'Scheduled 10 seconds ago ⏰', delay: 10_000, tag: 'later' });
  return 'Scheduled in 10 seconds. You can close the app.';
}, 'notify-out');
action('notify-cancel', async () => {
  await AG.notify.cancel('later');
  return 'Scheduled notification cancelled';
}, 'notify-out');

// <input type=file> (native picker) and Hina.fs.pick
$('#file-input-btn').addEventListener('click', () => $('#file-input').click());
$('#file-input').addEventListener('change', event => {
  const file = event.target.files[0];
  if (!file) return show('file-out', 'No file chosen');
  const img = $('#file-preview');
  img.src = URL.createObjectURL(file);
  img.hidden = false;
  show('file-out', `<input type=file>: ${file.name} · ${fmtSize(file.size)} · ${file.type || 'unknown type'}`, 'ok');
});
action('fs-pick', async () => {
  const files = await AG.fs.pick({ accept: 'image/*' });
  if (!files.length) return 'Nothing picked';
  const first = files[0];
  if ((first.type || '').startsWith('image/')) {
    const img = $('#file-preview');
    img.src = AG.fs.url(first.path);
    img.hidden = false;
  }
  return files.map(f => `${f.name} · ${fmtSize(f.size)} → ${f.path}`).join('\n');
}, 'file-out');

$('#nav-push').addEventListener('click', () => AG.nav.push('detail.html', { id: 42 }));

const statusColors = [
  ['App color', '#6750A4'], ['Red', '#C62828'], ['Teal', '#00796B'], ['Amber', '#FFC107'],
  ['Theme', () => getComputedStyle(document.documentElement).getPropertyValue('--ag-background').trim() || '#FFFFFF'],
];
$('#statusbar-chips').append(...statusColors.map(([label, color]) => h('button', {
  class: 'ag-chip',
  onclick: event => {
    $$('#statusbar-chips .ag-chip').forEach(c => c.classList.toggle('is-selected', c === event.currentTarget));
    AG.ui.statusBar({ color: typeof color === 'function' ? color() : color });
  },
}, label)));

action('device-info', () => AG.device.info(), 'device-out');

/* =========================== System =========================== */

const permissionInfo = {
  network: ['🌐', 'Internet, only the hosts in the manifest'],
  localhost: ['🖥️', 'Servers on this phone (127.0.0.1)'],
  storage: ['📂', 'Folders outside the app'],
  notifications: ['🔔', 'Show and schedule notifications'],
  clipboard: ['📋', 'Read the clipboard'],
  camera: ['📷', 'Take photos and video'],
  microphone: ['🎙️', 'Record audio'],
};
const stateBadge = { granted: 'ag-badge-success', denied: '', prompt: 'ag-badge-neutral' };

function renderPermissions() {
  const all = AG.permissions.all();
  $('#perm-list').replaceChildren(...Object.entries(all).map(([name, state]) => {
    const [icon, about] = permissionInfo[name] ?? ['🧩', name.startsWith('mcp:') ? `Agent Hina tool server ${name.slice(4)}` : ''];
    return h('li', { class: 'ag-item' },
      h('span', { class: 'ag-item-lead' }, icon),
      h('span', { class: 'ag-item-body' },
        h('span', { class: 'ag-item-title' }, name),
        h('span', { class: 'ag-item-sub' }, about)),
      h('span', { class: 'ag-item-trail' },
        h('span', { class: `ag-badge ${stateBadge[state] ?? 'ag-badge-neutral'}` }, state),
        state !== 'granted' && h('button', {
          class: 'ag-btn ag-btn-text ag-btn-sm',
          onclick: async () => {
            const result = await AG.permissions.request(name);
            AG.ui.toast(`${name}: ${result}`);
            renderPermissions();
          },
        }, 'Request')));
  }));
}
AG.on('permission', renderPermissions);

function renderTheme() {
  const { dark, colors } = AG.theme;
  $('#theme-mode').textContent = dark ? 'dark' : 'light';
  $('#swatches').replaceChildren(...Object.entries(colors).map(([name, hex]) => h('div', { class: 'swatch' },
    h('div', { class: 'swatch-color', style: `background:${hex}` }),
    h('div', { class: 'swatch-name' }, name),
    h('div', { class: 'swatch-hex' }, hex))));
}
AG.on('theme', () => { if (currentTab === 'system') renderTheme(); });

$('#log-log').addEventListener('click', () => console.log('Hello from console.log', { tab: currentTab, at: new Date() }));
$('#log-warn').addEventListener('click', () => console.warn('This is a warning'));
$('#log-error').addEventListener('click', () => console.error('This is an error', new Error('demo')));
$('#log-throw').addEventListener('click', () => setTimeout(() => { throw new Error('Demo uncaught error'); }));
$('#log-reject').addEventListener('click', () => { Promise.reject(new Error('Demo unhandled rejection')); });
$('#open-console').addEventListener('click', () => AG.dev.console());
$('#open-devtools').addEventListener('click', () => AG.dev.devtools());

action('mcp-list', async () => {
  const tools = await AG.mcp.list('notes_mcp');
  return `${tools.length} tools\n${tools.map(t => `• ${t.name}`).join('\n')}`;
}, 'mcp-out');

$('#app-reload').addEventListener('click', () => AG.reload());
$('#app-close').addEventListener('click', () => AG.nav.close());

/* =========================== Start =========================== */

AG.on('storage', () => renderCounter());
AG.on('resume', () => renderCounter());

renderCounter();
renderTodos();
show('app-info', { app: AG.app, page: AG.page, origin: location.origin });
const profile = AG.storage.get('profile', null);
if (profile) $('#kv-name').value = profile.name;
AG.fs.exists('data/notes.txt')
  .then(exists => exists && AG.fs.read('data/notes.txt'))
  .then(text => { if (typeof text === 'string') $('#notes-text').value = text; })
  .catch(e => console.warn('Could not load notes', e));

/* =========================== Threads =========================== */

// Self-contained: it is copied to each thread as source, so it can't use outside variables.
const countPrimes = ([from, to]) => {
  let n = 0;
  for (let i = Math.max(2, from); i < to; i++) {
    let prime = true;
    for (let j = 2; j * j <= i; j++) if (i % j === 0) { prime = false; break; }
    if (prime) n++;
  }
  return n;
};

action('thread-bench', async () => {
  const N = 4_000_000, parts = AG.thread.cores * 2, step = Math.ceil(N / parts);
  show('thread-out', 'Counting primes below 4,000,000 on one thread…');
  let t = performance.now();
  const one = await AG.thread.run(countPrimes, [[0, N]]);
  const oneMs = Math.round(performance.now() - t);
  show('thread-out', `One thread: ${oneMs} ms. Now on ${AG.thread.cores} cores…`);
  t = performance.now();
  const counts = await AG.thread.map(Array.from({ length: parts }, (_, i) => [i * step, Math.min(N, (i + 1) * step)]), countPrimes);
  const allMs = Math.round(performance.now() - t);
  AG.device.haptic('success');
  return `${one.toLocaleString()} primes\n1 thread:   ${oneMs} ms\nAll cores:  ${allMs} ms  (${(oneMs / allMs).toFixed(1)}× faster)\nSame answer: ${counts.reduce((a, b) => a + b, 0) === one}`;
}, 'thread-out');

/* =========================== Notifications =========================== */

const ntLog = [];
const ntShow = line => { ntLog.unshift(`${new Date().toLocaleTimeString()}  ${line}`); show('nt-out', ntLog.slice(0, 8).join('\n'), 'ok'); };
AG.on('notification', e => ntShow(`event: ${e.id} → ${e.action}${e.reply ? ` "${e.reply}"` : ''}${e.queued ? ' (while closed)' : ''}`));

let channels = null;
const ensureChannels = () => channels = channels || Promise.all([
  AG.notify.channel({ id: 'live', name: 'Live updates', importance: 'low', sound: false }),
  AG.notify.channel({ id: 'messages', name: 'Messages', importance: 'high', vibrate: [0, 120, 80, 120], lights: '#6750A4' }),
]);

action('nt-countdown', async () => {
  await ensureChannels();
  await AG.notify.show({
    id: 'count', ongoing: true, color: '#C62828', title: 'Tea is brewing 🍵', body: 'Ready in 3 minutes',
    countdown: Date.now() + 3 * 60_000,
    actions: [{ id: 'plus', title: '+1 min', open: false }, { id: 'done', title: 'Done', open: false }],
  });
  return 'Pull down the notification shade: the countdown ticks by itself.';
}, 'nt-out');

action('nt-progress', async () => {
  await ensureChannels();
  for (let v = 0; v <= 100; v += 10) {
    await AG.notify.show({ id: 'dl', channel: 'live', ongoing: v < 100, color: '#1565C0', title: v < 100 ? 'Downloading map…' : 'Map downloaded',
      body: `${v}%`, progress: v < 100 ? { value: v, max: 100 } : undefined, actions: v < 100 ? [{ id: 'cancel', title: 'Cancel', open: false }] : [] });
    await new Promise(r => setTimeout(r, 400));
  }
  return 'Progress went 0 → 100%';
}, 'nt-out');

action('nt-chat', async () => {
  await ensureChannels();
  await AG.notify.show({
    id: 'chat', channel: 'messages', color: '#6750A4', title: 'Team chat', category: 'msg',
    messages: [{ from: 'Asha', text: 'Lunch at 1?' }, { from: 'Ravi', text: 'I’m in 🍜' }],
    actions: [{ id: 'reply', title: 'Reply', reply: { placeholder: 'Message' } }, { id: 'read', title: 'Mark read', open: false }],
  });
  return 'Reply from the notification: the text comes back as an event.';
}, 'nt-out');

action('nt-inbox', async () => {
  await AG.notify.show({ id: 'inbox', color: '#2E7D32', title: '3 new orders', body: 'Today', lines: ['#1042 · 2× coffee', '#1043 · bagel', '#1044 · 3× tea'], number: 3 });
  return 'Inbox style with a badge count';
}, 'nt-out');

action('nt-picture', async () => {
  await AG.notify.show({ id: 'pic', title: 'Photo of the day', body: 'From picsum.photos', image: 'https://picsum.photos/600/300', color: '#6750A4' });
  return 'Big picture (loaded natively, needs the network host)';
}, 'nt-out');

action('nt-stopwatch', async () => {
  await ensureChannels();
  await AG.notify.show({ id: 'run', ongoing: true, color: '#00695C', title: 'Run in progress 🏃', body: '5 km goal', chronometer: Date.now(),
    actions: [{ id: 'stop', title: 'Stop', open: false }] });
  return 'The stopwatch counts up by itself';
}, 'nt-out');

action('nt-active', async () => (await AG.notify.active()).map(n => `${n.id}: ${n.title}${n.ongoing ? ' (ongoing)' : ''}`).join('\n') || 'None', 'nt-out');
action('nt-clear', async () => { await AG.notify.dismiss(); return 'Cleared'; }, 'nt-out');

// what the buttons do while the app is open
AG.on('notification', async e => {
  if (e.id === 'count' && e.action === 'plus') {
    await AG.notify.show({ id: 'count', ongoing: true, color: '#C62828', title: 'Tea is brewing 🍵', body: 'One more minute', countdown: Date.now() + 60_000,
      actions: [{ id: 'plus', title: '+1 min', open: false }, { id: 'done', title: 'Done', open: false }] });
  }
  if (['done', 'stop', 'cancel', 'read'].includes(e.action)) AG.notify.dismiss(e.id);
});

/* =========================== Background & reminders =========================== */

const when = (ms) => new Date(ms).toLocaleString();

action('bg-register', async () => {
  // background is a runtime permission: ask first (shows the native prompt once)
  if (await AG.permissions.request('background') !== 'granted') throw new Error('Background permission denied');
  const r = await AG.background.register('check', { every: '15m', network: 'any' });
  return `Registered "${r.name}" ${r.schedule}. Next run around ${when(r.next)}.\nClose the app: you'll get a notification each time it runs.`;
}, 'bg-out');

action('bg-run', async () => {
  if (await AG.permissions.request('background') !== 'granted') throw new Error('Background permission denied');
  await AG.background.run('check');
  return 'Started. Watch for the notification, then tap "Tasks & runs".';
}, 'bg-out');

action('bg-list', async () => {
  const tasks = await AG.background.list();
  const runs = await AG.fs.readJSON('data/bg-runs.json').catch(() => []);
  return [
    tasks.length ? tasks.map(t => `${t.name}: ${t.schedule}, next ≈ ${when(t.next)}` +
      (t.lastRun ? `\n  last: ${when(t.lastRun.at)} ${t.lastRun.status} ${t.lastRun.ms} ms ${t.lastRun.detail || ''}` : '\n  not run yet')).join('\n') : 'No tasks registered',
    '',
    `Runs written by background.js: ${runs.length}`,
    ...runs.slice(-5).map(r => `  ${when(r.at)} (${r.reason}) ${r.uuid.slice(0, 8)}`),
  ].join('\n');
}, 'bg-out');

action('bg-cancel', async () => { await AG.background.cancel('check'); return 'Task cancelled'; }, 'bg-out');

action('rem-add', async () => {
  const r = await AG.notify.schedule({
    id: 'demo', title: 'Showcase reminder', body: 'Scheduled natively. Survives restarts and reboots.',
    delay: 60_000, repeat: { every: '15m', count: 4 },
  });
  return `Reminder "${r.id}" ${r.repeat}, first at ${when(r.at)}`;
}, 'bg-out');

action('rem-list', async () => {
  const list = await AG.notify.list();
  return list.length ? list.map(r => `${r.id}: "${r.title}" ${r.repeat}, next ${when(r.at)}`).join('\n') : 'No reminders';
}, 'bg-out');

action('rem-cancel', async () => { await AG.notify.cancelAll(); return 'All reminders cancelled'; }, 'bg-out');

/* =========================== Cookies =========================== */

const HTTPBIN = 'https://httpbin.org';

action('ck-server', async () => {
  // the server answers with Set-Cookie and a redirect; the native jar stores it on the way
  const r = await fetch(`${HTTPBIN}/cookies/set?session=from-server-${Date.now() % 10000}`);
  return `The server set a cookie. It now sees: ${JSON.stringify((await r.json()).cookies)}`;
}, 'ck-out');

action('ck-echo', async () => {
  const r = await fetch(`${HTTPBIN}/cookies`);
  return `Cookies the server received: ${JSON.stringify((await r.json()).cookies)}`;
}, 'ck-out');

action('ck-import', async () => {
  const header = await AG.ui.prompt({ title: 'Paste a cookie', message: 'Like a "Cookie:" header from a browser', value: 'token=abc123; theme=dark' });
  if (!header) return undefined;
  const n = await AG.cookies.import(`${HTTPBIN}/`, header);
  return `Saved ${n} cookie${n === 1 ? '' : 's'} for httpbin.org. Tap "What the server receives".`;
}, 'ck-out');

action('ck-list', async () => {
  const list = await AG.cookies.list(`${HTTPBIN}/`);
  return list.length ? list.map(c => `${c.name}=${c.value}  (${c.session ? 'session' : 'until ' + when(c.expires)})`).join('\n') : 'Jar is empty';
}, 'ck-out');

action('ck-clear', async () => `Removed ${await AG.cookies.clear(`${HTTPBIN}/`)} cookies`, 'ck-out');

const savedTab = sessionStorage.getItem('tab');
if (savedTab && savedTab !== 'storage') showTab(savedTab, { haptic: false });
