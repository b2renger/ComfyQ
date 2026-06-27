// ComfyQ Fleet Monitor — Electron main process.
//
// Joins the LAN status-beacon multicast group and collects a JSON snapshot from
// every ComfyQ machine (see server/federation/beacon.js). Maintains the peer
// map + stale/expiry here and forwards the list to the renderer over IPC. The
// only outbound action is opening a machine's web UI in the default browser.

const { app, BrowserWindow, ipcMain, shell } = require('electron');
const dgram = require('dgram');
const os = require('os');
const path = require('path');

// Must match server config.federation defaults (group/port).
const GROUP = process.env.COMFYQ_FED_GROUP || '239.255.42.99';
const PORT = Number(process.env.COMFYQ_FED_PORT || 41999);

const STALE_MS = 30_000;     // ~6 missed 5s beacons → mark stale
const DROP_MS = 120_000;     // gone this long → remove from the list

// Non-internal IPv4 interface addresses — used to join the multicast group on
// every interface (a Wi-Fi machine may have several; the default join often
// picks the wrong one).
function ipv4Addresses() {
    const out = [];
    const ifs = os.networkInterfaces();
    for (const name of Object.keys(ifs)) {
        for (const i of ifs[name] || []) {
            if (i.family === 'IPv4' && !i.internal) out.push(i.address);
        }
    }
    return out;
}

let win = null;
let socket = null;
let socketError = null;
const peers = new Map();      // id -> { snap, lastSeen }

function pushToRenderer() {
    if (!win || win.isDestroyed()) return;
    const now = Date.now();
    const list = [];
    for (const [, rec] of peers) {
        const age = now - rec.lastSeen;
        list.push({ ...rec.snap, _lastSeen: rec.lastSeen, _ageMs: age, _stale: age > STALE_MS });
    }
    win.webContents.send('peers', { peers: list, socketError, group: GROUP, port: PORT });
}

function startSocket() {
    socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

    socket.on('error', (e) => {
        socketError = e.message;
        pushToRenderer();
        try { socket.close(); } catch { /* ignore */ }
        // Retry after a short delay (e.g. interface not ready yet).
        setTimeout(startSocket, 3000);
    });

    socket.on('message', (msg, rinfo) => {
        let snap;
        try { snap = JSON.parse(msg.toString()); } catch { return; }
        if (!snap || snap.v == null) return;
        if (!Array.isArray(snap.ips) || snap.ips.length === 0) snap.ips = [rinfo.address];
        const id = snap.id || `${rinfo.address}:${snap.apiPort || ''}`;
        peers.set(id, { snap, lastSeen: Date.now() });
        pushToRenderer();
    });

    socket.bind(PORT, () => {
        // Broadcast datagrams are received automatically once bound to
        // 0.0.0.0:PORT. For multicast we join the group on every interface
        // (and the default) so a multi-homed / Wi-Fi machine doesn't miss it.
        let joined = 0;
        try { socket.addMembership(GROUP); joined++; } catch { /* default join may fail; per-iface below */ }
        for (const addr of ipv4Addresses()) {
            try { socket.addMembership(GROUP, addr); joined++; } catch { /* already joined / unsupported */ }
        }
        socketError = joined === 0 ? `Could not join multicast group ${GROUP} on any interface` : null;
        console.log(`[FleetMonitor] listening on ${GROUP}:${PORT} (multicast joins: ${joined}; broadcast: on)`);
        pushToRenderer();
    });
}

// Sweep: drop long-gone peers and refresh stale flags / "last seen" ages.
setInterval(() => {
    const now = Date.now();
    for (const [id, rec] of peers) {
        if (now - rec.lastSeen > DROP_MS) peers.delete(id);
    }
    pushToRenderer();
}, 5000);

function createWindow() {
    win = new BrowserWindow({
        width: 1100,
        height: 780,
        minWidth: 720,
        minHeight: 480,
        backgroundColor: '#0b0d10',
        title: 'ComfyQ Fleet Monitor',
        icon: path.join(__dirname, 'assets', 'icon.png'),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    });
    win.removeMenu();
    win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
    win.webContents.on('did-finish-load', pushToRenderer);
}

ipcMain.handle('open-url', (_e, url) => {
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) return shell.openExternal(url);
    return false;
});

app.whenReady().then(() => {
    startSocket();
    createWindow();
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
