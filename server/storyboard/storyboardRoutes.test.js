// Storyboard HTTP routes — drives the EXACT request sequence the admin card
// (client/src/components/admin/StoryboardUpload.jsx) makes, against the real
// router, in BOTH server modes.
//
// Run with:  node server/storyboard/storyboardRoutes.test.js

const fs = require('fs'), os = require('os'), path = require('path'), express = require('express');
const { WorkflowRegistry } = require('../workflows/workflowRegistry');
const { JobQueue } = require('../queue/jobQueue');
const { adminGate } = require('../auth/authGate');
const storyboard = require('../routes/storyboard');
const bcrypt = require('bcryptjs');

const REPO = path.resolve(__dirname, '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-routes-'));
const PW = 'workshop123';

// A configManager stand-in with the same surface the router uses.
let mode = 'admin';
let activeWorkflowId = null;
const baseConfig = () => ({
    mode,
    auth: { adminPasswordHash: bcrypt.hashSync(PW, 10) },
    workflows: { activeWorkflowId, dir: path.join(REPO, 'workflows') },
    queue: { dbPath: path.join(tmp, 'queue.db') },
    comfy_ui: { root_path: tmp, output_dir: tmp }
});
const configManager = {
    load: () => ({ config: baseConfig() }),
    resolvePaths: (c) => c,
    update: (fn) => { const c = fn(baseConfig()); mode = c.mode; activeWorkflowId = c.workflows.activeWorkflowId; return c; }
};

const registry = new WorkflowRegistry(path.join(REPO, 'workflows'));
registry.discover();

// `runtime` is shared by reference, exactly as server/index.js shares it: empty
// in admin mode, populated once student mode boots.
const runtime = {};
let restarts = [];
const exitForRestart = (to) => restarts.push(to);

const app = express();
app.use(express.json({ limit: '20mb' }));
app.use('/storyboard', storyboard.makeRouter({
    configManager, registry, runtime, adminGate: adminGate(configManager), exitForRestart
}));

let fails = 0;
const check = (name, cond, extra = '') => {
    if (cond) console.log('  ok   ' + name);
    else { console.error('  FAIL ' + name + (extra ? '  ' + extra : '')); fails++; }
};

const srv = app.listen(0, async () => {
    const base = `http://127.0.0.1:${srv.address().port}`;
    const md = fs.readFileSync(path.join(REPO, 'docs', 'storyboard-example.md'), 'utf8');
    const H = { 'X-Admin-Password': PW };
    const withFile = (name, extra = {}) => {
        const f = new FormData();
        f.append('file', new Blob([md], { type: 'text/markdown' }), name);
        for (const [k, v] of Object.entries(extra)) f.append(k, v);
        return f;
    };

    // ---------------------------------------------------- admin mode ----
    console.log('\nadmin mode (nothing served yet)');
    let r = await fetch(base + '/storyboard/preview', { method: 'POST', headers: H, body: withFile('red.md') });
    let d = await r.json();
    check('preview works with no workflow served', r.status === 200, String(r.status));
    check('it reports that nothing is serving yet', d.serving === false);
    check('42 shots, no errors', d.totalJobs === 42 && d.errors.length === 0, JSON.stringify(d.errors));

    check('shots are grouped so each model loads once',
        d.modelLoads === 6, `modelLoads=${d.modelLoads}`);
    check('every workflow appears as exactly one contiguous run',
        new Set(d.workflowRuns.map(x => x.workflowId)).size === d.workflowRuns.length,
        JSON.stringify(d.workflowRuns.map(x => x.workflowId)));
    check('the run counts add up to every shot',
        d.workflowRuns.reduce((a, x) => a + x.count, 0) === d.totalJobs);
    check('a dependency is never scheduled after its consumer', (() => {
        const pos = new Map(d.jobs.map((j, i) => [j.itemIndex, i]));
        return d.jobs.every(j => j.deps.every(x => pos.get(x.sourceItemIndex) < pos.get(j.itemIndex)));
    })());
    check('images still run before videos before audio',
        d.jobs.map(j => j.phase).every((p, i, a) => i === 0 || a[i - 1] <= p));

    r = await fetch(base + '/storyboard/preview', { method: 'POST', body: withFile('red.md') });
    check('the admin password is still required', r.status === 401, String(r.status));

    r = await fetch(base + '/storyboard/queue', {
        method: 'POST', headers: H, body: withFile('red.md', { label: 'the red thread' })
    });
    d = await r.json();
    check('queueing from admin mode succeeds', r.status === 200, JSON.stringify(d).slice(0, 140));
    check('it starts serving the batch\'s OWN first workflow',
        d.restarting === true && d.startingWorkflowId === d.jobs[0].workflowId, JSON.stringify(d.startingWorkflowId));
    check('the config was switched to student mode',
        mode === 'student' && activeWorkflowId === d.startingWorkflowId, `${mode}/${activeWorkflowId}`);

    const batchId = d.batchId;
    await new Promise(res => setTimeout(res, 400));
    check('a restart was requested, into student mode',
        restarts.length === 1 && restarts[0] === 'student', JSON.stringify(restarts));

    // The jobs must be durable in the sqlite file — that is what survives the
    // restart and gets drained by the executor that boots with it.
    const reopened = new JobQueue(path.join(tmp, 'queue.db'));
    const stored = reopened.listBatch(batchId);
    check('the batch is on disk for the restarted server to find', stored.length === 42, String(stored.length));
    check('its dependency rows survived too',
        stored.filter(j => reopened.depsFor(j.id).length > 0).length === 22,
        String(stored.filter(j => reopened.depsFor(j.id).length > 0).length));
    check('every dependency points at a job in the same batch', (() => {
        const ids = new Set(stored.map(j => j.id));
        return stored.every(j => reopened.depsFor(j.id).every(dep => ids.has(dep.sourceJobId)));
    })());

    // -------------------------------------------------- student mode ----
    console.log('\nstudent mode (the executor is live)');
    runtime.queue = reopened;
    runtime.executor = { cancelJob: async () => true };

    r = await fetch(base + '/storyboard/preview', { method: 'POST', headers: H, body: withFile('red.md') });
    d = await r.json();
    check('preview reports that it is serving now', d.serving === true);

    r = await fetch(base + '/storyboard/batches', { headers: H });
    d = await r.json();
    const b = d.batches.find(x => x.batchId === batchId);
    check('the batch queued in admin mode is visible', !!b && b.total === 42);
    check('the tally adds up', b && b.completed + b.failed + b.pending + b.running === b.total, JSON.stringify(b));

    r = await fetch(base + '/storyboard/queue', {
        method: 'POST', headers: H, body: withFile('second.md', { spacing: 'asap' })
    });
    d = await r.json();
    check('queueing while serving does NOT restart', r.status === 200 && d.restarting === false);
    check('no extra restart was requested', restarts.length === 1, JSON.stringify(restarts));
    const second = reopened.listBatch(d.batchId);
    check('spacing=asap honoured through multipart',
        second[1].scheduledAt - second[0].scheduledAt === 1000,
        `${second[1].scheduledAt - second[0].scheduledAt}ms`);
    check('the second batch starts after the first',
        second[0].scheduledAt > stored[stored.length - 1].scheduledAt);

    // A storyboard the card must refuse to queue.
    const bad = new FormData();
    bad.append('file', new Blob(['# S | scene | -\n\n## Cut\n### ltx_2_5_i2v\nit moves']), 'bad.md');
    r = await fetch(base + '/storyboard/preview', { method: 'POST', headers: H, body: bad });
    d = await r.json();
    check('a cut with no frame previews as an error, disabling Queue',
        r.status === 200 && d.errors.length > 0 && d.totalJobs === 0, JSON.stringify(d.errors));

    // ------------------------------------------- progress + output naming ----
    console.log('\nprogress view and output naming');
    r = await fetch(base + '/storyboard/preview', {
        method: 'POST', headers: H, body: withFile('red.md', { folder: 'The Red Thread' })
    });
    d = await r.json();
    check('preview echoes the output folder and where it lands',
        d.outputFolder === 'The Red Thread' && typeof d.outputDir === 'string',
        `${d.outputFolder} / ${d.outputDir}`);
    check('each shot is named from its own headings',
        d.jobs[0].outputPrefix === 'The-Red-Thread/001_LIBRARY__Anchor-image-1__image_flux2_klein_9b_t2i',
        d.jobs[0].outputPrefix);
    check('the one-ref-in-two-slots case is warned about, not silent',
        d.warnings.some(w => /used for BOTH/.test(w)), JSON.stringify(d.warnings.slice(0, 1)));

    // Drive a batch through the states the progress view renders.
    const jobs = reopened.listBatch(batchId);
    const firstJob = jobs[0], failJob = jobs[1];
    check('the stored job carries its output prefix', !!firstJob.outputPrefix, String(firstJob.outputPrefix));

    for (const st of ['uploading-inputs', 'submitted', 'executing']) reopened.transitionStatus(firstJob.id, st);
    reopened.updateProgress(firstJob.id, { stepsDone: 7, stepsTotal: 20 });
    reopened.transitionStatus(failJob.id, 'uploading-inputs');
    reopened.transitionStatus(failJob.id, 'failed', {
        payload: { errorReason: 'This model is not compatible with Sage attention, the optional speed-up.' }
    });

    r = await fetch(base + `/storyboard/batches/${batchId}`, { headers: H });
    d = await r.json();
    const running = d.jobs.find(j => j.id === firstJob.id);
    const failed = d.jobs.find(j => j.id === failJob.id);
    check('a running shot reports its sampler progress',
        running.progress && running.progress.value === 7 && running.progress.max === 20,
        JSON.stringify(running.progress));
    check('a shot reads as its own heading, not a uuid',
        running.label === 'LIBRARY · Anchor image 1', running.label);
    check('a failed shot carries the reason inline',
        /Sage attention/.test(failed.error_reason || ''), String(failed.error_reason));
    // This batch was queued with no folder field, so it defaulted to the
    // uploaded filename (red.md) rather than the label.
    check('the detail names the output folder', d.outputFolder === 'red', String(d.outputFolder));

    r = await fetch(base + '/storyboard/batches', { headers: H });
    d = await r.json();
    const tally = d.batches.find(x => x.batchId === batchId);
    check('the tally counts the running shot', tally.running === 1, JSON.stringify(tally));
    check('the tally counts the failed shot', tally.failed >= 1, JSON.stringify(tally));

    // ------------------------------------------------------- retry failed ----
    console.log('\nretrying the shots that failed');
    // Two kinds of failure in one batch: a shot that failed on its own (a stale
    // dropdown option rejected at submit) and a shot cascade-failed because it
    // was waiting on that one. Both must come back.
    const retryJobs = reopened.listBatch(batchId);
    const ownFault = retryJobs.find(j => j.status === 'scheduled' && reopened.depsFor(j.id).length === 0);
    const dependent = retryJobs.find(j => reopened.depsFor(j.id).some(d => d.sourceJobId === ownFault.id));
    check('the batch has a source and a consumer to work with', !!(ownFault && dependent));

    reopened.transitionStatus(ownFault.id, 'uploading-inputs');
    reopened.transitionStatus(ownFault.id, 'failed', {
        payload: { errorReason: 'ComfyUI rejected this job — aspect_ratio out of date' }
    });
    reopened.failBlockedJobs();
    check('the consumer was collapsed by the failure',
        reopened.get(dependent.id).status === 'failed'
        && reopened.get(dependent.id).errorReason === 'dependency-failed',
        `${reopened.get(dependent.id).status} / ${reopened.get(dependent.id).errorReason}`);

    r = await fetch(base + `/storyboard/batches/${batchId}/retry`, { method: 'POST', headers: H });
    d = await r.json();
    check('retry reports what it requeued', r.status === 200 && d.retried >= 2, JSON.stringify(d).slice(0, 120));
    check('the shot that failed is scheduled again',
        reopened.get(ownFault.id).status === 'scheduled', reopened.get(ownFault.id).status);
    check('its error and timings were cleared',
        !reopened.get(ownFault.id).errorReason && !reopened.get(ownFault.id).finishedAt);
    check('the consumer is scheduled again too',
        reopened.get(dependent.id).status === 'scheduled', reopened.get(dependent.id).status);
    check('the dependency wiring survived the retry',
        reopened.depsFor(dependent.id).some(x => x.sourceJobId === ownFault.id));
    check('nothing is re-collapsed on the next executor tick',
        reopened.failBlockedJobs().length === 0);
    check('run order is preserved — the source still precedes its consumer',
        reopened.get(ownFault.id).scheduledAt <= reopened.get(dependent.id).scheduledAt);
    check('a shot whose label reads from its headings is reported',
        Array.isArray(d.jobs) && d.jobs.every(j => typeof j.label === 'string' && j.label.length > 0));

    r = await fetch(base + `/storyboard/batches/${batchId}/retry`, { method: 'POST', headers: H });
    d = await r.json();
    check('retrying with nothing failed is a no-op', r.status === 200 && d.retried === 0, JSON.stringify(d));

    r = await fetch(base + `/storyboard/batches/${batchId}/retry`, { method: 'POST' });
    check('retry needs the admin password', r.status === 401, String(r.status));

    r = await fetch(base + '/storyboard/batches/does-not-exist/retry', { method: 'POST', headers: H });
    check('retrying an unknown batch is a 404', r.status === 404, String(r.status));

    // A source that was DELETED, not merely failed, can never be recovered.
    const orphanSource = reopened.listBatch(batchId).find(j =>
        j.id !== ownFault.id && reopened.dependentsOf(j.id).length > 0);
    if (orphanSource) {
        const waiting = reopened.dependentsOf(orphanSource.id);
        reopened.delete(orphanSource.id);
        reopened.failBlockedJobs();
        r = await fetch(base + `/storyboard/batches/${batchId}/retry`, { method: 'POST', headers: H });
        d = await r.json();
        check('a shot whose input was deleted is reported as still blocked',
            d.stillBlocked.some(id => waiting.includes(id)), JSON.stringify(d.stillBlocked));
    }

    r = await fetch(base + `/storyboard/batches/${batchId}`, { method: 'DELETE', headers: H });
    d = await r.json();
    check('delete reports cancelled/removed for the toast',
        r.status === 200 && d.removed >= 41 && d.cancelled >= 40, JSON.stringify(d));
    check('the batch is gone', reopened.listBatch(batchId).length === 0);

    srv.close(); reopened.close();
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log(fails ? `\n${fails} FAILURE(S)\n` : '\nall route checks passed\n');
    process.exitCode = fails ? 1 : 0;
});
