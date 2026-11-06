// A library sweep (and the test suite, which runs through it) lives inside this
// server process. Anything that restarts the server kills it mid-bundle, and
// its report is only written when a run finishes, so the panel would go on
// showing the PREVIOUS run as if nothing had happened. Routes that restart into
// student mode ask this first.

const SWEEP_RUNNING_MESSAGE = 'A library sweep is running — stop it from the sweep card (Maintenance) '
    + 'and wait for it to finish the bundle it is on.';

function sweepBlocksRestart(runtime) {
    let state = null;
    try { state = runtime?.sweep?.status?.()?.state || null; } catch { /* no sweep */ }
    return state === 'running' || state === 'stopping';
}

module.exports = { sweepBlocksRestart, SWEEP_RUNNING_MESSAGE };
