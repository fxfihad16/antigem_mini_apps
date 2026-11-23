// Agy Accounts: keeps copies of agy's login file and swaps them in to switch accounts.
//
// agy (Antigravity) keeps its Google login in ~/.gemini/jetski-standalone-oauth-token (on Termux there is no keyring,
// so this file is the only copy). agy notices when the file changes or disappears and loads the new login the next
// time Agent Hina asks for the sign-in status, so switching is: save the current file, write another saved one in its
// place, refresh Agent Hina. Signing in itself always happens in Agent Hina; this app only copies files.

const AG = window.Hina;
const $ = (sel) => document.querySelector(sel);

const LIVE = '~/.gemini/jetski-standalone-oauth-token';
const DIR = 'data/accounts';

function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') el.className = value;
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (value === true) el.setAttribute(key, '');
    else if (value != null && value !== false) el.setAttribute(key, value);
  }
  el.append(...children.flat().filter((c) => c != null && c !== false));
  return el;
}

/* ---------------- Token helpers ---------------- */

const emailOf = (t) => (t && typeof t.id_token_email === 'string' ? t.id_token_email.trim() : '');
// The refresh token is what really identifies a login (access tokens change every hour).
const keyOf = (t) => (t && t.token && (t.token.refresh_token || t.token.access_token)) || '';
const kindOf = (t) => {
  const m = (t && t.auth_method) || '';
  if (m === 'consumer') return 'Personal Google account';
  if (m) return `${m[0].toUpperCase()}${m.slice(1)} login`;
  return 'Google login';
};
// writer_id marks which agy process wrote the file; a restored copy must look like an outside change, so drop it.
function clean(t) {
  const copy = JSON.parse(JSON.stringify(t));
  delete copy.writer_id;
  return copy;
}
const fileFor = (name) => `${DIR}/${name.toLowerCase().replace(/[^a-z0-9@._-]+/g, '_') || 'account'}.json`;
const initial = (s) => (s.trim()[0] || '?').toUpperCase();
const when = (ms) => (ms ? new Date(ms).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');

/* ---------------- State ---------------- */

let live = { status: 'loading' };   // {status: 'ok', token, email} | {status: 'none'} | {status: 'error', error}
let saved = [];                     // [{name, email, savedAt, usedAt, token, file}]
let busy = false;

const isActive = (acc) => live.status === 'ok' && keyOf(acc.token) === keyOf(live.token);
const liveSaved = () => live.status === 'ok' && saved.some(isActive);
const liveName = () => (live.status === 'ok' ? live.email || 'this account' : '');

async function readLive() {
  try {
    if (!(await AG.fs.exists(LIVE))) return { status: 'none' };
    const text = await AG.fs.read(LIVE);
    if (!text.trim()) return { status: 'none' };
    const token = JSON.parse(text);
    if (!keyOf(token)) return { status: 'error', error: new Error('The login file has no token in it.') };
    return { status: 'ok', token, email: emailOf(token) };
  } catch (error) {
    return { status: 'error', error };
  }
}

async function readSaved() {
  let entries = [];
  try {
    entries = await AG.fs.list(DIR);
  } catch (e) {
    if (e.name !== 'NotFoundError') console.warn('list accounts:', e.message);
    return [];
  }
  const out = [];
  for (const f of entries) {
    if (f.type !== 'file' || !f.name.endsWith('.json')) continue;
    const file = `${DIR}/${f.name}`;   // keep data/ paths: the absolute path of the data folder is not allowed
    try {
      const acc = await AG.fs.readJSON(file);
      if (acc && acc.token && keyOf(acc.token)) out.push({ ...acc, file });
    } catch (e) {
      console.warn(`skip ${f.name}:`, e.message);
    }
  }
  return out.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

/* ---------------- Actions ---------------- */

async function saveLive({ quiet = false } = {}) {
  if (live.status !== 'ok') return false;
  let name = live.email;
  if (!name) {
    name = await AG.ui.prompt({ title: 'Name this account', message: 'This login has no email in it.', placeholder: 'e.g. Work' });
    if (!name || !name.trim()) return false;
    name = name.trim();
  }
  const prev = saved.find((a) => a.name === name);
  const file = prev ? prev.file : fileFor(name);
  await AG.fs.writeJSON(file, {
    name,
    email: live.email,
    savedAt: Date.now(),
    usedAt: (prev && prev.usedAt) || Date.now(),
    token: clean(live.token),
  });
  if (!quiet) {
    AG.device.haptic('success');
    AG.ui.toast(`Saved ${name}`);
  }
  return true;
}

// Before the current login is removed or replaced: make sure it is saved, or that the user really wants to lose it.
async function keepCurrent(action) {
  if (live.status !== 'ok' || liveSaved()) return true;
  const name = liveName();
  const choice = await AG.ui.sheet({
    title: `${name} isn't saved`,
    items: [
      { id: 'save', label: `Save ${name} first`, icon: '💾' },
      { id: 'drop', label: `${action} without saving`, icon: '⚠️', destructive: true },
    ],
  });
  if (choice === 'save') return saveLive();
  if (choice !== 'drop') return false;
  return AG.ui.confirm({
    title: `Lose ${name}?`,
    message: 'This login will be gone from this phone. To use it again you will have to sign in again in Agent Hina.',
    ok: action,
    destructive: true,
  });
}

async function removeLive() {
  try {
    await AG.fs.delete(LIVE);
  } catch (e) {
    if (e.name !== 'NotFoundError') throw e;
  }
}

async function addAccount() {
  if (live.status === 'ok') {
    if (!(await keepCurrent('Remove it'))) return;
    await removeLive();
    AG.device.haptic('medium');
  }
  await AG.ui.alert({
    title: 'Sign in with the other account',
    message: 'Open Agent Hina and refresh: it will show that you are signed out. Sign in there with the other Google '
      + 'account, then come back here and tap “Save this account”.',
    ok: 'Got it',
  });
}

async function signOut() {
  if (live.status !== 'ok') return;
  const name = liveName();
  if (liveSaved()) {
    const ok = await AG.ui.confirm({
      title: `Sign out of ${name}?`,
      message: 'agy will be signed out after Agent Hina refreshes. The saved copy stays here, so you can switch back to it any time.',
      ok: 'Sign out',
    });
    if (!ok) return;
  } else if (!(await keepCurrent('Sign out'))) return;
  await removeLive();
  AG.device.haptic('medium');
  AG.ui.toast('Signed out. Refresh Agent Hina.', { long: true });
}

async function switchTo(acc) {
  if (isActive(acc)) {
    AG.ui.toast(`${acc.name} is already signed in`);
    return;
  }
  const ok = await AG.ui.confirm({
    title: `Switch to ${acc.name}?`,
    message: 'agy will use this account after Agent Hina refreshes. A reply that is running right now may stop.',
    ok: 'Switch',
  });
  if (!ok || !(await keepCurrent('Switch'))) return;
  await AG.fs.write(LIVE, JSON.stringify(clean(acc.token)));
  await AG.fs.writeJSON(acc.file, { name: acc.name, email: acc.email, savedAt: acc.savedAt, usedAt: Date.now(), token: acc.token });
  AG.device.haptic('success');
  await AG.ui.alert({
    title: `Switched to ${acc.name}`,
    message: 'Now refresh in Agent Hina so agy picks up this account.',
    ok: 'OK',
  });
}

async function deleteSaved(acc) {
  const ok = await AG.ui.confirm({
    title: `Delete the saved copy of ${acc.name}?`,
    message: isActive(acc)
      ? 'It is signed in right now and stays signed in; only the saved copy here is deleted.'
      : 'You will have to sign in again in Agent Hina to use this account later.',
    ok: 'Delete',
    destructive: true,
  });
  if (!ok) return;
  await AG.fs.delete(acc.file);
  AG.ui.toast('Deleted');
}

async function accountMenu(acc) {
  const items = [];
  if (!isActive(acc)) items.push({ id: 'switch', label: 'Switch to this account', icon: '🔁' });
  items.push({ id: 'delete', label: 'Delete saved copy', icon: '🗑️', destructive: true });
  const choice = await AG.ui.sheet({ title: acc.name, items });
  if (choice === 'switch') await switchTo(acc);
  else if (choice === 'delete') await deleteSaved(acc);
}

// Runs an action, then re-reads everything. One at a time, so a double tap can't swap files twice.
async function run(action) {
  if (busy) return;
  busy = true;
  try {
    await action();
  } catch (e) {
    console.error(e);
    await AG.ui.alert({ title: 'That didn’t work', message: e.message || String(e) });
  } finally {
    busy = false;
    await refresh();
  }
}

/* ---------------- Rendering ---------------- */

function renderNotice() {
  const notice = $('#notice');
  const btn = $('#notice-btn');
  const perm = AG.permissions.query('storage');
  if (perm !== 'granted') {
    notice.hidden = false;
    $('#notice-title').textContent = 'Allow access to agy’s login';
    $('#notice-text').textContent = 'This app needs the folder ~/.gemini, where agy keeps its login file, to show and switch accounts.';
    btn.hidden = false;
    return;
  }
  btn.hidden = true;
  if (live.status === 'error') {
    const e = live.error || {};
    notice.hidden = false;
    $('#notice-title').textContent = e.name === 'NotAllowedError' ? 'Agent Hina blocked the login file' : 'Can’t read agy’s login file';
    $('#notice-text').textContent = e.message || String(e);
  } else {
    notice.hidden = true;
  }
}

function renderCurrent() {
  const actions = $('#cur-actions');
  const badge = $('#cur-badge');
  actions.replaceChildren();
  badge.hidden = true;

  if (live.status === 'ok') {
    const name = liveName();
    $('#cur-avatar').textContent = initial(live.email || name);
    $('#cur-email').textContent = live.email || 'Account without an email';
    $('#cur-kind').textContent = kindOf(live.token);
    badge.hidden = false;
    if (liveSaved()) {
      badge.className = 'ag-badge ag-badge-success';
      badge.textContent = 'Saved';
    } else {
      badge.className = 'ag-badge ag-badge-warning';
      badge.textContent = 'Not saved';
      actions.append(h('button', { class: 'ag-btn', onclick: () => run(() => saveLive()) }, 'Save this account'));
    }
    actions.append(h('button', { class: 'ag-btn ag-btn-text', onclick: () => run(signOut) }, 'Sign out'));
  } else if (live.status === 'none') {
    $('#cur-avatar').textContent = '–';
    $('#cur-email').textContent = 'Not signed in';
    $('#cur-kind').textContent = saved.length ? 'Sign in in Agent Hina, or switch to a saved account below.' : 'Sign in in Agent Hina, then come back here.';
  } else if (live.status === 'error') {
    $('#cur-avatar').textContent = '!';
    $('#cur-email').textContent = 'Unknown';
    $('#cur-kind').textContent = 'The login file couldn’t be read.';
  } else {
    $('#cur-avatar').textContent = '?';
    $('#cur-email').textContent = 'Checking…';
    $('#cur-kind').textContent = '';
  }
}

function renderSaved() {
  const list = $('#saved-list');
  list.replaceChildren(...saved.map((acc) => {
    const active = isActive(acc);
    return h('li', {},
      h('button', { class: 'ag-item', onclick: () => run(() => accountMenu(acc)) },
        h('span', { class: 'ag-avatar' }, initial(acc.name)),
        h('span', { class: 'ag-item-body' },
          h('span', { class: 'ag-item-title saved-email' }, acc.name),
          h('span', { class: 'ag-item-sub' }, active ? 'Signed in now' : `Last used ${when(acc.usedAt || acc.savedAt)}`)),
        h('span', { class: 'ag-item-trail item-trail' },
          active
            ? h('span', { class: 'ag-badge ag-badge-success' }, 'Active')
            : h('span', {
              class: 'ag-btn ag-btn-tonal ag-btn-sm',
              onclick: (ev) => { ev.stopPropagation(); run(() => switchTo(acc)); },
            }, 'Switch'))));
  }));
  $('#saved-empty').hidden = saved.length > 0;
}

async function refresh() {
  if (AG.permissions.query('storage') === 'granted') {
    [live, saved] = await Promise.all([readLive(), readSaved()]);
    // The same account signed in again (for example after a password change): keep its saved copy current.
    if (live.status === 'ok' && live.email && !liveSaved() && saved.some((a) => a.email === live.email)) {
      try {
        await saveLive({ quiet: true });
        saved = await readSaved();
      } catch (e) {
        console.warn('update saved copy:', e.message);
      }
    }
  } else {
    live = { status: 'none' };
    saved = await readSaved();
  }
  renderNotice();
  renderCurrent();
  renderSaved();
}

/* ---------------- Start ---------------- */

$('#refresh').addEventListener('click', () => { AG.device.haptic('light'); run(async () => {}); });
$('#add').addEventListener('click', () => run(addAccount));
$('#notice-btn').addEventListener('click', () => run(() => AG.permissions.request('storage')));
AG.on('resume', () => { if (!busy) refresh(); });          // back from Agent Hina after signing in or refreshing
AG.on('permission', () => { if (!busy) refresh(); });

refresh();
