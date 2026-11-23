let current = 'photos';
let loadedAt = 0;
let list = [];

function showTab(name) {
  current = name;
  document.querySelectorAll('.tab').forEach(t => { t.hidden = t.dataset.tab !== name; });
  document.querySelectorAll('.ag-navbar-item').forEach(b => b.classList.toggle('is-active', b.dataset.tab === name));
  $('#title').textContent = { photos: 'Photos', folders: 'Folders', stats: 'Stats' }[name];
  $('#camera').hidden = name !== 'photos';
  if (name === 'folders') renderFolders();
  AG.device.haptic('selection');
}
document.querySelectorAll('.ag-navbar-item').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));
AG.onBack(() => { if (current !== 'photos') { showTab('photos'); return true; } return false; });

async function loadPhotos() {
  const state = AG.permissions.query('storage');
  const folders = await mediaFolders();
  $('#denied').hidden = folders.length > 0;
  if (!folders.length) { $('#photos').replaceChildren(); $('#empty').hidden = true; return; }
  $('#crumb').textContent = folders.map(f => f.path.replace('/storage/emulated/0', '/sdcard')).join(' · ');
  const box = $('#photos');
  box.replaceChildren(h('div', { class: 'ag-row', style: 'justify-content:center;padding:24px' }, h('span', { class: 'ag-spinner' })));
  list = [];
  const groups = [];
  for (const f of folders) {
    const items = await scanFolder(f.path);
    if (items.length) groups.push({ folder: f, items });
    list.push(...items);
  }
  sessionStorage.setItem('gallery.list', JSON.stringify(list.map(e => e.path)));
  box.replaceChildren(...groups.map(g => [
    h('div', { class: 'folder-head' }, h('h3', {}, g.folder.path.split('/').pop()), h('span', { class: 'ag-badge ag-badge-neutral' }, String(g.items.length))),
    h('div', { class: 'grid' }, g.items.slice(0, 300).map((e, i) => cell(e, g.items, i))),
  ]).flat());
  loadedAt = Date.now();
  $('#empty').hidden = list.length > 0;
  void state;
}

// Thumbnails are made natively (photos, HEIC and video frames alike) and cached: the grid stays light.
// Tap: the native viewer (swipe through the folder, zoom, videos play). Long-press: details (info, save, delete).
function cell(e, items, index) {
  const img = h('img', { src: AG.fs.url(e.path, { thumb: 320 }), loading: 'lazy', decoding: 'async', alt: e.name });
  const btn = h('button', { class: 'cell', onclick: () => openViewer(items, index) },
    img, isVideo(e.name) ? h('span', { class: 'badge' }, '▶') : null);
  btn.addEventListener('contextmenu', ev => { ev.preventDefault(); AG.device.haptic('medium'); AG.nav.push('viewer.html', { path: e.path }); });
  return btn;
}

async function openViewer(items, index) {
  AG.device.haptic('light');
  const { index: last } = await AG.ui.viewMedia({ items: items.map(x => ({ src: x.path, title: x.name, type: isVideo(x.name) ? 'video' : 'image' })), index });
  // bring the photo the user ended on into view
  const cells = document.querySelectorAll('.grid')[0] && [...document.querySelectorAll('.cell')];
  const target = cells && cells.find(c => c.querySelector('img')?.alt === items[last]?.name);
  if (target) target.scrollIntoView({ block: 'nearest' });
}

async function renderFolders() {
  const ul = $('#folder-list');
  const all = await AG.fs.folders();
  ul.replaceChildren(...all.filter(f => f.source !== 'own').map(f => h('li', { class: 'ag-item' },
    h('span', { class: 'ag-item-lead' }, f.source === 'picked' ? '📌' : '📁'),
    h('span', { class: 'ag-item-body' },
      h('span', { class: 'ag-item-title' }, f.path.replace('/storage/emulated/0', '/sdcard')),
      h('span', { class: 'ag-item-sub' }, `${f.access} · ${f.source}`)),
    f.source === 'picked' ? h('button', { class: 'ag-btn ag-btn-text ag-btn-sm', onclick: async () => { await AG.fs.forgetFolder(f.path); renderFolders(); loadPhotos(); } }, 'Remove') : null)));
  if (!ul.children.length) ul.append(h('li', { class: 'ag-item ag-muted' }, 'No folders yet. Grant access or add one.'));
}

$('#pick').addEventListener('click', async () => {
  try {
    const p = await AG.fs.pickFolder();
    if (p) { AG.ui.toast('Added ' + p.path.split('/').pop()); renderFolders(); loadPhotos(); }
  } catch (e) { AG.ui.toast(e.message); }
});

$('#grant').addEventListener('click', async () => {
  const s = await AG.permissions.request('storage');
  if (s !== 'granted') AG.ui.toast('Still no access. Change it in App info.');
  loadPhotos();
});
$('#refresh').addEventListener('click', () => { AG.device.haptic('light'); loadPhotos(); });

// Camera: native capture, saved into Pictures/AgentHina
$('#camera').addEventListener('click', async () => {
  if (await AG.permissions.request('camera') !== 'granted') { AG.ui.toast('Camera permission denied'); return; }
  $('#camera-input').click();
});
$('#camera-input').addEventListener('change', async (ev) => {
  const file = ev.target.files && ev.target.files[0];
  ev.target.value = '';
  if (!file) return;
  if (!(await canWrite('/sdcard/Pictures/x'))) { AG.ui.toast('Allow the Pictures folder to save photos'); return; }
  const name = `IMG_${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}.jpg`;
  await AG.fs.mkdir('/sdcard/Pictures/AgentHina');
  await AG.fs.write('/sdcard/Pictures/AgentHina/' + name, file);
  AG.device.haptic('success');
  AG.ui.toast('Saved to Pictures/AgentHina');
  loadPhotos();
});

// Stats: one thread per folder, each listing its own folder through the native fs
$('#stats-run').addEventListener('click', runStats);
async function runStats() {
  const body = $('#stats-body');
  body.replaceChildren(h('span', { class: 'ag-spinner' }));
  const folders = await mediaFolders();
  const t = performance.now();
  const parts = await AG.thread.map(folders.map(f => f.path), async (path) => {
    const IMG = /\.(jpe?g|png|gif|webp|heic|heif|avif|bmp)$/i, VID = /\.(mp4|webm|mov|m4v|3gp|mkv)$/i;
    const r = { images: 0, videos: 0, other: 0, bytes: 0, files: 0 };
    async function walk(p, depth) {
      let entries;
      try { entries = await Hina.fs.list(p); } catch (e) { return; }
      for (const e of entries) {
        if (e.type === 'dir') { if (depth < 2 && !e.name.startsWith('.')) await walk(e.path, depth + 1); continue; }
        if (e.type !== 'file') continue;
        r.files++; r.bytes += e.size;
        if (IMG.test(e.name)) r.images++; else if (VID.test(e.name)) r.videos++; else r.other++;
      }
    }
    await walk(path, 0);
    return r;
  });
  const sum = parts.reduce((a, b) => ({ images: a.images + b.images, videos: a.videos + b.videos, other: a.other + b.other, bytes: a.bytes + b.bytes, files: a.files + b.files }), { images: 0, videos: 0, other: 0, bytes: 0, files: 0 });
  const max = Math.max(1, sum.images, sum.videos, sum.other);
  const row = (label, n) => h('div', { class: 'bar-row' }, h('span', {}, label), h('div', { class: 'bar', style: `width:${Math.max(2, 70 * n / max)}%` }), h('span', {}, String(n)));
  body.replaceChildren(
    h('div', { class: 'stat-big' }, fmtSize(sum.bytes)),
    h('p', { class: 'ag-muted' }, `${sum.files} files in ${folders.length} folders · ${Math.round(performance.now() - t)} ms on ${AG.thread.cores} cores`),
    row('Photos', sum.images), row('Videos', sum.videos), row('Other', sum.other),
    h('button', { class: 'ag-btn ag-btn-tonal', onclick: runStats, style: 'margin-top:12px' }, 'Count again'));
}

// Coming back (from the viewer, another page or another app) keeps the grid and its scroll position; only a long
// absence re-scans the folders.
AG.on('resume', () => { if (current === 'photos' && Date.now() - loadedAt > 5 * 60_000) loadPhotos(); });
AG.on('permission', () => loadPhotos());
loadPhotos();
