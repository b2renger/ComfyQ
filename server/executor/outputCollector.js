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

// Text/preview nodes (PreviewAny "Preview as Text", ShowText, …) report their
// result as a `text` / `string` array of strings under the node's output —
// there is no file. We surface these as a `text` kind with the string inline so
// image-description / LLM workflows aren't collected as zero-output.
const TEXT_UI_KEYS = ['text', 'string'];

function _collectText(nodeId, nodeOutputs, results, seen) {
    if (!nodeOutputs || typeof nodeOutputs !== 'object') return;
    for (const key of TEXT_UI_KEYS) {
        const v = nodeOutputs[key];
        if (!Array.isArray(v)) continue;
        const text = v.filter(s => typeof s === 'string').join('\n').trim();
        if (!text || seen.has(text)) continue;   // dedupe identical previews
        seen.add(text);
        results.push({ kind: 'text', mime: 'text/plain', text, filename: null, subfolder: '', type: 'text', nodeId });
    }
}

function collectFromHistory(historyEntry) {
    if (!historyEntry || !historyEntry.outputs) return [];
    const out = [];
    const seenText = new Set();
    for (const [nodeId, nodeOutputs] of Object.entries(historyEntry.outputs)) {
        _walk(nodeOutputs, nodeId, out);
        _collectText(nodeId, nodeOutputs, out, seenText);
    }
    return out;
}

// Resolve a {type, subfolder, filename} record to an absolute path on disk.
// ComfyUI emits 'output' (config.comfy_ui.output_dir) or 'temp'
// (<root_path>/temp).
function resolveOutputPath({ type, subfolder, filename }, comfyConfig) {
    if (!filename) return null;   // inline outputs (kind 'text') have no file on disk
    const baseRoot = comfyConfig.root_path;
    const baseDir = type === 'temp'
        ? path.resolve(baseRoot, 'temp')
        : comfyConfig.output_dir;
    return path.resolve(baseDir, subfolder || '', filename);
}

// Enrich each output with sizeBytes (best-effort).
function enrich(outputs, comfyConfig) {
    return outputs.map(o => {
        if (!o.filename) {
            // Inline text output — no file on disk; size is its byte length.
            const sizeBytes = typeof o.text === 'string' ? Buffer.byteLength(o.text, 'utf8') : null;
            return { ...o, sizeBytes, absPath: null };
        }
        const abs = resolveOutputPath(o, comfyConfig);
        let sizeBytes = null;
        try { sizeBytes = fs.statSync(abs).size; } catch { /* file may not be flushed yet */ }
        return { ...o, sizeBytes, absPath: abs };
    });
}

module.exports = { collectFromHistory, resolveOutputPath, enrich };
