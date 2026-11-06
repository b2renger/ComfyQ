const fs = require('fs');
const path = require('path');
const { AppConfig } = require('./schemas');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const CONFIG_PATH = path.resolve(PROJECT_ROOT, 'config.json');

// Hardcoded defaults for the workshop-rig layout. Every classroom machine is
// cloned from the same image: portable ComfyUI lives at
// D:\ComfyUI_windows_portable_nvidia\ComfyUI_windows_portable\... so first-run
// admins land with all three paths pre-filled and only need to click Save.
const WORKSHOP_PORTABLE_BASE = 'D:\\ComfyUI_windows_portable_nvidia\\ComfyUI_windows_portable';

function defaultConfig() {
    return {
        schemaVersion: 2,
        mode: 'admin',
        server: { port: 3000, host: '0.0.0.0' },
        comfy_ui: {
            installation_type: 'portable',
            root_path: `${WORKSHOP_PORTABLE_BASE}\\ComfyUI`,
            python_executable: `${WORKSHOP_PORTABLE_BASE}\\python_embeded\\python.exe`,
            output_dir: `${WORKSHOP_PORTABLE_BASE}\\ComfyUI\\output`,
            api_host: '127.0.0.1',
            api_port: 8188,
            autoStart: true,
            vramBudgetGb: 24,
            use_sage_attention: false,
            fp16_accumulation: false
        },
        auth: { adminPasswordHash: '', accessPasswordHash: '' },
        queue: {
            dbPath: './server/data/comfyq.sqlite',
            inputRetentionMinutes: 30,
            outputRetentionDays: 30
        },
        workflows: { dir: './workflows', activeWorkflowId: null },
        // Sample media for one-click auto-calibration (see BenchmarkService).
        assets: { dir: 'D:\\_assets' }
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
        // ★ Keep the broken file. It holds both password hashes, the paths, the
        // HF token and the machine's name, and a trailing comma typed into it
        // must not cost all of that -- the beacon re-reads this file every few
        // seconds, so a running server got here within moments of the typo.
        const cfg = defaultConfig();
        const aside = keepBrokenCopy(CONFIG_PATH);
        if (!aside) {
            console.error(`[Config] config.json is not valid JSON (${e.message}) and no copy of it could be kept — `
                + 'leaving it as it is and using the defaults until it is fixed');
            return { config: cfg, fresh: true };
        }
        console.warn(`[Config] config.json is not valid JSON (${e.message}) — kept as ${path.basename(aside)}, starting fresh in admin mode`);
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
    writeAtomic(CONFIG_PATH, JSON.stringify(result.data, null, 2));
}

// Written to a temporary file and renamed over the real one, so a power cut in
// the middle of a save leaves the old file or the new one, never half of one
// (half a config.json is not valid JSON, and the next boot would reset it).
function writeAtomic(file, text) {
    const tmp = `${file}.tmp`;
    try {
        fs.writeFileSync(tmp, text, 'utf8');
    } catch (e) {
        // The temporary file could not be written (a full volume, say). The
        // real file is untouched, and must stay so: writing it directly would
        // truncate it first and then fail the same way, leaving half of it.
        try { fs.unlinkSync(tmp); } catch { /* not there */ }
        throw e;
    }
    try {
        fs.renameSync(tmp, file);
    } catch {
        // On Windows the rename fails (EPERM/EBUSY) while another program has
        // the file open; a direct write is still better than not saving.
        try { fs.unlinkSync(tmp); } catch { /* not there */ }
        fs.writeFileSync(file, text, 'utf8');
    }
}

// Move a file that cannot be read out of the way, so that writing defaults in
// its place does not destroy it. Returns where it went, or null when no copy
// could be kept -- and then the caller must not overwrite it.
function keepBrokenCopy(file, now = Date.now()) {
    const aside = `${file}.broken-${now}.bak`;   // .bak: gitignored, it holds secrets
    try { fs.renameSync(file, aside); return aside; } catch { /* held open by an editor? */ }
    try { fs.copyFileSync(file, aside); return aside; } catch { return null; }
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

// Where to look for ComfyUI, in order, one path at a time (a drive is only
// listed when the search reaches it, as before).
//
// ★ The install beside this checkout, then the drive ComfyQ runs from, come
// FIRST. Scanning C..Z in order meant a clone mounted as K: on a rig with its
// own D:\ComfyUI_windows_portable_nvidia was repointed at THAT install -- its
// models, its node packs -- with one log line to say so.
function* comfyCandidates(drives, projectRoot, listDir) {
    const seen = new Set();
    function* once(...paths) {
        for (const p of paths) {
            const k = p.toLowerCase();
            if (seen.has(k)) continue;
            seen.add(k);
            yield p;
        }
    }
    const parent = path.dirname(projectRoot);
    yield* once(
        path.join(parent, 'ComfyUI_windows_portable_nvidia', 'ComfyUI_windows_portable', 'ComfyUI'),
        path.join(parent, 'ComfyUI_windows_portable', 'ComfyUI'),
    );
    const own = (String(projectRoot).match(/^([A-Za-z]):/) || [])[1]?.toUpperCase();
    const ordered = own && drives.includes(own) ? [own, ...drives.filter(d => d !== own)] : drives;
    for (const drive of ordered) {
        yield* once(
            `${drive}:\\ComfyUI_windows_portable_nvidia\\ComfyUI_windows_portable\\ComfyUI`,
            `${drive}:\\ComfyUI_windows_portable\\ComfyUI`,
            `${drive}:\\ComfyUI\\ComfyUI`,
            `${drive}:\\ComfyUI`,
        );
        // Plus a shallow scan of the drive root for any ComfyUI* folder.
        let names = [];
        try { names = listDir(`${drive}:\\`); } catch { /* unreadable drive (empty CD, disconnected) — skip */ }
        for (const name of names) {
            if (!/comfyui/i.test(name)) continue;
            const base = path.join(`${drive}:\\`, name);
            yield* once(path.join(base, 'ComfyUI_windows_portable', 'ComfyUI'), path.join(base, 'ComfyUI'), base);
        }
    }
}

// Best-effort auto-detection of a local ComfyUI install (Windows). Looks for the
// portable layout — a directory containing main.py, ideally with a sibling
// python_embeded\python.exe — beside this checkout first, then on ComfyQ's own
// drive, then on the other drives. Returns { root_path, python_executable,
// output_dir, assets_dir, installation_type } for the first match, or null.
// Bounded: a readdir per drive + a handful of existsSync — no deep filesystem walk.
function detectComfyPaths({ projectRoot = PROJECT_ROOT } = {}) {
    if (process.platform !== 'win32') return null;
    const exists = (p) => { try { return fs.existsSync(p); } catch { return false; } };

    const drives = [];
    for (let c = 67; c <= 90; c++) {                 // C..Z (skip floppy A/B)
        const letter = String.fromCharCode(c);
        if (exists(`${letter}:\\`)) drives.push(letter);
    }

    for (const root of comfyCandidates(drives, projectRoot, (d) => fs.readdirSync(d))) {
        if (!exists(path.join(root, 'main.py'))) continue;
        const portablePy = path.resolve(root, '..', 'python_embeded', 'python.exe');
        const hasPortablePy = exists(portablePy);
        const assets = path.join(path.parse(root).root, '_assets');
        return {
            root_path: root,
            python_executable: hasPortablePy ? portablePy : 'python',
            output_dir: path.join(root, 'output'),
            assets_dir: exists(assets) ? assets : '',
            installation_type: hasPortablePy ? 'portable' : 'system',
        };
    }
    return null;
}

// A configured absolute folder, pointed at whatever drive the install is on now.
//
// This drive is cloned between machines that mount it under different letters,
// so a path recorded on one rig does not resolve on the next. The ComfyUI paths
// are re-detected at boot and the assets folder follows them; the workflow scan
// folders have to follow too, and they are the ones where being wrong is QUIET
// -- a folder that cannot be read makes every model only that folder references
// look UNUSED, so the prune tool ends up reasoning about a folder that is not
// there. (It refuses outright in that state rather than giving a bad verdict,
// which is the safe failure -- but it leaves the tool simply broken on every
// clone until somebody repoints it by hand.)
//
// It rewrites a path only when that path is BOTH unreachable now AND reachable
// on the new drive. A folder missing for any other reason is left alone so the
// scan reports it, rather than being quietly redirected somewhere plausible.
function followDriveLetter(dirs, installRoot, log = () => {}) {
    const to = (String(installRoot || '').match(/^([A-Za-z]):/) || [])[1];
    if (!to || !Array.isArray(dirs)) return dirs;
    return dirs.map((d) => {
        if (typeof d !== 'string' || !/^[A-Za-z]:/.test(d) || fs.existsSync(d)) return d;
        const moved = to + d.slice(1);
        if (!fs.existsSync(moved)) return d;
        log(`${d} -> ${moved}`);
        return moved;
    });
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
    if (out.assets && out.assets.dir) out.assets.dir = resolveRel(out.assets.dir);
    return out;
}

module.exports = {
    CONFIG_PATH,
    PROJECT_ROOT,
    load,
    save,
    update,
    setMode,
    resolvePaths,
    defaultConfig,
    detectComfyPaths,
    comfyCandidates,
    followDriveLetter,
    writeAtomic,
    keepBrokenCopy
};
