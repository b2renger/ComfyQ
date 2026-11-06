const EventEmitter = require('events');
const WebSocket = require('ws');

// Auto-reconnecting WebSocket client for ComfyUI.
// Emits parsed JSON messages as 'message' events and connection state as
// 'open' / 'close' / 'error' events. Reconnects with exponential backoff.
class ComfyWsClient extends EventEmitter {
    constructor({ host, port, clientId }) {
        super();
        this.url = `ws://${host}:${port}/ws?clientId=${encodeURIComponent(clientId)}`;
        this.ws = null;
        this.shouldReconnect = true;
        this.backoffMs = 1000;
        this.maxBackoffMs = 30000;
        this._retry = null;
        this._connect();
    }

    _connect() {
        this._retry = null;
        if (!this.shouldReconnect) return;
        const ws = new WebSocket(this.url);
        this.ws = ws;
        ws.on('open', () => {
            this.backoffMs = 1000;
            this.emit('open');
        });
        ws.on('message', (data) => {
            try {
                const msg = JSON.parse(data.toString());
                this.emit('message', msg);
            } catch (e) {
                // ComfyUI also sends binary preview frames; ignore.
            }
        });
        // ★ An 'error' with no listener throws, and that kills ComfyQ. A worker
        // drops its listeners when it replaces this client (a ComfyUI relaunch),
        // so a socket still failing after that must not take the server down.
        ws.on('error', (err) => { if (this.listenerCount('error')) this.emit('error', err); });
        ws.on('close', () => {
            this.emit('close');
            if (!this.shouldReconnect) return;
            const delay = Math.min(this.backoffMs, this.maxBackoffMs);
            this._retry = setTimeout(() => this._connect(), delay);
            this.backoffMs = Math.min(this.backoffMs * 2, this.maxBackoffMs);
        });
    }

    isOpen() {
        return this.ws && this.ws.readyState === WebSocket.OPEN;
    }

    // ★ Also cancels a reconnect already scheduled: while ComfyUI was down for a
    // relaunch the close handler had set one, and it used to fire after close(),
    // open a socket to the dead port and emit an error nobody listened to.
    close() {
        this.shouldReconnect = false;
        if (this._retry) { clearTimeout(this._retry); this._retry = null; }
        try { this.ws && this.ws.close(); } catch (e) { /* ignore */ }
    }
}

module.exports = { ComfyWsClient };
