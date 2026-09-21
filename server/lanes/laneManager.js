const fs = require('fs');
const path = require('path');
const { LocalComfyUIWorker } = require('../workers/localComfyUIWorker');
const { JobExecutor } = require('../executor/jobExecutor');
const { effectiveComfyConfig } = require('../workers/perfFlags');
const { estimateWorkflowVram } = require('../workflows/vramEstimate');

// LaneManager — one machine, several workflows served at once.
//
// A lane is a workflow + the ComfyUI process that runs it + the executor that
// feeds it. Lanes run in parallel on the one GPU, each holding its own model,
// so a class can use two models at once instead of an admin switching the
// machine over (which restarts the server and reloads tens of GB).
//
// The first lane uses the configured ComfyUI port and the install's own
// directories, so a single-lane machine behaves exactly as it always has.
// Every extra lane gets its own port and its own user/temp directories **under
// ComfyQ** — the portable ComfyUI install is never written to. Those two dirs
// cannot be shared: ComfyUI locks <user-dir>/comfyui.db exclusively, and wipes
// its temp dir at startup.
//
// One lane per workflow, always. That invariant is what lets each executor
// claim work with a plain `findReady(now, [workflowId])` and no lease: two
// lanes can never see the same job.

// Per-lane ComfyUI state. At the repo root, deliberately NOT under server/:
// nodemon watches that tree, and a lane's ComfyUI writes settings and manager
// cache files as .json — which restarted ComfyQ, which killed the very ComfyUI
// it had just spawned. Outside the install too, so the portable ComfyUI stays
// untouched. Gitignored.
const LANES_DIR = path.join(__dirname, '..', '..', '.comfyq-lanes');
// Left free on the card for the OS/desktop after all lanes are accounted for.
const CARD_HEADROOM_GB = 2;
// What each extra ComfyUI is asked to keep free for its neighbours.
const LANE_HEADROOM_GB = 1;

const laneSlug = (workflowId) => String(workflowId).replace(/[^a-zA-Z0-9._-]/g, '_');

class LaneManager {
    constructor({ queue, registry, configManager, onChange = null, onSageIncompatible = null, onMilestone = null }) {
        this.queue = queue;
        this.registry = registry;
        this.configManager = configManager;
        this.onChange = onChange || (() => {});
        this.onSageIncompatible = onSageIncompatible;
        this.onMilestone = onMilestone || (() => {});
        this.lanes = new Map();          // workflowId -> lane
    }

    _config() { return this.configManager.load().config; }

    // ---- reporting ---------------------------------------------------------

    /** Total VRAM on this machine, as detected at boot. Null when unknown. */
    cardVramGb() {
        const gb = this._config().instance?.vramGb;
        return Number.isFinite(gb) && gb > 0 ? gb : null;
    }

    /**
     * What one workflow needs on the card, or null when it can't be told.
     * A measured figure from calibration wins over the static estimate: it is
     * the truth, and for pipelines whose models aren't named as files in the
     * graph (the 3D bundles load a HuggingFace repo) it is all there is.
     */
    vramFor(workflowId) {
        const entry = this.registry.get(workflowId);
        if (!entry || entry.unavailable) return null;
        const measured = entry.summary?.calibration?.vramPeakGb;
        if (measured) return measured;
        if (!entry.apiWorkflow) return null;
        try {
            const est = estimateWorkflowVram(entry.apiWorkflow, this._config().comfy_ui?.root_path);
            return est.known ? est.weightsGb : null;
        } catch { return null; }
    }

    list() {
        return [...this.lanes.values()].map(l => this._describe(l));
    }

    _describe(lane) {
        const status = lane.worker?.getStatus?.() || {};
        return {
            id: lane.id,
            workflowId: lane.workflowId,
            name: this.registry.get(lane.workflowId)?.summary?.name || lane.workflowId,
            port: lane.port,
            primary: lane.primary,
            state: status.state || 'unknown',
            busy: !!lane.executor?._currentJobId,
            vramGb: lane.vramGb,
            startedAt: lane.startedAt,
        };
    }

    servedWorkflowIds() { return [...this.lanes.keys()]; }
    get(workflowId) { return this.lanes.get(workflowId) || null; }
    /** The lane a job belongs to, or the only lane when there is just one. */
    laneForWorkflow(workflowId) {
        return this.lanes.get(workflowId)
            || (this.lanes.size === 1 ? [...this.lanes.values()][0] : null);
    }

    // ---- admission ---------------------------------------------------------

    /**
     * Would another lane for `workflowId` fit on this card?
     * Returns { ok, reason, needGb, usedGb, cardGb, freeGb }.
     */
    fit(workflowId) {
        const cardGb = this.cardVramGb();
        const needGb = this.vramFor(workflowId);
        const usedGb = +[...this.lanes.values()]
            .reduce((t, l) => t + (l.vramGb || 0), 0).toFixed(2);
        const freeGb = cardGb ? +(cardGb - usedGb - CARD_HEADROOM_GB).toFixed(2) : null;

        if (this.lanes.has(workflowId)) {
            return { ok: false, reason: 'already-served', needGb, usedGb, cardGb, freeGb };
        }
        if (!cardGb) {
            return { ok: false, reason: 'card-unknown', needGb, usedGb, cardGb, freeGb };
        }
        if (needGb == null) {
            // We can't read this workflow's models, so we can't promise it fits.
            // The admin can still force it — better than refusing outright on a
            // bundle whose nodes resolve their models internally.
            return { ok: false, reason: 'size-unknown', needGb, usedGb, cardGb, freeGb };
        }
        if (needGb > freeGb) {
            return { ok: false, reason: 'not-enough-vram', needGb, usedGb, cardGb, freeGb };
        }
        return { ok: true, reason: 'fits', needGb, usedGb, cardGb, freeGb };
    }

    // ---- lifecycle ---------------------------------------------------------

    _nextPort() {
        const base = this._config().comfy_ui?.api_port || 8188;
        const taken = new Set([...this.lanes.values()].map(l => l.port));
        for (let p = base; p < base + 32; p++) if (!taken.has(p)) return p;
        throw new Error('no free ComfyUI port for another lane');
    }

    // The ComfyUI config for one lane: the machine's settings, with this
    // workflow's incompatible speed-ups masked, its own port, and — for every
    // lane after the first — its own state directories.
    _laneComfyConfig(workflowId, port, primary) {
        const base = this._config().comfy_ui;
        const meta = this.registry.get(workflowId)?.meta || null;
        const cfg = { ...effectiveComfyConfig(base, meta), api_port: port };
        if (!primary) {
            const home = path.join(LANES_DIR, laneSlug(workflowId));
            cfg.user_dir = path.join(home, 'user');
            cfg.temp_dir = home;                 // ComfyUI appends "temp"
            cfg.vram_headroom_gb = LANE_HEADROOM_GB;
            // Each lane keeps its own share of the card in mind when it decides
            // whether to free models between jobs.
            const cardGb = this.cardVramGb();
            if (cardGb) cfg.vramBudgetGb = Math.max(4, Math.round(cardGb / (this.lanes.size + 1)));
        }
        return cfg;
    }

    /**
     * Start serving `workflowId` in its own lane.
     * @param {object} opts
     *   primary  — first lane: keeps the install's own dirs and the base port
     *   force    — start even when the VRAM check says no
     *   attempts — start retries (a restart can race a dying ComfyUI)
     */
    async open(workflowId, { primary = false, force = false, attempts = 3, retryMs = 8000 } = {}) {
        const entry = this.registry.get(workflowId);
        if (!entry || entry.unavailable) {
            throw new Error(`Workflow unavailable: ${entry?.reason || workflowId}`);
        }
        if (this.lanes.has(workflowId)) return this._describe(this.lanes.get(workflowId));

        if (!primary && !force) {
            const verdict = this.fit(workflowId);
            if (!verdict.ok) {
                const err = new Error(this._fitMessage(workflowId, verdict));
                err.code = verdict.reason;
                err.fit = verdict;
                throw err;
            }
        }

        const port = primary ? (this._config().comfy_ui?.api_port || 8188) : this._nextPort();
        const comfyConfig = this._laneComfyConfig(workflowId, port, primary);
        const label = `${laneSlug(workflowId).slice(0, 18)}:${port}`;

        const worker = new LocalComfyUIWorker({
            comfyConfig,
            queueConfig: this._config().queue,
            onMilestone: this.onMilestone,
            // A class is being served: if ComfyUI dies, bring it back rather
            // than stranding the lane.
            autoRespawn: true,
            onRespawn: () => {
                console.log(`[Lane ${label}] ComfyUI recovered — still serving "${workflowId}"`);
                this.onChange();
            },
        });

        let started = null;
        for (let attempt = 1; attempt <= attempts; attempt++) {
            try {
                started = await worker.start();
                if (started?.external && primary) {
                    // Only the primary lane may adopt (and re-flag) a ComfyUI it
                    // did not spawn. An extra lane attaching to someone else's
                    // process would mean two lanes sharing one ComfyUI, where a
                    // cancel or a VRAM free in one hits the other.
                    const { replaced } = await worker.ensureNoBlockingPerfFlags();
                    if (replaced) started = { external: false };
                }
                break;
            } catch (e) {
                console.error(`[Lane ${label}] ComfyUI did not start (attempt ${attempt}/${attempts}): ${e.message}`);
                if (attempt === attempts) { try { await worker.shutdown(); } catch { /* already down */ } throw e; }
                await new Promise(r => setTimeout(r, retryMs));
            }
        }
        if (!primary && started?.external) {
            // Something already answers on this port. That is normal after a
            // ComfyQ restart — the lane's own ComfyUI usually outlives it — and
            // adopting it saves the minute and a half a cold start costs. But
            // it must really be ours: two lanes sharing one backend would mean
            // a cancel or a VRAM free in one hitting the other. The lane's user
            // directory is unique, so its presence in the running process's
            // argv is proof of ownership.
            const ours = await this._ownsRunningComfy(worker, comfyConfig.user_dir);
            if (!ours) {
                try { await worker.shutdown(); } catch { /* already down */ }
                throw new Error(`Port ${port} is already serving a ComfyUI this lane does not own.`);
            }
            console.log(`[Lane ${label}] adopted the ComfyUI already running on port ${port}`);
        }

        const executor = new JobExecutor({
            queue: this.queue,
            worker,
            registry: this.registry,
            comfyConfig,
            workflowIds: [workflowId],
            label,
            onSageIncompatible: this.onSageIncompatible
                ? () => this.onSageIncompatible(worker) : null,
        });
        executor.start();

        const lane = {
            id: label, workflowId, port, primary, worker, executor, comfyConfig,
            vramGb: this.vramFor(workflowId) || 0,
            startedAt: Date.now(),
        };
        this.lanes.set(workflowId, lane);
        if (!primary) this._remember(workflowId, true);
        console.log(`[Lane ${label}] serving "${workflowId}" on port ${port}` +
            (lane.vramGb ? ` (~${lane.vramGb} GB of models)` : ''));
        this.onChange();
        return this._describe(lane);
    }

    // Is the ComfyUI answering on this lane's port the one this lane started?
    // Checked against the argv it reports: the lane's user directory appears
    // there and nowhere else.
    async _ownsRunningComfy(worker, userDir) {
        if (!userDir) return false;
        try {
            const stats = await worker.rest.ping();
            const argv = (stats?.system?.argv || []).map(String);
            const want = path.resolve(userDir).toLowerCase();
            return argv.some(a => path.resolve(a).toLowerCase() === want);
        } catch { return false; }
    }

    _fitMessage(workflowId, v) {
        const name = this.registry.get(workflowId)?.summary?.name || workflowId;
        if (v.reason === 'already-served') return `"${name}" is already being served.`;
        if (v.reason === 'card-unknown') return 'This machine\'s VRAM could not be detected, so a second lane cannot be sized. Start it anyway to override.';
        if (v.reason === 'size-unknown') return `How much VRAM "${name}" needs cannot be read from its graph. Start it anyway to override.`;
        return `"${name}" needs about ${v.needGb} GB and only ${v.freeGb} GB is free ` +
            `(${v.usedGb} GB in use by other lanes, ${CARD_HEADROOM_GB} GB kept for the system, ${v.cardGb} GB card).`;
    }

    /** Stop a lane. Its ComfyUI is killed for extra lanes so the VRAM comes back. */
    async close(workflowId) {
        const lane = this.lanes.get(workflowId);
        if (!lane) return false;
        this.lanes.delete(workflowId);
        if (!lane.primary) this._remember(workflowId, false);
        try { lane.executor.stop(); } catch { /* not running */ }
        try { await lane.worker.shutdown(); } catch { /* already down */ }
        // The primary lane leaves ComfyUI up (an admin may be using it, and the
        // next boot attaches to it). An extra lane exists only for itself, so
        // its process goes — that is the point of closing it.
        if (!lane.primary) {
            try { await lane.worker.process.stop(); }
            catch (e) { console.warn(`[Lane ${lane.id}] could not stop ComfyUI: ${e.message}`); }
        }
        console.log(`[Lane ${lane.id}] stopped serving "${workflowId}"`);
        this.onChange();
        return true;
    }

    // Extra lanes are remembered in config so a restart restores them. The
    // primary lane is already covered by workflows.activeWorkflowId.
    _remember(workflowId, on) {
        try {
            this.configManager.update(c => {
                const list = c.workflows.extraLaneWorkflowIds || [];
                const without = list.filter(id => id !== workflowId);
                c.workflows.extraLaneWorkflowIds = on ? [...without, workflowId] : without;
                return c;
            });
        } catch (e) {
            console.warn(`[Lane] could not remember lane "${workflowId}": ${e.message}`);
        }
    }

    /**
     * Reopen the lanes this machine was serving before it restarted. Failures
     * are logged and dropped — one lane that will not come back must not stop
     * the machine from serving the rest.
     */
    async restoreRemembered() {
        const saved = this._config().workflows?.extraLaneWorkflowIds || [];
        for (const workflowId of saved) {
            if (this.lanes.has(workflowId)) continue;
            try {
                console.log(`[Lane] restoring "${workflowId}" from before the restart…`);
                await this.open(workflowId, { force: true });
            } catch (e) {
                console.warn(`[Lane] could not restore "${workflowId}": ${e.message}`);
                this._remember(workflowId, false);
            }
        }
    }

    async closeAll() {
        for (const id of [...this.lanes.keys()]) await this.close(id);
    }
}

module.exports = { LaneManager, CARD_HEADROOM_GB, LANES_DIR };
