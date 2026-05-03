const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { setAdminPassword, checkAdminPassword } = require('../auth/authGate');
const { WorkflowMeta } = require('../config/schemas');
const { validateApiWorkflow } = require('../workflows/workflowValidator');
const { parseWorkflow } = require('../workflows/workflowParser');
const sm = require('../queue/jobStateMachine');

function sanitizeId(s) {
    return String(s).toLowerCase().replace(/[^a-z0-9_-]/g, '_').replace(/^_+|_+$/g, '');
}

function makeRouter({ configManager, registry, adminGate, exitForRestart, runtime }) {
    const router = express.Router();
    const memUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

    router.get('/mode', (req, res) => {
        const { config } = configManager.load();
        res.json({ mode: config.mode });
    });

    router.get('/config', (req, res) => {
        const { config } = configManager.load();
        // Never leak the password hash.
        const safe = JSON.parse(JSON.stringify(config));
        if (safe.auth) delete safe.auth.adminPasswordHash;
        const hasAdminPassword = !!config.auth.adminPasswordHash;
        res.json({ config: safe, hasAdminPassword });
    });

    // First-run / admin: set ComfyUI paths and server settings.
    router.put('/comfy', express.json(), (req, res) => {
        try {
            const { root_path, python_executable, output_dir, api_host, api_port, autoStart, vramBudgetGb, installation_type } = req.body || {};
            configManager.update(c => {
                if (root_path !== undefined) c.comfy_ui.root_path = root_path;
                if (python_executable !== undefined) c.comfy_ui.python_executable = python_executable;
                if (output_dir !== undefined) c.comfy_ui.output_dir = output_dir;
                if (api_host !== undefined) c.comfy_ui.api_host = api_host;
                if (api_port !== undefined) c.comfy_ui.api_port = api_port;
                if (autoStart !== undefined) c.comfy_ui.autoStart = autoStart;
                if (vramBudgetGb !== undefined) c.comfy_ui.vramBudgetGb = vramBudgetGb;
                if (installation_type !== undefined) c.comfy_ui.installation_type = installation_type;
                return c;
            });
            res.json({ ok: true });
        } catch (e) { res.status(400).json({ error: e.message }); }
    });

    // Set / clear the admin password. Allowed without auth ONLY when no
    // password is currently set (first-run). Otherwise requires the current
    // password via X-Admin-Password header.
    router.put('/admin-password', express.json(), (req, res) => {
        try {
            const { config } = configManager.load();
            const hasExisting = !!config.auth.adminPasswordHash;
            if (hasExisting) {
                const provided = req.headers['x-admin-password'];
                if (!checkAdminPassword(provided, configManager)) {
                    return res.status(401).json({ error: 'admin password required' });
                }
            }
            const { password } = req.body || {};
            setAdminPassword(password || '', configManager);
            res.json({ ok: true });
        } catch (e) { res.status(400).json({ error: e.message }); }
    });

    // Activate a workflow and switch to student mode.
    router.post('/activate-workflow', express.json(), (req, res) => {
        try {
            const { workflowId } = req.body || {};
            if (!workflowId) return res.status(400).json({ error: 'workflowId required' });
            const entry = registry.get(workflowId);
            if (!entry || entry.unavailable) {
                return res.status(409).json({ error: entry?.reason || 'workflow unavailable' });
            }
            const prev = configManager.load().config;
            const prevId = prev.workflows.activeWorkflowId;
            const prevMode = prev.mode;
            console.log(`[Admin] activate-workflow: ${prevId || '(none)'} → ${workflowId}  (mode: ${prevMode} → student)`);
            console.log(`[Admin]   name="${entry.summary?.name}"  category=${entry.summary?.category}  exposedParams=${entry.effective?.exposedParameters?.length ?? '?'}`);
            // Warn (don't block) if scheduled jobs exist for the previous workflow.
            if (runtime?.queue && prevId && prevId !== workflowId) {
                try {
                    const sm = require('../queue/jobStateMachine');
                    const stale = runtime.queue.list({ status: sm.STATES.SCHEDULED, limit: 1000 })
                        .filter(j => j.workflowId !== workflowId);
                    if (stale.length > 0) {
                        console.warn(`[Admin]   ${stale.length} scheduled job(s) reference the previous workflow and will run with their original workflow if it is still available on disk`);
                    }
                } catch { /* non-critical */ }
            }
            configManager.update(c => {
                c.workflows.activeWorkflowId = workflowId;
                c.mode = 'student';
                return c;
            });
            console.log(`[Admin] config updated; restarting…`);
            res.json({ ok: true, mode: 'student', workflowId });
            if (exitForRestart) setTimeout(() => exitForRestart(), 250);
        } catch (e) { res.status(400).json({ error: e.message }); }
    });

    router.post('/reset-to-admin', adminGate, (req, res) => {
        configManager.update(c => { c.mode = 'admin'; return c; });
        res.json({ ok: true, mode: 'admin' });
        if (exitForRestart) setTimeout(() => exitForRestart(), 250);
    });

    router.post('/restart-server', adminGate, (req, res) => {
        res.json({ ok: true });
        if (exitForRestart) setTimeout(() => exitForRestart(), 250);
    });

    // Emergency stop: cancel every non-terminal job, interrupt + kill the
    // ComfyUI process (only the one we spawned — external attached ComfyUI
    // is left alone), switch to admin mode, and restart the server.
    router.post('/emergency-stop', adminGate, async (req, res) => {
        if (!runtime?.queue || !runtime?.worker) {
            return res.status(409).json({ error: 'emergency-stop is only available in student mode' });
        }
        const result = { cancelledScheduled: 0, failedInFlight: 0, killedComfy: false };
        try {
            // Mark scheduled jobs as cancelled.
            const scheduled = runtime.queue.list({ status: sm.STATES.SCHEDULED, limit: 10000 });
            for (const j of scheduled) {
                try {
                    runtime.queue.transitionStatus(j.id, sm.STATES.CANCELLED);
                    result.cancelledScheduled++;
                } catch { /* may have raced to terminal */ }
            }
            // Mark in-flight jobs as failed BEFORE killing ComfyUI so the
            // worker's 'failed' event lands as a no-op rather than a duplicate.
            const inFlight = [
                sm.STATES.UPLOADING_INPUTS, sm.STATES.SUBMITTED,
                sm.STATES.EXECUTING, sm.STATES.COLLECTING_OUTPUTS
            ];
            for (const status of inFlight) {
                const jobs = runtime.queue.list({ status, limit: 10000 });
                for (const j of jobs) {
                    try {
                        runtime.queue.transitionStatus(j.id, sm.STATES.FAILED, {
                            payload: { errorReason: 'emergency-stop', errorPhase: status }
                        });
                        result.failedInFlight++;
                    } catch { /* ignore */ }
                }
            }
            // Best-effort interrupt, then kill the spawned ComfyUI. If we're
            // attached to an external ComfyUI (process.proc === null) the
            // stop() is a no-op and we leave that process alone.
            try { await runtime.worker.rest.interrupt(); } catch { /* ignore */ }
            try {
                const hadSpawned = !!runtime.worker.process?.proc;
                await runtime.worker.process?.stop();
                result.killedComfy = hadSpawned;
            } catch (e) {
                console.warn('[admin] emergency-stop kill err:', e.message);
            }
            // Flip to admin mode and restart so we don't auto-relaunch ComfyUI.
            configManager.update(c => { c.mode = 'admin'; return c; });
            res.json({ ok: true, ...result, restarting: true });
            if (exitForRestart) setTimeout(() => exitForRestart(), 250);
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message, ...result });
        }
    });

    // Upload an API-format workflow JSON + auto-generate a meta.json scaffold.
    // Saves into <workflowsDir>/<id>/<id>.api.json + <id>.meta.json.
    // Admin can then click "Activate" to start using it.
    router.post('/upload-workflow', adminGate, memUpload.single('workflow'), (req, res) => {
        try {
            if (!req.file) return res.status(400).json({ error: 'no file uploaded' });
            const json = JSON.parse(req.file.buffer.toString('utf8'));
            const validation = validateApiWorkflow(json);
            if (!validation.valid) return res.status(400).json({ error: validation.error, format: validation.format });

            const cfg = configManager.load().config;
            const baseName = path.basename(req.file.originalname, '.json');
            const id = sanitizeId(req.body.id || baseName);
            if (!id) return res.status(400).json({ error: 'cannot derive workflow id from filename' });

            const dir = path.resolve(cfg.workflows.dir.startsWith('.')
                ? path.resolve(__dirname, '../..', cfg.workflows.dir)
                : cfg.workflows.dir, id);
            if (fs.existsSync(dir) && !req.body.force) {
                return res.status(409).json({ error: `workflow folder already exists: ${id}`, hint: 'pass force=true to overwrite' });
            }
            fs.mkdirSync(dir, { recursive: true });

            const apiFilename = `${id}.api.json`;
            fs.writeFileSync(path.join(dir, apiFilename), JSON.stringify(json, null, 2), 'utf8');

            const parsed = parseWorkflow(json);
            const meta = WorkflowMeta.parse({
                schemaVersion: 1,
                id,
                name: req.body.name || baseName.replace(/[_-]+/g, ' '),
                description: req.body.description || '',
                category: req.body.category || 'other',
                tags: [],
                author: req.body.author || 'Unknown',
                version: '1.0.0',
                workflowFile: apiFilename,
                apiFormat: true,
                requirements: { minVRAM: 0, models: [] },
                estimatedDurationSec: 60,
                maxRuntimeSec: 600,
                exposedParameters: parsed.parameters,
                warmupParams: {},
                presets: {}
            });
            fs.writeFileSync(path.join(dir, `${id}.meta.json`), JSON.stringify(meta, null, 2), 'utf8');
            registry.discover();
            res.json({ ok: true, id, parameterCount: parsed.parameters.length });
        } catch (e) { res.status(400).json({ error: e.message }); }
    });

    // Edit-data for a workflow: current meta + ALL primitives detected in the
    // api.json (so the editor can re-enable params that were hidden previously).
    router.get('/workflows/:id/edit-data', adminGate, (req, res) => {
        try {
            const id = req.params.id;
            const entry = registry.get(id);
            if (!entry) return res.status(404).json({ error: 'unknown workflow' });
            if (entry.unavailable) return res.status(409).json({ error: entry.reason });
            const detected = parseWorkflow(entry.apiWorkflow).parameters;
            const exposedByKey = new Map();
            for (const p of entry.meta.exposedParameters) {
                exposedByKey.set(`${p.nodeId}:${p.field}`, p);
            }
            const merged = detected.map(d => {
                const found = exposedByKey.get(`${d.nodeId}:${d.field}`);
                if (found) {
                    return {
                        ...d,
                        type: found.type,
                        label: found.label,
                        default: found.default,
                        options: found.options ?? d.options,
                        min: found.min,
                        max: found.max,
                        step: found.step,
                        required: found.required ?? d.required,
                        order: found.order ?? d.order,
                        enabled: true
                    };
                }
                return { ...d, enabled: false };
            });
            res.json({ meta: entry.meta, detectedParameters: merged });
        } catch (e) { res.status(400).json({ error: e.message }); }
    });

    // Delete a workflow folder bundle. Refuses to delete the currently-active
    // workflow — caller must activate another (or reset to admin) first.
    router.delete('/workflows/:id', adminGate, (req, res) => {
        try {
            const id = req.params.id;
            if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
                return res.status(400).json({ error: 'invalid workflow id' });
            }
            const cfg = configManager.load().config;
            if (cfg.workflows.activeWorkflowId === id) {
                return res.status(409).json({
                    error: 'cannot delete the active workflow; activate another first or reset to admin mode'
                });
            }
            const baseDir = cfg.workflows.dir.startsWith('.')
                ? path.resolve(__dirname, '../..', cfg.workflows.dir)
                : cfg.workflows.dir;
            const folder = path.resolve(baseDir, id);
            if (!folder.startsWith(path.resolve(baseDir))) {
                return res.status(400).json({ error: 'path traversal rejected' });
            }
            if (!fs.existsSync(folder)) return res.status(404).json({ error: 'workflow not found' });
            fs.rmSync(folder, { recursive: true, force: true });
            registry.discover();
            res.json({ ok: true, id });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // Overwrite meta.json with a validated payload. id, apiFormat, workflowFile
    // are forced to the canonical values regardless of client input.
    router.put('/workflows/:id/meta', adminGate, express.json({ limit: '5mb' }), (req, res) => {
        try {
            const id = req.params.id;
            const cfg = configManager.load().config;
            const baseDir = cfg.workflows.dir.startsWith('.')
                ? path.resolve(__dirname, '../..', cfg.workflows.dir)
                : cfg.workflows.dir;
            const folder = path.resolve(baseDir, id);
            const apiPath = path.join(folder, `${id}.api.json`);
            if (!fs.existsSync(apiPath)) return res.status(404).json({ error: 'workflow not found' });
            const incoming = req.body || {};
            const meta = WorkflowMeta.parse({
                ...incoming,
                schemaVersion: 1,
                id,
                apiFormat: true,
                workflowFile: `${id}.api.json`
            });
            fs.writeFileSync(path.join(folder, `${id}.meta.json`), JSON.stringify(meta, null, 2), 'utf8');
            registry.discover();
            res.json({ ok: true, id });
        } catch (e) { res.status(400).json({ error: e.message }); }
    });

    return router;
}

module.exports = { makeRouter };
