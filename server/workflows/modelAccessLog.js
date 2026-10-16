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

// ★★ A BULK SCAN IS NOT A LOAD. ComfyUI 0.40's asset scanner (app/assets/
// scanner.py) calls folder_paths.get_full_path for every model file each time
// ComfyUI starts, and the recorder logged every one of those as an observed load
// — 2,160 records on 2026-10-13, 6,625 on 2026-10-15 — which protected every model
// on the disk from pruning (sd_xl_base "observed" on a morning nobody ran SDXL).
// Records the fixed recorder writes carry `ctx: "prompt"` (made while a workflow
// ran) and always count. An older record carries nothing to tell them apart, so
// the SHAPE decides: measured on the real log, a 3-second window holds either
// fewer than 10 distinct models (a workflow running) or more than 50 (a scan),
// never anything in between. At BURST distinct models or more in its window, a
// legacy record is a scan and does not count.
const BURST = 20;

function parseRows(text) {
    const rows = [];
    for (const line of text.split(/\r?\n/)) {
        if (!line.trim()) continue;
        let row;
        // A torn final line is the normal cost of an append-only log; skip it
        // rather than discarding everything before it.
        try { row = JSON.parse(line); } catch { continue; }
        if (!row || !row.path) continue;
        const name = String(row.path).split(/[\\/]/).pop().toLowerCase();
        if (name) rows.push({ ...row, name });
    }
    return rows;
}

/**
 * The records that are real loads: those not part of a scan burst.
 *
 * ★ Prompt-tagged records are judged by the same shape, against each other.
 * Recorder v9 tagged a lookup `ctx: "prompt"` whenever ANY prompt was running,
 * and the asset scanner runs on its own thread — so a scan overlapping a prompt
 * (a job booked seconds after a ComfyUI starts, routine with parallel lanes)
 * logged 218 models in one second, all tagged as loads, on 2026-10-16. Each class
 * is measured only against its own kind, so a real load that happens to land
 * inside an old untagged scan still counts.
 */
function genuineRows(rows) {
    const cls = r => (r.ctx === 'prompt' ? 'prompt' : 'legacy');
    const perSecond = { prompt: new Map(), legacy: new Map() };
    for (const r of rows) {
        if (!r.at) continue;
        const m = perSecond[cls(r)];
        if (!m.has(r.at)) m.set(r.at, new Set());
        m.get(r.at).add(r.name);
    }
    const memo = new Map();
    const inBurst = (c, at) => {
        const key = `${c}:${at}`;
        if (!memo.has(key)) {
            const seen = new Set();
            for (const t of [at - 1, at, at + 1]) for (const n of perSecond[c].get(t) || []) seen.add(n);
            memo.set(key, seen.size >= BURST);
        }
        return memo.get(key);
    };
    return rows.filter(r => !r.at || !inBurst(cls(r), r.at));
}
const TTL_MS = 10000;

let _cache = { path: null, at: 0, value: null };

/**
 * Read the access log.
 *
 * @param {string} comfyRoot
 * @returns {{
 *   available: boolean,     the log exists, i.e. the recorder has run
 *   byName: Map,            folded basename -> { path, at (first), lastAt (latest), how }
 *   lines: number,
 *   since: number|null,     epoch seconds of the earliest record
 * }}
 */
function readAccessLog(comfyRoot) {
    const logPath = comfyRoot ? path.join(comfyRoot, LOG_NAME) : null;
    if (_cache.value && _cache.path === logPath && (Date.now() - _cache.at) < TTL_MS) {
        return _cache.value;
    }
    const out = { available: false, byName: new Map(), lines: 0, since: null, ignoredAsScan: 0 };
    if (logPath && fs.existsSync(logPath)) {
        out.available = true;
        let text = '';
        try { text = fs.readFileSync(logPath, 'utf8'); } catch { text = ''; }
        const all = parseRows(text);
        const rows = genuineRows(all);
        out.ignoredAsScan = all.length - rows.length;
        for (const row of rows) {
            out.lines++;
            const name = row.name;
            const prev = out.byName.get(name);
            const at = row.at || 0;
            if (!prev) {
                out.byName.set(name, { path: row.path, at, lastAt: at, how: row.how || 'unknown' });
            } else {
                if (at < (prev.at || 0)) Object.assign(prev, { path: row.path, at, how: row.how || 'unknown' });
                // ★ The LATEST sighting as well. When a workflow is removed, a load
                // recorded before the removal is plausibly that workflow's own; one
                // recorded after it is somebody else's and must keep protecting.
                if (at > (prev.lastAt || 0)) prev.lastAt = at;
            }
            if (row.at && (out.since === null || row.at < out.since)) out.since = row.at;
        }
    }
    _cache = { path: logPath, at: Date.now(), value: out };
    return out;
}

function invalidateAccessLog() { _cache = { path: null, at: 0, value: null }; }

/**
 * Weight basenames opened between two instants.
 *
 * ★ Why this exists rather than diffing `byName` before and after a run: the log
 * is append-only and keeps growing, and `byName` records the EARLIEST sighting of
 * each name. So "the names present after, minus the names present before" reports
 * only weights never loaded on this machine before — which is almost nothing on a
 * second sweep. The first re-run showed 0 models opened for a bundle the previous
 * sweep had credited with 5. Time is the honest key: the log stamps every entry,
 * so a run's window selects exactly what it loaded, however often that file has
 * been loaded before.
 *
 * Both bounds are epoch milliseconds. Reads the file directly rather than through
 * the TTL cache, because a caller asking about a window that just closed needs
 * what is on disk now.
 *
 * @returns {string[]} folded basenames, sorted, deduplicated
 */
function namesOpenedBetween(comfyRoot, fromMs, toMs) {
    const logPath = comfyRoot ? path.join(comfyRoot, LOG_NAME) : null;
    if (!logPath || !fs.existsSync(logPath)) return [];
    let text = '';
    try { text = fs.readFileSync(logPath, 'utf8'); } catch { return []; }
    const names = new Set();
    // Same rule as readAccessLog: a scan burst inside a sweep's window is
    // ComfyUI starting up, not the bundle loading its weights.
    for (const row of genuineRows(parseRows(text))) {
        if (!row.at) continue;
        const ms = row.at * 1000;
        if (ms < fromMs || ms > toMs) continue;
        names.add(row.name);
    }
    return [...names].sort();
}

module.exports = { readAccessLog, invalidateAccessLog, namesOpenedBetween, genuineRows, parseRows, LOG_NAME, BURST };
