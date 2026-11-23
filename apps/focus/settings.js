const AG = window.Hina;
const $ = s => document.querySelector(s);
const defaults = { focusMin: 25, shortMin: 5, longMin: 15, goal: 8, sound: true, longEvery: 4 };
const get = () => Object.assign({}, defaults, AG.storage.get('settings', {}));
const set = patch => AG.storage.set('settings', Object.assign(get(), patch));

const ROWS = [
  { key: 'focusMin', icon: '🍅', title: 'Focus length', unit: 'min', min: 1, max: 180 },
  { key: 'shortMin', icon: '☕', title: 'Short break', unit: 'min', min: 1, max: 60 },
  { key: 'longMin', icon: '🌴', title: 'Long break', unit: 'min', min: 1, max: 120 },
  { key: 'longEvery', icon: '🔁', title: 'Long break every', unit: 'sessions', min: 2, max: 12 },
  { key: 'goal', icon: '🏁', title: 'Daily goal', unit: 'sessions', min: 1, max: 30 },
];

function render() {
  const s = get();
  $('#durations').replaceChildren(...ROWS.map(r => {
    const li = document.createElement('li');
    li.className = 'ag-item ag-clickable';
    li.innerHTML = `<span class="ag-item-lead">${r.icon}</span><span class="ag-item-body"><span class="ag-item-title">${r.title}</span></span><span class="ag-item-trail">${s[r.key]} ${r.unit}</span>`;
    li.addEventListener('click', async () => {
      const v = await AG.ui.prompt({ title: r.title, message: `${r.min}–${r.max} ${r.unit}`, value: String(s[r.key]) });
      if (v == null) return;
      const n = Math.round(Number(v));
      if (!Number.isFinite(n) || n < r.min || n > r.max) { AG.ui.toast(`Enter a number from ${r.min} to ${r.max}`); return; }
      set({ [r.key]: n });
      AG.device.haptic('selection');
      render();
    });
    return li;
  }));
  $('#sound').checked = s.sound;
  $('#about').textContent = `${AG.app.name} ${AG.app.version} · a Mini App`;
}

$('#sound').addEventListener('change', e => { set({ sound: e.target.checked }); AG.device.haptic('light'); });
$('#test-sound').addEventListener('click', () => {
  try {
    const ctx = new AudioContext(), o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = 880; o.connect(g); g.connect(ctx.destination);
    g.gain.setValueAtTime(0.3, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.4);
    o.start(); o.stop(ctx.currentTime + 0.42);
  } catch (e) { AG.ui.toast('No audio'); }
});

$('#export').addEventListener('click', async () => {
  try {
    const sessions = await FocusDB.all('sessions');
    const tasks = await FocusDB.all('tasks');
    const data = { exported: new Date().toISOString(), settings: get(), tasks, sessions };
    await AG.fs.writeJSON('data/history.json', data);
    const focus = sessions.filter(s => s.mode === 'focus');
    const mins = focus.reduce((a, s) => a + s.minutes, 0);
    AG.ui.toast('Saved to data/history.json');
    await AG.device.share({
      title: 'My focus history',
      text: `Focus: ${focus.length} sessions, ${Math.round(mins / 60 * 10) / 10} h total across ${tasks.length} tasks.\n\n${JSON.stringify(data).slice(0, 4000)}`,
    });
  } catch (e) { AG.ui.alert({ title: 'Export failed', message: e.message }); }
});

$('#clear').addEventListener('click', async () => {
  if (!(await AG.ui.confirm({ title: 'Clear history?', message: 'All finished sessions are deleted. Tasks stay.', ok: 'Clear', destructive: true }))) return;
  const all = await FocusDB.all('sessions');
  for (const s of all) await FocusDB.del('sessions', s.id);
  AG.device.haptic('warning');
  AG.ui.toast('History cleared');
});

$('#back').addEventListener('click', () => AG.nav.back());
render();
