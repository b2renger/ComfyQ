const axios = require('axios');
const { LocalComfyUIWorker } = require('../workers/localComfyUIWorker');
const { killProcessOnPort } = require('../workers/comfyProcess');
const { BenchmarkService } = require('./benchmarkService');
const { ensureInstalled: ensureOpenerInstalled } = require('../comfyui/openerExtension');
const { effectiveComfyConfig, runningPerfFlags, blockingFlags, PERF_FLAG_LABELS } = require('../workers/perfFlags');

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
        // Perf-flag half of that signature, kept apart so a ComfyUI spawned
        // WITHOUT a flag for one workflow's sake (`disabledPerfFlags`) isn't
        // bounced again by a generic launch / "Open in ComfyUI".
        this._spawnFlagSig = null;
        this._spawnMasked = false;
        // Whether the currently-running ComfyUI is one we spawned with the ComfyQ
        // opener extension installed (so its "Open in ComfyUI" auto-open works).
        // False for an attached external instance or before we've spawned.
        this._openerLoaded = false;
    }

    // Always reflect the latest saved config (config.json is the source of truth).
    get _cfg() { return this.configManager.load().config; }
    get comfyConfig() { return this._cfg.comfy_ui; }
    get queueConfig() { return this._cfg.queue; }
    get assetsDir() { return this._cfg.assets?.dir || ''; }

    _pathSig(cfg) {
        return `${cfg.root_path || ''}|${cfg.python_executable || ''}|${cfg.api_port || ''}`;
    }

    _flagSig(cfg) {
        return `sage=${!!cfg.use_sage_attention}|fp16acc=${!!cfg.fp16_accumulation}`;
    }

    _comfySig(cfg) {
        return `${this._pathSig(cfg)}|${this._flagSig(cfg)}`;
    }

    // `workflowId` (calibration): run ComfyUI with exactly the perf flags that
    // workflow will be served with — its `disabledPerfFlags` forced off, so the
    // gauge neither saves black images nor times a different configuration.
    async _ensureWorker({ network = false, workflowId = null } = {}) {
        const base = this.comfyConfig; // fresh read for this call
        const entry = workflowId ? this.registry.get(workflowId) : null;
        const cfg = entry && !entry.unavailable ? effectiveComfyConfig(base, entry.meta) : base;
        if (this.worker && this.worker.getStatus().state !== 'down') {
            // Already up. Restart a ComfyUI we own when (a) the caller now needs a
            // network-bound backend but the running instance is loopback, (b) the
            // saved ComfyUI paths changed since we spawned it, or (c) its perf
            // flags differ from what's wanted — always for a calibration, but for
            // a generic launch only if the spawn wasn't masked for a workflow.
            // An externally-attached instance is left alone, EXCEPT when a
            // calibration needs a flag off that it was started with.
            const needRebind = network && !this._workerNetwork && !this._external;
            const pathsChanged = !this._external && this._spawnSig && this._spawnSig !== this._pathSig(cfg);
            const flagsChanged = !this._external && this._spawnFlagSig && this._spawnFlagSig !== this._flagSig(cfg)
                && (!!workflowId || !this._spawnMasked);
            const blockers = (this._external && workflowId) ? blockingFlags(cfg, await runningPerfFlags(this.worker.rest)) : [];
            if (needRebind || pathsChanged || flagsChanged) {
                const why = pathsChanged ? 'ComfyUI paths changed'
                    : flagsChanged ? `ComfyUI performance flags differ (${this._flagSig(cfg)})`
                    : 'rebinding ComfyUI to the network';
                console.log(`[AdminCalibrator] ${why} — restarting it…`);
                network = network || this._workerNetwork;
                await this._stopWorker();
                // stop() returns once the kill is issued; wait so the spawn below
                // doesn't find the dying instance still answering and attach to it.
                await this._waitForPortFree(base.api_port);
            } else if (blockers.length > 0) {
                console.log(`[AdminCalibrator] the external ComfyUI runs with ${blockers.map(k => PERF_FLAG_LABELS[k]).join(' + ')}, which "${workflowId}" can't use — replacing it…`);
                network = network || !!base.lan_access;
                await this._replaceExternal();
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
                // Ensure the ComfyQ opener extension is present before we boot, so
                // any ComfyUI we spawn can auto-open a workflow from the admin
                // panel. Best-effort — a failure here must not block the launch.
                try { ensureOpenerInstalled(cfg.root_path); } catch (e) { console.warn(`[AdminCalibrator] opener install skipped: ${e.message}`); }
                console.log(`[AdminCalibrator] starting ComfyUI${network ? ' (network-bound)' : ''} at ${cfg.root_path} (a cold boot can take 30–90s)…`);
                const worker = new LocalComfyUIWorker({
                    comfyConfig, queueConfig: this.queueConfig, onMilestone: this.onMilestone
                });
                const res = await worker.start();
                this.worker = worker;
                this._external = !!res?.external;
                this._workerNetwork = network && !this._external;
                this._spawnSig = this._pathSig(cfg);
                this._spawnFlagSig = this._flagSig(cfg);
                this._spawnMasked = cfg !== base;
                // We spawned it with the opener installed (an attached external
                // instance we don't own may not have it).
                this._openerLoaded = !this._external;
                this.bench = new BenchmarkService({
                    worker, registry: this.registry,
                    comfyConfig: cfg, assetsDir: this.assetsDir
                });
                console.log('[AdminCalibrator] ComfyUI ready');
            })();
        }
        try { await this._starting; } finally { this._starting = null; }
        // We may have just ATTACHED to a ComfyUI started elsewhere (e.g. by the
        // previous student session) that runs a flag this calibration can't use.
        if (this._external && workflowId) {
            const blockers = blockingFlags(cfg, await runningPerfFlags(this.worker.rest));
            if (blockers.length > 0) {
                console.log(`[AdminCalibrator] the external ComfyUI runs with ${blockers.map(k => PERF_FLAG_LABELS[k]).join(' + ')}, which "${workflowId}" can't use — replacing it…`);
                await this._replaceExternal();
                return this._ensureWorker({ network: network || !!base.lan_access, workflowId });
            }
        }
    }

    // Stop talking to an external ComfyUI and kill whatever listens on the port,
    // then wait for it to free so the next spawn doesn't re-attach to the dying
    // instance. Callers relaunch with _ensureWorker.
    async _replaceExternal() {
        const port = this.comfyConfig.api_port;
        await this._stopWorker();
        const { killed } = await killProcessOnPort(port);
        console.log(`[AdminCalibrator] killed PID(s) on ${port}: ${killed.join(', ') || 'none found'}`);
        await this._waitForPortFree(port);
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
        this._spawnFlagSig = null;
        this._spawnMasked = false;
        this._openerLoaded = false;
        if (w) {
            try { await w.shutdown(); } catch { /* WS close */ }
            try { await w.process?.stop(); } catch { /* kill spawned ComfyUI */ }
        }
    }

    // Ensure a network-bound ComfyUI is up AND running the ComfyQ opener
    // extension, so the admin's "Open in ComfyUI" can auto-open a workflow.
    // Launches if down (our spawns install + load the opener); if a ComfyUI we
    // own is already running without it (predates this feature), restarts once to
    // load it. An external ComfyUI can't be restarted → openerLoaded stays false
    // and the caller falls back to the Workflows-sidebar handoff.
    async ensureOpenerLoaded() {
        await this._ensureWorker({ network: true });
        if (!this._openerLoaded && !this._external) {
            console.log('[AdminCalibrator] restarting ComfyUI to load the ComfyQ opener extension…');
            try { ensureOpenerInstalled(this.comfyConfig.root_path); } catch (e) { console.warn(`[AdminCalibrator] opener install skipped: ${e.message}`); }
            await this._stopWorker();
            await this._ensureWorker({ network: true });
        }
        return { ...this.comfyStatus(), openerLoaded: this._openerLoaded && !this._external };
    }

    async calibrate(workflowId) {
        await this._ensureWorker({ workflowId });
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

    // Restarts ComfyUI: stop it, then relaunch reading the config FRESH — so an
    // edited ComfyUI path or a flipped "Expose ComfyUI to the LAN" toggle takes
    // effect. The network binding follows the saved `lan_access` (the toggle is
    // the source of truth), so a restart applies exactly what's configured.
    //
    // If ComfyUI is **external** (started outside ComfyQ, so we hold no process
    // handle), we "take over": force-kill whatever is listening on the port,
    // wait for it to free, then spawn our own — leaving ComfyQ managing it
    // afterward (so Restart / Stop / opener all work). This is an explicit,
    // admin-initiated action (the UI confirms it) — not something we ever do on
    // our own.
    async restartBackend() {
        const network = !!this.comfyConfig.lan_access;
        if (this._external) {
            const port = this.comfyConfig.api_port;
            console.log(`[AdminCalibrator] taking over external ComfyUI on port ${port} (force-kill + relaunch)…`);
            await this._stopWorker(); // close our WS to the external instance
            try {
                const { killed } = await killProcessOnPort(port);
                console.log(`[AdminCalibrator] killed PID(s) on ${port}: ${killed.join(', ') || 'none found'}`);
            } catch (e) {
                throw new Error(`Couldn't stop the external ComfyUI on port ${port}: ${e.message}`);
            }
            // Wait until nothing answers on the port, else the spawn below would
            // re-detect the dying instance as "external" and just attach again.
            await this._waitForPortFree(port);
            await this._ensureWorker({ network });
            return { ...this.comfyStatus(), restarted: true, tookOver: true };
        }
        await this._stopWorker();
        await this._ensureWorker({ network });
        return { ...this.comfyStatus(), restarted: true };
    }

    // Poll until nothing answers on the ComfyUI port (so a follow-up spawn sees a
    // free port and starts fresh instead of re-attaching). Best-effort — returns
    // after the timeout regardless.
    async _waitForPortFree(port, timeoutMs = 20000) {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            try {
                await axios.get(`http://127.0.0.1:${port}/system_stats`, { timeout: 1000 });
                await new Promise(r => setTimeout(r, 500)); // still up → keep waiting
            } catch {
                return true; // no response → port is free
            }
        }
        return false;
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
