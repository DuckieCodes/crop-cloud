// Selections are document-sized alpha canvases (opaque = selected).
// They are never edited in place, so history can share them safely.

const Sel = {
  blank(doc) {
    return makeCanvas(doc.width, doc.height);
  },

  all(doc) {
    const m = this.blank(doc);
    ctxOf(m).fillRect(0, 0, m.width, m.height);
    return m;
  },

  rect(doc, r) {
    const m = this.blank(doc);
    const q = { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.x + r.w) - Math.round(r.x), h: Math.round(r.y + r.h) - Math.round(r.y) };
    ctxOf(m).fillRect(q.x, q.y, q.w, q.h);
    return m;
  },

  ellipse(doc, r) {
    const m = this.blank(doc);
    const x = ctxOf(m);
    x.beginPath();
    x.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2);
    x.fill();
    return m;
  },

  polygon(doc, points) {
    const m = this.blank(doc);
    const x = ctxOf(m);
    x.beginPath();
    points.forEach((p, i) => (i ? x.lineTo(p.x, p.y) : x.moveTo(p.x, p.y)));
    x.closePath();
    x.fill('evenodd');
    return m;
  },

  // Build a mask canvas from per-pixel values (0–255) laid out w × h at (ox, oy).
  fromBytes(doc, bytes, w, h, ox = 0, oy = 0) {
    const img = new ImageData(w, h);
    for (let i = 0; i < bytes.length; i++) img.data[i * 4 + 3] = bytes[i];
    const tmp = makeCanvas(w, h);
    ctxOf(tmp).putImageData(img, 0, 0);
    const m = this.blank(doc);
    ctxOf(m).drawImage(tmp, ox, oy);
    return m;
  },

  // Layer transparency (including its mask) as a selection.
  fromLayer(doc, layer) {
    const m = this.blank(doc);
    const x = ctxOf(m);
    if (layer.canvas) x.drawImage(layer.canvas, layer.x, layer.y);
    if (layer.mask && layer.maskEnabled) {
      x.globalCompositeOperation = 'destination-in';
      x.drawImage(layer.mask, layer.x, layer.y);
    }
    return m;
  },

  // mode: 'new' | 'add' | 'subtract' | 'intersect'
  combine(doc, current, mask, mode) {
    if (mode === 'new' || !current) return mode === 'subtract' || mode === 'intersect' ? null : mask;
    const m = cloneCanvas(current);
    const x = ctxOf(m);
    x.globalCompositeOperation = { add: 'source-over', subtract: 'destination-out', intersect: 'destination-in' }[mode];
    x.drawImage(mask, 0, 0);
    return this.isEmpty(m) ? null : m;
  },

  invert(doc, mask) {
    const m = this.all(doc);
    if (mask) {
      const x = ctxOf(m);
      x.globalCompositeOperation = 'destination-out';
      x.drawImage(mask, 0, 0);
    }
    return this.isEmpty(m) ? null : m;
  },

  isEmpty(mask) {
    return !contentBounds(mask);
  },

  bounds(mask) {
    return contentBounds(mask);
  },

  feather(mask, radius) {
    return blurCanvas(mask, radius / 2);
  },

  // Expand (radius > 0) or contract (radius < 0) by blurring then thresholding.
  grow(mask, radius) {
    const m = blurCanvas(mask, Math.abs(radius) / 2);
    const x = ctxOf(m);
    const img = x.getImageData(0, 0, m.width, m.height);
    const cut = radius > 0 ? 6 : 249;
    const d = img.data;
    for (let i = 3; i < d.length; i += 4) d[i] = d[i] > cut ? 255 : 0;
    x.putImageData(img, 0, 0);
    return m;
  },

  // Flood fill on image data. Returns a Uint8Array (0 or 255 per pixel).
  flood(img, sx, sy, tolerance, contiguous) {
    const { width: w, height: h, data: d } = img;
    const out = new Uint8Array(w * h);
    sx = Math.floor(sx);
    sy = Math.floor(sy);
    if (sx < 0 || sy < 0 || sx >= w || sy >= h) return out;
    const i0 = (sy * w + sx) * 4;
    const r0 = d[i0], g0 = d[i0 + 1], b0 = d[i0 + 2], a0 = d[i0 + 3];
    const match = (p) => {
      const i = p * 4;
      return Math.abs(d[i] - r0) <= tolerance && Math.abs(d[i + 1] - g0) <= tolerance
        && Math.abs(d[i + 2] - b0) <= tolerance && Math.abs(d[i + 3] - a0) <= tolerance;
    };
    if (!contiguous) {
      for (let p = 0; p < w * h; p++) if (match(p)) out[p] = 255;
      return out;
    }
    const stack = [sx, sy];
    while (stack.length) {
      const y = stack.pop();
      let x = stack.pop();
      let p = y * w + x;
      while (x > 0 && !out[p - 1] && match(p - 1)) { x--; p--; }
      let up = false;
      let down = false;
      while (x < w && !out[p] && match(p)) {
        out[p] = 255;
        if (y > 0) {
          const q = p - w;
          if (!out[q] && match(q)) { if (!up) { stack.push(x, y - 1); up = true; } } else up = false;
        }
        if (y < h - 1) {
          const q = p + w;
          if (!out[q] && match(q)) { if (!down) { stack.push(x, y + 1); down = true; } } else down = false;
        }
        x++;
        p++;
      }
    }
    return out;
  },

  // Outline of the selection for "marching ants", cached per mask.
  antsCache: new WeakMap(),
  ants(mask) {
    let path = this.antsCache.get(mask);
    if (path) return path;
    const w = mask.width, h = mask.height;
    const d = ctxOf(mask).getImageData(0, 0, w, h).data;
    const on = new Uint8Array((w + 2) * (h + 2));
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) on[(y + 1) * (w + 2) + x + 1] = d[(y * w + x) * 4 + 3] >= 128 ? 1 : 0;
    }
    const W = w + 2;
    path = new Path2D();
    // Horizontal edges between rows y-1 and y.
    for (let y = 0; y <= h; y++) {
      let start = -1;
      for (let x = 0; x <= w; x++) {
        const edge = x < w && on[y * W + x + 1] !== on[(y + 1) * W + x + 1];
        if (edge && start < 0) start = x;
        else if (!edge && start >= 0) { path.moveTo(start, y); path.lineTo(x, y); start = -1; }
      }
    }
    // Vertical edges between columns x-1 and x.
    for (let x = 0; x <= w; x++) {
      let start = -1;
      for (let y = 0; y <= h; y++) {
        const edge = y < h && on[(y + 1) * W + x] !== on[(y + 1) * W + x + 1];
        if (edge && start < 0) start = y;
        else if (!edge && start >= 0) { path.moveTo(x, start); path.lineTo(x, y); start = -1; }
      }
    }
    this.antsCache.set(mask, path);
    return path;
  },

  // Rough background detection: flood in from the borders across pixels that
  // look like the border colors. Returns a "subject" mask, or null.
  subject(doc, source, ox = 0, oy = 0) {
    const w = source.width, h = source.height;
    const d = ctxOf(source).getImageData(0, 0, w, h).data;
    const border = [];
    const step = Math.max(1, Math.floor((w + h) / 300));
    for (let x = 0; x < w; x += step) border.push(x, (h - 1) * w + x);
    for (let y = 0; y < h; y += step) border.push(y * w, y * w + w - 1);

    // Group border colors into a small palette of background colors.
    const palette = [];
    for (const p of border) {
      const c = [d[p * 4], d[p * 4 + 1], d[p * 4 + 2], d[p * 4 + 3]];
      const hit = palette.find((q) => Math.max(...q.sum.map((v, k) => Math.abs(v / q.n - c[k]))) <= 28);
      if (hit) { hit.n++; c.forEach((v, k) => { hit.sum[k] += v; }); }
      else if (palette.length < 16) palette.push({ n: 1, sum: c });
    }
    const colors = palette.filter((q) => q.n >= border.length * 0.01).map((q) => q.sum.map((v) => v / q.n));
    const looksLikeBg = (p) => colors.some((c) => Math.abs(d[p * 4] - c[0]) <= 60 && Math.abs(d[p * 4 + 1] - c[1]) <= 60
      && Math.abs(d[p * 4 + 2] - c[2]) <= 60 && Math.abs(d[p * 4 + 3] - c[3]) <= 60);
    const near = (p, q) => Math.abs(d[p * 4] - d[q * 4]) <= 18 && Math.abs(d[p * 4 + 1] - d[q * 4 + 1]) <= 18
      && Math.abs(d[p * 4 + 2] - d[q * 4 + 2]) <= 18 && Math.abs(d[p * 4 + 3] - d[q * 4 + 3]) <= 18;

    const bg = new Uint8Array(w * h);
    const queue = new Int32Array(w * h);
    let head = 0, tail = 0;
    for (const p of border) {
      if (!bg[p] && looksLikeBg(p)) { bg[p] = 1; queue[tail++] = p; }
    }
    while (head < tail) {
      const p = queue[head++];
      const x = p % w;
      for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w]) {
        if (q < 0 || q >= w * h || bg[q]) continue;
        if (near(p, q) && looksLikeBg(q)) { bg[q] = 1; queue[tail++] = q; }
      }
    }
    const bytes = new Uint8Array(w * h);
    let count = 0;
    for (let i = 0; i < bytes.length; i++) if (!bg[i]) { bytes[i] = 255; count++; }
    if (count < w * h * 0.005 || count > w * h * 0.995) return null;
    // Soften the edge by a pixel.
    return this.feather(this.fromBytes(doc, bytes, w, h, ox, oy), 1.5);
  },
};
