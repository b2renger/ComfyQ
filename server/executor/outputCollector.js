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

// Some nodes don't report a {filename, subfolder, type} media record at all —
// they surface the SAVED FILE as a plain absolute-PATH string somewhere in their
// UI output. Two real cases from the 3D packs:
//   • Pixal3D's `Pixal3DExportGLB` → {"ui": {"text": ["<abs>/pixal3d_….glb"]}}
//   • TRELLIS2's `Preview3D` (fed a path string) → {"result": ["<abs>/….glb", …]}
// If a string is a single-line ABSOLUTE path to an EXISTING media file living
// under the output (or temp) dir, we serve it as that media. Generic +
// extension-based (via classify) — no class_type coupling — and gated on the
// string being a real on-disk media file inside a served root, so genuine
// captions / non-media strings are never mistaken for outputs.
function _mediaRecordFromPath(str, comfyConfig, nodeId) {
    if (typeof str !== 'string' || !comfyConfig || !comfyConfig.output_dir) return null;
    const p = str.trim();
    if (!p || /[\r\n]/.test(p) || !path.isAbsolute(p)) return null;
    const { kind, mime } = classify(p);
    if (kind === 'text') return null;                 // not a known media extension
    let abs;
    try { if (!fs.statSync(p).isFile()) return null; abs = path.resolve(p); }
    catch { return null; }
    const roots = [{ dir: comfyConfig.output_dir, type: 'output' }];
    if (comfyConfig.root_path) roots.push({ dir: path.resolve(comfyConfig.root_path, 'temp'), type: 'temp' });
    for (const { dir, type } of roots) {
        const rel = path.relative(path.resolve(dir), abs);
        if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) continue;  // outside this root
        const relPosix = rel.split(path.sep).join('/');
        const slash = relPosix.lastIndexOf('/');
        return {
            kind, mime,
            filename: slash >= 0 ? relPosix.slice(slash + 1) : relPosix,
            subfolder: slash >= 0 ? relPosix.slice(0, slash) : '',
            type, nodeId, _abs: abs
        };
    }
    return null;   // path exists but outside served roots → not servable, ignore
}

function _collectMediaPaths(value, nodeId, comfyConfig, results, seenAbs, mediaStrings) {
    if (value == null) return;
    if (Array.isArray(value)) {
        for (const v of value) _collectMediaPaths(v, nodeId, comfyConfig, results, seenAbs, mediaStrings);
        return;
    }
    if (typeof value === 'object') {
        for (const v of Object.values(value)) _collectMediaPaths(v, nodeId, comfyConfig, results, seenAbs, mediaStrings);
        return;
    }
    const rec = _mediaRecordFromPath(value, comfyConfig, nodeId);
    if (!rec) return;
    if (seenAbs.has(rec._abs)) return;                // same file surfaced by two nodes/keys
    seenAbs.add(rec._abs);
    mediaStrings.add(String(value).trim());           // so _collectText won't re-emit it as text
    delete rec._abs;
    results.push(rec);
}

// Text/preview nodes (PreviewAny "Preview as Text", ShowText, …) report their
// result as a `text` / `string` array of strings under the node's output —
// there is no file. We surface these as a `text` kind with the string inline so
// image-description / LLM workflows aren't collected as zero-output.
const TEXT_UI_KEYS = ['text', 'string'];

function _collectText(nodeId, nodeOutputs, results, seen, skip) {
    if (!nodeOutputs || typeof nodeOutputs !== 'object') return;
    for (const key of TEXT_UI_KEYS) {
        const v = nodeOutputs[key];
        if (!Array.isArray(v)) continue;
        const text = v.filter(s => typeof s === 'string').join('\n').trim();
        if (!text || seen.has(text)) continue;        // dedupe identical previews
        if (skip && skip.has(text)) continue;          // already served as a media-file path
        seen.add(text);
        results.push({ kind: 'text', mime: 'text/plain', text, filename: null, subfolder: '', type: 'text', nodeId });
    }
}

function collectFromHistory(historyEntry, comfyConfig) {
    if (!historyEntry || !historyEntry.outputs) return [];
    const out = [];
    const seenText = new Set();
    const seenAbs = new Set();
    const mediaStrings = new Set();
    const nodes = Object.entries(historyEntry.outputs);
    // Pass 1 — proper {filename, subfolder, type} media records.
    for (const [nodeId, nodeOutputs] of nodes) _walk(nodeOutputs, nodeId, out);
    // Pass 2 — string values that are on-disk media PATHS (Pixal3D text / TRELLIS2 Preview3D result).
    for (const [nodeId, nodeOutputs] of nodes) _collectMediaPaths(nodeOutputs, nodeId, comfyConfig, out, seenAbs, mediaStrings);
    // Pass 3 — genuine text (captions), skipping any string already taken as a media path.
    for (const [nodeId, nodeOutputs] of nodes) _collectText(nodeId, nodeOutputs, out, seenText, mediaStrings);
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
