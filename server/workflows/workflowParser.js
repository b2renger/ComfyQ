// Primitive-fallback workflow parser. Walks every node in an API-format
// workflow and surfaces every primitive (string/number/boolean) input field
// as a candidate exposed parameter. No class_type whitelist — this lets new
// node types (Flux2, LTX, depth preprocessors, audio loaders, custom LoRAs)
// be configured without code changes.

const PROMPT_FIELD_HINTS = ['text', 'prompt', 'positive', 'negative', 'caption'];
const SAMPLER_FIELD = 'sampler_name';
const SCHEDULER_FIELD = 'scheduler';

const COMMON_OPTIONS = {
    sampler_name: [
        'euler', 'euler_ancestral', 'heun', 'dpm_2', 'dpm_2_ancestral',
        'lms', 'dpm_fast', 'dpm_adaptive', 'dpmpp_2s_ancestral', 'dpmpp_sde',
        'dpmpp_2m', 'dpmpp_2m_sde', 'dpmpp_3m_sde', 'ddim', 'uni_pc', 'uni_pc_bh2'
    ],
    scheduler: [
        'normal', 'karras', 'exponential', 'sgm_uniform', 'simple',
        'ddim_uniform', 'beta'
    ]
};

// The file an upload input can hold, by extension. Input-side only: what a
// student can upload into a loader, not what a save node writes.
const MEDIA_BY_EXT = {
    png: 'image', jpg: 'image', jpeg: 'image', webp: 'image', bmp: 'image', gif: 'image', tif: 'image', tiff: 'image',
    mp4: 'video', webm: 'video', mov: 'video', mkv: 'video', avi: 'video', m4v: 'video',
    wav: 'audio', mp3: 'audio', flac: 'audio', ogg: 'audio', aac: 'audio', m4a: 'audio', opus: 'audio',
    glb: 'model3d', gltf: 'model3d', obj: 'model3d', stl: 'model3d', fbx: 'model3d', ply: 'model3d',
};
const { WEIGHT_RX } = require('./vramEstimate');

// Widget values the ComfyUI frontend writes into an export that are not inputs
// of the node: a player's or a 3D viewer's state. Nothing runs on them, so they
// are not offered as parameters at all. A bare name matches on any node; a
// `Class.field` entry only on that class, because `image` is LoadImage's real
// upload everywhere else. (SaveGLB declares only `mesh` and `filename_prefix`,
// comfy_extras/nodes_save_3d.py; its `image` is the canvas preview.)
const FRONTEND_ONLY = new Set(['video-preview', 'audioUI', 'SaveGLB.image']);
function isFrontendOnly(nodeType, field) {
    return FRONTEND_ONLY.has(field) || FRONTEND_ONLY.has(`${nodeType}.${field}`);
}

// ComfyUI annotates an upload with where it lives: `clipspace/x.png [input]`.
function stripAnnotation(value) {
    return value.replace(/\s*\[(input|output|temp)\]\s*$/i, '');
}

function mediaFromValue(value) {
    const m = /\.([a-z0-9]+)$/i.exec(stripAnnotation(value).trim());
    return m ? MEDIA_BY_EXT[m[1].toLowerCase()] : undefined;
}

function isPrimitive(v) {
    return v === null || ['string', 'number', 'boolean'].includes(typeof v);
}

function inferType(field, value, nodeType = '') {
    const f = field.toLowerCase();
    // ★ A media type only for a value that can BE an upload. Going by the field
    // name alone made `mask_blend_pixels: 64`, `mask_invert: false` and
    // `noise_mask: true` required mask uploads, and `ref_image_size: "match"`
    // (a dropdown), `audio_encoder_name: "…safetensors"` (a weight) required
    // picture and audio uploads: the booking form then asked for a file in a
    // setting, and calibration staged a file name into an input ComfyUI rejects.
    // So a FILLED value decides by its own extension, whatever the field is
    // called (LoadVideo's `file` holding x.mp4 is a video), and a filled value
    // that is a weight, a dropdown word or a URL is never media. The field name
    // decides only for an EMPTY value, where there is nothing else to go on.
    if (typeof value === 'string' && value.trim() !== '') {
        const v = stripAnnotation(value).trim();
        // A URL is a setting even when it ends in .png: a loader's upload is a
        // file name in ComfyUI's input folder, never an address.
        if (!WEIGHT_RX.test(v) && !/:\/\//.test(v)) {
            const media = mediaFromValue(value);
            if (media === 'image' && f.includes('mask')) return 'mask';
            if (media) return media;
        }
    } else if (value === null || typeof value === 'string') {
        // Exact match, not `f.includes('model')`: half the loaders in the library
        // have a `model`-ish field naming a WEIGHT file, which is infrastructure.
        // `model_file` is the Load3D / Load3DAdvanced mesh input and nothing else.
        if (field === 'model_file') return 'model3d';
        if (f.includes('mask')) return 'mask';
        if (f.includes('image')) return 'image';
        if (f.includes('video')) return 'video';
        if (f.includes('audio')) return 'audio';
        // LoadVideo's upload is called just `file`: when it is empty, the node's
        // own name is the only thing that says what goes in it.
        if (field === 'file') {
            const c = String(nodeType).toLowerCase();
            if (c.includes('video')) return 'video';
            if (c.includes('audio')) return 'audio';
            if (c.includes('image')) return 'image';
        }
    }
    if (field === SAMPLER_FIELD || field === SCHEDULER_FIELD) return 'select';
    if (typeof value === 'boolean') return 'checkbox';
    if (typeof value === 'number') return 'number';
    if (typeof value === 'string') {
        if (PROMPT_FIELD_HINTS.some(h => f.includes(h)) || value.length > 60) return 'textarea';
        return 'text';
    }
    return 'text';
}

function humanizeLabel(field, nodeTitle) {
    const pretty = field
        .replace(/[_\-]+/g, ' ')
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/\b\w/g, c => c.toUpperCase())
        .trim();
    return nodeTitle ? `${pretty} (${nodeTitle})` : pretty;
}

function makeKey(nodeType, field, nodeId) {
    return `${nodeType}_${field}_${nodeId}`
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, '_');
}

// Returns { parameters: ExposedParameter[], nodeCount, primitiveCount }
function parseWorkflow(apiWorkflow) {
    const parameters = [];
    let order = 0;
    let primitiveCount = 0;

    for (const [nodeId, node] of Object.entries(apiWorkflow)) {
        if (!node || typeof node !== 'object') continue;
        const nodeType = node.class_type || 'Unknown';
        const nodeTitle = node._meta?.title || nodeType;
        const inputs = node.inputs || {};

        for (const [field, value] of Object.entries(inputs)) {
            if (!isPrimitive(value)) continue;
            if (isFrontendOnly(nodeType, field)) continue;
            primitiveCount++;
            const type = inferType(field, value, nodeType);
            parameters.push({
                key: makeKey(nodeType, field, nodeId),
                nodeId,
                field,
                type,
                label: humanizeLabel(field, nodeTitle),
                // Node identity, surfaced to the admin editor for display + search
                // (lets you cross-reference a param against the ComfyUI graph by
                // the node's title / class). Not persisted into exposedParameters.
                nodeTitle,
                classType: nodeType,
                default: value,
                options: COMMON_OPTIONS[field],
                required: ['image', 'video', 'audio', 'mask', 'model3d'].includes(type),
                order: order++
            });
        }
    }

    return {
        parameters,
        nodeCount: Object.keys(apiWorkflow).length,
        primitiveCount
    };
}

// The parameter_map students receive is built in realtime/realtimeBus.js
// (_buildParameterMap), which adds the fields this parser knows nothing about
// (lora options, camera, format, maxInputEdge…).
module.exports = { parseWorkflow, COMMON_OPTIONS, inferType, mediaFromValue };
