/* A country, opened with Hina.nav.push('country.html', {code}). Data comes from the list page's saved copy;
   cities and the Wikipedia summary are fetched here. */
const code = (AG.page.params.code || '').toUpperCase();
const all = JSON.parse(localStorage.getItem('countries.v1') || 'null')?.list || [];
const c = all.find(x => x.iso2 === code);

$('#back').addEventListener('click', () => AG.nav.back());

async function main() {
  const body = $('#body');
  if (!c) { body.replaceChildren(empty('🌍', 'Country not found', `No saved data for "${code}". Open the Countries tab first.`)); return; }
  $('#title').textContent = c.name;
  const wiki = `https://en.wikipedia.org/wiki/${encodeURIComponent(c.name.replace(/ /g, '_'))}`;
  $('#share').addEventListener('click', () => shareSheet(c.name, `${c.emoji} ${c.name}: capital ${c.capital}, population ${fmtNum(c.population)}`, wiki));

  const about = h('p', { class: 'extract ag-muted' }, 'Loading summary…');
  const cities = h('div', { class: 'cities' }, spinner());
  body.replaceChildren(
    h('img', { class: 'hero ag-enter', src: `https://flagcdn.com/w640/${c.iso2.toLowerCase()}.png`, alt: c.emoji }),
    h('div', { class: 'facts' },
      fact('Capital', c.capital || '–'),
      fact('Population', fmtNum(c.population) + (c.popYear ? ` (${c.popYear})` : '')),
      fact('Currency', c.currency || '–'),
      fact('Dial code', c.dial ? '+' + c.dial : '–'),
      fact('ISO', `${c.iso2} / ${c.iso3}`),
      fact('Flag', c.emoji || '–'),
    ),
    h('div', { class: 'ag-card article' }, h('div', { class: 'ag-card-title' }, 'About'), about,
      h('div', { class: 'ag-card-actions' },
        h('button', { class: 'ag-btn ag-btn-sm', onclick: () => AG.device.openUrl(wiki) }, 'Wikipedia'),
        c.currency ? h('button', { class: 'ag-btn ag-btn-tonal ag-btn-sm', onclick: () => { AG.storage.set('fx.to', c.currency); AG.ui.toast(`Currency tab now converts to ${c.currency}`); } }, `Convert to ${c.currency}`) : null)),
    h('div', { class: 'ag-card' }, h('div', { class: 'ag-card-title' }, 'Cities'), cities),
  );

  // two more APIs: Wikipedia summary and the city list (in parallel)
  getJSON(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(c.name.replace(/ /g, '_'))}`)
    .then(s => { about.textContent = s.extract || 'No summary.'; about.classList.remove('ag-muted'); })
    .catch(() => { about.textContent = 'Summary not available offline.'; });
  getJSON(`https://countriesnow.space/api/v0.1/countries/cities/q?country=${encodeURIComponent(c.name)}`)
    .then(r => {
      const list = (r.data || []).slice(0, 60);
      cities.replaceChildren(...(list.length ? list.map(n => h('span', { class: 'ag-chip' }, n)) : [h('span', { class: 'ag-muted' }, 'No cities listed')]));
      if (r.data?.length > 60) cities.append(h('span', { class: 'ag-muted' }, ` +${r.data.length - 60} more`));
    })
    .catch(e => cities.replaceChildren(h('span', { class: 'ag-muted' }, `Cities not available: ${e.message}`)));
}

function fact(label, value) { return h('div', { class: 'fact' }, h('span', {}, label), h('b', {}, value)); }

main();
