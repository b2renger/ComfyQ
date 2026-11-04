const fs = require('fs');
const path = require('path');

// A test suite: the library sweep run in a DELIBERATE order, with chosen inputs.
//
// WHY. A plain sweep feeds every workflow whatever the assets folder happens to
// hold — the median photo, the smallest video — and its own literal prompt. That
// answers "does it run", and nothing else: an edit bundle shown a sports car
// while its prompt talks about a woman's top produces an example nobody can
// judge. A suite says, per workflow, what to ask it and which earlier result to
// feed it, so a text-to-image result becomes the picture an edit bundle edits,
// that edit becomes a video's last frame, and that video becomes what a restyle
// bundle restyles. The examples then read as one pipeline, and two bundles that
// do the same job are given the same inputs, so they can be compared.
//
// The file lives in tools/test-suite/<name>.suite.json and is committed: it IS
// the test configuration. Shape:
//
//   { "name": "...", "description": "...",
//     "stages": [ { "name": "Text to image", "runs": [
//         { "workflow": "<bundle id>", "note": "why this input",
//           "keepRuntime": false,               // restore runtime.json afterwards
//           "params": {
//             "<param key>": "a literal value",
//             "<media key>": "asset:<file in the assets dir>",
//             "<media key>": "output:<bundle id>",          // its first output of the kind this param takes
//             "<media key>": "output:<bundle id>#2",        // its second one
//             "<media key>": { "from": "<id>" | ["<id>", "<fallback id>"],
//                              "pick": 0, "kind": "video",  // kind of the SOURCE, when derive changes it
//                              "derive": [ { "op": "frame", "index": 0 }, { "op": "crop", "box": [x0,y0,x1,y1] } ],
//                              "fallback": "asset:<file>" },
//             "<media key>": null                           // leave an optional input empty
//         } } ] } ] }
//
// Each bundle may appear once: the sweep report is keyed by bundle id.

const SUITE_DIR = path.resolve(__dirname, '..', '..', 'tools', 'test-suite');
const MEDIA_TYPES = ['image', 'video', 'audio', 'mask', 'model3d'];
// Image ops (the result is a picture) and video ops (the result is a clip) —
// see tools/test-suite/derive_input.py for what each does.
const DERIVE_OPS = ['frame', 'crop', 'flip', 'scale', 'blur', 'transparent', 'circle', 'composite', 'jpeg', 'noise',
    'trim', 'vscale', 'vblur', 'mute', 'encode'];
const VIDEO_DERIVE_OPS = ['trim', 'vscale', 'vblur', 'mute', 'encode'];

/** The output kind a media param consumes. */
function kindForParam(type) {
    return type === 'mask' ? 'image' : type;
}

/**
 * Normalise one media spec to { from: [ids], pick, kind, derive, fallback } or
 * { asset } or { empty: true }. Returns null for a value that is not a media
 * reference (a literal the param takes as-is).
 */
function parseMediaSpec(spec) {
    if (spec === null) return { empty: true };
    if (typeof spec === 'string') {
        if (spec.startsWith('asset:')) return { asset: spec };
        const m = spec.match(/^output:([A-Za-z0-9_.-]+)(?:#(\d+))?$/);
        if (m) return { from: [m[1]], pick: m[2] ? Math.max(0, Number(m[2]) - 1) : 0, derive: [], fallback: null };
        return null;
    }
    // { from: "<bundle>" | "asset:<file>" | [...], derive|ops: [...] } — a `from`
    // that starts with asset: shapes a file from the assets folder (a damaged
    // photo for a restorer, a trimmed clip for frame interpolation).
    if (spec && typeof spec === 'object' && (spec.from || spec.asset)) {
        const from = spec.from
            ? (Array.isArray(spec.from) ? spec.from.map(String) : [String(spec.from)])
            : [`asset:${String(spec.asset).replace(/^asset:/, '')}`];
        const derive = Array.isArray(spec.derive) ? spec.derive : (Array.isArray(spec.ops) ? spec.ops : []);
        return {
            from,
            pick: Number.isInteger(spec.pick) ? spec.pick : 0,
            kind: spec.kind || null,
            derive,
            fallback: typeof spec.fallback === 'string' ? spec.fallback : null,
        };
    }
    return null;
}

function suitePath(name) {
    if (!/^[A-Za-z0-9_-]+$/.test(String(name || ''))) {
        throw new Error(`a suite name is letters, digits, - and _ only (got "${name}")`);
    }
    return path.join(SUITE_DIR, `${name}.suite.json`);
}

/** Read a suite by name, or by path for the CLI. Flattens the stages into runs. */
function loadSuite(nameOrPath) {
    const file = /[\\/]|\.json$/.test(String(nameOrPath)) ? path.resolve(nameOrPath) : suitePath(nameOrPath);
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const runs = [];
    for (const [si, stage] of (raw.stages || []).entries()) {
        for (const run of (stage.runs || [])) {
            runs.push({
                workflow: String(run.workflow || ''),
                stage: stage.name || `Stage ${si + 1}`,
                stageIndex: si,
                note: run.note || null,
                keepRuntime: !!run.keepRuntime,
                params: run.params || {},
            });
        }
    }
    return {
        name: raw.name || path.basename(file).replace(/\.suite\.json$/, ''),
        description: raw.description || '',
        file,
        runs,
    };
}

/**
 * Check a suite against the library BEFORE hours of GPU time are spent on it.
 * Errors stop the run; warnings are printed.
 */
function validateSuite(suite, registry) {
    const errors = [];
    const warnings = [];
    const seen = new Map();
    suite.runs.forEach((run, i) => {
        const where = `${run.stage} › ${run.workflow || '(no workflow)'}`;
        if (seen.has(run.workflow)) errors.push(`${where}: appears twice (the report is keyed by bundle id)`);
        seen.set(run.workflow, i);
        const entry = registry.get(run.workflow);
        if (!entry) { errors.push(`${where}: not in the library`); return; }
        if (entry.unavailable) { warnings.push(`${where}: unavailable — ${entry.reason || 'it will be skipped'}`); }
        const exposed = new Map((entry.effective?.exposedParameters || []).map(p => [p.key, p]));
        for (const [key, spec] of Object.entries(run.params || {})) {
            const p = exposed.get(key);
            if (!p) { errors.push(`${where}: no parameter "${key}"`); continue; }
            if (MEDIA_TYPES.includes(p.type)) {
                const m = parseMediaSpec(spec);
                if (!m) { errors.push(`${where}: "${key}" is a ${p.type} input — give asset:, output: or {from}`); continue; }
                if (m.empty && p.required !== false && !p.whenEmpty) warnings.push(`${where}: "${key}" left empty but it is not optional`);
                for (const id of (m.from || [])) {
                    if (id.startsWith('asset:')) continue;            // a file, checked when the run starts
                    if (!registry.get(id)) { errors.push(`${where}: "${key}" reads from "${id}", which is not in the library`); continue; }
                    const j = suite.runs.findIndex(r => r.workflow === id);
                    if (j === -1) warnings.push(`${where}: "${key}" reads from "${id}", which this suite never runs — the last report's output will be used`);
                    else if (j > i) errors.push(`${where}: "${key}" reads from "${id}", which runs LATER in the suite`);
                }
                for (const op of (m.derive || [])) {
                    if (!DERIVE_OPS.includes(op?.op)) errors.push(`${where}: "${key}" has an unknown derive op "${op?.op}"`);
                }
                const videoOps = (m.derive || []).some(op => VIDEO_DERIVE_OPS.includes(op?.op));
                if (videoOps && p.type !== 'video') errors.push(`${where}: "${key}" is a ${p.type} input but its derive makes a video`);
                if (videoOps && (m.derive || []).some(op => op?.op === 'frame')) errors.push(`${where}: "${key}" mixes "frame" with video ops`);
            } else if (p.type === 'select' && Array.isArray(p.options) && spec != null
                && !p.options.map(String).includes(String(spec))) {
                errors.push(`${where}: "${key}" = ${JSON.stringify(spec)} is not one of its options`);
            }
        }
    });
    return { errors, warnings };
}

module.exports = { loadSuite, validateSuite, parseMediaSpec, kindForParam, suitePath, SUITE_DIR, MEDIA_TYPES, DERIVE_OPS, VIDEO_DERIVE_OPS };
