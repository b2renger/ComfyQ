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
