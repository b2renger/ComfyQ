// ComfyQ Fleet Monitor — Electron main process.
//
// Discovers ComfyQ machines two ways and merges them into one list:
//   1. UDP status beacons (multicast + broadcast) — zero-config on friendly LANs.
//   2. Static peers — unicast HTTP poll of http://<ip>:<port>/federation/self.
//      Needed on managed/school Wi-Fi that blocks broadcast/multicast between
//      clients (client isolation) but still allows normal unicast TCP.
// Peer map + stale/expiry live here; the list is pushed to the renderer over IPC.
// The only outbound action is opening a machine's web UI in the default browser.

const { app, BrowserWindow, ipcMain, shell } = require('electron');
const dgram = require('dgram');
const http = require('http');
const os = require('os');
const fs = require('fs');
const path = require('path');

// Must match server config.federation defaults (group/port).
const GROUP = process.env.COMFYQ_FED_GROUP || '239.255.42.99';
const PORT = Number(process.env.COMFYQ_FED_PORT || 41999);
const POLL_MS = 5_000;       // unicast poll cadence for static peers
const DEFAULT_API_PORT = 3000;

const STALE_MS = 30_000;     // ~6 missed 5s updates → mark stale
const DROP_MS = 120_000;     // gone this long (and not a static peer) → remove

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
const peers = new Map();       // id -> { snap, lastSeen, source }

// ---- static peers (unicast poll) ----
let staticPeers = [];          // array of host strings ("10.10.16.174" or "host:3000")
let peersFile = null;

function loadStaticPeers() {
    try {
        peersFile = path.join(app.getPath('userData'), 'static-peers.json');
        if (fs.existsSync(peersFile)) {
            const arr = JSON.parse(fs.readFileSync(peersFile, 'utf8'));
            if (Array.isArray(arr)) staticPeers = arr.filter(s => typeof s === 'string');
        }
    } catch { /* start empty */ }
    // Seed from env on first run (comma-separated).
    const env = (process.env.COMFYQ_FED_PEERS || '').split(',').map(s => s.trim()).filter(Boolean);
    for (const h of env) if (!staticPeers.includes(h)) staticPeers.push(h);
}

function saveStaticPeers() {
    try { if (peersFile) fs.writeFileSync(peersFile, JSON.stringify(staticPeers, null, 2)); }
    catch (e) { console.warn('[FleetMonitor] could not save static peers:', e.message); }
}

function parseHost(entry) {
    const [host, port] = String(entry).split(':');
    return { host: host.trim(), port: Number(port) || DEFAULT_API_PORT };
}

function pollStaticPeers() {
    for (const entry of staticPeers) {
        const { host, port } = parseHost(entry);
        if (!host) continue;
        const req = http.get({ host, port, path: '/federation/self', timeout: 4000 }, (res) => {
            if (res.statusCode !== 200) { res.resume(); return; }
            let body = '';
            res.on('data', (c) => { body += c; if (body.length > 1_000_000) req.destroy(); });
            res.on('end', () => {
                let snap;
                try { snap = JSON.parse(body); } catch { return; }
                if (!snap || snap.v == null) return;
                if (!Array.isArray(snap.ips) || snap.ips.length === 0) snap.ips = [host];
                const id = snap.id || `${host}:${snap.apiPort || port}`;
                peers.set(id, { snap, lastSeen: Date.now(), source: 'poll' });
                pushToRenderer();
            });
        });
        req.on('timeout', () => req.destroy());
        req.on('error', () => { /* peer offline / unreachable — just skip */ });
    }
}

function pushToRenderer() {
    if (!win || win.isDestroyed()) return;
    const now = Date.now();
    const list = [];
    for (const [, rec] of peers) {
        const age = now - rec.lastSeen;
        list.push({ ...rec.snap, _lastSeen: rec.lastSeen, _ageMs: age, _stale: age > STALE_MS, _source: rec.source });
    }
    win.webContents.send('peers', { peers: list, staticPeers: staticPeers.slice(), socketError, group: GROUP, port: PORT });
}

function startSocket() {
    socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

    socket.on('error', (e) => {
        socketError = e.message;
        pushToRenderer();
        try { socket.close(); } catch { /* ignore */ }
        setTimeout(startSocket, 3000);   // retry (e.g. interface not ready yet)
    });

    socket.on('message', (msg, rinfo) => {
        let snap;
        try { snap = JSON.parse(msg.toString()); } catch { return; }
        if (!snap || snap.v == null) return;
        if (!Array.isArray(snap.ips) || snap.ips.length === 0) snap.ips = [rinfo.address];
        const id = snap.id || `${rinfo.address}:${snap.apiPort || ''}`;
        peers.set(id, { snap, lastSeen: Date.now(), source: 'beacon' });
        pushToRenderer();
    });

    socket.bind(PORT, () => {
        // Broadcast datagrams are received automatically once bound to
        // 0.0.0.0:PORT. For multicast we join the group on every interface.
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

// Sweep: drop long-gone peers (but keep static peers in the list even when
// offline so the user still sees what they configured) and refresh ages.
setInterval(() => {
    const now = Date.now();
    const staticHosts = new Set(staticPeers.map(e => parseHost(e).host));
    for (const [id, rec] of peers) {
        const isStatic = rec.source === 'poll' || (rec.snap.ips || []).some(ip => staticHosts.has(ip));
        if (!isStatic && now - rec.lastSeen > DROP_MS) peers.delete(id);
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

ipcMain.handle('get-static-peers', () => staticPeers.slice());

ipcMain.handle('add-static-peer', (_e, host) => {
    const h = String(host || '').trim();
    if (h && !staticPeers.includes(h)) {
        staticPeers.push(h);
        saveStaticPeers();
        pollStaticPeers();          // surface it immediately
    }
    pushToRenderer();
    return staticPeers.slice();
});

ipcMain.handle('remove-static-peer', (_e, host) => {
    staticPeers = staticPeers.filter(h => h !== host);
    saveStaticPeers();
    pushToRenderer();
    return staticPeers.slice();
});

app.whenReady().then(() => {
    loadStaticPeers();
    startSocket();
    pollStaticPeers();
    setInterval(pollStaticPeers, POLL_MS);
    createWindow();
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
