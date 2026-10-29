// Panels: Project, Source, Program, Effect Controls, Effects, Audio Track Mixer,
// Audio Meters, Graphics, History, Markers and the Tools strip.

const Panels = {};

function definePanel(id, title, impl) {
  const el = document.createElement('div');
  el.className = `panel panel-${id}`;
  el.dataset.panel = id;
  Panels[id] = { id, title, el, ...impl };
}

function mountPanels() {
  for (const p of Object.values(Panels)) {
    p.mount?.(p.el);
    p.el.addEventListener('pointerdown', () => App.focusPanel(p.id), true);
  }
}

const fmtDur = (sec) => (Number.isFinite(sec) ? tc(Math.round(sec * Model.fps)) : '—');

// ---------- Project panel ----------
definePanel('project', 'Project', {
  view: 'list',
  query: '',
  selected: null,
  mount(el) {
    el.innerHTML = `
      <div class="pp-bar">
        <span class="pp-search">${icon('search', 13)}<input placeholder="Search" aria-label="Search media"></span>
        <button class="ic-btn" data-pp="list" title="List view">${icon('list', 15)}</button>
        <button class="ic-btn" data-pp="grid" title="Icon view">${icon('grid', 15)}</button>
      </div>
      <div class="pp-body" tabindex="0"></div>
      <div class="pp-foot">
        <span class="pp-count"></span>
        <span class="tl-spacer"></span>
        <button class="ic-btn" data-pp="import" title="Import media (Ctrl+I)">${icon('importIcon', 15)}</button>
        <button class="ic-btn" data-pp="new" title="New item">${icon('plusSquare', 15)}</button>
        <button class="ic-btn" data-pp="delete" title="Clear (Delete)">${icon('trash', 15)}</button>
      </div>`;
    this.body = el.querySelector('.pp-body');
    el.querySelector('input').addEventListener('input', (e) => { this.query = e.target.value.toLowerCase(); this.render(); });
    el.querySelectorAll('[data-pp]').forEach((b) => b.addEventListener('click', (e) => {
      const a = b.dataset.pp;
      if (a === 'list' || a === 'grid') { this.view = a; this.render(); }
      if (a === 'import') App.importDialog();
      if (a === 'delete' && this.selected) this.remove(this.selected);
      if (a === 'new') {
        const r = e.currentTarget.getBoundingClientRect();
        Menus.open([
          { label: 'Text (Title)', run: () => Edit.addSynthetic('title') },
          { label: 'Color Matte…', run: () => Edit.addSynthetic('color') },
          { label: 'Adjustment Layer', run: () => Edit.addSynthetic('adjustment') },
        ], r.left, r.top - 90);
      }
    }));
    this.body.addEventListener('contextmenu', (e) => {
      if (e.target.closest('[data-id]')) return;
      e.preventDefault();
      const unused = Model.data.media.filter((m) => !Model.seq.clips.some((c) => c.mediaId === m.id));
      Menus.open([
        Cmd.item('import'),
        Cmd.item('import-timeline'),
        Cmd.item('open-sample'),
        { sep: true },
        { label: 'New Item', submenu: () => [Cmd.item('new-text'), Cmd.item('new-matte'), Cmd.item('new-adjustment')] },
        { sep: true },
        { label: 'List View', checked: this.view === 'list', run: () => { this.view = 'list'; this.render(); } },
        { label: 'Icon View', checked: this.view === 'grid', run: () => { this.view = 'grid'; this.render(); } },
        { sep: true },
        { label: `Remove Unused Media${unused.length ? ` (${unused.length})` : ''}`, disabled: !unused.length, run: () => this.removeUnused(unused) },
      ], e.clientX, e.clientY);
    });
    el.addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); el.classList.add('dropping'); } });
    el.addEventListener('dragleave', () => el.classList.remove('dropping'));
    el.addEventListener('drop', (e) => {
      el.classList.remove('dropping');
      if (!e.dataTransfer.files.length) return;
      e.preventDefault();
      Media.importFiles([...e.dataTransfer.files]);
    });
    Bus.on('project', () => this.render());
    Bus.on('media', () => this.render());
    this.render();
  },

  render() {
    const items = Model.data.media.filter((m) => !this.query || m.name.toLowerCase().includes(this.query));
    this.el.querySelector('.pp-count').textContent = `${Model.data.media.length} item${Model.data.media.length === 1 ? '' : 's'}`;
    this.el.querySelectorAll('[data-pp="list"],[data-pp="grid"]').forEach((b) => b.classList.toggle('on', b.dataset.pp === this.view));
    if (!Model.data.media.length) {
      this.body.innerHTML = `<div class="pp-empty">${icon('importIcon', 28)}<p>Import media to start</p><p class="muted">Drop video, audio or image files here, or press Ctrl+I.</p>
        <button class="pbtn pbtn-sm" data-sample>Open sample video</button></div>`;
      this.body.querySelector('[data-sample]').addEventListener('click', () => Samples.load());
      return;
    }
    const kindIcon = { video: 'film', audio: 'music', image: 'photo' };
    if (this.view === 'grid') {
      this.body.innerHTML = `<div class="pp-grid">${items.map((m) => {
        const rt = MediaRT.get(m.id);
        return `<div class="pp-tile${this.selected === m.id ? ' sel' : ''}${rt?.status === 'ready' ? '' : ' offline'}" data-id="${m.id}" draggable="true">
          <span class="pp-thumb">${rt?.thumb ? `<img src="${rt.thumb}" alt="">` : icon(kindIcon[m.kind], 26)}<em>${m.kind === 'image' ? '' : fmtDur(m.duration)}</em></span>
          <span class="pp-name">${icon(kindIcon[m.kind], 12)} ${esc(m.name)}</span></div>`;
      }).join('')}</div>`;
    } else {
      this.body.innerHTML = `<table class="pp-table"><thead><tr><th>Name</th><th>Frame Rate</th><th>Duration</th><th>Video Info</th></tr></thead><tbody>
        ${items.map((m) => `<tr class="pp-row${this.selected === m.id ? ' sel' : ''}${MediaRT.get(m.id)?.status === 'ready' ? '' : ' offline'}" data-id="${m.id}" draggable="true">
          <td><span class="pp-kind k-${m.kind}">${icon(kindIcon[m.kind], 12)}</span>${esc(m.name)}${MediaRT.get(m.id)?.status === 'ready' ? '' : ' <em class="offline-tag">offline</em>'}</td>
          <td>${m.fps ? `${m.fps} fps` : '—'}</td><td>${m.kind === 'image' ? '—' : fmtDur(m.duration)}</td>
          <td>${m.width ? `${m.width} × ${m.height}` : m.hasAudio ? 'Audio' : '—'}</td></tr>`).join('')}
      </tbody></table>`;
    }
    this.body.querySelectorAll('[data-id]').forEach((row) => {
      const m = Model.media(row.dataset.id);
      row.addEventListener('click', () => { this.selected = m.id; this.render(); });
      row.addEventListener('dblclick', () => (MediaRT.get(m.id)?.status === 'ready' ? Source.open(m) : this.relink(m)));
      row.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/x-fc-media', m.id);
        e.dataTransfer.effectAllowed = 'copy';
        App.dragMedia = m;
      });
      row.addEventListener('dragend', () => { App.dragMedia = null; });
      row.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.selected = m.id;
        Menus.open([
          { label: 'Open in Source Monitor', disabled: MediaRT.get(m.id)?.status !== 'ready', run: () => Source.open(m) },
          { label: 'Insert at Playhead', run: () => Edit.placeMedia(m, { insert: true }) },
          { label: 'Overwrite at Playhead', run: () => Edit.placeMedia(m) },
          { sep: true },
          { label: 'Rename…', run: () => this.rename(m) },
          { label: 'Relink Media…', run: () => this.relink(m) },
          { sep: true },
          { label: 'Clear', run: () => this.remove(m.id) },
        ], e.clientX, e.clientY);
      });
    });
  },

  removeUnused(items) {
    History.step('Remove Unused', () => {
      const ids = new Set(items.map((m) => m.id));
      Model.data.media = Model.data.media.filter((m) => !ids.has(m.id));
    });
    for (const m of items) { Pool.reset(m.id); FileStore.remove(m.fileKey).catch(() => {}); }
    if (items.some((m) => m.id === Source.item?.id)) Source.close();
    toast(`Removed ${items.length} unused item${items.length === 1 ? '' : 's'}.`);
  },

  rename(m) {
    openDialog({
      title: 'Rename', width: 380,
      body: `<label class="prow"><span class="prow-label">Name</span><input class="pinput" name="n" value="${esc(m.name)}"></label>`,
      onOk: (api) => History.step('Rename', () => { m.name = api.form.n.value.trim() || m.name; }),
    });
  },

  relink(m) {
    const input = document.getElementById('file-input');
    input.accept = { video: 'video/*', audio: 'audio/*', image: 'image/*' }[m.kind];
    input.multiple = false;
    input.onchange = async () => {
      const file = input.files[0];
      input.value = '';
      if (!file) return;
      App.busy(`Relinking ${file.name}…`);
      try {
        Pool.reset(m.id);
        await Media.relink(m, file);
        Player.renderExact();
        toast(`Relinked ${m.name}`);
      } catch {
        toast(`Couldn't use "${file.name}".`);
      } finally {
        App.busy(false);
      }
    };
    input.click();
  },

  async remove(id) {
    const m = Model.media(id);
    const used = Model.seq.clips.filter((c) => c.mediaId === id).length;
    if (used) {
      const answer = await confirmDialog({ title: 'Clear', message: `"${m.name}" is used ${used} time${used === 1 ? '' : 's'} in the sequence. Remove it and its clips?`, okLabel: 'Remove' });
      if (answer !== 'ok') return;
    }
    History.step('Clear', () => {
      Model.seq.clips = Model.seq.clips.filter((c) => c.mediaId !== id);
      Model.data.media = Model.data.media.filter((x) => x.id !== id);
    });
    Pool.reset(id);
    if (Source.item?.id === id) Source.close();
    FileStore.remove(m.fileKey).catch(() => {});
    this.selected = null;
  },
});

// ---------- Source monitor ----------
const Source = {
  item: null,
  marks: new Map(),

  open(item, clip) {
    if (!item || !Media.isOnline(item.id)) return;
    this.item = item;
    const p = Panels.source;
    const v = p.video;
    v.hidden = item.kind === 'image';
    p.img.hidden = item.kind !== 'image';
    if (item.kind === 'image') p.img.src = MediaRT.get(item.id).url;
    else { v.src = MediaRT.get(item.id).url; v.currentTime = clip ? clip.offset : 0; }
    p.wave.hidden = item.kind !== 'audio';
    App.showPanel('source');
    p.render();
    Bus.emit('source');
  },

  close() {
    this.item = null;
    Panels.source.video.removeAttribute('src');
    Panels.source.render();
  },

  range() {
    const m = this.marks.get(this.item.id) || {};
    const dur = this.item.kind === 'image' ? DEFAULT_STILL_SECONDS : this.item.duration;
    return { inSec: m.in ?? 0, outSec: m.out ?? dur };
  },

  mark(which) {
    if (!this.item) return;
    const t = Panels.source.video.currentTime;
    const m = this.marks.get(this.item.id) || {};
    if (which === 'in') m.in = t;
    if (which === 'out') m.out = t;
    if (which === 'clear') { m.in = null; m.out = null; }
    this.marks.set(this.item.id, m);
    Panels.source.render();
  },

  toggle() {
    const v = Panels.source.video;
    if (!this.item || this.item.kind === 'image') return;
    if (v.paused) v.play().catch(() => {}); else v.pause();
  },

  step(n) {
    const v = Panels.source.video;
    v.pause();
    v.currentTime = clamp(v.currentTime + n / Model.fps, 0, v.duration || 0);
  },

  shuttle(dir) {
    const v = Panels.source.video;
    if (dir === 0) { v.pause(); return; }
    if (dir > 0) { v.playbackRate = !v.paused && v.playbackRate >= 1 ? Math.min(8, v.playbackRate * 2) : 1; v.play().catch(() => {}); }
    else { v.pause(); this.step(-Math.round(Model.fps / 2)); }
  },
};

definePanel('source', 'Source', {
  mount(el) {
    el.innerHTML = `
      <div class="mon">
        <div class="mon-view mon-source"><video playsinline></video><img alt="" hidden><canvas class="src-wave" hidden></canvas>
          <div class="mon-empty">${icon('film', 30)}<p>Double-click a clip in the Project panel to view it here</p></div></div>
        <div class="mon-info"><span class="mon-tc" data-src="tc">00:00:00:00</span><span class="mon-name" data-src="name"></span><span class="mon-dur" data-src="dur"></span></div>
        <canvas class="mon-scrub" data-src="scrub"></canvas>
        <div class="mon-transport">
          <button class="ic-btn" data-sa="in" title="Mark In (I)">${icon('markIn', 16)}</button>
          <button class="ic-btn" data-sa="out" title="Mark Out (O)">${icon('markOut', 16)}</button>
          <span class="mt-gap"></span>
          <button class="ic-btn" data-sa="back" title="Step Back (Left)">${icon('stepBack', 15)}</button>
          <button class="ic-btn mt-play" data-sa="play" title="Play/Stop (Space)">${icon('play', 17)}</button>
          <button class="ic-btn" data-sa="fwd" title="Step Forward (Right)">${icon('stepFwd', 15)}</button>
          <span class="mt-gap"></span>
          <button class="ic-btn" data-sa="insert" title="Insert (,)">${icon('insert', 16)}</button>
          <button class="ic-btn" data-sa="overwrite" title="Overwrite (.)">${icon('overwrite', 16)}</button>
        </div>
      </div>`;
    this.video = el.querySelector('video');
    this.img = el.querySelector('img');
    this.wave = el.querySelector('.src-wave');
    this.video.addEventListener('timeupdate', () => this.renderInfo());
    this.video.addEventListener('seeked', () => this.renderInfo());
    this.video.addEventListener('play', () => this.renderInfo());
    this.video.addEventListener('pause', () => this.renderInfo());
    const tick = () => { if (!this.video.paused) this.renderInfo(); requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    el.querySelectorAll('[data-sa]').forEach((b) => b.addEventListener('click', () => {
      const a = b.dataset.sa;
      if (a === 'in' || a === 'out') Source.mark(a);
      if (a === 'play') Source.toggle();
      if (a === 'back') Source.step(-1);
      if (a === 'fwd') Source.step(1);
      if (a === 'insert') Edit.fromSource(true);
      if (a === 'overwrite') Edit.fromSource(false);
    }));
    const scrub = el.querySelector('[data-src="scrub"]');
    scrub.addEventListener('pointerdown', (e) => {
      if (!Source.item || Source.item.kind === 'image') return;
      scrub.setPointerCapture(e.pointerId);
      const go = (ev) => {
        const r = scrub.getBoundingClientRect();
        this.video.currentTime = clamp((ev.clientX - r.left) / r.width, 0, 1) * Source.item.duration;
      };
      go(e);
      scrub.addEventListener('pointermove', go);
      scrub.addEventListener('pointerup', () => scrub.removeEventListener('pointermove', go), { once: true });
    });
    // Drag from the Source monitor to the timeline.
    el.querySelector('.mon-view').setAttribute('draggable', 'true');
    el.querySelector('.mon-view').addEventListener('dragstart', (e) => {
      if (!Source.item) { e.preventDefault(); return; }
      e.dataTransfer.setData('text/x-fc-media', Source.item.id);
      App.dragMedia = Source.item;
    });
    this.render();
  },

  render() {
    const has = !!Source.item;
    this.el.querySelector('.mon-empty').hidden = has;
    this.el.querySelector('[data-src="name"]').textContent = has ? Source.item.name : '';
    if (has && Source.item.kind === 'audio') this.drawWave();
    this.renderInfo();
  },

  drawWave() {
    const peaks = MediaRT.get(Source.item.id)?.peaks;
    const cv = this.wave;
    cv.width = cv.clientWidth || 600;
    cv.height = cv.clientHeight || 200;
    const x = ctxOf(cv);
    x.clearRect(0, 0, cv.width, cv.height);
    if (!peaks) return;
    x.fillStyle = '#37b29f';
    for (let px = 0; px < cv.width; px++) {
      const i = Math.floor((px / cv.width) * peaks.length);
      const v = peaks[i] * cv.height * 0.45;
      x.fillRect(px, cv.height / 2 - v, 1, v * 2 || 1);
    }
  },

  renderInfo() {
    const item = Source.item;
    const t = item && item.kind !== 'image' ? this.video.currentTime : 0;
    const fps = item?.fps || Model.fps;
    this.el.querySelector('[data-src="tc"]').textContent = tc(Math.round(t * fps), fps);
    const r = item ? Source.range() : null;
    this.el.querySelector('[data-src="dur"]').textContent = item ? `${tc(Math.round((r.outSec - r.inSec) * fps), fps)}` : '';
    this.el.querySelector('[data-sa="play"]').innerHTML = icon(this.video.paused ? 'play' : 'pause', 17);
    const cv = this.el.querySelector('[data-src="scrub"]');
    const dpr = devicePixelRatio || 1;
    cv.width = Math.round(cv.clientWidth * dpr);
    cv.height = Math.round(cv.clientHeight * dpr);
    const x = ctxOf(cv);
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = cv.clientWidth, h = cv.clientHeight;
    x.fillStyle = getComputedStyle(document.body).getPropertyValue('--field');
    x.fillRect(0, 0, w, h);
    if (!item || item.kind === 'image') return;
    const dur = item.duration || 1;
    x.fillStyle = 'rgba(90,140,230,.4)';
    x.fillRect((r.inSec / dur) * w, 0, ((r.outSec - r.inSec) / dur) * w, h);
    x.fillStyle = getComputedStyle(document.body).getPropertyValue('--playhead');
    x.fillRect((t / dur) * w - 1, 0, 2, h);
  },
});

// ---------- Program monitor ----------
const Program = {
  quality: 0.5,
  zoom: 'fit',
  safe: false,
};

definePanel('program', 'Program', {
  mount(el) {
    el.innerHTML = `
      <div class="mon">
        <div class="mon-view mon-program"><div class="mon-stage"><canvas id="program-canvas"></canvas><canvas class="mon-overlay" id="program-overlay"></canvas></div></div>
        <div class="mon-info">
          <input class="mon-tc" id="program-tc" spellcheck="false" aria-label="Playhead timecode">
          <select class="mon-select" id="program-zoom" title="Select Zoom Level">
            <option value="fit">Fit</option><option value="0.25">25%</option><option value="0.5">50%</option><option value="0.75">75%</option><option value="1">100%</option>
          </select>
          <span class="tl-spacer"></span>
          <select class="mon-select" id="program-quality" title="Select Playback Resolution">
            <option value="1">Full</option><option value="0.5">1/2</option><option value="0.25">1/4</option>
          </select>
          <span class="mon-dur" id="program-dur"></span>
        </div>
        <canvas class="mon-scrub" id="program-scrub"></canvas>
        <div class="mon-transport">
          <button class="ic-btn" data-pa="in" title="Mark In (I)">${icon('markIn', 16)}</button>
          <button class="ic-btn" data-pa="out" title="Mark Out (O)">${icon('markOut', 16)}</button>
          <button class="ic-btn" data-pa="marker" title="Add Marker (M)">${icon('marker', 14)}</button>
          <span class="mt-gap"></span>
          <button class="ic-btn" data-pa="goIn" title="Go to In (Shift+I)">${icon('goIn', 15)}</button>
          <button class="ic-btn" data-pa="back" title="Step Back 1 Frame (Left)">${icon('stepBack', 15)}</button>
          <button class="ic-btn mt-play" data-pa="play" title="Play/Stop (Space)">${icon('play', 17)}</button>
          <button class="ic-btn" data-pa="fwd" title="Step Forward 1 Frame (Right)">${icon('stepFwd', 15)}</button>
          <button class="ic-btn" data-pa="goOut" title="Go to Out (Shift+O)">${icon('goOut', 15)}</button>
          <span class="mt-gap"></span>
          <button class="ic-btn" data-pa="lift" title="Lift (;)">${icon('lift', 16)}</button>
          <button class="ic-btn" data-pa="extract" title="Extract (')">${icon('extract', 16)}</button>
          <button class="ic-btn" data-pa="frame" title="Export Frame (Ctrl+Shift+E)">${icon('camera', 16)}</button>
          <button class="ic-btn" data-pa="safe" title="Safe Margins">${icon('safe', 16)}</button>
        </div>
      </div>`;
    this.canvas = el.querySelector('#program-canvas');
    this.overlay = el.querySelector('#program-overlay');
    this.view = el.querySelector('.mon-view');
    this.stage = el.querySelector('.mon-stage');
    GL.init(this.canvas);
    this.tc = el.querySelector('#program-tc');
    this.tc.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { const f = parseTC(this.tc.value); if (f != null) Player.seek(f); this.tc.blur(); }
      if (e.key === 'Escape') this.tc.blur();
    });
    this.tc.addEventListener('blur', () => this.renderInfo());
    el.querySelector('#program-zoom').addEventListener('change', (e) => { Program.zoom = e.target.value; this.layout(); });
    const q = el.querySelector('#program-quality');
    q.value = String(Program.quality);
    q.addEventListener('change', () => { Program.quality = +q.value; App.savePrefs(); this.layout(); Player.renderExact(); });
    el.querySelectorAll('[data-pa]').forEach((b) => b.addEventListener('click', () => {
      const a = b.dataset.pa;
      const seq = Model.seq;
      if (a === 'in') Edit.setInOut('in');
      if (a === 'out') Edit.setInOut('out');
      if (a === 'marker') Edit.addMarker();
      if (a === 'goIn' && seq.inPoint != null) Player.seek(seq.inPoint);
      if (a === 'goOut' && seq.outPoint != null) Player.seek(seq.outPoint - 1);
      if (a === 'back') Player.step(-1);
      if (a === 'fwd') Player.step(1);
      if (a === 'play') Player.toggle();
      if (a === 'lift') Edit.liftExtract(false);
      if (a === 'extract') Edit.liftExtract(true);
      if (a === 'frame') exportFrame();
      if (a === 'safe') { Program.safe = !Program.safe; this.drawOverlay(); b.classList.toggle('on', Program.safe); }
    }));
    const scrub = el.querySelector('#program-scrub');
    scrub.addEventListener('pointerdown', (e) => {
      scrub.setPointerCapture(e.pointerId);
      const go = (ev) => {
        const r = scrub.getBoundingClientRect();
        Player.seek(clamp((ev.clientX - r.left) / r.width, 0, 1) * Math.max(1, Model.duration()));
      };
      go(e);
      scrub.addEventListener('pointermove', go);
      scrub.addEventListener('pointerup', () => scrub.removeEventListener('pointermove', go), { once: true });
    });
    this.setupDirectManipulation();
    new ResizeObserver(() => this.layout()).observe(this.view);
    Bus.on('playhead', () => this.renderInfo());
    Bus.on('transport', () => this.renderInfo());
    Bus.on('sequence', () => this.layout());
    Bus.on('project', () => { this.renderInfo(); this.drawOverlay(); });
    Bus.on('selection', () => this.drawOverlay());
    Bus.on('rendered', () => this.drawOverlay());
    this.layout();
  },

  // Size the canvas to the sequence at the chosen playback resolution, shown fitted in the panel.
  layout() {
    const seq = Model.seq;
    const w = Math.max(16, Math.round(seq.width * Program.quality));
    const h = Math.max(16, Math.round(seq.height * Program.quality));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      GL.trimPool(w, h);
    }
    const vw = this.view.clientWidth, vh = this.view.clientHeight;
    const k = Program.zoom === 'fit' ? Math.min(vw / seq.width, vh / seq.height) : +Program.zoom;
    const cw = Math.max(1, Math.round(seq.width * k)), ch = Math.max(1, Math.round(seq.height * k));
    Object.assign(this.stage.style, { width: `${cw}px`, height: `${ch}px` });
    this.overlay.width = cw * (devicePixelRatio || 1);
    this.overlay.height = ch * (devicePixelRatio || 1);
    this.renderInfo();
    this.drawOverlay();
    if (!Player.playing) Player.renderExact();
  },

  renderInfo() {
    if (document.activeElement !== this.tc) this.tc.value = tc(Model.seq.playhead);
    this.el.querySelector('#program-dur').textContent = tc(Model.duration());
    this.el.querySelector('[data-pa="play"]').innerHTML = icon(Player.playing ? 'pause' : 'play', 17);
    const cv = this.el.querySelector('#program-scrub');
    const dpr = devicePixelRatio || 1;
    if (cv.width !== Math.round(cv.clientWidth * dpr)) { cv.width = Math.round(cv.clientWidth * dpr); cv.height = Math.round(cv.clientHeight * dpr); }
    const x = ctxOf(cv);
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = cv.clientWidth, h = cv.clientHeight;
    const css = getComputedStyle(document.body);
    x.fillStyle = css.getPropertyValue('--field');
    x.fillRect(0, 0, w, h);
    const d = Math.max(1, Model.duration());
    const seq = Model.seq;
    if (seq.inPoint != null || seq.outPoint != null) {
      x.fillStyle = 'rgba(90,140,230,.4)';
      const a = ((seq.inPoint ?? 0) / d) * w, b = ((seq.outPoint ?? d) / d) * w;
      x.fillRect(a, 0, b - a, h);
    }
    for (const m of seq.markers) { x.fillStyle = m.color; x.fillRect((m.frame / d) * w - 1, 0, 2, h / 2); }
    x.fillStyle = css.getPropertyValue('--playhead');
    x.fillRect((seq.playhead / d) * w - 1, 0, 2, h);
  },

  // Safe margins, the selected clip's bounds, and color windows.
  drawOverlay() {
    const cv = this.overlay;
    if (!cv) return;
    const x = ctxOf(cv);
    const dpr = devicePixelRatio || 1;
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.clearRect(0, 0, cv.width, cv.height);
    const w = cv.width, h = cv.height;
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    const W = w / dpr, H = h / dpr;
    if (Program.safe) {
      x.strokeStyle = 'rgba(255,255,255,.55)';
      x.lineWidth = 1;
      x.strokeRect(W * 0.05 + 0.5, H * 0.05 + 0.5, W * 0.9, H * 0.9);
      x.strokeRect(W * 0.1 + 0.5, H * 0.1 + 0.5, W * 0.8, H * 0.8);
    }
    ColorPage.drawWindowOverlay?.(x, W, H);
    const c = App.sel.size === 1 ? Model.clip([...App.sel][0]) : null;
    if (!c || c.kind === 'audio' || c.kind === 'adjustment' || App.workspace === 'color') return;
    const f = Model.seq.playhead;
    if (f < c.start || f >= Model.end(c)) return;
    const box = this.clipBox(c, f - c.start);
    if (!box) return;
    const k = W / Model.seq.width;
    x.save();
    x.translate(W / 2 + box.cx * k, H / 2 + box.cy * k);
    x.rotate(box.rot);
    x.strokeStyle = '#3f8cff';
    x.lineWidth = 1;
    x.strokeRect((-box.w * k) / 2, (-box.h * k) / 2, box.w * k, box.h * k);
    x.fillStyle = '#3f8cff';
    for (const [px, py] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) x.fillRect((px * box.w * k) / 2 - 3, (py * box.h * k) / 2 - 3, 6, 6);
    x.restore();
  },

  // Clip bounds in sequence pixels relative to the frame center.
  clipBox(c, rel) {
    const seq = Model.seq;
    let w = seq.width, h = seq.height;
    if (c.kind === 'video' || c.kind === 'image') {
      const m = Model.media(c.mediaId);
      if (!m) return null;
      const k = c.motion.fit ? Math.min(seq.width / m.width, seq.height / m.height) : 1;
      w = m.width * k; h = m.height * k;
    }
    const s = Param.at(c, 'motion.scale', rel) / 100;
    return { cx: Param.at(c, 'motion.x', rel), cy: Param.at(c, 'motion.y', rel), w: w * s, h: h * s, rot: (Param.at(c, 'motion.rotation', rel) * Math.PI) / 180 };
  },

  // Drag in the Program monitor to move the selected clip; Type tool clicks add text.
  setupDirectManipulation() {
    const cv = this.overlay;
    cv.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      Menus.open([
        quickToolsItem(),
        { sep: true },
        { label: 'Playback Resolution', submenu: () => [[1, 'Full'], [0.5, '1/2'], [0.25, '1/4']].map(([q, l]) => ({ label: l, checked: Program.quality === q, run: () => { Program.quality = q; this.el.querySelector('#program-quality').value = String(q); App.savePrefs(); this.layout(); } })) },
        { label: 'Safe Margins', checked: Program.safe, run: () => { Program.safe = !Program.safe; this.drawOverlay(); } },
        { sep: true },
        Cmd.item('new-text'),
        Cmd.item('export-frame'),
        Cmd.item('add-marker'),
      ], e.clientX, e.clientY);
    });
    cv.addEventListener('pointerdown', (e) => {
      const r = cv.getBoundingClientRect();
      const k = Model.seq.width / r.width;
      const sx = (e.clientX - r.left) * k - Model.seq.width / 2;
      const sy = (e.clientY - r.top) * k - Model.seq.height / 2;
      if (App.tool === 'type') {
        const clip = Edit.addSynthetic('title', { title: { x: Math.round(sx), y: Math.round(sy), text: 'Text' } });
        App.showPanel('graphics');
        setTimeout(() => Panels.graphics.focusText?.(), 50);
        return clip;
      }
      if (ColorPage.windowPointer?.(e, sx / Model.seq.width + 0.5, sy / Model.seq.height + 0.5)) return;
      const c = App.sel.size === 1 ? Model.clip([...App.sel][0]) : null;
      if (!c || c.kind === 'audio' || c.kind === 'adjustment') return;
      const rel = Model.seq.playhead - c.start;
      if (rel < 0 || rel >= c.duration) return;
      cv.setPointerCapture(e.pointerId);
      const isTitle = c.kind === 'title';
      const ox = isTitle ? c.title.x : Param.at(c, 'motion.x', rel);
      const oy = isTitle ? c.title.y : Param.at(c, 'motion.y', rel);
      History.begin();
      const move = (ev) => {
        const dx = (ev.clientX - e.clientX) * k, dy = (ev.clientY - e.clientY) * k;
        if (isTitle) { c.title.x = Math.round(ox + dx); c.title.y = Math.round(oy + dy); }
        else { Param.edit(c, 'motion.x', Math.round(ox + dx)); Param.edit(c, 'motion.y', Math.round(oy + dy)); }
        App.invalidate();
        this.drawOverlay();
      };
      const up = () => {
        cv.removeEventListener('pointermove', move);
        History.commit('Position');
      };
      cv.addEventListener('pointermove', move);
      cv.addEventListener('pointerup', up, { once: true });
    });
  },
});

// ---------- Effect Controls ----------
const EC_LANE_W = 0.38;

definePanel('effectControls', 'Effect Controls', {
  mount(el) {
    el.innerHTML = '<div class="ec"></div>';
    this.body = el.querySelector('.ec');
    Bus.on('selection', () => this.render());
    Bus.on('project', () => this.render());
    Bus.on('playhead', () => this.tick());
    this.render();
  },

  clip() {
    if (App.sel.size === 0) return null;
    const clips = Edit.selected();
    return clips.find((c) => c.kind !== 'audio') || clips[0];
  },

  rows(c) {
    if (c.kind === 'audio') {
      return [{ group: 'Volume', items: [{ path: 'volume', label: 'Level', min: -60, max: 15, step: 0.1, unit: 'dB' }] },
        { group: 'Panner', items: [{ path: 'pan', label: 'Balance', min: -100, max: 100, step: 1 }] }];
    }
    const groups = [];
    if (c.kind !== 'adjustment') {
      groups.push({ group: 'Motion', items: [
        { path: 'motion.x', label: 'Position X', min: -10000, max: 10000, step: 1 },
        { path: 'motion.y', label: 'Position Y', min: -10000, max: 10000, step: 1 },
        { path: 'motion.scale', label: 'Scale', min: 0, max: 1000, step: 0.1, unit: '%' },
        { path: 'motion.rotation', label: 'Rotation', min: -3600, max: 3600, step: 0.1, unit: '°' },
        { check: 'motion.fit', label: 'Scale to Frame Size', disabled: c.kind === 'title' || c.kind === 'color' },
      ] });
    }
    groups.push({ group: 'Opacity', items: [
      { path: 'opacity', label: 'Opacity', min: 0, max: 100, step: 0.1, unit: '%' },
      { select: 'blend', label: 'Blend Mode', options: BLENDS },
    ] });
    if (c.kind !== 'adjustment') {
      groups.push({ group: 'Crop', items: ['l', 'r', 't', 'b'].map((k) => ({ path: `crop.${k}`, label: { l: 'Left', r: 'Right', t: 'Top', b: 'Bottom' }[k], min: 0, max: 100, step: 0.1, unit: '%', noKeys: true })) });
    }
    if (Model.isTimed(c)) groups.push({ group: 'Time Remapping', items: [{ speed: true, label: 'Speed' }] });
    for (const fx of c.effects) {
      const def = EFFECTS[fx.type];
      groups.push({ group: def.name, fx, items: def.params.map((p) => (p.type === 'color'
        ? { color: `fx.${fx.id}.${p.key}`, label: p.label }
        : { path: `fx.${fx.id}.${p.key}`, label: p.label, min: p.min, max: p.max, step: p.step || 1 })) });
    }
    return groups;
  },

  render() {
    if (this.body.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return;
    const c = this.clip();
    if (!c) { this.body.innerHTML = `<p class="panel-empty">${App.selTrans ? this.transHTML() : 'No clip selected'}</p>`; this.bindTrans(); return; }
    const groups = this.rows(c);
    const keyCount = (p) => c.keys[p]?.length || 0;
    this.body.innerHTML = `
      <div class="ec-head"><span>${esc(Model.seq.name)} * ${esc(c.kind === 'title' ? c.title.text.split('\n')[0] : c.name)}</span>
        ${c.kind !== 'audio' ? `<button class="ic-btn" data-ec="addfx" title="Add effect">${icon('fx', 15)}</button>` : ''}</div>
      <div class="ec-cols"><div class="ec-props">
      ${c.kind === 'audio' ? '<div class="ec-section">Audio</div>' : '<div class="ec-section">Video</div>'}
      ${groups.map((g, gi) => `
        <div class="ec-group" data-g="${gi}">
          <div class="ec-gtitle">
            <span class="ec-fxbadge${g.fx && !g.fx.enabled ? ' off' : ''}" ${g.fx ? `data-fxtoggle="${g.fx.id}" title="Toggle effect"` : ''}>fx</span>
            <span>${esc(g.group)}</span>
            ${g.fx ? `<span class="tl-spacer"></span>
              <button class="ic-btn sm" data-fxmove="${g.fx.id}:-1" title="Move up">${icon('chevronLeft', 12)}</button>
              <button class="ic-btn sm" data-fxmove="${g.fx.id}:1" title="Move down">${icon('chevronRight', 12)}</button>
              <button class="ic-btn sm" data-fxreset="${g.fx.id}" title="Reset">${icon('reset', 12)}</button>
              <button class="ic-btn sm" data-fxdel="${g.fx.id}" title="Delete effect">${icon('trash', 12)}</button>` : ''}
          </div>
          ${g.items.map((it) => this.itemHTML(c, it, keyCount)).join('')}
        </div>`).join('')}
      ${c.kind !== 'audio' ? this.transitionsHTML(c) : ''}
      </div></div>`;
    this.bind(c);
    this.tick();
  },

  itemHTML(c, it, keyCount) {
    if (it.check) return `<div class="ec-row"><span class="ec-sw"></span><label class="pcheck"><input type="checkbox" data-check="${it.check}" ${getPath(c, it.check) ? 'checked' : ''} ${it.disabled ? 'disabled' : ''}> ${it.label}</label></div>`;
    if (it.select) return `<div class="ec-row"><span class="ec-sw"></span><span class="ec-label">${it.label}</span><select class="mon-select" data-sel="${it.select}">${it.options.map(([v, l]) => `<option value="${v}" ${getPath(c, it.select) === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>`;
    if (it.color) return `<div class="ec-row"><span class="ec-sw"></span><span class="ec-label">${it.label}</span><input type="color" class="ec-color" data-color="${it.color}" value="${Param.get(c, it.color)}"></div>`;
    if (it.speed) return `<div class="ec-row"><span class="ec-sw"></span><span class="ec-label">Speed</span><span class="ec-val scrub" data-speed><input type="number" value="${Math.round(c.speed * 1000) / 10}" step="1" min="10" max="1000"><em>%</em></span><button class="pbtn pbtn-sm" data-ec="speed">Speed/Duration…</button></div>`;
    const anim = keyCount(it.path) > 0;
    return `<div class="ec-row" data-path="${it.path}">
      ${it.noKeys ? '<span class="ec-sw"></span>' : `<button class="ec-sw${anim ? ' on' : ''}" data-sw="${it.path}" title="Toggle animation">${icon('stopwatch', 13)}</button>`}
      <span class="ec-label scrubby" data-scrub="${it.path}">${it.label}</span>
      <span class="ec-val"><input type="number" data-num="${it.path}" min="${it.min}" max="${it.max}" step="${it.step}"><em>${it.unit || ''}</em></span>
      ${anim ? `<span class="ec-keynav"><button class="ic-btn sm" data-kprev="${it.path}" title="Previous keyframe">${icon('chevronLeft', 11)}</button><button class="ic-btn sm" data-kadd="${it.path}" title="Add/remove keyframe">${icon('diamondOutline', 11)}</button><button class="ic-btn sm" data-knext="${it.path}" title="Next keyframe">${icon('chevronRight', 11)}</button></span>` : ''}
      <span class="ec-lane" data-lane="${it.path}"></span>
    </div>`;
  },

  transitionsHTML(c) {
    const t = [['transIn', 'Transition In'], ['transOut', 'Transition Out']].filter(([k]) => c[k]);
    if (!t.length) return '';
    return `<div class="ec-group"><div class="ec-gtitle"><span class="ec-fxbadge">⇄</span><span>Transitions</span></div>
      ${t.map(([k, label]) => `<div class="ec-row"><span class="ec-sw"></span><span class="ec-label">${label}: ${esc(TRANSITIONS[c[k].type]?.name || c[k].type)}</span>
        <span class="ec-val"><input type="number" data-tdur="${k}" value="${c[k].duration}" min="2" max="${c.duration}"><em>fr</em></span>
        <button class="ic-btn sm" data-tdel="${k}" title="Remove">${icon('trash', 12)}</button></div>`).join('')}</div>`;
  },

  transHTML() {
    const c = Model.clip(App.selTrans.clipId);
    const t = c?.[App.selTrans.side === 'in' ? 'transIn' : 'transOut'];
    if (!t) return 'No clip selected';
    return `<span class="ec-trans">${esc((TRANSITIONS[t.type] || AUDIO_TRANSITIONS[t.type]).name)} · Duration <input type="number" id="ec-tdur" value="${t.duration}" min="2" max="${c.duration}"> frames</span>`;
  },

  bindTrans() {
    const input = this.body.querySelector('#ec-tdur');
    if (!input) return;
    input.addEventListener('change', () => {
      const c = Model.clip(App.selTrans.clipId);
      History.step('Transition Duration', () => { c[App.selTrans.side === 'in' ? 'transIn' : 'transOut'].duration = clamp(Math.round(+input.value), 2, c.duration); });
    });
  },

  bind(c) {
    const b = this.body;
    b.querySelectorAll('[data-num]').forEach((input) => {
      const path = input.dataset.num;
      const commit = () => {
        const v = clamp(+input.value, +input.min, +input.max);
        if (Number.isNaN(v)) return;
        History.begin();
        Param.edit(c, path, v);
        App.invalidate();
      };
      input.addEventListener('input', commit);
      input.addEventListener('change', () => { History.commit('Change Property'); });
      const label = b.querySelector(`[data-scrub="${path}"]`);
      if (label) makeScrubby(label, input, { min: +input.min, max: +input.max, step: +input.step || 1 });
    });
    b.querySelectorAll('[data-check]').forEach((input) => input.addEventListener('change', () => History.step('Change Property', () => setPath(c, input.dataset.check, input.checked))));
    b.querySelectorAll('[data-sel]').forEach((s) => s.addEventListener('change', () => History.step('Blend Mode', () => setPath(c, s.dataset.sel, s.value))));
    b.querySelectorAll('[data-color]').forEach((s) => s.addEventListener('change', () => History.step('Change Property', () => Param.set(c, s.dataset.color, s.value))));
    b.querySelectorAll('[data-sw]').forEach((btn) => btn.addEventListener('click', () => {
      const path = btn.dataset.sw;
      History.step(Param.animated(c, path) ? 'Turn Off Animation' : 'Turn On Animation', () => {
        if (Param.animated(c, path)) {
          const v = Param.at(c, path, clamp(Model.seq.playhead - c.start, 0, c.duration));
          delete c.keys[path];
          Param.set(c, path, v);
        } else {
          setKey(c, path, clamp(Model.seq.playhead - c.start, 0, c.duration), Param.get(c, path));
        }
      });
    }));
    b.querySelectorAll('[data-kadd]').forEach((btn) => btn.addEventListener('click', () => {
      const path = btn.dataset.kadd;
      const rel = clamp(Model.seq.playhead - c.start, 0, c.duration);
      History.step('Keyframe', () => {
        const keys = c.keys[path];
        const i = keys.findIndex((k) => k.f === rel);
        if (i >= 0) keys.splice(i, 1);
        else setKey(c, path, rel, Param.at(c, path, rel));
        if (!keys.length) delete c.keys[path];
      });
    }));
    for (const [attr, dir] of [['kprev', -1], ['knext', 1]]) {
      b.querySelectorAll(`[data-${attr}]`).forEach((btn) => btn.addEventListener('click', () => {
        const rel = Model.seq.playhead - c.start;
        const fs = c.keys[btn.dataset[attr]].map((k) => k.f);
        const t = dir > 0 ? fs.find((f) => f > rel) : [...fs].reverse().find((f) => f < rel);
        if (t != null) Player.seek(c.start + t);
      }));
    }
    b.querySelector('[data-speed] input')?.addEventListener('change', (e) => Edit.setSpeed([c.id, ...Model.partners(c).map((p) => p.id)], +e.target.value / 100));
    b.querySelector('[data-ec="speed"]')?.addEventListener('click', () => speedDialog());
    b.querySelector('[data-ec="addfx"]')?.addEventListener('click', (e) => {
      const r = e.currentTarget.getBoundingClientRect();
      Menus.open(Object.entries(EFFECTS).map(([k, d]) => ({ label: d.name, run: () => History.step(`Apply ${d.name}`, () => c.effects.push(newEffect(k))) })), r.left, r.bottom);
    });
    b.querySelectorAll('[data-fxtoggle]').forEach((x) => x.addEventListener('click', () => History.step('Toggle Effect', () => { const fx = c.effects.find((f) => f.id === x.dataset.fxtoggle); fx.enabled = !fx.enabled; })));
    b.querySelectorAll('[data-fxdel]').forEach((x) => x.addEventListener('click', () => History.step('Delete Effect', () => {
      c.effects = c.effects.filter((f) => f.id !== x.dataset.fxdel);
      for (const k of Object.keys(c.keys)) if (k.startsWith(`fx.${x.dataset.fxdel}.`)) delete c.keys[k];
    })));
    b.querySelectorAll('[data-fxreset]').forEach((x) => x.addEventListener('click', () => History.step('Reset Effect', () => {
      const fx = c.effects.find((f) => f.id === x.dataset.fxreset);
      fx.params = newEffect(fx.type).params;
      for (const k of Object.keys(c.keys)) if (k.startsWith(`fx.${fx.id}.`)) delete c.keys[k];
    })));
    b.querySelectorAll('[data-fxmove]').forEach((x) => x.addEventListener('click', () => {
      const [id, dir] = x.dataset.fxmove.split(':');
      History.step('Reorder Effect', () => {
        const i = c.effects.findIndex((f) => f.id === id);
        const j = i + +dir;
        if (j < 0 || j >= c.effects.length) return false;
        [c.effects[i], c.effects[j]] = [c.effects[j], c.effects[i]];
      });
    }));
    b.querySelectorAll('[data-tdur]').forEach((input) => input.addEventListener('change', () => History.step('Transition Duration', () => { c[input.dataset.tdur].duration = clamp(Math.round(+input.value), 2, c.duration); })));
    b.querySelectorAll('[data-tdel]').forEach((x) => x.addEventListener('click', () => History.step('Delete Transition', () => { c[x.dataset.tdel] = null; })));
  },

  // Refresh numbers and keyframe lanes as the playhead moves.
  tick() {
    const c = this.clip();
    if (!c || !this.body.querySelector('.ec-props')) return;
    const rel = clamp(Model.seq.playhead - c.start, 0, c.duration);
    this.body.querySelectorAll('[data-num]').forEach((input) => {
      if (document.activeElement === input) return;
      const v = Param.at(c, input.dataset.num, rel);
      input.value = Math.round(v * 100) / 100;
    });
    this.body.querySelectorAll('[data-lane]').forEach((lane) => {
      const keys = c.keys[lane.dataset.lane] || [];
      lane.innerHTML = keys.map((k) => `<span class="ec-key${k.f === rel ? ' on' : ''}" style="left:${(k.f / Math.max(1, c.duration)) * 100}%" title="${tc(c.start + k.f)}"></span>`).join('')
        + (Model.seq.playhead >= c.start && Model.seq.playhead <= Model.end(c) ? `<span class="ec-ph" style="left:${(rel / Math.max(1, c.duration)) * 100}%"></span>` : '');
    });
  },
});

// ---------- Effects panel ----------
definePanel('effects', 'Effects', {
  query: '',
  open: new Set(['Presets', 'Video Effects', 'Video Transitions']),
  mount(el) {
    el.innerHTML = `<div class="pp-bar"><span class="pp-search">${icon('search', 13)}<input placeholder="Search effects" aria-label="Search effects"></span></div><div class="fxl"></div>`;
    el.querySelector('input').addEventListener('input', (e) => { this.query = e.target.value.toLowerCase(); this.render(); });
    this.render();
  },
  tree() {
    const groupBy = (obj, kind) => {
      const out = {};
      for (const [id, d] of Object.entries(obj)) (out[d.group] ||= []).push({ id, name: d.name, kind });
      return out;
    };
    return [
      ['Presets', { Looks: Object.entries(LOOKS).map(([id, d]) => ({ id, name: d.name, kind: 'look' })) }],
      ['Video Effects', groupBy(EFFECTS, 'effect')],
      ['Video Transitions', groupBy(TRANSITIONS, 'transition')],
      ['Audio Transitions', groupBy(AUDIO_TRANSITIONS, 'atransition')],
    ];
  },
  render() {
    const q = this.query;
    const body = this.el.querySelector('.fxl');
    body.innerHTML = this.tree().map(([top, groups]) => {
      const entries = Object.entries(groups).map(([g, items]) => {
        const shown = items.filter((i) => !q || i.name.toLowerCase().includes(q));
        if (!shown.length) return '';
        return `<details class="fx-sub" open><summary>${icon('folder', 13)} ${esc(g)}</summary>
          ${shown.map((i) => `<div class="fx-item" draggable="true" data-fx="${i.kind}:${i.id}" title="Drag onto a clip, or double-click to apply to the selection">${icon(i.kind === 'effect' ? 'fx' : i.kind === 'look' ? 'wave' : 'tSlide', 13)} ${esc(i.name)}</div>`).join('')}
        </details>`;
      }).join('');
      if (!entries) return '';
      return `<details class="fx-top" ${this.open.has(top) || q ? 'open' : ''} data-top="${top}"><summary>${icon('folder', 13)} ${top}</summary>${entries}</details>`;
    }).join('');
    body.querySelectorAll('.fx-top').forEach((d) => d.addEventListener('toggle', () => { if (d.open) this.open.add(d.dataset.top); else this.open.delete(d.dataset.top); }));
    body.querySelectorAll('[data-fx]').forEach((it) => {
      it.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/x-fc-effect', it.dataset.fx); e.dataTransfer.effectAllowed = 'copy'; });
      it.addEventListener('dblclick', () => this.applyToSelection(it.dataset.fx));
    });
  },
  applyToSelection(data) {
    const [kind, type] = data.split(':');
    const clips = Edit.selected();
    if (!clips.length) { toast('Select clips in the timeline first, or drag the effect onto a clip.'); return; }
    History.step('Apply Effect', () => {
      for (const c of clips) {
        if (kind === 'effect' && c.kind !== 'audio') c.effects.push(newEffect(type));
        if (kind === 'look' && c.kind !== 'audio') applyLook(c, type);
        if (kind === 'transition' && c.kind !== 'audio') Edit.setTransition(c, 'in', type);
        if (kind === 'atransition' && c.kind === 'audio') Edit.setTransition(c, 'in', type);
      }
    });
  },
});

// ---------- Audio meters ----------
const METER_MIN = -60;
const meterY = (db, h) => (db <= METER_MIN ? h : h * (1 - (db - METER_MIN) / -METER_MIN));

function drawMeter(cv, levels, peaks) {
  const dpr = devicePixelRatio || 1;
  const w = cv.clientWidth, h = cv.clientHeight;
  if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const x = ctxOf(cv);
  x.setTransform(dpr, 0, 0, dpr, 0, 0);
  x.fillStyle = '#111';
  x.fillRect(0, 0, w, h);
  const n = levels.length;
  const bw = (w - 2 * (n + 1)) / n;
  const grad = x.createLinearGradient(0, h, 0, 0);
  grad.addColorStop(0, '#1fae4b');
  grad.addColorStop(0.7, '#1fae4b');
  grad.addColorStop(0.85, '#e2c534');
  grad.addColorStop(1, '#e23b3b');
  levels.forEach((db, i) => {
    const bx = 2 + i * (bw + 2);
    const y = meterY(db, h);
    x.fillStyle = '#222';
    x.fillRect(bx, 0, bw, h);
    x.fillStyle = grad;
    x.fillRect(bx, y, bw, h - y);
    if (peaks?.[i] > METER_MIN) { x.fillStyle = '#ddd'; x.fillRect(bx, meterY(peaks[i], h), bw, 1); }
  });
}

definePanel('meters', 'Audio Meters', {
  peaks: [-Infinity, -Infinity],
  mount(el) {
    el.innerHTML = `<div class="meters"><canvas class="meter-canvas"></canvas><div class="meter-scale">${[0, -6, -12, -18, -24, -30, -36, -42, -48, -54].map((d) => `<span style="top:${(d / METER_MIN) * 100}%">${d}</span>`).join('')}</div></div>`;
    this.cv = el.querySelector('canvas');
    Bus.on('meters', () => this.draw());
    Bus.on('transport', () => this.draw());
    this.draw();
  },
  draw() {
    const L = Player.playing ? Player.levels.L : -Infinity, R = Player.playing ? Player.levels.R : -Infinity;
    const now = performance.now();
    if (!this.hold || now - this.hold > 1500) { this.peaks = [-Infinity, -Infinity]; this.hold = now; }
    this.peaks = [Math.max(this.peaks[0], L), Math.max(this.peaks[1], R)];
    drawMeter(this.cv, [L, R], this.peaks);
  },
});

// ---------- Audio Track Mixer ----------
definePanel('audioMixer', 'Audio Track Mixer', {
  mount(el) {
    el.innerHTML = '<div class="mixer"></div>';
    Bus.on('project', () => this.render());
    Bus.on('meters', () => this.meters());
    Bus.on('transport', () => this.meters());
    this.render();
  },
  render() {
    const tracks = Model.tracks('audio');
    const strip = (t, master) => `
      <div class="mx-strip${master ? ' master' : ''}" data-track="${t?.id || 'master'}">
        <div class="mx-pan"><span class="mx-knob" data-pan="${t?.id}" title="Pan: drag up/down, double-click to center" style="--a:${((t?.pan || 0) / 100) * 135}deg"></span><span class="mx-panval">${master ? '' : t.pan === 0 ? 'C' : t.pan < 0 ? `L${-t.pan}` : `R${t.pan}`}</span></div>
        ${master ? '' : `<div class="mx-ms"><button class="th-btn th-m${t.muted ? ' on' : ''}" data-mx="mute">M</button><button class="th-btn th-s${t.solo ? ' on' : ''}" data-mx="solo">S</button></div>`}
        <div class="mx-fader-wrap">
          <canvas class="mx-meter" data-meter="${t?.id || 'master'}"></canvas>
          ${master ? '' : `<input type="range" class="mx-fader" data-fader="${t.id}" min="-60" max="15" step="0.1" value="${t.volume}" orient="vertical" aria-label="${t.name} volume">`}
        </div>
        <div class="mx-db">${master ? '' : `${t.volume > 0 ? '+' : ''}${t.volume.toFixed(1)} dB`}</div>
        <div class="mx-name">${master ? 'Mix' : `${t.name} · Audio ${t.name.slice(1)}`}</div>
      </div>`;
    this.el.querySelector('.mixer').innerHTML = tracks.map((t) => strip(t, false)).join('') + strip(null, true);
    this.el.querySelectorAll('[data-fader]').forEach((f) => {
      const t = Model.track(f.dataset.fader);
      f.addEventListener('input', () => {
        History.begin();
        t.volume = +f.value;
        f.closest('.mx-strip').querySelector('.mx-db').textContent = `${t.volume > 0 ? '+' : ''}${t.volume.toFixed(1)} dB`;
        if (Player.playing) Player.bus(t);
      });
      f.addEventListener('change', () => History.commit('Track Volume'));
      f.addEventListener('dblclick', () => History.step('Track Volume', () => { t.volume = 0; }));
    });
    this.el.querySelectorAll('[data-mx]').forEach((b) => b.addEventListener('click', () => {
      const t = Model.track(b.closest('.mx-strip').dataset.track);
      History.step(b.dataset.mx === 'mute' ? 'Mute Track' : 'Solo Track', () => { t[b.dataset.mx === 'mute' ? 'muted' : 'solo'] = !t[b.dataset.mx === 'mute' ? 'muted' : 'solo']; });
    }));
    this.el.querySelectorAll('[data-pan]').forEach((k) => {
      const t = Model.track(k.dataset.pan);
      if (!t) return;
      k.addEventListener('dblclick', () => History.step('Pan', () => { t.pan = 0; }));
      k.addEventListener('pointerdown', (e) => {
        k.setPointerCapture(e.pointerId);
        const y0 = e.clientY, p0 = t.pan;
        History.begin();
        const move = (ev) => {
          t.pan = clamp(Math.round(p0 + (y0 - ev.clientY)), -100, 100);
          k.style.setProperty('--a', `${(t.pan / 100) * 135}deg`);
          k.nextElementSibling.textContent = t.pan === 0 ? 'C' : t.pan < 0 ? `L${-t.pan}` : `R${t.pan}`;
        };
        k.addEventListener('pointermove', move);
        k.addEventListener('pointerup', () => { k.removeEventListener('pointermove', move); History.commit('Pan'); }, { once: true });
      });
    });
    this.meters();
  },
  meters() {
    if (!this.el.isConnected) return;
    this.el.querySelectorAll('[data-meter]').forEach((cv) => {
      const id = cv.dataset.meter;
      const lv = Player.playing ? (id === 'master' ? [Player.levels.L, Player.levels.R] : [Player.levels.tracks[id] ?? -Infinity, Player.levels.tracks[id] ?? -Infinity]) : [-Infinity, -Infinity];
      drawMeter(cv, lv);
    });
  },
});

// ---------- Graphics (titles) ----------
definePanel('graphics', 'Graphics', {
  mount(el) {
    el.innerHTML = '<div class="gfx"></div>';
    Bus.on('selection', () => this.render());
    Bus.on('project', () => this.render());
    this.render();
  },
  clip() {
    const c = App.sel.size === 1 ? Model.clip([...App.sel][0]) : null;
    return c?.kind === 'title' ? c : null;
  },
  focusText() { this.el.querySelector('[data-t="text"]')?.select(); },
  render() {
    const body = this.el.querySelector('.gfx');
    if (body.contains(document.activeElement) && ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
    const c = this.clip();
    if (!c) {
      body.innerHTML = `<div class="gfx-empty"><p>Select a text clip to edit it.</p>
        <button class="pbtn pbtn-primary" data-new="title">${icon('text', 14)} New Text</button>
        <button class="pbtn" data-new="color">Color Matte</button>
        <button class="pbtn" data-new="adjustment">Adjustment Layer</button>
        <p class="muted">Tip: pick the Type tool (T) and click in the Program monitor.</p></div>`;
      body.querySelectorAll('[data-new]').forEach((b) => b.addEventListener('click', () => Edit.addSynthetic(b.dataset.new)));
      return;
    }
    const t = c.title;
    body.innerHTML = `
      <label class="gfx-row col"><span>Text</span><textarea data-t="text" rows="3">${esc(t.text)}</textarea></label>
      <div class="gfx-row"><select class="mon-select" data-t="font">${['Inter', 'Nunito Sans', 'Cantarell', 'DejaVu Sans', 'DejaVu Serif', 'Liberation Sans', 'Liberation Serif', 'Arial', 'Georgia', 'Impact', 'Segoe UI', 'Times New Roman', 'monospace'].map((f) => `<option ${f === t.font ? 'selected' : ''}>${f}</option>`).join('')}</select>
        <select class="mon-select" data-t="weight">${[300, 400, 600, 700, 900].map((w) => `<option value="${w}" ${w === t.weight ? 'selected' : ''}>${{ 300: 'Light', 400: 'Regular', 600: 'Semibold', 700: 'Bold', 900: 'Black' }[w]}</option>`).join('')}</select></div>
      <div class="gfx-row"><label>Size <input type="number" data-t="size" value="${t.size}" min="4" max="1000"></label>
        <label>Color <input type="color" data-t="color" value="${t.color}"></label>
        <span class="ob-seg">${['left', 'center', 'right'].map((a) => `<button class="ic-btn${t.align === a ? ' on' : ''}" data-align="${a}" title="Align ${a}">${a[0].toUpperCase()}</button>`).join('')}</span></div>
      <div class="gfx-row"><label>X <input type="number" data-t="x" value="${t.x}"></label><label>Y <input type="number" data-t="y" value="${t.y}"></label></div>
      <div class="gfx-sec">Appearance</div>
      <div class="gfx-row"><label class="pcheck"><input type="checkbox" data-t="stroke" ${t.stroke ? 'checked' : ''}> Stroke</label><input type="color" data-t="strokeColor" value="${t.strokeColor}"><input type="number" data-t="strokeWidth" value="${t.strokeWidth}" min="1" max="100"></div>
      <div class="gfx-row"><label class="pcheck"><input type="checkbox" data-t="shadow" ${t.shadow ? 'checked' : ''}> Shadow</label></div>
      <div class="gfx-row"><label class="pcheck"><input type="checkbox" data-t="box" ${t.box ? 'checked' : ''}> Background</label><input type="color" data-t="boxColor" value="${t.boxColor}"><label>Opacity <input type="number" data-t="boxOpacity" value="${t.boxOpacity}" min="0" max="100"></label></div>
      <div class="gfx-sec">Templates</div>
      <div class="gfx-row wrap">
        <button class="pbtn pbtn-sm" data-tpl="lower">Lower Third</button>
        <button class="pbtn pbtn-sm" data-tpl="center">Big Center Title</button>
        <button class="pbtn pbtn-sm" data-tpl="caption">Caption</button>
      </div>`;
    const apply = (key, value, live) => {
      History.begin();
      t[key] = value;
      App.invalidate();
      if (!live) History.commit('Edit Text');
    };
    body.querySelectorAll('[data-t]').forEach((input) => {
      const key = input.dataset.t;
      const read = () => (input.type === 'checkbox' ? input.checked : input.type === 'number' || key === 'weight' ? +input.value : input.value);
      input.addEventListener('input', () => apply(key, read(), true));
      input.addEventListener('change', () => { t[key] = read(); History.commit('Edit Text'); });
    });
    body.querySelectorAll('[data-align]').forEach((b) => b.addEventListener('click', () => History.step('Align Text', () => { t.align = b.dataset.align; })));
    body.querySelectorAll('[data-tpl]').forEach((b) => b.addEventListener('click', () => History.step('Apply Template', () => {
      const H = Model.seq.height, W = Model.seq.width;
      if (b.dataset.tpl === 'lower') Object.assign(t, { size: Math.round(H * 0.05), align: 'left', x: Math.round(-W * 0.38), y: Math.round(H * 0.33), box: true, boxColor: '#000000', boxOpacity: 65, shadow: false, weight: 600 });
      if (b.dataset.tpl === 'center') Object.assign(t, { size: Math.round(H * 0.12), align: 'center', x: 0, y: 0, box: false, shadow: true, weight: 900 });
      if (b.dataset.tpl === 'caption') Object.assign(t, { size: Math.round(H * 0.045), align: 'center', x: 0, y: Math.round(H * 0.4), box: true, boxColor: '#000000', boxOpacity: 55, shadow: false, weight: 500 });
    })));
  },
});

// ---------- History ----------
definePanel('history', 'History', {
  mount(el) {
    el.innerHTML = '<div class="hist"></div>';
    Bus.on('project', () => this.render());
    this.render();
  },
  render() {
    const undo = History.undoStack, redo = [...History.redoStack].reverse();
    const body = this.el.querySelector('.hist');
    body.innerHTML = `<button class="hist-row${undo.length ? '' : ' active'}" data-h="${-undo.length}">${icon('folder', 13)} Open</button>
      ${undo.map((e, i) => `<button class="hist-row${i === undo.length - 1 ? ' active' : ''}" data-h="${i + 1 - undo.length}">${icon('chevronRight', 12)} ${esc(e.name)}</button>`).join('')}
      ${redo.map((e, i) => `<button class="hist-row future" data-h="${i + 1}">${icon('chevronRight', 12)} ${esc(e.name)}</button>`).join('')}`;
    body.querySelectorAll('[data-h]').forEach((b) => b.addEventListener('click', () => {
      const n = +b.dataset.h;
      for (let i = 0; i < -n; i++) History.undo();
      for (let i = 0; i < n; i++) History.redo();
    }));
    body.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
  },
});

// ---------- Markers ----------
definePanel('markers', 'Markers', {
  mount(el) {
    el.innerHTML = '<div class="mk"></div>';
    Bus.on('project', () => this.render());
    this.render();
  },
  render() {
    const ms = Model.seq.markers;
    const body = this.el.querySelector('.mk');
    if (!ms.length) { body.innerHTML = '<p class="panel-empty">No markers. Press M to add one at the playhead.</p>'; return; }
    body.innerHTML = ms.map((m) => `<div class="mk-row" data-id="${m.id}"><span class="mk-dot" style="background:${m.color}"></span>
      <span class="mk-tc">${tc(m.frame)}</span><input class="mk-name" value="${esc(m.name)}" aria-label="Marker name"><button class="ic-btn sm" data-del title="Delete marker">${icon('trash', 12)}</button></div>`).join('');
    body.querySelectorAll('.mk-row').forEach((row) => {
      const m = ms.find((x) => x.id === row.dataset.id);
      row.querySelector('.mk-tc').addEventListener('click', () => Player.seek(m.frame));
      row.querySelector('.mk-name').addEventListener('change', (e) => History.step('Rename Marker', () => { m.name = e.target.value; }));
      row.querySelector('[data-del]').addEventListener('click', () => History.step('Delete Marker', () => { Model.seq.markers = Model.seq.markers.filter((x) => x.id !== m.id); }));
    });
  },
});

// ---------- Tools ----------
definePanel('tools', 'Tools', {
  mount(el) {
    el.innerHTML = `<div class="tools">${TOOLS.map(([id, name, key, ic]) => `<button class="tool-btn" data-tool="${id}" title="${name} (${key})">${icon(ic, 17)}</button>`).join('')}</div>`;
    el.querySelectorAll('[data-tool]').forEach((b) => b.addEventListener('click', () => App.setTool(b.dataset.tool)));
    Bus.on('tool', () => this.render());
    this.render();
  },
  render() {
    this.el.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === App.tool));
  },
});

// ---------- Dialogs ----------
function speedDialog() {
  const clips = Edit.selected().filter((c) => Model.isTimed(c));
  if (!clips.length) { toast('Select a video or audio clip first.'); return; }
  const c = clips[0];
  openDialog({
    title: 'Clip Speed / Duration',
    width: 400,
    body: `
      <div class="prow"><span class="prow-label">Speed</span><span class="pnum"><input type="number" name="speed" value="${Math.round(c.speed * 1000) / 10}" min="10" max="1000" step="1"><em>%</em></span></div>
      <div class="prow"><span class="prow-label">Duration</span><input class="pinput" name="dur" value="${tc(c.duration)}"></div>
      <p class="pdialog-note">Changing speed keeps the same footage and changes the clip length. Range 10–1000%.</p>`,
    onMount(api) {
      const f = api.form;
      f.speed.addEventListener('input', () => {
        const span = (c.duration / Model.fps) * c.speed;
        f.dur.value = tc(Math.round((span / (+f.speed.value / 100 || 1)) * Model.fps));
      });
      f.dur.addEventListener('change', () => {
        const d = parseTC(f.dur.value);
        if (!d) return;
        const span = (c.duration / Model.fps) * c.speed;
        f.speed.value = Math.round(((span * Model.fps) / d) * 1000) / 10;
      });
    },
    onOk(api) {
      Edit.setSpeed(Ops.withPartners(clips.map((x) => x.id), true), +api.form.speed.value / 100);
    },
  });
}

function sequenceSettingsDialog() {
  const seq = Model.seq;
  openDialog({
    title: 'Sequence Settings',
    width: 440,
    body: `
      <label class="prow"><span class="prow-label">Name</span><input class="pinput" name="name" value="${esc(seq.name)}"></label>
      <div class="prow"><span class="prow-label">Frame Size</span><span class="pnum"><input type="number" name="w" value="${seq.width}" min="16" max="7680"><em>w</em></span><span class="pnum"><input type="number" name="h" value="${seq.height}" min="16" max="4320"><em>h</em></span></div>
      <div class="prow"><span class="prow-label">Preset</span><select class="pselect" name="preset"><option value="">Custom</option><option value="1920x1080">HD 1080p</option><option value="1280x720">HD 720p</option><option value="3840x2160">4K UHD</option><option value="1080x1920">Vertical 1080×1920</option><option value="1080x1080">Square 1080</option></select></div>
      <div class="prow"><span class="prow-label">Timebase</span><select class="pselect" name="fps">${FPS_PRESETS.map((f) => `<option value="${f}" ${f === seq.fps ? 'selected' : ''}>${f} frames/second</option>`).join('')}</select></div>
      <p class="pdialog-note">Changing the timebase keeps clips at the same frame positions.</p>`,
    onMount(api) {
      api.form.preset.addEventListener('change', (e) => {
        if (!e.target.value) return;
        const [w, h] = e.target.value.split('x');
        api.form.w.value = w;
        api.form.h.value = h;
      });
    },
    onOk(api) {
      const f = api.form;
      History.step('Sequence Settings', () => {
        seq.name = f.name.value.trim() || seq.name;
        seq.width = clamp(Math.round(+f.w.value), 16, 7680);
        seq.height = clamp(Math.round(+f.h.value), 16, 4320);
        seq.fps = +f.fps.value;
      });
      Bus.emit('sequence');
    },
  });
}
