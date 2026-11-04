const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { readAccessLog, invalidateAccessLog, namesOpenedBetween } = require('../workflows/modelAccessLog');
const { flagsFromArgv } = require('../workers/perfFlags');
const { classify } = require('../media/mediaTypes');
const { parseMediaSpec, kindForParam, MEDIA_TYPES, VIDEO_DERIVE_OPS } = require('./suitePlan');

// Run every workflow in the library once, and write down what happened.
//
// WHY. Two questions the rest of ComfyQ cannot answer on its own:
//
// 1. DOES EACH BUNDLE STILL WORK? 61 bundles, many promoted experimentally, and
//    the only honest test is to run one and look at what came out. This rig has
//    twice shipped a bundle that reported success and saved BLACK images (Qwen
//    Image-Edit under Sage, SeedVR2 7B under fp16 accumulation) and once passed a
//    broken 4-step default because the check was a sharpness statistic that
//    cannot tell detail from structured noise. So every output of every run is
//    measured — size, luminance, spread, frame count — and anything black, flat,
//    empty or single-framed is listed by name for a human to open.
//
// 2. WHICH MODELS DOES THE LIBRARY ACTUALLY OPEN? Every protection class in the
//    prune tool is an inference: this graph names that file, this pack's source
//    mentions that name. Each inference has been wrong at least once, and one of
//    them cost a deleted VAE. The recorder in ComfyQ's own node logs every weight
//    ComfyUI resolves or loads, so a sweep turns "nothing references this" into
//    the far stronger "we ran all 61 workflows and ComfyUI never opened it."
//    ⚠ Still only ever a reason to KEEP: a setting nobody exercised (Fast mode
//    off, the second LoRA in a dropdown) leaves no trace either.
//
// HOW IT RUNS. Through AdminCalibrator, one bundle at a time, because that is
// what masks each workflow's `disabledPerfFlags` and restarts ComfyUI when they
// change — running the Qwen edit bundles with Sage on would produce exactly the
// black output this sweep exists to detect, and would blame the bundle for it.
// It therefore requires admin mode, and refuses while the rig is serving.
//
// Measured cost on this rig: about 2 hours for 61 bundles.

const DATA_DIR = path.resolve(__dirname, '..', 'data');
const STATS_SCRIPT = path.resolve(__dirname, '..', '..', 'tools', 'maintenance', 'output_stats.py');
const DERIVE_SCRIPT = path.resolve(__dirname, '..', '..', 'tools', 'test-suite', 'derive_input.py');
const STATS_TIMEOUT_MS = 120000;

class LibrarySweep {
    /**
     * @param {object} opts
     * @param {object} opts.registry
     * @param {() => object|null} opts.calibrator  AdminCalibrator, read lazily
     * @param {() => object} opts.config
     * @param {() => string} opts.mode             'admin' | 'student'
     */
    /**
     * @param {string} [opts.dataDir]  where reports are written. Injectable ONLY so a
     *   test can point it at a temp directory — it writes a `…-latest.json` that the
     *   report route serves, and a test that wrote into server/data would publish a
     *   fixture as if it were a real sweep of this machine. It did, once.
     */
    constructor({ registry, calibrator, config, mode, dataDir }) {
        this.registry = registry;
        this._calibrator = calibrator;
        this._config = config;
        this._mode = mode;
        this._dataDir = dataDir || DATA_DIR;
        this._run = null;
        this._cancelled = false;
    }

    status() {
        if (!this._run) return null;
        const r = this._run;
        return {
            state: r.state,
            startedAt: r.startedAt,
            finishedAt: r.finishedAt,
            total: r.ids.length,
            done: r.results.length,
            current: r.current,
            etaSec: this._eta(),
            // ★ Without this the live report has NO machine block at all. The route
            // prefers the running sweep over the file on disk and copied
            // `machine: run.machine` from it — a line that reads as if it handled the
            // field while always copying undefined, so a complete 61-bundle report
            // went out saying nothing about the host, the GPU, the ComfyUI version or
            // the commit, while both files on disk held all of it.
            machine: r.machine,
            suite: r.suite ? { name: r.suite.name, file: r.suite.file } : null,
            reportPath: path.relative(path.resolve(__dirname, '..', '..'), r.reportPath)
                .split(path.sep).join('/'),
            results: r.results,
            summary: this._summary(),
        };
    }

    _eta() {
        const r = this._run;
        if (!r || r.state !== 'running' || !r.results.length) return null;
        const spent = (Date.now() - Date.parse(r.startedAt)) / 1000;
        const per = spent / r.results.length;
        return Math.round(per * (r.ids.length - r.results.length));
    }

    _summary() {
        const r = this._run;
        if (!r) return null;
        return LibrarySweep.summarize(r.results, r.recorderAvailable);
    }

    /** Counts over any set of rows — the live run's, or a merged report's. */
    static summarize(results, recorderAvailable) {
        const ok = results.filter(x => x.ok);
        const flagged = results.filter(x => (x.flagged || []).length);
        const observed = new Set();
        for (const x of results) for (const n of (x.observedModels || [])) observed.add(n);
        return {
            ran: results.length,
            succeeded: ok.length,
            failed: results.length - ok.length,
            withFlaggedOutput: flagged.length,
            // ★★ A text-output workflow (the Gemma captioners) saves no file, so it was
            // exempted BY CATEGORY so as not to cry wolf on correct behaviour. That
            // exemption then hid the real thing: a stamp guard stopped collecting their
            // captions, both reported zero outputs, and this counter said nothing because
            // it had been taught never to speak about them. **The exemption that silences a
            // false alarm silences the true one too.** The honest form is to count a
            // caption as an output — which it now is, since text lands in `outputs` — so a
            // captioner that produced nothing is reported like anything else.
            noOutput: results.filter(x => x.ok && !(x.outputs || []).length).length,
            distinctModelsOpened: observed.size,
            recorderAvailable,
        };
    }

    /**
     * Fold this run's rows into whatever the last report held.
     *
     * ★ Because a SUBSET run otherwise destroys the full report. Re-running one
     * bundle to check a fix — or pressing "Run the remaining N" after a stop — wrote
     * a `…-latest.json` containing only those rows, so a two-hour 61-bundle record
     * became a one-line file and the report route then served that as the machine's
     * verdict on its library. The whole point of the report is that it is the record.
     *
     * A full run replaces every row, so merging is a no-op for it. Each row already
     * carries its own `finishedAt`, so a merged report stays honest about when each
     * line was measured.
     */
    _merged() {
        const prev = this.lastReport();
        const fresh = this._run.results;
        if (!prev || !Array.isArray(prev.results) || !prev.results.length) return fresh;
        const now = new Set(fresh.map(r => r.id));
        // A workflow deleted since the last report has no row worth carrying.
        let exists = null;
        try {
            exists = new Set(this.registry.list({ includeUnavailable: true, includeHidden: true }).map(e => e.id));
        } catch { /* a registry that cannot list keeps everything */ }
        const kept = prev.results.filter(r => !now.has(r.id) && (!exists || exists.has(r.id)));
        return [...kept, ...fresh].sort((a, b) => String(a.id).localeCompare(String(b.id)));
    }

    /**
     * A report as it stands for the library that EXISTS now.
     *
     * ★ Rows for workflows that have since been deleted are dropped and the
     * summary recomputed, so a library slimmed for a workshop does not go on
     * reading "64 of 64 ran" — which is how the card looked after workflows were
     * deleted from the library. Pure: returns a new object, never writes.
     */
    static forLibrary(report, liveIds) {
        if (!report || !Array.isArray(report.results)) return report;
        const live = new Set(liveIds);
        const kept = report.results.filter(r => live.has(r.id));
        if (kept.length === report.results.length) return report;
        const removed = report.results.filter(r => !live.has(r.id)).map(r => r.id);
        return {
            ...report,
            results: kept,
            summary: LibrarySweep.summarize(kept, report.recorderAvailable ?? report.summary?.recorderAvailable),
            removedSince: removed,
        };
    }

    /**
     * Drop the given bundles' rows from the published report on disk — called
     * when a workflow is deleted, so the record and the library agree. The
     * summary is recomputed by summarize(), never counted here.
     */
    forgetBundles(ids) {
        const gone = new Set(ids);
        const p = path.join(this._dataDir, 'library-sweep-latest.json');
        const prev = this.lastReport();
        let dropped = 0;
        if (prev && Array.isArray(prev.results)) {
            const kept = prev.results.filter(r => !gone.has(r.id));
            dropped = prev.results.length - kept.length;
            if (dropped) {
                prev.results = kept;
                prev.summary = LibrarySweep.summarize(kept, prev.recorderAvailable ?? prev.summary?.recorderAvailable);
                fs.writeFileSync(p, JSON.stringify(prev, null, 1));
            }
        }
        // A finished run still held in memory would otherwise be served instead.
        if (this._run && this._run.state !== 'running' && Array.isArray(this._run.results)) {
            this._run.results = this._run.results.filter(r => !gone.has(r.id));
        }
        return { dropped };
    }

    /** The report of the last sweep, read off disk — survives a restart. */
    lastReport() {
        try {
            const p = path.join(this._dataDir, 'library-sweep-latest.json');
            return JSON.parse(fs.readFileSync(p, 'utf8'));
        } catch { return null; }
    }

    /**
     * @param {object} [opts]
     * @param {string[]} [opts.ids]  a subset, default every available bundle
     * @param {object}   [opts.suite]  a loaded test suite (suitePlan.loadSuite): runs
     *   its bundles in ITS order with its inputs; `ids` then narrows it
     */
    async start(opts = {}) {
        if (this._run && this._run.state === 'running') {
            return { ok: false, error: 'a sweep is already running' };
        }
        // ★ Admin mode only, and this is not timidity. The sweep holds the GPU for
        // about two hours and restarts ComfyUI whenever the next bundle needs a
        // different perf flag — both of which would break a class mid-booking.
        if (this._mode() !== 'admin') {
            return {
                ok: false,
                error: 'This machine is serving students. A sweep takes about two hours of the GPU '
                    + 'and restarts ComfyUI between workflows that need different performance flags, '
                    + 'so run it from admin mode — Stop serving first.',
            };
        }
        const cal = this._calibrator();
        if (!cal) return { ok: false, error: 'the ComfyUI backend is not available' };

        const entries = this.registry.list({ includeUnavailable: false, includeHidden: true })
            .filter(e => e.apiWorkflow);
        const narrow = Array.isArray(opts.ids) && opts.ids.length ? opts.ids : null;
        let wanted;
        if (opts.suite) {
            // The suite's order IS the point: a result has to exist before the
            // workflow that is fed it runs.
            const byId = new Map(entries.map(e => [e.id, e]));
            wanted = opts.suite.runs
                .filter(r => !narrow || narrow.includes(r.workflow))
                .filter(r => byId.has(r.workflow))
                .map(r => ({ entry: byId.get(r.workflow), run: r }));
        } else {
            wanted = (narrow ? entries.filter(e => narrow.includes(e.id)) : entries)
                .map(entry => ({ entry, run: null }));
        }
        if (!wanted.length) return { ok: false, error: 'no workflows to run' };

        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        fs.mkdirSync(this._dataDir, { recursive: true });
        this._cancelled = false;
        this._run = {
            state: 'running',
            startedAt: new Date().toISOString(),
            finishedAt: null,
            ids: wanted.map(w => w.entry.id),
            suite: opts.suite ? { name: opts.suite.name, file: opts.suite.file, description: opts.suite.description } : null,
            results: [],
            current: null,
            // Written per bundle, not once at the end: a two-hour run that is
            // interrupted must still leave behind what it learned. Same lesson as
            // the prune log.
            reportPath: path.join(this._dataDir, `library-sweep-${stamp}.jsonl`),
            stamp,
            recorderAvailable: readAccessLog(this._config()?.comfy_ui?.root_path || '').available,
            // The last published rows, read once: a suite run narrowed with `ids`
            // takes the inputs it does not produce itself from here.
            prevRows: (this.lastReport()?.results) || [],
        };
        // Captured once, up front: a report is read later, often on another
        // machine, and "it failed" means nothing without knowing what it ran on.
        this._run.machine = await this._machine();
        fs.writeFileSync(this._run.reportPath,
            JSON.stringify({
                type: 'start', at: this._run.startedAt,
                bundles: this._run.ids.length, machine: this._run.machine,
                suite: this._run.suite,
            }) + '\n');

        this._execute(wanted, cal).catch(e => {
            if (this._run) { this._run.state = 'failed'; this._run.error = e.message; }
        });
        return { ok: true, total: wanted.length };
    }

    /**
     * Forget every sweep result — in memory and on disk.
     *
     * ★ Wanted because a partial or RECOVERED report is worse than none: it reads
     * like a verdict on the library while covering half of it, and a recovered one
     * cannot show a failure at all (a bundle that failed wrote no runtime.json).
     * Clearing is the honest reset before a fresh run.
     *
     * It never touches the `bench_*` output files — those are evidence, and
     * ComfyUI's output folder is not ours to tidy.
     */
    clear() {
        if (this._run && this._run.state === 'running') {
            return { ok: false, error: 'a sweep is running — stop it first' };
        }
        let removed = 0;
        try {
            for (const name of fs.readdirSync(this._dataDir)) {
                if (!/^library-sweep-/.test(name)) continue;
                try { fs.unlinkSync(path.join(this._dataDir, name)); removed++; } catch { /* in use */ }
            }
        } catch { /* no data dir yet */ }
        this._run = null;
        this._cancelled = false;
        return { ok: true, removed };
    }

    stop() {
        if (!this._run || this._run.state !== 'running') return { ok: false, error: 'nothing is running' };
        this._cancelled = true;
        this._run.state = 'stopping';
        return { ok: true, note: 'will stop after the workflow now running finishes' };
    }

    async _execute(entries, cal) {
        const root = this._config()?.comfy_ui?.root_path || '';
        for (const item of entries) {
            // { entry, run } from start(); a bare registry entry from an older caller
            const { entry, run } = item && item.entry ? item : { entry: item, run: null };
            if (this._cancelled) break;
            this._run.current = { id: entry.id, name: entry.summary?.name || entry.id, startedAt: new Date().toISOString() };

            // The window this bundle's loads will fall inside. Attribution is by
            // time, not by a before/after name diff — see the note where the models
            // are collected.
            const startedMs = Date.now();

            // ★ Preserve a hand-measured runtime. PiD's progress bar counts tiles,
            // so its automatic split under-reports the warm time by 10 s — its
            // runtime.json says source:'manual' for that reason, and a sweep must
            // not quietly overwrite a figure someone measured by hand.
            // A suite run that changes a setting which drives the cost (a shorter
            // clip, a smaller size) asks for its runtime to be kept too: its
            // timing would describe a job nobody books by default.
            const prevRuntime = entry.runtime && (entry.runtime.source === 'manual' || run?.keepRuntime) ? entry.runtime : null;

            const rec = {
                id: entry.id,
                name: entry.summary?.name || entry.id,
                category: entry.summary?.category || null,
                experimental: !!entry.summary?.experimental,
                startedAt: this._run.current.startedAt,
                ok: false,
                error: null,
                outputs: [],
                flagged: [],
                observedModels: [],
            };

            // ★ A suite run's inputs are resolved NOW, from what this sweep has
            // already produced — which is why the suite's order matters. An input
            // that cannot be found skips the run and says why, rather than falling
            // back to a random asset and producing an example that pretends to
            // follow from a result it never saw.
            let calOpts = {};
            if (run) {
                const res = await this._resolveSuiteParams(entry, run);
                rec.suite = { name: this._run.suite?.name || null, stage: run.stage, note: run.note, inputs: res.inputs };
                if (res.missing.length) {
                    rec.error = `skipped — ${res.missing.join('; ')}`;
                    rec.skipped = true;
                    rec.finishedAt = new Date().toISOString();
                    rec.wallSec = 0;
                    this._run.results.push(rec);
                    this._run.current = null;
                    try { fs.appendFileSync(this._run.reportPath, JSON.stringify({ type: 'bundle', ...rec }) + '\n'); } catch { /* keep going */ }
                    console.log(`[Sweep] SKIP ${entry.id} — ${rec.error}`);
                    continue;
                }
                calOpts = { params: res.params, mediaNotes: res.notes };
            }

            try {
                const runtime = await cal.calibrate(entry.id, calOpts);
                rec.ok = true;
                // ★ The ingredients, so a human can read what produced the result
                // rather than taking the measurement on trust.
                try {
                    const d = cal.lastRunDetails?.();
                    rec.ingredients = this._ingredients(entry, d);
                    rec.seedsRandomized = d?.seedsRandomized ?? null;
                } catch { /* the row is still useful without them */ }
                rec.warmSec = runtime?.estimatedDurationSec ?? null;
                rec.coldSec = runtime?.coldDurationSec ?? null;
                rec.modelLoadSec = runtime?.modelLoadSec ?? null;
                rec.vramPeakGb = runtime?.vramPeakGb ?? null;
                rec.steps = runtime?.steps ?? null;
                rec.gpu = runtime?.gpu ?? null;
                if (prevRuntime) {
                    this.registry.writeRuntime(entry.id, prevRuntime);
                    rec.runtimeKept = 'manual timings restored';
                }
            } catch (e) {
                rec.error = e.message;
                rec.traceback = e.traceback || null;
                rec.exceptionType = e.exceptionType || null;
                rec.failedNode = e.failedNode || null;
            }

            // ★ Ingredients for a FAILED run too. They used to be captured only in
            // the success branch, so the two bundles that failed on the first real
            // sweep carried no prompt, no params and no input paths — which is
            // backwards, because a failure is exactly when you need to know what was
            // fed in. The calibration service records them during
            // _buildCalibrationParams, which runs BEFORE the submit, so they exist
            // even when the run throws.
            if (!rec.ingredients) {
                try {
                    const d = cal.lastRunDetails?.();
                    if (d && d.workflowId === entry.id) rec.ingredients = this._ingredients(entry, d);
                } catch { /* the row is still useful without them */ }
            }

            // Outputs, found by the prefix the benchmark stamps on every save
            // node — no prompt id needed, and it reaches the subfolders that
            // audio and 3D saves use.
            try {
                rec.outputs = await this._describeOutputs(entry.id, startedMs);
                // ★ A workflow whose result is TEXT saves no file — the captioners
                // answer through a PreviewAny node — so the answer has to come from
                // ComfyUI's history or it is simply lost. Appended as an output of
                // kind 'text' so the card and the report show it like any other.
                const texts = await this._collectTextOutputs(entry.id, rec.outputs.length > 0, startedMs);
                if (texts.length) rec.outputs = rec.outputs.concat(texts);
                rec.flagged = rec.outputs
                    .filter(o => (o.flags || []).length || o.error)
                    .map(o => ({ file: o.file, flags: o.flags || [], error: o.error || null }));
            } catch (e) {
                rec.outputError = e.message;
            }

            // Which weights ComfyUI actually opened while this bundle ran.
            //
            // ★ By TIME WINDOW, not by diffing the log's name set. The log is
            // append-only and `byName` keeps each name's earliest sighting, so a set
            // difference reports only weights never loaded on this machine before —
            // which on a second sweep is almost nothing. The first re-run showed 0
            // models for a bundle the previous sweep credited with 5, which is how
            // this surfaced. A few seconds of slack each side covers the gap between
            // the run finishing and the log being flushed.
            try {
                invalidateAccessLog();
                rec.observedModels = namesOpenedBetween(root, startedMs - 2000, Date.now() + 2000);
                rec.recorderAvailable = readAccessLog(root).available;
            } catch { /* the sweep is still useful without it */ }

            // ★ The flags ComfyUI was ACTUALLY running with for this bundle, read
            // off its own argv, next to the flags the bundle says it cannot use.
            // This is the most valuable line in the whole report: a black output
            // from a bundle that declares `use_sage_attention` while sage is in
            // the argv has a known cause and is not a broken graph. Diagnosing
            // that by hand is what cost two silent failures already.
            try {
                const want = (entry.meta?.requirements?.disabledPerfFlags || []).slice();
                const sys = await this._systemInfo();
                const argv = sys?.argv || [];
                rec.perf = {
                    argv: argv.filter(a => a.startsWith('--')),
                    bundleDisables: want,
                    // a flag the bundle disowns that was nevertheless passed
                    // ★ flagsFromArgv returns an OBJECT ({use_sage_attention: bool,
                    // fp16_accumulation: bool}), not an array. `.includes` raised a
                    // TypeError, which abandoned the whole rec.perf assignment — and
                    // only for a bundle that DECLARES a flag, because filter never
                    // invokes its callback on an empty array. So the report's most
                    // useful diagnostic was absent for exactly the five bundles it
                    // exists for, and present for the other 56.
                    notMasked: want.filter(k => flagsFromArgv(argv)[k] === true),
                };
                if (rec.perf.notMasked.length) {
                    rec.cause = `ComfyUI was running with ${rec.perf.notMasked.join(', ')}, which this `
                        + `bundle declares it cannot use — any black or empty output here is that, not the graph.`;
                }
            } catch { /* the report is still useful without it */ }

            rec.finishedAt = new Date().toISOString();
            rec.wallSec = Math.round((Date.now() - startedMs) / 1000);
            this._run.results.push(rec);
            this._run.current = null;
            try { fs.appendFileSync(this._run.reportPath, JSON.stringify({ type: 'bundle', ...rec }) + '\n'); } catch { /* keep going */ }
            console.log(`[Sweep] ${rec.ok ? 'ok ' : 'FAIL'} ${entry.id} — ${rec.wallSec}s`
                + `${rec.outputs.length ? `, ${rec.outputs.length} output(s)` : ', NO OUTPUT'}`
                + `${rec.flagged.length ? `, ${rec.flagged.length} flagged` : ''}`
                + `${rec.observedModels.length ? `, opened ${rec.observedModels.length} model file(s)` : ''}`
                + `${rec.error ? ` — ${rec.error}` : ''}`);
        }

        this._run.state = this._cancelled ? 'stopped' : 'done';
        this._run.finishedAt = new Date().toISOString();
        const final = {
            type: 'summary',
            startedAt: this._run.startedAt,
            finishedAt: this._run.finishedAt,
            state: this._run.state,
            machine: this._run.machine,
            suite: this._run.suite || null,
            summary: this._summary(),
            results: this._run.results,
        };
        // The per-run .jsonl stays exactly this run; the published report is the
        // merge, so re-running one bundle corrects one line instead of erasing 60.
        const merged = this._merged();
        const published = merged === this._run.results ? final : {
            ...final,
            summary: LibrarySweep.summarize(merged, this._run.recorderAvailable),
            results: merged,
            mergedFrom: this._run.ids.length,
        };
        try {
            fs.appendFileSync(this._run.reportPath, JSON.stringify(final) + '\n');
            fs.writeFileSync(path.join(this._dataDir, 'library-sweep-latest.json'), JSON.stringify(published, null, 1));
        } catch (e) { console.warn(`[Sweep] could not write the report: ${e.message}`); }
        const s = final.summary;
        console.log(`[Sweep] ${this._run.state}: ${s.succeeded}/${s.ran} ran clean, ${s.failed} failed, `
            + `${s.withFlaggedOutput} with suspect output, ${s.distinctModelsOpened} distinct model file(s) opened`);
    }

    /**
     * What a run was actually fed, as a human would want to read it.
     *
     * ★ The EFFECTIVE value, not the submitted one. Calibration sends only the
     * media it staged and a fresh seed; every other parameter keeps whatever
     * literal sits in the api.json — so the prompt that really ran is almost never
     * in paramValues, and a list built from paramValues alone would omit the single
     * most useful ingredient. Each row therefore says where its value came from.
     */
    _ingredients(entry, details) {
        const sent = details?.paramValues || {};
        const media = details?.media || {};
        const graph = entry.apiWorkflow || {};
        const out = [];
        for (const p of (entry.effective?.exposedParameters || [])) {
            const isMedia = ['image', 'video', 'audio', 'mask', 'model3d'].includes(p.type);
            // ★ A `camera` param is ONE control over several node fields, so the
            //   literal on its primary field is a fragment of the answer — the
            //   azimuth without the height or the framing. Recording that would
            //   make an example recall a placement nobody chose. The whole
            //   position is what was sent, or the meta's own default.
            const literal = p.type === 'camera'
                ? p.default
                : graph[p.nodeId]?.inputs?.[p.field];
            const wasSent = Object.prototype.hasOwnProperty.call(sent, p.key);
            const fromSuite = (details?.suiteKeys || []).includes(p.key);
            const row = {
                key: p.key,
                label: p.label || p.key,
                type: p.type,
                node: `${p.nodeId}.${p.field}`,
                from: fromSuite ? 'the test suite' : wasSent ? 'calibration' : 'the graph default',
                value: wasSent ? sent[p.key] : literal,
            };
            if (isMedia && media[p.key]) {
                row.sourcePath = media[p.key].source;      // the real file on disk
                row.staged = media[p.key].staged;          // the copy ComfyUI read
                row.from = media[p.key].how;
            } else if (isMedia && !wasSent) {
                row.from = 'left empty';
                row.value = null;
            }
            // A prompt can be thousands of characters; keep the report readable and
            // say so rather than silently cutting it.
            if (typeof row.value === 'string' && row.value.length > 2000) {
                row.truncated = row.value.length;
                row.value = row.value.slice(0, 2000);
            }
            out.push(row);
        }
        return out;
    }

    /**
     * A suite run's parameters, with every media reference turned into a file.
     *
     * Returns { params, notes, inputs, missing }: `params` is what calibrate()
     * lays over warmupParams (media as `file:<path>` or `asset:<name>`), `notes`
     * says where each media input came from, `inputs` is what the report records,
     * and `missing` lists every input that could not be found — any entry there
     * skips the run.
     */
    async _resolveSuiteParams(entry, run) {
        const exposed = new Map((entry.effective?.exposedParameters || []).map(p => [p.key, p]));
        const params = {}, notes = {}, inputs = {}, missing = [];
        for (const [key, spec] of Object.entries(run.params || {})) {
            const p = exposed.get(key);
            if (!p) { missing.push(`the suite sets "${key}", which this workflow does not have`); continue; }
            const media = MEDIA_TYPES.includes(p.type) ? parseMediaSpec(spec) : null;
            if (!media) { params[key] = spec; continue; }
            if (media.empty) { params[key] = null; inputs[key] = { empty: true }; continue; }
            if (media.asset) { params[key] = media.asset; inputs[key] = { asset: media.asset.slice('asset:'.length) }; continue; }

            const kind = media.kind || kindForParam(p.type);
            let src = null, from = null;
            for (const id of media.from) {
                src = id.startsWith('asset:') ? this._assetFile(id) : this._suiteOutput(id, kind, media.pick);
                if (src) { from = id; break; }
            }
            if (!src && media.fallback) {
                params[key] = media.fallback;
                inputs[key] = { asset: media.fallback.replace(/^asset:/, ''), fallbackFor: media.from };
                notes[key] = `fallback asset — no ${kind} output from ${media.from.join(' or ')}`;
                continue;
            }
            if (!src) {
                missing.push(`"${key}" needs a ${kind} from ${media.from.join(' or ')}, and there is none`);
                continue;
            }
            let file = src;
            if (media.derive.length) {
                try {
                    file = await this._derive(src, media.derive, `${entry.id}__${key}`);
                } catch (e) {
                    missing.push(`"${key}": could not derive it from ${from}'s output — ${e.message}`);
                    continue;
                }
            }
            params[key] = `file:${file}`;
            const ops = media.derive.map(o => o.op).join(' + ');
            notes[key] = `${from.startsWith('asset:') ? `the asset ${from.slice(6)}` : `output of ${from}`}${ops ? ` (${ops})` : ''}`;
            inputs[key] = { from, source: src, path: file, ...(ops ? { derive: media.derive } : {}) };
        }
        return { params, notes, inputs, missing };
    }

    /**
     * The `pick`-th output of `kind` that `workflowId` produced — this sweep's
     * row first, else the last published report's. Kind is ComfyQ's own
     * classification, with an unambiguous mesh format preferred over a .ply.
     */
    _suiteOutput(workflowId, kind, pick = 0) {
        const rows = [...(this._run?.results || []), ...(this._run?.prevRows || [])];
        const row = rows.find(r => r.id === workflowId && r.ok);
        if (!row) return null;
        const files = (row.outputs || []).filter(o => o.path && o.file
            && classify(o.file).kind === kind && fs.existsSync(o.path));
        // A .ply counts as a mesh, but TripoSplat writes a SPLAT .ply beside its
        // .glb — so a mesh input takes the unambiguous formats first.
        if (kind === 'model3d') files.sort((a, b) => (/\.ply$/i.test(a.file) ? 1 : 0) - (/\.ply$/i.test(b.file) ? 1 : 0));
        return files[pick]?.path || null;
    }

    /** A file in the assets folder (sub-folders allowed, escapes refused), or null. */
    _assetFile(spec) {
        const dir = this._config()?.assets?.dir;
        if (!dir) return null;
        const rootDir = path.resolve(dir);
        const full = path.resolve(rootDir, String(spec).replace(/^asset:/, ''));
        if (!(full.toLowerCase() + path.sep).startsWith(rootDir.toLowerCase() + path.sep) || full === rootDir) return null;
        try { return fs.statSync(full).isFile() ? full : null; } catch { return null; }
    }

    /** Make an input from an output or an asset (a frame, a crop, a hole, a damaged copy, a trimmed clip). */
    _derive(src, ops, name) {
        const dir = path.join(this._dataDir, 'suite-inputs', this._run?.stamp || 'adhoc');
        fs.mkdirSync(dir, { recursive: true });
        const video = (ops || []).some(o => VIDEO_DERIVE_OPS.includes(o?.op));
        const dest = path.join(dir, `${name}.${video ? 'mp4' : 'png'}`);
        return new Promise((resolve, reject) => {
            const py = this._python();
            if (!py || !fs.existsSync(DERIVE_SCRIPT)) return reject(new Error('ComfyUI\'s python or derive_input.py is missing'));
            const boot = "import runpy, sys, os; p = sys.argv[1]; "
                + "sys.path.insert(0, os.path.dirname(os.path.abspath(p))); "
                + "sys.argv = sys.argv[1:]; runpy.run_path(p, run_name='__main__')";
            let out = '', err = '';
            const child = spawn(py, ['-c', boot, DERIVE_SCRIPT], {
                env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' }, windowsHide: true,
            });
            const timer = setTimeout(() => { try { child.kill(); } catch { /* gone */ } reject(new Error('timed out')); }, 120000);
            child.stdout.on('data', d => { out += d.toString('utf8'); });
            child.stderr.on('data', d => { err += d.toString('utf8'); });
            child.on('error', e => { clearTimeout(timer); reject(e); });
            child.on('close', () => {
                clearTimeout(timer);
                let res = null;
                try { res = JSON.parse(out); } catch { /* fall through */ }
                if (res?.ok && fs.existsSync(dest)) return resolve(dest);
                reject(new Error(res?.error || err.trim().split('\n').pop() || 'no result'));
            });
            const assets = this._config()?.assets?.dir || null;
            try { child.stdin.write(JSON.stringify({ src, dest, ops, assets })); child.stdin.end(); } catch { /* closed */ }
        });
    }

    /**
     * Text the run produced, read from ComfyUI's history.
     *
     * ★ A `description` workflow's whole result is a caption — it comes back through
     * a PreviewAny node as a `text` array in the prompt's outputs and touches the
     * filesystem not at all. Without this the sweep recorded those bundles as having
     * produced nothing, and the owner could not read the answer they exist to give.
     *
     * Takes the most recent history entry, which is the run that just finished:
     * calibration is serialized, so nothing else can have queued in between.
     *
     * ⚠ "The most recent entry" is only this bundle's run if a run actually reached
     * ComfyUI. A bundle that fails before queueing leaves the PREVIOUS bundle's entry
     * newest, which would attribute its caption to the wrong row — so the caller
     * passes the prompt stamp and the entry must carry it.
     *
     * @param {string} [workflowId]  whose run this must be
     * @param {boolean} [haveFiles]  whether the run already produced output files
     * @param {number} [startedMs]   when this bundle's run began; an entry older than
     *   that is somebody else's, which is the only guard that works for a workflow
     *   carrying no stamp
     */
    async _collectTextOutputs(workflowId, haveFiles, startedMs) {
        const cfg = this._config() || {};
        const host = cfg.comfy_ui?.api_host || '127.0.0.1';
        const port = cfg.comfy_ui?.api_port || 8188;
        let hist;
        try {
            const r = await fetch(`http://${host}:${port}/history?max_items=1`, { signal: AbortSignal.timeout(8000) });
            if (!r.ok) return [];
            hist = await r.json();
        } catch { return []; }
        const entry = Object.values(hist || {})[0];
        // Whose run is this entry? The stamp rides on a save node's filename_prefix, so
        // when there IS one the prompt proves ownership. ★ Anchored on the digit that
        // follows the id, like the output matcher: without it,
        // `bench_image_edit_bernini_r_image_editing_` matches the `…_with_reference` run
        // too, which is the collision that already mis-credited a picture.
        //
        // ★★ But a stamp is only present if the graph SAVES something, and the workflows
        // this function exists for do not: a `description` bundle answers through a
        // PreviewAny and writes no file, so its prompt carries no filename_prefix at all.
        // Demanding a stamp therefore threw away the caption of every captioner — the one
        // case the feature serves — and the sweep that caught it reported "0 outputs, ok"
        // because the no-output detector exempts that category. So the rule is: reject an
        // entry that carries SOMEBODY ELSE'S stamp, and accept one that carries none.
        if (workflowId) {
            // GREEDY, and the timestamp must be a real one (Date.now() is 13 digits).
            // A lazy match would stop at the first digit run inside the id itself —
            // `bench_video_ltx2_5_i2v_1791…` would read as the stamp `bench_video_ltx2_5`
            // and then fail to match its own bundle.
            // ★ Only where a stamp is WRITTEN — a save node's filename_prefix. A test
            // suite feeds one bundle's result to the next, so an INPUT filename now
            // carries the upstream bundle's stamp too (`…__bench_image_ideogram4_t2i_
            // 1793…png`), and searching the whole prompt read the captioner's own
            // entry as somebody else's and threw its caption away — found by the
            // first suite run, which recorded both Gemma captioners as NO OUTPUT.
            const prefixes = Object.values((Array.isArray(entry?.prompt) ? entry.prompt[2] : null) || {})
                .map(n => n?.inputs?.filename_prefix).filter(v => typeof v === 'string');
            const stamps = prefixes.join(' ').match(/bench_[A-Za-z0-9_]+_\d{10,}/g) || [];
            const esc = workflowId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const mine = new RegExp(`^bench_${esc}_\\d`);
            if (stamps.length && !stamps.some(s => mine.test(s))) return [];
        }
        // ★★ And a SECOND guard, because "carries no stamp" is not the same as "is mine":
        // any stampless entry would otherwise be accepted, including the previous
        // bundle's. That is not hypothetical — the two Gemma captioners are both
        // stampless and run back to back, so if the second failed before queueing it
        // would inherit the first one's caption. ComfyUI stamps each entry with an
        // `execution_start` timestamp, so an entry older than this run cannot be ours.
        // (A test reaching a live ComfyUI is how this was found: the stub was missing and
        // the real history walked in.)
        if (startedMs) {
            const start = (entry?.status?.messages || [])
                .find(m => Array.isArray(m) && m[0] === 'execution_start')?.[1]?.timestamp;
            if (typeof start === 'number' && start < startedMs - 2000) return [];
        }
        const nodes = entry?.outputs || {};
        const out = [];
        const seen = new Set();
        for (const [nodeId, o] of Object.entries(nodes)) {
            for (const key of ['text', 'string']) {
                for (const v of (Array.isArray(o?.[key]) ? o[key] : [])) {
                    const s = typeof v === 'string' ? v : (v == null ? '' : String(v));
                    const t = s.trim();
                    // A media filename also lands in some nodes' ui payloads; a caption
                    // is never one, and a duplicate is never worth showing twice.
                    if (!t || seen.has(t) || /\.(png|jpe?g|webp|mp4|webm|flac|mp3|wav|glb|ply|spz)$/i.test(t)) continue;
                    seen.add(t);
                    // ★ The same rule the student-facing collector now applies, and for
                    // the same reason: beside a real file, a whitespace-free string is a
                    // node's plumbing (a combo's line index, a tensor shape, a sample
                    // count), not the bundle's answer. Kept regardless when text is all
                    // the run produced — then it IS the answer, however short. Tagged
                    // rather than silently dropped, because seven bundles emitting one
                    // is a finding, not noise.
                    const prose = /\s/.test(t);
                    out.push({
                        kind: 'text', file: `node ${nodeId}`, text: t, chars: t.length, flags: [],
                        ...(haveFiles && !prose ? { stray: true } : {}),
                    });
                }
            }
        }
        return out;
    }

    /** Output files this run produced, with a content check on each. */
    async _describeOutputs(workflowId, sinceMs) {
        const cfg = this._config() || {};
        const outDir = cfg.comfy_ui?.output_dir
            || (cfg.comfy_ui?.root_path ? path.join(cfg.comfy_ui.root_path, 'output') : null);
        if (!outDir || !fs.existsSync(outDir)) return [];
        // ★ Anchored on the timestamp that follows the id, not on the bare prefix.
        // Several bundle ids are prefixes of others — `image_edit_bernini_r_image_editing`
        // against `…_with_reference`, `video_ltx2_5_i2v` against `…_i2v_something` —
        // so a startsWith match credited one bundle with another's output. Caught in
        // the first real sweep's files: the plain editing bundle was shown holding
        // the reference bundle's picture.
        const stamped = new RegExp(`^bench_${workflowId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_\\d+`);
        const found = [];
        const walk = (dir, depth) => {
            if (depth > 2) return;
            let items = [];
            try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
            for (const it of items) {
                const p = path.join(dir, it.name);
                if (it.isDirectory()) { walk(p, depth + 1); continue; }
                if (!stamped.test(it.name)) continue;
                let st;
                try { st = fs.statSync(p); } catch { continue; }
                // mtime guard, so a previous sweep's files are not credited to this one
                if (st.mtimeMs + 2000 < sinceMs) continue;
                found.push(p);
            }
        };
        walk(outDir, 0);
        if (!found.length) return [];
        const stats = await this._runStats(found);
        const byPath = new Map(stats.map(s => [s.path, s]));
        return found.map(p => {
            const s = byPath.get(p) || {};
            return {
                ...s,
                // `file` is output-root-relative, which is exactly what ComfyQ's own
                // /images route serves — so the card can show the actual picture.
                // `path` is the absolute location, because the owner asked to be able
                // to go and open it on disk.
                file: path.relative(outDir, p).split(path.sep).join('/'),
                path: p,
            };
        });
    }

    /**
     * ComfyUI's own account of itself: version, torch, the GPU, and the argv it
     * was started with. Recorded so a report read a week later on another machine
     * still says what produced it.
     */
    /** Everything a reader needs to know what produced this report. */
    async _machine() {
        const cfg = this._config() || {};
        const sys = await this._systemInfo();
        let commit = null, branch = null;
        try {
            const gitDir = path.resolve(__dirname, '..', '..', '.git');
            const head = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf8').trim();
            const m = head.match(/^ref:\s*(.+)$/);
            if (m) {
                branch = m[1].replace('refs/heads/', '');
                commit = fs.readFileSync(path.join(gitDir, m[1]), 'utf8').trim().slice(0, 7);
            } else commit = head.slice(0, 7);
        } catch { /* not a checkout, or a packed ref — the rest still stands */ }
        return {
            at: new Date().toISOString(),
            host: os.hostname(),
            instance: cfg.instance?.nameCustom || cfg.instance?.name || null,
            gpu: sys?.gpu || cfg.instance?.gpu || null,
            vramTotalGb: sys?.vramTotalGb || cfg.instance?.vramGb || null,
            comfyui: sys?.comfyui || null,
            pytorch: sys?.pytorch || null,
            python: sys?.python || null,
            argv: (sys?.argv || []).filter(a => a.startsWith('--')),
            comfyRoot: cfg.comfy_ui?.root_path || null,
            assetsDir: cfg.assets?.dir || null,
            scanDirs: cfg.maintenance?.workflowScanDirs || [],
            comfyqCommit: commit,
            comfyqBranch: branch,
        };
    }

    async _systemInfo() {
        const cfg = this._config() || {};
        const host = cfg.comfy_ui?.api_host || '127.0.0.1';
        const port = cfg.comfy_ui?.api_port || 8188;
        try {
            const r = await fetch(`http://${host}:${port}/system_stats`, { signal: AbortSignal.timeout(8000) });
            if (!r.ok) return null;
            const j = await r.json();
            const dev = (j.devices || []).find(d => d?.type === 'cuda') || j.devices?.[0] || {};
            return {
                comfyui: j.system?.comfyui_version || null,
                python: (j.system?.python_version || '').split(' ')[0] || null,
                pytorch: j.system?.pytorch_version || null,
                argv: j.system?.argv || [],
                gpu: dev.name ? String(dev.name).replace(/^cuda:\d+\s+/i, '').trim() : null,
                vramTotalGb: dev.vram_total ? +(dev.vram_total / 1024 ** 3).toFixed(2) : null,
            };
        } catch { return null; }
    }

    _python() {
        const cfg = this._config() || {};
        const root = cfg.comfy_ui?.root_path || '';
        const exe = cfg.comfy_ui?.python_executable || '';
        const cands = [];
        if (exe) cands.push(path.isAbsolute(exe) ? exe : path.resolve(root || '.', exe));
        if (root) cands.push(path.resolve(root, '..', 'python_embeded', 'python.exe'));
        return cands.find(p => { try { return fs.statSync(p).isFile(); } catch { return false; } }) || null;
    }

    /** Pixel/frame stats through ComfyUI's own python (PIL, numpy, cv2, av). */
    _runStats(files) {
        return new Promise((resolve) => {
            const py = this._python();
            if (!py || !fs.existsSync(STATS_SCRIPT)) return resolve([]);
            // The same runpy bootstrap the maintenance runner needs: python_embeded
            // has a ._pth, which pins sys.path and ignores PYTHONPATH, so a script
            // cannot import a sibling without this.
            const boot = "import runpy, sys, os; p = sys.argv[1]; "
                + "sys.path.insert(0, os.path.dirname(os.path.abspath(p))); "
                + "sys.argv = sys.argv[1:]; runpy.run_path(p, run_name='__main__')";
            let out = '', done = false;
            const child = spawn(py, ['-c', boot, STATS_SCRIPT], {
                env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
                windowsHide: true,
            });
            const finish = (v) => { if (!done) { done = true; resolve(v); } };
            const timer = setTimeout(() => { try { child.kill(); } catch { /* gone */ } finish([]); }, STATS_TIMEOUT_MS);
            child.stdout.on('data', d => { out += d.toString('utf8'); });
            child.stderr.on('data', d => console.warn(`[Sweep/stats] ${d.toString('utf8').trim().slice(0, 200)}`));
            child.on('error', () => { clearTimeout(timer); finish([]); });
            child.on('close', () => {
                clearTimeout(timer);
                try { finish(JSON.parse(out)); } catch { finish([]); }
            });
            try { child.stdin.write(JSON.stringify(files)); child.stdin.end(); } catch { /* closed */ }
        });
    }
}

module.exports = { LibrarySweep, DATA_DIR };
