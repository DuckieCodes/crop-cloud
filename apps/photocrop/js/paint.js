// Painting tools. Strokes paint into a buffer that is composited onto the layer,
// so Opacity caps the whole stroke and Flow builds up per dab (like Photoshop).

// Work out where painting goes (layer pixels or its mask) and explain when it can't.
function paintTarget(doc, { allowMask = true } = {}) {
  const layer = doc.active;
  if (!layer) { toast('Select a layer first.'); return null; }
  if (!layer.visible) { toast('The target layer is hidden. Show it to edit it.'); return null; }
  if (layer.locked) { toast('This layer is locked.'); return null; }
  if (doc.target === 'mask' && layer.mask) {
    if (!allowMask) { toast("This tool doesn't work on layer masks."); return null; }
    return { layer, mask: true };
  }
  if (layer.type === 'text') { toast('Rasterize the type layer first (Layer › Rasterize › Type).'); return null; }
  if (layer.type === 'adjustment') { toast('Adjustment layers have no pixels. Add a layer mask to paint on it.'); return null; }
  return { layer, mask: false };
}

// Start a history step for painting and return the canvas to paint on.
function beginPaint(doc, name, iconName, opts) {
  const t = paintTarget(doc, opts);
  if (!t) return null;
  doc.history.begin(name, iconName);
  if (t.layer.type === 'raster') ensureCovers(t.layer, doc.rect);
  t.canvas = t.mask ? t.layer.mask : t.layer.canvas;
  doc.history.touch(t.canvas, null);
  return t;
}

const dabCache = new Map();
function dabSprite(size, hardness, color, pencil) {
  const key = `${Math.round(size * 4)}|${hardness}|${color.r},${color.g},${color.b}|${pencil}`;
  let c = dabCache.get(key);
  if (c) return c;
  if (dabCache.size > 64) dabCache.clear();
  if (pencil) {
    const d = Math.max(1, Math.round(size));
    c = makeCanvas(d, d);
    const img = ctxOf(c).createImageData(d, d);
    const r = d / 2;
    for (let y = 0; y < d; y++) {
      for (let x = 0; x < d; x++) {
        if ((x + 0.5 - r) ** 2 + (y + 0.5 - r) ** 2 <= r * r + 0.25) {
          const i = (y * d + x) * 4;
          img.data[i] = color.r; img.data[i + 1] = color.g; img.data[i + 2] = color.b; img.data[i + 3] = 255;
        }
      }
    }
    ctxOf(c).putImageData(img, 0, 0);
  } else {
    const d = Math.ceil(size) + 2;
    c = makeCanvas(d, d);
    const x = ctxOf(c);
    const r = Math.max(0.5, size / 2);
    const h = clamp(hardness, 0, 0.97);
    const g = x.createRadialGradient(d / 2, d / 2, 0, d / 2, d / 2, r);
    g.addColorStop(0, rgba(color, 1));
    g.addColorStop(h, rgba(color, 1));
    for (let i = 1; i < 6; i++) {
      const t = i / 6;
      g.addColorStop(h + (1 - h) * t, rgba(color, (1 - t) ** 2));
    }
    g.addColorStop(1, rgba(color, 0));
    x.fillStyle = g;
    x.beginPath();
    x.arc(d / 2, d / 2, r, 0, Math.PI * 2);
    x.fill();
  }
  dabCache.set(key, c);
  return c;
}

class Stroke {
  // o: { size, hardness (0–1), flow, opacity (0–1), mode, color, erase, pencil, pressureSize, preview, stamp }
  constructor(doc, target, o) {
    this.doc = doc;
    this.t = target;
    this.o = o;
    this.canvas = target.canvas;
    this.backup = doc.history.backupOf(this.canvas);
    this.buffer = makeCanvas(this.canvas.width, this.canvas.height);
    this.bctx = ctxOf(this.buffer);
    this.dirty = null;
    this.pending = null;
    this.carry = 0;
    this.last = null;
  }

  begin(p) {
    this.last = { x: p.x, y: p.y };
    this.stamp(p.x, p.y, p.pressure ?? 1);
    this.flush();
  }

  moveTo(p) {
    const dx = p.x - this.last.x, dy = p.y - this.last.y;
    const dist = Math.hypot(dx, dy);
    const step = Math.max(0.5, this.o.size * (this.o.pencil ? 0.25 : 0.12));
    let t = step - this.carry;
    while (t <= dist) {
      this.stamp(this.last.x + (dx * t) / dist, this.last.y + (dy * t) / dist, p.pressure ?? 1);
      t += step;
    }
    this.carry = dist - (t - step);
    this.last = { x: p.x, y: p.y };
    this.flush();
  }

  stamp(x, y, pressure) {
    const o = this.o;
    const size = Math.max(1, o.size * (o.pressureSize ? pressure : 1));
    const lx = x - this.t.layer.x;
    const ly = y - this.t.layer.y;
    let d;
    if (o.stamp) {
      d = Math.ceil(size) + 2;
      o.stamp(this.bctx, lx, ly, size, x, y);
    } else {
      const dab = dabSprite(size, o.hardness, o.erase || this.t.mask ? { r: 255, g: 255, b: 255 } : o.color, o.pencil);
      d = dab.width;
      this.bctx.globalAlpha = o.pencil ? 1 : o.flow;
      if (o.pencil) this.bctx.drawImage(dab, Math.floor(lx - d / 2 + 0.5), Math.floor(ly - d / 2 + 0.5));
      else this.bctx.drawImage(dab, lx - d / 2, ly - d / 2);
    }
    const r = { x: lx - d / 2 - 2, y: ly - d / 2 - 2, w: d + 4, h: d + 4 };
    this.pending = rectUnion(this.pending, r);
    this.dirty = rectUnion(this.dirty, r);
  }

  flush() {
    const r0 = this.pending;
    if (!r0) return;
    this.pending = null;
    const r = rectIntersect(rectRoundOut(r0), fullRect(this.canvas));
    if (!r) return;
    this.compose(r);
    this.doc.history.touch(this.canvas, r);
    this.doc.invalidate();
  }

  compose(r) {
    const o = this.o;
    const { layer } = this.t;
    let src = this.buffer;
    if (this.doc.selection) {
      src = Scratch.get('stroke-sel', this.buffer.width, this.buffer.height);
      const s = ctxOf(src);
      s.save();
      s.beginPath();
      s.rect(r.x, r.y, r.w, r.h);
      s.clip();
      s.drawImage(this.buffer, 0, 0);
      s.globalCompositeOperation = 'destination-in';
      s.drawImage(this.doc.selection, -layer.x, -layer.y);
      s.restore();
    }
    const c = ctxOf(this.canvas);
    c.save();
    c.beginPath();
    c.rect(r.x, r.y, r.w, r.h);
    c.clip();
    c.globalCompositeOperation = 'copy';
    c.drawImage(this.backup, 0, 0);
    if (this.t.mask) {
      const col = o.erase ? App.bg : App.fg;
      const gray = luma(col.r, col.g, col.b) / 255;
      c.globalCompositeOperation = 'destination-out';
      c.globalAlpha = o.opacity;
      c.drawImage(src, 0, 0);
      c.globalCompositeOperation = 'source-over';
      c.globalAlpha = o.opacity * gray;
      c.drawImage(src, 0, 0);
    } else if (o.erase) {
      c.globalCompositeOperation = 'destination-out';
      c.globalAlpha = o.opacity;
      c.drawImage(src, 0, 0);
    } else {
      c.globalCompositeOperation = o.preview ? 'source-over' : o.mode;
      c.globalAlpha = o.preview ? 0.45 : o.opacity;
      c.drawImage(src, 0, 0);
    }
    c.restore();
  }

  end() {
    this.flush();
    this.doc.history.commit();
  }
}

function brushStrokeOptions(o, extra = {}) {
  return {
    size: o.size, hardness: (o.hardness ?? 100) / 100, flow: (o.flow ?? 100) / 100, opacity: (o.opacity ?? 100) / 100,
    mode: o.mode || 'source-over', color: App.fg, pressureSize: o.pressure, ...extra,
  };
}

// Brush, pencil and eraser share this behavior.
function strokeTool(def) {
  return {
    brushCursor: true,
    paints: true,
    ...def,
    down(p, s) {
      if (p.alt && def.altSamples) { sampleColor(p, false); s.sampling = true; return; }
      const doc = App.doc;
      const t = beginPaint(doc, def.name, def.icon);
      if (!t) return;
      const o = Tools.o(this.id);
      s.stroke = new Stroke(doc, t, brushStrokeOptions(o, def.strokeExtra?.(o)));
      const from = p.shift && Tools.lastPaintPoint ? { ...Tools.lastPaintPoint, pressure: p.pressure } : p;
      s.stroke.begin(from);
      if (from !== p) s.stroke.moveTo(p);
    },
    move(p, s) {
      if (s.sampling) sampleColor(p, false);
      else s.stroke?.moveTo(p);
    },
    up(p, s) {
      if (!s.stroke) return;
      s.stroke.end();
      Tools.lastPaintPoint = { x: p.x, y: p.y };
    },
  };
}

Tools.define('brush', strokeTool({
  name: 'Brush Tool', key: 'B', icon: 'brush', altSamples: true,
  options: { size: 30, hardness: 0, opacity: 100, flow: 100, mode: 'source-over', pressure: true },
}));

Tools.define('pencil', strokeTool({
  name: 'Pencil Tool', key: 'B', icon: 'pencil', altSamples: true,
  options: { size: 1, opacity: 100, mode: 'source-over' },
  strokeExtra: () => ({ pencil: true, hardness: 1, flow: 1 }),
}));

Tools.define('eraser', strokeTool({
  name: 'Eraser Tool', key: 'E', icon: 'eraser',
  options: { size: 40, hardness: 50, opacity: 100, flow: 100, pressure: true },
  strokeExtra: () => ({ erase: true }),
}));

// ---------- Clone stamp ----------
Tools.define('clone', {
  name: 'Clone Stamp Tool', key: 'S', icon: 'stamp', brushCursor: true, paints: true,
  options: { size: 40, hardness: 50, opacity: 100, flow: 100, aligned: true, sampleAll: false },
  source: null,
  offset: null,
  down(p, s) {
    const doc = App.doc;
    if (p.alt) {
      this.source = { x: p.x, y: p.y, docId: doc.id };
      this.offset = null;
      return;
    }
    if (!this.source || this.source.docId !== doc.id) {
      toast('Alt-click to set a source point first.');
      return;
    }
    const o = Tools.o('clone');
    const t = beginPaint(doc, this.name, 'stamp', { allowMask: false });
    if (!t) return;
    if (!this.offset || !o.aligned) this.offset = { x: this.source.x - p.x, y: this.source.y - p.y };
    const off = this.offset;
    const sample = o.sampleAll ? doc.flattened() : doc.history.backupOf(t.canvas);
    const sx0 = o.sampleAll ? 0 : t.layer.x;
    const sy0 = o.sampleAll ? 0 : t.layer.y;
    const hardness = o.hardness / 100;
    s.stroke = new Stroke(doc, t, brushStrokeOptions(o, {
      stamp(bctx, lx, ly, size, x, y) {
        const dab = dabSprite(size, hardness, { r: 255, g: 255, b: 255 }, false);
        const d = dab.width;
        const tmp = Scratch.get('clone-dab', d, d);
        const tc = ctxOf(tmp);
        tc.drawImage(sample, -(x + off.x - sx0 - d / 2), -(y + off.y - sy0 - d / 2));
        tc.globalCompositeOperation = 'destination-in';
        tc.drawImage(dab, 0, 0);
        bctx.globalAlpha = o.flow / 100;
        bctx.drawImage(tmp, lx - d / 2, ly - d / 2);
      },
    }));
    s.stroke.begin(p);
  },
  move(p, s) { s.stroke?.moveTo(p); },
  up(p, s) { s.stroke?.end(); },
  cursorExtra(ctx, doc) {
    if (!this.source || this.source.docId !== doc.id) return;
    const pt = this.offset && View.pointer.inside
      ? View.toScreen(View.pointer.x + this.offset.x, View.pointer.y + this.offset.y)
      : View.toScreen(this.source.x, this.source.y);
    ctx.save();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    ctx.shadowColor = '#000';
    ctx.shadowBlur = 2;
    ctx.beginPath();
    ctx.moveTo(pt.x - 7, pt.y); ctx.lineTo(pt.x + 7, pt.y);
    ctx.moveTo(pt.x, pt.y - 7); ctx.lineTo(pt.x, pt.y + 7);
    ctx.stroke();
    ctx.restore();
  },
});

// ---------- Spot healing ----------
// Fills the painted area from its surroundings (push-pull interpolation).
function inpaint(img, coverage) {
  const levels = [];
  let w = img.width, h = img.height;
  let L = { w, h, c: new Float32Array(w * h * 4), wt: new Float32Array(w * h) };
  for (let p = 0; p < w * h; p++) {
    if (coverage[p * 4 + 3] < 8) {
      L.wt[p] = 1;
      for (let k = 0; k < 4; k++) L.c[p * 4 + k] = img.data[p * 4 + k];
    }
  }
  levels.push(L);
  while (w > 1 || h > 1) {
    const nw = Math.ceil(w / 2), nh = Math.ceil(h / 2);
    const N = { w: nw, h: nh, c: new Float32Array(nw * nh * 4), wt: new Float32Array(nw * nh) };
    for (let y = 0; y < nh; y++) {
      for (let x = 0; x < nw; x++) {
        let sw = 0;
        const acc = [0, 0, 0, 0];
        for (let j = 0; j < 2; j++) {
          for (let i = 0; i < 2; i++) {
            const cx = 2 * x + i, cy = 2 * y + j;
            if (cx >= w || cy >= h) continue;
            const q = cy * w + cx;
            const wt = L.wt[q];
            if (!wt) continue;
            sw += wt;
            for (let k = 0; k < 4; k++) acc[k] += L.c[q * 4 + k] * wt;
          }
        }
        const p = y * nw + x;
        if (sw > 0) {
          N.wt[p] = Math.min(1, sw);
          for (let k = 0; k < 4; k++) N.c[p * 4 + k] = acc[k] / sw;
        }
      }
    }
    levels.push(N);
    L = N; w = nw; h = nh;
  }
  for (let l = levels.length - 2; l >= 0; l--) {
    const F = levels[l], C = levels[l + 1];
    for (let y = 0; y < F.h; y++) {
      for (let x = 0; x < F.w; x++) {
        const p = y * F.w + x;
        const wt = F.wt[p];
        if (wt >= 1) continue;
        const fx = clamp((x + 0.5) / 2 - 0.5, 0, C.w - 1), fy = clamp((y + 0.5) / 2 - 0.5, 0, C.h - 1);
        const x0 = Math.floor(fx), y0 = Math.floor(fy);
        const x1 = Math.min(x0 + 1, C.w - 1), y1 = Math.min(y0 + 1, C.h - 1);
        const ax = fx - x0, ay = fy - y0;
        for (let k = 0; k < 4; k++) {
          const v = (C.c[(y0 * C.w + x0) * 4 + k] * (1 - ax) + C.c[(y0 * C.w + x1) * 4 + k] * ax) * (1 - ay)
            + (C.c[(y1 * C.w + x0) * 4 + k] * (1 - ax) + C.c[(y1 * C.w + x1) * 4 + k] * ax) * ay;
          F.c[p * 4 + k] = F.c[p * 4 + k] * wt + v * (1 - wt);
        }
        F.wt[p] = 1;
      }
    }
  }
  return levels[0].c;
}

Tools.define('heal', {
  name: 'Spot Healing Brush Tool', key: 'J', icon: 'heal', brushCursor: true, paints: true,
  options: { size: 30, hardness: 60 },
  down(p, s) {
    const doc = App.doc;
    const t = beginPaint(doc, this.name, 'heal', { allowMask: false });
    if (!t) return;
    const o = Tools.o('heal');
    s.stroke = new Stroke(doc, t, { size: o.size, hardness: o.hardness / 100, flow: 1, opacity: 1, color: { r: 20, g: 20, b: 20 }, preview: true });
    s.stroke.begin(p);
  },
  move(p, s) { s.stroke?.moveTo(p); },
  up(p, s) {
    const st = s.stroke;
    if (!st) return;
    st.flush();
    const margin = Tools.o('heal').size;
    const r = rectIntersect(rectRoundOut({ x: st.dirty.x - margin, y: st.dirty.y - margin, w: st.dirty.w + margin * 2, h: st.dirty.h + margin * 2 }), fullRect(st.canvas));
    if (r) {
      const orig = ctxOf(st.backup).getImageData(r.x, r.y, r.w, r.h);
      let cover = ctxOf(st.buffer).getImageData(r.x, r.y, r.w, r.h).data;
      if (st.doc.selection) {
        const sel = ctxOf(st.doc.selection).getImageData(r.x + st.t.layer.x, r.y + st.t.layer.y, r.w, r.h).data;
        cover = cover.map((v, i) => (i % 4 === 3 ? (v * sel[i]) / 255 : v));
      }
      const filled = inpaint(orig, cover);
      const d = orig.data;
      // Match the grain of the surrounding pixels so the patch doesn't look plastic.
      let sum = 0, sum2 = 0, n = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (cover[i + 3] >= 8) continue;
        const l = luma(d[i], d[i + 1], d[i + 2]);
        const right = i + 4 < d.length && cover[i + 7] < 8 ? luma(d[i + 4], d[i + 5], d[i + 6]) : l;
        const diff = l - right;
        sum += diff; sum2 += diff * diff; n++;
      }
      const grain = n ? Math.min(12, Math.sqrt(Math.max(0, sum2 / n - (sum / n) ** 2)) / Math.SQRT2) : 0;
      for (let i = 0; i < d.length; i += 4) {
        const m = cover[i + 3] / 255;
        if (!m) continue;
        for (let k = 0; k < 4; k++) d[i + k] = d[i + k] * (1 - m) + filled[i + k] * m;
        if (grain) {
          const g = gaussRandom() * grain * m;
          d[i] += g; d[i + 1] += g; d[i + 2] += g;
        }
      }
      ctxOf(st.canvas).putImageData(orig, r.x, r.y);
      st.doc.history.touch(st.canvas, r);
    }
    st.doc.history.commit();
  },
});

// ---------- Gradient & paint bucket ----------
function gradientStops(preset, reverse) {
  const fg = App.fg, bg = App.bg;
  let stops = {
    'fg-bg': [[0, rgba(fg)], [1, rgba(bg)]],
    'fg-transparent': [[0, rgba(fg)], [1, rgba(fg, 0)]],
    'black-white': [[0, '#000'], [1, '#fff']],
    spectrum: ['#ff0000', '#ffff00', '#00ff00', '#00ffff', '#0000ff', '#ff00ff', '#ff0000'].map((c, i, a) => [i / (a.length - 1), c]),
  }[preset];
  if (reverse) stops = stops.map(([t, c]) => [1 - t, c]).reverse();
  return stops;
}

Tools.define('gradient', {
  name: 'Gradient Tool', key: 'G', icon: 'gradient', cursor: 'crosshair',
  options: { type: 'linear', preset: 'fg-bg', reverse: false, opacity: 100, mode: 'source-over' },
  down(p, s) {
    s.t = beginPaint(App.doc, this.name, 'gradient');
    s.from = p;
  },
  move(p, s) {
    if (!s.t) return;
    let to = p;
    if (p.shift) {
      const a = Math.round(Math.atan2(p.y - s.from.y, p.x - s.from.x) / (Math.PI / 4)) * (Math.PI / 4);
      const d = Math.hypot(p.x - s.from.x, p.y - s.from.y);
      to = { x: s.from.x + Math.cos(a) * d, y: s.from.y + Math.sin(a) * d };
    }
    s.to = to;
    this.render(s);
  },
  up(p, s) {
    if (!s.t) return;
    const doc = App.doc;
    if (!s.to || Math.hypot(s.to.x - s.from.x, s.to.y - s.from.y) < 1) { doc.history.cancel(); return; }
    doc.history.touch(s.t.canvas);
    doc.history.commit();
  },
  render(s) {
    const doc = App.doc;
    const o = Tools.o('gradient');
    const { canvas, layer, mask } = s.t;
    const w = canvas.width, h = canvas.height;
    const fx = s.from.x - layer.x, fy = s.from.y - layer.y, tx = s.to.x - layer.x, ty = s.to.y - layer.y;
    const tmp = Scratch.get('gradient', w, h);
    const g = ctxOf(tmp);
    let stops = gradientStops(o.preset, o.reverse);
    let grad;
    const dist = Math.hypot(tx - fx, ty - fy);
    if (o.type === 'radial') grad = g.createRadialGradient(fx, fy, 0, fx, fy, dist);
    else if (o.type === 'angle') grad = g.createConicGradient(Math.atan2(ty - fy, tx - fx), fx, fy);
    else if (o.type === 'reflected') {
      grad = g.createLinearGradient(2 * fx - tx, 2 * fy - ty, tx, ty);
      stops = [...stops.map(([t, c]) => [(1 - t) / 2, c]).reverse(), ...stops.map(([t, c]) => [0.5 + t / 2, c])];
    } else grad = g.createLinearGradient(fx, fy, tx, ty);
    stops.forEach(([t, c]) => grad.addColorStop(clamp(t, 0, 1), c));
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    if (mask) {
      // Masks store gray as alpha.
      const img = g.getImageData(0, 0, w, h);
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) { d[i + 3] = (luma(d[i], d[i + 1], d[i + 2]) * d[i + 3]) / 255; d[i] = d[i + 1] = d[i + 2] = 0; }
      g.putImageData(img, 0, 0);
    }
    const coverage = Scratch.get('gradient-cover', w, h);
    const cc = ctxOf(coverage);
    cc.fillRect(0, 0, w, h);
    if (doc.selection) {
      for (const x of [g, cc]) {
        x.globalCompositeOperation = 'destination-in';
        x.drawImage(doc.selection, -layer.x, -layer.y);
        x.globalCompositeOperation = 'source-over';
      }
    }
    const c = ctxOf(canvas);
    c.save();
    c.globalCompositeOperation = 'copy';
    c.drawImage(doc.history.backupOf(canvas), 0, 0);
    c.globalAlpha = o.opacity / 100;
    if (mask) {
      c.globalCompositeOperation = 'destination-out';
      c.drawImage(coverage, 0, 0);
      c.globalCompositeOperation = 'source-over';
    } else {
      c.globalCompositeOperation = o.mode;
    }
    c.drawImage(tmp, 0, 0);
    c.restore();
    doc.invalidate();
  },
  overlay(ctx, zoom, doc, s) {
    if (!s?.to) return;
    ctx.save();
    ctx.lineWidth = 1 / zoom;
    ctx.strokeStyle = '#fff';
    ctx.shadowColor = '#000';
    ctx.shadowBlur = 2;
    ctx.beginPath();
    ctx.moveTo(s.from.x, s.from.y);
    ctx.lineTo(s.to.x, s.to.y);
    ctx.stroke();
    for (const pt of [s.from, s.to]) {
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 3.5 / zoom, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
    }
    ctx.restore();
  },
});

function bytesToCanvas(bytes, w, h) {
  const img = new ImageData(w, h);
  for (let i = 0; i < bytes.length; i++) img.data[i * 4 + 3] = bytes[i];
  const c = makeCanvas(w, h);
  ctxOf(c).putImageData(img, 0, 0);
  return c;
}

Tools.define('bucket', {
  name: 'Paint Bucket Tool', key: 'G', icon: 'bucket', cursor: 'crosshair',
  options: { tolerance: 32, contiguous: true, sampleAll: false, opacity: 100, mode: 'source-over' },
  down(p) {
    const doc = App.doc;
    if (p.alt) { sampleColor(p, false); return; }
    const t = beginPaint(doc, this.name, 'bucket', { allowMask: false });
    if (!t) return;
    const o = Tools.o('bucket');
    const src = o.sampleAll ? doc.flattened() : t.canvas;
    const ox = o.sampleAll ? 0 : t.layer.x, oy = o.sampleAll ? 0 : t.layer.y;
    const bytes = Sel.flood(ctxOf(src).getImageData(0, 0, src.width, src.height), p.x - ox, p.y - oy, o.tolerance, o.contiguous);
    if (!bytes.some((b) => b)) { doc.history.cancel(); return; }
    const region = bytesToCanvas(bytes, src.width, src.height);
    const fill = Scratch.get('bucket', t.canvas.width, t.canvas.height);
    const f = ctxOf(fill);
    f.fillStyle = rgba(App.fg);
    f.fillRect(0, 0, fill.width, fill.height);
    f.globalCompositeOperation = 'destination-in';
    f.drawImage(region, ox - t.layer.x, oy - t.layer.y);
    if (doc.selection) f.drawImage(doc.selection, -t.layer.x, -t.layer.y);
    doc.history.touch(t.canvas);
    const c = ctxOf(t.canvas);
    c.save();
    c.globalAlpha = o.opacity / 100;
    c.globalCompositeOperation = o.mode;
    c.drawImage(fill, 0, 0);
    c.restore();
    doc.history.commit();
  },
});

// ---------- Pixel brushes: blur, sharpen, smudge, dodge, burn, sponge ----------
class PixelBrush {
  constructor(doc, t, o, op) {
    this.doc = doc;
    this.t = t;
    this.o = o;
    this.op = op;
    this.canvas = t.canvas;
    this.w = this.canvas.width;
    this.h = this.canvas.height;
    this.img = ctxOf(this.canvas).getImageData(0, 0, this.w, this.h);
    this.d = this.img.data;
    this.sel = doc.selection ? ctxOf(doc.selection).getImageData(0, 0, doc.width, doc.height).data : null;
    this.pending = null;
    this.last = null;
    this.carry = 0;
  }

  weight(x, y, cx, cy, r) {
    const dist = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
    if (dist > r) return 0;
    const h = this.o.hardness ?? 0.5;
    let w = dist <= r * h ? 1 : (1 - (dist - r * h) / (r - r * h || 1)) ** 2;
    if (this.sel) {
      const sx = x + this.t.layer.x, sy = y + this.t.layer.y;
      if (sx < 0 || sy < 0 || sx >= this.doc.width || sy >= this.doc.height) return 0;
      w *= this.sel[(sy * this.doc.width + sx) * 4 + 3] / 255;
    }
    return w;
  }

  dab(x, y) {
    const r = this.o.size / 2;
    const cx = x - this.t.layer.x, cy = y - this.t.layer.y;
    const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(this.w - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(this.h - 1, Math.ceil(cy + r));
    if (x1 < x0 || y1 < y0) return;
    this.op(this, x0, y0, x1, y1, cx, cy, r);
    this.pending = rectUnion(this.pending, { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 });
  }

  to(p) {
    if (!this.last) { this.last = p; this.dab(p.x, p.y); this.flush(); return; }
    const dx = p.x - this.last.x, dy = p.y - this.last.y;
    const dist = Math.hypot(dx, dy);
    const step = Math.max(1, this.o.size * 0.2);
    let t = step - this.carry;
    while (t <= dist) {
      this.dab(this.last.x + (dx * t) / dist, this.last.y + (dy * t) / dist);
      t += step;
    }
    this.carry = dist - (t - step);
    this.last = p;
    this.flush();
  }

  flush() {
    const r = this.pending;
    if (!r) return;
    this.pending = null;
    ctxOf(this.canvas).putImageData(this.img, 0, 0, r.x, r.y, r.w, r.h);
    this.doc.history.touch(this.canvas, r);
    this.doc.invalidate();
  }
}

// Copy of the rows around a dab, so ops read unmodified neighbors.
function rowsAround(b, y0, y1) {
  const base = Math.max(0, y0 - 1);
  return { base, src: b.d.slice(base * b.w * 4, (Math.min(b.h - 1, y1 + 1) + 1) * b.w * 4) };
}

const PIXEL_OPS = {
  blur(b, x0, y0, x1, y1, cx, cy, r) {
    const { d, w } = b;
    const { src, base } = rowsAround(b, y0, y1);
    const k = b.o.strength / 100;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const wt = b.weight(x, y, cx, cy, r) * k;
        if (!wt) continue;
        const i = (y * w + x) * 4;
        for (let c = 0; c < 4; c++) {
          let sum = 0, n = 0;
          for (let j = -1; j <= 1; j++) {
            const yy = y + j;
            if (yy < 0 || yy >= b.h) continue;
            for (let q = -1; q <= 1; q++) {
              const xx = x + q;
              if (xx < 0 || xx >= w) continue;
              sum += src[((yy - base) * w + xx) * 4 + c];
              n++;
            }
          }
          d[i + c] = lerp(d[i + c], sum / n, wt);
        }
      }
    }
  },
  sharpen(b, x0, y0, x1, y1, cx, cy, r) {
    const { d, w } = b;
    const { src, base } = rowsAround(b, y0, y1);
    const k = (b.o.strength / 100) * 0.6;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const wt = b.weight(x, y, cx, cy, r) * k;
        if (!wt) continue;
        const i = (y * w + x) * 4;
        for (let c = 0; c < 3; c++) {
          let sum = 0, n = 0;
          for (const [qx, qy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
            const xx = x + qx, yy = y + qy;
            if (xx < 0 || yy < 0 || xx >= w || yy >= b.h) continue;
            sum += src[((yy - base) * w + xx) * 4 + c];
            n++;
          }
          const v = src[((y - base) * w + x) * 4 + c];
          d[i + c] = v + (v - sum / n) * wt;
        }
      }
    }
  },
  smudge(b, x0, y0, x1, y1, cx, cy, r) {
    const { d, w } = b;
    const size = Math.ceil(r) * 2 + 1;
    const half = Math.ceil(r);
    if (!b.patch) {
      b.patch = new Float32Array(size * size * 4);
      for (let j = 0; j < size; j++) {
        for (let i = 0; i < size; i++) {
          const x = clamp(Math.round(cx) - half + i, 0, w - 1), y = clamp(Math.round(cy) - half + j, 0, b.h - 1);
          for (let c = 0; c < 4; c++) b.patch[(j * size + i) * 4 + c] = d[(y * w + x) * 4 + c];
        }
      }
      return;
    }
    const k = b.o.strength / 100;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const wt = b.weight(x, y, cx, cy, r) * k;
        if (!wt) continue;
        const pi = ((y - Math.round(cy) + half) * size + (x - Math.round(cx) + half)) * 4;
        if (pi < 0 || pi >= b.patch.length) continue;
        const i = (y * w + x) * 4;
        for (let c = 0; c < 4; c++) {
          const v = lerp(d[i + c], b.patch[pi + c], wt);
          d[i + c] = v;
          b.patch[pi + c] = v;
        }
      }
    }
  },
  tone(b, x0, y0, x1, y1, cx, cy, r) {
    const { d, w } = b;
    const o = b.o;
    const k = (o.exposure / 100) * 0.35;
    const range = { shadows: (l) => (1 - l) ** 2, midtones: (l) => 1 - Math.abs(2 * l - 1), highlights: (l) => l * l }[o.range];
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const wt = b.weight(x, y, cx, cy, r);
        if (!wt) continue;
        const i = (y * w + x) * 4;
        const amt = wt * k * range(luma(d[i], d[i + 1], d[i + 2]) / 255);
        for (let c = 0; c < 3; c++) d[i + c] = o.dodge ? d[i + c] + (255 - d[i + c]) * amt : d[i + c] * (1 - amt);
      }
    }
  },
  sponge(b, x0, y0, x1, y1, cx, cy, r) {
    const { d, w } = b;
    const k = (b.o.flow / 100) * 0.25 * (b.o.saturate ? 1 : -1);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const wt = b.weight(x, y, cx, cy, r);
        if (!wt) continue;
        const i = (y * w + x) * 4;
        const g = luma(d[i], d[i + 1], d[i + 2]);
        for (let c = 0; c < 3; c++) d[i + c] = g + (d[i + c] - g) * (1 + k * wt);
      }
    }
  },
};

function pixelTool(def, op, extra = () => ({})) {
  return {
    brushCursor: true,
    paints: true,
    ...def,
    down(p, s) {
      const doc = App.doc;
      const t = beginPaint(doc, def.name, def.icon, { allowMask: false });
      if (!t) return;
      const o = Tools.o(this.id);
      s.brush = new PixelBrush(doc, t, { ...o, hardness: (o.hardness ?? 50) / 100, ...extra(o) }, PIXEL_OPS[op]);
      s.brush.to(p);
    },
    move(p, s) { s.brush?.to(p); },
    up(p, s) {
      if (!s.brush) return;
      s.brush.flush();
      App.doc.history.commit();
    },
  };
}

Tools.define('blur', pixelTool({ name: 'Blur Tool', key: 'R', icon: 'blurTool', options: { size: 40, hardness: 0, strength: 50 } }, 'blur'));
Tools.define('sharpen', pixelTool({ name: 'Sharpen Tool', key: 'R', icon: 'sharpenTool', options: { size: 40, hardness: 0, strength: 50 } }, 'sharpen'));
Tools.define('smudge', pixelTool({ name: 'Smudge Tool', key: 'R', icon: 'smudge', options: { size: 30, hardness: 30, strength: 50 } }, 'smudge'));
Tools.define('dodge', pixelTool({ name: 'Dodge Tool', key: 'O', icon: 'dodge', options: { size: 60, hardness: 0, range: 'midtones', exposure: 50 } }, 'tone', () => ({ dodge: true })));
Tools.define('burn', pixelTool({ name: 'Burn Tool', key: 'O', icon: 'burn', options: { size: 60, hardness: 0, range: 'midtones', exposure: 50 } }, 'tone', () => ({ dodge: false })));
Tools.define('sponge', pixelTool({ name: 'Sponge Tool', key: 'O', icon: 'sponge', options: { size: 60, hardness: 0, mode: 'desaturate', flow: 50 } }, 'sponge', (o) => ({ saturate: o.mode === 'saturate' })));
