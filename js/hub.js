// Crop Cloud hub: routing, actions, dialogs, search and keyboard shortcuts.

const $ = (sel, root = document) => root.querySelector(sel);
const findApp = (id) => APPS.find((a) => a.id === id);
const findRecent = (id) => Store.get('recents').find((f) => f.id === id);

// ---------- Routing ----------
// Navigation uses location.replace so the window keeps a single history
// entry, which lets window.close() quit the app window.
function go(route) {
  if (location.hash.slice(1) === route) return;
  location.replace(`#${route}`);
}

function currentRoute() {
  const [view, sub] = location.hash.slice(1).split('/');
  return Views[view] ? { view, sub } : { view: 'home', sub: undefined };
}

let renderedView = null;
function render() {
  const { view, sub } = currentRoute();
  const main = $('#view');
  const keepScroll = view === renderedView;
  const scroll = main.scrollTop;

  const style = keepScroll ? ' style="animation:none"' : '';
  main.innerHTML = `<div class="page"${style}>${Views[view](sub)}</div>`;
  main.scrollTop = keepScroll ? scroll : 0;
  renderedView = view;

  document.querySelectorAll('.sidebar .nav-item[data-view]').forEach((a) => {
    const on = a.dataset.view === view;
    a.classList.toggle('active', on);
    if (on) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  const nav = NAV.find((n) => n.view === view);
  document.title = view === 'home' ? BRAND.name : `${nav.label} · ${BRAND.name}`;
  renderStorage();
}

// ---------- Appearance ----------
const darkQuery = matchMedia('(prefers-color-scheme: dark)');

function applyAppearance() {
  const s = Store.get('settings');
  const root = document.documentElement;
  const dark = s.theme === 'system' ? darkQuery.matches : s.theme === 'dark';
  root.dataset.theme = dark ? 'dark' : 'light';
  root.dataset.density = s.density;
  root.dataset.motion = s.reduceMotion ? 'reduce' : 'full';
  const accent = ACCENTS[s.accent] || ACCENTS.violet;
  root.style.setProperty('--accent', accent.solid);
  root.style.setProperty('--accent-from', accent.from);
  root.style.setProperty('--accent-to', accent.to);
  root.style.setProperty('--on-accent', accent.on);

  const name = s.name.trim();
  $('#avatar').innerHTML = name ? esc(initials(name)) : icon('user', 18);
  $('#avatar-btn').setAttribute('aria-label', name ? `Account: ${name}` : 'Account');
}

function isDark() {
  return document.documentElement.dataset.theme === 'dark';
}

function toggleTheme() {
  Store.setSetting('theme', isDark() ? 'light' : 'dark');
}

// ---------- Sidebar ----------
function renderSidebar() {
  $('#nav').innerHTML = NAV.map((n, i) => `
    <a class="nav-item" href="#${n.view}" data-view="${n.view}" title="${n.label} (${i + 1})">
      ${icon(n.icon, 20)}<span class="nav-label">${n.label}</span>
    </a>`).join('');
}

function renderStorage() {
  const cloud = Account.signedIn && Account.storage;
  if (cloud) {
    const { used, cap, planName } = Account.storage;
    $('#storage').innerHTML = `
      <div class="storage-head">${icon('cloud', 16)} Cloud storage</div>
      <div class="storage-bar${used >= cap ? ' is-full' : ''}"><span style="width:${Math.min(100, (used / cap) * 100).toFixed(1)}%"></span></div>
      <div class="storage-text">${formatBytes(used)} of ${formatBytes(cap)} · <button class="link" data-action="plans">${esc(planName)}</button></div>`;
    return;
  }
  const quota = 5 * 1024 * 1024; // typical localStorage limit
  const used = Store.usageBytes();
  const count = Store.get('recents').length;
  $('#storage').innerHTML = `
    <div class="storage-head">${icon('cloud', 16)} Local library</div>
    <div class="storage-bar"><span style="width:${Math.min(100, (used / quota) * 100).toFixed(1)}%"></span></div>
    <div class="storage-text">${count} file${count === 1 ? '' : 's'} · ${formatBytes(used)} of 5 MB</div>`;
}

// ---------- Notifications ----------
function unreadNotifications() {
  const read = Store.get('readNotifications');
  return SEED_NOTIFICATIONS.filter((n) => !read.includes(n.id));
}

function renderBell() {
  const count = unreadNotifications().length;
  $('#bell-count').textContent = count;
  $('#bell-count').hidden = count === 0;
  $('#bell-btn').setAttribute('aria-label', count ? `Notifications, ${count} unread` : 'Notifications');
}

function openNotifications(anchor) {
  const unread = new Set(unreadNotifications().map((n) => n.id));
  const header = `
    <div class="notif-head">
      <h2 style="font-size:15px">Notifications</h2>
      ${unread.size ? '<button class="link" data-action="read-all">Mark all as read</button>' : ''}
    </div>
    <div class="notif-list">
      ${SEED_NOTIFICATIONS.map((n) => `
        <button class="notif${unread.has(n.id) ? ' unread' : ''}" data-action="read-notification" data-id="${n.id}">
          <span class="ni-icon">${icon(n.icon, 18)}</span>
          <span><div class="ni-title">${esc(n.title)}</div><div class="ni-body">${esc(n.body)}</div></span>
        </button>`).join('')}
    </div>`;
  Menu.open(anchor, [], { header, align: 'end', className: 'notif-panel', focusFirst: false });
}

function markRead(ids) {
  const read = new Set([...Store.get('readNotifications'), ...ids]);
  Store.set('readNotifications', [...read]);
}

// ---------- Menus ----------
function openMainMenu(anchor) {
  Menu.open(anchor, [
    { header: 'File' },
    { label: 'New file…', icon: 'filePlus', hint: 'N', onClick: () => openNewDoc() },
    { label: 'Open file…', icon: 'upload', hint: 'Ctrl O', onClick: () => pickFiles() },
    { sep: true },
    { header: 'View' },
    ...NAV.map((n, i) => ({ label: n.label, icon: n.icon, hint: String(i + 1), onClick: () => go(n.view) })),
    { label: isDark() ? 'Light theme' : 'Dark theme', icon: isDark() ? 'sun' : 'moon', onClick: toggleTheme },
    { sep: true },
    { label: 'Preferences…', icon: 'sliders', hint: 'Ctrl ,', onClick: () => openPreferences() },
    { label: 'Keyboard shortcuts', icon: 'keyboard', hint: '?', onClick: openShortcuts },
    { label: `About ${BRAND.name}`, icon: 'info', onClick: openAbout },
    { sep: true },
    { label: `Quit ${BRAND.name}`, icon: 'power', hint: 'Ctrl Q', onClick: quit },
  ]);
}

function openHelpMenu(anchor) {
  Menu.open(anchor, [
    { label: 'Tutorials', icon: 'book', onClick: () => go('learn') },
    { label: 'Take the tour', icon: 'map', onClick: () => openTutorial('tour') },
    { label: 'Keyboard shortcuts', icon: 'keyboard', hint: '?', onClick: openShortcuts },
    { sep: true },
    { label: `About ${BRAND.name}`, icon: 'info', onClick: openAbout },
  ], { align: 'end' });
}

function openAccountMenu(anchor) {
  const name = Store.setting('name').trim();
  const user = Account.user;
  const storage = Account.storage;
  const subtitle = user ? esc(user.email) : Account.configured ? 'Not signed in' : 'Local profile on this computer';
  const header = `
    <div class="menu-profile">
      <span class="avatar avatar-lg">${name ? esc(initials(name)) : icon('user', 20)}</span>
      <div><div class="name">${name ? esc(name) : 'Your profile'}</div><div class="muted">${subtitle}</div></div>
    </div>
    ${user && storage ? `
      <div class="menu-storage">
        <div class="storage-bar"><span style="width:${Math.min(100, (storage.used / storage.cap) * 100).toFixed(1)}%"></span></div>
        <div class="muted">${formatBytes(storage.used)} of ${formatBytes(storage.cap)} · ${esc(storage.planName)} plan</div>
      </div>` : ''}
    <div class="menu-sep"></div>`;
  const accountItems = !Account.configured ? [] : user ? [
    { label: 'Storage and plan…', icon: 'cloud', onClick: openPlans },
  ] : [
    { label: 'Sign in…', icon: 'user', onClick: () => openSignIn() },
    { label: 'Create account…', icon: 'plus', onClick: () => openSignIn({ mode: 'signup' }) },
  ];
  Menu.open(anchor, [
    ...accountItems,
    { label: name ? 'Edit profile' : 'Set your name', icon: 'user', onClick: () => openPreferences('account') },
    { label: 'Preferences…', icon: 'sliders', hint: 'Ctrl ,', onClick: () => openPreferences() },
    { label: isDark() ? 'Light theme' : 'Dark theme', icon: isDark() ? 'sun' : 'moon', onClick: toggleTheme },
    { sep: true },
    ...(user ? [{ label: 'Sign out', icon: 'logOut', onClick: signOut }] : []),
    { label: `Quit ${BRAND.name}`, icon: 'power', onClick: quit },
  ], { header, align: 'end' });
}

function openAppMenu(anchor) {
  const app = findApp(anchor.dataset.id);
  Menu.open(anchor, [
    { label: `Open ${app.name}`, icon: 'external', onClick: () => launchApp(app.id) },
    ...(Platform.hasUpdate(app) ? [{ label: `Update to ${Platform.release(app).version}`, icon: 'download', onClick: () => installApp(app.id) }] : []),
    { label: `About ${app.name}`, icon: 'info', onClick: () => openAppInfo(app.id) },
    { sep: true },
    Platform.managesApps
      ? { label: 'Uninstall…', icon: 'trash', danger: true, onClick: () => confirmUninstall(app.id) }
      : { label: 'Uninstall', icon: 'trash', disabled: true },
  ], { align: 'end' });
}

function openFileMenu(anchor) {
  const file = findRecent(anchor.dataset.id);
  if (!file) return;
  Menu.open(anchor, [
    { label: 'Open in PhotoCrop', icon: 'external', onClick: () => openRecent(file.id) },
    { sep: true },
    { label: 'Remove from recent', icon: 'trash', danger: true, onClick: async () => {
      const blob = await FileStore.get(file.id).catch(() => null);
      Store.removeRecent(file.id);
      FileStore.remove(file.id).catch(() => {});
      toast(`Removed “${file.name}” from recent files`, {
        icon: 'trash',
        action: { label: 'Undo', onClick: () => { Store.addRecent(file); if (blob) FileStore.put(file.id, blob).catch(() => {}); } },
      });
    } },
  ], { align: 'end' });
}

function quit() {
  window.close();
  // Browsers only allow close() on windows they opened as an app window.
  setTimeout(() => toast(`Close this window to quit ${BRAND.name}.`), 150);
}

// ---------- Launching apps ----------
function launchApp(id, payload = {}) {
  const app = findApp(id);
  if (isInstallable(app)) {
    openAppInfo(id);
    return;
  }
  if (!isInstalled(app)) {
    toast(`${app.name} is on the roadmap and isn't available yet.`);
    return;
  }
  if (!app.entry) {
    toast(`${app.name}'s editor isn't built yet. It's the next step.`, { icon: 'sparkles' });
    return;
  }
  // The app reads (and clears) this on load to know what to open.
  sessionStorage.setItem('cropcloud.launch', JSON.stringify({ app: id, ...payload, at: Date.now() }));
  location.href = app.entry;
}

function openRecent(id) {
  launchApp('photocrop', { type: 'open', fileId: id });
}

// ---------- Installing apps (desktop app) ----------
// Downloads need an account; the sign-in is remembered on this computer.
async function installApp(id) {
  const app = findApp(id);
  if (!Platform.managesApps || Platform.progress(app)) return;
  if (Account.configured && !Account.signedIn) {
    openSignIn({
      reason: `Sign in to download ${app.name}. You only need to do this once on this computer.`,
      onDone: () => installApp(id),
    });
    return;
  }
  const updating = isInstalled(app);
  try {
    await Platform.install(app);
    toast(`${app.name} ${Platform.installedVersion(app)} is ${updating ? 'updated' : 'installed'}`, {
      icon: 'check',
      action: { label: 'Open', onClick: () => launchApp(id) },
    });
  } catch (err) {
    toast(`Couldn’t ${updating ? 'update' : 'install'} ${app.name}. ${err.message}`, { icon: 'alert', timeout: 9000 });
  }
}

async function updateAll() {
  for (const app of appsWithUpdates()) await installApp(app.id);
}

function confirmUninstall(id) {
  const app = findApp(id);
  Modal.open({
    title: `Uninstall ${app.name}?`,
    size: 'sm',
    body: `<p>${esc(app.name)} will be removed from this computer. Your projects, recent files and settings stay, and you can install it again any time.</p>`,
    footer: '<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-danger" id="confirm-uninstall">Uninstall</button>',
    onMount(modal, close) {
      $('#confirm-uninstall', modal).addEventListener('click', async () => {
        close();
        try {
          await Platform.uninstall(app);
          toast(`${app.name} was uninstalled`, { icon: 'trash' });
        } catch (err) {
          toast(`Couldn’t uninstall ${app.name}. ${err.message}`, { icon: 'alert' });
        }
      });
    },
  });
}

// ---------- Accounts ----------
// mode: 'signin' | 'signup'. onDone runs once the person is signed in.
function openSignIn({ mode = 'signin', reason = '', onDone } = {}) {
  if (!Account.configured) {
    Modal.open({
      title: 'Accounts aren’t set up yet',
      size: 'sm',
      body: '<p>Sign-in needs a Supabase project. Put its URL and anon key in <code>js/config.js</code> (see <code>supabase/README.md</code>).</p>',
      footer: '<button class="btn btn-primary" data-close>OK</button>',
    });
    return;
  }
  let step = mode;      // signin | signup | verify | forgot | reset
  let email = '';
  let finished = false;

  const titles = { signin: 'Sign in', signup: 'Create your account', verify: 'Check your email', forgot: 'Reset your password', reset: 'Choose a new password' };
  const passwordField = (id, label, autocomplete) => `
    <label class="field"><span>${label}</span>
      <span class="input-unit password-field">
        <input id="${id}" type="password" required minlength="${step === 'signin' ? 1 : 8}" autocomplete="${autocomplete}">
        <button type="button" class="icon-btn icon-btn-sm" data-reveal="${id}" aria-label="Show password" aria-pressed="false">${icon('eye', 16)}</button>
      </span>
    </label>`;
  const emailField = `<label class="field"><span>Email</span>
      <input class="input" id="auth-email" type="email" required autocomplete="email" value="${esc(email)}"></label>`;
  const codeField = `<label class="field"><span>6-digit code</span>
      <input class="input auth-code" id="auth-code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6,10}" maxlength="10" required></label>`;

  function body() {
    const intro = {
      signin: reason || `Sign in to your ${esc(BRAND.name)} account.`,
      signup: reason || 'One account for every app, your cloud storage and sharing with friends. Use the email you were invited with.',
      verify: `We sent a code to <strong>${esc(email)}</strong>. Enter it to finish creating your account.`,
      forgot: 'Enter your email and we’ll send you a code to reset your password.',
      reset: `Enter the code we sent to <strong>${esc(email)}</strong> and your new password.`,
    }[step];
    const fields = {
      signin: emailField + passwordField('auth-password', 'Password', 'current-password'),
      signup: `<label class="field"><span>Name</span><input class="input" id="auth-name" maxlength="40" autocomplete="name" value="${esc(Store.setting('name'))}"></label>`
        + emailField + passwordField('auth-password', 'Password (at least 8 characters)', 'new-password'),
      verify: codeField,
      forgot: emailField,
      reset: codeField + passwordField('auth-password', 'New password (at least 8 characters)', 'new-password'),
    }[step];
    const submit = { signin: 'Sign in', signup: 'Create account', verify: 'Confirm', forgot: 'Send code', reset: 'Save password' }[step];
    const links = {
      signin: `${CONFIG.emailCodes ? '<button type="button" class="link" data-step="forgot">Forgot password?</button>' : ''}
        <span class="muted">New here? <button type="button" class="link" data-step="signup">Create an account</button></span>
        ${CONFIG.emailCodes ? '' : '<span class="muted auth-note">Forgot your password? Ask whoever runs your Crop Cloud server to reset it.</span>'}`,
      signup: `<span class="muted">Already have an account? <button type="button" class="link" data-step="signin">Sign in</button></span>`,
      verify: '<button type="button" class="link" data-step="signin">Back to sign in</button>',
      forgot: '<button type="button" class="link" data-step="signin">Back to sign in</button>',
      reset: '<button type="button" class="link" data-step="forgot">Send a new code</button>',
    }[step];
    return `
      <form class="auth-form" novalidate>
        <p class="auth-intro">${intro}</p>
        ${fields}
        <p class="auth-error" id="auth-error" role="alert" hidden></p>
        <button class="btn btn-primary auth-submit" type="submit">${submit}</button>
        <div class="auth-links">${links}</div>
      </form>`;
  }

  Modal.open({
    title: titles[step],
    size: 'sm',
    body: '<div id="auth-body"></div>',
    onClose: () => { if (finished) onDone?.(); },
    onMount(modal, close) {
      const host = $('#auth-body', modal);
      const show = (next) => {
        step = next;
        $('.modal-head h2', modal).textContent = titles[step];
        modal.setAttribute('aria-label', titles[step]);
        host.innerHTML = body();
        (host.querySelector('input:not([value]), input[value=""]') || host.querySelector('input'))?.focus();
      };
      const fail = (msg) => {
        const el = $('#auth-error', host);
        el.innerHTML = `${icon('alert', 15)} ${esc(msg)}`;
        el.hidden = false;
      };
      const value = (id) => $(`#${id}`, host)?.value.trim() || '';

      host.addEventListener('click', (e) => {
        const reveal = e.target.closest('[data-reveal]');
        if (reveal) {
          const input = $(`#${reveal.dataset.reveal}`, host);
          const showing = input.type === 'text';
          input.type = showing ? 'password' : 'text';
          reveal.setAttribute('aria-pressed', String(!showing));
          reveal.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
          return;
        }
        const to = e.target.closest('[data-step]');
        if (to) {
          email = value('auth-email') || email;
          show(to.dataset.step);
        }
      });

      host.addEventListener('submit', async (e) => {
        e.preventDefault();
        const form = e.target;
        const newPassword = (step === 'signup' || step === 'reset') ? $('#auth-password', host).value : null;
        if (newPassword !== null && newPassword.length < 8 && form.checkValidity()) {
          $('#auth-password', host).focus();
          fail('Use a password with at least 8 characters.');
          return;
        }
        if (!form.checkValidity()) {
          const bad = form.querySelector(':invalid');
          bad.focus();
          fail(bad.type === 'email' ? 'Enter a valid email address.'
            : bad.id === 'auth-code' ? 'Enter the code from the email.'
            : step === 'signin' ? 'Enter your password.' : 'Use a password with at least 8 characters.');
          return;
        }
        const button = form.querySelector('.auth-submit');
        button.disabled = true;
        try {
          if (step !== 'verify' && step !== 'reset') email = value('auth-email');
          if (step === 'signin') await Account.signIn(email, $('#auth-password', host).value);
          if (step === 'signup') {
            const name = value('auth-name');
            if (name) Store.setSetting('name', name);
            const { needsCode } = await Account.signUp(email, $('#auth-password', host).value, name);
            if (needsCode) { show('verify'); return; }
          }
          if (step === 'verify') await Account.verifySignup(email, value('auth-code'));
          if (step === 'forgot') { await Account.sendPasswordCode(email); show('reset'); return; }
          if (step === 'reset') await Account.resetPassword(email, value('auth-code'), $('#auth-password', host).value);
          finished = true;
          close();
          toast(`Signed in as ${Account.user.email}`, { icon: 'check' });
        } catch (err) {
          fail(err.message);
        } finally {
          if (button.isConnected) button.disabled = false;
        }
      });

      show(step);
    },
  });
}

async function signOut() {
  await Account.signOut();
  toast('Signed out', { icon: 'logOut' });
}

async function openPlans() {
  const storage = Account.storage;
  let plans = [];
  try {
    plans = await Account.plans();
  } catch (err) {
    toast(`Couldn’t load plans. ${err.message}`, { icon: 'alert' });
    return;
  }
  const price = (p) => (p.price_cents === 0 ? 'Free' : p.price_cents == null ? 'Price coming soon'
    : `${(p.price_cents / 100).toLocaleString(undefined, { style: 'currency', currency: p.currency.toUpperCase() })} / ${p.interval}`);
  Modal.open({
    title: 'Storage and plan',
    size: 'md',
    body: `
      ${storage ? `
        <div class="plan-usage">
          <div class="storage-bar${storage.used >= storage.cap ? ' is-full' : ''}"><span style="width:${Math.min(100, (storage.used / storage.cap) * 100).toFixed(1)}%"></span></div>
          <p class="muted">${formatBytes(storage.used)} of ${formatBytes(storage.cap)} used. Your cloud storage works in every app.</p>
        </div>` : ''}
      <div class="plan-grid">
        ${plans.map((p) => `
          <div class="plan-card${p.id === storage?.planId ? ' is-current' : ''}">
            <h3>${esc(p.name)}</h3>
            <div class="plan-size">${formatBytes(p.storage_bytes)}</div>
            <div class="muted">${esc(price(p))}</div>
            ${p.id === storage?.planId ? '<span class="badge badge-accent">Your plan</span>'
              : `<button class="btn btn-secondary btn-sm" disabled title="Upgrades open once payments are set up">Upgrade</button>`}
          </div>`).join('')}
      </div>
      ${plans.length < 2 ? '<p class="hint-text">Bigger plans are on the way.</p>' : '<p class="hint-text">Upgrades open once payments are set up.</p>'}`,
    footer: '<button class="btn btn-primary" data-close>Done</button>',
  });
}

// Keep the display name the same here and on the account.
let nameSync = null;
function syncNameToAccount(name) {
  clearTimeout(nameSync);
  if (!Account.signedIn) return;
  nameSync = setTimeout(() => Account.setDisplayName(name.trim()).catch(() => {}), 600);
}

// ---------- Files ----------
let pendingQuickAction = null;

function pickFiles(quickAction = null) {
  pendingQuickAction = quickAction;
  $('#file-input').click();
}

function makeRecent(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const width = img.naturalWidth || 512;
      const height = img.naturalHeight || 512;
      const scale = Math.min(1, 360 / Math.max(width, height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve({
        id: `${file.name}:${file.size}:${file.lastModified}`,
        name: file.name,
        type: file.type,
        size: file.size,
        width,
        height,
        thumb: canvas.toDataURL('image/webp', 0.8),
        openedAt: Date.now(),
      });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`Could not decode ${file.name}`));
    };
    img.src = url;
  });
}

async function handleFiles(fileList, quickAction = null) {
  const files = [...fileList];
  const images = files.filter((f) => f.type.startsWith('image/'));
  const skipped = files.length - images.length;
  const added = [];

  for (const file of images) {
    try {
      const recent = await makeRecent(file);
      // Keep the original so PhotoCrop can open it later.
      await FileStore.put(recent.id, file).catch(() => {});
      added.push(recent);
    } catch {
      toast(`Couldn't read “${file.name}”. Try PNG, JPG or WebP.`);
    }
  }
  // Add in reverse so the first selected file ends up at the top.
  [...added].reverse().forEach((r) => Store.addRecent(r));

  if (skipped) toast(`Skipped ${skipped} file${skipped === 1 ? '' : 's'}: only images are supported.`);
  if (!added.length) return;

  if (quickAction) {
    launchApp('photocrop', { type: 'quick-action', action: quickAction, fileId: added[0].id });
  } else if (findApp('photocrop').entry) {
    launchApp('photocrop', { type: 'open', fileIds: added.map((r) => r.id) });
  } else {
    const label = added.length === 1 ? `“${added[0].name}”` : `${added.length} images`;
    toast(`Added ${label} to your files`, { icon: 'check', action: { label: 'View', onClick: () => go('files') } });
  }
}

function setupDragAndDrop() {
  const overlay = $('#drop-overlay');
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  let depth = 0;

  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth++;
    overlay.hidden = false;
  });
  window.addEventListener('dragleave', (e) => {
    if (!hasFiles(e)) return;
    depth = Math.max(0, depth - 1);
    if (!depth) overlay.hidden = true;
  });
  window.addEventListener('dragover', (e) => {
    if (hasFiles(e)) e.preventDefault();
  });
  window.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0;
    overlay.hidden = true;
    handleFiles(e.dataTransfer.files);
  });
}

function confirmClearRecents() {
  Modal.open({
    title: 'Clear recent files?',
    size: 'sm',
    body: '<p class="muted">This removes them from Crop Cloud. Your original files on this computer are not touched.</p>',
    footer: `<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-danger" id="confirm-clear">Clear all</button>`,
    onMount(modal, close) {
      $('#confirm-clear', modal).addEventListener('click', () => {
        Store.set('recents', []);
        FileStore.clear().catch(() => {});
        close();
        toast('Recent files cleared', { icon: 'check' });
      });
    },
  });
}

// ---------- New file dialog ----------
function gcd(a, b) {
  return b ? gcd(b, a % b) : a;
}

function aspectLabel(w, h) {
  const d = gcd(w, h);
  const [rw, rh] = [w / d, h / d];
  return rw <= 32 && rh <= 32 ? `${rw}:${rh}` : `${(w / h).toFixed(2)}:1`;
}

function openNewDoc(presetId = 'custom') {
  let docCount = 1;
  const presetList = PRESETS.map((p) => `
    <button type="button" class="newdoc-preset" data-preset="${p.id}" aria-pressed="false">
      <span class="np-name">${esc(p.name)}</span>
      <span class="np-meta">${p.id === 'custom' ? 'Set your own size' : `${p.width} × ${p.height} px`}</span>
    </button>`).join('');
  const backgrounds = [['white', 'White', '#fff'], ['black', 'Black', '#000'], ['transparent', 'Transparent', '']];

  Modal.open({
    title: 'New file',
    size: 'lg',
    body: `
      <div class="newdoc">
        <div class="newdoc-presets" role="group" aria-label="Presets">${presetList}</div>
        <form class="form-stack" id="newdoc-form" novalidate>
          <label class="field"><span>Name</span><input class="input" name="name" value="Untitled-${docCount}" autocomplete="off" autofocus></label>
          <div class="field-row">
            <label class="field"><span>Width</span><span class="input-unit"><input name="width" type="number" min="1" max="30000" step="1">px</span></label>
            <button type="button" class="icon-btn" id="swap-size" aria-label="Swap width and height" title="Swap width and height">${icon('swap')}</button>
            <label class="field"><span>Height</span><span class="input-unit"><input name="height" type="number" min="1" max="30000" step="1">px</span></label>
          </div>
          <label class="field"><span>Resolution</span><span class="input-unit"><input name="dpi" type="number" min="1" max="2400" value="72">pixels/inch</span></label>
          <fieldset class="field">
            <legend>Background</legend>
            <div class="bg-options">
              ${backgrounds.map(([id, label, color]) => `
                <button type="button" class="bg-option" data-bg="${id}" aria-pressed="${id === 'white'}">
                  <span class="bg-swatch${id === 'transparent' ? ' transparent' : ''}" style="background-color:${color}"></span>${label}
                </button>`).join('')}
            </div>
          </fieldset>
          <div class="newdoc-summary" id="newdoc-summary"></div>
          <p class="error-text" id="newdoc-error" role="alert"></p>
        </form>
      </div>`,
    footer: `<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" type="submit" form="newdoc-form">Create</button>`,
    onMount(modal, close) {
      const form = $('#newdoc-form', modal);
      const { width, height, dpi } = form.elements;
      let background = 'white';

      const update = () => {
        const w = Math.round(+width.value);
        const h = Math.round(+height.value);
        const valid = w > 0 && h > 0;
        $('#newdoc-summary', modal).innerHTML = valid
          ? `<span>Size <b>${w} × ${h} px</b></span><span>Aspect <b>${aspectLabel(w, h)}</b></span>
             <span>Print <b>${(w / (+dpi.value || 72) * 2.54).toFixed(1)} × ${(h / (+dpi.value || 72) * 2.54).toFixed(1)} cm</b></span>
             <span>Memory <b>${formatBytes(w * h * 4)}</b></span>`
          : '<span>Enter a width and height.</span>';
        modal.querySelectorAll('.newdoc-preset').forEach((b) => {
          const p = PRESETS.find((x) => x.id === b.dataset.preset);
          b.setAttribute('aria-pressed', String(p.id !== 'custom' && p.width === w && p.height === h));
        });
      };

      const applyPreset = (id) => {
        const p = PRESETS.find((x) => x.id === id) || PRESETS[0];
        width.value = p.width;
        height.value = p.height;
        dpi.value = p.dpi || 72;
        update();
        if (id === 'custom') width.select();
      };

      modal.querySelectorAll('.newdoc-preset').forEach((b) => b.addEventListener('click', () => applyPreset(b.dataset.preset)));
      modal.querySelectorAll('.bg-option').forEach((b) => b.addEventListener('click', () => {
        background = b.dataset.bg;
        modal.querySelectorAll('.bg-option').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      }));
      $('#swap-size', modal).addEventListener('click', () => {
        [width.value, height.value] = [height.value, width.value];
        update();
      });
      form.addEventListener('input', update);
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const w = Math.round(+width.value);
        const h = Math.round(+height.value);
        if (!(w >= 1 && h >= 1 && w <= 30000 && h <= 30000)) {
          $('#newdoc-error', modal).textContent = 'Width and height must be between 1 and 30000 px.';
          return;
        }
        close();
        launchApp('photocrop', {
          type: 'new',
          name: form.elements.name.value.trim() || 'Untitled',
          width: w, height: h, dpi: +dpi.value || 72, background,
        });
      });

      applyPreset(presetId);
      form.elements.name.select();
    },
  });
}

// ---------- Quick actions ----------
function runQuickAction(id) {
  pickFiles(id);
}

// ---------- Info dialogs ----------
function openAppInfo(id) {
  const app = findApp(id);
  const cats = app.categories.map((c) => CATEGORIES.find((x) => x.id === c).label).join(', ');
  Modal.open({
    title: app.name,
    size: 'sm',
    body: `
      <div class="app-info-head">${appTile(app, 64)}<div><h3>${esc(app.name)}</h3><p class="muted">${esc(app.tagline)}</p></div></div>
      <p>${esc(app.description)}</p>
      <dl class="kv">
        <dt>Status</dt><dd>${isInstalled(app) ? `Installed · version ${esc(Platform.installedVersion(app))}`
          : isInstallable(app) ? `Not installed${Platform.release(app) ? ` · ${esc(Platform.release(app).version)}, ${formatBytes(Platform.release(app).size)} download` : ''}`
          : 'Planned'}</dd>
        <dt>Category</dt><dd>${esc(cats)}</dd>
      </dl>`,
    footer: isInstalled(app)
      ? `<button class="btn btn-ghost" data-close>Close</button><button class="btn btn-primary" id="info-open">Open ${esc(app.name)}</button>`
      : isInstallable(app)
        ? `<button class="btn btn-ghost" data-close>Not now</button><button class="btn btn-primary" id="info-install">${icon('download', 16)} Install ${esc(app.name)}</button>`
        : '<button class="btn btn-primary" data-close>Got it</button>',
    onMount(modal, close) {
      $('#info-open', modal)?.addEventListener('click', () => { close(); launchApp(app.id); });
      $('#info-install', modal)?.addEventListener('click', () => { close(); installApp(app.id); });
    },
  });
}

function openAbout() {
  Modal.open({
    title: `About ${BRAND.name}`,
    size: 'sm',
    body: `
      <div class="about">
        <img src="assets/logo.svg" alt="">
        <h3>${esc(BRAND.name)}</h3>
        <p class="muted">Version ${esc(Platform.version)} · ${buildLabel()}</p>
        <p class="muted" style="max-width:34ch">Your own creative suite, built with plain HTML, CSS and JavaScript.</p>
        <div class="about-apps">${APPS.map((a) => appTile(a, 32)).join('')}</div>
      </div>`,
    footer: '<button class="btn btn-primary" data-close>Close</button>',
  });
}

function openShortcuts() {
  const keys = (combo) => combo.split(' ').map((k) => `<kbd>${esc(k)}</kbd>`).join('');
  Modal.open({
    title: 'Keyboard shortcuts',
    size: 'sm',
    body: `<table class="shortcut-table"><tbody>
      ${SHORTCUTS.map(([label, ...combos]) => `
        <tr><td>${esc(label)}</td><td>${combos.map(keys).join('<span class="or">or</span>')}</td></tr>`).join('')}
    </tbody></table>`,
    footer: '<button class="btn btn-primary" data-close>Done</button>',
  });
}

function openTutorial(id) {
  Modal.closeAll();
  const index = TUTORIALS.findIndex((t) => t.id === id);
  const t = TUTORIALS[index];
  const next = TUTORIALS[index + 1];
  Modal.open({
    title: t.title,
    size: 'md',
    body: `
      <div class="tut-modal-art"><span class="tut-art" style="--c1:${t.colors[0]};--c2:${t.colors[1]}">${icon(t.icon, 40)}</span></div>
      <p class="tut-meta" style="margin-bottom:14px">${icon('clock', 14)} ${t.minutes} min · ${esc(t.level)} · ${esc(t.topic)}</p>
      <ol class="steps">${t.steps.map((s) => `<li><span>${esc(s)}</span></li>`).join('')}</ol>`,
    footer: next
      ? `<button class="btn btn-ghost" data-close>Done</button><button class="btn btn-primary" data-action="tutorial" data-id="${next.id}">Next: ${esc(next.title)}</button>`
      : '<button class="btn btn-primary" data-close>Done</button>',
  });
}

// ---------- Preferences ----------
const PREF_TABS = [
  { id: 'general', label: 'General', icon: 'sliders' },
  { id: 'appearance', label: 'Appearance', icon: 'sun' },
  { id: 'account', label: 'Account', icon: 'user' },
  { id: 'about', label: 'About', icon: 'info' },
];

function prefSwitch(key, checked) {
  return `<label class="switch"><input type="checkbox" data-pref-toggle="${key}" ${checked ? 'checked' : ''}><span></span></label>`;
}

function prefSegmented(key, value, options) {
  return `<div class="segmented" role="group">${options.map(([v, label, ic]) => `
    <button type="button" data-pref="${key}" data-value="${v}" aria-pressed="${value === v}">${ic ? icon(ic, 15) : ''}${label}</button>`).join('')}</div>`;
}

function renderPrefPanel(tab) {
  const s = Store.get('settings');
  if (tab === 'general') {
    return `
      <div class="pref-row">
        <div class="pref-text"><div class="pref-title">Open on start</div><div class="pref-desc">The page ${esc(BRAND.name)} shows when it launches.</div></div>
        <select class="select" data-pref-select="startView">
          ${NAV.map((n) => `<option value="${n.view}" ${s.startView === n.view ? 'selected' : ''}>${n.label}</option>`).join('')}
        </select>
      </div>
      <div class="pref-row">
        <div class="pref-text"><div class="pref-title">Show planned apps</div><div class="pref-desc">List apps that are on the roadmap but not built yet.</div></div>
        ${prefSwitch('showPlanned', s.showPlanned)}
      </div>
      <div class="pref-row">
        <div class="pref-text"><div class="pref-title">Recent files</div><div class="pref-desc">${Store.get('recents').length} files · ${formatBytes(Store.usageBytes())} of previews stored.</div></div>
        <button class="btn btn-secondary btn-sm" id="pref-clear" ${Store.get('recents').length ? '' : 'disabled'}>Clear</button>
      </div>`;
  }
  if (tab === 'appearance') {
    return `
      <div class="pref-block">
        <div class="pref-title">Theme</div>
        ${prefSegmented('theme', s.theme, [['dark', 'Dark', 'moon'], ['light', 'Light', 'sun'], ['system', 'System', '']])}
      </div>
      <div class="pref-block">
        <div class="pref-title">Accent color</div>
        <div class="swatches">
          ${Object.entries(ACCENTS).map(([id, a]) => `
            <button type="button" class="swatch" style="--s1:${a.from};--s2:${a.to}" data-pref="accent" data-value="${id}"
              aria-pressed="${s.accent === id}" aria-label="${a.label}" title="${a.label}">${s.accent === id ? icon('check', 16) : ''}</button>`).join('')}
        </div>
      </div>
      <div class="pref-block">
        <div class="pref-title">Density</div>
        ${prefSegmented('density', s.density, [['comfortable', 'Comfortable'], ['compact', 'Compact']])}
      </div>
      <div class="pref-row">
        <div class="pref-text"><div class="pref-title">Reduce motion</div><div class="pref-desc">Turn off animations and transitions.</div></div>
        ${prefSwitch('reduceMotion', s.reduceMotion)}
      </div>`;
  }
  if (tab === 'account') {
    const user = Account.user;
    const title = user ? esc(user.email) : 'Local profile';
    const desc = user ? `Signed in${Account.storage ? ` · ${esc(Account.storage.planName)} plan, ${formatBytes(Account.storage.used)} of ${formatBytes(Account.storage.cap)} used` : ''}`
      : Account.configured ? 'Sign in to download apps, use cloud storage and share projects.' : 'Stored only on this computer. No sign-in needed.';
    const button = !Account.configured ? ''
      : user ? '<button class="btn btn-secondary btn-sm" data-action="sign-out">Sign out</button>'
      : '<button class="btn btn-primary btn-sm" data-action="sign-in">Sign in</button>';
    return `
      <div class="pref-row">
        <span class="avatar avatar-lg" id="pref-avatar">${s.name.trim() ? esc(initials(s.name)) : icon('user', 20)}</span>
        <div class="pref-text"><div class="pref-title">${title}</div><div class="pref-desc">${desc}</div></div>
        ${button}
      </div>
      <label class="field"><span>Display name</span>
        <input class="input" id="pref-name" value="${esc(s.name)}" placeholder="What should we call you?" maxlength="40" autocomplete="off">
      </label>
      <p class="hint-text">Used for the greeting on Home and your avatar initials.</p>`;
  }
  return `
    <div class="about">
      <img src="assets/logo.svg" alt="">
      <h3>${esc(BRAND.name)}</h3>
      <p class="muted">Version ${esc(Platform.version)} · ${buildLabel()}</p>
      <div class="about-apps">${APPS.map((a) => appTile(a, 32)).join('')}</div>
    </div>`;
}

function openPreferences(startTab = 'general') {
  Modal.closeAll();
  Modal.open({
    title: 'Preferences',
    size: 'lg',
    flush: true,
    body: `
      <div class="prefs">
        <div class="prefs-tabs" role="tablist" aria-orientation="vertical">
          ${PREF_TABS.map((t) => `<button class="prefs-tab" role="tab" data-tab="${t.id}" aria-selected="false">${icon(t.icon, 16)} ${t.label}</button>`).join('')}
        </div>
        <div class="prefs-panel" role="tabpanel" id="prefs-panel"></div>
      </div>`,
    onMount(modal) {
      const panel = $('#prefs-panel', modal);
      let tab = startTab;

      const show = (id) => {
        tab = id;
        modal.querySelectorAll('.prefs-tab').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === id)));
        panel.innerHTML = renderPrefPanel(id);
        $('#pref-clear', panel)?.addEventListener('click', confirmClearRecents);
        $('#pref-name', panel)?.addEventListener('input', (e) => {
          Store.setSetting('name', e.target.value);
          syncNameToAccount(e.target.value);
          const name = e.target.value.trim();
          $('#pref-avatar', panel).innerHTML = name ? esc(initials(name)) : icon('user', 20);
        });
      };

      modal.querySelectorAll('.prefs-tab').forEach((b) => b.addEventListener('click', () => show(b.dataset.tab)));

      panel.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-pref]');
        if (!btn) return;
        Store.setSetting(btn.dataset.pref, btn.dataset.value);
        show(tab);
        panel.querySelector(`[data-pref="${btn.dataset.pref}"][data-value="${btn.dataset.value}"]`)?.focus();
      });
      panel.addEventListener('change', (e) => {
        const { prefToggle, prefSelect } = e.target.dataset;
        if (prefToggle) Store.setSetting(prefToggle, e.target.checked);
        if (prefSelect) Store.setSetting(prefSelect, e.target.value);
      });

      show(startTab);
      $(`.prefs-tab[data-tab="${startTab}"]`, modal).focus();
    },
  });
}

// ---------- Search ----------
const Search = (() => {
  let results = [];
  let selected = 0;
  const input = () => $('#search-input');
  const box = () => $('#search-results');

  function commands() {
    return [
      { group: 'Actions', label: 'New file', icon: 'filePlus', hint: 'N', run: () => openNewDoc() },
      { group: 'Actions', label: 'Open file', icon: 'upload', hint: 'Ctrl O', run: () => pickFiles() },
      ...PRESETS.filter((p) => p.id !== 'custom').map((p) => ({
        group: 'Actions', label: `New ${p.name}`, icon: 'filePlus', hint: `${p.width} × ${p.height}`, run: () => openNewDoc(p.id),
      })),
      ...QUICK_ACTIONS.map((q) => ({ group: 'Actions', label: q.name, icon: q.icon, hint: 'Quick action', run: () => runQuickAction(q.id) })),
      ...NAV.map((n) => ({ group: 'Go to', label: n.label, icon: n.icon, keywords: 'page go open', run: () => go(n.view) })),
      { group: 'Settings', label: 'Preferences', icon: 'sliders', hint: 'Ctrl ,', keywords: 'settings options', run: () => openPreferences() },
      { group: 'Settings', label: isDark() ? 'Switch to light theme' : 'Switch to dark theme', icon: isDark() ? 'sun' : 'moon', keywords: 'theme mode appearance', run: toggleTheme },
      { group: 'Settings', label: 'Accent color', icon: 'sparkles', keywords: 'theme color appearance', run: () => openPreferences('appearance') },
      { group: 'Settings', label: 'Edit profile', icon: 'user', keywords: 'name account avatar', run: () => openPreferences('account') },
      { group: 'Settings', label: 'Keyboard shortcuts', icon: 'keyboard', hint: '?', keywords: 'keys hotkeys', run: openShortcuts },
    ];
  }

  function index() {
    return [
      ...visibleApps().map((a) => ({
        group: 'Apps', label: a.name, app: a, hint: isInstalled(a) ? a.tagline : 'Planned',
        keywords: a.categories.join(' '), run: () => (isInstalled(a) ? launchApp(a.id) : openAppInfo(a.id)),
      })),
      ...commands(),
      ...Store.get('recents').map((f) => ({
        group: 'Files', label: f.name, thumb: f.thumb, hint: `${f.width} × ${f.height}`, run: () => openRecent(f.id),
      })),
      ...TUTORIALS.map((t) => ({ group: 'Learn', label: t.title, icon: t.icon, hint: `${t.minutes} min`, keywords: t.topic, run: () => openTutorial(t.id) })),
    ];
  }

  function query(q) {
    const terms = q.toLowerCase().trim().split(/\s+/).filter(Boolean);
    if (!terms.length) {
      return [
        ...visibleApps().filter(isInstalled).map((a) => ({ group: 'Suggested', label: a.name, app: a, hint: a.tagline, run: () => launchApp(a.id) })),
        ...commands().slice(0, 2).map((c) => ({ ...c, group: 'Suggested' })),
        { group: 'Suggested', label: 'Preferences', icon: 'sliders', hint: 'Ctrl ,', run: () => openPreferences() },
      ];
    }
    const scored = index().map((item) => {
      const label = item.label.toLowerCase();
      const hay = `${label} ${(item.hint || '').toLowerCase()} ${item.keywords || ''}`;
      if (!terms.every((t) => hay.includes(t))) return null;
      const score = label.startsWith(terms[0]) ? 0 : label.includes(` ${terms[0]}`) ? 1 : label.includes(terms[0]) ? 2 : 3;
      return { ...item, score };
    }).filter(Boolean);

    const groups = ['Apps', 'Actions', 'Go to', 'Files', 'Learn', 'Settings'];
    return groups.flatMap((g) => scored.filter((r) => r.group === g).sort((a, b) => a.score - b.score).slice(0, 5));
  }

  function highlight(label, q) {
    const term = q.trim().split(/\s+/)[0];
    if (!term) return esc(label);
    const i = label.toLowerCase().indexOf(term.toLowerCase());
    if (i === -1) return esc(label);
    return `${esc(label.slice(0, i))}<mark>${esc(label.slice(i, i + term.length))}</mark>${esc(label.slice(i + term.length))}`;
  }

  function draw() {
    const q = input().value;
    results = query(q);
    selected = Math.min(selected, Math.max(0, results.length - 1));
    if (!results.length) {
      box().innerHTML = `<div class="search-empty">No results for “${esc(q)}”</div>`;
    } else {
      let lastGroup = '';
      box().innerHTML = results.map((r, i) => {
        const head = r.group !== lastGroup ? `<div class="search-group">${esc(r.group)}</div>` : '';
        lastGroup = r.group;
        const visual = r.app ? appTile(r.app, 30) : r.thumb ? `<img class="si-thumb" src="${r.thumb}" alt="">` : `<span class="si-icon">${icon(r.icon, 16)}</span>`;
        return `${head}<div class="search-item" role="option" id="sr-${i}" data-index="${i}" aria-selected="${i === selected}">
          ${visual}<span class="si-label">${highlight(r.label, q)}</span>${r.hint ? `<span class="si-hint">${esc(r.hint)}</span>` : ''}</div>`;
      }).join('');
    }
    box().hidden = false;
    input().setAttribute('aria-expanded', 'true');
    input().setAttribute('aria-activedescendant', results.length ? `sr-${selected}` : '');
  }

  function select(i) {
    selected = (i + results.length) % results.length;
    box().querySelectorAll('.search-item').forEach((el) => el.setAttribute('aria-selected', String(+el.dataset.index === selected)));
    box().querySelector(`#sr-${selected}`)?.scrollIntoView({ block: 'nearest' });
    input().setAttribute('aria-activedescendant', `sr-${selected}`);
  }

  function close() {
    box().hidden = true;
    input().setAttribute('aria-expanded', 'false');
  }

  function run(i) {
    const item = results[i];
    if (!item) return;
    input().value = '';
    close();
    input().blur();
    item.run();
  }

  function init() {
    const el = input();
    el.addEventListener('focus', () => { selected = 0; draw(); });
    el.addEventListener('input', () => { selected = 0; draw(); });
    el.addEventListener('blur', () => setTimeout(close, 120));
    el.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); select(selected + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); select(selected - 1); }
      else if (e.key === 'Enter') { e.preventDefault(); run(selected); }
      else if (e.key === 'Escape') { e.stopPropagation(); el.value = ''; close(); el.blur(); }
    });
    // pointerdown fires before blur, so the click still lands on the item.
    box().addEventListener('pointerdown', (e) => {
      const item = e.target.closest('.search-item');
      if (!item) return;
      e.preventDefault();
      run(+item.dataset.index);
    });
  }

  return { init, focus: () => input().focus() };
})();

// ---------- Global event wiring ----------
const Actions = {
  'main-menu': openMainMenu,
  'help-menu': openHelpMenu,
  'account-menu': openAccountMenu,
  notifications: openNotifications,
  'read-all': () => { markRead(SEED_NOTIFICATIONS.map((n) => n.id)); Menu.close(); },
  'read-notification': (el) => { markRead([el.dataset.id]); el.classList.remove('unread'); },
  'new-doc': (el) => openNewDoc(el.dataset.preset),
  'open-file': () => pickFiles(),
  'open-app': (el) => launchApp(el.dataset.id),
  'app-menu': openAppMenu,
  'app-info': (el) => openAppInfo(el.dataset.id),
  'quick-action': (el) => runQuickAction(el.dataset.id),
  'open-recent': (el) => openRecent(el.dataset.id),
  'file-menu': openFileMenu,
  'file-view': (el) => Store.set('fileView', el.dataset.view),
  'clear-recents': confirmClearRecents,
  tutorial: (el) => openTutorial(el.dataset.id),
  prefs: (el) => openPreferences(el.dataset.tab),
  shortcuts: openShortcuts,
  'install-app': (el) => installApp(el.dataset.id),
  'update-all': updateAll,
  'refresh-catalog': () => Platform.refreshCatalog(true),
  'check-updates': () => { Platform.checkShellUpdate(); Platform.refreshCatalog(true); },
  'restart-update': () => Platform.installShellUpdate(),
  'sign-in': () => { Modal.closeAll(); openSignIn(); },
  'sign-out': () => { Modal.closeAll(); signOut(); },
  plans: openPlans,
};

const Changes = {
  'file-sort': (el) => Store.set('fileSort', el.value),
};

function setupEvents() {
  document.addEventListener('click', (e) => {
    const link = e.target.closest('a[href^="#"]');
    if (link) {
      e.preventDefault();
      Menu.close();
      go(link.getAttribute('href').slice(1));
      return;
    }
    const el = e.target.closest('[data-action]');
    if (!el || el.disabled) return;
    const fn = Actions[el.dataset.action];
    if (fn) {
      e.preventDefault();
      fn(el, e);
    }
  });

  document.addEventListener('change', (e) => {
    const el = e.target.closest('[data-change]');
    if (el) Changes[el.dataset.change]?.(el);
  });

  $('#file-input').addEventListener('change', (e) => {
    const action = pendingQuickAction;
    pendingQuickAction = null;
    if (e.target.files.length) handleFiles(e.target.files, action);
    e.target.value = '';
  });

  document.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();

    if (e.key === 'Escape') {
      if (Menu.isOpen()) Menu.close({ restoreFocus: true });
      else Modal.closeTop();
      return;
    }
    if (mod && key === 'k') { e.preventDefault(); Modal.closeAll(); Search.focus(); return; }
    if (mod && e.key === ',') { e.preventDefault(); openPreferences(); return; }
    if (mod && key === 'o') { e.preventDefault(); pickFiles(); return; }
    if (mod && key === 'q') { e.preventDefault(); quit(); return; }

    const typing = e.target.closest('input, textarea, select, [contenteditable="true"]');
    if (typing || mod || e.altKey || Modal.isOpen()) return;

    // preventDefault stops the key from being typed into the dialog it opens.
    const shortcut = {
      '/': () => Search.focus(),
      '?': openShortcuts,
      n: () => openNewDoc(),
      o: () => pickFiles(),
    }[key] || (NAV[+e.key - 1] && (() => go(NAV[+e.key - 1].view)));
    if (shortcut) {
      e.preventDefault();
      shortcut();
    }
  });

  window.addEventListener('hashchange', () => { Menu.close(); render(); });
  window.addEventListener('resize', () => Menu.close());
  darkQuery.addEventListener('change', applyAppearance);

  Store.on((key) => {
    if (key === 'settings') applyAppearance();
    if (key === 'readNotifications') renderBell();
    else render();
  });
}

// ---------- Boot ----------
function buildLabel() {
  if (Platform.channel === 'web') return 'Test build';
  return Platform.packaged ? 'Desktop app' : 'Desktop app (from the project folder)';
}

function renderBuildBadge() {
  const badge = $('#build-badge');
  const label = Platform.channel === 'web' ? 'Test build' : Platform.packaged ? '' : 'Dev';
  badge.textContent = label;
  badge.hidden = !label;
  badge.title = Platform.channel === 'web' ? 'Running from the project folder. Releases go out as the desktop app.' : '';
}

// Only the progress bar moves while downloading; anything else redraws the page.
function updateProgress(id) {
  const el = document.querySelector(`.app-progress[data-progress="${id}"]`);
  const p = Platform.progress(findApp(id));
  if (!el || !p) return false;
  const pct = Math.round(p.fraction * 100);
  el.querySelector('.app-progress-bar span').style.width = `${pct}%`;
  el.querySelector('.app-progress-bar').setAttribute('aria-valuenow', pct);
  el.querySelector('.app-progress-label').textContent = p.phase === 'extract' ? 'Installing…' : `Downloading ${pct}%`;
  return true;
}

async function init() {
  hydrateIcons();
  renderSidebar();
  applyAppearance();
  renderBell();
  setupEvents();
  setupDragAndDrop();
  Search.init();
  if (!location.hash) location.replace(`#${Store.setting('startView')}`);
  await Platform.init().catch((err) => console.warn('Desktop shell unavailable', err));
  renderBuildBadge();
  render();
  pruneFileStore();

  Platform.on((kind, id) => {
    if (kind === 'progress' && updateProgress(id)) return;
    render();
  });
  Account.on(() => {
    const profileName = Account.profile?.display_name || '';
    if (Account.signedIn && profileName && !Store.setting('name').trim()) Store.setSetting('name', profileName);
    render();
  });
  Account.init().catch((err) => console.warn('Accounts unavailable', err));
}

// Drop stored originals that are no longer in the recent list.
function pruneFileStore() {
  FileStore.keys().then((keys) => {
    const ids = new Set(Store.get('recents').map((f) => f.id));
    keys.filter((k) => !ids.has(k)).forEach((k) => FileStore.remove(k));
  }).catch(() => {});
}

init();
