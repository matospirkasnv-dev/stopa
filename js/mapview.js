// 3D / 2D mapa jednej aktivity (MapLibre GL JS) + prehrávač trasy
import { sampleAt, bearing, indexAtDistance } from './geo.js';

const ACCENT = '#ff5a36';
const PROGRESS = '#ffd60a';

export const BASES = {
  osm: { layer: 'base-osm', label: 'Mapa' },
  sat: { layer: 'base-sat', label: 'Satelit' },
  dark: { layer: 'base-dark', label: 'Tmavá' },
};

export function mapStyle() {
  const dem = {
    type: 'raster-dem', encoding: 'terrarium', tileSize: 256, maxzoom: 15,
    tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
    attribution: 'Terén: Mapzen / AWS Terrain Tiles',
  };
  return {
    version: 8,
    sources: {
      osm: { type: 'raster', tileSize: 256, maxzoom: 19, tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>' },
      sat: { type: 'raster', tileSize: 256, maxzoom: 19, tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], attribution: 'Esri, Maxar, Earthstar Geographics' },
      dark: { type: 'raster', tileSize: 256, maxzoom: 19, tiles: ['https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png', 'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png'], attribution: '© OpenStreetMap, © CARTO' },
      dem,
      'dem-hs': { ...dem, attribution: undefined },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#0b0f14' } },
      { id: 'base-osm', type: 'raster', source: 'osm' },
      { id: 'base-sat', type: 'raster', source: 'sat', layout: { visibility: 'none' } },
      { id: 'base-dark', type: 'raster', source: 'dark', layout: { visibility: 'none' } },
      { id: 'hills', type: 'hillshade', source: 'dem-hs', paint: { 'hillshade-exaggeration': 0.3, 'hillshade-shadow-color': '#000', 'hillshade-highlight-color': '#fff' } },
    ],
  };
}

const el = (cls, html = '') => { const d = document.createElement('div'); d.className = cls; d.innerHTML = html; return d; };

export class TrackMap {
  constructor(container, { track, derived, exag = 1.5, base = 'osm', mode3d = true, onProblem = null }) {
    this.onProblem = onProblem; this.hideHills = false; this.camLock = 0; this.tileErrors = 0; this.lastProblem = 0;
    this.track = track; this.d = derived; this.exag = exag; this.mode3d = mode3d; this.base = base;
    this.photoMarkers = [];
    this.loaded = false; this.queue = [];
    this.lastProgress = 0;

    const n = track.lat.length;
    let minLon = 180, maxLon = -180, minLat = 90, maxLat = -90;
    for (let i = 0; i < n; i++) {
      minLon = Math.min(minLon, track.lon[i]); maxLon = Math.max(maxLon, track.lon[i]);
      minLat = Math.min(minLat, track.lat[i]); maxLat = Math.max(maxLat, track.lat[i]);
    }
    this.bounds = [[minLon, minLat], [maxLon, maxLat]];

    // zjednodušená trasa na vykreslenie (indexy do pôvodnej stopy)
    const step = Math.max(1, Math.ceil(n / 4000));
    const disp = [];
    for (let i = 0; i < n; i += step) disp.push(i);
    if (disp[disp.length - 1] !== n - 1) disp.push(n - 1);
    this.disp = disp;
    this.coords = disp.map((i) => [track.lon[i], track.lat[i]]);

    this.map = new maplibregl.Map({
      container, style: mapStyle(), bounds: this.bounds, fitBoundsOptions: { padding: 70 },
      pitch: mode3d ? 60 : 0, maxPitch: 85, attributionControl: { compact: true }, cooperativeGestures: false,
    });
    this.map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
    this.map.addControl(new maplibregl.ScaleControl({ maxWidth: 100, unit: 'metric' }), 'bottom-left');
    // Trasa a značky sa pridajú hneď po načítaní štýlu. Udalosť 'load' čaká na stiahnutie VŠETKÝCH dlaždíc,
    // takže pri blokovanej/pomalej sieti by sa nikdy nespustila a mapa by ostala prázdna.
    const init = () => { if (this.initDone) return; this.initDone = true; this.onLoad(); };
    this.map.on('style.load', init);
    this.map.on('styledata', () => { if (!this.initDone && this.map.getLayer && this.map.getLayer('hills')) init(); });
    this.map.on('load', init);
    setTimeout(() => { if (!this.initDone) { init(); } }, 4000);
    // ak sa podklad dlho nenačítava, upozorníme používateľa (trasa sa kreslí aj bez podkladu)
    setTimeout(() => {
      if (this.map.areTilesLoaded && !this.map.areTilesLoaded()) this.onProblem && this.onProblem('slow', null, this.lastErr);
    }, 8000);
    this.map.on('error', (e) => {
      if (e && e.error) { console.warn('Mapa:', e.error.message); this.lastErr = e.error.message; }
      if (e && e.sourceId && ['osm', 'sat', 'dark', 'dem', 'dem-hs'].includes(e.sourceId)) {
        this.tileErrors++;
        const now = Date.now();
        if (this.tileErrors >= 6 && now - this.lastProblem > 30000) {
          this.lastProblem = now; this.tileErrors = 0;
          this.onProblem && this.onProblem('tiles', e.sourceId, this.lastErr);
        }
      }
    });
    this.map.getCanvas().addEventListener('webglcontextlost', (ev) => { ev.preventDefault(); this.onProblem && this.onProblem('context'); });
  }

  whenReady(fn) { if (this.loaded) fn(); else this.queue.push(fn); }

  onLoad() {
    const m = this.map;
    m.addSource('route', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: this.coords } } });
    m.addSource('progress', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: [] } } });
    const lay = { 'line-cap': 'round', 'line-join': 'round' };
    m.addLayer({ id: 'route-casing', type: 'line', source: 'route', layout: lay, paint: { 'line-color': '#05080c', 'line-width': 8, 'line-opacity': 0.7 } });
    m.addLayer({ id: 'route-line', type: 'line', source: 'route', layout: lay, paint: { 'line-color': ACCENT, 'line-width': 4.5 } });
    m.addLayer({ id: 'progress-line', type: 'line', source: 'progress', layout: lay, paint: { 'line-color': PROGRESS, 'line-width': 5.5 } });

    // značky začiatku, konca, polohy prehrávania a kurzora z grafu
    const t = this.track, n = t.lat.length;
    this.startMarker = new maplibregl.Marker({ element: el('pin pin-start', 'S') }).setLngLat([t.lon[0], t.lat[0]]).addTo(m);
    this.endMarker = new maplibregl.Marker({ element: el('pin pin-end', 'C') }).setLngLat([t.lon[n - 1], t.lat[n - 1]]).addTo(m);
    this.posMarker = new maplibregl.Marker({ element: el('playhead', '<i></i>') }).setLngLat([t.lon[0], t.lat[0]]).addTo(m);
    this.posMarker.getElement().style.display = 'none';
    this.cursorMarker = new maplibregl.Marker({ element: el('cursor-dot') }).setLngLat([t.lon[0], t.lat[0]]).addTo(m);
    this.cursorMarker.getElement().style.display = 'none';

    this.loaded = true;
    this.setBase(this.base);
    this.setMode(this.mode3d, false);
    this.queue.splice(0).forEach((f) => f());
  }

  setBase(key) {
    this.base = key;
    this.whenReady(() => {
      Object.entries(BASES).forEach(([k, v]) => this.map.setLayoutProperty(v.layer, 'visibility', k === key ? 'visible' : 'none'));
      this.applyHills();
    });
  }

  applyHills() {
    if (!this.loaded) return;
    this.map.setLayoutProperty('hills', 'visibility', this.base === 'sat' || this.hideHills || !this.mode3d ? 'none' : 'visible');
  }
  // počas prehrávania sa stínovanie svahov vypne (menej záťaže pre grafiku a menej sťahovaných dlaždíc)
  setHills(on) { this.hideHills = !on; this.applyHills(); }
  beginFollow(lon, lat, brg) {
    if (!this.loaded || !Number.isFinite(lon) || !Number.isFinite(lat)) return;
    this.camLock = performance.now() + 900; // počas plynulého priblíženia sa kamera nepresúva po snímkoch
    const z = Math.min(15, Math.max(13, this.map.getZoom()));
    this.map.easeTo({ center: [lon, lat], bearing: Number.isFinite(brg) ? brg : 0, zoom: z, pitch: this.mode3d ? 55 : 0, duration: 800, essential: true });
  }

  setMode(is3d, animate = true) {
    this.mode3d = is3d;
    this.whenReady(() => {
      this.map.setTerrain(is3d ? { source: 'dem', exaggeration: this.exag } : null);
      this.applyHills();
      if (animate) this.map.easeTo({ pitch: is3d ? 60 : 0, duration: 800 });
    });
  }

  setExaggeration(v) {
    this.exag = v;
    if (this.loaded && this.mode3d) this.map.setTerrain({ source: 'dem', exaggeration: v });
  }

  fitRoute() { this.map.fitBounds(this.bounds, { padding: 70, pitch: this.mode3d ? 60 : 0, bearing: 0, duration: 1200 }); }
  goTo(i, zoom = 15.2) {
    this.map.flyTo({ center: [this.track.lon[i], this.track.lat[i]], zoom, pitch: this.mode3d ? 65 : 0, duration: 1400 });
  }

  // ----- fotografie -----
  setPhotos(photos, thumbUrl, onClick) {
    this.photoMarkers.forEach((m) => m.remove());
    this.photoMarkers = [];
    this.whenReady(() => {
      photos.filter((p) => p.pos).forEach((p) => {
        const b = document.createElement('button');
        b.className = 'photo-marker';
        b.title = p.caption || p.name || 'Fotografia';
        b.innerHTML = `<img alt="" src="${thumbUrl(p)}">`;
        b.addEventListener('click', (e) => { e.stopPropagation(); onClick(p); });
        this.photoMarkers.push(new maplibregl.Marker({ element: b }).setLngLat([p.pos.lon, p.pos.lat]).addTo(this.map));
      });
    });
  }

  // ----- kurzor z grafu -----
  setCursor(i) {
    if (!this.loaded) return;
    const mk = this.cursorMarker;
    if (i == null) { mk.getElement().style.display = 'none'; return; }
    mk.getElement().style.display = '';
    mk.setLngLat([this.track.lon[i], this.track.lat[i]]);
  }

  // ----- prehrávanie -----
  showPlayhead(on) { if (this.loaded) this.posMarker.getElement().style.display = on ? '' : 'none'; }
  setPlayhead(s, { follow, brg, force }) {
    if (!this.loaded) return;
    this.showPlayhead(true);
    this.posMarker.setLngLat([s.lon, s.lat]);
    const now = performance.now();
    if (force || now - this.lastProgress > 90) {
      this.lastProgress = now;
      let lo = 0, hi = this.disp.length - 1;
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (this.disp[mid] <= s.lo) lo = mid; else hi = mid - 1; }
      const part = this.coords.slice(0, lo + 1);
      part.push([s.lon, s.lat]);
      this.map.getSource('progress').setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: part } });
    }
    if (follow && performance.now() >= this.camLock && Number.isFinite(s.lon) && Number.isFinite(s.lat) && Number.isFinite(brg)) {
      try { this.map.jumpTo({ center: [s.lon, s.lat], bearing: brg }); } catch (err) { console.warn(err); }
    }
  }
  clearProgress() {
    if (!this.loaded) return;
    this.map.getSource('progress').setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: [] } });
    this.showPlayhead(false);
  }

  // ----- ručné umiestnenie fotografie -----
  startPick(cb) {
    const canvas = this.map.getCanvas();
    canvas.style.cursor = 'crosshair';
    const handler = (e) => { cleanup(); cb(e.lngLat); };
    const cleanup = () => { canvas.style.cursor = ''; this.map.off('click', handler); this._cancelPick = null; };
    this.map.on('click', handler);
    this._cancelPick = cleanup;
    return cleanup;
  }
  cancelPick() { this._cancelPick && this._cancelPick(); }

  resize() { this.map.resize(); }
  destroy() { this.cancelPick(); this.photoMarkers.forEach((m) => m.remove()); this.map.remove(); }
}

// ---------- prehrávač ----------
const angDiff = (a, b) => ((b - a + 540) % 360) - 180;

export class Player {
  constructor(tmap, { onTick, onEnd }) {
    this.tm = tmap; this.track = tmap.track; this.d = tmap.d;
    this.onTick = onTick; this.onEnd = onEnd;
    this.u = 0; this.mul = 1; this.playing = false; this.follow = true; this.brg = 0;
    this.raf = 0; this.last = 0; this.first = true;
    this.base = 60000; // 1× = celá aktivita sa prehrá za cca 60 s
  }
  get rate() { return (this.d.U / this.base) * this.mul; } // jednotiek osi (ms alebo m) za ms reálneho času
  get frac() { return this.d.U > 0 ? this.u / this.d.U : 0; }

  target(s) {
    const d = this.d, tr = this.track;
    const j = indexAtDistance(d, s.dist + 70);
    if (d.dist[j] - s.dist < 5) return null;
    return bearing(s.lat, s.lon, tr.lat[j], tr.lon[j]);
  }
  emit(dtMs, force) {
    const s = sampleAt(this.track, this.d, this.u);
    const tgt = this.target(s);
    if (tgt != null) {
      if (this.first) { this.brg = tgt; this.first = false; }
      else this.brg = (this.brg + angDiff(this.brg, tgt) * (1 - Math.exp(-(dtMs || 16) / 500)) + 360) % 360;
    }
    this.tm.setPlayhead(s, { follow: this.follow, brg: this.brg, force });
    this.onTick && this.onTick(s, this.u, this.frac);
  }
  tick = (now) => {
    if (!this.playing) return;
    const dt = Math.min(100, now - this.last);
    this.last = now;
    this.u += dt * this.rate;
    if (this.u >= this.d.U) { this.u = this.d.U; this.playing = false; this.tm.setHills(true); this.emit(dt, true); this.onEnd && this.onEnd(); return; }
    this.emit(dt);
    this.raf = requestAnimationFrame(this.tick);
  };
  play() {
    if (this.u >= this.d.U) this.u = 0;
    if (this.u === 0) this.first = true;
    this.playing = true; this.last = performance.now();
    if (this.follow) {
      const s0 = sampleAt(this.track, this.d, this.u), t0 = this.target(s0);
      if (t0 != null) this.brg = t0;
      this.tm.beginFollow(s0.lon, s0.lat, this.brg);
    }
    this.tm.setHills(false);
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(this.tick);
  }
  pause() { this.playing = false; cancelAnimationFrame(this.raf); this.tm.setHills(true); }
  toggle() { this.playing ? this.pause() : this.play(); return this.playing; }
  restart() { this.pause(); this.u = 0; this.first = true; this.tm.clearProgress(); this.emit(0, true); this.tm.showPlayhead(true); }
  seekFrac(f) { this.u = Math.max(0, Math.min(1, f)) * this.d.U; this.first = this.first && this.u === 0; this.emit(0, true); }
  seekIndex(i) { this.u = this.d.axis[i]; this.emit(0, true); }
  setSpeed(m) { this.mul = m; }
  setFollow(v) { this.follow = v; }
  destroy() { this.playing = false; cancelAnimationFrame(this.raf); }
}
