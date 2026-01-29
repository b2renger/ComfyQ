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
 * Main server entry point.
 * Initializes the API routes, file serving, and mode-specific logic (Admin vs Student).
 */
async function startServer() {
    try {
        console.log('[Server] Starting ComfyQ...');

        // 1. Core Configuration & Mode Initialization
        const mode = configManager.initializeMode();
        let config = configManager.readConfig();
        config = configManager.resolveConfigPaths(config);

        console.log(`[Server] Operating Mode: ${mode.toUpperCase()}`);
        console.log(`[Server] Workspace: ${config.comfy_ui.root_path}`);

        const app = express();
        app.use(cors());
        app.use(express.json({ limit: '10mb' }));

        const server = http.createServer(app);

        // 2. Routing Setup

        // Admin Management Routes
        app.use('/admin', adminRoutes);

        // Serve generated output images/videos
        console.log(`[Server] Output Gallery: ${config.comfy_ui.output_dir}`);
        app.use('/images', express.static(config.comfy_ui.output_dir));

        // File Upload Setup (for workflow inputs)
        const inputDir = path.resolve(config.comfy_ui.root_path, 'input');
        if (!fs.existsSync(inputDir)) {
            fs.mkdirSync(inputDir, { recursive: true });
        }

        const storage = multer.diskStorage({
            destination: (req, file, cb) => cb(null, inputDir),
            filename: (req, file, cb) => {
                const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
                cb(null, `${uniqueSuffix}-${file.originalname}`);
            }
        });

        const upload = multer({ storage: storage });

        // Generic upload endpoint
        app.post('/upload', upload.single('file'), (req, res) => {
            if (!req.file) return res.status(400).send('No file uploaded.');
            console.log(`[Server] Upload complete: ${req.file.filename}`);
            res.json({ filename: req.file.filename });
        });

        // Backward compatibility for legacy clients
        app.post('/upload-image', upload.single('image'), (req, res) => {
            if (!req.file) return res.status(400).send('No file uploaded.');
            res.json({ filename: req.file.filename });
        });

        // Secure download endpoint for results
        app.get('/download/:filename(*)', (req, res) => {
            const fileName = req.params.filename;
            const filePath = path.resolve(config.comfy_ui.output_dir, fileName);

            if (!fs.existsSync(filePath)) {
                return res.status(404).send('File not found');
            }

            res.download(filePath, fileName, (err) => {
                if (err && !res.headersSent) {
                    res.status(500).send('Download interrupted');
                }
            });
        });

        // 3. Web server startup
        const port = config.server.port || 3000;
        const host = config.server.host || '0.0.0.0';
        server.listen(port, host, () => {
            console.log(`[Server] Network interface: http://${host}:${port}`);
        });

        // 4. Mode-Dependent Logic (Student Mode = ComfyUI Interaction Enabled)
        if (mode === 'student') {
            const bootManager = new BootManager(config);
            const scheduler = new Scheduler(bootManager);
            new SocketManager(server, scheduler, bootManager);

            console.log('[Server] Student Mode: Initializing ComfyUI backend interaction...');

            bootManager.boot().catch(err => {
                console.error('[Server] ComfyUI Boot Sequence Failed:', err.message);
            });
        } else {
            console.log('[Server] Admin Mode: Waiting for workflow configuration from the dashboard.');
        }

    } catch (error) {
        console.error('[Server] Fatal Initialization Error:', error);
        process.exit(1);
    }
}

startServer();
