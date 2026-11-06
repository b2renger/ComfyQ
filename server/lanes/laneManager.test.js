// Lane admission: will a second workflow fit on this card, and does a lane get
// its own ComfyUI state? (node server/lanes/laneManager.test.js)
//
// Nothing here spawns ComfyUI — this covers the decisions, not the processes.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { LaneManager, CARD_HEADROOM_GB } = require('./laneManager');

// _nextPort also counts as taken any port the process registry
// (.comfyq-lanes/processes.json) records with a live PID. The real file says
// what THIS machine is doing — on a rig serving a second lane, 8189 — so the
// port checks below would pass or fail with it. Give them an empty registry.
const launcher = require('../workers/comfyLauncher');
launcher.readRegistry = () => ({ procs: {}, history: [] });

// A fake ComfyUI install holding four models of known size.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'comfyq-lanes-'));
const put = (kind, name, gb) => {
    const dir = path.join(root, 'models', kind);
    fs.mkdirSync(dir, { recursive: true });
    const fd = fs.openSync(path.join(dir, name), 'w');
    fs.ftruncateSync(fd, Math.round(gb * 1024 ** 3));   // sparse: no real bytes written
    fs.closeSync(fd);
};
put('diffusion_models', 'big.safetensors', 16);
put('diffusion_models', 'small.safetensors', 3);
put('diffusion_models', 'huge.safetensors', 40);
put('vae', 'vae.safetensors', 0.5);

const graph = (model) => ({
    '1': { class_type: 'UNETLoader', inputs: { unet_name: model } },
    '2': { class_type: 'VAELoader', inputs: { vae_name: 'vae.safetensors' } },
    '3': { class_type: 'SaveImage', inputs: { images: ['1', 0], vae: ['2', 0] } },
});

const BUNDLES = {
    heavy: graph('big.safetensors'),          // 16.5 GB
    light: graph('small.safetensors'),        //  3.5 GB
    enormous: graph('huge.safetensors'),      // 40.5 GB
    opaque: {                                 // names no model at all
        '1': { class_type: 'LoadImage', inputs: { image: 'x.png' } },
        '2': { class_type: 'SaveImage', inputs: { images: ['1', 0] } },
    },
};

const makeManager = (vramGb) => {
    const config = {
        instance: { vramGb },
        comfy_ui: { root_path: root, api_port: 8188, use_sage_attention: true },
        queue: {},
    };
    const registry = {
        get: (id) => BUNDLES[id]
            ? { id, summary: { name: id }, meta: {}, apiWorkflow: BUNDLES[id] }
            : null,
    };
    return new LaneManager({ queue: {}, registry, configManager: { load: () => ({ config }) } });
};

// Pretend a lane is running, without starting a process.
const pretendLane = (mgr, workflowId, port, primary = false) => {
    mgr.lanes.set(workflowId, {
        id: `${workflowId}:${port}`, workflowId, port, primary,
        worker: null, executor: null, vramGb: mgr.vramFor(workflowId) || 0, startedAt: Date.now(),
    });
};

const ok = [];
const check = (label, cond) => { assert.ok(cond, label); ok.push(label); };

// --- sizing ---------------------------------------------------------------
const m = makeManager(32);
check('a workflow is sized from its models', Math.abs(m.vramFor('heavy') - 16.5) < 0.05);
check('a workflow naming no model has no size', m.vramFor('opaque') === null);
check('the card is read from this machine, not hardcoded', m.cardVramGb() === 32);
check('another machine reports its own card', makeManager(96).cardVramGb() === 96);

// --- the gate -------------------------------------------------------------
pretendLane(m, 'heavy', 8188, true);            // 16.5 GB in use on a 32 GB card
const light = m.fit('light');
check('a small second workflow fits beside a big one', light.ok === true);
check('...and the numbers are reported', light.needGb > 3 && light.usedGb > 16 && light.cardGb === 32);
check('free space keeps a margin for the system',
    Math.abs(light.freeGb - (32 - light.usedGb - CARD_HEADROOM_GB)) < 0.01);

const enormous = m.fit('enormous');
check('a workflow that does not fit is refused', enormous.ok === false);
check('...for the right reason', enormous.reason === 'not-enough-vram');

check('a workflow already served is not started twice', m.fit('heavy').reason === 'already-served');
check('a workflow whose size cannot be read is not waved through',
    m.fit('opaque').reason === 'size-unknown');
check('a machine with unknown VRAM refuses rather than guesses',
    makeManager(null).fit('light').reason === 'card-unknown');

// The same pair on a bigger card is fine — the fleet has 32, 48 and 96 GB.
const big = makeManager(96);
pretendLane(big, 'heavy', 8188, true);
check('what is refused on a small card is allowed on a large one', big.fit('enormous').ok === true);

// --- ports and per-lane state --------------------------------------------
check('the first lane uses the configured port', m._nextPort() === 8189);
pretendLane(m, 'light', 8189);
check('each extra lane takes the next free port', m._nextPort() === 8190);
launcher.readRegistry = () => ({ procs: { 8190: { pid: process.pid } }, history: [] });
check('a port another ComfyUI of ours still holds is skipped', m._nextPort() === 8191);
launcher.readRegistry = () => ({ procs: { 8190: { pid: 0 } }, history: [] });
check('...but not one whose process is gone', m._nextPort() === 8190);
launcher.readRegistry = () => ({ procs: {}, history: [] });

const primaryCfg = m._laneComfyConfig('heavy', 8188, true);
check('the first lane keeps the install\'s own directories',
    !primaryCfg.user_dir && !primaryCfg.temp_dir);
const extraCfg = m._laneComfyConfig('light', 8189, false);
check('an extra lane gets its own user dir', !!extraCfg.user_dir);
check('...and its own temp dir', !!extraCfg.temp_dir);
check('...both under ComfyQ, never inside the ComfyUI install',
    !extraCfg.user_dir.startsWith(root) && extraCfg.user_dir.includes('lanes'));
check('...and it is asked to leave headroom for the others', extraCfg.vram_headroom_gb > 0);
check('the port is what was asked for', extraCfg.api_port === 8189);

// A workflow that cannot run with a speed-up still gets it masked per lane.
const masked = new LaneManager({
    queue: {}, registry: {
        get: () => ({ id: 'x', summary: { name: 'x' }, meta: { requirements: { disabledPerfFlags: ['use_sage_attention'] } }, apiWorkflow: BUNDLES.light }),
    },
    configManager: { load: () => ({ config: { instance: { vramGb: 32 }, comfy_ui: { root_path: root, api_port: 8188, use_sage_attention: true }, queue: {} } }) },
});
check('a lane drops the speed-ups its workflow cannot run with',
    masked._laneComfyConfig('x', 8190, false).use_sage_attention === false);

// --- closing lanes -------------------------------------------------------
// Stub lanes that record what close() does to them, on a config that can be
// written, so closeAll's effect on activeWorkflowId can be read back.
const closing = () => {
    let config = {
        instance: { vramGb: 96 }, comfy_ui: { root_path: root, api_port: 8188 }, queue: {},
        workflows: { activeWorkflowId: 'heavy', extraLaneWorkflowIds: ['light', 'opaque'] },
    };
    const configManager = {
        load: () => ({ config }),
        update: (fn) => { config = fn(JSON.parse(JSON.stringify(config))) || config; return config; },
    };
    const registry = { get: (id) => ({ id, summary: { name: id }, meta: {} }) };
    const events = [];
    const mgr = new LaneManager({ queue: {}, registry, configManager });
    const lane = (workflowId, port, base, runningJob = null) => mgr.lanes.set(workflowId, {
        id: `${workflowId}:${port}`, workflowId, port, base, vramGb: 1, startedAt: Date.now(),
        executor: {
            _currentJobId: runningJob,
            stop() { events.push(`stop ${workflowId}`); },
            async abortCurrent(reason) {
                events.push(`abort ${workflowId} ${this._currentJobId}`);
                this.reason = reason; this._currentJobId = null; return true;
            },
        },
        worker: {
            async shutdown() { events.push(`shutdown ${workflowId}`); },
            rest: { async free() { events.push(`unload ${workflowId}`); } },
            process: { async stop() { events.push(`kill ${workflowId}`); } },
        },
    });
    return { mgr, lane, events, config: () => config };
};

(async () => {
    const quiet = console.log; console.log = () => {};
    try {
        // Stop serving with three lanes: the main one must stay the active workflow.
        const a = closing();
        a.lane('heavy', 8188, true); a.lane('light', 8189, false); a.lane('opaque', 8190, false);
        await a.mgr.closeAll();
        check('Stop serving keeps the main workflow as the active one', a.config().workflows.activeWorkflowId === 'heavy');
        check('...and forgets the extra lanes', a.config().workflows.extraLaneWorkflowIds.length === 0);
        check('...and every lane was closed', a.mgr.lanes.size === 0);
        const stops = a.events.filter(e => e.startsWith('stop '));
        check('...the main lane last', stops[stops.length - 1] === 'stop heavy');

        // Closing a lane under a running job stops that job instead of orphaning it.
        const b = closing();
        b.lane('heavy', 8188, true, 'job-1');
        const exec = b.mgr.get('heavy').executor;
        await b.mgr.close('heavy');
        check('closing a lane stops the job it is running', b.events.includes('abort heavy job-1'));
        check('...after its executor stopped taking jobs', b.events.indexOf('stop heavy') < b.events.indexOf('abort heavy job-1'));
        check('...and before its worker lets go of ComfyUI', b.events.indexOf('abort heavy job-1') < b.events.indexOf('shutdown heavy'));
        check('...with a reason a student can read', /stopped being served/.test(exec.reason || ''));
        check("...and the install's ComfyUI only has its models unloaded", b.events.includes('unload heavy') && !b.events.includes('kill heavy'));

        const c = closing();
        c.lane('light', 8189, false);
        await c.mgr.close('light');
        check('an idle lane is closed without stopping anything', !c.events.some(e => e.startsWith('abort')));
        check('...and a lane on its own port has its ComfyUI stopped', c.events.includes('kill light'));
    } finally { console.log = quiet; }

    // cancelPrompts names each prompt on every lane, and one dead lane stops nothing.
    {
        const calls = [];
        const fakeLane = (name, dead) => ({ worker: { rest: {
            deleteFromQueue: async (ids) => { if (dead) throw new Error('down'); calls.push([name, 'queue', ids.join()]); },
            interrupt: async (id) => { if (dead) throw new Error('down'); calls.push([name, 'interrupt', id]); },
        } } });
        const lm = Object.create(LaneManager.prototype);
        lm.lanes = new Map([['a', fakeLane('a', true)], ['b', fakeLane('b', false)]]);
        await lm.cancelPrompts(['p1', 'p2']);
        assert.deepStrictEqual(calls, [['b', 'queue', 'p1,p2'], ['b', 'interrupt', 'p1'], ['b', 'interrupt', 'p2']]);
        assert.ok(calls.every(c => c[2] !== undefined), 'an interrupt with no id would stop whatever is running');
        await lm.cancelPrompts([]);
        assert.strictEqual(calls.length, 3);
        ok.push('cancelPrompts');
    }

    // Closing a lane cancels what only it would have run; a failure there stops nothing.
    {
        const lm = Object.create(LaneManager.prototype);
        const seen = [];
        lm.lanes = new Map([['kept', {}]]);
        lm.queue = { cancelUnserved: (served, reason) => { seen.push([served.join(), reason]); return []; } };
        assert.deepStrictEqual(lm.cancelUnserved(), []);
        assert.deepStrictEqual(seen, [['kept', 'workflow-not-served']]);
        lm.queue = { cancelUnserved: () => { throw new Error('locked'); } };
        assert.deepStrictEqual(lm.cancelUnserved(), []);
        ok.push('cancelUnserved');
    }

    // A live switch: bookings refused while it lasts, even if the open fails.
    {
        const lm = Object.create(LaneManager.prototype);
        const during = [];
        lm.onChange = () => during.push(lm.switching);
        lm.mainLane = () => ({ workflowId: 'old' });
        lm.close = async () => { during.push('close:' + lm.switching); };
        lm.open = async () => { during.push('open:' + lm.switching); throw new Error('no ComfyUI'); };
        await assert.rejects(() => lm.switchMain('new'), /no ComfyUI/);
        assert.deepStrictEqual(during, [true, 'close:true', 'open:true', false]);
        assert.strictEqual(lm.switching, false);
        ok.push('switchMain');
    }

    // A live switch must fit beside the lanes that stay.
    {
        const lm = makeManager(32);
        pretendLane(lm, 'light', 8188, true);
        pretendLane(lm, 'heavy', 8189, false);
        lm.configManager.load().config.workflows = { activeWorkflowId: 'light' };
        assert.strictEqual(lm.fitSwitch('light').ok, true, 'a small one fits where the main lane was');
        const v = lm.fitSwitch('enormous');
        assert.strictEqual(v.ok, false, 'no room beside the lane that stays');
        assert.ok(v.message.includes('Close') && v.lanes.includes('heavy'), v.message);
        assert.strictEqual(lm.fitSwitch('opaque').ok, true, 'a cannot-tell does not stop the main workflow');
        const alone = makeManager(32);
        pretendLane(alone, 'light', 8188, true);
        assert.strictEqual(alone.fitSwitch('enormous').ok, true, 'alone on the card, nothing to collide with');
        ok.push('fitSwitch');
    }

    // A batch moves the main lane between workflows: flags follow the workflow.
    {
        const lm = Object.create(LaneManager.prototype);
        const calls = [];
        const process = { useSageAttention: true, fp16Accumulation: true };
        const worker = {
            process,
            rest: { free: async () => calls.push('free') },
            ensureLaunchSettings: async () => calls.push(`check sage=${process.useSageAttention}`),
        };
        const lane = { id: 'l', workflowId: 'plain', ranWorkflowId: 'plain', worker };
        lm.lanes = new Map([['plain', lane]]);
        lm.registry = { get: (id) => (id === 'blackout' ? { meta: { requirements: { disabledPerfFlags: ['use_sage_attention'] } } } : { meta: {} }) };
        lm.configManager = { load: () => ({ config: { comfy_ui: { use_sage_attention: true, fp16_accumulation: true } } }) };
        await lm._prepareRun('plain', 'plain');
        assert.deepStrictEqual(calls, [], 'the same workflow costs nothing');
        await lm._prepareRun('plain', 'blackout');
        assert.deepStrictEqual(calls, ['free', 'check sage=false']);
        assert.strictEqual(lane.ranWorkflowId, 'blackout');
        await lm._prepareRun('plain', 'plain');
        assert.deepStrictEqual(calls, ['free', 'check sage=false', 'free', 'check sage=true'], 'the flag comes back for a workflow that can use it');
        ok.push('_prepareRun');
    }

    fs.rmSync(root, { recursive: true, force: true });
    console.log(`laneManager: all ${ok.length} checks passed`);
})().catch((e) => { console.error(e); process.exit(1); });
