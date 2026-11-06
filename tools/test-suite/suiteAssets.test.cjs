// node tools/test-suite/suiteAssets.test.cjs
// What `run-suite.cjs --check` reports as a missing asset: every place a suite can
// name one, found the way the sweep finds it, and "required" only when nothing
// else can stand in.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { assetFile, suiteAssets, missingAssetLines } = require('./suiteAssets.cjs');

let passed = 0;
const check = (name, fn) => { fn(); passed++; console.log(`ok  ${name}`); };

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'suite-assets-'));
const assets = path.join(root, 'assets');
fs.mkdirSync(path.join(assets, 'clips'), { recursive: true });
fs.writeFileSync(path.join(assets, 'here.png'), 'x');
fs.writeFileSync(path.join(assets, 'clips', 'dance.mp4'), 'x');
fs.writeFileSync(path.join(root, 'outside.png'), 'x');

const exposed = {
    wf: [
        { key: 'img', type: 'image' }, { key: 'vid', type: 'video' }, { key: 'mask', type: 'mask' },
        { key: 'prompt', type: 'textarea' }, { key: 'opt', type: 'image' },
    ],
};
const exposedOf = id => exposed[id] || [];
const suiteOf = params => ({ runs: [{ workflow: 'wf', params }] });
const one = (params) => suiteAssets(suiteOf(params), exposedOf, assets);

check('a plain asset is found, also in a sub-folder', () => {
    assert.ok(assetFile(assets, 'asset:here.png'));
    assert.ok(assetFile(assets, 'asset:clips/dance.mp4'));
    const l = one({ img: 'asset:here.png', vid: 'asset:clips/dance.mp4' });
    assert.deepStrictEqual(l.map(a => [a.name, a.found, a.required]), [['here.png', true, true], ['clips/dance.mp4', true, true]]);
});

check('a missing plain asset is required', () => {
    const l = one({ img: 'asset:gone.png' });
    assert.strictEqual(l.length, 1);
    assert.strictEqual(l[0].found, false);
    assert.strictEqual(l[0].required, true);
});

check('a name that escapes the folder is never found', () => {
    assert.strictEqual(assetFile(assets, 'asset:../outside.png'), null);
    assert.strictEqual(assetFile(assets, 'asset:'), null);
    assert.strictEqual(assetFile(null, 'asset:here.png'), null);
});

check('assetFile answers exactly as the sweep does (LibrarySweep._assetFile)', () => {
    // --check and the sweep share suitePlan.assetFile; this keeps them from
    // drifting apart again and disagreeing about whether an asset exists.
    const { LibrarySweep } = require('../../server/benchmark/librarySweep');
    const sweep = new LibrarySweep({ registry: null, calibrator: null, config: () => ({ assets: { dir: assets } }), mode: () => 'admin', dataDir: root });
    const none = new LibrarySweep({ registry: null, calibrator: null, config: () => ({}), mode: () => 'admin', dataDir: root });
    const specs = ['asset:here.png', 'here.png', 'asset:clips/dance.mp4', 'asset:clips', 'asset:gone.png',
        'asset:../outside.png', 'asset:', 'asset:.', `asset:${path.join(root, 'outside.png')}`, `asset:${path.join(assets, 'here.png')}`,
        'asset:HERE.PNG', 'asset:clips/../here.png', `asset:${path.join(assets, 'here.png').toUpperCase()}`];
    for (const s of specs) {
        assert.strictEqual(assetFile(assets, s), sweep._assetFile(s), s);
        assert.strictEqual(assetFile(null, s), none._assetFile(s), `${s} (no assets folder)`);
    }
});

check('a fallback, or one source of several, is not required', () => {
    const l = one({
        img: { from: 'image_x', fallback: 'asset:gone.png' },
        vid: { from: ['video_x', 'asset:gone.mp4'] },
    });
    assert.deepStrictEqual(l.map(a => [a.how, a.required, a.found]), [['fallback', false, false], ['from', false, false]]);
});

check('an asset that is the only source is required, a derive overlay too', () => {
    const l = one({
        img: { from: 'asset:gone.png', derive: [{ op: 'composite', overlay: 'asset:cutout.webp', box: [0, 0, 1, 1] }] },
    });
    assert.deepStrictEqual(l.map(a => [a.how, a.name, a.required]), [['from', 'gone.png', true], ['overlay', 'cutout.webp', true]]);
});

check('an asset source with a fallback is not required', () => {
    const l = one({ img: { from: 'asset:gone.png', fallback: 'asset:here.png' } });
    assert.deepStrictEqual(l.map(a => [a.how, a.required, a.found]), [['from', false, false], ['fallback', false, true]]);
});

check('a literal on a text parameter, an empty input and an output: reference name no asset', () => {
    const l = one({ prompt: 'asset:not-a-file.png', opt: null, mask: 'output:image_x' });
    assert.deepStrictEqual(l, []);
});

check('only the missing ones are printed, and the required ones say the run is skipped', () => {
    const lines = missingAssetLines(one({ img: 'asset:here.png', vid: 'asset:gone.mp4', mask: { from: 'image_x', fallback: 'asset:gone.png' } }), assets);
    assert.strictEqual(lines.length, 2);
    assert.match(lines[0], /^MISSING .*gone\.mp4.*will be skipped/);
    assert.match(lines[1], /^missing .*its fallback gone\.png/);
});

fs.rmSync(root, { recursive: true, force: true });
console.log(`\n${passed} checks passed`);
