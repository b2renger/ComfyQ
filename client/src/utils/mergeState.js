// mergeState — fold a fresh `state_update` into the previous state while
// reusing every piece that did not change.
//
// Each broadcast arrives as a brand-new object tree, so without this every
// job, the parameter_map and workflow_info get a new identity on every
// progress tick and every heartbeat: memoized cards re-render, effects keyed on
// `state.jobs` re-run, and forms that watch the parameter_map would reset.
// Reusing unchanged objects lets React skip that work, and returning `prev`
// itself when nothing changed skips the render entirely.

// Serialized form of each object we've already seen, so a job is stringified
// once per new version rather than once per comparison.
const serialized = new WeakMap();
const keyOf = (obj) => {
    let s = serialized.get(obj);
    if (s === undefined) {
        s = JSON.stringify(obj);
        serialized.set(obj, s);
    }
    return s;
};

const reuse = (prevValue, nextValue) => {
    if (prevValue === nextValue) return prevValue;
    if (prevValue == null || nextValue == null || typeof nextValue !== 'object') return nextValue;
    return keyOf(prevValue) === keyOf(nextValue) ? prevValue : nextValue;
};

const mergeJobs = (prevJobs = [], nextJobs = []) => {
    const byId = new Map(prevJobs.map(j => [j.id, j]));
    let changed = prevJobs.length !== nextJobs.length;
    const merged = nextJobs.map((job, i) => {
        const kept = reuse(byId.get(job.id), job);
        if (kept !== prevJobs[i]) changed = true;
        return kept;
    });
    return changed ? merged : prevJobs;
};

export function mergeState(prev, next) {
    if (!next) return prev;
    const merged = {
        ...next,
        jobs: mergeJobs(prev?.jobs, next.jobs || []),
        connected_users: reuse(prev?.connected_users, next.connected_users || []),
        workflow: reuse(prev?.workflow, next.workflow),
        workflow_info: reuse(prev?.workflow_info, next.workflow_info),
    };
    if (prev) {
        const keys = new Set([...Object.keys(prev), ...Object.keys(merged)]);
        if ([...keys].every(k => prev[k] === merged[k])) return prev;
    }
    return merged;
}
