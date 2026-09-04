// jobCleanup — remove everything a job left on disk.
//
// Deleting a job row is cheap; the files it produced are not. A cancelled
// storyboard batch can be hundreds of jobs, each holding an output file, a
// durable ingredients snapshot, and (for a chained job) a full copy of its
// input frame. Removing only the rows would leave gigabytes behind on a
// workshop rig with no way to find them again.
//
// Everything here is best effort: a missing file is not an error, and one
// failure never stops the rest.

const fs = require('fs');
const path = require('path');
const { resolveOutputPath } = require('../executor/outputCollector');
const ingredientsStore = require('./ingredientsStore');
const { CHAIN_PREFIX } = require('../executor/chainedInputs');

function removeOutputs(job, comfyConfig) {
    let removed = 0;
    for (const o of job?.outputs || []) {
        try {
            const abs = resolveOutputPath(o, comfyConfig);
            if (abs && fs.existsSync(abs)) { fs.unlinkSync(abs); removed++; }
        } catch (e) {
            console.warn(`[Cleanup] could not delete output ${o.filename}:`, e.message);
        }
    }
    return removed;
}

function removeIngredients(job, comfyConfig) {
    try {
        const dir = ingredientsStore.jobDir(comfyConfig, job.id);
        if (dir && fs.existsSync(dir)) { fs.rmSync(dir, { recursive: true, force: true }); return 1; }
    } catch (e) {
        console.warn(`[Cleanup] could not delete ingredients for ${job.id.slice(0, 8)}:`, e.message);
    }
    return 0;
}

// The frames staged into ComfyUI/input for this job's chained media inputs.
// Named by the CONSUMING job, so the prefix identifies them exactly.
function removeChainedInputs(job, comfyConfig) {
    let removed = 0;
    try {
        const inputDir = path.resolve(comfyConfig.root_path, 'input');
        const prefix = `${CHAIN_PREFIX}${job.id.slice(0, 8)}__`;
        for (const name of fs.readdirSync(inputDir)) {
            if (!name.startsWith(prefix)) continue;
            try { fs.unlinkSync(path.join(inputDir, name)); removed++; } catch { /* ignore */ }
        }
    } catch { /* input dir may not exist */ }
    return removed;
}

function removeJobArtifacts({ job, comfyConfig }) {
    if (!job || !comfyConfig) return { outputs: 0, ingredients: 0, inputs: 0 };
    return {
        outputs: removeOutputs(job, comfyConfig),
        ingredients: removeIngredients(job, comfyConfig),
        inputs: removeChainedInputs(job, comfyConfig)
    };
}

module.exports = { removeJobArtifacts, removeOutputs, removeIngredients, removeChainedInputs };
