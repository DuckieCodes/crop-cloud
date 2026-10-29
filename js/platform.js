// Where Crop Cloud is running.
//   desktop: the Windows app. Apps are downloaded one by one and it updates itself from GitHub.
//   web:     the test build, opened from the project folder. Every built app is already there.
const Platform = (() => {
  const native = window.cropcloud || null;
  const listeners = new Set();
  let info = { version: BRAND.version, localApps: !native };
  let installed = {};      // id -> { version }
  let catalog = null;      // latest release's apps-manifest.json
  let catalogError = '';
  let shell = { status: native ? 'idle' : 'web' };
  const progress = {};     // id -> { phase, fraction } while installing
  const errors = {};       // id -> last install error

  // kind is 'progress' while a download moves along, 'state' for everything else.
  const emit = (kind = 'state', id = null) => listeners.forEach((fn) => fn(kind, id));
  const built = (app) => app.status === 'available' && !!app.entry;

  async function refreshInstalled() {
    const res = await native.apps.installed();
    info.localApps = res.local;
    installed = res.apps;
  }

  async function refreshCatalog(refresh = false) {
    if (!native || info.localApps) return;
    try {
      catalog = await native.apps.catalog({ refresh });
      catalogError = '';
    } catch (err) {
      catalogError = cleanError(err);
    }
    emit();
  }

  // Errors from the main process arrive as "Error invoking remote method 'x': Error: message".
  const cleanError = (err) => String(err?.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

  return {
    get channel() { return native ? 'desktop' : 'web'; },
    get isDesktop() { return !!native; },
    // In the desktop app run from the repo (npm start), apps come from apps/ like the test build.
    get managesApps() { return !!native && !info.localApps; },
    get version() { return info.version; },
    get catalogError() { return catalogError; },
    get catalogLoaded() { return !!catalog; },
    get shell() { return shell; },
    get packaged() { return !!info.packaged; },

    async init() {
      if (!native) return;
      info = { ...info, ...(await native.info()) };
      await refreshInstalled();
      shell = await native.updates.state();
      native.updates.on((s) => { shell = s; emit(); });
      native.apps.onProgress(({ id, phase, done, total }) => {
        if (phase === 'done') return;
        progress[id] = { phase, fraction: total ? done / total : 0 };
        emit('progress', id);
      });
      refreshCatalog();
    },

    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    refreshCatalog,

    isBuilt: built,
    isInstalled(app) {
      if (!built(app)) return false;
      return this.managesApps ? !!installed[app.id] : true;
    },
    installedVersion(app) {
      return this.managesApps ? installed[app.id]?.version : app.version;
    },
    release(app) {
      return catalog?.apps.find((a) => a.id === app.id) || null;
    },
    hasUpdate(app) {
      const r = this.release(app);
      return !!(r && this.isInstalled(app) && compareVersions(r.version, this.installedVersion(app)) > 0);
    },
    progress: (app) => progress[app.id] || null,
    error: (app) => errors[app.id] || '',

    async install(app) {
      delete errors[app.id];
      progress[app.id] = { phase: 'download', fraction: 0 };
      emit();
      try {
        installed[app.id] = await native.apps.install(app.id);
      } catch (err) {
        errors[app.id] = cleanError(err);
        throw new Error(errors[app.id]);
      } finally {
        delete progress[app.id];
        emit();
      }
    },

    async uninstall(app) {
      await native.apps.uninstall(app.id);
      delete installed[app.id];
      emit();
    },

    checkShellUpdate: () => native?.updates.check(),
    installShellUpdate: () => native?.updates.install(),
    openExternal(url) {
      if (native) native.openExternal(url);
      else window.open(url, '_blank', 'noopener');
    },
  };
})();

function compareVersions(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return Math.sign(d);
  }
  return 0;
}
