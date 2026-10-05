const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('deck', {
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  scan: (dir) => ipcRenderer.invoke('scan', dir),
  loadState: () => ipcRenderer.invoke('state-load'),
  saveState: (o) => ipcRenderer.send('state-save', o),
  win: (cmd) => ipcRenderer.send('win', cmd)
});
