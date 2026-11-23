const AG = window.Hina;
const $ = s => document.querySelector(s);
const MODES = {
  focus: { label: 'Focus', color: '#C62828', key: 'focusMin', def: 25 },
  short: { label: 'Short break', color: '#2E7D32', key: 'shortMin', def: 5 },
  long: { label: 'Long break', color: '#1565C0', key: 'longMin', def: 15 },
};
const CIRC = 339.29;

const settings = () => Object.assign({ focusMin: 25, shortMin: 5, longMin: 15, goal: 8, sound: true, longEvery: 4 }, AG.storage.get('settings', {}));
// timer state survives closing the app: {mode, endAt (running) | remaining (paused), taskId, round}
let state = AG.storage.get('timer', null) || { mode: 'focus', remaining: null, endAt: null, taskId: null, round: 0 };
const save = () => AG.storage.set('timer', state);
const durMs = mode => settings()[MODES[mode].key] * 60000;

let tick = null;

function remainingMs() {
  if (state.endAt) return Math.max(0, state.endAt - Date.now());
  return state.remaining ?? durMs(state.mode);
}

function fmt(ms) { const s = Math.ceil(ms / 1000); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; }

function render() {
  const m = MODES[state.mode];
  document.documentElement.style.setProperty('--mode', m.color);
  const ms = remainingMs();
  $('#time').textContent = fmt(ms);
  $('#phase').textContent = state.endAt ? m.label : (state.remaining != null ? 'Paused' : m.label);
  $('#bar').style.strokeDashoffset = String(CIRC * (1 - ms / durMs(state.mode)));
  $('#start').textContent = state.endAt ? 'Pause' : (state.remaining != null ? 'Resume' : 'Start');
  document.querySelectorAll('#modes button').forEach(b => b.classList.toggle('is-active', b.dataset.mode === state.mode));
  $('#title').textContent = state.endAt ? `${fmt(ms)} · ${m.label}` : 'Focus';
}

async function renderTask() {
  const t = state.taskId != null ? await FocusDB.get('tasks', state.taskId).catch(() => null) : null;
  $('#task-name').textContent = t ? `${t.title} · 🍅 ${t.pomos || 0}` : 'Pick a task';
}

async function renderGoal() {
  const today = (await FocusDB.byDay(dayKey())).filter(s => s.mode === 'focus').length;
  const goal = settings().goal;
  $('#goal').replaceChildren(...Array.from({ length: Math.max(goal, today) }, (_, i) => Object.assign(document.createElement('i'), { className: i < today ? 'on' : '' })));
  $('#goal-text').textContent = today >= goal ? `Daily goal reached: ${today} sessions 🎉` : `${today} of ${goal} sessions today`;
}

function setMode(mode, keep = false) {
  state.mode = mode;
  if (!keep) { state.remaining = null; state.endAt = null; }
  AG.ui.statusBar({ color: MODES[mode].color });
  save(); render();
  notifyTimer();
}

// the live notification (countdown + buttons) follows the timer
async function notifyTimer() {
  const t = state.taskId != null ? await FocusDB.get('tasks', state.taskId).catch(() => null) : null;
  FocusNotify.update(state, (t && t.title) || null);
}

function beep(freq = 880, len = 0.18, times = 3) {
  if (!settings().sound) return;
  try {
    const ctx = new AudioContext();
    for (let i = 0; i < times; i++) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = freq; o.connect(g); g.connect(ctx.destination);
      const t = ctx.currentTime + i * (len + 0.12);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.4, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
      o.start(t); o.stop(t + len + 0.02);
    }
  } catch (e) {}
}

// The phase-end alert is a native reminder: it fires even if the app is closed or the phone sleeps.
async function scheduleEnd() {
  await FocusNotify.scheduleEnd(state).catch(e => AG.ui.toast(e.message));
}

async function start() {
  state.endAt = Date.now() + remainingMs();
  state.remaining = null;
  save(); render();
  AG.device.haptic('medium');
  await scheduleEnd();
  notifyTimer();
  run();
}

function pause() {
  state.remaining = remainingMs();
  state.endAt = null;
  save(); render();
  AG.device.haptic('light');
  AG.notify.cancel('phase-end').catch(() => {});
  clearInterval(tick);
  notifyTimer();
}

function run() {
  clearInterval(tick);
  tick = setInterval(() => { if (remainingMs() <= 0) finish(); else render(); }, 500);
}

async function finish(skipped = false) {
  clearInterval(tick);
  const mode = state.mode;
  const st = settings();
  if (!skipped) {
    beep(mode === 'focus' ? 880 : 660);
    AG.device.haptic('success');
    await FocusDB.put('sessions', { mode, minutes: st[MODES[mode].key], at: Date.now(), day: dayKey(), taskId: state.taskId });
    if (mode === 'focus' && state.taskId != null) {
      const t = await FocusDB.get('tasks', state.taskId);
      if (t) { t.pomos = (t.pomos || 0) + 1; await FocusDB.put('tasks', t); }
    }
  } else {
    AG.notify.cancel('phase-end').catch(() => {});
    AG.device.haptic('selection');
  }
  // next phase: a long break every few focus sessions
  let next = 'focus';
  if (mode === 'focus') { state.round = (state.round || 0) + 1; next = state.round % st.longEvery === 0 ? 'long' : 'short'; }
  setMode(next);
  renderTask(); renderGoal(); renderHistory();
  if (!skipped) AG.ui.toast(next === 'focus' ? 'Break over. Ready to focus?' : `Nice! ${MODES[next].label} time`);
}

/* ---------- tabs ---------- */
function showTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.hidden = t.dataset.tab !== name);
  document.querySelectorAll('.ag-navbar-item').forEach(b => b.classList.toggle('is-active', b.dataset.tab === name));
  if (name === 'tasks') renderTasks();
  if (name === 'history') renderHistory();
}
document.querySelectorAll('.ag-navbar-item').forEach(b => b.addEventListener('click', () => { AG.device.haptic('selection'); showTab(b.dataset.tab); }));
AG.onBack(() => { if ($('.tab[data-tab="timer"]').hidden) { showTab('timer'); return true; } return false; });

/* ---------- timer controls ---------- */
$('#start').addEventListener('click', () => state.endAt ? pause() : start());
$('#skip').addEventListener('click', () => finish(true));
$('#reset').addEventListener('click', async () => {
  if (state.endAt && !(await AG.ui.confirm({ title: 'Reset timer?', message: 'The current session will not be saved.', ok: 'Reset', destructive: true }))) return;
  AG.notify.cancel('phase-end').catch(() => {});
  clearInterval(tick);
  setMode(state.mode);
});
document.querySelectorAll('#modes button').forEach(b => b.addEventListener('click', async () => {
  if (b.dataset.mode === state.mode) return;
  if (state.endAt && !(await AG.ui.confirm({ title: 'Switch mode?', message: 'The running timer will stop.', ok: 'Switch' }))) return;
  AG.notify.cancel('phase-end').catch(() => {});
  clearInterval(tick);
  AG.device.haptic('selection');
  setMode(b.dataset.mode);
}));

$('#task-pick').addEventListener('click', async () => {
  const tasks = (await FocusDB.all('tasks')).filter(t => !t.done);
  const items = [...tasks.map(t => ({ id: String(t.id), label: `${t.title}  ·  🍅 ${t.pomos || 0}`, icon: state.taskId === t.id ? '✅' : '🎯' })),
    { id: 'none', label: 'No task', icon: '⭕' }, { id: 'new', label: 'New task…', icon: '➕' }];
  const pick = await AG.ui.sheet({ title: 'What are you working on?', items });
  if (pick == null) return;
  if (pick === 'new') {
    const title = await AG.ui.prompt({ title: 'New task', placeholder: 'e.g. Write report' });
    if (!title) return;
    state.taskId = await FocusDB.put('tasks', { title: title.trim(), pomos: 0, done: 0, created: Date.now() });
  } else state.taskId = pick === 'none' ? null : Number(pick);
  save(); renderTask();
});

/* ---------- tasks ---------- */
async function renderTasks() {
  const tasks = (await FocusDB.all('tasks')).sort((a, b) => a.done - b.done || b.created - a.created);
  $('#task-empty').hidden = tasks.length > 0;
  $('#task-list').replaceChildren(...tasks.map(t => {
    const li = document.createElement('li');
    li.className = 'ag-item ag-clickable ag-enter' + (t.done ? ' done-task' : '');
    li.innerHTML = `<span class="ag-item-lead">${t.done ? '✅' : (state.taskId === t.id ? '🎯' : '⬜')}</span>
      <span class="ag-item-body"><span class="ag-item-title"></span><span class="ag-item-sub">🍅 ${t.pomos || 0} pomodoros</span></span>
      <span class="ag-item-trail">⋮</span>`;
    li.querySelector('.ag-item-title').textContent = t.title;
    li.addEventListener('click', async () => {
      const a = await AG.ui.sheet({ title: t.title, items: [
        { id: 'focus', label: 'Focus on this', icon: '🎯' },
        { id: 'done', label: t.done ? 'Mark as open' : 'Mark as done', icon: '✅' },
        { id: 'rename', label: 'Rename', icon: '✏️' },
        { id: 'delete', label: 'Delete', icon: '🗑', destructive: true }] });
      if (a === 'focus') { state.taskId = t.id; save(); renderTask(); showTab('timer'); }
      if (a === 'done') { t.done = t.done ? 0 : 1; await FocusDB.put('tasks', t); AG.device.haptic('success'); }
      if (a === 'rename') { const n = await AG.ui.prompt({ title: 'Rename task', value: t.title }); if (n) { t.title = n.trim(); await FocusDB.put('tasks', t); } }
      if (a === 'delete' && await AG.ui.confirm({ title: 'Delete task?', message: t.title, ok: 'Delete', destructive: true })) {
        await FocusDB.del('tasks', t.id); if (state.taskId === t.id) { state.taskId = null; save(); }
      }
      renderTasks(); renderTask();
    });
    return li;
  }));
}
async function addTask() {
  const v = $('#task-input').value.trim();
  if (!v) return;
  await FocusDB.put('tasks', { title: v, pomos: 0, done: 0, created: Date.now() });
  $('#task-input').value = '';
  AG.device.haptic('light');
  renderTasks();
}
$('#task-add').addEventListener('click', addTask);
$('#task-input').addEventListener('keydown', e => { if (e.key === 'Enter') addTask(); });

/* ---------- history ---------- */
async function renderHistory() {
  const sessions = (await FocusDB.all('sessions')).filter(s => s.mode === 'focus');
  const days = [];
  for (let i = 6; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); days.push(dayKey(d)); }
  const mins = days.map(k => sessions.filter(s => s.day === k).reduce((a, s) => a + s.minutes, 0));
  $('#st-today').textContent = sessions.filter(s => s.day === dayKey()).length;
  $('#st-week').textContent = sessions.filter(s => days.includes(s.day)).length;
  // streak: consecutive days (ending today or yesterday) with at least one focus session
  const set = new Set(sessions.map(s => s.day));
  let streak = 0; const d = new Date();
  if (!set.has(dayKey(d))) d.setDate(d.getDate() - 1);
  while (set.has(dayKey(d))) { streak++; d.setDate(d.getDate() - 1); }
  $('#st-streak').textContent = streak;
  drawChart(days, mins);
  const tasks = Object.fromEntries((await FocusDB.all('tasks')).map(t => [t.id, t.title]));
  const recent = (await FocusDB.all('sessions')).sort((a, b) => b.at - a.at).slice(0, 15);
  $('#hist-list').replaceChildren(...(recent.length ? recent.map(s => {
    const li = document.createElement('li'); li.className = 'ag-item';
    li.innerHTML = `<span class="ag-item-lead">${s.mode === 'focus' ? '🍅' : '☕'}</span><span class="ag-item-body"><span class="ag-item-title"></span><span class="ag-item-sub"></span></span><span class="ag-item-trail">${s.minutes}m</span>`;
    li.querySelector('.ag-item-title').textContent = s.mode === 'focus' ? (tasks[s.taskId] || 'Focus') : MODES[s.mode].label;
    li.querySelector('.ag-item-sub').textContent = new Date(s.at).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
    return li;
  }) : [Object.assign(document.createElement('li'), { className: 'ag-item ag-muted', textContent: 'No sessions yet' })]));
  renderPlan();
}

function drawChart(days, mins) {
  const c = $('#chart'), dpr = devicePixelRatio || 1;
  const w = c.clientWidth || 300, h = c.clientHeight || 160;
  c.width = w * dpr; c.height = h * dpr;
  const g = c.getContext('2d'); g.scale(dpr, dpr); g.clearRect(0, 0, w, h);
  const css = getComputedStyle(document.documentElement);
  const fg = css.getPropertyValue('--ag-on-surface-variant').trim() || '#666';
  const max = Math.max(30, ...mins), bw = w / 7;
  g.font = '11px system-ui'; g.textAlign = 'center';
  days.forEach((d, i) => {
    const bh = (h - 36) * mins[i] / max, x = i * bw + bw * 0.2, y = h - 18 - bh;
    g.fillStyle = i === 6 ? MODES.focus.color : MODES.focus.color + '88';
    g.beginPath(); g.roundRect ? g.roundRect(x, y, bw * 0.6, Math.max(bh, 2), 6) : g.rect(x, y, bw * 0.6, Math.max(bh, 2)); g.fill();
    g.fillStyle = fg;
    g.fillText(new Date(d + 'T12:00').toLocaleDateString([], { weekday: 'narrow' }), i * bw + bw / 2, h - 4);
    if (mins[i]) g.fillText(String(mins[i]), i * bw + bw / 2, y - 4);
  });
}

/* ---------- plan-my-day reminder (native, repeats on weekdays) ---------- */
function renderPlan() {
  const t = AG.storage.get('planAt', null);
  $('#plan-text').textContent = t ? `Weekdays at ${t}` : 'Off';
}
$('#plan-set').addEventListener('click', async () => {
  const at = await AG.ui.pickTime({ value: AG.storage.get('planAt', '08:30') });
  if (!at) return;
  try {
    await AG.notify.schedule({ id: 'plan-day', title: 'Plan your day', body: 'Pick today\'s tasks and how many focus sessions you want 🎯', at, repeat: 'weekdays' });
    AG.storage.set('planAt', at);
    AG.ui.toast(`Reminder set: weekdays at ${at}`);
  } catch (e) { AG.ui.alert({ title: 'Could not set reminder', message: e.message }); }
  renderPlan();
});
$('#plan-off').addEventListener('click', async () => { await AG.notify.cancel('plan-day').catch(() => {}); AG.storage.remove('planAt'); renderPlan(); });

$('#open-settings').addEventListener('click', () => AG.nav.push('settings.html'));

/* ---------- boot ---------- */
// settings may change on the settings page (another page of this app): storage events keep us in sync
AG.on('storage', () => { render(); renderGoal(); });

// the notification's buttons while the app is open (or pressed before it opened)
AG.on('notification', async (e) => {
  if (e.id !== 'timer' || !['pause', 'resume', 'skip', 'stop'].includes(e.action)) return;
  if (e.action === 'pause') return pause();
  if (e.action === 'resume') return start();
  if (e.action === 'skip') return finish(true);
  AG.notify.cancel('phase-end').catch(() => {}); clearInterval(tick); setMode(state.mode);
});
AG.on('resume', () => { state = AG.storage.get('timer', state); render(); renderGoal(); renderTask(); renderHistory(); if (state.endAt) { if (remainingMs() <= 0) finish(); else run(); } });
AG.ui.statusBar({ color: MODES[state.mode].color });
render(); renderTask(); renderGoal();
if (state.endAt) { if (remainingMs() <= 0) finish(); else run(); }
// the notification follows the stored timer from the start (e.g. it was started before an update)
notifyTimer();
