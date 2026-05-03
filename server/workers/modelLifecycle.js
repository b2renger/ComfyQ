// Decides when to call ComfyUI's /free between jobs to manage VRAM.
// v2 policy: free models only when switching to a different workflow whose
// estimated VRAM would push the running total above the configured budget.
// Open question (per plan): whether back-to-back same-workflow jobs benefit
// from /free. Default: do NOT free for same-workflow runs.

class ModelLifecycle {
    constructor({ rest, vramBudgetGb }) {
        this.rest = rest;
        this.budget = vramBudgetGb;
        this.lastWorkflowId = null;
        this.lastMinVram = 0;
    }

    async beforeJob({ workflowId, minVRAM = 0 }) {
        const sameWorkflow = workflowId === this.lastWorkflowId;
        if (sameWorkflow) {
            return { freed: false, reason: 'same-workflow' };
        }
        // First run is a no-op (nothing loaded yet).
        if (this.lastWorkflowId == null) {
            this.lastWorkflowId = workflowId;
            this.lastMinVram = minVRAM;
            return { freed: false, reason: 'first-run' };
        }
        // Heuristic: if either side claims a VRAM footprint and combined would
        // exceed budget, free first. Conservative — better to over-free than OOM.
        const wouldExceed = (this.lastMinVram + minVRAM) > this.budget;
        if (wouldExceed) {
            try {
                await this.rest.free({ unloadModels: true, freeMemory: true });
                this.lastWorkflowId = workflowId;
                this.lastMinVram = minVRAM;
                return { freed: true, reason: 'budget-exceeded' };
            } catch (e) {
                console.warn('[ModelLifecycle] /free failed:', e.message);
                this.lastWorkflowId = workflowId;
                this.lastMinVram = minVRAM;
                return { freed: false, reason: 'free-failed' };
            }
        }
        this.lastWorkflowId = workflowId;
        this.lastMinVram = minVRAM;
        return { freed: false, reason: 'within-budget' };
    }
}

module.exports = { ModelLifecycle };
