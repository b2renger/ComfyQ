// Which models count as USED — the logic a prune button stands on.
// (node server/workflows/modelUsage.test.js)
//
// Every protection class here exists because missing it would delete a model
// that something needs, so each one is pinned by a check.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { buildModelUsage } = require('./modelUsage');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'comfyq-usage-'));
const comfy = path.join(root, 'comfy');
const wf = path.join(root, 'workflows');
const demo = path.join(root, 'demo');

const put = (kind, name, mib = 1) => {
    const dir = path.join(comfy, 'models', kind);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, name), Buffer.alloc(mib * 1024 * 1024));
};
const bundle = (id, { api, template, meta }) => {
    const dir = path.join(wf, id);
    fs.mkdirSync(dir, { recursive: true });
    if (api) fs.writeFileSync(path.join(dir, `${id}.api.json`), JSON.stringify(api));
    if (template) fs.writeFileSync(path.join(dir, `${id}_template.json`), JSON.stringify(template));
    fs.writeFileSync(path.join(dir, `${id}.meta.json`), JSON.stringify(meta || { id }));
};

put('diffusion_models', 'served.safetensors', 8);
put('checkpoints', 'template_only.safetensors', 40);   // the 43 GB class
put('loras', 'style_red.safetensors');                 // reachable via a dropdown
put('loras', 'style_blue.safetensors');                // ...and its sibling
put('diffusion_models', 'demo_only.safetensors', 4);
put('diffusion_models', 'nobody.safetensors', 16);     // the only prunable one
put('checkpoints', 'cloud_name.safetensors', 32);      // named, never loaded

bundle('runs_it', {
    api: {
        '1': { class_type: 'UNETLoader', inputs: { unet_name: 'served.safetensors' } },
        '2': { class_type: 'SaveImage', inputs: { images: ['1', 0] } },
    },
    // The editable graph loads one more thing than the api.json does.
    template: {
        nodes: [
            { type: 'UNETLoader', widgets_values: ['served.safetensors'] },
            { type: 'CheckpointLoaderSimple', widgets_values: ['template_only.safetensors'] },
            // A node that takes a model NAME as text, not a file it opens.
            { type: 'GemmaAPITextEncode', widgets_values: ['cloud_name.safetensors', 'a prompt'] },
        ],
    },
    meta: {
        id: 'runs_it',
        exposedParameters: [
            { key: 'lora', nodeId: '1', field: 'lora_name', type: 'lora', optionsFilter: 'style_' },
        ],
    },
});

fs.mkdirSync(demo, { recursive: true });
fs.writeFileSync(path.join(demo, 'someones_graph.json'), JSON.stringify({
    nodes: [{ type: 'UNETLoader', widgets_values: ['demo_only.safetensors'] }],
}));

const run = (opts = {}) => buildModelUsage({ comfyRoot: comfy, workflowsDir: wf, extraDirs: [demo], ...opts });
const r = run();
const get = (name) => r.models.find(m => m.name === name);

const ok = [];
const check = (label, cond) => { assert.ok(cond, label); ok.push(label); };

// 1. The obvious case.
check('a model a bundle runs is used', get('served.safetensors').usedBy.includes('runs_it'));
check('...and is not prunable', !get('served.safetensors').unused);

// 2. ★ The editable template counts. "Open in ComfyUI" hands the template to an
//    admin, so deleting a weight only it loads breaks what they opened.
check('a model only the TEMPLATE loads is not prunable', !get('template_only.safetensors').unused);
check('...and says which bundle wants it',
    get('template_only.safetensors').templateOnly.includes('runs_it'));

// 3. ★ A lora dropdown exposes every file matching its prefix, so these appear
//    in no graph at all and a grep over the workflows finds nothing.
check('a LoRA reachable only through a dropdown is not prunable',
    !get('style_red.safetensors').unused && !get('style_blue.safetensors').unused);
check('...and names the bundle whose dropdown offers it',
    get('style_red.safetensors').dropdowns.includes('runs_it'));

// 4. Somebody else's workflow on the same machine is still somebody's work.
check('a model used only by an outside workflow folder is not prunable',
    !get('demo_only.safetensors').unused);
check('...recorded as external', get('demo_only.safetensors').external.length === 1);

// 5. ★ A filename-shaped string is not a load. Kept, but flagged for a human
//    rather than counted as a real use.
check('a model named only in a text widget is kept', !get('cloud_name.safetensors').unused);
check('...but flagged for review', get('cloud_name.safetensors').textOnly === true);
check('...with the node class that mentions it',
    get('cloud_name.safetensors').nodeTypes.some(t => t.type === 'GemmaAPITextEncode'));
check('a real loader is never flagged for review', get('served.safetensors').textOnly === false);

// 6. Only the genuinely unreferenced is offered.
check('a model nothing refers to is prunable', get('nobody.safetensors').unused === true);
check('exactly one file is prunable', r.totals.unused === 1);
check('and the reclaimable total is its size alone',
    Math.abs(r.totals.unusedGb - 16 / 1024) < 0.01);

// 7. Removing a bundle releases what only it used — the exclusivity question.
const without = run({ ignoreBundles: ['runs_it'] });
const freed = without.models.filter(m => m.unused).map(m => m.name).sort();
check('dropping the bundle frees the model it ran', freed.includes('served.safetensors'));
check('...and the one only its template loaded', freed.includes('template_only.safetensors'));
check('...and the LoRAs its dropdown offered', freed.includes('style_red.safetensors'));
check('but NOT a model an outside workflow still uses', !freed.includes('demo_only.safetensors'));

// 8. A scan that cannot see the outside folder must not call its models unused —
//    this is why the UI names the folders it checked.
const blind = buildModelUsage({ comfyRoot: comfy, workflowsDir: wf, extraDirs: [] });
check('without the outside folder, its model looks prunable (hence the warning)',
    blind.models.find(m => m.name === 'demo_only.safetensors').unused === true);

fs.rmSync(root, { recursive: true, force: true });
console.log(`modelUsage: all ${ok.length} checks passed`);
