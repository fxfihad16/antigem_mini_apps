const AG = window.Hina;
const $ = (s) => document.querySelector(s);
const h = (tag, props = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else if (v != null) el.setAttribute(k, v);
  }
  el.append(...kids.flat().filter(x => x != null));
  return el;
};

let cities = AG.storage.get('cities', []);
let current = AG.storage.get('current', cities[0]?.id ?? null);
let units = AG.storage.get('units', 'metric');
let data = null;
const deg = () => (units === 'imperial' ? '°F' : '°C');
const wind = () => (units === 'imperial' ? 'mph' : 'km/h');
const cityOf = (id) => cities.find(c => c.id === id) || cities[0];

/* ---------------- tabs & back ---------------- */
let tab = 'now';
function showTab(name) {
  tab = name;
  document.querySelectorAll('.tab').forEach(s => (s.hidden = s.dataset.tab !== name));
  document.querySelectorAll('.ag-navbar-item').forEach(b => b.classList.toggle('is-active', b.dataset.tab === name));
  if (name === 'settings') renderBackground();
  AG.device.haptic('selection');
}
document.querySelectorAll('.ag-navbar-item').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));
AG.onBack(() => { if (tab !== 'now') { showTab('now'); return true; } return false; });

/* ---------------- weather ---------------- */
async function load(force = false) {
  const city = cityOf(current);
  if (!city) { renderEmpty(); return; }
  $('#title').textContent = city.name;
  $('#subtitle').textContent = city.country || '';
  const cacheKey = 'cache:' + city.id;
  const cached = JSON.parse(localStorage.getItem(cacheKey) || 'null');
  if (cached && !force) { data = cached.data; render(true, cached.at); }
  try {
    data = await (await fetch(Sky.url(city, units))).json();
    if (data.error) throw new Error(data.reason);
    localStorage.setItem(cacheKey, JSON.stringify({ at: Date.now(), data }));
    render(false);
  } catch (e) {
    console.warn('Forecast failed, using cache', e);
    if (cached) { data = cached.data; render(true, cached.at); } else AG.ui.toast('Could not load the forecast: ' + e.message);
  }
}

function renderEmpty() {
  $('#title').textContent = 'Sky';
  $('#cur-desc').textContent = 'Add a city on the Cities tab';
  $('#cur-temp').textContent = '--°';
  $('#days').replaceChildren();
}

const SKY_COLORS = { clear: ['#1e88e5', '#1565c0'], cloud: ['#78909c', '#455a64'], rain: ['#455a64', '#263238'], snow: ['#90a4ae', '#607d8b'], storm: ['#37474f', '#1c1c2e'] };
function skyKind(code) { return code <= 1 ? 'clear' : code <= 48 ? 'cloud' : code >= 95 ? 'storm' : (code >= 71 && code <= 77) || code >= 85 ? 'snow' : 'rain'; }

function render(isCached, at) {
  const c = data.current;
  const [icon, desc] = Sky.code(c.weather_code);
  $('#cur-icon').textContent = icon;
  $('#cur-temp').textContent = Math.round(c.temperature_2m) + '°';
  $('#cur-desc').textContent = desc;
  $('#cur-meta').textContent = `💨 ${Math.round(c.wind_speed_10m)} ${wind()} · 💧 ${c.relative_humidity_2m}% · ☔ ${Sky.rainSoon(data, 3)}% next 3 h`;
  const badge = $('#cached');
  badge.hidden = !isCached;
  if (isCached && at) badge.textContent = 'cached ' + new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const [s1, s2] = SKY_COLORS[skyKind(c.weather_code)];
  const hero = $('#hero');
  hero.style.setProperty('--sky1', s1); hero.style.setProperty('--sky2', s2);
  AG.ui.statusBar({ color: s1 });
  drawChart();
  const d = data.daily;
  $('#days').replaceChildren(...d.time.map((t, i) => {
    const [di, dd] = Sky.code(d.weather_code[i]);
    const name = i === 0 ? 'Today' : new Date(t + 'T12:00').toLocaleDateString([], { weekday: 'long' });
    return h('li', { class: 'ag-item' },
      h('span', { class: 'ag-item-lead' }, di),
      h('span', { class: 'ag-item-body' }, h('span', { class: 'ag-item-title' }, name), h('span', { class: 'ag-item-sub' }, `${dd} · ☔ ${d.precipitation_probability_max[i] ?? 0}%`)),
      h('span', { class: 'ag-item-trail day-temps' }, Math.round(d.temperature_2m_max[i]) + '°', h('span', { class: 'lo' }, Math.round(d.temperature_2m_min[i]) + '°')));
  }));
}

function drawChart() {
  const cv = $('#chart'), ctx = cv.getContext('2d');
  const dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = 180;
  cv.width = W * dpr; cv.height = H * dpr; ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);
  const now = Date.now();
  let start = data.hourly.time.findIndex(t => new Date(t).getTime() >= now - 3600e3);
  if (start < 0) start = 0;
  const temps = data.hourly.temperature_2m.slice(start, start + 24);
  const rain = data.hourly.precipitation_probability.slice(start, start + 24);
  const times = data.hourly.time.slice(start, start + 24);
  if (!temps.length) return;
  const css = getComputedStyle(document.documentElement);
  const primary = css.getPropertyValue('--ag-primary').trim() || '#1565c0';
  const text = css.getPropertyValue('--ag-on-surface-variant').trim() || '#666';
  const min = Math.min(...temps) - 2, max = Math.max(...temps) + 2;
  const pad = 24, step = (W - pad * 2) / Math.max(1, temps.length - 1);
  const y = (v) => 20 + (H - 60) * (1 - (v - min) / (max - min || 1));
  // rain bars
  ctx.fillStyle = 'rgba(66,165,245,.25)';
  rain.forEach((p, i) => { const bh = (H - 60) * (p || 0) / 100; ctx.fillRect(pad + i * step - step / 3, H - 40 - bh, step * 2 / 3, bh); });
  // temperature line
  ctx.strokeStyle = primary; ctx.lineWidth = 2.5; ctx.lineJoin = 'round'; ctx.beginPath();
  temps.forEach((t, i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, pad + i * step, y(t)));
  ctx.stroke();
  ctx.fillStyle = text; ctx.font = '11px system-ui'; ctx.textAlign = 'center';
  temps.forEach((t, i) => {
    if (i % 3) return;
    ctx.fillText(Math.round(t) + '°', pad + i * step, y(t) - 8);
    ctx.fillText(new Date(times[i]).getHours().toString().padStart(2, '0'), pad + i * step, H - 22);
    if (rain[i]) ctx.fillText(rain[i] + '%', pad + i * step, H - 6);
  });
}
window.addEventListener('resize', () => data && drawChart());
AG.on('theme', () => data && drawChart());

/* ---------------- cities ---------------- */
let searchTimer;
$('#search').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  const q = e.target.value.trim();
  if (q.length < 2) { $('#results').replaceChildren(); return; }
  searchTimer = setTimeout(() => search(q), 350);
});
async function search(q) {
  try {
    const r = await (await fetch('https://geocoding-api.open-meteo.com/v1/search?count=8&name=' + encodeURIComponent(q))).json();
    $('#results').replaceChildren(...(r.results || []).map(c => h('li', { class: 'ag-item ag-clickable', onclick: () => addCity(c) },
      h('span', { class: 'ag-item-lead' }, '📍'),
      h('span', { class: 'ag-item-body' }, h('span', { class: 'ag-item-title' }, c.name), h('span', { class: 'ag-item-sub' }, [c.admin1, c.country].filter(Boolean).join(', '))),
      h('span', { class: 'ag-item-trail' }, '+'))));
    if (!r.results) $('#results').replaceChildren(h('li', { class: 'ag-item ag-muted' }, 'No places found'));
  } catch (e) { AG.ui.toast('Search failed: ' + e.message); }
}
function saveCities() { AG.storage.set('cities', cities); AG.storage.set('current', current); }
function addCity(c) {
  const id = String(c.id);
  if (!cities.some(x => x.id === id)) cities.push({ id, name: c.name, country: c.country || '', lat: c.latitude, lon: c.longitude });
  current = id; saveCities();
  $('#search').value = ''; $('#results').replaceChildren();
  AG.device.haptic('success');
  renderSaved(); showTab('now'); load(); ensureRainTask();
}
function renderSaved() {
  $('#saved').replaceChildren(...(cities.length ? cities.map((c, i) => {
    const li = h('li', { class: 'ag-item ag-clickable', onclick: () => { current = c.id; saveCities(); showTab('now'); load(); } },
      h('span', { class: 'ag-item-lead' }, i === 0 ? '⭐' : '📍'),
      h('span', { class: 'ag-item-body' }, h('span', { class: 'ag-item-title' }, c.name), h('span', { class: 'ag-item-sub' }, c.country + (i === 0 ? ' · rain alerts' : ''))),
      c.id === current ? h('span', { class: 'ag-badge ag-badge-primary' }, 'shown') : null);
    li.addEventListener('contextmenu', async (e) => {
      e.preventDefault();
      const pick = await AG.ui.sheet({ title: c.name, items: [{ id: 'first', label: 'Use for rain alerts', icon: '⭐' }, { id: 'remove', label: 'Remove', icon: '🗑️', destructive: true }] });
      if (pick === 'remove') { cities = cities.filter(x => x.id !== c.id); if (current === c.id) current = cities[0]?.id ?? null; }
      if (pick === 'first') cities = [c, ...cities.filter(x => x.id !== c.id)];
      if (pick) { saveCities(); renderSaved(); load(); }
    });
    return li;
  }) : [h('li', { class: 'ag-item ag-muted' }, 'No cities yet: search above')]));
}

/* ---------------- settings: units, reminders, background ---------------- */
function renderUnits() { $('#units-sub').textContent = units === 'imperial' ? 'Fahrenheit, mph' : 'Celsius, km/h'; }
$('#units-row').addEventListener('click', async () => {
  const pick = await AG.ui.sheet({ title: 'Units', items: [{ id: 'metric', label: 'Celsius, km/h', icon: '🌍' }, { id: 'imperial', label: 'Fahrenheit, mph', icon: '🇺🇸' }] });
  if (!pick || pick === units) return;
  units = pick; AG.storage.set('units', units);
  cities.forEach(c => localStorage.removeItem('cache:' + c.id)); // cached numbers are in the old units
  renderUnits(); load(true);
});

$('#morning').checked = AG.storage.get('morning', false);
$('#morning').addEventListener('change', async (e) => {
  const on = e.target.checked;
  try {
    if (on) {
      if (await AG.permissions.request('notifications') !== 'granted') throw new Error('Notifications are not allowed');
      const city = cityOf(current);
      await AG.notify.schedule({ id: 'morning', title: '☀️ Good morning', body: `Open Sky for today's weather${city ? ' in ' + city.name : ''}.`, at: '07:00', repeat: 'daily' });
      AG.ui.toast('Morning summary every day at 07:00');
    } else await AG.notify.cancel('morning');
    AG.storage.set('morning', on);
  } catch (err) { e.target.checked = !on; AG.ui.alert({ title: 'Morning summary', message: err.message }); }
});

$('#rain').checked = AG.storage.get('rainAlerts', true);
$('#rain').addEventListener('change', async (e) => {
  AG.storage.set('rainAlerts', e.target.checked);
  if (e.target.checked) await ensureRainTask(true); else await AG.background.cancel('rain-check').catch(() => {});
  renderBackground();
});

async function ensureRainTask(ask = false) {
  if (!cities.length || AG.storage.get('rainAlerts', true) === false) return;
  try {
    if (AG.permissions.query('background') !== 'granted' && (!ask || await AG.permissions.request('background') !== 'granted')) return;
    await AG.background.register('rain-check', { every: '1h', network: 'any' });
  } catch (e) { console.warn('rain-check not registered', e); }
}

async function renderBackground() {
  try {
    const tasks = await AG.background.list();
    const last = AG.storage.get('lastCheck', null);
    const lines = tasks.length ? tasks.map(t => `${t.name}: ${t.schedule}\nnext ≈ ${new Date(t.next).toLocaleString()}` +
      (t.lastRun ? `\nlast run: ${new Date(t.lastRun.at).toLocaleString()} · ${t.lastRun.status}${t.lastRun.detail ? ' · ' + t.lastRun.detail : ''}` : '\nnot run yet')) : ['No background task (add a city and allow rain alerts)'];
    if (last) lines.push(`\nLast check: ${last.city}, ${last.rain}% rain in 3 h (${last.reason}, ${new Date(last.at).toLocaleTimeString()})`);
    const reminders = await AG.notify.list();
    lines.push(`Reminders: ${reminders.length ? reminders.map(r => r.id + ' ' + r.repeat).join(', ') : 'none'}`);
    $('#bg-out').textContent = lines.join('\n');
  } catch (e) { $('#bg-out').textContent = e.message; }
}
$('#bg-refresh').addEventListener('click', renderBackground);
$('#run-now').addEventListener('click', async () => {
  try {
    if (AG.permissions.query('background') !== 'granted' && await AG.permissions.request('background') !== 'granted') throw new Error('Background permission denied');
    await ensureRainTask();
    await AG.background.run('rain-check');
    AG.ui.toast('Checking… you get a notification if rain is likely');
    setTimeout(renderBackground, 6000);
  } catch (e) { AG.ui.alert({ title: 'Rain check', message: e.message }); }
});
AG.on('storage', (e) => { if (e.key === 'lastCheck' && tab === 'settings') renderBackground(); });

/* ---------------- toolbar ---------------- */
$('#btn-refresh').addEventListener('click', () => { AG.device.haptic('light'); load(true); });
$('#btn-share').addEventListener('click', async () => {
  const city = cityOf(current);
  if (!data || !city) return;
  const [icon, desc] = Sky.code(data.current.weather_code);
  const d = data.daily;
  const text = `${icon} ${city.name}: ${Math.round(data.current.temperature_2m)}${deg()}, ${desc}\n` +
    d.time.slice(0, 3).map((t, i) => `${i ? new Date(t + 'T12:00').toLocaleDateString([], { weekday: 'short' }) : 'Today'}: ${Math.round(d.temperature_2m_max[i])}/${Math.round(d.temperature_2m_min[i])}${deg()} ${Sky.code(d.weather_code[i])[0]}`).join('\n');
  await AG.device.share({ title: 'Weather in ' + city.name, text });
});
AG.on('resume', () => load());

/* ---------------- start ---------------- */
renderUnits(); renderSaved(); load(); ensureRainTask();
