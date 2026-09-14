// Per-workflow opt-out of ComfyUI's global performance flags.
//
// `use_sage_attention` and `fp16_accumulation` are rig-wide speed-ups (Admin →
// ComfyUI backend → Performance). Some models don't crash under them — they
// silently produce NaNs and save an all-black result:
//   • Sage attention blacks out Qwen-Image-Edit (2509 / 2511) and Marigold V2,
//     which runs on it;
//   • fp16 accumulation blacks out the SeedVR2 7B int8 build.
// A bundle lists the flags it can't run with in
// `meta.requirements.disabledPerfFlags`. Because ComfyQ serves ONE workflow at
// a time, the ComfyUI that serves (or calibrates) that workflow is launched
// without them, and every other workflow keeps the speed-up.

const PERF_FLAG_KEYS = ['use_sage_attention', 'fp16_accumulation'];
const PERF_FLAG_LABELS = {
    use_sage_attention: 'Sage attention',
    fp16_accumulation: 'fp16 accumulation'
};

function disabledPerfFlags(meta) {
    const list = meta?.requirements?.disabledPerfFlags;
    return Array.isArray(list) ? list.filter(k => PERF_FLAG_KEYS.includes(k)) : [];
}

// The comfy_ui config a workflow must be served with: the rig's config with the
// workflow's incompatible flags forced off. Returns the SAME object when nothing
// changes, so callers can tell a masked config from the plain one.
function effectiveComfyConfig(comfyConfig, meta) {
    const off = disabledPerfFlags(meta).filter(k => comfyConfig?.[k]);
    if (off.length === 0) return comfyConfig;
    const masked = { ...comfyConfig };
    for (const k of off) masked[k] = false;
    return masked;
}

// Which perf flags a running ComfyUI was started with, read from the argv that
// /system_stats reports. null when ComfyUI doesn't report its argv.
function flagsFromArgv(argv) {
    if (!Array.isArray(argv)) return null;
    const args = argv.map(String);
    let fp16 = false;
    const i = args.indexOf('--fast');
    if (i >= 0) {
        const features = [];
        for (let j = i + 1; j < args.length && !args[j].startsWith('--'); j++) features.push(args[j]);
        // bare `--fast` enables every feature, fp16_accumulation included
        fp16 = features.length === 0 || features.includes('fp16_accumulation');
    }
    return { use_sage_attention: args.includes('--use-sage-attention'), fp16_accumulation: fp16 };
}

async function runningPerfFlags(rest) {
    try {
        const stats = await rest.ping();
        return flagsFromArgv(stats?.system?.argv);
    } catch {
        return null;
    }
}

// Flags that are ON in the running ComfyUI but must be OFF for this config —
// the ones that would produce broken output. (The reverse, a speed-up that is
// off, only costs time, so it never forces a restart on its own.)
function blockingFlags(wantedConfig, runningFlags) {
    if (!runningFlags) return [];
    return PERF_FLAG_KEYS.filter(k => runningFlags[k] && !wantedConfig?.[k]);
}

module.exports = {
    PERF_FLAG_KEYS, PERF_FLAG_LABELS,
    disabledPerfFlags, effectiveComfyConfig, flagsFromArgv, runningPerfFlags, blockingFlags
};
