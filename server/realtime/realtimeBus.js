const fs = require('fs');
const { Server } = require('socket.io');
const sm = require('../queue/jobStateMachine');
const { isAuthorizedForJob } = require('../auth/authGate');
const { resolveOutputPath } = require('../executor/outputCollector');

const HEARTBEAT_MS = 5000;

// RealtimeBus — broadcasts state to clients and translates socket events into
// queue / executor actions. Wire format kept compatible with the v1 client:
//
// emit('state_update', {
//   system_status: 'starting' | 'idle' | 'busy' | 'down' | 'ready',
//   benchmark_ms,                              // active workflow's estimatedDurationSec * 1000
//   connected_users: [{ socketId, userId }],
//   jobs: [{ id, user_id, status, phase, time_slot, prompt, params,
//            result_filename, outputs, progress: { value, max } | null,
//            current_node, workflow_id, error_reason }],
//   workflow: { parameter_map },               // for active workflow
//   workflow_info: { id, name, description, category,
//                    samplesPerSec, estimatedDurationSec }  // for ETA + ProgressViz
// })
//
// Inbound events:
//   register_user(name)
//   book_job({ scheduledTime, prompt, params, user_id, workflow_id?, admin_password? })
//   delete_job(jobId)            with optional admin_password
//   reorder_job({ jobId, newTimeSlot })
//   cancel_job(jobId)            with optional admin_password
class RealtimeBus {
    constructor({ httpServer, queue, executor, registry, configManager, worker, comfyConfig }) {
        this.queue = queue;
        this.executor = executor;
        this.registry = registry;
        this.configManager = configManager;
        this.worker = worker;
        this.comfyConfig = comfyConfig;
        this.connectedUsers = new Map();

        this.io = new Server(httpServer, {
            cors: { origin: '*', methods: ['GET', 'POST'] }
        });
        this._wireEvents();

        // Broadcast on queue / worker change.
        queue.onChange(() => this.broadcast());
        worker.on('status', () => this.broadcast());
        executor.onChange(() => this.broadcast());
        setInterval(() => this.broadcast(), HEARTBEAT_MS);
    }

    _wireEvents() {
        this.io.on('connection', (socket) => {
            const guestId = `Guest-${socket.id.substring(0, 4)}`;
            this.connectedUsers.set(socket.id, { socketId: socket.id, userId: guestId });
            this.broadcast();

            socket.on('register_user', (name) => {
                if (!name) return;
                const u = this.connectedUsers.get(socket.id);
                if (u) { u.userId = String(name); this.connectedUsers.set(socket.id, u); }
                this.broadcast();
            });

            socket.on('book_job', (payload, ack) => {
                try {
                    const { scheduledTime, prompt, params = {}, user_id, workflow_id } = payload || {};
                    const me = this.connectedUsers.get(socket.id);
                    const userId = user_id || me?.userId || 'anon';
                    const cfg = this.configManager.load().config;
                    const wfId = workflow_id || cfg.workflows.activeWorkflowId;
                    if (!wfId) throw new Error('No active workflow configured');
                    const entry = this.registry.get(wfId);
                    if (!entry || entry.unavailable) throw new Error(`Workflow unavailable: ${entry?.reason || wfId}`);

                    const duration = (entry.summary?.estimatedDurationSec || entry.meta.estimatedDurationSec) * 1000;
                    const collisions = this.queue.findCollisions(scheduledTime, duration);
                    if (collisions.length > 0) throw new Error('Time slot collision detected');

                    // Stitch prompt into paramValues so the worker materializer
                    // doesn't have to special-case it. If a parameter exists
                    // with type 'textarea' and the workflow's first prompt
                    // node, set its value; otherwise put 'prompt' in params.
                    const paramValues = { ...params };
                    if (prompt && !paramValues.prompt) paramValues.prompt = prompt;
                    // Map paramValues['prompt'] to the first textarea-type
                    // exposed parameter if no key matches a textarea param.
                    const textParam = entry.effective.exposedParameters
                        .find(p => p.type === 'textarea' && (p.field === 'text' || p.field.includes('prompt')));
                    if (prompt && textParam && paramValues[textParam.key] == null) {
                        paramValues[textParam.key] = prompt;
                    }

                    const job = this.queue.insert({
                        userId,
                        workflowId: wfId,
                        workflowVersion: entry.meta.version,
                        scheduledAt: scheduledTime,
                        prompt: prompt || '',
                        paramValues,
                        createdBy: socket.id
                    });
                    if (typeof ack === 'function') ack({ ok: true, jobId: job.id });
                } catch (e) {
                    socket.emit('error', { message: e.message });
                    if (typeof ack === 'function') ack({ ok: false, error: e.message });
                }
            });

            socket.on('delete_job', (payload) => {
                try {
                    const jobId = typeof payload === 'string' ? payload : payload?.jobId;
                    const adminPassword = typeof payload === 'object' ? payload?.admin_password : null;
                    const job = this.queue.get(jobId);
                    if (!job) return;
                    const me = this.connectedUsers.get(socket.id);
                    const auth = isAuthorizedForJob({
                        socketUserId: me?.userId, providedPassword: adminPassword,
                        job, configManager: this.configManager
                    });
                    if (!auth.allowed) return socket.emit('error', { message: auth.reason });
                    if (sm.isInFlight(job.status) || job.status === sm.STATES.SCHEDULED) {
                        // Try cancelling first if executing; otherwise just remove.
                        if (sm.isInFlight(job.status)) this.executor.cancelJob(jobId);
                        else this.queue.transitionStatus(jobId, sm.STATES.CANCELLED);
                    }
                    this._deleteOutputFiles(job);
                    this.queue.delete(jobId);
                } catch (e) {
                    socket.emit('error', { message: e.message });
                }
            });

            socket.on('cancel_job', (payload) => {
                try {
                    const jobId = typeof payload === 'string' ? payload : payload?.jobId;
                    const adminPassword = typeof payload === 'object' ? payload?.admin_password : null;
                    const job = this.queue.get(jobId);
                    if (!job) return;
                    const me = this.connectedUsers.get(socket.id);
                    const auth = isAuthorizedForJob({
                        socketUserId: me?.userId, providedPassword: adminPassword,
                        job, configManager: this.configManager
                    });
                    if (!auth.allowed) return socket.emit('error', { message: auth.reason });
                    this.executor.cancelJob(jobId);
                } catch (e) {
                    socket.emit('error', { message: e.message });
                }
            });

            socket.on('reorder_job', (payload) => {
                try {
                    const { jobId, newTimeSlot, admin_password } = payload || {};
                    const job = this.queue.get(jobId);
                    if (!job) return;
                    const me = this.connectedUsers.get(socket.id);
                    const auth = isAuthorizedForJob({
                        socketUserId: me?.userId, providedPassword: admin_password,
                        job, configManager: this.configManager
                    });
                    if (!auth.allowed) return socket.emit('error', { message: auth.reason });
                    const cfg = this.configManager.load().config;
                    const entry = this.registry.get(job.workflowId);
                    const duration = ((entry?.summary?.estimatedDurationSec) || 60) * 1000;
                    const collisions = this.queue.findCollisions(newTimeSlot, duration, jobId);
                    if (collisions.length > 0) return socket.emit('error', { message: 'Time slot collision' });
                    this.queue.reorder(jobId, newTimeSlot);
                } catch (e) {
                    socket.emit('error', { message: e.message });
                }
            });

            socket.on('disconnect', () => {
                this.connectedUsers.delete(socket.id);
                this.broadcast();
            });
        });
    }

    // Best-effort deletion of any output files this job produced. Missing files
    // are ignored so a partially-cleaned-up job can still be removed.
    _deleteOutputFiles(job) {
        const outputs = job?.outputs || [];
        for (const o of outputs) {
            try {
                const abs = resolveOutputPath(o, this.comfyConfig);
                if (abs && fs.existsSync(abs)) fs.unlinkSync(abs);
            } catch (e) {
                console.warn(`[RealtimeBus] Could not delete output ${o.filename}:`, e.message);
            }
        }
    }

    _toWireJob(job) {
        const progress = (job.progress?.stepsDone != null && job.progress?.stepsTotal != null)
            ? { value: job.progress.stepsDone, max: job.progress.stepsTotal }
            : null;
        // Thumbnail filename for grid/sidebar cards. Prefer an image, then a
        // GLB mesh (renders in the inline ModelViewer), then anything. The GLB
        // preference is extension-based (not kind === 'model3d') so a splat
        // `.ply` never becomes the thumbnail — the client has no inline .ply/.spz
        // renderer; splats are viewed in the lightbox gallery only.
        const firstImage = job.outputs?.find(o => o.kind === 'image');
        const firstGlb = job.outputs?.find(o => /\.(glb|gltf)$/i.test(o.filename || ''));
        const firstAny = job.outputs?.[0];
        const resultFilename = (firstImage || firstGlb || firstAny)?.filename || null;
        return {
            id: job.id,
            user_id: job.userId,
            status: sm.toWireStatus(job.status),
            phase: job.status,
            time_slot: job.scheduledAt,
            prompt: job.prompt,
            params: job.paramValues,
            result_filename: resultFilename,
            outputs: job.outputs || [],
            progress,
            current_node: job.currentNode,
            workflow_id: job.workflowId,
            error_reason: job.errorReason
        };
    }

    broadcast() {
        try {
            const cfg = this.configManager.load().config;
            const activeId = cfg.workflows.activeWorkflowId;
            const entry = activeId ? this.registry.get(activeId) : null;
            const parameter_map = entry && !entry.unavailable
                ? this._buildParameterMap(entry.effective.exposedParameters)
                : {};
            const workflow_info = entry && !entry.unavailable ? {
                id: entry.id,
                name: entry.summary.name,
                description: entry.summary.description,
                category: entry.summary.category,
                samplesPerSec: entry.summary.samplesPerSec,
                estimatedDurationSec: entry.summary.estimatedDurationSec
            } : { id: null, name: 'No workflow configured', description: '', category: 'other', samplesPerSec: null, estimatedDurationSec: null };
            const benchmarkMs = entry && !entry.unavailable
                ? (entry.summary.estimatedDurationSec * 1000) : 60000;
            const workerStatus = this.worker.getStatus();
            const systemStatus = workerStatus.state === 'idle' || workerStatus.state === 'busy' ? 'ready' : workerStatus.state;
            const jobs = this.queue.list({ limit: 500 }).map(j => this._toWireJob(j));
            this.io.emit('state_update', {
                system_status: systemStatus,
                benchmark_ms: benchmarkMs,
                connected_users: Array.from(this.connectedUsers.values()),
                jobs,
                workflow: { parameter_map },
                workflow_info
            });
        } catch (e) {
            console.error('[RealtimeBus] broadcast err:', e);
        }
    }

    _buildParameterMap(exposed) {
        const out = {};
        for (const p of exposed) {
            if (p.enabled === false) continue;
            out[p.key] = {
                node_id: p.nodeId,
                field: p.field,
                type: p.type,
                label: p.label,
                default: p.default,
                enabled: true,
                order: p.order,
                options: p.options,
                min: p.min,
                max: p.max,
                step: p.step,
                maxInputEdge: p.maxInputEdge,
                disabledWhen: p.disabledWhen,
                required: p.required
            };
        }
        return out;
    }
}

module.exports = { RealtimeBus };
