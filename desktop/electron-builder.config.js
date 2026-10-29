// Packaging for the Windows installer. The GitHub repo comes from release.json,
// which the app also reads to find app downloads.
const release = require('./release.json');

module.exports = {
  appId: 'app.cropcloud.desktop',
  productName: 'Crop Cloud',
  artifactName: 'Crop-Cloud-Setup-${version}.${ext}',
  directories: { output: 'dist', buildResources: 'build' },
  files: ['main.js', 'preload.js', 'release.json', 'lib/**', 'package.json'],
  extraResources: [{ from: 'web', to: 'web' }],
  win: { target: [{ target: 'nsis', arch: ['x64'] }], icon: 'build/icon.png' },
  nsis: { oneClick: false, perMachine: false, allowToChangeInstallationDirectory: true, shortcutName: 'Crop Cloud' },
  publish: { provider: 'github', owner: release.owner, repo: release.repo },
};
