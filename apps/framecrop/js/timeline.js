// Timeline panel: track headers, ruler, clips and Premiere-style editing tools.

const TL_HEADER_W = 168;
const TL_RULER_H = 28;
const TL_TRACK_H = { video: 46, audio: 46 };
const TL_SEP = 6;
const EDGE_PX = 7;
const SNAP_PX = 9;

const TOOLS = [
  ['select', 'Selection Tool', 'V', 'tSelect'],
  ['track', 'Track Select Forward Tool', 'A', 'tTrack'],
  ['ripple', 'Ripple Edit Tool', 'B', 'tRipple'],
  ['rolling', 'Rolling Edit Tool', 'N', 'tRolling'],
  ['rate', 'Rate Stretch Tool', 'R', 'tRate'],
  ['razor', 'Razor Tool', 'C', 'tRazor'],
  ['slip', 'Slip Tool', 'Y', 'tSlip'],
  ['slide', 'Slide Tool', 'U', 'tSlide'],
  ['hand', 'Hand Tool', 'H', 'tHand'],
  ['zoom', 'Zoom Tool', 'Z', 'tZoom'],
  ['type', 'Type Tool', 'T', 'tType'],
];

const CLIP_COLORS = { video: 'v', image: 'i', audio: 'a', title: 't', color: 'm', adjustment: 'j' };

const Timeline = {
  el: null,
  ppf: 3,
  rows: [],
  drag: null,

  mount(el) {
    this.el = el;
    el.innerHTML = `
      <div class="tl">
        <div class="tl-bar">
          <input class="tl-tc" id="tl-tc" spellcheck="false" aria-label="Playhead timecode">
          <button class="tl-btn" data-tl="snap" title="Snap in Timeline (S)">${icon('magnet', 15)}</button>
          <button class="tl-btn" data-tl="linked" title="Linked Selection">${icon('link', 15)}</button>
          <button class="tl-btn" data-tl="marker" title="Add Marker (M)">${icon('marker', 15)}</button>
          <button class="tl-btn" data-tl="silence" title="Remove Silence…">${icon('wave', 15)}</button>
          <span class="tl-seqname" id="tl-seqname"></span>
          <span class="tl-spacer"></span>
          <button class="tl-btn" data-tl="zoom-out" title="Zoom Out (-)">${icon('minus', 14)}</button>
          <input type="range" class="tl-zoom" id="tl-zoom" min="0" max="100" step="1" aria-label="Timeline zoom">
          <button class="tl-btn" data-tl="zoom-in" title="Zoom In (=)">${icon('plus', 14)}</button>
        </div>
        <div class="tl-grid">
          <div class="tl-corner"><button class="tl-btn" data-tl="add-video" title="Add video track">V+</button><button class="tl-btn" data-tl="add-audio" title="Add audio track">A+</button></div>
          <canvas class="tl-ruler" id="tl-ruler"></canvas>
          <div class="tl-headers" id="tl-headers"><div class="tl-headers-inner" id="tl-headers-inner"></div></div>
          <div class="tl-lanes" id="tl-lanes"><div class="tl-canvas" id="tl-canvas"></div></div>
        </div>
      </div>`;
    this.lanes = el.querySelector('#tl-lanes');
    this.canvas = el.querySelector('#tl-canvas');
    this.ruler = el.querySelector('#tl-ruler');
    this.headers = el.querySelector('#tl-headers-inner');
    this.tcInput = el.querySelector('#tl-tc');
    this.zoomInput = el.querySelector('#tl-zoom');

    this.lanes.addEventListener('scroll', () => {
      this.headers.style.transform = `translateY(${-this.lanes.scrollTop}px)`;
      this.drawRuler();
    });
    this.lanes.addEventListener('wheel', (e) => {
      if (e.altKey || e.ctrlKey) {
        e.preventDefault();
        this.zoomAt(this.ppf * Math.exp(-e.deltaY * 0.002), e.clientX);
      } else if (!e.shiftKey && Math.abs(e.deltaY) > Math.abs(e.deltaX) && !e.target.closest('.tl-canvas')) {
        // plain wheel over empty lanes scrolls tracks vertically (default)
      }
    }, { passive: false });
    this.canvas.addEventListener('pointerdown', (e) => this.down(e));
    this.canvas.addEventListener('pointermove', (e) => { if (!this.drag) this.hover(e); });
    this.canvas.addEventListener('dblclick', (e) => {
      const hit = this.hit(e);
      if (hit.clip && hit.clip.mediaId) Source.open(Model.media(hit.clip.mediaId), hit.clip);
    });
    this.canvas.addEventListener('contextmenu', (e) => this.context(e));
    this.ruler.addEventListener('pointerdown', (e) => this.scrub(e));
    this.tcInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        const f = parseTC(this.tcInput.value);
        if (f != null) Player.seek(f);
        this.tcInput.blur();
      }
      if (e.key === 'Escape') this.tcInput.blur();
    });
    this.tcInput.addEventListener('blur', () => this.updatePlayhead());
    el.querySelectorAll('[data-tl]').forEach((b) => b.addEventListener('click', () => {
      const a = b.dataset.tl;
      if (a === 'snap') App.toggle('snap');
      if (a === 'linked') App.toggle('linked');
      if (a === 'marker') Edit.addMarker();
      if (a === 'silence') removeSilenceDialog();
      if (a === 'zoom-in') this.zoomAt(this.ppf * 1.5);
      if (a === 'zoom-out') this.zoomAt(this.ppf / 1.5);
      if (a === 'add-video') Edit.addTrack('video');
      if (a === 'add-audio') Edit.addTrack('audio');
    }));
    this.zoomInput.addEventListener('input', () => this.zoomAt(this.sliderToPpf(+this.zoomInput.value)));
    this.setupDrop();
    new ResizeObserver(() => { this.render(); }).observe(this.lanes);
    Bus.on('project', () => this.render());
    Bus.on('selection', () => this.render());
    Bus.on('playhead', () => this.updatePlayhead());
    Bus.on('flags', () => this.renderBar());
    Bus.on('media', () => this.render());
    this.render();
  },

  // ---------- Geometry ----------
  sliderToPpf(v) { return 0.05 * Math.pow(400, v / 100); },
  ppfToSlider(p) { return (Math.log(p / 0.05) / Math.log(400)) * 100; },

  x(frame) { return frame * this.ppf; },
  frameAt(clientX) {
    const r = this.lanes.getBoundingClientRect();
    return Math.max(0, Math.round((clientX - r.left + this.lanes.scrollLeft) / this.ppf));
  },

  rowAt(clientY) {
    const r = this.canvas.getBoundingClientRect();
    const y = clientY - r.top;
    return this.rows.find((row) => y >= row.top && y < row.top + row.h) || null;
  },

  zoomAt(ppf, clientX) {
    const r = this.lanes.getBoundingClientRect();
    const anchorX = clientX != null ? clientX - r.left : this.x(Model.seq.playhead) - this.lanes.scrollLeft;
    const anchorFrame = (anchorX + this.lanes.scrollLeft) / this.ppf;
    this.ppf = clamp(ppf, 0.05, 20);
    this.render();
    this.lanes.scrollLeft = Math.max(0, anchorFrame * this.ppf - anchorX);
    this.drawRuler();
  },

  zoomToFit() {
    const d = Math.max(Model.duration(), Model.fps * 10);
    this.ppf = clamp((this.lanes.clientWidth - 40) / d, 0.05, 20);
    this.render();
    this.lanes.scrollLeft = 0;
  },

  // ---------- Rendering ----------
  render() {
    if (!this.el || !Model.data) return;
    this.renderBar();
    const tracks = Model.displayTracks();
    this.rows = [];
    let y = 0;
    let firstAudio = true;
    for (const t of tracks) {
      if (t.kind === 'audio' && firstAudio) { y += TL_SEP; firstAudio = false; }
      this.rows.push({ track: t, top: y, h: TL_TRACK_H[t.kind] });
      y += TL_TRACK_H[t.kind];
    }
    const width = Math.max(this.lanes.clientWidth, this.x(Model.duration() + Model.fps * 30));
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${y + 40}px`;

    this.headers.innerHTML = this.rows.map(({ track: t, top, h }) => `
      <div class="tl-head ${t.kind}${t.target ? ' targeted' : ''}" style="top:${top}px;height:${h}px" data-track="${t.id}">
        <button class="th-target" data-th="target" title="Toggle track targeting">${t.name}</button>
        <button class="th-btn${t.locked ? ' on' : ''}" data-th="lock" title="Toggle track lock">${icon(t.locked ? 'lock' : 'unlock', 13)}</button>
        ${t.kind === 'video'
          ? `<button class="th-btn${t.hidden ? ' off' : ''}" data-th="hide" title="Toggle track output">${icon(t.hidden ? 'eyeOff' : 'eye', 14)}</button>`
          : `<button class="th-btn th-m${t.muted ? ' on' : ''}" data-th="mute" title="Mute track">M</button>
             <button class="th-btn th-s${t.solo ? ' on' : ''}" data-th="solo" title="Solo track">S</button>`}
        <span class="th-name">${t.kind === 'video' ? 'Video' : 'Audio'} ${t.name.slice(1)}${t.channels === 'mono' ? ' <em class="th-mono">Mono</em>' : ''}</span>
      </div>`).join('') + `<div class="tl-head-sep" style="top:${this.rows.find((r) => r.track.kind === 'audio')?.top - TL_SEP}px"></div>`;
    this.headers.querySelectorAll('[data-th]').forEach((b) => b.addEventListener('click', () => this.headerAction(b.closest('.tl-head').dataset.track, b.dataset.th)));
    this.headers.querySelectorAll('.tl-head').forEach((h) => h.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const t = Model.track(h.dataset.track);
      const other = t.kind === 'video' ? 'audio' : 'video';
      Menus.open([
        { label: `Add ${t.kind === 'video' ? 'Video' : 'Audio'} Track Above`, run: () => Edit.insertTrack(t, 'above') },
        { label: `Add ${t.kind === 'video' ? 'Video' : 'Audio'} Track Below`, run: () => Edit.insertTrack(t, 'below') },
        { label: `Add ${other === 'video' ? 'Video' : 'Audio'} Track`, run: () => Edit.addTrack(other) },
        ...(t.kind === 'audio' ? [
          { sep: true },
          { label: 'Stereo', checked: t.channels !== 'mono', run: () => Edit.setChannels(t, 'stereo') },
          { label: 'Mono', checked: t.channels === 'mono', run: () => Edit.setChannels(t, 'mono') },
        ] : []),
        { sep: true },
        { label: t.locked ? 'Unlock Track' : 'Lock Track', run: () => this.headerAction(t.id, 'lock') },
        { label: `Delete ${t.name}`, run: () => Edit.deleteTrack(t) },
      ], e.clientX, e.clientY);
    }));

    const parts = [];
    for (const { track: t, top, h } of this.rows) {
      parts.push(`<div class="tl-row ${t.kind}${t.locked ? ' locked' : ''}" style="top:${top}px;height:${h}px"></div>`);
      for (const c of Model.clipsOn(t.id)) parts.push(this.clipHTML(c, top, h));
      for (const c of Model.clipsOn(t.id)) parts.push(this.transHTML(c, top, h));
    }
    const seq = Model.seq;
    if (seq.inPoint != null || seq.outPoint != null) {
      const a = this.x(seq.inPoint ?? 0), b = this.x(seq.outPoint ?? Model.duration());
      parts.push(`<div class="tl-range" style="left:${a}px;width:${Math.max(0, b - a)}px"></div>`);
    }
    parts.push('<div class="tl-snap" id="tl-snap" hidden></div><div class="tl-marquee" id="tl-marquee" hidden></div><div class="tl-ghost" id="tl-ghost" hidden></div>');
    parts.push(`<div class="tl-playhead" id="tl-playhead"></div>`);
    this.canvas.innerHTML = parts.join('');
    this.drawSilence();
    this.drawWaves();
    this.updatePlayhead();
    this.drawRuler();
  },

  // Red bands over the parts Remove Silence would cut (while its dialog is open).
  drawSilence() {
    if (!this.canvas) return;
    let layer = this.canvas.querySelector('#tl-silence');
    if (!layer) {
      layer = document.createElement('div');
      layer.id = 'tl-silence';
      this.canvas.append(layer);
    }
    layer.innerHTML = (App.silencePreview || []).map(([a, b]) => `<div class="tl-sil" style="left:${this.x(a)}px;width:${Math.max(1, this.x(b - a))}px"></div>`).join('');
  },

  renderBar() {
    if (!this.el) return;
    this.el.querySelector('[data-tl="snap"]').classList.toggle('on', App.snap);
    this.el.querySelector('[data-tl="linked"]').classList.toggle('on', App.linked);
    this.el.querySelector('#tl-seqname').textContent = `${Model.seq.name} · ${Model.seq.width}×${Model.seq.height} · ${Model.fps} fps`;
    this.zoomInput.value = this.ppfToSlider(this.ppf);
  },

  clipHTML(c, top, h) {
    const m = c.mediaId && Model.media(c.mediaId);
    const sel = App.sel.has(c.id);
    const offline = m && !Media.isOnline(m.id);
    const x = this.x(c.start), w = Math.max(2, this.x(c.duration));
    const rt = m && MediaRT.get(m.id);
    const fx = c.kind !== 'audio' && (c.effects.length || c.grade.nodes.some((n) => !nodeIsNeutral(n)) || c.motion.scale !== 100 || c.motion.x || c.motion.y || c.motion.rotation || c.opacity !== 100);
    const animated = Object.values(c.keys).some((k) => k.length);
    const name = c.kind === 'title' ? c.title.text.split('\n')[0] : c.name;
    const speed = c.speed !== 1 ? ` [${Math.round(c.speed * 100)}%]` : '';
    return `<div class="clip c-${CLIP_COLORS[c.kind]}${sel ? ' sel' : ''}${c.enabled ? '' : ' disabled'}${offline ? ' offline' : ''}" data-id="${c.id}"
        style="left:${x}px;top:${top + 2}px;width:${w}px;height:${h - 4}px" title="${esc(name)}">
      ${c.kind === 'video' && rt?.thumb && w > 40 ? `<span class="clip-thumb" style="background-image:url(${rt.thumb})"></span>` : ''}
      ${c.kind === 'audio' ? `<canvas class="clip-wave" data-wave="${c.id}"></canvas>` : ''}
      <span class="clip-label">${fx ? `<span class="clip-fx${animated ? ' anim' : ''}">fx</span>` : ''}${c.linkId ? '' : c.kind === 'video' && m?.hasAudio ? '' : ''}${esc(name)}${speed}${offline ? ' — offline' : ''}</span>
    </div>`;
  },

  transHTML(c, top, h) {
    const out = [];
    const clips = Model.clipsOn(c.trackId);
    const i = clips.indexOf(c);
    const prev = clips[i - 1] && Model.end(clips[i - 1]) === c.start;
    const next = clips[i + 1] && clips[i + 1].start === Model.end(c);
    const label = (t) => (TRANSITIONS[t.type] || AUDIO_TRANSITIONS[t.type])?.name || t.type;
    const sel = (side) => (App.selTrans?.clipId === c.id && App.selTrans.side === side ? ' sel' : '');
    if (c.transIn) {
      const d = c.transIn.duration;
      const start = prev ? c.start - Math.round(d / 2) : c.start;
      out.push(`<div class="trans${sel('in')}" data-trans="${c.id}" data-side="in" style="left:${this.x(start)}px;width:${Math.max(6, this.x(d))}px;top:${top + 2}px;height:${(h - 4) / 2}px" title="${esc(label(c.transIn))}">${esc(label(c.transIn))}</div>`);
    }
    if (c.transOut && !next) {
      const d = c.transOut.duration;
      out.push(`<div class="trans${sel('out')}" data-trans="${c.id}" data-side="out" style="left:${this.x(Model.end(c) - d)}px;width:${Math.max(6, this.x(d))}px;top:${top + 2}px;height:${(h - 4) / 2}px" title="${esc(label(c.transOut))}">${esc(label(c.transOut))}</div>`);
    }
    return out.join('');
  },

  drawWaves() {
    this.canvas.querySelectorAll('[data-wave]').forEach((cv) => {
      const c = Model.clip(cv.dataset.wave);
      const peaks = MediaRT.get(c?.mediaId)?.peaks;
      const w = Math.min(4096, Math.max(1, Math.round(this.x(c.duration))));
      const h = TL_TRACK_H.audio - 18;
      cv.width = w;
      cv.height = h;
      if (!peaks) return;
      const x = ctxOf(cv);
      x.fillStyle = 'rgba(0,0,0,.45)';
      const vol = dbToGain(c.volume);
      const secPerPx = (c.duration / Model.fps / w) * c.speed;
      for (let px = 0; px < w; px++) {
        const t0 = c.offset + px * secPerPx;
        const i0 = Math.floor(t0 * PEAKS_PER_SEC), i1 = Math.max(i0 + 1, Math.floor((t0 + secPerPx) * PEAKS_PER_SEC));
        let m = 0;
        for (let i = i0; i < i1 && i < peaks.length; i++) m = Math.max(m, peaks[i]);
        const v = Math.min(1, m * vol) * (h / 2 - 1);
        x.fillRect(px, h / 2 - v, 1, v * 2 || 1);
      }
    });
  },

  updatePlayhead() {
    if (!this.el) return;
    const f = Model.seq.playhead;
    const ph = this.canvas.querySelector('#tl-playhead');
    if (ph) ph.style.left = `${this.x(f)}px`;
    if (document.activeElement !== this.tcInput) this.tcInput.value = tc(f);
    // Page-scroll to follow the playhead during playback.
    if (Player.playing) {
      const x = this.x(f) - this.lanes.scrollLeft;
      if (x > this.lanes.clientWidth - 20 || x < 0) this.lanes.scrollLeft = this.x(f) - 40;
    }
    this.drawRuler();
  },

  drawRuler() {
    const cv = this.ruler;
    if (!cv) return;
    const dpr = devicePixelRatio || 1;
    const w = cv.clientWidth, h = TL_RULER_H;
    if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    const x = ctxOf(cv);
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    const css = getComputedStyle(document.body);
    x.fillStyle = css.getPropertyValue('--ruler');
    x.fillRect(0, 0, w, h);
    const sx = this.lanes.scrollLeft;
    const fps = Math.round(Model.fps);
    const steps = [1, 2, 5, 10, fps / 2, fps, fps * 2, fps * 5, fps * 10, fps * 30, fps * 60, fps * 120, fps * 300, fps * 600];
    const step = steps.find((s) => s * this.ppf >= 90) || steps[steps.length - 1];
    const minor = step >= fps ? step / 5 : Math.max(1, step / 2);
    const seq = Model.seq;
    if (seq.inPoint != null || seq.outPoint != null) {
      const a = this.x(seq.inPoint ?? 0) - sx, b = this.x(seq.outPoint ?? Model.duration()) - sx;
      x.fillStyle = 'rgba(90,140,230,.35)';
      x.fillRect(a, h - 8, b - a, 8);
    }
    x.strokeStyle = css.getPropertyValue('--ruler-tick');
    x.fillStyle = css.getPropertyValue('--text-2');
    x.font = '10px Inter, sans-serif';
    x.beginPath();
    const first = Math.floor(sx / this.ppf / minor) * minor;
    for (let f = first; this.x(f) - sx < w; f += minor) {
      const px = Math.round(this.x(f) - sx) + 0.5;
      const major = Math.abs(f / step - Math.round(f / step)) < 1e-6;
      x.moveTo(px, h);
      x.lineTo(px, major ? h - 12 : h - 5);
      if (major) x.fillText(tc(f).replace(/^00:/, ''), px + 3, 11);
    }
    x.stroke();
    for (const m of seq.markers) {
      const px = this.x(m.frame) - sx;
      x.fillStyle = m.color;
      x.beginPath();
      x.moveTo(px - 5, 14); x.lineTo(px + 5, 14); x.lineTo(px + 5, 20); x.lineTo(px, 24); x.lineTo(px - 5, 20);
      x.fill();
    }
    const ph = this.x(seq.playhead) - sx;
    x.fillStyle = css.getPropertyValue('--playhead');
    x.beginPath();
    x.moveTo(ph - 6, h - 12); x.lineTo(ph + 6, h - 12); x.lineTo(ph + 6, h - 6); x.lineTo(ph, h); x.lineTo(ph - 6, h - 6);
    x.fill();
  },

  headerAction(trackId, action) {
    const t = Model.track(trackId);
    if (action === 'target') { t.target = !t.target; App.changed({ silent: true }); this.render(); return; }
    History.step({ lock: 'Lock Track', hide: 'Toggle Track Output', mute: 'Mute Track', solo: 'Solo Track' }[action], () => {
      if (action === 'lock') t.locked = !t.locked;
      if (action === 'hide') t.hidden = !t.hidden;
      if (action === 'mute') t.muted = !t.muted;
      if (action === 'solo') t.solo = !t.solo;
    });
  },

  // ---------- Hit testing ----------
  hit(e) {
    const row = this.rowAt(e.clientY);
    const frame = this.frameAt(e.clientX);
    const transEl = e.target.closest('[data-trans]');
    if (transEl) return { row, frame, trans: { clipId: transEl.dataset.trans, side: transEl.dataset.side } };
    const el = e.target.closest('.clip');
    const clip = el && Model.clip(el.dataset.id);
    let edge = null;
    if (clip) {
      const r = el.getBoundingClientRect();
      if (r.width > EDGE_PX * 2.5) {
        if (e.clientX - r.left < EDGE_PX) edge = 'start';
        else if (r.right - e.clientX < EDGE_PX) edge = 'end';
      }
    }
    return { row, frame, clip, edge, el };
  },

  hover(e) {
    const h = this.hit(e);
    const t = App.tool;
    let cursor = 'default';
    if (t === 'razor') cursor = 'crosshair';
    else if (t === 'hand') cursor = 'grab';
    else if (t === 'zoom') cursor = e.altKey ? 'zoom-out' : 'zoom-in';
    else if (t === 'slip' || t === 'slide') cursor = h.clip ? 'ew-resize' : 'default';
    else if (t === 'track') cursor = 'e-resize';
    else if (h.edge && ['select', 'ripple', 'rolling', 'rate'].includes(t)) cursor = t === 'rolling' ? 'col-resize' : 'ew-resize';
    this.canvas.style.cursor = cursor;
  },

  // ---------- Snapping ----------
  snapTargets(exclude) {
    const seq = Model.seq;
    const pts = Ops.editPoints(exclude);
    pts.push(seq.playhead);
    if (seq.inPoint != null) pts.push(seq.inPoint);
    if (seq.outPoint != null) pts.push(seq.outPoint);
    for (const m of seq.markers) pts.push(m.frame);
    return pts;
  },

  // Best shift (in frames) so one of the given frames lands on a snap point.
  snapDelta(frames, exclude, disable) {
    const snapOn = App.snap !== !!disable;
    this.showSnap(null);
    if (!snapOn) return 0;
    const targets = this.snapTargets(exclude);
    const tol = SNAP_PX / this.ppf;
    let best = null;
    for (const f of frames) {
      for (const t of targets) {
        const d = t - f;
        if (Math.abs(d) <= tol && (best == null || Math.abs(d) < Math.abs(best.d))) best = { d, at: t };
      }
    }
    if (!best) return 0;
    this.showSnap(best.at);
    return best.d;
  },

  showSnap(frame) {
    const s = this.canvas.querySelector('#tl-snap');
    if (!s) return;
    s.hidden = frame == null;
    if (frame != null) s.style.left = `${this.x(frame)}px`;
  },

  // ---------- Pointer interactions ----------
  down(e) {
    if (e.button !== 0) return;
    App.focusPanel('timeline');
    const h = this.hit(e);
    const tool = e.button === 1 ? 'hand' : App.tool;
    this.canvas.setPointerCapture(e.pointerId);
    const start = { x: e.clientX, y: e.clientY, frame: h.frame, scrollLeft: this.lanes.scrollLeft, scrollTop: this.lanes.scrollTop };
    const begin = (kind, extra = {}) => {
      History.begin();
      this.drag = { kind, start, h, moved: false, ...extra };
    };

    if (h.trans) {
      App.sel.clear();
      App.selTrans = h.trans;
      Bus.emit('selection');
      return;
    }
    if (tool === 'hand') { this.drag = { kind: 'hand', start }; }
    else if (tool === 'zoom') { this.zoomAt(this.ppf * (e.altKey ? 1 / 1.6 : 1.6), e.clientX); return; }
    else if (tool === 'razor') {
      if (!h.clip || Model.track(h.clip.trackId).locked) return;
      let f = h.frame;
      if (App.snap && Math.abs(this.x(Model.seq.playhead - f)) < SNAP_PX) f = Model.seq.playhead;
      Edit.razor(h.clip, f, e.shiftKey);
      return;
    } else if (tool === 'track') {
      const ids = Model.seq.clips.filter((c) => c.start >= h.frame - 1 && (!e.shiftKey || c.trackId === h.row?.track.id)).map((c) => c.id);
      Edit.select(ids);
      begin('move', { ids: Ops.withPartners(ids, App.linked), origin: this.origins(ids) });
    } else if (!h.clip) {
      if (!e.shiftKey && !e.ctrlKey) Edit.clearSelection();
      this.drag = { kind: 'marquee', start, base: new Set(App.sel) };
    } else if (Model.track(h.clip.trackId).locked) {
      return;
    } else if (tool === 'select' && h.edge) {
      if (!App.sel.has(h.clip.id)) Edit.select([h.clip.id]);
      begin('trim', { clip: h.clip, edge: h.edge, ripple: false, origin: this.origins(this.trimSet(h.clip)) });
    } else if (tool === 'ripple' && h.edge) {
      begin('trim', { clip: h.clip, edge: h.edge, ripple: true, origin: this.origins(Model.seq.clips.map((c) => c.id)) });
    } else if (tool === 'rolling' && h.edge) {
      const clips = Model.clipsOn(h.clip.trackId);
      const i = clips.indexOf(h.clip);
      const left = h.edge === 'end' ? h.clip : clips[i - 1];
      const right = h.edge === 'end' ? clips[i + 1] : h.clip;
      if (!left || !right || Model.end(left) !== right.start) { toast('The Rolling Edit tool works on an edit point between two clips.'); return; }
      begin('rolling', { left, right, origin: this.origins([left.id, right.id, ...Model.partners(left).map((c) => c.id), ...Model.partners(right).map((c) => c.id)]) });
    } else if (tool === 'rate' && h.edge) {
      begin('rate', { clip: h.clip, edge: h.edge, origin: this.origins(this.trimSet(h.clip)) });
    } else if (tool === 'slip') {
      begin('slip', { clip: h.clip, origin: this.origins(this.trimSet(h.clip)) });
    } else if (tool === 'slide') {
      begin('slide', { clip: h.clip, origin: this.origins(Model.seq.clips.map((c) => c.id)) });
    } else {
      if (e.shiftKey || e.ctrlKey) Edit.select([h.clip.id], { toggle: true });
      else if (!App.sel.has(h.clip.id)) Edit.select([h.clip.id]);
      const f = Model.seq.playhead;
      if (App.workspace === 'color' && (f < h.clip.start || f >= Model.end(h.clip))) Player.seek(h.clip.start);
      const ids = [...App.sel];
      begin('move', { ids, origin: this.origins(ids), copy: e.altKey });
    }

    const move = (ev) => this.dragMove(ev);
    const up = (ev) => {
      this.canvas.removeEventListener('pointermove', move);
      this.canvas.removeEventListener('pointerup', up);
      this.canvas.removeEventListener('pointercancel', up);
      this.dragEnd(ev);
    };
    this.canvas.addEventListener('pointermove', move);
    this.canvas.addEventListener('pointerup', up);
    this.canvas.addEventListener('pointercancel', up);
  },

  // Clips trimmed together with c (its linked partners when Linked Selection is on).
  trimSet(c) {
    return App.linked ? [c.id, ...Model.partners(c).map((p) => p.id)] : [c.id];
  },

  origins(ids) {
    return new Map(ids.map((id) => {
      const c = Model.clip(id);
      return [id, { start: c.start, duration: c.duration, offset: c.offset, speed: c.speed, trackId: c.trackId }];
    }));
  },

  restoreOrigins(d) {
    for (const [id, o] of d.origin) {
      const c = Model.clip(id);
      if (c) Object.assign(c, o);
    }
  },

  dragMove(e) {
    const d = this.drag;
    if (!d) return;
    const dxPx = e.clientX - d.start.x;
    if (!d.moved && Math.abs(dxPx) < 3 && Math.abs(e.clientY - d.start.y) < 3) return;
    d.moved = true;
    let df = Math.round(dxPx / this.ppf);

    if (d.kind === 'hand') {
      this.lanes.scrollLeft = d.start.scrollLeft - dxPx;
      this.lanes.scrollTop = d.start.scrollTop - (e.clientY - d.start.y);
      return;
    }
    if (d.kind === 'marquee') { this.marquee(d, e); return; }

    this.restoreOrigins(d);
    const fps = Model.fps;
    if (d.kind === 'move') {
      const clips = d.ids.map((id) => Model.clip(id));
      const minStart = Math.min(...clips.map((c) => c.start));
      df = Math.max(df, -minStart);
      const edges = clips.flatMap((c) => [c.start + df, Model.end(c) + df]);
      df += this.snapDelta(edges, new Set(d.ids), e.shiftKey);
      df = Math.max(df, -minStart);
      // Vertical moves change tracks within the same kind (video ↔ video).
      const row = this.rowAt(e.clientY);
      const startRow = d.h.row;
      let dTrack = 0;
      if (row && startRow && row.track.kind === startRow.track.kind) {
        const list = Model.tracks(row.track.kind);
        dTrack = list.indexOf(row.track) - list.indexOf(startRow.track);
      }
      for (const c of clips) {
        c.start += df;
        if (dTrack && c.kind !== 'audio' === (startRow.track.kind === 'video')) {
          const list = Model.tracks(Model.track(c.trackId).kind);
          const ni = list.indexOf(Model.track(c.trackId)) + dTrack;
          if (ni >= 0 && ni < list.length && !list[ni].locked) c.trackId = list[ni].id;
        }
      }
      d.df = df;
    } else if (d.kind === 'trim') {
      const c = d.clip;
      const set = d.ripple ? [c.id, ...this.trimSet(c).filter((id) => id !== c.id)] : this.trimSet(c);
      const o = d.origin.get(c.id);
      const exclude = new Set(set);
      if (d.edge === 'start') {
        df += this.snapDelta([o.start + df], exclude, e.shiftKey);
        const minDf = Model.isTimed(c) ? -Math.floor((o.offset / o.speed) * fps + 1e-6) : -Infinity;
        const prev = d.ripple ? null : Model.clipsOn(c.trackId).filter((x) => x.id !== c.id && Model.end(x) <= o.start).pop();
        const limitPrev = prev ? Model.end(prev) - o.start : -o.start;
        df = clamp(df, Math.max(minDf, d.ripple ? -Infinity : limitPrev), o.duration - 1);
        for (const id of set) {
          const x = Model.clip(id), ox = d.origin.get(id);
          if (!x || !ox) continue;
          x.offset = ox.offset + (df / fps) * ox.speed;
          x.duration = ox.duration - df;
          x.start = d.ripple ? ox.start : ox.start + df;
        }
        if (d.ripple) this.rippleShift(d, o.start + o.duration, -df, set);
      } else {
        df += this.snapDelta([o.start + o.duration + df], exclude, e.shiftKey);
        const maxDur = Model.maxDuration({ ...c, offset: o.offset, speed: o.speed });
        const next = d.ripple ? null : Model.clipsOn(c.trackId).find((x) => x.id !== c.id && x.start >= o.start + o.duration);
        const limitNext = next ? next.start - (o.start + o.duration) : Infinity;
        df = clamp(df, 1 - o.duration, Math.min(maxDur - o.duration, limitNext));
        for (const id of set) {
          const x = Model.clip(id), ox = d.origin.get(id);
          if (x && ox) x.duration = ox.duration + df;
        }
        if (d.ripple) this.rippleShift(d, o.start + o.duration, df, set);
      }
      d.df = df;
    } else if (d.kind === 'rolling') {
      const { left, right } = d;
      const ol = d.origin.get(left.id), or = d.origin.get(right.id);
      df += this.snapDelta([or.start + df], new Set([left.id, right.id]), e.shiftKey);
      const maxLeft = Model.maxDuration({ ...left, offset: ol.offset }) - ol.duration;
      const minRight = Model.isTimed(right) ? -Math.floor((or.offset / or.speed) * fps + 1e-6) : -Infinity;
      df = clamp(df, Math.max(1 - ol.duration, minRight), Math.min(maxLeft, or.duration - 1));
      const apply = (c, o, isLeft) => {
        if (isLeft) c.duration = o.duration + df;
        else { c.start = o.start + df; c.duration = o.duration - df; c.offset = o.offset + (df / fps) * o.speed; }
      };
      apply(left, ol, true);
      apply(right, or, false);
      if (App.linked) {
        for (const p of Model.partners(left)) if (d.origin.get(p.id)) apply(p, d.origin.get(p.id), true);
        for (const p of Model.partners(right)) if (d.origin.get(p.id)) apply(p, d.origin.get(p.id), false);
      }
      Player.seek(or.start + df);
    } else if (d.kind === 'rate') {
      const c = d.clip;
      const o = d.origin.get(c.id);
      const span = (o.duration / fps) * o.speed;
      const dur = Math.max(1, (d.edge === 'end' ? o.duration + df : o.duration - df));
      const speed = clamp(span / (dur / fps), 0.1, 10);
      for (const id of this.trimSet(c)) {
        const x = Model.clip(id), ox = d.origin.get(id);
        if (!x || !ox) continue;
        x.speed = speed;
        x.duration = Math.round((span / speed) * fps);
        if (d.edge === 'start') x.start = ox.start + ox.duration - x.duration;
      }
    } else if (d.kind === 'slip') {
      for (const id of this.trimSet(d.clip)) {
        const x = Model.clip(id), ox = d.origin.get(id);
        if (!x || !ox) continue;
        const m = Model.media(x.mediaId);
        const span = (ox.duration / fps) * ox.speed;
        const maxOff = m && m.kind !== 'image' ? Math.max(0, m.duration - span) : Infinity;
        x.offset = clamp(ox.offset - (df / fps) * ox.speed, 0, maxOff);
      }
      Player.seek(d.clip.start);
    } else if (d.kind === 'slide') {
      const c = d.clip;
      const o = d.origin.get(c.id);
      const clips = Model.clipsOn(c.trackId);
      const prev = clips.filter((x) => x.id !== c.id && Model.end(x) <= o.start).pop();
      const next = clips.find((x) => x.id !== c.id && x.start >= o.start + o.duration);
      const prevAdj = prev && Model.end(prev) === o.start ? prev : null;
      const nextAdj = next && next.start === o.start + o.duration ? next : null;
      let lo = -o.start, hi = Infinity;
      if (prevAdj) lo = Math.max(lo, 1 - d.origin.get(prevAdj.id).duration);
      else if (prev) lo = Math.max(lo, Model.end(prev) - o.start);
      if (nextAdj) {
        const on = d.origin.get(nextAdj.id);
        hi = Math.min(hi, on.duration - 1);
        if (Model.isTimed(nextAdj)) lo = Math.max(lo, -Math.floor((on.offset / on.speed) * fps + 1e-6));
      } else if (next) hi = Math.min(hi, next.start - (o.start + o.duration));
      if (prevAdj) hi = Math.min(hi, Model.maxDuration({ ...prevAdj, offset: d.origin.get(prevAdj.id).offset }) - d.origin.get(prevAdj.id).duration);
      df = clamp(df, lo, hi);
      c.start = o.start + df;
      for (const p of Model.partners(c)) { const op = d.origin.get(p.id); if (op) p.start = op.start + df; }
      if (prevAdj) prevAdj.duration = d.origin.get(prevAdj.id).duration + df;
      if (nextAdj) {
        const on = d.origin.get(nextAdj.id);
        nextAdj.start = on.start + df;
        nextAdj.duration = on.duration - df;
        nextAdj.offset = on.offset + (df / fps) * on.speed;
      }
    }
    this.renderSoon();
    App.invalidate();
  },

  // Ripple trims move everything after the edit point on all unlocked tracks.
  rippleShift(d, from, delta, skip) {
    for (const [id, o] of d.origin) {
      if (skip.includes(id)) continue;
      const c = Model.clip(id);
      if (c && o.start >= from && !Model.track(c.trackId).locked) c.start = o.start + delta;
    }
  },

  dragEnd(e) {
    const d = this.drag;
    this.drag = null;
    this.showSnap(null);
    if (!d) return;
    if (d.kind === 'hand') return;
    if (d.kind === 'marquee') { this.canvas.querySelector('#tl-marquee').hidden = true; return; }
    if (!d.moved) { History.pendingBefore = null; return; }
    if (d.kind === 'move') {
      const clips = d.ids.map((id) => Model.clip(id));
      if (d.copy) {
        // Alt-drag: originals go back, copies land where we dropped.
        const links = new Map();
        const copies = clips.map((c) => {
          const copy = structuredClone(c);
          copy.id = uid();
          if (c.linkId) { if (!links.has(c.linkId)) links.set(c.linkId, uid()); copy.linkId = links.get(c.linkId); }
          return copy;
        });
        this.restoreOrigins(d);
        Model.seq.clips.push(...copies);
        Ops.overwrite(copies);
        History.commit('Duplicate');
        Edit.select(copies.map((c) => c.id));
        return;
      }
      Ops.overwrite(clips);
    }
    const names = { move: 'Move', trim: d.ripple ? 'Ripple Edit' : 'Trim', rolling: 'Rolling Edit', rate: 'Rate Stretch', slip: 'Slip', slide: 'Slide' };
    History.commit(names[d.kind]);
  },

  marquee(d, e) {
    const r = this.canvas.getBoundingClientRect();
    const x0 = Math.min(d.start.x, e.clientX) - r.left, x1 = Math.max(d.start.x, e.clientX) - r.left;
    const y0 = Math.min(d.start.y, e.clientY) - r.top, y1 = Math.max(d.start.y, e.clientY) - r.top;
    const box = this.canvas.querySelector('#tl-marquee');
    Object.assign(box.style, { left: `${x0}px`, top: `${y0}px`, width: `${x1 - x0}px`, height: `${y1 - y0}px` });
    box.hidden = false;
    const ids = [];
    for (const row of this.rows) {
      if (row.top + row.h < y0 || row.top > y1) continue;
      for (const c of Model.clipsOn(row.track.id)) {
        if (this.x(Model.end(c)) >= x0 && this.x(c.start) <= x1) ids.push(c.id);
      }
    }
    App.sel = new Set([...d.base, ...Ops.withPartners(ids, App.linked)]);
    this.renderSoon();
  },

  renderSoon() {
    if (this.frameReq) return;
    this.frameReq = requestAnimationFrame(() => {
      this.frameReq = 0;
      const marquee = this.canvas.querySelector('#tl-marquee');
      const box = marquee && !marquee.hidden ? marquee.getAttribute('style') : null;
      this.render();
      if (box) { const m = this.canvas.querySelector('#tl-marquee'); m.setAttribute('style', box); m.hidden = false; }
      Bus.emit('selection-soft');
    });
  },

  scrub(e) {
    this.ruler.setPointerCapture(e.pointerId);
    const seekTo = (ev) => {
      const r = this.ruler.getBoundingClientRect();
      let f = Math.max(0, Math.round((ev.clientX - r.left + this.lanes.scrollLeft) / this.ppf));
      if (App.snap && ev.shiftKey) {
        const pts = this.snapTargets(new Set());
        const near = pts.find((p) => Math.abs(this.x(p - f)) < SNAP_PX);
        if (near != null) f = near;
      }
      Player.seek(f);
    };
    seekTo(e);
    const move = (ev) => seekTo(ev);
    this.ruler.addEventListener('pointermove', move);
    this.ruler.addEventListener('pointerup', () => this.ruler.removeEventListener('pointermove', move), { once: true });
  },

  context(e) {
    e.preventDefault();
    const h = this.hit(e);
    if (h.clip && !App.sel.has(h.clip.id)) Edit.select([h.clip.id]);
    const items = h.clip ? [
      { label: 'Cut', shortcut: 'Ctrl+X', run: () => Edit.copy(true) },
      { label: 'Copy', shortcut: 'Ctrl+C', run: () => Edit.copy() },
      { label: 'Paste Attributes…', shortcut: 'Ctrl+Alt+V', run: () => Edit.pasteAttributes() },
      { sep: true },
      { label: h.clip.enabled ? 'Disable' : 'Enable', shortcut: 'Shift+E', run: () => Edit.toggleEnabled() },
      { label: h.clip.linkId ? 'Unlink' : 'Link', shortcut: 'Ctrl+L', run: () => Edit.toggleLink() },
      { sep: true },
      { label: 'Speed/Duration…', shortcut: 'Ctrl+R', run: () => speedDialog() },
      { label: 'Scale to Frame Size', checked: h.clip.motion?.fit, disabled: h.clip.kind === 'audio', run: () => History.step('Scale to Frame Size', () => { h.clip.motion.fit = !h.clip.motion.fit; }) },
      { sep: true },
      { label: 'Ripple Delete', shortcut: 'Shift+Delete', run: () => Edit.deleteSelection(true) },
      { label: 'Clear', shortcut: 'Delete', run: () => Edit.deleteSelection(false) },
    ] : [
      { label: 'Ripple Delete gap', disabled: !h.row, run: () => this.rippleDeleteGap(h) },
      { label: 'Paste', shortcut: 'Ctrl+V', run: () => Edit.paste() },
    ];
    Menus.open([quickToolsItem(), { sep: true }, ...items], e.clientX, e.clientY);
  },

  rippleDeleteGap(h) {
    const clips = Model.clipsOn(h.row.track.id);
    const prev = clips.filter((c) => Model.end(c) <= h.frame).pop();
    const next = clips.find((c) => c.start > h.frame);
    if (!next) return;
    const from = prev ? Model.end(prev) : 0;
    History.step('Ripple Delete', () => { Ops.closeGap(h.row.track.id, from, next.start); });
  },

  // ---------- Drag & drop from the Project panel, Effects panel or the OS ----------
  setupDrop() {
    const ghost = () => this.canvas.querySelector('#tl-ghost');
    this.lanes.addEventListener('dragover', (e) => {
      const types = [...e.dataTransfer.types];
      if (!types.some((t) => t === 'text/x-fc-media' || t === 'text/x-fc-effect' || t === 'Files')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      const row = this.rowAt(e.clientY);
      const g = ghost();
      if (!row || !g) return;
      const f = this.frameAt(e.clientX);
      const len = App.dragMedia ? Math.round((App.dragMedia.kind === 'image' ? DEFAULT_STILL_SECONDS : App.dragMedia.duration) * Model.fps) : Model.fps * 2;
      if (types.includes('text/x-fc-effect')) { g.hidden = true; return; }
      Object.assign(g.style, { left: `${this.x(f)}px`, top: `${row.top + 2}px`, width: `${this.x(len)}px`, height: `${row.h - 4}px` });
      g.hidden = false;
    });
    this.lanes.addEventListener('dragleave', (e) => { if (!this.lanes.contains(e.relatedTarget)) { const g = ghost(); if (g) g.hidden = true; } });
    this.lanes.addEventListener('drop', async (e) => {
      e.preventDefault();
      const g = ghost();
      if (g) g.hidden = true;
      const row = this.rowAt(e.clientY);
      const frame = this.frameAt(e.clientX);
      const fx = e.dataTransfer.getData('text/x-fc-effect');
      if (fx) { this.dropEffect(fx, e); return; }
      let items = [];
      const mediaId = e.dataTransfer.getData('text/x-fc-media');
      if (mediaId) items = [Model.media(mediaId)];
      else if (e.dataTransfer.files.length) items = await Media.importFiles([...e.dataTransfer.files]);
      let f = frame;
      for (const item of items.filter(Boolean)) {
        const placed = Edit.placeMedia(item, { track: row?.track, frame: f, insert: e.ctrlKey || e.metaKey });
        if (placed.length) f = Model.end(placed[0]);
      }
    });
  },

  dropEffect(data, e) {
    const [kind, type] = data.split(':');
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('.clip');
    const clip = el && Model.clip(el.dataset.id);
    if (!clip) { toast('Drop effects and transitions onto a clip.'); return; }
    if (kind === 'effect') {
      if (clip.kind === 'audio') { toast('Video effects go on video clips.'); return; }
      History.step(`Apply ${EFFECTS[type].name}`, () => { clip.effects.push(newEffect(type)); });
      Edit.select([clip.id]);
    } else if (kind === 'look') {
      if (clip.kind === 'audio') return;
      History.step(`Apply ${LOOKS[type].name}`, () => { applyLook(clip, type); });
      Edit.select([clip.id]);
    } else if (kind === 'transition' || kind === 'atransition') {
      const isAudio = kind === 'atransition';
      if (isAudio !== (clip.kind === 'audio')) { toast(isAudio ? 'Audio transitions go on audio clips.' : 'Video transitions go on video clips.'); return; }
      const r = el.getBoundingClientRect();
      const side = e.clientX - r.left < r.width / 2 ? 'in' : 'out';
      History.step(`Apply ${(TRANSITIONS[type] || AUDIO_TRANSITIONS[type]).name}`, () => { Edit.setTransition(clip, side, type); });
    }
  },
};

// Row of tool buttons for right-click menus.
function quickToolsItem() {
  return { tools: TOOLS.map(([id, name, key, ic]) => ({ icon: ic, label: `${name} (${key})`, active: App.tool === id, run: () => App.setTool(id) })) };
}

function applyLook(clip, id) {
  const node = { ...newGradeNode(clip.grade.nodes.length + 1), ...structuredClone(LOOKS[id].node) };
  for (const k of ['lift', 'gamma', 'gain', 'offset']) node[k] ||= [0, 0, 0, 0];
  clip.grade.nodes.push(node);
}
