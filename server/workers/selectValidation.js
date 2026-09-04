// selectValidation — check a job's dropdown values against the installed node
// before the prompt is submitted.
//
// ComfyUI validates combo inputs strictly: one unknown string and it rejects the
// ENTIRE prompt with `value_not_in_list`, so a single stale option in a bundle's
// meta.json fails every job that picks it. That is exactly what happened to a
// 55-shot storyboard, where `aspect_ratio: '16:9 (Landscape Widescreen)'` was
// meta-declared but the node offers `'16:9 (Widescreen)'` — the same choice under
// a different label.
//
// So: when the live node names the same option differently, use its name; when
// the value is genuinely not on offer, fail with a message that says what to fix
// instead of letting ComfyUI answer with a wall of JSON.
//
// Deliberately conservative. It snaps only when it is certain the option is the
// same choice, never to a merely "nearest" one, and never touches a field the
// node does not enumerate.

const { getComboOptions } = require('./nodeSchema');

// Case, spacing and punctuation are how these labels differ between builds
// ("4:3 (Landscape)" vs "4:3 (Standard)" differ by more than that, and are
// correctly NOT matched by this).
function normalize(s) {
    return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, '');
}

// The leading "16:9" of "16:9 (Widescreen)". An aspect label's ratio is its
// identity; the parenthetical is just a human name for it.
function ratioKey(s) {
    const m = /^\s*(\d+)\s*:\s*(\d+)/.exec(String(s == null ? '' : s));
    return m ? `${Number(m[1])}:${Number(m[2])}` : null;
}

// Decide what to do with one value against one live option list.
// Returns { action: 'keep' } | { action: 'snap', to } | { action: 'fail', options }
function resolveValue(value, options) {
    if (!Array.isArray(options) || options.length === 0) return { action: 'keep' };
    if (options.includes(value)) return { action: 'keep' };

    const wanted = normalize(value);
    const sameLabel = options.filter(o => normalize(o) === wanted);
    if (sameLabel.length === 1) return { action: 'snap', to: sameLabel[0], why: 'same label' };

    const wantedRatio = ratioKey(value);
    if (wantedRatio) {
        const sameRatio = options.filter(o => ratioKey(o) === wantedRatio);
        if (sameRatio.length === 1) return { action: 'snap', to: sameRatio[0], why: 'same ratio' };
    }

    // More than one candidate, or none: guessing here would render something
    // other than what was asked for, silently.
    return { action: 'fail', options };
}

// Check every `select` parameter of a job.
//
// Returns { paramValues, adjustments, errors }:
//   paramValues  a NEW object, with any snapped values replaced
//   adjustments  [{ key, field, classType, from, to, why }] for logging
//   errors       human-readable reasons the job must not be submitted
//
// `lora` params are excluded on purpose: their options come from scanning
// ComfyUI's model dir on disk, and ComfyUI may not have rescanned since a file
// was added — refusing there would block a job whose LoRA is genuinely present.
async function validateSelects({ apiWorkflow, exposedParameters, paramValues, rest }) {
    const out = { ...(paramValues || {}) };
    const adjustments = [];
    const errors = [];
    if (!rest || !apiWorkflow || !Array.isArray(exposedParameters)) {
        return { paramValues: out, adjustments, errors };
    }

    for (const p of exposedParameters) {
        if (p.type !== 'select') continue;
        const value = out[p.key];
        if (value === undefined || value === null || value === '') continue;
        const node = apiWorkflow[p.nodeId];
        const classType = node && node.class_type;
        if (!classType) continue;

        let options = null;
        try { options = await getComboOptions(rest, classType, p.field); }
        catch { options = null; }        // never block a job on a diagnostic
        if (!options) continue;          // not enumerated (e.g. CustomCombo) → leave alone

        const verdict = resolveValue(value, options);
        if (verdict.action === 'snap') {
            out[p.key] = verdict.to;
            adjustments.push({
                key: p.key, field: p.field, classType,
                from: value, to: verdict.to, why: verdict.why
            });
        } else if (verdict.action === 'fail') {
            errors.push(
                `"${p.label || p.key}" is set to ${JSON.stringify(value)}, which this ComfyUI's ` +
                `${classType} does not offer. Valid values: ${options.join(', ')}. ` +
                `Fix the "${p.field}" option list in the workflow's meta.json.`
            );
        }
    }
    return { paramValues: out, adjustments, errors };
}

module.exports = { validateSelects, resolveValue, normalize, ratioKey };
