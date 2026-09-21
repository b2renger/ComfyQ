import React, { createContext, useContext, useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { io } from 'socket.io-client';
import Toast from '../components/ui/Toast';
import { SERVER_URL } from '../utils/api';
import { getAccessToken, accessHeaders } from '../utils/access';
import { mergeState, applyPatch } from '../utils/mergeState';
import { idleHeld } from '../utils/idleHold';

const SocketContext = createContext();

// How long a booking waits for the server's confirmation.
const BOOK_TIMEOUT_MS = 15000;

// A tab nobody is using still holds a socket, a job grid and its media. In a
// workshop that means dozens of them per machine, opened from the fleet monitor
// and never closed. So a tab with nothing of its own pending parks itself after
// a few idle minutes: it says so first, then tries to close (which only works
// for a tab that was opened by script) and otherwise drops the connection and
// unmounts the UI until someone clicks Resume.
const IDLE_PARK_MS = 5 * 60 * 1000;
const IDLE_WARN_MS = 30 * 1000;
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'];
// Statuses that mean "this tab is waiting for something".
const PENDING_STATUSES = new Set(['scheduled', 'processing']);
// Auto-reloading on a workflow switch must not be able to loop.
const WF_RELOAD_GUARD_MS = 60000;
const WF_RELOAD_KEY = 'comfyq_wf_reload_at';
const WF_SWITCH_KEY = 'comfyq_wf_switch_name';

const INITIAL_STATE = {
    system_status: 'booting',
    benchmark_ms: 0,
    connected_users: [],
    jobs: [],
    workflow: null
};

const readOnce = (key) => {
    try {
        const v = sessionStorage.getItem(key);
        if (v !== null) sessionStorage.removeItem(key);
        return v;
    } catch { return null; }
};

/**
 * Custom hook to access the SocketContext.
 */
export const useSocket = () => useContext(SocketContext);

/**
 * SocketProvider manages the WebSocket connection and global application
 * state. Toasts are limited to error feedback (e.g. "wrong admin password");
 * job completion notifications were removed.
 *
 * On a machine locked with an access password, the stored token is sent in the
 * handshake; if the server refuses it (password changed / cleared token), we
 * call `onAccessDenied` so App can put the access gate back up.
 *
 * Render stability: incoming state is merged with mergeState(), so unchanged
 * jobs / parameter_map / workflow_info keep their identity, and the actions
 * below never change identity (they read the socket and username from refs).
 */
export const SocketProvider = ({ children, onAccessDenied }) => {
    const [socket, setSocket] = useState(null);
    const socketRef = useRef(null);
    const [username, setUsername] = useState(localStorage.getItem('comfyq_username') || '');
    const usernameRef = useRef(username);
    // 'connecting' until the first connect, then 'connected' / 'reconnecting'
    // / 'paused' (parked on purpose — see IDLE_PARK_MS).
    const [connection, setConnection] = useState('connecting');
    const [state, setState] = useState(INITIAL_STATE);
    // The newest state, whether or not it has been rendered yet: a hidden tab
    // keeps folding updates in here and only re-renders when it comes back.
    const stateRef = useRef(INITIAL_STATE);
    const pendingRenderRef = useRef(false);
    // Sequence of the last state we applied; a gap means a patch went missing
    // and the whole state has to be asked for again.
    const seqRef = useRef(null);
    const resyncAskedRef = useRef(false);

    const [paused, setPaused] = useState(false);
    const pausedRef = useRef(false);
    // Seconds left before this tab parks itself; 0 = not counting down.
    const [parkWarning, setParkWarning] = useState(0);
    const lastActivityRef = useRef(Date.now());

    const [toasts, setToasts] = useState([]);
    const [workflowsById, setWorkflowsById] = useState({});
    // Set when the machine starts serving a different workflow, so open tabs
    // can say so instead of quietly holding the previous workflow's form.
    const [workflowChange, setWorkflowChange] = useState(null);

    // Kept in a ref so the socket effect stays mount-once — re-running it on a
    // new callback identity would tear down and re-open the connection.
    const onAccessDeniedRef = useRef(onAccessDenied);
    useEffect(() => { onAccessDeniedRef.current = onAccessDenied; }, [onAccessDenied]);

    // Fold an update into the state, but don't make a BACKGROUND tab render it:
    // with several tabs open per machine, the ones nobody is looking at were
    // re-rendering their whole grid (and re-decoding their media) on every
    // update. They stay up to date in stateRef and paint once, on return.
    const applyState = useCallback((updater) => {
        const next = updater(stateRef.current);
        if (next === stateRef.current) return;
        stateRef.current = next;
        if (typeof document !== 'undefined' && document.hidden) {
            pendingRenderRef.current = true;
            return;
        }
        setState(next);
    }, []);

    useEffect(() => {
        const onVisible = () => {
            if (document.hidden) return;
            lastActivityRef.current = Date.now();
            if (!pendingRenderRef.current) return;
            pendingRenderRef.current = false;
            setState(stateRef.current);
        };
        document.addEventListener('visibilitychange', onVisible);
        return () => document.removeEventListener('visibilitychange', onVisible);
    }, []);

    // The admin can switch the served workflow at any time (the server restarts
    // and every tab reconnects). A tab that was open then holds a form built
    // for the previous workflow, whose parameters mean nothing to the new one —
    // students had to reload the page to book again. Announce the switch and
    // let the UI rebuild itself.
    const activeWorkflowName = state.workflow_info?.name;
    const lastWorkflowId = useRef(undefined);
    useEffect(() => {
        const id = state.workflow_info?.id;
        if (id === undefined) return;                       // no state yet
        const previous = lastWorkflowId.current;
        lastWorkflowId.current = id;
        if (previous === undefined || previous === id) return;   // first sighting / unchanged
        const name = activeWorkflowName || id || 'no workflow';

        // Rebuilding the forms in place works, but a tab that lived through a
        // switch has stale everything else too — the workflow library, the
        // recall prefill, the ETAs, the guides — which is why the workaround
        // was "close the tab and open it again". Do that for them: reload,
        // unless a form is open with something typed in it (then the banner
        // below offers the reload), and never twice in quick succession so a
        // flapping server can't put a tab in a reload loop.
        let reloadedRecently = false;
        try { reloadedRecently = Date.now() - Number(sessionStorage.getItem(WF_RELOAD_KEY) || 0) < WF_RELOAD_GUARD_MS; } catch { /* no sessionStorage */ }
        if (!idleHeld() && !reloadedRecently) {
            try {
                sessionStorage.setItem(WF_RELOAD_KEY, String(Date.now()));
                sessionStorage.setItem(WF_SWITCH_KEY, name);
            } catch { /* private mode — the reload still happens */ }
            window.location.reload();
            return;
        }
        setWorkflowChange({ id, name, at: Date.now() });
        setToasts(prev => [...prev, {
            id: `wf-${Date.now()}`,
            kind: 'ok',
            message: id
                ? `This machine now serves “${name}”. The booking form has been updated — no need to reload.`
                : 'This machine stopped serving a workflow. Booking is paused until an admin starts one.',
        }]);
    }, [state.workflow_info?.id, activeWorkflowName]);

    const dismissWorkflowChange = useCallback(() => setWorkflowChange(null), []);

    // Say what happened after an automatic reload, so the new form doesn't just
    // appear out of nowhere.
    useEffect(() => {
        const switched = readOnce(WF_SWITCH_KEY);
        if (!switched) return;
        setToasts(prev => [...prev, {
            id: `wf-reload-${Date.now()}`,
            kind: 'ok',
            message: `This machine now serves “${switched}” — the page reloaded itself with its settings.`,
        }]);
    }, []);

    // Fetch the workflow library so jobs can resolve workflow_id → name. Past
    // jobs may reference workflows that aren't currently active; refetched when
    // the admin activates another workflow, so its name and ETA data show up.
    const activeWorkflowId = state.workflow_info?.id;
    useEffect(() => {
        let cancelled = false;
        fetch(`${SERVER_URL}/workflows`, { headers: accessHeaders() })
            .then(r => r.ok ? r.json() : null)
            .then(data => {
                if (!data || cancelled) return;
                const map = {};
                for (const w of data.workflows || []) map[w.id] = w;
                setWorkflowsById(map);
            })
            .catch(() => { /* non-critical */ });
        return () => { cancelled = true; };
    }, [activeWorkflowId]);

    // Initialize socket connection. Empty SERVER_URL means same-origin
    // (Vite is proxying /socket.io); pass undefined so socket.io-client
    // uses window.location instead of choking on the empty string.
    useEffect(() => {
        // The access token proves this browser knows the machine's access
        // password. Empty on an open machine, which the server accepts.
        const opts = { auth: { accessToken: getAccessToken() } };
        const newSocket = SERVER_URL ? io(SERVER_URL, opts) : io(opts);
        socketRef.current = newSocket;
        setSocket(newSocket);
        let accessDenied = false;

        const denyAccess = () => {
            accessDenied = true;
            newSocket.close();
            onAccessDeniedRef.current?.();
        };

        newSocket.on('connect', () => {
            setConnection('connected');
            const storedName = localStorage.getItem('comfyq_username');
            if (storedName) {
                newSocket.emit('register_user', storedName);
            }
        });

        newSocket.on('disconnect', (reason) => {
            if (accessDenied) return;
            // Parked on purpose — not a lost connection, so no alarming banner.
            if (pausedRef.current) { setConnection('paused'); return; }
            seqRef.current = null;          // patches resume from a fresh snapshot
            setConnection('reconnecting');
            // socket.io only retries on its own after a network drop; a
            // server-side disconnect (e.g. a restart racing the handshake)
            // needs an explicit reconnect.
            if (reason === 'io server disconnect') newSocket.connect();
        });

        // Handshake refused because this machine is reserved — stop retrying
        // and hand control back to the access gate.
        newSocket.on('connect_error', (err) => {
            if (err?.data?.accessRequired || /access password/i.test(err?.message || '')) {
                denyAccess();
            }
        });

        // The admin set/changed the access password while we were connected.
        newSocket.on('access_revoked', denyAccess);

        // The whole state: sent on connect, on request, and as a periodic
        // self-heal. Everything in between arrives as a patch.
        newSocket.on('state_update', (newState) => {
            seqRef.current = typeof newState?.seq === 'number' ? newState.seq : null;
            resyncAskedRef.current = false;
            applyState(prev => mergeState(prev, newState));
        });

        // Only what changed — one job on a progress tick instead of the entire
        // list. A patch that isn't the next one in sequence means we missed one
        // (a reconnect), so ask for the whole state instead of drifting.
        newSocket.on('state_patch', (patch) => {
            const expected = seqRef.current == null ? null : seqRef.current + 1;
            if (expected === null || patch?.seq !== expected) {
                if (!resyncAskedRef.current) {
                    resyncAskedRef.current = true;
                    newSocket.emit('request_state');
                }
                return;
            }
            seqRef.current = patch.seq;
            applyState(prev => applyPatch(prev, patch));
        });

        newSocket.on('error', (err) => {
            console.error('[Socket] Server error:', err.message);
            // Surface server-side rejections (e.g. "wrong admin password",
            // "foreign job — admin password required") as a toast so the
            // user knows why their action did nothing.
            const toastId = `err-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
            setToasts(prev => [...prev, { id: toastId, message: `⚠️ ${err.message}`, kind: 'err' }]);
        });

        return () => {
            newSocket.close();
            socketRef.current = null;
        };
    }, [applyState]);

    // ---- Idle parking -------------------------------------------------------

    const parkSession = useCallback(() => {
        pausedRef.current = true;
        setParkWarning(0);
        setPaused(true);
        setConnection('paused');
        // Works for a tab opened by script (the fleet monitor's "Schedule a
        // job", a link we opened ourselves). A tab the student opened by hand
        // can't be closed by script — it parks instead, which costs the same.
        try { window.close(); } catch { /* not script-opened */ }
        socketRef.current?.disconnect();
    }, []);

    const resumeSession = useCallback(() => {
        pausedRef.current = false;
        lastActivityRef.current = Date.now();
        setPaused(false);
        setParkWarning(0);
        const s = socketRef.current;
        if (s && !s.connected) {
            setConnection('connecting');
            seqRef.current = null;
            s.connect();
        } else {
            setConnection('connected');
        }
    }, []);

    useEffect(() => {
        const bump = () => {
            lastActivityRef.current = Date.now();
            setParkWarning(0);
        };
        for (const ev of ACTIVITY_EVENTS) window.addEventListener(ev, bump, { passive: true });
        return () => { for (const ev of ACTIVITY_EVENTS) window.removeEventListener(ev, bump); };
    }, []);

    useEffect(() => {
        if (paused) return;
        const tick = () => {
            // A booking form with something in it, or a job of ours still to
            // come, means this tab is in use — keep it.
            const mine = usernameRef.current;
            const waiting = (stateRef.current.jobs || []).some(
                j => j.user_id === mine && PENDING_STATUSES.has(j.status)
            );
            if (idleHeld() || waiting) {
                lastActivityRef.current = Date.now();
                setParkWarning(0);
                return;
            }
            const idleFor = Date.now() - lastActivityRef.current;
            if (idleFor >= IDLE_PARK_MS) { parkSession(); return; }
            // Count down in view so nobody is surprised; a tab nobody is
            // looking at has no one to warn, so it just goes.
            if (idleFor >= IDLE_PARK_MS - IDLE_WARN_MS && !document.hidden) {
                setParkWarning(Math.max(1, Math.ceil((IDLE_PARK_MS - idleFor) / 1000)));
            } else {
                setParkWarning(0);
            }
        };
        const id = setInterval(tick, 1000);
        return () => clearInterval(id);
    }, [paused, parkSession]);

    const removeToast = useCallback((id) => {
        setToasts(prev => prev.filter(t => t.id !== id));
    }, []);

    const registerUser = useCallback((name) => {
        if (!name) return;
        usernameRef.current = name;
        setUsername(name);
        localStorage.setItem('comfyq_username', name);
        socketRef.current?.emit('register_user', name);
    }, []);

    /**
     * Actions to interact with the scheduler
     */

    // Resolves { ok: true, jobId } once the server has queued the job, or
    // { ok: false, error } — so the booking form can stay open (and keep what
    // the student typed) when the booking didn't go through.
    const bookJob = useCallback((scheduledTime, prompt, params = {}) => new Promise((resolve) => {
        const s = socketRef.current;
        // Don't queue the emit while offline: socket.io would replay it on
        // reconnect, and a student who retries meanwhile would book twice.
        if (!s || !s.connected) {
            resolve({ ok: false, error: 'Not connected to the server — reconnecting. Try again in a moment.' });
            return;
        }
        s.timeout(BOOK_TIMEOUT_MS).emit(
            'book_job',
            { scheduledTime, prompt, params, user_id: usernameRef.current },
            (err, res) => {
                if (err) {
                    resolve({ ok: false, error: 'The server did not confirm the booking. Check the timeline before booking again.' });
                    return;
                }
                resolve(res || { ok: false, error: 'Unexpected reply from the server.' });
            }
        );
    }), []);

    // Both deleteJob and cancelJob accept an optional admin_password used
    // when acting on another user's job. The server refuses foreign actions
    // without a valid password (and refuses entirely if no password is set).
    const deleteJob = useCallback((jobId, adminPassword) => {
        const s = socketRef.current;
        if (!s) return;
        if (adminPassword) s.emit('delete_job', { jobId, admin_password: adminPassword });
        else s.emit('delete_job', jobId);
    }, []);

    const cancelJob = useCallback((jobId, adminPassword) => {
        const s = socketRef.current;
        if (!s) return;
        if (adminPassword) s.emit('cancel_job', { jobId, admin_password: adminPassword });
        else s.emit('cancel_job', jobId);
    }, []);

    const reorderJob = useCallback((jobId, newTimeSlot) => {
        socketRef.current?.emit('reorder_job', { jobId, newTimeSlot });
    }, []);

    const value = useMemo(() => ({
        socket, connection, state, bookJob, deleteJob, cancelJob, reorderJob, username, registerUser,
        workflowsById, workflowChange, dismissWorkflowChange,
        paused, parkWarning, resumeSession,
    }), [socket, connection, state, bookJob, deleteJob, cancelJob, reorderJob, username, registerUser,
        workflowsById, workflowChange, dismissWorkflowChange, paused, parkWarning, resumeSession]);

    return (
        <SocketContext.Provider value={value}>
            {children}
            {toasts.map(toast => (
                <Toast
                    key={toast.id}
                    id={toast.id}
                    message={toast.message}
                    kind={toast.kind || 'ok'}
                    onClose={removeToast}
                />
            ))}
        </SocketContext.Provider>
    );
};
