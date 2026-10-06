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
// Fixtures for the subgraph and note-only checks further down. Declared up
// here for the same reason as the rest: buildModelIndex caches for 30 s, so a
// model file written after the first scan is invisible to it.
put('vae', 'inside_subgraph.safetensors', 2);
put('vae', 'nested_deeper.safetensors', 2);
put('loras', 'only_in_a_note.safetensors', 3);
// Fixtures for the UI-shape, case and lane checks below.
put('loras', 'positional.safetensors', 1);
put('loras', 'named_wins.safetensors', 1);
put('loras', 'from_properties.safetensors', 1);
put('vae', 'inside_extra_prompt.safetensors', 1);
put('vae', 'mixed_case.safetensors', 1);          // referenced as MiXeD_CaSe.SafeTensors
put('vae', 'lane_saved.safetensors', 1);
// A staged HuggingFace repo lands as a FOLDER of weights, so it is written
// here with the other fixtures: buildModelIndex caches for 30 s.
const repoDir = path.join(comfy, 'models', 'vendor', 'Some-Model-4B', 'ckpts');
fs.mkdirSync(repoDir, { recursive: true });
fs.writeFileSync(path.join(repoDir, 'stage_one.safetensors'), Buffer.alloc(1024));
fs.writeFileSync(path.join(repoDir, 'stage_two.safetensors'), Buffer.alloc(1024));
// A node pack that opens weights by a path it BUILDS IN CODE, which is how
// comfyui-liveportraitkj loads five files with no widget anywhere.
const packDir = path.join(comfy, 'custom_nodes', 'somepack');
fs.mkdirSync(packDir, { recursive: true });
fs.writeFileSync(path.join(packDir, 'nodes.py'), [
    'import os, folder_paths',
    'base = os.path.join(folder_paths.models_dir, "somepack")',
    'p = os.path.join(base, "hardcoded_weight.safetensors")',
    'q = os.path.join(folder_paths.models_dir, "loras", "shared_lora.safetensors")',
].join(String.fromCharCode(10)));
put('somepack', 'anything_in_the_pack_folder.safetensors', 2);
put('loras', 'shared_lora.safetensors', 2);
put('diffusion_models', 'hardcoded_weight.safetensors', 2);
// A pack that offers its model sets as a DROPDOWN of HuggingFace repo ids and
// then joins models_dir with the CHOSEN VALUE — so the folder never appears as
// a literal second argument. ComfyUI-Trellis2 does this, and 7.54 GB of its
// fp8 set was offered for deletion as a result.
const dropPack = path.join(comfy, 'custom_nodes', 'droppack');
fs.mkdirSync(dropPack, { recursive: true });
fs.writeFileSync(path.join(dropPack, 'nodes.py'), [
    'OPTIONS = ["vendorA/Set-BF16", "vendorB/Set-FP8"]',
    'model_path = os.path.join(folder_paths.models_dir, modelname)',
    'other = os.path.join(folder_paths.models_dir, "notondisk/Nope")',
].join(String.fromCharCode(10)));
const fp8Dir = path.join(comfy, 'models', 'vendorB', 'Set-FP8', 'ckpts_fp8');
fs.mkdirSync(fp8Dir, { recursive: true });
fs.writeFileSync(path.join(fp8Dir, 'stem_fp8.safetensors'), Buffer.alloc(2048));

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

// 6. Only the genuinely unreferenced is offered. (The global count is asserted
//    at the very end, once every fixture bundle below exists — the later
//    sections add models whose bundles are not written yet at this point.)
check('a model nothing refers to is prunable', get('nobody.safetensors').unused === true);
check('none of the protected ones is offered',
    ['served.safetensors', 'template_only.safetensors', 'style_red.safetensors',
        'style_blue.safetensors', 'demo_only.safetensors', 'cloud_name.safetensors']
        .every(n => get(n).unused === false));

// 7. Removing a bundle releases what only it used — the exclusivity question.
const without = run({ ignoreBundles: ['runs_it'] });
const freed = without.models.filter(m => m.unused).map(m => m.name).sort();
check('dropping the bundle frees the model it ran', freed.includes('served.safetensors'));
check('...and the one only its template loaded', freed.includes('template_only.safetensors'));
check('...and the LoRAs its dropdown offered', freed.includes('style_red.safetensors'));
check('but NOT a model an outside workflow still uses', !freed.includes('demo_only.safetensors'));

// 8. ★★ A loader INSIDE A SUBGRAPH counts. This is the check that was missing:
//    `full_encoder_small_decoder.safetensors` was deleted as exclusive to the
//    Flux.2 Dev bundles when it is in fact loaded by a VAELoader inside a
//    subgraph of three live Klein TEMPLATES. The scanner in use at the time
//    walked `nodes` but not `definitions.subgraphs`, so it saw nothing.
bundle('subgraphy', {
    api: { '1': { class_type: 'SaveImage', inputs: {} } },
    template: {
        nodes: [{ type: '2f1a8c3e-0000-4000-8000-000000000001', widgets_values: [] }],
        definitions: {
            subgraphs: [{
                name: 'Text to Image',
                nodes: [
                    { type: 'VAELoader', widgets_values: ['inside_subgraph.safetensors'] },
                    { type: 'Group', nodes: [{ type: 'VAELoader', widgets_values: ['nested_deeper.safetensors'] }] },
                ],
            }],
        },
    },
    meta: { id: 'subgraphy' },
});
const sub = run();
check('a loader inside definitions.subgraphs counts as used',
    sub.models.find(m => m.name === 'inside_subgraph.safetensors').unused === false);
check('...attributed to the bundle whose template holds it',
    sub.models.find(m => m.name === 'inside_subgraph.safetensors').templateOnly.includes('subgraphy'));
check('a loader nested deeper still counts',
    sub.models.find(m => m.name === 'nested_deeper.safetensors').unused === false);

// 9. ★ A reference has to BE a filename, not contain one. A note saying
//    "download x.safetensors from <link>" is one long markdown string, and the
//    whole widget value must look like a filename to count — so prose mentioning
//    a model is not a use, and such a file stays prunable. Pinned because the
//    opposite (substring matching) would protect a model for ever on the
//    strength of a sentence in a note, and every ComfyUI template has notes.
bundle('notes_only', {
    api: { '1': { class_type: 'SaveImage', inputs: {} } },
    template: {
        nodes: [
            { type: 'MarkdownNote', widgets_values: ['get only_in_a_note.safetensors from somewhere'] },
            // A widget whose ENTIRE value is the filename, on a node that names
            // rather than loads: that does register, and reads as text-only.
            { type: 'GemmaAPITextEncode', widgets_values: ['only_in_a_note.safetensors'] },
        ],
    },
    meta: { id: 'notes_only' },
});
const noted = run();
const note = noted.models.find(m => m.name === 'only_in_a_note.safetensors');
check('prose that merely mentions a filename is not a load', !note.usedBy.length);
check('a naming node is recorded, and reads as text rather than a load',
    note.textOnly === true && note.nodeTypes.some(t => t.type === 'GemmaAPITextEncode'));
check('...and a MarkdownNote sentence contributed nothing',
    !note.nodeTypes.some(t => t.type === 'MarkdownNote'));

// 10. ★ Referenced by a loader but NOT on disk — the other half of the question.
//     Nothing reported this when a real model went missing.
const gone = run({ ignoreBundles: [] });
bundle('wants_missing', {
    api: { '1': { class_type: 'VAELoader', inputs: { vae_name: 'not_here_at_all.safetensors' } } },
    meta: { id: 'wants_missing' },
});
const broken = run();
check('a model a loader wants but the disk lacks is reported missing',
    broken.missing.some(m => m.name === 'not_here_at_all.safetensors'));
check('...naming the bundle that wants it',
    broken.missing.find(m => m.name === 'not_here_at_all.safetensors').usedBy.includes('wants_missing'));
check('a file that IS on disk is never reported missing',
    !broken.missing.some(m => m.name === 'served.safetensors') && gone.models.length > 0);

// 11. ★★ A UI graph hides the answer in four places. Reading only the positional
//     `widgets_values` put a model on the delete list that a template really
//     loads: video_minimax_h3_i2v_4step's LoraLoaderModelOnly has `inputs` as a
//     socket ARRAY (so Object.values finds no filename), its positional array
//     naming the 4-step file and `widgets_values_named.lora_name` naming the
//     8-step one — they DISAGREE, and the named object is what a current ComfyUI
//     frontend honours. Measured over the real library: 42 of 194 scanned files
//     carry widgets_values_named and 85 carry properties.models.
bundle('ui_shapes', {
    api: { '1': { class_type: 'SaveImage', inputs: {} } },
    template: {
        nodes: [{
            type: 'LoraLoaderModelOnly',
            inputs: [{ name: 'model', type: 'MODEL', link: 3 }],   // a socket array, not an object
            widgets_values: ['positional.safetensors', 1],
            widgets_values_named: { lora_name: 'named_wins.safetensors', strength_model: 1 },
            properties: { models: [{ name: 'from_properties.safetensors', url: 'https://example.invalid/x' }] },
        }],
        // An exported UI template can carry a whole API graph here.
        extra: {
            prompt: {
                '9': { class_type: 'VAELoader', inputs: { vae_name: 'inside_extra_prompt.safetensors' } },
            },
        },
    },
    meta: { id: 'ui_shapes' },
});
const shapes = run();
const shaped = (n) => shapes.models.find(m => m.name === n);
check('a positional widget value counts', shaped('positional.safetensors').unused === false);
check('widgets_values_named counts — the field the frontend honours',
    shaped('named_wins.safetensors').unused === false);
check('properties.models[].name counts', shaped('from_properties.safetensors').unused === false);
check('a graph embedded in extra.prompt counts',
    shaped('inside_extra_prompt.safetensors').unused === false);
check('all four are attributed to the bundle whose template holds them',
    ['positional.safetensors', 'named_wins.safetensors', 'from_properties.safetensors',
        'inside_extra_prompt.safetensors'].every(n => shaped(n).templateOnly.includes('ui_shapes')));

// 12. ★ Case. Windows filenames are case-insensitive, so a graph naming
//     "…-24K.safetensors" against a file called "…-24k.safetensors" must match.
//     Keyed case-sensitively it read as a missing model AND left the real file
//     looking unused — offering a model that is in use for deletion.
bundle('shouty', {
    api: { '1': { class_type: 'VAELoader', inputs: { vae_name: 'MiXeD_CaSe.SafeTensors' } } },
    meta: { id: 'shouty' },
});
const cased = run();
const mixed = cased.models.find(m => m.name.toLowerCase() === 'mixed_case.safetensors');
check('a reference matches a file that differs only in case', !!mixed && mixed.unused === false);
check('...reported with the spelling found on disk', mixed.name === 'mixed_case.safetensors');
check('...so it is not also reported missing',
    !cased.missing.some(m => m.name.toLowerCase() === 'mixed_case.safetensors'));

// 13. ★ A parallel lane keeps its own ComfyUI user directory, so "Open in
//     ComfyUI" on a lane saves graphs under
//     .comfyq-lanes/<id>/user/<profile>/workflows. One such file already exists
//     on the owner's machine. ⚠ And the lane's user/__manager/cache holds a
//     model-list.json naming 527 weight filenames — walking that would mark
//     nearly the whole disk as used and turn the prune tool into a no-op.
const laneWf = path.join(root, '.comfyq-lanes', 'some_lane', 'user', 'default', 'workflows');
fs.mkdirSync(laneWf, { recursive: true });
fs.writeFileSync(path.join(laneWf, 'saved.json'), JSON.stringify({
    nodes: [{ type: 'VAELoader', widgets_values: ['lane_saved.safetensors'] }],
}));
const mgrCache = path.join(root, '.comfyq-lanes', 'some_lane', 'user', '__manager', 'cache');
fs.mkdirSync(mgrCache, { recursive: true });
fs.writeFileSync(path.join(mgrCache, 'model-list.json'), JSON.stringify({
    models: [{ filename: 'nobody.safetensors' }],
}));
const laned = run();
check('a graph saved in a lane user dir protects its model',
    laned.models.find(m => m.name === 'lane_saved.safetensors').unused === false);
check("but the lane's ComfyUI-Manager cache is NOT read",
    laned.models.find(m => m.name === 'nobody.safetensors').unused === true);

// 14. ★ Relative scan dirs resolve against the COMFYUI ROOT, matching what
//     comfy_ui.python_executable and output_dir already do, so a config
//     survives the drive mounting under another letter. Resolved inside
//     buildModelUsage because neither caller passes through resolvePaths.
const relEntry = path.relative(comfy, demo).split(path.sep).join('/');
const rel = buildModelUsage({ comfyRoot: comfy, workflowsDir: wf, extraDirs: [relEntry] });
check('a relative scan dir resolves against the ComfyUI root',
    rel.models.find(m => m.name === 'demo_only.safetensors').unused === false);
check('...and the report says which absolute path it looked in',
    rel.scanned.configured.some(c => c.entry === relEntry
        && path.normalize(c.resolved) === path.normalize(demo) && c.found === true));
check('an absolute entry is left alone',
    buildModelUsage({ comfyRoot: comfy, workflowsDir: wf, extraDirs: [demo] })
        .scanned.configured[0].resolved === demo);


// 15. ★★ A bundle can declare a HuggingFace REPO it stages through rather
//     than a filename — `microsoft/TRELLIS.2-4B`. The repo lands on disk as a
//     folder of weights that NO graph names file by file, so every file inside
//     read as unused AND as high confidence: 12 files / 16.65 GB were being
//     offered for deletion while the bundles that need them were installed.
bundle('stages_a_repo', {
    api: { '1': { class_type: 'VendorImageTo3D', inputs: { image: 'x.png' } } },
    meta: {
        id: 'stages_a_repo',
        requirements: {
            models: [
                { type: 'other', file: 'vendor/Some-Model-4B', auto: true, note: 'staged by the pack' },
            ],
        },
    },
});
const staged = run();
check('every file inside a staged repo folder is claimed by the bundle',
    ['stage_one.safetensors', 'stage_two.safetensors'].every(n => {
        const m = staged.models.find(x => x.name === n);
        return m && m.unused === false && m.usedBy.includes('stages_a_repo');
    }));
check('...and a file outside that folder is NOT claimed by it',
    !staged.models.find(m => m.name === 'nobody.safetensors').usedBy.includes('stages_a_repo'));


// 16. ★★★ A pack can open a weight by a path it BUILDS IN CODE — no widget,
//     no graph string. comfyui-liveportraitkj joins models_dir with
//     "liveportrait" and then each filename, and its loader node's only input
//     is "precision". stitching_retargeting_module.safetensors therefore
//     scored HIGH CONFIDENCE DELETABLE while the rig-verified LivePortrait
//     bundle loads it on every job, and six siblings were saved only by a
//     hand-written decisions.json entry that had a hole exactly there.
const coded = run();
check('a weight named in the pack own python is protected',
    coded.models.find(m => m.name === 'hardcoded_weight.safetensors').unused === false);
check('...attributed to the pack that loads it',
    coded.models.find(m => m.name === 'hardcoded_weight.safetensors').packCode.includes('somepack'));
check('every weight inside the pack OWN model folder is protected too',
    coded.models.find(m => m.name === 'anything_in_the_pack_folder.safetensors').unused === false);
// ★ But a pack naming one of ComfyUI SHARED folders is not claiming it:
//   treating models_dir/"diffusion_models" as a claim protected 285 GB and
//   left the prune tool with nothing to offer.
check('a pack referencing a shared model folder does not claim the folder',
    coded.models.find(m => m.name === 'nobody.safetensors').packCode.length === 0);
check('...though a file it names BY NAME inside one is still protected',
    coded.models.find(m => m.name === 'shared_lora.safetensors').unused === false);


// 17. ★★★ A pack whose model folder arrives in a VARIABLE from a dropdown of
//     HuggingFace repo ids. Neither the filename matcher (the stems live
//     extensionless and slash-qualified inside the staged repo's own JSON
//     manifest) nor the literal-folder matcher can see it, and the bf16 twins
//     being in use meant the only thing holding the fp8 set back was
//     variant-sibling — whose text told the admin to keep the build in use and
//     delete the lookalike. An owner/name literal now claims that folder, but
//     only when models/<owner>/<name> really exists.
const dropped = run();
check('an owner/name literal claims that model folder',
    dropped.models.find(m => m.name === 'stem_fp8.safetensors').unused === false);
check('...attributed to the pack that offers it',
    dropped.models.find(m => m.name === 'stem_fp8.safetensors').packCode.includes('droppack'));
check('a repo id whose folder is NOT on disk claims nothing',
    dropped.models.find(m => m.name === 'nobody.safetensors').packCode.length === 0);

// 18. A scan that cannot see the outside folder must not call its models unused —
//    this is why the UI names the folders it checked.
const blind = buildModelUsage({ comfyRoot: comfy, workflowsDir: wf, extraDirs: [] });
check('without the outside folder, its model looks prunable (hence the warning)',
    blind.models.find(m => m.name === 'demo_only.safetensors').unused === true);

// 19. With every fixture bundle in place, exactly one file is reclaimable and
//     the total is its size alone. Asserted last because the sections above add
//     models whose bundles are written as they go.
const settled = run();
check('with every bundle present, exactly one file is prunable', settled.totals.unused === 1);
check('and the reclaimable total is that one file',
    Math.abs(settled.totals.unusedGb - 16 / 1024) < 0.01);

fs.rmSync(root, { recursive: true, force: true });
console.log(`modelUsage: all ${ok.length} checks passed`);
