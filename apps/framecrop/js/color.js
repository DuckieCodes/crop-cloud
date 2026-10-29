// Color page tools (DaVinci-style): color wheels, primaries, curves, a serial
// node graph with power windows, LUTs, and video scopes.

const WHEELS = [
  { key: 'lift', label: 'Lift', range: 0.25, master: 0.5 },
  { key: 'gamma', label: 'Gamma', range: 0.5, master: 1 },
  { key: 'gain', label: 'Gain', range: 0.5, master: 1 },
  { key: 'offset', label: 'Offset', range: 0.25, master: 0.5 },
];

// A chroma push in vectorscope direction (u = Cb, v = Cr) as an RGB change with zero luma (Rec.709).
const chromaRGB = (u, v) => [1.5748 * v, -0.1873 * u - 0.4681 * v, 1.8556 * u];
const rgbToChroma = (r, g, b) => [b / 1.8556, r / 1.5748];

const ColorPage = {
  nodeIds: new Map(),

  // The clip being graded: like Resolve, the clip under the playhead (a selected one
  // there wins, otherwise the top track); with nothing under the playhead, the selection.
  clip() {
    const f = Model.seq.playhead;
    const under = [];
    for (const t of [...Model.tracks('video')].reverse()) {
      if (t.hidden) continue;
      const c = Model.clipAt(t.id, f);
      if (c && c.enabled) under.push(c);
    }
    return under.find((c) => App.sel.has(c.id)) || under[0] || Edit.selected().find((c) => c.kind !== 'audio') || null;
  },

  node(c = this.clip()) {
    if (!c) return null;
    const id = this.nodeIds.get(c.id);
    return c.grade.nodes.find((n) => n.id === id) || c.grade.nodes[0];
  },

  selectNode(c, n) {
    this.nodeIds.set(c.id, n.id);
    Bus.emit('grade');
  },

  // Live edit of the current node; one undo step per gesture.
  edit(fn, { live = false, name = 'Color Correction' } = {}) {
    const c = this.clip();
    const n = this.node(c);
    if (!n) { toast('Select a video clip (or park the playhead over one) to grade it.'); return; }
    History.begin();
    fn(n, c);
    App.invalidate();
    Bus.emit('grade-live');
    if (!live) History.commit(name);
  },

  commit(name = 'Color Correction') { History.commit(name); },

  addSerialNode() {
    const c = this.clip();
    if (!c) return;
    let n;
    History.step('Add Serial Node', () => {
      const cur = this.node(c);
      const i = c.grade.nodes.indexOf(cur);
      n = newGradeNode(c.grade.nodes.length + 1);
      c.grade.nodes.splice(i + 1, 0, n);
      c.grade.nodes.forEach((x, k) => { x.label = String(k + 1).padStart(2, '0'); });
    });
    this.selectNode(c, n);
  },

  deleteNode() {
    const c = this.clip();
    if (!c) return;
    const n = this.node(c);
    History.step('Delete Node', () => {
      if (c.grade.nodes.length === 1) Object.assign(n, { ...newGradeNode(1), id: n.id });
      else c.grade.nodes = c.grade.nodes.filter((x) => x !== n);
      c.grade.nodes.forEach((x, k) => { x.label = String(k + 1).padStart(2, '0'); });
    });
  },

  toggleNode() {
    const n = this.node();
    if (n) History.step(n.enabled ? 'Disable Node' : 'Enable Node', () => { n.enabled = !n.enabled; });
  },

  resetNode() {
    const n = this.node();
    if (n) History.step('Reset Node', () => { Object.assign(n, { ...newGradeNode(1), id: n.id, label: n.label }); });
  },

  resetGrade() {
    const c = this.clip();
    if (c) History.step('Reset Grade', () => { c.grade = { nodes: [newGradeNode(1)] }; });
  },

  copied: null,
  copyGrade() {
    const c = this.clip();
    if (!c) return;
    this.copied = structuredClone(c.grade);
    toast('Grade copied.');
  },

  pasteGrade(targets = Edit.selected().filter((c) => c.kind !== 'audio')) {
    if (!this.copied) { toast('Copy a grade first.'); return; }
    if (!targets.length) { const c = this.clip(); if (c) targets = [c]; }
    History.step('Paste Grade', () => {
      for (const c of targets) {
        c.grade = structuredClone(this.copied);
        c.grade.nodes.forEach((n) => { n.id = uid(); });
      }
    });
  },

  applyToAll() {
    const c = this.clip();
    if (!c) return;
    this.copied = structuredClone(c.grade);
    this.pasteGrade(Model.seq.clips.filter((x) => x.kind === 'video' || x.kind === 'image'));
  },

  async loadLUT() {
    const input = document.getElementById('file-input');
    input.accept = '.cube';
    input.multiple = false;
    input.onchange = async () => {
      const file = input.files[0];
      input.value = '';
      if (!file) return;
      try {
        const text = await file.text();
        const parsed = parseCube(text);
        const id = uid();
        const fileKey = `framecrop-lut:${id}`;
        await FileStore.put(fileKey, new Blob([text], { type: 'text/plain' })).catch(() => {});
        LutRT.set(id, parsed);
        History.step(`Load LUT ${file.name}`, () => {
          Model.data.luts.push({ id, name: file.name.replace(/\.cube$/i, ''), size: parsed.size, fileKey });
          const n = this.node();
          if (n) n.lutId = id;
        });
        toast(`Loaded ${file.name} (${parsed.size}³).`);
      } catch (err) {
        toast(`Couldn't read that LUT: ${err.message}`);
      }
    };
    input.click();
  },

  // ---------- Power window on the Program monitor ----------
  drawWindowOverlay(x, W, H) {
    if (App.workspace !== 'color') return;
    const n = this.node();
    if (!n || n.window.type === 'none') return;
    const w = n.window;
    x.save();
    x.strokeStyle = '#e8e8e8';
    x.setLineDash([5, 4]);
    x.lineWidth = 1;
    x.beginPath();
    if (w.type === 'circle') x.ellipse(w.x * W, w.y * H, (w.w * W) / 2, (w.h * H) / 2, 0, 0, Math.PI * 2);
    else x.rect((w.x - w.w / 2) * W, (w.y - w.h / 2) * H, w.w * W, w.h * H);
    x.stroke();
    x.strokeStyle = 'rgba(232,232,232,.4)';
    x.beginPath();
    const s = 1 + w.softness;
    if (w.type === 'circle') x.ellipse(w.x * W, w.y * H, (w.w * W * s) / 2, (w.h * H * s) / 2, 0, 0, Math.PI * 2);
    else x.rect((w.x - (w.w * s) / 2) * W, (w.y - (w.h * s) / 2) * H, w.w * W * s, w.h * H * s);
    x.stroke();
    x.setLineDash([]);
    x.fillStyle = '#e8e8e8';
    x.beginPath();
    x.arc(w.x * W, w.y * H, 4, 0, Math.PI * 2);
    x.fill();
    x.restore();
  },

  // Drag the window: inside moves it, near the edge resizes it.
  windowPointer(e, u, v) {
    if (App.workspace !== 'color') return false;
    const n = this.node();
    if (!n || n.window.type === 'none') return false;
    const w = n.window;
    const dx = (u - w.x) / (w.w / 2), dy = (v - w.y) / (w.h / 2);
    const r = w.type === 'circle' ? Math.hypot(dx, dy) : Math.max(Math.abs(dx), Math.abs(dy));
    if (r > 1.3) return false;
    const mode = r > 0.8 ? 'size' : 'move';
    const cv = e.currentTarget;
    const rect = cv.getBoundingClientRect();
    cv.setPointerCapture(e.pointerId);
    const o = { ...w };
    History.begin();
    const move = (ev) => {
      const uu = (ev.clientX - rect.left) / rect.width, vv = (ev.clientY - rect.top) / rect.height;
      if (mode === 'move') { w.x = o.x + uu - u; w.y = o.y + vv - v; }
      else { w.w = clamp(Math.abs(uu - o.x) * 2, 0.02, 3); w.h = clamp(Math.abs(vv - o.y) * 2, 0.02, 3); if (ev.shiftKey) w.h = w.w * (rect.width / rect.height); }
      App.invalidate();
      Panels.program.drawOverlay();
      Bus.emit('grade-live');
    };
    cv.addEventListener('pointermove', move);
    cv.addEventListener('pointerup', () => { cv.removeEventListener('pointermove', move); History.commit('Window'); Bus.emit('grade'); }, { once: true });
    return true;
  },
};

// ---------- Color wheels + primaries ----------
const PRIMARY_BARS = [
  ['contrast', 'Contrast', 0, 2, 0.001, 1],
  ['pivot', 'Pivot', 0, 1, 0.001, 0.435],
  ['saturation', 'Sat', 0, 2, 0.001, 1],
  ['hue', 'Hue', -180, 180, 0.1, 0],
  ['temperature', 'Temp', -100, 100, 0.1, 0],
  ['tint', 'Tint', -100, 100, 0.1, 0],
  ['exposure', 'Exposure', -4, 4, 0.01, 0],
];

definePanel('colorWheels', 'Color Wheels', {
  mount(el) {
    el.innerHTML = `
      <div class="cw">
        <div class="cw-head"><span class="cw-title" id="cw-title"></span><span class="tl-spacer"></span>
          <button class="pbtn pbtn-sm" data-cw="lut">Load LUT…</button>
          <button class="ic-btn" data-cw="reset" title="Reset node">${icon('reset', 14)}</button></div>
        <div class="cw-wheels">${WHEELS.map((w) => `
          <div class="wheel" data-wheel="${w.key}">
            <div class="wl-title">${w.label}</div>
            <canvas class="wl-canvas" width="150" height="150"></canvas>
            <canvas class="wl-master" width="150" height="14" title="Drag to change ${w.label} master; double-click to reset"></canvas>
            <div class="wl-vals"><span data-v="3">0.00</span><span data-v="0" class="r">0.00</span><span data-v="1" class="g">0.00</span><span data-v="2" class="b">0.00</span></div>
          </div>`).join('')}</div>
        <div class="cw-bars">${PRIMARY_BARS.map(([k, label, min, max, step]) => `
          <label class="cw-bar"><span class="scrubby" data-scrub="${k}">${label}</span><input type="number" data-bar="${k}" min="${min}" max="${max}" step="${step}"></label>`).join('')}
          <label class="cw-bar"><span>LUT</span><select class="mon-select" data-lut></select></label>
          <label class="cw-bar"><span class="scrubby" data-scrub="lutMix">LUT Mix</span><input type="number" data-bar="lutMix" min="0" max="1" step="0.01"></label>
          <label class="cw-bar"><span class="scrubby" data-scrub="mix">Key Out</span><input type="number" data-bar="mix" min="0" max="1" step="0.01"></label>
        </div>
      </div>`;
    el.querySelector('[data-cw="lut"]').addEventListener('click', () => ColorPage.loadLUT());
    el.querySelector('[data-cw="reset"]').addEventListener('click', () => ColorPage.resetNode());
    for (const w of WHEELS) this.bindWheel(el.querySelector(`[data-wheel="${w.key}"]`), w);
    el.querySelectorAll('[data-bar]').forEach((input) => {
      const k = input.dataset.bar;
      input.addEventListener('input', () => { const v = +input.value; if (!Number.isNaN(v)) ColorPage.edit((n) => { n[k] = clamp(v, +input.min, +input.max); }, { live: true }); });
      input.addEventListener('change', () => ColorPage.commit());
      makeScrubby(el.querySelector(`[data-scrub="${k}"]`), input, { min: +input.min, max: +input.max, step: +input.step });
      el.querySelector(`[data-scrub="${k}"]`).addEventListener('dblclick', () => {
        const def = PRIMARY_BARS.find((b) => b[0] === k)?.[5] ?? 1;
        ColorPage.edit((n) => { n[k] = def; });
      });
    });
    el.querySelector('[data-lut]').addEventListener('change', (e) => ColorPage.edit((n) => { n.lutId = e.target.value || null; }, { name: 'Apply LUT' }));
    for (const evt of ['grade', 'selection', 'project', 'playhead']) Bus.on(evt, () => this.render());
    Bus.on('grade-live', () => this.render(true));
    this.render();
  },

  bindWheel(root, w) {
    const cv = root.querySelector('.wl-canvas');
    const master = root.querySelector('.wl-master');
    const setFromPointer = (ev) => {
      const r = cv.getBoundingClientRect();
      let px = ((ev.clientX - r.left) / r.width) * 2 - 1;
      let py = -(((ev.clientY - r.top) / r.height) * 2 - 1);
      const len = Math.hypot(px, py);
      if (len > 1) { px /= len; py /= len; }
      const k = ev.shiftKey ? 0.25 : 1;
      const [dr, dg, db] = chromaRGB(px * w.range * 0.5 * k, py * w.range * 0.5 * k);
      ColorPage.edit((n) => { n[w.key][0] = dr; n[w.key][1] = dg; n[w.key][2] = db; }, { live: true });
    };
    cv.addEventListener('pointerdown', (e) => {
      cv.setPointerCapture(e.pointerId);
      setFromPointer(e);
      cv.addEventListener('pointermove', setFromPointer);
      cv.addEventListener('pointerup', () => { cv.removeEventListener('pointermove', setFromPointer); ColorPage.commit(`${w.label} Wheel`); }, { once: true });
    });
    cv.addEventListener('dblclick', () => ColorPage.edit((n) => { n[w.key][0] = n[w.key][1] = n[w.key][2] = 0; }, { name: `Reset ${w.label}` }));
    master.addEventListener('pointerdown', (e) => {
      master.setPointerCapture(e.pointerId);
      const n0 = ColorPage.node();
      if (!n0) return;
      const start = e.clientX, v0 = n0[w.key][3];
      const move = (ev) => ColorPage.edit((n) => { n[w.key][3] = clamp(v0 + ((ev.clientX - start) / 150) * w.master * (ev.shiftKey ? 0.2 : 1), -w.master, w.master); }, { live: true });
      master.addEventListener('pointermove', move);
      master.addEventListener('pointerup', () => { master.removeEventListener('pointermove', move); ColorPage.commit(`${w.label} Master`); }, { once: true });
    });
    master.addEventListener('dblclick', () => ColorPage.edit((n) => { n[w.key][3] = 0; }, { name: `Reset ${w.label}` }));
  },

  render(liveOnly) {
    if (!this.el.isConnected) return;
    const c = ColorPage.clip();
    const n = ColorPage.node(c);
    this.el.querySelector('#cw-title').innerHTML = c ? `Primaries — <b>${esc(c.kind === 'title' ? c.title.text.split('\n')[0] : c.name)}</b> · Node ${n.label}${n.enabled ? '' : ' (off)'}` : 'Primaries — no clip under the playhead';
    for (const w of WHEELS) {
      const root = this.el.querySelector(`[data-wheel="${w.key}"]`);
      this.drawWheel(root.querySelector('.wl-canvas'), w, n);
      this.drawMaster(root.querySelector('.wl-master'), w, n);
      root.querySelectorAll('[data-v]').forEach((s) => {
        const i = +s.dataset.v;
        const v = n ? (i === 3 ? n[w.key][3] : n[w.key][i] + n[w.key][3]) : 0;
        s.textContent = (w.key === 'gamma' || w.key === 'gain' ? 1 + v : v).toFixed(2);
      });
    }
    this.el.querySelectorAll('[data-bar]').forEach((input) => {
      if (document.activeElement !== input) input.value = n ? +(n[input.dataset.bar]).toFixed(3) : '';
      input.disabled = !n;
    });
    if (!liveOnly) {
      const sel = this.el.querySelector('[data-lut]');
      sel.innerHTML = `<option value="">None</option>${Model.data.luts.map((l) => `<option value="${l.id}" ${n?.lutId === l.id ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}`;
      sel.disabled = !n;
    }
  },

  drawWheel(cv, w, n) {
    const x = ctxOf(cv);
    const S = cv.width, R = S / 2 - 6, C = S / 2;
    x.clearRect(0, 0, S, S);
    for (let a = 0; a < 360; a += 2) {
      const rad = (a * Math.PI) / 180;
      const [r, g, b] = chromaRGB(Math.cos(rad), Math.sin(rad));
      const m = Math.max(Math.abs(r), Math.abs(g), Math.abs(b));
      x.strokeStyle = `rgb(${[r, g, b].map((v) => Math.round(clamp(128 + (v / m) * 110, 0, 255))).join(',')})`;
      x.lineWidth = 4;
      x.beginPath();
      x.arc(C, C, R, -rad - 0.02, -rad + 0.04 + 0.02);
      x.stroke();
    }
    const grad = x.createRadialGradient(C, C, 0, C, C, R - 3);
    grad.addColorStop(0, '#3a3a3a');
    grad.addColorStop(1, '#1d1d1d');
    x.fillStyle = grad;
    x.beginPath();
    x.arc(C, C, R - 3, 0, Math.PI * 2);
    x.fill();
    x.strokeStyle = 'rgba(255,255,255,.12)';
    x.lineWidth = 1;
    x.beginPath();
    x.moveTo(C - R + 6, C); x.lineTo(C + R - 6, C);
    x.moveTo(C, C - R + 6); x.lineTo(C, C + R - 6);
    x.stroke();
    if (!n) return;
    const [u, v] = rgbToChroma(n[w.key][0], n[w.key][1], n[w.key][2]);
    const px = clamp(u / (w.range * 0.5), -1, 1), py = clamp(v / (w.range * 0.5), -1, 1);
    const dot = { x: C + px * (R - 6), y: C - py * (R - 6) };
    x.strokeStyle = '#e9e9e9';
    x.lineWidth = 1.5;
    x.beginPath();
    x.arc(dot.x, dot.y, 6, 0, Math.PI * 2);
    x.stroke();
    if (px || py) { x.strokeStyle = 'rgba(255,255,255,.35)'; x.beginPath(); x.moveTo(C, C); x.lineTo(dot.x, dot.y); x.stroke(); }
  },

  drawMaster(cv, w, n) {
    const x = ctxOf(cv);
    x.fillStyle = '#1b1b1b';
    x.fillRect(0, 0, cv.width, cv.height);
    x.fillStyle = '#2c2c2c';
    for (let i = 0; i < cv.width; i += 6) x.fillRect(i, 3, 3, cv.height - 6);
    if (!n) return;
    const v = n[w.key][3] / w.master;
    x.fillStyle = '#d9d9d9';
    x.fillRect(cv.width / 2 + v * (cv.width / 2 - 2) - 1, 0, 3, cv.height);
  },
});

// ---------- Curves ----------
definePanel('curves', 'Curves', {
  channel: 'y',
  mount(el) {
    el.innerHTML = `
      <div class="cv">
        <div class="cw-head"><span class="cw-title">Curves — Custom</span><span class="tl-spacer"></span>
          ${['y', 'r', 'g', 'b'].map((ch) => `<button class="cv-ch ch-${ch}" data-ch="${ch}">${ch.toUpperCase()}</button>`).join('')}
          <button class="ic-btn" data-cv="reset" title="Reset this curve">${icon('reset', 14)}</button></div>
        <div class="cv-wrap"><canvas class="cv-canvas" width="256" height="256"></canvas></div>
        <p class="cv-hint">Click to add points · drag a point off the graph to remove it</p>
      </div>`;
    this.cv = el.querySelector('canvas');
    el.querySelectorAll('[data-ch]').forEach((b) => b.addEventListener('click', () => { this.channel = b.dataset.ch; this.render(); }));
    el.querySelector('[data-cv="reset"]').addEventListener('click', () => ColorPage.edit((n) => { n.curves[this.channel] = [[0, 0], [255, 255]]; }, { name: 'Reset Curve' }));
    this.bind();
    for (const evt of ['grade', 'grade-live', 'selection', 'project', 'playhead', 'layout']) Bus.on(evt, () => this.render());
    new ResizeObserver(() => this.render()).observe(el.querySelector('.cv-wrap'));
    this.render();
  },
  bind() {
    const cv = this.cv;
    let drag = -1;
    const pt = (e) => {
      const r = cv.getBoundingClientRect();
      return { x: ((e.clientX - r.left) / r.width) * 255, y: 255 - ((e.clientY - r.top) / r.height) * 255, out: e.clientX < r.left - 24 || e.clientX > r.right + 24 || e.clientY < r.top - 24 || e.clientY > r.bottom + 24 };
    };
    cv.addEventListener('pointerdown', (e) => {
      const n = ColorPage.node();
      if (!n) return;
      cv.setPointerCapture(e.pointerId);
      const p = pt(e);
      const list = n.curves[this.channel];
      History.begin();
      drag = list.findIndex(([x, y]) => Math.hypot(x - p.x, y - p.y) < 10);
      if (drag < 0) {
        const t = curveTable(list);
        const xr = Math.round(clamp(p.x, 1, 254));
        list.push([xr, t[xr]]);
        list.sort((a, b) => a[0] - b[0]);
        drag = list.findIndex(([x]) => x === xr);
        App.invalidate();
      }
      this.render();
    });
    cv.addEventListener('pointermove', (e) => {
      if (drag < 0) return;
      const n = ColorPage.node();
      const list = n.curves[this.channel];
      const p = pt(e);
      const end = drag === 0 || drag === list.length - 1;
      if (p.out && !end && list.length > 2) { list.splice(drag, 1); drag = -1; }
      else {
        const lo = drag > 0 ? list[drag - 1][0] + 1 : 0, hi = drag < list.length - 1 ? list[drag + 1][0] - 1 : 255;
        list[drag] = [Math.round(clamp(p.x, lo, hi)), Math.round(clamp(p.y, 0, 255))];
      }
      App.invalidate();
      this.render();
    });
    cv.addEventListener('pointerup', () => { if (drag !== -2) { drag = -1; ColorPage.commit('Curves'); } });
  },
  render() {
    if (!this.el.isConnected) return;
    const wrap = this.el.querySelector('.cv-wrap');
    const side = Math.max(60, Math.min(wrap.clientWidth, wrap.clientHeight) - 12);
    this.cv.style.width = this.cv.style.height = `${side}px`;
    this.el.querySelectorAll('[data-ch]').forEach((b) => b.classList.toggle('on', b.dataset.ch === this.channel));
    const x = ctxOf(this.cv);
    x.fillStyle = '#161616';
    x.fillRect(0, 0, 256, 256);
    x.strokeStyle = 'rgba(255,255,255,.08)';
    x.beginPath();
    for (let i = 1; i < 4; i++) { x.moveTo(i * 64 + 0.5, 0); x.lineTo(i * 64 + 0.5, 256); x.moveTo(0, i * 64 + 0.5); x.lineTo(256, i * 64 + 0.5); }
    x.moveTo(0, 256); x.lineTo(256, 0);
    x.stroke();
    const n = ColorPage.node();
    if (!n) return;
    const colors = { y: '#e8e8e8', r: '#ff5b5b', g: '#4cd964', b: '#4c8dff' };
    for (const ch of ['y', 'r', 'g', 'b']) {
      if (ch === this.channel) continue;
      const pts = n.curves[ch];
      if (pts.length === 2 && pts[0][1] === 0 && pts[1][1] === 255) continue;
      x.strokeStyle = colors[ch] + '55';
      this.stroke(x, curveTable(pts));
    }
    x.strokeStyle = colors[this.channel];
    x.lineWidth = 2;
    this.stroke(x, curveTable(n.curves[this.channel]));
    x.lineWidth = 1;
    for (const [px, py] of n.curves[this.channel]) {
      x.fillStyle = '#fff';
      x.beginPath();
      x.arc(px, 255 - py, 4, 0, Math.PI * 2);
      x.fill();
    }
  },
  stroke(x, t) {
    x.beginPath();
    for (let i = 0; i < 256; i++) (i ? x.lineTo : x.moveTo).call(x, i, 255 - t[i]);
    x.stroke();
  },
});

// ---------- Nodes ----------
definePanel('nodes', 'Nodes', {
  mount(el) {
    el.innerHTML = `
      <div class="nd">
        <div class="cw-head"><span class="cw-title">Node Graph</span><span class="tl-spacer"></span>
          <button class="pbtn pbtn-sm" data-nd="add" title="Add Serial Node (Alt+S)">+ Serial Node</button>
          <button class="ic-btn" data-nd="toggle" title="Enable/Disable Node (Ctrl+D)">${icon('eye', 14)}</button>
          <button class="ic-btn" data-nd="delete" title="Delete Node">${icon('trash', 14)}</button>
          <button class="ic-btn" data-nd="menu" title="Grade menu">${icon('chevronDown', 14)}</button></div>
        <div class="nd-graph" id="nd-graph"></div>
        <div class="nd-window">
          <span class="nd-wtitle">${icon('window', 14)} Window</span>
          <select class="mon-select" data-w="type"><option value="none">None</option><option value="circle">Circle</option><option value="rect">Linear (Rectangle)</option></select>
          <label>X <input type="number" data-w="x" step="0.01"></label><label>Y <input type="number" data-w="y" step="0.01"></label>
          <label>W <input type="number" data-w="w" step="0.01" min="0.02"></label><label>H <input type="number" data-w="h" step="0.01" min="0.02"></label>
          <label>Soft <input type="number" data-w="softness" step="0.01" min="0" max="1"></label>
          <label class="pcheck"><input type="checkbox" data-w="invert"> Invert</label>
        </div>
      </div>`;
    el.querySelectorAll('[data-nd]').forEach((b) => b.addEventListener('click', (e) => {
      const a = b.dataset.nd;
      if (a === 'add') ColorPage.addSerialNode();
      if (a === 'toggle') ColorPage.toggleNode();
      if (a === 'delete') ColorPage.deleteNode();
      if (a === 'menu') {
        const r = e.currentTarget.getBoundingClientRect();
        Menus.open([
          { label: 'Reset Node', run: () => ColorPage.resetNode() },
          { label: 'Reset Grade (all nodes)', run: () => ColorPage.resetGrade() },
          { sep: true },
          { label: 'Copy Grade', run: () => ColorPage.copyGrade() },
          { label: 'Paste Grade', run: () => ColorPage.pasteGrade() },
          { label: 'Apply Grade to All Clips', run: () => ColorPage.applyToAll() },
          { sep: true },
          { label: 'Load LUT…', run: () => ColorPage.loadLUT() },
        ], r.left - 160, r.bottom);
      }
    }));
    el.querySelectorAll('[data-w]').forEach((input) => {
      const k = input.dataset.w;
      const read = () => (input.type === 'checkbox' ? input.checked : input.tagName === 'SELECT' ? input.value : +input.value);
      const evt = input.type === 'number' ? 'input' : 'change';
      input.addEventListener(evt, () => ColorPage.edit((n) => { n.window[k] = read(); }, { live: input.type === 'number', name: 'Window' }));
      input.addEventListener('change', () => { if (input.type === 'number') ColorPage.commit('Window'); Panels.program.drawOverlay(); });
    });
    for (const evt of ['grade', 'selection', 'project', 'playhead']) Bus.on(evt, () => this.render());
    Bus.on('grade-live', () => this.render(true));
    this.render();
  },
  render(liveOnly) {
    if (!this.el.isConnected) return;
    const c = ColorPage.clip();
    const cur = ColorPage.node(c);
    const graph = this.el.querySelector('#nd-graph');
    if (!liveOnly) {
      graph.innerHTML = c ? `
        <span class="nd-io">${icon('film', 13)}</span>
        ${c.grade.nodes.map((n) => `<span class="nd-link"></span><button class="nd-node${n === cur ? ' sel' : ''}${n.enabled ? '' : ' off'}" data-node="${n.id}">
          <span class="nd-num">${n.label}</span>
          <span class="nd-icons">${nodeIsNeutral(n) ? '' : '<i class="nd-dot" title="Has corrections"></i>'}${n.lutId ? '<i title="LUT">L</i>' : ''}${n.window.type !== 'none' ? '<i title="Window">◎</i>' : ''}</span>
        </button>`).join('')}
        <span class="nd-link"></span><span class="nd-io out">${icon('chevronRight', 13)}</span>`
        : '<p class="panel-empty">No clip to grade at the playhead.</p>';
      graph.querySelectorAll('[data-node]').forEach((b) => b.addEventListener('click', () => ColorPage.selectNode(c, c.grade.nodes.find((n) => n.id === b.dataset.node))));
    }
    this.el.querySelectorAll('[data-w]').forEach((input) => {
      input.disabled = !cur;
      if (!cur || document.activeElement === input) return;
      const v = cur.window[input.dataset.w];
      if (input.type === 'checkbox') input.checked = v;
      else input.value = typeof v === 'number' ? +v.toFixed(3) : v;
    });
    Panels.program?.drawOverlay?.();
  },
});

// ---------- Scopes ----------
definePanel('scopes', 'Scopes', {
  mode: 'parade',
  mount(el) {
    el.innerHTML = `
      <div class="sc">
        <div class="cw-head"><select class="mon-select" data-scope>
          <option value="waveform">Waveform</option><option value="parade">RGB Parade</option><option value="vector">Vectorscope</option><option value="histogram">Histogram</option>
        </select><span class="tl-spacer"></span><span class="sc-note">Updates with the Program monitor</span></div>
        <canvas class="sc-canvas"></canvas>
      </div>`;
    this.cv = el.querySelector('canvas');
    const sel = el.querySelector('[data-scope]');
    sel.value = this.mode;
    sel.addEventListener('change', () => { this.mode = sel.value; this.draw(); });
    Bus.on('scope', () => this.schedule());
    new ResizeObserver(() => this.draw()).observe(this.cv);
  },
  schedule() {
    if (this.pending) return;
    this.pending = setTimeout(() => { this.pending = 0; this.draw(); }, 60);
  },
  draw() {
    const cv = this.cv;
    if (!cv || !this.el.isConnected) return;
    const W = Math.max(64, cv.clientWidth), H = Math.max(64, cv.clientHeight);
    cv.width = W;
    cv.height = H;
    const x = ctxOf(cv);
    x.fillStyle = '#0d0d0d';
    x.fillRect(0, 0, W, H);
    const s = GL.lastScope;
    const grid = (lines) => {
      x.strokeStyle = 'rgba(255,255,255,.12)';
      x.fillStyle = 'rgba(255,255,255,.35)';
      x.font = '9px Inter, sans-serif';
      x.beginPath();
      for (const v of lines) { const y = Math.round(H - 8 - (v / 1023) * (H - 16)) + 0.5; x.moveTo(26, y); x.lineTo(W, y); x.fillText(String(v), 2, y + 3); }
      x.stroke();
    };
    if (!s) return;
    const { px, w, h } = s;
    if (this.mode === 'waveform' || this.mode === 'parade') {
      grid([0, 256, 512, 768, 1023]);
      const parts = this.mode === 'parade' ? 3 : 1;
      const cols = Math.floor((W - 30) / parts);
      const rows = H - 16;
      const img = x.getImageData(28, 8, cols * parts, rows);
      const acc = new Float32Array(cols * parts * rows * 3);
      for (let yy = 0; yy < h; yy++) {
        for (let xx = 0; xx < w; xx++) {
          const i = (yy * w + xx) * 4;
          const col = Math.floor((xx / w) * cols);
          if (parts === 1) {
            const l = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
            const row = rows - 1 - Math.round((l / 255) * (rows - 1));
            const k = (row * cols + col) * 3;
            acc[k] += 1; acc[k + 1] += 1; acc[k + 2] += 1;
          } else {
            for (let c = 0; c < 3; c++) {
              const row = rows - 1 - Math.round((px[i + c] / 255) * (rows - 1));
              acc[(row * cols * 3 + c * cols + col) * 3 + c] += 1;
            }
          }
        }
      }
      const gain = (cols * rows) / (w * h) * 40;
      const tint = parts === 1 ? [0.55, 1, 0.6] : null;
      for (let i = 0; i < acc.length / 3; i++) {
        const o = i * 4;
        for (let c = 0; c < 3; c++) {
          const v = acc[i * 3 + c] * gain * (tint ? tint[c] : 1);
          if (v) img.data[o + c] = Math.min(255, img.data[o + c] + v);
        }
        if (acc[i * 3] || acc[i * 3 + 1] || acc[i * 3 + 2]) img.data[o + 3] = 255;
      }
      x.putImageData(img, 28, 8);
    } else if (this.mode === 'vector') {
      const S = Math.min(W, H) - 16, cx = W / 2, cy = H / 2, R = S / 2;
      x.strokeStyle = 'rgba(255,255,255,.18)';
      x.beginPath(); x.arc(cx, cy, R, 0, Math.PI * 2); x.moveTo(cx - R, cy); x.lineTo(cx + R, cy); x.moveTo(cx, cy - R); x.lineTo(cx, cy + R); x.stroke();
      const toUV = (r, g, b) => [(-0.1146 * r - 0.3854 * g + 0.5 * b) / 255, (0.5 * r - 0.4542 * g - 0.0458 * b) / 255];
      const targets = { R: [191, 0, 0], Mg: [191, 0, 191], B: [0, 0, 191], Cy: [0, 191, 191], G: [0, 191, 0], Yl: [191, 191, 0] };
      x.font = '10px Inter, sans-serif';
      for (const [name, [r, g, b]] of Object.entries(targets)) {
        const [u, v] = toUV(r, g, b);
        const tx = cx + u * R * 1.9, ty = cy - v * R * 1.9;
        x.strokeStyle = 'rgba(255,255,255,.4)';
        x.strokeRect(tx - 5, ty - 5, 10, 10);
        x.fillStyle = 'rgba(255,255,255,.5)';
        x.fillText(name, tx + 7, ty + 3);
      }
      // Skin tone line.
      x.strokeStyle = 'rgba(255,200,150,.35)';
      x.beginPath(); x.moveTo(cx, cy); x.lineTo(cx + Math.cos((123 * Math.PI) / 180) * R, cy - Math.sin((123 * Math.PI) / 180) * R); x.stroke();
      const img = x.getImageData(0, 0, W, H);
      for (let i = 0; i < px.length; i += 4) {
        const [u, v] = toUV(px[i], px[i + 1], px[i + 2]);
        const X = Math.round(cx + u * R * 1.9), Y = Math.round(cy - v * R * 1.9);
        if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
        const o = (Y * W + X) * 4;
        img.data[o] = Math.min(255, img.data[o] + px[i] * 0.25 + 20);
        img.data[o + 1] = Math.min(255, img.data[o + 1] + px[i + 1] * 0.25 + 20);
        img.data[o + 2] = Math.min(255, img.data[o + 2] + px[i + 2] * 0.25 + 20);
      }
      x.putImageData(img, 0, 0);
    } else {
      const hist = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
      for (let i = 0; i < px.length; i += 4) { hist[0][px[i]]++; hist[1][px[i + 1]]++; hist[2][px[i + 2]]++; }
      const max = Math.max(1, ...hist.map((hh) => Math.max(...hh)));
      x.globalCompositeOperation = 'lighter';
      ['rgba(255,70,70,.7)', 'rgba(70,220,90,.7)', 'rgba(70,130,255,.7)'].forEach((color, c) => {
        x.fillStyle = color;
        x.beginPath();
        x.moveTo(0, H);
        for (let i = 0; i < 256; i++) x.lineTo((i / 255) * W, H - Math.sqrt(hist[c][i] / max) * (H - 10));
        x.lineTo(W, H);
        x.fill();
      });
      x.globalCompositeOperation = 'source-over';
    }
  },
});
