const fs = require('fs');
const path = require('path');
const { classify } = require('../media/mediaTypes');

// Generic output classifier. Walks history[promptId].outputs, finds every
// array of {filename, subfolder, type} entries (image/video/audio/3d/json),
// and returns a flat list with kind + MIME. NO class_type assumptions.

function _walk(value, nodeId, results) {
    if (!value) return;
    if (Array.isArray(value)) {
        for (const item of value) _walk(item, nodeId, results);
        return;
    }
    if (typeof value !== 'object') return;
    if (typeof value.filename === 'string') {
        const { kind, mime } = classify(value.filename);
        results.push({
            kind, mime,
            filename: value.filename,
            subfolder: value.subfolder || '',
            type: value.type || 'output',  // ComfyUI: 'output' or 'temp'
            nodeId
        });
        return;
    }
    // Some custom nodes nest media payloads further; recurse one level.
    for (const v of Object.values(value)) _walk(v, nodeId, results);
}

function collectFromHistory(historyEntry) {
    if (!historyEntry || !historyEntry.outputs) return [];
    const out = [];
    for (const [nodeId, nodeOutputs] of Object.entries(historyEntry.outputs)) {
        _walk(nodeOutputs, nodeId, out);
    }
    return out;
}

// Resolve a {type, subfolder, filename} record to an absolute path on disk.
// ComfyUI emits 'output' (config.comfy_ui.output_dir) or 'temp'
// (<root_path>/temp).
function resolveOutputPath({ type, subfolder, filename }, comfyConfig) {
    const baseRoot = comfyConfig.root_path;
    const baseDir = type === 'temp'
        ? path.resolve(baseRoot, 'temp')
        : comfyConfig.output_dir;
    return path.resolve(baseDir, subfolder || '', filename);
}

// Enrich each output with sizeBytes (best-effort).
function enrich(outputs, comfyConfig) {
    return outputs.map(o => {
        const abs = resolveOutputPath(o, comfyConfig);
        let sizeBytes = null;
        try { sizeBytes = fs.statSync(abs).size; } catch { /* file may not be flushed yet */ }
        return { ...o, sizeBytes, absPath: abs };
    });
}

module.exports = { collectFromHistory, resolveOutputPath, enrich };
