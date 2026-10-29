// PhotoCrop app controller: documents, files, preferences, keyboard and startup.

const PHOTOCROP_VERSION = '0.2.0';
const PREFS_KEY = 'photocrop.prefs';

// Keys as Photoshop names them, independent of keyboard layout where possible.
const CODE_KEYS = {
  BracketLeft: '[', BracketRight: ']', Minus: '-', Equal: '=', NumpadAdd: '=', NumpadSubtract: '-',
  Quote: "'", Comma: ',', Period: '.', Slash: '/', Backslash: '\\', Semicolon: ';', Backquote: '`',
  NumpadEnter: 'Enter',
};

function keyName(e) {
  const c = e.code || '';
  if (c.startsWith('Key')) return c.slice(3);
  if (c.startsWith('Digit')) return c.slice(5);
  if (/^Numpad\d$/.test(c)) return c.slice(6);
  if (CODE_KEYS[c]) return CODE_KEYS[c];
  if (e.key === ' ') return 'Space';
  return e.key.length === 1 ? e.key.toUpperCase() : e.key;
}

function comboOf(e) {
  const parts = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  parts.push(keyName(e));
  return parts.join('+');
}

// ---------- Project files (.pcrop) ----------
function serializeDoc(doc) {
  return JSON.stringify({
    format: 'photocrop',
    version: 1,
    width: doc.width,
    height: doc.height,
    dpi: doc.dpi,
    layers: doc.layers.map((l) => ({
      type: l.type, name: l.name, visible: l.visible, opacity: l.opacity, blend: l.blend, locked: l.locked,
      x: l.x, y: l.y, maskEnabled: l.maskEnabled, text: l.text, adjust: l.adjust,
      image: l.canvas && l.type === 'raster' ? l.canvas.toDataURL('image/png') : null,
      mask: l.mask ? l.mask.toDataURL('image/png') : null,
    })),
  });
}

async function dataUrlToCanvas(url) {
  return blobToCanvas(await (await fetch(url)).blob());
}

async function loadProject(text, name) {
  const data = JSON.parse(text);
  if (data.format !== 'photocrop') throw new Error('Not a PhotoCrop document');
  const doc = new Doc({ name, width: data.width, height: data.height, dpi: data.dpi || 72, historyName: 'Open' });
  for (const e of data.layers) {
    const layer = new Layer({ type: e.type, name: e.name, x: e.x, y: e.y, text: e.text, adjust: e.adjust });
    Object.assign(layer, { visible: e.visible, opacity: e.opacity, blend: e.blend, locked: e.locked, maskEnabled: e.maskEnabled });
    if (e.image) layer.canvas = await dataUrlToCanvas(e.image);
    if (e.type === 'text') renderText(layer);
    if (e.mask) layer.mask = await dataUrlToCanvas(e.mask);
    doc.layers.push(layer);
  }
  doc.layerCount = doc.layers.length;
  doc.activeId = doc.layers[doc.layers.length - 1]?.id || null;
  return doc;
}

function thumbnailOf(canvas) {
  const k = Math.min(1, 360 / Math.max(canvas.width, canvas.height));
  return scaledCopy(canvas, Math.max(1, Math.round(canvas.width * k)), Math.max(1, Math.round(canvas.height * k))).toDataURL('image/webp', 0.8);
}

// ---------- App ----------
const App = {
  docs: [],
  doc: null,
  fg: { r: 0, g: 0, b: 0 },
  bg: { r: 255, g: 255, b: 255 },
  toolOptions: {},
  panels: {},
  showRulers: false,
  showGrid: false,
  showExtras: true,
  theme: 'dark',
  untitled: 0,
  frame: 0,

  init() {
    this.loadPrefs();
    document.documentElement.dataset.theme = this.theme;
    View.init();
    Tools.init();
    Menubar.init();
    Toolbar.init();
    OptionsBar.init();
    DocTabs.init();
    Status.init();
    Dock.init();
    Home.init();
    this.bindEvents();
    this.applyFlags();
    Tools.select(this.savedTool && Tools.defs[this.savedTool] && !Tools.defs[this.savedTool].hidden ? this.savedTool : 'move');
    this.handleLaunch();
    this.requestRender();
  },

  // ---------- Preferences ----------
  loadPrefs() {
    let p = {};
    try { p = JSON.parse(localStorage.getItem(PREFS_KEY)) || {}; } catch { /* first run */ }
    const defaults = Tools.defaultOptions();
    this.toolOptions = Object.fromEntries(Object.entries(defaults).map(([k, v]) => [k, { ...v, ...(p.toolOptions?.[k] || {}) }]));
    if (p.fg) this.fg = p.fg;
    if (p.bg) this.bg = p.bg;
    this.panels = p.panels || {};
    this.showRulers = !!p.showRulers;
    this.showGrid = !!p.showGrid;
    this.savedTool = p.tool;
    const hubTheme = Store.setting('theme');
    this.theme = p.theme || (hubTheme === 'light' || (hubTheme === 'system' && !matchMedia('(prefers-color-scheme: dark)').matches) ? 'light' : 'dark');
  },

  savePrefs() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify({
          fg: this.fg, bg: this.bg, toolOptions: this.toolOptions, panels: this.panels,
          showRulers: this.showRulers, showGrid: this.showGrid, theme: this.theme, tool: Tools.current,
        }));
      } catch { /* storage full or blocked */ }
    }, 300);
  },

  setTheme(theme) {
    this.theme = theme;
    document.documentElement.dataset.theme = theme;
    this.savePrefs();
    Dock.refreshAll();
    this.requestRender();
  },

  toggleFlag(key) {
    this[key] = !this[key];
    this.applyFlags();
    this.savePrefs();
  },

  applyFlags() {
    document.body.classList.toggle('rulers-on', this.showRulers);
    this.requestRender();
  },

  togglePanel(id) {
    this.panels[id] = this.panels[id] === false;
    Dock.render();
    this.savePrefs();
  },

  togglePanelsHidden() {
    document.body.classList.toggle('panels-hidden');
    this.requestRender();
  },

  resetWorkspace() {
    this.panels = {};
    Dock.active = { top: 'color', mid: 'properties', bottom: 'layers' };
    Dock.collapsed = {};
    document.body.classList.remove('panels-hidden');
    Dock.render();
    this.savePrefs();
    this.requestRender();
  },

  // ---------- Colors & tool options ----------
  setColor(which, rgb, { live = false } = {}) {
    this[which] = { r: Math.round(clamp(rgb.r, 0, 255)), g: Math.round(clamp(rgb.g, 0, 255)), b: Math.round(clamp(rgb.b, 0, 255)) };
    this.colorLive = live;
    Bus.emit('colors');
    this.colorLive = false;
    this.savePrefs();
  },

  swapColors() {
    [this.fg, this.bg] = [this.bg, this.fg];
    Bus.emit('colors');
    this.savePrefs();
  },

  defaultColors() {
    this.fg = { r: 0, g: 0, b: 0 };
    this.bg = { r: 255, g: 255, b: 255 };
    Bus.emit('colors');
    this.savePrefs();
  },

  setToolOption(key, value) {
    if (Transform.active) return;
    const o = Tools.o(Tools.current);
    if (!o) return;
    o[key] = value;
    if (Tools.current === 'type' && ['font', 'size', 'weight', 'italic', 'align'].includes(key)) TextEditor.setProp(key, value);
    this.savePrefs();
    Tools.updateCursor();
    this.requestRender();
  },

  brushSize(dir) {
    const o = Tools.o(Tools.current);
    if (!o || o.size == null) return;
    const s = o.size;
    const step = s < 10 ? 1 : s < 50 ? 5 : s < 100 ? 10 : s < 500 ? 25 : 50;
    this.setToolOption('size', clamp(s + dir * step, 1, 2500));
    OptionsBar.render();
  },

  brushHardness(delta) {
    const o = Tools.o(Tools.current);
    if (!o || o.hardness == null) return;
    this.setToolOption('hardness', clamp(o.hardness + delta, 0, 100));
    OptionsBar.render();
  },

  quickOpacity(v) {
    const o = Tools.o(Tools.current);
    if (o && o.opacity != null) {
      this.setToolOption('opacity', v);
      OptionsBar.render();
      return;
    }
    const layer = this.doc?.active;
    if (Tools.current === 'move' && layer) this.doc.history.step('Opacity Change', 'layers', () => { layer.opacity = v / 100; });
  },

  nudge(dx, dy) {
    const doc = this.doc;
    if (!doc) return;
    const tool = Tools.current;
    if (/^(marquee|lasso|wand)/.test(tool)) {
      if (doc.selection) commitSelection(doc, shiftMask(doc, doc.selection, dx, dy), 'Nudge Selection');
      return;
    }
    if (tool !== 'move') return;
    const l = doc.active;
    if (!l || l.locked) return;
    doc.history.step('Nudge', 'move', () => {
      if (doc.selection && l.type === 'raster' && doc.target === 'pixels') {
        ensureCovers(l, doc.rect);
        doc.history.touch(l.canvas);
        const lifted = cloneCanvas(l.canvas);
        const f = ctxOf(lifted);
        f.globalCompositeOperation = 'destination-in';
        f.drawImage(doc.selection, -l.x, -l.y);
        const c = ctxOf(l.canvas);
        c.globalCompositeOperation = 'destination-out';
        c.drawImage(doc.selection, -l.x, -l.y);
        c.globalCompositeOperation = 'source-over';
        c.drawImage(lifted, dx, dy);
        doc.selection = shiftMask(doc, doc.selection, dx, dy);
      } else {
        translateLayer(l, dx, dy);
      }
    });
  },

  // Commit anything in progress (typing, Free Transform) before other actions.
  finishEditing() {
    if (TextEditor.active) TextEditor.commit();
    if (Transform.active) Transform.commit();
  },

  busy(on) {
    document.body.classList.toggle('busy', on);
  },

  requestRender() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      if (this.doc?.compositeDirty) this.doc.renderComposite();
      View.draw();
      TextEditor.position();
    });
  },

  clearHistory() {
    const doc = this.doc;
    if (!doc) return;
    const wasSaved = !doc.dirty;
    doc.history = new History(doc, 'Cleared');
    if (wasSaved) doc.savedEntry = doc.history.current;
    Bus.emit('doc', doc);
  },

  // ---------- Documents ----------
  nextUntitled() {
    return `Untitled-${++this.untitled}`;
  },

  addDoc(doc) {
    this.docs.push(doc);
    this.setDoc(doc);
  },

  setDoc(doc) {
    if (doc === this.doc) return;
    this.finishEditing();
    this.doc = doc || null;
    Tools.tool?.activate?.();
    Home.update();
    Bus.emit('docs');
    Tools.updateCursor();
    this.requestRender();
  },

  async closeDoc(doc) {
    if (!doc) return false;
    if (doc === this.doc) this.finishEditing();
    if (doc.dirty) {
      this.setDoc(doc);
      const answer = await confirmDialog({
        title: 'PhotoCrop',
        message: `Save changes to the document "${doc.name}" before closing?`,
        okLabel: 'Save', extra: "Don't Save", cancelLabel: 'Cancel',
      });
      if (answer === 'cancel') return false;
      if (answer === 'ok' && !(await this.save(doc))) return false;
    }
    const i = this.docs.indexOf(doc);
    this.docs.splice(i, 1);
    if (this.doc === doc) {
      this.doc = null;
      this.setDoc(this.docs[Math.min(i, this.docs.length - 1)] || null);
    }
    Home.update();
    Bus.emit('docs');
    return true;
  },

  async closeAll() {
    for (const d of [...this.docs]) if (!(await this.closeDoc(d))) return;
  },

  newDocument({ name, width, height, dpi = 72, background = 'white' }) {
    const doc = new Doc({ name: name || this.nextUntitled(), width, height, dpi, historyName: 'New' });
    const canvas = makeCanvas(width, height);
    const fill = { white: '#ffffff', black: '#000000', bgcolor: rgba(this.bg) }[background];
    if (fill) {
      const x = ctxOf(canvas);
      x.fillStyle = fill;
      x.fillRect(0, 0, width, height);
    }
    const layer = new Layer({ name: fill ? 'Background' : 'Layer 1', canvas });
    if (!fill) doc.layerCount = 1;
    doc.layers.push(layer);
    doc.activeId = layer.id;
    this.addDoc(doc);
    return doc;
  },

  docFromCanvas(canvas, name) {
    const doc = new Doc({ name, width: canvas.width, height: canvas.height, historyName: 'Open' });
    const layer = new Layer({ name: 'Background', canvas });
    doc.layers.push(layer);
    doc.activeId = layer.id;
    return doc;
  },

  pickFiles({ place = false } = {}) {
    const input = document.getElementById('file-input');
    input.accept = place ? 'image/*' : 'image/*,.pcrop';
    input.multiple = !place;
    input.onchange = () => {
      const files = [...input.files];
      input.value = '';
      if (files.length) this.openFiles(files, { place });
    };
    input.click();
  },

  async openFiles(files, { place = false, recentId = null } = {}) {
    for (const file of files) {
      try {
        if (/\.pcrop$/i.test(file.name)) {
          const doc = await loadProject(await file.text(), file.name);
          doc.recentId = recentId || `pcrop:${file.name}:${file.size}:${file.lastModified}`;
          this.addDoc(doc);
          this.rememberProject(doc, file);
          continue;
        }
        if (!file.type.startsWith('image/')) { toast(`"${file.name}" isn't an image or PhotoCrop document.`); continue; }
        const canvas = await blobToCanvas(file);
        if (place && this.doc) this.placeCanvas(canvas, baseName(file.name));
        else {
          this.addDoc(this.docFromCanvas(canvas, file.name));
          this.rememberImage(file, canvas, recentId);
        }
      } catch (err) {
        console.error(err);
        toast(`Couldn't open "${file.name}".`);
      }
    }
  },

  async openFromStore(id) {
    const rec = Store.get('recents').find((f) => f.id === id);
    let blob = null;
    try { blob = await FileStore.get(id); } catch { /* storage unavailable */ }
    if (!blob) { toast(`"${rec?.name || 'That file'}" isn't stored any more. Open it again from your computer.`); return; }
    const file = blob instanceof File ? blob : new File([blob], rec?.name || 'image.png', { type: blob.type });
    await this.openFiles([file], { recentId: id });
  },

  placeCanvas(canvas, name) {
    const doc = this.doc;
    let c = canvas;
    const k = Math.min(1, doc.width / c.width, doc.height / c.height);
    if (k < 1) c = scaledCopy(c, Math.max(1, Math.round(c.width * k)), Math.max(1, Math.round(c.height * k)));
    this.finishEditing();
    doc.history.step('Place', 'image', () => {
      doc.addLayer(new Layer({ name, canvas: c, x: Math.round((doc.width - c.width) / 2), y: Math.round((doc.height - c.height) / 2) }));
    });
  },

  // Keep files opened here in Crop Cloud's recent list too.
  rememberImage(file, canvas, id) {
    id ||= `${file.name}:${file.size}:${file.lastModified}`;
    try {
      Store.addRecent({ id, name: file.name, type: file.type, size: file.size, width: canvas.width, height: canvas.height, thumb: thumbnailOf(canvas), openedAt: Date.now() });
      FileStore.put(id, file).catch(() => {});
    } catch { /* recents are a convenience */ }
  },

  rememberProject(doc, blob) {
    try {
      Store.addRecent({ id: doc.recentId, name: doc.name, type: 'application/x-photocrop', size: blob.size, width: doc.width, height: doc.height, thumb: thumbnailOf(doc.flattened()), openedAt: Date.now() });
      FileStore.put(doc.recentId, blob instanceof File ? blob : new File([blob], doc.name, { type: 'application/json' })).catch(() => {});
    } catch { /* recents are a convenience */ }
  },

  async save(doc, saveAs = false) {
    if (!doc) return false;
    if (doc === this.doc) this.finishEditing();
    const blob = new Blob([serializeDoc(doc)], { type: 'application/json' });
    const name = `${baseName(doc.name)}.pcrop`;
    let saved = false;
    if (doc.fileHandle && !saveAs) {
      try { await writeHandle(doc.fileHandle, blob); saved = true; } catch { doc.fileHandle = null; }
    }
    if (!saved) {
      const result = await saveBlob(blob, name, { description: 'PhotoCrop document', accept: { 'application/json': ['.pcrop'] } });
      if (!result) return false;
      if (result !== 'download') { doc.fileHandle = result; doc.name = result.name; } else doc.name = name;
    }
    doc.savedEntry = doc.history.current;
    doc.recentId ||= `pcrop:${doc.id}`;
    this.rememberProject(doc, blob);
    Bus.emit('docs');
    toast(`Saved ${doc.name}`);
    return true;
  },

  async exportImage(format, quality, scale, transparent) {
    const doc = this.doc;
    if (!doc) return;
    const t = EXPORT_TYPES[format];
    const blob = await exportBlob(doc, format, quality, scale, transparent);
    const name = `${baseName(doc.name)}.${t.ext}`;
    const result = await saveBlob(blob, name, { description: `${t.label} image`, accept: { [t.mime]: [`.${t.ext}`] } });
    if (result) toast(`Exported ${result === 'download' ? name : result.name} (${formatBytes(blob.size)})`);
  },

  // ---------- Crop Cloud hand-off ----------
  async handleLaunch() {
    let req = null;
    try {
      req = JSON.parse(sessionStorage.getItem('cropcloud.launch'));
      sessionStorage.removeItem('cropcloud.launch');
    } catch { /* nothing to do */ }
    if (!req) return;
    if (req.type === 'new') {
      this.newDocument({ name: req.name, width: req.width, height: req.height, dpi: req.dpi, background: req.background });
    } else if (req.type === 'open') {
      for (const id of req.fileIds || [req.fileId]) await this.openFromStore(id);
    } else if (req.type === 'quick-action') {
      await this.openFromStore(req.fileId);
      if (this.doc) this.quickAction(req.action);
    }
  },

  quickAction(action) {
    const doc = this.doc;
    ({
      'remove-bg': () => LayerOps.removeBackground(doc),
      resize: () => imageSizeDialog(),
      crop: () => Tools.select('crop'),
      convert: () => exportDialog({ format: 'jpeg' }),
      compress: () => exportDialog({ format: 'jpeg', quality: 70 }),
      enhance: () => ImageOps.autoEnhance(doc),
    })[action]?.();
  },

  // ---------- Global events ----------
  bindEvents() {
    document.addEventListener('keydown', (e) => this.onKeyDown(e));
    document.addEventListener('keyup', (e) => {
      if (e.code === 'Space') {
        Tools.spaceHeld = false;
        Tools.updateCursor();
      }
    });
    window.addEventListener('blur', () => { Tools.spaceHeld = false; });

    document.addEventListener('paste', (e) => {
      if (e.target.closest('input, textarea, [contenteditable]') || Dialogs.stack.length) return;
      e.preventDefault();
      const inPlace = this.lastPasteInPlace;
      this.lastPasteInPlace = false;
      const file = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'))?.getAsFile();
      if (file) blobToCanvas(file).then((c) => Clipboard.pasteCanvas(c, inPlace)).catch(() => Clipboard.paste(this.doc, { inPlace }));
      else Clipboard.paste(this.doc, { inPlace });
    });

    // Drop onto an open document to place it; anywhere else opens it.
    const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
    document.addEventListener('dragover', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      document.body.classList.add('dropping');
    });
    document.addEventListener('dragleave', (e) => { if (!e.relatedTarget) document.body.classList.remove('dropping'); });
    document.addEventListener('drop', (e) => {
      document.body.classList.remove('dropping');
      if (!hasFiles(e)) return;
      e.preventDefault();
      const files = [...e.dataTransfer.files];
      const onCanvas = !!e.target.closest('#canvas-area') && this.doc;
      if (onCanvas && files.length === 1 && files[0].type.startsWith('image/')) this.openFiles(files, { place: true });
      else this.openFiles(files);
    });

    window.addEventListener('beforeunload', (e) => {
      if (this.docs.some((d) => d.dirty)) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
  },

  onKeyDown(e) {
    if (Dialogs.stack.length) return;
    if (Menus.key(e)) return;
    if (e.target.closest('input, textarea, select, [contenteditable]')) {
      if (e.key === 'Escape') e.target.blur();
      return;
    }
    if (e.code === 'Space') {
      e.preventDefault();
      if (!e.repeat && !Tools.session) { Tools.spaceHeld = true; Tools.updateCursor(); }
      return;
    }
    if (Tools.active().onKey?.(e)) { e.preventDefault(); return; }
    const combo = comboOf(e);
    if (combo === 'Ctrl+Shift+V') this.lastPasteInPlace = true;
    const c = Commands.byKey(combo);
    if (c) {
      e.preventDefault();
      if (Commands.enabled(c)) c.run();
      return;
    }
    if (!e.ctrlKey && !e.metaKey && !e.altKey && /^[A-Z]$/.test(keyName(e)) && Tools.byKey(keyName(e), e.shiftKey)) {
      e.preventDefault();
    }
  },
};

// ---------- Home screen (no documents open) ----------
const Home = {
  init() {
    this.el = document.getElementById('home-screen');
    this.update();
  },
  update() {
    const show = App.docs.length === 0;
    this.el.hidden = !show;
    document.body.classList.toggle('no-doc', show);
    if (!show) return;
    const recents = Store.get('recents').slice(0, 12);
    this.el.innerHTML = `
      <div class="home">
        <div class="home-side">
          <div class="home-brand"><span class="mb-logo big">Pc</span><div><h1>PhotoCrop</h1><p>Part of Crop Cloud</p></div></div>
          <button class="pbtn pbtn-primary home-btn" data-home="new">${icon('plus', 15)} New file</button>
          <button class="pbtn home-btn" data-home="open">${icon('upload', 15)} Open</button>
          <a class="home-link" href="../../index.html">${icon('home', 14)} Crop Cloud home</a>
        </div>
        <div class="home-main">
          <h2>Start something new</h2>
          <div class="home-presets">${DOC_PRESETS.slice(1, 7).map(([n, w, h, dpi], i) => `
            <button class="home-preset" data-preset="${i + 1}"><span class="hp-shape" style="aspect-ratio:${w}/${h}"></span><b>${esc(n)}</b><span>${w} × ${h}</span></button>`).join('')}</div>
          <h2>Recent</h2>
          ${recents.length ? `<div class="home-recents">${recents.map((f) => `
            <button class="home-recent" data-recent="${esc(f.id)}" title="${esc(f.name)}"><span class="hr-thumb"><img src="${f.thumb}" alt=""></span><b>${esc(f.name)}</b><span>${f.width} × ${f.height}</span></button>`).join('')}</div>`
            : '<p class="home-empty">Files you open will show up here. You can also drop an image anywhere in this window.</p>'}
        </div>
      </div>`;
    this.el.querySelector('[data-home="new"]').addEventListener('click', () => newDocumentDialog());
    this.el.querySelector('[data-home="open"]').addEventListener('click', () => App.pickFiles());
    this.el.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => {
      const [, w, h, dpi] = DOC_PRESETS[b.dataset.preset];
      newDocumentDialog({ width: w, height: h, dpi });
    }));
    this.el.querySelectorAll('[data-recent]').forEach((b) => b.addEventListener('click', () => App.openFromStore(b.dataset.recent)));
  },
};

App.init();
