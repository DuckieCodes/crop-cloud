// Image adjustments (also used by adjustment layers) and filters.
// Param types: range, check, select, color. Curves has its own editor.

const PHOTO_FILTERS = {
  'warming-85': ['Warming Filter (85)', '#ec8a00'],
  'warming-lba': ['Warming Filter (LBA)', '#fa9600'],
  'cooling-80': ['Cooling Filter (80)', '#006dff'],
  'cooling-82': ['Cooling Filter (82)', '#00b5ff'],
  red: ['Red', '#ea1a1a'],
  orange: ['Orange', '#f38417'],
  yellow: ['Yellow', '#f9e31c'],
  green: ['Green', '#19c919'],
  cyan: ['Cyan', '#1dcbea'],
  blue: ['Blue', '#1d35ea'],
  violet: ['Violet', '#9b1dea'],
  magenta: ['Magenta', '#e318e3'],
  sepia: ['Sepia', '#ac7a33'],
};

function lutFromFn(fn) {
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) lut[v] = fn(v);
  return lut;
}

function applyLuts(img, r, g = r, b = r) {
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = r[d[i]];
    d[i + 1] = g[d[i + 1]];
    d[i + 2] = b[d[i + 2]];
  }
}

// Monotone cubic interpolation through curve points → 256-entry LUT.
function curveLut(points) {
  const pts = [...points].sort((a, b) => a[0] - b[0]);
  const n = pts.length;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  if (n === 1) return lutFromFn(() => ys[0]);
  const d = [];
  for (let i = 0; i < n - 1; i++) d[i] = (ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i] || 1);
  const m = [d[0]];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  m[n - 1] = d[n - 2];
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * d[i];
      m[i + 1] = t * b * d[i];
    }
  }
  return lutFromFn((x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i];
    const t = (x - xs[i]) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  });
}

const DEFAULT_CURVES = () => ({ channel: 'rgb', points: { rgb: [[0, 0], [255, 255]], r: [[0, 0], [255, 255]], g: [[0, 0], [255, 255]], b: [[0, 0], [255, 255]] } });

const ADJUSTMENTS = {
  brightness: {
    name: 'Brightness/Contrast', icon: 'adjBrightness',
    params: [
      { key: 'brightness', label: 'Brightness', min: -150, max: 150, default: 0 },
      { key: 'contrast', label: 'Contrast', min: -50, max: 100, default: 0 },
    ],
    apply(img, p) {
      const gamma = Math.pow(2, (-p.brightness / 150) * 1.2);
      const k = p.contrast >= 0 ? 1 + (p.contrast / 100) * 2 : 1 + p.contrast / 100;
      applyLuts(img, lutFromFn((v) => ((Math.pow(v / 255, gamma) - 0.5) * k + 0.5) * 255));
    },
  },
  levels: {
    name: 'Levels', icon: 'adjLevels', shortcut: 'Ctrl+L', histogram: true,
    params: [
      { key: 'inBlack', label: 'Input shadows', min: 0, max: 253, default: 0 },
      { key: 'gamma', label: 'Midtones (gamma)', min: 0.1, max: 9.99, step: 0.01, default: 1 },
      { key: 'inWhite', label: 'Input highlights', min: 2, max: 255, default: 255 },
      { key: 'outBlack', label: 'Output shadows', min: 0, max: 255, default: 0 },
      { key: 'outWhite', label: 'Output highlights', min: 0, max: 255, default: 255 },
    ],
    apply(img, p) {
      const range = Math.max(1, p.inWhite - p.inBlack);
      applyLuts(img, lutFromFn((v) => {
        const x = Math.pow(clamp((v - p.inBlack) / range, 0, 1), 1 / p.gamma);
        return p.outBlack + x * (p.outWhite - p.outBlack);
      }));
    },
  },
  curves: {
    name: 'Curves', icon: 'adjCurves', shortcut: 'Ctrl+M', custom: 'curves', params: [],
    defaults: DEFAULT_CURVES,
    apply(img, p) {
      const rgb = curveLut(p.points.rgb);
      const [r, g, b] = ['r', 'g', 'b'].map((c) => {
        const ch = curveLut(p.points[c]);
        return lutFromFn((v) => rgb[ch[v]]);
      });
      applyLuts(img, r, g, b);
    },
  },
  exposure: {
    name: 'Exposure', icon: 'adjExposure',
    params: [
      { key: 'exposure', label: 'Exposure', min: -5, max: 5, step: 0.01, default: 0 },
      { key: 'offset', label: 'Offset', min: -0.5, max: 0.5, step: 0.001, default: 0 },
      { key: 'gamma', label: 'Gamma correction', min: 0.01, max: 9.99, step: 0.01, default: 1 },
    ],
    apply(img, p) {
      const gain = Math.pow(2, p.exposure);
      applyLuts(img, lutFromFn((v) => {
        const lin = Math.pow(v / 255, 2.2) * gain + p.offset;
        return Math.pow(clamp(lin, 0, 1), 1 / (2.2 * p.gamma)) * 255;
      }));
    },
  },
  vibrance: {
    name: 'Vibrance', icon: 'adjVibrance',
    params: [
      { key: 'vibrance', label: 'Vibrance', min: -100, max: 100, default: 0 },
      { key: 'saturation', label: 'Saturation', min: -100, max: 100, default: 0 },
    ],
    apply(img, p) {
      const d = img.data;
      const s = 1 + p.saturation / 100;
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i], g = d[i + 1], b = d[i + 2];
        const max = Math.max(r, g, b);
        const sat = max ? (max - Math.min(r, g, b)) / max : 0;
        const k = (1 + (p.vibrance / 100) * (1 - sat)) * s;
        const y = luma(r, g, b);
        d[i] = y + (r - y) * k;
        d[i + 1] = y + (g - y) * k;
        d[i + 2] = y + (b - y) * k;
      }
    },
  },
  hueSat: {
    name: 'Hue/Saturation', icon: 'adjHue', shortcut: 'Ctrl+U',
    params: [
      { key: 'hue', label: 'Hue', min: -180, max: 180, default: 0 },
      { key: 'saturation', label: 'Saturation', min: -100, max: 100, default: 0 },
      { key: 'lightness', label: 'Lightness', min: -100, max: 100, default: 0 },
      { key: 'colorize', label: 'Colorize', type: 'check', default: false },
    ],
    apply(img, p) {
      const d = img.data;
      const sat = p.saturation / 100;
      const light = p.lightness / 100;
      for (let i = 0; i < d.length; i += 4) {
        let [h, s, l] = rgbToHsl(d[i], d[i + 1], d[i + 2]);
        if (p.colorize) {
          h = (p.hue + 360) % 360;
          s = clamp(0.25 + sat * 0.75, 0, 1);
          l = luma(d[i], d[i + 1], d[i + 2]) / 255;
        } else {
          h = (h + p.hue + 360) % 360;
          s = sat > 0 ? s + (1 - s) * sat * s : s * (1 + sat);
        }
        l = light > 0 ? l + (1 - l) * light : l * (1 + light);
        const [r, g, b] = hslToRgb(h, clamp(s, 0, 1), clamp(l, 0, 1));
        d[i] = r; d[i + 1] = g; d[i + 2] = b;
      }
    },
  },
  colorBalance: {
    name: 'Color Balance', icon: 'adjBalance', shortcut: 'Ctrl+B',
    params: [
      { key: 'tone', label: 'Tone', type: 'select', default: 'midtones', options: [['shadows', 'Shadows'], ['midtones', 'Midtones'], ['highlights', 'Highlights']] },
      { key: 'cr', label: 'Cyan ↔ Red', min: -100, max: 100, default: 0 },
      { key: 'mg', label: 'Magenta ↔ Green', min: -100, max: 100, default: 0 },
      { key: 'yb', label: 'Yellow ↔ Blue', min: -100, max: 100, default: 0 },
      { key: 'preserve', label: 'Preserve luminosity', type: 'check', default: true },
    ],
    apply(img, p) {
      const d = img.data;
      const a = 0.25, b = 0.333, scale = 0.7;
      const weight = {
        shadows: (l) => clamp((l - b) / -a + 0.5, 0, 1) * scale,
        midtones: (l) => clamp((l - b) / a + 0.5, 0, 1) * clamp((l + b - 1) / -a + 0.5, 0, 1) * scale,
        highlights: (l) => clamp((l + b - 1) / a + 0.5, 0, 1) * scale,
      }[p.tone];
      for (let i = 0; i < d.length; i += 4) {
        const r0 = d[i], g0 = d[i + 1], b0 = d[i + 2];
        const l0 = luma(r0, g0, b0);
        const w = weight(l0 / 255) * 1.2;
        let r = r0 + p.cr * w, g = g0 + p.mg * w, bl = b0 + p.yb * w;
        if (p.preserve) {
          const dl = l0 - luma(r, g, bl);
          r += dl; g += dl; bl += dl;
        }
        d[i] = r; d[i + 1] = g; d[i + 2] = bl;
      }
    },
  },
  blackWhite: {
    name: 'Black & White', icon: 'adjBw', shortcut: 'Alt+Shift+Ctrl+B',
    params: [
      { key: 'reds', label: 'Reds', min: -200, max: 300, default: 40, unit: '%' },
      { key: 'yellows', label: 'Yellows', min: -200, max: 300, default: 60, unit: '%' },
      { key: 'greens', label: 'Greens', min: -200, max: 300, default: 40, unit: '%' },
      { key: 'cyans', label: 'Cyans', min: -200, max: 300, default: 60, unit: '%' },
      { key: 'blues', label: 'Blues', min: -200, max: 300, default: 20, unit: '%' },
      { key: 'magentas', label: 'Magentas', min: -200, max: 300, default: 80, unit: '%' },
    ],
    apply(img, p) {
      const d = img.data;
      const [wR, wY, wG, wC, wB, wM] = [p.reds, p.yellows, p.greens, p.cyans, p.blues, p.magentas].map((v) => v / 100);
      for (let i = 0; i < d.length; i += 4) {
        const m = Math.min(d[i], d[i + 1], d[i + 2]);
        const R = d[i] - m, G = d[i + 1] - m, B = d[i + 2] - m;
        let gray = m;
        if (B === 0) { const y = Math.min(R, G); gray += y * wY + (R - y) * wR + (G - y) * wG; }
        else if (R === 0) { const c = Math.min(G, B); gray += c * wC + (G - c) * wG + (B - c) * wB; }
        else { const mg = Math.min(R, B); gray += mg * wM + (R - mg) * wR + (B - mg) * wB; }
        d[i] = d[i + 1] = d[i + 2] = gray;
      }
    },
  },
  photoFilter: {
    name: 'Photo Filter', icon: 'adjPhotoFilter',
    params: [
      { key: 'filter', label: 'Filter', type: 'select', default: 'warming-85', options: Object.entries(PHOTO_FILTERS).map(([k, [label]]) => [k, label]) },
      { key: 'density', label: 'Density', min: 1, max: 100, default: 25, unit: '%' },
      { key: 'preserve', label: 'Preserve luminosity', type: 'check', default: true },
    ],
    apply(img, p) {
      const d = img.data;
      const c = hexToRgb(PHOTO_FILTERS[p.filter][1]);
      const k = p.density / 100;
      for (let i = 0; i < d.length; i += 4) {
        const l0 = luma(d[i], d[i + 1], d[i + 2]);
        let r = lerp(d[i], (d[i] * c.r) / 255 * 1.6, k);
        let g = lerp(d[i + 1], (d[i + 1] * c.g) / 255 * 1.6, k);
        let b = lerp(d[i + 2], (d[i + 2] * c.b) / 255 * 1.6, k);
        if (p.preserve) {
          const dl = l0 - luma(r, g, b);
          r += dl; g += dl; b += dl;
        }
        d[i] = r; d[i + 1] = g; d[i + 2] = b;
      }
    },
  },
  invert: {
    name: 'Invert', icon: 'adjInvert', shortcut: 'Ctrl+I', params: [],
    apply(img) { applyLuts(img, lutFromFn((v) => 255 - v)); },
  },
  posterize: {
    name: 'Posterize', icon: 'adjPosterize',
    params: [{ key: 'levels', label: 'Levels', min: 2, max: 64, default: 4 }],
    apply(img, p) {
      const n = Math.round(p.levels) - 1;
      applyLuts(img, lutFromFn((v) => (Math.round((v / 255) * n) / n) * 255));
    },
  },
  threshold: {
    name: 'Threshold', icon: 'adjThreshold',
    params: [{ key: 'level', label: 'Threshold level', min: 1, max: 255, default: 128 }],
    apply(img, p) {
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        d[i] = d[i + 1] = d[i + 2] = luma(d[i], d[i + 1], d[i + 2]) >= p.level ? 255 : 0;
      }
    },
  },
  gradientMap: {
    name: 'Gradient Map', icon: 'adjGradientMap',
    params: [
      { key: 'from', label: 'Shadows', type: 'color', default: '#000000' },
      { key: 'to', label: 'Highlights', type: 'color', default: '#ffffff' },
      { key: 'reverse', label: 'Reverse', type: 'check', default: false },
    ],
    apply(img, p) {
      let a = hexToRgb(p.from), b = hexToRgb(p.to);
      if (p.reverse) [a, b] = [b, a];
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        const t = luma(d[i], d[i + 1], d[i + 2]) / 255;
        d[i] = lerp(a.r, b.r, t); d[i + 1] = lerp(a.g, b.g, t); d[i + 2] = lerp(a.b, b.b, t);
      }
    },
  },
};

function adjustmentDefaults(kind) {
  const def = ADJUSTMENTS[kind];
  if (def.defaults) return def.defaults();
  return Object.fromEntries(def.params.map((p) => [p.key, p.default]));
}

function applyAdjustment(kind, img, params) {
  ADJUSTMENTS[kind].apply(img, params);
  return img;
}

// ---------- One-shot image commands ----------
function channelHistograms(img) {
  const h = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    h[0][d[i]]++; h[1][d[i + 1]]++; h[2][d[i + 2]]++;
    h[3][Math.round(luma(d[i], d[i + 1], d[i + 2]))]++;
  }
  return h;
}

function clipPoints(hist, clip = 0.001) {
  const total = hist.reduce((a, b) => a + b, 0);
  const cut = total * clip;
  let lo = 0, hi = 255, acc = 0;
  while (lo < 255 && (acc += hist[lo]) <= cut) lo++;
  acc = 0;
  while (hi > 0 && (acc += hist[hi]) <= cut) hi--;
  return hi > lo ? [lo, hi] : [0, 255];
}

const stretch = ([lo, hi]) => lutFromFn((v) => ((v - lo) / (hi - lo)) * 255);

const AUTO = {
  tone(img) {
    const h = channelHistograms(img);
    applyLuts(img, stretch(clipPoints(h[0])), stretch(clipPoints(h[1])), stretch(clipPoints(h[2])));
  },
  contrast(img) {
    applyLuts(img, stretch(clipPoints(channelHistograms(img)[3])));
  },
  color(img) {
    AUTO.tone(img);
    // Pull the average color toward neutral gray with a per-channel gamma.
    const d = img.data;
    const sum = [0, 0, 0];
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (!d[i + 3]) continue;
      sum[0] += d[i]; sum[1] += d[i + 1]; sum[2] += d[i + 2]; n++;
    }
    if (!n) return;
    const means = sum.map((s) => s / n / 255);
    const target = (means[0] + means[1] + means[2]) / 3;
    const luts = means.map((m) => {
      const g = clamp(Math.log(target) / Math.log(clamp(m, 0.01, 0.99)), 0.5, 2);
      return lutFromFn((v) => Math.pow(v / 255, g) * 255);
    });
    applyLuts(img, ...luts);
  },
  desaturate(img) {
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) d[i] = d[i + 1] = d[i + 2] = luma(d[i], d[i + 1], d[i + 2]);
  },
};

// ---------- Filters ----------
// Each filter takes a source canvas and returns a new canvas of the same size.
function pixelOp(src, fn) {
  const c = cloneCanvas(src);
  const x = ctxOf(c);
  const img = x.getImageData(0, 0, c.width, c.height);
  x.putImageData(fn(img) || img, 0, 0);
  return c;
}

function sampleBilinear(d, w, h, x, y, out) {
  x = clamp(x, 0, w - 1);
  y = clamp(y, 0, h - 1);
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, w - 1), y1 = Math.min(y0 + 1, h - 1);
  const fx = x - x0, fy = y - y0;
  const i00 = (y0 * w + x0) * 4, i10 = (y0 * w + x1) * 4, i01 = (y1 * w + x0) * 4, i11 = (y1 * w + x1) * 4;
  for (let c = 0; c < 4; c++) {
    out[c] = (d[i00 + c] * (1 - fx) + d[i10 + c] * fx) * (1 - fy) + (d[i01 + c] * (1 - fx) + d[i11 + c] * fx) * fy;
  }
}

function remap(src, fn) {
  return pixelOp(src, (img) => {
    const { width: w, height: h } = img;
    const s = new Uint8ClampedArray(img.data);
    const d = img.data;
    const px = [0, 0, 0, 0];
    const pt = { x: 0, y: 0 };
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        pt.x = x; pt.y = y;
        fn(pt);
        sampleBilinear(s, w, h, pt.x, pt.y, px);
        const i = (y * w + x) * 4;
        d[i] = px[0]; d[i + 1] = px[1]; d[i + 2] = px[2]; d[i + 3] = px[3];
      }
    }
  });
}

function gaussRandom() {
  return Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());
}

function unsharp(src, amount, radius, threshold) {
  const blurred = ctxOf(blurCanvas(src, radius)).getImageData(0, 0, src.width, src.height).data;
  return pixelOp(src, (img) => {
    const d = img.data;
    const k = amount / 100;
    for (let i = 0; i < d.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        const diff = d[i + c] - blurred[i + c];
        if (Math.abs(diff) * 2 >= threshold) d[i + c] = d[i + c] + diff * k;
      }
    }
  });
}

const FILTERS = {
  gaussianBlur: {
    group: 'Blur', name: 'Gaussian Blur',
    params: [{ key: 'radius', label: 'Radius', min: 0.1, max: 250, step: 0.1, default: 4, unit: 'px' }],
    run: (src, p) => blurCanvas(src, p.radius),
  },
  motionBlur: {
    group: 'Blur', name: 'Motion Blur',
    params: [
      { key: 'angle', label: 'Angle', min: -90, max: 90, default: 0, unit: '°' },
      { key: 'distance', label: 'Distance', min: 1, max: 500, default: 20, unit: 'px' },
    ],
    run(src, p) {
      const out = makeCanvas(src.width, src.height);
      const x = ctxOf(out);
      const n = clamp(Math.round(p.distance), 2, 64);
      const rad = (p.angle * Math.PI) / 180;
      for (let i = 0; i < n; i++) {
        const t = (i / (n - 1) - 0.5) * p.distance;
        x.globalAlpha = 1 / (i + 1);
        x.drawImage(src, Math.cos(rad) * t, -Math.sin(rad) * t);
      }
      return out;
    },
  },
  blur: { group: 'Blur', name: 'Blur', run: (src) => blurCanvas(src, 1) },
  blurMore: { group: 'Blur', name: 'Blur More', run: (src) => blurCanvas(src, 2.5) },

  unsharpMask: {
    group: 'Sharpen', name: 'Unsharp Mask',
    params: [
      { key: 'amount', label: 'Amount', min: 1, max: 500, default: 100, unit: '%' },
      { key: 'radius', label: 'Radius', min: 0.1, max: 250, step: 0.1, default: 1, unit: 'px' },
      { key: 'threshold', label: 'Threshold', min: 0, max: 255, default: 0, unit: 'levels' },
    ],
    run: (src, p) => unsharp(src, p.amount, p.radius, p.threshold),
  },
  sharpen: { group: 'Sharpen', name: 'Sharpen', run: (src) => unsharp(src, 60, 0.7, 0) },
  sharpenMore: { group: 'Sharpen', name: 'Sharpen More', run: (src) => unsharp(src, 140, 1, 0) },

  addNoise: {
    group: 'Noise', name: 'Add Noise',
    params: [
      { key: 'amount', label: 'Amount', min: 0.1, max: 400, step: 0.1, default: 12.5, unit: '%' },
      { key: 'distribution', label: 'Distribution', type: 'select', default: 'uniform', options: [['uniform', 'Uniform'], ['gaussian', 'Gaussian']] },
      { key: 'mono', label: 'Monochromatic', type: 'check', default: false },
    ],
    run: (src, p) => pixelOp(src, (img) => {
      const d = img.data;
      const amp = (p.amount / 100) * 255 * 0.5;
      const rnd = p.distribution === 'gaussian' ? () => gaussRandom() * 0.5 : () => Math.random() * 2 - 1;
      for (let i = 0; i < d.length; i += 4) {
        if (p.mono) {
          const n = rnd() * amp;
          d[i] += n; d[i + 1] += n; d[i + 2] += n;
        } else {
          d[i] += rnd() * amp; d[i + 1] += rnd() * amp; d[i + 2] += rnd() * amp;
        }
      }
    }),
  },

  mosaic: {
    group: 'Pixelate', name: 'Mosaic',
    params: [{ key: 'cell', label: 'Cell size', min: 2, max: 200, default: 10, unit: 'square' }],
    run(src, p) {
      const cell = Math.round(p.cell);
      const small = makeCanvas(Math.ceil(src.width / cell), Math.ceil(src.height / cell));
      const s = ctxOf(small);
      s.imageSmoothingQuality = 'high';
      s.drawImage(src, 0, 0, small.width * cell, small.height * cell, 0, 0, small.width, small.height);
      const out = makeCanvas(src.width, src.height);
      const x = ctxOf(out);
      x.imageSmoothingEnabled = false;
      x.drawImage(small, 0, 0, small.width * cell, small.height * cell);
      return out;
    },
  },

  emboss: {
    group: 'Stylize', name: 'Emboss',
    params: [
      { key: 'angle', label: 'Angle', min: -180, max: 180, default: 135, unit: '°' },
      { key: 'height', label: 'Height', min: 1, max: 10, default: 3, unit: 'px' },
      { key: 'amount', label: 'Amount', min: 1, max: 500, default: 100, unit: '%' },
    ],
    run: (src, p) => pixelOp(src, (img) => {
      const { width: w, height: h } = img;
      const s = img.data.slice();
      const d = img.data;
      const rad = (p.angle * Math.PI) / 180;
      const dx = Math.round(Math.cos(rad) * p.height), dy = Math.round(-Math.sin(rad) * p.height);
      const k = p.amount / 100;
      const L = (x, y) => {
        const i = (clamp(y, 0, h - 1) * w + clamp(x, 0, w - 1)) * 4;
        return luma(s[i], s[i + 1], s[i + 2]);
      };
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          d[i] = d[i + 1] = d[i + 2] = 128 + (L(x + dx, y + dy) - L(x - dx, y - dy)) * k;
        }
      }
    }),
  },
  findEdges: {
    group: 'Stylize', name: 'Find Edges',
    run: (src) => pixelOp(src, (img) => {
      const { width: w, height: h } = img;
      const s = img.data.slice();
      const d = img.data;
      const at = (x, y, c) => s[(clamp(y, 0, h - 1) * w + clamp(x, 0, w - 1)) * 4 + c];
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          for (let c = 0; c < 3; c++) {
            const gx = at(x + 1, y - 1, c) + 2 * at(x + 1, y, c) + at(x + 1, y + 1, c) - at(x - 1, y - 1, c) - 2 * at(x - 1, y, c) - at(x - 1, y + 1, c);
            const gy = at(x - 1, y + 1, c) + 2 * at(x, y + 1, c) + at(x + 1, y + 1, c) - at(x - 1, y - 1, c) - 2 * at(x, y - 1, c) - at(x + 1, y - 1, c);
            d[i + c] = 255 - Math.hypot(gx, gy) / 2;
          }
        }
      }
    }),
  },
  solarize: {
    group: 'Stylize', name: 'Solarize',
    run: (src) => pixelOp(src, (img) => applyLuts(img, lutFromFn((v) => (v > 127 ? 255 - v : v)))),
  },

  twirl: {
    group: 'Distort', name: 'Twirl',
    params: [{ key: 'angle', label: 'Angle', min: -999, max: 999, default: 50, unit: '°' }],
    run(src, p) {
      const cx = src.width / 2, cy = src.height / 2, R = Math.min(cx, cy);
      const a = (p.angle * Math.PI) / 180;
      return remap(src, (pt) => {
        const dx = pt.x - cx, dy = pt.y - cy;
        const r = Math.hypot(dx, dy);
        if (r >= R) return;
        const t = a * (1 - r / R) ** 2;
        const cos = Math.cos(-t), sin = Math.sin(-t);
        pt.x = cx + dx * cos - dy * sin;
        pt.y = cy + dx * sin + dy * cos;
      });
    },
  },
  ripple: {
    group: 'Distort', name: 'Ripple',
    params: [
      { key: 'amount', label: 'Amount', min: -999, max: 999, default: 100, unit: '%' },
      { key: 'size', label: 'Size', type: 'select', default: 'medium', options: [['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']] },
    ],
    run(src, p) {
      const wl = { small: 6, medium: 14, large: 30 }[p.size];
      const amp = (p.amount / 100) * 4;
      return remap(src, (pt) => {
        const x = pt.x;
        pt.x += amp * Math.sin(pt.y / wl);
        pt.y += amp * Math.sin(x / wl);
      });
    },
  },
  spherize: {
    group: 'Distort', name: 'Spherize',
    params: [{ key: 'amount', label: 'Amount', min: -100, max: 100, default: 100, unit: '%' }],
    run(src, p) {
      const cx = src.width / 2, cy = src.height / 2, R = Math.min(cx, cy);
      const k = p.amount / 100;
      return remap(src, (pt) => {
        const dx = (pt.x - cx) / R, dy = (pt.y - cy) / R;
        const r = Math.hypot(dx, dy);
        if (r >= 1 || r === 0) return;
        const nr = k >= 0 ? lerp(r, Math.asin(r) / (Math.PI / 2), k) : lerp(r, Math.sin((r * Math.PI) / 2), -k);
        pt.x = cx + (dx / r) * nr * R;
        pt.y = cy + (dy / r) * nr * R;
      });
    },
  },

  clouds: {
    group: 'Render', name: 'Clouds', usesColors: true,
    run(src, p, colors) {
      const out = makeCanvas(src.width, src.height);
      const x = ctxOf(out);
      const img = x.createImageData(out.width, out.height);
      const { width: w, height: h, data: d } = img;
      const G = 257;
      const grid = new Float32Array(G * G).map(() => Math.random());
      const noise = (fx, fy) => {
        const x0 = Math.floor(fx), y0 = Math.floor(fy);
        const tx = fx - x0, ty = fy - y0;
        const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
        const g = (i, j) => grid[((j & 255) * G) + (i & 255)];
        return lerp(lerp(g(x0, y0), g(x0 + 1, y0), sx), lerp(g(x0, y0 + 1), g(x0 + 1, y0 + 1), sx), sy);
      };
      const base = Math.max(w, h) / 4;
      for (let y = 0; y < h; y++) {
        for (let xx = 0; xx < w; xx++) {
          let v = 0, amp = 0.5, f = 1 / base;
          for (let o = 0; o < 7; o++) { v += noise(xx * f, y * f) * amp; amp /= 2; f *= 2; }
          const t = clamp((v - 0.5) * 1.6 + 0.5, 0, 1);
          const i = (y * w + xx) * 4;
          d[i] = lerp(colors.fg.r, colors.bg.r, t);
          d[i + 1] = lerp(colors.fg.g, colors.bg.g, t);
          d[i + 2] = lerp(colors.fg.b, colors.bg.b, t);
          d[i + 3] = 255;
        }
      }
      x.putImageData(img, 0, 0);
      return out;
    },
  },
  vignette: {
    group: 'Render', name: 'Vignette',
    params: [
      { key: 'amount', label: 'Amount', min: -100, max: 100, default: -50 },
      { key: 'midpoint', label: 'Midpoint', min: 0, max: 100, default: 50 },
    ],
    run: (src, p) => pixelOp(src, (img) => {
      const { width: w, height: h, data: d } = img;
      const cx = w / 2, cy = h / 2;
      const start = (p.midpoint / 100) * 0.9;
      const amt = p.amount / 100;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const dist = Math.hypot((x - cx) / cx, (y - cy) / cy) / Math.SQRT2;
          let t = clamp((dist - start) / (1 - start), 0, 1);
          t = t * t * (3 - 2 * t);
          const i = (y * w + x) * 4;
          for (let c = 0; c < 3; c++) d[i + c] = amt < 0 ? d[i + c] * (1 + amt * t) : d[i + c] + (255 - d[i + c]) * amt * t;
        }
      }
    }),
  },

  highPass: {
    group: 'Other', name: 'High Pass',
    params: [{ key: 'radius', label: 'Radius', min: 0.1, max: 250, step: 0.1, default: 10, unit: 'px' }],
    run(src, p) {
      const blurred = ctxOf(blurCanvas(src, p.radius)).getImageData(0, 0, src.width, src.height).data;
      return pixelOp(src, (img) => {
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        for (let c = 0; c < 3; c++) d[i + c] = d[i + c] - blurred[i + c] + 128;
      }
      });
    },
  },
};

const FILTER_GROUPS = ['Blur', 'Sharpen', 'Noise', 'Pixelate', 'Stylize', 'Distort', 'Render', 'Other'];

function filterDefaults(id) {
  return Object.fromEntries((FILTERS[id].params || []).map((p) => [p.key, p.default]));
}
