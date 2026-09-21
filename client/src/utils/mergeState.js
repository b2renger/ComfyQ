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

// applyPatch — fold a `state_patch` (only what changed) into the previous state.
//
// A running job emits a progress tick several times a second; sending the whole
// job list each time is what made several open tabs lag. The patch carries the
// jobs that changed, the ids that went, and any top-level field that moved —
// everything else keeps its identity, so only the affected card re-renders.
//
// Jobs the client doesn't know yet are appended, which is the order the server
// sends them in (oldest first); every view sorts by time anyway.
export function applyPatch(prev, patch) {
    if (!prev || !patch) return prev;
    const { seq, jobs: changedJobs, removed_jobs: removedJobs, ...head } = patch;

    let jobs = prev.jobs || [];
    if (changedJobs?.length || removedJobs?.length) {
        const incoming = new Map((changedJobs || []).map(j => [j.id, j]));
        const gone = new Set(removedJobs || []);
        const next = [];
        let touched = false;
        for (const job of jobs) {
            if (gone.has(job.id)) { touched = true; continue; }
            const update = incoming.get(job.id);
            if (!update) { next.push(job); continue; }
            incoming.delete(job.id);
            const kept = reuse(job, update);
            if (kept !== job) touched = true;
            next.push(kept);
        }
        for (const job of incoming.values()) { next.push(job); touched = true; }
        if (touched) jobs = next;
    }

    const merged = { ...prev, ...head, jobs };
    for (const key of ['connected_users', 'workflow', 'workflow_info']) {
        if (key in head) merged[key] = reuse(prev[key], head[key]);
    }
    const keys = new Set([...Object.keys(prev), ...Object.keys(merged)]);
    if ([...keys].every(k => prev[k] === merged[k])) return prev;
    return merged;
}

export function mergeState(prev, incoming) {
    if (!incoming) return prev;
    // `seq` is protocol bookkeeping (see applyPatch), not application state —
    // keeping it would give every periodic full snapshot a new identity and
    // re-render the whole page for nothing.
    const { seq, ...next } = incoming;
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
