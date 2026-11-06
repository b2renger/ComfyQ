const axios = require('axios');

class ComfyRestClient {
    constructor({ host, port }) {
        this.base = `http://${host}:${port}`;
        this.http = axios.create({ baseURL: this.base, timeout: 30000 });
    }

    async ping() {
        const r = await this.http.get('/system_stats');
        return r.data;
    }

    async submitPrompt(promptData, clientId) {
        const r = await this.http.post('/prompt', { prompt: promptData, client_id: clientId });
        return r.data; // { prompt_id, number, node_errors }
    }

    // Node schema for one class_type: { [classType]: { input: { required, optional } } }.
    // Used to check a combo/select value against what this ComfyUI actually
    // offers before a job is submitted — a bundle's meta.json can drift from
    // the installed node, and ComfyUI rejects the whole prompt when it does.
    async getObjectInfo(classType) {
        const r = await this.http.get(`/object_info/${encodeURIComponent(classType)}`);
        return r.data;
    }

    async getHistory(promptId) {
        const r = await this.http.get(`/history/${promptId}`);
        return r.data; // { [promptId]: { outputs: { [nodeId]: {...} }, status: {...} } }
    }

    // With a prompt id, stop THAT prompt only (ComfyUI ignores the call when
    // it is not the one running). Without one, ComfyUI stops whatever is
    // running — the admin emergency stop wants exactly that, a job's cancel
    // never does: with LAN access on, the run might be somebody else's.
    async interrupt(promptId) {
        if (promptId) await this.http.post('/interrupt', { prompt_id: promptId });
        else await this.http.post('/interrupt');
    }

    // Take prompts that have not started yet out of ComfyUI's queue.
    async deleteFromQueue(promptIds) {
        await this.http.post('/queue', { delete: promptIds });
    }

    async free({ unloadModels = true, freeMemory = true } = {}) {
        try {
            await this.http.post('/free', { unload_models: unloadModels, free_memory: freeMemory });
        } catch (e) {
            // /free was added in newer ComfyUI builds; missing endpoint is non-fatal.
            if (e.response?.status === 404) return;
            throw e;
        }
    }
}

module.exports = { ComfyRestClient };
