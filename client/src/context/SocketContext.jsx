import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { io } from 'socket.io-client';
import Toast from '../components/ui/Toast';
import { SERVER_URL } from '../utils/api';
import { getAccessToken, accessHeaders } from '../utils/access';

const SocketContext = createContext();

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
 */
export const SocketProvider = ({ children, onAccessDenied }) => {
    const [socket, setSocket] = useState(null);
    const [username, setUsername] = useState(localStorage.getItem('comfyq_username') || '');
    const [state, setState] = useState({
        system_status: 'booting',
        benchmark_ms: 0,
        connected_users: [],
        jobs: [],
        workflow: null
    });

    const [toasts, setToasts] = useState([]);
    const [workflowsById, setWorkflowsById] = useState({});

    // Kept in a ref so the socket effect stays mount-once — re-running it on a
    // new callback identity would tear down and re-open the connection.
    const onAccessDeniedRef = useRef(onAccessDenied);
    useEffect(() => { onAccessDeniedRef.current = onAccessDenied; }, [onAccessDenied]);

    // Fetch the workflow library once so jobs can resolve workflow_id → name.
    // Past jobs may reference workflows that aren't currently active.
    useEffect(() => {
        fetch(`${SERVER_URL}/workflows`, { headers: accessHeaders() })
            .then(r => r.ok ? r.json() : null)
            .then(data => {
                if (!data) return;
                const map = {};
                for (const w of data.workflows || []) map[w.id] = w;
                setWorkflowsById(map);
            })
            .catch(() => { /* non-critical */ });
    }, []);

    // Initialize socket connection. Empty SERVER_URL means same-origin
    // (Vite is proxying /socket.io); pass undefined so socket.io-client
    // uses window.location instead of choking on the empty string.
    useEffect(() => {
        // The access token proves this browser knows the machine's access
        // password. Empty on an open machine, which the server accepts.
        const opts = { auth: { accessToken: getAccessToken() } };
        const newSocket = SERVER_URL ? io(SERVER_URL, opts) : io(opts);
        setSocket(newSocket);

        newSocket.on('connect', () => {
            const storedName = localStorage.getItem('comfyq_username');
            if (storedName) {
                newSocket.emit('register_user', storedName);
            }
        });

        // Handshake refused because this machine is reserved — stop retrying
        // and hand control back to the access gate.
        newSocket.on('connect_error', (err) => {
            if (err?.data?.accessRequired || /access password/i.test(err?.message || '')) {
                newSocket.close();
                onAccessDeniedRef.current?.();
            }
        });

        // The admin set/changed the access password while we were connected.
        newSocket.on('access_revoked', () => {
            newSocket.close();
            onAccessDeniedRef.current?.();
        });

        newSocket.on('state_update', (newState) => {
            setState(newState);
        });

        newSocket.on('error', (err) => {
            console.error('[Socket] Server error:', err.message);
            // Surface server-side rejections (e.g. "wrong admin password",
            // "foreign job — admin password required") as a toast so the
            // user knows why their action did nothing.
            const toastId = `err-${Date.now()}`;
            setToasts(prev => [...prev, { id: toastId, message: `⚠️ ${err.message}`, kind: 'err' }]);
        });

        return () => newSocket.close();
    }, []);

    const removeToast = useCallback((id) => {
        setToasts(prev => prev.filter(t => t.id !== id));
    }, []);

    const registerUser = (name) => {
        if (!name) return;
        setUsername(name);
        localStorage.setItem('comfyq_username', name);
        if (socket) socket.emit('register_user', name);
    };

    /**
     * Actions to interact with the scheduler
     */
    const bookJob = useCallback((scheduledTime, prompt, params = {}) => {
        if (socket) socket.emit('book_job', { scheduledTime, prompt, params, user_id: username });
    }, [socket, username]);

    // Both deleteJob and cancelJob accept an optional admin_password used
    // when acting on another user's job. The server refuses foreign actions
    // without a valid password (and refuses entirely if no password is set).
    const deleteJob = useCallback((jobId, adminPassword) => {
        if (!socket) return;
        if (adminPassword) socket.emit('delete_job', { jobId, admin_password: adminPassword });
        else socket.emit('delete_job', jobId);
    }, [socket]);

    const cancelJob = useCallback((jobId, adminPassword) => {
        if (!socket) return;
        if (adminPassword) socket.emit('cancel_job', { jobId, admin_password: adminPassword });
        else socket.emit('cancel_job', jobId);
    }, [socket]);

    const reorderJob = useCallback((jobId, newTimeSlot) => {
        if (socket) socket.emit('reorder_job', { jobId, newTimeSlot });
    }, [socket]);

    return (
        <SocketContext.Provider value={{ socket, state, bookJob, deleteJob, cancelJob, reorderJob, username, registerUser, workflowsById }}>
            {children}
            {toasts.map(toast => (
                <Toast
                    key={toast.id}
                    message={toast.message}
                    kind={toast.kind || 'ok'}
                    onClose={() => removeToast(toast.id)}
                />
            ))}
        </SocketContext.Provider>
    );
};
