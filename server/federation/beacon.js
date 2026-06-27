// Federation (Phase F) — LAN status beacon.
//
// Multicasts a JSON status snapshot every `intervalSec` so a standalone fleet
// monitor (desktop/) can list every ComfyQ machine on the network without
// per-peer polling. Uses Node's built-in dgram (no transport dependency). Runs
// in BOTH admin and student mode so idle admin rigs still appear. Fully gated by
// config.federation.enabled — when off, start() is a no-op and behavior is
// identical to today's single-instance ComfyQ.

const dgram = require('dgram');
const { buildSnapshot } = require('./statusSnapshot');

class StatusBeacon {
    constructor({ configManager, registry, runtime, sysInfo }) {
        this.configManager = configManager;
        this.registry = registry;
        this.runtime = runtime;
        this.sysInfo = sysInfo;
        this.socket = null;
        this.timer = null;
        this._warned = false;
    }

    start() {
        const fed = this.configManager.load().config.federation || {};
        if (fed.enabled === false) {
            console.log('[Federation] beacon disabled (config.federation.enabled = false)');
            return;
        }
        const group = fed.group || '239.255.42.99';
        const port = fed.port || 41999;
        const intervalMs = (fed.intervalSec || 15) * 1000;

        const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
        socket.on('error', (e) => {
            if (!this._warned) {
                console.warn(`[Federation] beacon socket error (will keep retrying): ${e.message}`);
                this._warned = true;
            }
        });
        socket.bind(() => {
            try { socket.setBroadcast(true); } catch { /* ignore */ }
            try { socket.setMulticastTTL(1); } catch { /* same-LAN only */ }
            this._send(group, port);                       // immediate first beacon
            console.log(`[Federation] status beacon → ${group}:${port} every ${intervalMs / 1000}s (id=${this.sysInfo?.id?.slice(0, 8) || '?'})`);
        });
        this.socket = socket;
        this.timer = setInterval(() => this._send(group, port), intervalMs);
        if (this.timer.unref) this.timer.unref();
    }

    _send(group, port) {
        if (!this.socket) return;
        let buf;
        try {
            const snap = buildSnapshot({
                configManager: this.configManager,
                registry: this.registry,
                runtime: this.runtime,
                sysInfo: this.sysInfo
            });
            buf = Buffer.from(JSON.stringify(snap));
        } catch (e) {
            if (!this._warned) { console.warn('[Federation] could not build snapshot:', e.message); this._warned = true; }
            return;
        }
        this.socket.send(buf, 0, buf.length, port, group, (e) => {
            if (e && !this._warned) {
                console.warn(`[Federation] beacon send failed (network down?): ${e.message}`);
                this._warned = true;
            }
        });
    }

    stop() {
        if (this.timer) { clearInterval(this.timer); this.timer = null; }
        if (this.socket) { try { this.socket.close(); } catch { /* ignore */ } this.socket = null; }
    }
}

module.exports = { StatusBeacon };
