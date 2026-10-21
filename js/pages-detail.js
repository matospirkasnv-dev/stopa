// Detail aktivity: štatistiky, 3D mapa, prehrávanie, grafy, fotografie
import { repo, settings } from './db.js';
import { derive, nearestIndex } from './geo.js';
import { TrackMap, Player, BASES } from './mapview.js';
import { ProfileChart } from './charts.js';
import { processImageFile, applyMatch, methodLabel, resizeImage } from './photos.js';
import {
  h, icon, CATEGORIES, catById, toast, openModal, confirmDialog, blobUrl, toLocalInput,
  fmtDist, fmtDur, fmtSpeed, fmtEle, fmtDateTime, fmtDate, NA,
} from './util.js';

function smoothArr(a, win) {
  const out = new Float32Array(a.length), half = win >> 1;
  for (let i = 0; i < a.length; i++) {
    let s = 0, c = 0;
    for (let k = Math.max(0, i - half); k <= Math.min(a.length - 1, i + half); k++) if (Number.isFinite(a[k])) { s += a[k]; c++; }
    out[i] = c ? s / c : NaN;
  }
  return out;
}

export async function renderDetail(view, id) {
  const act = await repo.get(id);
  const track = act && (await repo.getTrack(id));
  if (!act || !track) {
    view.append(h('section', { class: 'page narrow' }, h('div', { class: 'empty' }, h('h2', {}, 'Aktivita sa nenašla'), h('p', {}, 'Možno bola vymazaná.'), h('a', { class: 'btn primary', href: '#/' }, 'Späť na aktivity'))));
    return;
  }
  let photos = await repo.getPhotos(id);
  const d = derive(track);
  const st = settings.get();
  const cleanups = [];

  const urlCache = new Map();
  const thumbUrl = (p) => { const k = 't' + p.id; if (!urlCache.has(k)) urlCache.set(k, blobUrl(p.thumb)); return urlCache.get(k); };
  const fullUrl = (p) => { const k = 'f' + p.id; if (!urlCache.has(k)) urlCache.set(k, blobUrl(p.blob)); return urlCache.get(k); };

  // ---------- hlavička ----------
  const head = h('div', { class: 'detail-head' });
  function renderHead() {
    const cat = catById(act.category), s = act.stats;
    head.replaceChildren(
      h('a', { class: 'back', href: '#/' }, h('span', { html: icon('left', 18) }), 'Aktivity'),
      h('div', { class: 'title-row' },
        h('div', {},
          h('span', { class: 'badge', style: `--c:${cat.color}` }, cat.label),
          h('h1', {}, act.title),
          h('p', { class: 'meta' },
            `Uskutočnená: ${fmtDateTime(act.activityDate)}`,
            h('span', { class: 'dot' }, '·'), `${fmtDist(s.distance)}`,
            s.elapsed != null ? [h('span', { class: 'dot' }, '·'), fmtDur(s.elapsed)] : null),
          h('p', { class: 'meta muted small' }, `Pridané do aplikácie: ${fmtDate(act.addedAt)} · zdroj: ${act.source ? act.source.fileName : '—'}`)),
        h('div', { class: 'actions' },
          h('button', { class: 'btn ghost', onclick: editActivity }, h('span', { html: icon('edit', 18) }), 'Upraviť'),
          h('button', { class: 'btn ghost danger-text', onclick: deleteActivity }, h('span', { html: icon('trash', 18) }), 'Vymazať'))),
      ...(act.description ? [h('p', { class: 'desc' }, act.description)] : []));
  }

  // ---------- štatistiky ----------
  const s = act.stats;
  const stat = (l, v) => h('div', { class: 'stat' }, h('span', {}, l), h('b', { class: v === NA ? 'muted' : '' }, v));
  const statGrid = h('div', { class: 'stat-grid' },
    stat('Vzdialenosť', fmtDist(s.distance)),
    stat('Celkový čas', fmtDur(s.elapsed)),
    stat('Čas v pohybe', fmtDur(s.moving)),
    stat('Priem. rýchlosť (v pohybe)', fmtSpeed(s.avgSpeed)),
    stat('Max. rýchlosť', fmtSpeed(s.maxSpeed)),
    stat('Najvyšší bod', fmtEle(s.eleMax)),
    stat('Najnižší bod', fmtEle(s.eleMin)),
    stat('Nastúpané', s.ascent != null ? Math.round(s.ascent) + ' m' : NA),
    stat('Naklesané', s.descent != null ? Math.round(s.descent) + ' m' : NA));

  const notices = [];
  if (act.elevationSource === 'api') notices.push('Nadmorská výška nebola v súbore – bola doplnená z výškového modelu Open-Meteo (približné hodnoty).');
  if (act.elevationSource === 'none') notices.push('Súbor neobsahuje nadmorskú výšku a zdroj výškových dát nebol dostupný, preto výškové štatistiky a profil nie sú k dispozícii. 3D terén na mape sa stále zobrazuje z mapových dlaždíc.');
  if (!d.hasTime) notices.push('Súbor neobsahuje časové značky – časy a rýchlosti nie sú dostupné, prehrávanie prebieha podľa vzdialenosti.');

  // ---------- mapa + ovládanie ----------
  const mapEl = h('div', { class: 'map' });
  const pickBanner = h('div', { class: 'pick-banner hidden' });
  const mapNote = h('div', { class: 'map-note hidden' });
  const seg = (items, cur, on) => {
    const box = h('div', { class: 'seg' });
    items.forEach(([val, label]) => box.append(h('button', {
      class: val === cur ? 'on' : '', type: 'button',
      onclick: (e) => { box.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === e.currentTarget)); on(val); },
    }, label)));
    return box;
  };
  let tm;
  const toolbar = h('div', { class: 'map-toolbar' },
    seg([['3d', '3D'], ['2d', '2D']], st.start3d ? '3d' : '2d', (v) => { settings.set({ start3d: v === '3d' }); tm.setMode(v === '3d'); exagWrap.classList.toggle('hidden', v !== '3d'); }),
    seg(Object.entries(BASES).map(([k, v]) => [k, v.label]), st.base, (v) => tm.setBase(v)),
    h('div', { class: 'btn-group' },
      h('button', { class: 'btn ghost sm', onclick: () => tm.goTo(0) }, 'Začiatok'),
      h('button', { class: 'btn ghost sm', onclick: () => tm.goTo(d.n - 1) }, 'Koniec'),
      h('button', { class: 'btn ghost sm', onclick: () => tm.fitRoute() }, 'Celá trasa')));
  const exagInput = h('input', { type: 'range', min: 1, max: 3, step: 0.1, value: st.exaggeration, oninput: (e) => tm.setExaggeration(Number(e.target.value)), onchange: (e) => settings.set({ exaggeration: Number(e.target.value) }) });
  const exagWrap = h('label', { class: 'inline' + (st.start3d ? '' : ' hidden') }, 'Prevýšenie terénu', exagInput);
  toolbar.append(exagWrap);

  // prehrávač
  const playBtn = h('button', { class: 'btn primary round', title: 'Prehrať / pozastaviť', 'aria-label': 'Prehrať trasu', html: icon('play', 20) + '<span>Prehrať trasu</span>' });
  const restartBtn = h('button', { class: 'btn ghost round', title: 'Reštart', 'aria-label': 'Reštart', html: icon('restart', 18) });
  const slider = h('input', { type: 'range', min: 0, max: 1000, value: 0, class: 'scrub', 'aria-label': 'Poloha na trase' });
  const rd = {
    t: h('b', {}, '—'), dist: h('b', {}, '—'), spd: h('b', {}, '—'), ele: h('b', {}, '—'),
  };
  const readouts = h('div', { class: 'readouts' },
    h('div', {}, h('span', {}, 'Čas'), rd.t), h('div', {}, h('span', {}, 'Vzdialenosť'), rd.dist),
    h('div', {}, h('span', {}, 'Rýchlosť'), rd.spd), h('div', {}, h('span', {}, 'Výška'), rd.ele));
  const speeds = [0.5, 1, 2, 5, 10];
  const speedSeg = seg(speeds.map((v) => [v, String(v).replace('.', ',') + '×']), 1, (v) => player.setSpeed(v));
  speedSeg.title = '1× = celá aktivita sa prehrá približne za minútu';
  const followChk = h('input', { type: 'checkbox', checked: true, onchange: (e) => player.setFollow(e.target.checked) });
  const player_ui = h('div', { class: 'player' },
    h('div', { class: 'player-row' }, playBtn, restartBtn, slider),
    h('div', { class: 'player-row wrap' },
      readouts,
      h('div', { class: 'player-opts' }, speedSeg,
        h('label', { class: 'check' }, followChk, 'Kamera sleduje značku'))));

  // ---------- grafy ----------
  const chartCard = (title, canvas, na) => h('div', { class: 'panel chart-card' }, h('h3', {}, title), na ? h('p', { class: 'muted' }, na) : canvas);
  const eleCanvas = h('canvas', { class: 'chart', 'aria-label': 'Výškový profil' });
  const spdCanvas = h('canvas', { class: 'chart', 'aria-label': 'Graf rýchlosti' });
  const charts = [];
  let player;

  // ---------- fotografie ----------
  const photoGrid = h('div', { class: 'photo-grid' });
  const unplacedBox = h('div', { class: 'unplaced' });
  const photosInfo = h('p', { class: 'muted small' });
  const addInput = h('input', { type: 'file', accept: 'image/*', multiple: true, class: 'sr-only', id: 'addphotos', onchange: (e) => addPhotos([...e.target.files]) });
  let shift = 0;

  const sortedPhotos = () => [...photos].sort((a, b) => (a.trackIndex ?? 1e12) - (b.trackIndex ?? 1e12) || (a.takenAt ?? 0) - (b.takenAt ?? 0) || a.name.localeCompare(b.name));
  const shortMethod = (p) => (p.method === 'manual' ? 'ručne' : p.method ? 'automaticky' : 'nepriradená');

  function renderPhotos() {
    const list = sortedPhotos();
    photoGrid.replaceChildren(...list.map((p) =>
      h('button', { class: 'ph-tile' + (p.pos ? '' : ' unplaced-tile'), onclick: () => openLightbox(p), title: p.caption || p.name },
        h('img', { src: thumbUrl(p), alt: p.caption || p.name, loading: 'lazy' }),
        h('span', { class: 'ph-tag ' + (p.method ? '' : 'warn') }, shortMethod(p)))));
    const un = list.filter((p) => !p.pos);
    unplacedBox.replaceChildren(...(un.length ? [
      h('h4', {}, `Nepriradené fotografie (${un.length})`),
      h('p', { class: 'muted small' }, 'Tieto fotografie nemajú použiteľnú polohu ani čas. Umiestnite ich ručne na trasu, alebo ich nechajte nepriradené.'),
      h('div', { class: 'unplaced-list' }, ...un.map((p) => h('div', { class: 'photo-row' },
        h('img', { src: thumbUrl(p), alt: '' }), h('div', { class: 'grow' }, h('b', {}, p.name)),
        h('button', { class: 'btn ghost sm', onclick: () => startPick(p) }, 'Umiestniť na mape'))))] : []));
    photosInfo.textContent = list.length ? `${list.length} fotografií, ${list.filter((p) => p.pos).length} umiestnených na mape.` : 'Zatiaľ žiadne fotografie. Pridajte ich a aplikácia ich sama umiestni na trasu.';
    tm && tm.setPhotos(list, thumbUrl, openLightbox);
  }

  async function addPhotos(files) {
    if (!files.length) return;
    const t = toast(`Spracúvam fotografie (0/${files.length})…`, 'info', 60000);
    const added = [];
    let n = 0;
    for (const f of files) {
      try {
        const p = await processImageFile(f);
        p.activityId = id;
        applyMatch(p, track, d, shift);
        added.push(p);
      } catch (err) { toast(err.message, 'error'); }
      t.textContent = `Spracúvam fotografie (${++n}/${files.length})…`;
    }
    t.remove();
    addInput.value = '';
    if (added.length) {
      await repo.putPhotos(added);
      photos.push(...added);
      renderPhotos();
      const placed = added.filter((p) => p.pos).length;
      toast(`Pridané ${added.length} fotografií, automaticky umiestnených ${placed}.`, 'success');
    }
  }

  async function savePhoto(p) { await repo.putPhoto(p); renderPhotos(); }

  function startPick(p) {
    mapEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    pickBanner.classList.remove('hidden');
    pickBanner.replaceChildren(
      h('span', {}, 'Kliknite na mape miesto, kde bola fotografia urobená – umiestni sa na najbližší bod trasy.'),
      h('button', { class: 'btn ghost sm', onclick: () => { tm.cancelPick(); pickBanner.classList.add('hidden'); } }, 'Zrušiť'));
    tm.startPick(async (ll) => {
      pickBanner.classList.add('hidden');
      const { index } = nearestIndex(track, ll.lat, ll.lng);
      p.pos = { lat: track.lat[index], lon: track.lon[index] };
      p.trackIndex = index; p.method = 'manual';
      await savePhoto(p);
      toast('Poloha fotografie bola uložená.', 'success');
    });
  }

  function openLightbox(p) {
    let list = sortedPhotos(), idx = list.findIndex((x) => x.id === p.id);
    const img = h('img', { class: 'lb-img', alt: '' });
    const caption = h('textarea', { rows: 3, maxlength: 600, placeholder: 'Popis fotografie…' });
    const meta = h('div', { class: 'lb-meta' });
    const method = h('span', { class: 'pill' });
    let cur = p;
    const flush = async () => {
      const v = caption.value.trim();
      if (v !== (cur.caption || '')) { cur.caption = v; await savePhoto(cur); }
    };
    const show = (i) => {
      cur = list[i]; idx = i;
      img.src = fullUrl(cur);
      caption.value = cur.caption || '';
      method.textContent = methodLabel(cur.method);
      method.className = 'pill ' + (cur.method ? 'ok' : 'warn');
      meta.replaceChildren(
        h('div', {}, h('span', {}, 'Čas fotografie'), h('b', {}, cur.takenAt != null ? fmtDateTime(new Date(cur.takenAt).toISOString()) : 'neznámy')),
        h('div', {}, h('span', {}, 'Poloha'), h('b', {}, cur.pos ? `${cur.pos.lat.toFixed(5)}, ${cur.pos.lon.toFixed(5)}` : 'nepriradená')));
    };
    const go = async (dlt) => { await flush(); const i = (idx + dlt + list.length) % list.length; show(i); };
    const onKey = (e) => {
      if (e.target.tagName === 'TEXTAREA') return;
      if (e.key === 'ArrowLeft') go(-1); else if (e.key === 'ArrowRight') go(1);
    };
    document.addEventListener('keydown', onKey);
    const m = openModal(h('div', { class: 'lightbox' },
      h('div', { class: 'lb-stage' },
        list.length > 1 ? h('button', { class: 'lb-nav l', 'aria-label': 'Predchádzajúca', html: icon('left', 26), onclick: () => go(-1) }) : null,
        img,
        list.length > 1 ? h('button', { class: 'lb-nav r', 'aria-label': 'Ďalšia', html: icon('right', 26), onclick: () => go(1) }) : null),
      h('div', { class: 'lb-side' },
        h('div', { class: 'row between' }, h('h3', {}, 'Fotografia'), h('button', { class: 'icon-btn', 'aria-label': 'Zavrieť', html: icon('close', 20), onclick: () => m.close() })),
        method, meta,
        h('label', {}, 'Popis', caption),
        h('div', { class: 'col-btns' },
          h('button', { class: 'btn primary', onclick: async () => { await flush(); toast('Popis uložený.', 'success'); } }, 'Uložiť popis'),
          h('button', { class: 'btn ghost', onclick: async () => { await flush(); m.close(); startPick(cur); } }, h('span', { html: icon('pin', 18) }), 'Zmeniť polohu na trase'),
          h('button', { class: 'btn ghost', onclick: async () => { act.cover = cur.blob; await repo.putActivity(act); toast('Nastavené ako titulná fotografia.', 'success'); } }, h('span', { html: icon('image', 18) }), 'Nastaviť ako titulnú'),
          h('button', { class: 'btn ghost danger-text', onclick: async () => {
            const ok = await confirmDialog('Odstrániť fotografiu?', 'Fotografia bude odstránená z tejto aktivity.', 'Odstrániť');
            if (!ok) return;
            await repo.deletePhoto(cur.id);
            photos = photos.filter((x) => x.id !== cur.id);
            m.close(); renderPhotos(); toast('Fotografia bola odstránená.');
          } }, h('span', { html: icon('trash', 18) }), 'Odstrániť')))),
      { wide: true, onClose: () => { document.removeEventListener('keydown', onKey); flush(); } });
    show(idx);
  }

  // ---------- úprava a mazanie aktivity ----------
  function editActivity() {
    const title = h('input', { type: 'text', value: act.title, maxlength: 120 });
    const cat = h('select', {}, ...CATEGORIES.map((c) => h('option', { value: c.id, selected: c.id === act.category }, c.label)));
    const date = h('input', { type: 'datetime-local', value: toLocalInput(act.activityDate) });
    const desc = h('textarea', { rows: 4, maxlength: 2000 }, '');
    desc.value = act.description || '';
    let newCover;
    const coverNote = h('small', { class: 'muted' }, act.cover ? 'Titulná fotografia je nastavená.' : 'Bez titulnej fotografie.');
    const m = openModal(h('div', { class: 'edit-form' },
      h('h3', {}, 'Upraviť aktivitu'),
      h('div', { class: 'form-grid' },
        h('label', { class: 'full' }, 'Názov', title),
        h('label', {}, 'Kategória', cat),
        h('label', {}, 'Dátum a čas uskutočnenia', date),
        h('label', { class: 'full' }, 'Opis', desc),
        h('div', { class: 'full' }, h('span', { class: 'lbl' }, 'Titulná fotografia'),
          h('div', { class: 'row' },
            h('label', { class: 'btn ghost' }, 'Vybrať novú…', h('input', { type: 'file', accept: 'image/*', class: 'sr-only', onchange: async (e) => {
              const f = e.target.files[0]; if (!f) return;
              try { newCover = await resizeImage(f, 1200, 0.85); coverNote.textContent = 'Nová titulná fotografia: ' + f.name; } catch (err) { toast(err.message, 'error'); }
            } })),
            h('button', { class: 'btn ghost', type: 'button', onclick: () => { newCover = null; coverNote.textContent = 'Titulná fotografia bude odstránená.'; } }, 'Odstrániť')),
          coverNote)),
      h('div', { class: 'row end' },
        h('button', { class: 'btn ghost', onclick: () => m.close() }, 'Zrušiť'),
        h('button', { class: 'btn primary', onclick: async () => {
          if (!title.value.trim()) return toast('Zadajte názov.', 'error');
          if (!date.value) return toast('Zadajte dátum uskutočnenia.', 'error');
          act.title = title.value.trim(); act.category = cat.value; act.description = desc.value.trim();
          const iso = new Date(date.value).toISOString();
          if (iso !== act.activityDate) { act.activityDate = iso; act.dateSource = 'manual'; }
          if (newCover !== undefined) act.cover = newCover;
          await repo.putActivity(act);
          m.close(); renderHead(); toast('Zmeny boli uložené.', 'success');
        } }, 'Uložiť zmeny'))));
  }

  async function deleteActivity() {
    const ok = await confirmDialog('Vymazať aktivitu?', `Aktivita „${act.title}“ vrátane trasy a fotografií bude natrvalo odstránená.`, 'Vymazať');
    if (!ok) return;
    await repo.remove(id);
    toast('Aktivita bola vymazaná.');
    location.hash = '#/';
  }

  // ---------- zloženie stránky ----------
  renderHead();
  const photosPanel = h('div', { class: 'panel' },
    h('div', { class: 'row between' },
      h('h3', {}, h('span', { html: icon('camera', 18) }), ' Fotografie'),
      h('div', { class: 'row' },
        h('label', { class: 'inline small', title: 'Posun času fotoaparátu voči GPS (pri nových fotografiách)' }, 'Posun času (min)',
          h('input', { type: 'number', value: 0, step: 1, class: 'tiny', onchange: (e) => { shift = Number(e.target.value) || 0; } })),
        h('label', { class: 'btn primary sm', for: 'addphotos' }, h('span', { html: icon('plus', 16) }), 'Pridať fotografie'), addInput)),
    photosInfo, photoGrid, unplacedBox);

  view.append(h('section', { class: 'page wide detail' },
    head,
    ...notices.map((n) => h('div', { class: 'notice warn' }, n)),
    statGrid,
    h('div', { class: 'viewer panel flush' }, toolbar, h('div', { class: 'map-wrap' }, mapEl, pickBanner, mapNote), player_ui),
    h('div', { class: 'charts' },
      chartCard('Výškový profil', eleCanvas, d.hasEle ? null : 'Nadmorská výška nie je dostupná.'),
      chartCard('Rýchlosť', spdCanvas, d.hasSpeed ? null : 'Rýchlosť nie je dostupná (súbor neobsahuje časové značky).')),
    photosPanel));

  const onProblem = (kind, src, msg) => {
    const bits = [];
    if (kind === 'context') {
      try { player.pause(); setPlayIcon(false); } catch { /* ignore */ }
      toolbar.querySelectorAll('.seg')[0].querySelectorAll('button')[1].click(); // prepnúť na 2D
      bits.push('Grafika prehliadača sa pri 3D zobrazení preťažila, preto sa prehrávanie zastavilo a mapa sa prepla na 2D. Skúste znížiť prevýšenie terénu alebo zavrieť ďalšie karty.');
    } else if (kind === 'slow') {
      bits.push('Podklad mapy sa načítava neobvykle dlho – dlaždice sa k vám pravdepodobne nedostávajú (blokovač reklám, firewall alebo sieť). Trasa sa zobrazuje aj bez podkladu. Skúste iný podklad alebo 2D.' + (msg ? ' Chyba: ' + msg : ''));
    } else {
      bits.push(`Mapové dlaždice sa nenačítavajú (zdroj: ${src}). Podklad môže byť dočasne preťažený alebo blokovaný – skúste iný podklad.` + (msg ? ' Chyba: ' + msg : ''));
    }
    mapNote.replaceChildren(h('span', {}, bits[0]),
      ...(kind !== 'context' ? Object.entries(BASES).map(([k, v]) => h('button', { class: 'btn ghost sm', onclick: () => { tm.setBase(k); settings.set({ base: k }); mapNote.classList.add('hidden'); } }, v.label)) : []),
      h('button', { class: 'btn ghost sm', onclick: () => mapNote.classList.add('hidden') }, 'Zavrieť'));
    mapNote.classList.remove('hidden');
  };
  tm = new TrackMap(mapEl, { track, derived: d, exag: st.exaggeration, base: st.base, mode3d: st.start3d, onProblem });
  cleanups.push(() => tm.destroy());
  renderPhotos();

  // grafy
  const onTick = (smp) => { charts.forEach((c) => c.setCursor(smp.i)); };
  const mkChart = (canvas, ys, color, fmtY, unit, nonNeg) => new ProfileChart(canvas, {
    xs: d.dist, ys, color, fmtY, unit, nonNeg,
    onHover: (i) => tm.setCursor(i),
    onLeave: () => tm.setCursor(null),
    onClick: (i) => { tm.setCursor(i); player.seekIndex(i); tm.map.easeTo({ center: [track.lon[i], track.lat[i]], duration: 500 }); },
  });
  if (d.hasEle) charts.push(mkChart(eleCanvas, d.eleS, '#4ade80', (v) => Math.round(v) + ' m', 'm'));
  if (d.hasSpeed) {
    const kmh = new Float32Array(d.n);
    for (let i = 0; i < d.n; i++) kmh[i] = Number.isFinite(d.speed[i]) ? d.speed[i] * 3.6 : NaN;
    charts.push(mkChart(spdCanvas, smoothArr(kmh, 5), '#38bdf8', (v) => v.toFixed(1).replace('.', ',') + ' km/h', '', true));
  }
  cleanups.push(() => charts.forEach((c) => c.destroy()));

  // prehrávač
  const setPlayIcon = (playing) => { playBtn.innerHTML = icon(playing ? 'pause' : 'play', 20) + `<span>${playing ? 'Pozastaviť' : 'Prehrať trasu'}</span>`; };
  player = new Player(tm, {
    onTick: (smp, u, frac) => {
      onTick(smp);
      slider.value = Math.round(frac * 1000);
      rd.t.textContent = smp.t != null ? fmtDur(smp.t) : '—';
      rd.dist.textContent = fmtDist(smp.dist);
      rd.spd.textContent = smp.speed != null ? fmtSpeed(smp.speed) : NA;
      rd.ele.textContent = smp.ele != null ? fmtEle(smp.ele) : NA;
    },
    onEnd: () => setPlayIcon(false),
  });
  cleanups.push(() => player.destroy());
  playBtn.addEventListener('click', () => { setPlayIcon(player.toggle()); });
  restartBtn.addEventListener('click', () => { player.restart(); setPlayIcon(false); });
  slider.addEventListener('input', () => { player.seekFrac(Number(slider.value) / 1000); });
  tm.whenReady(() => player.emit(0, true) || tm.showPlayhead(false));

  return () => cleanups.forEach((f) => { try { f(); } catch { /* ignore */ } });
}
