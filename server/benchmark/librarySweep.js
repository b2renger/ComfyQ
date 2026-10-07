const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { readAccessLog, invalidateAccessLog } = require('../workflows/modelAccessLog');
const { flagsFromArgv } = require('../workers/perfFlags');

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
        const ok = r.results.filter(x => x.ok);
        const flagged = r.results.filter(x => (x.flagged || []).length);
        const observed = new Set();
        for (const x of r.results) for (const n of (x.observedModels || [])) observed.add(n);
        return {
            ran: r.results.length,
            succeeded: ok.length,
            failed: r.results.length - ok.length,
            withFlaggedOutput: flagged.length,
            noOutput: r.results.filter(x => x.ok && !(x.outputs || []).length).length,
            distinctModelsOpened: observed.size,
            recorderAvailable: r.recorderAvailable,
        };
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
        const wanted = Array.isArray(opts.ids) && opts.ids.length
            ? entries.filter(e => opts.ids.includes(e.id))
            : entries;
        if (!wanted.length) return { ok: false, error: 'no workflows to run' };

        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        fs.mkdirSync(this._dataDir, { recursive: true });
        this._cancelled = false;
        this._run = {
            state: 'running',
            startedAt: new Date().toISOString(),
            finishedAt: null,
            ids: wanted.map(e => e.id),
            results: [],
            current: null,
            // Written per bundle, not once at the end: a two-hour run that is
            // interrupted must still leave behind what it learned. Same lesson as
            // the prune log.
            reportPath: path.join(this._dataDir, `library-sweep-${stamp}.jsonl`),
            stamp,
            recorderAvailable: readAccessLog(this._config()?.comfy_ui?.root_path || '').available,
        };
        // Captured once, up front: a report is read later, often on another
        // machine, and "it failed" means nothing without knowing what it ran on.
        this._run.machine = await this._machine();
        fs.writeFileSync(this._run.reportPath,
            JSON.stringify({
                type: 'start', at: this._run.startedAt,
                bundles: this._run.ids.length, machine: this._run.machine,
            }) + '\n');

        this._execute(wanted, cal).catch(e => {
            if (this._run) { this._run.state = 'failed'; this._run.error = e.message; }
        });
        return { ok: true, total: wanted.length };
    }

    stop() {
        if (!this._run || this._run.state !== 'running') return { ok: false, error: 'nothing is running' };
        this._cancelled = true;
        this._run.state = 'stopping';
        return { ok: true, note: 'will stop after the workflow now running finishes' };
    }

    async _execute(entries, cal) {
        const root = this._config()?.comfy_ui?.root_path || '';
        for (const entry of entries) {
            if (this._cancelled) break;
            this._run.current = { id: entry.id, name: entry.summary?.name || entry.id, startedAt: new Date().toISOString() };

            // What the recorder had seen before this bundle ran, so the delta is
            // this bundle's own.
            invalidateAccessLog();
            const before = new Set(readAccessLog(root).byName.keys());
            const startedMs = Date.now();

            // ★ Preserve a hand-measured runtime. PiD's progress bar counts tiles,
            // so its automatic split under-reports the warm time by 10 s — its
            // runtime.json says source:'manual' for that reason, and a sweep must
            // not quietly overwrite a figure someone measured by hand.
            const prevRuntime = entry.runtime && entry.runtime.source === 'manual' ? entry.runtime : null;

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

            try {
                const runtime = await cal.calibrate(entry.id);
                rec.ok = true;
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
            }

            // Outputs, found by the prefix the benchmark stamps on every save
            // node — no prompt id needed, and it reaches the subfolders that
            // audio and 3D saves use.
            try {
                rec.outputs = await this._describeOutputs(entry.id, startedMs);
                rec.flagged = rec.outputs
                    .filter(o => (o.flags || []).length || o.error)
                    .map(o => ({ file: o.file, flags: o.flags || [], error: o.error || null }));
            } catch (e) {
                rec.outputError = e.message;
            }

            // Which weights ComfyUI actually opened while this bundle ran.
            try {
                invalidateAccessLog();
                const after = readAccessLog(root);
                rec.observedModels = [...after.byName.keys()].filter(n => !before.has(n)).sort();
                rec.recorderAvailable = after.available;
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
                    notMasked: want.filter(k => flagsFromArgv(argv).includes(k)),
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
            summary: this._summary(),
            results: this._run.results,
        };
        try {
            fs.appendFileSync(this._run.reportPath, JSON.stringify(final) + '\n');
            fs.writeFileSync(path.join(this._dataDir, 'library-sweep-latest.json'), JSON.stringify(final, null, 1));
        } catch (e) { console.warn(`[Sweep] could not write the report: ${e.message}`); }
        const s = final.summary;
        console.log(`[Sweep] ${this._run.state}: ${s.succeeded}/${s.ran} ran clean, ${s.failed} failed, `
            + `${s.withFlaggedOutput} with suspect output, ${s.distinctModelsOpened} distinct model file(s) opened`);
    }

    /** Output files this run produced, with a content check on each. */
    async _describeOutputs(workflowId, sinceMs) {
        const cfg = this._config() || {};
        const outDir = cfg.comfy_ui?.output_dir
            || (cfg.comfy_ui?.root_path ? path.join(cfg.comfy_ui.root_path, 'output') : null);
        if (!outDir || !fs.existsSync(outDir)) return [];
        const prefix = `bench_${workflowId}_`;
        const found = [];
        const walk = (dir, depth) => {
            if (depth > 2) return;
            let items = [];
            try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
            for (const it of items) {
                const p = path.join(dir, it.name);
                if (it.isDirectory()) { walk(p, depth + 1); continue; }
                if (!it.name.startsWith(prefix)) continue;
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
                file: path.relative(outDir, p).split(path.sep).join('/'),
                ...s,
                path: undefined,
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
