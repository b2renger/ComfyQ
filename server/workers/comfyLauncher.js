// comfyLauncher — start ComfyUI so it OUTLIVES ComfyQ, and know it again later.
//
// ★★ Why this exists. ComfyQ used to spawn ComfyUI as a plain child process.
// Measured on the rig (2026-11-04): on Windows a child spawned that way dies
// with its parent — libuv puts it in a job object that is killed when ComfyQ
// exits — and ComfyQ exits on every "Activate & serve", every "Stop serving",
// every nodemon reload and every crash. So each of those cold-started ComfyUI
// (30–90 s) and reloaded the model (another 20–160 s), and anything queued
// waited for it. Two naive fixes fail, both measured:
//   - `detached: true` with the usual stdout pipe survives, but every print
//     after ComfyQ is gone raises OSError [Errno 22] — a custom node that
//     prints, or tqdm's progress bar, would fail the job;
//   - `detached: true` with a log file survives a clean exit, but nodemon
//     restarts with `taskkill /T`, which walks the process TREE and still
//     takes a detached child down.
// So on Windows ComfyUI is started by a short-lived PowerShell
// `Start-Process`: the PowerShell exits at once, ComfyUI is left with no live
// parent (no tree to be killed through, no job object), and its output goes
// to log files that ComfyQ follows. Elsewhere a detached spawn with file
// output does the same job.
//
// Ownership is recorded in .comfyq-lanes/processes.json (outside server/, so
// nodemon never restarts on it): port → { pid, userDir, flags, startedAt }.
// A later ComfyQ that finds that PID still listening on that port knows the
// ComfyUI is its own — it can stop it, mask its flags, respawn it — instead of
// treating it as somebody else's "external" instance.
'use strict';
const { spawn, execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');

const execFileAsync = promisify(execFile);

const STATE_DIR = path.join(__dirname, '..', '..', '.comfyq-lanes');
const REGISTRY = path.join(STATE_DIR, 'processes.json');
const LOG_DIR = path.join(STATE_DIR, 'logs');
const HISTORY_MAX = 200;

const norm = (p) => (p ? path.resolve(p).toLowerCase() : null);

// ---- registry ---------------------------------------------------------------

function readRegistry(file = REGISTRY) {
    try {
        const r = JSON.parse(fs.readFileSync(file, 'utf8'));
        return { procs: r.procs || {}, history: Array.isArray(r.history) ? r.history : [] };
    } catch { return { procs: {}, history: [] }; }
}

function writeRegistry(reg, file = REGISTRY) {
    try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const tmp = `${file}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(reg, null, 1));
        fs.renameSync(tmp, file);
    } catch (e) {
        console.warn(`[ComfyLauncher] could not write ${file}: ${e.message}`);
    }
}

/** Remember that we started `pid` on `port`, and why. */
function recordStart({ port, pid, userDir, flags, reason }, file = REGISTRY) {
    const reg = readRegistry(file);
    reg.procs[String(port)] = { pid, userDir: userDir || null, flags: flags || {}, startedAt: new Date().toISOString() };
    reg.history.push({ at: new Date().toISOString(), event: 'start', port, pid, reason: reason || 'start' });
    reg.history = reg.history.slice(-HISTORY_MAX);
    writeRegistry(reg, file);
}

/** Note an event (stop, crash, adopt) in the history. */
function recordEvent({ port, pid, event, reason }, file = REGISTRY) {
    const reg = readRegistry(file);
    if (event === 'stop' || event === 'exit') {
        const rec = reg.procs[String(port)];
        if (rec && (!pid || rec.pid === pid)) delete reg.procs[String(port)];
    }
    reg.history.push({ at: new Date().toISOString(), event, port, pid: pid || null, reason: reason || null });
    reg.history = reg.history.slice(-HISTORY_MAX);
    writeRegistry(reg, file);
}

function recordFor(port, file = REGISTRY) {
    return readRegistry(file).procs[String(port)] || null;
}

/** Recorded processes whose user directory is `userDir` (a lane's own). */
function recordsForUserDir(userDir, file = REGISTRY) {
    const want = norm(userDir);
    return Object.entries(readRegistry(file).procs)
        .filter(([, r]) => norm(r.userDir) === want)
        .map(([port, r]) => ({ port: Number(port), ...r }));
}

/** Starts in the last `windowMs`, newest last — for "how often does it restart". */
function recentStarts(windowMs = 24 * 3600e3, file = REGISTRY) {
    const since = Date.now() - windowMs;
    return readRegistry(file).history.filter(h => h.event === 'start' && Date.parse(h.at) >= since);
}

// ---- processes ----------------------------------------------------------------

function pidAlive(pid) {
    if (!pid) return false;
    try { process.kill(pid, 0); return true; }
    catch (e) { return e.code === 'EPERM'; }   // exists, just not ours to signal
}

/** PIDs LISTENING on `port` (Windows netstat / POSIX lsof). [] when unknown. */
async function pidsOnPort(port) {
    const p = Number(port);
    if (!Number.isInteger(p)) return [];
    try {
        if (process.platform === 'win32') {
            const { stdout } = await execFileAsync('netstat', ['-ano', '-p', 'TCP'], { windowsHide: true });
            const pids = new Set();
            for (const line of stdout.split(/\r?\n/)) {
                const m = line.trim().split(/\s+/);
                // Proto  Local Address  Foreign Address  State  PID
                if (m.length >= 5 && /LISTEN/i.test(m[3]) && new RegExp(`:${p}$`).test(m[1])) pids.add(Number(m[4]));
            }
            return [...pids].filter(Boolean);
        }
        const { stdout } = await execFileAsync('lsof', ['-nP', `-iTCP:${p}`, '-sTCP:LISTEN', '-t']);
        return stdout.split(/\s+/).map(Number).filter(Boolean);
    } catch { return []; }
}

async function killPid(pid) {
    if (!pid) return false;
    try {
        if (process.platform === 'win32') {
            await execFileAsync('taskkill', ['/F', '/T', '/PID', String(pid)], { windowsHide: true });
        } else {
            process.kill(pid, 'SIGTERM');
            await new Promise(r => setTimeout(r, 2000));
            if (pidAlive(pid)) process.kill(pid, 'SIGKILL');
        }
        return true;
    } catch { return !pidAlive(pid); }
}

/**
 * Start `exe args…` so that it survives this process, with stdout/stderr in
 * `${logBase}.out.log` / `${logBase}.err.log`. Resolves { pid, outLog, errLog }.
 */
async function launchDetached({ exe, args, cwd, env, logBase }) {
    fs.mkdirSync(path.dirname(logBase), { recursive: true });
    const outLog = `${logBase}.out.log`;
    const errLog = `${logBase}.err.log`;
    for (const f of [outLog, errLog]) { try { fs.writeFileSync(f, ''); } catch { /* reopened below */ } }

    if (process.platform !== 'win32') {
        const out = fs.openSync(outLog, 'a');
        const err = fs.openSync(errLog, 'a');
        const child = spawn(exe, args, { cwd, env, detached: true, stdio: ['ignore', out, err] });
        child.unref();
        fs.closeSync(out); fs.closeSync(err);
        if (!child.pid) throw new Error(`could not start ${exe}`);
        return { pid: child.pid, outLog, errLog };
    }

    // PowerShell quoting: single quotes, doubled inside. Start-Process joins
    // -ArgumentList with spaces and does NOT quote, so an argument holding a
    // space is wrapped in double quotes here.
    const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
    const argLine = args.map(a => (/[\s"]/.test(String(a)) ? `"${String(a).replace(/"/g, '\\"')}"` : String(a))).join(' ');
    // ★ The PID comes back through a FILE, and PowerShell runs with no pipes
    // at all. Start-Process lets the new process inherit PowerShell's
    // inheritable handles — so had PowerShell's stdout been a pipe to us,
    // ComfyUI would hold its write end and Node would wait for that stream to
    // close, i.e. until ComfyUI exits (found the hard way: the server sat in
    // this call while ComfyUI ran). Waiting for PowerShell to EXIT instead
    // does not depend on any stream.
    const pidFile = `${logBase}.pid`;
    try { fs.unlinkSync(pidFile); } catch { /* none yet */ }
    const script = [
        `$p = Start-Process -FilePath ${q(exe)}`,
        `-ArgumentList ${q(argLine)}`,
        `-WorkingDirectory ${q(cwd)}`,
        '-WindowStyle Hidden',
        `-RedirectStandardOutput ${q(outLog)}`,
        `-RedirectStandardError ${q(errLog)}`,
        '-PassThru;',
        `Set-Content -LiteralPath ${q(pidFile)} -Value $p.Id -Encoding ascii`,
    ].join(' ');
    await new Promise((resolve, reject) => {
        const ps = spawn('powershell.exe',
            ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
            { env, windowsHide: true, stdio: 'ignore' });
        const timer = setTimeout(() => { try { ps.kill(); } catch { /* gone */ } reject(new Error('Start-Process did not return within 60 s')); }, 60000);
        ps.once('error', (e) => { clearTimeout(timer); reject(e); });
        ps.once('exit', (code) => {
            clearTimeout(timer);
            if (code === 0) resolve();
            else reject(new Error(`Start-Process failed (exit code ${code}) — is ${exe} a valid program?`));
        });
    });
    let pid = NaN;
    try { pid = Number(fs.readFileSync(pidFile, 'utf8').trim()); } catch { /* checked below */ }
    if (!Number.isInteger(pid) || pid <= 0) throw new Error('Start-Process returned no PID');
    return { pid, outLog, errLog };
}

// ---- log following ---------------------------------------------------------------

/**
 * Follow a growing log file and hand each new chunk to `onData`. Polling, not
 * fs.watch: watch events on Windows are unreliable for a file another process
 * keeps open. `fromEnd` starts at the current end (adopting a running ComfyUI
 * should not replay its whole boot).
 */
class LogTail {
    constructor(file, onData, { fromEnd = false, intervalMs = 400 } = {}) {
        this.file = file;
        this.onData = onData;
        this.pos = 0;
        if (fromEnd) { try { this.pos = fs.statSync(file).size; } catch { /* not yet */ } }
        this.timer = setInterval(() => this._read(), intervalMs);
        if (this.timer.unref) this.timer.unref();
    }

    _read() {
        let size;
        try { size = fs.statSync(this.file).size; } catch { return; }
        if (size < this.pos) this.pos = 0;            // truncated — a new ComfyUI on this port
        if (size === this.pos) return;
        const len = Math.min(size - this.pos, 1 << 20);
        const buf = Buffer.alloc(len);
        let fd;
        try {
            fd = fs.openSync(this.file, 'r');
            const n = fs.readSync(fd, buf, 0, len, this.pos);
            this.pos += n;
            if (n > 0) this.onData(buf.subarray(0, n));
        } catch { /* the writer holds it; try again next tick */ }
        finally { if (fd !== undefined) try { fs.closeSync(fd); } catch { /* ignore */ } }
    }

    stop() { clearInterval(this.timer); this._read(); }
}

const logBaseFor = (port) => path.join(LOG_DIR, `comfyui-${port}`);

module.exports = {
    REGISTRY, LOG_DIR, STATE_DIR,
    readRegistry, writeRegistry, recordStart, recordEvent, recordFor, recordsForUserDir, recentStarts,
    pidAlive, pidsOnPort, killPid, launchDetached, LogTail, logBaseFor, norm,
};
