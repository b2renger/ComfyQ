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

    async getHistory(promptId) {
        const r = await this.http.get(`/history/${promptId}`);
        return r.data; // { [promptId]: { outputs: { [nodeId]: {...} }, status: {...} } }
    }

    async interrupt() {
        await this.http.post('/interrupt');
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

    async uploadImage(buffer, filename, { subfolder = '', overwrite = '1' } = {}) {
        const FormData = require('form-data');
        const fd = new FormData();
        fd.append('image', buffer, { filename });
        fd.append('subfolder', subfolder);
        fd.append('overwrite', overwrite);
        const r = await this.http.post('/upload/image', fd, { headers: fd.getHeaders() });
        return r.data;
    }
}

module.exports = { ComfyRestClient };
