const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

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
    audio: ['.mp3', '.wav', '.flac', '.ogg', '.m4a', '.aac']
};
// Skip tiny thumbnails / depth maps when picking an image so we don't feed a
// degenerate 12×12 px file into a workflow that derives latent size from it.
const IMAGE_MIN_BYTES = 50 * 1024;

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
    constructor({ worker, registry, comfyConfig, assetsDir }) {
        this.worker = worker;
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

    // Pick a file from the assets dir matching `type` (image|video|audio).
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
        // Smallest video/audio = fastest to decode; content is irrelevant to timing.
        return cands[0].full;
    }

    // Stage the assets each image/video/audio input needs into ComfyUI/input and
    // return the paramValues map (basenames the Load* nodes will read). Reuses
    // the worker's InputUploader so the copies are namespaced + sweepable.
    _buildCalibrationParams(entry, benchJobId) {
        const paramValues = { ...(entry.meta.warmupParams || {}) };
        for (const p of entry.effective.exposedParameters) {
            if (paramValues[p.key] !== undefined && paramValues[p.key] !== '') continue;
            if (!['image', 'video', 'audio', 'mask'].includes(p.type)) continue;
            const asset = this._resolveAsset(p.type);
            if (asset) {
                const rec = this.worker.uploader.copy({
                    jobId: benchJobId, paramKey: p.key,
                    originalName: path.basename(asset), source: asset
                });
                paramValues[p.key] = rec.comfyFilename;
                console.log(`[Benchmark]   ${p.type} input "${p.key}" ← ${path.basename(asset)}`);
            } else if (p.type === 'image' || p.type === 'mask') {
                paramValues[p.key] = this._ensureCalibrationImage();
                console.log(`[Benchmark]   ${p.type} input "${p.key}" ← built-in reference PNG (no asset found)`);
            } else {
                throw new Error(`Cannot calibrate: no ${p.type} asset available for input "${p.key}". Add a ${p.type} file to the assets dir (${this.assetsDir || 'not configured'}) or set meta.warmupParams.`);
            }
        }
        // Randomize any EXPOSED seed param so the run can't hit ComfyUI's result
        // cache — this covers seeds that live in a connected primitive node
        // (field `value`) which `_randomizeSeeds` (literal `*seed` fields) misses.
        // Overrides a warmupParams seed on purpose; calibration must always run.
        for (const p of entry.effective.exposedParameters) {
            const k = String(p.key || '').toLowerCase();
            const f = String(p.field || '').toLowerCase();
            if (k === 'seed' || k.endsWith('_seed') || f === 'seed' || f.endsWith('_seed')) {
                paramValues[p.key] = Math.floor(Math.random() * 0x7fffffff);
            }
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
    async _runOnce(entry, apiWorkflow, paramValues, runId) {
        let stepsDone = 0, stepsTotal = 0, firstStepAt = null, lastStepAt = null;
        let resolveDone, rejectDone;
        const donePromise = new Promise((res, rej) => { resolveDone = res; rejectDone = rej; });
        const onProgress = ({ stepsDone: d, stepsTotal: t }) => {
            if (firstStepAt == null) firstStepAt = Date.now();
            lastStepAt = Date.now();
            stepsDone = d; stepsTotal = t;
        };
        const onFinished = () => resolveDone();
        const onFailed = ({ errorReason }) => rejectDone(new Error(errorReason || 'benchmark-failed'));
        this.worker.on('progress', onProgress);
        this.worker.on('execution-finished', onFinished);
        this.worker.on('failed', onFailed);

        const startedAt = Date.now();
        try {
            await this.worker.submit(runId, apiWorkflow, {
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
            this.worker.finalize({ success: true });
            const finishedAt = Date.now();
            return { durationMs: finishedAt - startedAt, startedAt, finishedAt, firstStepAt, lastStepAt, stepsDone, stepsTotal };
        } catch (e) {
            // Release the worker so the next run (or a later job) can submit.
            try { this.worker.finalize({ success: false }); } catch { /* ignore */ }
            throw e;
        } finally {
            this.worker.off('progress', onProgress);
            this.worker.off('execution-finished', onFinished);
            this.worker.off('failed', onFailed);
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
    // cost by subtracting the measured load phase. Inputs (image/video/audio) are
    // auto-supplied from the assets dir, so no upload or warmupParams is required.
    async calibrate(workflowId) {
        const entry = this.registry.get(workflowId);
        if (!entry || entry.unavailable) {
            throw new Error(`Cannot calibrate unavailable workflow: ${workflowId}`);
        }
        if (this.worker.getStatus().state !== 'idle') {
            throw new Error('Worker is busy; calibrate after queue drains');
        }

        const benchJobId = `bench-${workflowId}-${Date.now()}`;
        console.log(`[Benchmark] ${workflowId}: preparing calibration inputs…`);
        const paramValues = this._buildCalibrationParams(entry, benchJobId);
        const { wf, seedsRandomized } = this._randomizeSeeds(entry.apiWorkflow);

        try {
            // Evict everything first so the run pays the full model-load cost,
            // exactly like the first job after a fresh start (→ coldDurationSec).
            try {
                await this.worker.rest.free({ unloadModels: true, freeMemory: true });
            } catch (e) {
                console.warn(`[Benchmark] pre-run /free failed (continuing): ${e.message}`);
            }
            console.log(`[Benchmark] ${workflowId}: timed run (load models → generate; ${seedsRandomized} seed(s) randomized to avoid the result cache)…`);
            const run = await this._runOnce(entry, wf, paramValues, `${benchJobId}-run`);

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
                const stats = await this.worker.rest.ping();
                const dev = (stats?.devices || []).find(d => d?.type === 'cuda') || stats?.devices?.[0];
                if (dev?.name) gpu = String(dev.name).replace(/^cuda:\d+\s+/i, '').trim();
            } catch (e) {
                console.warn(`[Benchmark] could not capture GPU info: ${e.message}`);
            }

            const runtime = {
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
                source: 'benchmark'
            };
            this.registry.writeRuntime(workflowId, runtime);
            console.log(`[Benchmark] ${workflowId}: first run ${runtime.coldDurationSec}s = model-load ~${runtime.modelLoadSec}s + generation ~${runtime.estimatedDurationSec}s${gpu ? ` · ${gpu}` : ''}`);
            return runtime;
        } finally {
            // Remove the namespaced asset copies we staged into ComfyUI/input.
            try { this.worker.uploader.cleanupJob(benchJobId); } catch { /* ignore */ }
        }
    }
}

module.exports = { BenchmarkService };
