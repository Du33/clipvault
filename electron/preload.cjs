const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('clipvault', {
  load: () => ipcRenderer.invoke('store:load'),
  save: (data) => ipcRenderer.invoke('store:save', data),
  readClipboard: () => ipcRenderer.invoke('clipboard:read'),
  writeClipboard: (text) => ipcRenderer.invoke('clipboard:write', text),
  readClipboardImage: () => ipcRenderer.invoke('clipboard:readImage'),
  writeClipboardImage: (ref, isPrivate) => ipcRenderer.invoke('clipboard:writeImage', ref, Boolean(isPrivate)),
  saveImage: (bytes, mime) => ipcRenderer.invoke('image:save', bytes, mime),
  private: {
    status: () => ipcRenderer.invoke('private:status'),
    setup: (pin) => ipcRenderer.invoke('private:setup', pin),
    unlock: (pin) => ipcRenderer.invoke('private:unlock', pin),
    load: () => ipcRenderer.invoke('private:load'),
    save: (data) => ipcRenderer.invoke('private:save', data),
    lock: () => ipcRenderer.invoke('private:lock'),
    changePin: (pin) => ipcRenderer.invoke('private:changePin', pin),
    erase: () => ipcRenderer.invoke('private:erase'),
    adoptImage: (info) => ipcRenderer.invoke('private:adoptImage', info),
    exportImage: (info) => ipcRenderer.invoke('private:exportImage', info),
  },
  openExternal: (url) => ipcRenderer.invoke('shell:open', url),
  info: () => ipcRenderer.invoke('app:info'),
  onQuickCapture: (cb) => {
    const listener = (_e, payload) => cb(payload);
    ipcRenderer.on('quick-capture', listener);
    return () => ipcRenderer.removeListener('quick-capture', listener);
  },
  onStoreChanged: (cb) => {
    const listener = (_e, data) => cb(data);
    ipcRenderer.on('store:changed', listener);
    return () => ipcRenderer.removeListener('store:changed', listener);
  },
  sync: {
    status: () => ipcRenderer.invoke('sync:status'),
    choose: () => ipcRenderer.invoke('sync:choose'),
    enable: (root, data) => ipcRenderer.invoke('sync:enable', root, data),
    disable: (data) => ipcRenderer.invoke('sync:disable', data),
    open: () => ipcRenderer.invoke('sync:open'),
  },
});
