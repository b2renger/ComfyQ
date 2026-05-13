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
 * SocketProvider manages the WebSocket connection, global application state,
 * and notifications (toasts/browser notifications).
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

    const [prevJobs, setPrevJobs] = useState([]);
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

    // Initialize socket connection
    useEffect(() => {
        const newSocket = io(SERVER_URL);
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

        // Request browser notification permission
        if ('Notification' in window && Notification.permission === 'default') {
            Notification.requestPermission();
        }

        return () => newSocket.close();
    }, []);

    // Job completion notification logic
    useEffect(() => {
        if (!username || state.jobs.length === 0) {
            setPrevJobs(state.jobs);
            return;
        }

        state.jobs.forEach(job => {
            const prevJob = prevJobs.find(j => j.id === job.id);
            // Detect transition from non-completed to completed
            if (job.user_id === username &&
                job.status === 'completed' &&
                (!prevJob || prevJob.status !== 'completed')) {

                // 1. Browser Notification
                if ('Notification' in window && Notification.permission === 'granted') {
                    new Notification('ComfyQ: Generation Ready! 🎨', {
                        body: `Result for: "${job.prompt.substring(0, 50)}..."`,
                        icon: '/favicon.ico',
                        tag: job.id,
                    });
                }

                // 2. In-App Toast
                const toastId = `${job.id}-${Date.now()}`;
                setToasts(prev => [...prev, {
                    id: toastId,
                    message: `Finish! ${job.prompt.substring(0, 40)}...`
                }]);
            }
        });

        setPrevJobs(state.jobs);
    }, [state.jobs, username, prevJobs]);

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
