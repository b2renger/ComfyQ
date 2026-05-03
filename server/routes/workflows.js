const express = require('express');

function makeRouter({ registry, configManager, benchmarkService, adminGate }) {
    const router = express.Router();

    router.get('/', (req, res) => {
        try {
            const summaries = registry.summaries({ includeUnavailable: true, includeHidden: false });
            const categories = {
                't2i': 'Text to Image', 'image-edit': 'Image Editing',
                'i2v': 'Image to Video', 'i2i': 'Image to Image',
                'audio': 'Audio Generation', '3d': '3D Generation',
                'preprocessor': 'Preprocessor', 'other': 'Other'
            };
            const cfg = configManager.load().config;
            res.json({
                workflows: summaries,
                categories,
                activeWorkflowId: cfg.workflows.activeWorkflowId
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
