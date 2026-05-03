const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

// Session-scoped uploads. Files land in ComfyUI/input/ with a comfyq_session__
// prefix so the InputUploader's TTL sweep can clean them up.
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
    const upload = multer({ storage, limits: { fileSize: 200 * 1024 * 1024 } });

    router.post('/upload', upload.single('file'), (req, res) => {
        if (!req.file) return res.status(400).json({ error: 'no file' });
        res.json({ filename: req.file.filename });
    });

    // Backward compat with v1 client (still hits /upload-image).
    router.post('/upload-image', upload.single('image'), (req, res) => {
        if (!req.file) return res.status(400).json({ error: 'no file' });
        res.json({ filename: req.file.filename });
    });

    return router;
}

module.exports = { makeRouter };
