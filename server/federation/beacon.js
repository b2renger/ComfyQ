// Federation (Phase F) — LAN status beacon.
//
// Sends a JSON status snapshot every `intervalSec` so a standalone fleet monitor
// (desktop/) can list every ComfyQ machine on the network without per-peer
// polling. Uses Node's built-in dgram (no transport dependency). Runs in BOTH
// admin and student mode so idle admin rigs still appear. Fully gated by
// config.federation.enabled.
//
// Delivery is belt-and-suspenders for flaky Wi-Fi / multi-AP LANs: every tick we
// send to (a) the multicast group on each interface, (b) each interface's
// directed broadcast (e.g. 10.10.16.255), and (c) the limited broadcast
// 255.255.255.255. Multicast alone is unreliable across consumer APs and on
// multi-homed machines; directed broadcast is what makes same-subnet peers
// actually see each other.

const os = require('os');
const dgram = require('dgram');
const { buildSnapshot } = require('./statusSnapshot');

// IPv4 interfaces (non-internal) with their directed broadcast address.
function ipv4Interfaces() {
    const out = [];
    const ifs = os.networkInterfaces();
    for (const name of Object.keys(ifs)) {
        for (const i of ifs[name] || []) {
            if (i.family !== 'IPv4' || i.internal) continue;
            out.push({ name, address: i.address, netmask: i.netmask, broadcast: broadcastAddr(i.address, i.netmask) });
        }
    }
    return out;
}

// Directed broadcast for an address+netmask, e.g. 10.10.16.58 / 255.255.255.0
// → 10.10.16.255.
function broadcastAddr(ip, netmask) {
    try {
        const a = ip.split('.').map(Number);
        const m = netmask.split('.').map(Number);
        if (a.length !== 4 || m.length !== 4) return null;
        return a.map((p, i) => (p & m[i]) | (~m[i] & 255)).join('.');
    } catch { return null; }
}

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
        const intervalMs = (fed.intervalSec || 5) * 1000;

        const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
        socket.on('error', (e) => {
            if (!this._warned) {
                console.warn(`[Federation] beacon socket error (will keep retrying): ${e.message}`);
                this._warned = true;
            }
        });
        socket.bind(() => {
            try { socket.setBroadcast(true); } catch { /* ignore */ }
            // TTL > 1 so the beacon can cross a router hop (e.g. a Wi-Fi AP that
            // routes rather than bridges); still LAN-scoped.
            try { socket.setMulticastTTL(4); } catch { /* ignore */ }
            const ifs = ipv4Interfaces();
            this._send();                                  // immediate first beacon (no-op if disabled)
            console.log(`[Federation] status beacon → multicast ${this.group}:${this.port} + broadcast, every ${intervalMs / 1000}s — ${fed.enabled === false ? 'currently DISABLED (config.federation.enabled=false)' : 'active'} (id=${this.sysInfo?.id?.slice(0, 8) || '?'})`);
            for (const i of ifs) console.log(`[Federation]   iface ${i.name} ${i.address} → bcast ${i.broadcast || '?'}`);
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

        const port = this.port;
        const sendTo = (addr) => {
            this.socket.send(buf, 0, buf.length, port, addr, (e) => {
                // Per-target failures are common (an interface with no route);
                // warn once, never spam.
                if (e && !this._warned) {
                    console.warn(`[Federation] beacon send to ${addr} failed: ${e.message}`);
                    this._warned = true;
                }
            });
        };

        // (a) multicast group, (b) each interface's directed broadcast,
        // (c) limited broadcast. Dedupe so we don't send twice to the same addr.
        const targets = new Set([this.group, '255.255.255.255']);
        for (const i of ipv4Interfaces()) if (i.broadcast) targets.add(i.broadcast);
        for (const addr of targets) sendTo(addr);
    }

    stop() {
        if (this.timer) { clearInterval(this.timer); this.timer = null; }
        if (this.socket) { try { this.socket.close(); } catch { /* ignore */ } this.socket = null; }
    }
}

module.exports = { StatusBeacon };
