/**
 * What of ComfyQ's `.comfyq-lanes/` folder a wipe may remove, and what it must keep.
 *
 * The folder used to hold only the extra lanes' state, so wiping all of it was
 * fine. Since ComfyUI outlives ComfyQ (server/workers/comfyLauncher.js) it also
 * holds `processes.json` -- which ComfyUI each port belongs to, the MAIN one
 * included -- and `logs/comfyui-<port>.*`, the console of every ComfyUI ComfyQ
 * started. Deleting the registry while that ComfyUI runs makes the next ComfyQ
 * treat its own ComfyUI as somebody else's ("external": no log following, no
 * flag masking, no respawn); deleting its open log files fails half-way.
 *
 * So: everything that belongs to a ComfyUI whose recorded process is still
 * alive is kept -- its registry, its log and pid files, its lane folder -- and
 * the rest is residue. On a cloned machine the kept registry entry is harmless:
 * ComfyQ adopts a recorded process only when that PID is listening on that
 * port with that user folder.
 *
 * Pure planning: reads the folder, deletes nothing.
 *
 * The registry, the liveness test and the log names come from comfyLauncher
 * itself, not from copies here: if its format moved and this did not, the
 * planner would see no live process and plan the running ComfyUI's registry and
 * logs for deletion -- the one thing this module exists to prevent.
 */
const fs = require('fs');
const path = require('path');
const launcher = require(path.join(__dirname, '..', '..', 'server', 'workers', 'comfyLauncher'));

// `comfyui-<port>.` -- the start of every log file comfyLauncher writes for a port.
const logPrefix = (port) => path.basename(launcher.logBaseFor(port)) + '.';

/**
 * @param {string} dir      the `.comfyq-lanes` folder
 * @param {(pid:number)=>boolean} [isAlive]
 * @returns {{ remove: string[], keep: {path:string, why:string}[], livePorts: string[] }}
 */
function planLaneWipe(dir, isAlive = launcher.pidAlive) {
    const out = { remove: [], keep: [], livePorts: [] };
    if (!fs.existsSync(dir)) return out;

    // {} when there is none, or it cannot be read.
    const procs = launcher.readRegistry(path.join(dir, 'processes.json')).procs;
    const live = Object.entries(procs).filter(([, rec]) => rec && isAlive(rec.pid));
    out.livePorts = live.map(([port]) => String(port));
    const livePorts = new Set(out.livePorts);
    const liveUserDirs = live.map(([, rec]) => rec.userDir).filter(Boolean)
        .map(u => path.resolve(u).toLowerCase());

    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.name.startsWith('processes.json')) {       // + the .tmp of a write in progress
            if (live.length) out.keep.push({ path: p, why: `records the running ComfyUI on port ${out.livePorts.join(', ')}` });
            else out.remove.push(p);
            continue;
        }
        if (e.isDirectory() && e.name === 'logs') {
            for (const f of fs.readdirSync(p, { withFileTypes: true })) {
                const q = path.join(p, f.name);
                const port = f.isFile() && [...livePorts].find(pt => f.name.startsWith(logPrefix(pt)));
                if (port) out.keep.push({ path: q, why: `port ${port} is running` });
                else out.remove.push(q);
            }
            continue;
        }
        if (e.isDirectory()) {
            const root = path.resolve(p).toLowerCase() + path.sep;
            const user = liveUserDirs.find(u => (u + path.sep).startsWith(root));
            if (user) out.keep.push({ path: p, why: 'a running lane uses it' });
            else out.remove.push(p);
            continue;
        }
        out.remove.push(p);         // a stray file
    }
    return out;
}

module.exports = { planLaneWipe };
