const express = require('express');
const { estimateWorkflowVram } = require('../workflows/vramEstimate');

function makeRouter({ registry, configManager, benchmarkService, adminGate }) {
    const router = express.Router();

    router.get('/', (req, res) => {
        try {
            // Default to hiding broken bundles. Pass ?includeUnavailable=1 if a
            // diagnostics view ever needs them.
            const includeUnavailable = req.query.includeUnavailable === '1';
            const summaries = registry.summaries({ includeUnavailable, includeHidden: false });
            const categories = {
                't2i': 'Text to Image', 'image-edit': 'Image Editing',
                'i2v': 'Image to Video', 'video-edit': 'Video Editing', 'i2i': 'Image to Image',
                'audio': 'Audio Generation', '3d': '3D Generation',
                'preprocessor': 'Preprocessor', 'description': 'Description', 'other': 'Other'
            };
            const cfg = configManager.load().config;
            // How much VRAM each one needs, so the admin can see what will fit
            // beside what before serving a second workflow on the same card.
            // Computed here rather than in the registry because it depends on
            // the ComfyUI install, which the registry knows nothing about.
            const comfyRoot = cfg.comfy_ui?.root_path;
            const workflows = summaries.map(s => {
                if (s.unavailable) return s;
                const graph = registry.get(s.id)?.apiWorkflow;
                if (!graph) return s;
                try { return { ...s, vram: estimateWorkflowVram(graph, comfyRoot) }; }
                catch { return s; }   // never let an estimate break the library
            });
            res.json({
                workflows,
                categories,
                activeWorkflowId: cfg.workflows.activeWorkflowId,
                // This machine's card, detected at boot — the yardstick the UI
                // compares against. Different on every rig in the fleet.
                gpu: { name: cfg.instance?.gpu || null, vramGb: cfg.instance?.vramGb || null }
            });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    router.get('/refresh', (req, res) => {
        registry.discover();
        res.json({ ok: true });
    });
    router.post('/refresh', (req, res) => {
        registry.discover();
        res.json({ ok: true });
    });

    router.get('/:id', (req, res) => {
        const e = registry.get(req.params.id);
        if (!e) return res.status(404).json({ error: 'unknown workflow' });
        if (e.unavailable) return res.status(409).json({ error: e.reason, unavailable: true });
        res.json({
            id: e.id,
            metadata: e.meta,
            effective: e.effective,
            runtime: e.runtime,
            summary: e.summary
        });
    });

    router.get('/:id/parameters', (req, res) => {
        const e = registry.get(req.params.id);
        if (!e || e.unavailable) return res.status(404).json({ error: 'unknown or unavailable workflow' });
        res.json({ parameters: e.effective.exposedParameters });
    });

    router.get('/:id/presets/:name', (req, res) => {
        const e = registry.get(req.params.id);
        if (!e || e.unavailable) return res.status(404).json({ error: 'unknown or unavailable workflow' });
        const preset = e.meta.presets?.[req.params.name];
        if (!preset) return res.status(404).json({ error: 'unknown preset' });
        res.json({ name: req.params.name, label: preset.label || req.params.name, values: preset.values || {} });
    });

    router.post('/:id/calibrate', adminGate, async (req, res) => {
        try {
            const runtime = await benchmarkService.calibrate(req.params.id);
            res.json({ ok: true, runtime });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    router.put('/:id/config-meta', express.json(), adminGate, (req, res) => {
        try {
            registry.writeConfigMeta(req.params.id, req.body);
            res.json({ ok: true });
        } catch (e) { res.status(400).json({ error: e.message }); }
    });

    return router;
}

module.exports = { makeRouter };
