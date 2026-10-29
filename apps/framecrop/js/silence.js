// Remove Silence: find quiet stretches in the sequence's audio and ripple-delete them
// across all tracks. Threshold, minimum length and padding are adjustable with a live preview.

// Run fn at most once per animation frame.
function frameThrottle(fn) {
  let queued = false;
  return () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; fn(); });
  };
}

const Silence = {
  settings: { threshold: -38, minSec: 0.5, padSec: 0.15, source: 'all', range: 'all' },

  tracksFor(source) {
    const audio = Model.tracks('audio');
    return source === 'all' ? audio.filter(trackAudible) : audio.filter((t) => t.id === source);
  },

  span(range) {
    const seq = Model.seq;
    const end = Model.duration();
    if (range === 'inout' && (seq.inPoint != null || seq.outPoint != null)) return [seq.inPoint ?? 0, seq.outPoint ?? end];
    if (range === 'selection') {
      const sel = Edit.selected();
      if (sel.length) return [Math.min(...sel.map((c) => c.start)), Math.max(...sel.map((c) => Model.end(c)))];
    }
    return [0, end];
  },

  // Loudest audible peak (dBFS) on each frame, from the waveform data made at import.
  envelope(from, to, tracks) {
    const fps = Model.fps;
    const levels = new Float32Array(Math.max(0, to - from)).fill(-Infinity);
    for (const track of tracks) {
      const trackGain = dbToGain(track.volume);
      for (let f = from; f < to; f++) {
        for (const A of audioLayers(track, f)) {
          const peaks = MediaRT.get(A.clip.mediaId)?.peaks;
          if (!peaks) continue;
          const s0 = A.srcTime, s1 = s0 + A.clip.speed / fps;
          const i0 = Math.max(0, Math.floor(s0 * PEAKS_PER_SEC)), i1 = Math.min(peaks.length, Math.max(i0 + 1, Math.ceil(s1 * PEAKS_PER_SEC)));
          let m = 0;
          for (let i = i0; i < i1; i++) if (peaks[i] > m) m = peaks[i];
          const db = 20 * Math.log10(m * A.gain * trackGain || 1e-9);
          if (db > levels[f - from]) levels[f - from] = db;
        }
      }
    }
    return levels;
  },

  // Runs of frames under the threshold, at least minSec long, shrunk by padding on sides that touch sound.
  detect(levels, from, { threshold, minSec, padSec }) {
    const fps = Model.fps;
    const minF = Math.max(1, Math.round(minSec * fps));
    const pad = Math.round(padSec * fps);
    const out = [];
    let start = -1;
    for (let i = 0; i <= levels.length; i++) {
      const quiet = i < levels.length && levels[i] < threshold;
      if (quiet && start < 0) start = i;
      if (!quiet && start >= 0) {
        if (i - start >= minF) {
          const a = start === 0 ? 0 : start + pad;
          const b = i === levels.length ? i : i - pad;
          if (b > a) out.push([from + a, from + b]);
        }
        start = -1;
      }
    }
    return out;
  },

  analyze() {
    const s = this.settings;
    const tracks = this.tracksFor(s.source);
    const [from, to] = this.span(s.range);
    const levels = this.envelope(from, to, tracks);
    const ranges = this.detect(levels, from, s);
    return { from, to, levels, ranges, removed: ranges.reduce((sum, [a, b]) => sum + b - a, 0) };
  },

  apply(ranges) {
    if (!ranges.length) return;
    const tracks = Model.seq.tracks.filter((t) => !t.locked).map((t) => t.id);
    const total = ranges.reduce((sum, [a, b]) => sum + b - a, 0);
    History.step(`Remove Silence (${ranges.length})`, () => {
      for (const [a, b] of [...ranges].sort((x, y) => y[0] - x[0])) Ops.extractRange(a, b, tracks);
    });
    Edit.clearSelection();
    Player.seek(Math.min(Model.seq.playhead, Math.max(0, Model.duration() - 1)));
    toast(`Removed ${ranges.length} silence${ranges.length === 1 ? '' : 's'} · ${(total / Model.fps).toFixed(1)}s shorter`);
  },

  setPreview(result) {
    App.silencePreview = result ? result.ranges : null;
    Timeline.drawSilence();
  },
};

function removeSilenceDialog() {
  const audioTracks = Model.tracks('audio');
  const hasAudio = Model.seq.clips.some((c) => c.kind === 'audio' && MediaRT.get(c.mediaId)?.peaks);
  if (!hasAudio) { toast('There is no audio in the sequence to analyze.'); return; }
  const s = Silence.settings;
  const seq = Model.seq;
  let result = null;
  openDialog({
    title: 'Remove Silence',
    width: 680,
    okLabel: 'Ripple Delete',
    body: `
      <div class="sil">
        <canvas class="sil-graph" width="540" height="130" title="Drag up or down to set the threshold"></canvas>
        <div class="prow"><span class="prow-label">Threshold</span>
          <button type="button" class="pbtn pbtn-sm" data-step="-2" title="Lower: only cut near-total silence">− Lower</button>
          <span class="pnum"><input type="number" name="threshold" min="-80" max="-6" step="1" value="${s.threshold}"><em>dB</em></span>
          <button type="button" class="pbtn pbtn-sm" data-step="2" title="Higher: cut quieter speech and breaths too">Higher +</button>
          <input type="range" class="sil-range" name="thresholdRange" min="-80" max="-6" step="1" value="${s.threshold}"></div>
        <div class="prow"><span class="prow-label">Minimum silence</span><span class="pnum"><input type="number" name="minSec" min="0.1" max="10" step="0.05" value="${s.minSec}"><em>s</em></span>
          <input type="range" class="sil-range" name="minRange" min="0.1" max="4" step="0.05" value="${Math.min(4, s.minSec)}"></div>
        <div class="prow"><span class="prow-label">Padding</span><span class="pnum"><input type="number" name="padSec" min="0" max="2" step="0.01" value="${s.padSec}"><em>s</em></span>
          <input type="range" class="sil-range" name="padRange" min="0" max="1" step="0.01" value="${Math.min(1, s.padSec)}"></div>
        <div class="prow"><span class="prow-label">Listen to</span><select class="pselect" name="source">
          <option value="all">All audible audio tracks</option>${audioTracks.map((t) => `<option value="${t.id}" ${s.source === t.id ? 'selected' : ''}>${t.name}</option>`).join('')}</select></div>
        <div class="prow"><span class="prow-label">Range</span><select class="pselect" name="range">
          <option value="all">Entire sequence</option>
          ${seq.inPoint != null || seq.outPoint != null ? `<option value="inout" ${s.range === 'inout' ? 'selected' : ''}>In to Out</option>` : ''}
          ${App.sel.size ? `<option value="selection" ${s.range === 'selection' ? 'selected' : ''}>Selected clips</option>` : ''}</select></div>
        <p class="sil-summary" data-summary></p>
        <p class="pdialog-note">Silent parts show in red on the timeline. Everything after each cut moves left on all unlocked tracks, so video stays in sync.</p>
      </div>`,
    onMount(api) {
      const f = api.form;
      if (![...f.range.options].some((o) => o.value === s.range)) s.range = 'all';
      f.range.value = s.range;
      f.source.value = [...f.source.options].some((o) => o.value === s.source) ? s.source : 'all';
      const graph = api.el.querySelector('.sil-graph');
      const update = frameThrottle(() => {
        result = Silence.analyze();
        drawSilenceGraph(graph, result, s.threshold);
        const secs = (n) => (n / Model.fps).toFixed(1);
        api.el.querySelector('[data-summary]').innerHTML = result.ranges.length
          ? `<b>${result.ranges.length}</b> silence${result.ranges.length === 1 ? '' : 's'} found · removes <b>${secs(result.removed)}s</b> of ${secs(result.to - result.from)}s (${Math.round((result.removed / Math.max(1, result.to - result.from)) * 100)}%)`
          : 'No silences at these settings. Try a higher threshold or a shorter minimum.';
        Silence.setPreview(result);
      });
      const set = (key, value, from) => {
        s[key] = value;
        const pairs = { threshold: ['threshold', 'thresholdRange'], minSec: ['minSec', 'minRange'], padSec: ['padSec', 'padRange'] }[key];
        if (pairs) for (const n of pairs) if (f[n] !== from) f[n].value = value;
        update();
      };
      f.threshold.addEventListener('input', (e) => { const v = +e.target.value; if (!Number.isNaN(v)) set('threshold', clamp(v, -80, -6), e.target); });
      f.thresholdRange.addEventListener('input', (e) => set('threshold', +e.target.value, e.target));
      f.minSec.addEventListener('input', (e) => { const v = +e.target.value; if (v > 0) set('minSec', clamp(v, 0.1, 10), e.target); });
      f.minRange.addEventListener('input', (e) => set('minSec', +e.target.value, e.target));
      f.padSec.addEventListener('input', (e) => { const v = +e.target.value; if (v >= 0) set('padSec', clamp(v, 0, 2), e.target); });
      f.padRange.addEventListener('input', (e) => set('padSec', +e.target.value, e.target));
      f.source.addEventListener('change', () => set('source', f.source.value));
      f.range.addEventListener('change', () => set('range', f.range.value));
      api.el.querySelectorAll('[data-step]').forEach((b) => b.addEventListener('click', () => set('threshold', clamp(s.threshold + +b.dataset.step, -80, -6))));
      // Drag on the graph to move the threshold line.
      graph.addEventListener('pointerdown', (e) => {
        graph.setPointerCapture(e.pointerId);
        const move = (ev) => {
          const r = graph.getBoundingClientRect();
          const db = Math.round(GRAPH_TOP - ((ev.clientY - r.top) / r.height) * (GRAPH_TOP - GRAPH_BOTTOM));
          set('threshold', clamp(db, -80, -6));
        };
        move(e);
        graph.addEventListener('pointermove', move);
        graph.addEventListener('pointerup', () => graph.removeEventListener('pointermove', move), { once: true });
      });
      update();
    },
    onOk() {
      Silence.setPreview(null);
      Silence.apply(result?.ranges || []);
    },
    onCancel() { Silence.setPreview(null); },
  });
}

const GRAPH_TOP = 0;
const GRAPH_BOTTOM = -80;

function drawSilenceGraph(cv, result, threshold) {
  const x = ctxOf(cv);
  const W = cv.width, H = cv.height;
  x.fillStyle = '#121212';
  x.fillRect(0, 0, W, H);
  const yOf = (db) => ((GRAPH_TOP - clamp(db, GRAPH_BOTTOM, GRAPH_TOP)) / (GRAPH_TOP - GRAPH_BOTTOM)) * H;
  x.strokeStyle = 'rgba(255,255,255,.07)';
  x.fillStyle = 'rgba(255,255,255,.3)';
  x.font = '9px Inter, sans-serif';
  for (const db of [-12, -24, -36, -48, -60, -72]) {
    x.beginPath(); x.moveTo(0, yOf(db) + 0.5); x.lineTo(W, yOf(db) + 0.5); x.stroke();
    x.fillText(`${db}`, 2, yOf(db) - 2);
  }
  const n = result.levels.length;
  if (!n) return;
  const xOf = (i) => (i / n) * W;
  x.fillStyle = 'rgba(230,60,60,.28)';
  for (const [a, b] of result.ranges) x.fillRect(xOf(a - result.from), 0, Math.max(1, xOf(b - a)), H);
  x.fillStyle = '#31bba2';
  for (let px = 0; px < W; px++) {
    const i0 = Math.floor((px / W) * n), i1 = Math.max(i0 + 1, Math.floor(((px + 1) / W) * n));
    let m = -Infinity;
    for (let i = i0; i < i1 && i < n; i++) m = Math.max(m, result.levels[i]);
    const y = yOf(m);
    x.fillRect(px, y, 1, H - y);
  }
  const ty = Math.round(yOf(threshold)) + 0.5;
  x.strokeStyle = '#f5d33b';
  x.lineWidth = 1.5;
  x.beginPath(); x.moveTo(0, ty); x.lineTo(W, ty); x.stroke();
  x.fillStyle = '#f5d33b';
  x.font = '600 10px Inter, sans-serif';
  x.fillText(`${threshold} dB`, W - 44, ty - 4);
}
