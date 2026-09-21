// VRAM estimate: does it count the models ComfyUI will actually load?
// (node server/workflows/vramEstimate.test.js)
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { estimateWorkflowVram, activeNodes } = require('./vramEstimate');

// A fake ComfyUI install: <root>/models/<kind>/<file>, sized in MiB.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'comfyq-vram-'));
const put = (kind, name, mib) => {
    const dir = path.join(root, 'models', kind);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, name), Buffer.alloc(mib * 1024 * 1024));
};
put('diffusion_models', 'base.safetensors', 900);      // the model when Fast mode is off
put('diffusion_models', 'turbo.safetensors', 300);     // ...and when it is on
put('text_encoders', 'te.safetensors', 400);
put('vae', 'vae.safetensors', 100);

// base ──┐
//        ├─ ComfySwitchNode(switch=false) ── sampler ── SaveImage
// turbo ─┘
const switched = (flag) => ({
    '1': { class_type: 'UNETLoader', inputs: { unet_name: 'base.safetensors' } },
    '2': { class_type: 'UNETLoader', inputs: { unet_name: 'turbo.safetensors' } },
    '3': { class_type: 'PrimitiveBoolean', inputs: { value: flag } },
    '4': { class_type: 'ComfySwitchNode', inputs: { switch: ['3', 0], on_false: ['1', 0], on_true: ['2', 0] } },
    '5': { class_type: 'CLIPLoader', inputs: { clip_name: 'te.safetensors' } },
    '6': { class_type: 'VAELoader', inputs: { vae_name: 'vae.safetensors' } },
    '7': { class_type: 'KSampler', inputs: { model: ['4', 0], clip: ['5', 0] } },
    '8': { class_type: 'SaveImage', inputs: { images: ['7', 0], vae: ['6', 0] } },
});

const ok = [];
const check = (label, cond) => { assert.ok(cond, label); ok.push(label); };
const near = (a, b) => Math.abs(a - b) < 0.02;

// 1. Only the taken branch counts — the whole point of the estimator.
const off = estimateWorkflowVram(switched(false), root);
check('fast mode off loads the base model, not the turbo one',
    off.components.some(c => c.name === 'base.safetensors') &&
    !off.components.some(c => c.name === 'turbo.safetensors'));
check('total is base + te + vae', near(off.weightsGb, (900 + 400 + 100) / 1024));
check('the unselected branch is reported as pruned', near(off.prunedGb, 300 / 1024));

const on = estimateWorkflowVram(switched(true), root);
check('fast mode on loads the turbo model instead',
    on.components.some(c => c.name === 'turbo.safetensors') &&
    !on.components.some(c => c.name === 'base.safetensors'));
check('and totals less', on.weightsGb < off.weightsGb);

// 2. An unresolvable switch must NOT under-report: count both sides.
const opaque = switched(false);
opaque['4'].inputs.switch = ['9', 0];
opaque['9'] = { class_type: 'SomeCustomLogic', inputs: {} };
const both = estimateWorkflowVram(opaque, root);
check('an unreadable switch counts both branches rather than guessing low',
    near(both.weightsGb, (900 + 300 + 400 + 100) / 1024));

// 3. The breakdown the admin panel shows.
check('components are sorted biggest first', off.components[0].name === 'base.safetensors');
check('kinds come from the models subfolder',
    off.components.find(c => c.name === 'te.safetensors').kind === 'text encoder' &&
    off.components.find(c => c.name === 'vae.safetensors').kind === 'vae');
check('largestGb is the single biggest model', near(off.largestGb, 900 / 1024));

// 4. A model named but not installed is listed, not silently dropped.
const missing = switched(false);
missing['5'].inputs.clip_name = 'nowhere.safetensors';
const miss = estimateWorkflowVram(missing, root);
check('a missing model is reported', miss.unresolved.includes('nowhere.safetensors'));
check('...and excluded from the total', near(miss.weightsGb, (900 + 100) / 1024));

// 5. A graph naming no model at all is UNKNOWN, never 0 GB. Three real bundles
//    are like this (pixal3d / trellis2 / liveportrait resolve models internally).
const none = estimateWorkflowVram({
    '1': { class_type: 'LoadImage', inputs: { image: 'x.png' } },
    '2': { class_type: 'Pixal3DMesh', inputs: { image: ['1', 0] } },
}, root);
check('no model filenames means unknown', none.known === false);
check('unknown does not masquerade as zero', none.weightsGb === 0 && none.components.length === 0);

// 6. A graph with no Save* node still gets walked (topological fallback).
const pathOut = {
    '1': { class_type: 'UNETLoader', inputs: { unet_name: 'base.safetensors' } },
    '2': { class_type: 'WriteMeshToDisk', inputs: { model: ['1', 0] } },
};
check('a bundle with no Save node is still analysed',
    estimateWorkflowVram(pathOut, root).weightsGb > 0);

// 7. Dead nodes that feed nothing are not mistaken for outputs when a real
//    output node exists (several bundles ship inert leftovers).
const withLeftover = switched(false);
withLeftover['10'] = { class_type: 'UNETLoader', inputs: { unet_name: 'turbo.safetensors' } };
check('an inert leftover loader is not counted',
    near(estimateWorkflowVram(withLeftover, root).weightsGb, off.weightsGb));

// 8. activeNodes is reachability, not the whole graph.
check('activeNodes prunes the unselected loader', !activeNodes(switched(false)).has('2'));

fs.rmSync(root, { recursive: true, force: true });
console.log(`vramEstimate: all ${ok.length} checks passed`);
