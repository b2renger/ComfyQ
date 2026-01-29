const { Server } = require('socket.io');

/**
 * SocketManager handles real-time communication between the server and clients.
 * It manages user connections, job bookings, and broadcasts the current system state.
 */
class SocketManager {
    /**
     * @param {Object} httpServer - The Express/HTTP server instance
     * @param {Scheduler} scheduler - The job scheduler instance
     * @param {BootManager} bootManager - The system boot manager instance
     */
    constructor(httpServer, scheduler, bootManager) {
        this.io = new Server(httpServer, {
            cors: {
                origin: "*",
                methods: ["GET", "POST"]
            }
        });
        this.scheduler = scheduler;
        this.bootManager = bootManager;
        this.connectedUsers = new Map();

        this.init();

        // Listen for internal scheduler updates and broadcast them globally
        this.scheduler.setUpdateListener(() => {
            this.broadcastState();
        });

        // Listen for boot manager status changes
        this.bootManager.setStatusListener(() => {
            this.broadcastState();
        });
    }

    /**
     * Initializes socket event listeners.
     */
    init() {
        this.io.on('connection', (socket) => {
            let userId = `Guest-${socket.id.substring(0, 4)}`;

            this.connectedUsers.set(socket.id, {
                socketId: socket.id,
                userId: userId,
                ip: socket.handshake.address
            });

            this.broadcastState();

            // Client identifies themselves with a username
            socket.on('register_user', (name) => {
                if (name) {
                    userId = name;
                    const userData = this.connectedUsers.get(socket.id);
                    if (userData) {
                        userData.userId = userId;
                        this.connectedUsers.set(socket.id, userData);
                        console.log(`[Socket] Registered User: ${userId}`);
                        this.broadcastState();
                    }
                }
            });

            // Client requests to book a new job
            socket.on('book_job', (data) => {
                try {
                    const { scheduledTime, prompt, params, user_id } = data;
                    const bookerId = user_id || userId;
                    console.log(`[Socket] Booking job for ${bookerId}: "${prompt}" at ${new Date(scheduledTime).toLocaleTimeString()}`);
                    this.scheduler.addJob(bookerId, scheduledTime, prompt, params);
                    this.broadcastState();
                } catch (error) {
                    socket.emit('error', { message: error.message });
                }
            });

            // Client (Admin) requests to delete a job
            socket.on('delete_job', (jobId) => {
                try {
                    this.scheduler.deleteJob(jobId);
                    this.broadcastState();
                } catch (error) {
                    socket.emit('error', { message: error.message });
                }
            });

            // Client (Admin) requests to reorder a job
            socket.on('reorder_job', (data) => {
                try {
                    const { jobId, newTimeSlot } = data;
                    this.scheduler.reorderJob(jobId, newTimeSlot);
                    this.broadcastState();
                } catch (error) {
                    socket.emit('error', { message: error.message });
                }
            });

            socket.on('disconnect', () => {
                this.connectedUsers.delete(socket.id);
                this.broadcastState();
            });
        });

        // Periodic heartbeat broadcast
        setInterval(() => {
            this.broadcastState();
        }, 5000);
    }

    /**
     * Broadcasts the current system state, jobs, and connected users to all clients.
     */
    broadcastState() {
        const config = this.bootManager.config;
        const state = {
            system_status: this.bootManager.status,
            benchmark_ms: this.bootManager.globalJobDuration,
            connected_users: Array.from(this.connectedUsers.values()),
            jobs: this.scheduler.getJobs(),
            workflow: config.workflow,
            workflow_info: {
                id: config.id || 'unknown',
                name: config.name || 'Unnamed Workflow',
                description: config.description || ''
            }
        };
        this.io.emit('state_update', state);
    }
}

module.exports = SocketManager;
