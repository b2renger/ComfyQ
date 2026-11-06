// jobQueue — booking slots are per lane.
//
// Each lane runs one workflow, one job at a time, on its own ComfyUI. A job
// for one lane must not be pushed back by the other lane's queue, or the two
// lanes take turns instead of running together (seen on the rig: an edit job
// booked beside a t2i job was slotted 72 s later and its ComfyUI sat idle).
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { JobQueue } = require('./jobQueue');
const sm = require('./jobStateMachine');

let pass = 0;
const ok = (what, cond) => { assert.ok(cond, what); pass++; };

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'comfyq-queue-'));
const q = new JobQueue(path.join(dir, 'q.sqlite'));
const T = 1_000_000_000_000;
const MIN = 60_000;
const book = (workflowId, scheduledAt) => q.insert({ userId: 'u', workflowId, workflowVersion: '1', scheduledAt });

const a1 = book('lane_a', T);

ok('a second lane books straight away beside the first', q.nextFreeSlot(T, MIN, 'lane_b') === T);
ok('the same lane still queues after its own job', q.nextFreeSlot(T, MIN, 'lane_a') === T + MIN);
ok('unscoped, the old whole-machine answer is unchanged', q.nextFreeSlot(T, MIN) === T + MIN);

ok('a picked time on another lane does not collide', q.findCollisions(T, MIN, null, 'lane_b').length === 0);
ok('a picked time on the same lane does', q.findCollisions(T, MIN, null, 'lane_a')[0] === a1.id);
ok('excluding the job itself still works when scoped', q.findCollisions(T, MIN, a1.id, 'lane_a').length === 0);

book('lane_b', T);
ok('each lane walks only its own queue', q.nextFreeSlot(T, MIN, 'lane_b') === T + MIN && q.nextFreeSlot(T, MIN, 'lane_a') === T + MIN);

// A batch job names its own workflow: one lane takes them, the others leave them.
{
    const q2dir = fs.mkdtempSync(path.join(os.tmpdir(), 'q-batch-'));
    const q2 = new JobQueue(path.join(q2dir, 'q.db'));
    const now = Date.now();
    const add = (workflowId, offset, batchId = null) => q2.insert({ userId: 'u', workflowId, workflowVersion: '1', scheduledAt: now - 1000 + offset, batchId });
    const batchA = add('wf_a', 0, 'b1');
    const batchB = add('wf_b', 1, 'b1');
    const plain = add('wf_c', 2);
    ok('a lane on wf_c that includes batches takes them first, by time', q2.findReady(now, ['wf_c'], { batch: 'include' }).id === batchA.id);
    ok('a lane that excludes batches takes only its own', q2.findReady(now, ['wf_a'], { batch: 'exclude' }) === null);
    ok('...and its plain job', q2.findReady(now, ['wf_c'], { batch: 'exclude' }).id === plain.id);
    ok('no policy keeps the plain filter', q2.findReady(now, ['wf_b']).id === batchB.id);
    ok('an open batch is seen', q2.hasOpenBatch() === true);

    const orphan = add('wf_gone', 3);
    const left = add('wf_c', 4);
    const cancelled = q2.cancelUnserved(['wf_c'], 'workflow-not-served');
    ok('only the unserved plain job is cancelled', cancelled.length === 1 && cancelled[0].id === orphan.id);
    ok('it carries the reason', q2.get(orphan.id).status === sm.STATES.CANCELLED && q2.get(orphan.id).errorReason === 'workflow-not-served');
    ok('a served workflow keeps its jobs', q2.get(left.id).status === sm.STATES.SCHEDULED);
    ok('batch jobs of an unserved workflow are kept', q2.get(batchA.id).status === sm.STATES.SCHEDULED);
    ok('nothing served cancels every plain job, never a batch job', q2.cancelUnserved([], 'workflow-not-served').length === 2 && q2.get(batchB.id).status === sm.STATES.SCHEDULED);

    for (const j of [batchA, batchB]) q2.transitionStatus(j.id, sm.STATES.CANCELLED);
    ok('a finished batch is no longer open', q2.hasOpenBatch() === false);
    q2.db.close();
    fs.rmSync(q2dir, { recursive: true, force: true });
}

// A job caught by a restart leaves its ComfyUI prompt to be cancelled.
{
    const running = book('lane_a', T + 100 * MIN);
    q.db.prepare('UPDATE jobs SET status=?, prompt_id=? WHERE id=?').run('executing', 'prompt-1', running.id);
    const queuedNoPrompt = book('lane_a', T + 200 * MIN);
    q.db.prepare('UPDATE jobs SET status=? WHERE id=?').run('uploading-inputs', queuedNoPrompt.id);
    ok('both in-flight jobs are reconciled', q.reconcileOnBoot() === 2);
    ok('only the job that reached ComfyUI leaves a prompt to cancel', q.staleBootPrompts.length === 1 && q.staleBootPrompts[0] === 'prompt-1');
    ok('the job reads failed', q.get(running.id).errorReason === 'server-restart' || q.get(running.id).error_reason === 'server-restart');
}

q.db.close();
fs.rmSync(dir, { recursive: true, force: true });
console.log(`jobQueue: all ${pass} checks passed`);
