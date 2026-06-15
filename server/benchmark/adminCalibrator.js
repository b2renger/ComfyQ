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
    constructor({ comfyConfig, queueConfig, registry, assetsDir, onMilestone }) {
        this.comfyConfig = comfyConfig;
        this.queueConfig = queueConfig;
        this.registry = registry;
        this.assetsDir = assetsDir || '';
        this.onMilestone = onMilestone || (() => {});
        this.worker = null;
        this.bench = null;
        this._starting = null;
        this._idleTimer = null;
    }

    async _ensureWorker() {
        if (this.worker && this.worker.getStatus().state !== 'down') return;
        if (!this.comfyConfig.root_path || !this.comfyConfig.python_executable) {
            throw new Error('Configure the ComfyUI paths (root + Python) in Settings before calibrating.');
        }
        // Coalesce concurrent first-calibrate requests onto one boot.
        if (!this._starting) {
            this._starting = (async () => {
                console.log('[AdminCalibrator] starting ComfyUI for calibration (this can take 30–90s on a cold boot)…');
                const worker = new LocalComfyUIWorker({
                    comfyConfig: this.comfyConfig,
                    queueConfig: this.queueConfig,
                    onMilestone: this.onMilestone
                });
                await worker.start();
                this.worker = worker;
                this.bench = new BenchmarkService({
                    worker, registry: this.registry,
                    comfyConfig: this.comfyConfig, assetsDir: this.assetsDir
                });
                console.log('[AdminCalibrator] ComfyUI ready — running calibration');
            })();
        }
        try { await this._starting; } finally { this._starting = null; }
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
