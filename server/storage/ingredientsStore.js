const fs = require('fs');
const path = require('path');

// Durable per-job "ingredients" store.
//
// When a job completes we copy its imported media + a settings.json snapshot
// here, so the exact inputs + parameters (including the seed) can be downloaded
// and re-used later — even after the machine switches to a DIFFERENT workflow
// (the in-app "Use these settings" recall can't do that, because the booking
// form's parameter_map has changed and the keys no longer line up).
//
// This lives OUTSIDE the ComfyUI input dir, so the ~30-min input sweep
// (InputUploader.sweepStale, which only touches `input/comfyq__*`) never deletes
// it. It is keyed by job id: <root>/comfyq_ingredients/<jobId>/{settings.json,
// README.txt, media/*}.

function baseDir(comfyConfig) {
    return path.resolve(comfyConfig.root_path, 'comfyq_ingredients');
}
function jobDir(comfyConfig, jobId) {
    return path.join(baseDir(comfyConfig), jobId);
}
function inputDir(comfyConfig) {
    return path.resolve(comfyConfig.root_path, 'input');
}

// Mirrors the client's isSeedParam: a param whose key is `seed` or ends in
// `seed` (e.g. `noise_seed`, `sampling_mode.seed`).
function isSeedKey(key) {
    const s = String(key || '').toLowerCase();
    return s === 'seed' || s.endsWith('_seed') || s.endsWith('.seed') || s.endsWith('seed');
}

function sanitizeName(name) {
    return String(name || 'file')
        .replace(/[/\\]/g, '_')
        .replace(/[^a-zA-Z0-9._ -]/g, '_')
        .slice(0, 120) || 'file';
}

// Recover the original upload name from a stored input filename:
//   comfyq_session__<ts>_<rand>__<orig>   (the /upload route — the normal path)
//   comfyq__<jobId8>__<orig>              (the per-run / bench copy)
function originalFromUpload(v) {
    const s = String(v || '');
    let m = s.match(/^comfyq_session__\d+_\d+__(.+)$/);
    if (m) return m[1];
    m = s.match(/^comfyq__[^_]+__(.+)$/);
    if (m) return m[1];
    const p = s.split('__');
    return p[p.length - 1];
}

// The imported media a job references. PRIMARY source is paramValues — the
// /upload route stores each media param as a `comfyq_*` filename in
// ComfyUI/input, and `job.inputFiles` is empty in the normal v2 flow — with any
// inputFiles (bench / future remote workers) merged in. De-duplicated by stored
// filename; pure (no disk access).
function mediaRefs(job) {
    const out = [], seen = new Set();
    const add = (param, filename, original) => {
        if (!filename || seen.has(filename)) return;
        seen.add(filename);
        out.push({ param, filename, original: original || originalFromUpload(filename) });
    };
    for (const [k, v] of Object.entries((job && job.paramValues) || {})) {
        if (typeof v === 'string' && v.startsWith('comfyq_')) add(k, v, null);
    }
    for (const f of (job && job.inputFiles) || []) {
        if (f && f.comfyFilename) add(f.paramKey, f.comfyFilename, f.originalName);
    }
    return out;
}

// Build the machine-readable settings snapshot for a job. `mediaIndex` (when
// given) lists the files actually copied into media/; otherwise it's derived
// from the job record (used by the fallback zip when nothing was persisted).
function buildSettings(job, registry, mediaIndex) {
    let summary = null;
    try { summary = registry && registry.get(job.workflowId) && registry.get(job.workflowId).summary; }
    catch { /* workflow no longer in the library */ }

    const params = job.paramValues || {};
    const seed = {};
    for (const [k, v] of Object.entries(params)) if (isSeedKey(k)) seed[k] = v;

    return {
        comfyq_ingredients: 1,
        exported_at: new Date().toISOString(),
        job: { id: job.id, user: job.userId, created_at: job.createdAt, finished_at: job.finishedAt },
        workflow: {
            id: job.workflowId,
            version: job.workflowVersion || null,
            name: (summary && summary.name) || null,
            category: (summary && summary.category) || null
        },
        prompt: job.prompt || '',
        seed,
        parameters: params,
        imported_media: mediaIndex || mediaRefs(job).map(s => ({ param: s.param, file: s.original }))
    };
}

const README = [
    'ComfyQ — job ingredients',
    '',
    'Everything used to (re)create one generation:',
    '  settings.json   workflow id + all parameters (incl. the seed) + prompt',
    '  media/          the input files that were imported for this job',
    '',
    'To re-run it: open the same workflow in ComfyQ, upload the files from media/,',
    'and copy the values from settings.json into the booking form.',
    ''
].join('\n');

// Snapshot a finished job's imported media + settings into the durable store.
// Best-effort: never throws (a failure here must not fail the job).
function persist({ comfyConfig, job, registry }) {
    if (!job) return null;
    const dir = jobDir(comfyConfig, job.id);
    const mediaDir = path.join(dir, 'media');
    const inDir = inputDir(comfyConfig);
    try {
        fs.mkdirSync(mediaDir, { recursive: true });
        const used = new Set();
        const mediaIndex = [];
        for (const s of mediaRefs(job)) {
            const src = path.join(inDir, s.filename);
            if (!fs.existsSync(src)) continue;             // already removed — skip
            const base = sanitizeName(s.original || s.filename);
            let name = base, n = 1;
            while (used.has(name.toLowerCase())) {
                const ext = path.extname(base);
                name = `${path.basename(base, ext)}_${n++}${ext}`;
            }
            used.add(name.toLowerCase());
            fs.copyFileSync(src, path.join(mediaDir, name));
            mediaIndex.push({ param: s.param, file: name, original: s.original || null });
        }
        if (!mediaIndex.length) { try { fs.rmdirSync(mediaDir); } catch { /* not empty / ignore */ } }
        fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify(buildSettings(job, registry, mediaIndex), null, 2));
        fs.writeFileSync(path.join(dir, 'README.txt'), README);
        return dir;
    } catch (e) {
        console.warn(`[Ingredients] persist failed for ${String(job.id).slice(0, 8)}: ${e.message}`);
        return null;
    }
}

module.exports = { baseDir, jobDir, buildSettings, persist, mediaRefs };
