const fs = require('fs');
const path = require('path');
const { buildModelIndex, WEIGHT_RX } = require('./vramEstimate');

// Which model files on this disk are actually used, and by what.
//
// This is the engine behind both the Maintenance tab's prune list and
// tools/model-provenance/exclusive.cjs, deliberately shared: if the admin panel
// and the command line disagreed about what is unused, one of them would be
// inviting someone to delete a model that is in use.
//
// ★ "Used" is wider than "named in a bundle's api.json", and every one of these
// classes has cost real time on this project:
//
//   bundle    a workflow ComfyQ runs. The obvious case.
//   template  the EDITABLE graph beside it. "Open in ComfyUI" hands the
//             template to an admin, so a weight only the template loads is
//             still in use — deleting it breaks the thing they opened.
//   dropdown  ★ a `lora` parameter with an optionsFilter exposes EVERY file
//             matching its prefix. Those files appear in no graph at all, so a
//             grep over the workflows finds nothing and they look orphaned.
//   external  a candidate, a demo file, or a workflow saved in ComfyUI's own
//             user dir. Not something ComfyQ serves, but somebody's work.
//
// Only a file in none of those classes is reported unused, and even then the
// caller is expected to let a human look at the list.

// Basenames that identify nothing: several repos ship a file by each of these
// names, and usage here is matched by basename alone.
const GENERIC_BASENAMES = new Set([
    "model.safetensors", "model.bin", "model.pt", "model.pth", "model.ckpt",
    "diffusion_pytorch_model.safetensors", "diffusion_pytorch_model.bin",
    "pytorch_model.bin", "pytorch_model.safetensors",
    "weights.safetensors", "weights.pth", "checkpoint.safetensors",
    "adapter_model.safetensors", "open_clip_pytorch_model.safetensors",
]);

const SUFFIXES = ['.api.json', '_template.json'];

// ComfyUI reports subfolder-qualified names on Windows (marigold_v2\x.safetensors).
const rawBasename = (v) => String(v || '').split('\\').join('/').split('/').pop();
// ★ Folded to lower case, because this runs on Windows where filenames are
// case-insensitive. Keyed case-sensitively, a template naming
// "ltx-av-…-24K.safetensors" against a file called "…-24k.safetensors" reads as
// BOTH "a loader wants a model that is missing" AND "this file is unused" — it
// offers a model that is in use for deletion. Display always uses the spelling
// found on disk (`hit.name`).
const basename = (v) => rawBasename(v).toLowerCase();

const readJson = (f) => {
    try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; }
};

// ★ A filename-shaped string is not proof a file is LOADED. The LTX 2.5
// templates mention `ltx-2.3-22b-dev.safetensors` eighteen times — every one of
// them text typed into a `GemmaAPITextEncode` widget, which names a CLOUD API
// model, not a file any loader opens. That one string protects 42.98 GB, and
// the model audit independently judged it unused for the same reason.
//
// ★ This is a NAMED LIST, not a heuristic, and that is deliberate. The obvious
// guess — "a node that loads a model has Loader in its name" — is wrong in both
// directions here: `DWPreprocessor`, `RIFE VFI` and `ASASRApplyConditioning` all
// genuinely take a model through a dropdown and none of them says Loader, so a
// heuristic flagged five files that are really in use. Being wrong in that
// direction on a PRUNE tool means offering to delete something that is needed.
// Add a class here only once you have looked at what its widget actually does;
// `/object_info` is the general answer (it declares whether an input is a combo
// of filenames or a plain STRING) but it needs ComfyUI running.
const NAMES_NOT_LOADS = new Set([
    'GemmaAPITextEncode',   // LTX cloud API: the "model" is a service name
    // A note that mentions a filename (usually beside its download link) is
    // documentation, not a load.
    'Note',
    'MarkdownNote',
    'Note Plus (mtb)',
]);
// A subgraph instance's type is a UUID; its widgets are promoted from the nodes
// inside, so it tells us nothing on its own and must not sway the verdict.
const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isLoader = (nodeType) => {
    const t = String(nodeType || '');
    if (UUID_RX.test(t)) return null;          // unknown, not a vote either way
    return !NAMES_NOT_LOADS.has(t);
};

// name -> [{ nodeType, loader }] for every weight filename a graph names.
//
// ★★ A UI-format graph hides the answer in FOUR places, and reading only the
// obvious one offered a model for deletion that a template really loads.
// `video_minimax_h3_i2v_4step`'s template has a genuine `LoraLoaderModelOnly`
// whose `inputs` is a socket ARRAY (so Object.values finds no filename at all),
// whose positional `widgets_values` says the **4step** file, and whose
// `widgets_values_named.lora_name` says the **8step** one — they disagree, and
// the named object is what a current ComfyUI frontend honours. Reading the
// array alone protected the wrong file and put 1.82 GB on the delete list.
// Measured over this library: 42 of 194 scanned files carry
// `widgets_values_named` and 85 carry `properties.models`.
//
// So all of these are read, and the union is taken — for a delete tool, over-
// protecting is the only safe direction when two fields of one node disagree:
//   inputs                     API format (an object), and UI links
//   widgets_values             UI positional values
//   widgets_values_named       UI named values, authoritative when present
//   properties.models[].name   what the frontend recorded the node as needing
//   extra.prompt               a whole API graph embedded in a UI template
function refsInGraph(graph, into = new Map()) {
    const note = (v, nodeType) => {
        if (typeof v !== 'string' || !WEIGHT_RX.test(v)) return;
        const name = basename(v);
        if (!into.has(name)) into.set(name, []);
        // `raw` keeps the spelling the graph used, so a file that is missing can
        // be reported the way the workflow asks for it rather than folded.
        into.get(name).push({ nodeType, loader: isLoader(nodeType), raw: rawBasename(v) });
    };

    const nodes = Array.isArray(graph.nodes) ? graph.nodes : Object.values(graph);
    for (const n of nodes) {
        if (!n || typeof n !== 'object') continue;
        const nodeType = n.type || n.class_type || '';

        for (const v of Object.values(n.inputs || {})) note(v, nodeType);
        if (Array.isArray(n.widgets_values)) {
            for (const v of n.widgets_values) note(v, nodeType);
        } else if (n.widgets_values && typeof n.widgets_values === 'object') {
            for (const v of Object.values(n.widgets_values)) note(v, nodeType);
        }
        if (n.widgets_values_named && typeof n.widgets_values_named === 'object') {
            for (const v of Object.values(n.widgets_values_named)) note(v, nodeType);
        }
        for (const m of (n.properties?.models || [])) note(m?.name, nodeType);

        if (Array.isArray(n.nodes)) refsInGraph({ nodes: n.nodes }, into);
    }
    for (const d of graph.definitions?.subgraphs || []) refsInGraph(d, into);
    // An exported UI template can carry the whole API graph under extra.prompt.
    // It is a real graph in a file already being read, so it counts.
    if (graph.extra?.prompt && typeof graph.extra.prompt === 'object') {
        refsInGraph(graph.extra.prompt, into);
    }
    return into;
}

// Kept for callers that only need the names.
const namesInGraph = (graph) => new Set(refsInGraph(graph).keys());

// Folders that hold JSON but no workflow. ★ __manager is the one that matters:
// ComfyUI-Manager's cache carries a model-list.json naming 527 weight files, so
// walking it would mark nearly everything on the disk as used and turn the
// prune tool into a silent no-op.
const SKIP_JSON_DIRS = new Set([
    '.git', 'node_modules', '__pycache__', '.cache', '__manager',
    'snapshots', 'startup-scripts', '.venv', 'venv',
]);

// <repo>/.comfyq-lanes/<workflow>/user/<profile>/workflows — each parallel lane
// runs its own ComfyUI with its own --user-directory, so "Open in ComfyUI" on a
// lane saves graphs there rather than in the install's own user folder.
function laneWorkflowDirs(repoRoot) {
    const base = path.join(repoRoot, '.comfyq-lanes');
    const out = [];
    let lanes = [];
    try { lanes = fs.readdirSync(base, { withFileTypes: true }); } catch { return out; }
    for (const lane of lanes) {
        if (!lane.isDirectory()) continue;
        const userDir = path.join(base, lane.name, 'user');
        let profiles = [];
        try { profiles = fs.readdirSync(userDir, { withFileTypes: true }); } catch { continue; }
        for (const prof of profiles) {
            if (!prof.isDirectory() || prof.name === '__manager') continue;
            const wf = path.join(userDir, prof.name, 'workflows');
            if (fs.existsSync(wf)) out.push(wf);
        }
    }
    return out;
}

function walkJson(dir, out = []) {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
    for (const e of entries) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
            if (SKIP_JSON_DIRS.has(e.name.toLowerCase())) continue;
            walkJson(p, out);
        } else if (e.name.endsWith('.json')) out.push(p);
    }
    return out;
}

/**
 * Classify every weight file under the install.
 *
 * @param {object}   opts
 * @param {string}   opts.comfyRoot        the ComfyUI install
 * @param {string}   opts.workflowsDir     ComfyQ's workflows/ dir
 * @param {string[]} [opts.extraDirs]      more dirs holding workflow JSON
 * @param {string[]} [opts.ignoreBundles]  bundles to treat as already gone
 * @returns {{
 *   models: Array<{name, rel, gb, kind, usedBy, templateOnly, dropdowns, external, nodeTypes, textOnly, unused}>,
 *   missing: Array<{name, nodeTypes, usedBy, templateOnly, external}>,  a loader
 *                           asks for it and it is not on disk
 *   scanned: { bundles: number, files: number, dirs: string[] },
 *   totals: { all: number, allGb: number, unused: number, unusedGb: number }
 * }}
 */
function buildModelUsage({ comfyRoot, workflowsDir, extraDirs = [], ignoreBundles = [] }) {
    const onDisk = buildModelIndex(comfyRoot);
    // Keyed the same way basename() folds, with the real spelling kept so the
    // UI shows the file as it actually appears on disk.
    const index = new Map();
    for (const [name, hit] of onDisk) {
        const key = name.toLowerCase();
        if (!index.has(key)) index.set(key, { ...hit, name });
    }
    const ignore = new Set(ignoreBundles);

    // Every bundle-shaped folder, including the ones being ignored: their files
    // are handled by the per-bundle pass below (or deliberately not handled at
    // all), so the recursive sweep of workflows/ must skip them.
    const allBundleDirs = (() => {
        try {
            return fs.readdirSync(workflowsDir, { withFileTypes: true })
                .filter(e => e.isDirectory() && !e.name.startsWith('_'))
                .map(e => e.name);
        } catch { return []; }
    })();
    const bundleIds = allBundleDirs.filter(id => !ignore.has(id));

    // name -> what uses it
    const usedBy = new Map();        // bundle id -> executed by its api.json
    const templateOnly = new Map();  // bundle id -> only in its editable template
    const external = new Map();      // a path outside the bundles
    const add = (map, name, who) => {
        if (!map.has(name)) map.set(name, new Set());
        map.get(name).add(who);
    };

    // name -> the node classes that mention it, so a reference can be judged
    const sites = new Map();
    // folded name -> how a graph first spelled it, for reporting a missing file
    const spelling = new Map();
    const noteSites = (name, refs) => {
        if (!sites.has(name)) sites.set(name, new Map());
        const m = sites.get(name);
        for (const r of refs) {
            m.set(r.nodeType, (m.get(r.nodeType) || 0) + 1);
            if (r.raw && !spelling.has(name)) spelling.set(name, r.raw);
        }
    };

    let fileCount = 0;
    for (const id of bundleIds) {
        // ★ List the folder rather than opening two hardcoded filenames. The
        // registry accepts ANY `*template.json` as a bundle's template (it has
        // a documented fallback for non-canonical names), so a bundle whose
        // template is named differently would have been invisible here — and a
        // weight only it loads would have been offered for deletion.
        let entries = [];
        try {
            entries = fs.readdirSync(path.join(workflowsDir, id))
                .filter(n => n.endsWith('.json') && !n.endsWith('.meta.json') && !n.endsWith('.runtime.json'));
        } catch { continue; }
        for (const name of entries) {
            const p = path.join(workflowsDir, id, name);
            const g = readJson(p);
            if (!g) continue;
            fileCount++;
            // What EXECUTES is the api.json; everything else in the folder is a
            // graph a human can open, which is a weaker but real claim.
            const executes = name === `${id}.api.json`;
            for (const [refName, refs] of refsInGraph(g)) {
                noteSites(refName, refs);
                add(executes ? usedBy : templateOnly, refName, id);
            }
        }
    }
    // A name in both lists is simply used; keep templateOnly for the rest.
    for (const [name, set] of templateOnly) {
        if (usedBy.has(name)) {
            for (const id of set) if (usedBy.get(name).has(id)) set.delete(id);
            if (!set.size) templateOnly.delete(name);
        }
    }

    // Folders of workflow JSON that are not bundles. The first few are always
    // scanned; `extraDirs` is what an admin adds.
    //
    // ★ Relative entries resolve against the COMFYUI ROOT, matching what
    // `comfy_ui.python_executable` and `comfy_ui.output_dir` already do, so a
    // config survives the NVMe mounting under another drive letter. The
    // resolution happens HERE rather than in configManager.resolvePaths()
    // because neither caller goes through it — the admin route reads the raw
    // config and tools/model-provenance/exclusive.cjs parses config.json by
    // hand — so resolving there would reach neither and the panel and the CLI
    // would compute different folders. That is a model-deletion bug, not an
    // inconsistency.
    const resolveDir = (d) => (path.isAbsolute(d) ? d : (comfyRoot ? path.resolve(comfyRoot, d) : d));

    const repoRoot = path.dirname(workflowsDir);
    const always = [
        path.join(workflowsDir, '_candidate_workflows'),
        // ★ Every parallel lane gets its own ComfyUI --user-directory, so an
        // admin using "Open in ComfyUI" on a lane saves graphs in here. One
        // such file is already on this machine. Globbed per profile, and only
        // the workflows folder: the lane's user/__manager/cache holds a
        // model-list.json naming 527 weights (walkJson prunes __manager too).
        ...laneWorkflowDirs(repoRoot),
    ];

    const dirs = [];
    for (const dir of [...always, ...extraDirs.map(resolveDir)]) {
        if (!dir || !fs.existsSync(dir)) continue;
        dirs.push(dir);
        for (const p of walkJson(dir)) {
            const g = readJson(p);
            if (!g) continue;
            fileCount++;
            for (const [name, refs] of refsInGraph(g)) {
                noteSites(name, refs);
                add(external, name, p);
            }
        }
    }

    // ★ A lora dropdown exposes every file matching its prefix, so these are
    // reachable with no graph mentioning them at all.
    const filters = [];
    // HuggingFace repos a pipeline stages through: a folder of weights on disk
    // that no graph names file by file. See where this is filled, below.
    const repoClaims = [];
    for (const id of bundleIds) {
        const meta = readJson(path.join(workflowsDir, id, `${id}.meta.json`));
        for (const p of (meta?.exposedParameters || [])) {
            if (p.optionsFilter) {
                filters.push({ bundle: id, prefix: String(p.optionsFilter).toLowerCase() });
            }
        }
        // A declared model is in use even if the graph resolves it internally.
        for (const m of (meta?.requirements?.models || [])) {
            const b = basename(m.file);
            if (WEIGHT_RX.test(b)) { add(usedBy, b, id); continue; }
            // ★ Not a filename but a HuggingFace REPO the pipeline stages
            // through — `microsoft/TRELLIS.2-4B`, `Pixal3D/briaai_RMBG-2.0`.
            // Those repos land on disk as a folder of weights that NO graph
            // names, so every file inside read as unused and, worse, as HIGH
            // confidence: 12 files / 16.65 GB offered for deletion while the
            // bundles that need them were installed. Claim the folder.
            const asPath = String(m.file || '').split('\\').join('/').replace(/^\/+|\/+$/g, '');
            if (asPath.includes('/')) repoClaims.push({ prefix: asPath.toLowerCase(), bundle: id });
        }
    }

    const models = [];
    for (const [key, hit] of index) {
        // `key` is the folded name every map is keyed by; `hit.name` is how the
        // file is actually spelled on disk, which is what a person should see.
        const name = key;
        const used = [...(usedBy.get(name) || [])];
        const tpl = [...(templateOnly.get(name) || [])].sort();
        const ext = [...(external.get(name) || [])].sort();
        const drops = filters
            .filter(f => name.toLowerCase().startsWith(f.prefix))
            .map(f => f.bundle);
        // Inside a staged repo's folder? Then the bundle that stages it needs
        // this file, whatever its name.
        const relLower = String(hit.rel || '').split('\\').join('/').toLowerCase();
        for (const claim of repoClaims) {
            if (relLower.includes(`/${claim.prefix}/`) || relLower.startsWith(`${claim.prefix}/`)) {
                used.push(claim.bundle);
            }
        }
        const nodeTypes = [...(sites.get(name) || new Map())]
            .sort((a, b) => b[1] - a[1])
            .map(([type, n]) => ({ type, count: n, loader: isLoader(type) }));
        // ★ Every KNOWN mention is a node that names a model rather than loading
        // one, so nothing actually opens this file. Kept anyway — the safe
        // direction for a prune tool — but surfaced for a human, because this is
        // where the big reclaimable files hide (42.98 GB on this rig). Subgraph
        // UUIDs abstain rather than vote.
        const known = nodeTypes.filter(t => t.loader !== null);
        const textOnly = known.length > 0 && known.every(t => t.loader === false);
        used.sort();
        models.push({
            name: hit.name,
            rel: hit.rel,
            gb: +(hit.size / 1024 ** 3).toFixed(2),
            kind: hit.kind,
            mtimeMs: hit.mtimeMs || 0,
            // ★ A filename too generic to identify a file. Reported for rows
            // that are PROTECTED as well as unused, because the hazard runs
            // both ways: models/facebook/dinov3-.../model.safetensors reads as
            // used by three LTX templates, when all they really name is a
            // gemma path ending in the same "model.safetensors". Over-
            // protection costs disk, not data, but it should be visible.
            genericName: GENERIC_BASENAMES.has(name),
            usedBy: used,
            templateOnly: tpl,
            dropdowns: [...new Set(drops)].sort(),
            external: ext,
            nodeTypes,
            textOnly,
            unused: !used.length && !tpl.length && !ext.length && !drops.length,
        });
    }
    models.sort((a, b) => b.gb - a.gb);

    // ★ Referenced but NOT on disk — the other half of the question, and the
    // one that caught a mistake of mine. `full_encoder_small_decoder` was
    // deleted as exclusive to the Flux.2 Dev bundles; it is in fact loaded by a
    // VAELoader inside a SUBGRAPH of three live Klein templates. The scanner in
    // use at the time did not descend into `definitions.subgraphs`, and nothing
    // afterwards noticed, because the readiness chip walks the api.json only.
    // Anything a loader asks for and cannot find now shows up here.
    const missing = [];
    for (const [name, byType] of sites) {
        if (index.has(name)) continue;
        const nodeTypes = [...byType].sort((a, b) => b[1] - a[1])
            .map(([type, n]) => ({ type, count: n, loader: isLoader(type) }));
        // A note naming a file it has no copy of is not a problem.
        if (!nodeTypes.some(t => t.loader === true)) continue;
        missing.push({
            name: spelling.get(name) || name,
            nodeTypes,
            usedBy: [...(usedBy.get(name) || [])].sort(),
            templateOnly: [...(templateOnly.get(name) || [])].sort(),
            external: [...(external.get(name) || [])].sort(),
        });
    }
    missing.sort((a, b) => a.name.localeCompare(b.name));

    const unused = models.filter(m => m.unused);
    // Kept, but every reference to them is text rather than a loader widget.
    const review = models.filter(m => !m.unused && m.textOnly);
    return {
        models,
        missing,
        scanned: {
            bundles: bundleIds.length,
            files: fileCount,
            dirs,
            // The configured entries as RESOLVED, so a report can say which
            // absolute path it actually looked for rather than echoing a
            // relative string the admin cannot act on.
            configured: extraDirs.map(d => ({ entry: d, resolved: resolveDir(d), found: fs.existsSync(resolveDir(d)) })),
        },
        totals: {
            all: models.length,
            allGb: +models.reduce((t, m) => t + m.gb, 0).toFixed(2),
            unused: unused.length,
            unusedGb: +unused.reduce((t, m) => t + m.gb, 0).toFixed(2),
            review: review.length,
            reviewGb: +review.reduce((t, m) => t + m.gb, 0).toFixed(2),
            missing: missing.length,
        },
    };
}

module.exports = { buildModelUsage, refsInGraph, namesInGraph, basename, isLoader };
