// GPS: parsovanie GPX / TCX / FIT, odvodené údaje, štatistiky, doplnenie výšky
export const toRad = (d) => (d * Math.PI) / 180;

export function haversine(a1, o1, a2, o2) {
  const dLa = toRad(a2 - a1), dLo = toRad(o2 - o1);
  const s = Math.sin(dLa / 2) ** 2 + Math.cos(toRad(a1)) * Math.cos(toRad(a2)) * Math.sin(dLo / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(s)));
}
export function bearing(a1, o1, a2, o2) {
  const y = Math.sin(toRad(o2 - o1)) * Math.cos(toRad(a2));
  const x = Math.cos(toRad(a1)) * Math.sin(toRad(a2)) - Math.sin(toRad(a1)) * Math.cos(toRad(a2)) * Math.cos(toRad(o2 - o1));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

// ---------- stavba stopy z bodov ----------
function fillGaps(a) {
  const n = a.length;
  let first = -1;
  for (let i = 0; i < n; i++) if (Number.isFinite(a[i])) { first = i; break; }
  if (first < 0) return;
  for (let i = 0; i < first; i++) a[i] = a[first];
  let prev = first;
  for (let i = first + 1; i < n; i++) {
    if (Number.isFinite(a[i])) {
      if (i - prev > 1) for (let k = prev + 1; k < i; k++) a[k] = a[prev] + ((a[i] - a[prev]) * (k - prev)) / (i - prev);
      prev = i;
    }
  }
  for (let i = prev + 1; i < n; i++) a[i] = a[prev];
}

export function buildTrack(points) {
  const pts = points.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180);
  const n = pts.length;
  if (n < 2) throw new Error('Súbor neobsahuje dostatok GPS bodov (potrebné sú aspoň 2).');
  const lat = new Float64Array(n), lon = new Float64Array(n);
  const ele = new Float32Array(n).fill(NaN), t = new Float64Array(n).fill(NaN), spd = new Float32Array(n).fill(NaN);
  let ef = 0, tf = 0;
  pts.forEach((p, i) => {
    lat[i] = p.lat; lon[i] = p.lon;
    if (Number.isFinite(p.ele)) { ele[i] = p.ele; ef++; }
    if (Number.isFinite(p.t)) { t[i] = p.t; tf++; }
    if (Number.isFinite(p.speed)) spd[i] = p.speed;
  });
  // čas: použijeme iba ak je k dispozícii pre (takmer) všetky body
  if (tf < n * 0.9) t.fill(NaN);
  else {
    fillGaps(t);
    for (let i = 1; i < n; i++) if (t[i] < t[i - 1]) t[i] = t[i - 1];
    if (!(t[n - 1] > t[0])) t.fill(NaN);
  }
  // výška: použijeme iba ak je aspoň pre polovicu bodov
  if (ef < n * 0.5) ele.fill(NaN); else fillGaps(ele);
  return { lat, lon, ele, t, spd };
}

function smooth(a, win) {
  const n = a.length, out = new Float32Array(n), half = Math.floor(win / 2);
  for (let i = 0; i < n; i++) {
    let s = 0, c = 0;
    for (let k = Math.max(0, i - half); k <= Math.min(n - 1, i + half); k++) { s += a[k]; c++; }
    out[i] = s / c;
  }
  return out;
}

// ---------- odvodené údaje ----------
export function derive(track) {
  const n = track.lat.length;
  const dist = new Float64Array(n);
  for (let i = 1; i < n; i++) dist[i] = dist[i - 1] + haversine(track.lat[i - 1], track.lon[i - 1], track.lat[i], track.lon[i]);
  const hasTime = Number.isFinite(track.t[0]) && Number.isFinite(track.t[n - 1]);
  const hasEle = Number.isFinite(track.ele[0]);
  const axis = new Float64Array(n);
  for (let i = 0; i < n; i++) axis[i] = hasTime ? track.t[i] - track.t[0] : dist[i];
  const speed = new Float32Array(n).fill(NaN);
  if (hasTime) {
    const w = 2500;
    for (let i = 0; i < n; i++) {
      let lo = i, hi = i;
      while (lo > 0 && track.t[i] - track.t[lo] < w) lo--;
      while (hi < n - 1 && track.t[hi] - track.t[i] < w) hi++;
      const dt = track.t[hi] - track.t[lo];
      if (dt > 0) speed[i] = (dist[hi] - dist[lo]) / (dt / 1000);
    }
  } else {
    for (let i = 0; i < n; i++) if (Number.isFinite(track.spd[i])) speed[i] = track.spd[i];
  }
  const hasSpeed = speed.some((v) => Number.isFinite(v));
  const eleS = hasEle ? smooth(track.ele, 5) : null;
  return { n, dist, hasTime, hasEle, hasSpeed, axis, speed, eleS, U: axis[n - 1] };
}

export function computeStats(track, d) {
  const n = d.n;
  const st = {
    distance: d.dist[n - 1], elapsed: null, moving: null, avgSpeed: null, maxSpeed: null,
    eleMax: null, eleMin: null, ascent: null, descent: null,
  };
  if (d.hasTime) {
    st.elapsed = track.t[n - 1] - track.t[0];
    const dts = [];
    for (let i = 1; i < n; i++) dts.push(track.t[i] - track.t[i - 1]);
    const sorted = [...dts].sort((a, b) => a - b);
    const med = sorted[Math.floor(sorted.length / 2)] || 1000;
    const gap = Math.max(30000, med * 8);
    let mt = 0, md = 0;
    for (let i = 1; i < n; i++) {
      const dt = dts[i - 1], dd = d.dist[i] - d.dist[i - 1];
      if (dt > 0 && dt <= gap && dd / (dt / 1000) >= 0.5) { mt += dt; md += dd; }
    }
    if (mt >= 10000) { st.moving = mt; st.avgSpeed = md / (mt / 1000); }
  }
  let mx = -1;
  for (const v of d.speed) if (Number.isFinite(v) && v <= 40 && v > mx) mx = v;
  if (mx >= 0 && (d.hasTime || d.hasSpeed)) st.maxSpeed = mx;
  if (d.hasEle) {
    const sm = d.eleS;
    let hi = -Infinity, lo = Infinity, ref = sm[0], gain = 0, loss = 0;
    const th = 3;
    for (const v of sm) {
      if (v > hi) hi = v;
      if (v < lo) lo = v;
      if (v - ref >= th) { gain += v - ref; ref = v; } else if (ref - v >= th) { loss += ref - v; ref = v; }
    }
    st.eleMax = hi; st.eleMin = lo; st.ascent = gain; st.descent = loss;
  }
  return st;
}

export function previewOf(track, max = 220) {
  const n = track.lat.length, step = Math.max(1, Math.ceil(n / max));
  const coords = [];
  for (let i = 0; i < n; i += step) coords.push([+track.lon[i].toFixed(5), +track.lat[i].toFixed(5)]);
  const last = [+track.lon[n - 1].toFixed(5), +track.lat[n - 1].toFixed(5)];
  if (coords[coords.length - 1][0] !== last[0] || coords[coords.length - 1][1] !== last[1]) coords.push(last);
  let minLon = 180, maxLon = -180, minLat = 90, maxLat = -90;
  for (let i = 0; i < n; i++) {
    minLon = Math.min(minLon, track.lon[i]); maxLon = Math.max(maxLon, track.lon[i]);
    minLat = Math.min(minLat, track.lat[i]); maxLat = Math.max(maxLat, track.lat[i]);
  }
  return { coords, bbox: [minLon, minLat, maxLon, maxLat] };
}

// vzorka stopy v danom čase (alebo vzdialenosti, ak chýbajú časy) – používa prehrávanie
export function sampleAt(track, d, u) {
  const n = d.n, ax = d.axis;
  u = Math.max(0, Math.min(d.U, u));
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (ax[mid] <= u) lo = mid; else hi = mid;
  }
  const span = ax[hi] - ax[lo];
  const f = span > 0 ? Math.min(1, Math.max(0, (u - ax[lo]) / span)) : 0;
  const mix = (a) => a[lo] + (a[hi] - a[lo]) * f;
  const sp = d.speed[lo], sp2 = d.speed[hi];
  return {
    i: f > 0.5 ? hi : lo, lo, hi, f,
    lat: mix(track.lat), lon: mix(track.lon),
    ele: d.hasEle ? mix(track.ele) : null,
    dist: mix(d.dist),
    speed: Number.isFinite(sp) && Number.isFinite(sp2) ? sp + (sp2 - sp) * f : Number.isFinite(sp) ? sp : null,
    t: d.hasTime ? u : null,
  };
}

export function indexAtDistance(d, dist) {
  let lo = 0, hi = d.n - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (d.dist[mid] < dist) lo = mid + 1; else hi = mid;
  }
  return lo;
}

export function nearestIndex(track, lat, lon) {
  const k = Math.cos(toRad(lat)) * 111320, m = 110540;
  let best = -1, bd = Infinity;
  for (let i = 0; i < track.lat.length; i++) {
    const dx = (track.lon[i] - lon) * k, dy = (track.lat[i] - lat) * m;
    const dd = dx * dx + dy * dy;
    if (dd < bd) { bd = dd; best = i; }
  }
  return { index: best, dist: Math.sqrt(bd) };
}

// ---------- parsery ----------
const num = (v) => (v == null || v === '' ? NaN : Number(v));
const textOf = (el, tag) => {
  const x = el.getElementsByTagName(tag)[0];
  return x ? x.textContent.trim() : null;
};
const textNS = (el, local) => {
  const x = el.getElementsByTagNameNS('*', local)[0];
  return x ? x.textContent.trim() : null;
};
const parseXml = (text) => {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('Súbor nie je platný XML.');
  return doc;
};
function guessCategory(s) {
  s = (s || '').toLowerCase();
  if (/mountain|mtb|gravel|enduro|downhill/.test(s)) return 'mtb';
  if (/bik|cycl|ride|bicy/.test(s)) return 'bike';
  if (/hik|trek|trail walk|turist/.test(s)) return 'hike';
  if (/run|jog/.test(s)) return 'run';
  if (/walk/.test(s)) return 'walk';
  return null;
}

export function parseGPX(text) {
  const doc = parseXml(text);
  if (!doc.getElementsByTagName('gpx').length) throw new Error('Súbor nie je GPX.');
  let nodes = [...doc.getElementsByTagName('trkpt')];
  if (!nodes.length) nodes = [...doc.getElementsByTagName('rtept')];
  if (!nodes.length) throw new Error('GPX neobsahuje žiadnu trasu (trkpt/rtept).');
  const pts = nodes.map((p) => {
    const t = textOf(p, 'time');
    const sp = textNS(p, 'speed');
    return {
      lat: num(p.getAttribute('lat')), lon: num(p.getAttribute('lon')),
      ele: num(textOf(p, 'ele')), t: t ? Date.parse(t) : NaN, speed: num(sp),
    };
  });
  const trk = doc.getElementsByTagName('trk')[0] || doc.getElementsByTagName('rte')[0];
  let name = null, type = null;
  if (trk) for (const c of trk.children) {
    if (c.localName === 'name') name = c.textContent.trim();
    if (c.localName === 'type') type = c.textContent.trim();
  }
  if (!name) { const m = doc.getElementsByTagName('metadata')[0]; if (m) name = textOf(m, 'name'); }
  return { points: pts, name, category: guessCategory(type), format: 'GPX' };
}

export function parseTCX(text) {
  const doc = parseXml(text);
  const tps = [...doc.getElementsByTagName('Trackpoint')];
  if (!tps.length) throw new Error('TCX neobsahuje žiadne body trasy.');
  const pts = [];
  for (const p of tps) {
    const la = textOf(p, 'LatitudeDegrees'), lo = textOf(p, 'LongitudeDegrees');
    if (la == null || lo == null) continue; // bod bez polohy (napr. pauza)
    const t = textOf(p, 'Time');
    pts.push({
      lat: num(la), lon: num(lo), ele: num(textOf(p, 'AltitudeMeters')),
      t: t ? Date.parse(t) : NaN, speed: num(textNS(p, 'Speed')),
    });
  }
  const act = doc.getElementsByTagName('Activity')[0];
  const sport = act ? act.getAttribute('Sport') : null;
  return { points: pts, name: null, category: guessCategory(sport), format: 'TCX' };
}

const FIT_SIZES = { 0: 1, 1: 1, 2: 1, 3: 2, 4: 2, 5: 4, 6: 4, 7: 1, 8: 4, 9: 8, 10: 1, 11: 2, 12: 4, 13: 1, 14: 8, 15: 8, 16: 8 };
function fitValue(dv, p, size, type, little) {
  if (FIT_SIZES[type] !== size) return null;
  switch (type) {
    case 0: case 2: case 13: { const v = dv.getUint8(p); return v === 0xff ? null : v; }
    case 1: { const v = dv.getInt8(p); return v === 0x7f ? null : v; }
    case 10: { const v = dv.getUint8(p); return v === 0 ? null : v; }
    case 3: { const v = dv.getInt16(p, little); return v === 0x7fff ? null : v; }
    case 4: { const v = dv.getUint16(p, little); return v === 0xffff ? null : v; }
    case 11: { const v = dv.getUint16(p, little); return v === 0 ? null : v; }
    case 5: { const v = dv.getInt32(p, little); return v === 0x7fffffff ? null : v; }
    case 6: { const v = dv.getUint32(p, little); return v === 0xffffffff ? null : v; }
    case 12: { const v = dv.getUint32(p, little); return v === 0 ? null : v; }
    case 8: { const v = dv.getFloat32(p, little); return Number.isFinite(v) ? v : null; }
    default: return null;
  }
}

export function parseFIT(buf) {
  const dv = new DataView(buf);
  if (dv.byteLength < 14) throw new Error('Neplatný FIT súbor.');
  const hs = dv.getUint8(0);
  const sig = String.fromCharCode(dv.getUint8(8), dv.getUint8(9), dv.getUint8(10), dv.getUint8(11));
  if (sig !== '.FIT') throw new Error('Neplatný FIT súbor.');
  const end = Math.min(dv.byteLength, hs + dv.getUint32(4, true));
  const defs = {};
  const pts = [];
  let pos = hs, lastTs = 0, sport = null, sub = null;

  const readData = (def, p, compTs) => {
    const rec = {};
    const want = def.gnum === 20 || def.gnum === 18;
    let q = p;
    for (const f of def.fields) {
      if (want) rec[f.num] = fitValue(dv, q, f.size, f.type, def.little);
      q += f.size;
    }
    q += def.devSize;
    if (def.gnum === 20) {
      let ts = rec[253];
      if (ts != null) lastTs = ts; else if (compTs != null) ts = compTs;
      const latR = rec[0], lonR = rec[1];
      if (latR != null && lonR != null) {
        const altRaw = rec[78] != null ? rec[78] : rec[2];
        const spRaw = rec[73] != null ? rec[73] : rec[6];
        pts.push({
          lat: latR * (180 / 2147483648), lon: lonR * (180 / 2147483648),
          ele: altRaw != null ? altRaw / 5 - 500 : NaN,
          t: ts != null ? (ts + 631065600) * 1000 : NaN,
          speed: spRaw != null ? spRaw / 1000 : NaN,
        });
      }
    } else if (def.gnum === 18) {
      if (rec[5] != null && sport == null) sport = rec[5];
      if (rec[6] != null && sub == null) sub = rec[6];
    }
    return q;
  };

  while (pos < end) {
    const hdr = dv.getUint8(pos++);
    if (hdr & 0x80) {
      const def = defs[(hdr >> 5) & 3];
      if (!def) throw new Error('Poškodený FIT súbor.');
      const off = hdr & 0x1f;
      let ts = (lastTs & ~0x1f) + off;
      if (off < (lastTs & 0x1f)) ts += 0x20;
      lastTs = ts;
      pos = readData(def, pos, ts);
    } else if (hdr & 0x40) {
      pos++;
      const little = dv.getUint8(pos++) === 0;
      const gnum = dv.getUint16(pos, little); pos += 2;
      const nf = dv.getUint8(pos++);
      const fields = [];
      for (let k = 0; k < nf; k++) { fields.push({ num: dv.getUint8(pos), size: dv.getUint8(pos + 1), type: dv.getUint8(pos + 2) & 0x1f }); pos += 3; }
      let devSize = 0;
      if (hdr & 0x20) { const nd = dv.getUint8(pos++); for (let k = 0; k < nd; k++) { devSize += dv.getUint8(pos + 1); pos += 3; } }
      defs[hdr & 0x0f] = { little, gnum, fields, devSize };
    } else {
      const def = defs[hdr & 0x0f];
      if (!def) throw new Error('Poškodený FIT súbor.');
      pos = readData(def, pos, null);
    }
  }
  if (!pts.length) throw new Error('FIT neobsahuje žiadne GPS body.');
  let category = null;
  if (sport === 1) category = 'run';
  else if (sport === 2) category = sub === 8 ? 'mtb' : 'bike';
  else if (sport === 11) category = 'walk';
  else if (sport === 17) category = 'hike';
  return { points: pts, name: null, category, format: 'FIT' };
}

export async function parseTrackFile(file) {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  let parsed;
  if (ext === 'gpx') parsed = parseGPX(await file.text());
  else if (ext === 'tcx') parsed = parseTCX(await file.text());
  else if (ext === 'fit') parsed = parseFIT(await file.arrayBuffer());
  else throw new Error('Nepodporovaný formát. Nahrajte súbor GPX, TCX alebo FIT.');
  const track = buildTrack(parsed.points);
  return { track, name: parsed.name, category: parsed.category, format: parsed.format };
}

// ---------- doplnenie výšky z externého zdroja (Open-Meteo, DEM) ----------
export async function fetchElevations(track, d, onProgress) {
  const n = track.lat.length;
  const m = Math.min(n, 300);
  const idx = [];
  for (let k = 0; k < m; k++) idx.push(Math.round((k * (n - 1)) / (m - 1)));
  const vals = [];
  for (let s = 0; s < idx.length; s += 100) {
    const part = idx.slice(s, s + 100);
    const url = `https://api.open-meteo.com/v1/elevation?latitude=${part.map((i) => track.lat[i].toFixed(5)).join(',')}&longitude=${part.map((i) => track.lon[i].toFixed(5)).join(',')}`;
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 12000);
    const res = await fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(to));
    if (!res.ok) throw new Error('Služba výšok vrátila chybu ' + res.status);
    const j = await res.json();
    if (!j.elevation || j.elevation.length !== part.length) throw new Error('Neplatná odpoveď služby výšok.');
    vals.push(...j.elevation);
    onProgress && onProgress(Math.min(1, (s + 100) / idx.length));
  }
  const out = new Float32Array(n);
  let k = 0;
  for (let i = 0; i < n; i++) {
    while (k < idx.length - 2 && d.dist[idx[k + 1]] < d.dist[i]) k++;
    const a = idx[k], b = idx[Math.min(k + 1, idx.length - 1)];
    const span = d.dist[b] - d.dist[a];
    const f = span > 0 ? Math.min(1, Math.max(0, (d.dist[i] - d.dist[a]) / span)) : 0;
    out[i] = vals[k] + (vals[Math.min(k + 1, vals.length - 1)] - vals[k]) * f;
  }
  return out;
}
