// Exposes a narrow, safe API to the game (no Node access in the page).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pizzaNative', {
  isDesktop: true,
  listSaves: () => ipcRenderer.invoke('saves:list'),
  loadSave: (slot) => ipcRenderer.invoke('saves:load', slot),
  writeSave: (file) => ipcRenderer.invoke('saves:write', file),
  deleteSave: (slot) => ipcRenderer.invoke('saves:delete', slot),
  quit: () => ipcRenderer.send('app:quit'),
  toggleFullscreen: () => ipcRenderer.send('app:fullscreen'),
});
