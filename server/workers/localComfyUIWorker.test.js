// LocalComfyUIWorker.cancel() — stop THIS job's prompt, nothing else.
//
// ★ cancel() used to POST a body-less /interrupt, which ComfyUI treats as
// "stop whatever is running". With LAN access on, that can be somebody else's
// run from the native UI, while the student's own prompt — still waiting
// behind it — stayed in ComfyUI's queue and ran later, after the worker had
// moved on to the next job.
//
// The transport is stubbed: no test may reach a ComfyUI on this machine.
//
// Run with:  node server/workers/localComfyUIWorker.test.js

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { LocalComfyUIWorker, clampParamValue } = require('./localComfyUIWorker');
const { ComfyRestClient } = require('./comfyRestClient');

let fails = 0;
async function test(name, fn) {
    try { await fn(); console.log(`  ok   ${name}`); }
    catch (e) { console.error(`  FAIL ${name}\n       ${e.message}`); fails++; }
}

// The worker's uploader creates <root>/input, so the root is a temp dir of
// this run's own, removed at the end — never a folder in the repo.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'comfyq-worker-'));

function makeWorker() {
    const w = new LocalComfyUIWorker({
        comfyConfig: { api_host: '127.0.0.1', api_port: 1, root_path: path.join(TMP, 'comfy') },
        queueConfig: { inputRetentionMinutes: 30 },
    });
    const posts = [];
    const refuse = async () => { throw new Error('no network in tests'); };
    w.rest.http = { get: refuse, post: async (url, body) => { posts.push([url, body]); return { data: {} }; } };
    return { w, posts };
}

(async () => {
    await test('a submitted job: its prompt is taken out of the queue, then interrupted by id', async () => {
        const { w, posts } = makeWorker();
        w.currentJobId = 'job-1';
        w.currentPromptId = 'prompt-1';
        const failed = [];
        w.on('failed', (e) => failed.push(e));
        assert.strictEqual(await w.cancel('job-1'), true);
        assert.deepStrictEqual(posts, [
            ['/queue', { delete: ['prompt-1'] }],
            ['/interrupt', { prompt_id: 'prompt-1' }],
        ]);
        assert.strictEqual(w.currentJobId, null);
        assert.strictEqual(failed[0].errorReason, 'cancelled');
    });

    await test('no prompt id yet: nothing is interrupted, the worker is released at once', async () => {
        const { w, posts } = makeWorker();
        w.currentJobId = 'job-1';
        assert.strictEqual(await w.cancel('job-1'), true);
        assert.deepStrictEqual(posts, []);
    });

    await test('another job id: not this worker\'s to cancel', async () => {
        const { w, posts } = makeWorker();
        w.currentJobId = 'job-1';
        w.currentPromptId = 'prompt-1';
        assert.strictEqual(await w.cancel('job-2'), false);
        assert.deepStrictEqual(posts, []);
        assert.strictEqual(w.currentJobId, 'job-1');
    });

    await test('ComfyUI refusing the calls does not stop the cancel', async () => {
        const { w } = makeWorker();
        w.rest.http.post = async () => { throw new Error('ECONNREFUSED'); };
        w.currentJobId = 'job-1';
        w.currentPromptId = 'prompt-1';
        assert.strictEqual(await w.cancel('job-1'), true);
        assert.strictEqual(w.currentJobId, null);
    });

    await test('the admin emergency stop still interrupts everything (no prompt id)', async () => {
        const rest = new ComfyRestClient({ host: '127.0.0.1', port: 1 });
        const posts = [];
        rest.http = { post: async (...a) => { posts.push(a); return { data: {} }; } };
        await rest.interrupt();
        assert.deepStrictEqual(posts, [['/interrupt']]);
    });

    // ★ A cancel can land while submit() is still waiting on ComfyUI (the job
    // shows as processing). cancel() resets the worker and fails the job; the
    // submit used to carry on regardless — queue the prompt, set it as the
    // idle worker's currentPromptId (so its events read as the NEXT job's) and
    // emit 'submitted' for a cancelled job.
    function readyForSubmit(w) {
        w._setState('idle');
        w.lifecycle.beforeJob = async () => ({ freed: false, reason: 'test' });
        const events = [];
        for (const t of ['submitted', 'failed']) w.on(t, (e) => events.push([t, e]));
        return events;
    }
    const OPTS = { workflowId: 'wf', exposedParameters: [], paramValues: {}, inputs: [] };

    await test('cancelled while /prompt is in flight: the queued prompt is taken back, nothing else touched', async () => {
        const { w, posts } = makeWorker();
        const events = readyForSubmit(w);
        let answer;
        w.rest.submitPrompt = () => new Promise((r) => { answer = r; });
        const pending = w.submit('job-1', {}, OPTS);
        await new Promise((r) => setImmediate(r));
        assert.ok(answer, 'submit reached the /prompt POST');
        assert.strictEqual(await w.cancel('job-1'), true);
        // The executor may already have handed the worker the next job.
        w.currentJobId = 'job-2';
        w._setState('busy');
        answer({ prompt_id: 'prompt-late', number: 0 });
        const out = await pending;
        assert.strictEqual(out.cancelled, true);
        assert.deepStrictEqual(posts, [
            ['/queue', { delete: ['prompt-late'] }],
            ['/interrupt', { prompt_id: 'prompt-late' }],
        ]);
        assert.strictEqual(w.currentJobId, 'job-2');
        assert.strictEqual(w.currentPromptId, null, 'the late prompt is not adopted');
        assert.strictEqual(w.getStatus().state, 'busy');
        assert.deepStrictEqual(events.map(([t]) => t), ['failed'], 'no "submitted" for a cancelled job');
    });

    await test('cancelled before the POST: nothing is sent to ComfyUI at all', async () => {
        const { w, posts } = makeWorker();
        readyForSubmit(w);
        let release;
        w.lifecycle.beforeJob = () => new Promise((r) => { release = r; });
        let submitted = false;
        w.rest.submitPrompt = async () => { submitted = true; return { prompt_id: 'p' }; };
        const pending = w.submit('job-1', {}, OPTS);
        await new Promise((r) => setImmediate(r));
        assert.ok(release, 'submit reached beforeJob');
        await w.cancel('job-1');
        release({ freed: false, reason: 'test' });
        assert.strictEqual((await pending).cancelled, true);
        assert.strictEqual(submitted, false);
        assert.deepStrictEqual(posts, []);
    });

    await test('not cancelled: submit still adopts its prompt and reports it', async () => {
        const { w } = makeWorker();
        const events = readyForSubmit(w);
        w.rest.submitPrompt = async () => ({ prompt_id: 'prompt-1', number: 0 });
        const out = await w.submit('job-1', {}, OPTS);
        assert.strictEqual(out.promptId, 'prompt-1');
        assert.strictEqual(w.currentPromptId, 'prompt-1');
        assert.deepStrictEqual(events.map(([t]) => t), ['submitted']);
    });

    await test('a dropdown value ComfyUI does not offer still fails the job, and releases the worker', async () => {
        const { w } = makeWorker();
        readyForSubmit(w);
        w.rest.getObjectInfo = async () => ({ ComfyQTestNode: { input: { required: { aspect: [['1:1', '16:9']] } } } });
        let submitted = false;
        w.rest.submitPrompt = async () => { submitted = true; return { prompt_id: 'p' }; };
        const opts = {
            ...OPTS,
            exposedParameters: [{ key: 'ar', type: 'select', nodeId: '1', field: 'aspect', label: 'Aspect' }],
            paramValues: { ar: 'banana' },
        };
        await assert.rejects(w.submit('job-1', { 1: { class_type: 'ComfyQTestNode', inputs: { aspect: '1:1' } } }, opts),
            /does not offer/);
        assert.strictEqual(submitted, false);
        assert.strictEqual(w.currentJobId, null);
        assert.strictEqual(w.getStatus().state, 'idle');
    });

    await test('the run ends while cancel waits on ComfyUI: the next job is not wiped', async () => {
        const { w } = makeWorker();
        w.currentJobId = 'job-1';
        w.currentPromptId = 'prompt-1';
        w._setState('busy');
        const failed = [];
        w.on('failed', (e) => failed.push(e));
        w.rest.http.post = async () => {
            // Meanwhile the executor collected job-1 and started job-2.
            w.currentJobId = 'job-2';
            w.currentPromptId = 'prompt-2';
        };
        assert.strictEqual(await w.cancel('job-1'), false);
        assert.strictEqual(w.currentJobId, 'job-2');
        assert.strictEqual(w.currentPromptId, 'prompt-2');
        assert.strictEqual(w.getStatus().state, 'busy');
        assert.deepStrictEqual(failed, []);
    });

    // ★ clampParamValue snapped every value through `* 1e6 / 1e6`, which loses
    // integer precision above ~9e9: a recalled seed of 730608533992019 reached
    // ComfyUI as 730608533992018 while the job recorded …019.
    await test('a large whole-number seed survives the step snap exactly', async () => {
        const p = { type: 'number', min: 0, max: 999999999999999, step: 1 };
        assert.strictEqual(clampParamValue(730608533992019, p), 730608533992019);
        assert.strictEqual(clampParamValue('730608533992019', p), 730608533992019);
    });

    await test('a float step is still snapped and cleaned of float noise', async () => {
        assert.strictEqual(clampParamValue(0.29, { type: 'number', min: 0, max: 1, step: 0.1 }), 0.3);
        assert.strictEqual(clampParamValue(1.26, { type: 'number', min: 0.5, max: 4, step: 0.25 }), 1.25);
        assert.strictEqual(clampParamValue(7, { type: 'number', min: 1, max: 5, step: 1 }), 5);
        assert.strictEqual(clampParamValue(-1, { type: 'number', min: 1, max: 5, step: 1 }), 1);
    });

    fs.rmSync(TMP, { recursive: true, force: true });
    if (fails) { console.error(`\n${fails} failing`); process.exit(1); }
    console.log('\nlocalComfyUIWorker: all passed');
})();
