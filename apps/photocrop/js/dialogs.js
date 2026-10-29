// Photoshop-style dialogs: New, Image Size, Canvas Size, Fill, Stroke, selection modify,
// adjustments and filters with live preview, Export As, Color Picker.

function rafThrottle(fn) {
  let queued = false;
  return () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; fn(); });
  };
}

// ---------- New document ----------
const DOC_PRESETS = [
  ['Default PhotoCrop size', 1920, 1080, 72],
  ['Instagram post', 1080, 1080, 72],
  ['Instagram story', 1080, 1920, 72],
  ['YouTube thumbnail', 1280, 720, 72],
  ['HD 1080p', 1920, 1080, 72],
  ['4K UHD', 3840, 2160, 72],
  ['A4 (300 ppi)', 2480, 3508, 300],
  ['Letter (300 ppi)', 2550, 3300, 300],
  ['Web 1366 × 768', 1366, 768, 72],
  ['Icon 512', 512, 512, 72],
];

function newDocumentDialog(init = {}) {
  let bg = init.background || 'white';
  const w0 = init.width || 1920, h0 = init.height || 1080;
  openDialog({
    title: 'New Document',
    width: 620,
    okLabel: 'Create',
    body: `
      <div class="newdoc">
        <div class="newdoc-list">${DOC_PRESETS.map(([n, w, h, dpi], i) => `
          <button type="button" class="newdoc-preset" data-i="${i}"><b>${esc(n)}</b><span>${w} × ${h} px · ${dpi} ppi</span></button>`).join('')}</div>
        <div class="newdoc-fields">
          <label class="prow"><span class="prow-label">Name</span><input class="pinput" name="name" value="${esc(init.name || App.nextUntitled())}" autofocus></label>
          <div class="prow"><span class="prow-label">Width</span><span class="pnum"><input type="number" name="width" min="1" max="30000" value="${w0}"><em>px</em></span></div>
          <div class="prow"><span class="prow-label">Height</span><span class="pnum"><input type="number" name="height" min="1" max="30000" value="${h0}"><em>px</em></span>
            <button type="button" class="picon-btn" data-swap title="Swap orientation">${icon('swap', 15)}</button></div>
          <div class="prow"><span class="prow-label">Resolution</span><span class="pnum"><input type="number" name="dpi" min="1" max="2400" value="${init.dpi || 72}"><em>ppi</em></span></div>
          <div class="prow"><span class="prow-label">Background</span>
            <select class="pselect" name="bg">
              ${[['white', 'White'], ['black', 'Black'], ['bgcolor', 'Background Color'], ['transparent', 'Transparent']].map(([v, l]) => `<option value="${v}" ${v === bg ? 'selected' : ''}>${l}</option>`).join('')}
            </select></div>
          <p class="pdialog-note" data-info></p>
        </div>
      </div>`,
    onMount(api) {
      const f = api.form;
      const info = () => {
        const w = +f.width.value, h = +f.height.value;
        api.el.querySelector('[data-info]').textContent = w > 0 && h > 0 ? `Image size: ${formatBytes(w * h * 4)}` : '';
      };
      api.el.querySelectorAll('.newdoc-preset').forEach((b) => b.addEventListener('click', () => {
        const [, w, h, dpi] = DOC_PRESETS[b.dataset.i];
        f.width.value = w; f.height.value = h; f.dpi.value = dpi;
        info();
      }));
      api.el.querySelector('[data-swap]').addEventListener('click', () => {
        [f.width.value, f.height.value] = [f.height.value, f.width.value];
        info();
      });
      f.addEventListener('input', info);
      info();
    },
    onOk(api) {
      const f = api.form;
      const w = Math.round(+f.width.value), h = Math.round(+f.height.value);
      if (!(w >= 1 && h >= 1 && w <= 30000 && h <= 30000)) { toast('Width and height must be between 1 and 30000 pixels.'); return false; }
      App.newDocument({ name: f.name.value.trim() || 'Untitled', width: w, height: h, dpi: +f.dpi.value || 72, background: f.bg.value });
    },
  });
}

// ---------- Image Size ----------
function imageSizeDialog() {
  const doc = App.doc;
  let linked = true;
  const ratio = doc.width / doc.height;
  openDialog({
    title: 'Image Size',
    width: 440,
    body: `
      <p class="pdialog-note">Current size: ${doc.width} × ${doc.height} px (${formatBytes(doc.width * doc.height * 4)})</p>
      <div class="prow"><span class="prow-label">Fit to</span>
        <select class="pselect" name="fit"><option value="">Custom</option><option value="0.5">50%</option><option value="0.25">25%</option><option value="2">200%</option>
        <option value="1920">1920 px long edge</option><option value="1080">1080 px long edge</option><option value="800">800 px long edge</option></select></div>
      <div class="link-group">
        <div>
          <div class="prow"><span class="prow-label">Width</span><span class="pnum"><input type="number" name="width" min="1" max="30000" value="${doc.width}"><em>px</em></span></div>
          <div class="prow"><span class="prow-label">Height</span><span class="pnum"><input type="number" name="height" min="1" max="30000" value="${doc.height}"><em>px</em></span></div>
        </div>
        <button type="button" class="link-btn active" data-link title="Constrain proportions">${icon('link', 15)}</button>
      </div>
      <div class="prow"><span class="prow-label">Resolution</span><span class="pnum"><input type="number" name="dpi" min="1" max="2400" value="${doc.dpi}"><em>ppi</em></span></div>
      <div class="prow"><span class="prow-label">Resample</span>
        <select class="pselect" name="resample"><option value="high">Automatic (bicubic)</option><option value="low">Bilinear</option><option value="none">Nearest Neighbor (hard edges)</option></select></div>
      <p class="pdialog-note" data-info></p>`,
    onMount(api) {
      const f = api.form;
      const info = () => { api.el.querySelector('[data-info]').textContent = `New size: ${formatBytes(Math.max(0, +f.width.value * +f.height.value * 4))}`; };
      api.el.querySelector('[data-link]').addEventListener('click', (e) => {
        linked = !linked;
        e.currentTarget.classList.toggle('active', linked);
      });
      f.width.addEventListener('input', () => { if (linked) f.height.value = Math.max(1, Math.round(+f.width.value / ratio)); info(); });
      f.height.addEventListener('input', () => { if (linked) f.width.value = Math.max(1, Math.round(+f.height.value * ratio)); info(); });
      f.fit.addEventListener('change', () => {
        const v = +f.fit.value;
        if (!v) return;
        const k = v <= 4 ? v : v / Math.max(doc.width, doc.height);
        f.width.value = Math.max(1, Math.round(doc.width * k));
        f.height.value = Math.max(1, Math.round(doc.height * k));
        info();
      });
      info();
    },
    onOk(api) {
      const f = api.form;
      const w = Math.round(+f.width.value), h = Math.round(+f.height.value);
      if (!(w >= 1 && h >= 1 && w <= 30000 && h <= 30000)) { toast('Width and height must be between 1 and 30000 pixels.'); return false; }
      ImageOps.resize(doc, w, h, f.resample.value, +f.dpi.value || doc.dpi);
    },
  });
}

// ---------- Canvas Size ----------
function canvasSizeDialog() {
  const doc = App.doc;
  let anchor = [1, 1];
  openDialog({
    title: 'Canvas Size',
    width: 440,
    body: `
      <p class="pdialog-note">Current size: ${doc.width} × ${doc.height} px</p>
      <div class="prow"><span class="prow-label">Width</span><span class="pnum"><input type="number" name="width" value="${doc.width}"><em>px</em></span></div>
      <div class="prow"><span class="prow-label">Height</span><span class="pnum"><input type="number" name="height" value="${doc.height}"><em>px</em></span></div>
      <label class="pcheck prow-check"><input type="checkbox" name="relative"> Relative</label>
      <div class="prow"><span class="prow-label">Anchor</span><div class="anchor-grid">${[0, 1, 2].map((y) => [0, 1, 2].map((x) => `<button type="button" data-ax="${x}" data-ay="${y}" class="${x === 1 && y === 1 ? 'on' : ''}"></button>`).join('')).join('')}</div></div>
      <div class="prow"><span class="prow-label">Extension color</span>
        <select class="pselect" name="fill"><option value="transparent">Transparent</option><option value="bg">Background</option><option value="fg">Foreground</option><option value="white">White</option><option value="black">Black</option></select></div>`,
    onMount(api) {
      const f = api.form;
      f.relative.addEventListener('change', () => {
        f.width.value = f.relative.checked ? 0 : doc.width;
        f.height.value = f.relative.checked ? 0 : doc.height;
      });
      api.el.querySelectorAll('.anchor-grid button').forEach((b) => b.addEventListener('click', () => {
        anchor = [+b.dataset.ax, +b.dataset.ay];
        api.el.querySelectorAll('.anchor-grid button').forEach((x) => x.classList.toggle('on', x === b));
      }));
    },
    onOk(api) {
      const f = api.form;
      let w = Math.round(+f.width.value), h = Math.round(+f.height.value);
      if (f.relative.checked) { w += doc.width; h += doc.height; }
      if (!(w >= 1 && h >= 1 && w <= 30000 && h <= 30000)) { toast('Width and height must be between 1 and 30000 pixels.'); return false; }
      const fill = { transparent: null, bg: rgba(App.bg), fg: rgba(App.fg), white: '#fff', black: '#000' }[f.fill.value];
      ImageOps.canvasSize(doc, w, h, anchor, fill);
    },
  });
}

// ---------- Fill & Stroke ----------
function fillDialog() {
  const doc = App.doc;
  openDialog({
    title: 'Fill',
    body: `
      <div class="prow"><span class="prow-label">Contents</span>
        <select class="pselect" name="contents"><option value="fg">Foreground Color</option><option value="bg">Background Color</option><option value="black">Black</option><option value="gray">50% Gray</option><option value="white">White</option></select></div>
      <div class="prow"><span class="prow-label">Mode</span><select class="pselect" name="mode">${blendOptions('source-over')}</select></div>
      <div class="prow"><span class="prow-label">Opacity</span><span class="pnum"><input type="number" name="opacity" min="1" max="100" value="100"><em>%</em></span></div>
      <label class="pcheck prow-check"><input type="checkbox" name="preserve"> Preserve transparency</label>`,
    onOk(api) {
      const f = api.form;
      const color = { fg: rgba(App.fg), bg: rgba(App.bg), black: '#000', gray: '#808080', white: '#fff' }[f.contents.value];
      ImageOps.fill(doc, color, { mode: f.mode.value, opacity: clamp(+f.opacity.value, 1, 100) / 100, preserve: f.preserve.checked });
    },
  });
}

function strokeDialog() {
  const doc = App.doc;
  if (!doc.selection) { toast('Make a selection to stroke.'); return; }
  openDialog({
    title: 'Stroke',
    body: `
      <div class="prow"><span class="prow-label">Width</span><span class="pnum"><input type="number" name="width" min="1" max="250" value="4"><em>px</em></span></div>
      <div class="prow"><span class="prow-label">Color</span><input type="color" class="pcolor" name="color" value="${rgbToHex(App.fg)}"></div>
      <div class="prow"><span class="prow-label">Location</span>
        <select class="pselect" name="location"><option value="inside">Inside</option><option value="center" selected>Center</option><option value="outside">Outside</option></select></div>
      <div class="prow"><span class="prow-label">Opacity</span><span class="pnum"><input type="number" name="opacity" min="1" max="100" value="100"><em>%</em></span></div>`,
    onOk(api) {
      const f = api.form;
      ImageOps.strokeSelection(doc, clamp(+f.width.value, 1, 250), f.color.value, f.location.value, clamp(+f.opacity.value, 1, 100) / 100);
    },
  });
}

function blendOptions(selected) {
  return BLEND_MODES.map((m) => (m ? `<option value="${m[0]}" ${m[0] === selected ? 'selected' : ''}>${m[1]}</option>` : '<option disabled>──────────</option>')).join('');
}

// ---------- Selection modify ----------
function modifySelectionDialog(kind) {
  const doc = App.doc;
  if (!doc.selection) { toast('There is no selection to modify.'); return; }
  const label = { feather: 'Feather Radius', expand: 'Expand By', contract: 'Contract By', border: 'Width' }[kind];
  const title = { feather: 'Feather Selection', expand: 'Expand Selection', contract: 'Contract Selection', border: 'Border Selection' }[kind];
  openDialog({
    title,
    width: 360,
    body: `<div class="prow"><span class="prow-label">${label}</span><span class="pnum"><input type="number" name="r" min="1" max="250" step="0.1" value="${kind === 'feather' ? 5 : 4}"><em>px</em></span></div>`,
    onOk(api) {
      const r = clamp(+api.form.r.value, 0.1, 250);
      let m = doc.selection;
      if (kind === 'feather') m = Sel.feather(m, r);
      if (kind === 'expand') m = Sel.grow(m, r);
      if (kind === 'contract') m = Sel.grow(m, -r);
      if (kind === 'border') {
        const outer = Sel.grow(m, r / 2);
        m = Sel.combine(doc, outer, Sel.grow(m, -r / 2), 'subtract');
      }
      commitSelection(doc, m && !Sel.isEmpty(m) ? m : null, title.replace(' Selection', ''));
    },
  });
}

// ---------- Live-preview sessions for adjustments and filters ----------
function maskToGray(img) {
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) { d[i] = d[i + 1] = d[i + 2] = d[i + 3]; d[i + 3] = 255; }
}
function grayToMask(img) {
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) { d[i + 3] = luma(d[i], d[i + 1], d[i + 2]); d[i] = d[i + 1] = d[i + 2] = 0; }
}

// Run fn(ImageData) on a canvas copy; masks are converted to gray first.
function processCanvas(src, isMask, fn) {
  return pixelOp(src, (img) => {
    if (isMask) maskToGray(img);
    fn(img);
    if (isMask) grayToMask(img);
  });
}

function startFx(doc, name, iconName) {
  const t = paintTarget(doc);
  if (!t) return null;
  t.canvas = t.mask ? t.layer.mask : t.layer.canvas;
  doc.history.begin(name, iconName);
  doc.history.touch(t.canvas);
  const original = doc.history.backupOf(t.canvas);
  return {
    t,
    original,
    set(result) {
      const c = ctxOf(t.canvas);
      const w = t.canvas.width, h = t.canvas.height;
      c.save();
      c.globalCompositeOperation = 'copy';
      if (!doc.selection || result === original) {
        c.drawImage(result, 0, 0);
      } else {
        // out = original × (1 − selection) + result × selection
        const a = Scratch.get('fx-a', w, h);
        const ax = ctxOf(a);
        ax.drawImage(original, 0, 0);
        ax.globalCompositeOperation = 'destination-out';
        ax.drawImage(doc.selection, -t.layer.x, -t.layer.y);
        const b = Scratch.get('fx-b', w, h);
        const bx = ctxOf(b);
        bx.drawImage(result, 0, 0);
        bx.globalCompositeOperation = 'destination-in';
        bx.drawImage(doc.selection, -t.layer.x, -t.layer.y);
        c.drawImage(a, 0, 0);
        c.globalCompositeOperation = 'lighter';
        c.drawImage(b, 0, 0);
      }
      c.restore();
      doc.invalidate();
    },
    commit: () => doc.history.commit(),
    cancel: () => doc.history.cancel(),
  };
}

// ---------- Adjustment controls (shared with the Properties panel) ----------
function adjustmentControlsHTML(kind, params) {
  const def = ADJUSTMENTS[kind];
  if (def.custom === 'curves') return CurvesEditor.html;
  return `${def.histogram ? '<canvas class="histogram" width="256" height="90"></canvas>' : ''}
    ${def.params.map((p) => paramControl(p, params[p.key])).join('')}`;
}

function bindAdjustmentControls(root, kind, params, onChange, histogramSource) {
  const def = ADJUSTMENTS[kind];
  if (def.custom === 'curves') { CurvesEditor.mount(root, params, onChange, histogramSource); return; }
  bindParams(root, def.params, params, onChange);
  const hc = root.querySelector('.histogram');
  if (hc && histogramSource) drawHistogram(hc, histogramSource);
}

function drawHistogram(canvas, source) {
  const img = ctxOf(source).getImageData(0, 0, source.width, source.height);
  const h = channelHistograms(img)[3];
  const max = Math.max(1, ...h);
  const c = ctxOf(canvas);
  c.clearRect(0, 0, canvas.width, canvas.height);
  c.fillStyle = getComputedStyle(document.body).getPropertyValue('--hist') || '#999';
  for (let i = 0; i < 256; i++) {
    const v = (Math.sqrt(h[i] / max)) * canvas.height;
    c.fillRect(i, canvas.height - v, 1, v);
  }
}

const CurvesEditor = {
  html: `
    <div class="curves">
      <div class="prow"><span class="prow-label">Channel</span>
        <select class="pselect" data-curve-channel><option value="rgb">RGB</option><option value="r">Red</option><option value="g">Green</option><option value="b">Blue</option></select></div>
      <canvas class="curves-canvas" width="256" height="256"></canvas>
      <p class="pdialog-note">Click the curve to add a point. Drag a point off the graph to remove it.</p>
    </div>`,

  mount(root, params, onChange, histogramSource) {
    const canvas = root.querySelector('.curves-canvas');
    const sel = root.querySelector('[data-curve-channel]');
    sel.value = params.channel;
    const hist = histogramSource ? channelHistograms(ctxOf(histogramSource).getImageData(0, 0, histogramSource.width, histogramSource.height)) : null;
    const colors = { rgb: '#ddd', r: '#ff5a5a', g: '#4cd964', b: '#4c8dff' };
    const pts = () => params.points[params.channel];
    const toCanvas = (e) => {
      const r = canvas.getBoundingClientRect();
      return { x: ((e.clientX - r.left) / r.width) * 255, y: 255 - ((e.clientY - r.top) / r.height) * 255, out: e.clientX < r.left - 20 || e.clientX > r.right + 20 || e.clientY < r.top - 20 || e.clientY > r.bottom + 20 };
    };
    const draw = () => {
      const c = ctxOf(canvas);
      const css = getComputedStyle(document.body);
      c.fillStyle = css.getPropertyValue('--field');
      c.fillRect(0, 0, 256, 256);
      if (hist) {
        const h = hist[{ rgb: 3, r: 0, g: 1, b: 2 }[params.channel]];
        const max = Math.max(1, ...h);
        c.fillStyle = 'rgba(160,160,160,.4)';
        for (let i = 0; i < 256; i++) { const v = Math.sqrt(h[i] / max) * 256; c.fillRect(i, 256 - v, 1, v); }
      }
      c.strokeStyle = 'rgba(160,160,160,.3)';
      c.lineWidth = 1;
      c.beginPath();
      for (let i = 1; i < 4; i++) { c.moveTo(i * 64 + 0.5, 0); c.lineTo(i * 64 + 0.5, 256); c.moveTo(0, i * 64 + 0.5); c.lineTo(256, i * 64 + 0.5); }
      c.moveTo(0, 256); c.lineTo(256, 0);
      c.stroke();
      const lut = curveLut(pts());
      c.strokeStyle = colors[params.channel];
      c.lineWidth = 2;
      c.beginPath();
      for (let x = 0; x < 256; x++) (x ? c.lineTo : c.moveTo).call(c, x, 255 - lut[x]);
      c.stroke();
      for (const [x, y] of pts()) {
        c.fillStyle = '#fff';
        c.strokeStyle = '#000';
        c.lineWidth = 1;
        c.fillRect(x - 3.5, 255 - y - 3.5, 7, 7);
        c.strokeRect(x - 3.5, 255 - y - 3.5, 7, 7);
      }
    };
    let drag = -1;
    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      const p = toCanvas(e);
      const list = pts();
      drag = list.findIndex(([x, y]) => Math.hypot(x - p.x, y - p.y) < 8);
      if (drag < 0) {
        const lut = curveLut(list);
        list.push([Math.round(clamp(p.x, 0, 255)), lut[Math.round(clamp(p.x, 0, 255))]]);
        list.sort((a, b) => a[0] - b[0]);
        drag = list.findIndex(([x]) => x === Math.round(clamp(p.x, 0, 255)));
      }
      draw();
    });
    canvas.addEventListener('pointermove', (e) => {
      if (drag < 0) return;
      const p = toCanvas(e);
      const list = pts();
      const endpoint = drag === 0 || drag === list.length - 1;
      if (p.out && !endpoint && list.length > 2) {
        list.splice(drag, 1);
        drag = -1;
      } else {
        const lo = drag > 0 ? list[drag - 1][0] + 1 : 0;
        const hi = drag < list.length - 1 ? list[drag + 1][0] - 1 : 255;
        list[drag] = [Math.round(clamp(p.x, lo, hi)), Math.round(clamp(p.y, 0, 255))];
      }
      draw();
      onChange(params, 'points');
    });
    canvas.addEventListener('pointerup', () => { drag = -1; onChange(params, 'points', true); });
    sel.addEventListener('change', () => { params.channel = sel.value; draw(); });
    draw();
  },
};

function adjustmentDialog(kind) {
  const doc = App.doc;
  if (!doc) return;
  const def = ADJUSTMENTS[kind];
  if (!def.params.length && !def.custom) { ImageOps.adjustNow(doc, kind); return; }
  const fx = startFx(doc, def.name, 'adjust');
  if (!fx) return;
  const params = adjustmentDefaults(kind);
  let dlg;
  const run = rafThrottle(() => {
    fx.set(dlg?.previewOn === false ? fx.original : processCanvas(fx.original, fx.t.mask, (img) => applyAdjustment(kind, img, params)));
  });
  dlg = openDialog({
    title: def.name,
    width: def.custom === 'curves' ? 400 : 420,
    preview: true,
    body: adjustmentControlsHTML(kind, params),
    onMount(api) {
      bindAdjustmentControls(api.form, kind, params, run, fx.original);
      api.el.querySelector('[data-preview]').addEventListener('change', run);
    },
    onOk() {
      fx.set(processCanvas(fx.original, fx.t.mask, (img) => applyAdjustment(kind, img, params)));
      fx.commit();
    },
    onCancel: () => fx.cancel(),
  });
}

// ---------- Filters ----------
const LastFilter = { id: null, params: null };

function runFilter(id, params, src, isMask) {
  const f = FILTERS[id];
  if (!isMask) return f.run(src, params, { fg: App.fg, bg: App.bg });
  // Filters on masks work on the gray version.
  const gray = processCanvas(src, false, maskToGray);
  const out = f.run(gray, params, { fg: App.fg, bg: App.bg });
  return processCanvas(out, false, grayToMask);
}

function filterDialog(id, { repeat = false } = {}) {
  const doc = App.doc;
  if (!doc) return;
  const f = FILTERS[id];
  const params = repeat && LastFilter.id === id ? { ...LastFilter.params } : filterDefaults(id);
  const fx = startFx(doc, f.name, 'filter');
  if (!fx) return;
  if (!f.params || repeat) {
    App.busy(true);
    setTimeout(() => {
      fx.set(runFilter(id, params, fx.original, fx.t.mask));
      fx.commit();
      LastFilter.id = id;
      LastFilter.params = params;
      App.busy(false);
    }, 20);
    return;
  }
  let dlg;
  const run = rafThrottle(() => {
    fx.set(dlg?.previewOn === false ? fx.original : runFilter(id, params, fx.original, fx.t.mask));
  });
  dlg = openDialog({
    title: f.name,
    preview: true,
    body: f.params.map((p) => paramControl(p, params[p.key])).join(''),
    onMount(api) {
      bindParams(api.form, f.params, params, run);
      api.el.querySelector('[data-preview]').addEventListener('change', run);
      run();
    },
    onOk() {
      fx.set(runFilter(id, params, fx.original, fx.t.mask));
      fx.commit();
      LastFilter.id = id;
      LastFilter.params = { ...params };
    },
    onCancel: () => fx.cancel(),
  });
}

// ---------- Export As ----------
function scaledCopy(src, w, h) {
  let cur = src;
  // Halve in steps for smoother downscaling.
  while (cur.width / 2 >= w && cur.height / 2 >= h) {
    const half = makeCanvas(Math.round(cur.width / 2), Math.round(cur.height / 2));
    const x = ctxOf(half);
    x.imageSmoothingQuality = 'high';
    x.drawImage(cur, 0, 0, half.width, half.height);
    cur = half;
  }
  const out = makeCanvas(w, h);
  const x = ctxOf(out);
  x.imageSmoothingQuality = 'high';
  x.drawImage(cur, 0, 0, w, h);
  return out;
}

const EXPORT_TYPES = {
  png: { mime: 'image/png', ext: 'png', label: 'PNG' },
  jpeg: { mime: 'image/jpeg', ext: 'jpg', label: 'JPEG' },
  webp: { mime: 'image/webp', ext: 'webp', label: 'WebP' },
};

async function exportBlob(doc, format, quality, scale, transparent) {
  const flat = doc.flattened();
  const w = Math.max(1, Math.round(doc.width * scale)), h = Math.max(1, Math.round(doc.height * scale));
  let out = scale === 1 ? flat : scaledCopy(flat, w, h);
  if (format === 'jpeg' || !transparent) {
    const bgd = makeCanvas(out.width, out.height);
    const x = ctxOf(bgd);
    x.fillStyle = '#fff';
    x.fillRect(0, 0, bgd.width, bgd.height);
    x.drawImage(out, 0, 0);
    out = bgd;
  }
  return canvasToBlob(out, EXPORT_TYPES[format].mime, quality / 100);
}

function exportDialog({ format = 'png', quality = 90 } = {}) {
  const doc = App.doc;
  if (!doc) return;
  const state = { format, quality, scale: 100, transparent: true };
  const preview = scaledCopy(doc.flattened(), ...(() => { const k = Math.min(1, 240 / Math.max(doc.width, doc.height)); return [Math.max(1, Math.round(doc.width * k)), Math.max(1, Math.round(doc.height * k))]; })());
  openDialog({
    title: 'Export As',
    width: 600,
    okLabel: 'Export',
    body: `
      <div class="export">
        <div class="export-preview"><img alt="Preview" src="${preview.toDataURL()}"></div>
        <div class="export-fields">
          <div class="prow"><span class="prow-label">Format</span><select class="pselect" name="format">${Object.entries(EXPORT_TYPES).map(([k, t]) => `<option value="${k}" ${k === format ? 'selected' : ''}>${t.label}</option>`).join('')}</select></div>
          <div class="prow prow-range" data-quality><label class="prow-label">Quality</label><span class="pnum"><input type="number" name="quality" min="1" max="100" value="${quality}"><em>%</em></span>
            <input type="range" class="prange" name="qrange" min="1" max="100" value="${quality}"></div>
          <label class="pcheck prow-check" data-transparency><input type="checkbox" name="transparent" checked> Transparency</label>
          <div class="prow"><span class="prow-label">Scale</span><span class="pnum"><input type="number" name="scale" min="1" max="400" value="100"><em>%</em></span></div>
          <p class="pdialog-note" data-size></p>
          <p class="pdialog-note" data-bytes>Estimating file size…</p>
        </div>
      </div>`,
    onMount(api) {
      const f = api.form;
      let token = 0;
      const update = async () => {
        state.format = f.format.value;
        state.quality = clamp(+f.quality.value, 1, 100);
        state.scale = clamp(+f.scale.value, 1, 400);
        state.transparent = f.transparent.checked;
        api.el.querySelector('[data-quality]').hidden = state.format === 'png';
        api.el.querySelector('[data-transparency]').hidden = state.format === 'jpeg';
        api.el.querySelector('[data-size]').textContent = `Image size: ${Math.round(doc.width * state.scale / 100)} × ${Math.round(doc.height * state.scale / 100)} px`;
        const mine = ++token;
        const blob = await exportBlob(doc, state.format, state.quality, state.scale / 100, state.transparent);
        if (mine === token && blob) api.el.querySelector('[data-bytes]').textContent = `File size: ${formatBytes(blob.size)}`;
      };
      const debounced = (() => { let t; return () => { clearTimeout(t); t = setTimeout(update, 200); }; })();
      f.qrange.addEventListener('input', () => { f.quality.value = f.qrange.value; debounced(); });
      f.quality.addEventListener('input', () => { f.qrange.value = f.quality.value; debounced(); });
      f.addEventListener('change', debounced);
      f.scale.addEventListener('input', debounced);
      update();
    },
    onOk() {
      App.exportImage(state.format, state.quality, state.scale / 100, state.transparent);
    },
  });
}

// ---------- Color picker ----------
// An SV square + hue strip that edits an RGB color. Used by the dialog and the Color panel.
function mountColorField(root, get, set) {
  const sv = root.querySelector('.cf-sv');
  const hue = root.querySelector('.cf-hue');
  const svDot = root.querySelector('.cf-sv-dot');
  const hueBar = root.querySelector('.cf-hue-bar');
  let hsv = rgbToHsv(get());

  const paint = () => {
    const r = sv.getBoundingClientRect();
    sv.style.background = `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent), hsl(${hsv.h}, 100%, 50%)`;
    svDot.style.left = `${hsv.s * r.width}px`;
    svDot.style.top = `${(1 - hsv.v) * r.height}px`;
    hueBar.style.top = `${(1 - hsv.h / 360) * hue.getBoundingClientRect().height}px`;
  };
  const drag = (el, fn) => el.addEventListener('pointerdown', (e) => {
    el.setPointerCapture(e.pointerId);
    const move = (ev) => {
      const r = el.getBoundingClientRect();
      fn(clamp((ev.clientX - r.left) / r.width, 0, 1), clamp((ev.clientY - r.top) / r.height, 0, 1));
      set(hsvToRgb(hsv));
      paint();
    };
    move(e);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', () => el.removeEventListener('pointermove', move), { once: true });
  });
  drag(sv, (x, y) => { hsv = { ...hsv, s: x, v: 1 - y }; });
  drag(hue, (x, y) => { hsv = { ...hsv, h: (1 - y) * 359.9 }; });
  paint();
  return {
    refresh() {
      const rgb = get();
      const next = rgbToHsv(rgb);
      // Keep hue when the color is gray, so the square doesn't jump to red.
      hsv = { h: next.s && next.v ? next.h : hsv.h, s: next.v ? next.s : hsv.s, v: next.v };
      paint();
    },
  };
}

const COLOR_FIELD_HTML = `
  <div class="cf">
    <div class="cf-sv"><span class="cf-sv-dot"></span></div>
    <div class="cf-hue"><span class="cf-hue-bar"></span></div>
  </div>`;

function colorPickerDialog(which = 'fg') {
  const original = { ...App[which] };
  let color = { ...original };
  let field;
  const fields = () => {
    const { h, s, v } = rgbToHsv(color);
    return { H: Math.round(h), S: Math.round(s * 100), B: Math.round(v * 100), R: Math.round(color.r), G: Math.round(color.g), Bl: Math.round(color.b) };
  };
  openDialog({
    title: `Color Picker (${which === 'fg' ? 'Foreground' : 'Background'} Color)`,
    width: 520,
    body: `
      <div class="cp">
        ${COLOR_FIELD_HTML}
        <div class="cp-side">
          <div class="cp-compare"><span data-new></span><span data-old style="background:${rgbToHex(original)}"></span></div>
          <div class="cp-compare-labels"><span>new</span><span>current</span></div>
          <div class="cp-grid">
            ${[['H', '°'], ['S', '%'], ['B', '%'], ['R', ''], ['G', ''], ['Bl', '']].map(([k, u]) => `<label><span>${k === 'Bl' ? 'B' : k}</span><input type="number" data-c="${k}" min="0" max="${k === 'H' ? 359 : ['S', 'B'].includes(k) ? 100 : 255}"><em>${u}</em></label>`).join('')}
          </div>
          <label class="cp-hex"><span>#</span><input data-hex maxlength="7" spellcheck="false"></label>
        </div>
      </div>`,
    onMount(api) {
      const sync = (skip) => {
        api.el.querySelector('[data-new]').style.background = rgbToHex(color);
        const f = fields();
        api.el.querySelectorAll('[data-c]').forEach((el) => { if (el !== skip) el.value = f[el.dataset.c]; });
        const hex = api.el.querySelector('[data-hex]');
        if (hex !== skip) hex.value = rgbToHex(color).slice(1);
      };
      field = mountColorField(api.el, () => color, (rgb) => { color = rgb; sync(); });
      api.el.querySelectorAll('[data-c]').forEach((el) => el.addEventListener('input', () => {
        const f = fields();
        f[el.dataset.c] = +el.value || 0;
        color = ['H', 'S', 'B'].includes(el.dataset.c)
          ? hsvToRgb({ h: clamp(f.H, 0, 359.9), s: clamp(f.S, 0, 100) / 100, v: clamp(f.B, 0, 100) / 100 })
          : { r: clamp(f.R, 0, 255), g: clamp(f.G, 0, 255), b: clamp(f.Bl, 0, 255) };
        field.refresh();
        sync(el);
      }));
      api.el.querySelector('[data-hex]').addEventListener('input', (e) => {
        const rgb = hexToRgb(e.target.value);
        if (!rgb) return;
        color = rgb;
        field.refresh();
        sync(e.target);
      });
      sync();
    },
    onOk() { App.setColor(which, color); },
  });
}

// ---------- Info dialogs ----------
function shortcutsDialog() {
  const rows = Commands.list().filter((c) => c.shortcut);
  const tools = TOOL_GROUPS.flat().map((id) => Tools.defs[id]);
  openDialog({
    title: 'Keyboard Shortcuts',
    width: 640,
    cancelLabel: '',
    body: `
      <div class="shortcuts">
        <div><h4>Tools</h4>${tools.map((t) => `<div class="sc-row"><span>${esc(t.name)}</span><kbd>${t.key}</kbd></div>`).join('')}
          <div class="sc-row"><span>Hand (temporary)</span><kbd>Space</kbd></div>
          <div class="sc-row"><span>Brush size smaller / larger</span><kbd>[ ]</kbd></div>
          <div class="sc-row"><span>Default / swap colors</span><kbd>D</kbd> <kbd>X</kbd></div>
          <div class="sc-row"><span>Tool opacity 10–100%</span><kbd>1–0</kbd></div></div>
        <div><h4>Menus</h4>${rows.map((c) => `<div class="sc-row"><span>${esc((c.name || c.label).replace('…', ''))}</span><kbd>${esc(c.shortcut)}</kbd></div>`).join('')}</div>
      </div>`,
  });
}

function aboutDialog() {
  openDialog({
    title: 'About PhotoCrop',
    width: 420,
    cancelLabel: '',
    body: `
      <div class="about">
        <span class="about-tile">Pc</span>
        <h3>PhotoCrop</h3>
        <p>Version ${PHOTOCROP_VERSION} · part of Crop Cloud</p>
        <p class="pdialog-note">A photo editor with a familiar layout, built with plain HTML, CSS and JavaScript.</p>
      </div>`,
  });
}
