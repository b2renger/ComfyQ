// The executor and a worker it does not have to itself — the real JobExecutor
// and JobQueue against a fake worker. (node server/executor/executorHold.test.js)
//
//   1. A worker busy with something that is not a queued job (an admin
//      calibrating the served workflow) holds the queue: the job that comes
//      due waits instead of failing with "Worker not idle".
//   2. A submit that fails after the worker marked itself busy with the job
//      releases the worker, or the hold in (1) would stall the queue for ever.
//   3. abortCurrent — what closing a lane calls — stops the running job on
//      ComfyUI and fails it with the reason given, instead of orphaning it.
//      It stops THAT job's prompt (queue first, then interrupt, by id), never
//      whatever ComfyUI is running: the install's ComfyUI stays up and may be
//      running an admin's prompt while ours waits behind it.
//   4. A job the student cancels while it runs is recorded as cancelled,
//      and a real error on the same event path still as failed.
//   5. abortCurrent on a job still inside worker.submit (no prompt id yet)
//      sends ComfyUI nothing and only fails the job.
//   6. abortCurrent while a finished render is being collected lets it
//      complete instead of failing a job that is done.
//   7. A collection that resolves after abortCurrent failed its job leaves
//      the job and the worker alone.
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), EventEmitter = require('events');
const { JobQueue } = require('../queue/jobQueue');
const { JobExecutor } = require('./jobExecutor');
const sm = require('../queue/jobStateMachine');
const { v4: uuid } = require('uuid');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'exec-hold-'));
const comfyConfig = { root_path: path.join(tmp, 'comfy'), output_dir: path.join(tmp, 'comfy', 'output') };

class FakeWorker extends EventEmitter {
    constructor() {
        super();
        this.state = 'idle'; this.currentJobId = null; this.currentPromptId = null; this.submits = [];
        this.failAfterBusy = false; this.gate = null; this.finalizes = 0;
        // What reached ComfyUI, with the arguments: a body-less interrupt
        // (no prompt id) stops whatever ComfyUI is running.
        this.calls = [];
        this.rest = {
            interrupt: async (promptId) => { this.calls.push(['interrupt', promptId]); },
            deleteFromQueue: async (ids) => { this.calls.push(['delete', ids]); },
            getHistory: async () => null,
        };
    }
    getStatus() { return { state: this.state, currentJobId: this.currentJobId, currentPromptId: this.currentPromptId }; }
    async submit(jobId) {
        if (this.state !== 'idle') throw new Error(`Worker not idle (state=${this.state})`);
        this.state = 'busy'; this.currentJobId = jobId; this.submits.push(jobId);
        // The real worker can throw here (lifecycle.beforeJob, the graph
        // transforms) without resetting itself.
        if (this.failAfterBusy) throw new Error('could not prepare the graph');
        // Still on its way to ComfyUI: no prompt id yet.
        if (this.gate) await this.gate;
        const promptId = 'p' + this.submits.length;
        this.currentPromptId = promptId;
        this.emit('submitted', { jobId, promptId });
        return { promptId };
    }
    finalize() { this.state = 'idle'; this.currentJobId = null; this.currentPromptId = null; this.finalizes++; return {}; }
    // As the real worker does: a stop the user asked for is reported through
    // the same 'failed' event as an error, with errorReason 'cancelled'.
    async cancel(jobId) {
        if (this.currentJobId !== jobId) return false;
        this.state = 'idle'; this.currentJobId = null; this.currentPromptId = null;
        this.emit('failed', { jobId, errorReason: 'cancelled', errorPhase: 'executing' });
        return true;
    }
}

const registry = {
    get: (id) => ({
        id, unavailable: false, summary: { name: id, estimatedDurationSec: 1 },
        meta: { version: '1', requirements: {} },
        effective: { exposedParameters: [] }, apiWorkflow: {},
    }),
};

let fails = 0;
const check = (name, cond, extra = '') => {
    if (cond) console.log('  ok   ' + name);
    else { console.error('  FAIL ' + name + (extra ? '  ' + extra : '')); fails++; }
};

(async () => {
    const queue = new JobQueue(path.join(tmp, 'q.db'));
    const worker = new FakeWorker();
    const executor = new JobExecutor({ queue, worker, registry, comfyConfig });
    const book = () => {
        const id = uuid();
        queue.insert({ id, userId: 's', workflowId: 'wf', scheduledAt: Date.now() - 1000, prompt: 'p', paramValues: {} });
        return id;
    };

    // 1. A calibration holds the worker; a job comes due.
    const A = book();
    worker.state = 'busy';                       // busy, and not with any job of ours
    await executor._tick();
    check('a job that comes due while the worker is busy waits', queue.get(A).status === sm.STATES.SCHEDULED, queue.get(A).status);
    check('...and was not submitted', worker.submits.length === 0);
    worker.state = 'idle';                       // the calibration is over
    await executor._tick();
    check('it runs once the worker is free', worker.submits[0] === A && queue.get(A).status === sm.STATES.EXECUTING, queue.get(A).status);

    // 3. The lane closes while A runs.
    executor.stop();
    const aborted = await executor.abortCurrent('Stopped: this workflow stopped being served.');
    check('abortCurrent reports it stopped a job', aborted === true);
    check('...took ITS prompt out of the queue, then interrupted it by id',
        JSON.stringify(worker.calls) === JSON.stringify([['delete', ['p1']], ['interrupt', 'p1']]),
        JSON.stringify(worker.calls));
    check('...failed the job with the reason given',
        queue.get(A).status === sm.STATES.FAILED && /stopped being served/.test(queue.get(A).errorReason || ''),
        `${queue.get(A).status} / ${queue.get(A).errorReason}`);
    check('...and released the worker', worker.state === 'idle' && executor._currentJobId === null);
    check('with nothing running it does nothing', (await executor.abortCurrent('x')) === false && worker.calls.length === 2);

    // 2. A submit that dies after the worker took the job.
    const B = book();
    worker.failAfterBusy = true;
    await executor._tick();
    check('a job whose submit fails is failed', queue.get(B).status === sm.STATES.FAILED, queue.get(B).status);
    check('...and the worker is released, not left busy', worker.state === 'idle' && worker.currentJobId === null, worker.state);
    worker.failAfterBusy = false;
    const C = book();
    await executor._tick();
    check('...so the next job still runs', worker.submits.slice(-1)[0] === C && queue.get(C).status === sm.STATES.EXECUTING, queue.get(C).status);

    // 4. The student cancels C while it runs: it is recorded as cancelled, as
    //    the Cancel dialog says — a storyboard retry re-runs failed shots only.
    check('cancelling the running job reports it stopped', (await executor.cancelJob(C)) === true);
    check('...records it as cancelled, not failed', queue.get(C).status === sm.STATES.CANCELLED, queue.get(C).status);
    check('...and releases the executor', executor._currentJobId === null && worker.state === 'idle');
    // A real error on the same path stays a failure.
    const D = book();
    await executor._tick();
    worker.state = 'idle'; worker.currentJobId = null;
    worker.emit('failed', { jobId: D, errorReason: 'CUDA out of memory', errorPhase: 'executing' });
    check('a real error during the run is still recorded as failed', queue.get(D).status === sm.STATES.FAILED, queue.get(D).status);
    worker.currentPromptId = null;

    const nextTurn = () => new Promise(r => setImmediate(r));

    // 5. The lane closes while E is still on its way to ComfyUI.
    worker.calls.length = 0;
    let releaseSubmit; worker.gate = new Promise(r => { releaseSubmit = r; });
    const E = book();
    const ticking = executor._tick();
    await nextTurn();
    check('(setup) E is inside submit, with no prompt id yet', worker.currentJobId === E && !worker.currentPromptId);
    check('abortCurrent with no prompt id reports it stopped the job', (await executor.abortCurrent('Stopped.')) === true);
    check('...sends ComfyUI nothing (never a body-less interrupt)', worker.calls.length === 0, JSON.stringify(worker.calls));
    check('...fails the job and releases the worker',
        queue.get(E).status === sm.STATES.FAILED && worker.state === 'idle' && executor._currentJobId === null,
        `${queue.get(E).status} / ${worker.state}`);
    worker.gate = null; releaseSubmit(); await ticking;
    check('...and the submit landing late does not revive it', queue.get(E).status === sm.STATES.FAILED, queue.get(E).status);
    worker.currentPromptId = null;

    // 6. The lane closes while F's finished render is being collected.
    worker.calls.length = 0;
    const F = book();
    await executor._tick();
    const pF = worker.currentPromptId;
    let deliverF; worker.rest.getHistory = () => new Promise(r => { deliverF = r; });
    worker.emit('execution-finished', { jobId: F, promptId: pF });
    const abortingF = executor.abortCurrent('Stopped.');
    await nextTurn();
    deliverF({ [pF]: { outputs: {}, status: { status_str: 'success' } } });
    check('abortCurrent during the collection of a finished render reports done', (await abortingF) === true);
    check('...lets the job complete instead of failing it', queue.get(F).status === sm.STATES.COMPLETED, queue.get(F).status);
    check('...and stops nothing on ComfyUI', worker.calls.length === 0, JSON.stringify(worker.calls));

    // 7. G's history arrives only after the lane closed and G was failed.
    worker.calls.length = 0;
    const G = book();
    await executor._tick();
    const pG = worker.currentPromptId;
    let releaseHistory; const historyGate = new Promise(r => { releaseHistory = r; });
    worker.rest.getHistory = async () => {
        await historyGate;
        return { [pG]: { outputs: { 9: { images: [{ filename: 'late.png', subfolder: '', type: 'output' }] } }, status: { status_str: 'success' } } };
    };
    const polling = executor._pollHistoryIfStale();
    await nextTurn();
    await executor.abortCurrent('Stopped.');
    check('(setup) G was stopped by id and failed',
        JSON.stringify(worker.calls) === JSON.stringify([['delete', [pG]], ['interrupt', pG]]) && queue.get(G).status === sm.STATES.FAILED,
        `${JSON.stringify(worker.calls)} / ${queue.get(G).status}`);
    const finalizesAfterAbort = worker.finalizes;
    releaseHistory(); await polling;
    check('a collection that resolves afterwards attaches no outputs to the failed job',
        queue.get(G).status === sm.STATES.FAILED && queue.get(G).outputs.length === 0,
        `${queue.get(G).status} / ${JSON.stringify(queue.get(G).outputs)}`);
    check('...and does not release the worker a second time', worker.finalizes === finalizesAfterAbort, `${worker.finalizes} vs ${finalizesAfterAbort}`);

    queue.close();
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log(fails ? `\n${fails} FAILURE(S)\n` : '\nexecutor hold works\n');
    process.exitCode = fails ? 1 : 0;
})().catch((e) => { console.error(e); process.exit(1); });
