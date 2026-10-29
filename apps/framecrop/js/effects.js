// Video effects, transitions and color looks, plus keyframeable parameter access.

const EFFECTS = {
  blur: { name: 'Gaussian Blur', group: 'Blur & Sharpen', params: [{ key: 'radius', label: 'Blurriness', min: 0, max: 200, default: 15 }] },
  sharpen: { name: 'Sharpen', group: 'Blur & Sharpen', params: [{ key: 'amount', label: 'Amount', min: 0, max: 300, default: 50 }] },
  bw: { name: 'Black & White', group: 'Color', params: [] },
  chromakey: {
    name: 'Chroma Key', group: 'Keying',
    params: [
      { key: 'color', label: 'Key Color', type: 'color', default: '#00b140' },
      { key: 'similarity', label: 'Similarity', min: 0, max: 100, default: 35 },
      { key: 'smoothness', label: 'Smoothness', min: 0, max: 100, default: 15 },
      { key: 'spill', label: 'Spill Suppression', min: 0, max: 100, default: 60 },
    ],
  },
  vignette: {
    name: 'Vignette', group: 'Stylize',
    params: [
      { key: 'amount', label: 'Amount', min: -100, max: 100, default: 50 },
      { key: 'size', label: 'Midpoint', min: 0, max: 100, default: 55 },
      { key: 'softness', label: 'Feather', min: 1, max: 100, default: 50 },
    ],
  },
  glow: {
    name: 'Glow', group: 'Stylize',
    params: [
      { key: 'threshold', label: 'Threshold', min: 0, max: 100, default: 65 },
      { key: 'radius', label: 'Radius', min: 1, max: 100, default: 25 },
      { key: 'intensity', label: 'Intensity', min: 0, max: 300, default: 100 },
    ],
  },
  grain: {
    name: 'Film Grain', group: 'Stylize',
    params: [{ key: 'amount', label: 'Amount', min: 0, max: 100, default: 20 }, { key: 'size', label: 'Size', min: 1, max: 8, default: 1.5, step: 0.1 }],
  },
  mosaic: { name: 'Mosaic', group: 'Stylize', params: [{ key: 'blocks', label: 'Block Size', min: 2, max: 200, default: 24 }] },
  flipH: { name: 'Horizontal Flip', group: 'Transform', params: [] },
  flipV: { name: 'Vertical Flip', group: 'Transform', params: [] },
};

const TRANSITIONS = {
  'cross-dissolve': { name: 'Cross Dissolve', group: 'Dissolve' },
  'dip-black': { name: 'Dip to Black', group: 'Dissolve' },
  'dip-white': { name: 'Dip to White', group: 'Dissolve' },
  'wipe-left': { name: 'Wipe', group: 'Wipe' },
  'wipe-right': { name: 'Wipe (from right)', group: 'Wipe' },
  push: { name: 'Push', group: 'Slide' },
  slide: { name: 'Slide', group: 'Slide' },
  zoom: { name: 'Cross Zoom', group: 'Zoom' },
};

const AUDIO_TRANSITIONS = {
  'constant-power': { name: 'Constant Power', group: 'Crossfade' },
  'constant-gain': { name: 'Constant Gain', group: 'Crossfade' },
};

// Grade-node presets ("looks"), applied as an extra color node.
const LOOKS = {
  'teal-orange': { name: 'Teal & Orange', node: { lift: [-0.03, 0.005, 0.035, 0], gain: [0.06, 0.015, -0.06, 0], saturation: 1.12, contrast: 1.08 } },
  film: { name: 'Soft Film', node: { lift: [0.02, 0.015, 0.03, 0.025], gain: [0.025, 0.01, -0.02, 0], saturation: 0.9, contrast: 1.12 } },
  bleach: { name: 'Bleach Bypass', node: { saturation: 0.45, contrast: 1.35, gamma: [0, 0, 0, -0.05] } },
  warm: { name: 'Warm Sunset', node: { temperature: 35, tint: 5, saturation: 1.08 } },
  cool: { name: 'Cool Blue', node: { temperature: -35, saturation: 0.95 } },
  bw: { name: 'B&W Contrast', node: { saturation: 0, contrast: 1.3 } },
  faded: { name: 'Faded', node: { lift: [0, 0, 0, 0.07], contrast: 0.85, saturation: 0.8 } },
  night: { name: 'Day for Night', node: { exposure: -1.2, temperature: -60, saturation: 0.6, contrast: 1.1 } },
};

function newEffect(type) {
  const def = EFFECTS[type];
  return { id: uid(), type, enabled: true, params: Object.fromEntries(def.params.map((p) => [p.key, p.default])) };
}

// Parameters a clip can animate. "fx.<effectId>.<key>" addresses effect params.
const Param = {
  get(clip, path) {
    if (path.startsWith('fx.')) {
      const [, id, key] = path.split('.');
      return clip.effects.find((e) => e.id === id)?.params[key];
    }
    return getPath(clip, path);
  },

  set(clip, path, value) {
    if (path.startsWith('fx.')) {
      const [, id, key] = path.split('.');
      const fx = clip.effects.find((e) => e.id === id);
      if (fx) fx.params[key] = value;
      return;
    }
    setPath(clip, path, value);
  },

  // Value at a frame relative to the clip start, following keyframes when there are any.
  at(clip, path, rel) {
    const keys = clip.keys[path];
    if (!keys?.length || typeof keys[0].v !== 'number') return this.get(clip, path);
    if (rel <= keys[0].f) return keys[0].v;
    const last = keys[keys.length - 1];
    if (rel >= last.f) return last.v;
    let i = 0;
    while (keys[i + 1].f < rel) i++;
    const a = keys[i], b = keys[i + 1];
    const t = (rel - a.f) / (b.f - a.f || 1);
    return a.v + (b.v - a.v) * (b.ease ? t * t * (3 - 2 * t) : t);
  },

  animated(clip, path) {
    return !!clip.keys[path]?.length;
  },

  // Change a value: with keyframes on, this sets a key at the playhead.
  edit(clip, path, value) {
    if (this.animated(clip, path)) setKey(clip, path, clamp(Model.seq.playhead - clip.start, 0, clip.duration), value);
    else this.set(clip, path, value);
  },
};

// Is a grade node doing anything? Skipping neutral nodes keeps playback fast.
function nodeIsNeutral(n) {
  const zero = (v) => v.every((x) => Math.abs(x) < 1e-4);
  const curvesFlat = Object.values(n.curves).every((pts) => pts.length === 2 && pts[0][0] === 0 && pts[0][1] === 0 && pts[1][0] === 255 && pts[1][1] === 255);
  return zero(n.lift) && zero(n.gamma) && zero(n.gain) && zero(n.offset) && n.contrast === 1 && n.saturation === 1
    && !n.hue && !n.temperature && !n.tint && !n.exposure && curvesFlat && !n.lutId;
}

// Monotone cubic curve through points (0–255) → 256-entry table.
function curveTable(points) {
  const pts = [...points].sort((a, b) => a[0] - b[0]);
  const n = pts.length;
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const out = new Uint8Array(256);
  if (n < 2) { out.fill(ys[0] ?? 0); return out; }
  const d = [];
  for (let i = 0; i < n - 1; i++) d[i] = (ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i] || 1);
  const m = [d[0]];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  m[n - 1] = d[n - 2];
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
    if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  for (let x = 0; x < 256; x++) {
    let y;
    if (x <= xs[0]) y = ys[0];
    else if (x >= xs[n - 1]) y = ys[n - 1];
    else {
      let i = 0;
      while (x > xs[i + 1]) i++;
      const h = xs[i + 1] - xs[i], t = (x - xs[i]) / h, t2 = t * t, t3 = t2 * t;
      y = (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
    }
    out[x] = clamp(Math.round(y), 0, 255);
  }
  return out;
}

// .cube LUT files (the common format used by Resolve, Premiere and cameras).
function parseCube(text) {
  let size = 0;
  const data = [];
  let domainMin = [0, 0, 0], domainMax = [1, 1, 1];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('LUT_3D_SIZE')) { size = parseInt(line.split(/\s+/)[1], 10); continue; }
    if (line.startsWith('DOMAIN_MIN')) { domainMin = line.split(/\s+/).slice(1).map(Number); continue; }
    if (line.startsWith('DOMAIN_MAX')) { domainMax = line.split(/\s+/).slice(1).map(Number); continue; }
    if (/^[A-Z_]/.test(line)) continue;
    const v = line.split(/\s+/).map(Number);
    if (v.length >= 3 && v.every((x) => !Number.isNaN(x))) data.push(v[0], v[1], v[2]);
  }
  if (!size || data.length !== size * size * size * 3) throw new Error('Not a valid 3D .cube LUT');
  const span = domainMax.map((m, i) => m - domainMin[i] || 1);
  const out = new Float32Array(size * size * size * 4);
  for (let i = 0; i < size ** 3; i++) {
    for (let c = 0; c < 3; c++) out[i * 4 + c] = (data[i * 3 + c] - domainMin[c]) / span[c];
    out[i * 4 + 3] = 1;
  }
  return { size, data: out };
}
