// App downloads. Each release on GitHub carries apps-manifest.json plus one
// zip per app; installed apps live in <userData>/apps/<id>/<version>/.

const { app, net } = require('electron');
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const crypto = require('node:crypto');
const AdmZip = require('adm-zip');
const { builtApps, compareVersions } = require('./catalog-data');
const release = require('../release.json');

let opts = { localApps: false, webRoot: '', manifestUrl: '' };
let state = null;
let cached = null; // { at, manifest }
const busy = new Map();

const root = () => path.join(app.getPath('userData'), 'apps');
const stateFile = () => path.join(root(), 'installed.json');

function configure(o) {
  opts = { ...opts, ...o };
}

function defaultManifestUrl() {
  const { owner, repo } = release;
  return `https://github.com/${owner}/${repo}/releases/latest/download/apps-manifest.json`;
}

const manifestUrl = () => opts.manifestUrl || defaultManifestUrl();

function load() {
  if (state) return state;
  try {
    state = JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
  } catch {
    state = {};
  }
  return state;
}

async function save() {
  await fsp.mkdir(root(), { recursive: true });
  const tmp = `${stateFile()}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(state, null, 2));
  await fsp.rename(tmp, stateFile());
}

// Folder an installed app is served from, or null.
function dir(id) {
  const s = load()[id];
  return s && /^[a-z0-9-]+$/.test(id) ? path.join(root(), id, s.version) : null;
}

function installed() {
  if (opts.localApps) {
    const apps = {};
    for (const a of builtApps(opts.webRoot)) apps[a.id] = { version: a.version, local: true };
    return { local: true, apps };
  }
  return { local: false, apps: { ...load() } };
}

function checkManifest(m) {
  if (!m || !Array.isArray(m.apps)) throw new Error('The app list from GitHub is not valid.');
  for (const a of m.apps) {
    if (!/^[a-z0-9-]+$/.test(a.id) || !/^[\w.-]+\.zip$/.test(a.file) || !/^[0-9a-f]{64}$/.test(a.sha256)) {
      throw new Error('The app list from GitHub is not valid.');
    }
  }
  return m;
}

async function catalog({ refresh = false } = {}) {
  if (!refresh && cached && Date.now() - cached.at < 10 * 60 * 1000) return cached.manifest;
  const res = await net.fetch(manifestUrl(), { cache: 'no-store' });
  if (!res.ok) throw new Error(res.status === 404 ? 'No release has been published yet.' : `Could not reach GitHub (${res.status}).`);
  const manifest = checkManifest(await res.json());
  cached = { at: Date.now(), manifest };
  return manifest;
}

// Release files must come over https; plain http is only for a local test server.
function assetUrl(manifest, file) {
  const url = new URL(file, manifest.base || manifestUrl());
  const local = url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname);
  if (url.protocol !== 'https:' && !local) throw new Error('Refusing to download over an insecure connection.');
  return url.toString();
}

async function download(url, expectedSize, onChunk) {
  const res = await net.fetch(url);
  if (!res.ok) throw new Error(`Download failed (${res.status}).`);
  const total = Number(res.headers.get('content-length')) || expectedSize || 0;
  const reader = res.body.getReader();
  const chunks = [];
  let done = 0;
  for (;;) {
    const { value, done: end } = await reader.read();
    if (end) break;
    chunks.push(Buffer.from(value));
    done += value.byteLength;
    onChunk(done, total);
  }
  return Buffer.concat(chunks);
}

async function extract(buffer, target) {
  const zip = new AdmZip(buffer);
  let bytes = 0;
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    const dest = path.resolve(target, entry.entryName);
    if (!dest.startsWith(target + path.sep)) throw new Error('The download contains an unsafe path.');
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    const data = entry.getData();
    await fsp.writeFile(dest, data);
    bytes += data.length;
  }
  return bytes;
}

async function doInstall(id, onProgress) {
  if (opts.localApps) throw new Error('Running from the project folder; apps come from apps/.');
  const manifest = await catalog({ refresh: true });
  const entry = manifest.apps.find((a) => a.id === id);
  if (!entry) throw new Error('That app is not in the latest release.');
  if (entry.minShell && compareVersions(app.getVersion(), entry.minShell) < 0) {
    throw new Error(`This version needs Crop Cloud ${entry.minShell}. Restart Crop Cloud to finish updating, then try again.`);
  }

  let last = 0;
  const buffer = await download(assetUrl(manifest, entry.file), entry.size, (done, total) => {
    if (Date.now() - last < 100 && done < total) return;
    last = Date.now();
    onProgress({ id, phase: 'download', done, total });
  });
  const hash = crypto.createHash('sha256').update(buffer).digest('hex');
  if (hash !== entry.sha256) throw new Error('The download was damaged. Please try again.');

  onProgress({ id, phase: 'extract', done: 1, total: 1 });
  const appRoot = path.join(root(), id);
  const target = path.join(appRoot, entry.version);
  const tmp = `${target}.part`;
  await fsp.rm(tmp, { recursive: true, force: true });
  await fsp.mkdir(tmp, { recursive: true });
  const bytes = await extract(buffer, tmp);
  if (!fs.existsSync(path.join(tmp, 'index.html'))) throw new Error('The download is missing the app.');
  await fsp.rm(target, { recursive: true, force: true });
  await fsp.rename(tmp, target);

  load()[id] = { version: entry.version, size: bytes, installedAt: Date.now() };
  await save();
  // Old versions go once the new one is in place.
  for (const name of await fsp.readdir(appRoot)) {
    if (name !== entry.version) await fsp.rm(path.join(appRoot, name), { recursive: true, force: true });
  }
  onProgress({ id, phase: 'done', done: 1, total: 1 });
  return load()[id];
}

function install(id, onProgress) {
  if (!busy.has(id)) {
    const job = doInstall(id, onProgress).finally(() => busy.delete(id));
    busy.set(id, job);
  }
  return busy.get(id);
}

async function uninstall(id) {
  if (opts.localApps) throw new Error('Running from the project folder; apps come from apps/.');
  if (!load()[id]) return;
  delete state[id];
  await save();
  await fsp.rm(path.join(root(), id), { recursive: true, force: true });
}

module.exports = { configure, dir, installed, catalog, install, uninstall };
