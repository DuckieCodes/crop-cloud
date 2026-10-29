// Workspaces: each is a tree of splits with tabbed panel groups. Panels are created once
// and moved between groups; gutters resize; ` (backtick) maximizes the panel under the pointer.

definePanel('timeline', 'Timeline', { mount(el) { Timeline.mount(el); } });

const T = (...tabs) => ({ tabs });
const ROW = (sizes, children) => ({ dir: 'row', sizes, children });
const COL = (sizes, children) => ({ dir: 'col', sizes, children });

const WORKSPACES = {
  editing: {
    label: 'Editing',
    tree: COL([0.56, 0.44], [
      ROW([0.5, 0.5], [T('source', 'effectControls', 'audioMixer', 'graphics'), T('program')]),
      ROW([0.24, 38, 1, 52], [T('project', 'effects', 'markers', 'history'), T('tools'), T('timeline'), T('meters')]),
    ]),
  },
  color: {
    label: 'Color',
    tree: COL([0.47, 0.33, 0.2], [
      ROW([0.64, 0.36], [T('program'), T('scopes')]),
      ROW([0.46, 0.25, 0.29], [T('colorWheels'), T('curves'), T('nodes')]),
      ROW([38, 1, 52], [T('tools'), T('timeline'), T('meters')]),
    ]),
  },
  effects: {
    label: 'Effects',
    tree: COL([0.56, 0.44], [
      ROW([0.34, 0.46, 0.2], [T('effectControls', 'source'), T('program'), T('effects')]),
      ROW([0.2, 38, 1, 52], [T('project', 'history'), T('tools'), T('timeline'), T('meters')]),
    ]),
  },
  audio: {
    label: 'Audio',
    tree: COL([0.52, 0.48], [
      ROW([0.5, 0.5], [T('audioMixer', 'effectControls'), T('program')]),
      ROW([0.22, 38, 1, 52], [T('project', 'effects', 'markers'), T('tools'), T('timeline'), T('meters')]),
    ]),
  },
  graphics: {
    label: 'Graphics',
    tree: COL([0.56, 0.44], [
      ROW([0.3, 0.7], [T('graphics', 'effectControls'), T('program')]),
      ROW([0.22, 38, 1, 52], [T('project', 'effects'), T('tools'), T('timeline'), T('meters')]),
    ]),
  },
};

const Layout = {
  ws: 'editing',
  sizes: {},
  active: {},
  leaves: [],

  render() {
    const root = document.getElementById('workspace');
    for (const p of Object.values(Panels)) p.el.remove();
    root.innerHTML = '';
    root.classList.remove('has-max');
    this.leaves = [];
    const def = WORKSPACES[this.ws];
    root.append(this.build(def.tree, `${this.ws}`));
    document.querySelectorAll('[data-ws]').forEach((b) => b.classList.toggle('on', b.dataset.ws === this.ws));
    Bus.emit('layout');
  },

  build(node, path) {
    if (node.tabs) return this.leaf(node, path);
    const el = document.createElement('div');
    el.className = `split split-${node.dir}`;
    const sizes = this.sizes[path] || node.sizes;
    node.children.forEach((child, i) => {
      const fixed = sizes[i] > 1;
      const cell = this.build(child, `${path}.${i}`);
      cell.style.flex = fixed ? `0 0 ${sizes[i]}px` : `${sizes[i]} 1 0`;
      cell.dataset.fixed = fixed ? '1' : '';
      el.append(cell);
      if (i < node.children.length - 1) el.append(this.gutter(el, node, path, i));
    });
    return el;
  },

  leaf(node, path) {
    const el = document.createElement('section');
    el.className = 'dock';
    const tabs = node.tabs.filter((t) => Panels[t]);
    const bare = tabs.length === 1 && ['tools', 'meters'].includes(tabs[0]);
    if (bare) el.classList.add('bare');
    let active = this.active[path];
    if (!tabs.includes(active)) active = tabs[0];
    el.innerHTML = `${bare ? '' : `<div class="dock-tabs">${tabs.map((t) => `<button class="dock-tab${t === active ? ' on' : ''}" data-tab="${t}">${esc(Panels[t].title)}</button>`).join('')}<span class="tl-spacer"></span><button class="dock-menu" title="Maximize panel (\`)">${icon('maximize', 12)}</button></div>`}<div class="dock-body"></div>`;
    const leaf = { el, path, tabs, active };
    this.leaves.push(leaf);
    el.querySelector('.dock-body').append(Panels[active].el);
    el.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => this.activate(leaf, b.dataset.tab)));
    el.querySelector('.dock-menu')?.addEventListener('click', () => this.toggleMax(el));
    return el;
  },

  activate(leaf, id) {
    if (leaf.active === id) return;
    leaf.active = id;
    this.active[leaf.path] = id;
    const body = leaf.el.querySelector('.dock-body');
    body.innerHTML = '';
    body.append(Panels[id].el);
    leaf.el.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === id));
    Panels[id].render?.();
    Bus.emit('layout');
    App.savePrefs();
  },

  // Bring a panel to the front, borrowing the first group if this workspace doesn't have it.
  show(id) {
    const leaf = this.leaves.find((l) => l.tabs.includes(id));
    if (leaf) { this.activate(leaf, id); return; }
    const first = this.leaves.find((l) => !l.el.classList.contains('bare'));
    if (!first) return;
    first.tabs.push(id);
    const tab = document.createElement('button');
    tab.className = 'dock-tab';
    tab.dataset.tab = id;
    tab.textContent = Panels[id].title;
    tab.addEventListener('click', () => this.activate(first, id));
    first.el.querySelector('.dock-tabs').insertBefore(tab, first.el.querySelector('.dock-tabs .tl-spacer'));
    this.activate(first, id);
  },

  isVisible(id) {
    return this.leaves.some((l) => l.active === id);
  },

  gutter(container, node, path, i) {
    const g = document.createElement('div');
    g.className = `gutter gutter-${node.dir}`;
    g.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      g.setPointerCapture(e.pointerId);
      const cells = [...container.children].filter((c) => !c.classList.contains('gutter'));
      const a = cells[i], b = cells[i + 1];
      const horizontal = node.dir === 'row';
      const size = (el) => (horizontal ? el.getBoundingClientRect().width : el.getBoundingClientRect().height);
      const sa = size(a), sb = size(b);
      const start = horizontal ? e.clientX : e.clientY;
      const move = (ev) => {
        const d = (horizontal ? ev.clientX : ev.clientY) - start;
        const na = Math.max(60, sa + d), nb = Math.max(60, sb - d);
        for (const [el, s] of [[a, na], [b, nb]]) el.style.flex = el.dataset.fixed ? `0 0 ${s}px` : `${s} 1 0`;
      };
      const up = () => {
        g.removeEventListener('pointermove', move);
        // Fixed cells are stored in px (> 1); flexible ones as fractions (≤ 1).
        const flexTotal = cells.filter((c) => !c.dataset.fixed).reduce((sum, c) => sum + size(c), 0) || 1;
        this.sizes[path] = cells.map((c) => (c.dataset.fixed ? Math.max(2, Math.round(size(c))) : size(c) / flexTotal));
        App.savePrefs();
      };
      g.addEventListener('pointermove', move);
      g.addEventListener('pointerup', up, { once: true });
    });
    return g;
  },

  toggleMax(el) {
    const root = document.getElementById('workspace');
    const on = !el.classList.contains('maximized');
    root.querySelectorAll('.dock.maximized').forEach((d) => d.classList.remove('maximized'));
    if (on) el.classList.add('maximized');
    root.classList.toggle('has-max', on);
    Bus.emit('layout');
  },

  maxUnderPointer() {
    const el = document.elementFromPoint(App.pointer.x, App.pointer.y)?.closest('.dock');
    if (el) this.toggleMax(el);
  },

  setWorkspace(id) {
    if (!WORKSPACES[id]) return;
    this.ws = id;
    App.workspace = id;
    this.render();
    App.savePrefs();
    Panels.program.layout?.();
    if (!Player.playing) Player.renderExact();
  },

  resetWorkspace() {
    for (const k of Object.keys(this.sizes)) if (k.startsWith(this.ws)) delete this.sizes[k];
    for (const k of Object.keys(this.active)) if (k.startsWith(this.ws)) delete this.active[k];
    this.render();
    App.savePrefs();
  },
};
