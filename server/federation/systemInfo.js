// Federation (Phase F) — machine identity + hardware detection.
//
// Detected once at boot and persisted to config.instance so the LAN status
// beacon (and GET /federation/self) can report the machine even when ComfyUI
// isn't running (an idle admin rig has no /system_stats to ask). GPU/RAM rarely
// change, so we detect once and cache; the persisted values survive a later
// detection failure.

const os = require('os');
const { execFile } = require('child_process');
const { v4: uuidv4 } = require('uuid');

// Every non-internal IPv4 this machine is reachable on. (Same logic as
// server/index.js lanAddresses() and routes/admin.js lanUrls(); kept here so
// the federation module is self-contained.)
function lanAddresses() {
    const out = [];
    const ifs = os.networkInterfaces();
    for (const name of Object.keys(ifs)) {
        for (const i of ifs[name] || []) {
            if (i.family === 'IPv4' && !i.internal) out.push(i.address);
        }
    }
    return out;
}

function execFileP(cmd, args, timeoutMs = 4000) {
    return new Promise((resolve) => {
        try {
            execFile(cmd, args, { timeout: timeoutMs, windowsHide: true }, (err, stdout) => {
                if (err) return resolve(null);
                resolve(String(stdout || '').trim());
            });
        } catch {
            resolve(null);
        }
    });
}

// Returns { gpu, vramGb } using systeminformation, falling back to nvidia-smi.
async function detectGpu() {
    // Primary: systeminformation (cross-platform, no native build).
    try {
        const si = require('systeminformation');
        const g = await si.graphics();
        const controllers = (g && g.controllers) || [];
        // Skip obvious virtual/basic adapters; prefer the one with the most VRAM.
        const real = controllers.filter(c => {
            const m = (c.model || c.name || '').toLowerCase();
            return m && !m.includes('microsoft basic') && !m.includes('virtual') && !m.includes('parsec');
        });
        const pool = real.length ? real : controllers;
        let best = null;
        for (const c of pool) {
            const vram = Number(c.vram) || 0; // MB
            if (!best || vram > (Number(best.vram) || 0)) best = c;
        }
        if (best && (best.model || best.name)) {
            const vramMb = Number(best.vram) || 0;
            return { gpu: best.model || best.name, vramGb: vramMb > 0 ? Math.round(vramMb / 1024) : 0 };
        }
    } catch {
        /* systeminformation unavailable — fall through to nvidia-smi */
    }

    // Fallback: nvidia-smi (the workshop NVIDIA rigs always have it on PATH).
    const out = await execFileP('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits']);
    if (out) {
        const line = out.split(/\r?\n/)[0] || '';
        const [name, memMb] = line.split(',').map(s => (s || '').trim());
        if (name) {
            const mb = Number(memMb) || 0;
            return { gpu: name, vramGb: mb > 0 ? Math.round(mb / 1024) : 0 };
        }
    }
    return { gpu: '', vramGb: 0 };
}

// Detect identity + hardware, persist new/missing values to config.instance,
// and return the resolved snapshot. Safe to call once at boot.
async function detectSystemInfo(configManager) {
    let cfgInstance = {};
    try { cfgInstance = configManager.load().config.instance || {}; } catch { /* default */ }

    const ramGb = Math.round(os.totalmem() / (1024 ** 3));
    let { gpu, vramGb } = await detectGpu();

    // Keep a previously-detected GPU if this probe came up empty.
    if (!gpu && cfgInstance.gpu) { gpu = cfgInstance.gpu; vramGb = cfgInstance.vramGb || 0; }
    if (!gpu) gpu = 'Unknown GPU';

    const id = cfgInstance.id || uuidv4();
    const name = cfgInstance.name || os.hostname();

    const resolved = { id, name, gpu, vramGb, ramGb };

    // Persist only if something changed (avoids a config rewrite every boot).
    const changed = ['id', 'name', 'gpu', 'vramGb', 'ramGb'].some(k => cfgInstance[k] !== resolved[k]);
    if (changed) {
        try {
            configManager.update(c => {
                c.instance = { ...(c.instance || {}), ...resolved };
                return c;
            });
        } catch (e) {
            console.warn('[Federation] could not persist instance info:', e.message);
        }
    }

    return resolved;
}

module.exports = { detectSystemInfo, detectGpu, lanAddresses };
