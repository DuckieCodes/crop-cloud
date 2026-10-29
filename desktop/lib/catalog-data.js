// Reads BRAND and APPS out of the hub's js/data.js so the shell and the
// build scripts use the same app list and versions as the hub.

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function readCatalogData(webRoot) {
  const code = fs.readFileSync(path.join(webRoot, 'js', 'data.js'), 'utf8');
  return vm.runInNewContext(`${code}\n;({ BRAND, APPS })`, {}, { filename: 'data.js' });
}

// The apps that are built and can be shipped.
function builtApps(webRoot) {
  return readCatalogData(webRoot).APPS.filter((a) => a.status === 'available' && a.entry);
}

// 1.10.0 > 1.9.3; missing parts count as 0.
function compareVersions(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return Math.sign(d);
  }
  return 0;
}

module.exports = { readCatalogData, builtApps, compareVersions };
