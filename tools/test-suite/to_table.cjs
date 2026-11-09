#!/usr/bin/env node
/**
 * Write a JSON test suite as a batch table, and prove the table says the same.
 *
 *   node tools/test-suite/to_table.cjs <name>     tools/test-suite/<name>.suite.json → <name>.suite.csv
 *
 * The table is the format the batch editor reads and writes (docs/batch-format.md),
 * with the suite's own columns: id (the card, or card@variant), stage, caption,
 * keepRuntime. It then reads the table back through suitePlan.loadSuite, the way
 * every run will, and compares each of the suite's runs with the JSON one: the
 * card, the variant, the stage, the caption, keepRuntime and every parameter,
 * inputs and their steps included. It prints every difference and exits 1 if
 * there is one.
 *
 * It writes one new file and nothing else. It refuses to overwrite a table that
 * exists (it may have been edited since), and it never removes the JSON.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..');
const { WorkflowRegistry } = require(path.join(REPO, 'server', 'workflows', 'workflowRegistry'));
const { describeCards } = require(path.join(REPO, 'server', 'batch', 'batchPlan'));
const { formatPipeline } = require(path.join(REPO, 'server', 'batch', 'deriveOps'));
const { loadSuite, SUITE_DIR } = require(path.join(REPO, 'server', 'benchmark', 'suitePlan'));

const args = process.argv.slice(2);
if (args.length !== 1 || args[0].startsWith('-') || !/^[A-Za-z0-9_-]+$/.test(args[0])) {
    console.error('Usage: node tools/test-suite/to_table.cjs <suite name>   (writes <name>.suite.csv beside <name>.suite.json)');
    process.exit(1);
}
const name = args[0];
const jsonFile = path.join(SUITE_DIR, `${name}.suite.json`);
const csvFile = path.join(SUITE_DIR, `${name}.suite.csv`);
if (!fs.existsSync(jsonFile)) { console.error(`${path.relative(REPO, jsonFile)} does not exist.`); process.exit(1); }
if (fs.existsSync(csvFile)) { console.error(`${path.relative(REPO, csvFile)} exists and may have been edited. Nothing was written.`); process.exit(1); }

const registry = new WorkflowRegistry(path.join(REPO, 'workflows'));
registry.discover();
const cards = new Map(describeCards(registry).map(c => [c.id, c]));
const json = loadSuite(jsonFile);

const quote = (v) => {
    const s = String(v ?? '');
    return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
// A field the suite sets to nothing on purpose: an empty cell would mean 'the card's default'.
const cellOf = (v) => (v === '' ? 'empty' : typeof v === 'boolean' ? (v ? 'true' : 'false')
    : v !== null && typeof v === 'object' ? JSON.stringify(v) : String(v));

const problems = [];
const notes = [];
const rows = [];
const settingCols = [];
const inputCols = new Set();
for (const run of json.runs) {
    const card = cards.get(run.workflow);
    if (!card) { problems.push(`${run.id}: ${run.workflow} is not a usable card here`); continue; }
    const cells = { id: run.id, workflow: run.workflow, stage: run.stage, caption: run.note || '', keepRuntime: run.keepRuntime && !run.variant ? 'yes' : '' };
    for (const [key, value] of Object.entries(run.params || {})) {
        const input = card.inputs.find(i => i.key === key);
        if (input) {
            inputCols.add(input.column);
            if (value === null) cells[input.column] = 'empty';
            else if (typeof value === 'string') cells[input.column] = value.replace(/^asset:/, 'file:');
            else if (value && typeof value === 'object') {
                const from = Array.isArray(value.from) ? value.from : [value.from];
                if (from.length !== 1 || !String(from[0]).startsWith('asset:')) { problems.push(`${run.id} ${key}: reads from ${JSON.stringify(value.from)}, which a table cannot say`); continue; }
                if (value.fallback && value.fallback !== from[0]) notes.push(`${run.id} ${key}: its fallback ${value.fallback} is dropped (the source is a file that is there)`);
                cells[input.column] = formatPipeline(`file:${String(from[0]).slice(6)}`, value.derive || []);
            }
            continue;
        }
        if (card.prompt?.key === key) { cells.prompt = cellOf(value); continue; }
        if (card.negative?.key === key) { cells.negative = cellOf(value); continue; }
        if (card.seed?.key === key) { cells.seed = cellOf(value); continue; }
        if (card.settings.some(s => s.key === key)) {
            if (!settingCols.includes(key)) settingCols.push(key);
            cells[key] = cellOf(value);
            continue;
        }
        problems.push(`${run.id}: "${key}" is not a field the table can set on ${run.workflow}`);
    }
    rows.push(cells);
}

const MEDIA_ORDER = ['image', 'mask', 'video', 'audio', 'model3d'];
const media = [...inputCols].sort((a, b) => {
    const [, ta, na] = /^([a-z0-9]+?)(\d*)$/.exec(a);
    const [, tb, nb] = /^([a-z0-9]+?)(\d*)$/.exec(b);
    return MEDIA_ORDER.indexOf(ta) - MEDIA_ORDER.indexOf(tb) || Number(na || 1) - Number(nb || 1);
});
const used = (c) => rows.some(r => r[c] !== undefined && r[c] !== '');
const header = ['id', 'workflow', 'stage', 'caption', 'keepRuntime', 'prompt', 'negative', ...media, ...settingCols, 'seed'].filter(c => ['id', 'workflow'].includes(c) || used(c));
const lines = [header.map(quote).join(',')];
if (json.description) lines.push([quote(`# ${json.description}`), ...header.slice(1).map(() => '')].join(','));
for (const r of rows) lines.push(header.map(h => quote(r[h] ?? '')).join(','));
fs.writeFileSync(csvFile, lines.join('\r\n') + '\r\n');
console.log(`${path.relative(REPO, csvFile)}: ${rows.length} rows, ${header.length} columns`);

// ---- read it back the way every run will, and compare
const table = loadSuite(csvFile, registry);
for (const e of table.loadErrors) problems.push(`the table: ${e}`);
const norm = (p) => JSON.stringify(Object.fromEntries(Object.entries(p || {}).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => {
    if (v && typeof v === 'object' && !Array.isArray(v) && v.from) {
        const from = Array.isArray(v.from) ? v.from[0] : v.from;
        // A file with no steps is the file.
        if (!(v.derive || []).length) return [k, from];
        return [k, { from, kind: v.kind || null, derive: v.derive }];
    }
    return [k, v];
})));
const byId = new Map(table.runs.map(r => [r.id, r]));
let same = 0;
json.runs.forEach((a, i) => {
    const b = byId.get(a.id);
    if (!b) { problems.push(`${a.id}: missing from the table`); return; }
    const diffs = [];
    if (table.runs.indexOf(b) !== i) diffs.push(`position ${i + 1} → ${table.runs.indexOf(b) + 1}`);
    for (const f of ['workflow', 'variant', 'stage', 'note', 'keepRuntime']) {
        if ((a[f] ?? null) !== (b[f] ?? null)) diffs.push(`${f}: ${JSON.stringify(a[f])} → ${JSON.stringify(b[f])}`);
    }
    if (norm(a.params) !== norm(b.params)) {
        const pa = JSON.parse(norm(a.params));
        const pb = JSON.parse(norm(b.params));
        for (const k of new Set([...Object.keys(pa), ...Object.keys(pb)])) {
            if (JSON.stringify(pa[k]) !== JSON.stringify(pb[k])) diffs.push(`${k}: ${JSON.stringify(pa[k])?.slice(0, 120)} → ${JSON.stringify(pb[k])?.slice(0, 120)}`);
        }
    }
    if (diffs.length) problems.push(`${a.id}: ${diffs.join('; ')}`);
    else same++;
});
if (table.runs.length !== json.runs.length) problems.push(`the table has ${table.runs.length} runs, the JSON ${json.runs.length}`);
console.log(`${same} of ${json.runs.length} runs read back the same.`);
for (const n of notes) console.log(`  note: ${n}`);
for (const p of problems) console.log(`  ✗ ${p}`);
process.exit(problems.length ? 1 : 0);
