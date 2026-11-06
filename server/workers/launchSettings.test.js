// A reused ComfyUI against the settings it would be started with now.
//
// Run with:  node server/workers/launchSettings.test.js

const assert = require('assert');
const os = require('os');
const path = require('path');
const { runningLaunch, launchDrift } = require('./launchSettings');
const { LocalComfyUIWorker } = require('./localComfyUIWorker');

let fails = 0;
async function test(name, fn) {
    try { await fn(); console.log(`  ok   ${name}`); }
    catch (e) { console.error(`  FAIL ${name}\n       ${e.message}`); fails++; }
}

// The rig's own argv on 2026-11-05, as /system_stats reported it.
const ROOT = 'J:\\ComfyUI_windows_portable_nvidia\\ComfyUI_windows_portable\\ComfyUI';
const argv = (...extra) => [`${ROOT}\\main.py`, '--listen', '0.0.0.0', '--port', '8188',
    '--disable-auto-launch', '--windows-standalone-build', ...extra];
const want = (o = {}) => ({ use_sage_attention: false, fp16_accumulation: true, bindHost: '0.0.0.0', rootPath: ROOT, ...o });

(async () => {
    await test('the rig as it runs today matches its settings: nothing to restart', () => {
        assert.deepStrictEqual(launchDrift(want(), runningLaunch(argv('--fast', 'fp16_accumulation'))), []);
    });

    await test('Sage on in the process, off for this lane: a difference that BREAKS output', () => {
        const d = launchDrift(want(), runningLaunch(argv('--use-sage-attention', '--fast', 'fp16_accumulation')));
        assert.strictEqual(d.length, 1);
        assert.strictEqual(d[0].key, 'use_sage_attention');
        assert.strictEqual(d[0].breaks, true);
    });

    await test('Sage off in the process, on for this lane (turned on since, or after a masked workflow): applied, not breaking', () => {
        const d = launchDrift(want({ use_sage_attention: true }), runningLaunch(argv('--fast', 'fp16_accumulation')));
        assert.strictEqual(d.length, 1);
        assert.strictEqual(d[0].key, 'use_sage_attention');
        assert.strictEqual(d[0].breaks, false);
        assert.match(d[0].text, /without Sage attention, and this lane runs with it/);
    });

    await test('fp16 accumulation is read from "--fast fp16_accumulation" and from a bare --fast', () => {
        assert.strictEqual(runningLaunch(argv('--fast', 'fp16_accumulation')).flags.fp16_accumulation, true);
        assert.strictEqual(runningLaunch(argv('--fast')).flags.fp16_accumulation, true);
        assert.strictEqual(runningLaunch(argv()).flags.fp16_accumulation, false);
        const d = launchDrift(want({ fp16_accumulation: false }), runningLaunch(argv('--fast', 'fp16_accumulation')));
        assert.deepStrictEqual(d.map(x => [x.key, x.breaks]), [['fp16_accumulation', true]]);
    });

    await test('LAN access: loopback against "expose to the LAN", both ways', () => {
        const local = [`${ROOT}\\main.py`, '--listen', '127.0.0.1', '--port', '8188', '--fast', 'fp16_accumulation'];
        const d1 = launchDrift(want(), runningLaunch(local));
        assert.deepStrictEqual(d1.map(x => [x.key, x.breaks]), [['lan_access', false]]);
        const d2 = launchDrift(want({ bindHost: '127.0.0.1' }), runningLaunch(argv('--fast', 'fp16_accumulation')));
        assert.deepStrictEqual(d2.map(x => x.key), ['lan_access']);
    });

    await test('--listen with no value is ComfyUI\'s "0.0.0.0,::"; no --listen is loopback', () => {
        assert.strictEqual(runningLaunch([`${ROOT}\\main.py`, '--listen', '--port', '8188']).bind, '0.0.0.0,::');
        assert.strictEqual(runningLaunch([`${ROOT}\\main.py`, '--port', '8188']).bind, '127.0.0.1');
        assert.deepStrictEqual(launchDrift(want({ fp16_accumulation: false }),
            runningLaunch([`${ROOT}\\main.py`, '--listen', '--port', '8188'])), []);
    });

    await test('another install is a difference; the same install spelled differently is not', () => {
        const other = ['D:\\Other\\ComfyUI\\main.py', '--listen', '0.0.0.0', '--fast', 'fp16_accumulation'];
        assert.deepStrictEqual(launchDrift(want(), runningLaunch(other)).map(x => x.key), ['root_path']);
        if (process.platform === 'win32') {
            const sameish = [`${ROOT.toLowerCase()}\\main.py`, '--listen', '0.0.0.0', '--fast', 'fp16_accumulation'];
            assert.deepStrictEqual(launchDrift(want({ rootPath: ROOT + '\\' }), runningLaunch(sameish)), []);
        }
    });

    await test('a relative main.py says nothing about the install, and no argv means nothing to compare', () => {
        assert.strictEqual(runningLaunch(['main.py', '--listen', '0.0.0.0']).root, null);
        assert.strictEqual(runningLaunch(undefined), null);
        assert.strictEqual(runningLaunch([]), null);
        assert.deepStrictEqual(launchDrift(want(), null), []);
    });

    // ---- The worker's decision: who may be relaunched for what -------------
    // The transport is stubbed: no test may reach a ComfyUI on this machine,
    // and the kill on the port never runs netstat or taskkill.
    //   relaunched  the argv that answers after the relaunch — by default a
    //               ComfyUI started with exactly these settings; pass the old
    //               argv to play a kill that was refused.
    const makeWorker = ({ cfg = {}, running, owned, relaunched }) => {
        const settings = { use_sage_attention: false, fp16_accumulation: true, ...cfg };
        const w = new LocalComfyUIWorker({
            comfyConfig: {
                api_host: '127.0.0.1', api_port: 59917, lan_access: true,
                root_path: ROOT, python_executable: path.join(os.tmpdir(), 'python.exe'),
                ...settings,
            },
            queueConfig: { inputRetentionMinutes: 30 },
        });
        const fresh = relaunched || argv(...(settings.use_sage_attention ? ['--use-sage-attention'] : []),
            ...(settings.fp16_accumulation ? ['--fast', 'fp16_accumulation'] : []));
        let answering = running;
        const calls = [];
        w.rest.ping = async () => ({ system: { argv: answering } });
        Object.defineProperty(w.process, 'owned', { get: () => owned });
        w.process.stop = async () => { calls.push('stop'); };
        w._killOnPort = async (port) => { calls.push(`kill ${port}`); };
        w._waitForPortFree = async () => true;
        w.start = async () => {
            calls.push(`start: ${w.process.nextStartReason}`);
            // A launch consumes the reason, as ComfyProcess.start() does.
            if (!relaunched) w.process.nextStartReason = 'start';
            answering = fresh;
            return {};
        };
        return { w, calls };
    };

    await test('worker: nothing differs → nothing restarts', async () => {
        const { w, calls } = makeWorker({ running: argv('--fast', 'fp16_accumulation'), owned: true });
        const r = await w.ensureLaunchSettings();
        assert.strictEqual(r.replaced, false);
        assert.deepStrictEqual(calls, []);
    });

    await test('worker: a speed-up turned on since → a ComfyUI ComfyQ started is relaunched, and says why', async () => {
        const { w, calls } = makeWorker({ cfg: { use_sage_attention: true }, running: argv('--fast', 'fp16_accumulation'), owned: true });
        const r = await w.ensureLaunchSettings();
        assert.strictEqual(r.replaced, true);
        assert.strictEqual(calls[0], 'stop');
        assert.match(calls[1], /^start: relaunched because it was started without Sage attention/);
        assert.ok(!calls.some(c => c.startsWith('kill')), 'a ComfyUI ComfyQ owns is stopped, not killed by port');
    });

    await test('worker: the same difference on a ComfyUI started by hand → left alone', async () => {
        const { w, calls } = makeWorker({ cfg: { use_sage_attention: true }, running: argv('--fast', 'fp16_accumulation'), owned: false });
        const r = await w.ensureLaunchSettings();
        assert.strictEqual(r.replaced, false);
        assert.strictEqual(r.drift.length, 1);
        assert.deepStrictEqual(calls, []);
    });

    // A lane that found its own user directory in the argv has proved the
    // ComfyUI is ComfyQ's, though the worker has no PID record of it. Without
    // the option it was left alone as hand-started, and never got new settings.
    await test('worker: proved ours with no PID record → relaunched, killed by port', async () => {
        const { w, calls } = makeWorker({ cfg: { use_sage_attention: true }, running: argv('--fast', 'fp16_accumulation'), owned: false });
        const r = await w.ensureLaunchSettings({ ours: true });
        assert.strictEqual(r.replaced, true);
        assert.strictEqual(calls[0], 'kill 59917');
        assert.match(calls[1], /^start: relaunched because it was started without Sage attention/);
        assert.strictEqual(calls.length, 2);
    });

    await test('worker: a flag that breaks output → relaunched even when it was started by hand', async () => {
        const { w, calls } = makeWorker({ running: argv('--use-sage-attention', '--fast', 'fp16_accumulation'), owned: false });
        const r = await w.ensureLaunchSettings();
        assert.strictEqual(r.replaced, true);
        assert.strictEqual(calls[0], 'kill 59917');
        assert.match(calls[1], /^start: relaunched because it was started with Sage attention, and this lane runs without it/);
        assert.strictEqual(calls.length, 2);
    });

    // ★ A refused taskkill used to end in replaced:true while the lane went on
    // serving the old process — the one that saves black images.
    await test('worker: the old ComfyUI survives the kill → the lane refuses, and the reason does not leak', async () => {
        const old = argv('--use-sage-attention', '--fast', 'fp16_accumulation');
        const { w } = makeWorker({ running: old, owned: false, relaunched: old });
        await assert.rejects(w.ensureLaunchSettings(), /could not stop the ComfyUI on port 59917 \(it was started with Sage attention/);
        assert.strictEqual(w.process.nextStartReason, 'start');
    });

    await test('worker: a setting that could not be applied is reported as not replaced, not as done', async () => {
        const old = argv('--fast', 'fp16_accumulation');
        const { w } = makeWorker({ cfg: { use_sage_attention: true }, running: old, owned: true, relaunched: old });
        const r = await w.ensureLaunchSettings();
        assert.strictEqual(r.replaced, false);
        assert.deepStrictEqual(r.drift.map(d => d.key), ['use_sage_attention']);
        assert.strictEqual(w.process.nextStartReason, 'start');
    });

    await test('worker: a ComfyUI of another install started by hand → refused, and not killed', async () => {
        const other = [path.join(os.tmpdir(), 'another-install', 'main.py'), '--listen', '0.0.0.0', '--fast', 'fp16_accumulation'];
        const { w, calls } = makeWorker({ running: other, owned: false });
        await assert.rejects(w.ensureLaunchSettings(), (e) => {
            assert.match(e.message, /another-install/);
            assert.match(e.message, /change the port/);
            assert.strictEqual(e.noRetry, true, 'retrying cannot help');
            return true;
        });
        assert.deepStrictEqual(calls, []);
    });

    await test('worker: another install with a flag that breaks output → still refused, not killed', async () => {
        const other = [path.join(os.tmpdir(), 'another-install', 'main.py'), '--listen', '0.0.0.0', '--use-sage-attention'];
        const { w, calls } = makeWorker({ running: other, owned: false });
        await assert.rejects(w.ensureLaunchSettings(), /another-install/);
        assert.deepStrictEqual(calls, []);
    });

    await test('worker: another install that ComfyQ started → relaunched from the configured one', async () => {
        const other = [path.join(os.tmpdir(), 'another-install', 'main.py'), '--listen', '0.0.0.0', '--fast', 'fp16_accumulation'];
        const { w, calls } = makeWorker({ running: other, owned: true });
        const r = await w.ensureLaunchSettings();
        assert.strictEqual(r.replaced, true);
        assert.strictEqual(calls[0], 'stop');
    });

    await test('worker: ComfyUI not answering → nothing compared, nothing restarted', async () => {
        const { w, calls } = makeWorker({ running: null, owned: true });
        w.rest.ping = async () => { throw new Error('ECONNREFUSED'); };
        const r = await w.ensureLaunchSettings();
        assert.strictEqual(r.replaced, false);
        assert.deepStrictEqual(calls, []);
    });

    if (fails) { console.error(`\n${fails} failing`); process.exit(1); }
    console.log('\nlaunchSettings: all passed');
})();
