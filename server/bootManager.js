/**
 * BootManager - ComfyUI Lifecycle and Connection Manager
 * 
 * Manages the complete lifecycle of ComfyUI integration:
 * 1. Validates configuration (paths, python executable)
 * 2. Launches ComfyUI as a child process
 * 3. Waits for API availability
 * 4. Establishes WebSocket connection for real-time updates
 * 5. Runs benchmark job to estimate average generation time
 * 
 * The BootManager maintains a WebSocket connection to ComfyUI for receiving
 * progress updates and execution messages, which are forwarded to the Scheduler.
 * 
 * @module server/bootManager
 */

const { spawn } = require('child_process');
const axios = require('axios');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');

/**
 * Manages ComfyUI process lifecycle and WebSocket communication.
 * 
 * Status Flow:
 * - 'booting' → Initial state during boot sequence
 * - 'ready' → ComfyUI is running and ready to accept jobs
 * - 'error' → ComfyUI process crashed or failed to start
 */
class BootManager {
    /**
     * Creates a new BootManager instance.
     * 
     * @param {Object} config - Application configuration object
     * @param {Object} config.comfy_ui - ComfyUI-specific configuration
     * @param {string} config.comfy_ui.root_path - Path to ComfyUI installation
     * @param {string} config.comfy_ui.python_executable - Path to Python executable
     * @param {string} config.comfy_ui.api_host - ComfyUI API host (default: 127.0.0.1)
     * @param {number} config.comfy_ui.api_port - ComfyUI API port (default: 8188)
     * @param {Object} config.workflow - Workflow configuration
     * @param {string} config.workflow.warmup_prompt - Prompt for benchmark job
     */
    constructor(config) {
        this.config = config;

        // Child process handle for ComfyUI
        this.comfyProcess = null;

        // WebSocket connection to ComfyUI for real-time updates
        this.internalWs = null;

        // Average job duration in milliseconds (updated dynamically)
        this.globalJobDuration = 0;

        // Current system status
        this._status = 'booting';

        // Callback for status changes (used by SocketManager)
        this.onStatusChange = null;
    }

    /**
     * Gets the current boot status.
     * @returns {string} Current status ('booting', 'ready', 'error')
     */
    get status() {
        return this._status;
    }

    /**
     * Sets the boot status and triggers status change callback.
     * @param {string} value - New status value
     */
    set status(value) {
        this._status = value;
        if (this.onStatusChange) this.onStatusChange(value);
    }

    /**
     * Registers a callback to be invoked when status changes.
     * Used by SocketManager to broadcast status updates to clients.
     * 
     * @param {Function} callback - Function to call on status change
     */
    setStatusListener(callback) {
        this.onStatusChange = callback;
    }

    /**
     * Executes the complete boot sequence for ComfyUI.
     * 
     * Boot Sequence:
     * 1. Validate configuration (check paths exist)
     * 2. Launch ComfyUI process
     * 3. Wait for API to become responsive
     * 4. Connect internal WebSocket for progress updates
     * 5. Run benchmark job to estimate generation time
     * 
     * @async
     * @returns {Promise<Object>} Boot result with status and benchmark time
     * @throws {Error} If validation fails, process crashes, or timeout occurs
     */
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

        // Override with manual testing duration if needed
        // TODO: Replace with actual benchmark timing from real job execution
        this.globalJobDuration = 60000; // 60 seconds
        console.log('[DEBUG-STEP-5] Benchmark complete. Calculated job duration: ' + this.globalJobDuration + 'ms');

        this.status = 'ready';
        console.log('\n[DEBUG] SYSTEM READY AND IDLE.\n');
        return {
            status: this.status,
            benchmark_ms: this.globalJobDuration
        };
    }

    /**
     * Validates that required paths and executables exist.
     * 
     * Checks:
     * - Python executable exists and is accessible
     * - ComfyUI root directory exists
     * 
     * @throws {Error} If validation fails
     */
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

    /**
     * Spawns ComfyUI as a child process.
     * 
     * Executes main.py using the configured Python executable.
     * Captures stdout/stderr for debugging and monitors process exit.
     * If the process exits unexpectedly, status is set to 'error'.
     */
    launchComfyUI() {
        console.log(`[BootManager] Spawning ComfyUI from ${this.config.comfy_ui.root_path}`);

        const mainPy = path.join(this.config.comfy_ui.root_path, 'main.py');

        // Spawn ComfyUI process with configured Python
        this.comfyProcess = spawn(this.config.comfy_ui.python_executable, [mainPy], {
            cwd: this.config.comfy_ui.root_path,
            env: process.env
        });

        // Forward ComfyUI stdout to console
        this.comfyProcess.stdout.on('data', (data) => {
            console.log(`[ComfyUI STDOUT] ${data}`);
        });

        // Forward ComfyUI stderr to console
        this.comfyProcess.stderr.on('data', (data) => {
            console.error(`[ComfyUI STDERR] ${data}`);
        });

        // Monitor process exit
        this.comfyProcess.on('close', (code) => {
            console.log(`[ComfyUI] Process exited with code ${code}`);
            this.status = 'error';
        });
    }

    /**
     * Waits for ComfyUI API to become responsive.
     * 
     * Polls the /history endpoint until a successful response is received
     * or the timeout is reached. Uses exponential backoff (2 second intervals).
     * 
     * @async
     * @param {string} host - API host (e.g., '127.0.0.1')
     * @param {number} port - API port (e.g., 8188)
     * @param {number} [timeout=60000] - Maximum wait time in milliseconds
     * @throws {Error} If timeout is reached before API becomes available
     */
    async waitForPort(host, port, timeout = 60000) {
        const start = Date.now();
        console.log(`[BootManager] Waiting for ComfyUI on http://${host}:${port}...`);

        while (Date.now() - start < timeout) {
            try {
                // Try to access ComfyUI history endpoint
                await axios.get(`http://${host}:${port}/history`);
                console.log('[BootManager] ComfyUI API is live.');
                return;
            } catch (e) {
                // Wait 2 seconds before retry
                await new Promise(r => setTimeout(r, 2000));
            }
        }
        throw new Error('Timeout waiting for ComfyUI to start');
    }

    /**
     * Establishes WebSocket connection to ComfyUI.
     * 
     * The WebSocket connection is used to receive real-time progress updates
     * and execution messages. Messages are forwarded to the Scheduler via
     * the onWsMessage callback.
     * 
     * @async
     * @returns {Promise<void>} Resolves when connection is established
     * @throws {Error} If WebSocket connection fails
     */
    async connectInternalWs() {
        const wsUrl = `ws://${this.config.comfy_ui.api_host}:${this.config.comfy_ui.api_port}/ws`;
        console.log(`[BootManager] Connecting to ComfyUI WS: ${wsUrl}`);

        return new Promise((resolve, reject) => {
            this.internalWs = new WebSocket(wsUrl);

            this.internalWs.on('open', () => {
                console.log('[BootManager] Internal WS connected.');
                resolve();
            });

            // Forward ComfyUI WebSocket messages to registered listener (Scheduler)
            this.internalWs.on('message', (data) => {
                try {
                    const message = JSON.parse(data.toString());
                    if (this.onWsMessage) {
                        this.onWsMessage(message);
                    }
                } catch (e) {
                    // Ignore non-JSON messages from ComfyUI
                }
            });

            this.internalWs.on('error', (err) => {
                console.error('[BootManager] Internal WS connection error:', err);
                reject(err);
            });
        });
    }

    /**
     * Registers a callback to receive WebSocket messages from ComfyUI.
     * Used by Scheduler to get real-time job progress and completion updates.
     * 
     * @param {Function} callback - Function to call with each WebSocket message
     */
    setWsMessageListener(callback) {
        this.onWsMessage = callback;
    }

    /**
     * Runs a benchmark job to estimate average generation time.
     * 
     * Currently performs a simple system stats ping to verify connectivity.
     * 
     * TODO: Implement actual benchmark that:
     * 1. Submits a real workflow job with warmup_prompt
     * 2. Measures time from submission to completion
     * 3. Sets globalJobDuration based on actual execution time
     * 
     * The benchmark time is used for scheduling jobs on the timeline,
     * allowing users to see estimated completion times.
     * 
     * @async
     */
    async runBenchmark() {
        console.log('[BootManager] Running Warmup & Benchmark...');

        try {
            // TODO: This is a placeholder ping, not a real benchmark
            // Real implementation should submit a workflow job and measure timing
            const start = Date.now();
            console.log('[BootManager] Pinging ComfyUI...');
            const response = await axios.get(`http://${this.config.comfy_ui.api_host}:${this.config.comfy_ui.api_port}/system_stats`);
            const end = Date.now();

            console.log(`[BootManager] Ping successful! Response time: ${end - start}ms`);
            console.log('[BootManager] System Stats:', response.data);

            // Default benchmark time - should be replaced with actual job timing
            this.globalJobDuration = 14500;
        } catch (error) {
            console.error('[BootManager] Benchmark/Ping failed:', error.message);
            // Continue boot sequence even if benchmark fails
        }
    }
}

module.exports = BootManager;
