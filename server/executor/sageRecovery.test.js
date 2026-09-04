// Sage-attention recovery — the real JobExecutor against a worker that fails the first job exactly the
// way ComfyUI does with an incompatible sage-attention head dimension.
const fs = require('fs'), os = require('os'), path = require('path'), EventEmitter = require('events');
const { JobQueue } = require('../queue/jobQueue');
const { JobExecutor } = require('./jobExecutor');
const { humanizeFailure } = require('./errorMessages');
const sm = require('../queue/jobStateMachine');
const { v4: uuid } = require('uuid');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sage-'));
const comfyConfig = { root_path: path.join(tmp, 'comfy'), output_dir: path.join(tmp, 'comfy', 'output') };
fs.mkdirSync(path.join(comfyConfig.root_path, 'input'), { recursive: true });
fs.mkdirSync(comfyConfig.output_dir, { recursive: true });

const RAW = 'Error running sage attention: headdim should be in [64, 96, 128].';
let sageOn = true;
const submits = [];

class FakeWorker extends EventEmitter {
    constructor() {
        super(); this.state = 'idle'; this.history = {}; this.n = 0;
        this.rest = { getHistory: async (pid) => this.history[pid] ? { [pid]: this.history[pid] } : null };
    }
    getStatus() { return { state: this.state }; }
    async submit(jobId, wf, opts) {
        this.state = 'busy';
        const promptId = 'p' + (++this.n);
        submits.push({ jobId, sageOn });
        this.emit('submitted', { jobId, promptId });
        if (sageOn) {
            // ComfyUI raises during execution; the worker humanizes and emits.
            setTimeout(() => {
                this.state = 'idle';
                this.emit('failed', { jobId, promptId, errorReason: humanizeFailure(RAW, 'KSampler'), errorPhase: 'executing' });
            }, 10);
            return { promptId };
        }
        const out = `gen_${this.n}_00001_.png`;
        fs.writeFileSync(path.join(comfyConfig.output_dir, out), Buffer.from('89504e470d0a1a0a', 'hex'));
        this.history[promptId] = { status: { status_str: 'success' }, outputs: { 9: { images: [{ filename: out, subfolder: '', type: 'output' }] } } };
        setTimeout(() => this.emit('execution-finished', { jobId, promptId }), 10);
        return { promptId };
    }
    finalize() { this.state = 'idle'; return {}; }
    async cancel() { return true; }
}

const registry = {
    get: (id) => ({
        id, unavailable: false, summary: { name: id, estimatedDurationSec: 1 },
        meta: { version: '1', requirements: {} },
        effective: { exposedParameters: [
            { key: 'prompt', nodeId: '6', field: 'text', type: 'textarea', label: 'Prompt' },
            { key: 'img', nodeId: '10', field: 'image', type: 'image', label: 'Image' }
        ] }, apiWorkflow: {}
    })
};

const queue = new JobQueue(path.join(tmp, 'q.db'));
const worker = new FakeWorker();
let recoveries = 0;
const executor = new JobExecutor({
    queue, worker, registry, comfyConfig,
    onSageIncompatible: async () => { recoveries++; sageOn = false; return true; }
});

// A -> B chain, so we can also prove the dependent is NOT collapsed while the
// source is being retried.
const A = uuid(), B = uuid();
const now = Date.now();
queue.insert({ id: A, userId: 'sb', workflowId: 't2i', scheduledAt: now, prompt: 'anchor', paramValues: { prompt: 'a' }, batchId: 'B' });
queue.insert({
    id: B, userId: 'sb', workflowId: 'i2v', scheduledAt: now + 1, prompt: 'cut', paramValues: { prompt: 'c' }, batchId: 'B',
    deps: [{ paramKey: 'img', sourceJobId: A, outputIndex: 0, kind: 'image' }]
});

let fails = 0;
const check = (name, cond, extra = '') => {
    if (cond) console.log('  ok   ' + name);
    else { console.error('  FAIL ' + name + (extra ? '  ' + extra : '')); fails++; }
};

executor.start();
setTimeout(() => {
    executor.stop();
    check('the flag was turned off exactly once', recoveries === 1, String(recoveries));
    check('the failing shot was retried, not failed',
        queue.get(A).status === sm.STATES.COMPLETED, queue.get(A).status);
    check('it was submitted twice — once with the flag, once without',
        submits.filter(s => s.jobId === A).length === 2,
        JSON.stringify(submits.map(s => s.sageOn)));
    check('the retry ran with the flag off',
        submits.filter(s => s.jobId === A).slice(-1)[0].sageOn === false);
    check('the dependent shot was NOT collapsed by the failure',
        queue.get(B).status === sm.STATES.COMPLETED, `${queue.get(B).status} / ${queue.get(B).errorReason}`);
    check('the retry is visible in the event log',
        queue.eventsFor(A).some(e => /sage/i.test(e.payload || '')),
        JSON.stringify(queue.eventsFor(A).map(e => e.to_status)));
    queue.close(); fs.rmSync(tmp, { recursive: true, force: true });
    console.log(fails ? `\n${fails} FAILURE(S)\n` : '\nsage recovery works\n');
    process.exitCode = fails ? 1 : 0;
}, 3000);
