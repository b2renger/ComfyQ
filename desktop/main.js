// ComfyQ Fleet Monitor — Electron main process.
//
// Discovers ComfyQ machines three ways and merges them into one list:
//   1. UDP status beacons (multicast + broadcast) — zero-config on friendly LANs.
//   2. Subnet auto-scan — unicast GET http://<ip>:3000/federation/self across the
//      local subnet(s). This is what finds *all* machines on managed/school Wi-Fi
//      that blocks broadcast/multicast between clients but allows unicast TCP.
//   3. Static peers — manually added IPs (e.g. a machine on another subnet).
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
const DEFAULT_API_PORT = 3000;

const POLL_MS = 5_000;         // refresh known machines (static + discovered)
const SCAN_MS = 60_000;        // full subnet sweep cadence
const SCAN_CONCURRENCY = 48;   // simultaneous unicast probes during a sweep
const SCAN_TIMEOUT_MS = 1500;  // per-host probe timeout
const MAX_SCAN_HOSTS = 4096;   // skip auto-scan on subnets bigger than this (/20)
const DISCOVERED_TTL = 90_000; // stop polling an auto-found host unseen this long

const STALE_MS = 30_000;       // ~6 missed 5s updates → mark stale
const DROP_MS = 120_000;       // gone this long (non-static) → remove from the list

let win = null;
let socket = null;
let socketError = null;
const peers = new Map();        // id -> { snap, lastSeen, source }
const discovered = new Map();   // host -> lastResponseTs (auto-found via scan)
let scanning = false;

// ---- persisted settings (static peers + auto-scan flag) ----
let staticPeers = [];           // host strings ("10.10.16.174" or "host:3000")
let autoScan = true;
let cfgFile = null;

function loadConfig() {
    try {
        cfgFile = path.join(app.getPath('userData'), 'fleet-config.json');
        if (fs.existsSync(cfgFile)) {
            const c = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
            if (Array.isArray(c.staticPeers)) staticPeers = c.staticPeers.filter(s => typeof s === 'string');
            if (typeof c.autoScan === 'boolean') autoScan = c.autoScan;
        }
    } catch { /* defaults */ }
    const env = (process.env.COMFYQ_FED_PEERS || '').split(',').map(s => s.trim()).filter(Boolean);
    for (const h of env) if (!staticPeers.includes(h)) staticPeers.push(h);
}
function saveConfig() {
    try { if (cfgFile) fs.writeFileSync(cfgFile, JSON.stringify({ staticPeers, autoScan }, null, 2)); }
    catch (e) { console.warn('[FleetMonitor] could not save config:', e.message); }
}

// ---- ip helpers ----
function ipToInt(ip) {
    const p = String(ip).split('.').map(Number);
    if (p.length !== 4 || p.some(n => Number.isNaN(n))) return 0;
    return ((p[0] << 24) | (p[1] << 16) | (p[2] << 8) | p[3]) >>> 0;
}
function intToIp(n) {
    return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
}
function maskBits(maskInt) { let b = 0; for (let i = 31; i >= 0; i--) if (maskInt & (1 << i)) b++; else break; return b; }
function parseHost(entry) {
    const [host, port] = String(entry).split(':');
    return { host: host.trim(), port: Number(port) || DEFAULT_API_PORT };
}

// Local subnet(s) → list of candidate host IPs to probe (own IP + net/bcast excluded).
function scanInfo() {
    const subnets = [];
    const ifs = os.networkInterfaces();
    for (const name of Object.keys(ifs)) {
        for (const i of ifs[name] || []) {
            if (i.family !== 'IPv4' || i.internal) continue;
            const ip = ipToInt(i.address), mask = ipToInt(i.netmask);
            if (!mask) continue;
            const net = (ip & mask) >>> 0;
            const bcast = (net | (~mask >>> 0)) >>> 0;
            const size = bcast - net - 1;
            if (size <= 0 || size > MAX_SCAN_HOSTS) continue;
            const hosts = [];
            for (let a = net + 1; a < bcast; a++) if (a !== ip) hosts.push(intToIp(a));
            subnets.push({ cidr: `${intToIp(net)}/${maskBits(mask)}`, self: i.address, hosts });
        }
    }
    return subnets;
}

// ---- unicast probe ----
function fetchSelf(host, port, timeoutMs) {
    return new Promise((resolve) => {
        const req = http.get({ host, port, path: '/federation/self', timeout: timeoutMs }, (res) => {
            if (res.statusCode !== 200) { res.resume(); return resolve(null); }
            let b = '';
            res.on('data', (c) => { b += c; if (b.length > 1_000_000) req.destroy(); });
            res.on('end', () => { try { const s = JSON.parse(b); resolve(s && s.v != null ? s : null); } catch { resolve(null); } });
        });
        req.on('timeout', () => req.destroy());
        req.on('error', () => resolve(null));
    });
}

function mergeSnap(snap, fallbackHost, source) {
    if (!Array.isArray(snap.ips) || snap.ips.length === 0) snap.ips = [fallbackHost];
    const id = snap.id || `${fallbackHost}:${snap.apiPort || ''}`;
    peers.set(id, { snap, lastSeen: Date.now(), source });
}

function staticHostSet() { return new Set(staticPeers.map(e => parseHost(e).host)); }

// Refresh all known machines (manually added + auto-discovered) over unicast.
async function pollKnown() {
    const statics = staticHostSet();
    const targets = new Set([...staticPeers, ...discovered.keys()]);
    await Promise.all([...targets].map(async (entry) => {
        const { host, port } = parseHost(entry);
        if (!host) return;
        const snap = await fetchSelf(host, port, SCAN_TIMEOUT_MS);
        if (snap) {
            if (discovered.has(host)) discovered.set(host, Date.now());
            mergeSnap(snap, host, statics.has(host) ? 'poll' : 'scan');
            pushToRenderer();
        }
    }));
}

// Sweep the local subnet(s) for ComfyQ machines (the locked-down-Wi-Fi path).
async function scanSubnet() {
    if (scanning || !autoScan) return;
    const subnets = scanInfo();
    const all = subnets.flatMap(s => s.hosts);
    if (!all.length) return;
    scanning = true; pushToRenderer();
    const statics = staticHostSet();
    let idx = 0;
    const worker = async () => {
        while (idx < all.length) {
            const host = all[idx++];
            const snap = await fetchSelf(host, DEFAULT_API_PORT, SCAN_TIMEOUT_MS);
            if (snap) {
                discovered.set(host, Date.now());
                mergeSnap(snap, host, statics.has(host) ? 'poll' : 'scan');
                pushToRenderer();
            }
        }
    };
    await Promise.all(Array.from({ length: Math.min(SCAN_CONCURRENCY, all.length) }, worker));
    scanning = false; pushToRenderer();
}

function pushToRenderer() {
    if (!win || win.isDestroyed()) return;
    const now = Date.now();
    const list = [];
    for (const [, rec] of peers) {
        const age = now - rec.lastSeen;
        list.push({ ...rec.snap, _lastSeen: rec.lastSeen, _ageMs: age, _stale: age > STALE_MS, _source: rec.source });
    }
    const sub = scanInfo();
    win.webContents.send('peers', {
        peers: list,
        staticPeers: staticPeers.slice(),
        socketError, group: GROUP, port: PORT,
        scan: {
            enabled: autoScan,
            scanning,
            cidrs: sub.map(s => s.cidr),
            candidateCount: sub.reduce((n, s) => n + s.hosts.length, 0),
            discoveredCount: discovered.size
        }
    });
}

function startSocket() {
    socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    socket.on('error', (e) => {
        socketError = e.message;
        pushToRenderer();
        try { socket.close(); } catch { /* ignore */ }
        setTimeout(startSocket, 3000);
    });
    socket.on('message', (msg, rinfo) => {
        let snap;
        try { snap = JSON.parse(msg.toString()); } catch { return; }
        if (!snap || snap.v == null) return;
        mergeSnap(snap, rinfo.address, 'beacon');
        pushToRenderer();
    });
    socket.bind(PORT, () => {
        let joined = 0;
        try { socket.addMembership(GROUP); joined++; } catch { /* default join may fail */ }
        for (const s of scanInfo()) {
            try { socket.addMembership(GROUP, s.self); joined++; } catch { /* already joined */ }
        }
        socketError = null;
        console.log(`[FleetMonitor] listening on ${GROUP}:${PORT} (multicast joins: ${joined}; broadcast: on)`);
        pushToRenderer();
    });
}

// Sweep: prune dead auto-discovered hosts + drop stale non-static peers.
setInterval(() => {
    const now = Date.now();
    for (const [host, ts] of discovered) if (now - ts > DISCOVERED_TTL) discovered.delete(host);
    for (const [id, rec] of peers) {
        if (rec.source === 'poll') continue;   // user-added static peers stay
        if (now - rec.lastSeen > DROP_MS) peers.delete(id);
    }
    pushToRenderer();
}, 5000);

function createWindow() {
    win = new BrowserWindow({
        width: 1100, height: 780, minWidth: 720, minHeight: 480,
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
    if (h && !staticPeers.includes(h)) { staticPeers.push(h); saveConfig(); pollKnown(); }
    pushToRenderer();
    return staticPeers.slice();
});
ipcMain.handle('remove-static-peer', (_e, host) => {
    staticPeers = staticPeers.filter(h => h !== host); saveConfig(); pushToRenderer();
    return staticPeers.slice();
});
ipcMain.handle('rescan', () => { scanSubnet(); return true; });
ipcMain.handle('set-auto-scan', (_e, on) => {
    autoScan = !!on; saveConfig(); pushToRenderer();
    if (autoScan) scanSubnet();
    return autoScan;
});

app.whenReady().then(() => {
    loadConfig();
    startSocket();
    pollKnown();
    setInterval(pollKnown, POLL_MS);
    setTimeout(scanSubnet, 800);          // initial sweep shortly after launch
    setInterval(scanSubnet, SCAN_MS);
    createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
