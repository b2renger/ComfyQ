// nodeSchema — what the INSTALLED ComfyUI says a node accepts.
//
// A bundle's meta.json declares the options for a `select` parameter, and that
// list can drift from the node actually installed on a rig: ComfyQ shipped
// `image_ideogram4_t2i` with five `aspect_ratio` strings that ResolutionSelector
// does not offer, which stayed invisible until something picked a non-default
// value and ComfyUI rejected the whole prompt. So the live schema is the
// authority, and this module fetches it.
//
// Cached per class_type with a long TTL: ComfyUI's node set is fixed for the
// life of the process, and a job must never wait on a diagnostic. Mirrors the
// TTL-cache shape of server/workflows/modelOptions.js.

const TTL_MS = 10 * 60 * 1000;
// A miss is cached only briefly. ComfyUI does not answer /object_info while it
// is busy loading a model, and caching that failure for the full TTL would
// blind the check for ten minutes over one hiccup — every dropdown would look
// unverifiable and every stale option would sail through. Short enough to
// recover on the next job, long enough not to re-request per parameter.
const MISS_TTL_MS = 15 * 1000;

const cache = new Map();   // classType → { at, schema }

// A combo field can be declared either as `[[...options], {...}]` (the classic
// shape) or as `["COMBO", { options: [...] }]` (newer builds). Anything else —
// including a dynamic node like CustomCombo, whose choices live in the
// workflow's own widget values rather than the schema — has no list to check
// against, and returns null so the caller leaves the value alone.
function comboOptionsFromSpec(spec) {
    if (!Array.isArray(spec) || spec.length === 0) return null;
    if (Array.isArray(spec[0])) return spec[0].length ? spec[0] : null;
    const opts = spec[1] && spec[1].options;
    return Array.isArray(opts) && opts.length ? opts : null;
}

async function getSchema(rest, classType) {
    if (!rest || !classType) return null;
    const hit = cache.get(classType);
    if (hit && (Date.now() - hit.at) < (hit.schema ? TTL_MS : MISS_TTL_MS)) return hit.schema;
    let schema = null;
    try {
        const data = await rest.getObjectInfo(classType);
        schema = (data && data[classType]) || null;
    } catch {
        // ComfyUI down or busy, node not installed, older build without the
        // endpoint — all non-fatal, and all retried soon (MISS_TTL_MS).
        schema = null;
    }
    cache.set(classType, { at: Date.now(), schema });
    return schema;
}

// The options this ComfyUI offers for one field, or null when it does not
// enumerate any (which is NOT the same as "no valid values" — see above).
async function getComboOptions(rest, classType, field) {
    const schema = await getSchema(rest, classType);
    if (!schema || !schema.input) return null;
    const spec = (schema.input.required && schema.input.required[field])
        || (schema.input.optional && schema.input.optional[field]);
    return comboOptionsFromSpec(spec);
}

function clearCache() { cache.clear(); }

module.exports = { getSchema, getComboOptions, comboOptionsFromSpec, clearCache, TTL_MS, MISS_TTL_MS };
