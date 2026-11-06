// Two storyboard route rules the card never exercises, because it goes through
// /preview first:
//   * POST /storyboard/queue refuses a document the PARSER found errors in, not
//     only one the planner could not plan. A `##` with no `###` line is dropped
//     before planning, so checking the plan alone queued 41 of 42 shots.
//   * DELETE /storyboard/batches/:id cancels a running shot on its OWN lane.
//     The main executor ignores a job it is not running, so a shot on a second
//     lane rendered on and wrote its files after the batch's cleanup.
// (node server/routes/storyboard.test.js)

const fs = require('fs'), os = require('os'), path = require('path'), express = require('express');
const bcrypt = require('bcryptjs');
const { WorkflowRegistry } = require('../workflows/workflowRegistry');
const { JobQueue } = require('../queue/jobQueue');
const { adminGate } = require('../auth/authGate');
const storyboard = require('./storyboard');

const REPO = path.resolve(__dirname, '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-route-rules-'));
const PW = 'workshop123';

let mode = 'student';
const baseConfig = () => ({
    mode,
    auth: { adminPasswordHash: bcrypt.hashSync(PW, 4) },
    workflows: { activeWorkflowId: null, dir: path.join(REPO, 'workflows') },
    queue: { dbPath: path.join(tmp, 'queue.db') },
    comfy_ui: { root_path: tmp, output_dir: tmp },
});
const configManager = {
    load: () => ({ config: baseConfig() }),
    resolvePaths: (c) => c,
    update: (fn) => { const c = fn(baseConfig()); mode = c.mode; return c; },
};
const registry = new WorkflowRegistry(path.join(REPO, 'workflows'));
registry.discover();

const queue = new JobQueue(path.join(tmp, 'queue.db'));
const mainCancels = [], laneCancels = [];
let laneWorkflowId = null;
let openLanes = [];
// Serving, with a second lane: the shape server/index.js shares by reference.
const runtime = {
    queue,
    executor: { cancelJob: async (id) => { mainCancels.push(id); return false; } },
    lanes: { list: () => openLanes, get: (wf) => (wf === laneWorkflowId ? { executor: { cancelJob: async (id) => { laneCancels.push(id); return true; } } } : null) },
};

const restarts = [];
const app = express();
app.use(express.json({ limit: '20mb' }));
app.use('/storyboard', storyboard.makeRouter({
    configManager, registry, runtime, adminGate: adminGate(configManager), exitForRestart: (to) => restarts.push(to),
}));

let fails = 0, passes = 0;
const check = (name, cond, extra = '') => {
    if (cond) { passes++; console.log('  ok   ' + name); }
    else { fails++; console.error('  FAIL ' + name + (extra ? '  ' + extra : '')); }
};

const srv = app.listen(0, async () => {
    const base = `http://127.0.0.1:${srv.address().port}`;
    const H = { 'X-Admin-Password': PW, 'Content-Type': 'application/json' };
    const md = fs.readFileSync(path.join(REPO, 'server', 'storyboard', 'fixtures', 'example.md'), 'utf8');
    const cut = md.indexOf('\n## ');
    const broken = md.slice(0, cut) + '\n## A shot with no workflow line\njust words here\n' + md.slice(cut);
    try {
        console.log('\nthe preview counts a shot the parser dropped in the total');
        let p = await fetch(base + '/storyboard/preview', { method: 'POST', headers: H, body: JSON.stringify({ markdown: md, name: 'clean.md' }) });
        const clean = await p.json();
        p = await fetch(base + '/storyboard/preview', { method: 'POST', headers: H, body: JSON.stringify({ markdown: broken, name: 'broken.md' }) });
        const dropped = await p.json();
        check('the broken document has one shot more than the clean one',
            Number.isInteger(clean.totalShots) && dropped.totalShots === clean.totalShots + 1,
            `clean ${clean.totalShots} broken ${dropped.totalShots}`);
        check('and still plans only the clean ones', dropped.totalJobs === clean.totalJobs, `${dropped.totalJobs} vs ${clean.totalJobs}`);

        console.log('\na parse error refuses the batch through the API too');
        let r = await fetch(base + '/storyboard/queue', { method: 'POST', headers: H, body: JSON.stringify({ markdown: broken, name: 'broken.md' }) });
        let d = await r.json();
        check('it is refused with 422', r.status === 422, `${r.status} ${JSON.stringify(d).slice(0, 160)}`);
        check('the parse error is named in the refusal',
            Array.isArray(d.errors) && d.errors.some(e => /no "### <workflow>" line/.test(e)), JSON.stringify(d.errors));
        check('the message says nothing was queued', /nothing was queued/.test(d.error || ''), d.error);
        check('nothing reached the queue', queue.listActive().length === 0, String(queue.listActive().length));

        r = await fetch(base + '/storyboard/queue', { method: 'POST', headers: H, body: JSON.stringify({ markdown: broken, name: 'broken.md', force: true }) });
        d = await r.json();
        check('force=true queues the rest', r.status === 200 && d.totalJobs > 0, `${r.status} ${JSON.stringify(d).slice(0, 160)}`);
        check('and still reports the parse error', (d.errors || []).some(e => /no "### <workflow>" line/.test(e)), JSON.stringify(d.errors));
        const batchId = d.batchId;

        r = await fetch(base + '/storyboard/queue', { method: 'POST', headers: H, body: JSON.stringify({ markdown: md, name: 'clean.md' }) });
        check('a clean document still queues', r.status === 200, String(r.status));

        console.log('\na batch needs the whole machine');
        openLanes = [{ name: 'Main', primary: true }, { name: 'Extra one', primary: false }];
        p = await fetch(base + '/storyboard/preview', { method: 'POST', headers: H, body: JSON.stringify({ markdown: md, name: 'clean.md' }) });
        d = await p.json();
        check('the preview warns, naming the lane', d.warnings.some(w => /close the extra lanes first \(Extra one\)/.test(w)), JSON.stringify(d.warnings).slice(0, 200));
        const queuedBefore = queue.listActive().length;
        r = await fetch(base + '/storyboard/queue', { method: 'POST', headers: H, body: JSON.stringify({ markdown: md, name: 'clean.md' }) });
        d = await r.json();
        check('queueing is refused with 409', r.status === 409 && d.code === 'lanes-open', `${r.status} ${JSON.stringify(d).slice(0, 160)}`);
        check('nothing was queued', queue.listActive().length === queuedBefore);
        openLanes = [];

        console.log('\nStop & remove cancels a running shot on its own lane');
        const jobs = queue.listBatch(batchId);
        const onLane = jobs[0];
        const onMain = jobs.find(j => j.workflowId !== onLane.workflowId);
        check('the batch has shots for two workflows', !!onMain);
        laneWorkflowId = onLane.workflowId;
        for (const j of [onLane, onMain]) {
            for (const st of ['uploading-inputs', 'submitted', 'executing']) queue.transitionStatus(j.id, st);
        }
        r = await fetch(base + `/storyboard/batches/${batchId}`, { method: 'DELETE', headers: H });
        d = await r.json();
        check('the batch is removed', r.status === 200 && d.removed === jobs.length, JSON.stringify(d));
        check('the shot on the second lane was cancelled THERE', laneCancels.includes(onLane.id) && !mainCancels.includes(onLane.id),
            `lane ${JSON.stringify(laneCancels)} main ${JSON.stringify(mainCancels)}`);
        check('the shot on the main lane was cancelled on the main lane', mainCancels.includes(onMain.id));

        console.log('\nfrom admin mode, a batch does not restart the server over a running sweep');
        const executor = runtime.executor;
        runtime.executor = null;   // admin mode: nothing drains the queue
        mode = 'admin';
        const before = queue.listActive().length;
        runtime.sweep = { status: () => ({ state: 'running' }) };
        r = await fetch(base + '/storyboard/queue', { method: 'POST', headers: H, body: JSON.stringify({ markdown: md, name: 'clean.md' }) });
        d = await r.json();
        await new Promise(ok => setTimeout(ok, 350));
        check('it is refused with 409, naming the sweep', r.status === 409 && /library sweep is running/.test(d.error || ''), `${r.status} ${d.error}`);
        check('nothing was queued and nothing restarted', queue.listActive().length === before && restarts.length === 0,
            `${queue.listActive().length} vs ${before}, ${JSON.stringify(restarts)}`);
        delete runtime.sweep;
        runtime.executor = executor;
        mode = 'student';
    } catch (e) {
        fails++;
        console.error('  FAIL the checks threw:', e);
    }
    srv.closeAllConnections();
    srv.close();
    try { queue.db.close(); } catch { /* closed */ }
    fs.rmSync(tmp, { recursive: true, force: true });
    if (fails) { console.error(`\nstoryboard route rules: ${fails} FAILED, ${passes} passed`); process.exitCode = 1; return; }
    console.log(`\nstoryboard route rules: all ${passes} checks passed`);
});
