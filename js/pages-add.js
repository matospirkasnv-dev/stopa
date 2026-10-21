// Stránka „Pridať aktivitu“: import GPS súboru, náhľad, fotografie, uloženie
import { repo, requestPersistence } from './db.js';
import { parseTrackFile, derive, computeStats, previewOf, fetchElevations } from './geo.js';
import { processImageFile, resizeImage, applyMatch, methodLabel } from './photos.js';
import {
  h, icon, CATEGORIES, uid, toast, fmtDist, fmtDur, fmtSpeed, fmtEle, fmtDate, fmtDateTime, NA, routeSvg, blobUrl, toLocalInput,
} from './util.js';

export async function renderAdd(view) {
  const S = { file: null, parsed: null, d: null, stats: null, elevSource: 'file', photos: [], cover: null, shift: 0, dateSource: null };
  const root = h('section', { class: 'page narrow' });
  view.append(root);

  const preview = h('div', { class: 'panel hidden' });
  const form = h('div', { class: 'panel hidden' });
  const photoPanel = h('div', { class: 'panel' });
  const saveBar = h('div', { class: 'savebar hidden' });
  const status = h('div', { class: 'notice hidden' });

  // ----- 1. súbor -----
  const fileInput = h('input', { type: 'file', accept: '.gpx,.tcx,.fit', id: 'gpsfile', class: 'sr-only', onchange: (e) => e.target.files[0] && loadFile(e.target.files[0]) });
  const drop = h('label', { class: 'drop', for: 'gpsfile' },
    h('span', { class: 'drop-ico', html: icon('upload', 30) }),
    h('b', {}, 'Vyberte alebo pretiahnite GPS súbor'),
    h('span', { class: 'muted' }, 'Podporované formáty: GPX, TCX, FIT'));
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => { const f = e.dataTransfer.files[0]; if (f) loadFile(f); });

  const showStatus = (msg, kind = 'info') => {
    status.className = 'notice ' + kind;
    status.replaceChildren(msg);
  };

  async function loadFile(file) {
    showStatus('Načítavam súbor…');
    try {
      const parsed = await parseTrackFile(file);
      S.file = file; S.parsed = parsed;
      S.d = derive(parsed.track);
      S.elevSource = S.d.hasEle ? 'file' : 'none';
      const notes = [];
      if (!S.d.hasEle) {
        showStatus('Súbor neobsahuje nadmorskú výšku – doplňam ju z výškového modelu…');
        try {
          const ele = await fetchElevations(parsed.track, S.d);
          parsed.track.ele = ele;
          S.d = derive(parsed.track);
          S.elevSource = 'api';
          notes.push('Súbor neobsahuje nadmorskú výšku – bola doplnená z výškového modelu Open-Meteo (približné hodnoty, rozlíšenie ~90 m).');
        } catch {
          notes.push('Súbor neobsahuje nadmorskú výšku a zdroj výškových dát sa nepodarilo kontaktovať. Výškové štatistiky a profil nebudú dostupné; 3D terén na mape sa zobrazí z mapových dlaždíc.');
        }
      }
      if (!S.d.hasTime) notes.push('Súbor neobsahuje časové značky – čas, rýchlosť a časové priradenie fotografií nie sú dostupné. Prehrávanie prebehne podľa vzdialenosti.');
      S.stats = computeStats(parsed.track, S.d);
      S.dateSource = S.d.hasTime ? 'file' : 'manual';
      S.startIso = S.d.hasTime ? new Date(parsed.track.t[0]).toISOString() : null;
      status.className = notes.length ? 'notice warn' : 'notice hidden';
      status.replaceChildren(...notes.map((n) => h('div', {}, n)));
      drop.querySelector('b').textContent = file.name;
      buildPreview(); buildForm(); rematch(); updateSave();
    } catch (err) {
      showStatus(err.message || 'Súbor sa nepodarilo načítať.', 'error');
    }
  }

  // ----- 2. náhľad a štatistiky -----
  function buildPreview() {
    const s = S.stats, pv = previewOf(S.parsed.track);
    const stat = (l, v) => h('div', { class: 'stat' }, h('span', {}, l), h('b', { class: v === NA ? 'muted' : '' }, v));
    preview.classList.remove('hidden');
    preview.replaceChildren(
      h('h3', {}, 'Náhľad trasy'),
      h('div', { class: 'preview-grid' },
        h('div', { class: 'route-preview', html: routeSvg(pv.coords, { width: 4 }) }),
        h('div', { class: 'stat-grid compact' },
          stat('Vzdialenosť', fmtDist(s.distance)),
          stat('Celkový čas', fmtDur(s.elapsed)),
          stat('Čas v pohybe', fmtDur(s.moving)),
          stat('Priem. rýchlosť', fmtSpeed(s.avgSpeed)),
          stat('Max. rýchlosť', fmtSpeed(s.maxSpeed)),
          stat('Nastúpané', s.ascent != null ? Math.round(s.ascent) + ' m' : NA),
          stat('Naklesané', s.descent != null ? Math.round(s.descent) + ' m' : NA),
          stat('Najvyšší / najnižší', s.eleMax != null ? `${fmtEle(s.eleMax)} / ${fmtEle(s.eleMin)}` : NA))),
      h('p', { class: 'muted small' }, `Formát ${S.parsed.format} · ${S.parsed.track.lat.length.toLocaleString('sk-SK')} GPS bodov`));
  }

  // ----- 3. formulár -----
  let tTitle, tCat, tDate, tDesc, coverPrev;
  function buildForm() {
    const p = S.parsed;
    const baseName = S.file.name.replace(/\.[^.]+$/, '');
    tTitle = h('input', { type: 'text', required: true, value: p.name || baseName, maxlength: 120, oninput: updateSave });
    tCat = h('select', {}, ...CATEGORIES.map((c) => h('option', { value: c.id, selected: c.id === (p.category || 'other') }, c.label)));
    tDate = h('input', { type: 'datetime-local', required: true, value: toLocalInput(S.startIso), oninput: updateSave });
    tDesc = h('textarea', { rows: 3, maxlength: 2000, placeholder: 'Krátky opis výletu…' });
    coverPrev = h('div', { class: 'cover-prev muted small' }, 'Bez titulnej fotografie – na karte sa zobrazí náhľad trasy.');
    form.classList.remove('hidden');
    form.replaceChildren(
      h('h3', {}, 'Údaje o aktivite'),
      h('div', { class: 'form-grid' },
        h('label', { class: 'full' }, 'Názov', tTitle),
        h('label', {}, 'Kategória', tCat),
        h('label', {}, 'Dátum a čas uskutočnenia', tDate,
          S.dateSource === 'file'
            ? h('small', { class: 'muted' }, 'Prevzaté zo súboru – môžete upraviť.')
            : h('small', { class: 'warn-text' }, 'Súbor neobsahuje dátum – zadajte, kedy sa aktivita uskutočnila.')),
        h('label', { class: 'full' }, 'Opis', tDesc),
        h('div', { class: 'full' },
          h('span', { class: 'lbl' }, 'Titulná fotografia'),
          h('div', { class: 'row' },
            h('label', { class: 'btn ghost' }, h('span', { html: icon('image', 18) }), 'Vybrať…',
              h('input', { type: 'file', accept: 'image/*', class: 'sr-only', onchange: async (e) => {
                const f = e.target.files[0]; if (!f) return;
                try { S.cover = await resizeImage(f, 1200, 0.85); coverPrev.replaceChildren(h('img', { src: blobUrl(S.cover), alt: '' })); }
                catch (err) { toast(err.message, 'error'); }
              } })),
            h('button', { class: 'btn ghost', type: 'button', onclick: () => { S.cover = null; coverPrev.replaceChildren('Bez titulnej fotografie – na karte sa zobrazí náhľad trasy.'); } }, 'Odstrániť')),
          coverPrev)));
  }

  // ----- 4. fotografie -----
  const photoList = h('div', { class: 'photo-rows' });
  const photoSummary = h('p', { class: 'muted small' }, 'Fotografie môžete pridať teraz alebo neskôr v detaile aktivity.');
  const shiftInput = h('input', { type: 'number', value: 0, step: 1, min: -1440, max: 1440, class: 'tiny', onchange: (e) => { S.shift = Number(e.target.value) || 0; rematch(); } });
  const photoInput = h('input', { type: 'file', accept: 'image/*', multiple: true, class: 'sr-only', id: 'photofiles', onchange: (e) => addPhotos([...e.target.files]) });
  photoPanel.append(
    h('h3', {}, 'Fotografie z výletu'),
    h('p', { class: 'muted small' }, 'Aplikácia zistí polohu a čas z EXIF a umiestni každú fotografiu na trasu. Fotografie bez použiteľných údajov zostanú nepriradené – nikdy ich nedáme na náhodné miesto.'),
    h('div', { class: 'row' },
      h('label', { class: 'btn ghost', for: 'photofiles' }, h('span', { html: icon('camera', 18) }), 'Pridať fotografie'),
      photoInput,
      h('label', { class: 'inline', title: 'Ak mal fotoaparát nesprávne nastavené hodiny, posuňte čas fotiek.' }, 'Posun času fotoaparátu (min)', shiftInput)),
    photoSummary, photoList);

  async function addPhotos(files) {
    if (!files.length) return;
    const t = toast(`Spracúvam fotografie (0/${files.length})…`, 'info', 60000);
    let done = 0;
    for (const f of files) {
      try { S.photos.push(await processImageFile(f)); }
      catch (err) { toast(err.message, 'error'); }
      done++; t.textContent = `Spracúvam fotografie (${done}/${files.length})…`;
    }
    t.remove();
    photoInput.value = '';
    rematch();
  }

  function rematch() {
    if (S.parsed) S.photos.forEach((p) => applyMatch(p, S.parsed.track, S.d, S.shift));
    photoList.replaceChildren(...S.photos.map((p) =>
      h('div', { class: 'photo-row' },
        h('img', { src: blobUrl(p.thumb), alt: '' }),
        h('div', { class: 'grow' },
          h('b', {}, p.name),
          h('div', { class: 'muted small' }, p.takenAt != null ? fmtDateTime(new Date(p.takenAt).toISOString()) : 'bez času v EXIF', p.exifLat != null ? ' · má GPS' : ' · bez GPS')),
        S.parsed
          ? h('span', { class: 'pill ' + (p.method ? 'ok' : 'warn') }, methodLabel(p.method))
          : h('span', { class: 'pill' }, 'čaká na GPS súbor'),
        h('button', { class: 'icon-btn', type: 'button', title: 'Odstrániť', html: icon('trash', 18), onclick: () => { S.photos = S.photos.filter((x) => x !== p); rematch(); } }))));
    if (S.photos.length) {
      const placed = S.photos.filter((p) => p.pos).length;
      photoSummary.textContent = S.parsed
        ? `Automaticky umiestnených ${placed} z ${S.photos.length}. Zvyšné môžete umiestniť ručne po uložení.`
        : `${S.photos.length} fotografií pripravených – umiestnia sa po nahratí GPS súboru.`;
    }
  }

  // ----- uloženie -----
  const saveBtn = h('button', { class: 'btn primary big', type: 'button', onclick: save }, 'Uložiť aktivitu');
  saveBar.append(saveBtn, h('a', { class: 'btn ghost', href: '#/' }, 'Zrušiť'));
  function updateSave() {
    const ok = S.parsed && tTitle && tTitle.value.trim() && tDate && tDate.value;
    saveBar.classList.toggle('hidden', !S.parsed);
    saveBtn.disabled = !ok;
  }

  async function save() {
    if (!tTitle.value.trim()) return toast('Zadajte názov aktivity.', 'error');
    if (!tDate.value) return toast('Zadajte dátum uskutočnenia aktivity.', 'error');
    saveBtn.disabled = true; saveBtn.textContent = 'Ukladám…';
    try {
      const id = uid(), track = S.parsed.track, pv = previewOf(track);
      const activity = {
        id, title: tTitle.value.trim(), category: tCat.value, description: tDesc.value.trim(),
        activityDate: new Date(tDate.value).toISOString(), // kedy sa aktivita uskutočnila
        addedAt: new Date().toISOString(),                 // kedy bola pridaná do aplikácie (oddelene)
        updatedAt: new Date().toISOString(),
        dateSource: S.dateSource === 'file' && tDate.value === toLocalInput(S.startIso) ? 'file' : 'manual',
        source: { fileName: S.file.name, format: S.parsed.format },
        stats: S.stats, preview: { coords: pv.coords, bbox: pv.bbox }, elevationSource: S.elevSource, cover: S.cover || null,
      };
      S.photos.forEach((p) => { p.activityId = id; });
      await repo.saveNew(activity, track, S.photos);
      requestPersistence();
      toast('Aktivita bola uložená.', 'success');
      location.hash = '#/a/' + id;
    } catch (err) {
      console.error(err);
      toast('Uloženie zlyhalo: ' + (err.message || err), 'error');
      saveBtn.disabled = false; saveBtn.textContent = 'Uložiť aktivitu';
    }
  }

  root.append(
    h('div', { class: 'page-head' }, h('h1', {}, 'Pridať aktivitu')),
    h('div', { class: 'panel' }, h('h3', {}, 'GPS záznam'), drop, fileInput, status),
    preview, form, photoPanel, saveBar);
  rematch();
}
