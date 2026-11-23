// Habits: a daily habit tracker. State lives in Hina.storage (native, synchronous JSON).

const AG = window.Hina;
const $ = sel => document.querySelector(sel);
const $$ = sel => [...document.querySelectorAll(sel)];

function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') el.className = value;
    else if (key === 'style') el.style.cssText = value;
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (key === 'svg') el.innerHTML = value;
    else if (value === true) el.setAttribute(key, '');
    else if (value != null && value !== false) el.setAttribute(key, value);
  }
  el.append(...children.flat().filter(c => c != null && c !== false));
  return el;
}

/* ---------------- Dates ---------------- */
const pad = n => String(n).padStart(2, '0');
const dayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const startOfDay = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };

/* ---------------- State ---------------- */
const ICONS = [
  ['💧', 'Drink water'], ['📚', 'Read'], ['🏃', 'Exercise'], ['🧘', 'Meditate'], ['🥗', 'Eat well'],
  ['😴', 'Sleep early'], ['✍️', 'Journal'], ['🎸', 'Practice'], ['🌱', 'Something else'],
];
let habits = AG.storage.get('habits', []);          // [{id, name, emoji, created}]
let checks = AG.storage.get('checks', {});          // {'YYYY-MM-DD': [habitId, ...]}
let reminder = AG.storage.get('reminder', { on: false, time: '20:00' });

function save() {
  // keep ~4 months of history so storage stays small
  const oldest = dayKey(addDays(new Date(), -120));
  for (const key of Object.keys(checks)) if (key < oldest) delete checks[key];
  AG.storage.set('habits', habits);
  AG.storage.set('checks', checks);
  AG.storage.set('reminder', reminder);
}

const isDone = (id, key) => (checks[key] ?? []).includes(id);
const doneToday = () => habits.filter(habit => isDone(habit.id, dayKey())).length;
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

function currentStreak(id) {
  let day = new Date();
  if (!isDone(id, dayKey(day))) day = addDays(day, -1); // today not checked yet: the streak is still alive
  let n = 0;
  while (isDone(id, dayKey(day))) { n++; day = addDays(day, -1); }
  return n;
}
function bestStreak(id) {
  const keys = Object.keys(checks).filter(k => checks[k].includes(id)).sort();
  let best = 0, run = 0, prev = null;
  for (const key of keys) {
    run = prev && dayKey(addDays(new Date(`${prev}T12:00:00`), 1)) === key ? run + 1 : 1;
    best = Math.max(best, run);
    prev = key;
  }
  return best;
}

/* ---------------- Today ---------------- */
let justToggled = null;
let justAdded = null;

function renderToday() {
  const list = $('#habit-list');
  const total = habits.length, done = doneToday();
  $('#empty').hidden = total > 0;
  $('#summary').hidden = total === 0;

  // Progress ring
  const circumference = 2 * Math.PI * 34;
  const bar = $('#ring-bar');
  bar.style.strokeDasharray = `${circumference}`;
  bar.style.strokeDashoffset = `${circumference * (1 - (total ? done / total : 0))}`;
  $('#ring-label').textContent = `${done}/${total}`;
  $('#summary-title').textContent = !total ? "Let's get started" : done === total ? 'All done for today 🎉' : done === 0 ? 'A fresh day' : 'Keep going';
  $('#summary-sub').textContent = !total ? '' : done === total ? 'Every habit checked. See you tomorrow!' : `${total - done} left for today`;

  const week = [...Array(7)].map((_, i) => dayKey(addDays(new Date(), i - 6)));
  list.replaceChildren(...habits.map((habit, index) => {
    const doneNow = isDone(habit.id, dayKey());
    const streak = currentStreak(habit.id);
    const card = h('div', { class: `habit${doneNow ? ' is-done' : ''}${list.childElementCount && habit.id !== justAdded ? '' : ' ag-enter'}`, style: `animation-delay:${index * 30}ms` },
      h('button', { class: 'habit-main ag-clickable', onclick: () => editHabit(habit) },
        h('span', { class: 'habit-emoji' }, habit.emoji),
        h('span', { class: 'habit-body' },
          h('span', { class: 'habit-name' }, habit.name),
          h('span', { class: 'habit-meta' },
            h('span', {}, streak ? `🔥 ${streak} day${streak === 1 ? '' : 's'}` : 'No streak yet'),
            h('span', { class: 'dots', 'aria-hidden': 'true' }, week.map((key, i) =>
              h('i', { class: `dot${isDone(habit.id, key) ? ' done' : ''}${i === 6 ? ' today' : ''}` })))))),
      h('button', {
        class: `habit-check${justToggled === habit.id ? ' pop' : ''}`,
        'aria-label': doneNow ? `Uncheck ${habit.name}` : `Check ${habit.name}`,
        'aria-pressed': String(doneNow),
        onclick: () => toggle(habit.id),
        svg: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>',
      }));
    return card;
  }));
  justToggled = null;
  justAdded = null;
}

function toggle(id) {
  const key = dayKey();
  const set = new Set(checks[key] ?? []);
  const nowDone = !set.has(id);
  if (nowDone) set.add(id); else set.delete(id);
  checks[key] = [...set];
  save();
  justToggled = id;
  AG.device.haptic(nowDone ? 'success' : 'light');
  renderToday();
  if (nowDone && doneToday() === habits.length) {
    AG.ui.toast('All habits done today 🎉');
    scheduleReminders(); // today is complete, so the next reminder is tomorrow
  }
}

async function addHabit() {
  const name = (await AG.ui.prompt({ title: 'New habit', message: 'What do you want to do every day?', placeholder: 'e.g. Drink 8 glasses of water', ok: 'Next' }))?.trim();
  if (!name) return;
  const emoji = await AG.ui.sheet({ title: 'Pick an icon', items: ICONS.map(([icon, label]) => ({ id: icon, label, icon })) });
  justAdded = uid();
  habits.push({ id: justAdded, name, emoji: emoji ?? '🌱', created: Date.now() });
  save();
  AG.device.haptic('medium');
  renderToday();
  window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
}

async function editHabit(habit) {
  const choice = await AG.ui.sheet({
    title: `${habit.emoji}  ${habit.name}`,
    items: [
      { id: 'rename', label: 'Rename', icon: '✏️' },
      { id: 'icon', label: 'Change icon', icon: '🎨' },
      { id: 'up', label: 'Move up', icon: '⬆️' },
      { id: 'delete', label: 'Delete habit', icon: '🗑️', destructive: true },
    ],
  });
  if (choice === 'rename') {
    const name = (await AG.ui.prompt({ title: 'Rename habit', value: habit.name, ok: 'Save' }))?.trim();
    if (name) habit.name = name;
  } else if (choice === 'icon') {
    const emoji = await AG.ui.sheet({ title: 'Pick an icon', items: ICONS.map(([icon, label]) => ({ id: icon, label, icon })) });
    if (emoji) habit.emoji = emoji;
  } else if (choice === 'up') {
    const i = habits.indexOf(habit);
    if (i > 0) [habits[i - 1], habits[i]] = [habits[i], habits[i - 1]];
  } else if (choice === 'delete') {
    const yes = await AG.ui.confirm({ title: 'Delete habit?', message: `"${habit.name}" and its history will be removed.`, ok: 'Delete', destructive: true });
    if (!yes) return;
    habits = habits.filter(x => x !== habit);
    for (const key of Object.keys(checks)) checks[key] = checks[key].filter(id => id !== habit.id);
    AG.device.haptic('warning');
  } else {
    return;
  }
  save();
  renderToday();
}

/* ---------------- History ---------------- */
function renderHistory() {
  // Heatmap: 4 weeks, Monday first, ending this week
  const today = startOfDay(new Date());
  const monday = addDays(today, -((today.getDay() + 6) % 7) - 21);
  const labels = ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map(l => h('span', { class: 'heat-label' }, l));
  const cells = [...Array(28)].map((_, i) => {
    const day = addDays(monday, i);
    const key = dayKey(day);
    if (day > today) return h('span', { class: 'heat future' }, day.getDate());
    const existing = habits.filter(habit => startOfDay(habit.created) <= day);
    const ratio = existing.length ? existing.filter(habit => isDone(habit.id, key)).length / existing.length : 0;
    const pct = ratio ? Math.round(25 + ratio * 75) : 0;
    return h('span', {
      class: `heat${ratio >= .6 ? ' strong' : ''}${key === dayKey() ? ' today' : ''}`,
      style: pct ? `background: color-mix(in srgb, var(--ag-primary, #6750A4) ${pct}%, var(--ag-surface-container-high, #ECE6F0)); animation-delay:${i * 8}ms` : `animation-delay:${i * 8}ms`,
    }, day.getDate());
  });
  $('#heatmap').replaceChildren(...labels, ...cells);

  // Stats
  let possible = 0, got = 0;
  for (let i = 0; i < 7; i++) {
    const day = addDays(today, -i), key = dayKey(day);
    const existing = habits.filter(habit => startOfDay(habit.created) <= day);
    possible += existing.length;
    got += existing.filter(habit => isDone(habit.id, key)).length;
  }
  $('#stat-week').textContent = possible ? `${Math.round((got / possible) * 100)}%` : '–';
  $('#stat-best').textContent = Math.max(0, ...habits.map(habit => bestStreak(habit.id)));
  $('#stat-total').textContent = Object.values(checks).reduce((sum, ids) => sum + ids.length, 0);

  $('#streak-list').replaceChildren(...(habits.length ? habits.map(habit => h('li', { class: 'ag-item' },
    h('span', { class: 'ag-avatar' }, habit.emoji),
    h('span', { class: 'ag-item-body' },
      h('span', { class: 'ag-item-title' }, habit.name),
      h('span', { class: 'ag-item-sub' }, `Best: ${bestStreak(habit.id)} days`)),
    h('span', { class: 'ag-item-trail' }, `🔥 ${currentStreak(habit.id)}`))) : [h('li', { class: 'ag-item ag-muted' }, 'No habits yet')]));
}

/* ---------------- Reminder ---------------- */
// One native repeating reminder: it survives restarts and reboots, no need to open the app.
// If every habit is already done today, it starts tomorrow.
async function scheduleReminders() {
  // older versions scheduled seven one-off reminders
  for (let i = 0; i < 7; i++) AG.notify.cancel(`daily-${i}`).catch(() => {});
  if (!reminder.on || !habits.length) { await AG.notify.cancel('daily').catch(() => {}); return; }
  const [hh, mm] = reminder.time.split(':').map(Number);
  let first = new Date();
  first.setHours(hh, mm, 0, 0);
  if (first <= new Date() || doneToday() === habits.length) first = addDays(first, 1);
  await AG.notify.schedule({
    id: 'daily',
    title: 'Habits',
    body: `Time to check in on your ${habits.length} habit${habits.length === 1 ? '' : 's'} ✨`,
    at: first,
    repeat: 'daily',
  });
}

function renderSettings() {
  $('#reminder-on').checked = reminder.on;
  $('#reminder-sub').textContent = reminder.on ? `Every day at ${reminder.time}` : 'Off';
  $('#reminder-time-sub').textContent = reminder.time;
  $('#reminder-time').disabled = !reminder.on;
  $('#reminder-time').style.opacity = reminder.on ? '' : '.5';
  $('#about').textContent = `${AG.app.name} ${AG.app.version} · a Mini App`;
}

$('#reminder-on').addEventListener('change', async event => {
  const want = event.target.checked;
  if (want) {
    const state = await AG.permissions.request('notifications');
    if (state !== 'granted') {
      event.target.checked = false;
      AG.ui.toast('Notifications are off for this app');
      return;
    }
  }
  reminder.on = want;
  save();
  renderSettings();
  try {
    await scheduleReminders();
    if (want) AG.ui.toast(`Reminder set for ${reminder.time}`);
  } catch (e) {
    AG.ui.toast(`Could not schedule: ${e.message}`);
  }
});

$('#reminder-time').addEventListener('click', async () => {
  const time = await AG.ui.pickTime({ value: reminder.time });
  if (!time) return;
  reminder.time = time;
  save();
  renderSettings();
  scheduleReminders().catch(e => AG.ui.toast(`Could not schedule: ${e.message}`));
});

$('#reset-today').addEventListener('click', async () => {
  if (!(await AG.ui.confirm({ title: 'Uncheck today?', message: "Today's check-ins will be cleared.", ok: 'Uncheck' }))) return;
  delete checks[dayKey()];
  save();
  renderToday();
  AG.ui.toast("Today's check-ins cleared");
});

$('#reset-all').addEventListener('click', async () => {
  const yes = await AG.ui.confirm({ title: 'Delete all data?', message: 'All habits and their history will be removed. This cannot be undone.', ok: 'Delete', destructive: true });
  if (!yes) return;
  habits = [];
  checks = {};
  save();
  scheduleReminders().catch(() => {});
  AG.device.haptic('warning');
  showTab('today');
});

/* ---------------- Tabs, back, theme ---------------- */
let currentTab = 'today';

function showTab(name) {
  currentTab = name;
  for (const section of $$('.tab')) {
    const active = section.dataset.tab === name;
    section.hidden = !active;
    if (active) {
      $('#title').textContent = section.dataset.title;
      section.classList.remove('ag-fade');
      void section.offsetWidth;
      section.classList.add('ag-fade');
    }
  }
  for (const item of $$('.ag-navbar-item')) item.classList.toggle('is-active', item.dataset.tab === name);
  $('#fab').classList.toggle('is-hidden', name !== 'today');
  window.scrollTo(0, 0);
  if (name === 'today') renderToday();
  if (name === 'history') renderHistory();
  if (name === 'settings') renderSettings();
}

for (const item of $$('.ag-navbar-item')) {
  item.addEventListener('click', () => {
    if (item.dataset.tab !== currentTab) AG.device.haptic('selection');
    showTab(item.dataset.tab);
  });
}

AG.onBack(() => {
  if (currentTab !== 'today') { showTab('today'); return true; }
  return false;
});

// Status bar blends with the page background, like a native edge-to-edge app
function matchStatusBar() {
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--ag-background').trim();
  if (bg) AG.ui.statusBar({ color: bg });
}
AG.on('theme', () => { matchStatusBar(); if (currentTab === 'history') renderHistory(); });

// Coming back on a new day (or from another page): refresh
let lastDay = dayKey();
AG.on('resume', () => {
  const day = dayKey();
  if (day !== lastDay) { lastDay = day; updateSubtitle(); }
  showTab(currentTab);
});

function updateSubtitle() {
  $('#subtitle').textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
}

$('#fab').addEventListener('click', addHabit);
$('#empty-add').addEventListener('click', addHabit);

updateSubtitle();
matchStatusBar();
showTab('today');
if (reminder.on) scheduleReminders().catch(e => console.warn('Reminder scheduling failed', e));
