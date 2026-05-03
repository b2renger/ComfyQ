// API-format-only validator. v2 deliberately does NOT auto-convert Litegraph
// workflows; the user must save with "Save (API Format)" from ComfyUI dev mode.

function detectFormat(json) {
    if (!json || typeof json !== 'object') return 'invalid';
    if (Array.isArray(json.nodes) && json.last_node_id !== undefined) return 'litegraph';
    const values = Object.values(json);
    if (values.length === 0) return 'invalid';
    const looksApi = values.every(v => v && typeof v === 'object' && typeof v.class_type === 'string');
    return looksApi ? 'api' : 'invalid';
}

function validateApiWorkflow(json) {
    const format = detectFormat(json);
    if (format === 'litegraph') {
        return {
            valid: false,
            format,
            error: 'Litegraph format detected. ComfyQ v2 requires API format. In ComfyUI: enable Settings → Dev mode Options, then click "Save (API Format)".'
        };
    }
    if (format === 'invalid') {
        return {
            valid: false,
            format,
            error: 'Not a recognizable ComfyUI workflow. Top-level should be a map of nodeId → { class_type, inputs }.'
        };
    }
    // Sanity: every input that looks like a connection should be [nodeId, slot].
    for (const [nodeId, node] of Object.entries(json)) {
        if (!node.inputs || typeof node.inputs !== 'object') continue;
        for (const [field, value] of Object.entries(node.inputs)) {
            if (Array.isArray(value)) {
                if (value.length !== 2 || typeof value[0] !== 'string' || typeof value[1] !== 'number') {
                    return {
                        valid: false,
                        format,
                        error: `Node ${nodeId} input "${field}" has malformed connection ${JSON.stringify(value)}.`
                    };
                }
                if (!(value[0] in json)) {
                    return {
                        valid: false,
                        format,
                        error: `Node ${nodeId} input "${field}" references missing node "${value[0]}".`
                    };
                }
            }
        }
    }
    return { valid: true, format };
}

module.exports = { detectFormat, validateApiWorkflow };
