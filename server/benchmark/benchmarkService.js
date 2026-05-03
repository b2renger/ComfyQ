// BenchmarkService — runs each workflow's `warmupParams` once and writes a
// sidecar `<id>.runtime.json` with measured wall-time + samples-per-sec.
// Triggered explicitly (admin "Calibrate" button) or implicitly before first
// real job for a workflow that has no runtime.json yet.
//
// v2 design: a benchmark is just a normal job submitted via the worker, so
// progress events feed back through the same path. We capture the prompt_id
// and observe WS events directly here for timing precision.

class BenchmarkService {
    constructor({ worker, registry, comfyConfig }) {
        this.worker = worker;
        this.registry = registry;
        this.comfyConfig = comfyConfig;
    }

    async calibrate(workflowId) {
        const entry = this.registry.get(workflowId);
        if (!entry || entry.unavailable) {
            throw new Error(`Cannot calibrate unavailable workflow: ${workflowId}`);
        }
        if (this.worker.getStatus().state !== 'idle') {
            throw new Error('Worker is busy; calibrate after queue drains');
        }

        const startedAt = Date.now();
        let stepsDone = 0;
        let stepsTotal = 0;
        let firstStepAt = null;
        let lastStepAt = null;
        let resolveDone, rejectDone;

        const donePromise = new Promise((res, rej) => { resolveDone = res; rejectDone = rej; });
        const onProgress = ({ stepsDone: d, stepsTotal: t }) => {
            if (firstStepAt == null) firstStepAt = Date.now();
            lastStepAt = Date.now();
            stepsDone = d;
            stepsTotal = t;
        };
        const onFinished = () => resolveDone();
        const onFailed = ({ errorReason }) => rejectDone(new Error(errorReason || 'benchmark-failed'));
        this.worker.on('progress', onProgress);
        this.worker.on('execution-finished', onFinished);
        this.worker.on('failed', onFailed);

        const benchJobId = `bench-${workflowId}-${Date.now()}`;
        try {
            await this.worker.submit(benchJobId, entry.apiWorkflow, {
                workflowId: entry.id,
                exposedParameters: entry.effective.exposedParameters,
                paramValues: entry.meta.warmupParams,
                inputs: [],
                filenamePrefix: `bench_${workflowId}_${Date.now()}`,
                requirements: entry.meta.requirements,
                maxRuntimeSec: entry.meta.maxRuntimeSec
            });

            // Wait for execution-finished or failure with a hard cap.
            const cap = entry.meta.maxRuntimeSec * 1000;
            await Promise.race([
                donePromise,
                new Promise((_, rej) => setTimeout(() => rej(new Error('benchmark timed out')), cap))
            ]);

            // Pull the final history once to ensure a real run completed.
            const history = await this.worker.rest.getHistory(this.worker.currentPromptId || '');
            // (We don't strictly need it; finalize either way.)
            this.worker.finalize({ success: true });

            const finishedAt = Date.now();
            const durationMs = finishedAt - startedAt;
            const samplePhaseMs = (firstStepAt && lastStepAt && stepsDone > 1)
                ? lastStepAt - firstStepAt
                : 0;
            const samplesPerSec = (samplePhaseMs > 0 && stepsDone > 1)
                ? (stepsDone - 1) / (samplePhaseMs / 1000)
                : null;

            const runtime = {
                schemaVersion: 1,
                calibratedAt: new Date().toISOString(),
                estimatedDurationSec: Math.max(1, Math.round(durationMs / 1000)),
                samplesPerSec,
                steps: stepsTotal,
                durationMs,
                source: 'benchmark'
            };
            this.registry.writeRuntime(workflowId, runtime);
            return runtime;
        } finally {
            this.worker.off('progress', onProgress);
            this.worker.off('execution-finished', onFinished);
            this.worker.off('failed', onFailed);
        }
    }
}

module.exports = { BenchmarkService };
