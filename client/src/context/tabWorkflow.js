// Which workflow a student tab is for, so SocketContext can tell when the
// machine has switched it over (and reload the tab, or say so).
//
// A tab opened for one lane (…/user?workflow=<id>, how Discovery opens them)
// follows that lane while it is listed. A scoped tab whose lane has never been
// listed books the main lane (as the booking form does), so it follows that
// one. Once an EXTRA lane has been seen, a moment without it is NOT a switch:
// after a server restart the extra lanes are reopened only after the main one,
// so for a while the list holds the main lane alone — the answer is "wait"
// (id undefined). That wait is for extra lanes only. When the tab's lane was
// the MAIN one (a single-lane rig, which Discovery still opens with
// ?workflow=<id>), its disappearing IS the switch: a live switch or Activate &
// serve replaced it, the booking form has already moved to the new main lane,
// and so does the tab.
//
// `memory` is the tab's own record ({ seen, wasPrimary }), kept across calls
// and updated in place.
export function followTabWorkflow({ scopedWorkflowId, lanes, workflowInfo }, memory) {
    const scopedLane = scopedWorkflowId
        ? (lanes || []).find(l => l.workflow_id === scopedWorkflowId) || null
        : null;
    if (scopedLane) {
        memory.seen = true;
        memory.wasPrimary = !!scopedLane.primary;
        return { id: scopedLane.workflow_id, name: scopedLane.name };
    }
    if (memory.seen && !memory.wasPrimary) {
        return { id: undefined, name: workflowInfo?.name };   // an extra lane reopening (or gone): wait
    }
    return { id: workflowInfo?.id, name: workflowInfo?.name };
}
