// Unit test for the incremental state protocol (run: node client/src/utils/mergeState.test.mjs)
import assert from 'node:assert';
import { mergeState, applyPatch } from './mergeState.js';

const base = mergeState(null, {
    system_status: 'ready', benchmark_ms: 1000, connected_users: [{ socketId: 's1', userId: 'ada' }],
    jobs: [
        { id: 'a', user_id: 'ada', status: 'completed', progress: null },
        { id: 'b', user_id: 'bo', status: 'processing', progress: { value: 1, max: 20 } },
    ],
    workflow: { parameter_map: { prompt: { type: 'textarea' } } },
    workflow_info: { id: 'wf1', name: 'One' },
    seq: 7,
});

// 1. a progress tick touches one job and nothing else
const t1 = applyPatch(base, { seq: 8, jobs: [{ ...base.jobs[1], progress: { value: 9, max: 20 } }] });
assert.notStrictEqual(t1, base, 'state should change');
assert.strictEqual(t1.jobs[0], base.jobs[0], 'untouched job keeps identity (card must not re-render)');
assert.strictEqual(t1.jobs[1].progress.value, 9);
assert.strictEqual(t1.workflow, base.workflow, 'parameter_map keeps identity (open form must not reset)');
assert.strictEqual(t1.workflow_info, base.workflow_info);
assert.strictEqual(t1.connected_users, base.connected_users);
assert.strictEqual(t1.jobs.length, 2);

// 2. a head-only patch leaves every job identical
const t2 = applyPatch(t1, { seq: 9, connected_users: [{ socketId: 's1', userId: 'ada' }, { socketId: 's2', userId: 'bo' }] });
assert.strictEqual(t2.jobs, t1.jobs, 'job array identity kept when only the head moved');
assert.strictEqual(t2.connected_users.length, 2);

// 3. a new job is appended; a removed one goes
const t3 = applyPatch(t2, { seq: 10, jobs: [{ id: 'c', user_id: 'cy', status: 'scheduled' }], removed_jobs: ['a'] });
assert.deepStrictEqual(t3.jobs.map(j => j.id), ['b', 'c'], 'removed dropped, new appended in server order');

// 4. a patch that changes nothing returns the SAME object (no render at all)
const t4 = applyPatch(t3, { seq: 11, jobs: [t3.jobs[0]] });
assert.strictEqual(t4, t3, 'an identical job must not produce a new state');

// 5. a patch repeating what a fresh snapshot already had is idempotent
//    (the race when a tab connects mid-flight)
const snap = mergeState(t3, { ...t3, jobs: [...t3.jobs], seq: 12 });
const t5 = applyPatch(snap, { seq: 13, jobs: [{ ...t3.jobs[1] }] });
assert.strictEqual(t5, snap, 'replaying a job the client already has changes nothing');

// 6. removing an unknown id is harmless
const t6 = applyPatch(t5, { seq: 14, removed_jobs: ['nope'] });
assert.strictEqual(t6, t5);

// 7. a full snapshot still works and reuses identities
const t7 = mergeState(t3, {
    system_status: 'ready', benchmark_ms: 1000, connected_users: t3.connected_users,
    jobs: t3.jobs.map(j => ({ ...j })), workflow: { parameter_map: { prompt: { type: 'textarea' } } },
    workflow_info: { id: 'wf1', name: 'One' }, seq: 15,
});
assert.strictEqual(t7, t3, 'an unchanged full snapshot is a no-op');

console.log('mergeState/applyPatch: all 7 checks passed');
