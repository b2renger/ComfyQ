const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { setAdminPassword, checkAdminPassword } = require('../auth/authGate');
const { WorkflowMeta } = require('../config/schemas');
const { validateApiWorkflow } = require('../workflows/workflowValidator');
const { parseWorkflow } = require('../workflows/workflowParser');

function sanitizeId(s) {
    return String(s).toLowerCase().replace(/[^a-z0-9_-]/g, '_').replace(/^_+|_+$/g, '');
}

function makeRouter({ configManager, registry, adminGate, exitForRestart }) {
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
            configManager.update(c => {
                c.workflows.activeWorkflowId = workflowId;
                c.mode = 'student';
                return c;
            });
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

    return router;
}

module.exports = { makeRouter };
