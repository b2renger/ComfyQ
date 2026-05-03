const EventEmitter = require('events');

// Abstract base for workflow execution backends. v2 ships with one
// LocalComfyUIWorker; future RemoteComfyUIWorker implements the same contract.
//
// Events emitted:
//   'submitted'        { jobId, promptId }
//   'progress'         { jobId, promptId, stepsDone, stepsTotal }
//   'node-executing'   { jobId, promptId, nodeId, nodeTitle }
//   'output-ready'     { jobId, promptId, outputs: [{kind, filename, nodeId, mime, sizeBytes}] }
//   'completed'        { jobId, promptId }
//   'failed'           { jobId, promptId, errorReason, errorPhase }
//   'status'           { state: 'idle'|'busy'|'starting'|'down', detail? }
class Worker extends EventEmitter {
    /**
     * Submit a job for execution.
     * @param {string} jobId
     * @param {object} apiWorkflow      ComfyUI API-format workflow JSON
     * @param {object} opts
     * @param {Array<{paramKey,nodeId,field,filename}>} opts.inputs
     * @param {string} opts.filenamePrefix
     * @param {number} opts.maxRuntimeSec
     * @param {object} opts.requirements  { minVRAM, models }
     * @returns {Promise<{promptId:string}>}
     */
    async submit(jobId, apiWorkflow, opts) { throw new Error('not implemented'); }

    /** Cancel an in-flight job. */
    async cancel(jobId) { throw new Error('not implemented'); }

    /** Returns the worker's current status. */
    getStatus() { throw new Error('not implemented'); }

    /** Optional: shut down the worker (kill child process, close ws). */
    async shutdown() { /* no-op by default */ }
}

module.exports = { Worker };
