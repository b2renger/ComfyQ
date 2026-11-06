const EventEmitter = require('events');

// Abstract base for workflow execution backends. v2 ships with one
// LocalComfyUIWorker; future RemoteComfyUIWorker implements the same contract.
//
// Events emitted:
//   'submitted'        { jobId, promptId }
//   'progress'         { jobId, promptId, stepsDone, stepsTotal, currentNodeId }
//   'node-executing'   { jobId, promptId, nodeId, nodeTitle }
//   'execution-finished' { jobId, promptId }  — the executor then reads /history itself (worker.rest.getHistory, also its polling fallback) and collects the outputs; there is no 'output-ready' or 'completed' event
//   'failed'           { jobId, promptId, errorReason, errorPhase, errorDetail? }
//                      errorReason 'cancelled' is a stop someone asked for (cancel());
//                      the executor records it as CANCELLED, not FAILED. Execution
//                      errors also carry errorDetail { exceptionType, exceptionMessage,
//                      traceback, nodeId, nodeType } for whoever has to fix them.
//   'status'           { state: 'idle'|'busy'|'starting'|'down', detail? }  (consumed by RealtimeBus and LaneManager)
class Worker extends EventEmitter {
    /**
     * Submit a job for execution.
     * @param {string} jobId
     * @param {object} apiWorkflow      ComfyUI API-format workflow JSON
     * @param {object} opts
     * @param {string} opts.workflowId
     * @param {Array<object>} opts.exposedParameters  the workflow's effective exposed parameters
     * @param {object} opts.paramValues   param key → value, as booked
     * @param {Array<{paramKey,nodeId,field,comfyFilename}>} opts.inputs
     * @param {string} opts.filenamePrefix
     * @param {object} opts.requirements  { minVRAM, models }
     * @returns {Promise<{promptId:string}|{promptId:null,cancelled:true}>}
     *   The second form means the job was stopped while submit was still in
     *   flight (cancelled, or ComfyUI exited): that was already reported through
     *   'failed', and submit emits nothing more.
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
