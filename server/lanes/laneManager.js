const path = require('path');
const { LocalComfyUIWorker } = require('../workers/localComfyUIWorker');
const { JobExecutor } = require('../executor/jobExecutor');
const { effectiveComfyConfig } = require('../workers/perfFlags');
const { estimateWorkflowVram } = require('../workflows/vramEstimate');
const launcher = require('../workers/comfyLauncher');

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
//
// A batch is the exception, and it does not use lanes: its jobs must run in
// order, because later ones consume what earlier ones made. The main lane alone
// takes them, whatever workflow each names, one at a time; every other lane
// leaves them. The routes refuse a batch beside extra lanes and an extra lane
// beside a batch, and _prepareRun gets the ComfyUI ready for each workflow.
//
// Two ideas that used to be one (2026-11-04):
//   - the BASE lane is the one on the configured port with the install's own
//     directories — "the install's ComfyUI";
//   - the MAIN lane is the one whose workflow is `workflows.activeWorkflowId`,
//     what an older client shows as "the" workflow.
// They start out the same. Any lane can now be closed on its own: closing the
// main lane hands "main" to the next one, and closing the base lane keeps the
// install's ComfyUI running (its VRAM given back), so the next lane opened
// reuses that warm process instead of cold-starting another one.

// Per-lane ComfyUI state. At the repo root, deliberately NOT under server/:
// nodemon watches that tree, and a lane's ComfyUI writes settings and manager
// cache files as .json — which restarted ComfyQ, which killed the very ComfyUI
// it had just spawned. Outside the install too, so the portable ComfyUI stays
// untouched. Gitignored. COMFYQ_LANES_DIR moves it — lanes.integration.js
// points it at a throwaway folder so a test never lands on (or deletes) the
// folders of the lanes the rig is serving.
const LANES_DIR = process.env.COMFYQ_LANES_DIR
    ? path.resolve(process.env.COMFYQ_LANES_DIR)
    : path.join(__dirname, '..', '..', '.comfyq-lanes');
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
        // True during a live switch: for that moment no lane can take a booking.
        this.switching = false;
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
     * graph (LivePortrait's pack loads its weights by a path built in code,
     * and the 3d_mesh_* tools name no model) it is all there is.
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

    // Take prompts out of every lane's ComfyUI: queued ones are dropped, a running
    // one is interrupted. Each call names the prompt, so a run that is not one of
    // these is left alone, and an id a ComfyUI does not know changes nothing.
    async cancelPrompts(promptIds) {
        if (!promptIds?.length) return;
        for (const lane of this.lanes.values()) {
            try { await lane.worker.rest.deleteFromQueue(promptIds); } catch { /* lane going down */ }
            for (const id of promptIds) {
                try { await lane.worker.rest.interrupt(id); } catch { /* lane going down */ }
            }
        }
    }

    _describe(lane) {
        const status = lane.worker?.getStatus?.() || {};
        return {
            id: lane.id,
            workflowId: lane.workflowId,
            name: this.registry.get(lane.workflowId)?.summary?.name || lane.workflowId,
            port: lane.port,
            primary: this.mainLane() === lane,
            base: lane.base,
            owned: !!lane.worker?.process?.owned,
            state: status.state || 'unknown',
            busy: !!lane.executor?._currentJobId,
            vramGb: lane.vramGb,
            startedAt: lane.startedAt,
        };
    }

    servedWorkflowIds() { return [...this.lanes.keys()]; }

    /** The lane an older client calls "the" workflow: activeWorkflowId's, else the oldest. */
    mainLane() {
        const active = this._config().workflows?.activeWorkflowId;
        return this.lanes.get(active) || [...this.lanes.values()][0] || null;
    }

    /** The lane running on the install's own ComfyUI, if any. */
    baseLane() { return [...this.lanes.values()].find(l => l.base) || null; }
    get(workflowId) { return this.lanes.get(workflowId) || null; }

    // ---- admission ---------------------------------------------------------

    /**
     * Would `workflowId` fit in place of the main lane, beside the other lanes?
     * Only a measured "no" refuses: the main workflow never waits on a "cannot
     * tell", and with no extra lane there is nothing to collide with.
     */
    fitSwitch(workflowId) {
        const main = this.mainLane();
        const others = [...this.lanes.values()].filter(l => l !== main);
        const cardGb = this.cardVramGb();
        const needGb = this.vramFor(workflowId);
        const usedGb = +others.reduce((t, l) => t + (l.vramGb || 0), 0).toFixed(2);
        const freeGb = cardGb ? +(cardGb - usedGb - CARD_HEADROOM_GB).toFixed(2) : null;
        const verdict = { needGb, usedGb, cardGb, freeGb, lanes: others.map(l => l.workflowId) };
        if (others.length === 0 || !cardGb || needGb == null || needGb <= freeGb) return { ok: true, reason: 'fits', ...verdict };
        const names = others.map(l => `"${this.registry.get(l.workflowId)?.summary?.name || l.workflowId}"`).join(', ');
        const message = `${this._fitMessage(workflowId, { ...verdict, reason: 'not-enough-vram' })} Close ${names} first.`;
        return { ok: false, reason: 'not-enough-vram', message, ...verdict };
    }

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
        taken.add(base);                       // the base port belongs to the base lane
        // A port another lane's ComfyUI still holds (recorded, alive, not yet
        // reopened after a restart) is taken too — opening there would find a
        // ComfyUI this lane does not own.
        for (const [port, rec] of Object.entries(launcher.readRegistry().procs)) {
            if (launcher.pidAlive(rec.pid)) taken.add(Number(port));
        }
        for (let p = base + 1; p < base + 32; p++) if (!taken.has(p)) return p;
        throw new Error('no free ComfyUI port for another lane');
    }

    _laneHome(workflowId) { return path.join(LANES_DIR, laneSlug(workflowId)); }

    /**
     * Where a lane for `workflowId` should run: back on the lane ComfyUI a
     * previous ComfyQ started for it (still running — no restart), else on the
     * install's own ComfyUI when no lane uses it (often already up and warm),
     * else on a fresh port with its own directories.
     */
    _placement(workflowId) {
        const taken = new Set([...this.lanes.values()].map(l => l.port));
        const prior = launcher.recordsForUserDir(path.join(this._laneHome(workflowId), 'user'))
            .find(r => launcher.pidAlive(r.pid) && !taken.has(r.port));
        if (prior) return { base: false, port: prior.port, reason: 'its own ComfyUI is still running' };
        if (!this.baseLane()) return { base: true, port: this._config().comfy_ui?.api_port || 8188, reason: "the install's ComfyUI is free" };
        return { base: false, port: this._nextPort(), reason: 'a new lane' };
    }

    // The ComfyUI config for one lane: the machine's settings, with this
    // workflow's incompatible speed-ups masked, its own port, and — for every
    // lane after the first — its own state directories.
    _laneComfyConfig(workflowId, port, onBase) {
        const base = this._config().comfy_ui;
        const meta = this.registry.get(workflowId)?.meta || null;
        const cfg = { ...effectiveComfyConfig(base, meta), api_port: port };
        if (!onBase) {
            const home = this._laneHome(workflowId);
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
     *   primary  — the machine's main workflow: skips the VRAM check and
     *              becomes activeWorkflowId (where it RUNS is _placement's call)
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

        const place = this._placement(workflowId);
        const { port } = place;
        const onBase = place.base;
        const comfyConfig = this._laneComfyConfig(workflowId, port, onBase);
        const label = `${laneSlug(workflowId).slice(0, 18)}:${port}`;
        console.log(`[Lane ${label}] opening "${workflowId}" on port ${port} (${place.reason})`);

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
                // A ComfyUI that was already running — the install's own, or
                // one a previous ComfyQ started and this one adopted — was
                // started for whatever the settings were THEN: a workflow that
                // needed Sage off, a speed-up since turned on, LAN access since
                // changed. Relaunch it only when it differs from what this lane
                // would start it with now; otherwise reuse it as it is.
                if ((started?.external && onBase) || started?.adopted) {
                    const { replaced } = await worker.ensureLaunchSettings();
                    if (replaced) started = { external: false };
                }
                break;
            } catch (e) {
                console.error(`[Lane ${label}] ComfyUI did not start (attempt ${attempt}/${attempts}): ${e.message}`);
                if (attempt === attempts || e.noRetry) { try { await worker.shutdown(); } catch { /* already down */ } throw e; }
                await new Promise(r => setTimeout(r, retryMs));
            }
        }
        if (!onBase && started?.external) {
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
            // Ours, but started for the settings of its time — same check as above.
            // `ours`: the worker cannot tell on its own (no PID record), and
            // would otherwise leave it alone as a hand-started ComfyUI.
            try { await worker.ensureLaunchSettings({ ours: true }); }
            catch (e) { try { await worker.shutdown(); } catch { /* already down */ } throw e; }
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
            batchPolicy: () => (this.mainLane()?.workflowId === workflowId ? 'include' : 'exclude'),
            beforeRun: (wf) => this._prepareRun(workflowId, wf.id),
        });
        executor.start();
        // Every lane's progress reaches the students' screens, not only the
        // main lane's: the bus used to subscribe to the first lane alone, so a
        // second lane's jobs only moved on the periodic resend.
        try { executor.onChange(() => this.onChange()); } catch { /* older executor */ }
        try { worker.on('status', () => this.onChange()); } catch { /* not an emitter */ }

        const lane = {
            id: label, workflowId, port, base: onBase, worker, executor, comfyConfig,
            ranWorkflowId: workflowId,   // what its ComfyUI is set up for (see _prepareRun)
            vramGb: this.vramFor(workflowId) || 0,
            startedAt: Date.now(),
        };
        this.lanes.set(workflowId, lane);
        this._syncConfig(primary ? workflowId : null);
        console.log(`[Lane ${label}] serving "${workflowId}" on port ${port}` +
            (lane.vramGb ? ` (~${lane.vramGb} GB of models)` : ''));
        this.onChange();
        return this._describe(lane);
    }

    // A batch moves the main lane between workflows. Each one gets the models of
    // the last out of the way, and the speed-ups it can run with: a flag a
    // workflow disowns saves black pictures. No change of workflow, nothing to do,
    // so a lane serving its own jobs pays nothing here.
    async _prepareRun(laneWorkflowId, workflowId) {
        const lane = this.lanes.get(laneWorkflowId);
        if (!lane || lane.ranWorkflowId === workflowId) return;
        const { worker } = lane;
        console.log(`[Lane ${lane.id}] next job runs "${workflowId}" (was "${lane.ranWorkflowId}")`);
        try { await worker.rest.free({ unloadModels: true, freeMemory: true }); }
        catch (e) { console.warn(`[Lane ${lane.id}] could not unload its models: ${e.message}`); }
        const wanted = effectiveComfyConfig(this._config().comfy_ui, this.registry.get(workflowId)?.meta || null);
        worker.process.useSageAttention = !!wanted.use_sage_attention;
        worker.process.fp16Accumulation = !!wanted.fp16_accumulation;
        await worker.ensureLaunchSettings();
        lane.ranWorkflowId = workflowId;
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

    /**
     * Swap the main lane for `workflowId` on the warm ComfyUI. The other lanes are
     * not touched. Bookings are refused for the moment no lane is there to take
     * them (realtimeBus), and the flag drops even when the open fails.
     */
    async switchMain(workflowId) {
        this.switching = true;
        this.onChange();
        try {
            const old = this.mainLane();
            if (old) await this.close(old.workflowId);
            await this.open(workflowId, { primary: true });
        } finally {
            this.switching = false;
            this.onChange();
        }
    }

    // What no lane will run any more goes away with a reason the student can
    // read, instead of waiting for ever.
    cancelUnserved() {
        try {
            const cancelled = this.queue.cancelUnserved(this.servedWorkflowIds(), 'workflow-not-served');
            if (cancelled.length) console.log(`[Lane] cancelled ${cancelled.length} waiting job(s): their workflow is no longer served`);
            return cancelled;
        } catch (e) {
            console.warn(`[Lane] could not cancel the waiting jobs: ${e.message}`);
            return [];
        }
    }

    /**
     * Stop one lane; every other lane keeps serving.
     *
     * A lane on its own ComfyUI has that process stopped, so the VRAM comes
     * back. The base lane runs on the install's ComfyUI, which stays up — an
     * admin may be using it, and the next lane opened reuses it warm instead of
     * cold-starting another — but its models are unloaded so the VRAM comes
     * back all the same. Closing the main lane makes the next lane main.
     */
    async close(workflowId) {
        const lane = this.lanes.get(workflowId);
        if (!lane) return false;
        this.lanes.delete(workflowId);
        try { lane.executor.stop(); } catch { /* not running */ }
        // A job still running here is stopped and failed with a reason. Left
        // alone it was orphaned: the install's ComfyUI stays up and went on
        // rendering it, with no executor left to collect it or to cancel it,
        // so it sat "processing" until the next restart.
        if (lane.executor?._currentJobId && typeof lane.executor.abortCurrent === 'function') {
            try {
                await lane.executor.abortCurrent('Stopped: this workflow stopped being served on this machine while the job was running.');
            } catch (e) { console.warn(`[Lane ${lane.id}] could not stop its running job: ${e.message}`); }
        }
        try { await lane.worker.shutdown(); } catch { /* already down */ }
        if (lane.base) {
            try { await lane.worker.rest.free({ unloadModels: true, freeMemory: true }); }
            catch (e) { console.warn(`[Lane ${lane.id}] could not unload its models: ${e.message}`); }
        } else {
            try { await lane.worker.process.stop(); }
            catch (e) { console.warn(`[Lane ${lane.id}] could not stop ComfyUI: ${e.message}`); }
        }
        this.cancelUnserved();
        this._syncConfig();
        console.log(`[Lane ${lane.id}] stopped serving "${workflowId}"` +
            (lane.base ? " — the install's ComfyUI stays up, models unloaded" : ' — its ComfyUI stopped'));
        this.onChange();
        return true;
    }

    /**
     * Write what is being served into config so a restart restores it:
     * activeWorkflowId = the main lane (kept when it is still served, else the
     * oldest lane), extraLaneWorkflowIds = the rest. `makeMain` forces one.
     * With no lane left, the config is left alone — stopping the last lane is
     * "Stop serving", which the route handles.
     */
    _syncConfig(makeMain = null) {
        if (this.lanes.size === 0) return;
        try {
            this.configManager.update(c => {
                const ids = [...this.lanes.keys()];
                const main = makeMain && this.lanes.has(makeMain) ? makeMain
                    : (this.lanes.has(c.workflows.activeWorkflowId) ? c.workflows.activeWorkflowId : ids[0]);
                c.workflows.activeWorkflowId = main;
                // Lanes still waiting to be restored after a restart are kept,
                // or a restart during the restore would forget them.
                const pending = [...(this._pendingRestore || [])].filter(id => !this.lanes.has(id) && id !== main);
                c.workflows.extraLaneWorkflowIds = [...ids.filter(id => id !== main), ...pending];
                return c;
            });
        } catch (e) {
            console.warn(`[Lane] could not record the served workflows: ${e.message}`);
        }
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
    /** Keep these in config while the main lane opens (see _syncConfig). */
    holdForRestore(ids) { this._pendingRestore = new Set(ids || []); }

    /** What to restore after a restart. Read it BEFORE opening the main lane. */
    rememberedExtras() { return [...(this._config().workflows?.extraLaneWorkflowIds || [])]; }

    async restoreRemembered(saved = this.rememberedExtras()) {
        this._pendingRestore = new Set(saved);
        try {
            for (const workflowId of saved) {
                if (this.lanes.has(workflowId)) { this._pendingRestore.delete(workflowId); continue; }
                try {
                    console.log(`[Lane] restoring "${workflowId}" from before the restart…`);
                    await this.open(workflowId, { force: true });
                } catch (e) {
                    console.warn(`[Lane] could not restore "${workflowId}": ${e.message}`);
                    this._pendingRestore.delete(workflowId);
                    this._remember(workflowId, false);
                }
                this._pendingRestore.delete(workflowId);
            }
        } finally { this._pendingRestore = null; }
    }

    /**
     * Stop every lane: "Stop serving". Lanes on their own ComfyUI are stopped;
     * the install's ComfyUI stays up with its models unloaded, so admin mode
     * (and the next "Activate & serve") attaches to it without a cold boot.
     * The extra lanes are forgotten — a deliberate stop is not something a
     * restart should undo.
     */
    async closeAll() {
        // The main lane closes LAST, and is written back after: each close()
        // hands "main" to the next lane, so closing in order left
        // activeWorkflowId naming whichever lane happened to close last.
        const main = this.mainLane()?.workflowId || null;
        const order = [...this.lanes.keys()].filter(id => id !== main);
        if (main) order.push(main);
        for (const id of order) await this.close(id);
        try {
            this.configManager.update(c => {
                if (main) c.workflows.activeWorkflowId = main;
                c.workflows.extraLaneWorkflowIds = [];
                return c;
            });
        } catch { /* config read-only — nothing to forget */ }
    }

    /**
     * ComfyQ is shutting down (Ctrl+C, the terminal closing): let go of every
     * lane without stopping its ComfyUI, so the next start adopts them.
     */
    detachAll() {
        for (const lane of this.lanes.values()) {
            try { lane.executor.stop(); } catch { /* not running */ }
            try { lane.worker.shutdown(); } catch { /* already down */ }
        }
    }
}

module.exports = { LaneManager, CARD_HEADROOM_GB, LANES_DIR };
