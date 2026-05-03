const express = require('express');
const fs = require('fs');
const path = require('path');
const { classify, KIND_BY_EXT } = require('./mediaTypes');

// Serves media files from ComfyUI's output_dir and temp/ directory.
// Routes:
//   GET /media/:kind/:filename(*)    — kind = image|video|audio|model3d|json|binary
//   GET /media/_any/:filename(*)     — kind-agnostic (for clients that don't know yet)
// Path traversal: reject any filename containing '..' segments.
//
// Backward-compat aliases:
//   GET /images/:filename(*)
//   GET /download/:filename(*)

function _resolveSafe(rootDir, fileRel) {
    const decoded = decodeURIComponent(fileRel);
    if (decoded.includes('..')) return null;
    const abs = path.resolve(rootDir, decoded);
    if (!abs.startsWith(path.resolve(rootDir))) return null;
    return abs;
}

function _findInRoots(roots, fileRel) {
    for (const r of roots) {
        const abs = _resolveSafe(r, fileRel);
        if (abs && fs.existsSync(abs)) return abs;
    }
    return null;
}

function makeRouter(comfyConfig) {
    const router = express.Router();
    const outputDir = comfyConfig.output_dir;
    const tempDir = path.resolve(comfyConfig.root_path, 'temp');
    const roots = [outputDir, tempDir];

    function serve(req, res) {
        const filename = req.params.filename;
        if (!filename) return res.status(400).send('Missing filename');
        const abs = _findInRoots(roots, filename);
        if (!abs) return res.status(404).send('Not found');
        const { mime } = classify(abs);
        res.type(mime);
        const wantDownload = req.query.download === '1' || req.path.startsWith('/download');
        if (wantDownload) {
            res.download(abs, path.basename(abs));
        } else {
            res.sendFile(abs);
        }
    }

    router.get('/media/:kind/:filename(*)', (req, res) => {
        const { kind } = req.params;
        const filename = req.params.filename;
        const cls = classify(filename);
        if (kind !== '_any' && cls.kind !== kind) {
            // Be lenient: still serve, but log.
            // (Strict 404 would break URLs after format changes.)
        }
        serve(req, res);
    });
    router.get('/media/_any/:filename(*)', serve);

    // Backward-compat aliases for v1 client paths.
    router.get('/images/:filename(*)', serve);
    router.get('/download/:filename(*)', (req, res) => {
        req.query.download = '1';
        serve(req, res);
    });

    return router;
}

module.exports = { makeRouter, KIND_BY_EXT };
