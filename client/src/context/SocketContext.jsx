import React, { createContext, useContext, useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { io } from 'socket.io-client';
import Toast from '../components/ui/Toast';
import { SERVER_URL } from '../utils/api';
import { getAccessToken, accessHeaders } from '../utils/access';
import { mergeState } from '../utils/mergeState';

const SocketContext = createContext();

// How long a booking waits for the server's confirmation.
const BOOK_TIMEOUT_MS = 15000;

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
    // 'connecting' until the first connect, then 'connected' / 'reconnecting'.
    const [connection, setConnection] = useState('connecting');
    const [state, setState] = useState({
        system_status: 'booting',
        benchmark_ms: 0,
        connected_users: [],
        jobs: [],
        workflow: null
    });

    const [toasts, setToasts] = useState([]);
    const [workflowsById, setWorkflowsById] = useState({});
    // Set when the machine starts serving a different workflow, so open tabs
    // can say so instead of quietly holding the previous workflow's form.
    const [workflowChange, setWorkflowChange] = useState(null);

    // Kept in a ref so the socket effect stays mount-once — re-running it on a
    // new callback identity would tear down and re-open the connection.
    const onAccessDeniedRef = useRef(onAccessDenied);
    useEffect(() => { onAccessDeniedRef.current = onAccessDenied; }, [onAccessDenied]);

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

        newSocket.on('state_update', (newState) => {
            setState(prev => mergeState(prev, newState));
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
    }, []);

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
    }), [socket, connection, state, bookJob, deleteJob, cancelJob, reorderJob, username, registerUser,
        workflowsById, workflowChange, dismissWorkflowChange]);

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
