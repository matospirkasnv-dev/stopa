// Stránky: zoznam aktivít, mapa všetkých trás, štatistiky
import { repo, settings } from './db.js';
import { mapStyle, BASES } from './mapview.js';
import {
  h, icon, CATEGORIES, catById, fmtDist, fmtDurShort, fmtDate, monthLabel, localKey, localDay, routeSvg, blobUrl, debounce,
} from './util.js';

const byDateDesc = (a, b) => Date.parse(b.activityDate) - Date.parse(a.activityDate); // podľa skutočného dátumu aktivity

export async function renderHome(view) {
  const all = (await repo.getAll()).sort(byDateDesc);
  const f = { q: '', cat: 'all', from: '', to: '' };

  const list = h('div', { class: 'activity-list' });
  const count = h('span', { class: 'muted' });

  const card = (a) => {
    const cat = catById(a.category);
    const media = h('div', { class: 'card-media' });
    if (a.cover) {
      media.append(h('img', { src: blobUrl(a.cover), alt: '', loading: 'lazy' }));
      media.append(h('div', { class: 'card-route-mini', html: routeSvg(a.preview.coords, { width: 3 }) }));
    } else {
      media.classList.add('no-cover');
      media.append(h('div', { class: 'card-route', html: routeSvg(a.preview.coords, { width: 3.5 }) }));
    }
    const s = a.stats || {};
    return h('a', { class: 'card', href: '#/a/' + a.id },
      media,
      h('div', { class: 'card-body' },
        h('span', { class: 'badge', style: `--c:${cat.color}` }, cat.label),
        h('h3', {}, a.title),
        h('p', { class: 'muted' }, fmtDate(a.activityDate))),
      h('div', { class: 'card-stats' },
        h('div', {}, h('b', {}, fmtDist(s.distance)), h('span', {}, 'vzdialenosť')),
        h('div', {}, h('b', {}, fmtDurShort(s.elapsed)), h('span', {}, 'trvanie')),
        h('div', {}, h('b', {}, s.ascent != null ? Math.round(s.ascent) + ' m' : '—'), h('span', {}, 'stúpanie'))));
  };

  const apply = () => {
    const q = f.q.trim().toLowerCase();
    const items = all.filter((a) => {
      if (f.cat !== 'all' && a.category !== f.cat) return false;
      if (q && !(a.title + ' ' + (a.description || '')).toLowerCase().includes(q)) return false;
      const day = localDay(a.activityDate);
      if (f.from && day < f.from) return false;
      if (f.to && day > f.to) return false;
      return true;
    });
    list.replaceChildren();
    count.textContent = items.length === all.length ? `${all.length} aktivít` : `${items.length} z ${all.length}`;
    if (!all.length) {
      list.append(h('div', { class: 'empty' },
        h('div', { class: 'empty-ico', html: icon('map', 40) }),
        h('h2', {}, 'Zatiaľ tu nie sú žiadne aktivity'),
        h('p', {}, 'Nahrajte GPS záznam (GPX, TCX alebo FIT) a pridajte fotografie z výletu. Všetko sa uloží iba vo vašom prehliadači.'),
        h('a', { class: 'btn primary', href: '#/add' }, 'Pridať prvú aktivitu')));
      return;
    }
    if (!items.length) {
      list.append(h('div', { class: 'empty small' }, h('h3', {}, 'Nič sa nenašlo'), h('p', {}, 'Skúste zmeniť vyhľadávanie alebo filtre.')));
      return;
    }
    let curKey = null, grid = null;
    for (const a of items) {
      const k = localKey(a.activityDate);
      if (k !== curKey) {
        curKey = k;
        list.append(h('h2', { class: 'month-title' }, monthLabel(k)));
        grid = h('div', { class: 'grid' });
        list.append(grid);
      }
      grid.append(card(a));
    }
  };

  const chips = h('div', { class: 'chips' },
    ...[{ id: 'all', label: 'Všetky' }, ...CATEGORIES].map((c) =>
      h('button', {
        class: 'chip' + (c.id === 'all' ? ' on' : ''), 'data-cat': c.id,
        onclick: (e) => { f.cat = c.id; chips.querySelectorAll('.chip').forEach((x) => x.classList.toggle('on', x === e.currentTarget)); apply(); },
      }, c.label)));

  view.append(
    h('section', { class: 'page' },
      h('div', { class: 'page-head' },
        h('div', {}, h('h1', {}, 'Moje aktivity'), count)),
      h('div', { class: 'filters' },
        h('label', { class: 'search' }, h('span', { html: icon('search', 18) }),
          h('input', { type: 'search', placeholder: 'Hľadať podľa názvu alebo opisu…', oninput: debounce((e) => { f.q = e.target.value; apply(); }, 120) })),
        h('div', { class: 'dates' },
          h('label', {}, 'Od', h('input', { type: 'date', onchange: (e) => { f.from = e.target.value; apply(); } })),
          h('label', {}, 'Do', h('input', { type: 'date', onchange: (e) => { f.to = e.target.value; apply(); } })))),
      chips,
      list),
    h('a', { class: 'fab', href: '#/add', title: 'Pridať aktivitu', 'aria-label': 'Pridať aktivitu', html: icon('plus', 28) }));
  apply();
}

// ---------- Mapa všetkých aktivít ----------
export async function renderMapPage(view) {
  const all = (await repo.getAll()).sort(byDateDesc);
  const box = h('div', { class: 'allmap' });
  view.append(h('section', { class: 'page wide' },
    h('div', { class: 'page-head' }, h('h1', {}, 'Mapa'), h('span', { class: 'muted' }, `${all.length} aktivít`)),
    all.length ? box : h('div', { class: 'empty' }, h('h2', {}, 'Mapa je zatiaľ prázdna'), h('p', {}, 'Po pridaní aktivít sa tu zobrazia všetky vaše trasy.'), h('a', { class: 'btn primary', href: '#/add' }, 'Pridať aktivitu'))));
  if (!all.length) return;

  const st = settings.get();
  const style = mapStyle();
  const map = new maplibregl.Map({ container: box, style, attributionControl: { compact: true }, bounds: [[0, 0], [1, 1]] });
  map.addControl(new maplibregl.NavigationControl(), 'top-right');
  let minX = 180, maxX = -180, minY = 90, maxY = -90;
  all.forEach((a) => { const [x0, y0, x1, y1] = a.preview.bbox; minX = Math.min(minX, x0); minY = Math.min(minY, y0); maxX = Math.max(maxX, x1); maxY = Math.max(maxY, y1); });
  map.fitBounds([[minX, minY], [maxX, maxY]], { padding: 60, duration: 0, maxZoom: 14 });

  map.on('load', () => {
    Object.entries(BASES).forEach(([k, v]) => map.setLayoutProperty(v.layer, 'visibility', k === st.base ? 'visible' : 'none'));
    map.addSource('acts', {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: all.map((a) => ({ type: 'Feature', properties: { id: a.id, title: a.title, color: catById(a.category).color, date: fmtDate(a.activityDate), dist: fmtDist(a.stats && a.stats.distance) }, geometry: { type: 'LineString', coordinates: a.preview.coords } })),
      },
    });
    map.addLayer({ id: 'acts-casing', type: 'line', source: 'acts', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#05080c', 'line-width': 6, 'line-opacity': 0.6 } });
    map.addLayer({ id: 'acts-line', type: 'line', source: 'acts', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': 3.5 } });
    map.on('mouseenter', 'acts-line', () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'acts-line', () => { map.getCanvas().style.cursor = ''; });
    map.on('click', 'acts-line', (e) => {
      const p = e.features[0].properties;
      const node = h('div', { class: 'popup' }, h('b', {}, p.title), h('div', { class: 'muted' }, `${p.date} · ${p.dist}`), h('a', { href: '#/a/' + p.id }, 'Otvoriť aktivitu →'));
      new maplibregl.Popup({ offset: 8 }).setLngLat(e.lngLat).setDOMContent(node).addTo(map);
    });
  });
  return () => map.remove();
}

// ---------- Štatistiky ----------
export async function renderStats(view) {
  const all = await repo.getAll();
  const years = [...new Set(all.map((a) => new Date(a.activityDate).getFullYear()))].sort((a, b) => b - a);
  const wrap = h('div', {});
  const sel = h('select', { onchange: () => draw() },
    h('option', { value: 'all' }, 'Všetky roky'), ...years.map((y) => h('option', { value: y }, y)));

  const draw = () => {
    const y = sel.value;
    const items = all.filter((a) => y === 'all' || new Date(a.activityDate).getFullYear() === Number(y));
    wrap.replaceChildren();
    if (!items.length) { wrap.append(h('div', { class: 'empty' }, h('h2', {}, 'Žiadne dáta'), h('p', {}, 'Pridajte aktivity, aby sa tu zobrazili štatistiky.'), h('a', { class: 'btn primary', href: '#/add' }, 'Pridať aktivitu'))); return; }
    const sum = (fn) => items.reduce((s, a) => s + (fn(a) || 0), 0);
    const totals = [
      ['Aktivity', items.length],
      ['Vzdialenosť', fmtDist(sum((a) => a.stats.distance))],
      ['Čas', fmtDurShort(sum((a) => a.stats.elapsed))],
      ['Stúpanie', Math.round(sum((a) => a.stats.ascent)) + ' m'],
    ];
    wrap.append(h('div', { class: 'stat-grid' }, ...totals.map(([l, v]) => h('div', { class: 'stat' }, h('span', {}, l), h('b', {}, String(v))))));

    // podľa kategórie
    const bycat = CATEGORIES.map((c) => ({ c, list: items.filter((a) => a.category === c.id) })).filter((x) => x.list.length);
    const maxD = Math.max(...bycat.map((x) => x.list.reduce((s, a) => s + a.stats.distance, 0)));
    wrap.append(h('div', { class: 'panel' }, h('h3', {}, 'Podľa kategórie'),
      ...bycat.map(({ c, list }) => {
        const d = list.reduce((s, a) => s + a.stats.distance, 0);
        return h('div', { class: 'bar-row' },
          h('span', { class: 'bar-label' }, c.label),
          h('div', { class: 'bar-track' }, h('div', { class: 'bar-fill', style: `width:${(d / maxD) * 100}%;background:${c.color}` })),
          h('span', { class: 'bar-val' }, `${fmtDist(d)} · ${list.length}×`));
      })));

    // podľa mesiaca
    const months = {};
    items.forEach((a) => { const k = localKey(a.activityDate); months[k] = (months[k] || 0) + a.stats.distance; });
    const keys = Object.keys(months).sort();
    const maxM = Math.max(...keys.map((k) => months[k]));
    wrap.append(h('div', { class: 'panel' }, h('h3', {}, 'Vzdialenosť podľa mesiaca'),
      h('div', { class: 'cols' }, ...keys.map((k) =>
        h('div', { class: 'col', title: `${monthLabel(k)}: ${fmtDist(months[k])}` },
          h('span', { class: 'col-val' }, (months[k] / 1000).toFixed(0)),
          h('div', { class: 'col-bar', style: `height:${Math.max(3, (months[k] / maxM) * 100)}%` }),
          h('span', { class: 'col-lab' }, k.slice(5) + '/' + k.slice(2, 4)))))));

    // rekordy
    const rec = (label, fn, fmt) => {
      const best = items.filter((a) => fn(a) != null).sort((a, b) => fn(b) - fn(a))[0];
      return h('div', { class: 'stat' }, h('span', {}, label), best ? h('b', {}, fmt(fn(best))) : h('b', { class: 'muted' }, 'nedostupné'), best && h('a', { href: '#/a/' + best.id }, best.title));
    };
    wrap.append(h('div', { class: 'panel' }, h('h3', {}, 'Rekordy'),
      h('div', { class: 'stat-grid' },
        rec('Najdlhšia trasa', (a) => a.stats.distance, fmtDist),
        rec('Najviac nastúpané', (a) => a.stats.ascent, (v) => Math.round(v) + ' m'),
        rec('Najvyšší bod', (a) => a.stats.eleMax, (v) => Math.round(v) + ' m n. m.'),
        rec('Najdlhšie trvanie', (a) => a.stats.elapsed, fmtDurShort))));
  };

  view.append(h('section', { class: 'page' },
    h('div', { class: 'page-head' }, h('h1', {}, 'Štatistiky'), sel), wrap));
  draw();
}
