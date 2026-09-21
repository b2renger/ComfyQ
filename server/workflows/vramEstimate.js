const fs = require('fs');
const path = require('path');

// How much VRAM a workflow's models need.
//
// This is what decides whether a second workflow can be served alongside the
// first one on the same card, so it has to be honest about what it does not
// know: a bundle whose models are resolved inside its nodes reports `unknown`,
// never 0 GB.
//
// The number is the weight of every model file on the graph's ACTIVE path,
// which is an upper bound on resident weights: ComfyUI offloads a text encoder
// under pressure, and a LoRA is merged into the model rather than held beside
// it. The measured figure written by calibration is the one to trust when it
// exists; this is for bundles that have never run.
//
// ★ Only the taken side of a switch counts. ComfyUI's `ComfySwitchNode`
// declares its two inputs lazy (comfy_extras/nodes_logic.py) and asks only for
// the selected one, so the other branch's models are never loaded. Ignoring
// that overstates 14 of this repo's bundles by up to 9.6 GB — a whole LTX
// model — which is more than enough to refuse a lane that would actually fit.

const WEIGHT_RX = /\.(safetensors|sft|ckpt|pt|pth|gguf|onnx|bin)$/i;
// The model index is rebuilt at most this often; a workshop adds models rarely.
const INDEX_TTL_MS = 30000;

// Which kind of model a file is, from the folder it sits in. Used for the
// breakdown in the admin panel ("9.0 GB diffusion + 8.1 GB text encoder").
const KIND_BY_DIR = {
    diffusion_models: 'diffusion', unet: 'diffusion', checkpoints: 'diffusion',
    text_encoders: 'text encoder', clip: 'text encoder', clip_vision: 'clip vision',
    vae: 'vae', loras: 'lora', controlnet: 'controlnet', upscale_models: 'upscaler',
    style_models: 'style model', embeddings: 'embedding',
};

let _index = { root: null, at: 0, byName: null };

// basename -> { size, kind, rel } for every weight file under <root>/models.
// First match wins, mirroring ComfyUI's own folder_paths lookup order closely
// enough for a size estimate.
function buildModelIndex(comfyRoot) {
    const root = comfyRoot ? path.resolve(comfyRoot, 'models') : null;
    const fresh = _index.byName && _index.root === root && (Date.now() - _index.at) < INDEX_TTL_MS;
    if (fresh) return _index.byName;

    const byName = new Map();
    const walk = (dir, top) => {
        let entries = [];
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const e of entries) {
            const p = path.join(dir, e.name);
            if (e.isDirectory()) { walk(p, top || e.name); continue; }
            if (!WEIGHT_RX.test(e.name) || byName.has(e.name)) continue;
            let size = 0;
            try { size = fs.statSync(p).size; } catch { continue; }
            byName.set(e.name, { size, kind: KIND_BY_DIR[top] || 'model', rel: path.relative(root, p) });
        }
    };
    if (root) walk(root, null);
    _index = { root, at: Date.now(), byName };
    return byName;
}

const isLink = (v) => Array.isArray(v) && v.length === 2 && typeof v[1] === 'number';

// A node whose output nobody consumes, or which looks like an output node.
// Class names are checked first because a few bundles carry inert leftovers
// that are terminal by topology but never execute; topology is the fallback so
// a bundle that surfaces its result another way (a path string, say) still
// gets walked.
const SINK_NAME_RX = /^(Save|Preview)|VideoCombine|SaveAnimated/i;

function findSinks(graph) {
    const named = Object.keys(graph).filter(id => SINK_NAME_RX.test(graph[id]?.class_type || ''));
    if (named.length) return named;
    const consumed = new Set();
    for (const node of Object.values(graph)) {
        for (const v of Object.values(node?.inputs || {})) if (isLink(v)) consumed.add(String(v[0]));
    }
    return Object.keys(graph).filter(id => !consumed.has(String(id)));
}

// Resolve a switch's boolean: a literal, or the value of the node feeding it.
function resolveSwitch(graph, value) {
    if (typeof value === 'boolean') return value;
    if (!isLink(value)) return null;
    const src = graph[value[0]];
    if (!src) return null;
    const w = src.inputs || {};
    for (const key of ['value', 'boolean', 'switch']) {
        if (typeof w[key] === 'boolean') return w[key];
    }
    return null;
}

// Every node that can actually execute, with unselected switch branches pruned.
function activeNodes(graph) {
    const seen = new Set();
    const stack = findSinks(graph).map(String);
    while (stack.length) {
        const id = stack.pop();
        if (id == null || seen.has(id)) continue;
        seen.add(id);
        const node = graph[id];
        if (!node) continue;
        const inputs = node.inputs || {};
        const isSwitch = /SwitchNode$/.test(node.class_type || '')
            && ('on_true' in inputs || 'on_false' in inputs);
        if (isSwitch) {
            const taken = resolveSwitch(graph, inputs.switch);
            for (const [k, v] of Object.entries(inputs)) {
                if (k === 'on_true' || k === 'on_false') continue;
                if (isLink(v)) stack.push(String(v[0]));
            }
            // An unresolvable switch counts both sides rather than guessing low.
            const keys = taken === null ? ['on_true', 'on_false'] : [taken ? 'on_true' : 'on_false'];
            for (const k of keys) if (isLink(inputs[k])) stack.push(String(inputs[k][0]));
            continue;
        }
        for (const v of Object.values(inputs)) if (isLink(v)) stack.push(String(v[0]));
    }
    return seen;
}

/**
 * Estimate a workflow's model footprint.
 *
 * @param {object} graph      the bundle's api.json
 * @param {string} comfyRoot  ComfyUI install root (for <root>/models)
 * @returns {{
 *   known: boolean,          false when the graph names no model file at all
 *   weightsGb: number,       sum over the active path
 *   largestGb: number,       biggest single model — the floor ComfyUI cannot avoid
 *   components: Array<{name, gb, kind}>,
 *   unresolved: string[],    named but not found under models/
 *   prunedGb: number         what branch-awareness removed (diagnostic)
 * }}
 */
function estimateWorkflowVram(graph, comfyRoot) {
    const index = buildModelIndex(comfyRoot);
    const namesIn = (ids) => {
        const out = new Set();
        for (const id of ids) {
            const node = graph[id];
            if (!node) continue;
            for (const v of Object.values(node.inputs || {})) {
                if (typeof v === 'string' && WEIGHT_RX.test(v)) out.add(v.split(/[\\/]/).pop());
            }
        }
        return out;
    };

    const active = namesIn(activeNodes(graph));
    const every = namesIn(Object.keys(graph));

    const gb = (bytes) => bytes / 1024 ** 3;
    const components = [];
    const unresolved = [];
    let weights = 0;
    for (const name of active) {
        const hit = index.get(name);
        if (!hit) { unresolved.push(name); continue; }
        weights += gb(hit.size);
        components.push({ name, gb: +gb(hit.size).toFixed(2), kind: hit.kind });
    }
    components.sort((a, b) => b.gb - a.gb);

    let pruned = 0;
    for (const name of every) {
        if (active.has(name)) continue;
        const hit = index.get(name);
        if (hit) pruned += gb(hit.size);
    }

    return {
        known: every.size > 0,
        weightsGb: +weights.toFixed(2),
        largestGb: components.length ? components[0].gb : 0,
        components,
        unresolved,
        prunedGb: +pruned.toFixed(2),
    };
}

module.exports = { estimateWorkflowVram, buildModelIndex, activeNodes, WEIGHT_RX };
