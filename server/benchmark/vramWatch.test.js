/**
 * The VRAM watcher's baseline, which is what decides whether two workflows can
 * be served side by side on one card — and the guards around a calibration run.
 *
 * Regression: calibrating the FastVideo i2v straight after its t2v sibling
 * reported 8.79 GB against a 31.14 GB card peak — ComfyUI answers /free with a
 * 200 while the previous run's weights are still resident, so the first sample
 * was taken against a card that still held ~22 GB. Under-reporting is the
 * direction that admits a lane which does not fit, so the floor is now the
 * LOWEST reading seen, not the first, and calibration waits for the card to
 * settle before the timed run.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { BenchmarkService, isSeedParam, keepHighestVram } = require('./benchmarkService');
const { AdminCalibrator } = require('./adminCalibrator');

// No test may reach a real service on this machine (AdminCalibrator asks a
// ComfyUI port for its extension list).
global.fetch = async () => { throw new Error('network blocked in tests'); };

const GB = 1024 ** 3;
let passed = 0;
function test(name, fn) {
    try { fn(); passed++; console.log(`  ok   ${name}`); }
    catch (e) { console.error(`  FAIL ${name}\n       ${e.message}`); process.exitCode = 1; }
}
async function atest(name, fn) {
    try { await fn(); passed++; console.log(`  ok   ${name}`); }
    catch (e) { console.error(`  FAIL ${name}\n       ${e.message}`); process.exitCode = 1; }
}

// A worker whose /system_stats walks a scripted list of card readings (GB).
// The last value repeats once the script runs out.
function stubService(cardGb, torchGb = []) {
    let i = 0;
    const worker = {
        rest: {
            ping: async () => {
                const card = cardGb[Math.min(i, cardGb.length - 1)];
                const mine = torchGb[Math.min(i, torchGb.length - 1)] || 0;
                i++;
                return {
                    devices: [{
                        type: 'cuda',
                        vram_total: 32 * GB, vram_free: (32 - card) * GB,
                        torch_vram_total: 32 * GB, torch_vram_free: (32 - mine) * GB,
                    }],
                };
            },
        },
    };
    const svc = new BenchmarkService({ worker, registry: null, comfyConfig: {}, assetsDir: '' });
    return { svc, reads: () => i };
}

// A worker for a whole calibrate() call: it records what it is asked to do.
function stubWorker({ state = 'idle', argv = [] } = {}) {
    const calls = { finalize: 0, copies: [], cleanup: [] };
    return {
        calls,
        currentJobId: null,
        getStatus() { return { state, currentJobId: this.currentJobId }; },
        rest: { ping: async () => ({ system: { argv } }), free: async () => {} },
        on() {}, off() {},
        finalize() { calls.finalize++; this.currentJobId = null; },
        uploader: {
            copy({ jobId, originalName }) {
                calls.copies.push(jobId);
                return { comfyFilename: `comfyq__${jobId.slice(0, 8)}__${originalName}` };
            },
            cleanupJob(jobId) { calls.cleanup.push(jobId); },
        },
    };
}
const FAKE_RUN = { durationMs: 10, startedAt: 0, finishedAt: 10, firstStepAt: null, lastStepAt: null, stepsDone: 0, stepsTotal: 0 };
const reachedRun = (e) => { assert.strictEqual(e.message, 'REACHED_RUN', `stopped before the run: ${e.message}`); return true; };

// A calibration that never settles leaves nothing pending, so node would exit 0
// halfway through the list. A run that did not reach its end is a failure.
let finished = false;
process.on('exit', () => {
    if (!finished) { console.error('  FAIL the checks never finished — a calibration hung'); process.exitCode = 1; }
});

const run = async () => {
    console.log('vramWatch:');

    await atest('a baseline left dirty by the previous run does not eat the footprint', async () => {
        // 22 GB still held at t0, released to 2 GB, then this run climbs to 31.
        const { svc } = stubService([22, 2, 12, 31, 31]);
        const w = svc._watchVram({ intervalMs: 5, settleMs: 1 });
        await new Promise(r => setTimeout(r, 40));
        const out = await w.stop();
        assert.ok(out.peakGb >= 28, `expected ~29 GB of growth, got ${out.peakGb}`);
        assert.strictEqual(out.cardPeakGb, 31);
    });

    await atest('a clean card measures growth from its own floor', async () => {
        const { svc } = stubService([2, 10, 18, 18]);
        const w = svc._watchVram({ intervalMs: 5, settleMs: 1 });
        await new Promise(r => setTimeout(r, 40));
        const out = await w.stop();
        assert.strictEqual(out.peakGb, 16, `2 GB floor to an 18 GB peak is 16, got ${out.peakGb}`);
    });

    await atest('torch wins when it holds more than the card grew', async () => {
        // A second lane frees while we run, so the card barely grows — but the
        // torch allocator says plainly what this process took.
        const { svc } = stubService([20, 20, 21], [0, 9, 9]);
        const w = svc._watchVram({ intervalMs: 5, settleMs: 1 });
        await new Promise(r => setTimeout(r, 40));
        const out = await w.stop();
        assert.strictEqual(out.peakGb, 9);
        assert.strictEqual(out.torchPeakGb, 9);
    });

    await atest('settle waits for the drop, then returns', async () => {
        const { svc, reads } = stubService([22, 14, 6, 2, 2, 2]);
        const t0 = Date.now();
        await svc._waitForVramSettle({ timeoutMs: 3000, intervalMs: 5, quietMs: 20 });
        assert.ok(Date.now() - t0 < 2500, 'should return well before the timeout');
        assert.ok(reads() >= 4, `should have watched it fall, only ${reads()} reads`);
    });

    await atest('settle gives up on a card that never drops', async () => {
        // A second lane holding a model resident never releases it; waiting for
        // that would hang every calibration on a two-lane machine.
        const { svc } = stubService([18]);
        const t0 = Date.now();
        await svc._waitForVramSettle({ timeoutMs: 2000, intervalMs: 5, quietMs: 20 });
        assert.ok(Date.now() - t0 < 1500, 'should stop waiting once it is quiet');
    });

    await atest('an unreachable ComfyUI does not stall the run', async () => {
        const worker = { rest: { ping: async () => { throw new Error('ECONNREFUSED'); } } };
        const svc = new BenchmarkService({ worker, registry: null, comfyConfig: {}, assetsDir: '' });
        await svc._waitForVramSettle({ timeoutMs: 2000, intervalMs: 5, quietMs: 20 });
        const w = svc._watchVram({ intervalMs: 5, settleMs: 1 });
        const out = await w.stop();
        assert.strictEqual(out.peakGb, null, 'nothing seen means no figure, not 0 GB');
    });

    // --- the gauge must not time a run it knows will be broken ----------------
    // These flags don't crash, they silently save black images. AdminCalibrator
    // relaunches ComfyUI without them first; the student-mode route reaches
    // calibrate() directly, on the ComfyUI already serving, so the refusal has
    // to live here.
    const stubFor = (disabledPerfFlags, argv) => {
        const worker = stubWorker({ argv });
        const registry = {
            get: () => ({
                unavailable: false,
                meta: { requirements: { disabledPerfFlags } },
                effective: { exposedParameters: [] },
                apiWorkflow: {},
            }),
        };
        const svc = new BenchmarkService({
            worker, registry, assetsDir: '',
            comfyConfig: { use_sage_attention: true, fp16_accumulation: true },
        });
        // ★ Everything past the guard is stubbed, so "reached the run" is the only
        // way through. Asserting merely "any error but the refusal" passed even
        // when the guard itself crashed — the exact TypeError it once had.
        svc._watchVram = () => ({ stop: async () => ({}) });
        svc._runOnce = async () => { throw new Error('REACHED_RUN'); };
        return svc;
    };

    await atest('refuses a workflow whose ComfyUI has a flag it cannot use', async () => {
        const svc = stubFor(['fp16_accumulation'], ['main.py', '--fast', 'fp16_accumulation']);
        await assert.rejects(() => svc.calibrate('seedvr2'), (e) => {
            assert.match(e.message, /fp16 accumulation/, 'names the offending flag');
            assert.match(e.message, /admin mode|lane/, 'says what to do about it');
            return true;
        });
    });

    await atest('sage is caught the same way', async () => {
        const svc = stubFor(['use_sage_attention'], ['main.py', '--use-sage-attention']);
        await assert.rejects(() => svc.calibrate('marigold'), /Sage attention/);
    });

    await atest('does not block a workflow that declares nothing', async () => {
        const svc = stubFor([], ['main.py', '--use-sage-attention', '--fast', 'fp16_accumulation']);
        await assert.rejects(() => svc.calibrate('anything'), reachedRun);
    });

    await atest('a flag that is off is not a blocker', async () => {
        // Sage declared off, and ComfyUI is running without it — nothing to do.
        const svc = stubFor(['use_sage_attention'], ['main.py', '--fast', 'fp16_accumulation']);
        await assert.rejects(() => svc.calibrate('marigold'), reachedRun);
    });

    // --- one calibration at a time -------------------------------------------
    console.log('calibration guards:');
    const plainRegistry = (params = []) => ({
        get: () => ({ unavailable: false, meta: {}, effective: { exposedParameters: params }, apiWorkflow: {} }),
        writeRuntime: () => {},
    });

    await atest('a second calibration while one runs is refused, and the first is left alone', async () => {
        // ★ Both used to pass the idle check (the worker stays idle through /free and
        // the settle wait); the loser's cleanup then reset the winner's run, which
        // waited out the two-hour timeout.
        const worker = stubWorker();
        const svc = new BenchmarkService({ worker, registry: plainRegistry(), comfyConfig: {}, assetsDir: '' });
        let release = null;
        svc._watchVram = () => ({ stop: async () => ({}) });
        svc._runOnce = () => new Promise(res => { release = () => res(FAKE_RUN); });
        const first = svc.calibrate('a');
        await assert.rejects(() => svc.calibrate('b'), /Another calibration is running \(a\)/);
        for (let i = 0; i < 100 && !release; i++) await new Promise(r => setTimeout(r, 5));
        assert.ok(release, 'the first calibration reached its run');
        release();
        const rt = await first;
        assert.strictEqual(rt.source, 'benchmark', 'the first calibration finished');
        assert.strictEqual(worker.calls.finalize, 0, 'the refused call reset nothing');
        svc._runOnce = async () => { throw new Error('REACHED_RUN'); };
        await assert.rejects(() => svc.calibrate('c'), reachedRun);
        await assert.rejects(() => svc.calibrate('d'), reachedRun);   // ...and a failed one releases it too
    });

    await atest('a submit refused because someone else holds the worker does not reset their run', async () => {
        const entry = { id: 'x', meta: {}, effective: { exposedParameters: [] } };
        const theirs = stubWorker({ state: 'busy' });
        theirs.currentJobId = 'student-job-1';
        theirs.submit = async () => { throw new Error('Worker not idle (state=busy)'); };
        const svc = new BenchmarkService({ worker: theirs, registry: null, comfyConfig: {}, assetsDir: '' });
        await assert.rejects(() => svc._runOnce(entry, {}, {}, 'bench-x-run'), /not idle/);
        assert.strictEqual(theirs.calls.finalize, 0, 'the student job is not finalized');
        // Our own run failing after the worker took it IS released.
        const ours = stubWorker();
        ours.submit = async (id) => { ours.currentJobId = id; throw new Error('/prompt rejected'); };
        await assert.rejects(() => svc._runOnce(entry, {}, {}, 'bench-x-run', ours), /rejected/);
        assert.strictEqual(ours.calls.finalize, 1, 'our own run is released');
    });

    await atest('each calibration stages its inputs under its own namespace, and cleans up only those', async () => {
        // ★ The uploader keeps 8 characters of the id: `bench-${id}` gave every
        // image_* bundle `comfyq__bench-im__…`, so one run's cleanup could delete
        // another's inputs.
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'comfyq-cal-'));
        fs.writeFileSync(path.join(dir, 'pick.png'), Buffer.alloc(100));
        const worker = stubWorker();
        const svc = new BenchmarkService({
            worker, comfyConfig: {}, assetsDir: dir,
            registry: plainRegistry([{ key: 'image', type: 'image', nodeId: '1', field: 'image' }]),
        });
        svc._watchVram = () => ({ stop: async () => ({}) });
        svc._runOnce = async () => { throw new Error('REACHED_RUN'); };
        await assert.rejects(() => svc.calibrate('image_one'), reachedRun);
        await assert.rejects(() => svc.calibrate('image_two'), reachedRun);
        const [a, b] = worker.calls.copies;
        assert.ok(a && b, 'both staged an input');
        assert.notStrictEqual(a.slice(0, 8), b.slice(0, 8), 'two runs never share a namespace');
        assert.deepStrictEqual(worker.calls.cleanup, [a, b], 'each run cleans up exactly what it staged');
        fs.rmSync(dir, { recursive: true, force: true });
    });

    await atest('a calibration on a lane leaves the service on its own worker, even when its inputs cannot be prepared', async () => {
        // ★ The lane's worker used to be swapped into this.worker and not swapped
        // back when preparing the inputs threw: later calibrations then ran on that
        // lane's ComfyUI, or were refused as busy once the lane closed.
        const main = stubWorker({ state: 'busy' });        // the main lane is serving a student
        const lane = stubWorker();
        const svc = new BenchmarkService({
            worker: main, comfyConfig: {}, assetsDir: '',
            registry: plainRegistry([{ key: 'clip', type: 'video', nodeId: '1', field: 'video' }]),
            lanes: { get: (id) => (id === 'laned' ? { worker: lane } : null) },
        });
        await assert.rejects(() => svc.calibrate('laned'), /no video asset available/);
        assert.strictEqual(svc.worker, main, 'the service still points at its own worker');
        assert.strictEqual(lane.calls.cleanup.length, 1, 'the lane\'s staged copies are cleaned up');
        await assert.rejects(() => svc.calibrate('not_laned'), /Worker is busy/, 'a workflow with no lane is gauged on the main worker');
    });

    await atest('a test-suite input that cannot be used stops the run instead of being swapped for a random file', async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'comfyq-suite-'));
        const assets = path.join(root, 'assets');
        const derivedDir = path.join(root, 'data', 'suite-inputs', 'run1');
        fs.mkdirSync(assets, { recursive: true });
        fs.mkdirSync(derivedDir, { recursive: true });
        fs.writeFileSync(path.join(assets, 'pick.png'), Buffer.alloc(100));
        const derived = path.join(derivedDir, 'edit__image.png');
        fs.writeFileSync(derived, Buffer.alloc(100));
        const elsewhere = path.join(root, 'elsewhere.png');
        fs.writeFileSync(elsewhere, Buffer.alloc(100));
        const worker = stubWorker();
        const svc = new BenchmarkService({ worker, registry: null, comfyConfig: {}, assetsDir: assets });
        const entry = { meta: {}, effective: { exposedParameters: [{ key: 'image', type: 'image', nodeId: '1', field: 'image' }] } };

        assert.throws(() => svc._buildCalibrationParams(entry, 'bsuite00', { image: `file:${derived}` }, null, { worker }),
            /never replaced with a random file/, 'a derived input outside the known folders is refused, not swapped');
        const ok = svc._buildCalibrationParams(entry, 'bsuite01', { image: `file:${derived}` }, null,
            { worker, inputRoots: [path.join(root, 'data', 'suite-inputs')] });
        assert.ok(ok.image.endsWith('edit__image.png'), 'a sweep run with its own data dir is allowed its derived inputs');
        assert.throws(() => svc._buildCalibrationParams(entry, 'bsuite02', { image: `file:${elsewhere}` }, null,
            { worker, inputRoots: [path.join(root, 'data', 'suite-inputs')] }), /outside the folders/);
        assert.throws(() => svc._buildCalibrationParams(entry, 'bsuite03', { image: 'asset:nope.png' }, null, { worker }),
            /"nope\.png", which is not in/);
        // warmupParams keep the automatic pick: a gauge with no suite still runs.
        const warm = { meta: { warmupParams: { image: 'asset:nope.png' } }, effective: entry.effective };
        assert.ok(svc._buildCalibrationParams(warm, 'bwarm000', null, null, { worker }).image.endsWith('pick.png'));
        fs.rmSync(root, { recursive: true, force: true });
    });

    test('every exposed seed is replaced, whatever node it sits on', () => {
        // ★ The 360 panorama's seed is a primitive (`seed_7` on `7.value`) and the
        // Gemma captioners' sits in a widget group (`sampling_mode.seed`): both were
        // missed, so the panorama could be calibrated from ComfyUI's cache and the
        // captioners ran the suite's seed 0 verbatim.
        const params = [
            { key: 'seed_7', type: 'number', nodeId: '7', field: 'value' },
            { key: 'seed_1', type: 'number', nodeId: '1', field: 'sampling_mode.seed' },
            { key: 'ksampler_seed_3', type: 'number', nodeId: '3', field: 'seed' },
            { key: 'noise', type: 'number', nodeId: '4', field: 'noise_seed' },
            { key: 'seed', type: 'number', nodeId: '5', field: 'value' },
        ];
        for (const p of params) assert.ok(isSeedParam(p), `${p.key} / ${p.field} is a seed`);
        // The shared list the client's copy of the rule should be tested against too.
        const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'seedParam.fixture.json'), 'utf8'));
        const asGiven = (p) => (p.keyOnly ? { key: p.key } : { key: p.key, field: p.field });
        for (const p of fixture.seeds) assert.ok(isSeedParam(asGiven(p)), `${p.key} / ${p.field || '(key only)'} is a seed`);
        for (const p of fixture.notSeeds) assert.ok(!isSeedParam(asGiven(p)), `${p.key} / ${p.field || '(key only)'} is not a seed`);
        const svc = new BenchmarkService({ worker: stubWorker(), registry: null, comfyConfig: {}, assetsDir: '' });
        const pv = svc._buildCalibrationParams({ meta: {}, effective: { exposedParameters: params } }, 'bseed000', { seed_1: 0 });
        for (const p of params) assert.strictEqual(typeof pv[p.key], 'number', `${p.key} was given a fresh seed`);
        assert.notStrictEqual(pv.seed_1, 0, 'the suite\'s seed 0 is not run verbatim');
    });

    test('the key alone says the same as key + field on every bundle', () => {
        // ★ A job record carries param keys, not fields: the ingredients zip and the
        // relaunch panel can only ask with the key, so the key rule must agree with
        // calibration's on every param the library exposes.
        const wfDir = path.join(__dirname, '..', '..', 'workflows');
        let seen = 0, seeds = 0;
        for (const id of fs.readdirSync(wfDir)) {
            if (id.startsWith('_')) continue;
            const metaPath = path.join(wfDir, id, `${id}.meta.json`);
            if (!fs.existsSync(metaPath)) continue;
            for (const p of JSON.parse(fs.readFileSync(metaPath, 'utf8')).exposedParameters || []) {
                seen++;
                const full = isSeedParam(p);
                if (full) seeds++;
                assert.strictEqual(isSeedParam({ key: p.key }), full, `${id}: ${p.key} (${p.field})`);
            }
        }
        assert.ok(seen > 0 && seeds > 0, 'the library was read');
    });

    await atest('the report counts a primitive seed among the ones randomized', async () => {
        // The panorama's row read "0 seeds randomized": its seed is a PrimitiveInt
        // linked into both samplers, which the literal pass never sees.
        const worker = stubWorker();
        const svc = new BenchmarkService({
            worker, comfyConfig: {}, assetsDir: '',
            registry: { get: () => ({
                unavailable: false, meta: {},
                effective: { exposedParameters: [{ key: 'seed_7', type: 'number', nodeId: '7', field: 'value' }] },
                apiWorkflow: { 7: { class_type: 'PrimitiveInt', inputs: { value: 360001 } }, 3: { class_type: 'KSampler', inputs: { seed: ['7', 0] } } },
            }) },
        });
        svc._watchVram = () => ({ stop: async () => ({}) });
        svc._runOnce = async () => { throw new Error('REACHED_RUN'); };
        await assert.rejects(() => svc.calibrate('image_qwen_image_2512_360_panorama'), reachedRun);
        assert.strictEqual(svc.lastRun.seedsRandomized, 1);
        assert.notStrictEqual(svc.lastRun.paramValues.seed_7, 360001, 'the graph\'s own seed is not what runs');
    });

    // --- AdminCalibrator must not restart ComfyUI under a running calibration --
    const makeCal = () => {
        const configManager = { load: () => ({ config: { comfy_ui: { api_port: 8199 }, queue: {}, assets: {} } }) };
        const cal = new AdminCalibrator({ configManager, registry: { get: () => null } });
        const stops = [];
        cal._stopWorker = async () => { stops.push(1); cal.worker = null; };
        cal._waitForPortFree = async () => true;
        cal._spawnSig = cal._pathSig(cal.comfyConfig);
        cal._spawnFlagSig = cal._flagSig(cal.comfyConfig);
        return { cal, stops };
    };

    await atest('a launch that would restart ComfyUI is refused while a calibration runs on it', async () => {
        // ★ A gauge click or a launch during a library sweep restarted ComfyUI
        // whenever the perf flags or the bind differed, and the sweep recorded a
        // bundle that was fine as FAILED.
        const { cal, stops } = makeCal();
        cal.worker = { getStatus: () => ({ state: 'busy' }) };   // loopback, so a network launch must rebind
        await assert.rejects(() => cal.launchBackend(), /running a calibration/);
        cal.worker = { getStatus: () => ({ state: 'idle' }) };   // between bundles, still claimed
        cal._calibrating = 'image_x';
        await assert.rejects(() => cal.launchBackend(), /calibration of image_x/);
        assert.strictEqual(stops.length, 0, 'nothing was stopped');
    });

    await atest('the calibration that holds the claim may restart for its own flags', async () => {
        const { cal, stops } = makeCal();
        cal.worker = { getStatus: () => ({ state: 'idle' }) };
        cal._calibrating = 'wf';
        cal._spawnFlagSig = 'sage=true|fp16acc=true';             // differs from what wf wants
        // No install configured, so the relaunch stops right after the restart.
        await assert.rejects(() => cal._ensureWorker({ workflowId: 'wf' }), /Configure the ComfyUI paths/);
        assert.strictEqual(stops.length, 1, 'it restarted');
    });

    await atest('a second calibration is refused before it can restart ComfyUI', async () => {
        const { cal, stops } = makeCal();
        cal._calibrating = 'a';
        await assert.rejects(() => cal.calibrate('b'), /Another calibration is running \(a\)/);
        assert.strictEqual(stops.length, 0);
        assert.strictEqual(cal._calibrating, 'a', 'the refused call does not release the other\'s claim');
    });

    await atest('while a library sweep holds the calibrator, only its own calls get through', async () => {
        // Between two sweep bundles nothing is running, so a gauge click there was
        // accepted and the sweep's next bundle then refused and recorded as FAILED.
        const { cal } = makeCal();
        const hold = cal.reserve('the library sweep');
        assert.throws(() => cal.reserve('another sweep'), /already using/);
        await assert.rejects(() => cal.calibrate('card_click'), /the library sweep is running/);
        // The sweep's own call passes the claim (and stops here: no install configured).
        await assert.rejects(() => cal.calibrate('bundle', { reservation: hold }), /Configure the ComfyUI paths/);
        assert.strictEqual(cal._calibrating, null, 'its claim is released after a failure');
        hold.release();
        await assert.rejects(() => cal.calibrate('card_click'), /Configure the ComfyUI paths/, 'released: anyone may calibrate again');
    });

    await atest('the opener restart waits for a calibration too', async () => {
        const { cal, stops } = makeCal();
        cal.worker = { getStatus: () => ({ state: 'idle' }) };
        cal._workerNetwork = true;                                 // already network-bound: no rebind
        cal._calibrating = 'image_x';
        await assert.rejects(() => cal.ensureOpenerLoaded(), /opener/);
        assert.strictEqual(stops.length, 0);
    });

    await atest('a worker whose ComfyUI died is shut down before it is replaced', async () => {
        // ★ It was overwritten instead, and its WebSocket client went on
        // reconnecting to the port for ever — one more per crash.
        const configManager = { load: () => ({ config: { comfy_ui: { api_port: 8199 }, queue: {}, assets: {} } }) };
        const cal = new AdminCalibrator({ configManager, registry: { get: () => null } });
        let shut = 0, stopped = 0;
        cal.worker = {
            getStatus: () => ({ state: 'down' }),
            shutdown: async () => { shut++; },
            process: { stop: async () => { stopped++; } },
        };
        await assert.rejects(() => cal.launchBackend(), /Configure the ComfyUI paths/);
        assert.strictEqual(shut, 1, 'its WebSocket was closed');
        assert.strictEqual(stopped, 1, 'and its (already exited) process told to stop');
        assert.strictEqual(cal.worker, null);
    });

    // The figure lane admission reads goes up, never down, on one graph.
    {
        const g = { 1: { class_type: 'A' } }, other = { 1: { class_type: 'B' } };
        const first = keepHighestVram({ vramPeakGb: 12.64 }, null, g);
        assert.strictEqual(first.vramPeakGb, 12.64);
        const lower = keepHighestVram({ vramPeakGb: 8.31 }, first, g);
        assert.strictEqual(lower.vramPeakGb, 12.64, 'a lower run must not lower the figure');
        assert.strictEqual(lower.vramLastPeakGb, 8.31, 'what the run measured stays visible');
        assert.strictEqual(keepHighestVram({ vramPeakGb: 14 }, first, g).vramPeakGb, 14);
        assert.strictEqual(keepHighestVram({ vramPeakGb: 8.31 }, first, other).vramPeakGb, 8.31, 'a changed graph starts again');
        assert.strictEqual(keepHighestVram({ vramPeakGb: 8.31 }, { vramPeakGb: 12.64 }, g).vramPeakGb, 12.64, 'a file from before the hash keeps its higher figure');
        assert.strictEqual(keepHighestVram({ vramPeakGb: null }, first, g).vramPeakGb, 12.64, 'a run with no reading keeps the figure');
        passed += 6;
    }

    finished = true;
    if (process.exitCode) console.error(`\nvramWatch: ${passed} checks passed, some FAILED`);
    else console.log(`\nvramWatch: all ${passed} checks passed`);
};

run();
