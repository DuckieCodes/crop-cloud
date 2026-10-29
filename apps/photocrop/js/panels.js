// Toolbar, document tabs, status bar and the panel dock
// (Color, Swatches, Properties, Adjustments, History, Layers).

// ---------- Toolbar ----------
const Toolbar = {
  el: null,
  flyout: null,

  init() {
    this.el = document.getElementById('toolbar');
    this.render();
    Bus.on('tool', () => this.render());
    Bus.on('colors', () => this.renderColors());
  },

  render() {
    const current = Tools.current;
    this.el.innerHTML = `
      <div class="tb-grip"></div>
      ${TOOL_GROUPS.map((g, i) => {
        const id = g.includes(current) ? current : Tools.lastInGroup[i] || g[0];
        const t = Tools.defs[id];
        return `<button class="tb-btn${g.includes(current) ? ' active' : ''}" data-group="${i}" data-tool="${id}" title="${esc(t.name)} (${t.key})" aria-label="${esc(t.name)}">
          ${icon(t.icon, 18)}${g.length > 1 ? '<span class="tb-corner"></span>' : ''}</button>`;
      }).join('')}
      <div class="tb-colors" id="tb-colors"></div>`;
    this.renderColors();
    this.el.querySelectorAll('.tb-btn').forEach((b) => {
      let timer = 0;
      b.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        timer = setTimeout(() => { timer = 0; this.openFlyout(b); }, 450);
      });
      b.addEventListener('pointerup', () => {
        if (!timer) return;
        clearTimeout(timer);
        timer = 0;
        Tools.select(b.dataset.tool);
      });
      b.addEventListener('pointerleave', () => { clearTimeout(timer); timer = 0; });
      b.addEventListener('contextmenu', (e) => { e.preventDefault(); this.openFlyout(b); });
      b.addEventListener('dblclick', () => {
        if (b.dataset.tool === 'hand') View.fit();
        if (b.dataset.tool === 'zoom') View.setZoom(App.doc, 1);
      });
    });
  },

  openFlyout(btn) {
    const group = TOOL_GROUPS[btn.dataset.group];
    if (group.length < 2) { Tools.select(btn.dataset.tool); return; }
    const r = btn.getBoundingClientRect();
    Menus.open(group.map((id) => {
      const t = Tools.defs[id];
      return { label: t.name, shortcut: t.key, checked: id === Tools.current, run: () => Tools.select(id) };
    }), r.right + 4, r.top);
  },

  renderColors() {
    const el = document.getElementById('tb-colors');
    if (!el) return;
    el.innerHTML = `
      <button class="tb-swatch tb-bg" style="background:${rgbToHex(App.bg)}" title="Set background color" data-color="bg"></button>
      <button class="tb-swatch tb-fg" style="background:${rgbToHex(App.fg)}" title="Set foreground color" data-color="fg"></button>
      <button class="tb-swap" title="Switch colors (X)">${icon('swapColors', 12)}</button>
      <button class="tb-default" title="Default colors (D)"><span></span><span></span></button>`;
    el.querySelectorAll('[data-color]').forEach((b) => b.addEventListener('click', () => colorPickerDialog(b.dataset.color)));
    el.querySelector('.tb-swap').addEventListener('click', () => App.swapColors());
    el.querySelector('.tb-default').addEventListener('click', () => App.defaultColors());
  },
};

// ---------- Document tabs ----------
const DocTabs = {
  init() {
    this.el = document.getElementById('doc-tabs');
    Bus.on('docs', () => this.render());
    Bus.on('doc', () => this.render());
    Bus.on('view', () => this.render());
    Bus.on('layers', () => this.render());
    this.render();
  },
  label(doc) {
    const layer = doc.active;
    return `${doc.name} @ ${Math.round(doc.view.zoom * 1000) / 10}% (${layer ? layer.name : 'RGB'}, RGB/8)${doc.dirty ? '*' : ''}`;
  },
  render() {
    this.el.innerHTML = App.docs.map((d) => `
      <div class="doc-tab${d === App.doc ? ' active' : ''}" data-id="${d.id}" title="${esc(d.name)}">
        <span class="doc-tab-name">${esc(this.label(d))}</span>
        <button class="doc-tab-x" data-close="${d.id}" aria-label="Close ${esc(d.name)}">${icon('x', 12)}</button>
      </div>`).join('');
    this.el.querySelectorAll('.doc-tab').forEach((t) => t.addEventListener('pointerdown', (e) => {
      if (e.target.closest('[data-close]')) return;
      App.setDoc(App.docs.find((d) => d.id === t.dataset.id));
    }));
    this.el.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => App.closeDoc(App.docs.find((d) => d.id === b.dataset.close))));
    document.title = App.doc ? `${this.label(App.doc)} · PhotoCrop` : 'PhotoCrop';
  },
};

// ---------- Status bar ----------
const Status = {
  init() {
    this.el = document.getElementById('status');
    Bus.on('view', () => this.render());
    Bus.on('docs', () => this.render());
    Bus.on('doc', () => this.render());
    Bus.on('tool', () => this.render());
    this.render();
  },
  render() {
    const doc = App.doc;
    if (!doc) { this.el.innerHTML = ''; return; }
    const tool = Transform.active ? Tools.defs.transform : Tools.tool;
    this.el.innerHTML = `
      <span class="st-zoom"><input id="zoom-input" value="${Math.round(doc.view.zoom * 1000) / 10}%" aria-label="Zoom level"></span>
      <span>${doc.width} px × ${doc.height} px (${doc.dpi} ppi)</span>
      <span class="st-coords" id="st-coords"></span>
      <span class="st-tool">${esc(tool.name)}</span>`;
    const input = this.el.querySelector('#zoom-input');
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const v = parseFloat(input.value);
      if (v > 0) View.setZoom(doc, v / 100);
      input.blur();
    });
  },
  coords(p) {
    const el = document.getElementById('st-coords');
    if (el) el.textContent = p ? `X: ${Math.floor(p.x)}  Y: ${Math.floor(p.y)}` : '';
  },
};

// ---------- Dock ----------
const PANEL_DEFS = {
  color: { title: 'Color' },
  swatches: { title: 'Swatches' },
  properties: { title: 'Properties' },
  adjustments: { title: 'Adjustments' },
  history: { title: 'History' },
  layers: { title: 'Layers' },
};
const DOCK_GROUPS = [
  { id: 'top', tabs: ['color', 'swatches'] },
  { id: 'mid', tabs: ['properties', 'adjustments', 'history'] },
  { id: 'bottom', tabs: ['layers'] },
];

const DEFAULT_SWATCHES = (() => {
  const out = ['#ffffff', '#d9d9d9', '#b3b3b3', '#8c8c8c', '#666666', '#404040', '#1a1a1a', '#000000'];
  for (const l of [0.85, 0.65, 0.5, 0.35, 0.2]) {
    for (const h of [0, 25, 50, 90, 140, 180, 210, 250, 290, 330]) {
      const [r, g, b] = hslToRgb(h, l === 0.5 ? 1 : 0.75, l);
      out.push(rgbToHex({ r, g, b }));
    }
  }
  return out;
})();

const Dock = {
  active: { top: 'color', mid: 'properties', bottom: 'layers' },
  collapsed: {},

  init() {
    this.el = document.getElementById('dock');
    this.render();
    Bus.on('docs', () => this.refreshAll());
    Bus.on('doc', () => this.refreshAll());
    Bus.on('layers', () => { this.refresh('layers'); this.refresh('properties'); });
    Bus.on('colors', () => { this.refresh('color'); });
    Bus.on('selection', () => this.refresh('properties'));
    Bus.on('tool', () => this.refresh('properties'));
  },

  visible(id) { return App.panels[id] !== false; },

  render() {
    this.el.innerHTML = DOCK_GROUPS.map((g) => {
      const tabs = g.tabs.filter((t) => this.visible(t));
      if (!tabs.length) return '';
      if (!tabs.includes(this.active[g.id])) this.active[g.id] = tabs[0];
      return `
        <section class="pgroup pgroup-${g.id}${this.collapsed[g.id] ? ' collapsed' : ''}" data-group="${g.id}">
          <div class="pgroup-tabs">
            ${tabs.map((t) => `<button class="ptab${this.active[g.id] === t ? ' active' : ''}" data-tab="${t}">${PANEL_DEFS[t].title}</button>`).join('')}
            <button class="ptab-menu" data-menu="${g.id}" aria-label="Panel menu">${icon('menu', 13)}</button>
          </div>
          <div class="pgroup-body" id="panel-${this.active[g.id]}"></div>
        </section>`;
    }).join('');
    this.el.querySelectorAll('.pgroup').forEach((sec) => {
      const gid = sec.dataset.group;
      sec.querySelectorAll('.ptab').forEach((b) => b.addEventListener('click', () => {
        if (this.active[gid] === b.dataset.tab && this.collapsed[gid]) this.collapsed[gid] = false;
        this.active[gid] = b.dataset.tab;
        this.render();
      }));
      sec.querySelector('.pgroup-tabs').addEventListener('dblclick', () => { this.collapsed[gid] = !this.collapsed[gid]; this.render(); });
      sec.querySelector('.ptab-menu').addEventListener('click', (e) => {
        const r = e.currentTarget.getBoundingClientRect();
        Menus.open(this.panelMenu(this.active[gid]), r.left - 180, r.bottom);
      });
    });
    this.refreshAll();
  },

  panelMenu(id) {
    if (id === 'layers') return LayersPanel.menu();
    if (id === 'history') return [Commands.item('undo'), Commands.item('redo'), { sep: true }, { label: 'Clear History', disabled: !App.doc, run: () => App.clearHistory() }];
    if (id === 'swatches') return [{ label: 'New Swatch from Foreground', run: () => SwatchesPanel.add() }, { label: 'Reset Swatches', run: () => SwatchesPanel.reset() }];
    return [{ label: `Close ${PANEL_DEFS[id].title}`, run: () => App.togglePanel(id) }];
  },

  refreshAll() {
    for (const g of DOCK_GROUPS) this.refresh(this.active[g.id]);
  },

  refresh(id) {
    const el = document.getElementById(`panel-${id}`);
    if (!el) return;
    ({ color: ColorPanel, swatches: SwatchesPanel, properties: PropertiesPanel, adjustments: AdjustmentsPanel, history: HistoryPanel, layers: LayersPanel })[id].render(el);
  },
};

// ---------- Color ----------
const ColorPanel = {
  which: 'fg',
  render(el) {
    if (!el.querySelector('.cf')) {
      el.innerHTML = `
        <div class="colorpanel">
          <div class="cpanel-chips">
            <button class="cpanel-chip" data-which="fg" title="Foreground color"></button>
            <button class="cpanel-chip" data-which="bg" title="Background color"></button>
          </div>
          ${COLOR_FIELD_HTML}
        </div>
        <label class="cpanel-hex"><span>#</span><input data-hex maxlength="7" spellcheck="false" aria-label="Hex color"></label>`;
      this.field = mountColorField(el, () => App[this.which], (rgb) => App.setColor(this.which, rgb, { live: true }));
      el.querySelectorAll('.cpanel-chip').forEach((b) => {
        b.addEventListener('click', () => { if (this.which === b.dataset.which) colorPickerDialog(this.which); this.which = b.dataset.which; this.render(el); });
      });
      el.querySelector('[data-hex]').addEventListener('change', (e) => {
        const rgb = hexToRgb(e.target.value);
        if (rgb) App.setColor(this.which, rgb);
      });
    }
    el.querySelectorAll('.cpanel-chip').forEach((b) => {
      b.style.background = rgbToHex(App[b.dataset.which]);
      b.classList.toggle('active', b.dataset.which === this.which);
    });
    const hex = el.querySelector('[data-hex]');
    if (document.activeElement !== hex) hex.value = rgbToHex(App[this.which]).slice(1);
    if (!App.colorLive) this.field.refresh();
  },
};

// ---------- Swatches ----------
const SwatchesPanel = {
  list() {
    try { return JSON.parse(localStorage.getItem('photocrop.swatches')) || DEFAULT_SWATCHES; } catch { return DEFAULT_SWATCHES; }
  },
  save(list) {
    try { localStorage.setItem('photocrop.swatches', JSON.stringify(list)); } catch { /* storage full or blocked */ }
  },
  add() {
    this.save([...this.list(), rgbToHex(App.fg)]);
    Dock.refresh('swatches');
  },
  reset() {
    this.save(DEFAULT_SWATCHES);
    Dock.refresh('swatches');
  },
  render(el) {
    el.innerHTML = `
      <div class="swatches">${this.list().map((c, i) => `<button class="swatch" style="background:${c}" data-i="${i}" title="${c} — click: foreground, Alt-click: background, right-click: delete"></button>`).join('')}
        <button class="swatch swatch-add" title="New swatch from foreground color">${icon('plus', 12)}</button></div>`;
    el.querySelectorAll('.swatch[data-i]').forEach((b) => {
      b.addEventListener('click', (e) => App.setColor(e.altKey || e.ctrlKey ? 'bg' : 'fg', hexToRgb(this.list()[b.dataset.i])));
      b.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const list = this.list();
        list.splice(+b.dataset.i, 1);
        this.save(list);
        this.render(el);
      });
    });
    el.querySelector('.swatch-add').addEventListener('click', () => this.add());
  },
};

// ---------- Adjustments ----------
const AdjustmentsPanel = {
  render(el) {
    el.innerHTML = `
      <p class="panel-hint">Add an adjustment layer</p>
      <div class="adj-grid">${Object.entries(ADJUSTMENTS).map(([k, d]) => `
        <button class="adj-btn" data-kind="${k}" title="${esc(d.name)}" ${App.doc ? '' : 'disabled'}>${icon(d.icon, 18)}</button>`).join('')}</div>`;
    el.querySelectorAll('.adj-btn').forEach((b) => b.addEventListener('click', () => LayerOps.newAdjustment(App.doc, b.dataset.kind)));
  },
};

// ---------- History ----------
const HistoryPanel = {
  render(el) {
    const doc = App.doc;
    if (!doc) { el.innerHTML = '<p class="panel-empty">No document open</p>'; return; }
    const h = doc.history;
    el.innerHTML = `<div class="hist-list">${h.entries.map((e, i) => `
      <button class="hist-row${i === h.index ? ' active' : ''}${i > h.index ? ' future' : ''}" data-i="${i}">
        ${e.base ? `<span class="hist-snap">${icon('image', 14)}</span>` : icon(e.icon || 'image', 14)}<span>${esc(e.base ? doc.name : e.name)}</span>
      </button>`).join('')}</div>`;
    el.querySelectorAll('.hist-row').forEach((b) => b.addEventListener('click', () => { App.finishEditing(); doc.history.goTo(+b.dataset.i); }));
    el.querySelector('.hist-row.active')?.scrollIntoView({ block: 'nearest' });
  },
};

// ---------- Properties ----------
const PropertiesPanel = {
  render(el) {
    const doc = App.doc;
    if (!doc) { el.innerHTML = '<p class="panel-empty">No properties</p>'; return; }
    const layer = doc.active;
    if (Transform.active) { el.innerHTML = '<p class="panel-hint">Free Transform: drag the handles, then press Enter to apply or Esc to cancel.</p>'; return; }
    if (layer?.type === 'adjustment') { this.renderAdjustment(el, doc, layer); return; }
    if (layer?.type === 'text') { this.renderText(el, doc, layer); return; }
    const b = layer?.bounds;
    el.innerHTML = `
      <div class="props-head">${icon(layer ? 'layers' : 'image', 15)} ${layer ? 'Pixel Layer' : 'Document'}</div>
      ${layer ? `
      <h4 class="props-title">Transform</h4>
      <div class="props-grid">
        <label>W<input disabled value="${b.w} px"></label><label>H<input disabled value="${b.h} px"></label>
        <label>X<input type="number" data-pos="x" value="${b.x}"></label><label>Y<input type="number" data-pos="y" value="${b.y}"></label>
      </div>
      <div class="props-row">
        <button class="pbtn pbtn-sm" data-cmd="flip-layer-h" title="Flip horizontal">${icon('flipH', 14)}</button>
        <button class="pbtn pbtn-sm" data-cmd="flip-layer-v" title="Flip vertical">${icon('flipV', 14)}</button>
        <button class="pbtn pbtn-sm" data-cmd="rotate-layer-90" title="Rotate 90° clockwise">${icon('rotate', 14)}</button>
        <button class="pbtn pbtn-sm" data-cmd="free-transform" title="Free Transform (Ctrl+T)">${icon('transform', 14)}</button>
      </div>` : ''}
      <h4 class="props-title">Canvas</h4>
      <div class="props-grid">
        <label>W<input disabled value="${doc.width} px"></label><label>H<input disabled value="${doc.height} px"></label>
        <label class="wide">Resolution<input disabled value="${doc.dpi} ppi"></label>
      </div>
      <div class="props-row">
        <button class="pbtn pbtn-sm" data-cmd="image-size">Image Size…</button>
        <button class="pbtn pbtn-sm" data-cmd="canvas-size">Canvas Size…</button>
      </div>
      <h4 class="props-title">Quick Actions</h4>
      <div class="props-col">
        <button class="pbtn pbtn-sm" data-cmd="remove-background">Remove Background</button>
        <button class="pbtn pbtn-sm" data-cmd="select-subject">Select Subject</button>
        <button class="pbtn pbtn-sm" data-cmd="auto-enhance">Auto Enhance</button>
      </div>`;
    el.querySelectorAll('[data-cmd]').forEach((btn) => btn.addEventListener('click', () => Commands.run(btn.dataset.cmd)));
    el.querySelectorAll('[data-pos]').forEach((input) => input.addEventListener('change', () => {
      const v = Math.round(+input.value);
      if (Number.isNaN(v)) return;
      doc.history.step('Move', 'move', () => {
        const dx = input.dataset.pos === 'x' ? v - layer.x : 0;
        const dy = input.dataset.pos === 'y' ? v - layer.y : 0;
        if (!dx && !dy) return false;
        translateLayer(layer, dx, dy);
      });
    }));
  },

  renderText(el, doc, layer) {
    const t = layer.text;
    el.innerHTML = `
      <div class="props-head">${icon('type', 15)} Type Layer</div>
      <h4 class="props-title">Character</h4>
      <div class="props-col">
        <select class="pselect" data-tp="font">${FONT_FAMILIES.map((f) => `<option ${f === t.font ? 'selected' : ''}>${esc(f)}</option>`).join('')}</select>
        <div class="props-grid">
          <label>Size<input type="number" data-tp="size" min="1" max="2000" value="${t.size}"></label>
          <label>Leading<input type="number" data-tp="leading" min="0.5" max="4" step="0.05" value="${t.leading}"></label>
          <label>Weight<select class="pselect" data-tp="weight">${[300, 400, 500, 600, 700, 800, 900].map((w) => `<option ${w === t.weight ? 'selected' : ''}>${w}</option>`).join('')}</select></label>
          <label>Color<input type="color" data-tp="color" value="${t.color}"></label>
        </div>
        <div class="props-row">
          ${['left', 'center', 'right'].map((a) => `<button class="pbtn pbtn-sm${t.align === a ? ' on' : ''}" data-align="${a}" title="Align ${a}">${icon(`align${a[0].toUpperCase()}${a.slice(1)}`, 14)}</button>`).join('')}
          <button class="pbtn pbtn-sm${t.italic ? ' on' : ''}" data-italic title="Italic"><i>I</i></button>
        </div>
        <button class="pbtn pbtn-sm" data-cmd="rasterize-type">Rasterize Type Layer</button>
      </div>`;
    const set = (key, value) => {
      if (TextEditor.active?.layer === layer) { TextEditor.setProp(key, value); return; }
      doc.history.step('Edit Type Layer', 'type', () => {
        layer.text[key] = value;
        renderText(layer);
      });
    };
    el.querySelectorAll('[data-tp]').forEach((input) => input.addEventListener('change', () => {
      const k = input.dataset.tp;
      set(k, ['size', 'leading', 'weight'].includes(k) ? +input.value : input.value);
    }));
    el.querySelectorAll('[data-align]').forEach((b) => b.addEventListener('click', () => set('align', b.dataset.align)));
    el.querySelector('[data-italic]').addEventListener('click', () => set('italic', !t.italic));
    el.querySelector('[data-cmd]').addEventListener('click', () => Commands.run('rasterize-type'));
  },

  renderAdjustment(el, doc, layer) {
    const kind = layer.adjust.kind;
    const def = ADJUSTMENTS[kind];
    el.innerHTML = `
      <div class="props-head">${icon(def.icon, 15)} ${esc(def.name)}</div>
      <div class="props-adjust">${def.params.length || def.custom ? adjustmentControlsHTML(kind, layer.adjust.params) : '<p class="panel-hint">No settings.</p>'}</div>
      <div class="props-row"><button class="pbtn pbtn-sm" data-reset>Reset to defaults</button></div>`;
    // Live edits change the layer directly; one history step per gesture.
    // The controls mutate params before we hear about it, so the step starts
    // from a copy of the values as they were before the gesture.
    let editing = false;
    let before = structuredClone(layer.adjust.params);
    const begin = () => {
      if (editing) return;
      const now = layer.adjust.params;
      layer.adjust.params = before;
      doc.history.begin(`Modify ${def.name}`, 'adjust');
      layer.adjust.params = now;
      editing = true;
    };
    const end = () => {
      if (!editing) return;
      editing = false;
      before = structuredClone(layer.adjust.params);
      doc.history.commit();
    };
    const root = el.querySelector('.props-adjust');
    bindAdjustmentControls(root, kind, layer.adjust.params, (params, key, done) => {
      begin();
      doc.invalidate();
      if (done) end();
    }, doc.flattened());
    root.addEventListener('change', end);
    root.addEventListener('pointerup', () => setTimeout(end));
    el.querySelector('[data-reset]').addEventListener('click', () => {
      doc.history.step(`Reset ${def.name}`, 'adjust', () => { layer.adjust.params = adjustmentDefaults(kind); });
    });
  },
};

// ---------- Layers ----------
function drawThumb(canvas, doc, draw) {
  const size = 34;
  const dpr = devicePixelRatio || 1;
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  const c = ctxOf(canvas);
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  const k = Math.min(size / doc.width, size / doc.height);
  const w = doc.width * k, h = doc.height * k;
  const ox = (size - w) / 2, oy = (size - h) / 2;
  c.fillStyle = '#fff';
  c.fillRect(ox, oy, w, h);
  c.fillStyle = '#d6d6d6';
  for (let y = 0; y < h; y += 4) for (let x = (y / 4) % 2 ? 4 : 0; x < w; x += 8) c.fillRect(ox + x, oy + y, Math.min(4, w - x), Math.min(4, h - y));
  c.save();
  c.beginPath();
  c.rect(ox, oy, w, h);
  c.clip();
  c.translate(ox, oy);
  c.scale(k, k);
  c.imageSmoothingQuality = 'high';
  draw(c);
  c.restore();
}

const LayersPanel = {
  menu() {
    return ['new-layer', 'duplicate-layer', 'delete-layer', { sep: true }, 'merge-down', 'merge-visible', 'flatten', { sep: true }, 'add-mask', 'delete-mask', 'apply-mask', { sep: true }, 'rasterize-type']
      .map((x) => (typeof x === 'string' ? Commands.item(x) : x));
  },

  render(el) {
    const doc = App.doc;
    const layer = doc?.active;
    const disabled = !doc || !layer ? 'disabled' : '';
    el.innerHTML = `
      <div class="layers-top">
        <select class="pselect" data-blend ${disabled} aria-label="Blend mode">${blendOptions(layer?.blend || 'source-over')}</select>
        <label class="layers-opacity"><span class="scrub-label">Opacity:</span><span class="pnum"><input type="number" data-opacity min="0" max="100" value="${layer ? Math.round(layer.opacity * 100) : 100}" ${disabled}><em>%</em></span></label>
      </div>
      <div class="layers-lock"><span>Lock:</span>
        <button class="picon-btn${layer?.locked ? ' on' : ''}" data-lock title="Lock all" ${disabled}>${icon('lock', 13)}</button>
      </div>
      <div class="layers-list" role="list">${doc ? [...doc.layers].reverse().map((l) => this.row(doc, l)).join('') : ''}</div>
      <div class="layers-foot">
        <button class="picon-btn" data-cmd="add-mask" title="Add layer mask" ${disabled}>${icon('mask', 15)}</button>
        <button class="picon-btn" data-adj title="Create new fill or adjustment layer" ${doc ? '' : 'disabled'}>${icon('adjust', 15)}</button>
        <button class="picon-btn" data-cmd="new-layer" title="Create a new layer (Ctrl+Shift+N)" ${doc ? '' : 'disabled'}>${icon('newLayer', 15)}</button>
        <button class="picon-btn" data-cmd="delete-layer" title="Delete layer" ${disabled}>${icon('trash', 15)}</button>
      </div>`;
    if (!doc) return;

    el.querySelectorAll('.layer-row').forEach((row) => {
      const l = doc.layers.find((x) => x.id === row.dataset.id);
      const thumb = row.querySelector('.thumb canvas');
      if (thumb) drawThumb(thumb, doc, (c) => l.canvas && c.drawImage(l.canvas, l.x, l.y));
      const mthumb = row.querySelector('.mask-thumb canvas');
      if (mthumb) {
        drawThumb(mthumb, doc, (c) => {
          c.fillStyle = '#000';
          c.fillRect(0, 0, doc.width, doc.height);
          const tmp = cloneCanvas(l.mask);
          const t = ctxOf(tmp);
          t.globalCompositeOperation = 'source-in';
          t.fillStyle = '#fff';
          t.fillRect(0, 0, tmp.width, tmp.height);
          c.drawImage(tmp, l.x, l.y);
        });
      }
      row.addEventListener('click', (e) => {
        const act = e.target.closest('[data-act]')?.dataset.act;
        if (act === 'eye') {
          if (e.altKey) LayerOps.solo(doc, l);
          else doc.history.step(l.visible ? 'Hide Layer' : 'Show Layer', 'eye', () => { l.visible = !l.visible; });
          return;
        }
        if ((act === 'thumb' || act === 'mask') && (e.ctrlKey || e.metaKey)) {
          commitSelection(doc, Sel.fromLayer(doc, l), 'Load Selection');
          return;
        }
        if (act === 'mask' && e.shiftKey) {
          doc.history.step(l.maskEnabled ? 'Disable Layer Mask' : 'Enable Layer Mask', 'mask', () => { l.maskEnabled = !l.maskEnabled; });
          return;
        }
        App.finishEditing();
        doc.select(l, act === 'mask' ? 'mask' : 'pixels');
      });
      row.addEventListener('dblclick', (e) => {
        if (e.target.closest('.layer-name')) {
          this.rename(row, doc, l);
        } else if (l.type === 'adjustment') {
          Dock.active.mid = 'properties';
          Dock.render();
        }
      });
      row.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        doc.select(l);
        Menus.open(this.menu(), e.clientX, e.clientY);
      });
      // Drag to reorder.
      row.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/x-layer', l.id); e.dataTransfer.effectAllowed = 'move'; });
      row.addEventListener('dragover', (e) => {
        if (!e.dataTransfer.types.includes('text/x-layer')) return;
        e.preventDefault();
        const r = row.getBoundingClientRect();
        row.classList.toggle('drop-above', e.clientY < r.top + r.height / 2);
        row.classList.toggle('drop-below', e.clientY >= r.top + r.height / 2);
      });
      row.addEventListener('dragleave', () => row.classList.remove('drop-above', 'drop-below'));
      row.addEventListener('drop', (e) => {
        e.preventDefault();
        const above = row.classList.contains('drop-above');
        row.classList.remove('drop-above', 'drop-below');
        const moving = doc.layers.find((x) => x.id === e.dataTransfer.getData('text/x-layer'));
        if (moving && moving !== l) LayerOps.reorder(doc, moving, l, above);
      });
    });

    // Right-click on empty space in the list: layer tools.
    el.querySelector('.layers-list').addEventListener('contextmenu', (e) => {
      if (e.target.closest('.layer-row')) return;
      e.preventDefault();
      Menus.open([
        Commands.item('new-layer'),
        { label: 'New Adjustment Layer', submenu: () => Object.entries(ADJUSTMENTS).map(([k, d]) => ({ label: `${d.name}…`, run: () => LayerOps.newAdjustment(doc, k) })) },
        Commands.item('paste'),
        { sep: true },
        Commands.item('merge-visible'),
        Commands.item('flatten'),
        { sep: true },
        Commands.item('select-all'),
        Commands.item('place'),
      ], e.clientX, e.clientY);
    });

    const blend = el.querySelector('[data-blend]');
    blend.addEventListener('change', () => doc.history.step('Blending Change', 'layers', () => { layer.blend = blend.value; }));
    const op = el.querySelector('[data-opacity]');
    makeScrubby(el.querySelector('.scrub-label'), op, { min: 0, max: 100 });
    let opStarted = false;
    op.addEventListener('input', () => {
      const v = clamp(+op.value, 0, 100);
      if (Number.isNaN(v)) return;
      if (!opStarted) { doc.history.begin('Opacity Change', 'layers'); opStarted = true; }
      layer.opacity = v / 100;
      doc.invalidate();
    });
    op.addEventListener('change', () => { if (opStarted) { opStarted = false; doc.history.commit(); } });
    el.querySelector('[data-lock]').addEventListener('click', () => doc.history.step(layer.locked ? 'Unlock Layer' : 'Lock Layer', 'lock', () => { layer.locked = !layer.locked; }));
    el.querySelectorAll('.layers-foot [data-cmd]').forEach((b) => b.addEventListener('click', () => Commands.run(b.dataset.cmd)));
    el.querySelector('[data-adj]').addEventListener('click', (e) => {
      const r = e.currentTarget.getBoundingClientRect();
      Menus.open(Object.entries(ADJUSTMENTS).map(([k, d]) => ({ label: `${d.name}…`, run: () => LayerOps.newAdjustment(doc, k) })), r.left, r.top - 330);
    });
  },

  row(doc, l) {
    const active = l.id === doc.activeId;
    const thumb = l.type === 'text'
      ? `<span class="thumb thumb-icon${active && doc.target === 'pixels' ? ' target' : ''}" data-act="thumb">${icon('type', 16)}</span>`
      : l.type === 'adjustment'
        ? `<span class="thumb thumb-icon" data-act="thumb">${icon(ADJUSTMENTS[l.adjust.kind].icon, 16)}</span>`
        : `<span class="thumb${active && doc.target === 'pixels' ? ' target' : ''}" data-act="thumb"><canvas></canvas></span>`;
    return `
      <div class="layer-row${active ? ' active' : ''}${l.visible ? '' : ' hidden-layer'}" data-id="${l.id}" draggable="true" role="listitem">
        <button class="layer-eye" data-act="eye" aria-label="${l.visible ? 'Hide' : 'Show'} layer" title="Toggle visibility (Alt-click: show only this)">${l.visible ? icon('eye', 14) : ''}</button>
        ${thumb}
        ${l.mask ? `<span class="layer-link">${icon('link', 10)}</span><span class="thumb mask-thumb${active && doc.target === 'mask' ? ' target' : ''}${l.maskEnabled ? '' : ' disabled'}" data-act="mask" title="Layer mask (Shift-click to disable)"><canvas></canvas></span>` : ''}
        <span class="layer-name">${esc(l.name)}</span>
        ${l.locked ? `<span class="layer-lock">${icon('lock', 12)}</span>` : ''}
      </div>`;
  },

  rename(row, doc, l) {
    const span = row.querySelector('.layer-name');
    const input = document.createElement('input');
    input.className = 'layer-rename';
    input.value = l.name;
    span.replaceWith(input);
    input.focus();
    input.select();
    let finished = false;
    const done = (save) => {
      if (finished) return;
      finished = true;
      const name = input.value.trim();
      if (save && name && name !== l.name) {
        doc.history.step('Rename Layer', 'layers', () => {
          l.name = name;
          if (l.text) l.text.autoName = false;
        });
      }
      else Dock.refresh('layers');
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') done(true);
      if (e.key === 'Escape') done(false);
    });
    input.addEventListener('blur', () => done(true), { once: true });
  },
};
