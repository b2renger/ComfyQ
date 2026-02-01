/**
 * ComfyQ Server - Main Entry Point
 * 
 * This is the primary server file for ComfyQ, a web-based middleware for scheduling
 * and managing ComfyUI workflow jobs. The server operates in two distinct modes:
 * 
 * - ADMIN MODE: Allows administrators to upload workflows, configure parameters,
 *   and set up the system for student/user access.
 * - STUDENT MODE: Provides users with a timeline interface to schedule jobs,
 *   view results, and manage their submissions.
 * 
 * The server handles:
 * - Express REST API endpoints for configuration and file management
 * - WebSocket communication for real-time job updates
 * - File uploads for workflow inputs (images, videos)
 * - Static file serving for generated outputs
 * - ComfyUI process lifecycle management (student mode only)
 * 
 * @module server/index
 */

const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const multer = require('multer');
const configManager = require('./configManager');
const BootManager = require('./bootManager');
const Scheduler = require('./scheduler');
const SocketManager = require('./socketManager');
const adminRoutes = require('./routes/admin');

/**
 * Initializes and starts the ComfyQ server.
 * 
 * This function sets up the Express application, configures middleware,
 * establishes routes, and initializes mode-specific components based on
 * the current server mode (admin or student).
 * 
 * Startup Flow:
 * 1. Read and resolve configuration (determines mode)
 * 2. Setup Express middleware (CORS, JSON parsing, etc.)
 * 3. Configure routes (admin routes, upload endpoints, static serving)
 * 4. Start HTTP server
 * 5. Initialize mode-specific logic (ComfyUI boot in student mode)
 * 
 * @async
 * @throws {Error} If configuration is invalid or server fails to start
 */
async function startServer() {
    try {
        console.log('[Server] Starting ComfyQ...');

        // ========================================
        // 1. CORE CONFIGURATION & MODE INITIALIZATION
        // ========================================

        // Initialize mode from config.json (or set to 'admin' if no config exists)
        const mode = configManager.initializeMode();

        // Read configuration and resolve all relative paths to absolute paths
        let config = configManager.readConfig();
        config = configManager.resolveConfigPaths(config);

        console.log(`[Server] Operating Mode: ${mode.toUpperCase()}`);
        console.log(`[Server] Workspace: ${config.comfy_ui.root_path}`);

        // ========================================
        // 2. EXPRESS APPLICATION SETUP
        // ========================================

        const app = express();

        // Enable Cross-Origin Resource Sharing for frontend access
        app.use(cors());

        // Parse JSON request bodies (increased limit for workflow uploads)
        app.use(express.json({ limit: '10mb' }));

        // Create HTTP server instance (needed for Socket.IO integration)
        const server = http.createServer(app);

        // ========================================
        // 3. ROUTING SETUP
        // ========================================

        // Admin API Routes - Workflow upload, configuration, mode switching
        app.use('/admin', adminRoutes);

        // Static file serving - Generated images/videos from ComfyUI output directory
        // Accessible at /images/<filename>
        console.log(`[Server] Output Gallery: ${config.comfy_ui.output_dir}`);
        app.use('/images', express.static(config.comfy_ui.output_dir));

        // ========================================
        // 4. FILE UPLOAD CONFIGURATION
        // ========================================

        // Ensure ComfyUI input directory exists for user-uploaded files
        const inputDir = path.resolve(config.comfy_ui.root_path, 'input');
        if (!fs.existsSync(inputDir)) {
            fs.mkdirSync(inputDir, { recursive: true });
        }

        // Configure multer storage - saves files with timestamp prefix to avoid collisions
        const storage = multer.diskStorage({
            destination: (req, file, cb) => cb(null, inputDir),
            filename: (req, file, cb) => {
                const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
                cb(null, `${uniqueSuffix}-${file.originalname}`);
            }
        });

        const upload = multer({ storage: storage });

        /**
         * POST /upload
         * Generic file upload endpoint for workflow inputs (images, videos)
         * Returns the saved filename for use in job parameters
         */
        app.post('/upload', upload.single('file'), (req, res) => {
            if (!req.file) return res.status(400).send('No file uploaded.');
            console.log(`[Server] Upload complete: ${req.file.filename}`);
            res.json({ filename: req.file.filename });
        });

        /**
         * POST /upload-image
         * Legacy endpoint for backward compatibility with older clients
         */
        app.post('/upload-image', upload.single('image'), (req, res) => {
            if (!req.file) return res.status(400).send('No file uploaded.');
            res.json({ filename: req.file.filename });
        });

        /**
         * GET /download/:filename
         * Secure download endpoint for generated results
         * Validates file exists before allowing download
         */
        app.get('/download/:filename(*)', (req, res) => {
            const fileName = req.params.filename;
            const filePath = path.resolve(config.comfy_ui.output_dir, fileName);

            // Security: Ensure file exists before allowing download
            if (!fs.existsSync(filePath)) {
                return res.status(404).send('File not found');
            }

            res.download(filePath, fileName, (err) => {
                if (err && !res.headersSent) {
                    res.status(500).send('Download interrupted');
                }
            });
        });

        // ========================================
        // 5. HTTP SERVER STARTUP
        // ========================================

        const port = config.server.port || 3000;
        const host = config.server.host || '0.0.0.0';
        server.listen(port, host, () => {
            console.log(`[Server] Network interface: http://${host}:${port}`);
        });

        // ========================================
        // 6. MODE-SPECIFIC INITIALIZATION
        // ========================================

        if (mode === 'student') {
            // STUDENT MODE: Full system initialization with ComfyUI integration

            // BootManager: Handles ComfyUI process lifecycle and WebSocket connection
            const bootManager = new BootManager(config);

            // Scheduler: Manages job queue, timing, and execution
            const scheduler = new Scheduler(bootManager);

            // SocketManager: Real-time communication with frontend clients
            new SocketManager(server, scheduler, bootManager);

            console.log('[Server] Student Mode: Initializing ComfyUI backend interaction...');

            // Start ComfyUI boot sequence (async)
            // This launches ComfyUI, waits for API readiness, connects WebSocket,
            // and runs a benchmark job to estimate average generation time
            bootManager.boot().catch(err => {
                console.error('[Server] ComfyUI Boot Sequence Failed:', err.message);
            });
        } else {
            // ADMIN MODE: Configuration-only, no ComfyUI interaction
            console.log('[Server] Admin Mode: Waiting for workflow configuration from the dashboard.');
        }

    } catch (error) {
        console.error('[Server] Fatal Initialization Error:', error);
        process.exit(1);
    }
}

startServer();
