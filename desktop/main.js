// Crop Cloud desktop shell. Serves the hub from app://cropcloud/ and each
// downloaded app from its own folder, so the pages' relative links
// (../../js/kit/ui.js, ../../index.html) work the same as in the test build.

const { app, BrowserWindow, protocol, net, ipcMain, shell, Menu, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const Apps = require('./lib/apps');
const Updates = require('./lib/updates');

const ORIGIN = 'app://cropcloud';
const arg = (name) => process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));

// Packaged: the hub is copied into resources/web by scripts/stage.js.
// From the repo (npm start): serve the project folder itself, and use the
// repo's apps unless --downloads asks to try the real download path.
const WEB_ROOT = app.isPackaged ? path.join(process.resourcesPath, 'web') : path.join(__dirname, '..');
const LOCAL_APPS = !app.isPackaged && !arg('downloads');
const SERVED = new Set(['index.html', 'css', 'js', 'assets', 'apps']);

Apps.configure({ localApps: LOCAL_APPS, webRoot: WEB_ROOT, manifestUrl: arg('manifest')?.split('=').slice(1).join('=') });

protocol.registerSchemesAsPrivileged([{
  scheme: 'app',
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true },
}]);

if (!app.requestSingleInstanceLock()) app.quit();

// Resolve a URL path to a file, refusing anything outside its root.
function inside(root, rel) {
  const file = path.resolve(root, rel);
  return file === root || file.startsWith(root + path.sep) ? file : null;
}

function resolveFile(pathname) {
  const rel = decodeURIComponent(pathname).replace(/^\/+/, '') || 'index.html';
  const parts = rel.split('/');
  if (!SERVED.has(parts[0])) return null;
  if (parts[0] === 'apps' && !LOCAL_APPS) {
    const dir = Apps.dir(parts[1]);
    return dir ? inside(dir, parts.slice(2).join('/') || 'index.html') : null;
  }
  return inside(WEB_ROOT, rel);
}

function serve(request) {
  const url = new URL(request.url);
  const file = url.host === 'cropcloud' ? resolveFile(url.pathname) : null;
  if (!file || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } });
  }
  return net.fetch(pathToFileURL(file).toString(), { headers: request.headers });
}

// ---------- Window ----------
const STATE_FILE = () => path.join(app.getPath('userData'), 'window.json');
let win = null;

function loadWindowState() {
  try {
    return { width: 1440, height: 880, ...JSON.parse(fs.readFileSync(STATE_FILE(), 'utf8')) };
  } catch {
    return { width: 1440, height: 880 };
  }
}

function saveWindowState() {
  if (!win || win.isDestroyed()) return;
  const b = win.getNormalBounds();
  try {
    fs.writeFileSync(STATE_FILE(), JSON.stringify({ ...b, maximized: win.isMaximized() }));
  } catch {}
}

function createWindow() {
  const s = loadWindowState();
  win = new BrowserWindow({
    x: s.x, y: s.y, width: s.width, height: s.height,
    minWidth: 960, minHeight: 600,
    title: 'Crop Cloud',
    backgroundColor: '#121212',
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'build', 'icon.png'),
    show: !arg('hidden'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  if (s.maximized) win.maximize();

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(`${ORIGIN}/`)) e.preventDefault();
  });
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i'))) {
      win.webContents.toggleDevTools();
      e.preventDefault();
    }
  });
  win.on('close', saveWindowState);
  win.on('closed', () => { win = null; });
  win.loadURL(`${ORIGIN}/index.html`);
}

// ---------- IPC ----------
// Only pages served from app://cropcloud may call into the shell.
function handle(channel, fn) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!event.senderFrame?.url.startsWith(`${ORIGIN}/`)) throw new Error('Not allowed');
    return fn(event, ...args);
  });
}

function send(channel, data) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, data);
}

handle('info', () => ({ version: app.getVersion(), platform: process.platform, packaged: app.isPackaged, localApps: LOCAL_APPS }));
handle('apps:installed', () => Apps.installed());
handle('apps:catalog', (_e, opts) => Apps.catalog(opts));
handle('apps:install', (_e, id) => Apps.install(String(id), (p) => send('apps:progress', p)));
handle('apps:uninstall', (_e, id) => Apps.uninstall(String(id)));
handle('updates:state', () => Updates.state());
handle('updates:check', () => Updates.check());
handle('updates:install', () => Updates.install());
handle('open-external', (_e, url) => {
  if (typeof url === 'string' && /^https:\/\//.test(url)) shell.openExternal(url);
});

// ---------- Startup ----------
app.on('second-instance', () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  protocol.handle('app', serve);
  // Clipboard access for pasting images; everything else is refused.
  const allowed = new Set(['clipboard-read', 'clipboard-sanitized-write', 'fullscreen']);
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(allowed.has(permission)));
  createWindow();
  Updates.init((s) => send('updates:state', s));
});

app.on('window-all-closed', () => app.quit());
