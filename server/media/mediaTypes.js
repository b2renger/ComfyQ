const path = require('path');
const mime = require('mime-types');

const KIND_BY_EXT = {
    '.png': 'image', '.jpg': 'image', '.jpeg': 'image', '.webp': 'image', '.bmp': 'image',
    '.gif': 'image',
    '.mp4': 'video', '.webm': 'video', '.mov': 'video', '.mkv': 'video', '.avi': 'video',
    '.wav': 'audio', '.mp3': 'audio', '.flac': 'audio', '.ogg': 'audio', '.aac': 'audio', '.m4a': 'audio',
    '.glb': 'model3d', '.gltf': 'model3d', '.obj': 'model3d', '.fbx': 'model3d', '.ply': 'model3d',
    '.json': 'json'
};

function classify(filename) {
    if (!filename) return { kind: 'binary', mime: 'application/octet-stream' };
    const ext = path.extname(filename).toLowerCase();
    const kind = KIND_BY_EXT[ext] || 'binary';
    const mimeType = mime.lookup(ext) || 'application/octet-stream';
    return { kind, mime: mimeType, ext };
}

module.exports = { classify, KIND_BY_EXT };
