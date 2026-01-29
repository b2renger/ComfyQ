const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const axios = require('axios');

/**
 * Scheduler manages the job queue, time slots, and execution on ComfyUI.
 * It ensures jobs are executed sequentially based on their scheduled time.
 */
class Scheduler {
    /**
     * @param {BootManager} bootManager - Handles ComfyUI lifecycle and WS communication
     */
    constructor(bootManager) {
        this.bootManager = bootManager;
        this.jobs = [];
        this.isWorkerIdle = true;
        this.currentJobPromptId = null;
        this.currentExecutingJob = null;
        this.lastProgressTime = null;
        this.onUpdate = null;

        // Listen for internal ComfyUI events via BootManager
        this.bootManager.setWsMessageListener((msg) => {
            this.handleComfyWsMessage(msg);
        });

        this.startLoop();
    }

    /**
     * Registers a callback for when job states change (e.g., progress, status update).
     */
    setUpdateListener(callback) {
        this.onUpdate = callback;
    }

    /**
     * Handles progress and execution messages from ComfyUI WS.
     */
    handleComfyWsMessage(msg) {
        if (!this.currentExecutingJob) return;

        const { type, data } = msg;

        if (type === 'progress') {
            const isMatch = data.prompt_id === this.currentJobPromptId;
            if (isMatch) {
                this.currentExecutingJob.progress = {
                    value: data.value,
                    max: data.max
                };
                if (this.onUpdate) this.onUpdate();
            }
        } else if (type === 'executing') {
            if (data.prompt_id === this.currentJobPromptId) {
                this.currentExecutingJob.current_node = data.node;
                if (this.onUpdate) this.onUpdate();
            }
        }
    }

    /**
     * Adds a new job to the queue if no time-slot collisions occur.
     */
    addJob(userId, scheduledTime, prompt, params = {}) {
        const duration = this.bootManager.globalJobDuration;
        const endTime = scheduledTime + duration;

        const hasCollision = this.jobs.some(job => {
            const jobStart = job.time_slot;
            const jobEnd = jobStart + duration;
            // Overlapping range check
            return (scheduledTime < jobEnd) && (endTime > jobStart);
        });

        if (hasCollision) {
            throw new Error('Time slot collision detected');
        }

        const newJob = {
            id: uuidv4(),
            user_id: userId,
            status: 'scheduled',
            time_slot: scheduledTime,
            prompt: prompt,
            params: params,
            result_filename: null,
            progress: null,
            s_it: null
        };

        this.jobs.push(newJob);
        return newJob;
    }

    /**
     * Starts the main scheduler loop.
     */
    startLoop() {
        setInterval(() => {
            this.checkAndExecute();
        }, 1000);
    }

    /**
     * Finds and executes the next pending job if time has passed.
     */
    async checkAndExecute() {
        if (!this.isWorkerIdle) return;

        const now = Date.now();
        const pendingJob = this.jobs.find(job => job.status === 'scheduled' && now >= job.time_slot);

        if (pendingJob) {
            this.isWorkerIdle = false;
            this.currentExecutingJob = pendingJob;
            this.lastProgressTime = null;

            try {
                await this.executeJob(pendingJob);
            } catch (err) {
                console.error(`[Scheduler] Execution error:`, err);
            } finally {
                this.isWorkerIdle = true;
                this.currentJobPromptId = null;
                this.currentExecutingJob = null;
            }
        }
    }

    /**
     * Executes a job by mapping parameters into the ComfyUI workflow template.
     */
    async executeJob(job) {
        job.status = 'processing';
        job.progress = { value: 0, max: job.params.steps || 20 };
        if (this.onUpdate) this.onUpdate();

        try {
            const config = this.bootManager.config;
            const apiBase = `http://${config.comfy_ui.api_host}:${config.comfy_ui.api_port}`;

            // Create unique filename: USERNAME_YYYYMMDD_HHMMSS
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
                const template = JSON.parse(fs.readFileSync(config.workflow.template_file, 'utf8'));

                // Inject user parameters into nodes via the parameter map
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
