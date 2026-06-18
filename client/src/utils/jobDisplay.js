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

// Pull the inline text result from a text-output job (image captioning /
// LLM describe). Returns the string, or null when the job produced no text
// output. Keys off the `text` kind the server collector assigns to
// PreviewAny-style outputs.
export function getJobText(job) {
    const t = (job?.outputs || []).find(o => o && o.kind === 'text' && typeof o.text === 'string' && o.text.trim());
    return t ? t.text : null;
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

// Actual wall-clock generation time (ms) for a finished job: from pickup
// (`started_at`, set when the executor begins uploading inputs) to the terminal
// state (`finished_at`). Workflow-agnostic — covers image/video/audio/3D the
// same way. Returns null when the job isn't finished or the timestamps are
// missing (records that pre-date these wire fields).
export function getGenerationMs(job) {
    if (!job) return null;
    const s = job.started_at;
    const f = job.finished_at;
    if (typeof s === 'number' && typeof f === 'number' && f >= s) return f - s;
    return null;
}

// Human-friendly duration: "<1s", "45s", "1m 23s", "2m".
export function formatDuration(ms) {
    if (ms == null || ms < 0) return '';
    const totalSec = Math.round(ms / 1000);
    if (totalSec < 1) return '<1s';
    if (totalSec < 60) return `${totalSec}s`;
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return s ? `${m}m ${s}s` : `${m}m`;
}
