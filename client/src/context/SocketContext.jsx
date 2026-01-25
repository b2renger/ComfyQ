import React, { createContext, useContext, useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import Toast from '../components/ui/Toast';

const SocketContext = createContext();

export const useSocket = () => useContext(SocketContext);

export const SocketProvider = ({ children }) => {
    const [socket, setSocket] = useState(null);
    const [username, setUsername] = useState(localStorage.getItem('comfyq_username') || '');
    const [state, setState] = useState({
        system_status: 'booting',
        benchmark_ms: 0,
        connected_users: [],
        jobs: []
    });

    const [prevJobs, setPrevJobs] = useState([]);
    const [toasts, setToasts] = useState([]);

    useEffect(() => {
        const newSocket = io('http://localhost:3000');
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
            alert(`Error: ${err.message}`);
        });

        // Request notification permission
        if ('Notification' in window && Notification.permission === 'default') {
            Notification.requestPermission();
        }

        return () => newSocket.close();
    }, []);

    // Track job completion and show notifications
    useEffect(() => {
        if (!username || prevJobs.length === 0) {
            setPrevJobs(state.jobs);
            return;
        }

        // Check for newly completed jobs for the current user
        state.jobs.forEach(job => {
            const prevJob = prevJobs.find(j => j.id === job.id);
            if (job.user_id === username &&
                job.status === 'completed' &&
                prevJob &&
                prevJob.status !== 'completed') {

                // Show browser notification
                if ('Notification' in window && Notification.permission === 'granted') {
                    new Notification('ComfyQ - Job Completed! 🎨', {
                        body: `Your generation is ready: "${job.prompt.substring(0, 50)}..."`,
                        icon: '/favicon.ico',
                        badge: '/favicon.ico',
                        tag: job.id,
                    });
                }

                // Show in-app toast notification
                setToasts(prev => [...prev, {
                    id: job.id,
                    message: job.prompt.substring(0, 50) + (job.prompt.length > 50 ? '...' : '')
                }]);

                // Optional: Play sound or show visual feedback
                console.log(`✅ Job completed for ${username}: ${job.prompt}`);
            }
        });

        setPrevJobs(state.jobs);
    }, [state.jobs, username, prevJobs]);

    const removeToast = (id) => {
        setToasts(prev => prev.filter(toast => toast.id !== id));
    };

    const registerUser = (name) => {
        if (!name) return;
        setUsername(name);
        localStorage.setItem('comfyq_username', name);
        if (socket) {
            socket.emit('register_user', name);
        }
    };

    const bookJob = (scheduledTime, prompt, params = {}) => {
        if (socket) {
            socket.emit('book_job', {
                scheduledTime,
                prompt,
                params,
                user_id: username // Attach username to booking
            });
        }
    };

    return (
        <SocketContext.Provider value={{ socket, state, bookJob, username, registerUser }}>
            {children}
            {toasts.map(toast => (
                <Toast
                    key={toast.id}
                    message={toast.message}
                    onClose={() => removeToast(toast.id)}
                />
            ))}
        </SocketContext.Provider>
    );
};
