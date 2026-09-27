// Optional image inputs.
//
// A meta can mark an image/mask param `required: false` — typically a start
// image that only a toggle switches on. ComfyUI still validates every LoadImage
// in the prompt, even one that only a switched-off branch reads, so an empty
// filename would reject the whole job. An optional image left empty is
// therefore filled with a neutral placeholder file; the graph is responsible
// for never actually using it (a switch or `bypass` driven by the same toggle).
//
// When the param is gated with `disabledWhen` and its toggle is ON, the image
// is genuinely needed: that is an error, not a placeholder.

const PLACEHOLDER_TYPES = new Set(['image', 'mask']);

const isEmpty = (v) => v === undefined || v === null || v === '';

// What a param holds for this job: the booked value, else its meta default.
// undefined when the param isn't exposed at all.
function effectiveValue(key, paramValues, exposedParameters) {
    if (paramValues && !isEmpty(paramValues[key])) return paramValues[key];
    const p = exposedParameters.find(e => e.key === key);
    return p ? p.default : undefined;
}

// True while an optional upload's `disabledWhen` toggle switches it ON. A gate
// whose controlling param isn't exposed can't be read, so it counts as off.
function isSwitchedOn(param, paramValues, exposedParameters) {
    const dw = param.disabledWhen;
    if (!dw) return false;
    const ctrl = effectiveValue(dw.param, paramValues, exposedParameters);
    return ctrl !== undefined && ctrl !== dw.equals;
}

// Returns a new paramValues with placeholders filled in, plus any errors.
function fillOptionalImages({ exposedParameters = [], paramValues = {}, placeholderName }) {
    const out = { ...(paramValues || {}) };
    const errors = [];
    let filled = 0;
    for (const p of exposedParameters) {
        if (!PLACEHOLDER_TYPES.has(p.type) || p.required !== false) continue;
        if (!isEmpty(out[p.key])) continue;
        if (isSwitchedOn(p, paramValues, exposedParameters)) {
            const ctrl = exposedParameters.find(e => e.key === p.disabledWhen.param);
            errors.push(`"${p.label || p.key}" is switched on${ctrl ? ` by "${ctrl.label || ctrl.key}"` : ''} but no image was uploaded — upload one or switch it off.`);
            continue;
        }
        out[p.key] = placeholderName;
        filled++;
    }
    return { paramValues: out, errors, filled };
}


// Optional media whose consumer is an AUTOGROW input — Qwen Image 2.1's
// `images.image_N` reference slots, and the same pattern elsewhere. There is no
// switch to hide a placeholder behind: a black placeholder would be *used* as a
// reference image and quietly change the result. The right move is to take the
// link out of the graph, which is exactly what an autogrow input expects when a
// slot is unused.
//
// Opt in per parameter with `whenEmpty: "unlink"`. For each such param left
// empty, every link pointing at its loader node is deleted, and the loader —
// now feeding nothing — is dropped from the prompt.
//
// Returns a NEW graph; the caller's is untouched.
function unlinkEmptyMedia({ apiWorkflow, exposedParameters = [], paramValues = {} }) {
    const targets = exposedParameters.filter(p =>
        p.whenEmpty === 'unlink' && isEmpty(paramValues[p.key]) && p.nodeId != null);
    if (!targets.length) return { workflow: apiWorkflow, unlinked: [] };

    const wf = JSON.parse(JSON.stringify(apiWorkflow));
    const unlinked = [];
    for (const p of targets) {
        const nodeId = String(p.nodeId);
        if (!wf[nodeId]) continue;
        for (const node of Object.values(wf)) {
            for (const [field, value] of Object.entries(node.inputs || {})) {
                if (Array.isArray(value) && String(value[0]) === nodeId) delete node.inputs[field];
            }
        }
        delete wf[nodeId];
        unlinked.push(p.key);
    }
    return { workflow: wf, unlinked };
}

// Node fields a param sets when it is left EMPTY (`whenEmptySet`).
//
// The companion to `unlink`: taking an unused loader out of the graph is only
// half the job when the rest of the graph still expects it. Qwen Image 2.1's
// encoder returns a latent sized from the FIRST reference picture, and with no
// pictures at all that is a fixed 1024x1024 square
// (`latent_w = latent_h = resolution or 1024`, comfy_extras/nodes_qwen.py) —
// so an edit bundle with every picture left empty would quietly ignore the
// student's aspect ratio and render a square. Verified on the rig: the same
// prompt at "16:9" came back 1024x1024 without this, and 1376x768 with it.
//
// The alternative is a visible toggle the student must flip to match what they
// uploaded, which is the pattern this replaces — a toggle that disagrees with
// the uploads is a silently wrong result, and nothing in the form shows it.
//
// Emptiness is judged exactly as `unlinkEmptyMedia` judges it (the booked value
// alone, not the meta default) because the two must agree: a slot that is
// unlinked but whose switch was not flipped is precisely the broken graph this
// exists to prevent.
//
// Returns a NEW graph; the caller's is untouched.
function applyWhenEmptySet({ apiWorkflow, exposedParameters = [], paramValues = {} }) {
    const targets = exposedParameters.filter(p =>
        Array.isArray(p.whenEmptySet) && p.whenEmptySet.length > 0 && isEmpty(paramValues[p.key]));
    if (!targets.length) return { workflow: apiWorkflow, applied: [] };

    const wf = JSON.parse(JSON.stringify(apiWorkflow));
    const applied = [];
    for (const p of targets) {
        for (const s of p.whenEmptySet) {
            const node = wf[String(s.nodeId)];
            // The node may itself have been unlinked out of the graph; that is
            // not an error, there is simply nothing left to set.
            if (!node) continue;
            node.inputs = node.inputs || {};
            node.inputs[s.field] = s.value;
            applied.push(`${p.key} -> ${s.nodeId}.${s.field} = ${JSON.stringify(s.value)}`);
        }
    }
    return { workflow: wf, applied };
}

module.exports = { fillOptionalImages, isSwitchedOn, unlinkEmptyMedia, applyWhenEmptySet };
