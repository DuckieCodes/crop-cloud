// Export: frame-accurate render → WebCodecs encode → MP4 (mp4-muxer), plus audio mixdown.

const VIDEO_CODECS = {
  h264: { label: 'H.264 (MP4)', muxer: 'avc', candidates: ['avc1.640033', 'avc1.640028', 'avc1.4d0028', 'avc1.42001f'] },
  hevc: { label: 'H.265 / HEVC (MP4)', muxer: 'hevc', candidates: ['hev1.1.6.L153.B0', 'hev1.1.6.L120.B0', 'hvc1.1.6.L120.B0'] },
  vp9: { label: 'VP9 (MP4)', muxer: 'vp9', candidates: ['vp09.00.41.08', 'vp09.00.40.08', 'vp09.00.31.08'] },
  av1: { label: 'AV1 (MP4)', muxer: 'av1', candidates: ['av01.0.12M.08', 'av01.0.08M.08', 'av01.0.05M.08'] },
};

const EXPORT_PRESETS = [
  ['match', 'Match Source – High bitrate', { res: 'seq', mbps: 20 }],
  ['yt1080', 'YouTube 1080p Full HD', { res: '1920x1080', mbps: 16 }],
  ['yt4k', 'YouTube 2160p 4K UHD', { res: '3840x2160', mbps: 45 }],
  ['720', 'Vimeo / Web 720p', { res: '1280x720', mbps: 8 }],
  ['vertical', 'Social vertical 1080×1920', { res: '1080x1920', mbps: 12 }],
  ['draft', 'Draft preview (fast, small)', { res: 'half', mbps: 4 }],
];

async function pickVideoConfig(codecId, width, height, fps, bitrate) {
  if (typeof VideoEncoder === 'undefined') return null;
  for (const codec of VIDEO_CODECS[codecId].candidates) {
    const config = { codec, width, height, bitrate, framerate: fps, latencyMode: 'quality', ...(codecId === 'h264' ? { avc: { format: 'avc' } } : {}) };
    try {
      if ((await VideoEncoder.isConfigSupported(config)).supported) return config;
    } catch { /* try the next one */ }
  }
  return null;
}

async function pickAudioConfig(bitrate) {
  if (typeof AudioEncoder === 'undefined') return null;
  for (const [codec, muxer] of [['mp4a.40.2', 'aac'], ['opus', 'opus']]) {
    const config = { codec, sampleRate: 48000, numberOfChannels: 2, bitrate };
    try {
      if ((await AudioEncoder.isConfigSupported(config)).supported) return { config, muxer };
    } catch { /* try the next one */ }
  }
  return null;
}

// Which video codecs this browser can encode at this size.
async function supportedCodecs(width, height, fps) {
  const out = [];
  for (const id of Object.keys(VIDEO_CODECS)) if (await pickVideoConfig(id, width, height, fps, 8e6)) out.push(id);
  return out;
}

// ---------- Audio mixdown ----------
async function renderAudio(from, to) {
  const fps = Model.fps, sr = 48000;
  const length = Math.max(1, Math.ceil(((to - from) / fps) * sr));
  const ctx = new OfflineAudioContext(2, length, sr);
  const buffers = new Map();
  for (const track of Model.tracks('audio')) {
    if (!trackAudible(track)) continue;
    const bus = ctx.createGain();
    bus.gain.value = dbToGain(track.volume);
    setBusChannels(bus, track);
    const pan = ctx.createStereoPanner();
    pan.pan.value = clamp(track.pan / 100, -1, 1);
    bus.connect(pan).connect(ctx.destination);
    // Collect, per clip, the frames it's audible and its gain on each.
    const spans = new Map();
    for (let f = from; f < to; f++) {
      for (const A of audioLayers(track, f)) {
        let s = spans.get(A.clip.id);
        if (!s) { s = { clip: A.clip, first: f, gains: [], firstSrc: A.srcTime, pan: A.pan }; spans.set(A.clip.id, s); }
        s.gains.push(A.gain);
      }
    }
    for (const s of spans.values()) {
      const c = s.clip;
      if (!Media.isOnline(c.mediaId)) continue;
      if (!buffers.has(c.mediaId)) buffers.set(c.mediaId, await Media.audioBuffer(c.mediaId).catch(() => null));
      const buf = buffers.get(c.mediaId);
      if (!buf) continue;
      let when = (s.first - from) / fps;
      let offset = s.firstSrc;
      if (offset < 0) { when -= offset / c.speed; offset = 0; }
      const dur = (s.gains.length / fps) - (when - (s.first - from) / fps);
      if (dur <= 0 || offset >= buf.duration) continue;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = c.speed;
      const g = ctx.createGain();
      const p = ctx.createStereoPanner();
      p.pan.value = clamp(s.pan / 100, -1, 1);
      src.connect(g).connect(p).connect(bus);
      const curve = Float32Array.from(s.gains.length > 1 ? s.gains : [s.gains[0], s.gains[0]]);
      g.gain.setValueCurveAtTime(curve, (s.first - from) / fps, Math.max(1 / fps, s.gains.length / fps));
      src.start(when, offset, dur * c.speed);
    }
  }
  return ctx.startRendering();
}

async function encodeAudio(buffer, ac, muxer, bitrate) {
  let error = null;
  const enc = new AudioEncoder({ output: (chunk, meta) => muxer.addAudioChunk(chunk, meta), error: (e) => { error = e; } });
  enc.configure(ac.config);
  const L = buffer.getChannelData(0), R = buffer.getChannelData(1);
  const N = 4800;
  for (let i = 0; i < buffer.length; i += N) {
    const n = Math.min(N, buffer.length - i);
    const data = new Float32Array(n * 2);
    data.set(L.subarray(i, i + n), 0);
    data.set(R.subarray(i, i + n), n);
    const ad = new AudioData({ format: 'f32-planar', sampleRate: 48000, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((i / 48000) * 1e6), data });
    enc.encode(ad);
    ad.close();
    if (error) throw error;
  }
  await enc.flush();
  if (error) throw error;
  void bitrate;
}

// ---------- Video export ----------
const Exporter = {
  running: false,
  cancelled: false,

  async run(opts) {
    const { name, codec, width, height, bitrate, from, to, audio, audioBitrate } = opts;
    const fps = Model.fps;
    Player.pause();
    const vc = await pickVideoConfig(codec, width, height, fps, bitrate);
    if (!vc) { toast(`This browser can't encode ${VIDEO_CODECS[codec].label} at ${width}×${height}.`); return; }
    const ac = audio ? await pickAudioConfig(audioBitrate) : null;
    if (audio && !ac) toast('No audio encoder available; exporting without sound.');

    this.running = true;
    this.cancelled = false;
    const ui = this.progressUI(name);
    const canvas = GL.canvas;
    const prev = [canvas.width, canvas.height];
    const t0 = performance.now();
    let error = null;
    try {
      const muxer = new Mp4Muxer.Muxer({
        target: new Mp4Muxer.ArrayBufferTarget(),
        video: { codec: VIDEO_CODECS[codec].muxer, width, height, frameRate: fps },
        audio: ac ? { codec: ac.muxer, numberOfChannels: 2, sampleRate: 48000 } : undefined,
        fastStart: 'in-memory',
        firstTimestampBehavior: 'offset',
      });
      const encoder = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => { error = e; } });
      encoder.configure(vc);
      canvas.width = width;
      canvas.height = height;
      const total = to - from;
      const gop = Math.max(1, Math.round(fps * 2));
      for (let f = from; f < to; f++) {
        if (this.cancelled || error) break;
        await Compose.prepare(f);
        GL.render(f);
        const frame = new VideoFrame(canvas, { timestamp: Math.round(((f - from) * 1e6) / fps), duration: Math.round(1e6 / fps) });
        encoder.encode(frame, { keyFrame: (f - from) % gop === 0 });
        frame.close();
        while (encoder.encodeQueueSize > 4) await new Promise((r) => setTimeout(r, 2));
        if ((f - from) % 3 === 0) {
          const done = (f - from + 1) / total;
          const elapsed = (performance.now() - t0) / 1000;
          ui.update(done * (ac ? 0.9 : 1), `Frame ${f - from + 1} of ${total}`, elapsed / done - elapsed);
          await new Promise((r) => requestAnimationFrame(r));
        }
      }
      await encoder.flush();
      if (error) throw error;
      if (this.cancelled) return;
      if (ac) {
        ui.update(0.92, 'Mixing audio…');
        const buffer = await renderAudio(from, to);
        ui.update(0.96, 'Encoding audio…');
        await encodeAudio(buffer, ac, muxer, audioBitrate);
      }
      muxer.finalize();
      const blob = new Blob([muxer.target.buffer], { type: 'video/mp4' });
      ui.close();
      const file = `${name.replace(/\.mp4$/i, '')}.mp4`;
      const result = await saveBlob(blob, file, { description: 'MP4 video', accept: { 'video/mp4': ['.mp4'] } });
      const secs = ((performance.now() - t0) / 1000).toFixed(1);
      if (result) toast(`Exported ${result === 'download' ? file : result.name} · ${formatBytes(blob.size)} in ${secs}s`);
      this.lastBlob = blob;
    } catch (err) {
      console.error(err);
      toast(`Export failed: ${err.message || err}`);
    } finally {
      this.running = false;
      ui.close();
      canvas.width = prev[0];
      canvas.height = prev[1];
      Panels.program.layout();
    }
  },

  progressUI(name) {
    const el = document.createElement('div');
    el.className = 'export-progress';
    el.innerHTML = `<div class="ep-box"><h3>Exporting ${esc(name)}</h3><div class="ep-bar"><span></span></div>
      <p class="ep-text">Preparing…</p><button class="pbtn" data-cancel>Cancel</button></div>`;
    document.getElementById('overlay-layer').append(el);
    el.querySelector('[data-cancel]').addEventListener('click', () => { this.cancelled = true; toast('Export cancelled.'); });
    return {
      update(p, text, eta) {
        el.querySelector('.ep-bar span').style.width = `${Math.round(p * 100)}%`;
        el.querySelector('.ep-text').textContent = `${text}${eta > 0 && Number.isFinite(eta) ? ` · about ${Math.ceil(eta)}s left` : ''}`;
      },
      close() { el.remove(); },
    };
  },
};

async function exportDialog() {
  const seq = Model.seq;
  const dur = Model.duration();
  if (!dur) { toast('The sequence is empty. Add clips to the timeline first.'); return; }
  const codecs = await supportedCodecs(seq.width, seq.height, seq.fps);
  if (!codecs.length) { toast('This browser has no video encoder (WebCodecs). Use a recent Chrome or Edge.'); return; }
  const hasRange = seq.inPoint != null || seq.outPoint != null;
  openDialog({
    title: 'Export Settings',
    width: 560,
    okLabel: 'Export',
    body: `
      <label class="prow"><span class="prow-label">File Name</span><input class="pinput" name="name" value="${esc(seq.name)}"></label>
      <div class="prow"><span class="prow-label">Preset</span><select class="pselect" name="preset">${EXPORT_PRESETS.map(([id, label]) => `<option value="${id}">${label}</option>`).join('')}</select></div>
      <div class="prow"><span class="prow-label">Format</span><select class="pselect" name="codec">${codecs.map((id) => `<option value="${id}">${VIDEO_CODECS[id].label}</option>`).join('')}</select></div>
      <div class="prow"><span class="prow-label">Frame Size</span><span class="pnum"><input type="number" name="w" min="16" max="7680"><em>w</em></span><span class="pnum"><input type="number" name="h" min="16" max="4320"><em>h</em></span></div>
      <div class="prow"><span class="prow-label">Frame Rate</span><span class="pdialog-note">${seq.fps} fps (sequence)</span></div>
      <div class="prow"><span class="prow-label">Target Bitrate</span><span class="pnum"><input type="number" name="mbps" min="0.5" max="200" step="0.5"><em>Mbps</em></span></div>
      <div class="prow"><span class="prow-label">Range</span><select class="pselect" name="range"><option value="all">Entire Sequence</option>${hasRange ? '<option value="inout" selected>Sequence In/Out</option>' : ''}</select></div>
      <div class="prow"><span class="prow-label">Audio</span><label class="pcheck"><input type="checkbox" name="audio" checked> Export audio</label>
        <select class="pselect" name="abr"><option value="128000">128 kbps</option><option value="192000" selected>192 kbps</option><option value="320000">320 kbps</option></select></div>
      <p class="pdialog-note" data-summary></p>`,
    onMount(api) {
      const f = api.form;
      const applyPreset = () => {
        const p = EXPORT_PRESETS.find(([id]) => id === f.preset.value)[2];
        let w = seq.width, h = seq.height;
        if (p.res === 'half') { w = Math.round(seq.width / 4) * 2; h = Math.round(seq.height / 4) * 2; }
        else if (p.res !== 'seq') [w, h] = p.res.split('x').map(Number);
        f.w.value = w; f.h.value = h; f.mbps.value = p.mbps;
        summary();
      };
      const summary = () => {
        const range = f.range.value === 'inout' ? [seq.inPoint ?? 0, seq.outPoint ?? dur] : [0, dur];
        const secs = (range[1] - range[0]) / seq.fps;
        const bytes = ((+f.mbps.value * 1e6 + (f.audio.checked ? +f.abr.value : 0)) * secs) / 8;
        api.el.querySelector('[data-summary]').textContent = `Duration ${tc(range[1] - range[0])} · ${f.w.value}×${f.h.value} · estimated file size ${formatBytes(bytes)}`;
      };
      f.preset.addEventListener('change', applyPreset);
      f.addEventListener('input', summary);
      f.addEventListener('change', summary);
      applyPreset();
    },
    onOk(api) {
      const f = api.form;
      const range = f.range.value === 'inout' ? [seq.inPoint ?? 0, seq.outPoint ?? dur] : [0, dur];
      const even = (v) => Math.max(16, Math.round(+v / 2) * 2);
      Exporter.run({
        name: f.name.value.trim() || seq.name, codec: f.codec.value, width: even(f.w.value), height: even(f.h.value),
        bitrate: clamp(+f.mbps.value, 0.5, 200) * 1e6, from: range[0], to: range[1], audio: f.audio.checked, audioBitrate: +f.abr.value,
      });
    },
  });
}

// Export Frame (Ctrl+Shift+E): the current frame as PNG at full sequence size.
async function exportFrame() {
  const canvas = GL.canvas;
  const prev = [canvas.width, canvas.height];
  canvas.width = Model.seq.width;
  canvas.height = Model.seq.height;
  await Compose.prepare(Model.seq.playhead);
  GL.render(Model.seq.playhead);
  const blob = await canvasToBlob(canvas, 'image/png');
  canvas.width = prev[0];
  canvas.height = prev[1];
  Panels.program.layout();
  const name = `${Model.seq.name} ${tc(Model.seq.playhead).replace(/:/g, '-')}.png`;
  const result = await saveBlob(blob, name, { description: 'PNG image', accept: { 'image/png': ['.png'] } });
  if (result) toast(`Saved frame ${result === 'download' ? name : result.name}`);
}
