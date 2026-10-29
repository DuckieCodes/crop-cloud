// The options bar under the menu bar: settings for the current tool.

const OB = {
  num(key, label, o, { min = 0, max = 100, step = 1, unit = '' } = {}) {
    return `<label class="ob-field"><span class="scrub-label" data-scrub="${key}">${label}</span>
      <span class="pnum"><input type="number" data-opt="${key}" min="${min}" max="${max}" step="${step}" value="${o[key]}">${unit ? `<em>${unit}</em>` : ''}</span></label>`;
  },
  check(key, label, o) {
    return `<label class="pcheck"><input type="checkbox" data-opt="${key}" ${o[key] ? 'checked' : ''}> ${label}</label>`;
  },
  select(key, label, o, options) {
    return `<label class="ob-field">${label ? `<span>${label}</span>` : ''}<select class="pselect" data-opt="${key}">
      ${options.map((x) => (x ? `<option value="${x[0]}" ${String(o[key]) === String(x[0]) ? 'selected' : ''}>${esc(x[1])}</option>` : '<option disabled>──────────</option>')).join('')}</select></label>`;
  },
  modes(o) {
    return `<div class="ob-seg" role="group" aria-label="Selection mode">${[['new', 'selNew', 'New selection'], ['add', 'selAdd', 'Add to selection (Shift)'], ['subtract', 'selSub', 'Subtract from selection (Alt)'], ['intersect', 'selInt', 'Intersect with selection (Shift+Alt)']]
      .map(([m, ic, t]) => `<button class="ob-icon${o.mode === m ? ' on' : ''}" data-mode="${m}" title="${t}">${icon(ic, 16)}</button>`).join('')}</div>`;
  },
  brush(o) {
    const soft = (o.hardness ?? 100) < 50;
    return `<button class="ob-brush" data-brush title="Brush size and hardness"><span class="ob-brush-dot${soft ? ' soft' : ''}"></span><span>${o.size}</span>${icon('chevronDown', 12)}</button>`;
  },
  sep: '<span class="ob-sep"></span>',
  blend: (o, key = 'mode') => OB.select(key, 'Mode:', o, BLEND_MODES),
};

const OptionsBar = {
  init() {
    this.el = document.getElementById('options-bar');
    Bus.on('tool', () => this.render());
    Bus.on('docs', () => this.render());
    Bus.on('transform', () => this.syncTransform());
    this.render();
  },

  render() {
    const transform = Transform.active;
    const id = transform ? 'transform' : Tools.current;
    const t = Tools.defs[id];
    const o = Tools.o(id) || {};
    this.el.innerHTML = `
      <a class="ob-home" href="../../index.html" title="Back to Crop Cloud" aria-label="Back to Crop Cloud">${icon('home', 16)}</a>
      <span class="ob-tool" title="${esc(t.name)}">${icon(t.icon, 18)}</span>
      ${OB.sep}
      <div class="ob-content">${this.content(id, o)}</div>`;
    this.bind(id);
  },

  content(id, o) {
    const sizeOpts = (max = 2500) => OB.num('size', 'Size:', o, { min: 1, max, unit: 'px' });
    switch (id) {
      case 'move':
        return `${OB.check('autoSelect', 'Auto-Select', o)} ${OB.sep}
          <div class="ob-seg">${[['left', 'alignLeftEdge', 'Align left edges'], ['hcenter', 'alignHCenter', 'Align horizontal centers'], ['right', 'alignRightEdge', 'Align right edges'], ['top', 'alignTopEdge', 'Align top edges'], ['vcenter', 'alignVCenter', 'Align vertical centers'], ['bottom', 'alignBottomEdge', 'Align bottom edges']]
            .map(([a, ic, title]) => `<button class="ob-icon" data-align="${a}" title="${title} (to selection or canvas)">${icon(ic, 16)}</button>`).join('')}</div>
          ${OB.sep}<button class="pbtn pbtn-sm" data-cmd="free-transform">Free Transform</button>`;
      case 'marquee-rect':
      case 'marquee-ellipse':
        return `${OB.modes(o)} ${OB.sep} ${OB.num('feather', 'Feather:', o, { min: 0, max: 250, unit: 'px' })}
          ${OB.select('style', 'Style:', o, [['normal', 'Normal'], ['ratio', 'Fixed Ratio'], ['fixed', 'Fixed Size']])}
          ${o.style === 'ratio' ? `${OB.num('ratioW', 'W:', o, { min: 0.01, max: 999, step: 0.01 })} ${OB.num('ratioH', 'H:', o, { min: 0.01, max: 999, step: 0.01 })}` : ''}
          ${o.style === 'fixed' ? `${OB.num('fixedW', 'W:', o, { min: 1, max: 30000, unit: 'px' })} ${OB.num('fixedH', 'H:', o, { min: 1, max: 30000, unit: 'px' })}` : ''}
          ${OB.sep}<button class="pbtn pbtn-sm" data-cmd="select-subject">Select Subject</button>`;
      case 'lasso':
      case 'lasso-poly':
        return `${OB.modes(o)} ${OB.sep} ${OB.num('feather', 'Feather:', o, { min: 0, max: 250, unit: 'px' })}
          ${OB.sep}<button class="pbtn pbtn-sm" data-cmd="select-subject">Select Subject</button>
          ${id === 'lasso-poly' ? '<span class="ob-hint">Click to add points · double-click or Enter to close · Backspace removes a point</span>' : ''}`;
      case 'wand':
        return `${OB.modes(o)} ${OB.sep} ${OB.num('tolerance', 'Tolerance:', o, { min: 0, max: 255 })}
          ${OB.check('antiAlias', 'Anti-alias', o)} ${OB.check('contiguous', 'Contiguous', o)} ${OB.check('sampleAll', 'Sample All Layers', o)}
          ${OB.sep}<button class="pbtn pbtn-sm" data-cmd="select-subject">Select Subject</button>`;
      case 'crop':
        return `${OB.select('ratio', '', o, CROP_RATIOS)} <button class="pbtn pbtn-sm" data-crop="reset">Clear</button>
          ${OB.sep} ${OB.check('deletePixels', 'Delete Cropped Pixels', o)}
          <span class="ob-spacer"></span>
          <button class="ob-icon" data-crop="cancel" title="Cancel (Esc)">${icon('x', 16)}</button>
          <button class="ob-icon ob-commit" data-crop="commit" title="Commit (Enter)">${icon('check', 16)}</button>`;
      case 'eyedropper':
        return `${OB.select('sampleSize', 'Sample Size:', o, [[1, 'Point Sample'], [3, '3 by 3 Average'], [5, '5 by 5 Average'], [11, '11 by 11 Average']])}
          ${OB.select('sampleAll', 'Sample:', o, [[true, 'All Layers'], [false, 'Current Layer']])}`;
      case 'heal':
        return `${OB.brush(o)} ${OB.sep}<span class="ob-hint">Paint over spots and blemishes; they're filled from the surrounding area.</span>`;
      case 'brush':
        return `${OB.brush(o)} ${OB.sep} ${OB.blend(o)} ${OB.num('opacity', 'Opacity:', o, { min: 1, max: 100, unit: '%' })}
          ${OB.num('flow', 'Flow:', o, { min: 1, max: 100, unit: '%' })} ${OB.check('pressure', 'Pen pressure for size', o)}`;
      case 'pencil':
        return `${sizeOpts()} ${OB.sep} ${OB.blend(o)} ${OB.num('opacity', 'Opacity:', o, { min: 1, max: 100, unit: '%' })}`;
      case 'eraser':
        return `${OB.brush(o)} ${OB.sep} ${OB.num('opacity', 'Opacity:', o, { min: 1, max: 100, unit: '%' })} ${OB.num('flow', 'Flow:', o, { min: 1, max: 100, unit: '%' })}`;
      case 'clone':
        return `${OB.brush(o)} ${OB.sep} ${OB.num('opacity', 'Opacity:', o, { min: 1, max: 100, unit: '%' })} ${OB.num('flow', 'Flow:', o, { min: 1, max: 100, unit: '%' })}
          ${OB.check('aligned', 'Aligned', o)} ${OB.check('sampleAll', 'Sample All Layers', o)} <span class="ob-hint">Alt-click to set the source</span>`;
      case 'gradient':
        return `${OB.select('preset', '', o, [['fg-bg', 'Foreground to Background'], ['fg-transparent', 'Foreground to Transparent'], ['black-white', 'Black, White'], ['spectrum', 'Spectrum']])}
          <div class="ob-seg">${[['linear', 'gradLinear', 'Linear'], ['radial', 'gradRadial', 'Radial'], ['angle', 'gradAngle', 'Angle'], ['reflected', 'gradReflected', 'Reflected']]
            .map(([v, ic, t]) => `<button class="ob-icon${o.type === v ? ' on' : ''}" data-set="type" data-value="${v}" title="${t} Gradient">${icon(ic, 16)}</button>`).join('')}</div>
          ${OB.sep} ${OB.blend(o)} ${OB.num('opacity', 'Opacity:', o, { min: 1, max: 100, unit: '%' })} ${OB.check('reverse', 'Reverse', o)}`;
      case 'bucket':
        return `${OB.blend(o)} ${OB.num('opacity', 'Opacity:', o, { min: 1, max: 100, unit: '%' })} ${OB.num('tolerance', 'Tolerance:', o, { min: 0, max: 255 })}
          ${OB.check('contiguous', 'Contiguous', o)} ${OB.check('sampleAll', 'All Layers', o)}`;
      case 'blur':
      case 'sharpen':
      case 'smudge':
        return `${OB.brush(o)} ${OB.sep} ${OB.num('strength', 'Strength:', o, { min: 1, max: 100, unit: '%' })}`;
      case 'dodge':
      case 'burn':
        return `${OB.brush(o)} ${OB.sep} ${OB.select('range', 'Range:', o, [['shadows', 'Shadows'], ['midtones', 'Midtones'], ['highlights', 'Highlights']])}
          ${OB.num('exposure', 'Exposure:', o, { min: 1, max: 100, unit: '%' })}`;
      case 'sponge':
        return `${OB.brush(o)} ${OB.sep} ${OB.select('mode', 'Mode:', o, [['desaturate', 'Desaturate'], ['saturate', 'Saturate']])} ${OB.num('flow', 'Flow:', o, { min: 1, max: 100, unit: '%' })}`;
      case 'type': {
        const editing = TextEditor.active;
        const t = editing ? editing.layer.text : o;
        const style = `${t.weight}${t.italic ? 'i' : ''}`;
        return `${OB.select('font', '', t, FONT_FAMILIES.map((f) => [f, f]))}
          <label class="ob-field"><select class="pselect" data-style>
            ${[['300', 'Light'], ['400', 'Regular'], ['500', 'Medium'], ['700', 'Bold'], ['900', 'Black'], ['400i', 'Italic'], ['700i', 'Bold Italic']].map(([v, l]) => `<option value="${v}" ${v === style ? 'selected' : ''}>${l}</option>`).join('')}
          </select></label>
          ${OB.num('size', '', t, { min: 1, max: 2000, unit: 'px' })}
          <div class="ob-seg">${['left', 'center', 'right'].map((a) => `<button class="ob-icon${t.align === a ? ' on' : ''}" data-set="align" data-value="${a}" title="${a[0].toUpperCase() + a.slice(1)} align text">${icon(`align${a[0].toUpperCase()}${a.slice(1)}`, 16)}</button>`).join('')}</div>
          <label class="ob-color" title="Text color"><input type="color" data-text-color value="${editing ? editing.layer.text.color : rgbToHex(App.fg)}"></label>
          ${editing ? `<span class="ob-spacer"></span>
            <button class="ob-icon" data-text="cancel" title="Cancel (Esc)">${icon('x', 16)}</button>
            <button class="ob-icon ob-commit" data-text="commit" title="Commit (Ctrl+Enter)">${icon('check', 16)}</button>` : '<span class="ob-hint">Click on the canvas to add text</span>'}`;
      }
      case 'shape-rect':
      case 'shape-ellipse':
      case 'shape-line':
        return id === 'shape-line'
          ? `<span class="ob-hint">Color: foreground</span> ${OB.num('strokeWidth', 'Weight:', o, { min: 1, max: 500, unit: 'px' })}`
          : `${OB.check('fill', 'Fill (foreground)', o)} ${OB.sep} ${OB.check('stroke', 'Stroke', o)}
            <label class="ob-color" title="Stroke color"><input type="color" data-opt="strokeColor" value="${o.strokeColor}"></label>
            ${OB.num('strokeWidth', '', o, { min: 1, max: 500, unit: 'px' })}
            ${id === 'shape-rect' ? `${OB.sep} ${OB.num('radius', 'Radius:', o, { min: 0, max: 5000, unit: 'px' })}` : ''}`;
      case 'hand':
      case 'zoom':
        return `${id === 'zoom' ? `<div class="ob-seg"><button class="ob-icon${!o.zoomOut ? ' on' : ''}" data-set="zoomOut" data-value="false" title="Zoom in">${icon('zoom', 16)}</button>
            <button class="ob-icon${o.zoomOut ? ' on' : ''}" data-set="zoomOut" data-value="true" title="Zoom out">${icon('zoomOut', 16)}</button></div>${OB.sep}` : ''}
          <button class="pbtn pbtn-sm" data-cmd="actual-pixels">100%</button>
          <button class="pbtn pbtn-sm" data-cmd="fit-screen">Fit Screen</button>
          <button class="pbtn pbtn-sm" data-cmd="fill-screen">Fill Screen</button>`;
      case 'transform':
        return `<label class="ob-field"><span>X:</span><span class="pnum"><input type="number" data-tf="x"><em>px</em></span></label>
          <label class="ob-field"><span>Y:</span><span class="pnum"><input type="number" data-tf="y"><em>px</em></span></label>
          ${OB.sep}
          <label class="ob-field"><span>W:</span><span class="pnum"><input type="number" data-tf="w" step="0.1"><em>%</em></span></label>
          <label class="ob-field"><span>H:</span><span class="pnum"><input type="number" data-tf="h" step="0.1"><em>%</em></span></label>
          ${OB.sep}
          <label class="ob-field"><span>${icon('rotate', 14)}</span><span class="pnum"><input type="number" data-tf="a" step="0.1"><em>°</em></span></label>
          ${OB.sep}
          <button class="ob-icon" data-tfop="flipH" title="Flip horizontal">${icon('flipH', 16)}</button>
          <button class="ob-icon" data-tfop="flipV" title="Flip vertical">${icon('flipV', 16)}</button>
          <span class="ob-spacer"></span>
          <button class="ob-icon" data-tfop="cancel" title="Cancel transform (Esc)">${icon('x', 16)}</button>
          <button class="ob-icon ob-commit" data-tfop="commit" title="Commit transform (Enter)">${icon('check', 16)}</button>`;
      default:
        return '';
    }
  },

  bind(id) {
    const el = this.el;
    el.querySelectorAll('[data-opt]').forEach((input) => {
      const evt = input.type === 'checkbox' || input.tagName === 'SELECT' || input.type === 'color' ? 'change' : 'input';
      input.addEventListener(evt, () => {
        let v;
        if (input.type === 'checkbox') v = input.checked;
        else if (input.type === 'number') {
          v = parseFloat(input.value);
          if (Number.isNaN(v)) return;
          v = clamp(v, +input.min, +input.max);
        } else v = input.value;
        if (v === 'true' || v === 'false') v = v === 'true';
        else if (input.tagName === 'SELECT' && /^\d+$/.test(v)) v = +v;
        App.setToolOption(input.dataset.opt, v);
        if (input.dataset.opt === 'style') this.render();
      });
    });
    el.querySelectorAll('[data-scrub]').forEach((label) => {
      const input = label.parentElement.querySelector('input');
      makeScrubby(label, input, { min: +input.min, max: +input.max, step: +input.step || 1 });
    });
    el.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => { App.setToolOption('mode', b.dataset.mode); this.render(); }));
    el.querySelectorAll('[data-set]').forEach((b) => b.addEventListener('click', () => {
      let v = b.dataset.value;
      if (v === 'true' || v === 'false') v = v === 'true';
      App.setToolOption(b.dataset.set, v);
      this.render();
    }));
    el.querySelectorAll('[data-cmd]').forEach((b) => b.addEventListener('click', () => Commands.run(b.dataset.cmd)));
    el.querySelectorAll('[data-align]').forEach((b) => b.addEventListener('click', () => LayerOps.align(App.doc, b.dataset.align)));
    el.querySelector('[data-brush]')?.addEventListener('click', (e) => this.brushPopover(e.currentTarget, id));
    el.querySelectorAll('[data-crop]').forEach((b) => b.addEventListener('click', () => {
      const crop = Tools.defs.crop;
      if (b.dataset.crop === 'commit') crop.commit();
      else crop.reset();
    }));
    el.querySelector('[data-style]')?.addEventListener('change', (e) => {
      const v = e.target.value;
      App.setToolOption('weight', parseInt(v, 10));
      App.setToolOption('italic', v.endsWith('i'));
    });
    el.querySelector('[data-text-color]')?.addEventListener('input', (e) => {
      if (!TextEditor.setProp('color', e.target.value)) App.setColor('fg', hexToRgb(e.target.value));
    });
    el.querySelectorAll('[data-text]').forEach((b) => b.addEventListener('click', () => (b.dataset.text === 'commit' ? TextEditor.commit() : TextEditor.cancel())));
    if (id === 'transform') {
      el.querySelectorAll('[data-tf]').forEach((input) => input.addEventListener('change', () => this.applyTransformField(input)));
      el.querySelectorAll('[data-tfop]').forEach((b) => b.addEventListener('click', () => {
        const op = b.dataset.tfop;
        if (op === 'commit') Transform.commit();
        else if (op === 'cancel') Transform.cancel();
        else { Transform.apply(op); this.syncTransform(); }
      }));
      this.syncTransform();
    }
  },

  syncTransform() {
    const t = Transform.active;
    if (!t) return;
    const vals = { x: Math.round(t.cx - (t.bounds.w * Math.abs(t.sx)) / 2), y: Math.round(t.cy - (t.bounds.h * Math.abs(t.sy)) / 2), w: +(t.sx * 100).toFixed(1), h: +(t.sy * 100).toFixed(1), a: +((t.angle * 180) / Math.PI).toFixed(1) };
    this.el.querySelectorAll('[data-tf]').forEach((input) => { if (document.activeElement !== input) input.value = vals[input.dataset.tf]; });
  },

  applyTransformField(input) {
    const t = Transform.active;
    const v = parseFloat(input.value);
    if (!t || Number.isNaN(v)) return;
    const k = input.dataset.tf;
    if (k === 'x') t.cx = v + (t.bounds.w * Math.abs(t.sx)) / 2;
    if (k === 'y') t.cy = v + (t.bounds.h * Math.abs(t.sy)) / 2;
    if (k === 'w') t.sx = v / 100 || 0.01;
    if (k === 'h') t.sy = v / 100 || 0.01;
    if (k === 'a') t.angle = (v * Math.PI) / 180;
    t.doc.invalidate();
    this.syncTransform();
  },

  brushPopover(anchor, id) {
    document.querySelector('.brush-pop')?.remove();
    const o = Tools.o(id);
    const pop = document.createElement('div');
    pop.className = 'brush-pop';
    const presets = [[1, 100], [5, 100], [9, 100], [13, 0], [19, 0], [30, 0], [45, 0], [65, 0], [100, 0], [200, 0], [30, 100], [60, 100]];
    pop.innerHTML = `
      <div class="prow prow-range"><label class="prow-label">Size</label><span class="pnum"><input type="number" data-k="size" min="1" max="2500" value="${o.size}"><em>px</em></span>
        <input type="range" class="prange" data-k="size" min="1" max="500" value="${Math.min(o.size, 500)}"></div>
      ${o.hardness != null ? `<div class="prow prow-range"><label class="prow-label">Hardness</label><span class="pnum"><input type="number" data-k="hardness" min="0" max="100" value="${o.hardness}"><em>%</em></span>
        <input type="range" class="prange" data-k="hardness" min="0" max="100" value="${o.hardness}"></div>` : ''}
      <div class="brush-presets">${presets.map(([s, h]) => `<button data-preset="${s},${h}" title="${h ? 'Hard' : 'Soft'} Round ${s}"><span style="width:${Math.min(28, Math.max(3, Math.sqrt(s) * 3))}px;height:${Math.min(28, Math.max(3, Math.sqrt(s) * 3))}px" class="${h ? '' : 'soft'}"></span><em>${s}</em></button>`).join('')}</div>`;
    document.getElementById('overlay-layer').append(pop);
    const r = anchor.getBoundingClientRect();
    pop.style.left = `${r.left}px`;
    pop.style.top = `${r.bottom + 4}px`;
    const set = (k, v) => {
      App.setToolOption(k, v);
      pop.querySelectorAll(`[data-k="${k}"]`).forEach((x) => { if (x !== document.activeElement) x.value = v; });
      anchor.querySelector('span:nth-child(2)').textContent = Tools.o(id).size;
      anchor.querySelector('.ob-brush-dot').classList.toggle('soft', (Tools.o(id).hardness ?? 100) < 50);
    };
    pop.addEventListener('input', (e) => {
      const k = e.target.dataset.k;
      if (k) set(k, clamp(+e.target.value, +e.target.min, +e.target.max));
    });
    pop.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => {
      const [s, h] = b.dataset.preset.split(',').map(Number);
      set('size', s);
      if (o.hardness != null) set('hardness', h);
    }));
    const close = (e) => {
      if (pop.contains(e.target) || anchor.contains(e.target)) return;
      pop.remove();
      document.removeEventListener('pointerdown', close, true);
    };
    setTimeout(() => document.addEventListener('pointerdown', close, true));
  },
};
