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
        this._connect();
    }

    _connect() {
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
        ws.on('error', (err) => this.emit('error', err));
        ws.on('close', () => {
            this.emit('close');
            if (!this.shouldReconnect) return;
            const delay = Math.min(this.backoffMs, this.maxBackoffMs);
            setTimeout(() => this._connect(), delay);
            this.backoffMs = Math.min(this.backoffMs * 2, this.maxBackoffMs);
        });
    }

    isOpen() {
        return this.ws && this.ws.readyState === WebSocket.OPEN;
    }

    close() {
        this.shouldReconnect = false;
        try { this.ws && this.ws.close(); } catch (e) { /* ignore */ }
    }
}

module.exports = { ComfyWsClient };
