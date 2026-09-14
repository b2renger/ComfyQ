// Optional image inputs — placeholder filling before submit.
//
// Run with:  node server/workers/optionalMedia.test.js

const assert = require('assert');
const { fillOptionalImages } = require('./optionalMedia');

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

if (fails) { console.error(`\n${fails} failing`); process.exit(1); }
console.log('\nall optional-media tests passed');
