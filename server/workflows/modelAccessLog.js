const fs = require('fs');
const path = require('path');

// What ComfyUI has ACTUALLY opened.
//
// ★ Every other signal in the prune mechanism is inference: this graph names
// that file, this pack's source mentions that name, this folder belongs to that
// pack. Each inference has been wrong at least once — a VAE was deleted because
// subgraphs were not walked, a LoRA reached the list because one widget field
// was not read, a 7.54 GB set was offered because a folder arrived in a
// variable. This is the one signal that is an observation instead: ComfyQ's
// custom node wraps `folder_paths.get_full_path` and `comfy.utils.load_torch_file`
// and appends every weight ComfyUI resolves or loads to
// <comfy_root>/comfyq_model_access.jsonl.
//
// ⚠ It can only ever PROTECT. Absence of a record is not evidence of disuse:
// the log starts when the recorder is installed, a bundle nobody has run leaves
// no trace, and a setting nobody exercised (Fast mode off, a second LoRA in a
// dropdown) leaves none either. So a recorded file is held back, and an
// unrecorded one is judged exactly as before.

const LOG_NAME = 'comfyq_model_access.jsonl';
const TTL_MS = 10000;

let _cache = { path: null, at: 0, value: null };

/**
 * Read the access log.
 *
 * @param {string} comfyRoot
 * @returns {{
 *   available: boolean,     the log exists, i.e. the recorder has run
 *   byName: Map,            folded basename -> { path, at, how }
 *   lines: number,
 *   since: number|null,     epoch seconds of the earliest record
 * }}
 */
function readAccessLog(comfyRoot) {
    const logPath = comfyRoot ? path.join(comfyRoot, LOG_NAME) : null;
    if (_cache.value && _cache.path === logPath && (Date.now() - _cache.at) < TTL_MS) {
        return _cache.value;
    }
    const out = { available: false, byName: new Map(), lines: 0, since: null };
    if (logPath && fs.existsSync(logPath)) {
        out.available = true;
        let text = '';
        try { text = fs.readFileSync(logPath, 'utf8'); } catch { text = ''; }
        for (const line of text.split(/\r?\n/)) {
            if (!line.trim()) continue;
            let row;
            // A torn final line is the normal cost of an append-only log; skip
            // it rather than discarding everything before it.
            try { row = JSON.parse(line); } catch { continue; }
            if (!row || !row.path) continue;
            out.lines++;
            const name = String(row.path).split(/[\\/]/).pop().toLowerCase();
            if (!name) continue;
            const prev = out.byName.get(name);
            if (!prev || (row.at || 0) < (prev.at || 0)) {
                out.byName.set(name, { path: row.path, at: row.at || 0, how: row.how || 'unknown' });
            }
            if (row.at && (out.since === null || row.at < out.since)) out.since = row.at;
        }
    }
    _cache = { path: logPath, at: Date.now(), value: out };
    return out;
}

function invalidateAccessLog() { _cache = { path: null, at: 0, value: null }; }

module.exports = { readAccessLog, invalidateAccessLog, LOG_NAME };
