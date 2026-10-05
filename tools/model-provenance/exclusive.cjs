#!/usr/bin/env node
// Which model files are EXCLUSIVE to a set of bundles — i.e. safe to delete if
// those bundles go — and which are shared with workflows that stay.
//
// ★ Never read a bundle's requirements.models as "its own" models. Marigold
// declared the 19 GB Qwen-Image-Edit UNET because it is BUILT ON it, and that
// file serves a production bundle; the Viggle adapter's bundle declared the
// whole shared Qwen 2.1 base. Taken literally, "remove the models for X" would
// have deleted 35 GB that four live bundles need. This exists so that cannot
// happen by hand.
//
// ★ It shares its engine with the admin panel's Maintenance tab
// (server/workflows/modelUsage.js), deliberately: if the command line and the
// panel disagreed about what is unused, one of them would be inviting someone
// to delete a model that is needed. Read that file for what "used" covers —
// bundles, their editable templates, lora dropdown prefixes, and workflows in
// the candidate / demo / ComfyUI-user folders.
//
// Usage: COMFY_ROOT=<install> node exclusive.cjs <bundle-id> [<bundle-id>…]
//        --unused   list everything unused on the disk instead
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const WF = path.join(ROOT, 'workflows');
const UNUSED_MODE = process.argv.includes('--unused');
const REMOVE = process.argv.slice(2).filter(a => !a.startsWith('--'));

if (!REMOVE.length && !UNUSED_MODE) {
    console.error('usage: COMFY_ROOT=<install> node exclusive.cjs <bundle-id> [<bundle-id>…]');
    console.error('       COMFY_ROOT=<install> node exclusive.cjs --unused');
    process.exit(2);
}

let comfyRoot = process.env.COMFY_ROOT;
let extraDirs = [];
try {
    const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
    comfyRoot = comfyRoot || cfg.comfy_ui?.root_path;
    extraDirs = [...(cfg.maintenance?.workflowScanDirs || [])];
} catch { /* no config on this machine */ }
if (!comfyRoot || !fs.existsSync(comfyRoot)) {
    console.error('ComfyUI install not found — set COMFY_ROOT');
    process.exit(2);
}
extraDirs.push(path.join(comfyRoot, 'user', 'default', 'workflows'));

const { buildModelUsage } = require(path.join(ROOT, 'server', 'workflows', 'modelUsage'));
const gb = (n) => `${n.toFixed(2)} GB`.padStart(10);
const sum = (rows) => rows.reduce((t, m) => t + m.gb, 0);

for (const id of REMOVE) {
    if (!fs.existsSync(path.join(WF, id))) { console.error(`no such bundle: ${id}`); process.exit(2); }
}

const report = buildModelUsage({ comfyRoot, workflowsDir: WF, extraDirs, ignoreBundles: REMOVE });
console.log(`scanned ${report.scanned.bundles} bundles and ${report.scanned.files} workflow files`);
for (const d of report.scanned.dirs) console.log(`   also: ${d}`);

if (UNUSED_MODE) {
    const unused = report.models.filter(m => m.unused);
    console.log(`\n${report.totals.all} model files, ${report.totals.allGb} GB in all`);
    console.log(`UNUSED: ${unused.length} files, ${report.totals.unusedGb} GB\n`);
    for (const m of unused) console.log(`   ${gb(m.gb)}  ${m.rel}`);
    const review = report.models.filter(m => !m.unused && m.textOnly);
    if (review.length) {
        console.log(`\nKEPT, but every mention is text rather than a loader (${report.totals.reviewGb} GB):`);
        for (const m of review) {
            console.log(`   ${gb(m.gb)}  ${m.rel}`);
            console.log(`               ${m.nodeTypes.map(t => `${t.type}x${t.count}`).join(', ')}`);
        }
    }
    console.log('\nNothing was deleted — this tool only reports.');
    process.exit(0);
}

// What the doomed bundles reference is whatever became unused by ignoring them,
// plus anything of theirs that is still held by something else.
const full = buildModelUsage({ comfyRoot, workflowsDir: WF, extraDirs });
const theirs = new Set();
for (const m of full.models) {
    const mine = [...m.usedBy, ...m.templateOnly, ...m.dropdowns].some(b => REMOVE.includes(b));
    if (mine) theirs.add(m.name);
}

const after = new Map(report.models.map(m => [m.name, m]));
const exclusive = [], shared = [];
for (const name of [...theirs].sort()) {
    const m = after.get(name);
    if (!m) continue;
    (m.unused ? exclusive : shared).push(m);
}
exclusive.sort((a, b) => b.gb - a.gb);
shared.sort((a, b) => b.gb - a.gb);

console.log(`\nremoving: ${REMOVE.join(', ')}`);
console.log(`they reference ${theirs.size} model files\n`);

console.log(`SHARED with workflows that stay — KEEP (${sum(shared).toFixed(2)} GB):`);
for (const m of shared) {
    const who = m.usedBy.length ? m.usedBy.join(', ')
        : m.templateOnly.length ? `template of ${m.templateOnly.join(', ')}`
            : m.dropdowns.length ? `dropdown in ${m.dropdowns.join(', ')}`
                : 'a workflow outside the bundles';
    console.log(`   ${gb(m.gb)}  ${m.name}`);
    console.log(`               still used by ${who}`);
}
if (!shared.length) console.log('   (none)');

console.log(`\nEXCLUSIVE — safe to delete (${sum(exclusive).toFixed(2)} GB):`);
for (const m of exclusive) console.log(`   ${gb(m.gb)}  ${m.rel}`);
if (!exclusive.length) console.log('   (none)');

console.log('\nNothing was deleted — this tool only reports.');
