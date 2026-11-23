// Shared by index.html and viewer.html
const AG = window.Hina;
const IMG = /\.(jpe?g|png|gif|webp|heic|heif|avif|bmp)$/i;
const VID = /\.(mp4|webm|mov|m4v|3gp|mkv)$/i;
const isMedia = (n) => IMG.test(n) || VID.test(n);
const isVideo = (n) => VID.test(n);
const $ = (s, r = document) => r.querySelector(s);

function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null) el.append(c);
  return el;
}

function fmtSize(b) {
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
  if (b < 1073741824) return (b / 1048576).toFixed(1) + ' MB';
  return (b / 1073741824).toFixed(2) + ' GB';
}

// Media of one folder plus its direct subfolders (DCIM/Camera, Screenshots, …), newest first
async function scanFolder(path) {
  const out = [];
  let entries;
  try { entries = await AG.fs.list(path); } catch (e) { return out; }
  for (const e of entries) {
    if (e.type === 'file' && isMedia(e.name)) out.push(e);
    else if (e.type === 'dir' && !e.name.startsWith('.')) {
      try {
        for (const s of await AG.fs.list(e.path)) if (s.type === 'file' && isMedia(s.name)) out.push(s);
      } catch (_) { /* not readable: skip */ }
    }
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}

// Readable folders the app may browse (granted manifest folders and picked ones)
async function mediaFolders() {
  const all = await AG.fs.folders();
  return all.filter(f => f.source !== 'own' && f.access !== 'write');
}

// Can the app delete files under this path?
async function canWrite(path) {
  path = path.replace(/^\/sdcard(?=\/|$)/, '/storage/emulated/0');
  const all = await AG.fs.folders();
  return all.some(f => f.access !== 'read' && (path === f.path || path.startsWith(f.path + '/')));
}
