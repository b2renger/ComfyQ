const express = require('express');
const fs = require('fs');
const path = require('path');
const { classify, KIND_BY_EXT } = require('./mediaTypes');

// Where extra lanes keep their own ComfyUI folders — the same path as
// laneManager's LANES_DIR (COMFYQ_LANES_DIR moves both), kept here rather than
// requiring the lane manager.
const LANES_DIR = process.env.COMFYQ_LANES_DIR
    ? path.resolve(process.env.COMFYQ_LANES_DIR)
    : path.join(__dirname, '..', '..', '.comfyq-lanes');

// Serves media files from ComfyUI's output_dir and temp/ directory.
// Routes:
//   GET /media/:kind/:filename(*)    — kind = image|video|audio|model3d|json|binary,
//                                      or _any; the kind is not checked (a strict
//                                      404 would break URLs after a format change)
// Path traversal: reject any filename containing '..', and anything that does
// not resolve INSIDE one of the roots (see _resolveSafe).
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

// The file a request names, or null when it is not strictly inside rootDir.
//
// ★ Compared with a separator after the root. path.resolve also accepts an
// absolute filename, and a bare startsWith let `<root>_old\x` through -- a
// sibling folder whose name begins with the output or temp folder's. Folded to
// lower case on Windows, where J:\X and j:\x are the same folder.
function _resolveSafe(rootDir, fileRel) {
    const decoded = decodeURIComponent(fileRel);
    if (decoded.includes('..')) return null;
    const root = path.resolve(rootDir);
    const abs = path.resolve(root, decoded);
    const fold = (s) => (process.platform === 'win32' ? s.toLowerCase() : s);
    const r = fold(root.endsWith(path.sep) ? root : root + path.sep);
    if (!fold(abs).startsWith(r)) return null;
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

    // An extra lane's ComfyUI writes its temp files under its own folder in
    // .comfyq-lanes/<id>/temp, not the install's temp. Listed per request: lanes
    // open and close while the server runs, and the listing is one readdir.
    function laneTempRoots() {
        try {
            return fs.readdirSync(LANES_DIR, { withFileTypes: true })
                .filter(d => d.isDirectory())
                .map(d => ({ dir: path.join(LANES_DIR, d.name, 'temp'), immutable: false }));
        } catch { return []; }
    }

    function serve(req, res) {
        const filename = req.params.filename;
        if (!filename) return res.status(400).send('Missing filename');
        const found = _findInRoots(roots, filename) || _findInRoots(laneTempRoots(), filename);
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

    router.get('/media/:kind/:filename(*)', serve);

    // Backward-compat aliases for v1 client paths.
    router.get('/images/:filename(*)', serve);
    router.get('/download/:filename(*)', (req, res) => {
        req.query.download = '1';
        serve(req, res);
    });

    return router;
}

module.exports = { makeRouter, KIND_BY_EXT, _resolveSafe, LANES_DIR };
