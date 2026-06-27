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
        // The socket + timer always run; whether a beacon is actually SENT is
        // re-checked from config on every tick (_send), so the admin toggle takes
        // effect live without a restart.
        this.group = fed.group || '239.255.42.99';
        this.port = fed.port || 41999;
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
            this._send();                                  // immediate first beacon (no-op if disabled)
            console.log(`[Federation] status beacon → ${this.group}:${this.port} every ${intervalMs / 1000}s — ${fed.enabled === false ? 'currently DISABLED (config.federation.enabled=false)' : 'active'} (id=${this.sysInfo?.id?.slice(0, 8) || '?'})`);
        });
        this.socket = socket;
        this.timer = setInterval(() => this._send(), intervalMs);
        if (this.timer.unref) this.timer.unref();
    }

    // Send one beacon now (used by the admin toggle so enabling is reflected
    // immediately rather than at the next interval tick).
    kick() { this._send(); }

    _send() {
        if (!this.socket) return;
        // Re-read enable state each send so the toggle is live.
        const fed = this.configManager.load().config.federation || {};
        if (fed.enabled === false) return;
        const group = this.group;
        const port = this.port;
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
