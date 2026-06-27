// Federation (Phase F) — the single source of truth for the LAN status payload.
//
// buildSnapshot() is called by BOTH the UDP beacon (server/federation/beacon.js)
// and GET /federation/self (server/routes/federation.js) so the two can never
// drift. It reads only already-computed state — no new probing of ComfyUI:
//   - mode               ← config.mode
//   - comfy liveness     ← runtime.comfyBackend.comfyStatus() (admin) / runtime.worker.getStatus() (student)
//   - active workflow    ← config.workflows.activeWorkflowId + registry summary
//   - planned/running    ← runtime.queue.list() (student only; admin has no live queue)

const sm = require('../queue/jobStateMachine');
const { lanAddresses } = require('./systemInfo');

const SNAPSHOT_VERSION = 1;
const MAX_SCHEDULED = 25;          // keep the datagram comfortably small
const PROMPT_MAX = 160;            // trim prompts for the wire

function trimPrompt(p) {
    const s = String(p || '').replace(/\s+/g, ' ').trim();
    return s.length > PROMPT_MAX ? s.slice(0, PROMPT_MAX - 1) + '…' : s;
}

function comfyState({ runtime, configManager }) {
    // Admin mode: the AdminCalibrator owns ComfyUI.
    if (runtime?.comfyBackend?.comfyStatus) {
        try {
            const s = runtime.comfyBackend.comfyStatus();
            return { running: !!s.running, external: !!s.external, wsConnected: !!s.wsConnected, port: s.port };
        } catch { /* fall through */ }
    }
    // Student mode: ComfyUI runs as part of the active worker.
    if (runtime?.worker?.getStatus) {
        try {
            const st = runtime.worker.getStatus();
            const port = configManager.load().config.comfy_ui.api_port;
            return { running: st.state !== 'down', external: false, wsConnected: !!st.wsConnected, port };
        } catch { /* fall through */ }
    }
    return { running: false, external: false, wsConnected: false, port: null };
}

function activeWorkflow({ config, registry }) {
    const id = config.workflows?.activeWorkflowId;
    if (!id) return null;
    try {
        const entry = registry.get(id);
        if (entry && !entry.unavailable) {
            return {
                id,
                name: entry.summary?.name || id,
                estimatedDurationSec: entry.summary?.estimatedDurationSec || null
            };
        }
        return { id, name: id, estimatedDurationSec: null, unavailable: true };
    } catch {
        return { id, name: id, estimatedDurationSec: null };
    }
}

function jobsState({ runtime, registry }) {
    const queue = runtime?.queue;
    if (!queue?.list) return { running: null, scheduled: [] };

    const estFor = (workflowId) => {
        try { return registry.get(workflowId)?.summary?.estimatedDurationSec || null; }
        catch { return null; }
    };
    const compact = (j) => ({
        id: j.id,
        user: j.userId,
        prompt: trimPrompt(j.prompt),
        status: j.status,
        scheduledAt: j.scheduledAt,
        startedAt: j.startedAt || null,
        estDurationSec: estFor(j.workflowId)
    });

    let running = null;
    const scheduled = [];
    try {
        // list() returns scheduled_at ASC across all statuses; partition the
        // non-terminal ones into "running now" (in-flight) vs "planned".
        for (const j of queue.list({ limit: 500 })) {
            if (sm.isTerminal(j.status)) continue;
            if (j.status === sm.STATES.SCHEDULED) {
                if (scheduled.length < MAX_SCHEDULED) scheduled.push(compact(j));
            } else if (!running) {
                running = compact(j);     // first in-flight job is the active one
            }
        }
    } catch { /* queue read failed — report empty */ }

    return { running, scheduled };
}

function buildSnapshot({ configManager, registry, runtime, sysInfo }) {
    const config = configManager.load().config;
    const fed = config.federation || {};
    return {
        v: SNAPSHOT_VERSION,
        id: sysInfo?.id || '',
        name: sysInfo?.name || '',
        ips: lanAddresses(),
        apiPort: config.server?.port || 3000,
        uiPort: 5173,                       // the Vite URL students open
        mode: config.mode,
        gpu: sysInfo?.gpu || '',
        vramGb: sysInfo?.vramGb || 0,
        ramGb: sysInfo?.ramGb || 0,
        comfy: comfyState({ runtime, configManager }),
        activeWorkflow: activeWorkflow({ config, registry }),
        jobs: jobsState({ runtime, registry }),
        federation: { enabled: fed.enabled !== false, intervalSec: fed.intervalSec || 15 },
        ts: Date.now()
    };
}

module.exports = { buildSnapshot, SNAPSHOT_VERSION };
