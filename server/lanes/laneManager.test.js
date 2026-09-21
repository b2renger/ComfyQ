// Lane admission: will a second workflow fit on this card, and does a lane get
// its own ComfyUI state? (node server/lanes/laneManager.test.js)
//
// Nothing here spawns ComfyUI — this covers the decisions, not the processes.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { LaneManager, CARD_HEADROOM_GB } = require('./laneManager');

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

fs.rmSync(root, { recursive: true, force: true });
console.log(`laneManager: all ${ok.length} checks passed`);
