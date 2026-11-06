/**
 * Every bundle ships BOTH formats: the `<id>.api.json` ComfyQ executes and the
 * `<id>_template.json` a human opens in ComfyUI.
 *
 * Why this is a test rather than a note in a doc: the two ControlNet bundles
 * shipped 2026-09-25 with an api.json only, and nothing complained. The
 * registry treats a missing template as merely a degraded feature — "Open in
 * ComfyUI" quietly falls back to download-and-drag — so the gap survives a
 * green test run, a clean build and a calibration. It surfaces only when an
 * admin tries to open the graph and cannot.
 *
 * Generate a missing one with `node tools/api-to-ui/convert.mjs <bundle-id>`
 * (needs ComfyUI running with the bundle's node packs); it round-trips the
 * result back through Export (API) and refuses to write a template that does
 * not reproduce its own api.json.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const WORKFLOWS = path.resolve(__dirname, '../../workflows');

let passed = 0;
function test(name, fn) {
    try { fn(); passed++; console.log(`  ok   ${name}`); }
    catch (e) { console.error(`  FAIL ${name}\n       ${e.message}`); process.exitCode = 1; }
}

// Bundle folders only: `_`-prefixed ones are staging areas (_candidate_workflows).
function bundles() {
    if (!fs.existsSync(WORKFLOWS)) return [];
    return fs.readdirSync(WORKFLOWS, { withFileTypes: true })
        .filter(d => d.isDirectory() && !d.name.startsWith('_'))
        .map(d => d.name)
        .filter(id => fs.existsSync(path.join(WORKFLOWS, id, `${id}.api.json`)));
}

console.log('bundle completeness — api.json + template.json');

const ids = bundles();

test('there are bundles to check', () => {
    assert.ok(ids.length > 0, `no bundles found under ${WORKFLOWS}`);
});

test('every bundle ships a human-readable template beside its api.json', () => {
    // The registry tolerates filename variance (any `*template.json`), so match
    // the same way rather than insisting on the canonical name here — the name
    // is checked separately below so the two failures read differently.
    const missing = ids.filter(id => {
        const dir = path.join(WORKFLOWS, id);
        return !fs.readdirSync(dir).some(f => /template\.json$/i.test(f));
    });
    assert.deepStrictEqual(missing, [],
        `${missing.length} bundle(s) have no ComfyUI template — run ` +
        `"node tools/api-to-ui/convert.mjs ${missing.join(' ')}"`);
});

test('templates use the canonical <id>_template.json name', () => {
    const odd = ids.filter(id => {
        const dir = path.join(WORKFLOWS, id);
        const files = fs.readdirSync(dir).filter(f => /template\.json$/i.test(f));
        return files.length > 0 && !files.includes(`${id}_template.json`);
    });
    assert.deepStrictEqual(odd, [], `non-canonical template filename in: ${odd.join(', ')}`);
});

test('templates are UI/litegraph format, not a second copy of the api.json', () => {
    // A template is a litegraph serialization: a `nodes` ARRAY. An api.json is
    // an object keyed by node id. Copying the api.json to the template name
    // would satisfy the check above and still be useless in the editor — it
    // loads as an empty graph.
    const bad = [];
    for (const id of ids) {
        const p = path.join(WORKFLOWS, id, `${id}_template.json`);
        if (!fs.existsSync(p)) continue;
        let g;
        try { g = JSON.parse(fs.readFileSync(p, 'utf8')); }
        catch (e) { bad.push(`${id} (unparseable: ${e.message})`); continue; }
        if (!Array.isArray(g.nodes)) bad.push(`${id} (no nodes array — API format?)`);
        else if (g.nodes.length === 0) bad.push(`${id} (empty graph)`);
    }
    assert.deepStrictEqual(bad, [], `not a usable UI graph: ${bad.join(', ')}`);
});

test('every api.json node class appears in its template', () => {
    // Catches a template that has drifted from the graph that actually runs —
    // the failure mode behind "Open in ComfyUI hands over a graph without the
    // feature" (the FastVideo i2v template still lacked the last-frame loader
    // after the api.json gained it).
    //
    // Class composition, not node ids: a template legitimately keeps subgraphs
    // and notes that the flattened api.json does not have, so this is a
    // one-way check — everything that EXECUTES must be present to edit.
    const drifted = [];
    for (const id of ids) {
        const tp = path.join(WORKFLOWS, id, `${id}_template.json`);
        if (!fs.existsSync(tp)) continue;
        const api = JSON.parse(fs.readFileSync(path.join(WORKFLOWS, id, `${id}.api.json`), 'utf8'));
        const tpl = JSON.parse(fs.readFileSync(tp, 'utf8'));

        const inTemplate = new Set();
        const walk = (nodes) => {
            for (const n of nodes || []) {
                if (n.type) inTemplate.add(n.type);
                if (Array.isArray(n.nodes)) walk(n.nodes);       // nested definitions
            }
        };
        walk(tpl.nodes);
        // Subgraph definitions live outside `nodes`; a template built from
        // ComfyUI's own export keeps the real classes in there.
        for (const d of tpl.definitions?.subgraphs || []) walk(d.nodes);

        const needed = new Set(Object.values(api).map(n => n.class_type));
        const absent = [...needed].filter(c => !inTemplate.has(c));
        // A template made of subgraphs exposes none of its inner classes at the
        // top level; only flag one that shares NO class with its api.json,
        // which is the real "wrong file" case.
        if (absent.length === needed.size && needed.size > 0) {
            drifted.push(`${id} (template shares no node class with its api.json)`);
        }
    }
    assert.deepStrictEqual(drifted, [], drifted.join(', '));
});

// ★ Every model a bundle declares must say where it comes from, or a rig that
// does not have it can only be told "missing" with nowhere to go. The links are
// harvested from the workflows' own notes by tools/model-provenance, so a new
// bundle normally gets this for free — this check is what makes sure nobody
// ships one that quietly has no source.
//
// The exceptions are named, not a count: these are community files whose origin
// genuinely is not recorded anywhere, and a guessed URL would be worse than the
// gap (it would download the wrong weights). Shrink this list, never grow it
// without knowing why.
// 2026-11-04: 3DREAL (fal/LTX-2.3-3DREAL-LoRA), both Krea 2 sheet LoRAs
// (Alissonerdx/CharacterSheet) and the ID-V2V int8 build (Kijai/Wan_ID_V2V_comfy)
// were traced to their repos and verified, and left the list.
// 2026-11-05: the last one, the Qwen 2511 multiple-angles LoRA, now carries its
// url and source (fal/Qwen-Image-Edit-2511-Multiple-Angles-LoRA). No declared
// model is left unsourced; keep it that way.
const UNSOURCED_OK = new Set([]);

test('every declared model says where it comes from', () => {
    const base = (v) => String(v || '').split('\\').join('/').split('/').pop();
    const gaps = [];
    for (const id of ids) {
        const mp = path.join(WORKFLOWS, id, `${id}.meta.json`);
        if (!fs.existsSync(mp)) continue;
        const meta = JSON.parse(fs.readFileSync(mp, 'utf8'));
        for (const m of (meta.requirements?.models || [])) {
            // `auto` means a node pack fetches it: declared and excused.
            if (m.auto || m.url || m.source) continue;
            if (UNSOURCED_OK.has(base(m.file))) continue;
            gaps.push(`${id} -> ${m.file}`);
        }
    }
    assert.deepStrictEqual(gaps, [],
        `no url/source for:\n       ${gaps.join('\n       ')}\n`
        + '       Add it to tools/model-provenance/known-sources.json, then run\n'
        + '       node tools/model-provenance/harvest.cjs --write');
});

const readMeta = (id) => {
    const mp = path.join(WORKFLOWS, id, `${id}.meta.json`);
    return fs.existsSync(mp) ? JSON.parse(fs.readFileSync(mp, 'utf8')) : null;
};

// ★ A meta refers to its own parameters by KEY in several places, and nothing
// fails when one of those keys stops existing: a dangling disabledWhen never
// greys its field out, a dangling warmupParams key is skipped so calibration
// times a different job, a dangling preset value is dropped. Found 2026-11-05
// when the meta editor's save renamed 186 hand-written keys in 31 bundles. A
// renamed key must fail here rather than quietly switch a feature off.
// linkedValues / whenEmptySet name graph nodes instead; a renumbered node
// leaves them writing into nothing, so those ids are checked against the
// api.json the same way.
test('every key a meta refers to names one of its own exposed parameters', () => {
    const dangling = [];
    for (const id of ids) {
        const meta = readMeta(id);
        if (!meta) continue;
        const keys = new Set((meta.exposedParameters || []).map(p => p.key));
        const api = JSON.parse(fs.readFileSync(path.join(WORKFLOWS, id, `${id}.api.json`), 'utf8'));
        for (const p of meta.exposedParameters || []) {
            if (p.disabledWhen && !keys.has(p.disabledWhen.param)) {
                dangling.push(`${id}: ${p.key}.disabledWhen.param "${p.disabledWhen.param}"`);
            }
            for (const [what, list] of [['linkedValues', p.linkedValues], ['whenEmptySet', p.whenEmptySet]]) {
                for (const l of list || []) {
                    if (!(l.nodeId in api)) dangling.push(`${id}: ${p.key}.${what} node "${l.nodeId}" (not in api.json)`);
                }
            }
        }
        for (const k of Object.keys(meta.warmupParams || {})) {
            if (!keys.has(k)) dangling.push(`${id}: warmupParams "${k}"`);
        }
        for (const [name, preset] of Object.entries(meta.presets || {})) {
            for (const k of Object.keys(preset?.values || {})) {
                if (!keys.has(k)) dangling.push(`${id}: presets.${name} "${k}"`);
            }
        }
        // Per-deployment overrides are keyed the same way (none ship today).
        const cp = path.join(WORKFLOWS, id, `${id}.config.meta.json`);
        if (fs.existsSync(cp)) {
            const cfg = JSON.parse(fs.readFileSync(cp, 'utf8'));
            for (const k of Object.keys(cfg.parameterOverrides || {})) {
                if (!keys.has(k)) dangling.push(`${id}: config.meta parameterOverrides "${k}"`);
            }
        }
    }
    assert.deepStrictEqual(dangling, [],
        `${dangling.length} reference(s) to a parameter or node that does not exist:\n       `
        + dangling.join('\n       '));
});

// ★ A calibration warmup must run the card's DEFAULT job: runtime.json is what
// the timeline books, and a warmup cheaper than the default rewrites it the next
// time anyone presses Calibrate or runs a plain library sweep. That is how the
// FLUX.2 Klein cards came to be booked a third of their real slot. So a
// warmupParams value may differ from its param's default only where the
// difference cannot change the job's cost or is a named exception:
//   - media inputs (calibration has to stage SOME file), seeds (calibration
//     replaces every one anyway), prompts (text does not change the cost),
//     and null (= "leave this optional slot empty", the default form);
//   - WARMUP_DIFF_OK below, each with its reason.
// Shrink the list, never grow it without knowing why.
const WARMUP_DIFF_OK = new Set([
    // The LTX 2.5 IC-LoRA trio calibrates with the start image OFF, because the
    // calibrator would otherwise stage a random picture as the first frame
    // (documented 2026-09-14). The start image changes no step count or size.
    'video_edit_ltx2_5_iclora_canny_control:primitiveboolean_value_5014_5506',
    'video_edit_ltx2_5_iclora_pose_control:primitiveboolean_value_5014_5506',
    'video_edit_ltx2_5_iclora_union_control:primitiveboolean_value_5014_5506',
]);
const NOT_COMPARED_TYPES = new Set(['image', 'video', 'audio', 'mask', 'model3d', 'text', 'textarea']);

test('calibration warmups run the card\'s default job', () => {
    const { isSeedParam } = require('../benchmark/benchmarkService');
    const cheaper = [];
    for (const id of ids) {
        const meta = readMeta(id);
        if (!meta) continue;
        const byKey = new Map((meta.exposedParameters || []).map(p => [p.key, p]));
        for (const [k, v] of Object.entries(meta.warmupParams || {})) {
            const p = byKey.get(k);
            if (!p) continue;                          // reported by the check above
            if (v === null || NOT_COMPARED_TYPES.has(p.type) || isSeedParam(p)) continue;
            if (WARMUP_DIFF_OK.has(`${id}:${k}`)) continue;
            if (JSON.stringify(v) !== JSON.stringify(p.default)) {
                cheaper.push(`${id}: ${k} warms up at ${JSON.stringify(v)}, card default ${JSON.stringify(p.default)}`);
            }
        }
    }
    assert.deepStrictEqual(cheaper, [],
        'warmupParams differ from the card defaults — runtime.json would describe a job nobody books.\n       '
        + cheaper.join('\n       ')
        + '\n       Use the default, or measure the cheaper run with keepRuntime so it does not write runtime.json.');
});

test('every warmup exception still names a warmup that exists', () => {
    // A stale exception would quietly re-allow a cheaper warmup if one ever came
    // back under that key, so an entry must go when its warmup goes.
    const stale = [...WARMUP_DIFF_OK].filter(entry => {
        const [id, k] = entry.split(':');
        const meta = ids.includes(id) ? readMeta(id) : null;
        return !meta || !Object.prototype.hasOwnProperty.call(meta.warmupParams || {}, k);
    });
    assert.deepStrictEqual(stale, [], `remove from WARMUP_DIFF_OK: ${stale.join(', ')}`);
});

console.log(`\n${passed} checks passed over ${ids.length} bundles`);
if (process.exitCode) process.exit(process.exitCode);
