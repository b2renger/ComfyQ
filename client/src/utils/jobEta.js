// computeEtaSeconds — estimates remaining wall-time for a processing job.
//
// Inputs:
//   job              — the wire-format job record from state.jobs
//   workflowsById    — map fetched once at mount in SocketContext
//   activeWorkflowInfo — state.workflow_info, broadcast every state_update
//
// Priority for samplesPerSec / estimatedDurationSec:
//   1. activeWorkflowInfo when the job's workflow IS the active one (freshest
//      — updated whenever the registry summary changes, e.g. recalibration)
//   2. workflowsById[wf_id] otherwise (good enough for foreign-workflow jobs;
//      a page refresh picks up new calibrations)
//
// Returns: seconds remaining (number), or null if no data to estimate from.
export function computeEtaSeconds(job, workflowsById, activeWorkflowInfo) {
    if (!job || job.status !== 'processing') return null;
    const wfId = job.workflow_id;
    if (!wfId) return null;

    const useActive = activeWorkflowInfo && activeWorkflowInfo.id === wfId;
    const wfSummary = workflowsById?.[wfId];
    const samplesPerSec = useActive ? activeWorkflowInfo.samplesPerSec : wfSummary?.samplesPerSec;
    const estimatedDurationSec = useActive
        ? activeWorkflowInfo.estimatedDurationSec
        : wfSummary?.estimatedDurationSec;

    const prog = job.progress;
    const hasProgress = prog && prog.value != null && prog.max != null && prog.max > 0;

    // Best path: calibrated samplesPerSec + live progress.
    if (samplesPerSec && samplesPerSec > 0 && hasProgress) {
        const stepsRemaining = Math.max(0, prog.max - prog.value);
        return stepsRemaining / samplesPerSec;
    }

    // Fallback: use the workflow's total estimate, interpolated by progress
    // if available. Uncalibrated workflows hit this path; the number is rough
    // but the wall-time-shaped countdown is still more useful than nothing.
    if (estimatedDurationSec && estimatedDurationSec > 0) {
        if (hasProgress) {
            const ratio = Math.max(0, 1 - prog.value / prog.max);
            return estimatedDurationSec * ratio;
        }
        return estimatedDurationSec;
    }

    return null;
}
