const { Worker } = require('./workerInterface');
const { ComfyProcess, killProcessOnPort } = require('./comfyProcess');
const { runningLaunch, launchDrift } = require('./launchSettings');
const { ComfyRestClient } = require('./comfyRestClient');
const { ComfyWsClient } = require('./comfyWsClient');
const { InputUploader, PLACEHOLDER_IMAGE } = require('./inputUploader');
const { ModelLifecycle } = require('./modelLifecycle');
const { humanizeFailure, humanizeSubmitRejection } = require('../executor/errorMessages');
const { validateSelects } = require('./selectValidation');
const { fillOptionalImages, unlinkEmptyMedia, applyWhenEmptySet } = require('./optionalMedia');
const { applyCamera } = require('./cameraAngle');
const { formatPromptValue } = require('./promptFormat');

const CLIENT_ID_PREFIX = 'comfyq';

// Snap a numeric parameter to the bounds its meta declares. The booking form
// applies the same rules on blur, but that is only the friendly half: values
// reach us straight off the wire, so this is where they are actually enforced.
// (A job once reached ComfyUI with Duration = -1 against a meta saying min 1.)
// `step` matters as much as min/max — a workflow that quantises its own inputs
// otherwise renders something quietly different from what was asked for.
function clampParamValue(v, p) {
    if (p.type !== 'number') return v;
    let n = typeof v === 'number' ? v : parseFloat(v);
    if (!Number.isFinite(n)) return Number.isFinite(p.default) ? p.default : undefined;
    const { min, max, step } = p;
    if (Number.isFinite(step) && step > 0) {
        const base = Number.isFinite(min) ? min : 0;
        let snapped = base + Math.round((n - base) / step) * step;
        // The 1e6 rounding only cleans up float steps (0.1 → 0.30000000000000004).
        // On whole numbers it is harmful: times 1e6, a seed above ~9e9 loses
        // integer precision and comes back fractional (…019 → …018.9).
        if (!Number.isInteger(step) || !Number.isInteger(base)) snapped = Math.round(snapped * 1e6) / 1e6;
        n = snapped;
    }
    if (Number.isFinite(min) && n < min) n = min;
    if (Number.isFinite(max) && n > max) n = max;
    return n;
}

// LocalComfyUIWorker — single-machine ComfyUI runner. Implements the Worker
// interface so the executor doesn't depend on locality. Owns one ComfyUI
// child process (or attaches to an external one), one REST client, one WS
// client (auto-reconnecting), one InputUploader, one ModelLifecycle.
// Crash-loop breaker (see _crashCoolOffMs).
const CRASH_LIMIT = 5;
const CRASH_WINDOW_MS = 15 * 60 * 1000;
const CRASH_COOLOFF_MS = 10 * 60 * 1000;

class LocalComfyUIWorker extends Worker {
    constructor({ comfyConfig, queueConfig, onMilestone, autoRespawn = false, onRespawn = null }) {
        super();
        // Connect host: what ComfyQ's REST/WS clients dial. Must be a real
        // loopback target — if an admin set api_host to a wildcard, fall back
        // to 127.0.0.1 (you can't *connect* to 0.0.0.0).
        const rawHost = comfyConfig.api_host;
        this.host = (rawHost === '0.0.0.0' || rawHost === '::') ? '127.0.0.1' : rawHost;
        // Bind host: what ComfyUI listens on. 0.0.0.0 when LAN access is enabled
        // so peers can reach ComfyUI's native UI; otherwise the loopback host.
        this.bindHost = comfyConfig.lan_access ? '0.0.0.0' : this.host;
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
            bindHost: this.bindHost,
            port: this.port,
            installationType: comfyConfig.installation_type,
            onMilestone: this.onMilestone,
            useSageAttention: comfyConfig.use_sage_attention,
            fp16Accumulation: comfyConfig.fp16_accumulation,
            // Per-lane state, so a second ComfyUI can run from the SAME portable
            // install without touching it: these directories live under ComfyQ.
            // Both are required for a second process — ComfyUI takes an
            // exclusive lock on <user-dir>/comfyui.db, and wipes its temp dir on
            // startup, so sharing either one breaks the other lane.
            userDir: comfyConfig.user_dir || null,
            tempDir: comfyConfig.temp_dir || null,
            vramHeadroomGb: comfyConfig.vram_headroom_gb || null
        });
        // Extra main.py arguments — only the lane integration test uses this
        // (--cpu on throwaway ports); a rig's config never sets it.
        if (Array.isArray(comfyConfig.extra_args)) this.process.extraArgs = comfyConfig.extra_args.map(String);
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

        // Crash recovery. A ComfyUI segfault (a bad VAE decode will do it) used
        // to leave the worker 'down' forever: the WS retried into a void and
        // every subsequent job failed with "Worker not idle (state=down)".
        // Opt-in so the admin calibrator, which stops and starts ComfyUI
        // deliberately, keeps its existing behaviour.
        this._autoRespawn = autoRespawn;
        this.onRespawn = onRespawn || (() => {});
        this._respawning = false;
        this._shuttingDown = false;
        // Registered ONCE here, not in start() — start() runs again on every
        // respawn and would otherwise stack a new listener each time.
        this.process.on('exited', (info) => this._onProcessExit(info));
    }

    // Backoff between respawn attempts: quick at first (a segfault leaves the
    // port free almost immediately), then patient, so a genuinely broken
    // install doesn't spin. Never gives up — a classroom rig should heal
    // itself even if ComfyUI is only fixed half an hour later.
    _respawnDelayMs(attempt) {
        const ladder = [2000, 5000, 10000, 20000, 30000];
        return ladder[Math.min(attempt, ladder.length - 1)];
    }

    // ★ A crash-loop breaker. Each respawn is a cold ComfyUI boot plus a model
    // reload, so a ComfyUI that dies on every job (a broken node, an OOM that
    // recurs) would thrash the card every thirty seconds for as long as nobody
    // looked. After CRASH_LIMIT unexpected exits inside CRASH_WINDOW_MS the
    // worker waits CRASH_COOLOFF_MS before trying again — still self-healing,
    // as a classroom rig must be, but at a pace that leaves the GPU alone and
    // the log readable.
    _crashCoolOffMs() {
        const now = Date.now();
        this._crashTimes = (this._crashTimes || []).filter(t => now - t < CRASH_WINDOW_MS);
        return this._crashTimes.length >= CRASH_LIMIT ? CRASH_COOLOFF_MS : 0;
    }

    _onProcessExit({ intentional } = {}) {
        console.warn('[Worker] ComfyUI process exited');
        this._setState('down');
        if (this.currentJobId) {
            const jobId = this.currentJobId;
            const promptId = this.currentPromptId;
            this._resetCurrent();
            this.emit('failed', { jobId, promptId, errorReason: 'comfyui-process-exited', errorPhase: 'executing' });
        }
        if (intentional || this._shuttingDown || !this._autoRespawn) return;
        (this._crashTimes = this._crashTimes || []).push(Date.now());
        this._respawnLoop();
    }

    async _respawnLoop() {
        if (this._respawning) return;
        this._respawning = true;
        console.warn('[Worker] ComfyUI died unexpectedly — restarting it automatically');
        for (let attempt = 0; !this._shuttingDown; attempt++) {
            const coolOff = this._crashCoolOffMs();
            if (coolOff) {
                const n = this._crashTimes.length;
                console.error(`[Worker] ComfyUI has exited ${n} times in ${CRASH_WINDOW_MS / 60000} min — waiting ${CRASH_COOLOFF_MS / 60000} min before the next restart. Check its log in .comfyq-lanes/logs/.`);
                this._setState('down', `crash-loop: ${n} exits in ${CRASH_WINDOW_MS / 60000} min, next restart in ${CRASH_COOLOFF_MS / 60000} min`);
                this._crashTimes = [];
            }
            const delay = Math.max(this._respawnDelayMs(attempt), coolOff);
            await new Promise(r => setTimeout(r, delay));
            if (this._shuttingDown) break;
            try {
                console.log(`[Worker] respawn attempt ${attempt + 1}…`);
                this.process.nextStartReason = 'crashed — restarted automatically';
                await this.start();
                console.log('[Worker] ComfyUI is back up — resuming the queue');
                this._respawning = false;
                try { this.onRespawn(); } catch (e) { console.warn('[Worker] onRespawn err:', e.message); }
                return;
            } catch (e) {
                console.error(`[Worker] respawn attempt ${attempt + 1} failed: ${e.message}`);
            }
        }
        this._respawning = false;
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
                // We attached to a ComfyUI we didn't spawn, so our --listen
                // setting was never applied — the external instance's own
                // bind address governs LAN reachability. ComfyQ can't inspect
                // that, so when lan_access is on, remind the operator that the
                // launcher (not ComfyQ) must pass --listen 0.0.0.0.
                if (this.bindHost === '0.0.0.0') {
                    console.log('[Worker] lan_access is ON, but this is an EXTERNAL ComfyUI ComfyQ did not launch.');
                    console.log('[Worker]   → LAN exposure depends on how it was started: it must include `--listen 0.0.0.0`.');
                    console.log('[Worker]   → Verify with: Get-NetTCPConnection -LocalPort ' + this.port + ' -State Listen  (LocalAddress should be 0.0.0.0, not 127.0.0.1).');
                }
            } else {
                console.log('[Worker] waiting for ComfyUI API to come up (this can take 30–90s on first launch)…');
            }
            await this.process.waitForApi();
            console.log('[Worker] ComfyUI API is responsive');
            // A respawn runs start() again; the previous WS client is still
            // reconnecting on a timer, so retire it before opening a new one
            // or both would handle every message.
            if (this.ws) {
                try { this.ws.close(); } catch { /* already closed */ }
                try { this.ws.removeAllListeners(); } catch { /* not an emitter */ }
            }
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
            this._setState('idle');
            return procStart;
        } catch (e) {
            this._setState('down', e.message);
            throw e;
        }
    }

    // Relaunch ComfyUI with `--use-sage-attention` dropped.
    //
    // Sage attention is an opt-in global speed-up that only supports certain
    // attention head dimensions, so one incompatible model in a batch kills
    // every job that uses it while the rest succeed. Rather than stranding the
    // batch, the flag is turned off and ComfyUI comes back without it.
    //
    // Returns false when there is nothing to do — the flag was already off, or
    // this is an external ComfyUI whose arguments we do not control.
    async restartWithoutSageAttention() {
        if (!this.process.useSageAttention) return false;
        if (!this.process.owned) {
            // Attached to a ComfyUI someone else launched; its flags are theirs.
            console.warn('[Worker] sage attention is incompatible with this model, but ComfyUI is EXTERNAL — ' +
                'relaunch it without --use-sage-attention.');
            return false;
        }
        console.warn('[Worker] sage attention is incompatible with this model — restarting ComfyUI without it');
        this.process.useSageAttention = false;
        try {
            await this.process.stop();
            this.process.nextStartReason = 'sage attention incompatible with a model';
            // stop() returns as soon as the kill is issued; start() would see the
            // dying instance still answering and "attach" to it instead of
            // spawning a fresh one with the new arguments.
            await this._waitForPortFree(20000);
            this.process._stopping = false;
            await this.start();
            console.log('[Worker] ComfyUI is back up without sage attention');
            return true;
        } catch (e) {
            console.error('[Worker] could not restart ComfyUI without sage attention:', e.message);
            this._setState('down', e.message);
            return false;
        }
    }

    // Make a ComfyUI we are about to REUSE match what this worker would start it
    // with (see launchSettings.js). ComfyUI outlives ComfyQ, so after a restart,
    // a live switch or a lane reopening the process may have been started for
    // other settings:
    //   • a perf flag ON that this lane runs without (a workflow's
    //     `disabledPerfFlags`, or the rig setting turned off) saves black
    //     images — that process is replaced whoever started it;
    //   • any other difference — a speed-up this lane runs WITH, LAN access,
    //     another install — relaunches a ComfyUI that ComfyQ started; one an
    //     admin started by hand is theirs, so it is left alone and named.
    //   • except a hand-started ComfyUI of ANOTHER install: uploads go to the
    //     configured install, so every job with an input would fail. ComfyQ
    //     refuses to serve on it, and does not kill what somebody else started.
    // When nothing differs nothing restarts, which is the whole point of reuse.
    //
    // `ours`: the caller has proved the running ComfyUI is ComfyQ's own even
    // though this worker has no PID record of it (a lane that found its own
    // user directory in the argv). It is then relaunched like an owned one —
    // killed by port, since there is no PID to stop — instead of being left
    // alone as a hand-started ComfyUI.
    async ensureLaunchSettings({ ours = false } = {}) {
        let argv = null;
        try { argv = (await this.rest.ping())?.system?.argv; } catch { /* not answering: nothing to compare */ }
        const wanted = {
            use_sage_attention: this.process.useSageAttention,
            fp16_accumulation: this.process.fp16Accumulation,
            bindHost: this.process.bindHost,
            rootPath: this.process.rootPath,
        };
        const drift = launchDrift(wanted, runningLaunch(argv));
        if (drift.length === 0) return { replaced: false, drift };
        const what = drift.map(d => d.text).join('; ');
        const foreign = drift.find(d => d.key === 'root_path');
        if (foreign && !(ours || this.process.owned)) {
            const e = new Error(`The ComfyUI on port ${this.port} runs from ${foreign.running}, not from the install in the settings (${foreign.wanted}). ` +
                'Jobs with an uploaded input would fail on it, so ComfyQ did not start serving. ' +
                'Close that ComfyUI, or change the port under Manage ComfyUI → Startup options.');
            e.noRetry = true;
            throw e;
        }
        if (!drift.some(d => d.breaks) && !(ours || this.process.owned)) {
            console.warn(`[Worker] the ComfyUI on port ${this.port} was started outside ComfyQ and does not match the settings (${what}) — ` +
                'leaving it as it is; close it and let ComfyQ start its own to apply them');
            return { replaced: false, drift };
        }
        console.warn(`[Worker] relaunching the ComfyUI on port ${this.port}: ${what}`);
        try {
            if (this.process.owned) await this.process.stop();
            else await this._killOnPort(this.port);
            await this._waitForPortFree(20000);
            this.process._stopping = false;
            const reason = `relaunched because ${what}`;
            this.process.nextStartReason = reason;
            await this.start();
            // start() consumes the reason only when it launches; when it
            // attached to whatever still answers, the reason must not label
            // the next real launch.
            const launched = this.process.nextStartReason !== reason;
            if (!launched) this.process.nextStartReason = 'start';
            // ★ Check what is answering NOW. A refused taskkill, or a port
            // released too slowly, leaves the old process up, and start() then
            // simply attaches to it again — the lane would go on serving with
            // the flag that blacks out its output while the log says
            // "relaunching". That must stop the lane from opening instead.
            let argvAfter = null;
            try { argvAfter = (await this.rest.ping())?.system?.argv; } catch { /* checked below */ }
            const left = launchDrift(wanted, runningLaunch(argvAfter));
            const broken = left.filter(d => d.breaks);
            if (broken.length) {
                throw new Error(`could not stop the ComfyUI on port ${this.port} (${broken.map(d => d.text).join('; ')}) — close it and retry`);
            }
            if (!launched || left.length) {
                console.warn(`[Worker] the ComfyUI on port ${this.port} could not be replaced; it keeps running as it was` +
                    (left.length ? ` (${left.map(d => d.text).join('; ')})` : ''));
                return { replaced: false, drift: left };
            }
            return { replaced: true, drift };
        } catch (e) {
            console.error('[Worker] could not relaunch ComfyUI with the current settings:', e.message);
            this._setState('down', e.message);
            throw e;
        }
    }

    // Force-kill whatever listens on the port. A method so the tests can
    // replace it: the real one runs netstat and `taskkill /F /T`.
    async _killOnPort(port) {
        return killProcessOnPort(port);
    }

    async _waitForPortFree(timeoutMs = 20000) {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            if (!(await this.process.isApiResponsive())) return true;
            await new Promise(r => setTimeout(r, 500));
        }
        return false;
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
            const reason = humanizeFailure(data.exception_message || data.traceback, data.node_type);
            this._resetCurrent();
            this._setState('idle');
            // ★ Carry the raw diagnosis alongside the friendly reason. A student sees
            // `errorReason`; whoever has to FIX it needs the rest. The two Qwen
            // ControlNet bundles failed with "aimdo memory compile error" and nothing
            // more — the 120 lines that actually located the fault
            // (comfy_aimdo/malloc_graph.py:16, reached from common_ksampler) existed
            // only in ComfyUI's stdout, which nothing stores durably, so the sweep
            // report named the failure without being able to explain it.
            this.emit('failed', {
                jobId, promptId, errorReason: reason, errorPhase: 'executing',
                errorDetail: {
                    exceptionType: data.exception_type || null,
                    exceptionMessage: data.exception_message || null,
                    traceback: Array.isArray(data.traceback) ? data.traceback.join('') : (data.traceback || null),
                    nodeId: data.node_id ?? null,
                    nodeType: data.node_type || null,
                },
            });
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

        // 0) Linked values: a param's choice also sets other node fields (a LoRA
        //    dropdown writing its trigger word). Runs first so an exposed param
        //    targeting the same field overrides it.
        for (const p of exposedParameters) {
            if (!Array.isArray(p.linkedValues) || p.linkedValues.length === 0) continue;
            const raw = paramValues ? paramValues[p.key] : undefined;
            const chosen = (raw === undefined || raw === null || raw === '') ? p.default : raw;
            for (const l of p.linkedValues) {
                const node = wf[l.nodeId];
                if (!node) continue;
                const inMap = l.map && chosen !== undefined && Object.prototype.hasOwnProperty.call(l.map, String(chosen));
                const value = inMap ? l.map[String(chosen)] : l.fallback;
                if (value === undefined) continue;
                node.inputs = node.inputs || {};
                node.inputs[l.field] = value;
            }
        }

        // 1) Apply parameter values via exposedParameters mapping. For
        //    image/video/audio types the value is the comfy-side filename the
        //    /upload endpoint returned; injecting it directly is equivalent to
        //    going through the `inputs` array below.
        for (const p of exposedParameters) {
            if (paramValues == null) continue;
            const raw = paramValues[p.key];
            if (raw === undefined || raw === null || raw === '') continue;
            // A camera POSITION is one control over several fields — three
            // numbers on a CameraAngle node, or the nearest label in two
            // dropdowns — so it writes its own targets and skips the
            // single-field write below.
            if (p.type === 'camera') { applyCamera(wf, p, raw); continue; }
            const node = wf[p.nodeId];
            if (!node) continue;
            const clamped = clampParamValue(raw, p);
            if (clamped === undefined) continue;           // unusable number, leave the graph literal
            if (clamped !== raw) console.warn(`[Worker] param ${p.key}: ${JSON.stringify(raw)} adjusted to fit its declared bounds → ${clamped}`);
            const v = formatPromptValue(clamped, p.format);
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
        let paramValues = opts.paramValues || {};
        const inputs = opts.inputs || [];
        const filenamePrefix = opts.filenamePrefix;

        // Check dropdown values against the INSTALLED node before anything else.
        // ComfyUI rejects the whole prompt for one unknown combo string, so a
        // bundle's meta.json drifting from its node fails every job that picks
        // the stale option. Done here rather than in _materializeWorkflow so
        // that stays a pure, synchronously-testable function.
        // A validation VERDICT must stop the job; a validation FAILURE
        // (ComfyUI unreachable, odd schema) must not — it is a diagnostic.
        let verdict = null;
        try {
            const checked = await validateSelects({ apiWorkflow, exposedParameters, paramValues, rest: this.rest });
            for (const a of checked.adjustments) {
                console.log(`[Worker] param ${a.key}: ${JSON.stringify(a.from)} → ${JSON.stringify(a.to)} ` +
                    `(${a.why}; ${a.classType} offers the latter)`);
            }
            if (checked.errors.length > 0) verdict = checked.errors.join(' · ');
            else paramValues = checked.paramValues;
        } catch (e) {
            console.warn('[Worker] could not check dropdown values against ComfyUI:', e.message);
        }
        if (this.currentJobId !== jobId) return this._abandon(jobId, null);
        if (verdict) {
            this._resetCurrent();
            this._setState('idle');
            throw new Error(verdict);
        }

        // What the booking actually left empty. unlink and whenEmptySet judge
        // emptiness on THESE values, never on the placeholder-filled ones: a
        // slot holding the placeholder is still a slot the student left empty.
        const booked = paramValues;

        // Optional image inputs the booking left empty still need a real file:
        // ComfyUI validates every LoadImage, even one a switched-off branch reads.
        const optional = fillOptionalImages({ exposedParameters, paramValues, placeholderName: PLACEHOLDER_IMAGE });
        if (optional.errors.length > 0) {
            this._resetCurrent();
            this._setState('idle');
            throw new Error(optional.errors.join(' · '));
        }
        if (optional.filled > 0) {
            this.uploader.ensurePlaceholderImage();
            paramValues = optional.paramValues;
        }

        const lifecycleResult = await this.lifecycle.beforeJob({
            workflowId: opts.workflowId,
            minVRAM: opts.requirements?.minVRAM ?? 0
        });
        if (lifecycleResult.freed) console.log(`[Worker] /free invoked: ${lifecycleResult.reason}`);
        if (this.currentJobId !== jobId) return this._abandon(jobId, null);

        // Unused reference slots are removed from the graph rather than filled
        // with a placeholder the model would actually look at (see optionalMedia).
        const pruned = unlinkEmptyMedia({ apiWorkflow, exposedParameters, paramValues: booked });
        if (pruned.unlinked.length) {
            console.log(`[Worker] ${pruned.unlinked.length} unused reference input(s) removed from the graph: ${pruned.unlinked.join(', ')}`);
        }
        // A param left empty can also flip the graph onto its other branch —
        // without this, an edit with no pictures renders a 1024x1024 square and
        // ignores the chosen aspect ratio (see optionalMedia).
        const branched = applyWhenEmptySet({ apiWorkflow: pruned.workflow, exposedParameters, paramValues: booked });
        if (branched.applied.length) {
            console.log(`[Worker] empty input(s) switched the graph: ${branched.applied.join(', ')}`);
        }
        const wf = this._materializeWorkflow(branched.workflow, { paramValues, exposedParameters, inputs, filenamePrefix });

        let resp;
        try {
            resp = await this.rest.submitPrompt(wf, this.clientId);
        } catch (e) {
            if (this.currentJobId !== jobId) return this._abandon(jobId, null);
            this._resetCurrent();
            this._setState('idle');
            const err = new Error(e.response?.data
                ? humanizeSubmitRejection(e.response.data)
                : `/prompt rejected: ${e.message}`);
            err.cause = e;
            throw err;
        }

        // ★ Cancelled while the POST was in flight: ComfyUI has queued a prompt
        // that nobody will collect — and whose events, left as currentPromptId,
        // would be read as the NEXT job's. Take it back out instead.
        if (this.currentJobId !== jobId) return this._abandon(jobId, resp?.prompt_id || null);

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
        // ★ Stop THIS job's prompt, not whatever ComfyUI is running: with LAN
        // access on, the run in progress may be somebody else's, and ours may
        // still be waiting behind it — where it used to stay, and run later on
        // a worker that had already moved on. Queue first, then interrupt, so a
        // prompt that starts between the two calls is still caught. With no
        // prompt id yet, submit() may still be on its way to ComfyUI: resetting
        // the worker here is what tells it to stop, and it takes back a prompt
        // that got queued anyway (see _abandon).
        const promptId = this.currentPromptId;
        if (promptId) {
            try { await this.rest.deleteFromQueue([promptId]); } catch (e) { /* ignore */ }
            try { await this.rest.interrupt(promptId); } catch (e) { /* ignore */ }
            // Those two round trips leave room for the run to end on its own
            // and the executor to start the next job on this worker. Then
            // nothing of this job is left to reset — and resetting would wipe
            // the next job's tracking.
            if (this.currentJobId !== jobId) return false;
        }
        this._resetCurrent();
        this._setState('idle');
        this.emit('failed', { jobId, promptId, errorReason: 'cancelled', errorPhase: 'executing' });
        return true;
    }

    // A submit whose job was cancelled while it waited on ComfyUI. cancel()
    // has already reset the worker and failed the job, and the worker may be
    // serving another run by now — so touch none of its state and emit
    // nothing; only take back a prompt that reached ComfyUI anyway.
    async _abandon(jobId, promptId) {
        console.log(`[Worker] job ${jobId.slice(0, 8)} was cancelled while it was being submitted` +
            (promptId ? ` — its prompt ${promptId.slice(0, 8)} is taken back out of ComfyUI` : ''));
        if (promptId) {
            try { await this.rest.deleteFromQueue([promptId]); } catch (e) { /* ignore */ }
            try { await this.rest.interrupt(promptId); } catch (e) { /* ignore */ }
        }
        return { promptId: null, cancelled: true };
    }

    async shutdown() {
        this._shuttingDown = true;
        if (this.ws) this.ws.close();
        // Stop following its log and polling its PID; the process itself stays.
        try { this.process.detach(); } catch { /* nothing to detach */ }
        // Note: we do NOT kill the ComfyUI process on shutdown; the user may
        // be running their own ComfyUI we attached to. ComfyProcess only kills
        // on explicit stop().
    }
}

module.exports = { LocalComfyUIWorker, clampParamValue };
