const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { loadConfig } = require('./configLoader');
const BootManager = require('./bootManager');
const Scheduler = require('./scheduler');
const SocketManager = require('./socketManager');

async function startServer() {
    try {
        console.log('[Server] Loading configuration...');
        const config = loadConfig();

        const app = express();
        const cors = require('cors');
        app.use(cors());
        const server = http.createServer(app);

        // 4.1. File Server & Image Proxy
        console.log(`[Server] Serving images from: ${config.comfy_ui.output_dir}`);
        app.use('/images', express.static(config.comfy_ui.output_dir));

        // Download route
        app.get('/download/:filename(*)', (req, res) => {
            const fileName = req.params.filename;
            const filePath = path.resolve(config.comfy_ui.output_dir, fileName);
            console.log(`[Download] Request for: ${fileName} -> ${filePath}`);

            if (!fs.existsSync(filePath)) {
                console.error(`[Download] File not found: ${filePath}`);
                return res.status(404).send('File not found on server');
            }

            res.download(filePath, fileName, (err) => {
                if (err) {
                    console.error(`[Download] Error sending file: ${err.message}`);
                    if (!res.headersSent) {
                        res.status(500).send('Error downloading file');
                    }
                }
            });
        });

        const bootManager = new BootManager(config);
        const scheduler = new Scheduler(bootManager);
        const socketManager = new SocketManager(server, scheduler, bootManager);

        const port = config.server.port || 3000;
        server.listen(port, () => {
            console.log(`[Server] Web server running on http://localhost:${port}`);
        });

        // Start ComfyUI boot sequence
        await bootManager.boot();

        // Initial broadcast after boot
        socketManager.broadcastState();

    } catch (error) {
        console.error('[Server] Failed to start:', error);
        process.exit(1);
    }
}

startServer();
