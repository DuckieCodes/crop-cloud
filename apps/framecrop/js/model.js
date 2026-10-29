// Project model: media, one sequence with tracks and clips, timecode helpers,
// editing operations and undo. Timeline positions are whole frames; source
// in-points (clip.offset) are seconds.

const FPS_PRESETS = [23.976, 24, 25, 29.97, 30, 50, 59.94, 60];
const BLENDS = [['normal', 'Normal'], ['multiply', 'Multiply'], ['screen', 'Screen'], ['overlay', 'Overlay'], ['add', 'Add (Linear Dodge)'], ['darken', 'Darken'], ['lighten', 'Lighten'], ['difference', 'Difference']];

// ---------- Timecode ----------
function tc(frame, fps = Model.fps) {
  const base = Math.round(fps);
  const f = Math.max(0, Math.round(frame));
  const s = Math.floor(f / base);
  return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60, f % base].map((n) => String(n).padStart(2, '0')).join(':');
}

// Accepts "00:00:05:10", "5:10" or Premiere-style digits ("510" = 5 seconds 10 frames).
function parseTC(text, fps = Model.fps) {
  const base = Math.round(fps);
  const s = String(text).trim();
  if (!s) return null;
  let parts;
  if (/^\d+$/.test(s)) {
    const d = s.padStart(8, '0');
    parts = [d.slice(-8, -6), d.slice(-6, -4), d.slice(-4, -2), d.slice(-2)].map(Number);
  } else {
    parts = s.split(/[:;.]/).map(Number);
    if (parts.some(Number.isNaN)) return null;
    while (parts.length < 4) parts.unshift(0);
  }
  const [h, m, sec, f] = parts.slice(-4);
  return ((h * 60 + m) * 60 + sec) * base + f;
}

// ---------- Defaults ----------
const DEFAULT_TITLE = {
  text: 'Your Title', font: 'Inter', size: 120, weight: 700, italic: false, color: '#ffffff', align: 'center',
  x: 0, y: 0, stroke: false, strokeColor: '#000000', strokeWidth: 6, shadow: true, box: false, boxColor: '#000000', boxOpacity: 60,
};

function newGradeNode(n = 1) {
  return {
    id: uid(), label: String(n).padStart(2, '0'), enabled: true,
    lift: [0, 0, 0, 0], gamma: [0, 0, 0, 0], gain: [0, 0, 0, 0], offset: [0, 0, 0, 0],
    contrast: 1, pivot: 0.435, saturation: 1, hue: 0, temperature: 0, tint: 0, exposure: 0,
    curves: { y: [[0, 0], [255, 255]], r: [[0, 0], [255, 255]], g: [[0, 0], [255, 255]], b: [[0, 0], [255, 255]] },
    lutId: null, lutMix: 1,
    window: { type: 'none', x: 0.5, y: 0.5, w: 0.5, h: 0.5, softness: 0.15, invert: false },
    mix: 1,
  };
}

function makeClip(kind, o = {}) {
  const visual = kind !== 'audio';
  return {
    id: uid(), kind, trackId: o.trackId, mediaId: o.mediaId || null, name: o.name || kind,
    start: o.start || 0, duration: o.duration || 1, offset: o.offset || 0, speed: 1,
    linkId: o.linkId || null, enabled: true,
    ...(visual ? {
      motion: { x: 0, y: 0, scale: 100, rotation: 0, fit: true },
      opacity: 100, blend: 'normal', crop: { l: 0, r: 0, t: 0, b: 0 },
      effects: [], grade: { nodes: [newGradeNode()] },
    } : { volume: 0, pan: 0 }),
    keys: {},
    transIn: null, transOut: null,
    ...(kind === 'title' ? { title: { ...DEFAULT_TITLE, ...(o.title || {}) } } : {}),
    ...(kind === 'color' ? { fill: o.fill || '#1a1a1a' } : {}),
  };
}

function makeTrack(kind, n) {
  return { id: uid(), kind, name: `${kind === 'video' ? 'V' : 'A'}${n}`, locked: false, hidden: false, muted: false, solo: false, volume: 0, pan: 0, target: n === 1, ...(kind === 'audio' ? { channels: 'stereo' } : {}) };
}

// ---------- Model ----------
const Model = {
  data: null,

  newProject(name = 'Untitled Project') {
    this.data = {
      version: 1,
      name,
      media: [],
      luts: [],
      seq: {
        name: 'Sequence 01', width: 1920, height: 1080, fps: 30, sampleRate: 48000,
        tracks: [makeTrack('video', 1), makeTrack('video', 2), makeTrack('video', 3), makeTrack('audio', 1), makeTrack('audio', 2), makeTrack('audio', 3)],
        clips: [], markers: [], inPoint: null, outPoint: null, playhead: 0,
      },
    };
  },

  get seq() { return this.data.seq; },
  get fps() { return this.data.seq.fps; },

  track(id) { return this.seq.tracks.find((t) => t.id === id); },
  tracks(kind) { return this.seq.tracks.filter((t) => t.kind === kind); },
  clip(id) { return this.seq.clips.find((c) => c.id === id); },
  media(id) { return this.data.media.find((m) => m.id === id); },
  lut(id) { return this.data.luts.find((l) => l.id === id); },

  clipsOn(trackId) {
    return this.seq.clips.filter((c) => c.trackId === trackId).sort((a, b) => a.start - b.start);
  },

  clipAt(trackId, frame) {
    return this.seq.clips.find((c) => c.trackId === trackId && frame >= c.start && frame < c.start + c.duration);
  },

  partners(c) {
    return c.linkId ? this.seq.clips.filter((x) => x.linkId === c.linkId && x.id !== c.id) : [];
  },

  end(c) { return c.start + c.duration; },

  duration() {
    return this.seq.clips.reduce((m, c) => Math.max(m, c.start + c.duration), 0);
  },

  // Source time (seconds) shown by clip c at timeline frame f.
  srcTime(c, f) {
    return c.offset + ((f - c.start) / this.fps) * c.speed;
  },

  // Longest the clip can be from its current in-point (Infinity for stills, titles…).
  maxDuration(c) {
    const m = c.mediaId && this.media(c.mediaId);
    if (!m || m.kind === 'image') return Infinity;
    return Math.floor(((m.duration - c.offset) / c.speed) * this.fps + 1e-6);
  },

  isTimed(c) {
    const m = c.mediaId && this.media(c.mediaId);
    return !!m && m.kind !== 'image';
  },

  // Index from the top of the timeline display (V3, V2, V1, A1, A2, A3).
  displayTracks() {
    return [...this.tracks('video').reverse(), ...this.tracks('audio')];
  },
};

// ---------- Editing operations ----------
const Ops = {
  remove(ids) {
    const set = new Set(ids);
    Model.seq.clips = Model.seq.clips.filter((c) => !set.has(c.id));
  },

  // Cut clip c into two at frame f. Returns the new right-hand clip.
  splitClip(c, f) {
    if (f <= c.start || f >= c.start + c.duration) return null;
    const right = structuredClone(c);
    right.id = uid();
    const leftLen = f - c.start;
    right.start = f;
    right.duration = c.duration - leftLen;
    right.offset = c.offset + (leftLen / Model.fps) * c.speed;
    right.transIn = null;
    c.transOut = null;
    c.duration = leftLen;
    // Keyframes are stored relative to the clip start.
    for (const k of Object.keys(right.keys)) right.keys[k] = right.keys[k].map((kf) => ({ ...kf, f: kf.f - leftLen })).filter((kf) => kf.f >= 0);
    for (const k of Object.keys(c.keys)) c.keys[k] = c.keys[k].filter((kf) => kf.f <= leftLen);
    Model.seq.clips.push(right);
    return right;
  },

  // Split everything crossing frame f on the given tracks; linked halves stay linked.
  splitAt(f, trackIds) {
    const relink = new Map();
    for (const c of [...Model.seq.clips]) {
      if (!trackIds.includes(c.trackId) || Model.track(c.trackId).locked) continue;
      const right = this.splitClip(c, f);
      if (right && c.linkId) {
        if (!relink.has(c.linkId)) relink.set(c.linkId, uid());
        right.linkId = relink.get(c.linkId);
      }
    }
  },

  // Make room for [from, to) on a track by trimming, splitting or removing clips.
  clearRange(trackId, from, to, keep = new Set()) {
    for (const c of [...Model.seq.clips]) {
      if (c.trackId !== trackId || keep.has(c.id)) continue;
      const s = c.start, e = c.start + c.duration;
      if (e <= from || s >= to) continue;
      if (s >= from && e <= to) { this.remove([c.id]); continue; }
      if (s < from && e > to) {
        const right = this.splitClip(c, to);
        right.linkId = null;
        c.duration = from - s;
        continue;
      }
      if (s < from) { c.duration = from - s; c.transOut = null; continue; }
      const cut = to - s;
      c.offset += (cut / Model.fps) * c.speed;
      c.start = to;
      c.duration -= cut;
      c.transIn = null;
    }
  },

  // Put clips where they are, overwriting whatever was underneath.
  overwrite(clips) {
    const keep = new Set(clips.map((c) => c.id));
    for (const c of clips) this.clearRange(c.trackId, c.start, c.start + c.duration, keep);
  },

  // Push everything at or after frame f to the right by n frames on the given tracks.
  ripple(f, n, trackIds) {
    this.splitAt(f, trackIds);
    for (const c of Model.seq.clips) {
      if (trackIds.includes(c.trackId) && c.start >= f && !Model.track(c.trackId).locked) c.start += n;
    }
    for (const m of Model.seq.markers) if (m.frame >= f) m.frame += n;
  },

  // Remove clips and close the gaps they leave on their tracks.
  rippleDelete(ids) {
    const doomed = Model.seq.clips.filter((c) => ids.includes(c.id));
    this.remove(ids);
    const byTrack = new Map();
    for (const c of doomed) {
      if (!byTrack.has(c.trackId)) byTrack.set(c.trackId, []);
      byTrack.get(c.trackId).push([c.start, c.start + c.duration]);
    }
    for (const [trackId, ranges] of byTrack) {
      ranges.sort((a, b) => b[0] - a[0]);
      for (const [s, e] of ranges) {
        for (const c of Model.seq.clips) if (c.trackId === trackId && c.start >= e) c.start -= e - s;
      }
    }
  },

  // Cut [from, to) out of the given tracks and pull everything after it left,
  // keeping linked audio/video halves linked (used by Remove Silence).
  extractRange(from, to, trackIds) {
    if (to <= from) return;
    this.splitAt(from, trackIds);
    this.splitAt(to, trackIds);
    const set = new Set(trackIds);
    const len = to - from;
    Model.seq.clips = Model.seq.clips.filter((c) => !(set.has(c.trackId) && c.start >= from && c.start + c.duration <= to));
    for (const c of Model.seq.clips) if (set.has(c.trackId) && c.start >= to) c.start -= len;
    const seq = Model.seq;
    seq.markers = seq.markers.filter((m) => m.frame < from || m.frame >= to);
    for (const m of seq.markers) if (m.frame >= to) m.frame -= len;
    const shift = (f) => (f == null ? f : f >= to ? f - len : f > from ? from : f);
    seq.inPoint = shift(seq.inPoint);
    seq.outPoint = shift(seq.outPoint);
  },

  // Close a gap on a track (ripple delete of empty space).
  closeGap(trackId, from, to) {
    for (const c of Model.seq.clips) if (c.trackId === trackId && c.start >= to) c.start -= to - from;
  },

  // Clips (and their linked partners) for a set of ids.
  withPartners(ids, linked = true) {
    const out = new Set(ids);
    if (linked) for (const id of ids) for (const p of Model.partners(Model.clip(id) || {})) out.add(p.id);
    return [...out];
  },

  // Next empty video track above everything at [from, to), adding one if needed.
  freeVideoTrack(from, to) {
    for (const t of Model.tracks('video')) {
      if (!t.locked && !Model.seq.clips.some((c) => c.trackId === t.id && c.start < to && c.start + c.duration > from)) return t;
    }
    return this.addTrack('video');
  },

  // New track right above or below another one on screen (video stacks upward, audio downward).
  insertTrack(ref, where) {
    const t = makeTrack(ref.kind, 0);
    t.target = false;
    const tracks = Model.seq.tracks;
    const i = tracks.indexOf(ref);
    const after = ref.kind === 'video' ? where === 'above' : where === 'below';
    tracks.splice(after ? i + 1 : i, 0, t);
    Model.tracks(ref.kind).forEach((x, k) => { x.name = `${x.kind === 'video' ? 'V' : 'A'}${k + 1}`; });
    return t;
  },

  addTrack(kind) {
    const n = Model.tracks(kind).length + 1;
    const t = makeTrack(kind, n);
    t.target = false;
    const tracks = Model.seq.tracks;
    const lastIndex = tracks.map((x) => x.kind).lastIndexOf(kind);
    tracks.splice(lastIndex + 1, 0, t);
    return t;
  },

  // Neighbor edit points (clip starts/ends) for snapping and Up/Down navigation.
  editPoints(exclude = new Set()) {
    const pts = new Set([0]);
    for (const c of Model.seq.clips) {
      if (exclude.has(c.id)) continue;
      pts.add(c.start);
      pts.add(c.start + c.duration);
    }
    return [...pts].sort((a, b) => a - b);
  },
};

// ---------- Keyframes ----------
// clip.keys[path] = [{ f, v }] with f relative to the clip start.
function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
}

function setPath(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  const target = keys.reduce((o, k) => o[k], obj);
  target[last] = value;
}

function paramAt(clip, path, rel) {
  const keys = clip.keys[path];
  if (!keys?.length) return getPath(clip, path);
  if (rel <= keys[0].f) return keys[0].v;
  const last = keys[keys.length - 1];
  if (rel >= last.f) return last.v;
  let i = 0;
  while (keys[i + 1].f < rel) i++;
  const a = keys[i], b = keys[i + 1];
  const t = (rel - a.f) / (b.f - a.f || 1);
  const s = b.ease ? t * t * (3 - 2 * t) : t;
  return a.v + (b.v - a.v) * s;
}

function setKey(clip, path, rel, value) {
  const keys = (clip.keys[path] ||= []);
  const k = keys.find((x) => x.f === rel);
  if (k) k.v = value;
  else keys.push({ f: rel, v: value });
  keys.sort((a, b) => a.f - b.f);
}

// ---------- Undo ----------
const History = {
  undoStack: [],
  redoStack: [],
  limit: 200,

  snapshot() {
    return structuredClone({ seq: Model.data.seq, media: Model.data.media, luts: Model.data.luts, name: Model.data.name });
  },

  restore(s) {
    Object.assign(Model.data, structuredClone(s));
  },

  // Run fn as one undoable step. Return false from fn to cancel it.
  step(name, fn) {
    const before = this.snapshot();
    const result = fn();
    if (result === false) { this.restore(before); return false; }
    this.undoStack.push({ name, before, after: this.snapshot() });
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
    App.changed();
    return true;
  },

  // For edits made live (dragging a slider): call begin() first, then commit(name).
  begin() {
    if (!this.pendingBefore) this.pendingBefore = this.snapshot();
  },

  commit(name) {
    const before = this.pendingBefore;
    this.pendingBefore = null;
    if (!before) return;
    this.undoStack.push({ name, before, after: this.snapshot() });
    this.redoStack = [];
    App.changed();
  },

  undo() {
    const e = this.undoStack.pop();
    if (!e) return;
    this.restore(e.before);
    this.redoStack.push(e);
    App.changed({ undo: e.name });
  },

  redo() {
    const e = this.redoStack.pop();
    if (!e) return;
    this.restore(e.after);
    this.undoStack.push(e);
    App.changed({ redo: e.name });
  },

  clear() {
    this.undoStack = [];
    this.redoStack = [];
  },
};
