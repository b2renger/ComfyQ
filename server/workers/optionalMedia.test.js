// Optional image inputs — placeholder filling before submit.
//
// Run with:  node server/workers/optionalMedia.test.js

const assert = require('assert');
const { fillOptionalImages, unlinkEmptyMedia, applyWhenEmptySet } = require('./optionalMedia');

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

// --- whenEmptySet: an empty param flips the graph onto its other branch -----
//
// Why this matters concretely: with every reference slot unlinked,
// TextEncodeQwenImage21's latent output is a fixed 1024x1024 square, so an edit
// bundle with no pictures would silently ignore the student's aspect ratio.
// Measured on the rig - the same prompt at "16:9" came back 1024x1024.
const branchGraph = () => ({
    '1': { class_type: 'LoadImage', inputs: { image: 'a.png' } },
    '9': { class_type: 'TextEncodeQwenImage21', inputs: { prompt: 'x', 'images.image_1': ['1', 0] } },
    '13': { class_type: 'ResolutionSelector', inputs: { aspect_ratio: '16:9 (Widescreen)' } },
    '56': { class_type: 'EmptyLatentImage', inputs: { width: ['13', 0], height: ['13', 1] } },
    '68': { class_type: 'ComfySwitchNode', inputs: { switch: false, on_false: ['9', 2], on_true: ['56', 0] } },
});
const branchParams = [{
    key: 'img1', nodeId: '1', field: 'image', type: 'image', required: false, whenEmpty: 'unlink',
    whenEmptySet: [{ nodeId: '68', field: 'switch', value: true }],
}];

test('an empty param sets the fields it declares', () => {
    const r = applyWhenEmptySet({ apiWorkflow: branchGraph(), exposedParameters: branchParams, paramValues: {} });
    assert.strictEqual(r.workflow['68'].inputs.switch, true);
    assert.strictEqual(r.applied.length, 1);
});

test('a filled param leaves the graph on its normal branch', () => {
    const r = applyWhenEmptySet({ apiWorkflow: branchGraph(), exposedParameters: branchParams, paramValues: { img1: 'photo.png' } });
    assert.strictEqual(r.workflow['68'].inputs.switch, false);
    assert.deepStrictEqual(r.applied, []);
});

test('unlink and whenEmptySet agree on what "empty" means', () => {
    // The pair must fire together: a slot unlinked without its switch flipped
    // is exactly the broken graph this exists to prevent.
    const pv = {};
    const pruned = unlinkEmptyMedia({ apiWorkflow: branchGraph(), exposedParameters: branchParams, paramValues: pv });
    const out = applyWhenEmptySet({ apiWorkflow: pruned.workflow, exposedParameters: branchParams, paramValues: pv });
    assert.strictEqual(out.workflow['1'], undefined, 'loader gone');
    assert.strictEqual(out.workflow['9'].inputs['images.image_1'], undefined, 'link gone');
    assert.strictEqual(out.workflow['68'].inputs.switch, true, 'switch flipped');
});

test('a target node already unlinked is not an error', () => {
    const params = [{ ...branchParams[0], whenEmptySet: [{ nodeId: '404', field: 'switch', value: true }] }];
    const r = applyWhenEmptySet({ apiWorkflow: branchGraph(), exposedParameters: params, paramValues: {} });
    assert.deepStrictEqual(r.applied, []);
});

test("the caller's graph is not mutated by whenEmptySet", () => {
    const g = branchGraph();
    applyWhenEmptySet({ apiWorkflow: g, exposedParameters: branchParams, paramValues: {} });
    assert.strictEqual(g['68'].inputs.switch, false);
});

test('no whenEmptySet anywhere returns the same graph object', () => {
    const g = branchGraph();
    const r = applyWhenEmptySet({ apiWorkflow: g, exposedParameters: refParams, paramValues: {} });
    assert.strictEqual(r.workflow, g);
});

// --- both fields must survive a meta save ----------------------------------
test('whenEmpty and whenEmptySet survive the meta schema', () => {
    const { ExposedParameter } = require('../config/schemas');
    const parsed = ExposedParameter.parse({
        key: 'img1', nodeId: '1', field: 'image', type: 'image', label: 'Image 1',
        required: false, whenEmpty: 'unlink',
        whenEmptySet: [{ nodeId: '68', field: 'switch', value: true }],
    });
    assert.strictEqual(parsed.whenEmpty, 'unlink');
    assert.deepStrictEqual(parsed.whenEmptySet, [{ nodeId: '68', field: 'switch', value: true }]);
});

// --- fill → unlink → whenEmptySet, in the order submit() runs them --------
// ★ Each function above passed on its own while the three in sequence did
// nothing: fillOptionalImages ran first and put the black placeholder in every
// `whenEmpty: "unlink"` slot, so the slot was no longer empty, nothing was
// unlinked, and FastH3 i2v clips started or ended on a black frame.
test('an unlink slot is never placeholder-filled', () => {
    const p = { key: 'ref', nodeId: '2', type: 'image', required: false, whenEmpty: 'unlink' };
    const r = fillOptionalImages({ exposedParameters: [p], paramValues: {}, placeholderName: PH });
    assert.strictEqual(r.paramValues.ref, undefined);
    assert.strictEqual(r.filled, 0);
});

test('an unlink slot switched ON with no upload is still an error', () => {
    const p = { ...startImage, whenEmpty: 'unlink' };
    const r = fillOptionalImages({ exposedParameters: [video, toggle, p], paramValues: { vid: 'a.mp4', use_start: true }, placeholderName: PH });
    assert.strictEqual(r.errors.length, 1);
});

const fs = require('fs');
const os = require('os');
const path = require('path');
const { LocalComfyUIWorker } = require('./localComfyUIWorker');

// The worker's uploader creates <root>/input, so the root is a temp dir of
// this run's own, removed at the end — never a folder in the repo.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'comfyq-optmedia-'));

const bundle = (id) => {
    const dir = path.join(__dirname, '..', '..', 'workflows', id);
    return {
        api: JSON.parse(fs.readFileSync(path.join(dir, `${id}.api.json`), 'utf8')),
        params: JSON.parse(fs.readFileSync(path.join(dir, `${id}.meta.json`), 'utf8')).exposedParameters,
    };
};

// The real submit() with its transport stubbed: the graph it would POST is
// captured, and nothing on this machine can be reached.
async function submitted(id, paramValues, editParams = (p) => p) {
    const { api } = bundle(id);
    const params = editParams(bundle(id).params);
    const w = new LocalComfyUIWorker({
        comfyConfig: { api_host: '127.0.0.1', api_port: 1, root_path: path.join(TMP, 'comfy') },
        queueConfig: { inputRetentionMinutes: 30 },
    });
    const refuse = async () => { throw new Error('no network in tests'); };
    w.rest.http = { get: refuse, post: refuse };
    let sent = null;
    w.rest.submitPrompt = async (wf) => { sent = wf; return { prompt_id: 'p1', number: 0 }; };
    w.lifecycle.beforeJob = async () => ({ freed: false });
    w.uploader.ensurePlaceholderImage = () => {};
    w._state = 'idle';
    await w.submit('job12345', api, { exposedParameters: params, paramValues, filenamePrefix: 'test' });
    return { sent, api, params };
}

const loadersOf = (wf) => Object.entries(wf).filter(([, n]) => n.class_type === 'LoadImage').map(([k]) => k);
const danglingLinks = (wf) => Object.entries(wf).flatMap(([id, n]) => Object.entries(n.inputs || {})
    .filter(([, v]) => Array.isArray(v) && !wf[String(v[0])]).map(([f, v]) => `${id}.${f} -> ${v[0]}`));

async function asyncTests() {
    await atest('submit, Qwen 2.1 edit with only image 1: the 15 other slots leave the graph', async () => {
        const { sent } = await submitted('image_qwen_image_2_1_image_edit', { loadimage_image_470: 'me.png', prompt: 'x' });
        assert.ok(sent, 'a graph was submitted');
        assert.deepStrictEqual(loadersOf(sent), ['470']);
        assert.strictEqual(sent['470'].inputs.image, 'me.png');
        assert.ok(!JSON.stringify(sent).includes(PH), 'no placeholder anywhere in the graph');
        assert.deepStrictEqual(danglingLinks(sent), []);
        assert.strictEqual(sent['459:468'].inputs.switch, false, 'image 1 given: the latent follows it');
    });

    await atest('submit, Qwen 2.1 edit with no pictures: all 16 unlinked and the aspect-ratio switch flipped', async () => {
        const { sent } = await submitted('image_qwen_image_2_1_image_edit', { prompt: 'x' });
        assert.deepStrictEqual(loadersOf(sent), []);
        assert.ok(!JSON.stringify(sent).includes(PH));
        assert.deepStrictEqual(danglingLinks(sent), []);
        assert.strictEqual(sent['459:468'].inputs.switch, true);
    });

    await atest('submit, FastH3 i2v with a first frame only: no last frame, and no black one', async () => {
        const { sent } = await submitted('video_fastvideo_fasth3_i2v', { loadimage_image_136: 'first.png' });
        assert.deepStrictEqual(loadersOf(sent), ['136']);
        assert.ok(!JSON.stringify(sent).includes(PH));
        assert.deepStrictEqual(danglingLinks(sent), []);
    });

    await atest('submit: a plain optional image (no unlink) still gets the placeholder', async () => {
        // Same bundle with the opt-in taken off one slot.
        const { sent } = await submitted('video_fastvideo_fasth3_i2v', {},
            (params) => params.map(p => p.key === 'loadimage_image_300' ? { ...p, whenEmpty: undefined } : p));
        assert.strictEqual(sent['300'].inputs.image, PH);
        assert.strictEqual(sent['136'], undefined, 'the unlink slot beside it is still removed');
    });
}

async function atest(name, fn) {
    try { await fn(); console.log(`  ok   ${name}`); }
    catch (e) { console.error(`  FAIL ${name}\n       ${e.message}`); fails++; }
}

asyncTests().then(() => {
    fs.rmSync(TMP, { recursive: true, force: true });
    if (fails) { console.error(`\n${fails} failing`); process.exit(1); }
    console.log('\nall optional-media tests passed');
});
