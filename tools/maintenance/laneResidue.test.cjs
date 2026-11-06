// node tools/maintenance/laneResidue.test.cjs
//
// The wipe before cloning must not take the running ComfyUI's registry, logs
// or lane folder with the residue: without processes.json the next ComfyQ
// treats its own ComfyUI as somebody else's.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { planLaneWipe } = require('./laneResidue.cjs');
// The fixture registry is written by comfyLauncher itself, so a change to its
// format shows up here instead of the planner silently reading nothing.
const launcher = require(path.join(__dirname, '..', '..', 'server', 'workers', 'comfyLauncher'));

let passed = 0;
function check(name, fn) {
    try { fn(); passed++; console.log('  ok  ' + name); }
    catch (e) { console.error('  FAIL ' + name + '\n       ' + e.message); process.exitCode = 1; }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'comfyq-lanes-'));
const put = (rel, text = 'x') => { const p = path.join(tmp, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); };
function layout(procs) {
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.mkdirSync(tmp, { recursive: true });
    const reg = path.join(tmp, 'processes.json');
    launcher.writeRegistry({ procs: {}, history: [] }, reg);
    for (const [port, rec] of Object.entries(procs)) launcher.recordStart({ port, ...rec }, reg);
    for (const port of ['8188', '8189', '8199']) {
        const base = path.relative(launcher.STATE_DIR, launcher.logBaseFor(port)).replace(/\\/g, '/');
        for (const ext of ['out.log', 'err.log', 'pid']) put(`${base}.${ext}`);
    }
    put('lane_a/user/comfyui_8189.log');
    put('lane_b/user/comfyui_8199.log');
}
const alive = (pids) => (pid) => pids.includes(pid);
const rel = (list) => list.map(p => path.relative(tmp, typeof p === 'string' ? p : p.path).replace(/\\/g, '/')).sort();

console.log('laneResidue');

try {
    check('the main ComfyUI running: its registry and logs stay, dead ports and lanes go', () => {
        layout({ 8188: { pid: 100, userDir: null }, 8199: { pid: 300, userDir: path.join(tmp, 'lane_b', 'user') } });
        const plan = planLaneWipe(tmp, alive([100]));
        assert.deepStrictEqual(plan.livePorts, ['8188']);
        assert.deepStrictEqual(rel(plan.keep), ['logs/comfyui-8188.err.log', 'logs/comfyui-8188.out.log', 'logs/comfyui-8188.pid', 'processes.json']);
        assert.ok(rel(plan.remove).includes('lane_a') && rel(plan.remove).includes('lane_b'));
        assert.ok(rel(plan.remove).includes('logs/comfyui-8199.err.log'));
    });

    check('a running extra lane keeps its own folder', () => {
        layout({ 8188: { pid: 100, userDir: null }, 8189: { pid: 200, userDir: path.join(tmp, 'lane_a', 'user') } });
        const plan = planLaneWipe(tmp, alive([100, 200]));
        assert.ok(rel(plan.keep).includes('lane_a'));
        assert.ok(rel(plan.keep).includes('logs/comfyui-8189.err.log'));
        assert.ok(rel(plan.remove).includes('lane_b'));
    });

    check('nothing running: everything is residue, the registry included', () => {
        layout({ 8188: { pid: 100, userDir: null } });
        const plan = planLaneWipe(tmp, alive([]));
        assert.strictEqual(plan.keep.length, 0);
        assert.ok(rel(plan.remove).includes('processes.json'));
    });

    check('an unreadable registry keeps nothing and does not throw', () => {
        layout({});
        fs.writeFileSync(path.join(tmp, 'processes.json'), '{ not json');
        const plan = planLaneWipe(tmp, alive([100]));
        assert.strictEqual(plan.keep.length, 0);
    });

    check('a missing folder plans nothing', () => {
        const plan = planLaneWipe(path.join(tmp, 'nope'));
        assert.deepStrictEqual(plan, { remove: [], keep: [], livePorts: [] });
    });
} finally {
    fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`${passed} passed`);
