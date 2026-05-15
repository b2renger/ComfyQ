import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { io } from 'socket.io-client';
import Toast from '../components/ui/Toast';
import { SERVER_URL } from '../utils/api';

const SocketContext = createContext();

/**
 * Custom hook to access the SocketContext.
 */
export const useSocket = () => useContext(SocketContext);

/**
 * SocketProvider manages the WebSocket connection and global application
 * state. Toasts are limited to error feedback (e.g. "wrong admin password");
 * job completion notifications were removed.
 */
export const SocketProvider = ({ children }) => {
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

    // Fetch the workflow library once so jobs can resolve workflow_id → name.
    // Past jobs may reference workflows that aren't currently active.
    useEffect(() => {
        fetch(`${SERVER_URL}/workflows`)
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
        const newSocket = SERVER_URL ? io(SERVER_URL) : io();
        setSocket(newSocket);

        newSocket.on('connect', () => {
            const storedName = localStorage.getItem('comfyq_username');
            if (storedName) {
                newSocket.emit('register_user', storedName);
            }
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
