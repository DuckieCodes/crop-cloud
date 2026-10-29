// Updates for the shell itself, from the GitHub release's latest.yml.
// New versions download in the background and install on restart.

const { app } = require('electron');

let current = { status: 'idle' };
let notify = () => {};
let updater = null;

function set(next) {
  current = next;
  notify(current);
}

function init(onChange) {
  notify = onChange;
  if (!app.isPackaged) {
    current = { status: 'dev' };
    return;
  }
  ({ autoUpdater: updater } = require('electron-updater'));
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  updater.on('checking-for-update', () => set({ status: 'checking' }));
  updater.on('update-not-available', () => set({ status: 'current', checkedAt: Date.now() }));
  updater.on('update-available', (info) => set({ status: 'downloading', version: info.version, percent: 0 }));
  updater.on('download-progress', (p) => set({ ...current, status: 'downloading', percent: Math.round(p.percent) }));
  updater.on('update-downloaded', (info) => set({ status: 'ready', version: info.version }));
  updater.on('error', (err) => set({ status: 'error', message: String(err?.message || err).split('\n')[0] }));
  setTimeout(check, 3000);
  setInterval(check, 4 * 60 * 60 * 1000);
}

function check() {
  if (!updater || ['checking', 'downloading', 'ready'].includes(current.status)) return current;
  updater.checkForUpdates().catch(() => {});
  return current;
}

function install() {
  if (current.status === 'ready') updater.quitAndInstall();
}

module.exports = { init, check, install, state: () => current };
