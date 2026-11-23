// Runs with Sky closed (Agent Hina background task): every hour, warn when rain is likely in the next 3 hours.
Hina.background.on('rain-check', async (task) => {
  await import('/shared.js'); // defines globalThis.Sky (weather codes, forecast URL)
  const cities = Hina.storage.get('cities', []);
  if (!cities.length || Hina.storage.get('rainAlerts', true) === false) return;
  const city = cities[0];
  const data = await (await fetch(Sky.url(city, Hina.storage.get('units', 'metric')))).json();
  localStorage.setItem('cache:' + city.id, JSON.stringify({ at: Date.now(), data }));
  const p = Sky.rainSoon(data, 3);
  Hina.storage.set('lastCheck', { at: Date.now(), city: city.name, rain: p, reason: task.reason });
  if (p >= 60) {
    await Hina.notify.show({ title: `☔ Rain likely in ${city.name}`, body: `${p}% chance of rain in the next 3 hours. Take an umbrella.`, tag: 'rain' });
  }
});
