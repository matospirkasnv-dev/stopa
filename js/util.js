// Pomocné funkcie: DOM, formátovanie, toasty, modálne okná
export const CATEGORIES = [
  { id: 'bike', label: 'Bicykel', color: '#38bdf8' },
  { id: 'mtb', label: 'Horský bicykel', color: '#fb923c' },
  { id: 'hike', label: 'Turistika', color: '#a3e635' },
  { id: 'run', label: 'Beh', color: '#fb7185' },
  { id: 'walk', label: 'Prechádzka', color: '#c4b5fd' },
  { id: 'other', label: 'Ostatné', color: '#94a3b8' },
];
export const catById = (id) => CATEGORIES.find((c) => c.id === id) || CATEGORIES[5];

const ICONS = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  map: '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  play: '<path d="M7 4v16l13-8z" fill="currentColor"/>',
  pause: '<path d="M8 5v14M16 5v14" stroke-width="3"/>',
  restart: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 10v6M14 10v6"/>',
  edit: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>',
  pin: '<path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  left: '<path d="m15 18-6-6 6-6"/>',
  right: '<path d="m9 18 6-6-6-6"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>',
  download: '<path d="M12 4v12M7 11l5 5 5-5M4 20h16"/>',
  flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  cube: '<path d="m12 2 9 5v10l-9 5-9-5V7zM12 12 3 7M12 12l9-5M12 12v10"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v12H4z"/><circle cx="12" cy="13" r="3.5"/>',
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
};
export function icon(name, size = 20) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}
export function iconEl(name, size) {
  const s = document.createElement('span');
  s.className = 'ico';
  s.innerHTML = icon(name, size);
  return s;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (['value', 'checked', 'disabled', 'selected', 'multiple'].includes(k)) el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  const add = (c) => {
    if (c == null || c === false) return;
    if (Array.isArray(c)) c.forEach(add);
    else el.append(c.nodeType ? c : document.createTextNode(String(c)));
  };
  kids.forEach(add);
  return el;
}

// ---------- formátovanie ----------
const pad = (n) => String(n).padStart(2, '0');
export const NA = 'nedostupné';
export function fmtDist(m) {
  if (m == null || !isFinite(m)) return NA;
  if (m < 1000) return Math.round(m) + ' m';
  return (m / 1000).toFixed(m >= 100000 ? 0 : m >= 10000 ? 1 : 2).replace('.', ',') + ' km';
}
export function fmtDur(ms) {
  if (ms == null || !isFinite(ms)) return NA;
  const s = Math.round(ms / 1000);
  const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
  return hh > 0 ? `${hh}:${pad(mm)}:${pad(ss)}` : `${mm}:${pad(ss)}`;
}
export function fmtDurShort(ms) {
  if (ms == null || !isFinite(ms)) return '—';
  const totalMin = Math.round(ms / 60000);
  const hh = Math.floor(totalMin / 60), mm = totalMin % 60;
  return hh > 0 ? `${hh} h ${pad(mm)} min` : `${mm} min`;
}
export function fmtSpeed(ms) {
  if (ms == null || !isFinite(ms)) return NA;
  return (ms * 3.6).toFixed(1).replace('.', ',') + ' km/h';
}
export function fmtEle(m) {
  if (m == null || !isFinite(m)) return NA;
  return Math.round(m) + ' m';
}
export function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('sk-SK', { day: 'numeric', month: 'long', year: 'numeric' });
}
export function fmtDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('sk-SK', { day: 'numeric', month: 'long', year: 'numeric' }) + ', ' +
    d.toLocaleTimeString('sk-SK', { hour: '2-digit', minute: '2-digit' });
}
export function fmtMs(ms) {
  if (ms == null) return '—';
  const d = new Date(ms);
  return d.toLocaleDateString('sk-SK') + ' ' + d.toLocaleTimeString('sk-SK');
}
export function monthLabel(key) {
  const [y, m] = key.split('-').map(Number);
  const s = new Date(y, m - 1, 1).toLocaleDateString('sk-SK', { month: 'long', year: 'numeric' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}
export function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export function localKey(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}
export function localDay(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export const uid = () =>
  (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 10));

// ---------- blob URL správa ----------
const urls = new Set();
export function blobUrl(blob) {
  const u = URL.createObjectURL(blob);
  urls.add(u);
  return u;
}
export function revokeAllUrls() {
  urls.forEach((u) => URL.revokeObjectURL(u));
  urls.clear();
}

// ---------- SVG náhľad trasy ----------
export function routeSvg(coords, { stroke = 'var(--accent)', width = 3, dots = true } = {}) {
  if (!coords || coords.length < 2) return '';
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [lo, la] of coords) {
    minX = Math.min(minX, lo); maxX = Math.max(maxX, lo);
    minY = Math.min(minY, la); maxY = Math.max(maxY, la);
  }
  const k = Math.cos(((minY + maxY) / 2) * Math.PI / 180);
  const w = Math.max((maxX - minX) * k, 1e-9), hh = Math.max(maxY - minY, 1e-9);
  const W = 300, H = 180, pad = 22;
  const s = Math.min((W - 2 * pad) / w, (H - 2 * pad) / hh);
  const ox = (W - w * s) / 2, oy = (H - hh * s) / 2;
  const pts = coords.map(([lo, la]) => [(ox + (lo - minX) * k * s).toFixed(1), (oy + (maxY - la) * s).toFixed(1)]);
  const poly = pts.map((p) => p.join(',')).join(' ');
  const a = pts[0], b = pts[pts.length - 1];
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <polyline points="${poly}" fill="none" stroke="rgba(0,0,0,.55)" stroke-width="${width + 3}" stroke-linecap="round" stroke-linejoin="round"/>
    <polyline points="${poly}" fill="none" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>
    ${dots ? `<circle cx="${a[0]}" cy="${a[1]}" r="5" fill="#22c55e" stroke="#fff" stroke-width="2"/><circle cx="${b[0]}" cy="${b[1]}" r="5" fill="#ef4444" stroke="#fff" stroke-width="2"/>` : ''}
  </svg>`;
}

// ---------- toast ----------
export function toast(msg, type = 'info', ms = 3800) {
  const root = document.getElementById('toasts');
  const t = h('div', { class: 'toast ' + type, role: 'status' }, msg);
  root.append(t);
  requestAnimationFrame(() => t.classList.add('in'));
  setTimeout(() => {
    t.classList.remove('in');
    setTimeout(() => t.remove(), 300);
  }, ms);
  return t;
}

// ---------- modálne okno ----------
export function openModal(content, { wide = false, onClose, dismissable = true } = {}) {
  const root = document.getElementById('modal-root');
  const box = h('div', { class: 'modal' + (wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true' }, content);
  const back = h('div', { class: 'modal-back' }, box);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey);
    back.classList.remove('in');
    setTimeout(() => back.remove(), 200);
    onClose && onClose();
  };
  const onKey = (e) => { if (e.key === 'Escape' && dismissable) close(); };
  document.addEventListener('keydown', onKey);
  back.addEventListener('mousedown', (e) => { if (e.target === back && dismissable) close(); });
  root.append(back);
  requestAnimationFrame(() => back.classList.add('in'));
  return { close, box };
}

export function confirmDialog(title, text, confirmLabel = 'Potvrdiť', danger = true) {
  return new Promise((resolve) => {
    let result = false;
    const m = openModal(
      h('div', { class: 'confirm' },
        h('h3', {}, title),
        h('p', {}, text),
        h('div', { class: 'row end' },
          h('button', { class: 'btn ghost', onclick: () => m.close() }, 'Zrušiť'),
          h('button', { class: 'btn ' + (danger ? 'danger' : 'primary'), onclick: () => { result = true; m.close(); } }, confirmLabel))),
      { onClose: () => resolve(result) });
  });
}

export function debounce(fn, ms = 200) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
