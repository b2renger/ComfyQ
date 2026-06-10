const path = require('path');
const mime = require('mime-types');

const KIND_BY_EXT = {
    '.png': 'image', '.jpg': 'image', '.jpeg': 'image', '.webp': 'image', '.bmp': 'image',
    '.gif': 'image',
    '.mp4': 'video', '.webm': 'video', '.mov': 'video', '.mkv': 'video', '.avi': 'video',
    '.wav': 'audio', '.mp3': 'audio', '.flac': 'audio', '.ogg': 'audio', '.aac': 'audio', '.m4a': 'audio',
    '.glb': 'model3d', '.gltf': 'model3d', '.obj': 'model3d', '.fbx': 'model3d', '.ply': 'model3d',
    // Gaussian-splat container formats — a distinct kind from polygon meshes so
    // the client routes them to the SplatViewer (Spark) instead of GLTFLoader.
    // `.ply` is intentionally left under model3d above: it's ambiguous (mesh PLY
    // vs splat PLY); TripoSplat's headline splat ships as `.spz`.
    '.spz': 'splat', '.splat': 'splat', '.ksplat': 'splat',
    '.json': 'json'
};

// Extensions mime-types doesn't know — keep downloads/serving sane.
const MIME_BY_EXT = {
    '.spz': 'application/octet-stream',
    '.splat': 'application/octet-stream',
    '.ksplat': 'application/octet-stream'
};

function classify(filename) {
    if (!filename) return { kind: 'binary', mime: 'application/octet-stream' };
    const ext = path.extname(filename).toLowerCase();
    const kind = KIND_BY_EXT[ext] || 'binary';
    const mimeType = MIME_BY_EXT[ext] || mime.lookup(ext) || 'application/octet-stream';
    return { kind, mime: mimeType, ext };
}

module.exports = { classify, KIND_BY_EXT };
