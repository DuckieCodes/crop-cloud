// Shared UI building blocks: escaping, formatting, menus, modals, toasts.

const ACCENTS = {
  violet: { label: 'Violet', solid: '#6c4dff', from: '#7b5cff', to: '#00c2ff', on: '#fff' },
  blue: { label: 'Blue', solid: '#2b63f0', from: '#2f6bff', to: '#00c2ff', on: '#fff' },
  teal: { label: 'Teal', solid: '#008080', from: '#00a3a3', to: '#3fe0cf', on: '#fff' },
  pink: { label: 'Pink', solid: '#e0245e', from: '#ff2d6f', to: '#ff8a5c', on: '#fff' },
  orange: { label: 'Orange', solid: '#ff8a1f', from: '#ff7a00', to: '#ffc23d', on: '#1c1206' },
  green: { label: 'Green', solid: '#15803d', from: '#16a34a', to: '#84cc16', on: '#fff' },
};

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) { value /= 1024; i++; }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[i]}`;
}

function timeAgo(ts) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return d === 1 ? 'yesterday' : `${d} days ago`;
  return new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return 'Working late';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

function initials(name) {
  return name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
}

function fileExt(name) {
  const m = /\.([a-z0-9]+)$/i.exec(name);
  return m ? m[1].toUpperCase() : 'IMG';
}

function appTile(app, size = 44) {
  const planned = app.status === 'planned' ? ' is-planned' : '';
  return `<span class="app-tile${planned}" style="--size:${size}px;--c1:${app.colors[0]};--c2:${app.colors[1]}" aria-hidden="true">${app.code}</span>`;
}

// ---------- Dropdown menus ----------
// items: { label, icon, hint, onClick, disabled, danger } | { sep: true } | { header: 'Title' }
const Menu = (() => {
  let current = null;

  function renderItems(items) {
    return items.map((item, i) => {
      if (item.sep) return '<div class="menu-sep" role="separator"></div>';
      if (item.header) return `<div class="menu-header">${esc(item.header)}</div>`;
      return `<button class="menu-item${item.danger ? ' danger' : ''}" role="menuitem" data-index="${i}" ${item.disabled ? 'disabled' : ''}>
        ${item.icon ? icon(item.icon, 16) : ''}<span>${esc(item.label)}</span>${item.hint ? `<span class="hint">${esc(item.hint)}</span>` : ''}
      </button>`;
    }).join('');
  }

  function position(el, anchor, align) {
    const a = anchor.getBoundingClientRect();
    const m = el.getBoundingClientRect();
    let top = a.bottom + 6;
    let left = align === 'end' ? a.right - m.width : a.left;
    if (top + m.height > innerHeight - 8) top = Math.max(8, a.top - m.height - 6);
    left = Math.min(Math.max(8, left), innerWidth - m.width - 8);
    el.style.top = `${top}px`;
    el.style.left = `${left}px`;
  }

  function onOutside(e) {
    if (current && !current.el.contains(e.target) && !current.anchor.contains(e.target)) close();
  }

  function onKey(e) {
    const items = [...current.el.querySelectorAll('.menu-item:not(:disabled)')];
    const i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus(); }
    else if (e.key === 'Tab') close();
  }

  function open(anchor, items = [], { align = 'start', header = '', className = '', focusFirst = true } = {}) {
    if (current?.anchor === anchor) return close();
    close();
    const el = document.createElement('div');
    el.className = `menu ${className}`;
    el.setAttribute('role', 'menu');
    el.innerHTML = header + renderItems(items);
    document.getElementById('layer').append(el);
    position(el, anchor, align);

    el.addEventListener('click', (e) => {
      const btn = e.target.closest('.menu-item[data-index]');
      if (!btn || btn.disabled) return;
      const item = items[btn.dataset.index];
      close();
      item.onClick?.();
    });
    el.addEventListener('keydown', onKey);

    current = { el, anchor };
    anchor.classList.add('is-open');
    anchor.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', onOutside, true);
    if (focusFirst) el.querySelector('.menu-item:not(:disabled)')?.focus();
    return el;
  }

  function close({ restoreFocus = false } = {}) {
    if (!current) return;
    const { el, anchor } = current;
    current = null;
    el.remove();
    anchor.classList.remove('is-open');
    anchor.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', onOutside, true);
    if (restoreFocus) anchor.focus();
  }

  return { open, close, isOpen: () => !!current };
})();

// ---------- Modal dialogs ----------
const Modal = (() => {
  const stack = [];

  function trapFocus(e, modal) {
    if (e.key !== 'Tab') return;
    const focusable = [...modal.querySelectorAll('button:not(:disabled), input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])')]
      .filter((el) => el.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  function open({ title, body, footer = '', size = 'md', onMount, onClose, flush = false }) {
    Menu.close();
    const prevFocus = document.activeElement;
    const wrap = document.createElement('div');
    wrap.className = 'modal-backdrop';
    wrap.innerHTML = `
      <div class="modal modal-${size}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <header class="modal-head"><h2>${esc(title)}</h2>
          <button class="icon-btn" data-close aria-label="Close">${icon('x')}</button></header>
        <div class="modal-body"${flush ? ' style="padding:0"' : ''}>${body}</div>
        ${footer ? `<footer class="modal-foot">${footer}</footer>` : ''}
      </div>`;
    const modal = wrap.firstElementChild;

    const entry = { close };
    function close() {
      const i = stack.indexOf(entry);
      if (i === -1) return;
      stack.splice(i, 1);
      wrap.classList.add('is-leaving');
      setTimeout(() => wrap.remove(), 120);
      prevFocus?.focus?.();
      onClose?.();
    }

    wrap.addEventListener('pointerdown', (e) => { if (e.target === wrap) close(); });
    wrap.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) close(); });
    wrap.addEventListener('keydown', (e) => trapFocus(e, modal));

    document.getElementById('layer').append(wrap);
    stack.push(entry);
    onMount?.(modal, close);
    if (!modal.contains(document.activeElement)) {
      const autofocus = modal.querySelector('[autofocus]') || modal.querySelector('.modal-foot .btn-primary') || modal.querySelector('[data-close]');
      autofocus?.focus();
    }
    return close;
  }

  return {
    open,
    closeTop: () => stack[stack.length - 1]?.close(),
    closeAll: () => [...stack].reverse().forEach((m) => m.close()),
    isOpen: () => stack.length > 0,
  };
})();

// ---------- Toasts ----------
function toast(message, { icon: iconName = 'info', action, timeout = 4500 } = {}) {
  let host = document.querySelector('.toasts');
  if (!host) {
    host = document.createElement('div');
    host.className = 'toasts';
    host.setAttribute('role', 'status');
    host.setAttribute('aria-live', 'polite');
    document.body.append(host);
  }
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `${icon(iconName, 18)}<span>${esc(message)}</span>
    ${action ? `<button class="toast-action">${esc(action.label)}</button>` : ''}
    <button class="icon-btn icon-btn-sm" aria-label="Dismiss">${icon('x', 14)}</button>`;

  const dismiss = () => {
    if (!el.isConnected) return;
    el.classList.add('is-leaving');
    setTimeout(() => el.remove(), 160);
  };
  el.querySelector('.icon-btn').addEventListener('click', dismiss);
  el.querySelector('.toast-action')?.addEventListener('click', () => { dismiss(); action.onClick(); });

  // Keep at most three on screen.
  while (host.children.length >= 3) host.firstElementChild.remove();
  host.append(el);
  setTimeout(dismiss, timeout);
}
