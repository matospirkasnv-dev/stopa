// Smerovač a navigácia
import { renderHome, renderMapPage, renderStats } from './pages-home.js';
import { renderAdd } from './pages-add.js';
import { renderDetail } from './pages-detail.js';
import { renderSettings } from './pages-settings.js';
import { requestPersistence } from './db.js';
import { h, icon, revokeAllUrls } from './util.js';

const NAV = [
  { href: '#/', icon: 'list', label: 'Aktivity', match: /^#\/?$|^#\/a\// },
  { href: '#/map', icon: 'map', label: 'Mapa', match: /^#\/map/ },
  { href: '#/stats', icon: 'chart', label: 'Štatistiky', match: /^#\/stats/ },
  { href: '#/add', icon: 'plus', label: 'Pridať aktivitu', short: 'Pridať', match: /^#\/add/ },
  { href: '#/settings', icon: 'settings', label: 'Nastavenia', short: 'Nastavenia', match: /^#\/settings/ },
];

const view = document.getElementById('view');
let cleanup = null;
let token = 0;

function buildNav() {
  const link = (n, cls) => h('a', { class: cls, href: n.href, 'data-nav': n.href }, h('span', { html: icon(n.icon, 20) }), h('span', { class: 'lbl' }, cls === 'tab' ? n.short || n.label : n.label));
  document.getElementById('topnav').replaceChildren(...NAV.map((n) => link(n, 'navlink')));
  document.getElementById('tabbar').replaceChildren(...NAV.map((n) => link(n, 'tab')));
}

function setActive(hash) {
  const cur = NAV.find((n) => n.match.test(hash));
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', !!cur && a.dataset.nav === cur.href));
}

async function route() {
  const my = ++token;
  if (cleanup) { try { cleanup(); } catch (e) { console.warn(e); } cleanup = null; }
  revokeAllUrls();
  document.getElementById('modal-root').replaceChildren();
  view.replaceChildren();
  const hash = location.hash || '#/';
  setActive(hash);
  const tmp = document.createElement('div');
  tmp.className = 'route-host';
  view.append(tmp);
  try {
    let fn = null;
    let m;
    if (/^#\/?$/.test(hash)) fn = () => renderHome(tmp);
    else if (/^#\/map/.test(hash)) fn = () => renderMapPage(tmp);
    else if (/^#\/stats/.test(hash)) fn = () => renderStats(tmp);
    else if (/^#\/add/.test(hash)) fn = () => renderAdd(tmp);
    else if (/^#\/settings/.test(hash)) fn = () => renderSettings(tmp);
    else if ((m = hash.match(/^#\/a\/(.+)$/))) fn = () => renderDetail(tmp, decodeURIComponent(m[1]));
    else fn = () => renderHome(tmp);
    const c = await fn();
    if (my !== token) { if (typeof c === 'function') c(); return; } // medzitým sa zmenila stránka
    cleanup = typeof c === 'function' ? c : null;
  } catch (err) {
    console.error(err);
    tmp.replaceChildren(h('div', { class: 'empty' }, h('h2', {}, 'Niečo sa pokazilo'), h('p', {}, String(err.message || err)), h('a', { class: 'btn primary', href: '#/' }, 'Späť na aktivity')));
  }
  window.scrollTo(0, 0);
}

buildNav();
window.addEventListener('hashchange', route);
requestPersistence();
if (typeof maplibregl === 'undefined') {
  view.append(h('div', { class: 'empty' }, h('h2', {}, 'Nepodarilo sa načítať knižnicu máp'), h('p', {}, 'Skontrolujte pripojenie na internet a obnovte stránku.')));
}
route();
