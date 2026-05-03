// WorkflowRegistry — discovers folder-bundled workflows under <workflowsDir>/<id>/
// Each bundle has:
//   <id>.api.json              ComfyUI API-format workflow (REQUIRED, validated)
//   <id>.meta.json             WorkflowMeta (REQUIRED for v2)
//   <id>.config.meta.json      Per-deployment overrides (OPTIONAL, written by admin UI)
//   <id>.runtime.json          BenchmarkService output (OPTIONAL, written at calibration)
//
// The registry caches results in-memory but invalidates a bundle when any of
// its files' mtimes change. No Litegraph auto-conversion: invalid format is
// surfaced as `unavailable: true` with a human-readable reason.

const fs = require('fs');
const path = require('path');
const { WorkflowMeta, WorkflowConfigMeta } = require('../config/schemas');
const { validateApiWorkflow } = require('./workflowValidator');

class WorkflowRegistry {
    constructor(workflowsDir) {
        this.dir = workflowsDir;
        this.cache = new Map();   // id → entry
        this.mtimes = new Map();  // id → Map<file, mtimeMs>
    }

    _bundlePaths(id) {
        const folder = path.join(this.dir, id);
        return {
            folder,
            apiPath: path.join(folder, `${id}.api.json`),
            metaPath: path.join(folder, `${id}.meta.json`),
            configMetaPath: path.join(folder, `${id}.config.meta.json`),
            runtimePath: path.join(folder, `${id}.runtime.json`)
        };
    }

    _readMtimes(paths) {
        const result = new Map();
        for (const p of Object.values(paths)) {
            if (typeof p !== 'string') continue;
            try {
                const st = fs.statSync(p);
                result.set(p, st.mtimeMs);
            } catch (e) {
                result.set(p, 0);
            }
        }
        return result;
    }

    _mtimesEqual(a, b) {
        if (!a || !b || a.size !== b.size) return false;
        for (const [k, v] of a) if (b.get(k) !== v) return false;
        return true;
    }

    _loadOne(id) {
        const paths = this._bundlePaths(id);
        const currentMtimes = this._readMtimes(paths);

        const cached = this.cache.get(id);
        if (cached && this._mtimesEqual(currentMtimes, this.mtimes.get(id))) {
            return cached;
        }

        const entry = { id, paths, unavailable: false, reason: null, summary: null };

        // meta.json
        if (!fs.existsSync(paths.metaPath)) {
            entry.unavailable = true;
            entry.reason = `Missing ${path.basename(paths.metaPath)}`;
            this.cache.set(id, entry);
            this.mtimes.set(id, currentMtimes);
            return entry;
        }
        let metaRaw;
        try { metaRaw = JSON.parse(fs.readFileSync(paths.metaPath, 'utf8')); }
        catch (e) {
            entry.unavailable = true;
            entry.reason = `Invalid JSON in ${path.basename(paths.metaPath)}: ${e.message}`;
            this.cache.set(id, entry); this.mtimes.set(id, currentMtimes);
            return entry;
        }
        const metaParse = WorkflowMeta.safeParse(metaRaw);
        if (!metaParse.success) {
            entry.unavailable = true;
            entry.reason = `Invalid meta.json: ${metaParse.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')}`;
            this.cache.set(id, entry); this.mtimes.set(id, currentMtimes);
            return entry;
        }
        const meta = metaParse.data;
        if (meta.id !== id) {
            entry.unavailable = true;
            entry.reason = `meta.json id "${meta.id}" does not match folder "${id}"`;
            this.cache.set(id, entry); this.mtimes.set(id, currentMtimes);
            return entry;
        }

        // api.json
        const apiPath = path.join(paths.folder, meta.workflowFile);
        if (!fs.existsSync(apiPath)) {
            entry.unavailable = true;
            entry.reason = `Missing workflow file: ${meta.workflowFile}`;
            this.cache.set(id, entry); this.mtimes.set(id, currentMtimes);
            return entry;
        }
        let apiJson;
        try { apiJson = JSON.parse(fs.readFileSync(apiPath, 'utf8')); }
        catch (e) {
            entry.unavailable = true;
            entry.reason = `Invalid JSON in ${meta.workflowFile}: ${e.message}`;
            this.cache.set(id, entry); this.mtimes.set(id, currentMtimes);
            return entry;
        }
        const validation = validateApiWorkflow(apiJson);
        if (!validation.valid) {
            entry.unavailable = true;
            entry.reason = validation.error;
            this.cache.set(id, entry); this.mtimes.set(id, currentMtimes);
            return entry;
        }

        // config.meta.json (optional)
        let configMeta = null;
        if (fs.existsSync(paths.configMetaPath)) {
            try {
                const raw = JSON.parse(fs.readFileSync(paths.configMetaPath, 'utf8'));
                const parsed = WorkflowConfigMeta.safeParse(raw);
                if (parsed.success && parsed.data.id === id) configMeta = parsed.data;
                else console.warn(`[Registry] ${id}: ignoring invalid config.meta.json`);
            } catch (e) {
                console.warn(`[Registry] ${id}: failed to read config.meta.json: ${e.message}`);
            }
        }

        // runtime.json (optional)
        let runtime = null;
        if (fs.existsSync(paths.runtimePath)) {
            try { runtime = JSON.parse(fs.readFileSync(paths.runtimePath, 'utf8')); }
            catch (e) { /* ignore */ }
        }

        // Merge meta + configMeta into effective parameters
        const merged = this._mergeMeta(meta, configMeta);

        const populated = {
            ...entry,
            unavailable: false,
            reason: null,
            meta,
            configMeta,
            runtime,
            apiWorkflow: apiJson,
            apiPath,
            // summary used by /admin/workflows list view
            summary: {
                id: meta.id,
                name: merged.name,
                description: merged.description,
                category: merged.category,
                tags: merged.tags,
                thumbnail: merged.thumbnail,
                estimatedDurationSec: runtime?.estimatedDurationSec ?? merged.estimatedDurationSec,
                samplesPerSec: runtime?.samplesPerSec ?? null,
                hasCalibration: !!runtime,
                presets: Object.keys(merged.presets || {}),
                parameterCount: merged.exposedParameters.filter(p => p.enabled !== false).length,
                hidden: merged.hidden === true
            },
            effective: merged
        };
        this.cache.set(id, populated);
        this.mtimes.set(id, currentMtimes);
        return populated;
    }

    _mergeMeta(meta, configMeta) {
        const overrides = configMeta?.parameterOverrides || {};
        const exposedParameters = meta.exposedParameters.map(p => {
            const o = overrides[p.key];
            if (!o) return { ...p, enabled: true };
            return {
                ...p,
                label: o.label ?? p.label,
                default: o.default !== undefined ? o.default : p.default,
                order: o.order ?? p.order,
                enabled: o.enabled !== undefined ? o.enabled : true
            };
        }).sort((a, b) => (a.order || 0) - (b.order || 0));
        return {
            ...meta,
            exposedParameters,
            warmupPrompt: configMeta?.warmupPromptOverride,
            hidden: configMeta?.hidden === true
        };
    }

    discover() {
        if (!fs.existsSync(this.dir)) {
            fs.mkdirSync(this.dir, { recursive: true });
            return [];
        }
        const entries = fs.readdirSync(this.dir, { withFileTypes: true })
            .filter(e => e.isDirectory());
        const seen = new Set();
        const results = [];
        for (const e of entries) {
            const entry = this._loadOne(e.name);
            seen.add(e.name);
            results.push(entry);
        }
        // Drop cache entries for folders that no longer exist
        for (const id of this.cache.keys()) if (!seen.has(id)) {
            this.cache.delete(id);
            this.mtimes.delete(id);
        }
        return results;
    }

    list({ includeUnavailable = true, includeHidden = false } = {}) {
        return this.discover().filter(e => {
            if (e.unavailable && !includeUnavailable) return false;
            if (e.summary?.hidden && !includeHidden) return false;
            return true;
        });
    }

    get(id) {
        if (!this.cache.has(id)) this._loadOne(id);
        return this._loadOne(id);
    }

    summaries(opts) {
        return this.list(opts).map(e => e.unavailable
            ? { id: e.id, unavailable: true, reason: e.reason }
            : e.summary);
    }

    writeRuntime(id, runtime) {
        const paths = this._bundlePaths(id);
        if (!fs.existsSync(paths.folder)) throw new Error(`Workflow folder missing: ${id}`);
        fs.writeFileSync(paths.runtimePath, JSON.stringify(runtime, null, 2), 'utf8');
        this.cache.delete(id);
        this.mtimes.delete(id);
    }

    writeConfigMeta(id, configMeta) {
        const paths = this._bundlePaths(id);
        if (!fs.existsSync(paths.folder)) throw new Error(`Workflow folder missing: ${id}`);
        const validated = WorkflowConfigMeta.parse({ ...configMeta, id });
        fs.writeFileSync(paths.configMetaPath, JSON.stringify(validated, null, 2), 'utf8');
        this.cache.delete(id);
        this.mtimes.delete(id);
    }
}

module.exports = { WorkflowRegistry };
