// Bridge between the (sandboxed) renderer and the main process.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('fleet', {
    // Subscribe to peer-list updates pushed from the UDP listener.
    onPeers: (cb) => ipcRenderer.on('peers', (_e, data) => cb(data)),
    // Open a machine's web UI in the default browser.
    openUrl: (url) => ipcRenderer.invoke('open-url', url)
});
