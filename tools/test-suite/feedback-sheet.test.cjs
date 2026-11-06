// The owner's feedback sheet (node tools/test-suite/feedback-sheet.test.cjs).
'use strict';
const assert = require('assert');
const { sheet } = require('./feedback-sheet.cjs');

const suite = { runs: [
    { id: 'a', workflow: 'a', stage: 'One', note: 'Listen for the bell.' },
    { id: 'b', workflow: 'b', stage: 'One', note: 'Count the fingers.' },
    { id: 'c', workflow: 'c', stage: 'Two', note: null },
    { id: 'a@fast-off', workflow: 'a', variant: 'fast-off', stage: 'Two', note: 'Listen too.' },
    { id: 'd', workflow: 'd', stage: 'Two', note: null },
] };
const report = { finishedAt: '2026-11-07T03:00:00Z', results: [
    { id: 'a', name: 'Card A', ok: true, outputs: [{ file: 'a.mp4' }], flagged: [] },
    { id: 'b', name: 'Card B', ok: false, skipped: true, error: 'skipped — no asset' },
    { id: 'c', name: 'Card C', ok: true, outputs: [{ file: 'c.png' }], flagged: [{ flags: ['black'] }] },
    { id: 'a@fast-off', name: 'Card A', ok: true, outputs: [] },
] };
const { text, date, runs, listen } = sheet(suite, report);
assert.strictEqual(date, '2026-11-07');
assert.strictEqual(runs, 5);
assert.strictEqual(listen, 1, 'a variant is not a card to listen to first');
assert.ok(text.indexOf('## One') < text.indexOf('## Two'), 'in suite order');
assert.ok(/### 4\. Card A \(fast-off\)/.test(text), 'a variant says which');
assert.ok(text.includes('Skipped: skipped — no asset'), 'a skipped run says why');
assert.ok(text.includes('flagged it: black'), 'a flag is shown');
assert.ok(text.includes('No result: this run is not in the report'), 'a run with no row is not silently dropped');
assert.strictEqual(text.split('Verdict =>').length - 1, 5, 'every run can be answered');
console.log('feedback-sheet: ok');
