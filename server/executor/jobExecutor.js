const sm = require('../queue/jobStateMachine');
const oc = require('./outputCollector');

const FAST_POLL_MS = 1000;        // first 60s
const SLOW_POLL_MS = 5000;        // after 60s
const FAST_POLL_WINDOW_MS = 60000;

// Drives the JobQueue + Worker. One job at a time in M0; the executor stays
// loop-driven so it composes cleanly with future multi-worker pools.
class JobExecutor {
    constructor({ queue, worker, registry, comfyConfig }) {
        this.queue = queue;
        this.worker = worker;
        this.registry = registry;
        this.comfyConfig = comfyConfig;
        this.running = false;
        this.tickMs = 1000;
        this._listeners = new Set();
        this._currentJobId = null;
        this._historyDeadline = null;
        this._historyStartedAt = null;
        this._wsHasFired = false;
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
            try { this.queue.transitionStatus(jobId, sm.STATES.FAILED, { payload: { errorReason, errorPhase } }); } catch { /* already terminal */ }
            const dur = this._jobStartedAt ? ((Date.now() - this._jobStartedAt) / 1000).toFixed(1) : '?';
            const truncReason = String(errorReason).split('\n')[0].slice(0, 200);
            console.warn(`[Executor] job ${jobId.slice(0, 8)} FAILED after ${dur}s — ${errorPhase}: ${truncReason}`);
            this._currentJobId = null;
            this._historyDeadline = null;
            this._wsHasFired = false;
            this._jobStartedAt = null;
            this._lastLoggedNodeId = null;
            this._notify();
        });
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
        // Otherwise look for the next ready job.
        const ready = this.queue.findReady();
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

            const filenamePrefix = this._buildFilenamePrefix(job);
            this.queue.transitionStatus(job.id, sm.STATES.SUBMITTED);
            await this.worker.submit(job.id, workflowEntry.apiWorkflow, {
                workflowId: workflowEntry.id,
                exposedParameters: workflowEntry.effective.exposedParameters,
                paramValues: job.paramValues,
                inputs: job.inputFiles,
                filenamePrefix,
                requirements: workflowEntry.meta.requirements,
                maxRuntimeSec: workflowEntry.meta.maxRuntimeSec
            });
            // Worker.submit emits 'submitted' which transitions → EXECUTING
            this._historyStartedAt = Date.now();
            this._historyDeadline = Date.now() + (workflowEntry.meta.maxRuntimeSec * 1000);
        } catch (e) {
            console.error('[Executor] submit err:', e.message);
            try {
                this.queue.transitionStatus(job.id, sm.STATES.FAILED, {
                    payload: { errorReason: e.message, errorPhase: 'submit' }
                });
            } catch { /* may already be terminal */ }
            this._currentJobId = null;
            this._notify();
        }
    }

    _buildFilenamePrefix(job) {
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

        if (this._historyDeadline && Date.now() > this._historyDeadline) {
            this._failCurrent('runtime-budget-exceeded', 'executing');
            return;
        }
        try {
            const data = await this.worker.rest.getHistory(job.promptId);
            if (data && data[job.promptId]) {
                await this._collectAndComplete(job.id, job.promptId);
            }
        } catch (e) {
            // ignore — history may not be ready yet
        }
    }

    async _collectAndComplete(jobId, promptId) {
        let history;
        try { history = await this.worker.rest.getHistory(promptId); }
        catch (e) { return this._failCurrent(`history fetch failed: ${e.message}`, 'collecting-outputs'); }
        const entry = history?.[promptId];
        if (!entry) return; // not ready yet

        // ComfyUI may report execution status; check for failure.
        const statusObj = entry.status;
        if (statusObj && statusObj.status_str === 'error') {
            const reason = statusObj.messages?.find(m => m[0] === 'execution_error')?.[1]?.exception_message
                || 'execution_error';
            return this._failCurrent(reason, 'executing');
        }

        // Move to collecting-outputs (idempotent if already there).
        try { this.queue.transitionStatus(jobId, sm.STATES.COLLECTING_OUTPUTS); }
        catch { /* ok if already collected */ }

        const raw = oc.collectFromHistory(entry);
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
        this._historyDeadline = null;
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
        this._historyDeadline = null;
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
}

module.exports = { JobExecutor };
