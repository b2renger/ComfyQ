// Pick the prompt to show on a job card / lightbox / sidebar row.
//
// Older jobs (LTX i2v, anything where the workflow's prompt input wasn't
// literally named `prompt`) were stored with an empty top-level
// `job.prompt`. The actual user-typed text still lives under whatever key
// the workflow exposed — `positive_prompt`, `text`, etc. This helper
// mines `job.params` for that value so existing records display
// correctly without a database backfill.
//
// New jobs get the right `job.prompt` from the start
// (see pickHeadlinePrompt in BookingDialog.jsx), so this is primarily a
// compatibility shim for history.

export function getDisplayPrompt(job) {
    if (!job) return '';
    if (typeof job.prompt === 'string' && job.prompt.trim()) return job.prompt;
    const params = job.params || job.paramValues || {};

    // Prefer positive over generic prompt; skip anything negative.
    const candidates = Object.entries(params)
        .filter(([k, v]) => typeof v === 'string' && v.trim() && /prompt|^text$/i.test(k) && !/negative|neg/i.test(k))
        .sort(([a], [b]) => {
            const score = (k) => (/positive/i.test(k) ? 0 : /prompt/i.test(k) ? 1 : 2);
            return score(a) - score(b);
        });
    return candidates[0]?.[1] || '';
}

const MODEL3D_RX = /\.(glb|gltf)$/i;

// Pick the file the user actually wants to download for a job. For 2D/video
// workflows that's just `result_filename`. For 3D workflows the headline
// artifact is the GLB, not the preview-PNG that the grid uses as its
// thumbnail. Prefer persistent outputs over ComfyUI temp/ files (Preview3D
// nodes write to temp and may be cleaned up).
export function getPrimaryDownloadFilename(job) {
    if (!job) return null;
    const outputs = job.outputs || [];
    const model3ds = outputs.filter(o => MODEL3D_RX.test(o.filename || ''));
    if (model3ds.length > 0) {
        const persistent = model3ds.find(o => o.type !== 'temp');
        return (persistent || model3ds[0]).filename;
    }
    return job.result_filename || null;
}
