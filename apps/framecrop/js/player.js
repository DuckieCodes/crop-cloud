// Playback: clock, J/K/L shuttle, keeping media elements in sync, audio routing and meters.

const dbToGain = (db) => (db <= -60 ? 0 : Math.pow(10, db / 20));

// Audio clips audible at a frame, with their gain from volume keyframes and crossfades.
function audioLayers(track, f) {
  const clips = Model.clipsOn(track.id).filter((c) => c.enabled);
  const out = [];
  const fade = (trans, p, incoming) => {
    const curve = trans.type === 'constant-gain' ? (x) => x : (x) => Math.sin((x * Math.PI) / 2);
    return incoming ? curve(clamp(p, 0, 1)) : curve(clamp(1 - p, 0, 1));
  };
  for (let i = 0; i < clips.length; i++) {
    const c = clips[i];
    const prev = clips[i - 1] && Model.end(clips[i - 1]) === c.start ? clips[i - 1] : null;
    const next = clips[i + 1] && clips[i + 1].start === Model.end(c) ? clips[i + 1] : null;
    const s = c.start, e = Model.end(c);
    const tin = c.transIn, tnext = next?.transIn;
    const inHalf = tin ? Math.round(tin.duration / 2) : 0;
    const nHalf = tnext ? Math.round(tnext.duration / 2) : 0;
    let g = null;
    if (tin && prev && f >= s - inHalf && f < s - inHalf + tin.duration) g = fade(tin, (f - (s - inHalf)) / tin.duration, true);
    else if (tnext && f >= e - nHalf && f < e - nHalf + tnext.duration) g = fade(tnext, (f - (e - nHalf)) / tnext.duration, false);
    else if (f >= s && f < e) {
      g = 1;
      if (tin && !prev && f < s + tin.duration) g = fade(tin, (f - s) / tin.duration, true);
      if (c.transOut && !next && f >= e - c.transOut.duration) g = fade(c.transOut, (f - (e - c.transOut.duration)) / c.transOut.duration, false);
    }
    if (g == null) continue;
    const rel = f - s;
    out.push({ clip: c, rel, srcTime: Model.srcTime(c, f), gain: g * dbToGain(Param.at(c, 'volume', clamp(rel, 0, c.duration))), pan: Param.at(c, 'pan', clamp(rel, 0, c.duration)) });
  }
  return out;
}

function setBusChannels(node, track) {
  const mono = track.channels === 'mono';
  node.channelCount = mono ? 1 : 2;
  node.channelCountMode = 'explicit';
  node.channelInterpretation = 'speakers';
}

function trackAudible(track) {
  const anySolo = Model.tracks('audio').some((t) => t.solo);
  return !track.muted && (!anySolo || track.solo);
}

const Player = {
  playing: false,
  rate: 1,
  startFrame: 0,
  startTime: 0,
  token: 0,
  ctx: null,
  buses: new Map(),
  levels: { L: -Infinity, R: -Infinity, tracks: {} },

  // ---------- Audio graph ----------
  ensureAudio() {
    if (this.ctx) return this.ctx;
    const ctx = new AudioContext({ latencyHint: 'interactive', sampleRate: 48000 });
    this.ctx = ctx;
    this.master = ctx.createGain();
    const split = ctx.createChannelSplitter(2);
    this.meterL = ctx.createAnalyser();
    this.meterR = ctx.createAnalyser();
    this.meterL.fftSize = this.meterR.fftSize = 1024;
    this.master.connect(split);
    split.connect(this.meterL, 0);
    split.connect(this.meterR, 1);
    this.master.connect(ctx.destination);
    this.buf = new Float32Array(1024);
    return ctx;
  },

  connectElement(el) {
    const ctx = this.ensureAudio();
    const src = ctx.createMediaElementSource(el);
    const gain = ctx.createGain();
    const pan = ctx.createStereoPanner();
    src.connect(gain).connect(pan);
    return { src, gain, pan, bus: null };
  },

  bus(track) {
    let b = this.buses.get(track.id);
    if (!b) {
      const ctx = this.ensureAudio();
      const gain = ctx.createGain();
      const pan = ctx.createStereoPanner();
      const meter = ctx.createAnalyser();
      meter.fftSize = 512;
      gain.connect(pan).connect(this.master);
      pan.connect(meter);
      b = { gain, pan, meter };
      this.buses.set(track.id, b);
    }
    b.gain.gain.value = trackAudible(track) ? dbToGain(track.volume) : 0;
    setBusChannels(b.gain, track);
    b.pan.pan.value = clamp(track.pan / 100, -1, 1);
    return b;
  },

  // ---------- Transport ----------
  get frame() { return Model.seq.playhead; },

  endFrame() {
    const seq = Model.seq;
    return seq.outPoint != null && this.frame < seq.outPoint ? seq.outPoint : Model.duration();
  },

  play(rate = 1) {
    if (!Model.duration()) return;
    this.ensureAudio().resume();
    if (rate > 0 && this.frame >= Model.duration() - 1) Model.seq.playhead = 0;
    this.rate = rate;
    this.startFrame = this.frame;
    this.startTime = performance.now();
    if (!this.playing) {
      this.playing = true;
      requestAnimationFrame(() => this.tick());
    }
    Bus.emit('transport');
  },

  pause() {
    if (!this.playing) return;
    this.playing = false;
    Pool.pauseAll();
    this.levels = { L: -Infinity, R: -Infinity, tracks: {} };
    Bus.emit('transport');
    this.renderExact();
  },

  toggle() {
    if (this.playing) this.pause();
    else this.play(1);
  },

  // J / K / L: each press speeds up in that direction.
  shuttle(dir) {
    if (dir === 0) { this.pause(); return; }
    let rate = dir;
    if (this.playing && Math.sign(this.rate) === dir) rate = clamp(this.rate * 2, -8, 8);
    this.play(rate);
  },

  seek(frame, { render = true } = {}) {
    const f = clamp(Math.round(frame), 0, Math.max(0, Model.duration() + Model.fps * 60));
    Model.seq.playhead = f;
    if (this.playing) {
      this.startFrame = f;
      this.startTime = performance.now();
    } else if (render) {
      this.renderExact();
    }
    Bus.emit('playhead');
  },

  step(n) {
    if (this.playing) this.pause();
    this.seek(this.frame + n);
  },

  tick() {
    if (!this.playing) return;
    const elapsed = (performance.now() - this.startTime) / 1000;
    let f = this.startFrame + elapsed * Model.fps * this.rate;
    const end = this.endFrame();
    if (f >= end) { Model.seq.playhead = Math.max(0, end - 1); this.pause(); Bus.emit('playhead'); return; }
    if (f < 0) { Model.seq.playhead = 0; this.pause(); Bus.emit('playhead'); return; }
    Model.seq.playhead = Math.floor(f);
    this.sync(Model.seq.playhead);
    GL.render(Model.seq.playhead, { scopes: App.scopesVisible() });
    this.readMeters();
    Bus.emit('playhead');
    requestAnimationFrame(() => this.tick());
  },

  // Keep every active element near its source time while playing.
  sync(f) {
    const rate = this.rate;
    for (const L of Compose.layers(f)) {
      const el = L.el;
      if (!el) continue;
      if (rate < 0 || Math.abs(rate) > 4) {
        if (!el.paused) el.pause();
        if (!el.seeking) el.currentTime = L.srcTime;
        continue;
      }
      el.playbackRate = clamp(L.clip.speed * rate, 0.0625, 16);
      if (el.paused) { el.currentTime = L.srcTime; el.play().catch(() => {}); }
      else if (Math.abs(el.currentTime - L.srcTime) > 0.25) el.currentTime = L.srcTime;
    }
    for (const track of Model.tracks('audio')) {
      const bus = this.bus(track);
      for (const A of audioLayers(track, f)) {
        const m = Model.media(A.clip.mediaId);
        if (!m || !Media.isOnline(m.id)) continue;
        const entry = Pool.get('audio', m.id, A.clip.id);
        if (!entry) continue;
        const { el, node } = entry;
        if (node.bus !== bus) {
          node.pan.disconnect();
          node.pan.connect(bus.gain);
          node.bus = bus;
        }
        node.gain.gain.value = A.gain;
        node.pan.pan.value = clamp(A.pan / 100, -1, 1);
        if (rate < 0 || Math.abs(rate) > 4 || A.srcTime < 0 || A.srcTime >= m.duration) { if (!el.paused) el.pause(); continue; }
        el.playbackRate = clamp(A.clip.speed * rate, 0.0625, 16);
        if (el.paused) { el.currentTime = A.srcTime; el.play().catch(() => {}); }
        else if (Math.abs(el.currentTime - A.srcTime) > 0.2) el.currentTime = A.srcTime;
      }
    }
    Pool.sweep();
  },

  readMeters() {
    if (!this.ctx) return;
    const peak = (an) => {
      an.getFloatTimeDomainData(this.buf);
      let m = 0;
      for (let i = 0; i < an.fftSize; i++) m = Math.max(m, Math.abs(this.buf[i]));
      return m > 0 ? 20 * Math.log10(m) : -Infinity;
    };
    this.levels.L = peak(this.meterL);
    this.levels.R = peak(this.meterR);
    for (const [id, b] of this.buses) this.levels.tracks[id] = peak(b.meter);
    Bus.emit('meters');
  },

  // Exact frame while paused: seek, then draw. Newer requests cancel older ones.
  async renderExact() {
    const token = ++this.token;
    const f = this.frame;
    await Compose.prepare(f);
    if (token !== this.token || this.playing) return;
    GL.render(f, { scopes: App.scopesVisible() });
    Bus.emit('rendered');
  },
};
