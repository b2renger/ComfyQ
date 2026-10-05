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

const SUFFIXES = ['.api.json', '_template.json'];

// ComfyUI reports subfolder-qualified names on Windows (marigold_v2\x.safetensors).
const basename = (v) => String(v || '').split('\\').join('/').split('/').pop();

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
]);
// A subgraph instance's type is a UUID; its widgets are promoted from the nodes
// inside, so it tells us nothing on its own and must not sway the verdict.
const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isLoader = (nodeType) => {
    const t = String(nodeType || '');
    if (UUID_RX.test(t)) return null;          // unknown, not a vote either way
    return !NAMES_NOT_LOADS.has(t);
};

// name -> [{ nodeType, loader }] for every weight filename a graph names, in
// either format. Reads widget values as well as inputs, because a UI-format
// graph keeps them there.
function refsInGraph(graph, into = new Map()) {
    const nodes = Array.isArray(graph.nodes) ? graph.nodes : Object.values(graph);
    for (const n of nodes) {
        if (!n || typeof n !== 'object') continue;
        const nodeType = n.type || n.class_type || '';
        const vals = [
            ...Object.values(n.inputs || {}),
            ...(Array.isArray(n.widgets_values) ? n.widgets_values : []),
        ];
        for (const v of vals) {
            if (typeof v !== 'string' || !WEIGHT_RX.test(v)) continue;
            const name = basename(v);
            if (!into.has(name)) into.set(name, []);
            into.get(name).push({ nodeType, loader: isLoader(nodeType) });
        }
        if (Array.isArray(n.nodes)) refsInGraph({ nodes: n.nodes }, into);
    }
    for (const d of graph.definitions?.subgraphs || []) refsInGraph(d, into);
    return into;
}

// Kept for callers that only need the names.
const namesInGraph = (graph) => new Set(refsInGraph(graph).keys());

function walkJson(dir, out = []) {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
    for (const e of entries) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walkJson(p, out);
        else if (e.name.endsWith('.json')) out.push(p);
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
 *   models: Array<{name, rel, gb, kind, usedBy, templateOnly, dropdowns, external, unused}>,
 *   scanned: { bundles: number, files: number, dirs: string[] },
 *   totals: { all: number, allGb: number, unused: number, unusedGb: number }
 * }}
 */
function buildModelUsage({ comfyRoot, workflowsDir, extraDirs = [], ignoreBundles = [] }) {
    const index = buildModelIndex(comfyRoot);
    const ignore = new Set(ignoreBundles);

    const bundleIds = (() => {
        try {
            return fs.readdirSync(workflowsDir, { withFileTypes: true })
                .filter(e => e.isDirectory() && !e.name.startsWith('_'))
                .map(e => e.name)
                .filter(id => !ignore.has(id));
        } catch { return []; }
    })();

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
    const noteSites = (name, refs) => {
        if (!sites.has(name)) sites.set(name, new Map());
        const m = sites.get(name);
        for (const r of refs) m.set(r.nodeType, (m.get(r.nodeType) || 0) + 1);
    };

    let fileCount = 0;
    for (const id of bundleIds) {
        for (const suf of SUFFIXES) {
            const p = path.join(workflowsDir, id, id + suf);
            const g = readJson(p);
            if (!g) continue;
            fileCount++;
            for (const [name, refs] of refsInGraph(g)) {
                noteSites(name, refs);
                add(suf === '.api.json' ? usedBy : templateOnly, name, id);
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

    const dirs = [];
    const candidates = path.join(workflowsDir, '_candidate_workflows');
    for (const dir of [candidates, ...extraDirs]) {
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
            if (WEIGHT_RX.test(b)) add(usedBy, b, id);
        }
    }

    const models = [];
    for (const [name, hit] of index) {
        const used = [...(usedBy.get(name) || [])].sort();
        const tpl = [...(templateOnly.get(name) || [])].sort();
        const ext = [...(external.get(name) || [])].sort();
        const drops = filters
            .filter(f => name.toLowerCase().startsWith(f.prefix))
            .map(f => f.bundle);
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
        models.push({
            name,
            rel: hit.rel,
            gb: +(hit.size / 1024 ** 3).toFixed(2),
            kind: hit.kind,
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

    const unused = models.filter(m => m.unused);
    // Kept, but every reference to them is text rather than a loader widget.
    const review = models.filter(m => !m.unused && m.textOnly);
    return {
        models,
        scanned: { bundles: bundleIds.length, files: fileCount, dirs },
        totals: {
            all: models.length,
            allGb: +models.reduce((t, m) => t + m.gb, 0).toFixed(2),
            unused: unused.length,
            unusedGb: +unused.reduce((t, m) => t + m.gb, 0).toFixed(2),
            review: review.length,
            reviewGb: +review.reduce((t, m) => t + m.gb, 0).toFixed(2),
        },
    };
}

module.exports = { buildModelUsage, refsInGraph, namesInGraph, basename, isLoader };
