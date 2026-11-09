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
// The file lives in tools/test-suite/ and is committed: it IS the test
// configuration. Since 2026-11-09 the library's is a batch table,
// library.suite.csv (see suiteFromTable below and docs/batch-format.md), which
// the batch editor opens, edits and runs. The older JSON shape is still read:
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
// The report is keyed by bundle id, so a bundle's main run appears once. A run with
// a `variant` is a second run of the same card, to exercise an option or to compare
// cards on the same input: its row is "<bundle>@<variant>". It never writes
// runtime.json, since it is not the job the card describes, and it is never seeded
// as an example.

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

/**
 * The file an `asset:<name>` names inside the assets folder (sub-folders
 * allowed), or null when it is not there, is not a file, or escapes the folder.
 * The sweep resolves plain assets, `from` and `fallback` with it, and
 * `run-suite.cjs --check` uses it to list missing assets before a run, so the two
 * cannot disagree about what is there.
 */
function assetFile(assetsDir, spec) {
    if (!assetsDir) return null;
    const root = path.resolve(assetsDir);
    const full = path.resolve(root, String(spec).replace(/^asset:/, ''));
    if (full === root || !(full.toLowerCase() + path.sep).startsWith(root.toLowerCase() + path.sep)) return null;
    try { return fs.statSync(full).isFile() ? full : null; } catch { return null; }
}

// A suite by name: <name>.suite.csv (a batch table, the format since 2026-11-09),
// else <name>.suite.json.
function suitePath(name) {
    if (!/^[A-Za-z0-9_-]+$/.test(String(name || ''))) {
        throw new Error(`a suite name is letters, digits, - and _ only (got "${name}")`);
    }
    const csv = path.join(SUITE_DIR, `${name}.suite.csv`);
    return fs.existsSync(csv) ? csv : path.join(SUITE_DIR, `${name}.suite.json`);
}

// The library a .csv suite is read against when the caller has none to give.
function defaultRegistry() {
    const { WorkflowRegistry } = require('../workflows/workflowRegistry');
    const r = new WorkflowRegistry(path.resolve(__dirname, '..', '..', 'workflows'));
    r.discover();
    return r;
}

const yes = (v) => /^(yes|true|oui|1|x)$/i.test(String(v || '').trim());

/**
 * A suite written as a batch table (docs/batch-format.md), read by the batch
 * planner itself, so the suite and a batch cannot read one cell two ways.
 *
 * One row is one run. Its id is its card ("image_moss_image_t2i"), or
 * "<card>@<variant>" for a second run of the card (a comparison, an option),
 * which keeps runtime.json and is never seeded as an example. The suite's own
 * columns: `stage` (carried down to the rows below until the next one),
 * `caption` (the note an example shows), `keepRuntime` (yes or no). An input is
 * file:NAME, with steps when it is prepared (file:a.mp4 | frame(0)), or `empty`
 * to leave an optional input empty on purpose; one the row does not name gets
 * an asset picked by the calibrator. The params of a run are only what its row
 * sets: the card's defaults stay the card's.
 *
 * The planner's problems are kept in `loadErrors`, and validateSuite reports
 * them with the rest, so a broken table stops the run before it starts.
 */
function suiteFromTable(text, registry, { name, file } = {}) {
    const { planBatch } = require('../batch/batchPlan');
    const { parseCsv } = require('../batch/csv');
    const { classify } = require('../media/mediaTypes');
    // Existence is checked by run-suite --check and by the sweep before each run,
    // with the assets folder of the machine that runs it.
    const plan = planBatch(text, registry, { assetExists: () => true, listAssets: () => null, random: () => 0 });
    const loadErrors = plan.errors.map(e => `${e.row ? `row ${e.row}${e.column ? `, ${e.column}` : ''}: ` : ''}${e.message}`);
    for (const b of plan.blocked) loadErrors.push(`row ${b.row} (${b.id}) waits on ${b.waitsOn.join(', ')}`);
    const description = (parseCsv(text).records.slice(1).find(r => String(r.cells[0] || '').trim().startsWith('#'))?.cells[0] || '')
        .trim().replace(/^#\s*/, '');
    const stages = [];
    let stage = null;
    const runs = [];
    for (const job of [...plan.jobs].sort((a, b) => a.row - b.row)) {
        if (job.key !== job.id) { loadErrors.push(`row ${job.row} (${job.id}): a suite row is one run; repeat and folder: make several`); continue; }
        const workflow = job.workflowId;
        let variant = null;
        if (job.id !== workflow) {
            if (!job.id.startsWith(`${workflow}@`)) { loadErrors.push(`row ${job.row}: a suite row's id is its card (${workflow}) or ${workflow}@<variant>, not "${job.id}"`); continue; }
            variant = job.id.slice(workflow.length + 1);
        }
        if (job.cells?.stage) stage = job.cells.stage;
        const stageName = stage || 'Stage 1';
        if (!stages.includes(stageName)) stages.push(stageName);
        const params = {};
        for (const k of job.setKeys) params[k] = job.paramValues[k];
        if (job.seedSet) params[job.seedSet] = job.paramValues[job.seedSet];
        for (const a of job.assets) {
            params[a.paramKey] = a.derive
                ? { from: `asset:${a.file}`, kind: classify(a.file).kind, derive: a.derive }
                : `asset:${a.file}`;
        }
        for (const k of job.emptyInputs) params[k] = null;
        if (job.deps.length) loadErrors.push(`row ${job.row} (${job.id}): a suite row takes files, not another row's result`);
        runs.push({
            workflow,
            variant,
            id: job.id,
            row: job.row,
            stage: stageName,
            stageIndex: stages.indexOf(stageName),
            note: job.cells?.caption || null,
            keepRuntime: yes(job.cells?.keepRuntime) || !!variant,
            params,
        });
    }
    return { name, description, file, runs, loadErrors, format: 'table' };
}

/** Read a suite by name, or by path for the CLI. Flattens the stages into runs. */
function loadSuite(nameOrPath, registry = null) {
    const file = /[\\/]|\.(json|csv)$/.test(String(nameOrPath)) ? path.resolve(nameOrPath) : suitePath(nameOrPath);
    if (/\.csv$/i.test(file)) {
        return suiteFromTable(fs.readFileSync(file, 'utf8'), registry || defaultRegistry(), {
            name: path.basename(file).replace(/\.suite\.csv$|\.csv$/i, ''),
            file,
        });
    }
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const runs = [];
    for (const [si, stage] of (raw.stages || []).entries()) {
        for (const run of (stage.runs || [])) {
            const workflow = String(run.workflow || '');
            const variant = run.variant ? String(run.variant) : null;
            runs.push({
                workflow,
                variant,
                id: variant ? `${workflow}@${variant}` : workflow,
                stage: stage.name || `Stage ${si + 1}`,
                stageIndex: si,
                note: run.note || null,
                keepRuntime: !!run.keepRuntime || !!variant,
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
    const errors = [...(suite.loadErrors || [])];
    const warnings = [];
    const seen = new Map();
    suite.runs.forEach((run, i) => {
        const id = run.id || run.workflow;
        const where = `${run.stage} › ${id || '(no workflow)'}`;
        if (seen.has(id)) errors.push(`${where}: appears twice (the report is keyed by bundle id)`);
        seen.set(id, i);
        if (run.variant && !/^[a-z0-9-]+$/.test(run.variant)) errors.push(`${where}: a variant name is lower-case letters, digits and -`);
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

module.exports = { loadSuite, suiteFromTable, validateSuite, parseMediaSpec, kindForParam, assetFile, suitePath, SUITE_DIR, MEDIA_TYPES, DERIVE_OPS, VIDEO_DERIVE_OPS };
