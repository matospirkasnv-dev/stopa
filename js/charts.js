// Jednoduchý interaktívny graf profilu (výška / rýchlosť) na canvase
export class ProfileChart {
  constructor(canvas, { xs, ys, color, fmtY, unit, onHover, onLeave, onClick, fill = true, nonNeg = false }) {
    Object.assign(this, { canvas, xs, ys, color, fmtY, unit, onHover, onLeave, onClick, fill, nonNeg });
    this.cursor = null;
    this.ctx = canvas.getContext('2d');
    const bounds = this.bounds();
    this.min = bounds.min; this.max = bounds.max;
    this.ro = new ResizeObserver(() => this.draw());
    this.ro.observe(canvas);
    canvas.addEventListener('pointermove', (e) => this.pointer(e, false));
    canvas.addEventListener('pointerdown', (e) => this.pointer(e, true));
    canvas.addEventListener('pointerleave', () => { this.hover = null; this.draw(); this.onLeave && this.onLeave(); });
    this.hover = null;
    this.draw();
  }
  bounds() {
    let min = Infinity, max = -Infinity;
    for (const v of this.ys) if (Number.isFinite(v)) { if (v < min) min = v; if (v > max) max = v; }
    if (!isFinite(min)) { min = 0; max = 1; }
    if (max - min < 1e-6) { max = min + 1; }
    const padv = (max - min) * 0.08;
    return { min: Math.max(this.nonNeg && min >= 0 ? 0 : -Infinity, min - padv), max: max + padv };
  }
  setCursor(i) { this.cursor = i; this.draw(); }
  indexAtX(px) {
    const r = this.rect, x0 = r.l, x1 = r.w - r.r;
    const xmax = this.xs[this.xs.length - 1];
    const target = Math.max(0, Math.min(1, (px - x0) / (x1 - x0))) * xmax;
    let lo = 0, hi = this.xs.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (this.xs[mid] < target) lo = mid + 1; else hi = mid; }
    if (lo > 0 && Math.abs(this.xs[lo - 1] - target) < Math.abs(this.xs[lo] - target)) lo--;
    return lo;
  }
  pointer(e, click) {
    const b = this.canvas.getBoundingClientRect();
    const i = this.indexAtX(e.clientX - b.left);
    this.hover = i;
    this.draw();
    if (click) this.onClick && this.onClick(i);
    else this.onHover && this.onHover(i);
  }
  draw() {
    const c = this.canvas, dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth, hgt = c.clientHeight;
    if (!w || !hgt) return;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(hgt * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(hgt * dpr); }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, hgt);
    const css = getComputedStyle(document.documentElement);
    const muted = css.getPropertyValue('--muted').trim() || '#8b95a5';
    const line = css.getPropertyValue('--line').trim() || 'rgba(255,255,255,.08)';
    const r = { l: 46, r: 10, t: 10, b: 22, w, h: hgt };
    this.rect = r;
    const X = (v) => r.l + (v / this.xs[this.xs.length - 1]) * (w - r.l - r.r);
    const Y = (v) => r.t + (1 - (v - this.min) / (this.max - this.min)) * (hgt - r.t - r.b);
    ctx.font = '11px Inter, system-ui, sans-serif';
    ctx.fillStyle = muted; ctx.strokeStyle = line; ctx.lineWidth = 1;
    // mriežka a popisy osí
    for (let k = 0; k <= 3; k++) {
      const v = this.min + ((this.max - this.min) * k) / 3, y = Y(v);
      ctx.beginPath(); ctx.moveTo(r.l, y + 0.5); ctx.lineTo(w - r.r, y + 0.5); ctx.stroke();
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      ctx.fillText(this.axisLabel(v), r.l - 6, y);
    }
    const xmax = this.xs[this.xs.length - 1];
    const ticks = w < 420 ? 2 : w < 640 ? 3 : 5;
    ctx.textBaseline = 'top';
    for (let k = 0; k <= ticks; k++) {
      const v = (xmax * k) / ticks;
      ctx.textAlign = k === 0 ? 'left' : k === ticks ? 'right' : 'center';
      ctx.fillText((v / 1000).toFixed(v >= 10000 ? 0 : 1).replace('.', ',') + ' km', X(v), hgt - r.b + 6);
    }
    // čiara
    const n = this.xs.length, step = Math.max(1, Math.floor(n / (w * 1.5)));
    ctx.beginPath();
    let started = false, lastX = 0, firstX = 0;
    for (let i = 0; i < n; i += step) {
      const v = this.ys[i];
      if (!Number.isFinite(v)) { started = false; continue; }
      const x = X(this.xs[i]), y = Y(v);
      if (!started) { ctx.moveTo(x, y); started = true; firstX = firstX || x; } else ctx.lineTo(x, y);
      lastX = x;
    }
    ctx.strokeStyle = this.color; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke();
    if (this.fill) {
      ctx.lineTo(lastX, hgt - r.b); ctx.lineTo(r.l, hgt - r.b); ctx.closePath();
      const g = ctx.createLinearGradient(0, r.t, 0, hgt - r.b);
      g.addColorStop(0, this.color + '55'); g.addColorStop(1, this.color + '00');
      ctx.fillStyle = g; ctx.fill();
    }
    // kurzor (prehrávanie) a hover
    const mark = (i, strong) => {
      if (i == null || !Number.isFinite(this.ys[i])) return;
      const x = X(this.xs[i]), y = Y(this.ys[i]);
      ctx.strokeStyle = strong ? 'rgba(255,255,255,.7)' : 'rgba(255,255,255,.35)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x + 0.5, r.t); ctx.lineTo(x + 0.5, hgt - r.b); ctx.stroke();
      ctx.fillStyle = this.color; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, 4.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      if (strong) {
        const txt = `${(this.xs[i] / 1000).toFixed(2).replace('.', ',')} km · ${this.fmtY(this.ys[i])}`;
        const tw = ctx.measureText(txt).width + 14;
        let bx = x + 10; if (bx + tw > w - 4) bx = x - 10 - tw;
        ctx.fillStyle = 'rgba(10,14,20,.92)'; ctx.strokeStyle = 'rgba(255,255,255,.15)';
        ctx.beginPath(); ctx.roundRect(bx, r.t + 2, tw, 22, 6); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ctx.fillText(txt, bx + 7, r.t + 13);
      }
    };
    mark(this.cursor, false);
    mark(this.hover, true);
  }
  axisLabel(v) { return this.unit === 'm' ? Math.round(v) + ' m' : Math.round(v); }
  destroy() { this.ro.disconnect(); }
}
