// modelOptions — enumerate ComfyUI model files (LoRAs, checkpoints, …) for
// dynamically-populated `select`/`lora` params. The student booking form needs
// the list of installed LoRAs (filtered to the ones compatible with the active
// model, by filename prefix) so it can render a dropdown; the value the user
// picks is just the `.safetensors` filename fed to a LoraLoader node.
//
// Scanning happens on the ComfyQ host's filesystem (config.comfy_ui.root_path),
// NOT via ComfyUI's API — so it works whether or not ComfyUI is currently up.
// Results are cached with a short TTL because the realtime bus rebuilds the
// parameter_map on every broadcast (many per minute) and we don't want to hit
// the disk each time; a freshly-dropped LoRA appears within TTL_MS.

const fs = require('fs');
const path = require('path');

// Weight file extensions ComfyUI recognizes for LoRAs / checkpoints.
const MODEL_EXTS = new Set(['.safetensors', '.ckpt', '.pt', '.pth', '.sft', '.bin']);
const TTL_MS = 8000;
const _cache = new Map(); // `${dir}|${prefix}` → { ts, files }

// List model filenames under `<comfyRoot>/models/<subdir>` (default `loras`),
// keeping only weight files whose name starts with `prefix` (case-insensitive;
// empty/absent prefix = all). Returns a sorted array of basenames (the exact
// value a LoraLoader `lora_name` expects). Missing dir / unset root → [] (e.g.
// off-rig dev), so the caller can fall back to just the param's default.
function listModelFiles(comfyRoot, subdir = 'loras', prefix = '') {
    if (!comfyRoot) return [];
    const dir = path.join(comfyRoot, 'models', subdir);
    const key = `${dir}|${prefix.toLowerCase()}`;
    const now = Date.now();
    const hit = _cache.get(key);
    if (hit && now - hit.ts < TTL_MS) return hit.files;

    let files = [];
    try {
        const pfx = prefix.toLowerCase();
        files = fs.readdirSync(dir, { withFileTypes: true })
            .filter(e => e.isFile())
            .map(e => e.name)
            .filter(f => MODEL_EXTS.has(path.extname(f).toLowerCase()))
            .filter(f => !pfx || f.toLowerCase().startsWith(pfx))
            .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }));
    } catch {
        files = []; // dir missing / unreadable — caller falls back to the default
    }
    _cache.set(key, { ts: now, files });
    return files;
}

// Display label for a model file: drop the weight extension so the dropdown
// reads `krea2_realism_lora` instead of `krea2_realism_lora.safetensors`. The
// stored value stays the full filename.
function prettyModelLabel(filename) {
    return String(filename || '').replace(/\.(safetensors|ckpt|pt|pth|sft|bin)$/i, '');
}

module.exports = { listModelFiles, prettyModelLabel };
