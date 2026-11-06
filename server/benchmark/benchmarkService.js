const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { effectiveComfyConfig, runningPerfFlags, blockingFlags, PERF_FLAG_LABELS } = require('../workers/perfFlags');

// BenchmarkService — runs each workflow's `warmupParams` once and writes a
// sidecar `<id>.runtime.json` with measured wall-time + samples-per-sec.
// Triggered explicitly (admin "Calibrate" button) or implicitly before first
// real job for a workflow that has no runtime.json yet.
//
// v2 design: a benchmark is just a normal job submitted via the worker, so
// progress events feed back through the same path. We capture the prompt_id
// and observe WS events directly here for timing precision.

const CALIBRATION_IMAGE_NAME = '__comfyq_calibration.png';
// Safety cap so a stuck calibration can't hang the admin gauge forever. This is
// NOT a per-job time budget (real jobs run to completion / until cancelled) — it
// only bounds the admin calibration run, and is deliberately generous since
// calibration normally finishes in seconds-to-minutes.
const CALIBRATION_TIMEOUT_MS = 2 * 60 * 60 * 1000; // 2h

// Extensions the calibrator will accept from the assets dir for each input
// type. Images are restricted to safe static formats (no animated webp/gif that
// some LoadImage builds choke on). Videos/audio are real container formats.
const ASSET_EXTS = {
    image: ['.png', '.jpg', '.jpeg'],
    // A 'mask' input is a painted base image (RGBA PNG); for calibration we
    // stage a plain image just like 'image' — a file without an alpha channel
    // yields an empty mask, which inpaints nothing but still runs the full
    // sampler, so the timing is valid.
    mask: ['.png', '.jpg', '.jpeg'],
    video: ['.mp4', '.webm', '.mov', '.mkv', '.avi'],
    audio: ['.mp3', '.wav', '.flac', '.ogg', '.m4a', '.aac'],
    // A 3D mesh input. Geometry only -- textures ride inside a .glb.
    // Only what Get3DComponents can read (glb, gltf, obj, stl): it refuses .fbx
    // and any other suffix, so a .ply or .fbx in the assets dir must not be picked.
    model3d: ['.glb', '.gltf', '.obj', '.stl']
};
// Skip tiny thumbnails / depth maps when picking an image so we don't feed a
// degenerate 12×12 px file into a workflow that derives latent size from it.
const IMAGE_MIN_BYTES = 50 * 1024;

// Whether an exposed parameter is a seed. Calibration replaces every one with a
// fresh number so the run cannot be answered from ComfyUI's result cache, and the
// sweep report labels those values "calibration" — both read this one rule.
// A seed sits on a sampler field (`seed`, `noise_seed`), inside a widget group
// (`sampling_mode.seed` — the Gemma captioners) or on a primitive node whose key
// is `seed_<n>` (the 360 panorama's `7.value`, linked into both samplers). The
// last two were missed: the panorama could be calibrated from the cache, and the
// captioners ran the test suite's seed verbatim.
// The key rule alone (`seed` as the last word, then only node-id numbers:
// `seed_7`, `ksampler_seed_3`, `randomnoise_noise_seed_75_73`) gives the same
// answer as key + field on every bundle, so a caller that only has a job's
// param keys (the ingredients zip, the relaunch panel) can pass `{ key }`.
// ⚠ Never /seed/ anywhere in the name: SeedVR2's colour-correction key contains it.
// ⚠ The client cannot import this, so it keeps its own copy (the booking form's
//   re-roll, the relaunch panel's seed line, client/src/utils/seedParam.js).
//   client/src/utils/seedParam.test.mjs tests that copy against seedParam.fixture.json,
//   the list this rule is tested against, so the two cannot drift apart.
function isSeedParam(p) {
    const k = String(p?.key || '').toLowerCase();
    const f = String(p?.field || '').toLowerCase();
    return /(^|_)seed(_\d+)*$/.test(k) || /(^|[._])seed$/.test(f);
}

// Tiny PNG generator (no external deps). Used to seed a reference image into
// ComfyUI's input/ dir so workflows with image inputs can be calibrated
// without first uploading sample media.
function _crc32(buf) {
    let table = _crc32.table;
    if (!table) {
        table = new Uint32Array(256);
        for (let n = 0; n < 256; n++) {
            let c = n;
            for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
            table[n] = c >>> 0;
        }
        _crc32.table = table;
    }
    let crc = 0xffffffff;
    for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
}
function _pngChunk(type, data) {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(_crc32(Buffer.concat([typeBuf, data])), 0);
    return Buffer.concat([len, typeBuf, data, crc]);
}
function _makeSolidPng(width, height, [r, g, b]) {
    const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8;  // bit depth
    ihdr[9] = 2;  // color type RGB
    const rowLen = width * 3;
    const raw = Buffer.alloc(height * (rowLen + 1));
    for (let y = 0; y < height; y++) {
        const off = y * (rowLen + 1);
        raw[off] = 0; // filter: none
        for (let x = 0; x < width; x++) {
            const p = off + 1 + x * 3;
            raw[p] = r; raw[p + 1] = g; raw[p + 2] = b;
        }
    }
    const idat = zlib.deflateSync(raw);
    return Buffer.concat([sig, _pngChunk('IHDR', ihdr), _pngChunk('IDAT', idat), _pngChunk('IEND', Buffer.alloc(0))]);
}

class BenchmarkService {
    constructor({ worker, registry, comfyConfig, assetsDir, lanes = null }) {
        this.worker = worker;
        // When a workflow is being served in its own lane, calibrate it on THAT
        // lane's ComfyUI: it is the process that will actually run it, and the
        // VRAM measured is the VRAM that lane will hold.
        this.lanes = lanes;
        this.registry = registry;
        this.comfyConfig = comfyConfig;
        // Directory of sample media for auto-calibration (config.assets.dir).
        this.assetsDir = assetsDir || '';
    }

    _ensureCalibrationImage() {
        const inputDir = path.resolve(this.comfyConfig.root_path, 'input');
        fs.mkdirSync(inputDir, { recursive: true });
        const target = path.join(inputDir, CALIBRATION_IMAGE_NAME);
        if (fs.existsSync(target)) return CALIBRATION_IMAGE_NAME;
        fs.writeFileSync(target, _makeSolidPng(512, 512, [180, 180, 180]));
        return CALIBRATION_IMAGE_NAME;
    }

    // Pick a file from the assets dir matching `type` (image|video|audio|model3d).
    // Deterministic: smallest video/audio (fastest to decode), smallest image
    // above a size floor (skips depth-map thumbnails). Returns an absolute path
    // or null when the dir is unset/missing or has no file of that type.
    _resolveAsset(type) {
        const dir = this.assetsDir;
        if (!dir) return null;
        const exts = ASSET_EXTS[type] || [];
        let names;
        try { names = fs.readdirSync(dir); } catch { return null; }
        const cands = [];
        for (const name of names) {
            if (name === CALIBRATION_IMAGE_NAME || name.startsWith('comfyq__')) continue;
            if (!exts.includes(path.extname(name).toLowerCase())) continue;
            const full = path.join(dir, name);
            let st; try { st = fs.statSync(full); } catch { continue; }
            if (!st.isFile()) continue;
            cands.push({ full, size: st.size });
        }
        if (cands.length === 0) return null;
        cands.sort((a, b) => a.size - b.size);
        if (type === 'image' || type === 'mask') {
            // Median of the above-floor images → a "typical" photo rather than a
            // tiny icon/line-drawing (degenerate for 3D / multi-view) or a huge
            // file (slow upload). Falls back to all candidates if none clear the
            // floor.
            const pool = cands.filter(c => c.size >= IMAGE_MIN_BYTES);
            const arr = pool.length ? pool : cands;
            return arr[Math.floor((arr.length - 1) / 2)].full;
        }
        if (type === 'model3d') {
            // NOT the smallest: a mesh tool's cost scales with how dense the
            // mesh is, so the smallest file on disk would time a decimation
            // bundle against a twelve-triangle cube. Median, like images.
            return cands[Math.floor((cands.length - 1) / 2)].full;
        }
        // Smallest video/audio = fastest to decode; content is irrelevant to timing.
        return cands[0].full;
    }

    // A warmupParams value of `asset:<file name>` names a specific file in the
    // assets dir for that media input. Needed when the content matters, not
    // just the type: a pose / character-replacement workflow calibrated on
    // whatever video happens to be smallest may find no person and fail.
    /**
     * @param {object} [opts]
     * @param {string[]} [opts.extraRoots]  more folders a `file:` value may come
     *   from — a sweep run with its own data dir derives its inputs there
     * @param {boolean} [opts.strict]  the value is a TEST SUITE's input: refuse it
     *   with an error instead of falling back to an automatic pick
     */
    _namedAsset(value, type, { extraRoots = [], strict = false } = {}) {
        // ★ A value that cannot be used. For warmupParams the gauge picks a file of
        // the right type instead and says so. A test suite's input is never swapped:
        // the result would become an example that pretends to follow from a file
        // it never saw, while the report still named the one asked for. The run
        // stops with the reason instead.
        const refuse = (why) => {
            if (strict) throw new Error(`${why} — a test-suite input is never replaced with a random file, so this run was not made`);
            console.warn(`[Benchmark]   ${why} — picking a ${type} automatically`);
            return null;
        };
        // `file:<absolute path>` — what a test suite passes when it feeds one
        // workflow's RESULT to the next (see suitePlan.js). Accepted only inside
        // the folders ComfyQ already works with: ComfyUI's output and input dirs,
        // the assets dir, and the suite's own derived-inputs folder (plus the one
        // a sweep with its own data dir writes to). A path from anywhere else is
        // refused rather than copied into ComfyUI's input dir.
        if (typeof value === 'string' && value.startsWith('file:')) {
            const full = path.resolve(value.slice('file:'.length).trim());
            const roots = [
                this.comfyConfig?.output_dir || (this.comfyConfig?.root_path ? path.join(this.comfyConfig.root_path, 'output') : null),
                this.comfyConfig?.root_path ? path.join(this.comfyConfig.root_path, 'input') : null,
                this.assetsDir || null,
                path.resolve(__dirname, '..', 'data', 'suite-inputs'),
                ...(extraRoots || []),
            ].filter(Boolean).map(r => path.resolve(r).toLowerCase() + path.sep);
            const inside = roots.some(r => (full.toLowerCase() + path.sep).startsWith(r) && full.toLowerCase() + path.sep !== r);
            let isFile = false;
            try { isFile = fs.statSync(full).isFile(); } catch { /* missing */ }
            if (inside && isFile) return full;
            return refuse(`a ${type} input asks for ${full}, which is ${isFile ? 'outside the folders ComfyQ works with' : 'not there'}`);
        }
        if (typeof value !== 'string' || !value.startsWith('asset:')) return undefined;
        const name = value.slice('asset:'.length).trim();
        const full = this.assetsDir ? path.join(this.assetsDir, name) : '';
        // Inside the assets folder — a sub-folder is fine (Keyframes/…), an
        // escape (../) is not.
        const rootDir = this.assetsDir ? path.resolve(this.assetsDir).toLowerCase() + path.sep : null;
        const ok = full && rootDir && path.resolve(full).toLowerCase().startsWith(rootDir)
            && fs.existsSync(full) && fs.statSync(full).isFile();
        if (ok) return full;
        return refuse(`a ${type} input asks for the asset "${name}", which is not in ${this.assetsDir || '(no assets dir)'}`);
    }

    // Stage the assets each image/video/audio input needs into ComfyUI/input and
    // return the paramValues map (basenames the Load* nodes will read). Reuses
    // the worker's InputUploader so the copies are namespaced + sweepable.
    /**
     * @param {object} [overrides]   values a test suite sets for this run, laid
     *   over warmupParams (a media value may be `asset:` or `file:`)
     * @param {object} [mediaNotes]  per media key, where a suite input came from —
     *   shown to a human beside the ingredient ("output of image_…_t2i")
     * @param {object} [opts]
     * @param {object} [opts.worker]      the worker whose uploader stages the copies
     * @param {string[]} [opts.inputRoots]  more folders a suite's `file:` value may come from
     */
    _buildCalibrationParams(entry, benchJobId, overrides = null, mediaNotes = null, { worker = this.worker, inputRoots = [], reproducible = false } = {}) {
        const paramValues = { ...(entry.meta.warmupParams || {}), ...(overrides || {}) };
        // ★ Which file on disk each media input really came from, kept so a sweep
        // report can show a human the ingredients that produced a given result.
        // The value in paramValues is only the namespaced copy inside ComfyUI/input,
        // which is swept away after the run and tells nobody what was fed in.
        this._lastMedia = {};
        for (const p of entry.effective.exposedParameters) {
            if (!['image', 'video', 'audio', 'mask', 'model3d'].includes(p.type)) continue;
            const fromSuite = !!overrides && Object.prototype.hasOwnProperty.call(overrides, p.key);
            const named = this._namedAsset(paramValues[p.key], p.type, { extraRoots: inputRoots, strict: fromSuite });
            if (named) {
                const rec = worker.uploader.copy({
                    jobId: benchJobId, paramKey: p.key,
                    originalName: path.basename(named), source: named
                });
                paramValues[p.key] = rec.comfyFilename;
                const how = mediaNotes?.[p.key]
                    || (overrides && Object.prototype.hasOwnProperty.call(overrides, p.key) ? 'named by the test suite' : 'named in warmupParams');
                this._lastMedia[p.key] = { source: named, staged: rec.comfyFilename, how };
                console.log(`[Benchmark]   ${p.type} input "${p.key}" ← ${path.basename(named)} (${how})`);
                continue;
            }
            if (named === null) delete paramValues[p.key];
            if (paramValues[p.key] !== undefined && paramValues[p.key] !== '') continue;
            const asset = this._resolveAsset(p.type);
            if (asset) {
                const rec = worker.uploader.copy({
                    jobId: benchJobId, paramKey: p.key,
                    originalName: path.basename(asset), source: asset
                });
                paramValues[p.key] = rec.comfyFilename;
                this._lastMedia[p.key] = { source: asset, staged: rec.comfyFilename, how: 'resolved from the assets dir' };
                console.log(`[Benchmark]   ${p.type} input "${p.key}" ← ${path.basename(asset)}`);
            } else if (p.type === 'image' || p.type === 'mask') {
                paramValues[p.key] = this._ensureCalibrationImage();
                this._lastMedia[p.key] = {
                    source: '(built-in reference PNG — no asset matched)',
                    staged: paramValues[p.key], how: 'fallback',
                };
                console.log(`[Benchmark]   ${p.type} input "${p.key}" ← built-in reference PNG (no asset found)`);
            } else {
                throw new Error(`Cannot calibrate: no ${p.type} asset available for input "${p.key}". Add a ${p.type} file to the assets dir (${this.assetsDir || 'not configured'}) or set meta.warmupParams.`);
            }
        }
        // Randomize any EXPOSED seed param so the run can't hit ComfyUI's result
        // cache — this covers seeds that live in a connected primitive node
        // (field `value`) which `_randomizeSeeds` (literal `*seed` fields) misses.
        // Overrides a warmupParams seed on purpose; calibration must always run.
        // A seed a test suite chose stays: an example is reproduced from its seeds,
        // and the /free before the run empties ComfyUI's cache anyway.
        for (const p of entry.effective.exposedParameters) {
            if (!isSeedParam(p)) continue;
            if (reproducible && typeof overrides?.[p.key] === 'number') continue;
            paramValues[p.key] = Math.floor(Math.random() * 0x7fffffff);
        }
        return paramValues;
    }

    // Deep-clone the workflow with every numeric *seed field randomized. This is
    // the cache-buster: ComfyUI caches each node's output keyed on its inputs, so
    // re-submitting an identical graph returns the cached result instantly (no
    // real sampling). A fresh seed forces the sampler (and everything downstream)
    // to actually execute, while the model-loader nodes are untouched so loaded
    // models stay resident. Only literal numeric seeds are bumped — `[nodeId,idx]`
    // connections are left alone.
    _randomizeSeeds(apiWorkflow) {
        const wf = JSON.parse(JSON.stringify(apiWorkflow));
        let n = 0;
        for (const node of Object.values(wf)) {
            const inputs = node && node.inputs;
            if (!inputs) continue;
            for (const [k, v] of Object.entries(inputs)) {
                if (typeof v === 'number' && /seed$/i.test(k)) {
                    inputs[k] = Math.floor(Math.random() * 0x7fffffff);
                    n++;
                }
            }
        }
        return { wf, seedsRandomized: n };
    }

    // Submit the workflow once and resolve when ComfyUI reports the prompt
    // finished. Returns timing (absolute timestamps + the sampler-step window).
    // Always leaves the worker idle (finalize) so a later job/run can submit.
    /**
     * Poll ComfyUI's device memory for the length of a run.
     *
     * `/system_stats` reports, per device, the card's own total/free and the
     * torch allocator's total/free. The difference of the torch pair is what
     * THIS ComfyUI is holding; the difference of the card pair includes every
     * other process (another lane, the desktop). Returns a handle whose stop()
     * takes one last reading a few seconds after the run, which is what stays
     * resident between jobs — the number that decides what else fits beside it.
     */
    /**
     * Poll until the card stops giving memory back, so a run that follows
     * another one starts from a real floor. Bounded: a lane that legitimately
     * keeps a model resident (a second lane serving) never drops, and waiting
     * for it would hang every calibration.
     */
    async _waitForVramSettle({ worker = this.worker, timeoutMs = 25000, intervalMs = 1500, quietMs = 3000 } = {}) {
        const GB = 1024 ** 3;
        const deadline = Date.now() + timeoutMs;
        let lowest = Infinity, lastDropAt = Date.now();
        while (Date.now() < deadline) {
            let used = null;
            try {
                const stats = await worker.rest.ping();
                const dev = (stats?.devices || []).find(d => d?.type === 'cuda') || stats?.devices?.[0];
                if (dev) used = (dev.vram_total || 0) - (dev.vram_free || 0);
            } catch { /* ComfyUI busy or restarting — just stop waiting */ }
            if (used === null) return;
            if (used < lowest - 0.25 * GB) { lowest = used; lastDropAt = Date.now(); }
            else if (Date.now() - lastDropAt >= quietMs) {
                console.log(`[Benchmark] card settled at ${(used / GB).toFixed(2)} GB before the timed run`);
                return;
            }
            await new Promise(r => setTimeout(r, intervalMs));
        }
        console.warn('[Benchmark] card never settled — the VRAM baseline may include another process');
    }

    _watchVram({ worker = this.worker, intervalMs = 2000, settleMs = 4000 } = {}) {
        const GB = 1024 ** 3;
        let peak = 0, cardPeak = 0, seen = false, baseCard = null;
        const read = async () => {
            try {
                const stats = await worker.rest.ping();
                const dev = (stats?.devices || []).find(d => d?.type === 'cuda') || stats?.devices?.[0];
                if (!dev) return null;
                const mine = (dev.torch_vram_total || 0) - (dev.torch_vram_free || 0);
                const card = (dev.vram_total || 0) - (dev.vram_free || 0);
                if (mine > 0 || card > 0) seen = true;
                // The floor this run grew FROM. Take the LOWEST reading, not the
                // first: ComfyUI frees lazily — /free answers 200 while the
                // previous run's weights are still resident — so a first-sample
                // baseline makes a calibration that follows another run report a
                // fraction of its own footprint. (Measured: the FastVideo i2v
                // reported 8.79 GB against a 31.14 GB card peak because the t2v
                // before it was still loaded at baseline time.) Reading low here
                // overstates the growth, and overstating is the safe direction —
                // understating is what admits a lane that does not fit.
                baseCard = baseCard === null ? card : Math.min(baseCard, card);
                peak = Math.max(peak, mine);
                cardPeak = Math.max(cardPeak, card);
                return { mine, card };
            } catch { return null; }
        };
        // Read once straight away: the first interval tick is 2 s in, by which
        // time a fast loader has already put several GB on the card and the
        // baseline would swallow them.
        const first = read();
        const timer = setInterval(read, intervalMs);
        return {
            stop: async () => {
                clearInterval(timer);
                await first;
                await read();
                // Let ComfyUI settle, then see what it kept loaded.
                await new Promise(r => setTimeout(r, settleMs));
                const last = await read();
                const round = (bytes) => bytes > 0 ? +(bytes / GB).toFixed(2) : null;
                // torch_vram only counts PyTorch's own allocator. Nodes with
                // their own CUDA kernels (the 3D pipelines, flash-attention
                // sparse ops) allocate outside it, and reporting only the torch
                // figure would badly understate them — which, for deciding
                // whether a second workflow fits, is the dangerous direction to
                // be wrong in. So take the larger of "what torch held" and "how
                // much the whole card grew during the run".
                const grew = baseCard !== null ? Math.max(0, cardPeak - baseCard) : 0;
                return {
                    peakGb: seen ? round(Math.max(peak, grew)) : null,
                    torchPeakGb: seen ? round(peak) : null,
                    residentGb: seen && last ? round(last.mine) : null,
                    cardPeakGb: seen ? round(cardPeak) : null,
                };
            },
        };
    }

    async _runOnce(entry, apiWorkflow, paramValues, runId, worker = this.worker) {
        let stepsDone = 0, stepsTotal = 0, firstStepAt = null, lastStepAt = null;
        let resolveDone, rejectDone;
        const donePromise = new Promise((res, rej) => { resolveDone = res; rejectDone = rej; });
        const onProgress = ({ stepsDone: d, stepsTotal: t }) => {
            if (firstStepAt == null) firstStepAt = Date.now();
            lastStepAt = Date.now();
            stepsDone = d; stepsTotal = t;
        };
        const onFinished = () => resolveDone();
        // ★ Carry the detail onto the Error so a caller that reports failures (the
        // library sweep) can print the traceback instead of just the one-liner.
        const onFailed = ({ errorReason, errorDetail }) => {
            const e = new Error(errorReason || 'benchmark-failed');
            if (errorDetail) {
                e.traceback = errorDetail.traceback || null;
                e.exceptionType = errorDetail.exceptionType || null;
                e.failedNode = errorDetail.nodeId != null
                    ? `${errorDetail.nodeId} (${errorDetail.nodeType || 'unknown class'})`
                    : (errorDetail.nodeType || null);
            }
            rejectDone(e);
        };
        worker.on('progress', onProgress);
        worker.on('execution-finished', onFinished);
        worker.on('failed', onFailed);

        const startedAt = Date.now();
        try {
            await worker.submit(runId, apiWorkflow, {
                workflowId: entry.id,
                exposedParameters: entry.effective.exposedParameters,
                paramValues,
                inputs: [],
                filenamePrefix: `bench_${entry.id}_${Date.now()}`,
                requirements: entry.meta.requirements
            });
            await Promise.race([
                donePromise,
                new Promise((_, rej) => setTimeout(() => rej(new Error('benchmark timed out')), CALIBRATION_TIMEOUT_MS))
            ]);
            worker.finalize({ success: true });
            const finishedAt = Date.now();
            return { durationMs: finishedAt - startedAt, startedAt, finishedAt, firstStepAt, lastStepAt, stepsDone, stepsTotal };
        } catch (e) {
            // Release the worker so the next run (or a later job) can submit — but
            // only while it is still running THIS run. A submit refused with "Worker
            // not idle" means someone else holds it (a student job, another
            // calibration): finalize() would reset THEIR run, its events would be
            // dropped from then on, and it would wait out the two-hour timeout.
            try { if (worker.getStatus().currentJobId === runId) worker.finalize({ success: false }); } catch { /* ignore */ }
            throw e;
        } finally {
            worker.off('progress', onProgress);
            worker.off('execution-finished', onFinished);
            worker.off('failed', onFailed);
        }
    }

    // Run the workflow ONCE for real and write <id>.runtime.json. The single run
    // is split at the first sampler step into:
    //   • model load  (start → first step): the per-switch one-time cost
    //   • generation  (first step → end):   the recurring cost a warm worker pays
    // so we report BOTH a first-time figure (coldDurationSec, incl. load) and the
    // optimal/warm figure (estimatedDurationSec, the timeline number) from one run.
    //
    // We deliberately do NOT do a second "warm" submission: ComfyUI would return
    // its cached result for an identical graph in ~1s (which is what made
    // calibration report 1s). Instead the run uses a fresh random seed so it
    // always actually executes — even on re-calibration — and we derive the warm
    // cost by subtracting the measured load phase. Inputs are auto-supplied from
    // the assets dir; when the content matters, meta.warmupParams names a file
    // with `asset:<name>` (see _namedAsset).
    /**
     * @param {object} [opts]
     * @param {object} [opts.params]      a test suite's values for this run
     * @param {object} [opts.mediaNotes]  where each suite media input came from
     * @param {string[]} [opts.inputRoots]  more folders a suite's `file:` input may
     *   come from (a sweep run with its own data dir derives its inputs there)
     */
    async calibrate(workflowId, opts = {}) {
        const entry = this.registry.get(workflowId);
        if (!entry || entry.unavailable) {
            throw new Error(`Cannot calibrate unavailable workflow: ${workflowId}`);
        }
        // ★ One calibration at a time, claimed BEFORE the first await. The idle check
        // in _calibrate is not enough on its own: the worker stays 'idle' through the
        // /free and the wait for the card to settle (3–25 s), so a second click in
        // that window passed it too. The loser's submit then failed "Worker not
        // idle", its cleanup reset the winner's run — which then waited out the
        // two-hour timeout — and could delete the winner's staged inputs. One claim
        // for the whole service also stops two LANES calibrating at once: both
        // would /free and measure the same card.
        if (this._running) {
            throw new Error(`Another calibration is running (${this._running}) — wait for it to finish; two at once would disturb each other's timing and memory figures`);
        }
        this._running = workflowId;
        try {
            return await this._calibrate(workflowId, entry, opts);
        } finally {
            this._running = null;
        }
    }

    async _calibrate(workflowId, entry, opts) {
        // Run on this workflow's own lane when it has one. The worker is handed to
        // every step rather than swapped into this.worker: the swap was not undone
        // when preparing the inputs threw, so later calibrations of other workflows
        // ran on that lane's ComfyUI — or, once the lane closed, were refused as
        // busy until a restart.
        const laneWorker = this.lanes?.get?.(workflowId)?.worker || null;
        const worker = laneWorker || this.worker;
        if (worker.getStatus().state !== 'idle') {
            throw new Error('Worker is busy; calibrate after queue drains');
        }
        // Refuse to gauge a workflow whose ComfyUI is running with a flag that
        // workflow declares it cannot use. AdminCalibrator masks those flags and
        // restarts before it calls us, but in STUDENT mode the route reaches
        // this method directly, on the ComfyUI already serving — and these flags
        // do not crash, they silently save black images (SeedVR2 7B under
        // fp16_accumulation, Marigold and Qwen-Image-Edit under Sage). Timing a
        // black run and writing it to runtime.json as fact is worse than not
        // measuring at all, so say plainly what is wrong and what to do.
        const blocked = blockingFlags(effectiveComfyConfig(this.comfyConfig, entry.meta),
            await runningPerfFlags(worker.rest));
        if (blocked.length) {
            const names = blocked.map(k => PERF_FLAG_LABELS[k] || k).join(' and ');
            throw new Error(
                `Cannot calibrate ${workflowId}: the ComfyUI it would run on was started with ${names}, `
                + `which this workflow lists as incompatible — the run would produce black output and the `
                + `timing would be meaningless. Stop serving and calibrate from admin mode (which relaunches `
                + `ComfyUI without it), or open a lane for this workflow.`);
        }

        const benchJobId = `bench-${workflowId}-${Date.now()}`;
        // ★ What the staged copies are namespaced by. The uploader keeps only the
        // first 8 characters of it, so `bench-${workflowId}` gave every image_*
        // bundle the same namespace (`comfyq__bench-im__…`), and one run's cleanup
        // could delete another's inputs — a second ComfyQ process (the suite CLI)
        // stages into the same folder. A random token keeps them this run's own.
        const stageId = `b${crypto.randomBytes(4).toString('hex').slice(0, 7)}`;

        try {
            // Inside the try, so a refused input still cleans up what was staged.
            console.log(`[Benchmark] ${workflowId}: preparing calibration inputs…`);
            const paramValues = this._buildCalibrationParams(entry, stageId, opts.params || null, opts.mediaNotes || null,
                { worker, inputRoots: opts.inputRoots || [], reproducible: !!opts.reproducible });
            // ★ A reproducible run keeps the graph's hidden seeds: they are what a
            // booking gets, so an example's settings give back the same pixels.
            // Randomised, they were recorded nowhere and could not be repeated.
            const { wf, seedsRandomized: literalSeeds } = opts.reproducible
                ? { wf: JSON.parse(JSON.stringify(entry.apiWorkflow)), seedsRandomized: 0 }
                : this._randomizeSeeds(entry.apiWorkflow);
            // …plus the exposed seeds _buildCalibrationParams replaced on a field the
            // literal pass does not touch (a primitive's `value`, `sampling_mode.seed`),
            // or the report reads "0 seeds randomized" for a run that was cache-proof.
            const seedsRandomized = literalSeeds + entry.effective.exposedParameters.filter(p => isSeedParam(p)
                && !(typeof entry.apiWorkflow?.[p.nodeId]?.inputs?.[p.field] === 'number' && /seed$/i.test(p.field))).length;
            // ★ What this run was actually fed, kept on the service for a caller that
            // wants to show it. runtime.json is the wrong home for a prompt and a set of
            // asset paths — it is committed per bundle and read by the scheduler — so
            // this stays in memory and the library sweep copies what it needs.
            this.lastRun = {
                workflowId,
                paramValues: { ...paramValues },
                media: { ...(this._lastMedia || {}) },
                // Which values a test suite chose, so the report can say so rather
                // than calling them "calibration" defaults.
                suiteKeys: Object.keys(opts.params || {}),
                seedsRandomized,
                startedAt: new Date().toISOString(),
            };

            // Evict everything first so the run pays the full model-load cost,
            // exactly like the first job after a fresh start (→ coldDurationSec).
            try {
                await worker.rest.free({ unloadModels: true, freeMemory: true });
            } catch (e) {
                console.warn(`[Benchmark] pre-run /free failed (continuing): ${e.message}`);
            }
            // …and wait for the card to actually give the memory back. /free
            // returns as soon as it has asked, so without this both the model
            // load time and the VRAM baseline are measured against the previous
            // run's weights.
            await this._waitForVramSettle({ worker });
            console.log(`[Benchmark] ${workflowId}: timed run (load models → generate; ${seedsRandomized} seed(s) randomized to avoid the result cache)…`);
            // Watch VRAM for the length of the run. This is the only honest
            // figure for a pipeline whose models aren't named as files in the
            // graph (LivePortrait's pack loads its weights by a path built in
            // code, and the 3d_mesh_* tools name no model), and it is what
            // decides whether two workflows can be served side by side on one
            // card.
            const vram = this._watchVram({ worker });
            // stop() in a finally, or a run that throws leaves the 2 s poller
            // running for the life of the server — one more every time a
            // calibration fails.
            let run, vramPeak;
            try {
                run = await this._runOnce(entry, wf, paramValues, `${benchJobId}-run`, worker);
            } finally {
                vramPeak = await vram.stop();
            }

            // Split the single run. If the workflow emits no sampler progress at
            // all (firstStepAt stays null), treat the whole run as generation.
            const genStart = run.firstStepAt || run.startedAt;
            const coldMs = run.durationMs;                           // first-time, incl. load
            const generationMs = Math.max(0, run.finishedAt - genStart); // recurring / warm
            const modelLoadMs = Math.max(0, genStart - run.startedAt);
            const samplePhaseMs = (run.firstStepAt && run.lastStepAt && run.stepsDone > 1)
                ? run.lastStepAt - run.firstStepAt
                : 0;
            const samplesPerSec = (samplePhaseMs > 0 && run.stepsDone > 1)
                ? (run.stepsDone - 1) / (samplePhaseMs / 1000)
                : null;

            // Capture the GPU that produced these numbers (best-effort).
            let gpu = null;
            try {
                const stats = await worker.rest.ping();
                const dev = (stats?.devices || []).find(d => d?.type === 'cuda') || stats?.devices?.[0];
                if (dev?.name) gpu = String(dev.name).replace(/^cuda:\d+\s+/i, '').trim();
            } catch (e) {
                console.warn(`[Benchmark] could not capture GPU info: ${e.message}`);
            }

            const runtime = keepHighestVram({
                schemaVersion: 1,
                calibratedAt: new Date().toISOString(),
                // estimatedDurationSec drives the timeline → the warm/recurring cost
                // (generation only, models already resident).
                estimatedDurationSec: Math.max(1, Math.round(generationMs / 1000)),
                warmDurationSec: Math.max(1, Math.round(generationMs / 1000)),
                coldDurationSec: Math.max(1, Math.round(coldMs / 1000)),  // first run, incl. model load
                modelLoadSec: Math.round(modelLoadMs / 1000),
                samplesPerSec,
                steps: run.stepsTotal || 0,
                durationMs: coldMs,
                gpu,
                // What it actually took on the card: this lane's own peak, and
                // what it still held a few seconds after finishing (what a
                // second workflow would have to fit beside). Null when ComfyUI
                // didn't report device memory.
                vramPeakGb: vramPeak.peakGb,
                vramTorchPeakGb: vramPeak.torchPeakGb,
                vramResidentGb: vramPeak.residentGb,
                vramCardPeakGb: vramPeak.cardPeakGb,
                source: 'benchmark'
            }, entry.runtime, entry.apiWorkflow);
            this.registry.writeRuntime(workflowId, runtime);
            console.log(`[Benchmark] ${workflowId}: first run ${runtime.coldDurationSec}s = model-load ~${runtime.modelLoadSec}s + generation ~${runtime.estimatedDurationSec}s${gpu ? ` · ${gpu}` : ''}`);
            if (runtime.vramPeakGb) {
                console.log(`[Benchmark] ${workflowId}: VRAM peak ${runtime.vramPeakGb} GB, still resident after the run ${runtime.vramResidentGb} GB`);
            }
            return runtime;
        } finally {
            // Remove the namespaced asset copies we staged into ComfyUI/input.
            try { worker.uploader.cleanupJob(stageId); } catch { /* ignore */ }
        }
    }
}

// Lane admission reads vramPeakGb, and a peak depends on the input and on what
// was already on the card: SeedVR2-3B measured 12.64 GB, then 8.31 GB on a later
// run, and the lower figure admitted a pairing measured at 30.17 of 30 GB usable.
// So the figure only goes up while the graph is the same; a changed graph starts
// again. A runtime.json from before this has no hash and keeps its higher figure,
// which is the safe direction. vramLastPeakGb is what this run really measured.
function keepHighestVram(runtime, prev, apiWorkflow) {
    const vramGraph = crypto.createHash('sha1').update(JSON.stringify(apiWorkflow || {})).digest('hex').slice(0, 12);
    const out = { ...runtime, vramLastPeakGb: runtime.vramPeakGb ?? null, vramGraph };
    const comparable = prev?.vramPeakGb && (!prev.vramGraph || prev.vramGraph === vramGraph);
    if (comparable && !(runtime.vramPeakGb >= prev.vramPeakGb)) out.vramPeakGb = prev.vramPeakGb;
    return out;
}

module.exports = { BenchmarkService, isSeedParam, keepHighestVram };
