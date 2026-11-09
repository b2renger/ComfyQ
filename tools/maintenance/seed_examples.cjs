/**
 * Turn the library sweep into a browsable showcase.
 *
 * The sweep runs every workflow once and keeps what each produced, but it runs
 * through the calibrator rather than the queue -- so none of it is a JOB, and
 * none of it appears in the client's all-jobs view. This writes one COMPLETED
 * job per workflow pointing at the sweep's own result and the settings that
 * produced it, under a dedicated `examples` user, so anyone opening a freshly
 * cloned machine can see what the rig can do and exactly how each was made.
 *
 * Four things make it durable, each of which a naive version gets wrong:
 *
 *  - The sweep stages its media inputs under the `comfyq__` prefix
 *    (`comfyq__<run token>__<name>`): calibration deletes them when the run
 *    ends, and the `comfyq__` prefix is what InputUploader.sweepStale() deletes
 *    after ~30 minutes anyway. So each input is re-staged from its ORIGINAL
 *    source file under the durable `comfyq_session__` prefix -- the prefix a
 *    real booking uses and the one the sweeper leaves alone.
 *  - The staged name follows ComfyQ's own upload convention
 *    (`comfyq_session__<n>_<n>__<original>`), because ingredientsStore parses
 *    the original filename back out of it for the "Imported media" list.
 *  - The output's kind comes from ComfyQ's classifier, not the sweep's: the
 *    sweep calls a `.spz` Gaussian splat `model3d`, which would route it to
 *    the mesh viewer instead of the splat viewer.
 *  - A parameter's value must be the staged filename, not the asset's path,
 *    because that is what the form recalls and what /input-media serves.
 *
 * No ingredients snapshot is written: these jobs never pass through the
 * executor, and the "Download ingredients" zip is built live from the staged
 * inputs instead (routes/jobs.js) — one copy on disk however many examples
 * share it.
 *
 * Usage: node seed_examples.cjs [--dry] [--only a,b] [--replace]
 *
 *  --replace  first delete the `examples` jobs of every bundle about to be
 *             seeded, so a re-run REPLACES that bundle's example instead of
 *             adding a second one. Only the job rows go: their inputs stay staged
 *             (another example may share one) and their outputs stay on disk.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO = path.resolve(__dirname, '..', '..');
const Database = require(path.join(REPO, 'server', 'node_modules', 'better-sqlite3'));
const { classify } = require(path.join(REPO, 'server', 'media', 'mediaTypes'));
const DB = path.join(REPO, 'server', 'data', 'comfyq.sqlite');
const cfg = JSON.parse(fs.readFileSync(path.join(REPO, 'config.json'), 'utf8'));
const COMFY = cfg.comfy_ui.root_path;
const OUT = cfg.comfy_ui.output_dir || path.join(COMFY, 'output');
const INP = path.join(COMFY, 'input');
// It writes into the queue by default, so an option it does not know (a typo,
// --help) stops it before anything is touched.
{
    const args = process.argv.slice(2);
    const bad = args.filter((a, i) => a.startsWith('-') && !['--dry', '--replace', '--only'].includes(a) && !a.startsWith('--only='));
    const onlyAt = args.indexOf('--only');
    if (bad.length || (onlyAt >= 0 && (!args[onlyAt + 1] || args[onlyAt + 1].startsWith('-')))) {
        console.error(bad.length ? `Unknown option ${bad.join(', ')}. Nothing was written.` : '--only needs a list of bundles. Nothing was written.');
        console.error('Usage: node tools/maintenance/seed_examples.cjs [--dry] [--only a,b] [--replace]');
        process.exit(1);
    }
}
const DRY = process.argv.includes('--dry');
const USER = 'examples';
// `--only a,b,c` seeds just those bundles. Seeding INSERTS rather than
// replaces, so when a few bundles are added to an existing showcase, re-running
// the whole thing would duplicate every example and orphan every input it had
// already staged. Naming the new ones avoids both.
const onlyArg = (process.argv.find(a => a.startsWith('--only=')) || '').slice('--only='.length)
    || (process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : '');
const ONLY = onlyArg ? new Set(onlyArg.split(',').map(s => s.trim()).filter(Boolean)) : null;
const REPLACE = process.argv.includes('--replace');

// The run the sweep published is the showcase: one row per bundle, merged over
// previous runs, which is exactly the 61-row picture the report serves.
const latest = path.join(REPO, 'server', 'data', 'library-sweep-latest.json');
if (!fs.existsSync(latest)) { console.error('no published sweep at ' + latest); process.exit(1); }
const pub = JSON.parse(fs.readFileSync(latest, 'utf8'));
const rows = pub.results || pub.rows || [];
console.log('sweep       %s  (%d bundles, finished %s)', path.basename(latest), rows.length, pub.finishedAt || '?');

// Captions are read from the suite FILE at seeding time, not only from the run
// record: a caption is a claim about the result, and it is often only after a
// run has been looked at that its wording can be made true (a purr that came out
// inaudible, a crop the caption promised away). ★ But only when the published row
// IS the run that file entry describes — same prompts, same inputs. A row left
// over from an older version of the suite keeps its own note; the current file's
// caption would describe a different result. Every caption taken from the file
// is printed.
const { loadSuite } = require(path.join(REPO, 'server', 'benchmark', 'suitePlan'));
// The same-run check and the output filter live in exampleRules.cjs, where they
// are tested (exampleRules.test.cjs).
const { sameRun, showableOutputs, wholeValue } = require(path.join(__dirname, 'exampleRules.cjs'));
const suiteRuns = new Map();
const captionFor = (r) => {
    const name = r.suite?.name;
    if (!name) return null;
    if (!suiteRuns.has(name)) {
        const m = new Map();
        try { for (const run of loadSuite(name).runs) if (!run.variant) m.set(run.workflow, run); }
        catch { /* the suite file is gone: keep the run's own notes */ }
        suiteRuns.set(name, m);
    }
    const fileRuns = suiteRuns.get(name);
    const fileRun = fileRuns.get(r.id);
    if (fileRun && fileRun.note && sameRun(fileRun, r, { rows, fileRuns })) return fileRun.note;
    return r.suite?.note || null;
};
const captionsChanged = [];

// Graph literals, for the one case the sweep row cannot answer: a prompt over
// 2000 characters is truncated in the report.
const literalOf = (id, node) => {
    try {
        const g = JSON.parse(fs.readFileSync(path.join(REPO, 'workflows', id, id + '.api.json'), 'utf8'));
        const parts = String(node).split('.');
        const field = parts.pop();
        const nodeId = parts.join('.');
        return g[nodeId] && g[nodeId].inputs ? g[nodeId].inputs[field] : undefined;
    } catch { return undefined; }
};

// Stage an input durably, sharing one copy between every example that used it.
let stageN = 0;
const stagedCache = new Map();
function stage(src) {
    if (stagedCache.has(src)) return stagedCache.get(src);
    const base = path.basename(src);
    const size = fs.statSync(src).size;
    let name = 'comfyq_session__0_0__' + base;
    for (let i = 1; ; i++) {
        const dest = path.join(INP, name);
        if (!fs.existsSync(dest)) { if (!DRY) { fs.copyFileSync(src, dest); stageN++; } break; }
        if (fs.statSync(dest).size === size) break;            // already there, same file
        name = 'comfyq_session__0_' + i + '__' + base;         // same name, different file
    }
    stagedCache.set(src, name);
    return name;
}

const db = DRY ? null : new Database(DB);
const insert = db && db.prepare(
    'INSERT INTO jobs (id,user_id,workflow_id,workflow_version,status,scheduled_at,'
    + 'started_at,finished_at,prompt_id,prompt,param_values,input_files,outputs,progress,'
    + 'current_node,error_reason,error_phase,created_by,created_at,batch_label) '
    + "VALUES (@id,@user_id,@workflow_id,NULL,'completed',@at,@at,@fin,NULL,@prompt,"
    + "@param_values,'[]',@outputs,@progress,NULL,NULL,NULL,'library-sweep',@at,@caption)");

let made = 0, noOutput = 0, failedRow = 0, replaced = 0;
const lostInputs = [];
const skipped = [];

// A value a report from before 2026-11-09 cut short, made whole only when that
// can be known (exampleRules.wholeValue): three of four long prompts would
// otherwise have been seeded with the card's default prompt.
const wholeOf = (r, ing) => wholeValue(ing, literalOf(r.id, ing.node));
const cutBeyondRepair = (r) => (r.ingredients || []).filter(ing => ing.truncated && wholeOf(r, ing) === null);

// Replace rather than add: drop the example of every bundle this run seeds,
// decided BEFORE inserting so a bundle whose new row fails is not left empty
// for nothing -- it keeps its old example. A row with a value cut beyond repair
// is not seeded, so its old example stays too.
const seeding = rows.filter(r => !r.variantOf && (!ONLY || ONLY.has(r.id)) && r.ok && (r.outputs || []).length
    && !cutBeyondRepair(r).length).map(r => r.id);
if (REPLACE && seeding.length && !DRY) {
    const del = db.prepare("DELETE FROM jobs WHERE user_id = ? AND workflow_id = ?");
    for (const id of seeding) replaced += del.run(USER, id).changes;
}
for (const r of rows) {
    if (r.variantOf) continue;     // a test-only run: it never replaces a card's example
    if (ONLY && !ONLY.has(r.id)) continue;
    if (!r.ok) { failedRow++; skipped.push(r.id + (r.skipped ? ' (a test-suite input was missing)' : ' (the sweep run failed)')); continue; }
    const cut = cutBeyondRepair(r);
    if (cut.length) {
        skipped.push(`${r.id} (the report cut ${cut.map(i => `${i.key} at ${String(i.value || '').length} of ${i.truncated} characters`).join(', ')}; its old example is kept)`);
        continue;
    }

    // Outputs. `file` is already output-root-relative, which is what /images
    // serves; kind and mime come from ComfyQ's classifier so each result lands
    // in the right viewer. Stray text tiles ("3", a tensor shape) and VHS's
    // first-frame PNG are left out: a student opening the example should see
    // what the card is for.
    const outputs = [];
    for (const o of showableOutputs(r.outputs)) {
        if (o.kind === 'text') {
            const m = String(o.file || '').match(/node (\S+)/);
            outputs.push({
                kind: 'text', mime: 'text/plain', filename: null, subfolder: '',
                type: 'output', nodeId: m ? m[1] : null, sizeBytes: null, text: o.text,
            });
            continue;
        }
        if (!o.file || !o.path || !fs.existsSync(o.path)) continue;
        const c = classify(o.file);
        outputs.push({
            kind: c.kind, mime: c.mime, filename: o.file, subfolder: '',
            type: 'output', nodeId: null,
            sizeBytes: o.bytes != null ? o.bytes : fs.statSync(o.path).size,
        });
    }
    if (!outputs.length) { noOutput++; skipped.push(r.id + ' (produced nothing to show)'); continue; }

    // Parameters: the EFFECTIVE values the sweep recorded -- which is the point,
    // because calibration sends only the media and a seed, so most values are
    // the graph's own literal and would be blank in a list built from the sent
    // parameters alone.
    const params = {};
    let prompt = null;
    for (const ing of (r.ingredients || [])) {
        let v = ing.value;
        if (ing.truncated) v = wholeOf(r, ing);   // never null here: such rows were skipped
        const isMedia = ['image', 'video', 'audio', 'mask', 'model3d'].includes(ing.type);
        if (ing.sourcePath && fs.existsSync(ing.sourcePath)) {
            v = stage(ing.sourcePath);
        } else if (isMedia && typeof v === 'string' && /^comfyq_/.test(v)) {
            // ★ The value is the sweep's own staged copy, under the `comfyq__`
            // prefix the uploader sweeps away -- and the wipe removes it too. With
            // no original to re-stage from, recording it would leave the example
            // pointing at a file that is not there. Say so instead.
            lostInputs.push(r.id + ' / ' + ing.key);
            continue;
        }
        if (v === undefined) continue;
        params[ing.key] = v;
        if (!prompt && ing.type === 'textarea' && typeof v === 'string' && v.trim()
            && !/negative/i.test(ing.key) && !/negative/i.test(ing.label || '')) prompt = v;
    }

    const at = Date.parse(r.startedAt || '') || Date.parse(pub.startedAt || '') || 0;
    const fin = Date.parse(r.finishedAt || '') || at + (r.wallSec || 10) * 1000;
    if (!at) { skipped.push(r.id + ' (no timestamp)'); continue; }
    const steps = r.steps || 1;
    const caption = captionFor(r);
    if (caption && r.suite?.note && caption !== r.suite.note) captionsChanged.push(r.id);
    if (!DRY) {
        insert.run({
            id: crypto.randomUUID(), user_id: USER, workflow_id: r.id,
            at, fin, prompt,
            param_values: JSON.stringify(params),
            outputs: JSON.stringify(outputs),
            progress: JSON.stringify({ stepsDone: steps, stepsTotal: steps }),
            // What this example shows — the test suite's note for the run, so a
            // student opening it learns what to look at (shown in the lightbox
            // and on the card's "See an example").
            caption,
        });
    }
    made++;
}

if (REPLACE) console.log('replaced    %d earlier example job(s)', replaced);
if (captionsChanged.length) {
    console.log('captions    %d corrected in the suite file since their run: %s',
        captionsChanged.length, captionsChanged.join(', '));
}
console.log('examples    %d jobs written as user "%s"', made, USER);
console.log('inputs      %d media files staged durably (%d distinct sources)', stageN, stagedCache.size);
if (lostInputs.length) {
    console.log('            ⚠ %d input(s) had no original to re-stage and were left out of their example:',
        lostInputs.length);
    for (const l of lostInputs) console.log('              - ' + l);
}
if (skipped.length) {
    console.log('skipped     %d (%d failed runs, %d nothing to show)', skipped.length, failedRow, noOutput);
    for (const s of skipped) console.log('              - ' + s);
}
if (DRY) console.log('\n(dry run - nothing written)');
