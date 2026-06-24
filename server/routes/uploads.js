const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const sizeOf = require('image-size');

// Session-scoped uploads. Files land in ComfyUI/input/ with a comfyq_session__
// prefix so the InputUploader's TTL sweep can clean them up.
//
// Upload caps — the backstop that keeps a too-big image from crashing the rig.
// The booking dialog already downsizes images client-side to ~1024px on the
// long edge (see client/src/utils/imageResize.js), so a legitimate upload lands
// far under these limits. The caps exist for when that client resize is
// bypassed or fails — HEIC/HEIF photos (it can't decode them), a corrupt image,
// or any non-browser client. Without them a full-resolution phone photo (40+ MP)
// reaches ComfyUI, whose LoadImage decode (~0.5 GB RAM per copy) plus the model
// load OOMs the GPU box. HEIC is rejected outright (ComfyUI's PIL often can't
// read it either, and we can't downscale it here without a heavy native dep).
const UPLOAD_MAX_BYTES = 150 * 1024 * 1024; // multer hard ceiling (covers video)
const IMAGE_MAX_BYTES = 30 * 1024 * 1024;   // 30 MB for a still image
// Images must fit a 1920×1080 box in EITHER orientation: long edge ≤ 1920 AND
// short edge ≤ 1080. The client already downscales to fit this; the cap is the
// backstop for bypassed/failed client resizes.
const IMAGE_MAX_LONG = 1920;
const IMAGE_MAX_SHORT = 1080;

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif']);
const HEIC_EXTS = new Set(['.heic', '.heif']);

// ISO-BMFF 'ftyp' brand sniff for HEIC/HEIF (bytes 4..12), so a mislabeled or
// extension-less HEIC is still caught.
function isHeicBuffer(buf) {
    if (!buf || buf.length < 12) return false;
    if (buf.toString('ascii', 4, 8) !== 'ftyp') return false;
    const brand = buf.toString('ascii', 8, 12);
    return ['heic', 'heix', 'heif', 'hevc', 'hevx', 'mif1', 'msf1'].includes(brand);
}

const HEIC_MSG = 'HEIC/HEIF images aren’t supported. On iPhone, take a new photo with the camera button (it saves as JPEG), or pick a JPEG/PNG/WebP from your gallery.';

function readHeader(absPath, n) {
    const fd = fs.openSync(absPath, 'r');
    try {
        const buf = Buffer.alloc(n);
        const bytes = fs.readSync(fd, buf, 0, n, 0);
        return buf.subarray(0, bytes);
    } finally {
        fs.closeSync(fd);
    }
}

// Inspect a just-uploaded file. Returns { ok: true } to accept, or
// { ok: false, status, error } to reject (caller deletes the file). Reads only
// a header (+ stat) for the cheap checks; the full image is read only when we
// actually need its pixel dimensions — so a 150 MB video isn't slurped into
// memory just to confirm it isn't an image.
function inspectUpload(absPath, originalName) {
    const ext = path.extname(originalName || absPath).toLowerCase();

    let header, stat;
    try {
        stat = fs.statSync(absPath);
        header = readHeader(absPath, 4096);
    } catch {
        return { ok: false, status: 400, error: 'Could not read the uploaded file.' };
    }

    if (HEIC_EXTS.has(ext) || isHeicBuffer(header)) {
        return { ok: false, status: 415, error: HEIC_MSG };
    }

    // Only images get the dimension/size cap; videos and other inputs are
    // bounded by the multer file-size ceiling alone.
    if (!IMAGE_EXTS.has(ext)) return { ok: true };

    if (stat.size > IMAGE_MAX_BYTES) {
        return {
            ok: false,
            status: 413,
            error: `Image file is too large (${Math.round(stat.size / 1024 / 1024)} MB). Please use one under ${IMAGE_MAX_BYTES / 1024 / 1024} MB.`
        };
    }

    let dim;
    try {
        dim = sizeOf(fs.readFileSync(absPath));
    } catch {
        return { ok: false, status: 400, error: 'Could not read this image. Please use a standard JPEG, PNG, or WebP.' };
    }
    if (dim && (dim.type === 'heic' || dim.type === 'heif')) {
        return { ok: false, status: 415, error: HEIC_MSG };
    }
    const longest = Math.max(dim?.width || 0, dim?.height || 0);
    const shortest = Math.min(dim?.width || 0, dim?.height || 0);
    if (longest > IMAGE_MAX_LONG || shortest > IMAGE_MAX_SHORT) {
        return {
            ok: false,
            status: 413,
            error: `Image is too large (${dim.width}×${dim.height}). Maximum is ${IMAGE_MAX_LONG}×${IMAGE_MAX_SHORT} in either orientation (portrait or landscape) — please resize it and try again.`
        };
    }
    return { ok: true };
}

function makeRouter({ comfyConfig }) {
    const router = express.Router();
    const inputDir = path.resolve(comfyConfig.root_path, 'input');
    fs.mkdirSync(inputDir, { recursive: true });

    const storage = multer.diskStorage({
        destination: (req, file, cb) => cb(null, inputDir),
        filename: (req, file, cb) => {
            const ts = Date.now();
            const rand = Math.floor(Math.random() * 1e6);
            const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
            cb(null, `comfyq_session__${ts}_${rand}__${safe}`);
        }
    });
    const upload = multer({ storage, limits: { fileSize: UPLOAD_MAX_BYTES } });

    // Wrap multer so its errors (notably LIMIT_FILE_SIZE) come back as clean
    // JSON the client can surface, instead of a 500.
    function runUpload(field) {
        return (req, res, next) => {
            upload.single(field)(req, res, (err) => {
                if (err) {
                    if (err.code === 'LIMIT_FILE_SIZE') {
                        return res.status(413).json({ error: `File too large. Maximum upload size is ${UPLOAD_MAX_BYTES / 1024 / 1024} MB.` });
                    }
                    return res.status(400).json({ error: err.message || 'Upload failed.' });
                }
                next();
            });
        };
    }

    function handleUpload(req, res) {
        if (!req.file) return res.status(400).json({ error: 'no file' });
        const verdict = inspectUpload(req.file.path, req.file.originalname);
        if (!verdict.ok) {
            try { fs.unlinkSync(req.file.path); } catch { /* best effort */ }
            return res.status(verdict.status).json({ error: verdict.error });
        }
        res.json({ filename: req.file.filename });
    }

    router.post('/upload', runUpload('file'), handleUpload);
    // Backward compat with v1 client (still hits /upload-image).
    router.post('/upload-image', runUpload('image'), handleUpload);

    // Serve a previously-uploaded INPUT file back to the client so "Use these
    // settings" can preview/play the reused asset. Restricted to ComfyQ's own
    // uploads (the `comfyq_` prefix) and pinned inside the input dir — never a
    // path-traversal vector or a way to read arbitrary ComfyUI inputs.
    router.get('/input-media/:filename', (req, res) => {
        const name = path.basename(req.params.filename || '');
        if (!name.startsWith('comfyq_')) return res.status(404).end();
        const full = path.join(inputDir, name);
        if (!full.startsWith(inputDir + path.sep) || !fs.existsSync(full)) return res.status(404).end();
        res.sendFile(full);
    });

    return router;
}

module.exports = { makeRouter, inspectUpload, IMAGE_MAX_LONG, IMAGE_MAX_SHORT, IMAGE_MAX_BYTES };
