#!/usr/bin/env node
/**
 * Rebuild a library-sweep report from what the sweep left on disk.
 *
 * WHY THIS EXISTS. A sweep writes its report to server/data as it goes, and the
 * in-memory status is lost whenever ComfyQ restarts — which, under nodemon, is
 * whenever anyone edits a server file. If both are gone the run itself is still
 * recoverable, because it left three independent traces:
 *
 *   <id>.runtime.json          rewritten by every bundle that RAN, with its
 *                              timings, VRAM and a calibratedAt stamp
 *   output/bench_<id>_*        the files it produced, named after the bundle
 *   comfyq_model_access.jsonl  every weight ComfyUI opened, with timestamps
 *
 * Weights are attributed to bundles by TIME WINDOW: each runtime.json records
 * when the run ended and how long it took, so a log entry inside that window
 * belongs to that bundle.
 *
 * ⚠ What cannot be recovered: a bundle that FAILED wrote no runtime.json, so it
 * is invisible here — it appears as "did not run" rather than "failed", and its
 * error text is gone. The report says so rather than implying the library is
 * clean. Run a fresh sweep when the rig is free if you need the failures.
 *
 * Usage:  node tools/maintenance/recover_sweep.cjs [--since "2026-10-07T12:00"] [--write]
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO = path.resolve(__dirname, '..', '..');
const { renderSweepReport } = require(path.join(REPO, 'server', 'benchmark', 'sweepReport.js'));

const args = process.argv.slice(2);
const sinceArg = (() => { const i = args.indexOf('--since'); return i >= 0 ? args[i + 1] : null; })();
const WRITE = args.includes('--write');

const cfg = JSON.parse(fs.readFileSync(path.join(REPO, 'config.json'), 'utf8'));
const comfyRoot = cfg.comfy_ui?.root_path;
const outDir = cfg.comfy_ui?.output_dir || path.join(comfyRoot, 'output');
const wfDir = path.join(REPO, 'workflows');
const since = sinceArg ? Date.parse(sinceArg) : Date.now() - 6 * 3600 * 1000;

// ---- which bundles ran, from their freshly rewritten runtime.json ----------
const ran = [];
const didNotRun = [];
for (const d of fs.readdirSync(wfDir, { withFileTypes: true })) {
    if (!d.isDirectory() || d.name.startsWith('_')) continue;
    const rtPath = path.join(wfDir, d.name, `${d.name}.runtime.json`);
    const metaPath = path.join(wfDir, d.name, `${d.name}.meta.json`);
    let meta = {};
    try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')); } catch { /* no meta */ }
    let rt = null;
    try { rt = JSON.parse(fs.readFileSync(rtPath, 'utf8')); } catch { /* never calibrated */ }
    const at = rt?.calibratedAt ? Date.parse(rt.calibratedAt) : 0;
    if (rt && at >= since) ran.push({ id: d.name, meta, rt, endedMs: at });
    else didNotRun.push(d.name);
}
ran.sort((a, b) => a.endedMs - b.endedMs);

// ---- the weights ComfyUI opened, bucketed into those windows ---------------
const logPath = path.join(comfyRoot, 'comfyq_model_access.jsonl');
const events = [];
try {
    for (const line of fs.readFileSync(logPath, 'utf8').split(/\r?\n/)) {
        if (!line.trim()) continue;
        try {
            const r = JSON.parse(line);
            if (r?.path && r.at) events.push({ ms: r.at * 1000, name: String(r.path).split(/[\\/]/).pop() });
        } catch { /* a torn line costs one entry */ }
    }
} catch { /* no recorder log */ }

// ---- the files each bundle produced ---------------------------------------
function outputsFor(id) {
    // Anchored on the timestamp that follows the id: several bundle ids are
    // prefixes of others, so a bare startsWith credits one bundle with another's
    // output — which is how the plain Bernini editing bundle appeared to hold the
    // reference bundle's picture.
    const stamped = new RegExp(`^bench_${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_\\d+`);
    const found = [];
    const walk = (dir, depth) => {
        if (depth > 2) return;
        let items = [];
        try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const it of items) {
            const p = path.join(dir, it.name);
            if (it.isDirectory()) { walk(p, depth + 1); continue; }
            if (!stamped.test(it.name)) continue;
            let st; try { st = fs.statSync(p); } catch { continue; }
            if (st.mtimeMs < since) continue;
            found.push(p);
        }
    };
    walk(outDir, 0);
    return found;
}

// ---- measure them, through ComfyUI's own python ---------------------------
function measure(files) {
    if (!files.length) return [];
    const py = cfg.comfy_ui?.python_executable
        || path.join(path.dirname(comfyRoot), 'python_embeded', 'python.exe');
    const script = path.join(__dirname, 'output_stats.py');
    const boot = 'import runpy, sys, os; p = sys.argv[1]; '
        + 'sys.path.insert(0, os.path.dirname(os.path.abspath(p))); '
        + "sys.argv = sys.argv[1:]; runpy.run_path(p, run_name='__main__')";
    const r = spawnSync(py, ['-c', boot, script], {
        input: JSON.stringify(files), encoding: 'utf8',
        env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
        maxBuffer: 1 << 26,
    });
    try { return JSON.parse(r.stdout); } catch { return []; }
}

const results = [];
for (const b of ran) {
    const files = outputsFor(b.id);
    const stats = measure(files);
    const byPath = new Map(stats.map(s => [s.path, s]));
    const outputs = files.map(p => {
        const s = byPath.get(p) || {};
        // Keep the absolute path: the card and the report both show it so a human
        // can go and open the file.
        return { ...s, file: path.relative(outDir, p).split(path.sep).join('/'), path: p };
    });
    const durMs = b.rt.durationMs || (b.rt.coldDurationSec || 0) * 1000;
    const windowStart = b.endedMs - durMs - 5000;
    const observed = [...new Set(events
        .filter(e => e.ms >= windowStart && e.ms <= b.endedMs + 5000)
        .map(e => e.name))].sort();
    results.push({
        id: b.id,
        name: b.meta.name || b.id,
        category: b.meta.category || null,
        experimental: !!b.meta.experimental,
        ok: true,                       // it wrote a runtime.json, so it completed
        wallSec: Math.round(durMs / 1000),
        warmSec: b.rt.estimatedDurationSec ?? null,
        coldSec: b.rt.coldDurationSec ?? null,
        vramPeakGb: b.rt.vramPeakGb ?? null,
        steps: b.rt.steps ?? null,
        gpu: b.rt.gpu ?? null,
        finishedAt: b.rt.calibratedAt,
        outputs,
        flagged: outputs.filter(o => (o.flags || []).length || o.error)
            .map(o => ({ file: o.file, flags: o.flags || [], error: o.error || null })),
        observedModels: observed,
        perf: {
            argv: [],
            bundleDisables: b.meta.requirements?.disabledPerfFlags || [],
            notMasked: [],
        },
        recovered: true,
    });
}

const report = {
    startedAt: ran.length ? new Date(ran[0].endedMs - (ran[0].rt.durationMs || 0)).toISOString() : null,
    finishedAt: ran.length ? new Date(ran[ran.length - 1].endedMs).toISOString() : null,
    state: 'recovered (partial)',
    machine: {
        at: new Date().toISOString(),
        host: require('os').hostname(),
        gpu: ran.find(b => b.rt.gpu)?.rt.gpu || cfg.instance?.gpu || null,
        vramTotalGb: cfg.instance?.vramGb || null,
        comfyRoot, assetsDir: cfg.assets?.dir || null,
        scanDirs: cfg.maintenance?.workflowScanDirs || [],
    },
    summary: {
        ran: results.length,
        succeeded: results.length,
        failed: 0,
        withFlaggedOutput: results.filter(r => r.flagged.length).length,
        // Same rule as the live sweep: a text-output workflow saves no file and is
        // not counted as having produced nothing.
        noOutput: results.filter(r => !r.outputs.length && r.category !== 'description').length,
        distinctModelsOpened: new Set(results.flatMap(r => r.observedModels)).size,
        recorderAvailable: events.length > 0,
    },
    results,
    recoveryNote: `Reconstructed from ${results.length} runtime.json file(s) rewritten after `
        + `${new Date(since).toISOString()}, the bench_* outputs on disk, and the model-access log. `
        + `⚠ A bundle that FAILED wrote no runtime.json, so it cannot appear here — `
        + `${didNotRun.length} bundle(s) are simply absent and are either untouched by the sweep or failed: `
        + didNotRun.join(', '),
};

const text = renderSweepReport(report)
    + '\nRECOVERY NOTE\n  ' + report.recoveryNote.replace(/(.{76}) /g, '$1\n  ') + '\n';

if (WRITE) {
    const dataDir = path.join(REPO, 'server', 'data');
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'library-sweep-latest.json'), JSON.stringify(report, null, 1));
    console.error(`wrote server/data/library-sweep-latest.json (${results.length} bundles)`);
}
process.stdout.write(text);
