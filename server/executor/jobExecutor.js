const sm = require('../queue/jobStateMachine');
const oc = require('./outputCollector');
const { humanizeFailure, isSageIncompatibility } = require('./errorMessages');
const ingredientsStore = require('../storage/ingredientsStore');
const { resolveChainedInputs } = require('./chainedInputs');

const FAST_POLL_MS = 1000;        // first 60s
const SLOW_POLL_MS = 5000;        // after 60s
const FAST_POLL_WINDOW_MS = 60000;

// Drives the JobQueue + Worker. One job at a time in M0; the executor stays
// loop-driven so it composes cleanly with future multi-worker pools.
class JobExecutor {
    constructor({ queue, worker, registry, comfyConfig, onSageIncompatible = null, workflowIds = null, label = '', batchPolicy = null, beforeRun = null }) {
        this.queue = queue;
        this.worker = worker;
        this.registry = registry;
        this.comfyConfig = comfyConfig;
        // The workflows this executor is responsible for. null = every job,
        // which is the single-lane behaviour. With several lanes running in
        // parallel each one claims only its own workflow's jobs.
        this.workflowIds = workflowIds;
        // Prefix for this executor's log lines, so two lanes are tellable apart.
        this.label = label;
        // Batch jobs name their own workflow, so one lane takes them all and
        // runs them in order: () => 'include' | 'exclude', asked on every tick
        // because the main lane can change. See LaneManager.
        this.batchPolicy = batchPolicy;
        // async (workflowEntry) => void, awaited before a job starts: this is
        // where a lane gets its ComfyUI ready for another workflow's job.
        this.beforeRun = beforeRun;
        // Called once, the first time a job dies because ComfyUI's optional
        // sage-attention flag does not support that model's head dimension.
        // Should turn the flag off, bring ComfyUI back without it, and resolve
        // truthy — the job is then retried rather than failed. See server/index.js.
        this.onSageIncompatible = onSageIncompatible;
        this._sageRecoveryDone = false;
        this._recovering = false;
        this._heldFor = null;          // why _tick last held the queue (logged once)
        this.running = false;
        this.tickMs = 1000;
        this._listeners = new Set();
        this._currentJobId = null;
        this._historyStartedAt = null;
        this._wsHasFired = false;
        this._collecting = null;       // { jobId, settled } of the last output collection
        this._jobStartedAt = null;
        this._lastProgressLogAt = 0;
        this._lastLoggedNodeId = null;

        // Wire worker events.
        this.worker.on('submitted', ({ jobId, promptId }) => {
            try { this.queue.transitionStatus(jobId, sm.STATES.EXECUTING, { payload: { promptId } }); }
            catch (e) { console.warn('[Executor] submitted transition err:', e.message); }
            console.log(`[Executor] job ${jobId.slice(0, 8)} → prompt ${promptId.slice(0, 8)} (executing)`);
        });
        this.worker.on('progress', ({ jobId, stepsDone, stepsTotal, currentNodeId }) => {
            this.queue.updateProgress(jobId, { stepsDone, stepsTotal, currentNode: currentNodeId });
            this._logProgress(jobId, stepsDone, stepsTotal, currentNodeId);
        });
        this.worker.on('node-executing', ({ jobId, nodeId }) => {
            this.queue.updateProgress(jobId, { currentNode: nodeId });
            if (nodeId !== this._lastLoggedNodeId) {
                this._lastLoggedNodeId = nodeId;
                const elapsed = this._jobStartedAt ? ((Date.now() - this._jobStartedAt) / 1000).toFixed(1) : '?';
                console.log(`[Executor] job ${jobId.slice(0, 8)} node ${nodeId} executing (t=${elapsed}s)`);
            }
        });
        this.worker.on('execution-finished', async ({ jobId, promptId }) => {
            this._wsHasFired = true;
            try {
                await this._collectAndComplete(jobId, promptId);
            } catch (e) {
                console.error('[Executor] collect failed:', e.message);
                this._failCurrent(e.message, 'collecting-outputs');
            }
        });
        this.worker.on('failed', ({ jobId, errorReason, errorPhase }) => {
            // A model that sage attention cannot run is a server-configuration problem, not a
            // problem with the job: the flag is global, so it would take out
            // every remaining shot that uses this model. Turn it off, restart
            // ComfyUI, and put the job back — once.
            if (this._shouldRecoverFromSage(errorReason)) {
                this._recoverFromSage(jobId, errorReason);
                return;
            }
            // worker.cancel() reports a stop the user asked for through this
            // same event. Record it as cancelled, as the Cancel dialog promises:
            // a storyboard retry re-runs failed shots, and must not re-run one
            // somebody stopped. Dependents cascade either way (failBlockedJobs).
            const cancelled = errorReason === 'cancelled';
            const to = cancelled ? sm.STATES.CANCELLED : sm.STATES.FAILED;
            try { this.queue.transitionStatus(jobId, to, { payload: { errorReason, errorPhase } }); } catch { /* already terminal, or deleted */ }
            const dur = this._jobStartedAt ? ((Date.now() - this._jobStartedAt) / 1000).toFixed(1) : '?';
            const truncReason = String(errorReason).split('\n')[0].slice(0, 200);
            console.warn(`[Executor] job ${jobId.slice(0, 8)} ${cancelled ? 'CANCELLED' : 'FAILED'} after ${dur}s — ${errorPhase}: ${truncReason}`);
            this._currentJobId = null;
            this._wsHasFired = false;
            this._jobStartedAt = null;
            this._lastLoggedNodeId = null;
            this._notify();
        });
    }

    _shouldRecoverFromSage(errorReason) {
        return !!this.onSageIncompatible
            && !this._sageRecoveryDone
            && !this._recovering
            && isSageIncompatibility(errorReason);
    }

    // Take the job out of flight, fix the server, put the job back. The job
    // stays SCHEDULED throughout, so its job_deps rows remain valid and the
    // shots waiting on it are never collapsed by failBlockedJobs.
    async _recoverFromSage(jobId, errorReason) {
        this._recovering = true;
        this._sageRecoveryDone = true;
        const short = jobId.slice(0, 8);
        console.warn(`[Executor] job ${short} hit an acceleration flag its model cannot use — recovering`);
        this.queue.requeue(jobId, 'retrying without sage attention');
        this._currentJobId = null;
        this._wsHasFired = false;
        this._jobStartedAt = null;
        this._lastLoggedNodeId = null;
        this._notify();
        try {
            const ok = await this.onSageIncompatible({ jobId, errorReason });
            if (ok) {
                console.log(`[Executor] job ${short} will be retried`);
            } else {
                // Nothing could be changed (external ComfyUI, or the flag was
                // already off) — fail it honestly rather than loop forever.
                this.queue.transitionStatus(jobId, sm.STATES.FAILED, {
                    payload: { errorReason, errorPhase: 'executing' }
                });
                this._notify();
            }
        } catch (e) {
            console.error('[Executor] sage recovery failed:', e.message);
            try {
                this.queue.transitionStatus(jobId, sm.STATES.FAILED, {
                    payload: { errorReason, errorPhase: 'executing' }
                });
            } catch { /* already terminal */ }
            this._notify();
        } finally {
            this._recovering = false;
        }
    }

    _logProgress(jobId, stepsDone, stepsTotal, currentNodeId) {
        const now = Date.now();
        const isFirst = stepsDone <= 1;
        const isLast = stepsTotal && stepsDone === stepsTotal;
        // Throttle to once every 2s — but always log first/last step so the
        // user sees sampling start and finish.
        if (!isFirst && !isLast && (now - this._lastProgressLogAt) < 2000) return;
        this._lastProgressLogAt = now;
        const pct = stepsTotal ? `${Math.round((stepsDone / stepsTotal) * 100)}%` : '';
        const elapsed = this._jobStartedAt ? `${((now - this._jobStartedAt) / 1000).toFixed(1)}s` : '?';
        const tail = currentNodeId ? ` node=${currentNodeId}` : '';
        console.log(`[Executor] job ${jobId.slice(0, 8)} step ${stepsDone}/${stepsTotal || '?'} ${pct} t=${elapsed}${tail}`);
    }

    _summarizeParams(paramValues, exposed) {
        if (!paramValues) return '';
        const parts = [];
        for (const p of (exposed || [])) {
            const v = paramValues[p.key];
            if (v === undefined || v === null || v === '') continue;
            let display = v;
            if (typeof v === 'string' && v.length > 60) display = v.slice(0, 57) + '…';
            parts.push(`${p.key}=${typeof display === 'string' ? JSON.stringify(display) : display}`);
        }
        return parts.join(' ');
    }

    onChange(cb) { this._listeners.add(cb); return () => this._listeners.delete(cb); }
    _notify() { for (const cb of this._listeners) try { cb(); } catch (e) { console.error('[Executor] listener err:', e); } }

    start() {
        if (this.running) return;
        this.running = true;
        this._loop();
    }
    stop() { this.running = false; }

    async _loop() {
        while (this.running) {
            try {
                await this._tick();
            } catch (e) {
                console.error('[Executor] tick err:', e);
            }
            await new Promise(r => setTimeout(r, this.tickMs));
        }
    }

    async _tick() {
        // If we have a current job, watch for history-poll fallback (in case
        // WS dropped between submit and execution-finished).
        if (this._currentJobId) {
            await this._pollHistoryIfStale();
            return;
        }
        // Hold the queue while ComfyUI is down, coming back up, or busy with a
        // run that is not this executor's (an admin calibrating the served
        // workflow uses the same worker). Submitting now would throw "Worker
        // not idle" and the catch below marks the job FAILED — so a single
        // crash used to burn every job still waiting, one per tick, and a
        // calibration failed whatever came due while it ran.
        // Hold while ComfyUI is being restarted out from under us.
        if (this._recovering) return;
        const workerState = this.worker.getStatus?.().state;
        if (workerState && workerState !== 'idle') {
            if (this._heldFor !== workerState) {
                this._heldFor = workerState;
                console.log(`${this._tag()} holding the queue: ComfyUI is ${workerState}` +
                    (workerState === 'busy' ? ' with a run that is not a queued job (a calibration?)' : ''));
            }
            return;
        }
        this._heldFor = null;

        // Collapse any job whose chained input can never arrive (its source
        // failed, was cancelled, or was deleted) before looking for work —
        // otherwise a storyboard video waits forever on a frame that will
        // never be rendered. A no-op unless a batch is queued.
        const blocked = this.queue.failBlockedJobs();
        if (blocked.length) {
            console.warn(`[Executor] ${blocked.length} job(s) failed: dependency-failed`);
            this._notify();
        }

        // Otherwise look for the next ready job. findReady already skips jobs
        // whose chained inputs are not COMPLETED yet, so a waiting video never
        // blocks the images queued behind it.
        const ready = this.queue.findReady(Date.now(), this.workflowIds, { batch: this.batchPolicy?.() ?? null });
        if (!ready) return;

        // Reject jobs whose workflow disappeared / became unavailable.
        const wf = this.registry.get(ready.workflowId);
        if (!wf || wf.unavailable) {
            this.queue.transitionStatus(ready.id, sm.STATES.FAILED, {
                payload: { errorReason: wf?.reason || 'workflow-unavailable', errorPhase: 'pre-submit' }
            });
            this._notify();
            return;
        }

        if (this.beforeRun) {
            // Held like a recovery: this can restart ComfyUI, and a second tick
            // in the meantime would claim the same job.
            this._recovering = true;
            try {
                await this.beforeRun(wf);
            } catch (e) {
                console.error(`${this._tag()} could not get ComfyUI ready for ${wf.id}: ${e.message}`);
                if (this.queue.get(ready.id)?.status === sm.STATES.SCHEDULED) {
                    this.queue.transitionStatus(ready.id, sm.STATES.FAILED, {
                        payload: { errorReason: e.message, errorPhase: 'pre-submit' }
                    });
                    this._notify();
                }
                return;
            } finally {
                this._recovering = false;
            }
            // Cancelled meanwhile, or ComfyUI is not back yet: the next tick decides.
            if (this.queue.get(ready.id)?.status !== sm.STATES.SCHEDULED) return;
            const state = this.worker.getStatus?.().state;
            if (state && state !== 'idle') return;
        }

        await this._executeOne(ready, wf);
    }

    async _executeOne(job, workflowEntry) {
        this._currentJobId = job.id;
        this._wsHasFired = false;
        this._historyStartedAt = null;
        this._jobStartedAt = Date.now();
        this._lastProgressLogAt = 0;
        this._lastLoggedNodeId = null;

        const wfName = workflowEntry.summary?.name || workflowEntry.id;
        console.log(`[Executor] picking up job ${job.id.slice(0, 8)} user=${job.userId} workflow=${workflowEntry.id} (${wfName})`);
        const paramSummary = this._summarizeParams(job.paramValues, workflowEntry.effective?.exposedParameters);
        if (paramSummary) console.log(`[Executor]   params: ${paramSummary}`);
        if (job.inputFiles?.length) {
            console.log(`[Executor]   inputs: ${job.inputFiles.map(f => `${f.field}=${f.comfyFilename}`).join(' ')}`);
        }

        try {
            this.queue.transitionStatus(job.id, sm.STATES.UPLOADING_INPUTS);
            // Inputs were already copied into ComfyUI/input by the upload route
            // and recorded in job.inputFiles. v2 doesn't re-upload here — but
            // we surface this state for clarity / future remote workers.

            // Storyboard chaining: a media param may be fed by an earlier job's
            // output rather than an upload. Copy that output into ComfyUI/input
            // now and persist the resolved filename, so the stored job records
            // what actually ran. Fail loudly rather than submit with the
            // parameter unset — the graph would otherwise quietly render
            // whatever filename its api.json shipped with.
            const deps = this.queue.depsFor(job.id);
            if (deps.length > 0) {
                const chain = resolveChainedInputs({
                    job, deps, queue: this.queue, comfyConfig: this.comfyConfig
                });
                if (chain.errors.length > 0) {
                    throw new Error(`chained input unavailable — ${chain.errors.join('; ')}`);
                }
                job = this.queue.setParamValues(job.id, chain.paramValues);
                for (const r of chain.resolved) {
                    console.log(`[Executor]   chained ${r.paramKey} ← job ${r.sourceJobId.slice(0, 8)} (${r.originalName})`);
                }
            }

            const filenamePrefix = this._buildFilenamePrefix(job);
            this.queue.transitionStatus(job.id, sm.STATES.SUBMITTED);
            await this.worker.submit(job.id, workflowEntry.apiWorkflow, {
                workflowId: workflowEntry.id,
                exposedParameters: workflowEntry.effective.exposedParameters,
                paramValues: job.paramValues,
                inputs: job.inputFiles,
                filenamePrefix,
                requirements: workflowEntry.meta.requirements
            });
            // Worker.submit emits 'submitted' which transitions → EXECUTING.
            // No runtime budget: a job runs until ComfyUI finishes or a user/admin
            // cancels it. `_historyStartedAt` only drives the poll-interval ramp.
            this._historyStartedAt = Date.now();
        } catch (e) {
            console.error('[Executor] submit err:', e.message);
            try {
                this.queue.transitionStatus(job.id, sm.STATES.FAILED, {
                    payload: { errorReason: e.message, errorPhase: 'submit' }
                });
            } catch { /* may already be terminal */ }
            // Some failures inside worker.submit happen after it marked itself
            // busy with this job and before it could reset. Release it, or the
            // hold in _tick (worker not idle) would stall the queue for ever.
            try {
                if (this.worker.getStatus?.().currentJobId === job.id) this.worker.finalize({ success: false });
            } catch { /* nothing to release */ }
            this._currentJobId = null;
            this._notify();
        }
    }

    _tag() { return this.label ? `[Executor ${this.label}]` : '[Executor]'; }

    _buildFilenamePrefix(job) {
        // A storyboard job carries its own prefix — a folder plus a name built
        // from the shot's own headings — so its results are findable on disk
        // instead of being a wall of timestamps. ComfyUI treats a "/" in
        // filename_prefix as a subfolder under its output dir.
        if (job.outputPrefix) return job.outputPrefix;
        const d = new Date(job.scheduledAt);
        const z = (n, w = 2) => String(n).padStart(w, '0');
        const stamp = `${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}_${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}`;
        const safeUser = (job.userId || 'anon').replace(/[^a-zA-Z0-9_-]/g, '_');
        return `${safeUser}_${stamp}_${job.id.slice(0, 8)}`;
    }

    async _pollHistoryIfStale() {
        if (this._wsHasFired) return; // collection already in progress
        const job = this.queue.get(this._currentJobId);
        if (!job || !job.promptId) return;

        const elapsed = this._historyStartedAt ? Date.now() - this._historyStartedAt : 0;
        const interval = elapsed < FAST_POLL_WINDOW_MS ? FAST_POLL_MS : SLOW_POLL_MS;
        // Throttle polls based on interval.
        if (this._lastPollAt && (Date.now() - this._lastPollAt) < interval) return;
        this._lastPollAt = Date.now();

        try {
            const data = await this.worker.rest.getHistory(job.promptId);
            if (data && data[job.promptId]) {
                await this._collectAndComplete(job.id, job.promptId);
            }
        } catch (e) {
            // ignore — history may not be ready yet
        }
    }

    // Recorded so abortCurrent can let a finished render finish collecting
    // instead of failing a job that is already done.
    _collectAndComplete(jobId, promptId) {
        const run = this._collectOnce(jobId, promptId);
        this._collecting = { jobId, settled: run.then(() => {}, () => {}) };
        return run;
    }

    async _collectOnce(jobId, promptId) {
        let history;
        try { history = await this.worker.rest.getHistory(promptId); }
        catch (e) {
            if (this._currentJobId !== jobId) return;
            return this._failCurrent(`history fetch failed: ${e.message}`, 'collecting-outputs');
        }
        // The job may have been settled while this waited (abortCurrent, when
        // its lane closed): then it is not ours to complete, and the worker may
        // already be on another job — touch neither.
        if (this._currentJobId !== jobId) return;
        const entry = history?.[promptId];
        if (!entry) return; // not ready yet

        // ComfyUI may report execution status; check for failure.
        const statusObj = entry.status;
        if (statusObj && statusObj.status_str === 'error') {
            const errMsg = statusObj.messages?.find(m => m[0] === 'execution_error')?.[1];
            const reason = humanizeFailure(errMsg?.exception_message, errMsg?.node_type);
            return this._failCurrent(reason, 'executing');
        }

        // Move to collecting-outputs (idempotent if already there).
        try { this.queue.transitionStatus(jobId, sm.STATES.COLLECTING_OUTPUTS); }
        catch { /* ok if already collected */ }

        const raw = oc.collectFromHistory(entry, this.comfyConfig);
        const enriched = oc.enrich(raw, this.comfyConfig);
        // Fold any ComfyUI subfolder into `filename` so it's an output-root-
        // relative path (e.g. "audio/track_001.mp3"). The media route serves by
        // this path via /images/:filename(*), and result_filename inherits it —
        // otherwise a subfolder save (SaveAudioMP3 "audio/…", SaveGLB "3d/…")
        // would 404 when served by basename. `subfolder` is emptied so
        // resolveOutputPath (which joins baseDir/subfolder/filename) doesn't
        // double-count. Non-subfolder outputs are unchanged.
        const wireOutputs = enriched.map(o => ({
            kind: o.kind, mime: o.mime,
            filename: o.filename ? (o.subfolder ? `${o.subfolder}/${o.filename}` : o.filename) : null,
            subfolder: '', type: o.type, nodeId: o.nodeId,
            sizeBytes: o.sizeBytes,
            // Inline text outputs (PreviewAny etc.) carry their content on the wire.
            ...(o.text != null ? { text: o.text } : {})
        }));
        this.queue.setOutputs(jobId, wireOutputs);
        try {
            this.queue.transitionStatus(jobId, sm.STATES.COMPLETED, { payload: { outputs: wireOutputs } });
        } catch (e) {
            console.warn('[Executor] complete transition err:', e.message);
        }
        // Snapshot the imported media + parameters into the durable ingredients
        // store. The inputs are still on disk here (sweepStale only removes them
        // ~30 min later), so they can be downloaded/relaunched as a .zip later —
        // even after the machine switches to a different workflow.
        try { ingredientsStore.persist({ comfyConfig: this.comfyConfig, registry: this.registry, job: this.queue.get(jobId) }); }
        catch (e) { console.warn('[Executor] ingredients persist err:', e.message); }
        const dur = this._jobStartedAt ? ((Date.now() - this._jobStartedAt) / 1000).toFixed(1) : '?';
        console.log(`[Executor] job ${jobId.slice(0, 8)} COMPLETED in ${dur}s — ${wireOutputs.length} output(s)`);
        for (const o of wireOutputs) {
            const sizeKb = o.sizeBytes ? `${Math.round(o.sizeBytes / 1024)} KB` : '?';
            const sub = o.subfolder ? `${o.subfolder}/` : '';
            const label = o.filename ? `${sub}${o.filename}`
                : (o.kind === 'text' ? `"${String(o.text).replace(/\s+/g, ' ').slice(0, 60)}…"` : '[inline]');
            console.log(`[Executor]   → ${label} (${o.kind}, ${sizeKb})`);
        }
        this.worker.finalize({ success: true });
        this._currentJobId = null;
        this._historyStartedAt = null;
        this._wsHasFired = false;
        this._jobStartedAt = null;
        this._lastLoggedNodeId = null;
        this._notify();
    }

    _failCurrent(reason, phase) {
        const id = this._currentJobId;
        if (!id) return;
        try {
            this.queue.transitionStatus(id, sm.STATES.FAILED, {
                payload: { errorReason: reason, errorPhase: phase }
            });
        } catch { /* may already be terminal */ }
        const dur = this._jobStartedAt ? ((Date.now() - this._jobStartedAt) / 1000).toFixed(1) : '?';
        const truncReason = String(reason).split('\n')[0].slice(0, 200);
        console.warn(`[Executor] job ${id.slice(0, 8)} FAILED after ${dur}s — ${phase}: ${truncReason}`);
        try { this.worker.finalize({ success: false }); } catch { /* ignore */ }
        this._currentJobId = null;
        this._historyStartedAt = null;
        this._wsHasFired = false;
        this._jobStartedAt = null;
        this._lastLoggedNodeId = null;
        this._notify();
    }

    async cancelJob(jobId) {
        const job = this.queue.get(jobId);
        if (!job) return false;
        if (sm.isTerminal(job.status)) return false;
        if (job.status === sm.STATES.SCHEDULED) {
            this.queue.transitionStatus(jobId, sm.STATES.CANCELLED);
            this._notify();
            return true;
        }
        // Currently executing → ask worker to interrupt (it will emit 'failed').
        if (this._currentJobId === jobId) {
            await this.worker.cancel(jobId);
            return true;
        }
        return false;
    }

    /**
     * The lane running this executor is closing (a live switch, a lane closed,
     * Stop serving): stop the job it is running on ComfyUI and fail it with
     * `reason`. Call stop() first so no new job is picked up meanwhile.
     * Without this, closing the lane on the install's ComfyUI — which stays up
     * — left its job "processing" until the next restart: ComfyUI went on
     * rendering it and nothing was left to collect the result or to cancel it.
     *
     * ★ Stops THIS job's prompt, never whatever ComfyUI is running, in the
     * same order as worker.cancel(): the install's ComfyUI stays up and, with
     * LAN access on, the run in progress may be an admin's while ours still
     * waits behind it — a body-less interrupt killed theirs and left ours in
     * the queue to render with nobody collecting it. With no prompt id yet the
     * job is still inside worker.submit and there is nothing to stop by id: it
     * is only failed, which releases the worker — a prompt ComfyUI accepts
     * after that is the worker's to drop.
     */
    async abortCurrent(reason) {
        const id = this._currentJobId;
        if (!id) return false;
        if (this._collecting?.jobId !== id) {           // still rendering, or not submitted yet
            const st = this.worker.getStatus?.() || {};
            const promptId = st.currentJobId === id ? st.currentPromptId : null;
            if (promptId) {
                try { await this.worker.rest?.deleteFromQueue?.([promptId]); } catch { /* ComfyUI already gone */ }
                try { await this.worker.rest?.interrupt?.(promptId); } catch { /* ComfyUI already gone */ }
            }
        }
        // A render that has finished is being collected: let that complete the
        // job rather than fail one that is done.
        if (this._collecting?.jobId === id) await this._collecting.settled;
        if (this._currentJobId !== id) return true;        // finished or failed meanwhile
        this._failCurrent(reason, 'executing');
        return true;
    }
}

module.exports = { JobExecutor };
