const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// ★ Fixtures, not this rig. Every class every bundle here needs is installed —
// 0 missing across 61 bundles — so the live machine cannot exercise the one case
// that matters. These build a ComfyUI that is deliberately short of a pack.

const {
    listInstalledPacks, missingNodePacks, availableClasses, classesInGraph,
    readClassIndex, readRequirements, repoName, invalidateNodePacks,
} = require('./nodePacks');
const { NodePackInstaller } = require('../models/nodePackInstaller');

let pass = 0;
const ok = (what, cond) => {
    assert.ok(cond, what);
    pass++;
    console.log(`  ok  ${what}`);
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'comfyq-packs-'));
const root = path.join(tmp, 'ComfyUI');
const cn = path.join(root, 'custom_nodes');
fs.mkdirSync(cn, { recursive: true });

// Two packs on disk: one a git clone with a remote, one a Manager-style copy.
fs.mkdirSync(path.join(cn, 'ComfyUI-Installed', '.git'), { recursive: true });
fs.writeFileSync(path.join(cn, 'ComfyUI-Installed', '.git', 'config'),
    '[core]\n\trepositoryformatversion = 0\n[remote "origin"]\n\turl = https://github.com/someone/ComfyUI-Installed.git\n\tfetch = +refs/heads/*\n');
fs.writeFileSync(path.join(cn, 'ComfyUI-Installed', 'requirements.txt'),
    '# a comment\nrich>=13\nonnxruntime==1.24.1\n\ntqdm\n');
fs.mkdirSync(path.join(cn, 'copied-pack'), { recursive: true });
fs.mkdirSync(path.join(cn, '__pycache__'), { recursive: true });

// ComfyUI-Manager's map, with the shape it really has on disk.
fs.mkdirSync(path.join(cn, 'comfyui-manager'), { recursive: true });
fs.writeFileSync(path.join(cn, 'comfyui-manager', 'extension-node-map.json'), JSON.stringify({
    'https://github.com/someone/ComfyUI-Needed': [['NeededNodeA', 'NeededNodeB'], { title_aux: 'The Needed Pack' }],
    'https://github.com/other/ComfyUI-Second': [['SecondNode'], { title_aux: 'Second Pack' }],
    'https://github.com/someone/ComfyUI-Installed': [['InstalledButBroken'], { title_aux: 'Installed' }],
}));

console.log('\nreading what is on disk');
const packs = listInstalledPacks(root);
ok('lists the real folders and skips __pycache__',
    packs.map(p => p.name).join(',') === 'ComfyUI-Installed,comfyui-manager,copied-pack');
ok('knows which pack is a git clone, and its remote',
    packs[0].isGit && packs[0].remote === 'https://github.com/someone/ComfyUI-Installed.git');
ok('a Manager-style copy is reported as NOT updatable',
    packs.find(p => p.name === 'copied-pack').isGit === false);
ok('notices a requirements.txt', packs[0].hasRequirements === true);

const idx = readClassIndex(root);
ok('the class index maps a class to its repo',
    idx.byClass.get('NeededNodeB').url === 'https://github.com/someone/ComfyUI-Needed');
ok('the index carries the pack title', idx.byClass.get('NeededNodeA').title === 'The Needed Pack');
ok('and reports where it read the map from', String(idx.source).includes('extension-node-map.json'));
ok('no manager installed -> an empty index rather than a throw',
    readClassIndex(path.join(tmp, 'nothing')).byClass.size === 0);

console.log('\nwhat a bundle wants');
const graph = {
    1: { class_type: 'KSampler' },
    2: { class_type: 'NeededNodeA' },
    3: { class_type: 'NeededNodeB' },
    4: { class_type: 'HomeGrownNode' },
    5: { not_a_node: true },
};
ok('reads class_type off every node and ignores the rest',
    [...classesInGraph(graph)].sort().join(',') === 'HomeGrownNode,KSampler,NeededNodeA,NeededNodeB');

console.log('\nthe missing-pack answer');
const live = { KSampler: {}, VAEDecode: {} };
let out = missingNodePacks([{ id: 'bundle_a', graph }], root, { objectInfo: live, allowCache: false });
ok('a class ComfyUI does not offer is reported missing',
    out.missingByBundle.bundle_a.join(',') === 'HomeGrownNode,NeededNodeA,NeededNodeB');
ok('the two classes of one pack collapse into ONE install',
    out.packs.length === 1 && out.packs[0].classes.length === 2);
ok('and it names the repo to clone', out.packs[0].url === 'https://github.com/someone/ComfyUI-Needed');
ok('a class no map knows is listed separately, not silently dropped',
    out.unknownClasses.length === 1 && out.unknownClasses[0].name === 'HomeGrownNode');
ok('the bundle that wants it is named', out.unknownClasses[0].bundles.join() === 'bundle_a');
ok('source says the answer came from the running ComfyUI', out.source === 'live');

invalidateNodePacks();
out = missingNodePacks([{ id: 'b', graph: { 1: { class_type: 'InstalledButBroken' } } }], root,
    { objectInfo: live, allowCache: false });
ok('a pack whose FOLDER is present but whose class is absent is flagged as already installed',
    out.packs[0].installed === true);

invalidateNodePacks();
out = missingNodePacks([{ id: 'c', graph: { 1: { class_type: 'KSampler' } } }], root,
    { objectInfo: live, allowCache: false });
ok('a satisfied bundle produces no entry at all',
    Object.keys(out.missingByBundle).length === 0 && out.packs.length === 0);

// ⚠ The one wrong answer this must never give.
invalidateNodePacks();
out = missingNodePacks([{ id: 'd', graph }], root, { objectInfo: null, allowCache: false });
ok('with no class list the answer is UNKNOWN, not "nothing is missing"',
    out.known === false && out.source === 'none' && Object.keys(out.missingByBundle).length === 0);

console.log('\nrequirements, and what is risky about them');
const reqs = readRequirements(path.join(cn, 'ComfyUI-Installed'));
ok('comments and blank lines are dropped', reqs.lines.join(',') === 'rich>=13,onnxruntime==1.24.1,tqdm');
ok('onnxruntime is named as touching a shared package',
    reqs.risky.length === 1 && reqs.risky[0].startsWith('onnxruntime'));
ok('a pack with no requirements.txt reports exists:false',
    readRequirements(path.join(cn, 'copied-pack')).exists === false);

console.log('\nwhat the installer will and will not accept');
const inst = new NodePackInstaller({ config: () => ({ comfy_ui: { root_path: root } }) });
ok('a plain github URL is accepted',
    inst.plan('https://github.com/someone/ComfyUI-New').ok === true);
ok('and the folder is named the way git would name it',
    inst.plan('https://github.com/someone/ComfyUI-New.git').folder === 'ComfyUI-New');
for (const bad of [
    'https://github.com/someone/ComfyUI-New; rm -rf /',
    'file:///J:/evil',
    'https://evil.example.com/someone/pack',
    'https://github.com/someone/pack/../../../etc',
    '',
]) {
    ok(`refused: ${bad.slice(0, 42) || '(empty)'}`, inst.plan(bad).ok === false);
}
ok('an existing folder is reported, so install can refuse it',
    inst.plan('https://github.com/someone/ComfyUI-Installed').exists === true);

(async () => {
    const r = await inst.install('https://github.com/someone/ComfyUI-Installed');
    ok('installing over an existing pack is refused and touches nothing',
        r.ok === false && /already exists/.test(r.error));

    const pip = await inst.pipInstall('ComfyUI-Installed', false);
    ok('pip refuses a risky requirements.txt until it is accepted explicitly',
        pip.ok === false && pip.risky.join().startsWith('onnxruntime'));

    const noReq = await inst.pipInstall('copied-pack', true);
    ok('pip on a pack with no requirements says so rather than running',
        noReq.ok === false && /no requirements/.test(noReq.error));

    const absent = await inst.pipInstall('not-here', true);
    ok('pip on something that is not installed is refused',
        absent.ok === false && /not installed/.test(absent.error));

    // ★ A cached class list can be older than ComfyUI. CameraAngle arrived in a
    // ComfyUI update after the cache was taken, and the 2511 angles bundle read as
    // "node pack missing" whenever ComfyUI was not answering — with no Install
    // button, because no pack provides a core node.
    {
        const np = require('./nodePacks');
        fs.mkdirSync(path.join(root, 'comfy_extras'), { recursive: true });
        fs.writeFileSync(path.join(root, 'comfy_extras', 'nodes_camera_angle.py'),
            'class CameraAngle:\n    node_id="CameraAngle"\n');
        ok('a class ComfyUI defines in its own source is recognised as core',
            np.coreSourceDefines(root, 'CameraAngle') === true);
        ok('a pack class is not mistaken for core', np.coreSourceDefines(root, 'VHS_VideoCombine') === false);
        // ★ Registration, not mention: a quoted word in core source is not a node.
        // (A different root string so the ten-minute parse cache is not reused.)
        fs.writeFileSync(path.join(root, 'comfy_extras', 'nodes_misc.py'),
            'cfg = {"name": 1, "description": 2}\nNODE_CLASS_MAPPINGS = {\n    "ClassicNode": ClassicNode,\n}\n');
        const core2 = np.coreClassNames(root + path.sep);
        ok('a generic quoted word is not a core node', !core2.has('name') && !core2.has('description'));
        ok('a NODE_CLASS_MAPPINGS entry is', core2.has('ClassicNode'));
        ok('a V3 node_id is', core2.has('CameraAngle'));

        // ★ And the cache refresh must never take a fixture for a real ComfyUI:
        // the first version ran inside missingNodePacks, and THIS test file's
        // two-class fixture overwrote the real 4.7 MB cache.
        const cachePath = path.resolve(__dirname, '..', '..', 'tools', 'maintenance', 'model-audit', 'object_info.json');
        const before = fs.existsSync(cachePath) ? fs.statSync(cachePath).mtimeMs : null;
        np.missingNodePacks([{ id: 'x', graph: { 1: { class_type: 'KSampler', inputs: {} } } }], root,
            { objectInfo: { KSampler: {}, VAEDecode: {} } });
        ok('checking against a live list never rewrites the cache by itself',
            (fs.existsSync(cachePath) ? fs.statSync(cachePath).mtimeMs : null) === before);
        ok('a payload too small to be a ComfyUI is refused as a cache',
            np.refreshCachedObjectInfo({ KSampler: {}, VAEDecode: {} }) === false);
        // ★ And a ComfyUI that lost most of what the cache knew — one started with
        // --disable-all-custom-nodes — must not replace it. The payload is refused
        // before anything is written, so the real cache is never at risk here.
        if (fs.existsSync(cachePath)) {
            const prev = Object.keys(JSON.parse(fs.readFileSync(cachePath, 'utf8')));
            const stripped = Object.fromEntries(prev.slice(0, Math.floor(prev.length * 0.5)).map(k => [k, {}]));
            const mtime = fs.statSync(cachePath).mtimeMs;
            ok('a stripped class list does not replace the cache',
                np.refreshCachedObjectInfo(stripped) === false && fs.statSync(cachePath).mtimeMs === mtime);
        }
    }

    fs.rmSync(tmp, { recursive: true, force: true });
    console.log(`\n${pass} checks passed`);
})();
