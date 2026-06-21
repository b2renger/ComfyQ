const { LocalComfyUIWorker } = require('../workers/localComfyUIWorker');
const { BenchmarkService } = require('./benchmarkService');

// After this much idle time, release the calibration ComfyUI's VRAM (but keep
// the process up so a follow-up calibrate — or a switch to student mode, which
// attaches to the running ComfyUI — is fast).
const IDLE_FREE_MS = 10 * 60 * 1000;

// AdminCalibrator — makes "Calibrate" work from the admin panel, where there is
// normally no ComfyUI worker running.
//
// Admin mode boots only a thin HTTP server (no worker/queue/executor), so the
// /workflows calibrate route historically got a stub that just said "calibrate
// from student mode". This class is dropped in as that route's benchmarkService
// instead: on the first calibrate it lazily spawns (or attaches to) ComfyUI via
// the same LocalComfyUIWorker the executor uses, then reuses that worker for
// subsequent calibrations. The spawned ComfyUI is intentionally left running on
// shutdown — exactly like student mode — so activating a workflow afterwards
// attaches instantly instead of paying another cold boot.
class AdminCalibrator {
    constructor({ configManager, registry, onMilestone }) {
        // Read ComfyUI / queue / assets config FRESH from the configManager on
        // every use (see the getters below) rather than snapshotting it at
        // construction. Admin mode builds this once at boot; without fresh reads,
        // a path the admin edits + saves in the Settings panel afterwards would be
        // ignored and the boot-time (often default/hardcoded) path used instead.
        this.configManager = configManager;
        this.registry = registry;
        this.onMilestone = onMilestone || (() => {});
        this.worker = null;
        this.bench = null;
        this._starting = null;
        this._idleTimer = null;
        // Backend-launch state: whether the current worker attached to an
        // external ComfyUI we don't own, and whether it was spawned bound to the
        // network (0.0.0.0) for the "Launch ComfyUI backend" admin button.
        this._external = false;
        this._workerNetwork = false;
        // Signature (root|python|port) of the config the live worker was spawned
        // with, so a later path change triggers a restart instead of silently
        // reusing the process started with the old path.
        this._spawnSig = null;
    }

    // Always reflect the latest saved config (config.json is the source of truth).
    get _cfg() { return this.configManager.load().config; }
    get comfyConfig() { return this._cfg.comfy_ui; }
    get queueConfig() { return this._cfg.queue; }
    get assetsDir() { return this._cfg.assets?.dir || ''; }

    _comfySig(cfg) {
        return `${cfg.root_path || ''}|${cfg.python_executable || ''}|${cfg.api_port || ''}`;
    }

    async _ensureWorker({ network = false } = {}) {
        const cfg = this.comfyConfig; // fresh read for this call
        const sig = this._comfySig(cfg);
        if (this.worker && this.worker.getStatus().state !== 'down') {
            // Already up. Restart a ComfyUI we own when either (a) the caller now
            // needs a network-bound backend but the running instance is loopback,
            // or (b) the saved ComfyUI paths changed since we spawned it. An
            // externally-attached instance is always left alone.
            const needRebind = network && !this._workerNetwork && !this._external;
            const pathsChanged = !this._external && this._spawnSig && this._spawnSig !== sig;
            if (needRebind || pathsChanged) {
                console.log(`[AdminCalibrator] ${pathsChanged ? 'ComfyUI paths changed' : 'rebinding ComfyUI to the network'} — restarting it…`);
                await this._stopWorker();
            } else {
                return;
            }
        }
        if (!cfg.root_path || !cfg.python_executable) {
            throw new Error('Configure the ComfyUI paths (root + Python) in Settings first.');
        }
        // Coalesce concurrent first-start requests onto one boot.
        if (!this._starting) {
            this._starting = (async () => {
                // Force --listen 0.0.0.0 for a network backend, without persisting
                // lan_access — this launch is an explicit, one-off opt-in.
                const comfyConfig = network ? { ...cfg, lan_access: true } : cfg;
                console.log(`[AdminCalibrator] starting ComfyUI${network ? ' (network-bound)' : ''} at ${cfg.root_path} (a cold boot can take 30–90s)…`);
                const worker = new LocalComfyUIWorker({
                    comfyConfig, queueConfig: this.queueConfig, onMilestone: this.onMilestone
                });
                const res = await worker.start();
                this.worker = worker;
                this._external = !!res?.external;
                this._workerNetwork = network && !this._external;
                this._spawnSig = sig;
                this.bench = new BenchmarkService({
                    worker, registry: this.registry,
                    comfyConfig: cfg, assetsDir: this.assetsDir
                });
                console.log('[AdminCalibrator] ComfyUI ready');
            })();
        }
        try { await this._starting; } finally { this._starting = null; }
    }

    // Tears down the worker: close our WS and kill the ComfyUI we spawned (a
    // no-op for an externally-attached instance).
    async _stopWorker() {
        const w = this.worker;
        this.worker = null;
        this.bench = null;
        this._external = false;
        this._workerNetwork = false;
        this._spawnSig = null;
        if (w) {
            try { await w.shutdown(); } catch { /* WS close */ }
            try { await w.process?.stop(); } catch { /* kill spawned ComfyUI */ }
        }
    }

    async calibrate(workflowId) {
        await this._ensureWorker();
        this._clearIdle();
        try {
            return await this.bench.calibrate(workflowId);
        } finally {
            this._scheduleIdleFree();
        }
    }

    // --- "Launch ComfyUI as a network backend" (admin panel button) ---
    // Spawns (or reuses) ComfyUI bound to 0.0.0.0 so its native UI is reachable
    // on the LAN — the same single instance the calibrator uses, so a later
    // calibrate/activate attaches to it instead of cold-booting again.
    async launchBackend() {
        await this._ensureWorker({ network: true });
        return this.comfyStatus();
    }

    // Kills the ComfyUI we spawned. Leaves an externally-attached one alone.
    async stopBackend() {
        if (this._external) {
            return { ...this.comfyStatus(), stopped: false, note: 'attached to an external ComfyUI — left running' };
        }
        await this._stopWorker();
        return { ...this.comfyStatus(), stopped: true };
    }

    comfyStatus() {
        const st = this.worker?.getStatus?.();
        const running = !!st && st.state !== 'down';
        return {
            running,
            external: this._external,
            networkBound: running ? this._workerNetwork : false,
            wsConnected: st?.wsConnected || false,
            port: this.comfyConfig.api_port
        };
    }

    _clearIdle() {
        if (this._idleTimer) { clearTimeout(this._idleTimer); this._idleTimer = null; }
    }

    _scheduleIdleFree() {
        this._clearIdle();
        this._idleTimer = setTimeout(() => {
            console.log('[AdminCalibrator] idle — releasing ComfyUI VRAM (process stays up)');
            this.worker?.rest?.free({ unloadModels: true, freeMemory: true }).catch(() => {});
        }, IDLE_FREE_MS);
        // Don't keep the event loop alive just for this timer.
        this._idleTimer.unref?.();
    }

    // Closes our WS connection; leaves the ComfyUI process running so a
    // subsequent student-mode boot attaches to it. Called on SIGINT.
    async shutdown() {
        this._clearIdle();
        if (this.worker) {
            try { await this.worker.shutdown(); } catch { /* ignore */ }
        }
    }
}

module.exports = { AdminCalibrator };
