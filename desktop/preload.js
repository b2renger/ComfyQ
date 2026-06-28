// Bridge between the (sandboxed) renderer and the main process.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('fleet', {
    // Subscribe to peer-list updates pushed from the UDP listener / poller.
    onPeers: (cb) => ipcRenderer.on('peers', (_e, data) => cb(data)),
    // Open a machine's web UI in the default browser.
    openUrl: (url) => ipcRenderer.invoke('open-url', url),
    // Copy text (e.g. a machine's admin-panel link) to the clipboard.
    copyText: (text) => ipcRenderer.invoke('copy-text', text),
    // Static peers (unicast poll) — for networks that block broadcast/multicast.
    getStaticPeers: () => ipcRenderer.invoke('get-static-peers'),
    addStaticPeer: (host) => ipcRenderer.invoke('add-static-peer', host),
    removeStaticPeer: (host) => ipcRenderer.invoke('remove-static-peer', host),
    // Auto-discovery (IP-range scan) controls.
    rescan: () => ipcRenderer.invoke('rescan'),
    setAutoScan: (on) => ipcRenderer.invoke('set-auto-scan', on),
    getScanRange: () => ipcRenderer.invoke('get-scan-range'),
    setScanRange: (range) => ipcRenderer.invoke('set-scan-range', range)
});
