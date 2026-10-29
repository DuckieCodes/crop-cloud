// Tool framework: registry, pointer routing, cursors, and the navigation tools.
// Tool definitions live in paint.js, select-tools.js and transform.js.

const TOOL_GROUPS = [
  ['move'], ['marquee-rect', 'marquee-ellipse'], ['lasso', 'lasso-poly'], ['wand'], ['crop'], ['eyedropper'],
  ['heal'], ['brush', 'pencil'], ['clone'], ['eraser'], ['gradient', 'bucket'], ['blur', 'sharpen', 'smudge'],
  ['dodge', 'burn', 'sponge'], ['type'], ['shape-rect', 'shape-ellipse', 'shape-line'], ['hand'], ['zoom'],
];

const Tools = {
  defs: {},
  current: 'move',
  lastInGroup: {},
  session: null,
  spaceHeld: false,
  lastPaintPoint: null,

  define(id, def) {
    def.id = id;
    this.defs[id] = def;
  },

  get tool() { return this.defs[this.current]; },

  // The tool receiving pointer input (free transform takes over while active).
  active() {
    return Transform.active ? this.defs.transform : this.tool;
  },

  // Options are shared within some groups (e.g. both marquees).
  o(id) {
    const def = this.defs[id];
    return App.toolOptions[def?.optionsKey || id];
  },

  defaultOptions() {
    const out = {};
    for (const def of Object.values(this.defs)) {
      if (def.options) out[def.optionsKey || def.id] = structuredClone(def.options);
    }
    return out;
  },

  groupIndex(id) {
    return TOOL_GROUPS.findIndex((g) => g.includes(id));
  },

  select(id) {
    if (!this.defs[id] || this.defs[id].hidden) return;
    if (id !== this.current) {
      App.finishEditing();
      this.tool?.deactivate?.();
      this.current = id;
      this.lastInGroup[this.groupIndex(id)] = id;
      this.tool.activate?.();
    }
    this.updateCursor();
    Bus.emit('tool');
    App.requestRender();
  },

  // Pressing a tool's letter again with Shift cycles through its group.
  byKey(letter, shift) {
    const ids = TOOL_GROUPS.flat().filter((id) => this.defs[id].key === letter);
    if (!ids.length) return false;
    const group = TOOL_GROUPS[this.groupIndex(ids[0])];
    if (shift && group.includes(this.current)) this.select(group[(group.indexOf(this.current) + 1) % group.length]);
    else this.select(this.lastInGroup[this.groupIndex(ids[0])] || ids[0]);
    return true;
  },

  init() {
    const stage = View.stage;
    stage.addEventListener('pointerdown', (e) => this.down(e));
    stage.addEventListener('pointermove', (e) => this.move(e));
    stage.addEventListener('pointerup', (e) => this.up(e));
    stage.addEventListener('pointercancel', (e) => this.up(e));
    stage.addEventListener('pointerleave', () => {
      View.pointer.inside = false;
      Status.coords(null);
      App.requestRender();
    });
    stage.addEventListener('dblclick', (e) => App.doc && this.active().dblclick?.(this.point(e)));
    stage.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    stage.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (App.doc) Commands.contextMenu(e.clientX, e.clientY);
    });
  },

  point(e) {
    const r = View.stage.getBoundingClientRect();
    const sx = e.clientX - r.left;
    const sy = e.clientY - r.top;
    const v = App.doc.view;
    return {
      x: (sx - v.ox) / v.zoom, y: (sy - v.oy) / v.zoom, sx, sy,
      shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey || e.metaKey,
      pressure: e.pointerType === 'pen' ? e.pressure || 0.5 : 1,
    };
  },

  down(e) {
    if (!App.doc || e.button === 2) return;
    View.stage.setPointerCapture(e.pointerId);
    const p = this.point(e);
    const tool = this.spaceHeld || e.button === 1 ? this.defs.hand : this.active();
    this.session = { tool, start: p, last: p };
    tool.down?.(p, this.session);
    this.updateCursor();
    App.requestRender();
  },

  move(e) {
    if (!App.doc) return;
    const p = this.point(e);
    View.pointer = { inside: true, sx: p.sx, sy: p.sy, x: p.x, y: p.y };
    Status.coords(p);
    const s = this.session;
    if (s) {
      // Coalesced events give smoother brush strokes on fast moves.
      const events = s.tool.paints && e.getCoalescedEvents ? e.getCoalescedEvents() : [];
      for (const ev of events.length ? events : [e]) {
        const q = ev === e ? p : this.point(ev);
        s.tool.move?.(q, s);
        s.last = q;
      }
    } else {
      this.active().hover?.(p);
    }
    this.updateCursor(p);
    App.requestRender();
  },

  up(e) {
    const s = this.session;
    if (!s) return;
    this.session = null;
    s.tool.up?.(this.point(e), s);
    this.updateCursor();
    App.requestRender();
  },

  wheel(e) {
    if (!App.doc) return;
    e.preventDefault();
    const r = View.stage.getBoundingClientRect();
    const anchor = { x: e.clientX - r.left, y: e.clientY - r.top };
    const scale = e.deltaMode === 1 ? 16 : 1;
    if (e.ctrlKey || e.altKey || e.metaKey) {
      View.setZoom(App.doc, App.doc.view.zoom * Math.exp(-e.deltaY * scale * 0.0025), anchor);
    } else if (e.shiftKey) {
      View.pan(-(e.deltaY || e.deltaX) * scale, 0);
    } else {
      View.pan(-e.deltaX * scale, -e.deltaY * scale);
    }
  },

  updateCursor(p) {
    const stage = View.stage;
    if (!App.doc) { stage.style.cursor = 'default'; return; }
    if (this.spaceHeld || this.session?.tool === this.defs.hand) {
      stage.style.cursor = this.session ? 'grabbing' : 'grab';
      return;
    }
    const t = this.active();
    let c = typeof t.cursor === 'function' ? t.cursor(p || View.pointer) : t.cursor || 'default';
    if (t.brushCursor) {
      const size = this.o(t.id).size * App.doc.view.zoom;
      c = size < 6 ? 'crosshair' : 'none';
    }
    stage.style.cursor = c;
  },

  drawOverlay(ctx, zoom, doc) {
    const t = this.active();
    const s = this.session?.tool === t ? this.session : null;
    t.overlay?.(ctx, zoom, doc, s);
  },

  drawCursor(ctx, doc) {
    if (!View.pointer.inside || this.spaceHeld) return;
    const t = this.active();
    t.cursorExtra?.(ctx, doc);
    if (!t.brushCursor) return;
    const r = (this.o(t.id).size / 2) * doc.view.zoom;
    if (r * 2 < 6) return;
    const { sx, sy } = View.pointer;
    ctx.save();
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(0,0,0,.75)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,.95)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  },

  hidesSelection() {
    return !!(this.session?.hideSelection || Transform.active?.floating);
  },
};

// ---------- Shared helpers for tools ----------
function selectionMode(p, fallback) {
  if (p.shift && p.alt) return 'intersect';
  if (p.shift) return 'add';
  if (p.alt) return 'subtract';
  return fallback;
}

function commitSelection(doc, mask, name, icon = 'marqueeRect') {
  doc.history.begin(name, icon);
  doc.setSelection(mask);
  doc.history.commit();
}

// Sample the color under p into the foreground (or background) color.
function sampleColor(p, toBg, { all = true, size = 1 } = {}) {
  const doc = App.doc;
  let src, ox = 0, oy = 0;
  if (all || !doc.active?.canvas) {
    if (doc.compositeDirty) doc.renderComposite();
    src = doc.composite;
  } else {
    src = doc.active.canvas;
    ox = doc.active.x;
    oy = doc.active.y;
  }
  const half = Math.floor(size / 2);
  const x0 = Math.floor(p.x - ox) - half;
  const y0 = Math.floor(p.y - oy) - half;
  const r = rectIntersect({ x: x0, y: y0, w: size, h: size }, fullRect(src));
  if (!r) return;
  const d = ctxOf(src).getImageData(r.x, r.y, r.w, r.h).data;
  let R = 0, G = 0, B = 0, A = 0;
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3];
    R += d[i] * a; G += d[i + 1] * a; B += d[i + 2] * a; A += a;
  }
  if (!A) return;
  App.setColor(toBg ? 'bg' : 'fg', { r: R / A, g: G / A, b: B / A });
}

// Which layer is visible under p? Used by the Move tool's auto-select and the Type tool.
function layerAt(doc, p, filter = () => true) {
  for (let i = doc.layers.length - 1; i >= 0; i--) {
    const l = doc.layers[i];
    if (!l.visible || !l.canvas || !filter(l)) continue;
    const x = Math.floor(p.x - l.x), y = Math.floor(p.y - l.y);
    if (x < 0 || y < 0 || x >= l.canvas.width || y >= l.canvas.height) continue;
    if (l.type === 'text') return l;
    if (ctxOf(l.canvas).getImageData(x, y, 1, 1).data[3] > 10) return l;
  }
  return null;
}

// ---------- Navigation tools ----------
Tools.define('hand', {
  name: 'Hand Tool', key: 'H', icon: 'hand', cursor: 'grab', options: {},
  down(p, s) { s.prev = p; },
  move(p, s) {
    View.pan(p.sx - s.prev.sx, p.sy - s.prev.sy);
    s.prev = { ...p, sx: p.sx, sy: p.sy };
  },
  dblclick() { View.fit(); },
});

Tools.define('zoom', {
  name: 'Zoom Tool', key: 'Z', icon: 'zoom', options: { zoomOut: false },
  cursor() { return Tools.o('zoom').zoomOut ? 'zoom-out' : 'zoom-in'; },
  down(p, s) { s.zoom0 = App.doc.view.zoom; s.dragged = false; },
  move(p, s) {
    const dx = p.sx - s.start.sx;
    if (Math.abs(dx) > 3) s.dragged = true;
    if (s.dragged) View.setZoom(App.doc, s.zoom0 * Math.exp(dx * 0.01), { x: s.start.sx, y: s.start.sy });
  },
  up(p, s) {
    if (s.dragged) return;
    const out = Tools.o('zoom').zoomOut !== p.alt;
    View.zoomStep(out ? -1 : 1, { x: p.sx, y: p.sy });
  },
  dblclick() { View.setZoom(App.doc, 1); },
});

Tools.define('eyedropper', {
  name: 'Eyedropper Tool', key: 'I', icon: 'eyedropper', cursor: 'crosshair',
  options: { sampleSize: 1, sampleAll: true },
  down(p) { this.sample(p); },
  move(p) { this.sample(p); },
  sample(p) {
    const o = Tools.o('eyedropper');
    sampleColor(p, p.alt, { all: o.sampleAll, size: o.sampleSize });
  },
});
