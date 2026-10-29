// FrameCrop app controller: commands, menus, keyboard shortcuts, autosave and startup.

const FRAMECROP_VERSION = '0.1.1';
const PROJECT_KEY = 'framecrop.project';
const PREFS_KEY_FC = 'framecrop.prefs';

const CODE_KEYS_FC = {
  BracketLeft: '[', BracketRight: ']', Minus: '-', Equal: '=', NumpadAdd: '=', NumpadSubtract: '-', Quote: "'", Comma: ',', Period: '.',
  Slash: '/', Backslash: '\\', Semicolon: ';', Backquote: '`', NumpadEnter: 'Enter', Space: 'Space',
};

function keyNameFC(e) {
  const c = e.code || '';
  if (c.startsWith('Key')) return c.slice(3);
  if (c.startsWith('Digit')) return c.slice(5);
  if (/^Numpad\d$/.test(c)) return c.slice(6);
  if (CODE_KEYS_FC[c]) return CODE_KEYS_FC[c];
  return e.key.length === 1 ? e.key.toUpperCase() : e.key;
}

function comboFC(e) {
  const parts = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  parts.push(keyNameFC(e));
  return parts.join('+');
}

// ---------- Commands ----------
const Cmd = {
  map: {},
  keys: new Map(),
  define(id, label, keys, run, opts = {}) {
    const c = { id, label, keys: keys ? [].concat(keys) : [], run, ...opts };
    this.map[id] = c;
    for (const k of c.keys) this.keys.set(k, c);
  },
  item(id) {
    const c = this.map[id];
    return { label: typeof c.label === 'function' ? c.label() : c.label, shortcut: c.keys[0], run: () => c.run(), disabled: c.enabled ? !c.enabled() : false, checked: c.checked?.() };
  },
  run(id) { const c = this.map[id]; if (c && (!c.enabled || c.enabled())) c.run(); },
};

const hasSel = () => App.sel.size > 0;
const srcFocused = () => App.focused === 'source';
const D_ = Cmd.define.bind(Cmd);

// File
D_('new-project', 'New Project…', 'Ctrl+Alt+N', () => App.newProject());
D_('open-project', 'Open Project…', 'Ctrl+O', () => App.openProjectDialog());
D_('save-project', 'Save Project', 'Ctrl+S', () => App.saveProject());
D_('import', 'Import…', 'Ctrl+I', () => App.importDialog());
D_('import-timeline', 'Import Timeline (Resolve, Premiere, Final Cut)…', 'Ctrl+Alt+I', () => App.importTimelineDialog());
D_('export-media', 'Export Media…', 'Ctrl+M', () => exportDialog());
D_('export-frame', 'Export Frame', 'Ctrl+Shift+E', () => exportFrame());
D_('open-sample', 'Open Sample Video', null, () => Samples.load());
D_('home', 'Back to Crop Cloud', null, () => { location.href = '../../index.html'; });

// Edit
D_('undo', () => (History.undoStack.length ? `Undo ${History.undoStack[History.undoStack.length - 1].name}` : 'Undo'), 'Ctrl+Z', () => History.undo(), { enabled: () => History.undoStack.length > 0 });
D_('redo', () => (History.redoStack.length ? `Redo ${History.redoStack[History.redoStack.length - 1].name}` : 'Redo'), ['Ctrl+Shift+Z', 'Ctrl+Y'], () => History.redo(), { enabled: () => History.redoStack.length > 0 });
D_('cut', 'Cut', 'Ctrl+X', () => Edit.copy(true), { enabled: hasSel });
D_('copy', 'Copy', 'Ctrl+C', () => Edit.copy(), { enabled: hasSel });
D_('paste', 'Paste', 'Ctrl+V', () => Edit.paste(false), { enabled: () => !!Edit.clipboard });
D_('paste-insert', 'Paste Insert', 'Ctrl+Shift+V', () => Edit.paste(true), { enabled: () => !!Edit.clipboard });
D_('paste-attributes', 'Paste Attributes', 'Ctrl+Alt+V', () => Edit.pasteAttributes(), { enabled: () => !!Edit.clipboard && hasSel() });
D_('clear', 'Clear', ['Delete', 'Backspace'], () => Edit.deleteSelection(false), { enabled: () => hasSel() || !!App.selTrans });
D_('ripple-delete', 'Ripple Delete', ['Shift+Delete', 'Alt+Backspace', 'Shift+Backspace'], () => Edit.deleteSelection(true), { enabled: hasSel });
D_('select-all', 'Select All', 'Ctrl+A', () => Edit.select(Model.seq.clips.map((c) => c.id)));
D_('deselect', 'Deselect All', 'Ctrl+Shift+A', () => Edit.clearSelection());
D_('shortcuts', 'Keyboard Shortcuts…', 'Ctrl+Alt+K', () => shortcutsDialogFC());

// Clip
D_('speed', 'Speed/Duration…', 'Ctrl+R', () => speedDialog(), { enabled: hasSel });
D_('enable', 'Enable', 'Shift+E', () => Edit.toggleEnabled(), { enabled: hasSel });
D_('link', 'Link / Unlink', 'Ctrl+L', () => Edit.toggleLink(), { enabled: hasSel });
D_('scale-frame', 'Scale to Frame Size', null, () => History.step('Scale to Frame Size', () => { for (const c of Edit.selected()) if (c.motion) c.motion.fit = !c.motion.fit; }), { enabled: hasSel });
D_('nudge-left', 'Nudge Clip Left', 'Alt+ArrowLeft', () => Edit.nudge(-1), { enabled: hasSel, hidden: true });
D_('nudge-right', 'Nudge Clip Right', 'Alt+ArrowRight', () => Edit.nudge(1), { enabled: hasSel, hidden: true });

// Sequence
D_('seq-settings', 'Sequence Settings…', null, () => sequenceSettingsDialog());
D_('add-edit', 'Add Edit', 'Ctrl+K', () => Edit.splitAtPlayhead(false));
D_('add-edit-all', 'Add Edit to All Tracks', 'Ctrl+Shift+K', () => Edit.splitAtPlayhead(true));
D_('trim-prev', 'Ripple Trim Previous Edit to Playhead', 'Q', () => Edit.rippleTrimToPlayhead('prev'));
D_('trim-next', 'Ripple Trim Next Edit to Playhead', 'W', () => Edit.rippleTrimToPlayhead('next'));
D_('video-transition', 'Apply Video Transition', 'Ctrl+D', () => (App.workspace === 'color' ? ColorPage.toggleNode() : Edit.applyDefaultTransition('video')));
D_('audio-transition', 'Apply Audio Transition', 'Ctrl+Shift+D', () => Edit.applyDefaultTransition('audio'));
D_('both-transitions', 'Apply Default Transitions to Selection', 'Shift+D', () => { Edit.applyDefaultTransition('video'); Edit.applyDefaultTransition('audio'); });
D_('lift', 'Lift', ';', () => Edit.liftExtract(false));
D_('extract', 'Extract', "'", () => Edit.liftExtract(true));
D_('insert', 'Insert from Source', ',', () => Edit.fromSource(true));
D_('overwrite', 'Overwrite from Source', '.', () => Edit.fromSource(false));
D_('snap', 'Snap in Timeline', 'S', () => App.toggle('snap'), { checked: () => App.snap });
D_('linked-selection', 'Linked Selection', null, () => App.toggle('linked'), { checked: () => App.linked });
D_('zoom-in', 'Zoom In', ['=', 'Shift+='], () => Timeline.zoomAt(Timeline.ppf * 1.5));
D_('zoom-out', 'Zoom Out', '-', () => Timeline.zoomAt(Timeline.ppf / 1.5));
D_('zoom-fit', 'Zoom to Sequence', '\\', () => Timeline.zoomToFit());
D_('remove-silence', 'Remove Silence…', 'Ctrl+Alt+R', () => removeSilenceDialog(), { enabled: () => Model.seq.clips.some((c) => c.kind === 'audio') });
D_('add-video-track', 'Add Video Track', null, () => Edit.addTrack('video'));
D_('add-audio-track', 'Add Audio Track', null, () => Edit.addTrack('audio'));

// Markers & navigation
D_('mark-in', 'Mark In', 'I', () => (srcFocused() ? Source.mark('in') : Edit.setInOut('in')));
D_('mark-out', 'Mark Out', 'O', () => (srcFocused() ? Source.mark('out') : Edit.setInOut('out')));
D_('mark-clip', 'Mark Clip', 'X', () => Edit.markClip());
D_('go-in', 'Go to In', 'Shift+I', () => Model.seq.inPoint != null && Player.seek(Model.seq.inPoint));
D_('go-out', 'Go to Out', 'Shift+O', () => Model.seq.outPoint != null && Player.seek(Model.seq.outPoint - 1));
D_('clear-in', 'Clear In', 'Ctrl+Shift+I', () => Edit.setInOut('clear-in'));
D_('clear-out', 'Clear Out', 'Ctrl+Shift+O', () => Edit.setInOut('clear-out'));
D_('clear-inout', 'Clear In and Out', 'Ctrl+Shift+X', () => (srcFocused() ? Source.mark('clear') : Edit.setInOut('clear')));
D_('add-marker', 'Add Marker', 'M', () => Edit.addMarker());
D_('next-marker', 'Go to Next Marker', 'Shift+M', () => Edit.jumpMarker(1));
D_('prev-marker', 'Go to Previous Marker', 'Ctrl+Shift+M', () => Edit.jumpMarker(-1));
D_('clear-markers', 'Clear All Markers', null, () => History.step('Clear Markers', () => { Model.seq.markers = []; }));

// Transport (context: Source monitor when it has focus)
D_('play', 'Play/Stop', 'Space', () => (srcFocused() ? Source.toggle() : Player.toggle()), { hidden: true });
D_('shuttle-l', 'Shuttle Right', 'L', () => (srcFocused() ? Source.shuttle(1) : Player.shuttle(1)), { hidden: true });
D_('shuttle-k', 'Shuttle Stop', 'K', () => (srcFocused() ? Source.shuttle(0) : Player.shuttle(0)), { hidden: true });
D_('shuttle-j', 'Shuttle Left', 'J', () => (srcFocused() ? Source.shuttle(-1) : Player.shuttle(-1)), { hidden: true });
D_('step-back', 'Step Back', 'ArrowLeft', () => (srcFocused() ? Source.step(-1) : Player.step(-1)), { hidden: true });
D_('step-fwd', 'Step Forward', 'ArrowRight', () => (srcFocused() ? Source.step(1) : Player.step(1)), { hidden: true });
D_('step-back5', 'Step Back 5 Frames', 'Shift+ArrowLeft', () => (srcFocused() ? Source.step(-5) : Player.step(-5)), { hidden: true });
D_('step-fwd5', 'Step Forward 5 Frames', 'Shift+ArrowRight', () => (srcFocused() ? Source.step(5) : Player.step(5)), { hidden: true });
D_('prev-edit', 'Go to Previous Edit Point', 'ArrowUp', () => Edit.jumpEdit(-1), { hidden: true });
D_('next-edit', 'Go to Next Edit Point', 'ArrowDown', () => Edit.jumpEdit(1), { hidden: true });
D_('go-start', 'Go to Sequence Start', 'Home', () => Player.seek(0), { hidden: true });
D_('go-end', 'Go to Sequence End', 'End', () => Player.seek(Math.max(0, Model.duration() - 1)), { hidden: true });
D_('maximize', 'Maximize Panel', '`', () => Layout.maxUnderPointer(), { hidden: true });

// Graphics
D_('new-text', 'New Layer › Text', 'Ctrl+T', () => { Edit.addSynthetic('title'); App.showPanel('graphics'); });
D_('new-matte', 'New Layer › Color Matte', null, () => Edit.addSynthetic('color'));
D_('new-adjustment', 'New Layer › Adjustment Layer', null, () => Edit.addSynthetic('adjustment'));

// Color (DaVinci-style)
D_('add-serial-node', 'Add Serial Node', 'Alt+S', () => ColorPage.addSerialNode());
D_('toggle-node', 'Enable/Disable Current Node', null, () => ColorPage.toggleNode());
D_('reset-node', 'Reset Current Node', null, () => ColorPage.resetNode());
D_('reset-grade', 'Reset Grade', null, () => ColorPage.resetGrade());
D_('copy-grade', 'Copy Grade', null, () => ColorPage.copyGrade());
D_('paste-grade', 'Paste Grade', null, () => ColorPage.pasteGrade());
D_('grade-all', 'Apply Grade to All Clips', null, () => ColorPage.applyToAll());
D_('load-lut', 'Load LUT (.cube)…', null, () => ColorPage.loadLUT());

// Tools
for (const [id, name, key] of TOOLS) D_(`tool-${id}`, name, key, () => App.setTool(id), { hidden: true });

// Workspaces
Object.keys(WORKSPACES).forEach((id, i) => D_(`ws-${id}`, WORKSPACES[id].label, `Alt+Shift+${i + 1}`, () => Layout.setWorkspace(id), { checked: () => App.workspace === id }));
D_('reset-ws', 'Reset to Saved Layout', null, () => Layout.resetWorkspace());

const SEP_ = { sep: true };
const ci = (id) => Cmd.item(id);
const subm = (label, items) => ({ label, submenu: () => items().filter(Boolean) });

const MENUS_FC = [
  ['File', () => [ci('new-project'), ci('open-project'), ci('save-project'), SEP_, ci('import'), ci('import-timeline'), ci('open-sample'), SEP_, subm('Export', () => [ci('export-media'), ci('export-frame')]), SEP_, ci('home')]],
  ['Edit', () => [ci('undo'), ci('redo'), SEP_, ci('cut'), ci('copy'), ci('paste'), ci('paste-insert'), ci('paste-attributes'), SEP_, ci('clear'), ci('ripple-delete'), SEP_, ci('select-all'), ci('deselect'), SEP_, ci('shortcuts')]],
  ['Clip', () => [ci('speed'), ci('enable'), ci('link'), ci('scale-frame')]],
  ['Sequence', () => [ci('seq-settings'), SEP_, ci('add-edit'), ci('add-edit-all'), ci('trim-prev'), ci('trim-next'), SEP_, ci('video-transition'), ci('audio-transition'), ci('both-transitions'), SEP_, ci('lift'), ci('extract'), ci('insert'), ci('overwrite'), SEP_, ci('remove-silence'), SEP_, ci('zoom-in'), ci('zoom-out'), ci('zoom-fit'), ci('snap'), ci('linked-selection'), SEP_, ci('add-video-track'), ci('add-audio-track')]],
  ['Markers', () => [ci('mark-in'), ci('mark-out'), ci('mark-clip'), SEP_, ci('go-in'), ci('go-out'), SEP_, ci('clear-in'), ci('clear-out'), ci('clear-inout'), SEP_, ci('add-marker'), ci('next-marker'), ci('prev-marker'), ci('clear-markers')]],
  ['Graphics', () => [ci('new-text'), ci('new-matte'), ci('new-adjustment')]],
  ['Color', () => [ci('add-serial-node'), ci('toggle-node'), ci('reset-node'), ci('reset-grade'), SEP_, ci('copy-grade'), ci('paste-grade'), ci('grade-all'), SEP_, ci('load-lut'), SEP_, { label: 'Open Color Workspace', run: () => Layout.setWorkspace('color') }]],
  ['Window', () => [...Object.keys(WORKSPACES).map((id) => ci(`ws-${id}`)), ci('reset-ws'), SEP_, ...['project', 'source', 'program', 'timeline', 'effectControls', 'effects', 'audioMixer', 'graphics', 'history', 'markers', 'colorWheels', 'curves', 'nodes', 'scopes'].map((id) => ({ label: Panels[id].title, checked: Layout.isVisible(id), run: () => App.showPanel(id) }))]],
  ['Help', () => [ci('shortcuts'), { label: 'About FrameCrop…', run: () => aboutDialogFC() }]],
];

// The shared menu code (from PhotoCrop) calls Menubar.step for arrow keys.
const Menubar = {
  open: -1,
  init() {
    const el = document.getElementById('menubar');
    el.innerHTML = `<span class="fc-logo">Fc</span>${MENUS_FC.map(([label], i) => `<button class="menubar-item" data-i="${i}">${label}</button>`).join('')}`;
    el.querySelectorAll('.menubar-item').forEach((b) => {
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        if (this.open === +b.dataset.i) Menus.closeAll(); else this.show(+b.dataset.i);
      });
      b.addEventListener('pointerenter', () => { if (this.open >= 0 && this.open !== +b.dataset.i) this.show(+b.dataset.i); });
    });
    this.el = el;
  },
  show(i) {
    Menus.closeAll();
    const btn = this.el.querySelector(`[data-i="${i}"]`);
    const r = btn.getBoundingClientRect();
    this.open = i;
    btn.classList.add('open');
    Menus.open(MENUS_FC[i][1], r.left, r.bottom);
    Menus.onClose(() => { this.open = -1; this.el.querySelectorAll('.menubar-item').forEach((x) => x.classList.remove('open')); });
  },
  step(dir) {
    if (this.open < 0) return false;
    this.show((this.open + dir + MENUS_FC.length) % MENUS_FC.length);
    return true;
  },
};

// ---------- App ----------
const App = {
  sel: new Set(),
  selTrans: null,
  tool: 'select',
  snap: true,
  linked: true,
  workspace: 'editing',
  focused: 'timeline',
  dragMedia: null,
  pointer: { x: 0, y: 0 },

  async init() {
    this.loadPrefs();
    const restored = this.restoreProject();
    if (!restored) Model.newProject();
    mountPanels();
    Layout.ws = this.workspace;
    Layout.render();
    Menubar.init();
    this.bindHeader();
    this.bindGlobal();
    this.updateTitle();
    if (restored) await this.reconnectMedia();
    Player.renderExact();
    Timeline.zoomToFit();
  },

  // ---------- State changes ----------
  changed(info = {}) {
    for (const id of [...this.sel]) if (!Model.clip(id)) this.sel.delete(id);
    if (this.selTrans && !Model.clip(this.selTrans.clipId)) this.selTrans = null;
    if (!info.silent) Bus.emit('project');
    if (info.undo) toast(`Undo ${info.undo}`, { timeout: 1200 });
    this.invalidate();
    this.autosave();
    this.updateTitle();
  },

  invalidate() {
    if (Player.playing || this.renderQueued) return;
    this.renderQueued = true;
    requestAnimationFrame(() => {
      this.renderQueued = false;
      Player.renderExact();
    });
  },

  toggle(flag) {
    this[flag] = !this[flag];
    Bus.emit('flags');
    this.savePrefs();
    toast(`${flag === 'snap' ? 'Snap' : 'Linked selection'} ${this[flag] ? 'on' : 'off'}`, { timeout: 1000 });
  },

  setTool(id) {
    this.tool = id;
    Bus.emit('tool');
    this.updateTitle();
  },

  focusPanel(id) {
    if (this.focused === id) return;
    this.focused = id;
    document.querySelectorAll('.dock').forEach((d) => d.classList.toggle('focused', !!d.querySelector(`.panel-${id}`)));
  },

  showPanel(id) { Layout.show(id); },
  scopesVisible() { return Layout.isVisible('scopes'); },

  busy(msg) {
    const el = document.getElementById('busy');
    el.hidden = !msg;
    if (msg) el.textContent = msg;
  },

  updateTitle() {
    const name = Model.data?.name || 'FrameCrop';
    document.title = `${name} · FrameCrop`;
    const t = document.getElementById('hdr-title');
    if (t) t.textContent = `${name} — ${Model.seq.name}`;
  },

  // ---------- Preferences ----------
  loadPrefs() {
    let p = {};
    try { p = JSON.parse(localStorage.getItem(PREFS_KEY_FC)) || {}; } catch { /* first run */ }
    this.workspace = WORKSPACES[p.workspace] ? p.workspace : 'editing';
    this.snap = p.snap ?? true;
    this.linked = p.linked ?? true;
    Program.quality = p.quality ?? 0.5;
    Layout.sizes = p.sizes || {};
    Layout.active = p.active || {};
  },

  savePrefs() {
    clearTimeout(this.prefsTimer);
    this.prefsTimer = setTimeout(() => {
      try {
        localStorage.setItem(PREFS_KEY_FC, JSON.stringify({ workspace: this.workspace, snap: this.snap, linked: this.linked, quality: Program.quality, sizes: Layout.sizes, active: Layout.active }));
      } catch { /* storage full or blocked */ }
    }, 300);
  },

  // ---------- Projects ----------
  autosave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      try { localStorage.setItem(PROJECT_KEY, JSON.stringify(Model.data)); } catch (err) { console.warn('Autosave failed', err); }
    }, 400);
  },

  restoreProject() {
    try {
      const data = JSON.parse(localStorage.getItem(PROJECT_KEY));
      if (data?.version === 1 && data.seq) { Model.data = this.normalize(data); return true; }
    } catch { /* ignore broken autosave */ }
    return false;
  },

  // JSON turns Infinity into null; images have unlimited duration.
  normalize(data) {
    for (const m of data.media) if (m.kind === 'image') m.duration = Infinity;
    data.luts ||= [];
    return data;
  },

  async reconnectMedia() {
    const offline = [];
    await Promise.all(Model.data.media.map(async (m) => {
      if (!(await Media.restore(m))) offline.push(m.name);
    }));
    await Promise.all(Model.data.luts.map(async (l) => {
      try {
        const blob = await FileStore.get(l.fileKey);
        if (blob) LutRT.set(l.id, parseCube(await blob.text()));
      } catch { /* LUT missing */ }
    }));
    Bus.emit('media');
    if (offline.length) toast(`${offline.length} media file${offline.length === 1 ? ' is' : 's are'} offline. Double-click in the Project panel to relink.`);
  },

  async newProject() {
    if (Model.seq.clips.length || Model.data.media.length) {
      const answer = await confirmDialog({ title: 'New Project', message: 'Start a new project? The current one is autosaved only until you replace it, so save it first (Ctrl+S) if you want to keep it.', okLabel: 'New Project' });
      if (answer !== 'ok') return;
    }
    Player.pause();
    Model.newProject();
    History.clear();
    this.sel.clear();
    Source.close();
    this.changed();
    Bus.emit('sequence');
    Bus.emit('media');
  },

  saveProject() {
    const blob = new Blob([JSON.stringify(Model.data, null, 1)], { type: 'application/json' });
    saveBlob(blob, `${Model.data.name}.fcrop`, { description: 'FrameCrop project', accept: { 'application/json': ['.fcrop'] } })
      .then((r) => { if (r) toast(`Saved ${r === 'download' ? `${Model.data.name}.fcrop` : r.name}`); });
  },

  openProjectDialog() {
    const input = document.getElementById('file-input');
    input.accept = '.fcrop,application/json';
    input.multiple = false;
    input.onchange = async () => {
      const file = input.files[0];
      input.value = '';
      if (!file) return;
      try {
        const data = JSON.parse(await file.text());
        if (data.version !== 1 || !data.seq) throw new Error('bad');
        Player.pause();
        Model.data = this.normalize(data);
        Model.data.name = file.name.replace(/\.fcrop$/i, '');
        History.clear();
        this.sel.clear();
        this.changed();
        Bus.emit('sequence');
        await this.reconnectMedia();
        Timeline.zoomToFit();
      } catch {
        toast(`"${file.name}" isn't a FrameCrop project.`);
      }
    };
    input.click();
  },

  importDialog() {
    const input = document.getElementById('file-input');
    input.accept = 'video/*,audio/*,image/*,.mov,.mkv,.m4a,.flac,.fcpxml,.xml,.edl,.otio';
    input.multiple = true;
    input.onchange = () => {
      const files = [...input.files];
      input.value = '';
      if (files.length) Media.importFiles(files);
    };
    input.click();
  },

  importTimelineDialog() {
    const input = document.getElementById('file-input');
    input.accept = '.fcpxml,.xml,.edl,.otio';
    input.multiple = false;
    input.onchange = () => {
      const file = input.files[0];
      input.value = '';
      if (file) Interchange.openFile(file);
    };
    input.click();
  },

  // ---------- UI wiring ----------
  bindHeader() {
    const hdr = document.getElementById('header');
    hdr.innerHTML = `
      <a class="hdr-home" href="../../index.html" title="Back to Crop Cloud">${icon('home', 15)}</a>
      <button class="hdr-mode" data-hdr="import">Import</button>
      <button class="hdr-mode on" data-hdr="edit">Edit</button>
      <button class="hdr-mode" data-hdr="export">Export</button>
      <span class="hdr-sep"></span>
      ${Object.entries(WORKSPACES).map(([id, w]) => `<button class="hdr-ws" data-ws="${id}">${w.label}</button>`).join('')}
      <span class="tl-spacer"></span>
      <span class="hdr-title" id="hdr-title"></span>
      <span class="hdr-busy" id="busy" hidden></span>
      <span class="tl-spacer"></span>
      <button class="pbtn pbtn-primary hdr-export" data-hdr="export">${icon('exportIcon', 14)} Export</button>`;
    hdr.querySelectorAll('[data-ws]').forEach((b) => b.addEventListener('click', () => Layout.setWorkspace(b.dataset.ws)));
    hdr.querySelectorAll('[data-hdr]').forEach((b) => b.addEventListener('click', () => {
      if (b.dataset.hdr === 'import') this.importDialog();
      if (b.dataset.hdr === 'export') exportDialog();
    }));
    hdr.querySelectorAll('[data-ws]').forEach((b) => b.classList.toggle('on', b.dataset.ws === Layout.ws));
  },

  bindGlobal() {
    document.addEventListener('keydown', (e) => this.onKey(e));
    document.addEventListener('pointermove', (e) => { this.pointer = { x: e.clientX, y: e.clientY }; }, { passive: true });
    document.addEventListener('pointerdown', () => Player.ensureAudio().resume(), { once: true });
    // Files dropped outside the timeline go into the Project panel.
    document.addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
    document.addEventListener('drop', (e) => {
      if (e.defaultPrevented || !e.dataTransfer.files.length) return;
      e.preventDefault();
      Media.importFiles([...e.dataTransfer.files]);
    });
    window.addEventListener('beforeunload', () => {
      try { localStorage.setItem(PROJECT_KEY, JSON.stringify(Model.data)); } catch { /* best effort */ }
    });
  },

  onKey(e) {
    if (Dialogs.stack.length) return;
    if (Menus.key(e)) return;
    if (e.target.closest('input, textarea, select, [contenteditable]')) {
      if (e.key === 'Escape') e.target.blur();
      return;
    }
    if (e.key === 'Escape' && Timeline.drag) {
      if (History.pendingBefore) { History.restore(History.pendingBefore); History.pendingBefore = null; }
      Timeline.drag = null;
      this.changed({ silent: false });
      return;
    }
    const c = Cmd.keys.get(comboFC(e));
    if (!c) return;
    e.preventDefault();
    if (!c.enabled || c.enabled()) c.run();
  },
};

// The bundled sample clip (samples/sample-talk.js holds it as a data URL, which
// works from file:// without extra browser permissions).
const Samples = {
  async load(name = 'sample-talk.mp4') {
    try {
      App.busy('Loading sample…');
      if (!window.FRAMECROP_SAMPLES?.[name]) {
        await new Promise((resolve, reject) => {
          const s = document.createElement('script');
          s.src = 'samples/sample-talk.js';
          s.onload = resolve;
          s.onerror = () => reject(new Error('samples/sample-talk.js is missing'));
          document.head.append(s);
        });
      }
      const blob = await (await fetch(window.FRAMECROP_SAMPLES[name])).blob();
      let item = Model.data.media.find((m) => m.name === name && Media.isOnline(m.id));
      if (!item) [item] = await Media.importFiles([new File([blob], name, { type: 'video/mp4' })]);
      if (!item) return;
      if (!Model.seq.clips.length) {
        Edit.placeMedia(item, { frame: 0 });
        Timeline.zoomToFit();
        Player.seek(0);
      }
      toast('Sample loaded. Try Sequence › Remove Silence… (Ctrl+Alt+R)');
    } catch (err) {
      toast(`Couldn't load the sample: ${err.message}`);
    } finally {
      App.busy(false);
    }
  },
};

function shortcutsDialogFC() {
  const rows = Object.values(Cmd.map).filter((c) => c.keys.length);
  const label = (c) => (typeof c.label === 'function' ? c.id.replace(/-/g, ' ').replace(/^\w/, (m) => m.toUpperCase()) : c.label);
  openDialog({
    title: 'Keyboard Shortcuts',
    width: 680,
    cancelLabel: '',
    body: `<div class="shortcuts-fc">${rows.map((c) => `<div class="sc-row"><span>${esc(label(c))}</span><span>${c.keys.map((k) => `<kbd>${esc(k.replace('Arrow', ''))}</kbd>`).join(' ')}</span></div>`).join('')}</div>`,
  });
}

function aboutDialogFC() {
  openDialog({
    title: 'About FrameCrop',
    width: 420,
    cancelLabel: '',
    body: `<div class="about"><span class="about-tile fc">Fc</span><h3>FrameCrop</h3><p>Version ${FRAMECROP_VERSION} · part of Crop Cloud</p>
      <p class="pdialog-note">A video editor with a familiar editing layout and node-based color tools, running in your browser with GPU rendering and hardware encoding.</p></div>`,
  });
}

App.init();
