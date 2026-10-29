// The canvas area: zoom, pan, rulers, checkerboard, marching ants and tool overlays.

const ZOOM_STEPS = [0.01, 0.02, 0.03, 0.05, 0.0667, 0.0833, 0.125, 0.1667, 0.25, 0.3333, 0.5, 0.6667, 1, 2, 3, 4, 5, 6, 7, 8, 12, 16, 24, 32];
const RULER = 18;

const View = {
  area: null,
  stage: null,
  ctx: null,
  pointer: { x: 0, y: 0, inside: false },
  antsPhase: 0,
  checker: null,

  init() {
    this.area = document.getElementById('canvas-area');
    this.stage = document.getElementById('stage');
    this.ctx = this.stage.getContext('2d');
    this.rulerTop = document.getElementById('ruler-top');
    this.rulerLeft = document.getElementById('ruler-left');

    const tile = makeCanvas(16, 16);
    const t = ctxOf(tile);
    t.fillStyle = '#ffffff';
    t.fillRect(0, 0, 16, 16);
    t.fillStyle = '#cccccc';
    t.fillRect(0, 0, 8, 8);
    t.fillRect(8, 8, 8, 8);
    this.checker = this.ctx.createPattern(tile, 'repeat');

    new ResizeObserver(() => App.requestRender()).observe(this.area);
    setInterval(() => {
      if (App.doc?.selection && App.showExtras) {
        this.antsPhase = (this.antsPhase + 1) % 8;
        App.requestRender();
      }
    }, 120);
  },

  size() {
    return { w: this.area.clientWidth, h: this.area.clientHeight };
  },

  toDoc(clientX, clientY, doc = App.doc) {
    const r = this.stage.getBoundingClientRect();
    return { x: (clientX - r.left - doc.view.ox) / doc.view.zoom, y: (clientY - r.top - doc.view.oy) / doc.view.zoom };
  },

  toScreen(x, y, doc = App.doc) {
    return { x: x * doc.view.zoom + doc.view.ox, y: y * doc.view.zoom + doc.view.oy };
  },

  // ---------- Zoom & pan ----------
  fit(doc = App.doc, { fill = false, allowUp = true } = {}) {
    if (!doc) return;
    const { w, h } = this.size();
    const pad = 40;
    const zx = (w - pad * 2) / doc.width;
    const zy = (h - pad * 2) / doc.height;
    let z = fill ? Math.max(zx, zy) : Math.min(zx, zy);
    if (!allowUp) z = Math.min(1, z);
    this.setZoom(doc, Math.max(0.01, z));
    doc.view.ox = Math.round((w - doc.width * doc.view.zoom) / 2);
    doc.view.oy = Math.round((h - doc.height * doc.view.zoom) / 2);
    doc.view.placed = true;
    App.requestRender();
    Bus.emit('view', doc);
  },

  setZoom(doc, z, anchor) {
    z = clamp(z, 0.01, 32);
    const { w, h } = this.size();
    const a = anchor || { x: w / 2, y: h / 2 };
    const docX = (a.x - doc.view.ox) / doc.view.zoom;
    const docY = (a.y - doc.view.oy) / doc.view.zoom;
    doc.view.zoom = z;
    doc.view.ox = Math.round(a.x - docX * z);
    doc.view.oy = Math.round(a.y - docY * z);
    App.requestRender();
    Bus.emit('view', doc);
  },

  zoomStep(dir, anchor, doc = App.doc) {
    if (!doc) return;
    const z = doc.view.zoom;
    const next = dir > 0 ? ZOOM_STEPS.find((s) => s > z * 1.001) : [...ZOOM_STEPS].reverse().find((s) => s < z * 0.999);
    if (next) this.setZoom(doc, next, anchor);
  },

  pan(dx, dy, doc = App.doc) {
    if (!doc) return;
    doc.view.ox = Math.round(doc.view.ox + dx);
    doc.view.oy = Math.round(doc.view.oy + dy);
    App.requestRender();
  },

  // ---------- Drawing ----------
  draw() {
    const doc = App.doc;
    const { w, h } = this.size();
    const dpr = devicePixelRatio || 1;
    if (this.stage.width !== Math.round(w * dpr) || this.stage.height !== Math.round(h * dpr)) {
      this.stage.width = Math.round(w * dpr);
      this.stage.height = Math.round(h * dpr);
    }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = getComputedStyle(this.area).getPropertyValue('--pasteboard') || '#202020';
    ctx.fillRect(0, 0, w, h);
    if (!doc) return;
    if (!doc.view.placed) this.fit(doc, { allowUp: false });

    const { zoom, ox, oy } = doc.view;
    const dw = doc.width * zoom;
    const dh = doc.height * zoom;

    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.45)';
    ctx.shadowBlur = 14;
    ctx.fillStyle = '#000';
    ctx.fillRect(ox, oy, dw, dh);
    ctx.restore();

    ctx.save();
    ctx.translate(ox, oy);
    ctx.fillStyle = this.checker;
    ctx.fillRect(0, 0, dw, dh);
    ctx.restore();

    ctx.imageSmoothingEnabled = zoom < 1;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(doc.composite, ox, oy, dw, dh);
    ctx.imageSmoothingEnabled = true;

    if (App.showGrid) this.drawGrid(ctx, doc);
    if (zoom >= 8 && App.showExtras) this.drawPixelGrid(ctx, doc, w, h);

    // Overlays in document space.
    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(zoom, zoom);
    if (doc.selection && App.showExtras && !Tools.hidesSelection()) this.drawAnts(ctx, doc.selection, zoom);
    Tools.drawOverlay(ctx, zoom, doc);
    ctx.restore();

    Tools.drawCursor(ctx, doc);
    if (App.showRulers) this.drawRulers(doc);
  },

  drawAnts(ctx, mask, zoom) {
    const path = Sel.ants(mask);
    ctx.lineWidth = 1 / zoom;
    ctx.setLineDash([]);
    ctx.strokeStyle = '#fff';
    ctx.stroke(path);
    ctx.setLineDash([4 / zoom, 4 / zoom]);
    ctx.lineDashOffset = -this.antsPhase / zoom;
    ctx.strokeStyle = '#000';
    ctx.stroke(path);
    ctx.setLineDash([]);
  },

  drawGrid(ctx, doc) {
    const { zoom, ox, oy } = doc.view;
    let step = 100;
    while (step * zoom > 160) step /= 2;
    while (step * zoom < 24) step *= 2;
    ctx.save();
    ctx.beginPath();
    for (let x = 0; x <= doc.width; x += step) { const sx = Math.round(ox + x * zoom) + 0.5; ctx.moveTo(sx, oy); ctx.lineTo(sx, oy + doc.height * zoom); }
    for (let y = 0; y <= doc.height; y += step) { const sy = Math.round(oy + y * zoom) + 0.5; ctx.moveTo(ox, sy); ctx.lineTo(ox + doc.width * zoom, sy); }
    ctx.strokeStyle = 'rgba(80,140,255,.45)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  },

  drawPixelGrid(ctx, doc, w, h) {
    const { zoom, ox, oy } = doc.view;
    const x0 = Math.max(0, Math.floor(-ox / zoom)), x1 = Math.min(doc.width, Math.ceil((w - ox) / zoom));
    const y0 = Math.max(0, Math.floor(-oy / zoom)), y1 = Math.min(doc.height, Math.ceil((h - oy) / zoom));
    ctx.save();
    ctx.beginPath();
    for (let x = x0; x <= x1; x++) { const sx = Math.round(ox + x * zoom) + 0.5; ctx.moveTo(sx, oy + y0 * zoom); ctx.lineTo(sx, oy + y1 * zoom); }
    for (let y = y0; y <= y1; y++) { const sy = Math.round(oy + y * zoom) + 0.5; ctx.moveTo(ox + x0 * zoom, sy); ctx.lineTo(ox + x1 * zoom, sy); }
    ctx.strokeStyle = 'rgba(128,128,128,.35)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  },

  drawRulers(doc) {
    const dpr = devicePixelRatio || 1;
    const css = getComputedStyle(document.body);
    const bg = css.getPropertyValue('--ruler-bg');
    const fg = css.getPropertyValue('--ruler-fg');
    const { zoom, ox, oy } = doc.view;
    let step = 1;
    for (const s of [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000]) { step = s; if (s * zoom >= 60) break; }

    for (const [canvas, horizontal] of [[this.rulerTop, true], [this.rulerLeft, false]]) {
      const len = horizontal ? canvas.clientWidth : canvas.clientHeight;
      canvas.width = Math.round((horizontal ? len : RULER) * dpr);
      canvas.height = Math.round((horizontal ? RULER : len) * dpr);
      const c = canvas.getContext('2d');
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.fillStyle = bg;
      c.fillRect(0, 0, horizontal ? len : RULER, horizontal ? RULER : len);
      c.strokeStyle = fg;
      c.fillStyle = fg;
      c.font = '9px Inter, sans-serif';
      c.lineWidth = 1;
      const origin = horizontal ? ox : oy;
      const shift = horizontal ? 0 : 0;
      const start = Math.floor(-origin / zoom / step) * step;
      c.beginPath();
      for (let v = start; v * zoom + origin < len; v += step / 5) {
        const p = Math.round(v * zoom + origin + shift) + 0.5;
        const major = Math.abs(v / step - Math.round(v / step)) < 1e-6;
        const tick = major ? RULER : RULER * 0.3;
        if (horizontal) { c.moveTo(p, RULER); c.lineTo(p, RULER - tick); }
        else { c.moveTo(RULER, p); c.lineTo(RULER - tick, p); }
        if (major) {
          if (horizontal) c.fillText(String(Math.round(v)), p + 2, 9);
          else {
            c.save();
            c.translate(9, p + 2);
            c.rotate(-Math.PI / 2);
            c.textAlign = 'right';
            c.fillText(String(Math.round(v)), 0, 0);
            c.restore();
          }
        }
      }
      c.stroke();
      // Pointer position marker.
      if (this.pointer.inside) {
        const p = horizontal ? this.pointer.sx : this.pointer.sy;
        c.strokeStyle = '#4c8dff';
        c.beginPath();
        if (horizontal) { c.moveTo(p + 0.5, 0); c.lineTo(p + 0.5, RULER); } else { c.moveTo(0, p + 0.5); c.lineTo(RULER, p + 0.5); }
        c.stroke();
      }
    }
  },
};
