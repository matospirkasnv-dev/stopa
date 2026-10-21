// Fotografie: čítanie EXIF, zmenšenie, automatické priradenie k trase
import { sampleAt, toRad } from './geo.js';
import { uid } from './util.js';

const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };

function parseTiff(dv, base) {
  const little = dv.getUint16(base) === 0x4949;
  const u16 = (o) => dv.getUint16(o, little);
  const u32 = (o) => dv.getUint32(o, little);
  const readValue = (type, cnt, off) => {
    const out = [];
    for (let i = 0; i < cnt; i++) {
      const o = off + i * TYPE_SIZE[type];
      if (type === 1 || type === 7) out.push(dv.getUint8(o));
      else if (type === 3) out.push(u16(o));
      else if (type === 4) out.push(u32(o));
      else if (type === 9) out.push(dv.getInt32(o, little));
      else if (type === 5) { const d = u32(o + 4); out.push(d ? u32(o) / d : 0); }
      else if (type === 10) { const d = dv.getInt32(o + 4, little); out.push(d ? dv.getInt32(o, little) / d : 0); }
    }
    return out;
  };
  const readIfd = (o) => {
    const tags = {};
    const n = u16(o);
    for (let i = 0; i < n; i++) {
      try {
        const e = o + 2 + i * 12;
        const tag = u16(e), type = u16(e + 2), cnt = u32(e + 4);
        if (!TYPE_SIZE[type] || cnt > 4096) continue;
        const size = TYPE_SIZE[type] * cnt;
        const off = size <= 4 ? e + 8 : base + u32(e + 8);
        if (type === 2) {
          let s = '';
          for (let k = 0; k < cnt; k++) { const c = dv.getUint8(off + k); if (c === 0) break; s += String.fromCharCode(c); }
          tags[tag] = s;
        } else {
          const v = readValue(type, cnt, off);
          tags[tag] = cnt === 1 ? v[0] : v;
        }
      } catch { /* poškodený záznam – preskočíme */ }
    }
    return tags;
  };

  const ifd0 = readIfd(base + u32(base + 4));
  const ex = ifd0[0x8769] ? readIfd(base + ifd0[0x8769]) : {};
  const gps = ifd0[0x8825] ? readIfd(base + ifd0[0x8825]) : {};
  const out = { lat: null, lon: null, takenAt: null };

  const dms = (a) => (Array.isArray(a) && a.length >= 3 ? a[0] + a[1] / 60 + a[2] / 3600 : null);
  if (gps[2] && gps[4]) {
    const la = dms(gps[2]), lo = dms(gps[4]);
    if (la != null && lo != null && !(la === 0 && lo === 0)) {
      out.lat = la * (String(gps[1]).startsWith('S') ? -1 : 1);
      out.lon = lo * (String(gps[3]).startsWith('W') ? -1 : 1);
    }
  }
  const dtStr = ex[0x9003] || ex[0x9004] || ifd0[0x0132];
  const m = typeof dtStr === 'string' && dtStr.match(/(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  const off = ex[0x9011];
  if (m) {
    const [, y, mo, d, hh, mi, ss] = m.map(Number);
    const om = typeof off === 'string' && off.match(/^([+-])(\d{2}):(\d{2})/);
    if (om) {
      const mins = (om[1] === '-' ? -1 : 1) * (Number(om[2]) * 60 + Number(om[3]));
      out.takenAt = Date.UTC(y, mo - 1, d, hh, mi, ss) - mins * 60000; // presný čas aj s časovou zónou
    } else if (gps[0x1d] && Array.isArray(gps[7])) {
      const [gy, gm, gd] = String(gps[0x1d]).split(':').map(Number);
      out.takenAt = Date.UTC(gy, gm - 1, gd, gps[7][0], gps[7][1], Math.round(gps[7][2])); // GPS čas je v UTC
    } else {
      out.takenAt = new Date(y, mo - 1, d, hh, mi, ss).getTime(); // lokálny čas prehliadača
    }
  }
  return out;
}

export async function readExif(file) {
  const buf = await file.slice(0, 262144).arrayBuffer();
  const dv = new DataView(buf);
  if (dv.byteLength < 12 || dv.getUint16(0) !== 0xffd8) return {};
  let off = 2;
  while (off + 4 < dv.byteLength) {
    const m = dv.getUint16(off);
    if (m === 0xffda || m === 0xffd9 || (m & 0xff00) !== 0xff00) break;
    const len = dv.getUint16(off + 2);
    if (m === 0xffe1 && dv.getUint32(off + 4) === 0x45786966) return parseTiff(dv, off + 10);
    off += 2 + len;
  }
  return {};
}

function bitmapToBlob(bmp, max, q) {
  const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * s)), hh = Math.max(1, Math.round(bmp.height * s));
  const c = document.createElement('canvas');
  c.width = w; c.height = hh;
  c.getContext('2d').drawImage(bmp, 0, 0, w, hh);
  return new Promise((res, rej) => c.toBlob((b) => (b ? res({ blob: b, w, h: hh }) : rej(new Error('Zmenšenie zlyhalo'))), 'image/jpeg', q));
}

export async function resizeImage(file, max = 1800, q = 0.86) {
  let bmp;
  try { bmp = await createImageBitmap(file); } catch { throw new Error(`Fotografiu „${file.name}“ sa nepodarilo načítať (nepodporovaný formát).`); }
  try { return (await bitmapToBlob(bmp, max, q)).blob; } finally { bmp.close && bmp.close(); }
}

export async function processImageFile(file) {
  let exif = {};
  try { exif = await readExif(file); } catch { exif = {}; }
  let bmp;
  try { bmp = await createImageBitmap(file); } catch { throw new Error(`Fotografiu „${file.name}“ sa nepodarilo načítať (nepodporovaný formát).`); }
  try {
    const full = await bitmapToBlob(bmp, 1800, 0.86);
    const thumb = await bitmapToBlob(bmp, 240, 0.8);
    return {
      id: uid(), activityId: null, name: file.name,
      blob: full.blob, thumb: thumb.blob, w: full.w, h: full.h,
      caption: '', takenAt: exif.takenAt ?? null, exifLat: exif.lat ?? null, exifLon: exif.lon ?? null,
      pos: null, trackIndex: null, method: null,
    };
  } finally { bmp.close && bmp.close(); }
}

// ---------- priradenie fotografie k trase ----------
const GPS_TOL = 300;      // m – GPS fotografie sa považuje za „na trase“
const TIME_TOL = 300000;  // 5 min – tolerancia času mimo záznamu

export function matchPhoto(ph, track, d, shiftMin = 0) {
  const n = d.n;
  const t = d.hasTime && ph.takenAt != null ? ph.takenAt + shiftMin * 60000 : null;
  const tIn = t != null && t >= track.t[0] - TIME_TOL && t <= track.t[n - 1] + TIME_TOL;
  const hasG = ph.exifLat != null && ph.exifLon != null;
  const at = (i, method) => ({ pos: { lat: track.lat[i], lon: track.lon[i] }, trackIndex: i, method });

  if (hasG) {
    const k = Math.cos(toRad(ph.exifLat)) * 111320, m = 110540;
    const dd = new Float32Array(n);
    let best = -1, bd = Infinity;
    for (let i = 0; i < n; i++) {
      const dx = (track.lon[i] - ph.exifLon) * k, dy = (track.lat[i] - ph.exifLat) * m;
      dd[i] = Math.sqrt(dx * dx + dy * dy);
      if (dd[i] < bd) { bd = dd[i]; best = i; }
    }
    if (bd <= GPS_TOL) {
      if (tIn) { // GPS aj čas: z miest blízko GPS vyberieme to s najbližším časom
        let bi = best, bt = Infinity;
        for (let i = 0; i < n; i++) if (dd[i] <= GPS_TOL) { const dt = Math.abs(track.t[i] - t); if (dt < bt) { bt = dt; bi = i; } }
        return at(bi, 'gps+time');
      }
      return at(best, 'gps');
    }
  }
  if (tIn) {
    const s = sampleAt(track, d, t - track.t[0]);
    return { pos: { lat: s.lat, lon: s.lon }, trackIndex: s.i, method: 'time' };
  }
  if (hasG) return { pos: { lat: ph.exifLat, lon: ph.exifLon }, trackIndex: null, method: 'gps-offtrack' };
  return { pos: null, trackIndex: null, method: null }; // nepriradená – nikdy náhodné miesto
}

export function applyMatch(ph, track, d, shiftMin = 0) {
  Object.assign(ph, matchPhoto(ph, track, d, shiftMin));
  return ph;
}

export const METHOD_LABEL = {
  gps: 'Automaticky – podľa GPS fotografie',
  time: 'Automaticky – podľa času fotografie',
  'gps+time': 'Automaticky – GPS aj čas',
  'gps-offtrack': 'Automaticky – GPS fotografie (mimo trasy)',
  manual: 'Ručne',
  null: 'Nepriradená',
};
export const methodLabel = (m) => METHOD_LABEL[m ?? 'null'];
