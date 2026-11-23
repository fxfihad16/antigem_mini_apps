// Pocket Notes: the editor page (opened with Hina.nav.push('editor.html', {id})).
const AG = window.Hina;
const $ = s => document.querySelector(s);
const text = $('#text');
let note = { text: '', images: [] };
let dirty = false;
let saveTimer = null;

function setStatus(s) { $('#status').textContent = s; }

function renderMeta() {
  const parts = [];
  if (note.created) parts.push('Created ' + new Date(note.created).toLocaleString());
  if (note.reminder && note.reminder > Date.now()) parts.push('⏰ ' + new Date(note.reminder).toLocaleString());
  $('#meta').textContent = parts.join(' · ');
}

function renderImages() {
  const box = $('#images');
  box.replaceChildren();
  (note.images || []).forEach((path, i) => {
    const fig = document.createElement('figure');
    fig.innerHTML = `<img src="${AG.fs.url(path)}" alt=""><button aria-label="Remove">✕</button>`;
    fig.querySelector('button').onclick = async () => {
      if (!(await AG.ui.confirm({ title: 'Remove image?', ok: 'Remove', destructive: true }))) return;
      note.images.splice(i, 1);
      AG.fs.delete(path).catch(() => {});
      changed();
      renderImages();
    };
    box.append(fig);
  });
}

async function save() {
  clearTimeout(saveTimer);
  if (!dirty) return;
  // an empty new note isn't kept
  if (!note.id && !text.value.trim() && !(note.images || []).length) { dirty = false; return; }
  note.text = text.value;
  await Notes.put(note);
  dirty = false;
  setStatus('Saved');
  renderMeta();
}

/** Autosave a moment after typing stops. */
function changed() {
  dirty = true;
  setStatus('Editing…');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => save().catch(e => { setStatus('Not saved'); AG.ui.toast(e.message); }), 700);
}

function insert(prefix, wrap) {
  const { selectionStart: a, selectionEnd: b, value } = text;
  if (wrap) {
    text.value = value.slice(0, a) + wrap + value.slice(a, b) + wrap + value.slice(b);
    text.setSelectionRange(a + wrap.length, b + wrap.length);
  } else {
    const lineStart = value.lastIndexOf('\n', a - 1) + 1;
    text.value = value.slice(0, lineStart) + prefix + value.slice(lineStart);
    text.setSelectionRange(a + prefix.length, b + prefix.length);
  }
  text.focus();
  AG.device.haptic('selection');
  changed();
}

async function setReminder() {
  const now = new Date();
  const date = await AG.ui.pickDate({ title: 'Remind me on', value: now.toISOString().slice(0, 10) });
  if (!date) return;
  const time = await AG.ui.pickTime({ value: `${String(now.getHours() + 1 > 23 ? 9 : now.getHours() + 1).padStart(2, '0')}:00` });
  if (!time) return;
  const at = new Date(`${date}T${time}`);
  if (at <= new Date()) { AG.ui.toast('Pick a time in the future'); return; }
  if ((await AG.permissions.request('notifications')) !== 'granted') { AG.ui.toast('Notifications are off for Pocket Notes'); return; }
  note.text = text.value;
  dirty = true;
  await save();
  if (!note.id) { AG.ui.toast('Write something first'); return; }
  await AG.notify.schedule({ id: 'note-' + note.id, title: '📝 ' + titleOf(note), body: note.text.split('\n').slice(1).join(' ').slice(0, 200) || 'Reminder', at });
  note.reminder = at.getTime();
  await Notes.put(note);
  renderMeta();
  AG.device.haptic('success');
  AG.ui.toast('Reminder set for ' + at.toLocaleString());
}

async function more() {
  const has = note.reminder && note.reminder > Date.now();
  const pick = await AG.ui.sheet({
    title: titleOf({ text: text.value }),
    items: [
      { id: 'remind', label: has ? 'Change reminder' : 'Remind me…', icon: '⏰' },
      ...(has ? [{ id: 'unremind', label: 'Cancel reminder', icon: '🔕' }] : []),
      { id: 'pin', label: note.pinned ? 'Unpin' : 'Pin to top', icon: '📌' },
      { id: 'share', label: 'Share', icon: '📤' },
      { id: 'copy', label: 'Copy all', icon: '📋' },
      { id: 'delete', label: 'Delete note', icon: '🗑', destructive: true },
    ],
  });
  if (pick === 'remind') return setReminder();
  if (pick === 'unremind') { await AG.notify.cancel('note-' + note.id); note.reminder = 0; await Notes.put(note); renderMeta(); AG.ui.toast('Reminder cancelled'); }
  if (pick === 'pin') { note.pinned = !note.pinned; dirty = true; await save(); AG.ui.toast(note.pinned ? 'Pinned' : 'Unpinned'); }
  if (pick === 'share') await AG.device.share({ title: titleOf({ text: text.value }), text: text.value });
  if (pick === 'copy') { await AG.device.copy(text.value); AG.ui.toast('Copied'); }
  if (pick === 'delete') {
    if (!(await AG.ui.confirm({ title: 'Delete note?', ok: 'Delete', destructive: true }))) return;
    if (note.id) { await Notes.remove(note.id); AG.notify.cancel('note-' + note.id).catch(() => {}); }
    dirty = false;
    AG.nav.back();
  }
}

async function addImage() {
  const files = await AG.fs.pick({ accept: 'image/*', multiple: true });
  if (!files || !files.length) return;
  note.images = (note.images || []).concat(files.map(f => f.path));
  renderImages();
  changed();
  AG.ui.toast(`${files.length} image${files.length === 1 ? '' : 's'} added`);
}

async function paste() {
  try {
    const clip = await AG.device.paste();
    if (!clip) { AG.ui.toast('Clipboard is empty'); return; }
    const { selectionStart: a, selectionEnd: b, value } = text;
    text.value = value.slice(0, a) + clip + value.slice(b);
    changed();
  } catch (e) {
    if ((await AG.permissions.request('clipboard')) === 'granted') paste();
    else AG.ui.toast('Clipboard access is off');
  }
}

async function leave() {
  if (dirty) {
    try { await save(); } catch (e) {
      // couldn't save: ask before throwing the changes away
      if (!(await AG.ui.confirm({ title: 'Discard changes?', message: 'This note could not be saved: ' + e.message, ok: 'Discard', destructive: true }))) return;
    }
  }
  AG.nav.back();
}

/* ---------- wiring ---------- */

text.addEventListener('input', changed);
document.querySelectorAll('[data-ins]').forEach(b => b.addEventListener('click', () => insert(b.dataset.ins)));
document.querySelectorAll('[data-wrap]').forEach(b => b.addEventListener('click', () => insert('', b.dataset.wrap)));
$('#img').addEventListener('click', () => addImage().catch(e => AG.ui.toast(e.message)));
$('#paste').addEventListener('click', paste);
$('#more').addEventListener('click', () => more().catch(e => AG.ui.toast(e.message)));
$('#back').addEventListener('click', leave);
$('#mode').addEventListener('click', () => {
  const previewing = $('#preview').hidden;
  if (previewing) $('#preview').innerHTML = renderMd(text.value || '*Nothing yet*');
  $('#preview').hidden = !previewing;
  text.hidden = previewing;
  $('#mode').textContent = previewing ? '✏️' : '👁';
  AG.device.haptic('selection');
});
// system back: save first; if saving fails, ask whether to discard
AG.onBack(() => {
  if (!dirty) return false;
  leave();
  return true;
});
AG.on('pause', () => save().catch(() => {}));

(async () => {
  const id = AG.page.params.id;
  if (id) {
    const found = await Notes.get(id);
    if (found) note = found;
  }
  note.images = note.images || [];
  text.value = note.text || '';
  renderMeta();
  renderImages();
  if (!id) text.focus();
})().catch(e => AG.ui.toast('Could not open the note: ' + e.message));
