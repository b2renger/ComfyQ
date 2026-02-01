/**
 * Scheduler - Job Queue Management and Execution
 * 
 * Manages the lifecycle of scheduled ComfyUI workflow jobs:
 * - Validates time slots to prevent collisions
 * - Executes jobs sequentially based on scheduled time
 * - Maps user parameters into workflow templates
 * - Tracks progress via ComfyUI WebSocket messages
 * - Handles job completion and result extraction
 * 
 * Job State Machine:
 * - 'scheduled' → Job added to queue, waiting for time slot
 * - 'processing' → Job submitted to ComfyUI, actively generating
 * - 'completed' → Generation finished, result available
 * - 'failed' → Error during execution
 * 
 * @module server/scheduler
 */

const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const axios = require('axios');

/**
 * Manages job scheduling, collision detection, and execution on ComfyUI.
 * 
 * The scheduler ensures only one job runs at a time and prevents time slot
 * overlaps by calculating job duration from the BootManager's benchmark.
 */
class Scheduler {
    /**
     * Creates a new Scheduler instance.
     * 
     * @param {BootManager} bootManager - BootManager instance for ComfyUI communication
     */
    constructor(bootManager) {
        this.bootManager = bootManager;

        // Array of all jobs (scheduled, processing, completed, failed)
        this.jobs = [];

        // Whether the scheduler is currently processing a job
        this.isWorkerIdle = true;

        // ComfyUI prompt_id for the currently executing job
        this.currentJobPromptId = null;

        // Reference to the job currently being processed
        this.currentExecutingJob = null;

        // Last time progress was reported (for debugging)
        this.lastProgressTime = null;

        // Callback for state updates (triggers broadcast to clients)
        this.onUpdate = null;

        // Subscribe to ComfyUI WebSocket messages for progress updates
        this.bootManager.setWsMessageListener((msg) => {
            this.handleComfyWsMessage(msg);
        });

        // Start the scheduling loop
        this.startLoop();
    }

    /**
     * Registers a callback to be invoked when any job state changes.
     * Used by SocketManager to broadcast updates to all connected clients.
     * 
     * @param {Function} callback - Function to call on state change
     */
    setUpdateListener(callback) {
        this.onUpdate = callback;
    }

    /**
     * Processes WebSocket messages from ComfyUI.
     * 
     * Listens for two message types:
     * - 'progress': Updates job progress bar (e.g., "15/20 steps complete")
     * - 'executing': Updates which node is currently being processed
     * 
     * Only updates the currently executing job; ignores messages for
     * other jobs or benchmarks.
     * 
     * @param {Object} msg - WebSocket message from ComfyUI
     * @param {string} msg.type - Message type ('progress', 'executing', etc.)
     * @param {Object} msg.data - Message payload
     */
    handleComfyWsMessage(msg) {
        if (!this.currentExecutingJob) return;

        const { type, data } = msg;

        if (type === 'progress') {
            // Update progress bar if message is for current job
            const isMatch = data.prompt_id === this.currentJobPromptId;
            if (isMatch) {
                this.currentExecutingJob.progress = {
                    value: data.value,
                    max: data.max
                };
                if (this.onUpdate) this.onUpdate();
            }
        } else if (type === 'executing') {
            // Track which node is currently being processed
            if (data.prompt_id === this.currentJobPromptId) {
                this.currentExecutingJob.current_node = data.node;
                if (this.onUpdate) this.onUpdate();
            }
        }
    }

    /**
     * Adds a new job to the scheduling queue.
     * 
     * Performs collision detection to ensure the new job doesn't overlap
     * with existing jobs. Jobs occupy a time slot from scheduledTime to
     * scheduledTime + globalJobDuration.
     * 
     * Collision Detection:
     * Two jobs collide if their time ranges overlap. For jobs A and B:
     * - A.start < B.end AND A.end > B.start = collision
     * 
     * @param {string} userId - User who scheduled the job
     * @param {number} scheduledTime - Timestamp when job should start (ms since epoch)
     * @param {string} prompt - Text prompt for generation
     * @param {Object} params - Additional workflow parameters (seed, steps, etc.)
     * @returns {Object} The created job object
     * @throws {Error} If time slot collision is detected
     */
    addJob(userId, scheduledTime, prompt, params = {}) {
        const duration = this.bootManager.globalJobDuration;
        const endTime = scheduledTime + duration;

        // Check for overlapping time slots
        const hasCollision = this.jobs.some(job => {
            const jobStart = job.time_slot;
            const jobEnd = jobStart + duration;
            // Two ranges overlap if: (start1 < end2) AND (end1 > start2)
            return (scheduledTime < jobEnd) && (endTime > jobStart);
        });

        if (hasCollision) {
            throw new Error('Time slot collision detected');
        }

        // Create new job with unique ID
        const newJob = {
            id: uuidv4(),
            user_id: userId,
            status: 'scheduled',
            time_slot: scheduledTime,
            prompt: prompt,
            params: params,
            result_filename: null,  // Set after completion
            progress: null,         // Set during execution
            s_it: null              // Iteration timing (optional)
        };

        this.jobs.push(newJob);
        return newJob;
    }

    /**
     * Starts the main scheduler loop.
     * 
     * Checks every second for jobs that are ready to execute.
     * This ensures jobs start promptly when their scheduled time arrives.
     */
    startLoop() {
        setInterval(() => {
            this.checkAndExecute();
        }, 1000);
    }

    /**
     * Checks for pending jobs and executes the next one if ready.
     * 
     * Execution Flow:
     * 1. Skip if a job is already running (only one job at a time)
     * 2. Find first job where: status='scheduled' AND scheduledTime <= now
     * 3. Mark worker as busy and execute the job
     * 4. Clean up state when job completes (success or failure)
     * 
     * @async
     */
    async checkAndExecute() {
        // Only one job can run at a time
        if (!this.isWorkerIdle) return;

        const now = Date.now();
        const pendingJob = this.jobs.find(job => job.status === 'scheduled' && now >= job.time_slot);

        if (pendingJob) {
            // Mark worker as busy and track current job
            this.isWorkerIdle = false;
            this.currentExecutingJob = pendingJob;
            this.lastProgressTime = null;

            try {
                await this.executeJob(pendingJob);
            } catch (err) {
                console.error(`[Scheduler] Execution error:`, err);
            } finally {
                // Clean up state when job finishes
                this.isWorkerIdle = true;
                this.currentJobPromptId = null;
                this.currentExecutingJob = null;
            }
        }
    }

    /**
     * Executes a job by submitting it to ComfyUI.
     * 
     * Execution Steps:
     * 1. Mark job as 'processing' and initialize progress
     * 2. Load workflow template from config
     * 3. Map user parameters into workflow nodes
     * 4. Inject unique filename prefix for output files
     * 5. Submit prompt to ComfyUI via /prompt endpoint
     * 6. Poll /history endpoint until job completes
     * 7. Extract result filename from outputs
     * 8. Mark job as 'completed' or 'failed'
     * 
     * Parameter Mapping:
     * The parameter_map in config defines how user inputs map to workflow nodes.
     * Example: { "seed_123": { node_id: "3", field: "seed" } }
     * This would set template["3"].inputs["seed"] = job.params["seed_123"]
     * 
     * Output Naming:
     * Files are saved with format: USERNAME_YYYYMMDD_HHMMSS
     * Examples: "Alice_20260201_143052.png", "Bob_20260201_150030_00001.png"
     * 
     * @async
     * @param {Object} job - Job object to execute
     * @throws {Error} If template loading fails or execution times out
     */
    async executeJob(job) {
        job.status = 'processing';
        job.progress = { value: 0, max: job.params.steps || 20 };
        if (this.onUpdate) this.onUpdate();

        try {
            const config = this.bootManager.config;
            const apiBase = `http://${config.comfy_ui.api_host}:${config.comfy_ui.api_port}`;

            // Create unique filename prefix: USERNAME_YYYYMMDD_HHMMSS
            const scheduledDate = new Date(job.time_slot);
            const timestamp = scheduledDate.getFullYear().toString() +
                (scheduledDate.getMonth() + 1).toString().padStart(2, '0') +
                scheduledDate.getDate().toString().padStart(2, '0') + '_' +
                scheduledDate.getHours().toString().padStart(2, '0') +
                scheduledDate.getMinutes().toString().padStart(2, '0') +
                scheduledDate.getSeconds().toString().padStart(2, '0');
            const filePrefix = `${job.user_id}_${timestamp}`;

            let promptData = {};
            try {
                // Load workflow template
                const template = JSON.parse(fs.readFileSync(config.workflow.template_file, 'utf8'));

                // Inject user parameters into workflow nodes
                // Iterates through parameter_map and replaces values in template
                for (const [key, mappingOrMappings] of Object.entries(config.workflow.parameter_map)) {
                    let value = (key === 'prompt') ? job.prompt : job.params[key];

                    if (value !== undefined && value !== null) {
                        const mappings = Array.isArray(mappingOrMappings) ? mappingOrMappings : [mappingOrMappings];
                        for (const mapping of mappings) {
                            const { node_id, field } = mapping;
                            if (template[node_id]) {
                                if (!template[node_id].inputs) template[node_id].inputs = {};
                                template[node_id].inputs[field] = value;
                            }
                        }
                    }
                }

                // Inject dynamic filename prefix into Save nodes (Image/Video)
                for (const nodeId in template) {
                    const node = template[nodeId];
                    if (['SaveImage', 'SaveVideo', 'VHS_VideoCombine'].includes(node.class_type)) {
                        if (!node.inputs) node.inputs = {};
                        node.inputs.filename_prefix = filePrefix;
                    }
                }
                promptData = template;

            } catch (e) {
                console.error(`[Scheduler] Template Error: ${e.message}`);
                // Simple fallback in case of catastrophic workflow failure
                promptData = {
                    "3": { "class_type": "KSampler", "inputs": { "seed": Math.floor(Math.random() * 1000000), "steps": 20, "cfg": 1, "sampler_name": "euler", "scheduler": "simple", "denoise": 1, "model": ["4", 0], "positive": ["6", 0], "negative": ["7", 0], "latent_image": ["5", 0] } },
                    "4": { "class_type": "CheckpointLoaderSimple", "inputs": { "ckpt_name": "flux1-dev-fp8.safetensors" } },
                    "5": { "class_type": "EmptyLatentImage", "inputs": { "width": 1024, "height": 1024, "batch_size": 1 } },
                    "6": { "class_type": "CLIPTextEncode", "inputs": { "text": job.prompt, "clip": ["4", 1] } },
                    "7": { "class_type": "CLIPTextEncode", "inputs": { "text": "", "clip": ["4", 1] } },
                    "8": { "class_type": "VAEDecode", "inputs": { "samples": ["3", 0], "vae": ["4", 2] } },
                    "9": { "class_type": "SaveImage", "inputs": { "filename_prefix": filePrefix, "images": ["8", 0] } }
                };
            }

            // Submit to ComfyUI
            const response = await axios.post(`${apiBase}/prompt`, {
                prompt: promptData,
                client_id: 'comfy_scheduler'
            });

            this.currentJobPromptId = response.data.prompt_id;
            const promptId = this.currentJobPromptId;

            // Poll history for completion
            let completed = false;
            let attempts = 0;
            const maxAttempts = 600; // Increased timeout for potentially long generations

            while (!completed && attempts < maxAttempts) {
                attempts++;
                try {
                    const history = await axios.get(`${apiBase}/history/${promptId}`);
                    if (history.data[promptId]) {
                        const outputs = history.data[promptId].outputs;
                        for (const nodeId in outputs) {
                            const output = outputs[nodeId];
                            // Support for both images and videos (via VHS_VideoCombine or SaveVideo)
                            if (output.images?.[0]) {
                                job.result_filename = output.images[0].filename;
                                break;
                            } else if (output.gifs?.[0]) {
                                job.result_filename = output.gifs[0].filename;
                                break;
                            }
                        }
                        completed = true;
                    }
                } catch (pe) { /* Wait and retry */ }

                if (!completed) await new Promise(r => setTimeout(r, 1000));
            }

            if (!completed) throw new Error('Job timed out in ComfyUI history');

            job.status = 'completed';
            job.progress = { value: 100, max: 100 };
            if (this.onUpdate) this.onUpdate();
        } catch (error) {
            console.error(`[Scheduler] Job execution failed:`, error.message);
            job.status = 'failed';
            if (this.onUpdate) this.onUpdate();
        }
    }

    /**
     * Removes a job from the internal list.
     */
    deleteJob(jobId) {
        const index = this.jobs.findIndex(j => j.id === jobId);
        if (index !== -1) {
            this.jobs.splice(index, 1);
            if (this.onUpdate) this.onUpdate();
        }
    }

    /**
     * Moves a job to a new time slot with collision validation.
     */
    reorderJob(jobId, newTimeSlot) {
        const job = this.jobs.find(j => j.id === jobId);
        if (!job) return;

        const duration = this.bootManager.globalJobDuration;
        const endTime = newTimeSlot + duration;

        const collision = this.jobs.some(j => {
            if (j.id === jobId) return false;
            return (newTimeSlot < j.time_slot + duration) && (endTime > j.time_slot);
        });

        if (collision) throw new Error('Time slot collision');

        job.time_slot = newTimeSlot;
        if (this.onUpdate) this.onUpdate();
    }

    /**
     * @returns {Array} All active and completed jobs.
     */
    getJobs() {
        return this.jobs;
    }
}

module.exports = Scheduler;
