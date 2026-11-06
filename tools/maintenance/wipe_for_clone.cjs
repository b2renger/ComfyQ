/**
 * Clear a workshop's residue so the drive can be cloned as a master image.
 *
 * What makes this safe is that it does not guess which outputs to keep: the
 * files it spares are exactly the ones the PUBLISHED sweep report points at.
 * Those are the showcase examples, so keeping them and keeping the report
 * consistent are the same act. Everything else under the output dir is a
 * student's work from a past session.
 *
 * Deliberately NOT touched, and each for a reason:
 *   - the 688 non-ComfyQ files in ComfyUI/input: 16 months of the owner's own
 *     test material, not workshop residue. Reported, never deleted.
 *   - comfyq_model_access.jsonl: the record of which weights have actually been
 *     loaded on this machine. It can only ever PROTECT a model from pruning,
 *     and a cloned rig starts with no history of its own.
 *   - comfyq_removed_workflows.jsonl: which models each deleted workflow named.
 *     It is what lets the access log STOP protecting a deleted workflow's own
 *     weights, so it must travel with that log or the protection comes back.
 *   - pruned-models.jsonl: how to get a pruned model back. The difference
 *     between "deleted" and "lost".
 *   - config.json: not changed. The run warns (naming the key, never the value)
 *     when a HuggingFace token or a password hash is still set in it, because
 *     whatever is in it travels to every machine written from the image.
 *   - in .comfyq-lanes: whatever belongs to a ComfyUI that is still running --
 *     its entry in processes.json, its log files, its lane folder (see
 *     laneResidue.cjs). Everything else there goes.
 *
 * Usage: node wipe_for_clone.cjs [--dry] [--other-drive]
 */
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..');
// A tool that deletes by default must not treat a flag it does not know as "go
// ahead": `--help` used to run the wipe.
{
    const known = new Set(['--dry', '--other-drive']);
    const asked = process.argv.slice(2);
    const unknown = asked.filter(a => !known.has(a));
    if (unknown.length) {
        console.error(`Usage: node wipe_for_clone.cjs [--dry] [--other-drive]\n` +
            (unknown.every(a => /^(-h|--help|\/\?)$/.test(a)) ? '' : `Unknown option: ${unknown.join(' ')}. Nothing was changed.\n`));
        process.exit(1);
    }
}
const DRY = process.argv.includes('--dry');
const cfg = JSON.parse(fs.readFileSync(path.join(REPO, 'config.json'), 'utf8'));
const COMFY = cfg.comfy_ui.root_path;
const OUT = cfg.comfy_ui.output_dir || path.join(COMFY, 'output');
const INP = path.join(COMFY, 'input');
const DATA = path.join(REPO, 'server', 'data');
const { planLaneWipe } = require(path.join(__dirname, 'laneResidue.cjs'));

// This script deletes in the install config.json NAMES, not beside itself. A copy
// of ComfyQ staged on another drive still names the source, so running it there
// would wipe the source. A rig with ComfyQ and ComfyUI on two drives on purpose
// passes --other-drive. (Same-drive copies cannot be told apart: see
// tools/maintenance/backup-and-move.md.)
const sameDrive = path.parse(path.resolve(REPO)).root.toLowerCase() === path.parse(path.resolve(COMFY)).root.toLowerCase();
if (!DRY && !sameDrive && !process.argv.includes('--other-drive')) {
    console.error(`Refusing: this ComfyQ is at ${REPO}, but its config.json names an install on another drive:\n  ${COMFY}\nIf this is a staged copy, do not run the wipe here (it would delete on that drive). See tools/maintenance/backup-and-move.md.\nIf ComfyQ and ComfyUI really are on two drives, add --other-drive.`);
    process.exit(1);
}

const gb = (b) => (b / 1e9).toFixed(2) + ' GB';
let freed = 0, removed = 0;
const notes = [];

function rmFile(p) {
    let size = 0;
    try { size = fs.statSync(p).size; } catch { return; }
    if (!DRY) { try { fs.unlinkSync(p); } catch (e) { notes.push(`could not remove ${p}: ${e.message}`); return; } }
    freed += size; removed++;
}
function treeSize(p) {
    let n = 0, b = 0;
    const walk = (d) => {
        let entries;
        try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
        for (const e of entries) {
            const q = path.join(d, e.name);
            if (e.isDirectory()) walk(q);
            else { try { b += fs.statSync(q).size; n++; } catch { /* vanished */ } }
        }
    };
    if (fs.existsSync(p)) walk(p);
    return { n, b };
}
/** Remove a folder; count only what really went (a file held open stays). */
function rmTreeQuiet(p, label) {
    const before = treeSize(p);
    if (DRY) { freed += before.b; removed += before.n; return before; }
    try { fs.rmSync(p, { recursive: true, force: true }); } catch (e) { notes.push(`${label}: ${e.message}`); }
    const left = treeSize(p);
    const gone = { n: before.n - left.n, b: before.b - left.b };
    freed += gone.b; removed += gone.n;
    return gone;
}
function rmTree(p, label) {
    if (!fs.existsSync(p)) { console.log('  ' + label.padEnd(34) + ' absent'); return; }
    const { n, b } = rmTreeQuiet(p, label);
    console.log('  ' + label.padEnd(34) + ' ' + String(n).padStart(5) + ' files  ' + gb(b));
}

// ---------------------------------------------------------------- the showcase
const pubPath = path.join(DATA, 'library-sweep-latest.json');
const pub = fs.existsSync(pubPath) ? JSON.parse(fs.readFileSync(pubPath, 'utf8')) : null;
if (!pub) { console.error('No published sweep report — run the sweep before wiping, or the examples have nothing to point at.'); process.exit(1); }
// Examples already in the job history? Their inputs are about to go with the
// rest, so this has to be known before anything is removed.
let seededExamples = 0;
try {
    const Database = require(path.join(REPO, 'server', 'node_modules', 'better-sqlite3'));
    const db = new Database(path.join(DATA, 'comfyq.sqlite'), { readonly: true });
    seededExamples = db.prepare("SELECT COUNT(*) c FROM jobs WHERE user_id = 'examples'").get().c;
    db.close();
} catch { /* no db yet, or no jobs table -- nothing seeded either way */ }

const keep = new Set();
for (const r of (pub.results || [])) {
    for (const o of (r.outputs || [])) if (o.path) keep.add(path.resolve(o.path).toLowerCase());
}
console.log('showcase    %d bundles in the report, %d output files to keep\n', (pub.results || []).length, keep.size);

// ------------------------------------------------------------------- the wipe
console.log('OUTPUT  (keeping only what the report points at)');
{
    let n = 0, b = 0, kept = 0;
    const walk = (d) => {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            const q = path.join(d, e.name);
            if (e.isDirectory()) { walk(q); continue; }
            if (keep.has(path.resolve(q).toLowerCase())) { kept++; continue; }
            try { b += fs.statSync(q).size; } catch { continue; }
            n++; rmFile(q);
        }
    };
    walk(OUT);
    console.log('  ' + 'past sessions + stale sweeps'.padEnd(34) + ' ' + String(n).padStart(5)
        + ' files  ' + gb(b) + '   (' + kept + ' kept as examples)');
}

console.log('\nINPUT  (ComfyQ uploads only)');
{
    // What ComfyQ stages in ComfyUI/input: students' uploads (comfyq_session__),
    // the per-run copies (comfyq__) and a storyboard's chained frames, copied
    // from students' results (comfyq_chain__; only student mode sweeps those,
    // after 24 h, and this runs in admin mode). comfyq_placeholder.png stays: it
    // is infrastructure.
    const STAGED = /^comfyq_(session|chain)__|^comfyq__/;
    let n = 0, b = 0;
    for (const e of fs.readdirSync(INP, { withFileTypes: true })) {
        if (!e.isFile()) continue;
        if (!STAGED.test(e.name)) continue;
        const q = path.join(INP, e.name);
        try { b += fs.statSync(q).size; } catch { continue; }
        n++; rmFile(q);
    }
    console.log('  ' + 'uploads + storyboard frames'.padEnd(34) + ' ' + String(n).padStart(5) + ' files  ' + gb(b));
    // ★ The examples' inputs are staged under the same `comfyq_session__` prefix
    // a real booking uses, which is the whole point of them -- so a wipe run
    // AFTER seeding strips them and leaves every example pointing at a file that
    // is not there. Say so rather than leaving it to be discovered.
    if (seededExamples) {
        // The job history is emptied further down, so the example jobs themselves
        // go too -- not only their inputs.
        notes.push(`${seededExamples} seeded examples were in the job history; the history has been emptied `
            + `and their input files cleared with everybody else's. Run tools/maintenance/seed_examples.cjs --replace `
            + `again to put them back -- seeding belongs AFTER this script, not before.`);
    }
    rmTree(path.join(INP, 'clipspace'), "ComfyUI's mask-editor scratch");
    let own = 0, ownB = 0;
    const walkOwn = (d) => {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            const q = path.join(d, e.name);
            if (e.isDirectory()) { if (e.name !== 'clipspace') walkOwn(q); continue; }
            // Skip what the wipe removes above (still there in a --dry run) and
            // the placeholder; a file that only LOOKS like ComfyQ's is counted.
            if (STAGED.test(e.name) || e.name === 'comfyq_placeholder.png') continue;
            try { ownB += fs.statSync(q).size; own++; } catch { /* ignore */ }
        }
    };
    walkOwn(INP);
    notes.push(`left alone: ${own} files (${gb(ownB)}) in ComfyUI/input that ComfyQ did not put there — `
        + `the owner's own test material, going back to June 2025. Delete by hand if the clone should not carry it.`);
}

console.log('\nELSEWHERE');
rmTree(path.join(COMFY, 'comfyq_ingredients'), 'per-job ingredient snapshots');
rmTree(path.join(COMFY, 'temp'), "ComfyUI's temp dir");
// .comfyq-lanes also holds the registry and the console logs of the ComfyUI
// that is running right now (the main one included), which outlives ComfyQ.
// Those stay; the lanes and logs of ComfyUIs that are gone are residue.
{
    const lanesDir = path.join(REPO, '.comfyq-lanes');
    const label = 'lane state + ComfyUI logs';
    if (!fs.existsSync(lanesDir)) console.log('  ' + label.padEnd(34) + ' absent');
    else {
        const plan = planLaneWipe(lanesDir);
        let n = 0, b = 0;
        for (const p of plan.remove) {
            let isDir = false;
            try { isDir = fs.statSync(p).isDirectory(); } catch { continue; }
            if (isDir) { const g = rmTreeQuiet(p, label); n += g.n; b += g.b; }
            else {
                const before = removed, size = (() => { try { return fs.statSync(p).size; } catch { return 0; } })();
                rmFile(p);
                if (removed > before) { n++; b += size; }
            }
        }
        console.log('  ' + label.padEnd(34) + ' ' + String(n).padStart(5) + ' files  ' + gb(b)
            + (plan.livePorts.length ? `   (kept: the running ComfyUI on port ${plan.livePorts.join(', ')})` : ''));
    }
}
rmTree(path.join(REPO, 'logs'), 'old logs/ (nothing writes it now)');

// Stale per-run sweep records: they describe libraries that no longer match
// (two of them still list bundles that have since been removed).
{
    // ★ Keep the run records BEHIND the published report, drop the ones it
    // superseded. Keying this on a field of the report was wrong: a merged
    // report does not carry `recoveredFrom`, so the rule would have deleted
    // today's own records along with the stale ones. The report's earliest row
    // is a fact it always has.
    const oldestRow = (pub.results || []).reduce((min, r) => {
        const t = Date.parse(r.startedAt || '');
        return t && (!min || t < min) ? t : min;
    }, 0);
    const keepAfter = oldestRow ? oldestRow - 3600e3 : 0;   // an hour of slack
    let n = 0, b = 0;
    for (const f of fs.readdirSync(DATA)) {
        if (!/^library-sweep-.*\.jsonl$/.test(f)) continue;
        try { if (keepAfter && fs.statSync(path.join(DATA, f)).mtimeMs >= keepAfter) continue; }
        catch { continue; }
        const q = path.join(DATA, f);
        try { b += fs.statSync(q).size; } catch { continue; }
        n++; rmFile(q);
    }
    console.log('  ' + 'superseded sweep run records'.padEnd(34) + ' ' + String(n).padStart(5) + ' files  ' + gb(b));
}

// ------------------------------------------------------------- the job history
console.log('\nJOB HISTORY');
{
    const Database = require(path.join(REPO, 'server', 'node_modules', 'better-sqlite3'));
    const dbPath = path.join(DATA, 'comfyq.sqlite');
    const before = fs.statSync(dbPath).size;
    const db = new Database(dbPath);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(t => t.name);
    const counts = {};
    for (const t of tables) {
        if (t.startsWith('sqlite_')) continue;
        counts[t] = db.prepare(`SELECT COUNT(*) c FROM "${t}"`).get().c;
    }
    console.log('  tables: %s', JSON.stringify(counts));
    let vacuumed = true;
    if (!DRY) {
        for (const t of Object.keys(counts)) db.prepare(`DELETE FROM "${t}"`).run();
        // ★ VACUUM wants an exclusive lock, and ComfyQ is normally RUNNING with
        // this same file open -- so it can legitimately fail with SQLITE_BUSY.
        // The rows are already gone by then; reclaiming a megabyte of file is
        // not worth failing the wipe over, so it is attempted and reported.
        try { db.pragma('wal_checkpoint(TRUNCATE)'); db.exec('VACUUM'); }
        catch (e) { vacuumed = false; notes.push(`the job rows are deleted, but the database was not compacted `
            + `(${e.message}) -- ComfyQ is holding it open. Harmless; it compacts next time, or stop ComfyQ and re-run.`); }
    }
    db.close();
    const after = DRY ? before : fs.statSync(dbPath).size;
    console.log('  ' + 'cleared'.padEnd(34) + ' ' + String(Object.values(counts).reduce((a, c) => a + c, 0)).padStart(5)
        + ' rows     ' + gb(before) + ' -> ' + gb(after) + (vacuumed ? '' : '   (not compacted)'));
    if (!DRY) freed += before - after;
}

// ------------------------------------------------- partial downloads
// A cancelled or failed download leaves <name>.part under models/. It is ours, it
// is never a model (only a finished download is renamed), and a clone gains
// nothing from half a file.
{
    console.log('\nMODELS  (partial downloads)');
    let n = 0, b = 0;
    const walk = (d) => {
        let entries;
        try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
        for (const e of entries) {
            const q = path.join(d, e.name);
            if (e.isDirectory()) { walk(q); continue; }
            if (!e.isFile() || !e.name.toLowerCase().endsWith('.part')) continue;
            try { b += fs.statSync(q).size; } catch { continue; }
            n++; rmFile(q);
        }
    };
    walk(path.join(COMFY, 'models'));
    console.log('  ' + '.part files'.padEnd(34) + ' ' + String(n).padStart(5) + ' files  ' + gb(b));
}

// --------------------------------------------------------------- serving state
{
    const marker = path.join(DATA, '.serving');
    const oneShot = path.join(DATA, '.boot-student');
    for (const [p, label] of [[marker, '.serving (standing intent)'], [oneShot, '.boot-student (one-shot)']]) {
        if (fs.existsSync(p)) { if (!DRY) fs.unlinkSync(p); console.log('\n  removed %s — every clone boots into admin', label); }
    }
    if (!fs.existsSync(marker)) console.log('\nserving     marker absent: a cloned machine boots into admin mode');
}

// ------------------------------------------------------------------- secrets
// Not cleared here -- whether a clone should carry them is the owner's call --
// but never let one travel unnoticed. The key is named, never the value.
for (const [key, val] of [
    ['comfy_ui.hf_token', cfg.comfy_ui?.hf_token],
    ['auth.adminPasswordHash', cfg.auth?.adminPasswordHash],
    ['auth.accessPasswordHash', cfg.auth?.accessPasswordHash],
]) {
    if (val) notes.push(`config.json still carries ${key}. It travels to every machine written from this `
        + `image (docs/cloning-the-drive.md, step 5) -- clear it before imaging if the clones should not have it.`);
}
// configManager keeps earlier copies beside config.json (config.json.v1.bak when
// it archives an old format, config.json.broken-<n>.bak when it sets a broken one
// aside) and writes through config.json.tmp; a hand-made config.json.bak is the
// same thing. Any of them can hold the same secrets. Named, never deleted: same
// owner's call as above.
for (const name of fs.readdirSync(REPO)) {
    if (/^config\.json\.(.*\.)?bak$/.test(name) || name === 'config.json.tmp') {
        notes.push(`${name} is a kept copy of an earlier config.json and may carry the same secrets (password `
            + `hashes, hf_token). It travels to every machine written from this image; delete it before imaging `
            + `if the clones should not have it.`);
    }
}

console.log('\n----------------------------------------------------------------');
console.log((DRY ? 'WOULD REMOVE ' : 'removed ') + removed + ' files, ' + gb(freed) + ' reclaimed');
for (const n of notes) console.log('\n! ' + n);
if (DRY) console.log('\n(dry run - nothing was deleted)');
