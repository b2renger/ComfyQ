const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// Run the maintenance scripts from the admin panel instead of a console.
//
// These came from <nvme>\_maintenance and now live in tools/maintenance. They
// are still ordinary Python — nothing was rewritten to be callable — so this is
// a small, deliberate runner rather than a port.
//
// ★ A WHITELIST of named tasks, not "run this path". The request names a task
// key; the steps are fixed here. Taking a script path from a browser would make
// an admin-password-protected arbitrary-code endpoint out of a convenience
// button, and these run with ComfyUI's interpreter against the live install.
//
// ★ PYTHONIOENCODING=utf-8 on every step, which is not optional on this fleet:
// ComfyUI and these scripts print ✓ and other non-cp1252 characters, and
// Windows falls back to cp1252 the moment stdout is a pipe rather than a
// terminal — so a captured run dies with UnicodeEncodeError where the same
// command works by hand. That cost a debugging session once already.
//
// Mutating tasks are marked so the route can require the admin password and the
// UI can warn; a read-only task only ever rewrites the scan files it owns.

const TASKS = [
    {
        key: 'audit-rebuild',
        label: 'Rebuild the model audit',
        blurb: 'Re-scans the disk, the workflows and the node-pack source, then rebuilds'
            + ' model-audit.csv. Your ACTION column is preserved — build_csv.py reads the'
            + ' existing sheet back in. Needs ComfyUI running for the node list.',
        mutating: false,
        needsComfy: true,
        steps: [
            { kind: 'object-info', writes: 'model-audit/object_info.json' },
            { kind: 'python', script: 'model-audit/rescan.py', writes: 'model-audit/inventory.json' },
            { kind: 'python', script: 'model-audit/rescan_nodes.py', writes: 'model-audit/nodes.json' },
            { kind: 'python', script: 'model-audit/scan_links.py', writes: 'model-audit/links.json' },
            { kind: 'python', script: 'model-audit/build_csv.py', writes: 'model-audit/model-audit.csv' },
        ],
    },
    {
        key: 'audit-verify',
        label: 'Verify the model audit',
        blurb: 'Cross-checks model-audit.csv against the scan data and against what is'
            + ' really on disk. Reads only. Run it before acting on the sheet.',
        mutating: false,
        needsComfy: false,
        steps: [{ kind: 'python', script: 'model-audit/verify_audit.py' }],
    },
    {
        key: 'custom-node-fixes',
        label: 'Re-apply the custom-node fixes',
        blurb: 'Some node packs need a local fix to run on this ComfyUI. The patches live in the'
            + ' repo rather than only on this rig, so a cloned or rebuilt machine can be brought'
            + ' up to them. Safe to run twice — it says what was already in place, and it'
            + ' REFUSES loudly if a pack has changed under the patch instead of guessing.'
            + ' ⚠ It modifies custom_nodes, and ComfyUI must be restarted afterwards.',
        mutating: true,
        needsComfy: false,
        steps: [{ kind: 'python', script: 'fix_custom_node_patches.py' }],
    },
    {
        key: 'install-repair',
        label: 'Repair the ComfyUI install',
        blurb: 'Checks the portable install for the damage this fleet has hit before and'
            + ' repairs what it can. ⚠ It MODIFIES the install — read its output before'
            + ' trusting a green result, and remember this drive is cloned to other rigs.',
        mutating: true,
        needsComfy: false,
        steps: [{ kind: 'python', script: 'repair_all.py' }],
    },
    {
        key: 'portablize-paths',
        label: 'Make install paths portable',
        blurb: 'Rewrites absolute paths inside the install so it survives being mounted'
            + ' under a different drive letter. ⚠ It MODIFIES the install.',
        mutating: true,
        needsComfy: false,
        steps: [{ kind: 'python', script: 'portablize_paths.py' }],
    },
];

const MAINT_DIR = path.resolve(__dirname, '..', '..', 'tools', 'maintenance');

class ScriptRunner {
    /**
     * @param {object} opts
     * @param {() => object} opts.config   read fresh, so an edited path is honoured
     */
    constructor({ config }) {
        this._config = config;
        this._run = null;        // the one run in flight or last finished
        this._child = null;
    }

    tasks() {
        return TASKS.map(t => ({
            key: t.key, label: t.label, blurb: t.blurb,
            mutating: t.mutating, needsComfy: t.needsComfy,
            steps: t.steps.map(s => s.script || s.kind),
        }));
    }

    status() { return this._run ? { ...this._run } : null; }

    _python() {
        const cfg = this._config() || {};
        const root = cfg.comfy_ui?.root_path || '';
        const exe = cfg.comfy_ui?.python_executable || '';
        // Relative python paths resolve against the ComfyUI root, which is the
        // convention configManager already uses for this field.
        const candidates = [];
        if (exe) candidates.push(path.isAbsolute(exe) ? exe : path.resolve(root || '.', exe));
        if (root) candidates.push(path.resolve(root, '..', 'python_embeded', 'python.exe'));
        return candidates.find(p => { try { return fs.statSync(p).isFile(); } catch { return false; } }) || null;
    }

    _log(line) {
        if (!this._run) return;
        this._run.output.push(line);
        // Keep the tail bounded: a full rescan prints thousands of lines and the
        // whole thing is handed to a browser.
        if (this._run.output.length > 600) this._run.output.splice(0, this._run.output.length - 600);
    }

    /** Start a task. Returns { ok } or { ok:false, error }. */
    async start(key) {
        if (this._run && this._run.status === 'running') {
            return { ok: false, error: 'a maintenance task is already running' };
        }
        const task = TASKS.find(t => t.key === key);
        if (!task) return { ok: false, error: 'no such task' };

        const py = this._python();
        if (!py) return { ok: false, error: "ComfyUI's python could not be found — check the paths under Manage ComfyUI" };

        this._run = {
            key, label: task.label, status: 'running',
            startedAt: new Date().toISOString(),
            step: null, stepIndex: 0, steps: task.steps.length,
            output: [], wrote: [], error: null,
        };
        // Deliberately not awaited: the caller gets an immediate ack and polls.
        this._execute(task, py).catch(e => {
            if (this._run) { this._run.status = 'failed'; this._run.error = e.message; }
        });
        return { ok: true };
    }

    stop() {
        if (!this._run || this._run.status !== 'running') return { ok: false, error: 'nothing is running' };
        try { this._child?.kill(); } catch { /* already gone */ }
        this._run.status = 'cancelled';
        return { ok: true };
    }

    async _execute(task, py) {
        for (let i = 0; i < task.steps.length; i++) {
            if (!this._run || this._run.status !== 'running') return;
            const step = task.steps[i];
            this._run.stepIndex = i;
            this._run.step = step.script || step.kind;

            if (step.kind === 'object-info') {
                await this._fetchObjectInfo(step.writes);
                continue;
            }
            const code = await this._python_step(py, step.script);
            if (code !== 0) {
                this._run.status = 'failed';
                this._run.error = `${step.script} exited with code ${code}`;
                return;
            }
            if (step.writes) this._noteWrote(step.writes);
        }
        if (this._run) { this._run.status = 'done'; this._run.step = null; }
    }

    /**
     * ComfyUI's node table, which rescan_nodes.py expects to find on disk.
     *
     * ★ Fetched here rather than by the script: ComfyQ already knows the port,
     * and the README's hand instruction for this step is an Invoke-WebRequest
     * the admin had to remember. It is ~4.4 MB.
     */
    async _fetchObjectInfo(writesRel) {
        const cfg = this._config() || {};
        const host = cfg.comfy_ui?.api_host || '127.0.0.1';
        const port = cfg.comfy_ui?.api_port || 8188;
        const url = `http://${host}:${port}/object_info`;
        this._log(`fetching ${url}`);
        try {
            const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const text = await res.text();
            const out = path.join(MAINT_DIR, writesRel);
            fs.mkdirSync(path.dirname(out), { recursive: true });
            fs.writeFileSync(out, text);
            this._log(`wrote ${writesRel} (${(text.length / 1024 ** 2).toFixed(1)} MB)`);
            this._noteWrote(writesRel);
        } catch (e) {
            // Not fatal on its own: rescan_nodes.py will say what it is missing,
            // and the rest of the chain does not depend on it.
            this._log(`could not fetch the node list: ${e.message}`);
            this._log('ComfyUI must be running for this step — the node attribution will be stale');
        }
    }

    _noteWrote(rel) {
        const abs = path.join(MAINT_DIR, rel);
        let size = 0;
        try { size = fs.statSync(abs).size; } catch { /* did not appear */ }
        if (!this._run) return;
        this._run.wrote = this._run.wrote.filter(w => w.rel !== rel);
        this._run.wrote.push({ rel, mb: +(size / 1024 ** 2).toFixed(2) });
    }

    _python_step(py, scriptRel) {
        return new Promise((resolve) => {
            const script = path.join(MAINT_DIR, scriptRel);
            if (!fs.existsSync(script)) { this._log(`missing: ${scriptRel}`); return resolve(1); }
            this._log(`--- ${scriptRel}`);
            // ★ Run it through a bootstrap rather than as `python <script>`.
            // ComfyUI's embedded Python has a `python312._pth`, which PINS sys.path
            // and makes it ignore PYTHONPATH — so the script's OWN folder is never
            // importable and a sibling module (`import variants`) raises
            // ModuleNotFoundError even though the file sits right beside it. This
            // puts the script's dir and tools/maintenance back on the path, which
            // is what running these by hand from a shell happens to give them.
            const boot = "import runpy, sys, os; p = sys.argv[1]; sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(p)))); sys.path.insert(0, os.path.dirname(os.path.abspath(p))); sys.argv = sys.argv[1:]; runpy.run_path(p, run_name='__main__')";
            const child = spawn(py, ['-c', boot, script], {
                cwd: path.dirname(script),
                // ★ Without this the run dies on a ✓ the moment stdout is a pipe.
                env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
                windowsHide: true,
            });
            this._child = child;
            const feed = (buf) => {
                for (const line of buf.toString('utf8').split(/\r?\n/)) {
                    if (line.trim()) this._log(line);
                }
            };
            child.stdout.on('data', feed);
            child.stderr.on('data', feed);
            child.on('error', (e) => { this._log(`could not start python: ${e.message}`); resolve(1); });
            child.on('close', (code) => { this._child = null; resolve(code == null ? 1 : code); });
        });
    }
}

module.exports = { ScriptRunner, TASKS, MAINT_DIR };
