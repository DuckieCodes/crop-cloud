// The menu bar: File, Edit, Image, Layer, Type, Select, Filter, View, Window, Help.

const SEP = { sep: true };
const cmd = (id) => Commands.item(id);
const sub = (label, items) => ({ label, submenu: () => items().filter(Boolean) });

function recentItems() {
  const recents = Store.get('recents').slice(0, 15);
  if (!recents.length) return [{ label: 'No recent files', disabled: true }];
  return recents.map((f) => ({ label: f.name, run: () => App.openFromStore(f.id) }));
}

function adjustmentItems() {
  const ids = ['brightness', 'levels', 'curves', 'exposure', null, 'vibrance', 'hueSat', 'colorBalance', 'blackWhite', 'photoFilter', null, 'invert', 'posterize', 'threshold', 'gradientMap'];
  return [...ids.map((k) => (k ? cmd(`adj-${k}`) : SEP)), SEP, cmd('desaturate')];
}

const MENUBAR = [
  ['File', () => [
    cmd('new'), cmd('open'), sub('Open Recent', recentItems), SEP,
    cmd('close'), cmd('close-all'), SEP,
    cmd('save'), cmd('save-as'), cmd('revert'), SEP,
    sub('Export', () => [cmd('quick-export'), cmd('export-as')]), SEP,
    cmd('place'), SEP, cmd('home'),
  ]],
  ['Edit', () => [
    cmd('undo'), cmd('redo'), SEP,
    cmd('cut'), cmd('copy'), cmd('copy-merged'), cmd('paste'), cmd('paste-in-place'), cmd('clear'), SEP,
    cmd('fill'), cmd('stroke'), SEP,
    cmd('free-transform'),
    sub('Transform', () => [cmd('rotate-layer-180'), cmd('rotate-layer-90'), cmd('rotate-layer-ccw'), SEP, cmd('flip-layer-h'), cmd('flip-layer-v')]), SEP,
    sub('Interface Theme', () => [cmd('theme-dark'), cmd('theme-light')]),
    cmd('shortcuts'),
  ]],
  ['Image', () => [
    sub('Adjustments', adjustmentItems), SEP,
    cmd('auto-tone'), cmd('auto-contrast'), cmd('auto-color'), SEP,
    cmd('image-size'), cmd('canvas-size'),
    sub('Image Rotation', () => [cmd('rotate-180'), cmd('rotate-cw'), cmd('rotate-ccw'), SEP, cmd('flip-canvas-h'), cmd('flip-canvas-v')]),
    cmd('crop-to-selection'), cmd('trim'), SEP,
    cmd('remove-background'),
  ]],
  ['Layer', () => [
    sub('New', () => [cmd('new-layer'), cmd('layer-via-copy'), cmd('layer-via-cut')]),
    cmd('duplicate-layer'), cmd('delete-layer'), cmd('rename-layer'), SEP,
    sub('New Adjustment Layer', () => Object.entries(ADJUSTMENTS).map(([k, d]) => ({ label: `${d.name}…`, disabled: !App.doc, run: () => LayerOps.newAdjustment(App.doc, k) }))), SEP,
    sub('Layer Mask', () => [cmd('mask-reveal-all'), cmd('mask-hide-all'), cmd('mask-reveal-sel'), cmd('mask-hide-sel'), SEP, cmd('delete-mask'), cmd('apply-mask'), SEP, cmd('toggle-mask')]),
    sub('Rasterize', () => [cmd('rasterize-type')]), SEP,
    sub('Arrange', () => [cmd('bring-front'), cmd('bring-forward'), cmd('send-backward'), cmd('send-back')]),
    cmd('lock-layer'), SEP,
    cmd('merge-down'), cmd('merge-visible'), cmd('flatten'),
  ]],
  ['Type', () => [cmd('type-tool'), SEP, { ...cmd('rasterize-type'), label: 'Rasterize Type Layer' }]],
  ['Select', () => [
    cmd('select-all'), cmd('deselect'), cmd('reselect'), cmd('select-inverse'), SEP,
    cmd('select-subject'), cmd('load-transparency'), SEP,
    sub('Modify', () => [cmd('border'), cmd('expand'), cmd('contract'), cmd('feather')]),
  ]],
  ['Filter', () => [
    cmd('last-filter'), SEP,
    ...FILTER_GROUPS.map((g) => sub(g, () => Object.keys(FILTERS).filter((id) => FILTERS[id].group === g).map((id) => cmd(`filter-${id}`)))),
  ]],
  ['View', () => [
    cmd('zoom-in'), cmd('zoom-out'), cmd('fit-screen'), cmd('fill-screen'), cmd('actual-pixels'), SEP,
    cmd('toggle-extras'), cmd('toggle-grid'), cmd('toggle-rulers'), SEP,
    cmd('toggle-panels'),
  ]],
  ['Window', () => [
    ...App.docs.map((d) => ({ label: d.name, checked: d === App.doc, run: () => App.setDoc(d) })),
    App.docs.length ? SEP : null,
    ...Object.keys(PANEL_DEFS).map((id) => cmd(`panel-${id}`)), SEP,
    cmd('reset-workspace'),
  ]],
  ['Help', () => [cmd('shortcuts'), cmd('learn'), SEP, cmd('about')]],
];

const Menubar = {
  open: -1,

  init() {
    this.el = document.getElementById('menubar');
    this.el.innerHTML = `
      <span class="mb-logo" title="PhotoCrop">Pc</span>
      ${MENUBAR.map(([label], i) => `<button class="menubar-item" data-i="${i}">${label}</button>`).join('')}
      <span class="mb-spacer"></span>
      <span class="mb-title" id="mb-title"></span>`;
    this.el.querySelectorAll('.menubar-item').forEach((b) => {
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        if (this.open === +b.dataset.i) Menus.closeAll();
        else this.show(+b.dataset.i);
      });
      b.addEventListener('pointerenter', () => { if (this.open >= 0 && this.open !== +b.dataset.i) this.show(+b.dataset.i); });
    });
  },

  show(i) {
    Menus.closeAll();
    const btn = this.el.querySelector(`[data-i="${i}"]`);
    const r = btn.getBoundingClientRect();
    this.open = i;
    btn.classList.add('open');
    Menus.open(MENUBAR[i][1], r.left, r.bottom);
    Menus.onClose(() => {
      this.open = -1;
      this.el.querySelectorAll('.menubar-item').forEach((x) => x.classList.remove('open'));
    });
  },

  step(dir) {
    if (this.open < 0) return false;
    this.show((this.open + dir + MENUBAR.length) % MENUBAR.length);
    return true;
  },
};
