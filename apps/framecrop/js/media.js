// Media: import, persistence (originals live in IndexedDB via FileStore),
// thumbnails, audio waveforms and the pools of <video>/<audio> elements used for playback.

// Runtime-only data per media id (never saved): object URL, thumbnail, waveform peaks.
const MediaRT = new Map();

const PEAKS_PER_SEC = 200;

function mediaKind(file) {
  if (file.type.startsWith('video/') || /\.(mp4|m4v|mov|webm|mkv|ogv)$/i.test(file.name)) return 'video';
  if (file.type.startsWith('audio/') || /\.(mp3|wav|m4a|aac|ogg|oga|flac|opus)$/i.test(file.name)) return 'audio';
  if (file.type.startsWith('image/')) return 'image';
  return null;
}

function waitEvent(el, ok, fail = 'error', timeout = 15000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { cleanup(); reject(new Error(`Timed out waiting for ${ok}`)); }, timeout);
    const onOk = () => { cleanup(); resolve(); };
    const onFail = () => { cleanup(); reject(new Error(`Failed: ${fail}`)); };
    const cleanup = () => { clearTimeout(t); el.removeEventListener(ok, onOk); el.removeEventListener(fail, onFail); };
    el.addEventListener(ok, onOk, { once: true });
    el.addEventListener(fail, onFail, { once: true });
  });
}

async function seekTo(el, t) {
  // A fresh element has to load before it can show a frame; seeking to where it
  // already is never fires "seeked", so only seek when the time actually changes.
  if (el.readyState < 2) await waitEvent(el, 'loadeddata', 'error', 8000).catch(() => {});
  if (Math.abs(el.currentTime - t) < 1e-3) return;
  const done = waitEvent(el, 'seeked', 'error', 4000);
  el.currentTime = t;
  await done;
}

let decodeCtx = null;
async function decodeAudio(blob) {
  decodeCtx ||= new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 48000 });
  return decodeCtx.decodeAudioData(await blob.arrayBuffer());
}

function computePeaks(buffer) {
  const n = Math.ceil(buffer.duration * PEAKS_PER_SEC);
  const peaks = new Float32Array(n);
  const step = buffer.sampleRate / PEAKS_PER_SEC;
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < n; i++) {
      let m = 0;
      const end = Math.min(data.length, Math.floor((i + 1) * step));
      for (let j = Math.floor(i * step); j < end; j += 4) {
        const v = Math.abs(data[j]);
        if (v > m) m = v;
      }
      if (m > peaks[i]) peaks[i] = m;
    }
  }
  return peaks;
}

// Estimate frame rate by timing a few decoded frames.
async function detectFps(el) {
  if (!('requestVideoFrameCallback' in el)) return null;
  const times = [];
  try {
    el.muted = true;
    await el.play();
    await new Promise((resolve) => {
      const t = setTimeout(resolve, 1500);
      const cb = (now, meta) => {
        times.push(meta.mediaTime);
        if (times.length >= 8) { clearTimeout(t); resolve(); } else el.requestVideoFrameCallback(cb);
      };
      el.requestVideoFrameCallback(cb);
    });
    el.pause();
  } catch { return null; }
  const deltas = times.slice(1).map((t, i) => t - times[i]).filter((d) => d > 0.005).sort((a, b) => a - b);
  if (!deltas.length) return null;
  const fps = 1 / deltas[Math.floor(deltas.length / 2)];
  return FPS_PRESETS.reduce((best, p) => (Math.abs(p - fps) < Math.abs(best - fps) ? p : best), 30);
}

function letterbox(src, sw, sh, w, h) {
  const c = makeCanvas(w, h);
  const x = ctxOf(c);
  x.fillStyle = '#000';
  x.fillRect(0, 0, w, h);
  const k = Math.min(w / sw, h / sh);
  x.drawImage(src, (w - sw * k) / 2, (h - sh * k) / 2, sw * k, sh * k);
  return c;
}

const Media = {
  // Import files into the project. Returns the new media items.
  async importFiles(files) {
    const added = [];
    // Timeline files (FCPXML, XML, EDL, OTIO) open the timeline import instead.
    for (const file of files.filter(isTimelineFile)) Interchange.openFile(file);
    for (const file of files.filter((f) => !isTimelineFile(f))) {
      const kind = mediaKind(file);
      if (!kind) { toast(`"${file.name}" isn't a video, audio or image file.`); continue; }
      const id = uid();
      const item = { id, name: file.name, kind, size: file.size, fileKey: `framecrop:${id}`, duration: 0, width: 0, height: 0, fps: null, hasAudio: false, hasVideo: kind !== 'audio' };
      try {
        App.busy(`Importing ${file.name}…`);
        await FileStore.put(item.fileKey, file).catch(() => {});
        await this.analyze(item, file);
        added.push(item);
      } catch (err) {
        console.error(err);
        toast(`Couldn't import "${file.name}". The format may not be supported by this browser.`);
      } finally {
        App.busy(false);
      }
    }
    if (added.length) {
      History.step(added.length === 1 ? `Import ${added[0].name}` : `Import ${added.length} items`, () => { Model.data.media.push(...added); });
    }
    return added;
  },

  // Read duration, size, frame rate, thumbnail and waveform for an item.
  async analyze(item, blob) {
    const rt = { url: URL.createObjectURL(blob), status: 'ready', thumb: null, peaks: null };
    MediaRT.set(item.id, rt);
    if (item.kind === 'image') {
      const bmp = await createImageBitmap(blob);
      item.width = bmp.width;
      item.height = bmp.height;
      item.duration = Infinity;
      rt.image = bmp;
      rt.thumb = letterbox(bmp, bmp.width, bmp.height, 160, 90).toDataURL('image/jpeg', 0.8);
      return item;
    }
    const el = document.createElement(item.kind === 'video' ? 'video' : 'audio');
    el.preload = 'auto';
    el.muted = true;
    el.src = rt.url;
    await waitEvent(el, 'loadedmetadata');
    item.duration = el.duration;
    if (item.kind === 'video') {
      item.width = el.videoWidth;
      item.height = el.videoHeight;
      if (!item.width) throw new Error('No video track');
      await waitEvent(el, 'loadeddata').catch(() => {});
      item.fps ||= await detectFps(el);
      await seekTo(el, Math.min(1, item.duration * 0.1));
      rt.thumb = letterbox(el, item.width, item.height, 160, 90).toDataURL('image/jpeg', 0.8);
    }
    el.removeAttribute('src');
    el.load();
    try {
      const buffer = await decodeAudio(blob);
      item.hasAudio = buffer.length > 0;
      rt.peaks = computePeaks(buffer);
    } catch {
      item.hasAudio = false;
      if (item.kind === 'audio') throw new Error('Audio could not be decoded');
    }
    return item;
  },

  // Reconnect saved media to the originals stored on this computer.
  async restore(item) {
    const rt = { url: null, status: 'offline', thumb: null, peaks: null };
    MediaRT.set(item.id, rt);
    let blob = null;
    try { blob = await FileStore.get(item.fileKey); } catch { /* storage unavailable */ }
    if (!blob) return false;
    const fresh = { ...item };
    try {
      await this.analyze(fresh, blob);
      return true;
    } catch {
      MediaRT.set(item.id, rt);
      return false;
    }
  },

  async relink(item, file) {
    await FileStore.put(item.fileKey, file).catch(() => {});
    await this.analyze(item, file);
    App.changed();
  },

  isOnline(id) {
    return MediaRT.get(id)?.status === 'ready';
  },

  // Decoded audio for export (decoded fresh each time to keep memory low between exports).
  async audioBuffer(id) {
    const item = Model.media(id);
    const blob = await FileStore.get(item.fileKey);
    return decodeAudio(blob);
  },
};

// ---------- Element pools ----------
// Each clip on screen needs its own element; elements are reused as clips come and go.
const Pool = {
  videos: new Map(),
  audios: new Map(),

  get(kind, mediaId, clipId) {
    const map = kind === 'video' ? this.videos : this.audios;
    let list = map.get(mediaId);
    if (!list) { list = []; map.set(mediaId, list); }
    let entry = list.find((e) => e.clipId === clipId) || list.find((e) => !e.clipId);
    if (!entry) {
      const rt = MediaRT.get(mediaId);
      if (!rt?.url) return null;
      const el = document.createElement(kind);
      el.preload = 'auto';
      el.playsInline = true;
      el.src = rt.url;
      if (kind === 'video') el.muted = true;
      entry = { el, clipId: null };
      if (kind === 'audio') entry.node = Player.connectElement(el);
      list.push(entry);
    }
    entry.clipId = clipId;
    entry.used = true;
    return entry;
  },

  // Free elements whose clips are no longer active.
  sweep() {
    for (const map of [this.videos, this.audios]) {
      for (const list of map.values()) {
        for (const e of list) {
          if (!e.used && e.clipId) {
            e.clipId = null;
            if (!e.el.paused) e.el.pause();
          }
          e.used = false;
        }
      }
    }
  },

  pauseAll() {
    for (const map of [this.videos, this.audios]) for (const list of map.values()) for (const e of list) if (!e.el.paused) e.el.pause();
  },

  // Drop elements for media that changed (relinked or removed).
  reset(mediaId) {
    for (const map of [this.videos, this.audios]) {
      for (const e of map.get(mediaId) || []) { e.el.pause(); e.el.removeAttribute('src'); }
      map.delete(mediaId);
    }
  },
};

// ---------- Titles ----------
const titleCache = new Map();
function titleCanvas(clip, w, h) {
  const t = clip.title;
  const key = `${JSON.stringify(t)}|${w}x${h}`;
  const cached = titleCache.get(clip.id);
  if (cached?.key === key) return cached;
  const k = w / Model.seq.width;
  const c = makeCanvas(w, h);
  const x = ctxOf(c);
  x.font = `${t.italic ? 'italic ' : ''}${t.weight} ${t.size * k}px "${t.font}", sans-serif`;
  x.textAlign = t.align;
  x.textBaseline = 'middle';
  const lines = String(t.text).split('\n');
  const lineH = t.size * k * 1.15;
  const cx = w / 2 + t.x * k, cy = h / 2 + t.y * k;
  const top = cy - ((lines.length - 1) * lineH) / 2;
  if (t.box) {
    const widths = lines.map((l) => x.measureText(l).width);
    const bw = Math.max(...widths) + t.size * k * 0.6;
    const bh = lines.length * lineH + t.size * k * 0.3;
    const bx = t.align === 'center' ? cx - bw / 2 : t.align === 'left' ? cx - t.size * k * 0.3 : cx - bw + t.size * k * 0.3;
    x.fillStyle = t.boxColor;
    x.globalAlpha = t.boxOpacity / 100;
    x.fillRect(bx, top - lineH / 2 - t.size * k * 0.15, bw, bh);
    x.globalAlpha = 1;
  }
  if (t.shadow) {
    x.shadowColor = 'rgba(0,0,0,.6)';
    x.shadowBlur = 12 * k;
    x.shadowOffsetY = 4 * k;
  }
  lines.forEach((line, i) => {
    const y = top + i * lineH;
    if (t.stroke) {
      x.lineJoin = 'round';
      x.lineWidth = t.strokeWidth * k * 2;
      x.strokeStyle = t.strokeColor;
      x.strokeText(line, cx, y);
    }
    x.fillStyle = t.color;
    x.fillText(line, cx, y);
  });
  const entry = { key, canvas: c, version: (cached?.version || 0) + 1 };
  titleCache.set(clip.id, entry);
  return entry;
}
