const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { readRequirements, repoName, invalidateNodePacks } = require('../workflows/nodePacks');

// Install a node pack from ComfyQ's own backend.
//
// ★ A git clone into custom_nodes, not a call to ComfyUI-Manager's API. Two
// reasons, and the first is the owner's: the install should be driven from here
// rather than from ComfyUI's own interface. The second is that `git clone` into
// custom_nodes is the pack authors' OWN published instruction and the supported
// extension point — the 47 packs on this rig are there, and ComfyUI's code is
// never touched. It also leaves a real git remote behind, so the pack can be
// updated later; most of what Manager installed cannot be, because it unpacks a
// copy with no .git at all.
//
// ⚠ pip is SEPARATE and never automatic. Every lane and every rig shares one
// python_embeded, and a pack's requirements.txt can quietly replace a package
// the rest of the install depends on. That is not hypothetical here: a pack
// pulling the CPU onnxruntime wheel overwrote the GPU one's core DLL, and DWPose
// silently fell back to CPU — 64.5 s instead of 5.1 s on the same clip, with no
// error anywhere. So the requirements are READ and shown first, risky lines are
// named, and nothing is installed until someone asks for it.
//
// ⚠ And a freshly cloned pack is not loaded until ComfyUI restarts. This module
// never restarts anything — on this fleet a restart is the operator's call,
// since the machine may be mid-class.

const CLONE_TIMEOUT_MS = 10 * 60 * 1000;
const PIP_TIMEOUT_MS = 20 * 60 * 1000;

class NodePackInstaller {
    /**
     * @param {object} opts
     * @param {() => object} opts.config  read fresh, so an edited path is honoured
     */
    constructor({ config }) {
        this._config = config;
        this._jobs = new Map();   // folder -> job
    }

    _root() { return (this._config() || {}).comfy_ui?.root_path || ''; }
    _customNodes() {
        const r = this._root();
        return r ? path.join(r, 'custom_nodes') : null;
    }
    _python() {
        const cfg = this._config() || {};
        const exe = cfg.comfy_ui?.python_executable || '';
        const root = this._root();
        const cands = [];
        if (exe) cands.push(path.isAbsolute(exe) ? exe : path.resolve(root || '.', exe));
        if (root) cands.push(path.resolve(root, '..', 'python_embeded', 'python.exe'));
        return cands.find(p => { try { return fs.statSync(p).isFile(); } catch { return false; } }) || null;
    }

    list() { return [...this._jobs.values()].map(j => this._wire(j)); }

    _wire(j) {
        return {
            folder: j.folder, url: j.url, status: j.status, step: j.step,
            error: j.error, output: j.output.slice(-200),
            requirements: j.requirements, pipRan: j.pipRan,
            needsRestart: j.needsRestart,
        };
    }

    /**
     * What installing this would do, before anything happens.
     * Cheap and side-effect free: an admin should be able to look first.
     */
    plan(url) {
        const cn = this._customNodes();
        if (!cn) return { ok: false, error: 'no ComfyUI install is configured' };
        if (!/^https:\/\/(github\.com|gitlab\.com|codeberg\.org)\/[\w.-]+\/[\w.-]+\/?$/i.test(String(url || '').replace(/\.git$/, ''))) {
            // ★ A whitelist of hosts and a strict shape: this string becomes an
            // argument to git. Anything else is refused rather than escaped.
            return { ok: false, error: 'only a plain https repo URL on github, gitlab or codeberg can be installed' };
        }
        const folder = repoName(url);
        if (!folder) return { ok: false, error: 'could not work out a folder name from that URL' };
        const dest = path.join(cn, folder);
        return {
            ok: true,
            url: String(url).replace(/\/$/, ''),
            folder,
            dest,
            exists: fs.existsSync(dest),
            python: this._python(),
        };
    }

    /** Clone it. pip is a separate, explicit step. */
    async install(url) {
        const p = this.plan(url);
        if (!p.ok) return p;
        if (p.exists) return { ok: false, error: `custom_nodes/${p.folder} already exists — nothing was touched` };
        const running = this._jobs.get(p.folder);
        if (running && running.status === 'cloning') return { ok: false, error: 'that pack is already being installed' };

        const job = {
            folder: p.folder, url: p.url, dest: p.dest, status: 'cloning', step: 'git clone',
            output: [], error: null, requirements: null, pipRan: false, needsRestart: false,
        };
        this._jobs.set(p.folder, job);

        this._clone(job).catch(e => { job.status = 'failed'; job.error = e.message; });
        return { ok: true, folder: p.folder };
    }

    async _clone(job) {
        const code = await this._run('git', ['clone', '--depth', '1', job.url, job.dest],
            { job, cwd: path.dirname(job.dest), timeout: CLONE_TIMEOUT_MS });
        if (code !== 0) {
            job.status = 'failed';
            job.error = `git clone exited with code ${code}`;
            // Leave no half directory behind: a partial clone would read as an
            // installed pack to every other check in here.
            try {
                if (fs.existsSync(job.dest) && !fs.existsSync(path.join(job.dest, '.git'))) {
                    fs.rmSync(job.dest, { recursive: true, force: true });
                    job.output.push('removed the incomplete folder');
                }
            } catch { /* say nothing; the error above is the headline */ }
            return;
        }
        job.requirements = readRequirements(job.dest);
        job.status = 'cloned';
        job.step = null;
        job.needsRestart = true;
        invalidateNodePacks();
        job.output.push(`cloned into custom_nodes/${job.folder}`);
        if (job.requirements.exists) {
            job.output.push(`requirements.txt has ${job.requirements.lines.length} line(s)`
                + (job.requirements.risky.length
                    ? `, ${job.requirements.risky.length} of them touching a shared package`
                    : ''));
        } else {
            job.output.push('no requirements.txt — nothing to pip install');
        }
        job.output.push('ComfyUI must be restarted before it sees this pack');
    }

    /**
     * Run pip for a pack that is already cloned.
     *
     * @param {string} folder
     * @param {boolean} acceptRisky  the risky lines were shown and accepted
     */
    async pipInstall(folder, acceptRisky = false) {
        const job = this._jobs.get(folder);
        const cn = this._customNodes();
        const dest = job?.dest || (cn ? path.join(cn, folder) : null);
        if (!dest || !fs.existsSync(dest)) return { ok: false, error: 'that pack is not installed' };

        const reqs = readRequirements(dest);
        if (!reqs.exists) return { ok: false, error: 'that pack has no requirements.txt' };
        if (reqs.risky.length && !acceptRisky) {
            return {
                ok: false,
                error: 'these requirements replace packages the whole install shares: '
                    + reqs.risky.join(', ')
                    + '. Say so explicitly to go ahead.',
                risky: reqs.risky,
            };
        }
        const py = this._python();
        if (!py) return { ok: false, error: "ComfyUI's python could not be found" };

        const j = job || {
            folder, url: null, dest, status: 'cloned', step: null,
            output: [], error: null, requirements: reqs, pipRan: false, needsRestart: true,
        };
        this._jobs.set(folder, j);
        j.status = 'pip';
        j.step = 'pip install -r requirements.txt';
        j.output.push(`--- pip, with ${path.basename(py)}`);

        (async () => {
            const code = await this._run(py,
                ['-s', '-m', 'pip', 'install', '-r', path.join(dest, 'requirements.txt')],
                { job: j, cwd: dest, timeout: PIP_TIMEOUT_MS });
            j.pipRan = true;
            j.status = code === 0 ? 'done' : 'failed';
            j.step = null;
            if (code !== 0) j.error = `pip exited with code ${code}`;
            j.needsRestart = true;
        })().catch(e => { j.status = 'failed'; j.error = e.message; });

        return { ok: true };
    }

    forget(folder) {
        const j = this._jobs.get(folder);
        if (j && (j.status === 'cloning' || j.status === 'pip')) {
            return { ok: false, error: 'it is still running' };
        }
        this._jobs.delete(folder);
        return { ok: true };
    }

    _run(cmd, args, { job, cwd, timeout }) {
        return new Promise((resolve) => {
            let child;
            try {
                child = spawn(cmd, args, {
                    cwd,
                    // utf-8 for the same reason the maintenance runner needs it:
                    // Windows falls back to cp1252 the moment stdout is a pipe.
                    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1', GIT_TERMINAL_PROMPT: '0' },
                    windowsHide: true,
                });
            } catch (e) {
                job.output.push(`could not start ${cmd}: ${e.message}`);
                return resolve(1);
            }
            const timer = setTimeout(() => {
                job.output.push(`timed out after ${Math.round(timeout / 60000)} min`);
                try { child.kill(); } catch { /* already gone */ }
            }, timeout);
            const feed = (buf) => {
                for (const line of buf.toString('utf8').split(/\r?\n/)) {
                    if (line.trim()) {
                        job.output.push(line);
                        if (job.output.length > 400) job.output.splice(0, job.output.length - 400);
                    }
                }
            };
            child.stdout.on('data', feed);
            child.stderr.on('data', feed);
            child.on('error', (e) => {
                clearTimeout(timer);
                job.output.push(`${cmd} failed to start: ${e.message}`);
                resolve(1);
            });
            child.on('close', (code) => { clearTimeout(timer); resolve(code == null ? 1 : code); });
        });
    }
}

module.exports = { NodePackInstaller };
