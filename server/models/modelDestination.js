const path = require('path');

// Where a downloaded weight belongs under <comfyRoot>/models.
//
// Getting this wrong is worse than not downloading: the file arrives, costs the
// bandwidth, and ComfyUI still cannot see it — and the next prune run calls it
// unused, because nothing references a model in the wrong folder.
//
// ★ The URL usually knows. The provenance harvested from the workflows' own
// notes is mostly HuggingFace `/resolve/<rev>/<path>` links, and that path is
// the layout the repacker intended:
//     …/resolve/main/diffusion_models/qwen_image_2.1_int8_convrot.safetensors
//     …/resolve/main/split_files/text_encoders/mistral_3_small_flux2_fp8.safetensors
// So the folder is read off the URL first, and the meta's `type` is only the
// fallback for a link that carries no folder.

// Model folders this family of installs actually uses — ComfyUI's own plus the
// ones node packs register. Read off the real install rather than invented: a
// URL path segment only counts as a destination if it names a folder that
// exists in this layout, which is what makes "the URL knows" safe rather than
// a guess.
const KNOWN_DIRS = new Set([
    // ComfyUI core
    'checkpoints', 'diffusion_models', 'unet', 'loras', 'vae', 'vae_approx',
    'text_encoders', 'clip', 'clip_vision', 'controlnet', 'upscale_models',
    'embeddings', 'style_models', 'gligen', 'hypernetworks', 'photomaker',
    'audio_encoders', 'model_patches', 'classifiers', 'diffusers', 'configs',
    // registered by packs on this fleet, verified present on the install
    'latent_upscale_models', 'background_removal', 'geometry_estimation',
    'frame_interpolation', 'detection', 'face_detection', 'optical_flow',
    'depthanything', 'depthanything3', 'videodepthanything', 'liveportrait',
    'rembg', 'sam2', 'sam3d', 'ultralytics', 'yolo', 'llm', 'llama_cpp',
]);

// A bundle's declared `type` -> the folder this install keeps that kind in.
// ★ `unet` maps to diffusion_models, not to unet/: ComfyUI reads both, but
// every UNET on this rig lives in diffusion_models, and a model that lands in
// the other one is invisible to the dropdowns an admin would use to check.
const DIR_BY_TYPE = {
    unet: 'diffusion_models',
    checkpoint: 'checkpoints',
    clip: 'text_encoders',
    vae: 'vae',
    lora: 'loras',
    controlnet: 'controlnet',
};

/**
 * Decide where a model file goes.
 *
 * @param {object} opts
 * @param {string} opts.url    the download link (may carry the folder)
 * @param {string} [opts.type] the meta's declared type, as a fallback
 * @param {string} [opts.file] the declared filename, when the URL has none
 * @returns {{dir: string|null, name: string|null, from: string, why: string}}
 *          `dir` is relative to <comfyRoot>/models; null means "cannot tell",
 *          which the caller must treat as a refusal, not a guess.
 */
function destinationFor({ url, type, file } = {}) {
    const clean = String(url || '').split('?')[0].split('#')[0];
    let decoded = clean;
    try { decoded = decodeURIComponent(clean); } catch { /* leave as-is */ }
    const segs = decoded.split('/').filter(Boolean);

    const name = (file && String(file).split(/[\\/]/).pop())
        || (segs.length ? segs[segs.length - 1] : null);

    // Everything after /resolve/<rev>/ or /blob/<rev>/ is the repo-relative
    // path, and that is where a folder name would be.
    let tail = [];
    const marker = segs.findIndex((s, i) => (s === 'resolve' || s === 'blob') && segs[i + 1]);
    if (marker > -1) tail = segs.slice(marker + 2);

    // Walk the repo path from the file backwards for a folder ComfyUI knows.
    for (let i = tail.length - 2; i >= 0; i--) {
        const seg = tail[i].toLowerCase();
        if (KNOWN_DIRS.has(seg)) {
            return {
                dir: seg === 'unet' ? 'diffusion_models' : seg,
                name,
                from: 'url',
                why: `the download link puts it in ${tail[i]}/`,
            };
        }
    }

    const byType = DIR_BY_TYPE[String(type || '').toLowerCase()];
    if (byType) {
        return {
            dir: byType,
            name,
            from: 'type',
            why: `the link carries no folder, so the declared type "${type}" decides`,
        };
    }

    return {
        dir: null,
        name,
        from: 'none',
        why: 'neither the link nor the declared type says which folder this belongs in',
    };
}

/**
 * The absolute destination, or null when it cannot be determined safely.
 *
 * `dir` may be supplied explicitly — that is how the undecidable case is meant
 * to be handled: the UI asks the admin to pick a folder rather than the server
 * guessing one. A file in the wrong folder is invisible to ComfyUI and reads as
 * unused on the next prune, so a guess here is worse than a question.
 */
function resolveDestination({ comfyRoot, url, type, file, dir: explicitDir }) {
    const d = explicitDir
        ? {
            dir: String(explicitDir).toLowerCase(),
            name: (file && String(file).split(/[\\/]/).pop())
                || String(url || '').split('?')[0].split('/').filter(Boolean).pop() || null,
            from: 'explicit',
            why: 'the folder was chosen explicitly',
        }
        : destinationFor({ url, type, file });
    // An explicit folder still has to be one this layout uses, or the file
    // lands somewhere ComfyUI never looks.
    if (explicitDir && !KNOWN_DIRS.has(d.dir)) {
        return { ...d, abs: null, dir: null, why: `"${explicitDir}" is not a model folder this install uses` };
    }
    if (!comfyRoot || !d.dir || !d.name) return { ...d, abs: null };
    // ★ Pinned inside models/: a filename from a URL is untrusted input, and
    // `..` in it would otherwise write anywhere on the disk.
    const modelsRoot = path.resolve(comfyRoot, 'models');
    const abs = path.resolve(modelsRoot, d.dir, d.name);
    if (!abs.startsWith(modelsRoot + path.sep)) return { ...d, abs: null, why: 'the resolved path escapes the models folder' };
    return { ...d, abs };
}

module.exports = { destinationFor, resolveDestination, KNOWN_DIRS, DIR_BY_TYPE };
