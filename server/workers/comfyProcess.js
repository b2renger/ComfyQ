const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');
const axios = require('axios');

// Owns the ComfyUI child process lifecycle. v2 design: spawn once, keep alive.
// If ComfyUI exits, we emit 'exited' and let the LocalComfyUIWorker decide
// whether to respawn (default: yes, with backoff).
class ComfyProcess extends EventEmitter {
    constructor({ rootPath, pythonExecutable, host, bindHost, port, installationType, onMilestone }) {
        super();
        this.rootPath = rootPath;
        this.pythonExecutable = pythonExecutable;
        // `host` is the address ComfyQ *connects* to (always localhost-reachable).
        // `bindHost` is what ComfyUI *listens* on via --listen: 0.0.0.0 to expose
        // the native ComfyUI UI to the LAN, else the same loopback as `host`.
        this.host = host;
        this.bindHost = bindHost || host;
        this.port = port;
        this.installationType = installationType || 'portable';
        this.proc = null;
        // Boot-milestone callback (see LocalComfyUIWorker). Used here to
        // reprint the LAN URL banner the moment ComfyUI's comfyregistry
        // fetch finishes — that's the natural "everything is ready" point
        // and the last big block of startup noise. Defaults to no-op.
        this.onMilestone = onMilestone || (() => {});
        this._registryMilestoneFired = false;
        // Line buffer for stdout. Python flushes can split a single line
        // across two 'data' events, so a regex against each chunk alone
        // would miss matches that straddle the boundary.
        this._stdoutBuf = '';
    }

    validate() {
        if (!fs.existsSync(this.pythonExecutable)) {
            throw new Error(`Python executable not found: ${this.pythonExecutable}`);
        }
        if (!fs.existsSync(this.rootPath)) {
            throw new Error(`ComfyUI root path not found: ${this.rootPath}`);
        }
        if (!fs.existsSync(path.join(this.rootPath, 'main.py'))) {
            throw new Error(`ComfyUI main.py not found in ${this.rootPath}`);
        }
    }

    async isApiResponsive() {
        try {
            await axios.get(`http://${this.host}:${this.port}/system_stats`, { timeout: 1500 });
            return true;
        } catch { return false; }
    }

    async start() {
        this.validate();
        // If something is already responding on the port, assume an external
        // ComfyUI is running and don't try to spawn our own.
        if (await this.isApiResponsive()) {
            console.log('[ComfyProcess] External ComfyUI already responding; using it.');
            this.proc = null;
            return { external: true };
        }
        const mainPy = path.join(this.rootPath, 'main.py');
        // Portable installs match the run_nvidia_gpu.bat launcher:
        //   python.exe -s main.py --windows-standalone-build --disable-auto-launch ...
        // -s — drops user site-packages from sys.path so a stray pip-installed
        //   torch (CPU-only / wrong CUDA) can't shadow the embedded torch.
        // --windows-standalone-build — ComfyUI's portable-mode path tweaks.
        // --disable-auto-launch — suppresses the browser tab that
        //   --windows-standalone-build otherwise opens (we host our own UI).
        // No --highvram: it forces full-load, which thrashes against the
        // text encoder when a single model nearly fills VRAM (e.g. LTX-AV
        // at 23.8GB on a 24GB card). The default dynamic loader handles
        // near-budget cases properly.
        const pyArgs = [];
        const comfyArgs = [
            '--listen', this.bindHost,
            '--port', String(this.port),
            '--disable-auto-launch'
        ];
        if (this.installationType === 'portable') {
            pyArgs.push('-s');
            comfyArgs.push('--windows-standalone-build');
        }
        const args = [...pyArgs, mainPy, ...comfyArgs];
        // Sanitize the env so an active conda/venv in the parent shell can't
        // leak Python paths into the spawned interpreter. Without this, the
        // embedded torch can be shadowed by a CPU-only build → 800+ s/iter.
        const env = { ...process.env };
        const stripped = [];
        const condaPrefix = env.CONDA_PREFIX;
        const virtualEnv = env.VIRTUAL_ENV;
        for (const k of ['PYTHONPATH', 'PYTHONHOME', 'PYTHONSTARTUP', 'VIRTUAL_ENV', 'CONDA_PREFIX', 'CONDA_DEFAULT_ENV', 'CONDA_PROMPT_MODIFIER', 'CONDA_SHLVL', 'CONDA_PYTHON_EXE']) {
            if (env[k] !== undefined) { stripped.push(`${k}=${env[k]}`); delete env[k]; }
        }
        if (stripped.length) console.log(`[ComfyProcess] Stripped env vars: ${stripped.join(' ')}`);
        // Also scrub PATH of any directory under the conda/virtualenv prefix
        // we just removed. Conda activation prepends <prefix>, <prefix>\Library\bin,
        // <prefix>\Scripts, etc. Those carry a different numpy/CUDA/Pillow that
        // Windows can pick up via DLL search order even after we delete CONDA_PREFIX.
        const pathKey = env.Path !== undefined ? 'Path' : (env.PATH !== undefined ? 'PATH' : null);
        if (pathKey && (condaPrefix || virtualEnv)) {
            const prefixes = [condaPrefix, virtualEnv].filter(Boolean).map(p => p.toLowerCase());
            const before = env[pathKey].split(path.delimiter);
            const after = before.filter(p => !prefixes.some(pre => p.toLowerCase().startsWith(pre)));
            if (before.length !== after.length) {
                console.log(`[ComfyProcess] Removed ${before.length - after.length} env-prefix entries from PATH`);
                env[pathKey] = after.join(path.delimiter);
            }
        }
        console.log(`[ComfyProcess] Spawning: ${this.pythonExecutable} ${args.join(' ')}`);
        this.proc = spawn(this.pythonExecutable, args, {
            cwd: this.rootPath,
            env
        });
        this.proc.stdout.on('data', d => this._handleStdoutChunk(d));
        this.proc.stderr.on('data', d => process.stderr.write(`[ComfyUI!] ${d}`));
        this.proc.on('exit', (code, signal) => {
            console.log(`[ComfyProcess] Exited code=${code} signal=${signal}`);
            this.proc = null;
            this.emit('exited', { code, signal });
        });
        return { external: false };
    }

    // Pipes ComfyUI's stdout through with the original `[ComfyUI]` prefix
    // AND scans for the comfyregistry fetch terminal log line. On the
    // first match per boot, fires onMilestone() so the LAN URL banner
    // reprints right after the noisy registry block finishes — that's
    // the moment workshop admins actually want the URLs visible.
    //
    // Matching uses a line buffer because Python's stdout flush can split
    // a single line across multiple 'data' chunks; regex-per-chunk would
    // miss boundary-crossing matches.
    //
    // Terminal patterns observed in this codebase / ComfyUI Manager:
    //   "Comfyregistry has been fetched"         (success)
    //   "Cannot connect to comfyregistry."       (offline)
    //   plus generic done/complete/failed variants for forward compat.
    _handleStdoutChunk(chunk) {
        // Pass-through write — preserves the existing operator UX.
        process.stdout.write(`[ComfyUI] ${chunk}`);
        if (this._registryMilestoneFired) return;
        this._stdoutBuf += chunk.toString('utf8');
        let idx;
        while ((idx = this._stdoutBuf.indexOf('\n')) !== -1) {
            const line = this._stdoutBuf.slice(0, idx);
            this._stdoutBuf = this._stdoutBuf.slice(idx + 1);
            if (/comfyregistry/i.test(line) && /(fetched|cannot|failed|done|complete|skip)/i.test(line)) {
                this._registryMilestoneFired = true;
                this.onMilestone('ComfyUI registry fetch completed');
                // Stop buffering — we found what we wanted, no need to
                // hold partial lines or scan further.
                this._stdoutBuf = '';
                return;
            }
        }
        // Guard against pathological input (a single line that never
        // terminates) bloating memory. 64 KiB is far past any real log
        // line; truncate from the front so we still match the tail.
        if (this._stdoutBuf.length > 65536) {
            this._stdoutBuf = this._stdoutBuf.slice(-32768);
        }
    }

    async waitForApi(timeoutMs = 120000) {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            if (await this.isApiResponsive()) return;
            await new Promise(r => setTimeout(r, 1500));
        }
        throw new Error(`Timeout waiting for ComfyUI API at ${this.host}:${this.port}`);
    }

    async stop() {
        if (this.proc) {
            this.proc.kill();
            await new Promise(r => setTimeout(r, 500));
            this.proc = null;
        }
    }
}

module.exports = { ComfyProcess };
