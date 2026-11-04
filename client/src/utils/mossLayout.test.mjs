/**
 * The MOSS layout composer writes two fields: the boxes (JSON for ComfyUI's
 * Create Bounding Boxes node) and the character box numbers (the layout
 * node's `character_boxes`). Both are read back when the composer reopens, so
 * a round trip must give the same boxes and the same characters.
 */
import assert from 'node:assert';
import {
    readLayout, layoutToElements, elementsToLayout, formatLayout, checkLayout, describeLayout, parseCharacters,
} from './mossLayout.js';

const raw = [
    { type: 'obj', bbox: [0, 0, 1000, 1000], desc: 'Overgrown ruin' },
    { type: 'text', bbox: [20, 50, 150, 950], text: 'MOSS', desc: 'Cream serif capitals', color_palette: ['#f5e6c8'] },
    { type: 'obj', bbox: [180, 140, 1000, 920], desc: 'A kneeling knight' },
];

// Round trip: the text, the box numbers and the character flags survive.
const els = layoutToElements(raw, '3');
assert.deepStrictEqual(els.map(e => e.character), [false, false, true]);
const back = elementsToLayout(els);
assert.strictEqual(back.characters, '3');
assert.deepStrictEqual(back.list[1], { type: 'text', bbox: [20, 50, 150, 950], text: 'MOSS', desc: 'Cream serif capitals', color_palette: ['#F5E6C8'] });
assert.deepStrictEqual(back.list[0], raw[0]);

// A text box can never be a character: the node only labels object boxes.
assert.deepStrictEqual(layoutToElements(raw, '2').map(e => e.character), [false, false, false]);

// Character numbers count every box, text boxes included (the node uses i + 1).
assert.deepStrictEqual([...parseCharacters('1, 3 and 12')], [1, 3, 12]);

// No boxes is an empty string, which the layout node passes through.
assert.strictEqual(formatLayout([]), '');
assert.strictEqual(describeLayout('').level, 'none');

// Accepted shapes.
assert.strictEqual(readLayout(JSON.stringify(raw)).kind, 'list');
assert.strictEqual(readLayout(JSON.stringify({ elements: raw })).kind, 'list');
assert.strictEqual(readLayout(JSON.stringify({ compositional_deconstruction: { elements: raw } })).kind, 'list');
assert.strictEqual(readLayout('[1,').kind, 'broken');
assert.strictEqual(readLayout('{"a":1}').kind, 'other');
assert.strictEqual(describeLayout('[1,').level, 'error');

// The checks the node would otherwise fail on, or quietly ignore.
assert.deepStrictEqual(checkLayout(raw), []);
assert.strictEqual(describeLayout(JSON.stringify(raw)).short, '3 boxes ✓');
const bad = checkLayout([{ type: 'text', desc: '' }, { type: 'obj', bbox: [500, 0, 400, 10], desc: 'x' }]);
assert.ok(bad.some(w => /Box 1: needs a box/.test(w)), 'missing box');
assert.ok(bad.some(w => /Box 1: a text box needs the words/.test(w)), 'text without words');
assert.ok(bad.some(w => /Box 1: add a description/.test(w)), 'no description');
assert.ok(bad.some(w => /Box 2: the box's min/.test(w)), 'inverted box');

console.log('mossLayout: all checks passed');
