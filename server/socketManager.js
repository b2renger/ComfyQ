const { Server } = require('socket.io');

class SocketManager {
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

        // Listen for scheduler updates and broadcast immediately
        this.scheduler.setUpdateListener(() => {
            this.broadcastState();
        });
    }

    init() {
        this.io.on('connection', (socket) => {
            let userId = `Guest-${socket.id.substring(0, 4)}`;
            console.log(`[SocketManager] User connected: ${userId} (${socket.id})`);

            this.connectedUsers.set(socket.id, {
                socketId: socket.id,
                userId: userId,
                ip: socket.handshake.address
            });

            this.broadcastState();

            socket.on('register_user', (name) => {
                if (name) {
                    userId = name;
                    const userData = this.connectedUsers.get(socket.id);
                    if (userData) {
                        userData.userId = userId;
                        this.connectedUsers.set(socket.id, userData);
                        console.log(`[SocketManager] ${socket.id} registered as ${userId}`);
                        this.broadcastState();
                    }
                }
            });

            socket.on('book_job', (data) => {
                try {
                    const { scheduledTime, prompt, params, user_id } = data;
                    // Use the user_id sent from client if available (for persistency), otherwise socket name
                    const bookerId = user_id || userId;
                    this.scheduler.addJob(bookerId, scheduledTime, prompt, params);
                    this.broadcastState();
                } catch (error) {
                    socket.emit('error', { message: error.message });
                }
            });

            socket.on('disconnect', () => {
                console.log(`[SocketManager] User disconnected: ${socket.id}`);
                this.connectedUsers.delete(socket.id);
                this.broadcastState();
            });
        });

        // Periodic broadcast to ensure all clients are synced
        setInterval(() => {
            this.broadcastState();
        }, 5000);
    }

    broadcastState() {
        const workflow = this.bootManager.config.workflow;
        const state = {
            system_status: this.bootManager.status,
            benchmark_ms: this.bootManager.globalJobDuration,
            connected_users: Array.from(this.connectedUsers.values()),
            jobs: this.scheduler.getJobs(),
            workflow: workflow,
            workflow_info: {
                id: this.bootManager.config.id || 'unknown',
                name: this.bootManager.config.name || 'Unnamed Workflow',
                description: this.bootManager.config.description || ''
            }
        };
        this.io.emit('state_update', state);
    }
}

module.exports = SocketManager;
