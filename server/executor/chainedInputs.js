// chainedInputs — fills a job's media parameters from an EARLIER job's output.
//
// Normal ComfyQ inputs arrive by upload: the /upload route drops the file in
// ComfyUI/input and the client sends back the filename, which the materializer
// injects verbatim. A storyboard batch has no upload for the frame a video
// animates — that frame is produced by an image job queued minutes earlier.
// So just before submit we take the source job's output, copy it into
// ComfyUI/input, and write the filename into paramValues exactly as an upload
// would have. Nothing downstream (materializer, ingredients store, "Use these
// settings", the media routes) can tell the difference.
//
// The copy is deliberate rather than a path reference: ComfyUI resolves
// LoadImage/LoadVideo names against its own input dir, and outputs are subject
// to history clearing, so a copy is what makes the input stable for the life
// of the job.

const fs = require('fs');
const path = require('path');
const { resolveOutputPath } = require('./outputCollector');

// `comfyq_chain__` deliberately does NOT match the `comfyq__` prefix that
// InputUploader.sweepStale deletes after ~30 min: a storyboard runs for hours
// and a frame may be consumed long after it was produced. It does start with
// `comfyq_`, which is what GET /input-media/:filename requires to serve it back
// to the UI.
const CHAIN_PREFIX = 'comfyq_chain__';

// Outputs that can stand in for a given media parameter type.
const KIND_FOR_TYPE = {
    image: ['image'],
    mask: ['image'],
    video: ['video'],
    audio: ['audio']
};

function sanitize(s) {
    return String(s || '').replace(/[^a-zA-Z0-9._-]/g, '_');
}

// Pick the file a dependent job should consume. `outputIndex` counts within
// the matching kind, so index 0 of an image dep is the first *image* even when
// the source job also emitted a text caption or a video.
function pickOutput(sourceJob, kind, outputIndex = 0) {
    const wanted = KIND_FOR_TYPE[kind] || [kind];
    const candidates = (sourceJob.outputs || []).filter(o => o.filename && wanted.includes(o.kind));
    // Out of range returns null rather than clamping to the last file: asking
    // for "view 5" of a job that produced two must be an error, not view 2
    // rendered silently under the wrong name.
    if (outputIndex < 0 || outputIndex >= candidates.length) return null;
    return candidates[outputIndex];
}

// Resolve every chained input for one job.
//
// Returns { paramValues, resolved, errors }:
//   paramValues  a NEW object — the job's values plus the resolved filenames
//   resolved     [{ paramKey, sourceJobId, comfyFilename, originalName }]
//   errors       human-readable reasons a dep could not be filled; a non-empty
//                list means the job must not be submitted (it would otherwise
//                silently render whatever filename the api.json shipped with).
function resolveChainedInputs({ job, deps, queue, comfyConfig }) {
    const paramValues = { ...(job.paramValues || {}) };
    const resolved = [];
    const errors = [];
    if (!deps || deps.length === 0) return { paramValues, resolved, errors };

    const inputDir = path.resolve(comfyConfig.root_path, 'input');
    try { fs.mkdirSync(inputDir, { recursive: true }); } catch { /* already there */ }

    for (const dep of deps) {
        const source = queue.get(dep.sourceJobId);
        if (!source) {
            errors.push(`the job that produces "${dep.paramKey}" no longer exists`);
            continue;
        }
        if (source.status !== 'completed') {
            errors.push(`the job that produces "${dep.paramKey}" is ${source.status}`);
            continue;
        }
        const out = pickOutput(source, dep.kind || 'image', dep.outputIndex ?? 0);
        if (!out) {
            const n = (source.outputs || []).filter(o => o.filename).length;
            errors.push(`the job that produces "${dep.paramKey}" has no ${dep.kind || 'image'} ` +
                `output at position ${(dep.outputIndex ?? 0) + 1} (it produced ${n})`);
            continue;
        }
        const abs = resolveOutputPath(out, comfyConfig);
        if (!abs || !fs.existsSync(abs)) {
            errors.push(`the ${dep.kind || 'image'} for "${dep.paramKey}" is no longer on disk (${out.filename})`);
            continue;
        }
        // Namespaced by the CONSUMING job + param, so two params of the same
        // job fed by different sources can't collide and a re-run overwrites
        // its own copy rather than another job's.
        const base = path.basename(out.filename);
        const destName = `${CHAIN_PREFIX}${job.id.slice(0, 8)}__${sanitize(dep.paramKey)}__${sanitize(base)}`;
        const dest = path.join(inputDir, destName);
        try {
            fs.copyFileSync(abs, dest);
        } catch (e) {
            errors.push(`could not stage the ${dep.kind || 'image'} for "${dep.paramKey}": ${e.message}`);
            continue;
        }
        paramValues[dep.paramKey] = destName;
        resolved.push({
            paramKey: dep.paramKey,
            sourceJobId: dep.sourceJobId,
            comfyFilename: destName,
            originalName: base
        });
    }
    return { paramValues, resolved, errors };
}

module.exports = { resolveChainedInputs, pickOutput, CHAIN_PREFIX };
