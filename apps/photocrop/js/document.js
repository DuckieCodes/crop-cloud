// Documents and layers. Layers are bottom → top in doc.layers.
// Raster and text layers own a canvas positioned at (x, y) in document space.
// A layer mask is an alpha canvas with the same size and position as its layer.

const BLEND_MODES = [
  ['source-over', 'Normal'], null,
  ['darken', 'Darken'], ['multiply', 'Multiply'], ['color-burn', 'Color Burn'], null,
  ['lighten', 'Lighten'], ['screen', 'Screen'], ['color-dodge', 'Color Dodge'], ['lighter', 'Linear Dodge (Add)'], null,
  ['overlay', 'Overlay'], ['soft-light', 'Soft Light'], ['hard-light', 'Hard Light'], null,
  ['difference', 'Difference'], ['exclusion', 'Exclusion'], null,
  ['hue', 'Hue'], ['saturation', 'Saturation'], ['color', 'Color'], ['luminosity', 'Luminosity'],
];

const TEXT_DEFAULTS = {
  value: '', font: 'Inter', size: 48, weight: 400, italic: false,
  color: '#000000', align: 'left', leading: 1.2, ax: 0, ay: 0,
};

class Layer {
  constructor({ type = 'raster', name, canvas = null, x = 0, y = 0, text = null, adjust = null }) {
    this.id = uid();
    this.type = type;
    this.name = name;
    this.visible = true;
    this.opacity = 1;
    this.blend = 'source-over';
    this.locked = false;
    this.canvas = canvas;
    this.x = x;
    this.y = y;
    this.mask = null;
    this.maskEnabled = true;
    this.text = text;
    this.adjust = adjust;
  }

  snapshot() {
    return {
      name: this.name, visible: this.visible, opacity: this.opacity, blend: this.blend, locked: this.locked,
      canvas: this.canvas, x: this.x, y: this.y, mask: this.mask, maskEnabled: this.maskEnabled,
      text: this.text && { ...this.text },
      adjust: this.adjust && structuredClone(this.adjust),
    };
  }

  restore(s) {
    Object.assign(this, s, {
      text: s.text && { ...s.text },
      adjust: s.adjust && structuredClone(s.adjust),
    });
  }

  get bounds() {
    return this.canvas ? { x: this.x, y: this.y, w: this.canvas.width, h: this.canvas.height } : null;
  }

  get kindLabel() {
    if (this.type === 'text') return 'Type layer';
    if (this.type === 'adjustment') return `${ADJUSTMENTS[this.adjust.kind].name} adjustment`;
    return 'Pixel layer';
  }
}

// ---------- Layer canvas helpers ----------
// Replace a layer's canvas; the mask follows, revealing any new area.
function setLayerCanvas(layer, canvas, x, y) {
  if (layer.mask) {
    const m = makeCanvas(canvas.width, canvas.height);
    const mx = ctxOf(m);
    mx.fillRect(0, 0, m.width, m.height);
    mx.clearRect(layer.x - x, layer.y - y, layer.mask.width, layer.mask.height);
    mx.drawImage(layer.mask, layer.x - x, layer.y - y);
    layer.mask = m;
  }
  layer.canvas = canvas;
  layer.x = x;
  layer.y = y;
}

// Grow a raster layer so it covers rect (document space). Returns true if it grew.
function ensureCovers(layer, rect) {
  const cur = layer.bounds;
  const r = rectRoundOut(rect);
  if (r.x >= cur.x && r.y >= cur.y && r.x + r.w <= cur.x + cur.w && r.y + r.h <= cur.y + cur.h) return false;
  const u = rectUnion(cur, r);
  const c = makeCanvas(u.w, u.h);
  ctxOf(c).drawImage(layer.canvas, cur.x - u.x, cur.y - u.y);
  setLayerCanvas(layer, c, u.x, u.y);
  return true;
}

// Apply the same geometric change to a layer's pixels and mask.
// fn(canvas, x, y) returns { canvas, x, y }.
function transformLayer(layer, fn) {
  if (layer.canvas && layer.type !== 'text') {
    const r = fn(layer.canvas, layer.x, layer.y);
    if (layer.mask) layer.mask = fn(layer.mask, layer.x, layer.y).canvas;
    layer.canvas = r.canvas;
    layer.x = r.x;
    layer.y = r.y;
  } else if (layer.mask) {
    const r = fn(layer.mask, layer.x, layer.y);
    layer.mask = r.canvas;
    layer.x = r.x;
    layer.y = r.y;
  }
}

function fontString(t, size = t.size) {
  return `${t.italic ? 'italic ' : ''}${t.weight} ${size}px "${t.font}", sans-serif`;
}

// Re-render a text layer from its properties.
function renderText(layer) {
  const t = layer.text;
  const lines = t.value.split('\n');
  const measure = ctxOf(Scratch.get('measure', 1, 1));
  measure.font = fontString(t);
  const width = Math.max(1, ...lines.map((l) => measure.measureText(l).width));
  const lineH = t.size * t.leading;
  const pad = Math.ceil(t.size * 0.3) + 2;
  const c = makeCanvas(Math.ceil(width) + pad * 2, Math.ceil(lineH * lines.length) + pad * 2);
  const x = ctxOf(c);
  x.font = fontString(t);
  x.fillStyle = t.color;
  x.textBaseline = 'middle';
  x.textAlign = t.align;
  const tx = t.align === 'left' ? pad : t.align === 'center' ? c.width / 2 : c.width - pad;
  lines.forEach((line, i) => x.fillText(line, tx, pad + i * lineH + lineH / 2));
  layer.canvas = c;
  layer.x = Math.round(t.align === 'left' ? t.ax - pad : t.align === 'center' ? t.ax - c.width / 2 : t.ax - c.width + pad);
  layer.y = Math.round(t.ay - pad);
}

function translateLayer(layer, dx, dy) {
  if (layer.type === 'text') {
    layer.text.ax += dx;
    layer.text.ay += dy;
    renderText(layer);
  } else {
    layer.x += dx;
    layer.y += dy;
  }
}

// ---------- Document ----------
class Doc {
  constructor({ name = 'Untitled-1', width, height, dpi = 72, historyName = 'New' }) {
    this.id = uid();
    this.name = name;
    this.width = width;
    this.height = height;
    this.dpi = dpi;
    this.layers = [];
    this.activeId = null;
    this.target = 'pixels'; // or 'mask'
    this.selection = null;
    this.lastSelection = null;
    this.composite = makeCanvas(width, height);
    this.compositeDirty = true;
    this.view = { zoom: 1, ox: 0, oy: 0, placed: false };
    this.layerCount = 0;
    this.history = new History(this, historyName);
    this.savedEntry = this.history.current;
    this.fileHandle = null;
    this.recentId = null;
    this.version = 0;
  }

  get active() { return this.layers.find((l) => l.id === this.activeId) || null; }
  get dirty() { return this.history.current !== this.savedEntry; }
  get rect() { return { x: 0, y: 0, w: this.width, h: this.height }; }

  // "Layer 3", "Ellipse 1"… numbered per kind, like Photoshop.
  nextLayerName(prefix = 'Layer') {
    if (prefix === 'Layer') return `Layer ${++this.layerCount}`;
    this.nameCounts ||= {};
    this.nameCounts[prefix] = (this.nameCounts[prefix] || 0) + 1;
    return `${prefix} ${this.nameCounts[prefix]}`;
  }

  newRasterLayer(name) {
    return new Layer({ name: name || this.nextLayerName(), canvas: makeCanvas(this.width, this.height) });
  }

  addLayer(layer, above = this.active) {
    const i = above ? this.layers.indexOf(above) + 1 : this.layers.length;
    this.layers.splice(i, 0, layer);
    this.select(layer);
    this.invalidate();
    return layer;
  }

  removeLayer(layer) {
    const i = this.layers.indexOf(layer);
    if (i < 0) return;
    this.layers.splice(i, 1);
    if (this.activeId === layer.id) this.select(this.layers[Math.max(0, i - 1)] || null);
    this.invalidate();
  }

  select(layer, target = 'pixels') {
    this.activeId = layer ? layer.id : null;
    this.target = layer && target === 'mask' && layer.mask ? 'mask' : 'pixels';
    Bus.emit('layers', this);
  }

  setSelection(mask) {
    if (this.selection) this.lastSelection = this.selection;
    this.selection = mask;
    App.requestRender();
    Bus.emit('selection', this);
  }

  snapshotState() {
    return {
      width: this.width, height: this.height, dpi: this.dpi,
      activeId: this.activeId, target: this.target, selection: this.selection,
      layers: this.layers.map((l) => [l, l.snapshot()]),
    };
  }

  restoreState(s) {
    if (s.width !== this.width || s.height !== this.height) this.composite = makeCanvas(s.width, s.height);
    this.width = s.width;
    this.height = s.height;
    this.dpi = s.dpi;
    this.layers = s.layers.map(([layer, props]) => {
      layer.restore(props);
      return layer;
    });
    this.activeId = s.activeId;
    this.target = s.target;
    this.selection = s.selection;
    this.invalidate();
  }

  invalidate() {
    this.compositeDirty = true;
    this.version++;
    App.requestRender();
  }

  // Structure or history changed: refresh panels too.
  changed() {
    this.invalidate();
    Bus.emit('doc', this);
  }

  renderComposite() {
    const ctx = ctxOf(this.composite);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    drawLayers(ctx, this.layers, this.width, this.height);
    this.compositeDirty = false;
  }

  // A flattened copy of the visible image.
  flattened() {
    if (this.compositeDirty) this.renderComposite();
    return cloneCanvas(this.composite);
  }
}

// Composite layers (bottom → top) into ctx, which covers the document at (0, 0).
function drawLayers(ctx, layers, w, h) {
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  for (const layer of layers) {
    if (!layer.visible || layer.editing) continue;
    if (layer.type === 'adjustment') {
      drawAdjustmentLayer(ctx, layer, w, h);
      continue;
    }
    ctx.globalAlpha = layer.opacity;
    ctx.globalCompositeOperation = layer.blend;
    if (layer.drawOverride) {
      layer.drawOverride(ctx);
      continue;
    }
    if (!layer.canvas) continue;
    let src = layer.canvas;
    if (layer.mask && layer.maskEnabled) {
      const tmp = Scratch.get('composite-mask', src.width, src.height);
      const t = ctxOf(tmp);
      t.drawImage(src, 0, 0);
      t.globalCompositeOperation = 'destination-in';
      t.drawImage(layer.mask, 0, 0);
      src = tmp;
    }
    ctx.drawImage(src, layer.x, layer.y);
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

// Adjustment layers re-color everything below them.
function drawAdjustmentLayer(ctx, layer, w, h) {
  const img = ctx.getImageData(0, 0, w, h);
  applyAdjustment(layer.adjust.kind, img, layer.adjust.params);
  const tmp = Scratch.get('composite-adjust', w, h);
  const t = ctxOf(tmp);
  t.putImageData(img, 0, 0);
  if (layer.mask && layer.maskEnabled) {
    t.globalCompositeOperation = 'destination-in';
    t.drawImage(layer.mask, layer.x, layer.y);
  }
  ctx.globalAlpha = layer.opacity;
  ctx.globalCompositeOperation = layer.blend === 'source-over' ? 'source-atop' : layer.blend;
  ctx.drawImage(tmp, 0, 0);
}

// A new document-sized canvas with the given layers merged.
function compositeLayers(doc, layers) {
  const c = makeCanvas(doc.width, doc.height);
  drawLayers(ctxOf(c), layers, doc.width, doc.height);
  return c;
}
