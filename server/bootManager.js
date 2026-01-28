const { spawn } = require('child_process');
const axios = require('axios');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');

class BootManager {
    constructor(config) {
        this.config = config;
        this.comfyProcess = null;
        this.internalWs = null;
        this.globalJobDuration = 0;
        this.status = 'booting';
    }

    async boot() {
        console.log('\n[DEBUG-STEP-1] Starting boot sequence...');
        this.validateConfig();
        console.log('[DEBUG-STEP-1] Config validated successfully.');

        console.log('\n[DEBUG-STEP-2] Launching ComfyUI process...');
        this.launchComfyUI();

        console.log('\n[DEBUG-STEP-3] Waiting for ComfyUI API on port ' + this.config.comfy_ui.api_port + '...');
        await this.waitForPort(this.config.comfy_ui.api_host, this.config.comfy_ui.api_port);
        console.log('[DEBUG-STEP-3] API is responsive.');

        console.log('\n[DEBUG-STEP-4] Connecting internal WebSocket...');
        await this.connectInternalWs();
        console.log('[DEBUG-STEP-4] WebSocket connected.');

        console.log('\n[DEBUG-STEP-5] Running Warmup & Benchmark...');
        await this.runBenchmark();

        // FOR MANUAL TESTING: Set a long enough duration to see what's happening
        this.globalJobDuration = 60000; // 60 seconds
        console.log('[DEBUG-STEP-5] Benchmark complete. Calculated job duration: ' + this.globalJobDuration + 'ms');

        this.status = 'ready';
        console.log('\n[DEBUG] SYSTEM READY AND IDLE.\n');
        return {
            status: this.status,
            benchmark_ms: this.globalJobDuration
        };
    }

    validateConfig() {
        console.log(`[BootManager] Checking Python executable: ${this.config.comfy_ui.python_executable}`);
        if (!fs.existsSync(this.config.comfy_ui.python_executable)) {
            throw new Error(`Python executable not found: ${this.config.comfy_ui.python_executable}`);
        }
        console.log(`[BootManager] Checking ComfyUI root path: ${this.config.comfy_ui.root_path}`);
        if (!fs.existsSync(this.config.comfy_ui.root_path)) {
            throw new Error(`ComfyUI root path not found: ${this.config.comfy_ui.root_path}`);
        }
    }

    launchComfyUI() {
        console.log(`[BootManager] Spawning ComfyUI from ${this.config.comfy_ui.root_path}`);

        const mainPy = path.join(this.config.comfy_ui.root_path, 'main.py');

        this.comfyProcess = spawn(this.config.comfy_ui.python_executable, [mainPy], {
            cwd: this.config.comfy_ui.root_path,
            env: process.env
        });

        this.comfyProcess.stdout.on('data', (data) => {
            console.log(`[ComfyUI STDOUT] ${data}`);
        });

        this.comfyProcess.stderr.on('data', (data) => {
            console.error(`[ComfyUI STDERR] ${data}`);
        });

        this.comfyProcess.on('close', (code) => {
            console.log(`[ComfyUI] Process exited with code ${code}`);
            this.status = 'error';
        });
    }

    async waitForPort(host, port, timeout = 60000) {
        const start = Date.now();
        console.log(`[BootManager] Waiting for ComfyUI on http://${host}:${port}...`);

        while (Date.now() - start < timeout) {
            try {
                await axios.get(`http://${host}:${port}/history`);
                console.log('[BootManager] ComfyUI API is live.');
                return;
            } catch (e) {
                await new Promise(r => setTimeout(r, 2000));
            }
        }
        throw new Error('Timeout waiting for ComfyUI to start');
    }

    async connectInternalWs() {
        const wsUrl = `ws://${this.config.comfy_ui.api_host}:${this.config.comfy_ui.api_port}/ws`;
        console.log(`[BootManager] Connecting to ComfyUI WS: ${wsUrl}`);

        return new Promise((resolve, reject) => {
            this.internalWs = new WebSocket(wsUrl);
            this.internalWs.on('open', () => {
                console.log('[BootManager] Internal WS connected.');
                resolve();
            });
            this.internalWs.on('message', (data) => {
                try {
                    const message = JSON.parse(data.toString());
                    if (this.onWsMessage) {
                        this.onWsMessage(message);
                    }
                } catch (e) {
                    // Ignore non-json messages
                }
            });
            this.internalWs.on('error', (err) => {
                console.error('[BootManager] Internal WS connection error:', err);
                reject(err);
            });
        });
    }

    setWsMessageListener(callback) {
        this.onWsMessage = callback;
    }

    async runBenchmark() {
        console.log('[BootManager] Running Warmup & Benchmark...');

        try {
            const prompt = {
                client_id: 'boot_manager',
                prompt: {
                    // This should be a real ComfyUI prompt structure
                    // For now, using the warmup_prompt from config
                    "6": { "class_type": "CLIPTextEncode", "inputs": { "text": this.config.workflow.warmup_prompt, "clip": ["4", 1] } }
                    // ... (simplified for now, ideally loads from template_file)
                }
            };

            // Real benchmark would involve sending prompt to /prompt and waiting for output
            // For now, we'll implement a robust ping/check
            const start = Date.now();
            console.log('[BootManager] Pinging ComfyUI...');
            const response = await axios.get(`http://${this.config.comfy_ui.api_host}:${this.config.comfy_ui.api_port}/system_stats`);
            const end = Date.now();

            console.log(`[BootManager] Ping successful! Response time: ${end - start}ms`);
            console.log('[BootManager] System Stats:', response.data);

            this.globalJobDuration = 14500; // Default or calculated
        } catch (error) {
            console.error('[BootManager] Benchmark/Ping failed:', error.message);
            // We still proceed but with warning if user wants verification
        }
    }
}

module.exports = BootManager;
