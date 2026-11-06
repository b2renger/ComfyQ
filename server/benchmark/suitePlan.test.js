/**
 * A test suite feeds one workflow's result to the next. These checks pin the
 * things that would silently produce a wrong example if they broke: what a
 * media spec means, what validation refuses before hours of GPU time, which
 * file a reference resolves to (the right bundle, the right kind, the right
 * index — or a skip with the reason, never a random asset), that the committed
 * library suite still fits the library, and when a suite caption may land on a
 * published result.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseMediaSpec, validateSuite, loadSuite, MEDIA_TYPES } = require('./suitePlan');
const { LibrarySweep } = require('./librarySweep');
// The rule seed_examples.cjs applies. Its own tests (exampleRules.test.cjs) pin
// the media spec and the seed rule; the cases below pin the chain.
const { sameRun, rowFrom } = require(path.join(__dirname, '..', '..', 'tools', 'maintenance', 'exampleRules.cjs'));

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

// Derive from an ASSET (a damaged copy for a restorer, a trimmed clip), `ops`
// accepted for `derive`, and the shape checks on video derives.
const fromAsset = parseMediaSpec({ from: 'asset:Mariette1.jpg', kind: 'image', ops: [{ op: 'noise' }, { op: 'jpeg' }] });
assert.deepStrictEqual(fromAsset.from, ['asset:Mariette1.jpg']);
assert.strictEqual(fromAsset.derive.length, 2, '`ops` is read as `derive`');
assert.deepStrictEqual(parseMediaSpec({ asset: 'Tree.png', derive: [{ op: 'flip' }] }).from, ['asset:Tree.png'], '{asset, derive} works too');
library.vedit = { effective: { exposedParameters: [param('clip', 'video')] } };
v = validateSuite(suite([
    { workflow: 'edit', params: { image: { from: 'asset:cat.jpg', derive: [{ op: 'noise' }, { op: 'jpeg' }, { op: 'circle', box: [0, 0, 1, 1] }] } } },
    { workflow: 'vedit', params: { clip: { from: 'asset:dance.mp4', derive: [{ op: 'trim', start: 1, duration: 2 }, { op: 'mute' }] } } },
]), registry);
assert.deepStrictEqual(v.errors, [], 'asset-derived inputs and the new ops are valid');
v = validateSuite(suite([{ workflow: 'edit', params: { image: { from: 'asset:dance.mp4', derive: [{ op: 'trim', duration: 2 }] } } }]), registry);
assert.ok(v.errors.some(e => /derive makes a video/.test(e)), 'a video derive into a picture input is refused');
v = validateSuite(suite([{ workflow: 'vedit', params: { clip: { from: 'asset:d.mp4', derive: [{ op: 'frame' }, { op: 'mute' }] } } }]), registry);
assert.ok(v.errors.some(e => /mixes "frame"/.test(e)), 'frame + video ops is refused');

// --- the committed library suite still fits the library -------------------
// ★ Checked here and not only by `run-suite.cjs --check`, which nobody runs
// until the GPU is booked: a renamed parameter would otherwise surface hours into
// a run, and a bundle added without a suite entry would simply get no example.
// Both files are in the repo, so this reports on the code, not on the machine.
{
    const { WorkflowRegistry } = require('../workflows/workflowRegistry');
    const real = new WorkflowRegistry(path.resolve(__dirname, '..', '..', 'workflows'));
    real.discover();
    const lib = loadSuite('library');
    const check = validateSuite(lib, real);
    assert.deepStrictEqual(check.errors, [], `tools/test-suite/library.suite.json no longer fits the library:\n  ${check.errors.join('\n  ')}`);
    const inSuite = new Set(lib.runs.map(r => r.workflow));
    const bundles = real.list({ includeUnavailable: true, includeHidden: true }).map(e => e.id);
    const without = bundles.filter(id => !inSuite.has(id));
    assert.deepStrictEqual(without, [],
        `bundle(s) with no run in tools/test-suite/library.suite.json, so no example: ${without.join(', ')}`);

    // ★ A suite leaves most settings unset, and an unset setting runs the api.json
    // LITERAL, not the card's default. Thirty literals once disagreed with their
    // defaults, so every calibration, sweep and suite run measured a job nobody
    // books. Media inputs are staged per run, seeds are drawn fresh and a camera
    // is several fields, so those three are left out. Range checks and whether an
    // asset exists stay in `run-suite.cjs --check`: the assets folder is per machine.
    const { isSeedParam } = require('./benchmarkService');
    const drift = [];
    let compared = 0;
    for (const e of real.list({ includeUnavailable: true, includeHidden: true })) {
        for (const p of (e.effective?.exposedParameters || [])) {
            if (MEDIA_TYPES.includes(p.type) || p.type === 'camera' || isSeedParam(p) || p.default === undefined) continue;
            const lit = e.apiWorkflow?.[p.nodeId]?.inputs?.[p.field];
            if (Array.isArray(lit)) continue;                 // fed by a link, not a literal
            compared++;
            // Loose on type only: a select of numbers stores 24 where the card says "24".
            if (lit === undefined || String(lit) !== String(p.default)) {
                drift.push(`${e.id} › ${p.key} (${p.nodeId}.${p.field}): literal ${JSON.stringify(lit)?.slice(0, 60)} ≠ default ${JSON.stringify(p.default)?.slice(0, 60)}`);
            }
        }
    }
    assert.ok(compared > 0, 'the literal check compared something');
    assert.deepStrictEqual(drift, [],
        `api.json literal(s) differ from the card default — an unattended run would measure another job:\n  ${drift.join('\n  ')}`);

    // ★ The same disagreement one step later: a booking passes every number through
    // clampParamValue (snap to min + k·step, then clamp to [min, max]), and an
    // unattended run sends the literal. A default off that grid is booked as
    // another value than the one the calibration measured. Seeds are left out, as
    // above: the form rolls one and calibration and the suite draw fresh, so a
    // seed's default is never what runs.
    const { clampParamValue } = require('../workers/localComfyUIWorker');
    const offGrid = [];
    let numbers = 0;
    for (const e of real.list({ includeUnavailable: true, includeHidden: true })) {
        for (const p of (e.effective?.exposedParameters || [])) {
            if (p.type !== 'number' || !Number.isFinite(p.default) || isSeedParam(p)) continue;
            numbers++;
            const booked = clampParamValue(p.default, p);
            if (booked !== p.default) offGrid.push(`${e.id} › ${p.key}: default ${p.default} → ${booked}`);
        }
    }
    assert.ok(numbers > 0, 'the grid check checked a number default');
    assert.deepStrictEqual(offGrid, [],
        `default is off its min+k·step grid or outside [min,max] — a default booking runs another value than an unattended run:\n  ${offGrid.join('\n  ')}`);
}

// --- _resolveSuiteParams --------------------------------------------------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'suite-test-'));
const touch = (name) => { const p = path.join(tmp, name); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, 'x'); return p; };
const a1 = touch('bench_t2i_1700000000000_00001_.png');
const a2 = touch('bench_t2i_1700000000000_00002_.png');
const stale = touch('bench_broken_1600000000000_00001_.png');
const mp4 = touch('bench_vid_1700000000000_00001_.mp4');
const splat = touch('bench_tri_1700000000000.spz');
const plySplat = touch('bench_tri_1700000000000.ply');
const glb = touch('bench_tri_1700000000000.glb');
// The assets folder a plain `asset:` and a fallback are looked up in.
const assetsDir = path.join(tmp, 'assets');
const dancer = touch(path.join('assets', 'dancer.mp4'));
const woman = touch(path.join('assets', 'Woman.png'));
const key1 = touch(path.join('assets', 'Keyframes', 'k1.png'));
touch('outside.png');

const sweep = new LibrarySweep({ registry: { list: () => [] }, calibrator: () => null, config: () => ({ assets: { dir: assetsDir } }), mode: () => 'admin', dataDir: tmp });
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
        // An older suite's picture from a bundle that FAILED in this run.
        { id: 'broken', ok: true, outputs: [{ file: path.basename(stale), path: stale }] },
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
    // ★ Which of the upstream's files was taken: exampleRules.sameMedia compares it
    // with the suite's `pick`, and a missing one reads as the first file.
    assert.strictEqual(r.inputs.second.pick, 1, 'the row records a pick past the first file');
    assert.ok(!('pick' in r.inputs.image), 'the first file records no pick (rows before it was recorded still match)');

    // The right KIND: a .spz splat is not a mesh, and a mesh input takes the
    // .glb before an ambiguous .ply (TripoSplat writes a splat .ply beside it).
    r = await sweep._resolveSuiteParams(entry, { params: { mesh: 'output:spz' } });
    assert.strictEqual(r.missing.length, 1, 'a splat is not a mesh');
    assert.ok(/needs a model3d from spz/.test(r.missing[0]));
    r = await sweep._resolveSuiteParams(entry, { params: { mesh: 'output:tri' } });
    assert.strictEqual(r.params.mesh, `file:${glb}`, 'the .glb wins over the .ply');

    // A failed row is never a source — and ★ neither is the previous report's
    // picture for a bundle that failed in THIS run: it is a result this run never
    // made, often from an older version of the suite.
    r = await sweep._resolveSuiteParams(entry, { params: { image: 'output:broken' } });
    assert.strictEqual(r.missing.length, 1, 'a failed run supplies nothing, even with an older ok row on record');
    assert.ok(!Object.values(r.params).includes(`file:${stale}`), 'the previous report\'s picture is not used');

    // The second source is tried, then the fallback asset.
    r = await sweep._resolveSuiteParams(entry, { params: { image: { from: ['broken', 't2i'] } } });
    assert.strictEqual(r.params.image, `file:${a1}`);
    r = await sweep._resolveSuiteParams(entry, { params: { clip: { from: 'broken', fallback: 'asset:dancer.mp4' } } });
    assert.strictEqual(r.params.clip, `file:${dancer}`, 'the fallback is the file found in the assets folder');
    assert.strictEqual(r.inputs.clip.asset, 'dancer.mp4', 'the report still names the asset');
    assert.ok(/fallback/.test(r.notes.clip), 'a fallback says so');

    // ★ A named asset is checked like any other source. It used to go through
    // unchecked, and the calibrator then fed the run a random file of that type.
    r = await sweep._resolveSuiteParams(entry, { params: { image: 'asset:Woman.png', second: 'asset:Keyframes/k1.png' } });
    assert.deepStrictEqual(r.missing, []);
    assert.strictEqual(r.params.image, `file:${woman}`, 'a plain asset is passed on as the file found');
    assert.strictEqual(r.params.second, `file:${key1}`, 'a sub-folder of the assets folder is fine');
    assert.deepStrictEqual(r.inputs.image, { asset: 'Woman.png' }, 'the report records the asset by name (seed_examples matches on it)');
    r = await sweep._resolveSuiteParams(entry, { params: { image: 'asset:nope.png' } });
    assert.strictEqual(r.missing.length, 1, 'a missing asset skips the run');
    assert.ok(/names the asset nope\.png, which is not in the assets folder/.test(r.missing[0]));
    assert.strictEqual(r.params.image, undefined, 'and nothing is passed on for it');
    r = await sweep._resolveSuiteParams(entry, { params: { image: 'asset:../outside.png' } });
    assert.strictEqual(r.missing.length, 1, 'an asset outside the assets folder is not found');
    r = await sweep._resolveSuiteParams(entry, { params: { clip: { from: 'broken', fallback: 'asset:gone.mp4' } } });
    assert.strictEqual(r.missing.length, 1, 'a missing fallback skips the run too');
    assert.ok(/nor is its fallback asset gone\.mp4/.test(r.missing[0]));
    const noAssets = new LibrarySweep({ registry: { list: () => [] }, calibrator: () => null, config: () => ({}), mode: () => 'admin', dataDir: tmp });
    r = await noAssets._resolveSuiteParams(entry, { params: { image: 'asset:Woman.png' } });
    assert.ok(/none is set/.test(r.missing[0] || ''), 'with no assets folder configured, an asset is missing and says why');

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

    // --- when a suite caption may land on a published result ----------------
    // ★★ "Is this the same run?" must follow the chain: a caption about the
    // upstream picture is wrong on a row that consumed a different one.
    {
        const fileRuns = new Map([
            ['t2i', { params: { prompt: 'a lighthouse', seed: 42 }, note: 'the lighthouse' }],
            ['edit', { params: { image: 'output:t2i', prompt: 'at night' }, note: 'the lighthouse at night' }],
        ]);
        const t2iRow = {
            id: 't2i', ok: true, outputs: [{ path: 'C:\\out\\bench_t2i_1_00001_.png' }],
            ingredients: [{ key: 'prompt', value: 'a lighthouse', from: 'the test suite' }, { key: 'seed', value: 987, from: 'calibration' }],
        };
        const editRow = {
            id: 'edit', ok: true,
            suite: { inputs: { image: { from: 't2i', source: 'c:/out/BENCH_T2I_1_00001_.png' } } },
            ingredients: [{ key: 'prompt', value: 'at night', from: 'the test suite' }],
        };
        const ctx = { rows: [t2iRow, editRow], fileRuns };
        assert.strictEqual(rowFrom({ asset: 'Woman.png' }), 'asset:Woman.png');
        assert.strictEqual(rowFrom({ empty: true }), null);

        assert.ok(sameRun(fileRuns.get('t2i'), t2iRow, ctx), 'the run as described matches — the seed calibration drew is ignored');
        assert.ok(sameRun(fileRuns.get('edit'), editRow, ctx), 'a chained run matches when its upstream is that run and that file (paths compared loosely)');
        assert.ok(!sameRun({ params: { prompt: 'a lighthouse at dusk' } }, t2iRow, ctx), 'a changed prompt does not match');
        assert.ok(!sameRun({ params: { image: 'output:other' } }, editRow, ctx), 'an input from another bundle does not match');
        assert.ok(!sameRun(undefined, t2iRow, ctx), 'no file entry, no match');

        const long = 'x'.repeat(2500);
        const truncRow = { id: 't2i', ingredients: [{ key: 'prompt', value: long.slice(0, 2000), truncated: 2500, from: 'the test suite' }] };
        assert.ok(sameRun({ params: { prompt: long } }, truncRow), 'a prompt cut short in the report matches by its start');
        assert.ok(!sameRun({ params: { prompt: 'y' + long } }, truncRow), '...and only by its start');

        // The upstream re-ran with another prompt: its picture is not the one the
        // caption describes, so the downstream caption must not land either.
        const changed = new Map(fileRuns);
        changed.set('t2i', { params: { prompt: 'a windmill' } });
        assert.ok(!sameRun(fileRuns.get('edit'), editRow, { rows: ctx.rows, fileRuns: changed }), 'an upstream from a different run breaks the match');
        // The upstream row exists but this run consumed another of its files.
        const otherFile = { ...editRow, suite: { inputs: { image: { from: 't2i', source: 'C:/out/bench_t2i_0_00009_.png' } } } };
        assert.ok(!sameRun(fileRuns.get('edit'), otherFile, ctx), 'a file the upstream row does not hold breaks the match');

        // Two entries reading from each other (a broken suite) end instead of looping.
        const loopRuns = new Map([['a', { params: { image: 'output:b' } }], ['b', { params: { image: 'output:a' } }]]);
        const ra = { id: 'a', outputs: [{ path: '/o/a.png' }], suite: { inputs: { image: { from: 'b', source: '/o/b.png' } } } };
        const rb = { id: 'b', outputs: [{ path: '/o/b.png' }], suite: { inputs: { image: { from: 'a', source: '/o/a.png' } } } };
        assert.strictEqual(sameRun(loopRuns.get('a'), ra, { rows: [ra, rb], fileRuns: loopRuns }), false, 'a cycle terminates, as no match');
    }

    console.log('suitePlan: all checks passed');
})().catch(e => { console.error(e); process.exit(1); });
