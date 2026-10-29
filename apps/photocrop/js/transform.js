// Free Transform (Ctrl+T), the Type tool and the Shape tools.

// ---------- Free Transform ----------
const Transform = {
  active: null,

  start() {
    const doc = App.doc;
    const layer = doc?.active;
    if (!layer) return;
    if (layer.locked) { toast('This layer is locked.'); return; }
    if (layer.type === 'adjustment') { toast("Adjustment layers can't be transformed."); return; }
    App.finishEditing();
    doc.history.begin('Free Transform', 'transform');
    if (layer.type === 'text') {
      layer.type = 'raster';
      layer.text = null;
      toast('The type layer was rasterized so it can be transformed.');
    }
    let src, bounds, base = null, floating = false, maskSrc = null;
    if (doc.selection && doc.target === 'pixels') {
      ensureCovers(layer, doc.rect);
      doc.history.touch(layer.canvas);
      const lifted = cloneCanvas(layer.canvas);
      const f = ctxOf(lifted);
      f.globalCompositeOperation = 'destination-in';
      f.drawImage(doc.selection, -layer.x, -layer.y);
      const c = ctxOf(layer.canvas);
      c.globalCompositeOperation = 'destination-out';
      c.drawImage(doc.selection, -layer.x, -layer.y);
      c.globalCompositeOperation = 'source-over';
      const b = contentBounds(lifted);
      if (!b) { doc.history.cancel(); toast('The selected area is empty.'); return; }
      src = crop(lifted, b);
      bounds = { x: b.x + layer.x, y: b.y + layer.y, w: b.w, h: b.h };
      base = layer.canvas;
      floating = true;
    } else {
      const b = contentBounds(layer.canvas);
      if (!b) { doc.history.cancel(); toast('The layer is empty.'); return; }
      src = crop(layer.canvas, b);
      if (layer.mask) maskSrc = crop(layer.mask, b);
      bounds = { x: b.x + layer.x, y: b.y + layer.y, w: b.w, h: b.h };
    }
    this.active = {
      doc, layer, src, maskSrc, base, floating, bounds,
      cx: bounds.x + bounds.w / 2, cy: bounds.y + bounds.h / 2, sx: 1, sy: 1, angle: 0,
      prevTool: Tools.current,
    };
    layer.drawOverride = (ctx) => this.drawLayer(ctx);
    doc.invalidate();
    Bus.emit('tool');
    Tools.updateCursor();
  },

  matrix(t = this.active) {
    return new DOMMatrix()
      .translate(t.cx, t.cy)
      .rotate((t.angle * 180) / Math.PI)
      .scale(t.sx, t.sy)
      .translate(-t.bounds.w / 2, -t.bounds.h / 2);
  },

  corners(t = this.active) {
    const m = this.matrix(t);
    const { w, h } = t.bounds;
    return [[0, 0], [w, 0], [w, h], [0, h]].map(([x, y]) => m.transformPoint(new DOMPoint(x, y)));
  },

  drawLayer(ctx) {
    const t = this.active;
    if (t.base) ctx.drawImage(t.base, t.layer.x, t.layer.y);
    ctx.save();
    const m = this.matrix();
    ctx.transform(m.a, m.b, m.c, m.d, m.e, m.f);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(t.src, 0, 0);
    ctx.restore();
  },

  commit() {
    const t = this.active;
    if (!t) return;
    this.active = null;
    const { doc, layer } = t;
    layer.drawOverride = null;
    const pts = this.corners(t);
    let box = rectRoundOut({
      x: Math.min(...pts.map((p) => p.x)), y: Math.min(...pts.map((p) => p.y)),
      w: Math.max(...pts.map((p) => p.x)) - Math.min(...pts.map((p) => p.x)),
      h: Math.max(...pts.map((p) => p.y)) - Math.min(...pts.map((p) => p.y)),
    });
    if (t.base) box = rectUnion(box, { x: layer.x, y: layer.y, w: t.base.width, h: t.base.height });
    const m = new DOMMatrix().translate(-box.x, -box.y).multiply(this.matrix(t));
    const draw = (source, under) => {
      const c = makeCanvas(box.w, box.h);
      const x = ctxOf(c);
      if (under) x.drawImage(under, layer.x - box.x, layer.y - box.y);
      x.setTransform(m);
      x.imageSmoothingQuality = 'high';
      x.drawImage(source, 0, 0);
      return c;
    };
    const canvas = draw(t.src, t.base);
    if (layer.mask) layer.mask = t.maskSrc ? draw(t.maskSrc) : (() => { const c = makeCanvas(box.w, box.h); ctxOf(c).fillRect(0, 0, box.w, box.h); return c; })();
    layer.canvas = canvas;
    layer.x = box.x;
    layer.y = box.y;
    if (t.floating && doc.selection) {
      const sel = Sel.blank(doc);
      const sx = ctxOf(sel);
      const selSrc = crop(doc.selection, t.bounds);
      sx.setTransform(this.matrix(t));
      sx.drawImage(selSrc, 0, 0);
      doc.setSelection(Sel.isEmpty(sel) ? null : sel);
    }
    doc.history.commit();
    this.finish();
  },

  cancel() {
    const t = this.active;
    if (!t) return;
    this.active = null;
    t.layer.drawOverride = null;
    t.doc.history.cancel();
    this.finish();
  },

  finish() {
    Bus.emit('tool');
    Tools.updateCursor();
    App.requestRender();
  },

  // Flip/rotate the transform box (Edit › Transform while transforming).
  apply(kind) {
    const t = this.active;
    if (kind === 'flipH') t.sx *= -1;
    if (kind === 'flipV') t.sy *= -1;
    if (kind === 'rot90') t.angle += Math.PI / 2;
    if (kind === 'rot-90') t.angle -= Math.PI / 2;
    if (kind === 'rot180') t.angle += Math.PI;
    t.doc.invalidate();
    Bus.emit('tool');
  },
};

function crop(canvas, r) {
  const c = makeCanvas(r.w, r.h);
  ctxOf(c).drawImage(canvas, -r.x, -r.y);
  return c;
}

// Pointer handling while Free Transform is active.
Tools.define('transform', {
  name: 'Free Transform', icon: 'transform', hidden: true,
  hit(p) {
    const t = Transform.active;
    if (!t) return null;
    const m = Transform.matrix();
    const { w, h } = t.bounds;
    const handles = { nw: [0, 0], n: [w / 2, 0], ne: [w, 0], e: [w, h / 2], se: [w, h], s: [w / 2, h], sw: [0, h], w: [0, h / 2] };
    for (const [id, [x, y]] of Object.entries(handles)) {
      const pt = m.transformPoint(new DOMPoint(x, y));
      const sc = View.toScreen(pt.x, pt.y);
      if (Math.hypot(sc.x - p.sx, sc.y - p.sy) < 8) return id;
    }
    const local = m.inverse().transformPoint(new DOMPoint(p.x, p.y));
    if (local.x >= 0 && local.y >= 0 && local.x <= w && local.y <= h) return 'move';
    return 'rotate';
  },
  cursor(p) {
    const h = this.hit(p);
    return h === 'rotate' ? 'alias' : HANDLE_CURSORS[h] || 'default';
  },
  down(p, s) {
    const t = Transform.active;
    s.mode = this.hit(p);
    s.orig = { cx: t.cx, cy: t.cy, sx: t.sx, sy: t.sy, angle: t.angle };
    if (s.mode && s.mode.length <= 2) {
      // Anchor = the opposite handle (or the center with Alt), fixed in document space.
      const hx = s.mode.includes('w') ? 0 : s.mode.includes('e') ? 1 : 0.5;
      const hy = s.mode.includes('n') ? 0 : s.mode.includes('s') ? 1 : 0.5;
      s.h = { x: hx, y: hy };
    }
  },
  move(p, s) {
    const t = Transform.active;
    const o = s.orig;
    const { w, h } = t.bounds;
    if (s.mode === 'move') {
      t.cx = o.cx + p.x - s.start.x;
      t.cy = o.cy + p.y - s.start.y;
    } else if (s.mode === 'rotate') {
      const a0 = Math.atan2(s.start.y - o.cy, s.start.x - o.cx);
      let a = o.angle + Math.atan2(p.y - o.cy, p.x - o.cx) - a0;
      if (p.shift) a = Math.round(a / (Math.PI / 12)) * (Math.PI / 12);
      t.angle = a;
    } else if (s.h) {
      const center = p.alt;
      const ax = center ? 0.5 : 1 - s.h.x, ay = center ? 0.5 : 1 - s.h.y;
      const cos = Math.cos(o.angle), sin = Math.sin(o.angle);
      const toDoc = (u, v) => ({ x: o.cx + ((u - 0.5) * w * o.sx) * cos - ((v - 0.5) * h * o.sy) * sin, y: o.cy + ((u - 0.5) * w * o.sx) * sin + ((v - 0.5) * h * o.sy) * cos });
      const A = toDoc(ax, ay);
      // Pointer relative to the anchor, in the box's rotated frame.
      const dx = p.x - A.x, dy = p.y - A.y;
      const lx = dx * cos + dy * sin, ly = -dx * sin + dy * cos;
      let sx = o.sx, sy = o.sy;
      if (s.h.x !== 0.5) sx = lx / ((s.h.x - ax) * w);
      if (s.h.y !== 0.5) sy = ly / ((s.h.y - ay) * h);
      const corner = s.h.x !== 0.5 && s.h.y !== 0.5;
      if (corner && !p.shift) {
        // Proportional by default, like current Photoshop.
        const k = (sx / o.sx + sy / o.sy) / 2;
        sx = o.sx * k;
        sy = o.sy * k;
      }
      t.sx = Math.abs(sx) < 0.001 ? 0.001 * Math.sign(sx || 1) : sx;
      t.sy = Math.abs(sy) < 0.001 ? 0.001 * Math.sign(sy || 1) : sy;
      const ox = (0.5 - ax) * w * t.sx, oy = (0.5 - ay) * h * t.sy;
      t.cx = A.x + ox * cos - oy * sin;
      t.cy = A.y + ox * sin + oy * cos;
    }
    t.doc.invalidate();
    Bus.emit('transform');
  },
  dblclick(p) { if (this.hit(p) === 'move') Transform.commit(); },
  onKey(e) {
    if (e.key === 'Enter') { Transform.commit(); return true; }
    if (e.key === 'Escape') { Transform.cancel(); return true; }
    return false;
  },
  overlay(ctx, zoom) {
    if (!Transform.active) return;
    const pts = Transform.corners();
    ctx.save();
    ctx.lineWidth = 1 / zoom;
    ctx.strokeStyle = '#4c8dff';
    ctx.beginPath();
    pts.forEach((pt, i) => (i ? ctx.lineTo(pt.x, pt.y) : ctx.moveTo(pt.x, pt.y)));
    ctx.closePath();
    ctx.stroke();
    const mids = pts.map((pt, i) => { const q = pts[(i + 1) % 4]; return { x: (pt.x + q.x) / 2, y: (pt.y + q.y) / 2 }; });
    const s = 7 / zoom;
    for (const pt of [...pts, ...mids]) {
      ctx.fillStyle = '#fff';
      ctx.fillRect(pt.x - s / 2, pt.y - s / 2, s, s);
      ctx.strokeRect(pt.x - s / 2, pt.y - s / 2, s, s);
    }
    const t = Transform.active;
    ctx.beginPath();
    ctx.arc(t.cx, t.cy, 4 / zoom, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  },
});

// ---------- Type ----------
const FONT_FAMILIES = ['Inter', 'Nunito Sans', 'Cantarell', 'DejaVu Sans', 'DejaVu Serif', 'DejaVu Sans Mono', 'Liberation Sans', 'Liberation Serif', 'Liberation Mono', 'FreeSans', 'FreeSerif', 'Nimbus Sans', 'Nimbus Roman', 'URW Gothic', 'URW Bookman', 'C059', 'P052', 'Z003', 'Noto Mono', 'sans-serif', 'serif', 'monospace', 'cursive'];

const TextEditor = {
  active: null,

  create(doc, p) {
    const o = Tools.o('type');
    const layer = new Layer({
      type: 'text',
      name: 'Text',
      text: {
        ...TEXT_DEFAULTS, font: o.font, size: o.size, weight: o.weight, italic: o.italic, align: o.align,
        color: rgbToHex(App.fg), ax: Math.round(p.x), ay: Math.round(p.y - o.size * 0.6), autoName: true,
      },
    });
    doc.history.begin('Type Tool', 'type');
    renderText(layer);
    doc.addLayer(layer);
    this.open(doc, layer, true);
  },

  edit(doc, layer) {
    doc.history.begin('Edit Type Layer', 'type');
    doc.select(layer);
    this.open(doc, layer, false);
  },

  open(doc, layer, isNew) {
    layer.editing = true;
    doc.invalidate();
    const ta = document.createElement('textarea');
    ta.className = 'text-editor';
    ta.spellcheck = false;
    ta.value = layer.text.value;
    View.area.append(ta);
    this.active = { doc, layer, isNew, ta };
    ta.addEventListener('input', () => {
      layer.text.value = ta.value;
      this.position();
    });
    ta.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); this.cancel(); }
      else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); this.commit(); }
    });
    this.position();
    setTimeout(() => ta.focus());
    Bus.emit('tool');
  },

  // Keep the textarea over the text at the current zoom.
  position() {
    const a = this.active;
    if (!a) return;
    const t = a.layer.text;
    const z = a.doc.view.zoom;
    const lines = (a.ta.value || ' ').split('\n');
    const m = ctxOf(Scratch.get('measure', 1, 1));
    m.font = fontString(t, t.size * z);
    const width = Math.max(t.size * z * 0.6, ...lines.map((l) => m.measureText(l || ' ').width)) + t.size * z * 0.6;
    const lineH = t.size * t.leading * z;
    const pt = View.toScreen(t.ax, t.ay);
    const left = t.align === 'left' ? pt.x : t.align === 'center' ? pt.x - width / 2 : pt.x - width;
    Object.assign(a.ta.style, {
      left: `${left}px`, top: `${pt.y}px`, width: `${width}px`, height: `${lineH * lines.length + 2}px`,
      font: fontString(t, t.size * z), lineHeight: `${lineH}px`, color: t.color, textAlign: t.align,
      paddingLeft: t.align === 'left' ? '0' : '', paddingRight: t.align === 'right' ? '0' : '',
    });
  },

  // Options bar edits while typing.
  setProp(key, value) {
    const a = this.active;
    if (!a) return false;
    a.layer.text[key] = value;
    this.position();
    a.ta.focus();
    return true;
  },

  commit() {
    const a = this.active;
    if (!a) return;
    this.active = null;
    const { doc, layer, isNew, ta } = a;
    layer.text.value = ta.value;
    layer.editing = false;
    ta.remove();
    if (!layer.text.value.trim()) {
      if (isNew) doc.history.cancel();
      else {
        doc.removeLayer(layer);
        doc.history.commit();
      }
    } else {
      renderText(layer);
      // Type layers are named after their text until renamed by hand.
      if (layer.text.autoName) layer.name = layer.text.value.split('\n')[0].slice(0, 30);
      doc.history.commit();
    }
    Bus.emit('tool');
    App.requestRender();
  },

  cancel() {
    const a = this.active;
    if (!a) return;
    this.active = null;
    a.layer.editing = false;
    a.ta.remove();
    a.doc.history.cancel();
    Bus.emit('tool');
  },
};

Tools.define('type', {
  name: 'Horizontal Type Tool', key: 'T', icon: 'type', cursor: 'text',
  options: { font: 'Inter', weight: 400, italic: false, size: 48, align: 'left' },
  down(p) {
    const doc = App.doc;
    if (TextEditor.active) { TextEditor.commit(); return; }
    const hit = layerAt(doc, p, (l) => l.type === 'text');
    if (hit) TextEditor.edit(doc, hit);
    else TextEditor.create(doc, p);
  },
  deactivate() { TextEditor.commit(); },
});

// ---------- Shapes ----------
function shapeGeometry(kind, s, p) {
  let a = s.start, b = p;
  if (kind === 'line') {
    if (p.shift) {
      const ang = Math.round(Math.atan2(p.y - a.y, p.x - a.x) / (Math.PI / 4)) * (Math.PI / 4);
      const d = Math.hypot(p.x - a.x, p.y - a.y);
      b = { x: a.x + Math.cos(ang) * d, y: a.y + Math.sin(ang) * d };
    }
    return { a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y } };
  }
  let w = p.x - a.x, h = p.y - a.y;
  if (p.shift) { const m = Math.max(Math.abs(w), Math.abs(h)); w = (Math.sign(w) || 1) * m; h = (Math.sign(h) || 1) * m; }
  if (p.alt) return { x: a.x - Math.abs(w), y: a.y - Math.abs(h), w: Math.abs(w) * 2, h: Math.abs(h) * 2 };
  return rectFromPoints(a, { x: a.x + w, y: a.y + h });
}

function drawShape(ctx, kind, g, o) {
  ctx.beginPath();
  if (kind === 'line') {
    ctx.moveTo(g.a.x, g.a.y);
    ctx.lineTo(g.b.x, g.b.y);
    ctx.lineCap = 'round';
    ctx.lineWidth = o.strokeWidth;
    ctx.strokeStyle = rgba(App.fg);
    ctx.stroke();
    return;
  }
  if (kind === 'rect') ctx.roundRect(g.x, g.y, g.w, g.h, Math.min(o.radius, g.w / 2, g.h / 2));
  else ctx.ellipse(g.x + g.w / 2, g.y + g.h / 2, g.w / 2, g.h / 2, 0, 0, Math.PI * 2);
  if (o.fill) { ctx.fillStyle = rgba(App.fg); ctx.fill(); }
  if (o.stroke) { ctx.lineWidth = o.strokeWidth; ctx.strokeStyle = o.strokeColor; ctx.stroke(); }
}

function shapeTool(kind, def) {
  return {
    cursor: 'crosshair',
    optionsKey: 'shape',
    options: { fill: true, stroke: false, strokeColor: '#000000', strokeWidth: 4, radius: 0 },
    ...def,
    down(p, s) { s.geom = null; },
    move(p, s) { s.geom = shapeGeometry(kind, s, p); },
    up(p, s) {
      const g = s.geom;
      const doc = App.doc;
      if (!g) return;
      const o = Tools.o(def.id);
      const pad = (kind === 'line' || o.stroke ? o.strokeWidth : 0) + 2;
      const box = kind === 'line' ? rectFromPoints(g.a, g.b) : g;
      if (kind !== 'line' && (box.w < 1 || box.h < 1)) return;
      if (kind === 'line' && Math.hypot(g.b.x - g.a.x, g.b.y - g.a.y) < 1) return;
      const r = rectRoundOut({ x: box.x - pad, y: box.y - pad, w: box.w + pad * 2, h: box.h + pad * 2 });
      const c = makeCanvas(r.w, r.h);
      const x = ctxOf(c);
      x.translate(-r.x, -r.y);
      drawShape(x, kind, g, o);
      doc.history.begin(def.name, def.icon);
      doc.addLayer(new Layer({ name: doc.nextLayerName(def.layerName), canvas: c, x: r.x, y: r.y }));
      doc.history.commit();
    },
    overlay(ctx, zoom, doc, s) {
      if (!s?.geom) return;
      ctx.save();
      drawShape(ctx, kind, s.geom, Tools.o(def.id));
      ctx.restore();
    },
  };
}

Tools.define('shape-rect', shapeTool('rect', { id: 'shape-rect', name: 'Rectangle Tool', key: 'U', icon: 'shapeRect', layerName: 'Rectangle' }));
Tools.define('shape-ellipse', shapeTool('ellipse', { id: 'shape-ellipse', name: 'Ellipse Tool', key: 'U', icon: 'shapeEllipse', layerName: 'Ellipse' }));
Tools.define('shape-line', shapeTool('line', { id: 'shape-line', name: 'Line Tool', key: 'U', icon: 'shapeLine', layerName: 'Line' }));
