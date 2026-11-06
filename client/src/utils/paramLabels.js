// Field labels for a job's parameter keys, so the result panel reads "Prompt"
// and "Steps" rather than `cliptextencode_text_6` and `ksampler_steps_459_458`.
//
// Two sources, in order of preference:
//  1. A workflow this machine serves has its booking form's parameter_map on
//     the broadcast (one per lane, and the primary's under `workflow`). Best,
//     because a `lora` dropdown's options there come from the disk scan.
//  2. Any other workflow: GET /workflows/:id/parameters, the effective exposed
//     parameters with the admin's label overrides applied. `labelMapFromExposed`
//     turns that list into the same key → { label, options, optionLabels } shape.
//
// The library list (GET /workflows) carries no parameters, so it cannot be used.

// The live parameter_map for `workflowId`, or null when it is not served here.
export function liveParamMap(state, workflowId) {
    if (!workflowId || !state) return null;
    const lane = (state.lanes || []).find(l => l.workflow_id === workflowId);
    const fromLane = lane?.parameter_map;
    if (fromLane && Object.keys(fromLane).length) return fromLane;
    if (state.workflow_info?.id === workflowId) {
        const primary = state.workflow?.parameter_map;
        if (primary && Object.keys(primary).length) return primary;
    }
    return null;
}

// key → { label, options, optionLabels } from a list of exposed parameters.
// Disabled ones are kept: a job booked before the admin switched a field off
// still carries its value, and its label is still the right name for it.
export function labelMapFromExposed(exposed) {
    const out = {};
    for (const p of Array.isArray(exposed) ? exposed : []) {
        if (!p || !p.key) continue;
        out[p.key] = { label: p.label, options: p.options, optionLabels: p.optionLabels };
    }
    return out;
}
