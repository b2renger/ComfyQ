// ComfyQ Fleet Monitor — Electron main process.
//
// Finds ComfyQ machines and merges them into one list, discovered three ways:
//   1. UDP status beacons (multicast + broadcast) — zero-config on friendly LANs.
//   2. IP-range scan — unicast GET http://<ip>:3000/federation/self across a
//      configurable address range. This is what finds machines on managed/school
//      Wi-Fi that blocks broadcast/multicast between clients.
//   3. Manually added machines (a machine on another network).
// Peer map + expiry live here; the list is pushed to the renderer over IPC.

const { app, BrowserWindow, ipcMain, shell, clipboard } = require('electron');
const dgram = require('dgram');
const http = require('http');
const os = require('os');
const fs = require('fs');
const path = require('path');

const GROUP = process.env.COMFYQ_FED_GROUP || '239.255.42.99';
const PORT = Number(process.env.COMFYQ_FED_PORT || 41999);
const DEFAULT_API_PORT = 3000;

const POLL_MS = 5_000;          // refresh known machines (added + discovered)
const SCAN_MS = 60_000;         // full range sweep cadence
const SCAN_CONCURRENCY = 48;
const SCAN_TIMEOUT_MS = 1500;
const MAX_SCAN_HOSTS = 4096;    // safety cap on a single sweep
const DISCOVERED_TTL = 90_000;  // stop polling an auto-found host unseen this long

const STALE_MS = 30_000;
const DROP_MS = 120_000;

let win = null;
let socket = null;
let socketError = null;
const peers = new Map();         // id -> { snap, lastSeen, source }
const discovered = new Map();    // host -> lastResponseTs
let scanning = false;
let scanChecked = 0, scanTotal = 0;

// ---- persisted settings ----
let staticPeers = [];
let autoScan = true;
let scanRange = null;            // { base:"10.10", third:[16,17], fourth:[1,254] }
let cfgFile = null;

function localIPv4s() {
    const out = [];
    const ifs = os.networkInterfaces();
    for (const name of Object.keys(ifs)) {
        for (const i of ifs[name] || []) {
            if (i.family === 'IPv4' && !i.internal) out.push({ address: i.address, netmask: i.netmask });
        }
    }
    return out;
}

// Sensible default range from the machine's own subnet (covers the whole subnet).
function defaultRange() {
    const me = localIPv4s()[0];
    if (!me) return { base: '192.168.1', third: [1, 1], fourth: [1, 254] };
    const o = me.address.split('.').map(Number);
    const m = me.netmask.split('.').map(Number);
    const net = o.map((x, i) => x & m[i]);
    const bc = o.map((x, i) => (x & m[i]) | (~m[i] & 255));
    // base = first two octets; scan the 3rd+4th octet ranges the mask spans.
    return { base: `${o[0]}.${o[1]}`, third: [net[2], bc[2]], fourth: [Math.max(1, net[3]), Math.min(254, bc[3] || 254)] };
}

function loadConfig() {
    try {
        cfgFile = path.join(app.getPath('userData'), 'fleet-config.json');
        if (fs.existsSync(cfgFile)) {
            const c = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
            if (Array.isArray(c.staticPeers)) staticPeers = c.staticPeers.filter(s => typeof s === 'string');
            if (typeof c.autoScan === 'boolean') autoScan = c.autoScan;
            if (c.scanRange && c.scanRange.base) scanRange = c.scanRange;
        }
    } catch { /* defaults */ }
    if (!scanRange) scanRange = defaultRange();
    const env = (process.env.COMFYQ_FED_PEERS || '').split(',').map(s => s.trim()).filter(Boolean);
    for (const h of env) if (!staticPeers.includes(h)) staticPeers.push(h);
}
function saveConfig() {
    try { if (cfgFile) fs.writeFileSync(cfgFile, JSON.stringify({ staticPeers, autoScan, scanRange }, null, 2)); }
    catch (e) { console.warn('[FleetMonitor] could not save config:', e.message); }
}

function parseHost(entry) {
    const [host, port] = String(entry).split(':');
    return { host: host.trim(), port: Number(port) || DEFAULT_API_PORT };
}

// Candidate IPs from the configured range (own IPs excluded), capped.
function scanCandidates() {
    const r = scanRange || defaultRange();
    const mine = new Set(localIPv4s().map(i => i.address));
    const [t0, t1] = r.third, [f0, f1] = r.fourth;
    const out = [];
    for (let t = Math.min(t0, t1); t <= Math.max(t0, t1); t++) {
        for (let f = Math.min(f0, f1); f <= Math.max(f0, f1); f++) {
            const ip = `${r.base}.${t}.${f}`;
            if (!mine.has(ip)) out.push(ip);
            if (out.length >= MAX_SCAN_HOSTS) return out;
        }
    }
    return out;
}

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

async function pollKnown() {
    const statics = staticHostSet();
    const targets = new Set([...staticPeers, ...discovered.keys()]);
    await Promise.all([...targets].map(async (entry) => {
        const { host, port } = parseHost(entry);
        if (!host) return;
        const snap = await fetchSelf(host, port, SCAN_TIMEOUT_MS);
        if (snap) {
            if (discovered.has(host)) discovered.set(host, Date.now());
            mergeSnap(snap, host, statics.has(host) ? 'added' : 'scan');
            pushToRenderer();
        }
    }));
}

async function scanRange_sweep() {
    if (scanning || !autoScan) return;
    const all = scanCandidates();
    if (!all.length) return;
    scanning = true; scanChecked = 0; scanTotal = all.length; pushToRenderer();
    const statics = staticHostSet();
    let idx = 0;
    const worker = async () => {
        while (idx < all.length) {
            const host = all[idx++];
            const snap = await fetchSelf(host, DEFAULT_API_PORT, SCAN_TIMEOUT_MS);
            scanChecked++;
            if (snap) {
                discovered.set(host, Date.now());
                mergeSnap(snap, host, statics.has(host) ? 'added' : 'scan');
            }
            if (scanChecked % 16 === 0 || snap) pushToRenderer();
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
    win.webContents.send('peers', {
        peers: list,
        staticPeers: staticPeers.slice(),
        selfIps: localIPv4s().map(i => i.address),   // to mark "this machine"
        socketError, group: GROUP, port: PORT,
        scan: {
            enabled: autoScan,
            scanning,
            range: scanRange,
            candidateCount: (scanRange ? scanCandidates().length : 0),
            discoveredCount: discovered.size,
            checked: scanChecked,
            total: scanTotal
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
        for (const i of localIPv4s()) {
            try { socket.addMembership(GROUP, i.address); joined++; } catch { /* already joined */ }
        }
        socketError = null;
        console.log(`[FleetMonitor] listening on ${GROUP}:${PORT} (multicast joins: ${joined}; broadcast: on)`);
        pushToRenderer();
    });
}

// Prune dead auto-discovered hosts + drop stale peers (added machines stay).
setInterval(() => {
    const now = Date.now();
    for (const [host, ts] of discovered) if (now - ts > DISCOVERED_TTL) discovered.delete(host);
    for (const [id, rec] of peers) {
        if (rec.source === 'added') continue;
        if (now - rec.lastSeen > DROP_MS) peers.delete(id);
    }
    pushToRenderer();
}, 5000);

function createWindow() {
    win = new BrowserWindow({
        width: 1100, height: 800, minWidth: 720, minHeight: 480,
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
ipcMain.handle('copy-text', (_e, text) => {
    if (typeof text === 'string') { clipboard.writeText(text); return true; }
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
ipcMain.handle('rescan', () => { scanRange_sweep(); return true; });
ipcMain.handle('set-auto-scan', (_e, on) => {
    autoScan = !!on; saveConfig(); pushToRenderer();
    if (autoScan) scanRange_sweep();
    return autoScan;
});
ipcMain.handle('get-scan-range', () => scanRange);
ipcMain.handle('set-scan-range', (_e, r) => {
    if (r && typeof r.base === 'string' && Array.isArray(r.third) && Array.isArray(r.fourth)) {
        const clamp = (n) => Math.max(0, Math.min(255, Math.round(Number(n) || 0)));
        scanRange = {
            base: r.base.trim().replace(/\.+$/, ''),
            third: [clamp(r.third[0]), clamp(r.third[1])],
            fourth: [clamp(r.fourth[0]), clamp(r.fourth[1])]
        };
        saveConfig();
        if (autoScan) scanRange_sweep();
    }
    pushToRenderer();
    return scanRange;
});

app.whenReady().then(() => {
    loadConfig();
    startSocket();
    pollKnown();
    setInterval(pollKnown, POLL_MS);
    setTimeout(scanRange_sweep, 800);
    setInterval(scanRange_sweep, SCAN_MS);
    createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
