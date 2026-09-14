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

module.exports = { fillOptionalImages, isSwitchedOn };
