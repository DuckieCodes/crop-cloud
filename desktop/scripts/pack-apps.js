// Zips each built app and writes apps-manifest.json into dist/apps/.
// The release workflow uploads these next to the installer.
//
//   node scripts/pack-apps.js            links point at the GitHub release for this version
//   node scripts/pack-apps.js --local    links are relative, for a local test server

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const AdmZip = require('adm-zip');
const { builtApps } = require('../lib/catalog-data');
const pkg = require('../package.json');
const release = require('../release.json');

const repo = path.join(__dirname, '..', '..');
const out = path.join(__dirname, '..', 'dist', 'apps');
const local = process.argv.includes('--local');
const SKIP = /\.(py|md)$|(^|\/)\./;

function addDir(zip, dir, rel = '') {
  for (const name of fs.readdirSync(dir).sort()) {
    const file = path.join(dir, name);
    const entry = rel ? `${rel}/${name}` : name;
    if (SKIP.test(entry)) continue;
    if (fs.statSync(file).isDirectory()) addDir(zip, file, entry);
    else zip.addFile(entry, fs.readFileSync(file));
  }
}

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

const { owner, repo: repoName } = release;
const manifest = {
  suite: pkg.version,
  publishedAt: new Date().toISOString(),
  base: local ? undefined : `https://github.com/${owner}/${repoName}/releases/download/v${pkg.version}/`,
  apps: [],
};

for (const app of builtApps(repo)) {
  const zip = new AdmZip();
  addDir(zip, path.join(repo, 'apps', app.id));
  const file = `${app.id}-${app.version}.zip`;
  const buffer = zip.toBuffer();
  fs.writeFileSync(path.join(out, file), buffer);
  manifest.apps.push({
    id: app.id,
    name: app.name,
    version: app.version,
    file,
    size: buffer.length,
    sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
    minShell: pkg.version,
  });
  console.log(`${file}  ${(buffer.length / 1048576).toFixed(1)} MB`);
}

fs.writeFileSync(path.join(out, 'apps-manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`Wrote dist/apps/apps-manifest.json (${manifest.apps.length} apps)`);
