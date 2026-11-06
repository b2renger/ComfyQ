// node tools/maintenance/publish_partial_sweep.test.cjs
//
// What a rescued sweep publishes. The case that matters: rescuing a SECOND
// killed run (the "Run the remaining N" after a first rescue) must keep the rows
// the first rescue published, or the card offers to re-run them and the wipe
// deletes their outputs.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildReport, reportPathFor } = require('./publish_partial_sweep.cjs');

let passed = 0;
function check(name, fn) {
    try { fn(); passed++; console.log('  ok  ' + name); }
    catch (e) { console.error('  FAIL ' + name + '\n       ' + e.message); process.exitCode = 1; }
}

const LIB = ['a', 'b', 'c', 'd', 'e'];
const row = (id, t = '2026-11-05T10:00:00.000Z') => ({ id, ok: true, startedAt: t, finishedAt: t, outputs: [] });
const summarize = (rows) => ({ ran: rows.length });
const jsonl = (head, ids) => [{ type: 'start', at: '2026-11-05T09:00:00.000Z', ...head },
    ...ids.map(id => ({ type: 'bundle', ...row(id) }))];
const ids = (r) => r.report.results.map(x => x.id).join(',');

console.log('publish_partial_sweep');

check('a killed FULL run replaces the published report (the continuation case)', () => {
    const prev = { results: LIB.map(id => row(id, '2026-11-01T00:00:00.000Z')) };
    const r = buildReport({ lines: jsonl({ bundles: 5 }, ['a', 'b']), prev, libraryIds: LIB, jsonlName: 'run2.jsonl', summarize });
    assert.strictEqual(ids(r), 'a,b');
    assert.strictEqual(r.carried, 0);
    assert.deepStrictEqual(r.report.summary, { ran: 2 });
});

check('a killed SUBSET run keeps the rows a first rescue published (old .jsonl, count only)', () => {
    const prev = { state: 'partial', recoveredFrom: 'run1.jsonl', startedAt: '2026-11-05T08:00:00.000Z', results: [row('a'), row('b')] };
    const r = buildReport({ lines: jsonl({ bundles: 3 }, ['c']), prev, libraryIds: LIB, jsonlName: 'run2.jsonl', summarize });
    assert.strictEqual(ids(r), 'a,b,c');
    assert.strictEqual(r.carried, 2);
    assert.strictEqual(r.report.recoveredFrom, 'run1.jsonl + run2.jsonl');
    assert.strictEqual(r.report.startedAt, '2026-11-05T08:00:00.000Z', 'starts when the earliest kept row started');
});

check('with planned ids, a planned-but-unreached bundle stays missing so it is offered again', () => {
    const prev = { results: LIB.map(id => row(id)) };
    const r = buildReport({ lines: jsonl({ bundles: 3, ids: ['c', 'd', 'e'] }, ['c']), prev, libraryIds: LIB, jsonlName: 'x.jsonl', summarize });
    assert.strictEqual(ids(r), 'a,b,c');
});

check('a row for a workflow deleted since is not carried', () => {
    const prev = { results: [row('a'), row('gone')] };
    const r = buildReport({ lines: jsonl({ bundles: 1 }, ['b']), prev, libraryIds: LIB, jsonlName: 'x.jsonl', summarize });
    assert.strictEqual(ids(r), 'a,b');
});

check('the fresh row wins over the published one for the same bundle', () => {
    const prev = { results: [{ ...row('a'), ok: false }] };
    const r = buildReport({ lines: jsonl({ bundles: 1 }, ['a']), prev, libraryIds: LIB, jsonlName: 'x.jsonl', summarize });
    assert.strictEqual(r.report.results.length, 1);
    assert.strictEqual(r.report.results[0].ok, true);
});

check('a rescued suite run publishes its suite, so "Run the remaining N" continues the suite', () => {
    const r = buildReport({ lines: jsonl({ bundles: 5, suite: { name: 'library', file: 'library.suite.json' } }, ['a']),
        prev: null, libraryIds: LIB, jsonlName: 'x.jsonl', summarize });
    assert.strictEqual(r.report.suite && r.report.suite.name, 'library');
});

check('a rescued plain sweep publishes no suite', () => {
    const r = buildReport({ lines: jsonl({ bundles: 5 }, ['a']), prev: null, libraryIds: LIB, jsonlName: 'x.jsonl', summarize });
    assert.strictEqual(r.report.suite, null);
});

check('a .jsonl with no bundle rows is refused', () => {
    assert.throws(() => buildReport({ lines: jsonl({ bundles: 5 }, []), prev: null, libraryIds: LIB, jsonlName: 'x', summarize }));
});

check('a .jsonl in another folder (a --data-dir experiment) publishes into that folder, not server/data', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'comfyq-pps-'));
    try {
        const out = reportPathFor(path.join(dir, 'library-sweep-2026-11-05T10-00-00-000Z.jsonl'));
        assert.strictEqual(out, path.join(dir, 'library-sweep-latest.json'));
        assert.ok(!out.includes(path.join('server', 'data')), out);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

check('the ordinary server/data .jsonl still publishes the server/data report', () => {
    const data = path.resolve(__dirname, '..', '..', 'server', 'data');
    assert.strictEqual(reportPathFor(path.join(data, 'library-sweep-x.jsonl')), path.join(data, 'library-sweep-latest.json'));
});

console.log(`${passed} passed`);
