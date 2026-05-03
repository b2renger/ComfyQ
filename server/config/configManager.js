const fs = require('fs');
const path = require('path');
const { AppConfig } = require('./schemas');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const CONFIG_PATH = path.resolve(PROJECT_ROOT, 'config.json');

function defaultConfig() {
    return {
        schemaVersion: 2,
        mode: 'admin',
        server: { port: 3000, host: '0.0.0.0' },
        comfy_ui: {
            installation_type: 'portable',
            root_path: '',
            python_executable: '',
            output_dir: 'output',
            api_host: '127.0.0.1',
            api_port: 8188,
            autoStart: true,
            vramBudgetGb: 24
        },
        auth: { adminPasswordHash: '' },
        queue: {
            dbPath: './server/data/comfyq.sqlite',
            inputRetentionMinutes: 30,
            outputRetentionDays: 30
        },
        workflows: { dir: './workflows', activeWorkflowId: null }
    };
}

function load() {
    if (!fs.existsSync(CONFIG_PATH)) {
        const cfg = defaultConfig();
        save(cfg);
        return { config: cfg, fresh: true };
    }
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    let parsed;
    try { parsed = JSON.parse(raw); } catch (e) {
        console.warn('[Config] config.json is not valid JSON, starting fresh in admin mode');
        const cfg = defaultConfig();
        save(cfg);
        return { config: cfg, fresh: true };
    }
    // v1 → v2: detect old shape (no schemaVersion or schemaVersion !== 2) and reset to admin.
    if (parsed.schemaVersion !== 2) {
        console.warn('[Config] Detected v1 config.json (or unversioned). Archiving to config.json.v1.bak and starting fresh.');
        try {
            fs.renameSync(CONFIG_PATH, CONFIG_PATH + '.v1.bak');
        } catch (e) {
            console.warn('[Config] Failed to archive old config:', e.message);
        }
        const cfg = defaultConfig();
        save(cfg);
        return { config: cfg, fresh: true };
    }
    const result = AppConfig.safeParse(parsed);
    if (!result.success) {
        console.error('[Config] config.json failed validation:', result.error.issues);
        throw new Error('Invalid config.json — fix or delete it and restart.');
    }
    return { config: result.data, fresh: false };
}

function save(config) {
    const result = AppConfig.safeParse(config);
    if (!result.success) {
        console.error('[Config] Refusing to write invalid config:', result.error.issues);
        throw new Error('Invalid config object');
    }
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(result.data, null, 2), 'utf8');
}

function update(mutator) {
    const { config } = load();
    const next = mutator(JSON.parse(JSON.stringify(config))) || config;
    save(next);
    return next;
}

function setMode(mode) {
    return update(c => { c.mode = mode; return c; });
}

function setActiveWorkflow(workflowId) {
    return update(c => { c.workflows.activeWorkflowId = workflowId; return c; });
}

// Resolve all relative paths to absolute, given a (validated) config.
function resolvePaths(config) {
    const out = JSON.parse(JSON.stringify(config));
    const resolveRel = (p) => path.isAbsolute(p) ? p : path.resolve(PROJECT_ROOT, p);

    if (out.comfy_ui.root_path) {
        out.comfy_ui.root_path = resolveRel(out.comfy_ui.root_path);
        // Python executable: relative paths are relative to ComfyUI root (matches v1).
        if (out.comfy_ui.python_executable) {
            const py = out.comfy_ui.python_executable;
            if (!path.isAbsolute(py) && (py.startsWith('.') || py.includes(path.sep) || py.includes('/'))) {
                out.comfy_ui.python_executable = path.resolve(out.comfy_ui.root_path, py);
            }
        }
        // Output dir: relative paths are relative to ComfyUI root.
        if (out.comfy_ui.output_dir && !path.isAbsolute(out.comfy_ui.output_dir)) {
            out.comfy_ui.output_dir = path.resolve(out.comfy_ui.root_path, out.comfy_ui.output_dir);
        }
    }

    if (out.queue.dbPath) out.queue.dbPath = resolveRel(out.queue.dbPath);
    if (out.workflows.dir) out.workflows.dir = resolveRel(out.workflows.dir);
    return out;
}

module.exports = {
    CONFIG_PATH,
    PROJECT_ROOT,
    load,
    save,
    update,
    setMode,
    setActiveWorkflow,
    resolvePaths,
    defaultConfig
};
