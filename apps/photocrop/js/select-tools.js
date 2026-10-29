// Selection tools, Crop and Move.

function insideSelection(doc, p) {
  if (!doc.selection) return false;
  const x = Math.floor(p.x), y = Math.floor(p.y);
  if (x < 0 || y < 0 || x >= doc.width || y >= doc.height) return false;
  return ctxOf(doc.selection).getImageData(x, y, 1, 1).data[3] > 127;
}

function shiftMask(doc, mask, dx, dy) {
  const m = Sel.blank(doc);
  ctxOf(m).drawImage(mask, dx, dy);
  return Sel.isEmpty(m) ? null : m;
}

function strokeOutline(ctx, zoom, draw) {
  ctx.save();
  ctx.lineWidth = 1 / zoom;
  ctx.beginPath();
  draw();
  ctx.strokeStyle = '#fff';
  ctx.stroke();
  ctx.setLineDash([4 / zoom, 4 / zoom]);
  ctx.strokeStyle = '#000';
  ctx.stroke();
  ctx.restore();
}

function ratioRect(anchor, p, ratio) {
  let w = p.x - anchor.x, h = p.y - anchor.y;
  if (Math.abs(w) / ratio > Math.abs(h)) h = (Math.sign(h) || 1) * (Math.abs(w) / ratio);
  else w = (Math.sign(w) || 1) * Math.abs(h) * ratio;
  return rectFromPoints(anchor, { x: anchor.x + w, y: anchor.y + h });
}

// ---------- Marquees ----------
function marqueeTool(def) {
  return {
    cursor: 'crosshair',
    optionsKey: 'marquee',
    options: { mode: 'new', feather: 0, style: 'normal', ratioW: 1, ratioH: 1, fixedW: 64, fixedH: 64 },
    ...def,
    down(p, s) {
      const doc = App.doc;
      const o = Tools.o(def.id);
      s.mode = selectionMode(p, o.mode);
      s.shiftAtStart = p.shift;
      s.altAtStart = p.alt;
      if (s.mode === 'new' && insideSelection(doc, p)) {
        s.moveSel = true;
        s.hideSelection = true;
        s.dx = s.dy = 0;
        return;
      }
      s.from = p;
      if (o.style === 'fixed') s.rect = { x: Math.round(p.x), y: Math.round(p.y), w: o.fixedW, h: o.fixedH };
    },
    move(p, s) {
      if (s.moveSel) {
        s.dx = Math.round(p.x - s.start.x);
        s.dy = Math.round(p.y - s.start.y);
        return;
      }
      const o = Tools.o(def.id);
      if (o.style === 'fixed') {
        s.rect = { x: Math.round(p.x), y: Math.round(p.y), w: o.fixedW, h: o.fixedH };
        return;
      }
      const fromCenter = p.alt && !s.altAtStart;
      let r;
      if (o.style === 'ratio') r = ratioRect(s.from, p, o.ratioW / o.ratioH);
      else if (p.shift && !s.shiftAtStart) r = ratioRect(s.from, p, 1);
      else r = rectFromPoints(s.from, p);
      if (fromCenter) {
        const w = Math.abs(p.x - s.from.x) * 2, h = Math.abs(p.y - s.from.y) * 2;
        r = { x: s.from.x - w / 2, y: s.from.y - h / 2, w, h };
        if (p.shift && !s.shiftAtStart) { const m = Math.max(w, h); r = { x: s.from.x - m / 2, y: s.from.y - m / 2, w: m, h: m }; }
      }
      const x0 = Math.round(r.x), y0 = Math.round(r.y);
      s.rect = { x: x0, y: y0, w: Math.round(r.x + r.w) - x0, h: Math.round(r.y + r.h) - y0 };
    },
    up(p, s) {
      const doc = App.doc;
      if (s.moveSel) {
        if (s.dx || s.dy) commitSelection(doc, shiftMask(doc, doc.selection, s.dx, s.dy), 'Move Selection');
        return;
      }
      if (!s.rect || s.rect.w < 1 || s.rect.h < 1) {
        if (s.mode === 'new' && doc.selection) commitSelection(doc, null, 'Deselect');
        return;
      }
      let m = def.shape === 'rect' ? Sel.rect(doc, s.rect) : Sel.ellipse(doc, s.rect);
      const o = Tools.o(def.id);
      if (o.feather > 0) m = Sel.feather(m, o.feather);
      commitSelection(doc, Sel.combine(doc, doc.selection, m, s.mode), def.name.replace(' Tool', ''), def.icon);
    },
    overlay(ctx, zoom, doc, s) {
      if (!s) return;
      if (s.moveSel) {
        ctx.save();
        ctx.translate(s.dx, s.dy);
        View.drawAnts(ctx, doc.selection, zoom);
        ctx.restore();
        return;
      }
      const r = s.rect;
      if (!r) return;
      strokeOutline(ctx, zoom, () => {
        if (def.shape === 'rect') ctx.rect(r.x, r.y, r.w, r.h);
        else ctx.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2);
      });
    },
  };
}

Tools.define('marquee-rect', marqueeTool({ name: 'Rectangular Marquee Tool', key: 'M', icon: 'marqueeRect', shape: 'rect', id: 'marquee-rect' }));
Tools.define('marquee-ellipse', marqueeTool({ name: 'Elliptical Marquee Tool', key: 'M', icon: 'marqueeEllipse', shape: 'ellipse', id: 'marquee-ellipse' }));

// ---------- Lassos ----------
function finishLasso(doc, points, mode, name, iconName) {
  if (points.length < 3) {
    if (mode === 'new' && doc.selection) commitSelection(doc, null, 'Deselect');
    return;
  }
  let m = Sel.polygon(doc, points);
  const o = Tools.o('lasso');
  if (o.feather > 0) m = Sel.feather(m, o.feather);
  if (Sel.isEmpty(m)) m = null;
  commitSelection(doc, m ? Sel.combine(doc, doc.selection, m, mode) : doc.selection, name, iconName);
}

function drawPolyline(ctx, zoom, points, extra) {
  strokeOutline(ctx, zoom, () => {
    points.forEach((pt, i) => (i ? ctx.lineTo(pt.x, pt.y) : ctx.moveTo(pt.x, pt.y)));
    if (extra) ctx.lineTo(extra.x, extra.y);
  });
}

Tools.define('lasso', {
  name: 'Lasso Tool', key: 'L', icon: 'lasso', cursor: 'crosshair', optionsKey: 'lasso',
  options: { mode: 'new', feather: 0 },
  down(p, s) {
    s.mode = selectionMode(p, Tools.o('lasso').mode);
    s.points = [{ x: p.x, y: p.y }];
  },
  move(p, s) {
    const last = s.points[s.points.length - 1];
    if (Math.hypot(p.x - last.x, p.y - last.y) * App.doc.view.zoom >= 1.5) s.points.push({ x: p.x, y: p.y });
  },
  up(p, s) { finishLasso(App.doc, s.points, s.mode, 'Lasso', 'lasso'); },
  overlay(ctx, zoom, doc, s) {
    if (s?.points) drawPolyline(ctx, zoom, [...s.points, s.points[0]]);
  },
});

Tools.define('lasso-poly', {
  name: 'Polygonal Lasso Tool', key: 'L', icon: 'lassoPoly', cursor: 'crosshair', optionsKey: 'lasso',
  points: null,
  hoverPt: null,
  down(p) {
    const pt = { x: p.x, y: p.y };
    if (!this.points) {
      this.points = [pt];
      this.mode = selectionMode(p, Tools.o('lasso').mode);
      return;
    }
    const first = View.toScreen(this.points[0].x, this.points[0].y);
    if (this.points.length > 2 && Math.hypot(p.sx - first.x, p.sy - first.y) < 8) this.close();
    else this.points.push(pt);
  },
  hover(p) { this.hoverPt = p; },
  move(p) { this.hoverPt = p; },
  dblclick() { if (this.points) this.close(); },
  close() {
    const pts = this.points;
    this.points = null;
    finishLasso(App.doc, pts, this.mode, 'Polygonal Lasso', 'lassoPoly');
  },
  deactivate() { this.points = null; },
  onKey(e) {
    if (!this.points) return false;
    if (e.key === 'Enter') this.close();
    else if (e.key === 'Escape') this.points = null;
    else if (e.key === 'Backspace' || e.key === 'Delete') { this.points.pop(); if (!this.points.length) this.points = null; }
    else return false;
    App.requestRender();
    return true;
  },
  overlay(ctx, zoom) {
    if (this.points) drawPolyline(ctx, zoom, this.points, this.hoverPt);
  },
});

// ---------- Magic wand ----------
Tools.define('wand', {
  name: 'Magic Wand Tool', key: 'W', icon: 'wand', cursor: 'crosshair',
  options: { mode: 'new', tolerance: 32, antiAlias: true, contiguous: true, sampleAll: false },
  down(p) {
    const doc = App.doc;
    const o = Tools.o('wand');
    const mode = selectionMode(p, o.mode);
    const layer = doc.active;
    let src = doc.flattened(), ox = 0, oy = 0;
    if (!o.sampleAll && layer?.canvas) { src = layer.canvas; ox = layer.x; oy = layer.y; }
    const bytes = Sel.flood(ctxOf(src).getImageData(0, 0, src.width, src.height), p.x - ox, p.y - oy, o.tolerance, o.contiguous);
    let m = Sel.fromBytes(doc, bytes, src.width, src.height, ox, oy);
    if (Sel.isEmpty(m)) m = null;
    else if (o.antiAlias) m = Sel.feather(m, 1);
    if (!m && mode !== 'new') return;
    if (!m && !doc.selection) return;
    commitSelection(doc, m ? Sel.combine(doc, doc.selection, m, mode) : null, 'Magic Wand', 'wand');
  },
});

// ---------- Crop ----------
const CROP_RATIOS = [['free', 'Ratio'], ['original', 'Original Ratio'], ['1:1', '1 : 1 (Square)'], ['4:5', '4 : 5 (8 : 10)'], ['5:7', '5 : 7'], ['2:3', '2 : 3 (4 : 6)'], ['3:2', '3 : 2'], ['16:9', '16 : 9'], ['9:16', '9 : 16']];
const HANDLE_IDS = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const HANDLE_CURSORS = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', move: 'move' };

function rectHandles(r) {
  const xs = { w: r.x, c: r.x + r.w / 2, e: r.x + r.w };
  const ys = { n: r.y, c: r.y + r.h / 2, s: r.y + r.h };
  return {
    nw: [xs.w, ys.n], n: [xs.c, ys.n], ne: [xs.e, ys.n], e: [xs.e, ys.c],
    se: [xs.e, ys.s], s: [xs.c, ys.s], sw: [xs.w, ys.s], w: [xs.w, ys.c],
  };
}

Tools.define('crop', {
  name: 'Crop Tool', key: 'C', icon: 'crop',
  options: { ratio: 'free', deletePixels: true },
  rect: null,
  docId: null,
  ensure(doc) {
    if (this.docId !== doc.id || !this.rect) {
      this.rect = { x: 0, y: 0, w: doc.width, h: doc.height };
      this.docId = doc.id;
    }
  },
  activate() { this.rect = null; },
  deactivate() { this.rect = null; },
  ratio(doc) {
    const r = Tools.o('crop').ratio;
    if (r === 'free') return null;
    if (r === 'original') return doc.width / doc.height;
    const [a, b] = r.split(':').map(Number);
    return a / b;
  },
  hit(p) {
    const doc = App.doc;
    if (!doc || !this.rect) return null;
    const tol = 9 / doc.view.zoom;
    const hs = rectHandles(this.rect);
    for (const id of HANDLE_IDS) if (Math.abs(p.x - hs[id][0]) <= tol && Math.abs(p.y - hs[id][1]) <= tol) return id;
    const r = this.rect;
    return p.x > r.x && p.y > r.y && p.x < r.x + r.w && p.y < r.y + r.h ? 'move' : null;
  },
  cursor(p) { return HANDLE_CURSORS[this.hit(p)] || 'crosshair'; },
  down(p, s) {
    this.ensure(App.doc);
    s.mode = this.hit(p) || 'new';
    s.orig = { ...this.rect };
  },
  move(p, s) {
    const doc = App.doc;
    const ratio = this.ratio(doc);
    const o = s.orig;
    if (s.mode === 'move') {
      this.rect = { ...o, x: Math.round(o.x + p.x - s.start.x), y: Math.round(o.y + p.y - s.start.y) };
      return;
    }
    if (s.mode === 'new') {
      this.rect = ratio || p.shift ? ratioRect(s.start, p, ratio || 1) : rectFromPoints(s.start, p);
      return;
    }
    let x0 = o.x, y0 = o.y, x1 = o.x + o.w, y1 = o.y + o.h;
    const corner = s.mode.length === 2;
    if (corner && (ratio || p.shift)) {
      const anchor = { x: s.mode.includes('w') ? x1 : x0, y: s.mode.includes('n') ? y1 : y0 };
      this.rect = ratioRect(anchor, p, ratio || o.w / o.h);
      return;
    }
    if (s.mode.includes('w')) x0 = p.x;
    if (s.mode.includes('e')) x1 = p.x;
    if (s.mode.includes('n')) y0 = p.y;
    if (s.mode.includes('s')) y1 = p.y;
    let r = rectFromPoints({ x: x0, y: y0 }, { x: x1, y: y1 });
    if (ratio && !corner) {
      if (s.mode === 'n' || s.mode === 's') { const w = r.h * ratio; r = { ...r, x: r.x + (r.w - w) / 2, w }; }
      else { const h = r.w / ratio; r = { ...r, y: r.y + (r.h - h) / 2, h }; }
    }
    this.rect = r;
  },
  up() {
    const r = this.rect;
    this.rect = { x: Math.round(r.x), y: Math.round(r.y), w: Math.max(1, Math.round(r.w)), h: Math.max(1, Math.round(r.h)) };
  },
  dblclick(p) { if (this.hit(p) === 'move') this.commit(); },
  onKey(e) {
    if (e.key === 'Enter') { this.commit(); return true; }
    if (e.key === 'Escape') { this.reset(); return true; }
    return false;
  },
  commit() {
    const doc = App.doc;
    if (!doc || !this.rect) return;
    const r = rectRoundOut(this.rect);
    this.rect = null;
    if (r.w < 1 || r.h < 1 || (r.x === 0 && r.y === 0 && r.w === doc.width && r.h === doc.height)) return;
    ImageOps.crop(doc, r, Tools.o('crop').deletePixels);
  },
  reset() {
    this.rect = null;
    App.requestRender();
  },
  overlay(ctx, zoom, doc) {
    this.ensure(doc);
    const r = this.rect;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,.55)';
    ctx.beginPath();
    ctx.rect(-1e5, -1e5, 2e5, 2e5);
    ctx.rect(r.x, r.y, r.w, r.h);
    ctx.fill('evenodd');
    ctx.lineWidth = 1 / zoom;
    ctx.strokeStyle = 'rgba(255,255,255,.5)';
    ctx.beginPath();
    for (let i = 1; i < 3; i++) {
      ctx.moveTo(r.x + (r.w * i) / 3, r.y); ctx.lineTo(r.x + (r.w * i) / 3, r.y + r.h);
      ctx.moveTo(r.x, r.y + (r.h * i) / 3); ctx.lineTo(r.x + r.w, r.y + (r.h * i) / 3);
    }
    ctx.stroke();
    ctx.strokeStyle = '#fff';
    ctx.strokeRect(r.x, r.y, r.w, r.h);
    const hs = rectHandles(r);
    const len = 14 / zoom, th = 3 / zoom;
    ctx.fillStyle = '#fff';
    for (const id of HANDLE_IDS) {
      const [x, y] = hs[id];
      if (id.length === 2) {
        const sx = id.includes('w') ? 1 : -1, sy = id.includes('n') ? 1 : -1;
        ctx.fillRect(x - (sx < 0 ? th : 0), y - (sy < 0 ? th : 0), sx * len, sy * th);
        ctx.fillRect(x - (sx < 0 ? th : 0), y - (sy < 0 ? th : 0), sx * th, sy * len);
      } else if (id === 'n' || id === 's') ctx.fillRect(x - len / 2, y - (id === 's' ? th : 0), len, th);
      else ctx.fillRect(x - (id === 'e' ? th : 0), y - len / 2, th, len);
    }
    ctx.restore();
  },
});

// ---------- Move ----------
Tools.define('move', {
  name: 'Move Tool', key: 'V', icon: 'move', cursor: 'move',
  options: { autoSelect: false },
  down(p, s) {
    const doc = App.doc;
    let layer = doc.active;
    if (Tools.o('move').autoSelect || p.ctrl) {
      const hit = layerAt(doc, p);
      if (hit) { doc.select(hit); layer = hit; }
    }
    if (!layer) return;
    if (layer.locked) { toast('This layer is locked.'); return; }
    s.layer = layer;
    s.dx = s.dy = 0;
    doc.history.begin('Move', 'move');
    if (doc.selection && layer.type === 'raster' && doc.target === 'pixels') {
      ensureCovers(layer, doc.rect);
      const canvas = layer.canvas;
      doc.history.touch(canvas);
      s.float = cloneCanvas(canvas);
      const f = ctxOf(s.float);
      f.globalCompositeOperation = 'destination-in';
      f.drawImage(doc.selection, -layer.x, -layer.y);
      const c = ctxOf(canvas);
      c.globalCompositeOperation = 'destination-out';
      c.drawImage(doc.selection, -layer.x, -layer.y);
      c.globalCompositeOperation = 'source-over';
      s.base = cloneCanvas(canvas);
      s.hideSelection = true;
    }
  },
  move(p, s) {
    if (!s.layer) return;
    let dx = Math.round(p.x - s.start.x), dy = Math.round(p.y - s.start.y);
    if (p.shift) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
    if (s.float) {
      const c = ctxOf(s.layer.canvas);
      c.save();
      c.globalCompositeOperation = 'copy';
      c.drawImage(s.base, 0, 0);
      c.globalCompositeOperation = 'source-over';
      c.drawImage(s.float, dx, dy);
      c.restore();
    } else {
      translateLayer(s.layer, dx - s.dx, dy - s.dy);
    }
    s.dx = dx;
    s.dy = dy;
    App.doc.invalidate();
  },
  up(p, s) {
    const doc = App.doc;
    if (!s.layer) return;
    if (!s.dx && !s.dy) { doc.history.cancel(); return; }
    if (s.float) doc.setSelection(shiftMask(doc, doc.selection, s.dx, s.dy));
    doc.history.commit();
  },
  overlay(ctx, zoom, doc, s) {
    if (s?.float && doc.selection) {
      ctx.save();
      ctx.translate(s.dx, s.dy);
      View.drawAnts(ctx, doc.selection, zoom);
      ctx.restore();
    }
  },
});
