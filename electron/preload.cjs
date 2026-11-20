// Minimal, sandboxed bridge between the game and the desktop shell.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  isDesktop: true,
  platform: process.platform,
  saveGame: (json) => ipcRenderer.invoke('game:save', json),
  loadGame: () => ipcRenderer.invoke('game:load'),
  quit: () => ipcRenderer.invoke('game:quit'),
  toggleFullscreen: () => ipcRenderer.invoke('game:toggle-fullscreen'),
  info: () => ipcRenderer.invoke('app:info'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdateStatus: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('update:status', listener);
    return () => ipcRenderer.removeListener('update:status', listener);
  },
});
