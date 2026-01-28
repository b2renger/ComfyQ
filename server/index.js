const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
// const { loadConfig } = require('./configLoader'); // Deprecated in favor of configManager
const configManager = require('./configManager');
const BootManager = require('./bootManager');
const Scheduler = require('./scheduler');
const SocketManager = require('./socketManager');
const multer = require('multer');
const adminRoutes = require('./routes/admin');

async function startServer() {
    try {
        console.log('[Server] Initializing...');

        // Initialize and get current mode
        const mode = configManager.initializeMode();
        let config = configManager.readConfig(); // Read full config
        config = configManager.resolveConfigPaths(config); // Resolve relative paths
        console.log(`[Server] Resolved Config Paths:`);
        console.log(`  - Root: ${config.comfy_ui.root_path}`);
        console.log(`  - Python: ${config.comfy_ui.python_executable}`);
        console.log(`  - Output: ${config.comfy_ui.output_dir}`);

        console.log(`[Server] Operating Mode: ${mode.toUpperCase()}`);
        if (mode === 'student') {
            console.log(`[Server] Workflow: ${config.workflow?.template_file || 'None'}`);
        }

        const app = express();
        const cors = require('cors');
        app.use(cors());

        // Create HTTP server
        const server = http.createServer(app);

        // --- Common Middleware & Routes ---

        // 1. Admin API Routes (Available in both modes, though usage might differ)
        app.use('/admin', adminRoutes);

        // 2. File Server & Image Proxy
        console.log(`[Server] Serving images from: ${config.comfy_ui.output_dir}`);
        app.use('/images', express.static(config.comfy_ui.output_dir));

        // 3. Image Upload (Used by both Admin for previews and Students for input)
        const inputDir = path.resolve(config.comfy_ui.root_path, 'input');
        if (!fs.existsSync(inputDir)) {
            fs.mkdirSync(inputDir, { recursive: true });
        }

        const storage = multer.diskStorage({
            destination: (req, file, cb) => {
                cb(null, inputDir);
            },
            filename: (req, file, cb) => {
                const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
                cb(null, uniqueSuffix + '-' + file.originalname);
            }
        });

        const upload = multer({ storage: storage });

        app.post('/upload', upload.single('image'), (req, res) => {
            if (!req.file) {
                return res.status(400).send('No file uploaded');
            }
            console.log(`[Upload] Received: ${req.file.filename}`);
            res.json({ filename: req.file.filename });
        });

        // 4. Download route
        app.get('/download/:filename(*)', (req, res) => {
            const fileName = req.params.filename;
            const filePath = path.resolve(config.comfy_ui.output_dir, fileName);
            // console.log(`[Download] Request for: ${fileName}`);

            if (!fs.existsSync(filePath)) {
                return res.status(404).send('File not found on server');
            }

            res.download(filePath, fileName, (err) => {
                if (err && !res.headersSent) {
                    res.status(500).send('Error downloading file');
                }
            });
        });

        // Start Web Server immediately
        const port = config.server.port || 3000;
        const host = config.server.host || '0.0.0.0';
        server.listen(port, host, () => {
            console.log(`[Server] Web server running on http://${host}:${port}`);
        });

        // --- Mode Specific Logic ---

        if (mode === 'student') {
            // Initialize ComfyUI and Scheduler only in Student Mode
            console.log('[Server] Starting ComfyUI connection...');

            const bootManager = new BootManager(config);
            const scheduler = new Scheduler(bootManager);
            const socketManager = new SocketManager(server, scheduler, bootManager);

            // Start ComfyUI boot sequence (non-blocking for server startup, but we await it for logic flow)
            // Ideally we shouldn't await it if we want server to be responsive during boot
            // But we need it for scheduler? No, scheduler can exist.

            bootManager.boot().catch(err => {
                console.error('[Server] ComfyUI Boot Failed:', err);
                // We don't exit process, we let server run so admin can see error?
                // But in student mode, maybe we should alert connected clients via socket?
                if (socketManager) {
                    // socketManager might rely on bootManager status updates
                }
            });

            // Initial broadcast after boot is handled by bootManager completion or socket logic
        } else {
            console.log('[Server] Admin mode active. Waiting for configuration...');
        }

    } catch (error) {
        console.error('[Server] Failed to start:', error);
        process.exit(1);
    }
}

startServer();
