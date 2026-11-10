// The run order of a batch (node server/batch/runOrder.test.js): the decision
// model on stand-in jobs, checked against brute force, then through planBatch
// with real bundles. No ComfyUI, no queue, no disk.
'use strict';
const path = require('path');
const assert = require('assert');
const { orderRun, costOf, flagsKey, RESTART_SEC } = require('./runOrder');
const { planBatch } = require('./batchPlan');
const batchQueue = require('./batchQueue');
const { WorkflowRegistry } = require('../workflows/workflowRegistry');

let passed = 0;
function test(name, fn) {
    try { fn(); passed++; }
    catch (e) { console.error(`  FAIL ${name}\n       ${e.stack || e.message}`); process.exitCode = 1; }
}

// A stand-in job: card, the rows it uses, its card's load time and flags.
const J = (key, workflowId, deps = [], { load = 10, flags = 'f' } = {}) =>
    ({ key, workflowId, flags, modelLoadSec: load, deps: deps.map(s => ({ sourceKey: s })) });
const keys = (r) => r.jobs.map(j => j.key);
const score = (jobs, opts) => { const c = costOf(jobs, opts); return c.setupSec + c.loads; };
function assertDepsFirst(order) {
    const at = new Map(order.map((j, i) => [j.key, i]));
    for (const j of order) for (const d of j.deps) {
        if (at.has(d.sourceKey)) assert.ok(at.get(d.sourceKey) < at.get(j.key), `${j.key} runs before its source ${d.sourceKey}`);
    }
}

// ---- the cost model
test('cost: a change of card is a load, a change of flags a restart, nothing loaded at the start is no restart', () => {
    const c = costOf([J('a', 'A', [], { load: 20, flags: 'x' }), J('b', 'A'), J('c', 'B', [], { load: 5, flags: 'y' })]);
    assert.deepStrictEqual(c.steps.map(s => s.setup), ['load', null, 'restart']);
    assert.strictEqual(c.loads, 2);
    assert.strictEqual(c.restarts, 1);
    assert.strictEqual(c.setupSec, 20 + 5 + RESTART_SEC);
});
test('cost: the card the lane has loaded costs nothing; other flags than the lane\'s restart it', () => {
    const jobs = [J('a', 'A', [], { flags: 'x' }), J('b', 'B', [], { flags: 'y' })];
    assert.deepStrictEqual(costOf(jobs, { start: { workflowId: 'A', flags: 'x' } }).steps.map(s => s.setup), [null, 'restart']);
    assert.deepStrictEqual(costOf(jobs, { start: { workflowId: 'C', flags: 'y' } }).steps.map(s => s.setup), ['restart', 'restart']);
    assert.deepStrictEqual(costOf(jobs, { start: { workflowId: 'C', flags: 'x' } }).steps.map(s => s.setup), ['load', 'restart']);
});

// ---- the order
test('interleaved rows are grouped: four loads become two, each film after its picture', () => {
    const jobs = [J('a', 'T2I'), J('va', 'I2V', ['a']), J('b', 'T2I'), J('vb', 'I2V', ['b'])];
    const r = orderRun(jobs);
    assert.deepStrictEqual(keys(r), ['a', 'b', 'va', 'vb']);
    assert.strictEqual(r.changed, true);
    assert.strictEqual(r.written.loads, 4);
    assert.strictEqual(r.cost.loads, 2);
    assert.strictEqual(r.exact, true);
});
test('a chain that must come back to a card does, and only as often as it must', () => {
    // hero (A) → look (B) → final (A, uses look); side (A) and extra (B) use
    // nothing. As written: A B A B A, five loads.
    const jobs = [J('hero', 'A'), J('look', 'B', ['hero']), J('side', 'A'), J('extra', 'B'), J('final', 'A', ['look'])];
    const r = orderRun(jobs);
    assertDepsFirst(r.jobs);
    assert.strictEqual(r.written.loads, 5);
    assert.deepStrictEqual(keys(r), ['hero', 'side', 'look', 'extra', 'final']);
    assert.strictEqual(r.cost.loads, 3);
});
test('an order that is already the best is kept as written', () => {
    const jobs = [J('a', 'A'), J('b', 'A'), J('c', 'B', ['a'])];
    const r = orderRun(jobs);
    assert.strictEqual(r.changed, false);
    assert.strictEqual(r.jobs, jobs, 'the same list, untouched');
});
test('a reorder that saves nothing is not made: independent cards stay in the table\'s order', () => {
    const jobs = [J('b1', 'B', [], { load: 50 }), J('a1', 'A', [], { load: 5 })];
    assert.deepStrictEqual(keys(orderRun(jobs)), ['b1', 'a1']);
});
test('cards with the same speed-up flags run together: two restarts become one', () => {
    const jobs = [J('a', 'A', [], { flags: 'sage' }), J('b', 'B', [], { flags: 'nosage' }), J('c', 'C', [], { flags: 'sage' })];
    const r = orderRun(jobs);
    assert.deepStrictEqual(keys(r), ['a', 'c', 'b']);
    assert.strictEqual(r.written.restarts, 2);
    assert.strictEqual(r.cost.restarts, 1);
});
test('the card the lane already has loaded goes first', () => {
    const jobs = [J('a', 'A'), J('x', 'X')];
    const r = orderRun(jobs, { start: { workflowId: 'X', flags: 'f' } });
    assert.deepStrictEqual(keys(r), ['x', 'a']);
    assert.strictEqual(r.cost.loads, 1);
});
test('the search beats the greedy choice when the cheap card first costs a reload', () => {
    // Greedy loads B (cheap) first, then C, then B again for b2. Loading C first
    // lets both B jobs run in one visit.
    const jobs = [J('b1', 'B', [], { load: 10 }), J('c1', 'C', [], { load: 50 }), J('b2', 'B', ['c1'], { load: 10 })];
    const r = orderRun(jobs);
    assert.deepStrictEqual(keys(r), ['c1', 'b1', 'b2']);
    assert.strictEqual(r.cost.loads, 2);
});
test('an input from a job that already ran does not hold a job back', () => {
    const jobs = [J('a', 'A'), J('b', 'B'), { ...J('c', 'A'), deps: [{ sourceJobId: 'old-job' }] }];
    assert.deepStrictEqual(keys(orderRun(jobs)), ['a', 'c', 'b']);
});

// ---- exact: brute force over every order the inputs allow, on small batches
function lcg(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }
function bestByBruteForce(jobs, opts) {
    let best = Infinity;
    const at = new Map(jobs.map((j, i) => [j.key, i]));
    const srcs = jobs.map(j => j.deps.map(d => at.get(d.sourceKey)).filter(i => i !== undefined));
    const used = new Array(jobs.length).fill(false);
    const seq = [];
    const go = () => {
        if (seq.length === jobs.length) { best = Math.min(best, score(seq.map(i => jobs[i]), opts)); return; }
        for (let i = 0; i < jobs.length; i++) {
            if (used[i] || srcs[i].some(s => !used[s])) continue;
            used[i] = true; seq.push(i); go(); seq.pop(); used[i] = false;
        }
    };
    go();
    return best;
}
test('on 400 random small batches the order is the cheapest the inputs allow, never worse than the table', () => {
    const rnd = lcg(20261110);
    for (let t = 0; t < 400; t++) {
        const n = 3 + Math.floor(rnd() * 5);                  // 3..7 jobs
        const nCards = 2 + Math.floor(rnd() * 3);             // 2..4 cards
        const cardLoad = Array.from({ length: nCards }, () => Math.floor(rnd() * 60));
        const cardFlags = Array.from({ length: nCards }, () => (rnd() < 0.3 ? 'nosage' : 'sage'));
        const jobs = [];
        for (let i = 0; i < n; i++) {
            const c = Math.floor(rnd() * nCards);
            const deps = [];
            for (let k = 0; k < i; k++) if (rnd() < 0.25) deps.push(`j${k}`);
            jobs.push(J(`j${i}`, `C${c}`, deps, { load: cardLoad[c], flags: cardFlags[c] }));
        }
        const start = rnd() < 0.3 ? { workflowId: `C${Math.floor(rnd() * nCards)}`, flags: rnd() < 0.5 ? 'sage' : 'nosage' } : null;
        const r = orderRun(jobs, { start });
        assertDepsFirst(r.jobs);
        assert.strictEqual(r.jobs.length, n);
        assert.strictEqual(new Set(keys(r)).size, n);
        const got = score(r.jobs, { start });
        assert.ok(got <= score(jobs, { start }), `case ${t}: worse than the table`);
        assert.strictEqual(got, bestByBruteForce(jobs, { start }), `case ${t}: not the cheapest order (${keys(r).join(' ')})`);
        assert.strictEqual(r.exact, true);
    }
});

test('a large batch is ordered quickly and stays correct', () => {
    const rnd = lcg(7);
    const jobs = [];
    for (let i = 0; i < 500; i++) {
        const c = Math.floor(rnd() * 10);
        const deps = i > 0 && rnd() < 0.5 ? [`j${Math.floor(rnd() * i)}`] : [];
        jobs.push(J(`j${i}`, `C${c}`, deps, { load: 5 + c * 7, flags: c % 4 === 0 ? 'nosage' : 'sage' }));
    }
    const t0 = Date.now();
    const r = orderRun(jobs);
    const ms = Date.now() - t0;
    assertDepsFirst(r.jobs);
    assert.strictEqual(r.jobs.length, 500);
    assert.ok(r.cost.loads < r.written.loads, `${r.cost.loads} loads, the table ${r.written.loads}`);
    assert.ok(ms < 3000, `took ${ms} ms`);
});

// ---- the flags
const registry = new WorkflowRegistry(path.resolve(__dirname, '..', '..', 'workflows'));
registry.discover();
test('flags: a card that disowns Sage differs from one that does not only when the rig runs Sage', () => {
    const moss = registry.get('image_moss_image_t2i').meta;
    const ideo = registry.get('image_ideogram4_t2i').meta;
    assert.notStrictEqual(flagsKey(moss, { use_sage_attention: true, fp16_accumulation: true }),
        flagsKey(ideo, { use_sage_attention: true, fp16_accumulation: true }));
    assert.strictEqual(flagsKey(moss, { use_sage_attention: false, fp16_accumulation: true }),
        flagsKey(ideo, { use_sage_attention: false, fp16_accumulation: true }));
});

// ---- through planBatch, with real cards
const T2I = 'image_moss_image_t2i';
const I2V = 'video_ltx2_5_i2v';
const TABLE = `id,workflow,prompt,image\na,${T2I},one,\nva,${I2V},film one,a\nb,${T2I},two,\nvb,${I2V},film two,b\n`;
const envFor = (extra) => {
    const rnd = lcg(3);
    return { assetExists: () => false, listAssets: () => null, random: rnd, ...extra };
};
test('planBatch: the table\'s order unless asked; asked, the same jobs and seeds in fewer loads', () => {
    const written = planBatch(TABLE, registry, envFor({}));
    const best = planBatch(TABLE, registry, envFor({ order: 'fewest-loads' }));
    assert.deepStrictEqual(written.errors, []);
    assert.deepStrictEqual(written.jobs.map(j => j.key), ['a', 'va', 'b', 'vb']);
    assert.strictEqual(written.modelLoads, 4);
    assert.strictEqual(written.ordering, null);
    assert.deepStrictEqual(best.jobs.map(j => j.key), ['a', 'b', 'va', 'vb']);
    assert.strictEqual(best.modelLoads, 2);
    assert.deepStrictEqual(best.jobs.map(j => j.writtenOrder), [0, 2, 1, 3]);
    assert.deepStrictEqual(best.ordering && { changed: best.ordering.changed, loads: best.ordering.written.loads }, { changed: true, loads: 4 });
    assert.ok(best.ordering.savedSec > 0);
    assert.ok(best.totalEstimatedSec < written.totalEstimatedSec);
    const seeds = (p) => Object.fromEntries(p.jobs.map(j => [j.key, JSON.stringify(j.paramValues)]));
    assert.deepStrictEqual(seeds(best), seeds(written), 'the order does not change what each job runs with');
});
test('planBatch: serving the video card, the batch starts with what it can run on it', () => {
    const p = planBatch(TABLE, registry, envFor({ order: 'fewest-loads', startWorkflowId: I2V }));
    assert.deepStrictEqual(p.jobs.map(j => j.key), ['a', 'b', 'va', 'vb'], 'nothing on the video card is ready first');
    const q = planBatch(`id,workflow,prompt\nx,${T2I},one\ny,${T2I},two\n`, registry,
        envFor({ order: 'fewest-loads', startWorkflowId: T2I }));
    assert.strictEqual(q.modelLoads, 0, 'every job on the card already loaded');
});
test('preview and timeline follow the order: each gap is the job before plus what loads before this one', () => {
    const p = planBatch(TABLE, registry, envFor({ order: 'fewest-loads' }));
    const pv = batchQueue.toPreview(p, registry);
    assert.strictEqual(pv.ordering.changed, true);
    assert.deepStrictEqual(pv.jobs.map(j => j.setup), ['load', null, 'load', null]);
    const rows = batchQueue.buildInserts(p, { batchId: 'b', batchLabel: 't.csv', folder: 't', userId: 'u', startAt: 1000 });
    for (let i = 1; i < rows.length; i++) {
        const want = Math.max(1, Math.round(((p.jobs[i - 1].estimatedDurationSec || 0) + (p.jobs[i].setupSec || 0)) * 1000));
        assert.strictEqual(rows[i].scheduledAt - rows[i - 1].scheduledAt, want);
    }
    assert.ok(rows[2].deps[0].sourceJobId === rows[0].id, 'va still reads a');
    assert.ok(rows[1].outputPrefix.includes('002_b__'), 'the output numbering is the run order');
});

console.log(`runOrder: ${passed} ok${process.exitCode ? ', with failures' : ''}`);
