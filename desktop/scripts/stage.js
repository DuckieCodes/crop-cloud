// Copies the hub (not the apps; those ship as separate downloads) into
// desktop/web, which electron-builder packs as resources/web.

const fs = require('node:fs');
const path = require('node:path');
const { readCatalogData } = require('../lib/catalog-data');
const pkg = require('../package.json');

const repo = path.join(__dirname, '..', '..');
const out = path.join(__dirname, '..', 'web');
const CORE = ['index.html', 'css', 'js', 'assets'];

const { BRAND } = readCatalogData(repo);
if (BRAND.version !== pkg.version) {
  console.error(`Version mismatch: js/data.js says ${BRAND.version}, desktop/package.json says ${pkg.version}. Make them the same.`);
  process.exit(1);
}

const config = fs.readFileSync(path.join(repo, 'js', 'config.js'), 'utf8');
if (/supabaseUrl:\s*''/.test(config)) {
  console.warn('Note: js/config.js has no Supabase project yet, so sign-in is turned off in this build.');
}

fs.rmSync(out, { recursive: true, force: true });
for (const item of CORE) fs.cpSync(path.join(repo, item), path.join(out, item), { recursive: true });
console.log(`Staged Crop Cloud ${pkg.version} hub into desktop/web`);
