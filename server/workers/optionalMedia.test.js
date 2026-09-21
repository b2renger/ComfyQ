// Optional image inputs — placeholder filling before submit.
//
// Run with:  node server/workers/optionalMedia.test.js

const assert = require('assert');
const { fillOptionalImages, unlinkEmptyMedia } = require('./optionalMedia');

let fails = 0;
function test(name, fn) {
    try { fn(); console.log(`  ok   ${name}`); }
    catch (e) { console.error(`  FAIL ${name}\n       ${e.message}`); fails++; }
}

const PH = 'comfyq_placeholder.png';
const video = { key: 'vid', type: 'video', required: true, default: '' };
const toggle = { key: 'use_start', type: 'checkbox', label: 'Use the start image', default: false };
const startImage = {
    key: 'start', type: 'image', required: false, label: 'Start image', default: '',
    disabledWhen: { param: 'use_start', equals: false }
};

test('optional image left empty with its toggle off gets the placeholder', () => {
    const r = fillOptionalImages({ exposedParameters: [video, toggle, startImage], paramValues: { vid: 'a.mp4', use_start: false }, placeholderName: PH });
    assert.deepStrictEqual(r.errors, []);
    assert.strictEqual(r.paramValues.start, PH);
    assert.strictEqual(r.filled, 1);
});

test('toggle missing from the booking falls back to its default (off)', () => {
    const r = fillOptionalImages({ exposedParameters: [video, toggle, startImage], paramValues: { vid: 'a.mp4' }, placeholderName: PH });
    assert.strictEqual(r.paramValues.start, PH);
});

test('toggle on without an upload is an error, not a placeholder', () => {
    const r = fillOptionalImages({ exposedParameters: [video, toggle, startImage], paramValues: { vid: 'a.mp4', use_start: true }, placeholderName: PH });
    assert.strictEqual(r.errors.length, 1);
    assert.match(r.errors[0], /Start image.*Use the start image/);
    assert.strictEqual(r.paramValues.start, undefined);
});

test('an uploaded optional image is left alone', () => {
    const r = fillOptionalImages({ exposedParameters: [video, toggle, startImage], paramValues: { vid: 'a.mp4', use_start: true, start: 'me.png' }, placeholderName: PH });
    assert.deepStrictEqual(r.errors, []);
    assert.strictEqual(r.paramValues.start, 'me.png');
    assert.strictEqual(r.filled, 0);
});

test('required media is never filled (an empty one stays empty)', () => {
    const r = fillOptionalImages({ exposedParameters: [video], paramValues: {}, placeholderName: PH });
    assert.strictEqual(r.paramValues.vid, undefined);
    assert.strictEqual(r.filled, 0);
});

test('optional image without a gate always gets the placeholder', () => {
    const plain = { key: 'ref', type: 'image', required: false };
    const r = fillOptionalImages({ exposedParameters: [plain], paramValues: {}, placeholderName: PH });
    assert.strictEqual(r.paramValues.ref, PH);
});

test('a gate whose toggle is not exposed counts as off', () => {
    const r = fillOptionalImages({ exposedParameters: [startImage], paramValues: {}, placeholderName: PH });
    assert.deepStrictEqual(r.errors, []);
    assert.strictEqual(r.paramValues.start, PH);
});

test('optional video is not placeholder-filled (no neutral video file exists)', () => {
    const optVideo = { key: 'v2', type: 'video', required: false };
    const r = fillOptionalImages({ exposedParameters: [optVideo], paramValues: {}, placeholderName: PH });
    assert.strictEqual(r.paramValues.v2, undefined);
});

test('the caller\'s paramValues object is not mutated', () => {
    const pv = { vid: 'a.mp4' };
    fillOptionalImages({ exposedParameters: [video, toggle, startImage], paramValues: pv, placeholderName: PH });
    assert.deepStrictEqual(pv, { vid: 'a.mp4' });
});


// --- unused reference slots are removed, not placeholder-filled -------------
// Qwen Image 2.1 takes up to ten reference pictures on an AUTOGROW input. A
// placeholder there would be USED as a reference picture, so an empty slot has
// to leave the graph instead of being filled.
const refGraph = () => ({
    '1': { class_type: 'LoadImage', inputs: { image: 'a.png' } },
    '2': { class_type: 'LoadImage', inputs: { image: 'b.png' } },
    '3': { class_type: 'LoadImage', inputs: { image: 'c.png' } },
    '9': {
        class_type: 'TextEncodeQwenImage21',
        inputs: { prompt: 'x', 'images.image_1': ['1', 0], 'images.image_2': ['2', 0], 'images.image_3': ['3', 0] },
    },
    '10': { class_type: 'SaveImage', inputs: { images: ['9', 0] } },
});
const refParams = [
    { key: 'img1', nodeId: '1', field: 'image', type: 'image', required: true },
    { key: 'img2', nodeId: '2', field: 'image', type: 'image', required: false, whenEmpty: 'unlink' },
    { key: 'img3', nodeId: '3', field: 'image', type: 'image', required: false, whenEmpty: 'unlink' },
];

test('an empty reference slot loses its loader and its link', () => {
    const r = unlinkEmptyMedia({ apiWorkflow: refGraph(), exposedParameters: refParams, paramValues: { img1: 'p.png' } });
    assert.strictEqual(r.workflow['2'], undefined);
    assert.strictEqual(r.workflow['3'], undefined);
    assert.strictEqual(r.workflow['9'].inputs['images.image_2'], undefined);
    assert.strictEqual(r.workflow['9'].inputs['images.image_3'], undefined);
    assert.deepStrictEqual(r.unlinked.slice().sort(), ['img2', 'img3']);
});

test('a slot that was filled stays wired', () => {
    const r = unlinkEmptyMedia({ apiWorkflow: refGraph(), exposedParameters: refParams, paramValues: { img1: 'p.png', img2: 'q.png' } });
    assert.ok(r.workflow['2'], 'the filled loader survives');
    assert.deepStrictEqual(r.workflow['9'].inputs['images.image_2'], ['2', 0]);
    assert.strictEqual(r.workflow['3'], undefined);
    assert.deepStrictEqual(r.unlinked, ['img3']);
});

test('the required image is never unlinked', () => {
    const r = unlinkEmptyMedia({ apiWorkflow: refGraph(), exposedParameters: refParams, paramValues: {} });
    assert.ok(r.workflow['1'], 'image 1 stays even with nothing booked');
    assert.deepStrictEqual(r.workflow['9'].inputs['images.image_1'], ['1', 0]);
});

test('a param without whenEmpty keeps the placeholder behaviour', () => {
    const plain = [{ key: 'img2', nodeId: '2', field: 'image', type: 'image', required: false }];
    const r = unlinkEmptyMedia({ apiWorkflow: refGraph(), exposedParameters: plain, paramValues: {} });
    assert.ok(r.workflow['2'], 'untouched without the opt-in');
    assert.deepStrictEqual(r.unlinked, []);
});

test('the caller\'s graph is not mutated', () => {
    const g = refGraph();
    unlinkEmptyMedia({ apiWorkflow: g, exposedParameters: refParams, paramValues: {} });
    assert.ok(g['2'] && g['3'], 'the original graph still has every loader');
});

test('nothing to unlink returns the same graph object', () => {
    const g = refGraph();
    const r = unlinkEmptyMedia({ apiWorkflow: g, exposedParameters: refParams, paramValues: { img2: 'a', img3: 'b' } });
    assert.strictEqual(r.workflow, g);
});

if (fails) { console.error(`\n${fails} failing`); process.exit(1); }
console.log('\nall optional-media tests passed');
