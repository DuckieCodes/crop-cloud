// Page renderers. Each returns an HTML string; clicks are handled in hub.js via data-action.

const NAV = [
  { view: 'home', label: 'Home', icon: 'home' },
  { view: 'apps', label: 'Apps', icon: 'apps' },
  { view: 'files', label: 'Files', icon: 'folder' },
  { view: 'actions', label: 'Quick actions', icon: 'zap' },
  { view: 'learn', label: 'Learn', icon: 'book' },
];

const isInstalled = (app) => Platform.isInstalled(app);
// Built but not downloaded yet (desktop app only).
const isInstallable = (app) => Platform.isBuilt(app) && !Platform.isInstalled(app);
const visibleApps = () => APPS.filter((a) => Platform.isBuilt(a) || Store.setting('showPlanned'));
const appsWithUpdates = () => APPS.filter((a) => Platform.hasUpdate(a));
const topicSlug = (topic) => topic.toLowerCase().replace(/\s+/g, '-');

// ---------- Shared pieces ----------
function progressBar(app) {
  const p = Platform.progress(app);
  const pct = Math.round((p?.fraction || 0) * 100);
  const label = p?.phase === 'extract' ? 'Installing…' : `Downloading ${pct}%`;
  return `
    <span class="app-progress" data-progress="${app.id}">
      <span class="app-progress-bar" role="progressbar" aria-label="${esc(app.name)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><span style="width:${pct}%"></span></span>
      <span class="app-progress-label">${label}</span>
    </span>`;
}

// Open, Update or Install, whichever fits the app right now.
function appButton(app, { small = true } = {}) {
  const sm = small ? ' btn-sm' : '';
  if (Platform.progress(app)) return progressBar(app);
  if (isInstallable(app)) return `<button class="btn btn-primary${sm}" data-action="install-app" data-id="${app.id}">${icon('download', 16)} Install</button>`;
  if (Platform.hasUpdate(app)) {
    return `<button class="btn btn-secondary${sm}" data-action="install-app" data-id="${app.id}">${icon('download', 16)} Update</button>
      <button class="btn btn-primary${sm}" data-action="open-app" data-id="${app.id}">Open</button>`;
  }
  return `<button class="btn btn-primary${sm}" data-action="open-app" data-id="${app.id}">Open</button>`;
}

function appRow(app) {
  const release = Platform.release(app);
  const error = Platform.error(app);
  const meta = isInstalled(app)
    ? `Version ${esc(Platform.installedVersion(app))}${Platform.hasUpdate(app) ? ` · ${esc(release.version)} available` : ''}`
    : release ? `${esc(release.version)} · ${formatBytes(release.size)}` : '';
  return `
    <div class="app-row">
      ${appTile(app, 44)}
      <div class="app-row-text">
        <div class="app-row-name">${esc(app.name)}</div>
        <div class="muted">${esc(app.tagline)}</div>
        ${error ? `<div class="app-row-error">${icon('alert', 14)} ${esc(error)}</div>` : ''}
      </div>
      <span class="app-row-version muted">${meta}</span>
      ${appButton(app)}
      ${isInstalled(app) ? `<button class="icon-btn" data-action="app-menu" data-id="${app.id}" aria-label="More options for ${esc(app.name)}" aria-haspopup="menu">${icon('more')}</button>` : ''}
    </div>`;
}

function shellUpdateRow() {
  const s = Platform.shell;
  const brandTile = `<span class="app-tile" style="--size:44px;--c1:var(--accent-from);--c2:var(--accent-to)" aria-hidden="true"><img src="assets/logo.svg" alt="" width="26" height="26"></span>`;
  const text = {
    web: 'This is the test build. It runs straight from the project folder, so it’s always the latest code.',
    dev: 'Running from the project folder (npm start). Installed copies update from GitHub.',
    idle: 'Updates download in the background and install when you restart.',
    checking: 'Checking for updates…',
    current: `You have the latest version, ${esc(Platform.version)}.`,
    downloading: `Downloading version ${esc(s.version || '')}… ${s.percent || 0}%`,
    ready: `Version ${esc(s.version || '')} is ready. Restart to finish updating.`,
    error: `Couldn’t check for updates: ${esc(s.message || 'unknown error')}`,
  }[s.status] || '';
  const button = s.status === 'ready'
    ? '<button class="btn btn-primary btn-sm" data-action="restart-update">Restart to update</button>'
    : ['current', 'error'].includes(s.status)
      ? `<button class="btn btn-secondary btn-sm" data-action="check-updates">${icon('refresh', 16)} Check again</button>`
      : '';
  return `
    <div class="app-row">
      ${brandTile}
      <div class="app-row-text">
        <div class="app-row-name">${esc(BRAND.name)}</div>
        <div class="muted">${text}</div>
      </div>
      <span class="app-row-version muted">Version ${esc(Platform.version)}</span>
      ${button}
    </div>`;
}

function presetCard(p) {
  const max = 54;
  const ratio = p.width / p.height;
  const w = ratio >= 1 ? max : Math.round(max * ratio);
  const h = ratio >= 1 ? Math.round(max / ratio) : max;
  const custom = p.id === 'custom';
  return `
    <button class="preset${custom ? ' preset-custom' : ''}" data-action="new-doc" data-preset="${p.id}">
      <span class="preset-thumb"><span class="preset-shape" style="width:${w}px;height:${h}px">${custom ? icon('plus', 20) : ''}</span></span>
      <span class="preset-name">${esc(p.name)}</span>
      <span class="preset-meta">${custom ? 'Any size' : `${p.width} × ${p.height}`}</span>
    </button>`;
}

function fileCard(f) {
  return `
    <div class="file-card">
      <button class="file-thumb" data-action="open-recent" data-id="${esc(f.id)}" aria-label="Open ${esc(f.name)}">
        <img src="${f.thumb}" alt="" loading="lazy">
      </button>
      <div class="file-info">
        <div class="file-text">
          <div class="file-name" title="${esc(f.name)}">${esc(f.name)}</div>
          <div class="file-meta" title="Opened ${timeAgo(f.openedAt)}">${fileExt(f.name)} · ${f.width} × ${f.height}</div>
        </div>
        <button class="icon-btn icon-btn-sm" data-action="file-menu" data-id="${esc(f.id)}" aria-label="More options for ${esc(f.name)}">${icon('more', 16)}</button>
      </div>
    </div>`;
}

function tutorialCard(t) {
  return `
    <button class="tut-card" data-action="tutorial" data-id="${t.id}">
      <span class="tut-art" style="--c1:${t.colors[0]};--c2:${t.colors[1]}">${icon(t.icon, 36)}</span>
      <span class="tut-body">
        <span class="tut-topic">${esc(t.topic)}</span>
        <span class="tut-title">${esc(t.title)}</span>
        <span class="tut-meta">${icon('clock', 14)} ${t.minutes} min · ${esc(t.level)}</span>
      </span>
    </button>`;
}

function emptyState({ iconName, title, text, button = '' }) {
  return `
    <div class="empty">
      <span class="empty-icon">${icon(iconName, 26)}</span>
      <h3>${title}</h3>
      <p class="muted">${text}</p>
      ${button}
    </div>`;
}

const heroArt = `
  <svg viewBox="0 0 320 210" aria-hidden="true">
    <defs>
      <linearGradient id="hero-sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#ffb36b"/><stop offset=".6" stop-color="#ff5f8f"/><stop offset="1" stop-color="#8a4dff"/>
      </linearGradient>
      <clipPath id="hero-clip"><rect x="30" y="20" width="260" height="170" rx="12"/></clipPath>
    </defs>
    <g transform="rotate(-3 160 105)">
      <g clip-path="url(#hero-clip)">
        <rect x="30" y="20" width="260" height="170" fill="url(#hero-sky)"/>
        <circle cx="205" cy="78" r="24" fill="#fff4cf" opacity=".95"/>
        <path d="M30 150 105 82l46 44 44-36 95 74v26H30z" fill="#3a2780"/>
        <path d="M30 170l90-46 70 30 50-20 50 22v34H30z" fill="#22164f"/>
      </g>
      <g fill="none" stroke="#fff">
        <rect x="64" y="40" width="190" height="130" stroke-opacity=".9" stroke-width="1.5"/>
        <path d="M127.3 40v130M190.6 40v130M64 83.3h190M64 126.6h190" stroke-opacity=".35"/>
        <path d="M64 56V40h16M238 40h16v16M254 154v16h-16M80 170H64v-16" stroke-width="5" stroke-linecap="round"/>
      </g>
    </g>
  </svg>`;

// ---------- Views ----------
const Views = {
  home() {
    const name = Store.setting('name').trim();
    const installed = APPS.filter(isInstalled);
    const installable = APPS.filter(isInstallable);
    const planned = APPS.filter((a) => !Platform.isBuilt(a));
    const recents = Store.get('recents').slice(0, 5);

    return `
      <section class="hero">
        <div>
          <p class="eyebrow">${greeting()}${name ? `, ${esc(name)}` : ''}</p>
          <h1>What do you want to create today?</h1>
          <div class="hero-actions">
            <button class="btn btn-primary" data-action="new-doc">${icon('plus')} New file</button>
            <button class="btn btn-secondary" data-action="open-file">${icon('upload')} Open file</button>
          </div>
        </div>
        <div class="hero-art">${heroArt}</div>
      </section>

      <section class="section">
        <div class="section-head"><h2>Start something new</h2></div>
        <div class="preset-row">${PRESETS.map(presetCard).join('')}</div>
      </section>

      <section class="section">
        <div class="section-head"><h2>Quick actions</h2><a class="link" href="#actions">See all ${icon('arrowRight', 14)}</a></div>
        <div class="qa-row">
          ${QUICK_ACTIONS.map((q) => `
            <button class="qa-chip" data-action="quick-action" data-id="${q.id}">
              <span class="qa-icon">${icon(q.icon, 18)}</span>${esc(q.name)}
            </button>`).join('')}
        </div>
      </section>

      <section class="section">
        <div class="section-head"><h2>Your apps</h2><a class="link" href="#apps">Browse all apps ${icon('arrowRight', 14)}</a></div>
        <div class="app-strip">
          ${[...installed, ...installable].map((a) => `
            <div class="app-strip-item">
              ${appTile(a, 46)}
              <div class="app-strip-text"><div class="name">${esc(a.name)}</div><div class="muted">${esc(a.tagline)}</div></div>
              ${appButton(a)}
            </div>`).join('')}
          ${Store.setting('showPlanned') && planned.length ? `
            <a class="app-strip-more" href="#apps">
              <span class="stack">${planned.slice(0, 3).map((a) => appTile(a, 30)).join('')}</span>
              <span>${planned.length} more apps on the roadmap</span>
            </a>` : ''}
        </div>
      </section>

      <section class="section">
        <div class="section-head"><h2>Recent</h2>${recents.length ? `<a class="link" href="#files">View all ${icon('arrowRight', 14)}</a>` : ''}</div>
        ${recents.length
          ? `<div class="file-grid">${recents.map(fileCard).join('')}</div>`
          : `<div class="dropzone">
              <span class="empty-icon">${icon('image', 26)}</span>
              <h3>No recent files yet</h3>
              <p class="muted">Drop images anywhere in this window, or open one from your computer.</p>
              <button class="btn btn-secondary" data-action="open-file">${icon('upload')} Open file</button>
            </div>`}
      </section>

      <section class="section">
        <div class="section-head"><h2>Learn</h2><a class="link" href="#learn">All tutorials ${icon('arrowRight', 14)}</a></div>
        <div class="tut-grid">${TUTORIALS.slice(0, 3).map(tutorialCard).join('')}</div>
      </section>`;
  },

  apps(sub = 'all') {
    const apps = visibleApps();
    const category = CATEGORIES.find((c) => c.id === sub);
    const title = sub === 'installed' ? 'Installed' : category ? category.label : 'All apps';
    const list = sub === 'installed' ? apps.filter(isInstalled)
      : category ? apps.filter((a) => a.categories.includes(category.id))
      : apps;
    const installed = list.filter(isInstalled);
    const installable = sub === 'installed' ? [] : list.filter(isInstallable);
    const planned = list.filter((a) => !Platform.isBuilt(a));
    const updates = appsWithUpdates();
    const active = (id) => (sub === id ? ' active' : '');
    const catalogNote = Platform.managesApps && Platform.catalogError
      ? `<div class="notice">${icon('alert', 16)}<span>Couldn’t load the app list from GitHub: ${esc(Platform.catalogError)}</span>
           <button class="btn btn-ghost btn-sm" data-action="refresh-catalog">${icon('refresh', 16)} Try again</button></div>`
      : '';

    const main = sub === 'updates'
      ? `<div class="page-head"><h1>Updates</h1>
           ${updates.length > 1 ? `<div class="page-actions"><button class="btn btn-primary" data-action="update-all">${icon('download')} Update all</button></div>` : ''}</div>
         ${catalogNote}
         <div class="app-list">${shellUpdateRow()}${updates.map(appRow).join('')}</div>
         ${updates.length ? '' : `<p class="muted updates-foot">${APPS.filter(isInstalled).length
           ? `${APPS.filter(isInstalled).map((a) => `${esc(a.name)} ${esc(Platform.installedVersion(a))}`).join(', ')}: all up to date.`
           : 'No apps installed yet.'}</p>`}`
      : `<div class="page-head"><h1>${esc(title)}</h1></div>
         ${catalogNote}
         ${installed.length ? `
           <h2 class="list-title">Installed</h2>
           <div class="app-list">${installed.map(appRow).join('')}</div>` : ''}
         ${installable.length ? `
           <h2 class="list-title">Available to install</h2>
           <div class="app-list">${installable.map(appRow).join('')}</div>` : ''}
         ${planned.length ? `
           <h2 class="list-title">On the roadmap</h2>
           <div class="app-cards">
             ${planned.map((a) => `
               <article class="app-card">
                 <div class="app-card-top">${appTile(a, 42)}<span class="badge">Planned</span></div>
                 <h3>${esc(a.name)}</h3>
                 <p>${esc(a.description)}</p>
                 <div class="app-card-foot">
                   <span class="tag">${esc(CATEGORIES.find((c) => c.id === a.categories[0]).label)}</span>
                   <button class="btn btn-ghost btn-sm" data-action="app-info" data-id="${a.id}">Details</button>
                 </div>
               </article>`).join('')}
           </div>` : ''}
         ${!installed.length && !installable.length && !planned.length ? emptyState({
           iconName: 'apps', title: 'Nothing here yet',
           text: 'No apps in this category right now. Turn on “Show planned apps” in Preferences to see the roadmap.',
         }) : ''}`;

    return `
      <div class="split">
        <nav class="subnav" aria-label="App categories">
          <a class="subnav-item${active('all')}" href="#apps">${icon('apps', 16)} All apps <span class="count">${apps.length}</span></a>
          <a class="subnav-item${active('installed')}" href="#apps/installed">${icon('check', 16)} Installed <span class="count">${apps.filter(isInstalled).length}</span></a>
          <a class="subnav-item${active('updates')}" href="#apps/updates">${icon('download', 16)} Updates${updates.length ? ` <span class="count count-accent">${updates.length}</span>` : ''}</a>
          <p class="subnav-label">Categories</p>
          ${CATEGORIES.map((c) => `<a class="subnav-item${active(c.id)}" href="#apps/${c.id}">${esc(c.label)}</a>`).join('')}
          <p class="subnav-label">Resources</p>
          <a class="subnav-item" href="#learn">${icon('book', 16)} Tutorials</a>
          <button class="subnav-item" data-action="shortcuts">${icon('keyboard', 16)} Keyboard shortcuts</button>
        </nav>
        <div>${main}</div>
      </div>`;
  },

  files() {
    const view = Store.get('fileView');
    const sort = Store.get('fileSort');
    const files = [...Store.get('recents')];
    if (sort === 'name') files.sort((a, b) => a.name.localeCompare(b.name));
    if (sort === 'size') files.sort((a, b) => b.size - a.size);

    const body = !files.length
      ? `<div class="dropzone">
           <span class="empty-icon">${icon('upload', 26)}</span>
           <h3>Drop images here</h3>
           <p class="muted">PNG, JPG, WebP, GIF and SVG. Files stay on this computer.</p>
           <button class="btn btn-primary" data-action="open-file">${icon('upload')} Open file</button>
         </div>`
      : view === 'grid'
        ? `<div class="file-grid">${files.map(fileCard).join('')}</div>`
        : `<table class="file-table">
             <thead><tr><th>Name</th><th>Dimensions</th><th>Type</th><th>Size</th><th>Opened</th><th><span class="sr-only">Actions</span></th></tr></thead>
             <tbody>
               ${files.map((f) => `
                 <tr>
                   <td class="cell-name"><button data-action="open-recent" data-id="${esc(f.id)}">
                     <span class="file-mini"><img src="${f.thumb}" alt=""></span><span>${esc(f.name)}</span>
                   </button></td>
                   <td>${f.width} × ${f.height}</td>
                   <td>${fileExt(f.name)}</td>
                   <td>${formatBytes(f.size)}</td>
                   <td>${timeAgo(f.openedAt)}</td>
                   <td><button class="icon-btn icon-btn-sm" data-action="file-menu" data-id="${esc(f.id)}" aria-label="More options for ${esc(f.name)}">${icon('more', 16)}</button></td>
                 </tr>`).join('')}
             </tbody>
           </table>`;

    return `
      <div class="page-head">
        <div><h1>Your files</h1><p class="muted">Images you’ve opened recently.</p></div>
        <div class="page-actions">
          ${files.length ? `
            <label><span class="sr-only">Sort by</span>
              <select class="select" data-change="file-sort">
                <option value="recent" ${sort === 'recent' ? 'selected' : ''}>Last opened</option>
                <option value="name" ${sort === 'name' ? 'selected' : ''}>Name</option>
                <option value="size" ${sort === 'size' ? 'selected' : ''}>File size</option>
              </select>
            </label>
            <div class="segmented" role="group" aria-label="Layout">
              <button data-action="file-view" data-view="grid" aria-pressed="${view === 'grid'}" aria-label="Grid">${icon('grid', 16)}</button>
              <button data-action="file-view" data-view="list" aria-pressed="${view === 'list'}" aria-label="List">${icon('list', 16)}</button>
            </div>` : ''}
          <button class="btn btn-primary" data-action="open-file">${icon('upload')} Open file</button>
        </div>
      </div>
      ${body}
      ${files.length ? `<div class="files-foot"><button class="btn btn-ghost btn-sm" data-action="clear-recents">${icon('trash', 16)} Clear recent files</button></div>` : ''}`;
  },

  actions() {
    return `
      <div class="page-head">
        <div><h1>Quick actions</h1><p class="muted">Pick an action, choose an image, and PhotoCrop takes it from there.</p></div>
      </div>
      <div class="qa-grid">
        ${QUICK_ACTIONS.map((q) => `
          <button class="qa-card" data-action="quick-action" data-id="${q.id}">
            <span class="qa-icon">${icon(q.icon, 22)}</span>
            <h3>${esc(q.name)}</h3>
            <p>${esc(q.description)}</p>
            <span class="qa-go">Choose image ${icon('arrowRight', 14)}</span>
          </button>`).join('')}
      </div>`;
  },

  learn(sub) {
    const topics = [...new Set(TUTORIALS.map((t) => t.topic))];
    const topic = topics.find((t) => topicSlug(t) === sub);
    const list = topic ? TUTORIALS.filter((t) => t.topic === topic) : TUTORIALS;
    return `
      <div class="page-head">
        <div><h1>Learn</h1><p class="muted">Short, practical guides. Most take less than five minutes.</p></div>
      </div>
      <div class="chips">
        <a class="chip${topic ? '' : ' active'}" href="#learn">All</a>
        ${topics.map((t) => `<a class="chip${t === topic ? ' active' : ''}" href="#learn/${topicSlug(t)}">${esc(t)}</a>`).join('')}
      </div>
      <div class="tut-grid">${list.map(tutorialCard).join('')}</div>`;
  },
};
