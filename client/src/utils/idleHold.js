// idleHold — "don't touch this tab, someone is using it".
//
// Two things happen to a tab on their own: it parks itself after a few idle
// minutes (see SocketContext), and it reloads itself when the machine starts
// serving another workflow. Either one would throw away a half-filled booking
// form, so anything that holds unsaved work takes a hold for as long as it is
// open. A module-level counter is enough: there is one student UI per page.

let holds = 0;

/** Take a hold. Returns the release function (safe to call twice). */
export function acquireIdleHold() {
    holds++;
    let released = false;
    return () => {
        if (released) return;
        released = true;
        holds = Math.max(0, holds - 1);
    };
}

/** True while anything holds unsaved work. */
export function idleHeld() {
    return holds > 0;
}
