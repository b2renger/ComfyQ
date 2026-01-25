const { v4: uuidv4 } = require('uuid');

class Scheduler {
    constructor(bootManager) {
        this.bootManager = bootManager;
        this.jobs = [];
        this.isWorkerIdle = true;
        this.currentJobPromptId = null;
        this.currentExecutingJob = null;
        this.lastProgressTime = null;
        this.onUpdate = null;

        this.bootManager.setWsMessageListener((msg) => {
            this.handleComfyWsMessage(msg);
        });

        this.startLoop();
    }

    setUpdateListener(callback) {
        this.onUpdate = callback;
    }

    handleComfyWsMessage(msg) {
        if (!this.currentExecutingJob) return;

        const { type, data } = msg;

        if (type === 'progress') {
            const isMatch = data.prompt_id === this.currentJobPromptId;
            console.log(`[Scheduler] Progress: ${data.value}/${data.max} for prompt ${data.prompt_id} (Match: ${isMatch})`);

            if (isMatch) {
                this.currentExecutingJob.progress = {
                    value: data.value,
                    max: data.max
                };
                if (this.onUpdate) this.onUpdate();
            }
        } else if (type === 'executing') {
            if (data.prompt_id === this.currentJobPromptId) {
                console.log(`[Scheduler] Executing node: ${data.node}`);
                this.currentExecutingJob.current_node = data.node;
                if (this.onUpdate) this.onUpdate();
            }
        }
    }

    addJob(userId, scheduledTime, prompt, params = {}) {
        const duration = this.bootManager.globalJobDuration;
        const endTime = scheduledTime + duration;

        const hasCollision = this.jobs.some(job => {
            const jobStart = job.time_slot;
            const jobEnd = jobStart + duration;
            return (scheduledTime <= jobEnd) && (endTime >= jobStart);
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

    startLoop() {
        setInterval(() => {
            this.checkAndExecute();
        }, 1000);
    }

    async checkAndExecute() {
        if (!this.isWorkerIdle) return;

        const now = Date.now();
        const pendingJob = this.jobs.find(job => job.status === 'scheduled' && now >= job.time_slot);

        if (pendingJob) {
            this.isWorkerIdle = false;
            this.currentExecutingJob = pendingJob;
            this.lastProgressTime = null;
            await this.executeJob(pendingJob);
            this.isWorkerIdle = true;
            this.currentJobPromptId = null;
            this.currentExecutingJob = null;
        }
    }

    async executeJob(job) {
        job.status = 'processing';
        job.progress = { value: 0, max: job.params.steps || 20 };
        if (this.onUpdate) this.onUpdate();

        try {
            const config = this.bootManager.config;
            const apiBase = `http://${config.comfy_ui.api_host}:${config.comfy_ui.api_port}`;

            let promptData = {};

            // Format: USERNAME_YYYYMMDD_HHMMSS
            const scheduledDate = new Date(job.time_slot);
            const timestamp = scheduledDate.getFullYear().toString() +
                (scheduledDate.getMonth() + 1).toString().padStart(2, '0') +
                scheduledDate.getDate().toString().padStart(2, '0') + '_' +
                scheduledDate.getHours().toString().padStart(2, '0') +
                scheduledDate.getMinutes().toString().padStart(2, '0') +
                scheduledDate.getSeconds().toString().padStart(2, '0');
            const filePrefix = `${job.user_id}_${timestamp}`;

            try {
                const fs = require('fs');
                const template = JSON.parse(fs.readFileSync(config.workflow.template_file, 'utf8'));

                for (const [key, mappingOrMappings] of Object.entries(config.workflow.parameter_map)) {
                    let value = null;
                    if (key === 'prompt') value = job.prompt;
                    else value = job.params[key];

                    if (value !== undefined && value !== null) {
                        const mappings = Array.isArray(mappingOrMappings) ? mappingOrMappings : [mappingOrMappings];

                        for (const mapping of mappings) {
                            const { node_id, field } = mapping;
                            if (template[node_id]) {
                                if (!template[node_id].inputs) template[node_id].inputs = {};
                                template[node_id].inputs[field] = value;
                                console.log(`[Scheduler] Applied ${key}=${value} to node ${node_id}.${field}`);
                            }
                        }
                    }
                }

                // Inject filename prefix into any SaveImage node found in template
                for (const nodeId in template) {
                    if (template[nodeId].class_type === 'SaveImage') {
                        if (!template[nodeId].inputs) template[nodeId].inputs = {};
                        template[nodeId].inputs.filename_prefix = filePrefix;
                    }
                }

                promptData = template;

            } catch (e) {
                console.error(`[DEBUG-MAPPING] ERROR: ${e.message}`);
                promptData = {
                    "3": { "class_type": "KSampler", "inputs": { "seed": Math.floor(Math.random() * 1000000), "steps": job.params.steps || 20, "cfg": job.params.cfg || 5, "sampler_name": "euler", "scheduler": "normal", "denoise": 1, "model": ["4", 0], "positive": ["6", 0], "negative": ["7", 0], "latent_image": ["5", 0] } },
                    "4": { "class_type": "CheckpointLoaderSimple", "inputs": { "ckpt_name": "flux1-dev-fp8.safetensors" } },
                    "5": { "class_type": "EmptyLatentImage", "inputs": { "width": job.params.width || 512, "height": job.params.height || 512, "batch_size": 1 } },
                    "6": { "class_type": "CLIPTextEncode", "inputs": { "text": job.prompt, "clip": ["4", 1] } },
                    "7": { "class_type": "CLIPTextEncode", "inputs": { "text": "", "clip": ["4", 1] } },
                    "8": { "class_type": "VAEDecode", "inputs": { "samples": ["3", 0], "vae": ["4", 2] } },
                    "9": { "class_type": "SaveImage", "inputs": { "filename_prefix": filePrefix, "images": ["8", 0] } }
                };
            }

            console.log(`[Scheduler] Final Prompt Data: ${JSON.stringify(promptData, null, 2)}`);

            const axios = require('axios');
            const response = await axios.post(`${apiBase}/prompt`, {
                prompt: promptData,
                client_id: 'comfy_scheduler'
            });

            this.currentJobPromptId = response.data.prompt_id;
            const promptId = this.currentJobPromptId;

            let completed = false;
            let attempts = 0;
            const maxAttempts = 300;

            while (!completed && attempts < maxAttempts) {
                attempts++;
                try {
                    const history = await axios.get(`${apiBase}/history/${promptId}`);
                    if (history.data[promptId]) {
                        const outputs = history.data[promptId].outputs;
                        for (const nodeId in outputs) {
                            if (outputs[nodeId].images && outputs[nodeId].images[0]) {
                                job.result_filename = outputs[nodeId].images[0].filename;
                                break;
                            }
                        }
                        completed = true;
                    }
                } catch (pollError) { }

                if (!completed) await new Promise(r => setTimeout(r, 1000));
            }

            if (!completed) throw new Error('Job timed out or failed in ComfyUI');

            job.status = 'completed';
            job.progress = { value: 100, max: 100 };
            if (this.onUpdate) this.onUpdate();
        } catch (error) {
            console.error(`[Scheduler] Job ${job.id} failed:`, error.message || error);
            job.status = 'failed';
            if (this.onUpdate) this.onUpdate();
        }
    }

    getJobs() {
        return this.jobs;
    }
}

module.exports = Scheduler;
