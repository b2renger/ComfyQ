// The batch editor's table model (node client/src/utils/batchTable.test.mjs).
import assert from 'assert';
import { parseCsv, tableFromCsv, csvFromRows, columnsFor, parseRef, formatRef, sourceRows, freeId } from './batchTable.js';

let passed = 0;
const test = (name, fn) => {
    try { fn(); passed++; } catch (e) { console.error(`  FAIL ${name}\n       ${e.message}`); process.exitCode = 1; }
};

test('a table survives a round trip: quotes, commas, line breaks, accents', () => {
    const text = 'id,workflow,prompt,image,steps_107,notes\r\nhero,moss,"one, two ""three""\nand a line",,30,\r\nlook,klein,"Éclairage doux",hero#2,,keep\r\n';
    const { rows } = tableFromCsv(text);
    assert.strictEqual(rows.length, 2);
    assert.strictEqual(rows[0].cells.prompt, 'one, two "three"\nand a line');
    const again = tableFromCsv(csvFromRows(rows)).rows;
    assert.deepStrictEqual(again.map(r => r.cells), rows.map(r => r.cells));
});
test('a French spreadsheet: semicolons and a byte-order mark', () => {
    const { rows } = tableFromCsv('﻿id;workflow;prompt\nhero;moss;un, deux\n');
    assert.deepStrictEqual(rows[0].cells, { id: 'hero', workflow: 'moss', prompt: 'un, deux' });
});
test('comment and empty rows are not rows; an unclosed quote is refused', () => {
    const { rows, skipped } = tableFromCsv('id,workflow\n# a note\n,\nhero,moss\n');
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(skipped, 1);
    assert.throws(() => parseCsv('a,b\n"open,x\n'), /Row 2/);
});
test('columns: lead, inputs in type order, settings as first seen, tail; empty ones dropped', () => {
    const rows = [
        { cells: { workflow: 'a', id: 'x', notes: 'n', image2: 'y', steps_1: '3', image: 'file:a.png' } },
        { cells: { workflow: 'b', id: 'y', video: 'x', cfg_2: '1', prompt: 'p', seed: '' } },
    ];
    assert.deepStrictEqual(columnsFor(rows), ['id', 'workflow', 'prompt', 'image', 'image2', 'video', 'steps_1', 'cfg_2', 'notes']);
});
test('input cells read and written back unchanged', () => {
    for (const v of ['', 'hero', 'hero#2', 'hero.3', 'hero.3#2', 'file:shots/a.png', 'folder:Keyframes/', 'job:3f2a9c1e#2']) {
        assert.strictEqual(formatRef(parseRef(v)), v, v);
    }
    assert.deepStrictEqual(parseRef('hero.3#2'), { type: 'row', row: 'hero', copy: 3, output: 2 });
    assert.deepStrictEqual(parseRef('12 bad'), { type: 'raw', raw: '12 bad' }, 'kept as typed for the server to explain');
    assert.strictEqual(formatRef({ type: 'row', row: 'hero', copy: null, output: 1 }), 'hero');
});
test('a row can take its file from rows whose card makes that kind, not from itself', () => {
    const cards = [{ id: 't2i', produces: 'image' }, { id: 'i2v', produces: 'video' }];
    const rows = [
        { uid: 'a', cells: { id: 'hero', workflow: 't2i' } },
        { uid: 'b', cells: { id: 'move', workflow: 'i2v' } },
        { uid: 'c', cells: { id: 'later', workflow: 't2i' } },
    ];
    assert.deepStrictEqual(sourceRows(rows, cards, 'a', 'image').map(r => r.cells.id), ['later']);
    assert.deepStrictEqual(sourceRows(rows, cards, 'b', 'image').map(r => r.cells.id), ['hero', 'later']);
});
test('a free id', () => {
    const rows = [{ cells: { id: 'row1' } }, { cells: { id: 'hero' } }];
    assert.strictEqual(freeId(rows), 'row2');
    assert.strictEqual(freeId(rows, 'hero'), 'hero2');
    assert.strictEqual(freeId(rows, 'move'), 'move');
});

console.log(`batchTable: ${passed} ok${process.exitCode ? ', with failures' : ''}`);
