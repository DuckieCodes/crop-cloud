// UI toolkit: dropdown menus (with submenus), dialogs, toasts and form controls.

// ---------- Menus ----------
// Item: { label, shortcut, run, disabled, checked, submenu: items | () => items } | { sep: true }
const Menus = (() => {
  const stack = [];
  let onCloseAll = null;
  let hoverTimer = 0;

  const host = () => document.getElementById('overlay-layer');

  function resolve(items) {
    return (typeof items === 'function' ? items() : items).filter(Boolean);
  }

  function render(items) {
    return items.map((item, i) => {
      if (item.sep) return '<div class="pmenu-sep"></div>';
      if (item.header) return `<div class="pmenu-header">${esc(item.header)}</div>`;
      if (item.tools) {
        return `<div class="pmenu-tools">${item.tools.map((t, j) => `<button class="pmenu-tool${t.active ? ' on' : ''}" data-i="${i}" data-t="${j}" title="${esc(t.label)}" aria-label="${esc(t.label)}">${icon(t.icon, 16)}</button>`).join('')}</div>`;
      }
      const sub = !!item.submenu;
      return `<div class="pmenu-item${item.disabled ? ' disabled' : ''}${sub ? ' has-sub' : ''}" data-i="${i}" role="menuitem" tabindex="-1">
        <span class="pmenu-check">${item.checked ? icon('check', 13) : ''}</span>
        <span class="pmenu-label">${esc(item.label)}</span>
        <span class="pmenu-key">${sub ? icon('chevronRight', 13) : esc(item.shortcut || '')}</span>
      </div>`;
    }).join('');
  }

  function place(el, x, y, flipX) {
    const r = el.getBoundingClientRect();
    if (x + r.width > innerWidth - 4) x = flipX != null ? flipX - r.width : innerWidth - r.width - 4;
    if (y + r.height > innerHeight - 4) y = Math.max(4, innerHeight - r.height - 4);
    el.style.left = `${Math.max(4, x)}px`;
    el.style.top = `${y}px`;
  }

  function open(items, x, y, { level = 0, flipX = null } = {}) {
    closeFrom(level);
    const list = resolve(items);
    const el = document.createElement('div');
    el.className = 'pmenu';
    el.setAttribute('role', 'menu');
    el.innerHTML = render(list);
    host().append(el);
    place(el, x, y, flipX);
    const entry = { el, items: list, level, active: -1 };
    stack.push(entry);

    el.addEventListener('pointerover', (e) => {
      const row = e.target.closest('.pmenu-item');
      if (!row) return;
      setActive(entry, +row.dataset.i);
      clearTimeout(hoverTimer);
      const item = list[row.dataset.i];
      hoverTimer = setTimeout(() => {
        if (item.submenu && !item.disabled) openSub(entry, row, item);
        else closeFrom(level + 1);
      }, 110);
    });
    el.addEventListener('click', (e) => {
      const tool = e.target.closest('.pmenu-tool');
      if (tool) {
        const t = list[tool.dataset.i].tools[tool.dataset.t];
        closeAll();
        t.run();
        return;
      }
      const row = e.target.closest('.pmenu-item');
      if (!row) return;
      activate(entry, row, list[row.dataset.i]);
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    return el;
  }

  function openSub(entry, row, item) {
    const r = row.getBoundingClientRect();
    open(item.submenu, r.right - 2, r.top - 5, { level: entry.level + 1, flipX: r.left + 2 });
  }

  function activate(entry, row, item) {
    if (!item || item.disabled) return;
    if (item.submenu) { openSub(entry, row, item); return; }
    closeAll();
    item.run?.();
  }

  function setActive(entry, i) {
    entry.active = i;
    entry.el.querySelectorAll('.pmenu-item').forEach((r) => r.classList.toggle('active', +r.dataset.i === i));
  }

  function closeFrom(level) {
    while (stack.length > level) stack.pop().el.remove();
  }

  function closeAll() {
    closeFrom(0);
    const cb = onCloseAll;
    onCloseAll = null;
    cb?.();
  }

  // Arrow-key navigation while a menu is open. Returns true if handled.
  function key(e) {
    if (!stack.length) return false;
    const top = stack[stack.length - 1];
    const rows = [...top.el.querySelectorAll('.pmenu-item:not(.disabled)')];
    const idx = rows.findIndex((r) => +r.dataset.i === top.active);
    if (e.key === 'Escape') { if (stack.length > 1) closeFrom(stack.length - 1); else closeAll(); }
    else if (e.key === 'ArrowDown') setActive(top, +rows[(idx + 1) % rows.length]?.dataset.i);
    else if (e.key === 'ArrowUp') setActive(top, +rows[(idx - 1 + rows.length) % rows.length]?.dataset.i);
    else if (e.key === 'ArrowRight' || e.key === 'Enter') {
      const row = rows[idx];
      if (row) activate(top, row, top.items[row.dataset.i]);
      else if (e.key === 'ArrowRight') return Menubar.step(1);
    } else if (e.key === 'ArrowLeft') {
      if (stack.length > 1) closeFrom(stack.length - 1);
      else Menubar.step(-1);
    } else return false;
    e.preventDefault();
    return true;
  }

  document.addEventListener('pointerdown', (e) => {
    if (!stack.length) return;
    if (e.target.closest('.pmenu') || e.target.closest('.menubar-item')) return;
    closeAll();
  }, true);

  return {
    open,
    closeAll,
    key,
    isOpen: () => stack.length > 0,
    context(items, x, y) { open(items, x, y); },
    onClose(fn) { onCloseAll = fn; },
  };
})();

// ---------- Toasts ----------
function toast(message, { timeout = 3500 } = {}) {
  const host = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = 'ptoast';
  el.textContent = message;
  host.append(el);
  while (host.children.length > 3) host.firstElementChild.remove();
  setTimeout(() => {
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 200);
  }, timeout);
}

// ---------- Dialogs ----------
// Photoshop-style: draggable title bar, content on the left, buttons on the right.
const Dialogs = { stack: [] };

function openDialog({ title, body, width = 420, okLabel = 'OK', cancelLabel = 'Cancel', preview = false, extraButtons = '', onMount, onOk, onCancel }) {
  Menus.closeAll();
  const backdrop = document.createElement('div');
  backdrop.className = 'pdialog-backdrop';
  backdrop.innerHTML = `
    <div class="pdialog" role="dialog" aria-modal="true" aria-label="${esc(title)}" style="width:${width}px">
      <div class="pdialog-title">${esc(title)}<button class="pdialog-x" data-cancel aria-label="Close">${icon('x', 14)}</button></div>
      <div class="pdialog-main">
        <form class="pdialog-body" novalidate>${body}</form>
        <div class="pdialog-buttons">
          ${okLabel ? `<button class="pbtn pbtn-primary" data-ok>${esc(okLabel)}</button>` : ''}
          ${cancelLabel ? `<button class="pbtn" data-cancel>${esc(cancelLabel)}</button>` : ''}
          ${extraButtons}
          ${preview ? '<label class="pcheck pdialog-preview"><input type="checkbox" data-preview checked> Preview</label>' : ''}
        </div>
      </div>
    </div>`;
  document.getElementById('overlay-layer').append(backdrop);
  const dlg = backdrop.firstElementChild;
  const form = dlg.querySelector('.pdialog-body');
  const prevFocus = document.activeElement;

  const api = {
    el: dlg,
    form,
    get previewOn() { return !preview || dlg.querySelector('[data-preview]').checked; },
    close() {
      backdrop.remove();
      Dialogs.stack.splice(Dialogs.stack.indexOf(api), 1);
      prevFocus?.focus?.();
    },
    ok() {
      if (onOk && onOk(api) === false) return;
      api.close();
    },
    cancel() {
      onCancel?.(api);
      api.close();
    },
  };
  Dialogs.stack.push(api);

  dlg.querySelector('[data-ok]')?.addEventListener('click', (e) => { e.preventDefault(); api.ok(); });
  dlg.querySelectorAll('[data-cancel]').forEach((b) => b.addEventListener('click', (e) => { e.preventDefault(); api.cancel(); }));
  form.addEventListener('submit', (e) => { e.preventDefault(); api.ok(); });
  dlg.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); api.cancel(); }
    else if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'BUTTON') { e.preventDefault(); e.stopPropagation(); api.ok(); }
    e.stopPropagation();
  });

  // Drag by the title bar so the canvas preview stays visible.
  const titleBar = dlg.querySelector('.pdialog-title');
  titleBar.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    const r = dlg.getBoundingClientRect();
    const dx = e.clientX - r.left, dy = e.clientY - r.top;
    dlg.style.position = 'fixed';
    titleBar.setPointerCapture(e.pointerId);
    const move = (ev) => {
      dlg.style.left = `${clamp(ev.clientX - dx, 0, innerWidth - 60)}px`;
      dlg.style.top = `${clamp(ev.clientY - dy, 0, innerHeight - 30)}px`;
    };
    move(e);
    titleBar.addEventListener('pointermove', move);
    titleBar.addEventListener('pointerup', () => titleBar.removeEventListener('pointermove', move), { once: true });
  });

  onMount?.(api);
  const first = form.querySelector('[autofocus]') || form.querySelector('input:not([type=checkbox]):not([type=range]), select') || dlg.querySelector('[data-ok]');
  first?.focus();
  first?.select?.();
  return api;
}

function confirmDialog({ title, message, okLabel = 'OK', cancelLabel = 'Cancel', extra }) {
  return new Promise((resolve) => {
    openDialog({
      title, okLabel, cancelLabel, width: 440,
      body: `<p class="pdialog-text">${esc(message)}</p>`,
      extraButtons: extra ? `<button class="pbtn" data-extra>${esc(extra)}</button>` : '',
      onMount(api) {
        api.el.querySelector('[data-extra]')?.addEventListener('click', (e) => { e.preventDefault(); api.close(); resolve('extra'); });
      },
      onOk: () => resolve('ok'),
      onCancel: () => resolve('cancel'),
    });
  });
}

// ---------- Form controls ----------
function paramControl(p, value) {
  if (p.type === 'check') {
    return `<label class="pcheck prow-check"><input type="checkbox" data-key="${p.key}" ${value ? 'checked' : ''}> ${esc(p.label)}</label>`;
  }
  if (p.type === 'select') {
    return `<label class="prow"><span class="prow-label">${esc(p.label)}</span>
      <select class="pselect" data-key="${p.key}">${p.options.map(([v, l]) => `<option value="${v}" ${v === value ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
  }
  if (p.type === 'color') {
    return `<label class="prow"><span class="prow-label">${esc(p.label)}</span><input type="color" class="pcolor" data-key="${p.key}" value="${value}"></label>`;
  }
  const step = p.step || 1;
  return `<div class="prow prow-range">
    <label class="prow-label" for="p-${p.key}">${esc(p.label)}</label>
    <span class="pnum"><input type="number" id="p-${p.key}" data-key="${p.key}" min="${p.min}" max="${p.max}" step="${step}" value="${value}">${p.unit ? `<em>${esc(p.unit)}</em>` : ''}</span>
    <input type="range" class="prange" data-key="${p.key}" min="${p.min}" max="${p.max}" step="${step}" value="${value}" tabindex="-1">
  </div>`;
}

// Wire paramControl() inputs inside root to a params object; onChange fires live.
function bindParams(root, specs, params, onChange) {
  const byKey = Object.fromEntries(specs.map((s) => [s.key, s]));
  const sync = (key, value, source) => {
    root.querySelectorAll(`[data-key="${key}"]`).forEach((el) => {
      if (el === source) return;
      if (el.type === 'checkbox') el.checked = value;
      else el.value = value;
    });
  };
  root.addEventListener('input', (e) => {
    const el = e.target.closest('[data-key]');
    if (!el || !byKey[el.dataset.key]) return;
    const spec = byKey[el.dataset.key];
    let value;
    if (el.type === 'checkbox') value = el.checked;
    else if (spec.type === 'select' || spec.type === 'color') value = el.value;
    else {
      value = parseFloat(el.value);
      if (Number.isNaN(value)) return;
      value = clamp(value, spec.min, spec.max);
    }
    params[spec.key] = value;
    sync(spec.key, value, el);
    onChange(params, spec.key);
  });
  root.addEventListener('change', (e) => {
    const el = e.target.closest('input[type=number][data-key]');
    if (el && byKey[el.dataset.key]) el.value = params[el.dataset.key];
  });
}

// Drag a label left/right to change the number in the input next to it (Photoshop "scrubby" labels).
function makeScrubby(label, input, { min = -Infinity, max = Infinity, step = 1, speed = 1 } = {}) {
  label.classList.add('scrubby');
  label.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    label.setPointerCapture(e.pointerId);
    const start = e.clientX;
    const from = parseFloat(input.value) || 0;
    const move = (ev) => {
      const v = clamp(Math.round((from + (ev.clientX - start) * speed * step) / step) * step, min, max);
      input.value = +v.toFixed(3);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const up = () => {
      label.removeEventListener('pointermove', move);
      input.dispatchEvent(new Event('change', { bubbles: true }));
    };
    label.addEventListener('pointermove', move);
    label.addEventListener('pointerup', up, { once: true });
  });
}
