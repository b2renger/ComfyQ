// batchPlan — turns a batch table into the jobs it would queue, or says why not.
//
// The format is in docs/batch-format.md. One row per job; a row can become
// several (repeat, a folder of inputs, or a row that feeds on several jobs).
// An input cell names where a file comes from:
//
//   hero          the first output of the row whose id is "hero"
//   hero#2        its second output
//   hero.3        the third copy of a row that made several
//   file:a.png    a file in the assets folder
//   folder:dir/   one job per file of the right kind in that folder
//   job:<id>      an output of a job that already exists
//
// Nothing here touches the disk or the queue: what it needs comes in `env`
// (assets, text files, existing jobs, the random source), so the plan is the
// same in a test as on the rig. The queue route turns the plan into rows.
//
// It refuses rather than guesses. A cell it cannot read, a setting the card
// does not have, a value outside the card's range, a reference to nothing,
// or a loop is an error with the spreadsheet row and the column. A row that
// waits on a broken row is reported as blocked, not queued.

const path = require('path');
const { parseCsv } = require('./csv');
const { resolveWorkflowAlias, buildIndex } = require('../storyboard/workflowResolver');
const { predictOutputKind } = require('../storyboard/storyboardPlanner');
const { isSeedParam } = require('../benchmark/benchmarkService');
const { classify } = require('../media/mediaTypes');
const { splitPipeline, outputKind, extraAssets } = require('./deriveOps');
const { orderRun, costOf, flagsKey } = require('./runOrder');
const kindOf = (file) => classify(file).kind;

const MEDIA_TYPES = ['image', 'mask', 'video', 'audio', 'model3d'];
// What a job output must be to fill a parameter of this type.
const KIND_FOR_TYPE = { image: 'image', mask: 'image', video: 'video', audio: 'audio', model3d: 'model3d' };
// Columns that are not a card's setting. stage, caption and keepRuntime are the
// test suite's (tools/test-suite): a batch reads past them.
const RESERVED = new Set(['id', 'workflow', 'prompt', 'negative', 'repeat', 'seed', 'note', 'notes', 'comment',
    'stage', 'caption', 'keepruntime']);
// A letter or digit first ("3d_pixal3d_multi_views" is a card's id), then letters,
// digits, - _ and @ ("video_ltx2_5_t2v@compare" is a test-suite variant).
const ID_RX = /^[A-Za-z0-9][A-Za-z0-9_@-]{0,79}$/;
const REF_RX = /^([A-Za-z0-9][A-Za-z0-9_@-]*)(?:\.(\d+))?(?:#(\d+))?$/;
const MAX_REPEAT = 100;

function isSeed(p) { return p.type === 'number' && isSeedParam(p); }
function isNegative(p) { return /negative/i.test(p.key) || /negative/i.test(p.label || ''); }

// The card's own prompt: the text field most like one. A field that is
// plumbing (an LLM's system instruction, a trigger word joined by a
// StringConcatenate) scores below zero and is never chosen.
function promptScore(p) {
    const hay = `${p.key} ${p.label || ''}`.toLowerCase();
    if (/concatenate|string_[a-z](_|\b)|system|delimiter|trigger/.test(hay)) return -10;
    let s = 0;
    if (/prompt/.test(hay)) s += 3;
    if (/description|instruction|caption/.test(hay)) s += 2;
    if (p.type === 'textarea') s += 1;
    return s;
}

function enabledParams(entry) {
    return (entry.effective?.exposedParameters || [])
        .filter(p => p.enabled !== false)
        .slice()
        .sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
}

// The parameters a column can stand for on one card.
//   prompt / negative           the card's prompt and negative prompt
//   image, image2, video, ...   its media inputs of that type, in form order
//   anything else               a parameter key, exactly (case aside)
function columnTarget(column, params) {
    const c = column.toLowerCase();
    if (c === 'prompt') {
        const best = params.filter(p => ['textarea', 'text'].includes(p.type) && !isNegative(p))
            .map(p => ({ p, s: promptScore(p) })).filter(x => x.s > 0)
            .sort((a, b) => b.s - a.s)[0];
        return best ? best.p : null;
    }
    if (c === 'negative') return params.find(p => ['textarea', 'text'].includes(p.type) && isNegative(p)) || null;
    const media = /^(image|mask|video|audio|model3d)(\d*)$/.exec(c);
    if (media) {
        const n = media[2] ? Number(media[2]) : 1;
        const ofType = params.filter(p => p.type === media[1]);
        return ofType[n - 1] || null;
    }
    return params.find(p => p.key.toLowerCase() === c) || null;
}

function loose(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }

// A cell's value for a non-media parameter, or { error }.
function readValue(raw, p, env) {
    let v = raw;
    if (/^text:/i.test(v)) {
        const name = v.slice(5).trim();
        if (!['textarea', 'text'].includes(p.type)) return { error: `"${v}": a text file can only fill a text field, and this one is a ${p.type}.` };
        const bad = unsafeName(name);
        if (bad) return { error: `"${v}": ${bad}` };
        const text = env.readText ? env.readText(name) : null;
        if (text == null) return { error: `"${v}": there is no text file named "${name}" in the assets folder.` };
        return { value: text };
    }
    switch (p.type) {
        case 'number': {
            // A French spreadsheet writes 1,5; accept one comma as the decimal point.
            const s = v.includes('.') ? v : v.replace(',', '.');
            const n = Number(s);
            if (!Number.isFinite(n) || s.trim() === '') return { error: `"${raw}" is not a number.` };
            if (Number.isFinite(p.min) && n < p.min) return { error: `${n} is below this setting's minimum, ${p.min}.` };
            if (Number.isFinite(p.max) && n > p.max) return { error: `${n} is above this setting's maximum, ${p.max}.` };
            return { value: n };
        }
        case 'checkbox': {
            const t = v.trim().toLowerCase();
            if (['true', 'yes', 'oui', '1', 'on', 'x'].includes(t)) return { value: true };
            if (['false', 'no', 'non', '0', 'off'].includes(t)) return { value: false };
            return { error: `"${raw}" is not yes or no.` };
        }
        case 'select':
        case 'lora': {
            const options = p.type === 'lora' ? (env.optionsFor ? env.optionsFor(p) : null) : p.options;
            if (!Array.isArray(options) || !options.length) return { value: v };
            const hit = options.find(o => o === v) || options.find(o => loose(o) === loose(v));
            if (!hit) return { error: `"${raw}" is not one of the choices: ${options.slice(0, 12).join(', ')}${options.length > 12 ? ', …' : ''}.` };
            return { value: hit };
        }
        case 'camera': {
            // Checked as JSON, kept as written: the value travels as the text a
            // booking sends, so a suite run and its replay send the same thing.
            try {
                const obj = JSON.parse(v);
                if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error();
                return { value: v };
            } catch { return { error: `a camera setting is written as JSON, such as {"horizontal": 0, "vertical": 0, "zoom": 5}.` }; }
        }
        default:
            return { value: v };
    }
}

// Names in the assets folder are relative and stay inside it.
function unsafeName(name) {
    if (!name) return 'no file name is given.';
    if (path.isAbsolute(name) || /^[a-z]:/i.test(name)) return 'name a file inside the assets folder, not a full path.';
    if (name.split(/[\\/]/).includes('..')) return 'a name cannot leave the assets folder with "..".';
    return null;
}

// A media cell, read but not yet resolved against the other rows.
//   { asset } | { folder } | { job, outputIndex } | { row, copy, outputIndex } | { error }
function readMediaCell(raw) {
    // "file:a.mp4 | frame(0) | crop(…)": a file, then the steps that prepare it.
    let base;
    let derive = [];
    try { ({ base, ops: derive } = splitPipeline(raw)); }
    catch (e) { return { error: `"${raw.trim()}": ${e.message}` }; }
    const v = base;
    let m;
    // "empty": leave an optional input empty on purpose. In a batch that is what
    // an empty cell does too; the test suite tells the two apart (an input it
    // does not name gets an asset picked for it).
    if (/^empty$/i.test(v) && !derive.length) return { empty: true };
    if ((m = /^file:(.+)$/i.exec(v))) {
        const name = m[1].trim();
        const bad = unsafeName(name);
        return bad ? { error: `"${v}": ${bad}` } : { asset: name, derive };
    }
    if ((m = /^folder:(.*)$/i.exec(v))) {
        const dir = m[1].trim().replace(/[\\/]+$/, '');
        const bad = dir ? unsafeName(dir) : null;
        return bad ? { error: `"${v}": ${bad}` } : { folder: dir, derive };
    }
    if (derive.length) return { error: `"${raw.trim()}": steps (| …) prepare a file from the assets folder; another row's or job's result cannot be prepared yet.` };
    if ((m = /^job:([0-9a-f-]{8,36})(?:#(\d+))?$/i.exec(v))) {
        return { job: m[1].toLowerCase(), outputIndex: m[2] ? Number(m[2]) - 1 : 0 };
    }
    if ((m = REF_RX.exec(v))) {
        if (m[3] !== undefined && Number(m[3]) < 1) return { error: `"${v}": outputs are counted from 1.` };
        if (m[2] !== undefined && Number(m[2]) < 1) return { error: `"${v}": copies are counted from 1.` };
        return { row: m[1], copy: m[2] ? Number(m[2]) : null, outputIndex: m[3] ? Number(m[3]) - 1 : 0 };
    }
    return { error: `"${v}" is not an input. Write the id of a row, file:NAME for a file in the assets folder, folder:NAME/ for each file in a folder, job:ID, or empty.` };
}

function randomSeed(p, random) {
    const max = Number.isFinite(p?.max) ? Math.min(p.max, 4294967295) : 4294967295;
    const min = Number.isFinite(p?.min) ? Math.max(p.min, 0) : 0;
    return min + Math.floor(random() * Math.max(1, max - min));
}

function cardName(entry) {
    return entry.summary?.title || entry.meta?.title || entry.meta?.name || entry.id;
}

// planBatch(text, registry, env) →
//   { jobs, errors, warnings, blocked, summary, totalEstimatedSec, modelLoads,
//     restarts, ordering }
//
// env: {
//   assetExists(name) → bool        a file in the assets folder
//   listAssets(dir) → [names]       its files, relative to the assets folder (null: no such folder)
//   readText(name) → string|null    a text file in the assets folder
//   getJob(id) → { id, status, workflowId, outputs } | null   an existing job, by id or unique prefix
//   optionsFor(param) → [values]|null   the choices of a lora param on this machine
//   random() → [0, 1)               for fresh seeds (Math.random by default)
//   order                           'fewest-loads': reorder for the fewest model loads
//                                   and restarts (runOrder.js); otherwise the table's
//                                   order, each row moved only below the rows it uses
//   comfyFlags                      the rig's comfy_ui config: which speed-up flags are on
//   startWorkflowId                 the card the main lane has loaded now, if serving
// }
//
// A job: { key, row, order, writtenOrder, workflowId, workflowName, workflowVersion,
//          prompt, promptParamKey, paramValues, deps, assets, estimatedDurationSec,
//          modelLoadSec, flags, setup, setupSec }
//   setup:  what runs before it: null, 'load' (the card's models) or 'restart'
//           (ComfyUI with other speed-up flags, then the load); setupSec its time
//   deps:   [{ paramKey, sourceKey, outputIndex, kind }]    another job of this batch
//         | [{ paramKey, sourceJobId, outputIndex, kind }]  a job that already exists
//   assets: [{ paramKey, file }]   files to stage from the assets folder
function planBatch(text, registry, env = {}) {
    const random = env.random || Math.random;
    const errors = [];
    const warnings = [];
    const err = (row, column, message) => errors.push({ row, column: column || null, message });
    const warn = (row, column, message) => warnings.push({ row, column: column || null, message });

    const csv = parseCsv(text);
    if (csv.error) return finish([], { errors: [{ row: null, column: null, message: csv.error }], warnings });

    const isBlank = (cells) => cells.every(c => c.trim() === '');
    const records = csv.records.filter(r => !isBlank(r.cells));
    if (!records.length) return finish([], { errors: [{ row: null, column: null, message: 'The table is empty.' }], warnings });

    const header = records[0].cells.map(c => c.trim());
    const lower = header.map(h => h.toLowerCase());
    if (!lower.includes('workflow')) {
        return finish([], { errors: [{ row: records[0].row, column: null, message: 'The first row must name the columns, and one of them must be "workflow".' }], warnings });
    }
    const seen = new Map();
    lower.forEach((h, i) => {
        if (!h) return;
        if (seen.has(h)) err(records[0].row, header[i], `The column "${header[i]}" appears twice.`);
        seen.set(h, i);
    });
    const col = (cells, name) => {
        const i = lower.indexOf(name);
        return i >= 0 ? String(cells[i] ?? '').trim() : '';
    };

    // ---- pass 1: each row on its own -----------------------------------
    const index = buildIndex(registry);
    const rows = [];
    const byId = new Map();
    for (const rec of records.slice(1)) {
        const first = String(rec.cells[0] ?? '').trim();
        if (first.startsWith('#')) continue;                 // a comment row
        // filled: the params whose cell is not empty, even when the cell is wrong,
        // so a bad input is reported once and not again as a missing one.
        const r = { row: rec.row, cells: rec.cells, ok: true, media: [], values: {}, filled: new Set() };
        if (rec.cells.length > header.length && rec.cells.slice(header.length).some(c => c.trim())) {
            err(rec.row, null, `This row has ${rec.cells.length} cells but the header names ${header.length} columns. A cell with the separator in it needs quotes.`);
            r.ok = false;
        }
        r.id = col(rec.cells, 'id') || `row${rec.row}`;
        if (!ID_RX.test(r.id)) {
            err(rec.row, 'id', `"${r.id}" cannot be an id: a letter or digit, then letters, digits, - _ or @.`);
            r.ok = false;
        } else if (byId.has(r.id)) {
            err(rec.row, 'id', `The id "${r.id}" is already used on row ${byId.get(r.id).row}.`);
            r.ok = false;
        } else {
            byId.set(r.id, r);
        }

        const alias = col(rec.cells, 'workflow');
        if (!alias) { err(rec.row, 'workflow', 'No workflow is named.'); r.ok = false; rows.push(r); continue; }
        try { r.entry = registry.get(resolveWorkflowAlias(alias, registry, index).id); }
        catch (e) { err(rec.row, 'workflow', e.message); r.ok = false; rows.push(r); continue; }
        const params = enabledParams(r.entry);
        r.params = params;

        // The test suite's own columns, carried to the jobs for its loader.
        r.extra = { stage: col(rec.cells, 'stage'), caption: col(rec.cells, 'caption'), keepRuntime: col(rec.cells, 'keepruntime') };
        if (r.extra.keepRuntime && !/^(yes|no|true|false|oui|non|1|0|x)$/i.test(r.extra.keepRuntime)) {
            err(rec.row, 'keepRuntime', 'keepRuntime is yes or no.');
            r.ok = false;
        }

        const rep = col(rec.cells, 'repeat');
        r.repeat = 1;
        if (rep) {
            const n = Number(rep);
            if (!Number.isInteger(n) || n < 1 || n > MAX_REPEAT) { err(rec.row, 'repeat', `repeat is a whole number from 1 to ${MAX_REPEAT}.`); r.ok = false; }
            else r.repeat = n;
        }

        const seedParam = params.find(isSeed) || null;
        r.seedParam = seedParam;
        for (let i = 0; i < header.length; i++) {
            const column = header[i];
            const name = lower[i];
            if (!name || (RESERVED.has(name) && name !== 'prompt' && name !== 'negative')) continue;
            const raw = String(rec.cells[i] ?? '');
            if (raw.trim() === '') continue;
            const p = columnTarget(column, params);
            if (!p) {
                const what = name === 'prompt' ? 'a prompt'
                    : name === 'negative' ? 'a negative prompt'
                    : /^(image|mask|video|audio|model3d)\d*$/.test(name) ? `that many ${name.replace(/\d+$/, '')} inputs`
                    : `a setting named "${column}"`;
                err(rec.row, column, `${cardName(r.entry)} has no ${what}.`);
                r.ok = false;
                continue;
            }
            // "prompt" and "prompt_117" can name one field: the second would win unseen.
            if (r.filled.has(p.key)) {
                err(rec.row, column, `Another column of this row already sets ${p.label || p.key}.`);
                r.ok = false;
                continue;
            }
            r.filled.add(p.key);
            if (MEDIA_TYPES.includes(p.type)) {
                const ref = readMediaCell(raw);
                if (ref.error) { err(rec.row, column, ref.error); r.ok = false; continue; }
                r.media.push({ param: p, column, ref });
                continue;
            }
            if (isSeed(p)) { err(rec.row, column, `Use the "seed" column for the seed.`); r.ok = false; continue; }
            // "empty" sets a text field to nothing; an empty cell leaves the card's default.
            if (/^empty$/i.test(raw.trim()) && ['textarea', 'text'].includes(p.type)) { r.values[p.key] = ''; continue; }
            const got = readValue(raw.trim(), p, env);
            if (got.error) { err(rec.row, column, got.error); r.ok = false; continue; }
            r.values[p.key] = got.value;
        }
        const seedCell = col(rec.cells, 'seed');
        r.seed = null;
        if (seedCell) {
            if (!seedParam) { err(rec.row, 'seed', `${cardName(r.entry)} has no seed to set.`); r.ok = false; }
            else {
                const n = Number(seedCell);
                const max = Number.isFinite(seedParam.max) ? seedParam.max : Number.MAX_SAFE_INTEGER;
                if (!Number.isSafeInteger(n) || n < 0 || n + r.repeat - 1 > max) { err(rec.row, 'seed', `A seed is a whole number from 0 to ${max}.`); r.ok = false; }
                else r.seed = n;
            }
        }
        rows.push(r);
    }

    // ---- pass 2: inputs against the assets, the jobs and the other rows -----
    for (const r of rows) {
        if (!r.entry) continue;
        for (const m of r.media) {
            const want = KIND_FOR_TYPE[m.param.type];
            const ref = m.ref;
            // What a file becomes once its steps (| …) are applied; null when the
            // steps cannot take it (a crop on a video), with the reason in `why`.
            let why = null;
            const madeFrom = (file) => {
                try { return outputKind(kindOf(file), ref.derive); } catch (e) { why = e.message; return null; }
            };
            for (const extra of extraAssets(ref.derive)) {
                if (!env.assetExists || !env.assetExists(extra)) { err(r.row, m.column, `There is no file "${extra}" in the assets folder.`); r.ok = false; }
            }
            if (ref.empty) {
                if (m.param.required !== false) { err(r.row, m.column, `${cardName(r.entry)} needs ${article(m.param.type)} here (${m.param.label || m.param.key}); it cannot be left empty.`); r.ok = false; }
            } else if (ref.asset) {
                if (!env.assetExists || !env.assetExists(ref.asset)) { err(r.row, m.column, `There is no file "${ref.asset}" in the assets folder.`); r.ok = false; continue; }
                const kind = madeFrom(ref.asset);
                if (!kind) { err(r.row, m.column, `"${ref.asset}": ${why}`); r.ok = false; }
                else if (kind !== want) {
                    err(r.row, m.column, `"${ref.asset}"${ref.derive.length ? ', prepared,' : ''} is ${article(kind)}, and this input takes ${article(want)}.`);
                    r.ok = false;
                }
            } else if (ref.folder !== undefined) {
                const files = env.listAssets ? env.listAssets(ref.folder) : null;
                if (!files) { err(r.row, m.column, `There is no folder "${ref.folder || '.'}" in the assets folder.`); r.ok = false; continue; }
                ref.files = files.filter(f => madeFrom(f) === want).sort((a, b) => a.localeCompare(b));
                if (!ref.files.length) { err(r.row, m.column, `The folder "${ref.folder || '.'}" has no ${want} file${ref.derive.length ? ' these steps can prepare' : ''}.`); r.ok = false; }
            } else if (ref.job) {
                const job = env.getJob ? env.getJob(ref.job) : null;
                if (!job) { err(r.row, m.column, `There is no job ${ref.job}.`); r.ok = false; continue; }
                if (['failed', 'cancelled'].includes(job.status)) { err(r.row, m.column, `Job ${ref.job} ${job.status === 'failed' ? 'failed' : 'was cancelled'}, so it has nothing to give.`); r.ok = false; continue; }
                ref.jobId = job.id;
                const outs = Array.isArray(job.outputs) ? job.outputs : [];
                if (job.status === 'completed') {
                    const out = outs[ref.outputIndex];
                    if (!out) { err(r.row, m.column, `Job ${ref.job} made ${outs.length} output${outs.length === 1 ? '' : 's'}, not ${ref.outputIndex + 1}.`); r.ok = false; continue; }
                    const kind = out.kind || kindOf(out.filename || out.file || '');
                    if (kind !== want) { err(r.row, m.column, `Output ${ref.outputIndex + 1} of job ${ref.job} is ${article(kind)}, and this input takes ${article(want)}.`); r.ok = false; }
                }
            } else {
                const src = byId.get(ref.row);
                if (!src) { err(r.row, m.column, `No row has the id "${ref.row}".`); r.ok = false; continue; }
                if (src === r) { err(r.row, m.column, `A row cannot use its own result.`); r.ok = false; continue; }
                m.source = src;
                if (src.entry) {
                    const kind = predictOutputKind(src.entry);
                    if (kind && kind !== want) { err(r.row, m.column, `"${ref.row}" makes ${article(kind)}, and this input takes ${article(want)}.`); r.ok = false; }
                    else if (!kind) warn(r.row, m.column, `What ${cardName(src.entry)} makes could not be told in advance; the job fails if it is not ${article(want)}.`);
                }
            }
            if (m.param.type === 'mask' && (ref.row !== undefined || ref.job)) {
                warn(r.row, m.column, `A mask is read from the picture's transparency. A generated picture has none, so nothing would be masked.`);
            }
        }
        // A required input with nothing in it.
        for (const p of r.params || []) {
            if (!MEDIA_TYPES.includes(p.type) || p.required === false) continue;
            if (!r.filled.has(p.key)) {
                const same = r.params.filter(q => q.type === p.type);
                const column = same.indexOf(p) === 0 ? p.type : `${p.type}${same.indexOf(p) + 1}`;
                err(r.row, column, `${cardName(r.entry)} needs ${article(p.type)} here (${p.label || p.key}).`);
                r.ok = false;
            }
        }
        // A value set on a field the card's own switch turns off.
        for (const [key] of Object.entries(r.values)) {
            const p = r.params.find(q => q.key === key);
            const dw = p?.disabledWhen;
            if (!dw?.param) continue;
            const ref = r.params.find(q => q.key === dw.param);
            if (!ref) continue;
            const current = Object.prototype.hasOwnProperty.call(r.values, ref.key) ? r.values[ref.key] : ref.default;
            if (current === dw.equals) warn(r.row, key, `${p.label || key} is switched off by "${ref.label || ref.key}", so this value is not used.`);
        }
    }

    // ---- pass 3: order, loops, and the rows that wait on broken ones --------
    const order = [];
    const state = new Map();      // row → 'visiting' | 'done'
    const loops = new Set();
    const visit = (r, trail) => {
        if (state.get(r) === 'done') return;
        if (state.get(r) === 'visiting') {
            const from = trail.indexOf(r);
            for (const x of trail.slice(from)) loops.add(x);
            return;
        }
        state.set(r, 'visiting');
        for (const m of r.media) if (m.source) visit(m.source, [...trail, r]);
        state.set(r, 'done');
        order.push(r);
    };
    for (const r of rows) visit(r, []);
    for (const r of loops) {
        err(r.row, null, `This row is part of a loop: ${[...loops].map(x => x.id).join(' → ')} each wait for one another.`);
        r.ok = false;
    }
    // Spreadsheet order wherever the inputs allow it: a row moves only to come
    // after the rows it uses.
    const blocked = [];
    for (const r of order) {
        if (!r.ok) continue;
        const broken = r.media.map(m => m.source).filter(s => s && !s.ok);
        if (broken.length) {
            r.ok = false;
            r.blocked = true;
            blocked.push({ row: r.row, id: r.id, waitsOn: [...new Set(broken.map(s => s.id))] });
        }
    }

    // ---- pass 4: copies -----------------------------------------------------
    // A row becomes one job per item of its widest input (a folder, or a row
    // that made several), times its repeat. Inputs of different widths cannot
    // be paired, so that is an error.
    const copiesOf = new Map();       // row → [job]
    const jobs = [];
    for (const r of order) {
        if (!r.ok) continue;
        // A source that failed while making its own copies breaks this row too.
        const lost = r.media.filter(m => m.source && !copiesOf.has(m.source)).map(m => m.source.id);
        if (lost.length) {
            r.ok = false;
            r.blocked = true;
            blocked.push({ row: r.row, id: r.id, waitsOn: [...new Set(lost)] });
            continue;
        }
        const widths = [];
        for (const m of r.media) {
            const w = m.ref.files ? m.ref.files.length
                : (m.source && m.ref.copy == null) ? copiesOf.get(m.source).length : 1;
            if (m.source && m.ref.copy != null && m.ref.copy > copiesOf.get(m.source).length) {
                err(r.row, m.column, `"${m.ref.row}" makes ${copiesOf.get(m.source).length} job${copiesOf.get(m.source).length === 1 ? '' : 's'}, so there is no copy ${m.ref.copy}.`);
                r.ok = false;
            }
            if (w > 1) widths.push({ w, column: m.column });
        }
        const distinct = [...new Set(widths.map(x => x.w))];
        if (distinct.length > 1) {
            err(r.row, null, `These inputs make different numbers of jobs and cannot be paired: ${widths.map(x => `${x.column} ${x.w}`).join(', ')}.`);
            r.ok = false;
        }
        if (!r.ok) continue;
        const items = distinct[0] || 1;
        const list = [];
        for (let item = 0; item < items; item++) {
            for (let rep = 0; rep < r.repeat; rep++) {
                const n = item * r.repeat + rep;
                const key = items * r.repeat > 1 ? `${r.id}.${n + 1}` : r.id;
                const paramValues = {};
                for (const p of r.params) {
                    if (MEDIA_TYPES.includes(p.type)) continue;
                    if (Object.prototype.hasOwnProperty.call(r.values, p.key)) paramValues[p.key] = r.values[p.key];
                    else if (p.default !== undefined) paramValues[p.key] = p.default;
                }
                // Every job records the seed it ran with, so the batch can be
                // run again exactly. A fixed seed steps by one per repeat; the
                // copies of a folder share it, so they share a look.
                if (r.seedParam) paramValues[r.seedParam.key] = r.seed != null ? r.seed + rep : randomSeed(r.seedParam, random);
                const deps = [];
                const assets = [];
                const emptyInputs = [];
                // `derive` only when there are steps, so a plain file stays { paramKey, file }.
                const withSteps = (a, ref) => (ref.derive?.length ? { ...a, derive: ref.derive } : a);
                for (const m of r.media) {
                    const kind = KIND_FOR_TYPE[m.param.type];
                    const ref = m.ref;
                    if (ref.empty) emptyInputs.push(m.param.key);
                    else if (ref.asset) assets.push(withSteps({ paramKey: m.param.key, file: ref.asset }, ref));
                    else if (ref.files) assets.push(withSteps({ paramKey: m.param.key, file: ref.folder ? `${ref.folder}/${ref.files[item]}` : ref.files[item] }, ref));
                    else if (ref.jobId) deps.push({ paramKey: m.param.key, sourceJobId: ref.jobId, outputIndex: ref.outputIndex, kind });
                    else {
                        const src = copiesOf.get(m.source);
                        const pick = ref.copy != null ? src[ref.copy - 1] : src.length > 1 ? src[item] : src[0];
                        deps.push({ paramKey: m.param.key, sourceKey: pick.key, outputIndex: ref.outputIndex, kind });
                    }
                }
                const promptParam = columnTarget('prompt', r.params);
                const rt = r.entry.runtime || {};
                const job = {
                    key,
                    id: r.id,
                    row: r.row,
                    workflowId: r.entry.id,
                    workflowName: cardName(r.entry),
                    workflowVersion: r.entry.meta?.version || null,
                    prompt: promptParam ? String(paramValues[promptParam.key] ?? '') : '',
                    promptParamKey: promptParam ? promptParam.key : null,
                    paramValues,
                    deps,
                    assets,
                    emptyInputs,
                    // What the row set itself, as opposed to the card's defaults
                    // filled in above: the test suite records only these as its own.
                    setKeys: Object.keys(r.values),
                    seedSet: r.seedParam && r.seed != null ? r.seedParam.key : null,
                    cells: r.extra,
                    estimatedDurationSec: rt.warmDurationSec || rt.estimatedDurationSec || r.entry.meta?.estimatedDurationSec || null,
                    modelLoadSec: rt.modelLoadSec || 0,
                    flags: flagsKey(r.entry.meta, env.comfyFlags || null),
                };
                list.push(job);
                jobs.push(job);
            }
        }
        copiesOf.set(r, list);
    }

    // ---- pass 5: the run order ----------------------------------------------
    // The table's order, each row below the rows it uses, is what the queue runs
    // unless `order` asks for the fewest model loads (runOrder.js). Seeds were
    // drawn above, so they do not depend on the order.
    jobs.forEach((j, i) => { j.writtenOrder = i; });
    const startEntry = env.startWorkflowId ? registry.get(env.startWorkflowId) : null;
    const start = startEntry ? { workflowId: startEntry.id, flags: flagsKey(startEntry.meta, env.comfyFlags || null) } : null;
    let ordering = null;
    if (env.order === 'fewest-loads') {
        const r = orderRun(jobs, { start });
        ordering = { mode: 'fewest-loads', changed: r.changed, exact: r.exact,
            written: { loads: r.written.loads, restarts: r.written.restarts, setupSec: Math.round(r.written.setupSec) } };
        if (r.changed) jobs.splice(0, jobs.length, ...r.jobs);
    }
    return finish(jobs, { errors, warnings, blocked }, { start, ordering });
}

function article(kind) {
    const k = String(kind || 'unknown');
    if (k === 'model3d') return 'a 3D model';
    if (k === 'unknown' || k === 'binary') return 'a file of another kind';
    return /^[aeiou]/.test(k) ? `an ${k}` : `a ${k}`;
}

function finish(jobs, { errors, warnings, blocked = [] }, { start = null, ordering = null } = {}) {
    jobs.forEach((j, i) => { j.order = i; });
    // In row order, as someone fixing the spreadsheet reads them.
    const byRow = (a, b) => (a.row ?? 0) - (b.row ?? 0);
    errors.sort(byRow);
    warnings.sort(byRow);
    blocked.sort(byRow);
    // What the batch costs: each job's own time, plus what runs before it when
    // the card changes (runOrder.costOf: a model load, and a ComfyUI restart when
    // the speed-up flags change too). The same model the order was chosen by.
    const cost = costOf(jobs, { start });
    let total = cost.setupSec;
    const unknown = [];
    jobs.forEach((j, i) => {
        j.setup = cost.steps[i].setup;
        j.setupSec = cost.steps[i].setupSec;
        if (j.estimatedDurationSec) total += j.estimatedDurationSec;
        else unknown.push(j.key);
    });
    const loads = cost.loads;
    const restarts = cost.restarts;
    const total_rows = new Set(jobs.map(j => j.id)).size;
    const summary = errors.length || blocked.length
        ? `${errors.length} problem${errors.length === 1 ? '' : 's'}${blocked.length ? `, and ${blocked.length} row${blocked.length === 1 ? '' : 's'} waiting on a row with one` : ''}. Nothing is queued until the table is fixed.`
        : `${jobs.length} job${jobs.length === 1 ? '' : 's'} from ${total_rows} row${total_rows === 1 ? '' : 's'}, ${loads} model load${loads === 1 ? '' : 's'}`
            + `${restarts ? `, ${restarts} ComfyUI restart${restarts === 1 ? '' : 's'}` : ''}.`;
    if (ordering) ordering.savedSec = Math.max(0, Math.round(ordering.written.setupSec - cost.setupSec));
    return { jobs, errors, warnings, blocked, summary, totalEstimatedSec: Math.round(total), modelLoads: loads, restarts,
        ordering, unknownDurations: unknown };
}

// The cards a table can name, described in the table's own terms, for the batch
// editor: which column holds each input, which field "prompt" and "negative"
// reach, and every other setting by key. Built from the same rules the planner
// applies (columnTarget, enabledParams, isSeed), so the editor can never offer a
// column the planner would refuse.
//   optionsFor(param) → [values]|null   the choices of a lora param on this machine
function describeCards(registry, { optionsFor } = {}) {
    const cards = [];
    for (const s of registry.summaries({ includeUnavailable: false, includeHidden: false })) {
        const entry = registry.get(s.id);
        if (!entry) continue;
        const params = enabledParams(entry);
        const prompt = columnTarget('prompt', params);
        const negative = columnTarget('negative', params);
        const seed = params.find(isSeed) || null;
        const inputs = [];
        for (const type of MEDIA_TYPES) {
            params.filter(p => p.type === type).forEach((p, i) => inputs.push({
                column: i === 0 ? type : `${type}${i + 1}`,
                key: p.key,
                type,
                kind: KIND_FOR_TYPE[type],
                label: p.label || p.key,
                required: p.required !== false,
            }));
        }
        const taken = new Set([prompt?.key, negative?.key, seed?.key, ...inputs.map(i => i.key)].filter(Boolean));
        const settings = params.filter(p => !taken.has(p.key)).map(p => ({
            key: p.key,
            label: p.label || p.key,
            type: p.type,
            default: p.default ?? null,
            options: p.type === 'lora' ? (optionsFor ? optionsFor(p) : null) : (Array.isArray(p.options) ? p.options : null),
            min: Number.isFinite(p.min) ? p.min : null,
            max: Number.isFinite(p.max) ? p.max : null,
            step: Number.isFinite(p.step) ? p.step : null,
        }));
        const rt = entry.runtime || {};
        cards.push({
            id: entry.id,
            title: cardName(entry),
            name: entry.meta?.name || null,
            // What the card does, in plain words and technically: the batch
            // editor shows both beside the model name (owner, 2026-11-10).
            summary: s.summary || '',
            description: s.description || '',
            category: entry.summary?.category || entry.meta?.category || null,
            experimental: !!entry.meta?.experimental,
            produces: predictOutputKind(entry),
            prompt: prompt ? { key: prompt.key, label: prompt.label || prompt.key, default: prompt.default ?? '' } : null,
            negative: negative ? { key: negative.key, label: negative.label || negative.key, default: negative.default ?? '' } : null,
            seed: seed ? { key: seed.key, max: Number.isFinite(seed.max) ? seed.max : null } : null,
            inputs,
            settings,
            estimatedSec: rt.warmDurationSec || rt.estimatedDurationSec || entry.meta?.estimatedDurationSec || null,
        });
    }
    return cards.sort((a, b) => String(a.category).localeCompare(String(b.category)) || a.title.localeCompare(b.title));
}

module.exports = { planBatch, describeCards, columnTarget, readMediaCell, MEDIA_TYPES };
