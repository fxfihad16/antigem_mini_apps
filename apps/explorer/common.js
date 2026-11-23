// Shared helpers for Explorer's pages.
const AG = window.Hina;
const $ = (sel, root = document) => root.querySelector(sel);

/** Tiny element builder: h('li', {class: 'x', onclick}, child, ...) */
function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : String(c));
  return el;
}

const spinner = () => h('div', { class: 'loading' }, h('div', { class: 'ag-spinner' }));
const empty = (icon, title, sub) => h('div', { class: 'ag-empty' }, h('div', { class: 'ag-empty-icon' }, icon), h('div', { class: 'ag-empty-title' }, title), sub ? h('p', {}, sub) : null);

/** fetch → JSON, with a readable error (all of it goes through Agent Hina's native network). */
async function getJSON(url, opts) {
  const r = await fetch(url, opts);
  if (!r.ok) {
    const err = new Error(`${new URL(url).host} answered ${r.status}`);
    err.status = r.status;
    throw err;
  }
  return r.json();
}

function toastError(e) {
  console.warn(e);
  AG?.ui.toast(e?.message || String(e));
}

/** Long-press (or right-click) handler for list items. */
function onLongPress(el, fn) {
  let t = null;
  let fired = false;
  const start = () => { fired = false; t = setTimeout(() => { t = null; fired = true; AG?.device.haptic('medium'); fn(); }, 480); };
  // the finger lifting after a long press must not also count as a tap
  el.addEventListener('click', e => { if (fired) { e.stopImmediatePropagation(); e.preventDefault(); fired = false; } }, true);
  const stop = () => { if (t) clearTimeout(t); t = null; };
  el.addEventListener('touchstart', start, { passive: true });
  el.addEventListener('touchend', stop);
  el.addEventListener('touchmove', stop, { passive: true });
  el.addEventListener('contextmenu', e => { e.preventDefault(); stop(); fn(); });
}

/** Share / copy sheet for any item. */
async function shareSheet(title, text, url) {
  const id = await AG.ui.sheet({ title, items: [
    { id: 'share', label: 'Share', icon: '📤' },
    { id: 'copy', label: 'Copy link', icon: '📋' },
    url ? { id: 'open', label: 'Open in browser', icon: '🌐' } : null,
  ].filter(Boolean) });
  if (id === 'share') AG.device.share({ title, text, url });
  else if (id === 'copy') { await AG.device.copy(url || text); AG.ui.toast('Copied'); }
  else if (id === 'open') AG.device.openUrl(url);
}

const fmtNum = n => (n == null ? '–' : Number(n).toLocaleString());
