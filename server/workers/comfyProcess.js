const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');
const axios = require('axios');

// Owns the ComfyUI child process lifecycle. v2 design: spawn once, keep alive.
// If ComfyUI exits, we emit 'exited' and let the LocalComfyUIWorker decide
// whether to respawn (default: yes, with backoff).
class ComfyProcess extends EventEmitter {
    constructor({ rootPath, pythonExecutable, host, port }) {
        super();
        this.rootPath = rootPath;
        this.pythonExecutable = pythonExecutable;
        this.host = host;
        this.port = port;
        this.proc = null;
    }

    validate() {
        if (!fs.existsSync(this.pythonExecutable)) {
            throw new Error(`Python executable not found: ${this.pythonExecutable}`);
        }
        if (!fs.existsSync(this.rootPath)) {
            throw new Error(`ComfyUI root path not found: ${this.rootPath}`);
        }
        if (!fs.existsSync(path.join(this.rootPath, 'main.py'))) {
            throw new Error(`ComfyUI main.py not found in ${this.rootPath}`);
        }
    }

    async isApiResponsive() {
        try {
            await axios.get(`http://${this.host}:${this.port}/system_stats`, { timeout: 1500 });
            return true;
        } catch { return false; }
    }

    async start() {
        this.validate();
        // If something is already responding on the port, assume an external
        // ComfyUI is running and don't try to spawn our own.
        if (await this.isApiResponsive()) {
            console.log('[ComfyProcess] External ComfyUI already responding; using it.');
            this.proc = null;
            return { external: true };
        }
        const mainPy = path.join(this.rootPath, 'main.py');
        // --highvram keeps weights resident on GPU and disables ComfyUI's
        // staged offload prefetch path. Required on workshop rigs (RTX 5090,
        // 24+ GB) because the prefetcher hits an upstream NoneType crash on
        // LTX-AV / similar models. Workshop hardware has plenty of VRAM, so
        // there is no downside.
        const args = [mainPy, '--listen', this.host, '--port', String(this.port), '--highvram'];
        console.log(`[ComfyProcess] Spawning: ${this.pythonExecutable} ${args.join(' ')}`);
        this.proc = spawn(this.pythonExecutable, args, {
            cwd: this.rootPath,
            env: process.env
        });
        this.proc.stdout.on('data', d => process.stdout.write(`[ComfyUI] ${d}`));
        this.proc.stderr.on('data', d => process.stderr.write(`[ComfyUI!] ${d}`));
        this.proc.on('exit', (code, signal) => {
            console.log(`[ComfyProcess] Exited code=${code} signal=${signal}`);
            this.proc = null;
            this.emit('exited', { code, signal });
        });
        return { external: false };
    }

    async waitForApi(timeoutMs = 120000) {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            if (await this.isApiResponsive()) return;
            await new Promise(r => setTimeout(r, 1500));
        }
        throw new Error(`Timeout waiting for ComfyUI API at ${this.host}:${this.port}`);
    }

    async stop() {
        if (this.proc) {
            this.proc.kill();
            await new Promise(r => setTimeout(r, 500));
            this.proc = null;
        }
    }
}

module.exports = { ComfyProcess };
