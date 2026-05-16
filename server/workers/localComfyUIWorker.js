const { Worker } = require('./workerInterface');
const { ComfyProcess } = require('./comfyProcess');
const { ComfyRestClient } = require('./comfyRestClient');
const { ComfyWsClient } = require('./comfyWsClient');
const { InputUploader } = require('./inputUploader');
const { ModelLifecycle } = require('./modelLifecycle');

const CLIENT_ID_PREFIX = 'comfyq';

// LocalComfyUIWorker — single-machine ComfyUI runner. Implements the Worker
// interface so the executor doesn't depend on locality. Owns one ComfyUI
// child process (or attaches to an external one), one REST client, one WS
// client (auto-reconnecting), one InputUploader, one ModelLifecycle.
class LocalComfyUIWorker extends Worker {
    constructor({ comfyConfig, queueConfig, onMilestone }) {
        super();
        this.host = comfyConfig.api_host;
        this.port = comfyConfig.api_port;
        this.clientId = `${CLIENT_ID_PREFIX}-${Math.random().toString(36).slice(2, 8)}`;
        // Boot-milestone callback. server/index.js uses it to reprint the
        // LAN-URL banner so workshop admins don't lose the URLs to
        // ComfyUI's noisy startup output. Defaults to a no-op so tests
        // and other call sites can ignore it.
        this.onMilestone = onMilestone || (() => {});
        // One-shot guard — WS reconnects (close→open cycles) shouldn't
        // reprint the banner. Reset to false on every worker start.
        this._wsMilestoneFired = false;

        this.process = new ComfyProcess({
            rootPath: comfyConfig.root_path,
            pythonExecutable: comfyConfig.python_executable,
            host: this.host,
            port: this.port,
            installationType: comfyConfig.installation_type,
            onMilestone: this.onMilestone
        });
        this.rest = new ComfyRestClient({ host: this.host, port: this.port });
        this.uploader = new InputUploader({
            comfyInputDir: require('path').resolve(comfyConfig.root_path, 'input'),
            retentionMinutes: queueConfig.inputRetentionMinutes
        });
        this.lifecycle = new ModelLifecycle({ rest: this.rest, vramBudgetGb: comfyConfig.vramBudgetGb });

        this.ws = null;
        this._state = 'starting';
        this.currentJobId = null;
        this.currentPromptId = null;
        this.currentStepsTotal = null;
    }

    getStatus() {
        return {
            state: this._state,
            currentJobId: this.currentJobId,
            currentPromptId: this.currentPromptId,
            wsConnected: this.ws?.isOpen() || false
        };
    }

    _setState(state, detail) {
        this._state = state;
        this.emit('status', { state, detail });
    }

    async start() {
        try {
            console.log(`[Worker] checking ComfyUI at ${this.host}:${this.port}…`);
            const procStart = await this.process.start();
            if (procStart?.external) {
                console.log('[Worker] using external ComfyUI (already responding)');
            } else {
                console.log('[Worker] waiting for ComfyUI API to come up (this can take 30–90s on first launch)…');
            }
            await this.process.waitForApi();
            console.log('[Worker] ComfyUI API is responsive');
            this.ws = new ComfyWsClient({ host: this.host, port: this.port, clientId: this.clientId });
            this.ws.on('open', () => {
                console.log(`[Worker] WS connected (clientId=${this.clientId})`);
                // Reprint the LAN URL banner the FIRST time the WS opens this
                // boot. Skipped on reconnect so terminal noise stays low.
                if (!this._wsMilestoneFired) {
                    this._wsMilestoneFired = true;
                    this.onMilestone('Worker connected — ComfyUI ready for jobs');
                }
            });
            this.ws.on('close', () => console.log('[Worker] WS disconnected (will reconnect)'));
            this.ws.on('error', (e) => console.warn('[Worker] WS error:', e.message));
            this.ws.on('message', (msg) => this._handleWsMessage(msg));
            this.process.on('exited', () => {
                console.warn('[Worker] ComfyUI process exited');
                this._setState('down');
                if (this.currentJobId) {
                    const jobId = this.currentJobId;
                    const promptId = this.currentPromptId;
                    this._resetCurrent();
                    this.emit('failed', { jobId, promptId, errorReason: 'comfyui-process-exited', errorPhase: 'executing' });
                }
            });
            this._setState('idle');
            return procStart;
        } catch (e) {
            this._setState('down', e.message);
            throw e;
        }
    }

    _resetCurrent() {
        this.currentJobId = null;
        this.currentPromptId = null;
        this.currentStepsTotal = null;
    }

    _handleWsMessage(msg) {
        const { type, data } = msg || {};
        if (!data || !this.currentPromptId || data.prompt_id !== this.currentPromptId) return;
        const jobId = this.currentJobId;
        const promptId = this.currentPromptId;

        if (type === 'progress') {
            this.currentStepsTotal = data.max ?? this.currentStepsTotal;
            this.emit('progress', {
                jobId, promptId,
                stepsDone: data.value, stepsTotal: data.max,
                currentNodeId: data.node || null
            });
        } else if (type === 'executing') {
            // node === null AND prompt_id present → execution finished for this prompt
            if (data.node == null) {
                // Ask executor to finalize via history fetch + output collection.
                this.emit('execution-finished', { jobId, promptId });
            } else {
                this.emit('node-executing', { jobId, promptId, nodeId: String(data.node), nodeTitle: null });
            }
        } else if (type === 'execution_error') {
            const reason = data.exception_message || data.traceback || 'execution_error';
            this._resetCurrent();
            this._setState('idle');
            this.emit('failed', { jobId, promptId, errorReason: reason, errorPhase: 'executing' });
        } else if (type === 'execution_cached') {
            // nodes were cached, just informational
        }
    }

    // Apply user param values into the API workflow at known node/field
    // locations. Inject filename_prefix into ANY node that has that field
    // (no class_type whitelist). Inject input filenames at LoadImage/LoadAudio/
    // LoadVideo locations specified by the per-input record.
    _materializeWorkflow(apiWorkflow, { paramValues, exposedParameters, inputs, filenamePrefix }) {
        const wf = JSON.parse(JSON.stringify(apiWorkflow));

        // 1) Apply parameter values via exposedParameters mapping. For
        //    image/video/audio types the value is the comfy-side filename the
        //    /upload endpoint returned; injecting it directly is equivalent to
        //    going through the `inputs` array below.
        for (const p of exposedParameters) {
            if (paramValues == null) continue;
            const v = paramValues[p.key];
            if (v === undefined || v === null || v === '') continue;
            const node = wf[p.nodeId];
            if (!node) continue;
            node.inputs = node.inputs || {};
            node.inputs[p.field] = v;
        }

        // 2) Apply input file references (already copied into ComfyUI/input by
        //    the executor — we just inject the filename here).
        for (const f of inputs || []) {
            const node = wf[f.nodeId];
            if (!node) continue;
            node.inputs = node.inputs || {};
            node.inputs[f.field] = f.comfyFilename;
        }

        // 3) Inject filename_prefix into every node that already has that
        //    field. Generic — works for SaveImage, SaveVideo, VHS_VideoCombine,
        //    custom save nodes. Doesn't add the field where it didn't exist.
        for (const node of Object.values(wf)) {
            if (node && node.inputs && Object.prototype.hasOwnProperty.call(node.inputs, 'filename_prefix')) {
                node.inputs.filename_prefix = filenamePrefix;
            }
        }
        return wf;
    }

    async submit(jobId, apiWorkflow, opts) {
        if (this._state !== 'idle') {
            throw new Error(`Worker not idle (state=${this._state})`);
        }
        this._setState('busy');
        this.currentJobId = jobId;
        const exposedParameters = opts.exposedParameters || [];
        const paramValues = opts.paramValues || {};
        const inputs = opts.inputs || [];
        const filenamePrefix = opts.filenamePrefix;

        const lifecycleResult = await this.lifecycle.beforeJob({
            workflowId: opts.workflowId,
            minVRAM: opts.requirements?.minVRAM ?? 0
        });
        if (lifecycleResult.freed) console.log(`[Worker] /free invoked: ${lifecycleResult.reason}`);

        const wf = this._materializeWorkflow(apiWorkflow, { paramValues, exposedParameters, inputs, filenamePrefix });

        let resp;
        try {
            resp = await this.rest.submitPrompt(wf, this.clientId);
        } catch (e) {
            this._resetCurrent();
            this._setState('idle');
            const detail = e.response?.data ? JSON.stringify(e.response.data) : e.message;
            const err = new Error(`/prompt rejected: ${detail}`);
            err.cause = e;
            throw err;
        }

        if (!resp || !resp.prompt_id) {
            this._resetCurrent();
            this._setState('idle');
            const nodeErrors = resp?.node_errors;
            throw new Error(`/prompt did not return prompt_id${nodeErrors ? `: ${JSON.stringify(nodeErrors)}` : ''}`);
        }

        this.currentPromptId = resp.prompt_id;
        const queueAhead = (resp.number != null) ? resp.number : '?';
        console.log(`[Worker] job ${jobId.slice(0, 8)} accepted by ComfyUI — prompt=${this.currentPromptId.slice(0, 8)} queue#=${queueAhead}`);
        this.emit('submitted', { jobId, promptId: this.currentPromptId });
        return { promptId: this.currentPromptId };
    }

    // Called by the executor after collecting outputs (on 'execution-finished'
    // or via polling fallback). Releases the worker for the next job.
    finalize({ success }) {
        const jobId = this.currentJobId;
        const promptId = this.currentPromptId;
        this._resetCurrent();
        this._setState('idle');
        return { jobId, promptId, success };
    }

    async cancel(jobId) {
        if (this.currentJobId !== jobId) {
            // Job may still be in queue (not yet submitted). Executor handles that case.
            return false;
        }
        try { await this.rest.interrupt(); } catch (e) { /* ignore */ }
        const promptId = this.currentPromptId;
        this._resetCurrent();
        this._setState('idle');
        this.emit('failed', { jobId, promptId, errorReason: 'cancelled', errorPhase: 'executing' });
        return true;
    }

    async shutdown() {
        if (this.ws) this.ws.close();
        // Note: we do NOT kill the ComfyUI process on shutdown; the user may
        // be running their own ComfyUI we attached to. ComfyProcess only kills
        // on explicit stop().
    }
}

module.exports = { LocalComfyUIWorker };
