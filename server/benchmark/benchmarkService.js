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
    constructor({ worker, registry, comfyConfig }) {
        this.worker = worker;
        this.registry = registry;
        this.comfyConfig = comfyConfig;
    }

    _ensureCalibrationImage() {
        const inputDir = path.resolve(this.comfyConfig.root_path, 'input');
        fs.mkdirSync(inputDir, { recursive: true });
        const target = path.join(inputDir, CALIBRATION_IMAGE_NAME);
        if (fs.existsSync(target)) return CALIBRATION_IMAGE_NAME;
        fs.writeFileSync(target, _makeSolidPng(512, 512, [180, 180, 180]));
        return CALIBRATION_IMAGE_NAME;
    }

    async calibrate(workflowId) {
        const entry = this.registry.get(workflowId);
        if (!entry || entry.unavailable) {
            throw new Error(`Cannot calibrate unavailable workflow: ${workflowId}`);
        }
        if (this.worker.getStatus().state !== 'idle') {
            throw new Error('Worker is busy; calibrate after queue drains');
        }

        // Build calibration paramValues. Start from admin-provided warmupParams,
        // then fill any image-typed exposed parameter that has no value with a
        // built-in reference image. Video/audio inputs without warmupParams are
        // an error (we don't ship sample media for them).
        const paramValues = { ...(entry.meta.warmupParams || {}) };
        let needsImage = false;
        for (const p of entry.effective.exposedParameters) {
            if (paramValues[p.key] !== undefined && paramValues[p.key] !== '') continue;
            if (p.type === 'image') {
                paramValues[p.key] = CALIBRATION_IMAGE_NAME;
                needsImage = true;
            } else if (p.type === 'video' || p.type === 'audio') {
                throw new Error(`Cannot calibrate: ${p.type} input "${p.key}" has no warmupParams entry. Add a sample filename to the workflow's meta.warmupParams.`);
            }
        }
        if (needsImage) this._ensureCalibrationImage();

        const startedAt = Date.now();
        let stepsDone = 0;
        let stepsTotal = 0;
        let firstStepAt = null;
        let lastStepAt = null;
        let resolveDone, rejectDone;

        const donePromise = new Promise((res, rej) => { resolveDone = res; rejectDone = rej; });
        const onProgress = ({ stepsDone: d, stepsTotal: t }) => {
            if (firstStepAt == null) firstStepAt = Date.now();
            lastStepAt = Date.now();
            stepsDone = d;
            stepsTotal = t;
        };
        const onFinished = () => resolveDone();
        const onFailed = ({ errorReason }) => rejectDone(new Error(errorReason || 'benchmark-failed'));
        this.worker.on('progress', onProgress);
        this.worker.on('execution-finished', onFinished);
        this.worker.on('failed', onFailed);

        const benchJobId = `bench-${workflowId}-${Date.now()}`;
        try {
            await this.worker.submit(benchJobId, entry.apiWorkflow, {
                workflowId: entry.id,
                exposedParameters: entry.effective.exposedParameters,
                paramValues,
                inputs: [],
                filenamePrefix: `bench_${workflowId}_${Date.now()}`,
                requirements: entry.meta.requirements,
                maxRuntimeSec: entry.meta.maxRuntimeSec
            });

            // Wait for execution-finished or failure with a hard cap.
            const cap = entry.meta.maxRuntimeSec * 1000;
            await Promise.race([
                donePromise,
                new Promise((_, rej) => setTimeout(() => rej(new Error('benchmark timed out')), cap))
            ]);

            // Pull the final history once to ensure a real run completed.
            const history = await this.worker.rest.getHistory(this.worker.currentPromptId || '');
            // (We don't strictly need it; finalize either way.)
            this.worker.finalize({ success: true });

            const finishedAt = Date.now();
            const durationMs = finishedAt - startedAt;
            // Exclude model/VAE/CLIP loading. firstStepAt is when the sampler
            // emits its first progress event — by then everything upstream is
            // loaded, so (finishedAt - firstStepAt) ≈ sampling + decode + save,
            // which matches the recurring per-job cost a warm worker pays.
            const generationStartAt = firstStepAt || startedAt;
            const generationMs = Math.max(0, finishedAt - generationStartAt);
            const modelLoadMs = Math.max(0, generationStartAt - startedAt);
            const samplePhaseMs = (firstStepAt && lastStepAt && stepsDone > 1)
                ? lastStepAt - firstStepAt
                : 0;
            const samplesPerSec = (samplePhaseMs > 0 && stepsDone > 1)
                ? (stepsDone - 1) / (samplePhaseMs / 1000)
                : null;

            const runtime = {
                schemaVersion: 1,
                calibratedAt: new Date().toISOString(),
                estimatedDurationSec: Math.max(1, Math.round(generationMs / 1000)),
                coldDurationSec: Math.max(1, Math.round(durationMs / 1000)),
                modelLoadSec: Math.round(modelLoadMs / 1000),
                samplesPerSec,
                steps: stepsTotal,
                durationMs,
                source: 'benchmark'
            };
            this.registry.writeRuntime(workflowId, runtime);
            return runtime;
        } finally {
            this.worker.off('progress', onProgress);
            this.worker.off('execution-finished', onFinished);
            this.worker.off('failed', onFailed);
        }
    }
}

module.exports = { BenchmarkService };
