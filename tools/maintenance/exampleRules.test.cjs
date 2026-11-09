// node tools/maintenance/exampleRules.test.cjs
//
// When a corrected caption from the suite file may land on a published result
// ("the same run"), and which outputs an example shows. Fixtures use the shapes
// the sweep really records (librarySweep._resolveSuiteParams / _ingredients).
const assert = require('assert');
const { sameRun, sameMedia, isSeedIngredient, showableOutputs, wholeValue } = require('./exampleRules.cjs');

let passed = 0;
function check(name, fn) {
    try { fn(); passed++; console.log('  ok  ' + name); }
    catch (e) { console.error('  FAIL ' + name + '\n       ' + e.message); process.exitCode = 1; }
}

console.log('exampleRules');

check('an array `from` matches whichever listed bundle the run took', () => {
    const spec = { from: ['video_minimax_h3_t2v_turbo', 'video_fastvideo_fasth3_t2v'], kind: 'video', fallback: 'asset:d6.mp4' };
    assert.ok(sameMedia(spec, { from: 'video_minimax_h3_t2v_turbo', source: 's', path: 'p' }));
    assert.ok(sameMedia(spec, { from: 'video_fastvideo_fasth3_t2v', source: 's', path: 'p' }));
    assert.ok(!sameMedia(spec, { from: 'video_ltx2_5_t2v', source: 's', path: 'p' }));
});

check('a run that fell back to its asset is not the run the caption describes', () => {
    const spec = { from: ['a', 'b'], fallback: 'asset:d6.mp4' };
    assert.ok(!sameMedia(spec, { asset: 'd6.mp4', fallbackFor: ['a', 'b'] }));
});

check('"output:<id>" and "asset:<file>" strings, and an empty slot', () => {
    assert.ok(sameMedia('output:image_x', { from: 'image_x', source: 's', path: 'p' }));
    assert.ok(sameMedia('asset:Woman.png', { asset: 'Woman.png' }));
    assert.ok(!sameMedia('asset:Woman.png', { asset: 'Man.png' }));
    assert.ok(sameMedia(null, { empty: true }));
    assert.ok(!sameMedia(null, { asset: 'Woman.png' }));
});

check('a changed derive op is a different input', () => {
    const derive = [{ op: 'jpeg', quality: 20 }];
    assert.ok(sameMedia({ from: 'asset:photo.png', derive }, { from: 'asset:photo.png', derive }));
    assert.ok(!sameMedia({ from: 'asset:photo.png', derive: [{ op: 'jpeg', quality: 40 }] }, { from: 'asset:photo.png', derive }));
    assert.ok(!sameMedia({ from: 'asset:photo.png', derive }, { from: 'asset:photo.png' }));
    assert.ok(sameMedia({ from: 'asset:photo.png', ops: derive }, { from: 'asset:photo.png', derive }), '`ops` is the same as `derive`');
});

check('a non-zero pick the row did not record cannot be confirmed', () => {
    assert.ok(!sameMedia('output:image_x#2', { from: 'image_x', source: 's', path: 'p' }));
    assert.ok(sameMedia('output:image_x#2', { from: 'image_x', source: 's', path: 'p', pick: 1 }));
});

check('a seed is skipped; a setting with "seed" inside its name is not', () => {
    assert.ok(isSeedIngredient({ key: 'ksampler_seed_3', node: '3.seed' }));
    assert.ok(isSeedIngredient({ key: 'seed_1', node: '1.sampling_mode.seed' }));
    assert.ok(isSeedIngredient({ key: 'randomnoise_noise_seed_15', node: '15.noise_seed' }));
    assert.ok(!isSeedIngredient({ key: 'seedvr2postprocessing_color_correction_method_66_59', node: '66:59.color_correction_method' }));
});

check('a primitive keyed seed_<n> is a seed too (calibration\'s own rule)', () => {
    // The 360 panorama's seed sits on a PrimitiveInt's `value`, linked into both samplers.
    assert.ok(isSeedIngredient({ key: 'seed_7', node: '7.value' }));
    assert.ok(!isSeedIngredient({ key: 'width_7', node: '7.value' }));
});

check('sameRun compares a changed colour method instead of skipping it', () => {
    const fileRun = { params: { seedvr2postprocessing_color_correction_method_66_59: 'lab', ksampler_seed_3: 42 } };
    const row = (v) => ({
        id: 'utility_x', suite: { inputs: {} },
        ingredients: [
            { key: 'seedvr2postprocessing_color_correction_method_66_59', node: '66:59.color_correction_method', from: 'the test suite', value: v },
            { key: 'ksampler_seed_3', node: '3.seed', from: 'the test suite', value: 987654 },
        ],
    });
    assert.ok(sameRun(fileRun, row('lab'), { rows: [], fileRuns: new Map() }));
    assert.ok(!sameRun(fileRun, row('wavelet'), { rows: [], fileRuns: new Map() }));
});

check('stray text tiles and VHS\'s first-frame PNG are not shown; a caption is', () => {
    const shown = showableOutputs([
        { kind: 'video', file: 'bench_lp_17938_00001.mp4' },
        { kind: 'image', file: 'bench_lp_17938_00001.png' },
        { kind: 'text', file: 'node 78', stray: true, text: '1x512x512' },
        { kind: 'text', file: 'node 4', text: 'A woman smiles.' },
    ]).map(o => o.file);
    assert.deepStrictEqual(shown, ['bench_lp_17938_00001.mp4', 'node 4']);
});

check('core save nodes\' image beside a video of the same prefix is kept', () => {
    const shown = showableOutputs([
        { kind: 'video', file: 'bench_x_17938_00001_.mp4' },
        { kind: 'image', file: 'bench_x_17938_00001_.png' },
    ]);
    assert.strictEqual(shown.length, 2);
});

check('a cut value is made whole only by the text it was cut from', () => {
    const full = 'x'.repeat(2000) + 'tail';
    const cut = { value: 'x'.repeat(2000), truncated: full.length };
    assert.strictEqual(wholeValue(cut, full), full, 'the default prompt was what ran');
    assert.strictEqual(wholeValue(cut, 'a different default prompt, longer than the cut one' + 'y'.repeat(3000)), null,
        'Ideogram, 2026-11-09: the default is another prompt');
    assert.strictEqual(wholeValue(cut, 'short default'), null, 'FastVideo omniref: the default is shorter than the cut');
    assert.strictEqual(wholeValue(cut, 'x'.repeat(2000) + 'other'), null, 'same start, different length');
    assert.strictEqual(wholeValue({ value: 'whole' }, 'anything'), 'whole', 'a value that was not cut stays');
});

console.log(`${passed} passed`);
