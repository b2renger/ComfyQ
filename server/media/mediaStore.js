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

// A finished result never changes: ComfyQ namespaces every output filename with
// the user, the date and the job id, so a URL always points at the same bytes.
// Express' sendFile defaults to `max-age=0`, which makes the browser revalidate
// EVERY tile on every render — one round trip per result per tab, which is what
// made a grid of generations slow to appear and several open tabs crawl. A year
// of immutable caching means a result is fetched once per browser and then read
// from disk on every other tab, scroll and reload.
const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable';
// ComfyUI's temp/ dir is not namespaced by us, so a name there could be reused
// by a later preview. Cache it briefly instead of for a year.
const TEMP_CACHE = 'public, max-age=60';

function _resolveSafe(rootDir, fileRel) {
    const decoded = decodeURIComponent(fileRel);
    if (decoded.includes('..')) return null;
    const abs = path.resolve(rootDir, decoded);
    if (!abs.startsWith(path.resolve(rootDir))) return null;
    return abs;
}

// Returns { abs, immutable } — `immutable` only for the durable output dir.
function _findInRoots(roots, fileRel) {
    for (const r of roots) {
        const abs = _resolveSafe(r.dir, fileRel);
        if (abs && fs.existsSync(abs)) return { abs, immutable: r.immutable };
    }
    return null;
}

function makeRouter(comfyConfig) {
    const router = express.Router();
    const outputDir = comfyConfig.output_dir;
    const tempDir = path.resolve(comfyConfig.root_path, 'temp');
    const roots = [{ dir: outputDir, immutable: true }, { dir: tempDir, immutable: false }];

    function serve(req, res) {
        const filename = req.params.filename;
        if (!filename) return res.status(400).send('Missing filename');
        const found = _findInRoots(roots, filename);
        if (!found) return res.status(404).send('Not found');
        const { abs, immutable } = found;
        const { mime } = classify(abs);
        res.type(mime);
        res.setHeader('Cache-Control', immutable ? IMMUTABLE_CACHE : TEMP_CACHE);
        const wantDownload = req.query.download === '1' || req.path.startsWith('/download');
        if (wantDownload) {
            // cacheControl:false — sendFile would otherwise overwrite the header
            // set above with its own `max-age=0`.
            res.download(abs, path.basename(abs), { cacheControl: false });
        } else {
            res.sendFile(abs, { cacheControl: false });
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
