// The hub's window into the desktop shell. Pages see it as window.cropcloud;
// window.cropcloud missing means the test build in a browser.

const { contextBridge, ipcRenderer } = require('electron');

const listen = (channel) => (fn) => {
  const handler = (_event, data) => fn(data);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('cropcloud', {
  channel: 'desktop',
  info: () => ipcRenderer.invoke('info'),
  apps: {
    installed: () => ipcRenderer.invoke('apps:installed'),
    catalog: (opts) => ipcRenderer.invoke('apps:catalog', opts),
    install: (id) => ipcRenderer.invoke('apps:install', id),
    uninstall: (id) => ipcRenderer.invoke('apps:uninstall', id),
    onProgress: listen('apps:progress'),
  },
  updates: {
    state: () => ipcRenderer.invoke('updates:state'),
    check: () => ipcRenderer.invoke('updates:check'),
    install: () => ipcRenderer.invoke('updates:install'),
    on: listen('updates:state'),
  },
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
});
