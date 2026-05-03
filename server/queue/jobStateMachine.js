const STATES = Object.freeze({
    SCHEDULED: 'scheduled',
    UPLOADING_INPUTS: 'uploading-inputs',
    SUBMITTED: 'submitted',
    EXECUTING: 'executing',
    COLLECTING_OUTPUTS: 'collecting-outputs',
    COMPLETED: 'completed',
    FAILED: 'failed',
    CANCELLED: 'cancelled'
});

const TERMINAL_STATES = new Set([STATES.COMPLETED, STATES.FAILED, STATES.CANCELLED]);
const IN_FLIGHT_STATES = new Set([
    STATES.UPLOADING_INPUTS, STATES.SUBMITTED, STATES.EXECUTING, STATES.COLLECTING_OUTPUTS
]);

const TRANSITIONS = {
    [STATES.SCHEDULED]: [STATES.UPLOADING_INPUTS, STATES.CANCELLED, STATES.FAILED],
    [STATES.UPLOADING_INPUTS]: [STATES.SUBMITTED, STATES.FAILED, STATES.CANCELLED],
    [STATES.SUBMITTED]: [STATES.EXECUTING, STATES.FAILED, STATES.CANCELLED],
    [STATES.EXECUTING]: [STATES.COLLECTING_OUTPUTS, STATES.FAILED, STATES.CANCELLED],
    [STATES.COLLECTING_OUTPUTS]: [STATES.COMPLETED, STATES.FAILED, STATES.CANCELLED],
    [STATES.COMPLETED]: [],
    [STATES.FAILED]: [],
    [STATES.CANCELLED]: []
};

function canTransition(from, to) {
    return (TRANSITIONS[from] || []).includes(to);
}

function isTerminal(state) {
    return TERMINAL_STATES.has(state);
}

function isInFlight(state) {
    return IN_FLIGHT_STATES.has(state);
}

// Coarse status used on the wire (compatible with v1 client expectations).
function toWireStatus(state) {
    if (state === STATES.SCHEDULED) return 'scheduled';
    if (state === STATES.COMPLETED) return 'completed';
    if (state === STATES.FAILED) return 'failed';
    if (state === STATES.CANCELLED) return 'cancelled';
    return 'processing';
}

module.exports = {
    STATES,
    TERMINAL_STATES,
    IN_FLIGHT_STATES,
    canTransition,
    isTerminal,
    isInFlight,
    toWireStatus
};
