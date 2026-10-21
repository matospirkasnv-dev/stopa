// Nastavenia: mapa, záloha a obnova dát, vymazanie
import { repo, settings } from './db.js';
import { BASES } from './mapview.js';
import { h, icon, toast, confirmDialog } from './util.js';

const blobToDataUrl = (b) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(b); });
const dataUrlToBlob = async (u) => (await fetch(u)).blob();
const packArr = (a) => Array.from(a, (v) => (Number.isFinite(v) ? v : null));
const unpackArr = (a, T) => { const o = new T(a.length); a.forEach((v, i) => { o[i] = v == null ? NaN : v; }); return o; };

async function exportAll() {
  const dump = await repo.dumpAll();
  const out = {
    app: 'stopa', version: 1, exportedAt: new Date().toISOString(),
    activities: await Promise.all(dump.activities.map(async (a) => ({ ...a, cover: a.cover ? await blobToDataUrl(a.cover) : null }))),
    tracks: dump.tracks.map((t) => ({ id: t.id, lat: packArr(t.lat), lon: packArr(t.lon), ele: packArr(t.ele), t: packArr(t.t), spd: packArr(t.spd) })),
    photos: await Promise.all(dump.photos.map(async (p) => ({ ...p, blob: await blobToDataUrl(p.blob), thumb: await blobToDataUrl(p.thumb) }))),
  };
  const blob = new Blob([JSON.stringify(out)], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: `stopa-zaloha-${new Date().toISOString().slice(0, 10)}.json` });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

async function importAll(file) {
  const data = JSON.parse(await file.text());
  if (data.app !== 'stopa' || !Array.isArray(data.activities)) throw new Error('Toto nie je záloha aplikácie Stopa.');
  const activities = await Promise.all(data.activities.map(async (a) => ({ ...a, cover: a.cover ? await dataUrlToBlob(a.cover) : null })));
  const tracks = data.tracks.map((t) => ({ id: t.id, lat: unpackArr(t.lat, Float64Array), lon: unpackArr(t.lon, Float64Array), ele: unpackArr(t.ele, Float32Array), t: unpackArr(t.t, Float64Array), spd: unpackArr(t.spd, Float32Array) }));
  const photos = await Promise.all(data.photos.map(async (p) => ({ ...p, blob: await dataUrlToBlob(p.blob), thumb: await dataUrlToBlob(p.thumb) })));
  await repo.restoreAll({ activities, tracks, photos });
  return activities.length;
}

export async function renderSettings(view) {
  const st = settings.get();
  const usage = h('p', { class: 'muted small' }, 'Zisťujem využitie úložiska…');
  if (navigator.storage && navigator.storage.estimate) {
    navigator.storage.estimate().then((e) => {
      const mb = (v) => (v / 1048576).toFixed(1).replace('.', ',') + ' MB';
      usage.textContent = `Využité miesto: ${mb(e.usage || 0)}${e.quota ? ' z ' + mb(e.quota) : ''}.`;
    }).catch(() => { usage.textContent = ''; });
  } else usage.textContent = '';

  const importInput = h('input', { type: 'file', accept: 'application/json,.json', class: 'sr-only', id: 'impfile', onchange: async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { const n = await importAll(f); toast(`Obnovených ${n} aktivít.`, 'success'); }
    catch (err) { toast(err.message || 'Import zlyhal.', 'error'); }
    e.target.value = '';
  } });

  view.append(h('section', { class: 'page narrow' },
    h('div', { class: 'page-head' }, h('h1', {}, 'Nastavenia')),
    h('div', { class: 'panel' }, h('h3', {}, 'Mapa'),
      h('div', { class: 'form-grid' },
        h('label', {}, 'Predvolený podklad',
          h('select', { onchange: (e) => { settings.set({ base: e.target.value }); toast('Uložené.'); } },
            ...Object.entries(BASES).map(([k, v]) => h('option', { value: k, selected: k === st.base }, v.label)))),
        h('label', {}, 'Prevýšenie 3D terénu',
          h('input', { type: 'range', min: 1, max: 3, step: 0.1, value: st.exaggeration, onchange: (e) => { settings.set({ exaggeration: Number(e.target.value) }); } })),
        h('label', { class: 'check full' },
          h('input', { type: 'checkbox', checked: st.start3d, onchange: (e) => settings.set({ start3d: e.target.checked }) }), 'Otvárať aktivity v 3D pohľade'))),
    h('div', { class: 'panel' }, h('h3', {}, 'Údaje a záloha'),
      h('p', { class: 'muted' }, 'Aktivity sú uložené lokálne vo vašom prehliadači (IndexedDB). Pred vymazaním dát prehliadača alebo zmenou zariadenia si urobte zálohu.'),
      usage,
      h('div', { class: 'row' },
        h('button', { class: 'btn ghost', onclick: async () => { try { await exportAll(); toast('Záloha bola stiahnutá.', 'success'); } catch (e) { toast('Export zlyhal: ' + e.message, 'error'); } } }, h('span', { html: icon('download', 18) }), 'Exportovať zálohu'),
        h('label', { class: 'btn ghost', for: 'impfile' }, h('span', { html: icon('upload', 18) }), 'Obnoviť zo zálohy'), importInput)),
    h('div', { class: 'panel danger-zone' }, h('h3', {}, 'Nebezpečná zóna'),
      h('p', { class: 'muted' }, 'Natrvalo odstráni všetky aktivity, trasy a fotografie z tohto prehliadača.'),
      h('button', { class: 'btn danger', onclick: async () => {
        if (await confirmDialog('Vymazať všetky dáta?', 'Táto akcia sa nedá vrátiť. Zvážte najprv export zálohy.', 'Vymazať všetko')) { await repo.clearAll(); toast('Všetky dáta boli vymazané.'); }
      } }, 'Vymazať všetky dáta')),
    h('p', { class: 'muted small center' }, 'Stopa · mapové podklady © OpenStreetMap, CARTO, Esri · terén AWS Terrain Tiles · výšky Open-Meteo')));
}
