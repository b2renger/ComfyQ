/**
 * A test suite feeds one workflow's result to the next. These checks pin the
 * three things that would silently produce a wrong example if they broke:
 * what a media spec means, what validation refuses before hours of GPU time,
 * and which file a reference resolves to (the right bundle, the right kind,
 * the right index — or a skip with the reason, never a random asset).
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseMediaSpec, validateSuite } = require('./suitePlan');
const { LibrarySweep } = require('./librarySweep');

// No test may reach a real service on this machine.
global.fetch = async () => { throw new Error('network blocked in tests'); };

// --- parseMediaSpec -------------------------------------------------------
assert.deepStrictEqual(parseMediaSpec(null), { empty: true });
assert.deepStrictEqual(parseMediaSpec('asset:Woman.png'), { asset: 'asset:Woman.png' });
assert.deepStrictEqual(parseMediaSpec('output:image_x_t2i'), { from: ['image_x_t2i'], pick: 0, derive: [], fallback: null });
assert.strictEqual(parseMediaSpec('output:image_x_t2i#3').pick, 2, '#N is 1-based');
assert.strictEqual(parseMediaSpec('a plain prompt'), null, 'a literal is not a media reference');
const obj = parseMediaSpec({ from: ['a', 'b'], kind: 'video', derive: [{ op: 'frame' }], fallback: 'asset:x.mp4' });
assert.deepStrictEqual(obj.from, ['a', 'b']);
assert.strictEqual(obj.kind, 'video');
assert.strictEqual(obj.fallback, 'asset:x.mp4');

// --- validateSuite --------------------------------------------------------
const param = (key, type, extra = {}) => ({ key, type, nodeId: '1', field: 'x', ...extra });
const library = {
    t2i: { effective: { exposedParameters: [param('prompt', 'textarea'), param('ar', 'select', { options: ['1:1', '16:9'] })] } },
    edit: { effective: { exposedParameters: [param('image', 'image'), param('prompt', 'textarea')] } },
    vid: { effective: { exposedParameters: [param('first', 'image'), param('last', 'image', { required: false, whenEmpty: 'unlink' })] } },
};
const registry = { get: (id) => library[id] || null };
const suite = (runs) => ({ runs: runs.map(r => ({ stage: 'S', params: {}, ...r })) });

let v = validateSuite(suite([
    { workflow: 't2i', params: { prompt: 'a lighthouse', ar: '16:9' } },
    { workflow: 'edit', params: { image: 'output:t2i', prompt: 'at night' } },
    { workflow: 'vid', params: { first: 'output:t2i', last: 'output:edit' } },
]), registry);
assert.deepStrictEqual(v.errors, [], 'a well-ordered suite is valid');

v = validateSuite(suite([{ workflow: 'nope' }, { workflow: 't2i' }, { workflow: 't2i' }]), registry);
assert.ok(v.errors.some(e => /nope: not in the library/.test(e)));
assert.ok(v.errors.some(e => /appears twice/.test(e)));

v = validateSuite(suite([
    { workflow: 'edit', params: { image: 'output:t2i' } },
    { workflow: 't2i', params: { ar: '4:3', colour: 'red' } },
]), registry);
assert.ok(v.errors.some(e => /runs LATER/.test(e)), 'reading from a later run is an error');
assert.ok(v.errors.some(e => /"4:3" is not one of its options/.test(e)), 'a select value is checked');
assert.ok(v.errors.some(e => /no parameter "colour"/.test(e)), 'a typo in a key is caught');

v = validateSuite(suite([{ workflow: 'edit', params: { image: 'output:t2i' } }]), registry);
assert.ok(v.warnings.some(w => /never runs/.test(w)), 'a source outside the suite is only a warning');

v = validateSuite(suite([{ workflow: 'edit', params: { image: 'a picture' } }]), registry);
assert.ok(v.errors.some(e => /is a image input/.test(e)), 'a media input must be a reference');

// --- _resolveSuiteParams --------------------------------------------------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'suite-test-'));
const touch = (name) => { const p = path.join(tmp, name); fs.writeFileSync(p, 'x'); return p; };
const a1 = touch('bench_t2i_1700000000000_00001_.png');
const a2 = touch('bench_t2i_1700000000000_00002_.png');
const mp4 = touch('bench_vid_1700000000000_00001_.mp4');
const splat = touch('bench_tri_1700000000000.spz');
const plySplat = touch('bench_tri_1700000000000.ply');
const glb = touch('bench_tri_1700000000000.glb');

const sweep = new LibrarySweep({ registry: { list: () => [] }, calibrator: () => null, config: () => ({}), mode: () => 'admin', dataDir: tmp });
sweep._run = {
    stamp: 'test',
    results: [
        { id: 't2i', ok: true, outputs: [{ file: path.basename(a1), path: a1 }, { file: path.basename(a2), path: a2 }] },
        { id: 'broken', ok: false, outputs: [{ file: path.basename(a1), path: a1 }] },
    ],
    prevRows: [
        { id: 'vid', ok: true, outputs: [{ file: path.basename(mp4), path: mp4 }] },
        { id: 'tri', ok: true, outputs: [{ file: path.basename(splat), path: splat }, { file: path.basename(plySplat), path: plySplat }, { file: path.basename(glb), path: glb }] },
        { id: 'spz', ok: true, outputs: [{ file: path.basename(splat), path: splat }] },
    ],
};
const entry = { id: 'edit', effective: { exposedParameters: [
    param('image', 'image'), param('second', 'image'), param('clip', 'video'), param('mesh', 'model3d'),
    param('opt', 'image', { required: false }), param('prompt', 'textarea'), param('frames', 'number'),
] } };

(async () => {
    let r = await sweep._resolveSuiteParams(entry, { params: {
        image: 'output:t2i', second: 'output:t2i#2', clip: 'output:vid', opt: null, prompt: 'at night', frames: 81,
    } });
    assert.deepStrictEqual(r.missing, []);
    assert.strictEqual(r.params.image, `file:${a1}`, 'the first image');
    assert.strictEqual(r.params.second, `file:${a2}`, '#2 is the second image');
    assert.strictEqual(r.params.clip, `file:${mp4}`, 'from the last report when this run has no row');
    assert.strictEqual(r.params.opt, null, 'null leaves an optional input empty');
    assert.strictEqual(r.params.prompt, 'at night');
    assert.strictEqual(r.params.frames, 81, 'non-media literals pass through untouched');
    assert.ok(/output of t2i/.test(r.notes.image), 'where it came from is recorded');

    // The right KIND: a .spz splat is not a mesh, and a mesh input takes the
    // .glb before an ambiguous .ply (TripoSplat writes a splat .ply beside it).
    r = await sweep._resolveSuiteParams(entry, { params: { mesh: 'output:spz' } });
    assert.strictEqual(r.missing.length, 1, 'a splat is not a mesh');
    assert.ok(/needs a model3d from spz/.test(r.missing[0]));
    r = await sweep._resolveSuiteParams(entry, { params: { mesh: 'output:tri' } });
    assert.strictEqual(r.params.mesh, `file:${glb}`, 'the .glb wins over the .ply');

    // A failed row is never a source.
    r = await sweep._resolveSuiteParams(entry, { params: { image: 'output:broken' } });
    assert.strictEqual(r.missing.length, 1, 'a failed run supplies nothing');

    // The second source is tried, then the fallback asset.
    r = await sweep._resolveSuiteParams(entry, { params: { image: { from: ['broken', 't2i'] } } });
    assert.strictEqual(r.params.image, `file:${a1}`);
    r = await sweep._resolveSuiteParams(entry, { params: { clip: { from: 'broken', fallback: 'asset:dancer.mp4' } } });
    assert.strictEqual(r.params.clip, 'asset:dancer.mp4');
    assert.ok(/fallback/.test(r.notes.clip), 'a fallback says so');

    // An index past the end is missing, not the last one.
    r = await sweep._resolveSuiteParams(entry, { params: { image: 'output:t2i#3' } });
    assert.strictEqual(r.missing.length, 1);

    // A key the workflow does not have is refused, not ignored.
    r = await sweep._resolveSuiteParams(entry, { params: { imagee: 'output:t2i' } });
    assert.ok(/does not have/.test(r.missing[0]));

    // A deleted output file is not a source.
    fs.unlinkSync(a2);
    r = await sweep._resolveSuiteParams(entry, { params: { second: 'output:t2i#2' } });
    assert.strictEqual(r.missing.length, 1, 'an output that is gone from disk is not offered');

    fs.rmSync(tmp, { recursive: true, force: true });
    console.log('suitePlan: all checks passed');
})().catch(e => { console.error(e); process.exit(1); });
