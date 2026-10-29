// Commands (menus + keyboard shortcuts) and the image/layer/clipboard operations behind them.

// ---------- Image operations ----------
function resample(src, w, h, quality) {
  if (quality === 'none') {
    const c = makeCanvas(w, h);
    const x = ctxOf(c);
    x.imageSmoothingEnabled = false;
    x.drawImage(src, 0, 0, w, h);
    return c;
  }
  if (quality === 'high') return scaledCopy(src, w, h);
  const c = makeCanvas(w, h);
  const x = ctxOf(c);
  x.imageSmoothingQuality = 'low';
  x.drawImage(src, 0, 0, w, h);
  return c;
}

const ImageOps = {
  crop(doc, r, deletePixels = true, name = 'Crop') {
    App.finishEditing();
    doc.history.begin(name, 'crop');
    for (const layer of doc.layers) {
      if (layer.type === 'text') {
        layer.text.ax -= r.x;
        layer.text.ay -= r.y;
        renderText(layer);
        continue;
      }
      transformLayer(layer, (canvas, x, y) => {
        if (!deletePixels && layer.type === 'raster') return { canvas, x: x - r.x, y: y - r.y };
        const c = makeCanvas(r.w, r.h);
        ctxOf(c).drawImage(canvas, x - r.x, y - r.y);
        return { canvas: c, x: 0, y: 0 };
      });
    }
    if (doc.selection) {
      const m = makeCanvas(r.w, r.h);
      ctxOf(m).drawImage(doc.selection, -r.x, -r.y);
      doc.selection = Sel.isEmpty(m) ? null : m;
    }
    doc.width = r.w;
    doc.height = r.h;
    doc.composite = makeCanvas(r.w, r.h);
    doc.history.commit();
    View.fit(doc, { allowUp: false });
  },

  resize(doc, w, h, quality, dpi) {
    App.finishEditing();
    const kx = w / doc.width, ky = h / doc.height;
    doc.history.begin('Image Size', 'resize');
    for (const layer of doc.layers) {
      if (layer.type === 'text') {
        const t = layer.text;
        t.ax *= kx;
        t.ay *= ky;
        t.size = Math.max(1, Math.round(t.size * ky * 10) / 10);
        renderText(layer);
        continue;
      }
      transformLayer(layer, (canvas, x, y) => ({
        canvas: resample(canvas, Math.max(1, Math.round(canvas.width * kx)), Math.max(1, Math.round(canvas.height * ky)), quality),
        x: Math.round(x * kx),
        y: Math.round(y * ky),
      }));
    }
    if (doc.selection) doc.selection = resample(doc.selection, w, h, 'high');
    doc.width = w;
    doc.height = h;
    doc.dpi = dpi;
    doc.composite = makeCanvas(w, h);
    doc.history.commit();
    View.fit(doc, { allowUp: false });
  },

  canvasSize(doc, w, h, anchor, fill) {
    App.finishEditing();
    const dx = Math.round(((w - doc.width) * anchor[0]) / 2);
    const dy = Math.round(((h - doc.height) * anchor[1]) / 2);
    const oldW = doc.width, oldH = doc.height;
    doc.history.begin('Canvas Size', 'canvasSize');
    for (const layer of doc.layers) {
      if (layer.type === 'adjustment') {
        if (layer.mask) {
          const m = makeCanvas(w, h);
          const x = ctxOf(m);
          x.fillRect(0, 0, w, h);
          x.clearRect(dx, dy, oldW, oldH);
          x.drawImage(layer.mask, dx, dy);
          layer.mask = m;
        }
        continue;
      }
      translateLayer(layer, dx, dy);
    }
    const bottom = doc.layers[0];
    if (fill && bottom?.type === 'raster') {
      const c = makeCanvas(w, h);
      const x = ctxOf(c);
      x.fillStyle = fill;
      x.fillRect(0, 0, w, h);
      x.clearRect(dx, dy, oldW, oldH);
      x.drawImage(bottom.canvas, bottom.x, bottom.y);
      setLayerCanvas(bottom, c, 0, 0);
    }
    if (doc.selection) {
      const m = makeCanvas(w, h);
      ctxOf(m).drawImage(doc.selection, dx, dy);
      doc.selection = Sel.isEmpty(m) ? null : m;
    }
    doc.width = w;
    doc.height = h;
    doc.composite = makeCanvas(w, h);
    doc.history.commit();
    View.fit(doc, { allowUp: false });
  },

  // Rotate or flip the whole canvas. kind: 'cw', 'ccw', '180', 'flipH', 'flipV'
  orient(doc, kind) {
    App.finishEditing();
    const W = doc.width, H = doc.height;
    const names = { cw: 'Rotate 90° Clockwise', ccw: 'Rotate 90° Counter Clockwise', 180: 'Rotate 180°', flipH: 'Flip Canvas Horizontal', flipV: 'Flip Canvas Vertical' };
    doc.history.begin(names[kind], 'rotate');
    const map = (canvas, x, y) => {
      const w = canvas.width, h = canvas.height;
      const swap = kind === 'cw' || kind === 'ccw';
      const c = makeCanvas(swap ? h : w, swap ? w : h);
      const t = ctxOf(c);
      let nx, ny;
      if (kind === 'cw') { t.translate(h, 0); t.rotate(Math.PI / 2); nx = H - y - h; ny = x; }
      if (kind === 'ccw') { t.translate(0, w); t.rotate(-Math.PI / 2); nx = y; ny = W - x - w; }
      if (kind === '180') { t.translate(w, h); t.rotate(Math.PI); nx = W - x - w; ny = H - y - h; }
      if (kind === 'flipH') { t.translate(w, 0); t.scale(-1, 1); nx = W - x - w; ny = y; }
      if (kind === 'flipV') { t.translate(0, h); t.scale(1, -1); nx = x; ny = H - y - h; }
      t.drawImage(canvas, 0, 0);
      return { canvas: c, x: nx, y: ny };
    };
    let rasterized = false;
    for (const layer of doc.layers) {
      if (layer.type === 'text') { layer.type = 'raster'; layer.text = null; rasterized = true; }
      transformLayer(layer, map);
    }
    if (doc.selection) doc.selection = map(doc.selection, 0, 0).canvas;
    if (kind === 'cw' || kind === 'ccw') { doc.width = H; doc.height = W; doc.composite = makeCanvas(H, W); }
    doc.history.commit();
    if (rasterized) toast('Type layers were rasterized.');
    View.fit(doc, { allowUp: false });
  },

  trim(doc) {
    const b = contentBounds(doc.flattened());
    if (!b) { toast('The image is completely transparent.'); return; }
    if (b.w === doc.width && b.h === doc.height) { toast('There are no transparent edges to trim.'); return; }
    this.crop(doc, b, true, 'Trim');
  },

  cropToSelection(doc) {
    const b = doc.selection && Sel.bounds(doc.selection);
    if (b) this.crop(doc, b, true, 'Crop');
  },

  fill(doc, color, { mode = 'source-over', opacity = 1, preserve = false } = {}) {
    const t = beginPaint(doc, 'Fill', 'bucket');
    if (!t) return;
    const w = t.canvas.width, h = t.canvas.height;
    const tmp = Scratch.get('fill', w, h);
    const x = ctxOf(tmp);
    if (t.mask) {
      const c = new Option().style;
      c.color = color;
      const rgb = c.color.match(/\d+/g).map(Number);
      x.fillStyle = `rgba(0,0,0,${luma(rgb[0], rgb[1], rgb[2]) / 255})`;
    } else x.fillStyle = color;
    x.fillRect(0, 0, w, h);
    const cover = Scratch.get('fill-cover', w, h);
    const cx = ctxOf(cover);
    cx.fillRect(0, 0, w, h);
    if (doc.selection) {
      for (const k of [x, cx]) {
        k.globalCompositeOperation = 'destination-in';
        k.drawImage(doc.selection, -t.layer.x, -t.layer.y);
      }
    }
    doc.history.touch(t.canvas);
    const c = ctxOf(t.canvas);
    c.save();
    c.globalAlpha = opacity;
    if (t.mask) {
      c.globalCompositeOperation = 'destination-out';
      c.drawImage(cover, 0, 0);
      c.globalCompositeOperation = 'source-over';
    } else c.globalCompositeOperation = preserve ? 'source-atop' : mode;
    c.drawImage(tmp, 0, 0);
    c.restore();
    doc.history.commit();
  },

  // Delete key: clear the selected pixels, or delete the layer when nothing is selected.
  clear(doc) {
    if (!doc.selection) { LayerOps.remove(doc); return; }
    const t = beginPaint(doc, 'Clear', 'trash');
    if (!t) return;
    doc.history.touch(t.canvas);
    const c = ctxOf(t.canvas);
    c.save();
    c.globalCompositeOperation = 'destination-out';
    c.drawImage(doc.selection, -t.layer.x, -t.layer.y);
    c.restore();
    doc.history.commit();
  },

  strokeSelection(doc, width, color, location, opacity) {
    const sel = doc.selection;
    let band;
    if (location === 'inside') band = Sel.combine(doc, sel, Sel.grow(sel, -width), 'subtract');
    else if (location === 'outside') band = Sel.combine(doc, Sel.grow(sel, width), sel, 'subtract');
    else band = Sel.combine(doc, Sel.grow(sel, width / 2), Sel.grow(sel, -width / 2), 'subtract');
    if (!band) return;
    const t = beginPaint(doc, 'Stroke', 'brush', { allowMask: false });
    if (!t) return;
    const tmp = Scratch.get('stroke', t.canvas.width, t.canvas.height);
    const x = ctxOf(tmp);
    x.fillStyle = color;
    x.fillRect(0, 0, tmp.width, tmp.height);
    x.globalCompositeOperation = 'destination-in';
    x.drawImage(band, -t.layer.x, -t.layer.y);
    doc.history.touch(t.canvas);
    const c = ctxOf(t.canvas);
    c.globalAlpha = opacity;
    c.drawImage(tmp, 0, 0);
    c.globalAlpha = 1;
    doc.history.commit();
  },

  adjustNow(doc, kind) {
    const def = ADJUSTMENTS[kind];
    const fx = startFx(doc, def.name, 'adjust');
    if (!fx) return;
    fx.set(processCanvas(fx.original, fx.t.mask, (img) => applyAdjustment(kind, img, adjustmentDefaults(kind))));
    fx.commit();
  },

  auto(doc, which) {
    const names = { tone: 'Auto Tone', contrast: 'Auto Contrast', color: 'Auto Color', desaturate: 'Desaturate' };
    const fx = startFx(doc, names[which], 'adjust');
    if (!fx) return;
    fx.set(processCanvas(fx.original, fx.t.mask, AUTO[which]));
    fx.commit();
  },

  autoEnhance(doc) {
    const fx = startFx(doc, 'Auto Enhance', 'sparkles');
    if (!fx) return;
    fx.set(processCanvas(fx.original, fx.t.mask, (img) => {
      AUTO.tone(img);
      applyAdjustment('vibrance', img, { vibrance: 25, saturation: 0 });
    }));
    fx.commit();
  },

  // Flip/rotate just the active layer around its own center.
  orientLayer(doc, kind) {
    if (Transform.active) { Transform.apply({ flipH: 'flipH', flipV: 'flipV', cw: 'rot90', ccw: 'rot-90', 180: 'rot180' }[kind]); return; }
    const layer = doc.active;
    if (!layer || layer.type === 'adjustment') return;
    if (layer.locked) { toast('This layer is locked.'); return; }
    doc.history.step('Transform', 'transform', () => {
      if (layer.type === 'text') { layer.type = 'raster'; layer.text = null; }
      const cx = layer.x + layer.canvas.width / 2, cy = layer.y + layer.canvas.height / 2;
      transformLayer(layer, (canvas) => {
        const w = canvas.width, h = canvas.height;
        const swap = kind === 'cw' || kind === 'ccw';
        const c = makeCanvas(swap ? h : w, swap ? w : h);
        const t = ctxOf(c);
        t.translate(c.width / 2, c.height / 2);
        if (kind === 'flipH') t.scale(-1, 1);
        if (kind === 'flipV') t.scale(1, -1);
        if (kind === 'cw') t.rotate(Math.PI / 2);
        if (kind === 'ccw') t.rotate(-Math.PI / 2);
        if (kind === '180') t.rotate(Math.PI);
        t.drawImage(canvas, -w / 2, -h / 2);
        return { canvas: c, x: Math.round(cx - c.width / 2), y: Math.round(cy - c.height / 2) };
      });
    });
  },
};

// ---------- Layer operations ----------
function cloneLayer(l) {
  const c = new Layer({
    type: l.type, name: l.name, x: l.x, y: l.y,
    canvas: l.canvas && cloneCanvas(l.canvas),
    text: l.text && { ...l.text },
    adjust: l.adjust && structuredClone(l.adjust),
  });
  Object.assign(c, { visible: l.visible, opacity: l.opacity, blend: l.blend, maskEnabled: l.maskEnabled });
  if (l.mask) c.mask = cloneCanvas(l.mask);
  return c;
}

const LayerOps = {
  newLayer(doc) {
    App.finishEditing();
    doc.history.step('New Layer', 'newLayer', () => { doc.addLayer(doc.newRasterLayer()); });
  },

  duplicate(doc) {
    const l = doc.active;
    if (!l) return;
    App.finishEditing();
    doc.history.step('Duplicate Layer', 'layers', () => {
      const c = cloneLayer(l);
      c.name = `${l.name} copy`;
      doc.addLayer(c, l);
    });
  },

  remove(doc) {
    const l = doc.active;
    if (!l) return;
    if (doc.layers.length <= 1) { toast('A document needs at least one layer.'); return; }
    App.finishEditing();
    doc.history.step('Delete Layer', 'trash', () => doc.removeLayer(l));
  },

  viaCopy(doc, cut) {
    const l = doc.active;
    if (!l) return;
    if (!doc.selection) {
      if (cut) toast('Make a selection first.');
      else this.duplicate(doc);
      return;
    }
    if (l.type !== 'raster') { toast('Rasterize this layer first.'); return; }
    doc.history.step(cut ? 'Layer Via Cut' : 'Layer Via Copy', 'layers', () => {
      const c = cloneCanvas(l.canvas);
      const x = ctxOf(c);
      x.globalCompositeOperation = 'destination-in';
      x.drawImage(doc.selection, -l.x, -l.y);
      if (cut) {
        doc.history.touch(l.canvas);
        const lc = ctxOf(l.canvas);
        lc.globalCompositeOperation = 'destination-out';
        lc.drawImage(doc.selection, -l.x, -l.y);
        lc.globalCompositeOperation = 'source-over';
      }
      doc.addLayer(new Layer({ name: doc.nextLayerName(), canvas: c, x: l.x, y: l.y }), l);
    });
  },

  reorder(doc, moving, target, above) {
    doc.history.step('Layer Order', 'layers', () => {
      doc.layers.splice(doc.layers.indexOf(moving), 1);
      const i = doc.layers.indexOf(target);
      doc.layers.splice(above ? i + 1 : i, 0, moving);
      doc.select(moving);
    });
  },

  arrange(doc, how) {
    const l = doc.active;
    if (!l) return;
    const i = doc.layers.indexOf(l);
    const n = doc.layers.length;
    const to = { front: n - 1, forward: Math.min(n - 1, i + 1), backward: Math.max(0, i - 1), back: 0 }[how];
    if (to === i) return;
    doc.history.step('Layer Order', 'layers', () => {
      doc.layers.splice(i, 1);
      doc.layers.splice(to, 0, l);
    });
  },

  mergeDown(doc) {
    const l = doc.active;
    const i = doc.layers.indexOf(l);
    if (i <= 0) return;
    const below = doc.layers[i - 1];
    App.finishEditing();
    doc.history.step('Merge Down', 'layers', () => {
      const merged = new Layer({ name: below.name, canvas: compositeLayers(doc, [below, l].map((x) => (x.visible ? x : { ...x, visible: false }))) });
      doc.layers.splice(i - 1, 2, merged);
      doc.select(merged);
    });
  },

  mergeVisible(doc) {
    const visible = doc.layers.filter((l) => l.visible);
    if (visible.length < 2) return;
    App.finishEditing();
    doc.history.step('Merge Visible', 'layers', () => {
      const merged = new Layer({ name: visible[0].name, canvas: compositeLayers(doc, visible) });
      const at = doc.layers.indexOf(visible[0]);
      doc.layers = doc.layers.filter((l) => !l.visible);
      doc.layers.splice(Math.min(at, doc.layers.length), 0, merged);
      doc.select(merged);
    });
  },

  flatten(doc) {
    App.finishEditing();
    doc.history.step('Flatten Image', 'layers', () => {
      const c = makeCanvas(doc.width, doc.height);
      const x = ctxOf(c);
      x.fillStyle = '#fff';
      x.fillRect(0, 0, c.width, c.height);
      x.drawImage(compositeLayers(doc, doc.layers), 0, 0);
      const bg = new Layer({ name: 'Background', canvas: c });
      doc.layers = [bg];
      doc.select(bg);
    });
  },

  // Alt-click on an eye: show only this layer (or show everything again).
  solo(doc, layer) {
    const others = doc.layers.filter((l) => l !== layer);
    const soloed = layer.visible && others.every((l) => !l.visible);
    doc.history.step('Show/Hide Layers', 'eye', () => {
      layer.visible = true;
      others.forEach((l) => { l.visible = soloed; });
    });
  },

  newAdjustment(doc, kind) {
    if (!doc) return;
    App.finishEditing();
    const def = ADJUSTMENTS[kind];
    doc.history.step(`New ${def.name} Layer`, 'adjust', () => {
      const n = doc.layers.filter((l) => l.adjust?.kind === kind).length + 1;
      const layer = new Layer({ type: 'adjustment', name: `${def.name} ${n}`, adjust: { kind, params: adjustmentDefaults(kind) } });
      const m = Sel.blank(doc);
      if (doc.selection) ctxOf(m).drawImage(doc.selection, 0, 0);
      else ctxOf(m).fillRect(0, 0, m.width, m.height);
      layer.mask = m;
      doc.addLayer(layer);
    });
    if (App.panels.properties !== false) {
      Dock.active.mid = 'properties';
      Dock.render();
    }
  },

  // mode: 'reveal' | 'hide' | 'selection' | 'hideSelection'
  addMask(doc, mode) {
    const l = doc.active;
    if (!l) return;
    if (l.type === 'text') { toast('Rasterize the type layer before adding a mask.'); return; }
    if (l.mask) { doc.select(l, 'mask'); return; }
    mode ||= doc.selection ? 'selection' : 'reveal';
    doc.history.step('Add Layer Mask', 'mask', () => {
      const w = l.canvas ? l.canvas.width : doc.width, h = l.canvas ? l.canvas.height : doc.height;
      const m = makeCanvas(w, h);
      const x = ctxOf(m);
      if (mode === 'reveal' || mode === 'hideSelection') x.fillRect(0, 0, w, h);
      if (mode === 'selection' && doc.selection) x.drawImage(doc.selection, -l.x, -l.y);
      if (mode === 'hideSelection' && doc.selection) {
        x.globalCompositeOperation = 'destination-out';
        x.drawImage(doc.selection, -l.x, -l.y);
      }
      l.mask = m;
      l.maskEnabled = true;
      if (mode.includes('election')) doc.selection = null;
      doc.select(l, 'mask');
    });
  },

  deleteMask(doc) {
    const l = doc.active;
    if (!l?.mask) return;
    doc.history.step('Delete Layer Mask', 'mask', () => { l.mask = null; doc.select(l); });
  },

  applyMask(doc) {
    const l = doc.active;
    if (!l?.mask || l.type !== 'raster') return;
    doc.history.step('Apply Layer Mask', 'mask', () => {
      const c = cloneCanvas(l.canvas);
      const x = ctxOf(c);
      x.globalCompositeOperation = 'destination-in';
      x.drawImage(l.mask, 0, 0);
      l.canvas = c;
      l.mask = null;
      doc.select(l);
    });
  },

  toggleMask(doc) {
    const l = doc.active;
    if (!l?.mask) return;
    doc.history.step(l.maskEnabled ? 'Disable Layer Mask' : 'Enable Layer Mask', 'mask', () => { l.maskEnabled = !l.maskEnabled; });
  },

  rasterize(doc) {
    const l = doc.active;
    if (l?.type !== 'text') return;
    App.finishEditing();
    doc.history.step('Rasterize Type', 'type', () => {
      l.type = 'raster';
      l.text = null;
      l.canvas = cloneCanvas(l.canvas);
    });
  },

  align(doc, how) {
    const l = doc.active;
    if (!doc || !l?.canvas) return;
    const b = contentBounds(l.canvas);
    if (!b) return;
    const box = { x: b.x + l.x, y: b.y + l.y, w: b.w, h: b.h };
    const to = (doc.selection && Sel.bounds(doc.selection)) || doc.rect;
    const dx = { left: to.x - box.x, hcenter: to.x + to.w / 2 - (box.x + box.w / 2), right: to.x + to.w - (box.x + box.w) }[how] || 0;
    const dy = { top: to.y - box.y, vcenter: to.y + to.h / 2 - (box.y + box.h / 2), bottom: to.y + to.h - (box.y + box.h) }[how] || 0;
    if (!Math.round(dx) && !Math.round(dy)) return;
    doc.history.step('Align', 'move', () => translateLayer(l, Math.round(dx), Math.round(dy)));
  },

  removeBackground(doc) {
    const l = doc.active;
    if (!l || l.type !== 'raster') { toast('Select a pixel layer to remove its background.'); return; }
    App.busy(true);
    setTimeout(() => {
      const subject = Sel.subject(doc, l.canvas, l.x, l.y);
      App.busy(false);
      if (!subject) { toast("Couldn't find a clear subject. This works best on plain backgrounds."); return; }
      doc.history.step('Remove Background', 'eraser', () => {
        const m = makeCanvas(l.canvas.width, l.canvas.height);
        ctxOf(m).drawImage(subject, -l.x, -l.y);
        l.mask = m;
        l.maskEnabled = true;
        doc.select(l, 'mask');
      });
      toast('Background hidden with a layer mask. Paint on the mask to fix edges.');
    }, 20);
  },

  selectSubject(doc) {
    const l = doc.active;
    const src = l?.type === 'raster' ? l.canvas : doc.flattened();
    const ox = l?.type === 'raster' ? l.x : 0, oy = l?.type === 'raster' ? l.y : 0;
    App.busy(true);
    setTimeout(() => {
      const m = Sel.subject(doc, src, ox, oy);
      App.busy(false);
      if (!m) { toast("Couldn't find a clear subject. This works best on plain backgrounds."); return; }
      commitSelection(doc, m, 'Select Subject', 'sparkles');
    }, 20);
  },
};

// ---------- Clipboard ----------
const Clipboard = {
  data: null,

  copy(doc, { merged = false, cut = false } = {}) {
    const l = doc.active;
    let src, ox = 0, oy = 0;
    if (merged) src = doc.flattened();
    else {
      if (!l?.canvas) { toast('Select a pixel layer to copy from.'); return false; }
      src = l.canvas; ox = l.x; oy = l.y;
    }
    const c = cloneCanvas(src);
    if (doc.selection) {
      const x = ctxOf(c);
      x.globalCompositeOperation = 'destination-in';
      x.drawImage(doc.selection, -ox, -oy);
    }
    const b = contentBounds(c);
    if (!b) { toast('The selected area is empty.'); return false; }
    this.data = { canvas: crop(c, b), x: b.x + ox, y: b.y + oy };
    canvasToBlob(this.data.canvas).then((blob) => navigator.clipboard?.write?.([new ClipboardItem({ 'image/png': blob })])).catch(() => {});
    if (cut && !merged) {
      if (doc.selection) ImageOps.clear(doc);
      else LayerOps.remove(doc);
    }
    return true;
  },

  paste(doc, { inPlace = false, canvas = null } = {}) {
    const clip = canvas ? { canvas, x: null, y: null } : this.data;
    if (!clip) { toast('Nothing to paste.'); return; }
    if (!doc) {
      App.newDocument({ name: App.nextUntitled(), width: clip.canvas.width, height: clip.canvas.height, background: 'transparent' });
      doc = App.doc;
      inPlace = false;
    }
    App.finishEditing();
    let x = clip.x, y = clip.y;
    const fits = x != null && x >= 0 && y >= 0 && x + clip.canvas.width <= doc.width && y + clip.canvas.height <= doc.height;
    if (!inPlace || !fits || x == null) {
      const target = doc.selection ? Sel.bounds(doc.selection) : doc.rect;
      x = Math.round(target.x + (target.w - clip.canvas.width) / 2);
      y = Math.round(target.y + (target.h - clip.canvas.height) / 2);
      if (inPlace && fits) { x = clip.x; y = clip.y; }
    }
    doc.history.step('Paste', 'paste', () => {
      doc.addLayer(new Layer({ name: doc.nextLayerName(), canvas: cloneCanvas(clip.canvas), x, y }));
      doc.selection = null;
    });
  },

  async pasteFromSystem(inPlace) {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const type = item.types.find((t) => t.startsWith('image/'));
        if (!type) continue;
        const c = await blobToCanvas(await item.getType(type));
        this.pasteCanvas(c, inPlace);
        return;
      }
    } catch { /* No permission or no image: fall back to our own clipboard. */ }
    this.paste(App.doc, { inPlace });
  },

  // A system clipboard image that matches our last copy keeps its position.
  pasteCanvas(c, inPlace) {
    const d = this.data;
    if (d && d.canvas.width === c.width && d.canvas.height === c.height) this.paste(App.doc, { inPlace });
    else this.paste(App.doc, { inPlace, canvas: c });
  },
};

// ---------- Commands ----------
const Commands = {
  map: {},
  keys: new Map(),

  define(id, spec) {
    const c = { id, ...spec };
    this.map[id] = c;
    for (const k of c.keys || (c.shortcut ? [c.shortcut] : [])) this.keys.set(k, c);
  },

  get(id) { return this.map[id]; },
  list() { return Object.values(this.map).filter((c) => !c.hidden); },
  enabled(c) { return !c.enabled || !!c.enabled(); },

  run(id) {
    const c = this.map[id];
    if (c && this.enabled(c)) c.run();
  },

  byKey(combo) { return this.keys.get(combo); },

  item(id) {
    const c = this.map[id];
    return {
      label: typeof c.label === 'function' ? c.label() : c.label,
      shortcut: c.shortcut,
      run: () => this.run(id),
      disabled: !this.enabled(c),
      checked: c.checked?.(),
    };
  },

  contextMenu(x, y) {
    const doc = App.doc;
    const items = doc.selection
      ? ['deselect', 'select-inverse', 'feather', null, 'layer-via-copy', 'layer-via-cut', null, 'free-transform', 'fill', 'stroke', null, 'crop-to-selection']
      : ['select-all', 'reselect', null, 'free-transform', 'duplicate-layer', null, 'paste', null, 'fit-screen', 'actual-pixels'];
    const quick = ['move', 'marquee-rect', 'lasso', 'wand', 'crop', 'eyedropper', 'heal', 'brush', 'clone', 'eraser', 'gradient', 'type', 'shape-rect', 'hand', 'zoom']
      .map((id) => ({ icon: Tools.defs[id].icon, label: `${Tools.defs[id].name} (${Tools.defs[id].key})`, active: Tools.current === id, run: () => Tools.select(id) }));
    Menus.open([{ tools: quick }, { sep: true }, ...items.map((id) => (id ? this.item(id) : { sep: true }))], x, y);
  },
};

const has = {
  doc: () => !!App.doc,
  layer: () => !!App.doc?.active,
  sel: () => !!App.doc?.selection,
  raster: () => App.doc?.active?.type === 'raster',
  mask: () => !!App.doc?.active?.mask,
};

const C = (id, label, shortcut, run, extra = {}) => Commands.define(id, { label, shortcut, run, enabled: has.doc, ...extra });
const D = () => App.doc;

// File
C('new', 'New…', 'Ctrl+N', () => newDocumentDialog(), { enabled: null, keys: ['Ctrl+N', 'Ctrl+Alt+N'] });
C('open', 'Open…', 'Ctrl+O', () => App.pickFiles(), { enabled: null });
C('close', 'Close', 'Ctrl+W', () => App.closeDoc(D()), { keys: ['Ctrl+W', 'Ctrl+F4'] });
C('close-all', 'Close All', 'Ctrl+Alt+W', () => App.closeAll());
C('save', 'Save', 'Ctrl+S', () => App.save(D()));
C('save-as', 'Save As…', 'Ctrl+Shift+S', () => App.save(D(), true));
C('revert', 'Revert', 'F12', () => { App.finishEditing(); D().history.goTo(0); }, { enabled: () => App.doc?.dirty });
C('export-as', 'Export As…', 'Ctrl+Alt+Shift+W', () => exportDialog());
C('quick-export', 'Quick Export as PNG', null, () => App.exportImage('png', 100, 1, true));
C('place', 'Place Embedded…', null, () => App.pickFiles({ place: true }));
C('home', 'Back to Crop Cloud', null, () => { location.href = '../../index.html'; }, { enabled: null });

// Edit
C('undo', () => (App.doc?.history.canUndo ? `Undo ${App.doc.history.current.name}` : 'Undo'), 'Ctrl+Z', () => { App.finishEditing(); D().history.undo(); }, { enabled: () => App.doc?.history.canUndo || TextEditor.active || Transform.active, keys: ['Ctrl+Z', 'Ctrl+Alt+Z'], name: 'Undo' });
C('redo', () => (App.doc?.history.canRedo ? `Redo ${App.doc.history.entries[App.doc.history.index + 1].name}` : 'Redo'), 'Ctrl+Shift+Z', () => D().history.redo(), { enabled: () => App.doc?.history.canRedo, keys: ['Ctrl+Shift+Z', 'Ctrl+Y'], name: 'Redo' });
C('cut', 'Cut', 'Ctrl+X', () => Clipboard.copy(D(), { cut: true }), { enabled: has.layer });
C('copy', 'Copy', 'Ctrl+C', () => Clipboard.copy(D()), { enabled: has.layer });
C('copy-merged', 'Copy Merged', 'Ctrl+Shift+C', () => Clipboard.copy(D(), { merged: true }));
C('paste', 'Paste', 'Ctrl+V', () => Clipboard.pasteFromSystem(false), { enabled: null, keys: [] });
C('paste-in-place', 'Paste in Place', 'Ctrl+Shift+V', () => Clipboard.pasteFromSystem(true), { enabled: null, keys: [] });
C('clear', 'Clear', 'Delete', () => ImageOps.clear(D()), { enabled: has.layer, keys: ['Delete', 'Backspace'] });
C('fill', 'Fill…', 'Shift+F5', () => fillDialog(), { enabled: has.layer });
C('fill-fg', 'Fill with Foreground', 'Alt+Backspace', () => ImageOps.fill(D(), rgba(App.fg)), { enabled: has.layer, hidden: true, keys: ['Alt+Backspace', 'Alt+Delete'] });
C('fill-bg', 'Fill with Background', 'Ctrl+Backspace', () => ImageOps.fill(D(), rgba(App.bg)), { enabled: has.layer, hidden: true, keys: ['Ctrl+Backspace', 'Ctrl+Delete'] });
C('stroke', 'Stroke…', null, () => strokeDialog(), { enabled: has.sel });
C('free-transform', 'Free Transform', 'Ctrl+T', () => Transform.start(), { enabled: () => has.layer() && !Transform.active });
C('flip-layer-h', 'Flip Horizontal', null, () => ImageOps.orientLayer(D(), 'flipH'), { enabled: has.layer });
C('flip-layer-v', 'Flip Vertical', null, () => ImageOps.orientLayer(D(), 'flipV'), { enabled: has.layer });
C('rotate-layer-90', 'Rotate 90° Clockwise', null, () => ImageOps.orientLayer(D(), 'cw'), { enabled: has.layer });
C('rotate-layer-ccw', 'Rotate 90° Counter Clockwise', null, () => ImageOps.orientLayer(D(), 'ccw'), { enabled: has.layer });
C('rotate-layer-180', 'Rotate 180°', null, () => ImageOps.orientLayer(D(), '180'), { enabled: has.layer });
C('theme-dark', 'Dark', null, () => App.setTheme('dark'), { enabled: null, checked: () => App.theme === 'dark' });
C('theme-light', 'Light', null, () => App.setTheme('light'), { enabled: null, checked: () => App.theme === 'light' });

// Image
for (const [kind, def] of Object.entries(ADJUSTMENTS)) {
  C(`adj-${kind}`, def.params.length || def.custom ? `${def.name}…` : def.name, def.shortcut || null, () => adjustmentDialog(kind), { enabled: has.layer });
}
C('desaturate', 'Desaturate', 'Ctrl+Shift+U', () => ImageOps.auto(D(), 'desaturate'), { enabled: has.layer });
C('auto-tone', 'Auto Tone', 'Ctrl+Shift+L', () => ImageOps.auto(D(), 'tone'), { enabled: has.layer });
C('auto-contrast', 'Auto Contrast', 'Ctrl+Alt+Shift+L', () => ImageOps.auto(D(), 'contrast'), { enabled: has.layer });
C('auto-color', 'Auto Color', 'Ctrl+Shift+B', () => ImageOps.auto(D(), 'color'), { enabled: has.layer });
C('auto-enhance', 'Auto Enhance', null, () => ImageOps.autoEnhance(D()), { enabled: has.layer });
C('image-size', 'Image Size…', 'Ctrl+Alt+I', () => imageSizeDialog());
C('canvas-size', 'Canvas Size…', 'Ctrl+Alt+C', () => canvasSizeDialog());
C('rotate-180', '180°', null, () => ImageOps.orient(D(), '180'));
C('rotate-cw', '90° Clockwise', null, () => ImageOps.orient(D(), 'cw'));
C('rotate-ccw', '90° Counter Clockwise', null, () => ImageOps.orient(D(), 'ccw'));
C('flip-canvas-h', 'Flip Canvas Horizontal', null, () => ImageOps.orient(D(), 'flipH'));
C('flip-canvas-v', 'Flip Canvas Vertical', null, () => ImageOps.orient(D(), 'flipV'));
C('crop-to-selection', 'Crop', null, () => ImageOps.cropToSelection(D()), { enabled: has.sel });
C('trim', 'Trim', null, () => ImageOps.trim(D()));
C('remove-background', 'Remove Background', null, () => LayerOps.removeBackground(D()), { enabled: has.raster });

// Layer
C('new-layer', 'Layer…', 'Ctrl+Shift+N', () => LayerOps.newLayer(D()), { keys: ['Ctrl+Shift+N', 'Ctrl+Alt+Shift+N'] });
C('layer-via-copy', 'Layer via Copy', 'Ctrl+J', () => LayerOps.viaCopy(D(), false), { enabled: has.layer });
C('layer-via-cut', 'Layer via Cut', 'Ctrl+Shift+J', () => LayerOps.viaCopy(D(), true), { enabled: () => has.raster() && has.sel() });
C('duplicate-layer', 'Duplicate Layer', null, () => LayerOps.duplicate(D()), { enabled: has.layer });
C('delete-layer', 'Delete Layer', null, () => LayerOps.remove(D()), { enabled: () => App.doc?.layers.length > 1 });
C('rename-layer', 'Rename Layer…', null, () => {
  const row = document.querySelector('.layer-row.active');
  if (row) LayersPanel.rename(row, D(), D().active);
}, { enabled: has.layer });
C('add-mask', 'Add Layer Mask', null, () => LayerOps.addMask(D()), { enabled: () => has.layer() && !has.mask() && App.doc.active.type !== 'text' });
C('mask-reveal-all', 'Reveal All', null, () => LayerOps.addMask(D(), 'reveal'), { enabled: () => has.layer() && !has.mask() });
C('mask-hide-all', 'Hide All', null, () => LayerOps.addMask(D(), 'hide'), { enabled: () => has.layer() && !has.mask() });
C('mask-reveal-sel', 'Reveal Selection', null, () => LayerOps.addMask(D(), 'selection'), { enabled: () => has.sel() && !has.mask() });
C('mask-hide-sel', 'Hide Selection', null, () => LayerOps.addMask(D(), 'hideSelection'), { enabled: () => has.sel() && !has.mask() });
C('delete-mask', 'Delete', null, () => LayerOps.deleteMask(D()), { enabled: has.mask });
C('apply-mask', 'Apply', null, () => LayerOps.applyMask(D()), { enabled: () => has.mask() && has.raster() });
C('toggle-mask', () => (App.doc?.active?.mask && !App.doc.active.maskEnabled ? 'Enable' : 'Disable'), null, () => LayerOps.toggleMask(D()), { enabled: has.mask });
C('rasterize-type', 'Type', null, () => LayerOps.rasterize(D()), { enabled: () => App.doc?.active?.type === 'text' });
C('bring-front', 'Bring to Front', 'Ctrl+Shift+]', () => LayerOps.arrange(D(), 'front'), { enabled: has.layer });
C('bring-forward', 'Bring Forward', 'Ctrl+]', () => LayerOps.arrange(D(), 'forward'), { enabled: has.layer });
C('send-backward', 'Send Backward', 'Ctrl+[', () => LayerOps.arrange(D(), 'backward'), { enabled: has.layer });
C('send-back', 'Send to Back', 'Ctrl+Shift+[', () => LayerOps.arrange(D(), 'back'), { enabled: has.layer });
C('merge-down', 'Merge Down', 'Ctrl+E', () => LayerOps.mergeDown(D()), { enabled: () => App.doc?.active && App.doc.layers.indexOf(App.doc.active) > 0 });
C('merge-visible', 'Merge Visible', 'Ctrl+Shift+E', () => LayerOps.mergeVisible(D()), { enabled: () => App.doc?.layers.filter((l) => l.visible).length > 1 });
C('flatten', 'Flatten Image', null, () => LayerOps.flatten(D()));
C('lock-layer', () => (App.doc?.active?.locked ? 'Unlock Layer' : 'Lock Layer'), 'Ctrl+/', () => {
  const l = D().active;
  D().history.step(l.locked ? 'Unlock Layer' : 'Lock Layer', 'lock', () => { l.locked = !l.locked; });
}, { enabled: has.layer, name: 'Lock Layer' });

// Type
C('type-tool', 'Add Text', null, () => Tools.select('type'));

// Select
C('select-all', 'All', 'Ctrl+A', () => commitSelection(D(), Sel.all(D()), 'Select All'));
C('deselect', 'Deselect', 'Ctrl+D', () => commitSelection(D(), null, 'Deselect'), { enabled: has.sel });
C('reselect', 'Reselect', 'Ctrl+Shift+D', () => commitSelection(D(), D().lastSelection, 'Reselect'), { enabled: () => !!App.doc?.lastSelection && !App.doc.selection });
C('select-inverse', 'Inverse', 'Ctrl+Shift+I', () => commitSelection(D(), Sel.invert(D(), D().selection), 'Select Inverse'), { keys: ['Ctrl+Shift+I', 'Shift+F7'] });
C('select-subject', 'Subject', null, () => LayerOps.selectSubject(D()));
C('load-transparency', 'Load Layer Transparency', null, () => commitSelection(D(), Sel.fromLayer(D(), D().active), 'Load Selection'), { enabled: has.layer });
C('feather', 'Feather…', 'Shift+F6', () => modifySelectionDialog('feather'), { enabled: has.sel });
C('expand', 'Expand…', null, () => modifySelectionDialog('expand'), { enabled: has.sel });
C('contract', 'Contract…', null, () => modifySelectionDialog('contract'), { enabled: has.sel });
C('border', 'Border…', null, () => modifySelectionDialog('border'), { enabled: has.sel });

// Filter
C('last-filter', () => (LastFilter.id ? FILTERS[LastFilter.id].name : 'Last Filter'), 'Ctrl+Alt+F', () => filterDialog(LastFilter.id, { repeat: true }), { enabled: () => !!App.doc?.active && !!LastFilter.id, name: 'Last Filter' });
for (const [id, f] of Object.entries(FILTERS)) {
  C(`filter-${id}`, f.params ? `${f.name}…` : f.name, null, () => filterDialog(id), { enabled: has.layer });
}

// View
C('zoom-in', 'Zoom In', 'Ctrl+=', () => View.zoomStep(1), { keys: ['Ctrl+=', 'Ctrl+Shift+='] });
C('zoom-out', 'Zoom Out', 'Ctrl+-', () => View.zoomStep(-1));
C('fit-screen', 'Fit on Screen', 'Ctrl+0', () => View.fit());
C('fill-screen', 'Fill Screen', null, () => View.fit(App.doc, { fill: true }));
C('actual-pixels', '100%', 'Ctrl+1', () => View.setZoom(App.doc, 1));
C('toggle-rulers', 'Rulers', 'Ctrl+R', () => App.toggleFlag('showRulers'), { enabled: null, checked: () => App.showRulers });
C('toggle-grid', 'Grid', "Ctrl+'", () => App.toggleFlag('showGrid'), { enabled: null, checked: () => App.showGrid });
C('toggle-extras', 'Extras', 'Ctrl+H', () => App.toggleFlag('showExtras'), { enabled: null, checked: () => App.showExtras });
C('toggle-panels', 'Show/Hide Panels', 'Tab', () => App.togglePanelsHidden(), { enabled: null });

// Window
for (const id of Object.keys(PANEL_DEFS)) {
  C(`panel-${id}`, PANEL_DEFS[id].title, id === 'layers' ? 'F7' : id === 'color' ? 'F6' : null, () => App.togglePanel(id), { enabled: null, checked: () => App.panels[id] !== false });
}
C('reset-workspace', 'Reset Essentials', null, () => App.resetWorkspace(), { enabled: null });

// Help
C('shortcuts', 'Keyboard Shortcuts…', 'Ctrl+Alt+Shift+K', () => shortcutsDialog(), { enabled: null });
C('about', 'About PhotoCrop…', null, () => aboutDialog(), { enabled: null });
C('learn', 'Tutorials in Crop Cloud', null, () => { location.href = '../../index.html#learn'; }, { enabled: null });

// Keyboard-only helpers
const toolOpacityKeys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];
toolOpacityKeys.forEach((k, i) => C(`opacity-${k}`, `Opacity ${(i + 1) * 10}%`, k, () => App.quickOpacity((i + 1) * 10), { hidden: true }));
C('default-colors', 'Default Colors', 'D', () => App.defaultColors(), { enabled: null, hidden: true });
C('swap-colors', 'Switch Colors', 'X', () => App.swapColors(), { enabled: null, hidden: true });
C('brush-smaller', 'Decrease Brush Size', '[', () => App.brushSize(-1), { hidden: true });
C('brush-larger', 'Increase Brush Size', ']', () => App.brushSize(1), { hidden: true });
C('brush-softer', 'Decrease Hardness', 'Shift+[', () => App.brushHardness(-25), { hidden: true });
C('brush-harder', 'Increase Hardness', 'Shift+]', () => App.brushHardness(25), { hidden: true });
for (const [key, dx, dy] of [['ArrowLeft', -1, 0], ['ArrowRight', 1, 0], ['ArrowUp', 0, -1], ['ArrowDown', 0, 1]]) {
  C(`nudge-${key}`, 'Nudge', key, () => App.nudge(dx, dy), { hidden: true });
  C(`nudge10-${key}`, 'Nudge', `Shift+${key}`, () => App.nudge(dx * 10, dy * 10), { hidden: true });
}
