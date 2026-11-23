// Pocket Notes: the list page.
const AG = window.Hina;
const $ = s => document.querySelector(s);
let notes = [];
let filter = 'all';
let lastQuery = '';

function fmtWhen(ms) {
  const d = new Date(ms), now = new Date();
  return d.toDateString() === now.toDateString()
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString([], { day: 'numeric', month: 'short' });
}

function highlight(text, q) {
  const safe = escapeHtml(text);
  if (!q) return safe;
  return safe.replace(new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), m => `<mark>${m}</mark>`);
}

function visible() {
  return notes.filter(n => {
    if (filter === 'archived') return n.archived;
    if (n.archived) return false;
    if (filter === 'pinned') return n.pinned;
    if (filter === 'reminders') return n.reminder && n.reminder > Date.now();
    return true;
  });
}

/** Search on another CPU core: the UI stays smooth even with thousands of notes. */
async function search(list, q) {
  if (!q) return list;
  const ids = await AG.thread.run((items, query) => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return items
      .map(n => {
        const t = n.text.toLowerCase();
        if (!words.every(w => t.includes(w))) return null;
        const title = t.split('\n')[0];
        return { id: n.id, score: words.reduce((s, w) => s + (title.includes(w) ? 10 : 1), 0) };
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score)
      .map(x => x.id);
  }, [list.map(n => ({ id: n.id, text: n.text || '' })), q]);
  const byId = new Map(list.map(n => [n.id, n]));
  return ids.map(id => byId.get(id));
}

async function render() {
  const q = $('#q').value.trim();
  lastQuery = q;
  let list = visible();
  list.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.updated - a.updated);
  list = await search(list, q);
  if (q !== lastQuery) return; // a newer search is running
  const el = $('#list');
  el.replaceChildren();
  for (const n of list) {
    const card = document.createElement('div');
    card.className = 'note ag-enter' + (n.pinned ? ' pinned' : '');
    const body = (n.text || '').split('\n').slice(1).join('\n').trim();
    const tags = (n.pinned ? '📌' : '') + (n.reminder > Date.now() ? '⏰' : '');
    card.innerHTML =
      (n.images && n.images[0] ? `<img class="thumb" src="${AG.fs.url(n.images[0])}" alt="">` : '') +
      `<span class="tags">${tags}</span><h3>${highlight(titleOf(n), q)}</h3>` +
      `<div class="body">${highlight(body.slice(0, 400), q)}</div><div class="when">${fmtWhen(n.updated)}</div>`;
    attachPress(card, () => open(n.id), () => noteMenu(n));
    el.append(card);
  }
  const active = notes.filter(n => !n.archived).length;
  $('#count').textContent = `${active} note${active === 1 ? '' : 's'}`;
  $('#empty').hidden = list.length > 0;
  $('#empty-title').textContent = q ? 'Nothing found' : filter === 'all' ? 'No notes yet' : 'Nothing here';
  $('#empty-sub').hidden = !!q || filter !== 'all';
}

/** Tap opens, long-press (500 ms) shows the note's native action sheet. */
function attachPress(el, onTap, onLong) {
  let timer = null, long = false, moved = false, sx = 0, sy = 0;
  el.addEventListener('pointerdown', e => {
    long = false; moved = false; sx = e.clientX; sy = e.clientY;
    timer = setTimeout(() => { long = true; AG.device.haptic('heavy'); onLong(); }, 500);
  });
  el.addEventListener('pointermove', e => { if (Math.abs(e.clientX - sx) + Math.abs(e.clientY - sy) > 10) { moved = true; clearTimeout(timer); } });
  el.addEventListener('pointerup', () => { clearTimeout(timer); if (!long && !moved) onTap(); });
  el.addEventListener('pointercancel', () => clearTimeout(timer));
  el.addEventListener('contextmenu', e => e.preventDefault());
}

async function load() {
  notes = await Notes.all();
  await render();
}

function open(id) { AG.device.haptic('light'); AG.nav.push('editor.html', id ? { id } : {}); }

async function noteMenu(n) {
  const pick = await AG.ui.sheet({
    title: titleOf(n),
    items: [
      { id: 'pin', label: n.pinned ? 'Unpin' : 'Pin to top', icon: '📌' },
      { id: 'archive', label: n.archived ? 'Unarchive' : 'Archive', icon: '🗄' },
      { id: 'share', label: 'Share', icon: '📤' },
      { id: 'copy', label: 'Copy text', icon: '📋' },
      { id: 'delete', label: 'Delete', icon: '🗑', destructive: true },
    ],
  });
  if (!pick) return;
  if (pick === 'pin') { n.pinned = !n.pinned; await Notes.put(n); AG.ui.toast(n.pinned ? 'Pinned' : 'Unpinned'); }
  if (pick === 'archive') { n.archived = !n.archived; n.pinned = false; await Notes.put(n); AG.ui.toast(n.archived ? 'Archived' : 'Back in your notes'); }
  if (pick === 'share') await AG.device.share({ title: titleOf(n), text: n.text });
  if (pick === 'copy') { await AG.device.copy(n.text); AG.ui.toast('Copied'); }
  if (pick === 'delete') {
    if (!(await AG.ui.confirm({ title: 'Delete note?', message: `“${titleOf(n)}” will be gone for good.`, ok: 'Delete', destructive: true }))) return;
    await Notes.remove(n.id);
    if (n.reminder) AG.notify.cancel('note-' + n.id).catch(() => {});
    AG.device.haptic('success');
  }
  await load();
}

/* ---------- export / import (the declared folder /sdcard/Documents/PocketNotes) ---------- */

function slug(s) { return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'note'; }

async function ensureFolder() {
  const state = await AG.permissions.request('storage');
  if (state !== 'granted') throw new Error('Allow the Documents/PocketNotes folder to export or import');
}

async function exportAll() {
  await ensureFolder();
  const stamp = new Date().toISOString().slice(0, 10);
  await AG.fs.writeJSON(`${EXPORT_DIR}/pocket-notes-${stamp}.json`, notes);
  for (const n of notes) await AG.fs.write(`${EXPORT_DIR}/md/${n.id}-${slug(titleOf(n))}.md`, n.text || '');
  AG.device.haptic('success');
  await AG.ui.alert({ title: 'Exported', message: `${notes.length} notes saved to Documents/PocketNotes (one JSON backup + a Markdown file each).` });
}

async function importFrom() {
  await ensureFolder();
  const files = [];
  for (const dir of [EXPORT_DIR, `${EXPORT_DIR}/md`]) {
    try { files.push(...(await AG.fs.list(dir)).filter(f => f.type === 'file' && /\.(json|md|txt)$/i.test(f.name))); } catch (e) { /* folder not there yet */ }
  }
  if (!files.length) { await AG.ui.alert({ title: 'Nothing to import', message: 'Put .json, .md or .txt files in Documents/PocketNotes.' }); return; }
  const pick = await AG.ui.sheet({ title: 'Import a file', items: files.slice(0, 40).map(f => ({ id: f.path, label: f.name, icon: f.name.endsWith('.json') ? '🗂' : '📄' })) });
  if (!pick) return;
  let added = 0;
  if (pick.endsWith('.json')) {
    const data = await AG.fs.readJSON(pick);
    const have = new Set(notes.map(n => n.text));
    for (const n of Array.isArray(data) ? data : []) {
      if (!n || typeof n.text !== 'string' || have.has(n.text)) continue;
      await Notes.put({ text: n.text, pinned: !!n.pinned, archived: !!n.archived, created: n.created });
      added++;
    }
  } else {
    await Notes.put({ text: await AG.fs.read(pick) });
    added = 1;
  }
  AG.ui.toast(`Imported ${added} note${added === 1 ? '' : 's'}`);
  await load();
}

async function menu() {
  const pick = await AG.ui.sheet({
    title: 'Pocket Notes',
    items: [
      { id: 'export', label: 'Export all to Documents', icon: '💾' },
      { id: 'import', label: 'Import from Documents', icon: '📥' },
      { id: 'reminders', label: 'Scheduled reminders', icon: '⏰' },
    ],
  });
  try {
    if (pick === 'export') await exportAll();
    if (pick === 'import') await importFrom();
    if (pick === 'reminders') {
      const list = await AG.notify.list();
      await AG.ui.alert({ title: 'Reminders', message: list.length ? list.map(r => `${r.title}: ${new Date(r.at).toLocaleString()}`).join('\n') : 'No reminders scheduled.' });
    }
  } catch (e) {
    AG.ui.toast(e.message, { long: true });
  }
}

/* ---------- wiring ---------- */

let typing;
$('#q').addEventListener('input', () => { clearTimeout(typing); typing = setTimeout(render, 120); });
$('#filters').addEventListener('click', e => {
  const chip = e.target.closest('.ag-chip');
  if (!chip) return;
  document.querySelectorAll('#filters .ag-chip').forEach(c => c.classList.toggle('is-selected', c === chip));
  filter = chip.dataset.f;
  AG.device.haptic('selection');
  render();
});
$('#new').addEventListener('click', () => open(null));
$('#menu').addEventListener('click', menu);
AG.onBack(() => {
  if ($('#q').value) { $('#q').value = ''; render(); return true; }
  if (filter !== 'all') { $('#filters .ag-chip').click(); return true; }
  return false;
});
// back from the editor (or another app) → fresh list
AG.on('resume', load);
load().catch(e => { console.error(e); AG.ui.toast('Could not load notes: ' + e.message); });


/* ---------- things shared to Pocket Notes (other mini apps, or Android's share sheet → Mini app) ---------- */
AG.on('intent', async (it) => {
  if (it.action !== 'share') return;
  const note = { text: [it.title, it.text, it.url].filter(Boolean).join('\n\n') || 'Shared', images: [], pinned: false, archived: false };
  if (it.path && /^image\//.test(it.type || '')) {
    // keep our own copy: the sender's file was only lent to us for a day
    const name = it.path.split('/').pop();
    const blob = await (await fetch(AG.fs.url(it.path))).blob();
    const own = `data/images/shared-${Date.now()}-${name}`;
    await AG.fs.write(own, blob);
    note.images.push(own);
    if (!it.text) note.text = `Image from ${it.from?.name || 'another app'}`;
  }
  const saved = await Notes.put(note);
  AG.device.haptic('success');
  AG.ui.toast(`Saved from ${it.from?.name || 'another app'}`);
  if (typeof render === 'function') render();
  open(saved.id);
});
