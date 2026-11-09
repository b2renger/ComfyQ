#!/usr/bin/env node
/**
 * Run a library test suite from the command line.
 *
 *   node tools/test-suite/run-suite.cjs [suite] [--check] [--dry] [--only a,b] [--from <id>]
 *
 *   suite     a name in tools/test-suite (default "library"), or a path
 *   --check   validate the suite against the library, list every asset it names
 *             that is not in the assets folder, and stop
 *   --dry     validate, then print every run and where each input will come from
 *   --only    run just these bundles and their variants, in the suite's order
 *   --from    start at this bundle and run the rest of the suite
 *   --data-dir write the report somewhere else (an experiment that must not
 *             replace the published report, and so the examples). Inputs from
 *             earlier results then come from THAT folder's last report, so in
 *             an empty folder only from bundles in this run. It still
 *             calibrates: the runtime.json (timings and VRAM peak) of every
 *             bundle it runs is rewritten, except runs marked keepRuntime. To
 *             leave no trace, discard those changes afterwards (git checkout
 *             the bundles' .runtime.json files; see the README) or mark the
 *             suite's runs keepRuntime
 *
 * It runs the SAME sweep the admin panel's "Run the whole library" card runs — one bundle
 * at a time through AdminCalibrator, so each workflow's `disabledPerfFlags` are
 * masked — and publishes to the same server/data/library-sweep-latest.json, so
 * the card shows the result and tools/maintenance/seed_examples.cjs can turn it
 * into examples. From the command line because a suite takes hours and the
 * panel's route sits behind the admin password; it refuses unless the machine
 * is in admin mode (not serving), exactly as the panel does.
 *
 * The ComfyUI already running is used as it is. If a workflow needs a flag off
 * that it runs with, it is replaced by one this process starts. That one is
 * left running at the end: ComfyUI outlives the process that started it (see
 * server/workers/comfyLauncher.js), and ComfyQ adopts it on its next start
 * instead of cold-booting another.
 */
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..');
const configManager = require(path.join(REPO, 'server', 'config', 'configManager'));
const { WorkflowRegistry } = require(path.join(REPO, 'server', 'workflows', 'workflowRegistry'));
const { AdminCalibrator } = require(path.join(REPO, 'server', 'benchmark', 'adminCalibrator'));
const { LibrarySweep } = require(path.join(REPO, 'server', 'benchmark', 'librarySweep'));
const { loadSuite, validateSuite, parseMediaSpec, MEDIA_TYPES } = require(path.join(REPO, 'server', 'benchmark', 'suitePlan'));
const { suiteAssets, missingAssetLines } = require(path.join(__dirname, 'suiteAssets.cjs'));

const args = process.argv.slice(2);
// Running is the default, so a flag this script does not know (a typo, --help)
// must stop it rather than start a suite of several hours.
const KNOWN_FLAGS = ['--check', '--dry', '--only', '--from', '--data-dir'];
const unknown = args.filter(a => a.startsWith('-') && !KNOWN_FLAGS.includes(a));
if (unknown.length) {
    console.error(`Unknown option ${unknown.join(', ')}. Nothing was run.`);
    console.error('Usage: node tools/test-suite/run-suite.cjs [suite] [--check] [--dry] [--only a,b] [--from <id>] [--data-dir <dir>]');
    process.exit(1);
}
for (const name of ['--only', '--from', '--data-dir']) {
    const i = args.indexOf(name);
    if (i >= 0 && (!args[i + 1] || args[i + 1].startsWith('-'))) {
        console.error(`${name} needs a value. Nothing was run.`);
        process.exit(1);
    }
}
const flag = (name) => args.includes(name);
const value = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const positional = args.filter((a, i) => !a.startsWith('--') && !['--only', '--from', '--data-dir'].includes(args[i - 1]));
const suiteArg = positional[0] || 'library';

const { config } = configManager.load();
const registry = new WorkflowRegistry(path.resolve(REPO, config.workflows.dir));
registry.discover();
const suite = loadSuite(suiteArg);
const check = validateSuite(suite, registry);

console.log(`suite      ${suite.name} — ${suite.runs.length} runs (${path.relative(REPO, suite.file)})`);
for (const w of check.warnings) console.log(`  warning  ${w}`);
for (const e of check.errors) console.log(`  ERROR    ${e}`);
if (check.errors.length) { console.log(`\n${check.errors.length} error(s) — nothing was run.`); process.exit(1); }

// Assets the suite names that are not in the assets folder: the sweep would skip
// those runs, so say it now rather than hours into the run.
const assetsDir = config.assets?.dir || null;
const assetList = suiteAssets(suite, id => registry.get(id)?.effective?.exposedParameters, assetsDir);
for (const line of missingAssetLines(assetList, assetsDir)) console.log(`  ${line}`);
const assetsMissing = assetList.filter(a => !a.found && a.required).length;
if (flag('--check')) {
    if (assetsMissing) {
        console.log(`\n${assetsMissing} asset(s) missing from ${assetsDir || 'the assets folder (none is set)'} — the runs that need them would be skipped.`);
        process.exit(1);
    }
    console.log(`suite is valid (${assetList.length} asset uses, all found where needed).`);
    process.exit(0);
}

let ids = null;
if (value('--only')) ids = value('--only').split(',').map(s => s.trim()).filter(Boolean);
if (value('--from')) {
    const i = suite.runs.findIndex(r => r.workflow === value('--from'));
    if (i < 0) { console.error(`--from: "${value('--from')}" is not in the suite`); process.exit(1); }
    ids = suite.runs.slice(i).map(r => r.workflow);
}

if (flag('--dry')) {
    let stage = null;
    for (const r of suite.runs) {
        if (ids && !ids.includes(r.workflow)) continue;
        if (r.stage !== stage) { stage = r.stage; console.log(`\n== ${stage}`); }
        const entry = registry.get(r.workflow);
        const exposed = new Map((entry?.effective?.exposedParameters || []).map(p => [p.key, p]));
        const media = Object.entries(r.params).filter(([k]) => MEDIA_TYPES.includes(exposed.get(k)?.type));
        const est = entry?.runtime?.coldDurationSec || entry?.meta?.estimatedDurationSec || '?';
        console.log(`  ${r.workflow}  (~${est}s)`);
        for (const [k, spec] of media) {
            const m = parseMediaSpec(spec);
            const desc = m.empty ? 'left empty' : m.asset ? m.asset
                : `${m.from.join(' | ')}${m.pick ? ` #${m.pick + 1}` : ''}${m.derive.length ? ` → ${m.derive.map(o => o.op).join(' + ')}` : ''}${m.fallback ? ` (else ${m.fallback})` : ''}`;
            console.log(`      ${k} ← ${desc}`);
        }
    }
    process.exit(0);
}

if (config.mode !== 'admin') {
    console.error('This machine is serving students. Stop serving (admin mode) before running a suite.');
    process.exit(1);
}

const cal = new AdminCalibrator({ configManager, registry });
const dataDir = value('--data-dir') ? path.resolve(value('--data-dir')) : undefined;
const sweep = new LibrarySweep({
    dataDir,
    registry,
    calibrator: () => cal,
    config: () => configManager.load().config,
    mode: () => configManager.load().config.mode,
});

let stopping = false;
process.on('SIGINT', () => {
    if (stopping) process.exit(130);
    stopping = true;
    console.log('\n[Suite] stopping after the workflow now running (Ctrl-C again to quit at once)');
    sweep.stop();
});

(async () => {
    const started = await sweep.start({ suite, ids: ids || undefined });
    if (!started.ok) { console.error(`[Suite] ${started.error}`); process.exit(1); }
    console.log(`[Suite] running ${started.total} workflow(s)`);
    let last = 0;
    for (;;) {
        await new Promise(r => setTimeout(r, 5000));
        const st = sweep.status();
        if (!st) break;
        if (st.done !== last) {
            last = st.done;
            const eta = st.etaSec ? `, about ${Math.round(st.etaSec / 60)} min left` : '';
            console.log(`[Suite] ${st.done}/${st.total} done${eta}`);
        }
        if (st.state !== 'running' && st.state !== 'stopping') break;
    }
    const st = sweep.status();
    const s = st?.summary || {};
    const skipped = (st?.results || []).filter(r => r.skipped).map(r => r.id);
    console.log(`[Suite] ${st?.state}: ${s.succeeded}/${s.ran} ran clean, ${s.failed} failed${skipped.length ? ` (${skipped.length} skipped for a missing input)` : ''}, `
        + `${s.withFlaggedOutput} with suspect output, ${s.noOutput} produced nothing`);
    for (const r of (st?.results || []).filter(x => !x.ok)) console.log(`  FAIL ${r.id} — ${r.error}`);
    console.log(`[Suite] report: ${path.join(dataDir || path.join(REPO, 'server', 'data'), 'library-sweep-latest.json')}`);
    // Leave ComfyUI up: ComfyQ adopts it on its next start (no cold boot).
    if (!cal._external && cal.worker) console.log('[Suite] the ComfyUI this run started is left running — ComfyQ reuses it');
    try { await cal.shutdown(); } catch { /* closing a websocket */ }
    process.exit(s.failed ? 2 : 0);
})().catch(e => { console.error(`[Suite] ${e.stack || e.message}`); process.exit(1); });
