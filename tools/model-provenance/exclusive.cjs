#!/usr/bin/env node
// Which model files are EXCLUSIVE to a set of bundles, i.e. safe to delete if
// those bundles go — and which are shared with workflows that stay.
//
// ★ Never read a bundle's requirements.models as "its own" models. Marigold
// declared the 19 GB Qwen-Image-Edit UNET because it is BUILT ON it, and that
// file serves a production bundle; the Viggle adapter's bundle declared the
// whole shared Qwen 2.1 base. Taken literally, "remove the models for X" would
// have deleted 35 GB that four live bundles need. This exists so that cannot
// happen by hand.
//
// The keep-set is deliberately wider than the obvious one:
//   - every other bundle's api.json AND its _template.json — a human opens the
//     template in ComfyUI, so a weight it loads is still in use
//   - the candidates in _candidate_workflows
//   - the other workflow dirs on this machine (demo, ComfyUI's own user dir)
//   - every other bundle's requirements.models
//   - ★ the `lora` dropdowns' optionsFilter prefixes: a dropdown exposes EVERY
//     file matching its prefix, so those are reachable without being named in
//     any graph at all
//
// Usage: COMFY_ROOT=<install> node exclusive.cjs <bundle-id> [<bundle-id>…]
//        add --orphans to also list files sitting unreferenced beside them
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const WF = path.join(ROOT, 'workflows');
const WEIGHT_RX = /\.(safetensors|sft|ckpt|pt|pth|gguf|onnx|bin)$/i;
const ORPHANS = process.argv.includes('--orphans');
const REMOVE = process.argv.slice(2).filter(a => !a.startsWith('--'));

if (!REMOVE.length) {
    console.error('usage: COMFY_ROOT=<install> node exclusive.cjs <bundle-id> [<bundle-id>…] [--orphans]');
    process.exit(2);
}

let comfyRoot = process.env.COMFY_ROOT;
if (!comfyRoot) {
    try { comfyRoot = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8')).comfy_ui?.root_path; }
    catch { /* no config on this machine */ }
}
if (!comfyRoot || !fs.existsSync(comfyRoot)) {
    console.error('ComfyUI install not found — set COMFY_ROOT');
    process.exit(2);
}

const { buildModelIndex } = require(path.join(ROOT, 'server', 'workflows', 'vramEstimate'));
const index = buildModelIndex(comfyRoot);

const read = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
// ComfyUI reports subfolder-qualified names on Windows (marigold_v2\x.safetensors).
const base = (v) => String(v || '').split('\\').join('/').split('/').pop();

function namesIn(graph) {
    const out = new Set();
    const nodes = Array.isArray(graph.nodes) ? graph.nodes : Object.values(graph);
    for (const n of nodes) {
        if (!n || typeof n !== 'object') continue;
        const vals = [
            ...Object.values(n.inputs || {}),
            ...(Array.isArray(n.widgets_values) ? n.widgets_values : []),
        ];
        for (const v of vals) if (typeof v === 'string' && WEIGHT_RX.test(v)) out.add(base(v));
    }
    return out;
}
const collect = (files) => {
    const s = new Set();
    for (const f of files) { const g = read(f); if (g) for (const n of namesIn(g)) s.add(n); }
    return s;
};
const bundleFiles = (id) => ['.api.json', '_template.json']
    .map(s => path.join(WF, id, id + s)).filter(fs.existsSync);
const metaModels = (id) => (read(path.join(WF, id, `${id}.meta.json`))?.requirements?.models || []);

for (const id of REMOVE) {
    if (!fs.existsSync(path.join(WF, id))) { console.error(`no such bundle: ${id}`); process.exit(2); }
}

// ---- what the doomed bundles reference
const gone = collect(REMOVE.flatMap(bundleFiles));
for (const id of REMOVE) for (const m of metaModels(id)) if (WEIGHT_RX.test(base(m.file))) gone.add(base(m.file));

// ---- the keep-set
const keepFiles = [];
const all = fs.readdirSync(WF).filter(d => fs.statSync(path.join(WF, d)).isDirectory());
for (const d of all) {
    if (d.startsWith('_') || REMOVE.includes(d)) continue;
    keepFiles.push(...bundleFiles(d));
}
const extraDirs = [path.join(WF, '_candidate_workflows'), 'J:/_demo_workflows',
    path.join(comfyRoot, 'user', 'default', 'workflows')];
for (const dir of extraDirs) {
    if (!fs.existsSync(dir)) continue;
    const walk = (d) => {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            const p = path.join(d, e.name);
            if (e.isDirectory()) walk(p);
            else if (e.name.endsWith('.json')) keepFiles.push(p);
        }
    };
    walk(dir);
}
const keep = collect(keepFiles);
const filters = [];
for (const d of all) {
    if (d.startsWith('_') || REMOVE.includes(d)) continue;
    for (const m of metaModels(d)) if (WEIGHT_RX.test(base(m.file))) keep.add(base(m.file));
    for (const p of (read(path.join(WF, d, `${d}.meta.json`))?.exposedParameters || [])) {
        if (p.optionsFilter) filters.push({ bundle: d, prefix: p.optionsFilter.toLowerCase() });
    }
}

// ---- classify
const shared = [], protectedBy = [], exclusive = [], absent = [];
for (const name of [...gone].sort()) {
    const hit = index.get(name);
    if (keep.has(name)) { shared.push([name, hit]); continue; }
    const f = filters.find(x => name.toLowerCase().startsWith(x.prefix));
    if (f) { protectedBy.push([name, hit, f]); continue; }
    if (!hit) { absent.push(name); continue; }
    exclusive.push([name, hit]);
}

const gb = (h) => (h ? (h.size / 1024 ** 3).toFixed(2) + ' GB' : 'n/a').padStart(10);
const sum = (rows) => rows.reduce((t, [, h]) => t + (h ? h.size / 1024 ** 3 : 0), 0);

console.log(`removing: ${REMOVE.join(', ')}`);
console.log(`keep-set: ${keepFiles.length} workflow files, ${all.length - REMOVE.length} other bundles, ${filters.length} lora dropdowns`);
console.log(`these bundles reference ${gone.size} weight files\n`);

console.log(`SHARED with workflows that stay — KEEP (${sum(shared).toFixed(2)} GB):`);
for (const [n, h] of shared) console.log(`   ${gb(h)}  ${n}`);
if (!shared.length) console.log('   (none)');

if (protectedBy.length) {
    console.log(`\nPROTECTED by a lora dropdown elsewhere — KEEP:`);
    for (const [n, h, f] of protectedBy) console.log(`   ${gb(h)}  ${n}   (${f.bundle})`);
}
if (absent.length) console.log(`\nreferenced but not on this disk: ${absent.join(', ')}`);

console.log(`\nEXCLUSIVE — safe to delete (${sum(exclusive).toFixed(2)} GB):`);
for (const [, h] of exclusive) console.log(`   ${gb(h)}  ${h.rel}`);
if (!exclusive.length) console.log('   (none)');

if (ORPHANS) {
    // Files in the same folders that nothing anywhere references. Not implied by
    // the removal, but this is when you notice them.
    const dirs = new Set(exclusive.map(([, h]) => path.posix.dirname(h.rel)));
    const orphans = [...index.entries()].filter(([n, v]) =>
        dirs.has(path.posix.dirname(v.rel)) && !gone.has(n) && !keep.has(n)
        && !filters.some(f => n.toLowerCase().startsWith(f.prefix)));
    if (orphans.length) {
        console.log(`\nORPHANS in the same folders, referenced by nothing (${(orphans.reduce((t, [, v]) => t + v.size / 1024 ** 3, 0)).toFixed(2)} GB):`);
        for (const [, v] of orphans) console.log(`   ${gb(v)}  ${v.rel}`);
    }
}

console.log('\nNothing was deleted — this tool only reports.');
