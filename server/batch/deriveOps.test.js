// Steps that prepare a file, as a cell writes them (node server/batch/deriveOps.test.js).
'use strict';
const assert = require('assert');
const { parseOp, formatOp, splitPipeline, formatPipeline, outputKind, extraAssets, SIGNATURES } = require('./deriveOps');
const { DERIVE_OPS } = require('../benchmark/suitePlan');

let passed = 0;
const test = (name, fn) => {
    try { fn(); passed++; } catch (e) { console.error(`  FAIL ${name}\n       ${e.message}`); process.exitCode = 1; }
};

// One example of every operation, as the test suite writes it.
const EVERY = [
    { op: 'frame', index: 0 },
    { op: 'crop', box: [0.34, 0, 0.565, 1] },
    { op: 'flip' },
    { op: 'scale', factor: 0.296296 },
    { op: 'blur', radius: 1.2 },
    { op: 'transparent', shape: 'ellipse', box: [0.03, 0.7, 0.24, 0.86] },
    { op: 'circle', box: [0.25, 0.25, 0.69, 0.48], color: '#FF0000' },
    { op: 'composite', overlay: 'asset:6504516c0115ed9b83b2d82e1d94c4ec.webp', box: [0.07, 0.64, 0.33, 0.97] },
    { op: 'jpeg', quality: 40 },
    { op: 'noise', sigma: 8, seed: 1 },
    { op: 'trim', start: 3, duration: 2 },
    { op: 'vscale', factor: 0.375 },
    { op: 'vblur', radius: 1 },
    { op: 'mute' },
    { op: 'encode', crf: 35 },
];

test('every operation the suite uses is known here, and the other way round', () => {
    assert.deepStrictEqual(Object.keys(SIGNATURES).sort(), [...DERIVE_OPS].sort());
    assert.deepStrictEqual(EVERY.map(o => o.op).sort(), [...DERIVE_OPS].sort());
});
test('every operation reads back as it was written', () => {
    for (const op of EVERY) assert.deepStrictEqual(parseOp(formatOp(op)), op, formatOp(op));
    assert.strictEqual(formatOp({ op: 'flip' }), 'flip');
    assert.strictEqual(formatOp({ op: 'composite', overlay: 'asset:a.webp', box: [0, 0, 1, 1] }), 'composite(file:a.webp, 0, 0, 1, 1)');
});
test('a cell: a file, then its steps', () => {
    const cell = 'file:clip.mp4 | frame(0) | crop(0, 0.16, 1, 0.91)';
    const { base, ops } = splitPipeline(cell);
    assert.strictEqual(base, 'file:clip.mp4');
    assert.deepStrictEqual(ops, [{ op: 'frame', index: 0 }, { op: 'crop', box: [0, 0.16, 1, 0.91] }]);
    assert.strictEqual(formatPipeline(base, ops), cell);
    assert.deepStrictEqual(splitPipeline('file:a.png').ops, []);
});
test('what the steps make, and what they cannot take', () => {
    assert.strictEqual(outputKind('video', [{ op: 'frame', index: 0 }, { op: 'crop', box: [0, 0, 1, 1] }]), 'image');
    assert.strictEqual(outputKind('video', [{ op: 'trim', start: 0 }, { op: 'mute' }]), 'video');
    assert.strictEqual(outputKind('image', []), 'image');
    assert.throws(() => outputKind('video', [{ op: 'scale', factor: 0.5 }]), /take a frame/);
    assert.throws(() => outputKind('image', [{ op: 'trim', start: 0 }]), /works on a video/);
    assert.throws(() => outputKind('image', [{ op: 'frame', index: 0 }]), /on a video/);
    assert.throws(() => outputKind('video', [{ op: 'mute' }, { op: 'frame', index: 0 }]), /comes first/);
});
test('a step written wrong says how to write it', () => {
    assert.throws(() => parseOp('zoom(2)'), /"zoom" is not an operation/);
    assert.throws(() => parseOp('crop(0, 0, 1)'), /four numbers/);
    assert.throws(() => parseOp('scale(big)'), /factor is a number/);
    assert.throws(() => parseOp('scale(0.5, 2)'), /extra/);
    assert.throws(() => parseOp('transparent(star, 0, 0, 1, 1)'), /rect or ellipse/);
    assert.throws(() => parseOp('scale'), /scale needs factor/);
});
test('a composite names its overlay as an asset', () => {
    assert.deepStrictEqual(extraAssets([parseOp('composite(file:a.webp, 0, 0, 1, 1)')]), ['a.webp']);
});

console.log(`deriveOps: ${passed} ok${process.exitCode ? ', with failures' : ''}`);
