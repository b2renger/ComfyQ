const fs = require('fs');
const path = require('path');

// Which node packs a bundle needs, and whether this machine has them.
//
// A missing MODEL fails loudly enough to diagnose: ComfyUI refuses the prompt
// and names the file. A missing node PACK fails earlier and more confusingly —
// the class simply does not exist, so the graph is rejected for a class_type
// nobody recognises, and the bundle looks broken rather than unsatisfied. On
// this rig every class every bundle needs is present, which is exactly why this
// could go unnoticed: it only bites on a FRESH machine, or on the A6000s, or on
// a rig imaged before a pack was added. That is the case this serves.
//
// Three facts, from three sources, each with its own failure mode:
//
//   what classes exist   /object_info from the running ComfyUI, falling back to
//                        the audit's cached copy. Live is authoritative; the
//                        cache is dated, and the caller is told which was used.
//   what a bundle wants  the class_type of every node in its api.json. Read
//                        from the api.json because that is what EXECUTES — a
//                        _template.json can carry nodes the runnable graph does
//                        not.
//   who provides a class ComfyUI-Manager's extension-node-map.json, already on
//                        disk. ★ Read locally rather than asked of Manager's
//                        API: the point is to install from ComfyQ's own backend,
//                        and a map on disk also answers on a rig with no
//                        internet.
//
// ⚠ Attribution of an INSTALLED class is deliberately not attempted here.
// `comfyui-workflow-encrypt` re-exports ComfyUI's whole NODE_CLASS_MAPPINGS, so
// /object_info credits it with VHS, KJ and LTXVideo nodes — the same skew that
// misleads the model audit. For "can this run?" the question is only whether the
// class exists, which that bug cannot affect.

const SKIP_DIRS = new Set(['__pycache__', 'node_modules', '.git', '.disabled']);
const CACHED_OBJECT_INFO = path.resolve(
    __dirname, '..', '..', 'tools', 'maintenance', 'model-audit', 'object_info.json');

// pip packages that have broken this fleet's shared python_embeded before.
// onnxruntime is not hypothetical: a pack pulling the CPU wheel overwrote the
// GPU one's core DLL, and DWPose silently fell back to CPU at 12x the cost.
const RISKY_REQUIREMENTS = [
    'onnxruntime', 'torch', 'torchvision', 'torchaudio', 'numpy',
    'transformers', 'diffusers', 'xformers', 'opencv-python',
];

const TTL_MS = 15000;
let _cache = { key: null, at: 0, value: null };

function managerMapPath(comfyRoot) {
    if (!comfyRoot) return null;
    for (const dir of ['comfyui-manager', 'ComfyUI-Manager']) {
        const p = path.join(comfyRoot, 'custom_nodes', dir, 'extension-node-map.json');
        if (fs.existsSync(p)) return p;
    }
    return null;
}

/**
 * class name -> { url, title }, from ComfyUI-Manager's map.
 * First repo wins, which matches how Manager resolves a duplicate itself.
 */
function readClassIndex(comfyRoot) {
    const p = managerMapPath(comfyRoot);
    const out = { byClass: new Map(), source: p, mtime: null, repos: 0 };
    if (!p) return out;
    let raw;
    try {
        raw = JSON.parse(fs.readFileSync(p, 'utf8'));
        out.mtime = fs.statSync(p).mtimeMs;
    } catch { return out; }
    for (const [url, v] of Object.entries(raw)) {
        const classes = Array.isArray(v) ? (v[0] || []) : [];
        const title = (Array.isArray(v) && v[1] && v[1].title_aux) || repoName(url);
        out.repos++;
        for (const c of classes) if (!out.byClass.has(c)) out.byClass.set(c, { url, title });
    }
    return out;
}

/** The folder a repo clones into, the way git itself would name it. */
function repoName(url) {
    return String(url || '').replace(/\.git$/, '').replace(/\/+$/, '').split('/').pop() || '';
}

/**
 * The packs on disk, and whether each is something we could update.
 *
 * ★ Most are NOT git clones. 24 of this rig's 44 arrived through ComfyUI-Manager,
 * which unpacks a copy — so `git pull` is not available for them and an Update
 * button that offered it would simply fail. Say which is which instead.
 */
function listInstalledPacks(comfyRoot) {
    const dir = comfyRoot ? path.join(comfyRoot, 'custom_nodes') : null;
    if (!dir || !fs.existsSync(dir)) return [];
    const out = [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!e.isDirectory() || SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
        const abs = path.join(dir, e.name);
        const pack = {
            name: e.name,
            isGit: fs.existsSync(path.join(abs, '.git')),
            remote: null,
            hasRequirements: fs.existsSync(path.join(abs, 'requirements.txt')),
            disabled: fs.existsSync(path.join(abs, '.disabled')),
        };
        if (pack.isGit) {
            try {
                const cfg = fs.readFileSync(path.join(abs, '.git', 'config'), 'utf8');
                const m = cfg.match(/\[remote "origin"\][^[]*?url\s*=\s*(\S+)/);
                if (m) pack.remote = m[1];
            } catch { /* a worktree or a packed config; the name is enough */ }
        }
        out.push(pack);
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Every class_type a bundle's RUNNABLE graph asks for. */
function classesInGraph(graph) {
    const out = new Set();
    for (const node of Object.values(graph || {})) {
        if (node && typeof node.class_type === 'string') out.add(node.class_type);
    }
    return out;
}

/**
 * The classes this ComfyUI can provide.
 *
 * @param {object} opts
 * @param {object} [opts.objectInfo]   a live /object_info payload, if the caller has one
 * @param {boolean} [opts.allowCache]  fall back to the audit's copy (default true)
 */
function availableClasses({ objectInfo = null, allowCache = true } = {}) {
    if (objectInfo && typeof objectInfo === 'object') {
        const names = Object.keys(objectInfo);
        if (names.length) return { classes: new Set(names), source: 'live', at: null };
    }
    if (allowCache && fs.existsSync(CACHED_OBJECT_INFO)) {
        try {
            const raw = JSON.parse(fs.readFileSync(CACHED_OBJECT_INFO, 'utf8'));
            return {
                classes: new Set(Object.keys(raw)),
                source: 'cache',
                at: fs.statSync(CACHED_OBJECT_INFO).mtimeMs,
            };
        } catch { /* a torn cache is the same as none */ }
    }
    return { classes: null, source: 'none', at: null };
}

/**
 * What a set of bundles needs that this machine cannot provide.
 *
 * ⚠ With no class list at all the answer is UNKNOWN, never "nothing missing":
 * reporting a fresh rig as ready because ComfyUI happened to be down is the one
 * wrong answer this must not give.
 *
 * @returns {{
 *   known: boolean,
 *   source: 'live'|'cache'|'none',
 *   cachedAt: number|null,
 *   missingByBundle: Object<string, string[]>,   bundle id -> missing classes
 *   packs: Array<{url, title, classes: string[], bundles: string[], installed: boolean}>,
 *   unknownClasses: Array<{name, bundles: string[]}>,
 *   mapSource: string|null,
 *   mapAt: number|null,
 * }}
 */
function missingNodePacks(bundles, comfyRoot, opts = {}) {
    const key = JSON.stringify([comfyRoot, bundles.map(b => b.id), !!opts.objectInfo]);
    if (_cache.value && _cache.key === key && (Date.now() - _cache.at) < TTL_MS) return _cache.value;

    const { classes, source, at } = availableClasses(opts);
    const index = readClassIndex(comfyRoot);
    const installed = new Set(listInstalledPacks(comfyRoot).map(p => p.name.toLowerCase()));

    const out = {
        known: !!classes,
        source,
        cachedAt: at,
        missingByBundle: {},
        packs: [],
        unknownClasses: [],
        mapSource: index.source,
        mapAt: index.mtime,
    };
    if (!classes) { _cache = { key, at: Date.now(), value: out }; return out; }

    const byPack = new Map();      // url -> { url, title, classes:Set, bundles:Set }
    const unknown = new Map();     // class -> Set(bundle)

    for (const b of bundles) {
        const wanted = classesInGraph(b.graph);
        const miss = [...wanted].filter(c => !classes.has(c)).sort();
        if (!miss.length) continue;
        out.missingByBundle[b.id] = miss;
        for (const c of miss) {
            const hit = index.byClass.get(c);
            if (!hit) {
                if (!unknown.has(c)) unknown.set(c, new Set());
                unknown.get(c).add(b.id);
                continue;
            }
            if (!byPack.has(hit.url)) {
                byPack.set(hit.url, { url: hit.url, title: hit.title, classes: new Set(), bundles: new Set() });
            }
            byPack.get(hit.url).classes.add(c);
            byPack.get(hit.url).bundles.add(b.id);
        }
    }

    out.packs = [...byPack.values()].map(p => ({
        url: p.url,
        title: p.title,
        folder: repoName(p.url),
        classes: [...p.classes].sort(),
        bundles: [...p.bundles].sort(),
        // A pack whose folder is already there but whose class is absent is a
        // DIFFERENT problem from a missing pack -- it failed to import, or it is
        // installed under another name. Cloning again would not fix it.
        installed: installed.has(repoName(p.url).toLowerCase()),
    })).sort((a, b) => b.bundles.length - a.bundles.length);

    out.unknownClasses = [...unknown.entries()]
        .map(([name, who]) => ({ name, bundles: [...who].sort() }))
        .sort((a, b) => a.name.localeCompare(b.name));

    _cache = { key, at: Date.now(), value: out };
    return out;
}

/**
 * Read a pack's requirements.txt and flag the lines that have broken this
 * install before, so an admin decides about pip rather than discovering it.
 */
function readRequirements(absPackDir) {
    const p = path.join(absPackDir, 'requirements.txt');
    if (!fs.existsSync(p)) return { exists: false, lines: [], risky: [] };
    let text = '';
    try { text = fs.readFileSync(p, 'utf8'); } catch { return { exists: false, lines: [], risky: [] }; }
    const lines = text.split(/\r?\n/).map(l => l.trim())
        .filter(l => l && !l.startsWith('#'));
    const risky = lines.filter(l => {
        const name = l.split(/[<>=!~[; ]/)[0].toLowerCase();
        return RISKY_REQUIREMENTS.includes(name);
    });
    return { exists: true, lines, risky };
}

function invalidateNodePacks() { _cache = { key: null, at: 0, value: null }; }

module.exports = {
    listInstalledPacks,
    missingNodePacks,
    availableClasses,
    classesInGraph,
    readClassIndex,
    readRequirements,
    repoName,
    invalidateNodePacks,
    RISKY_REQUIREMENTS,
    CACHED_OBJECT_INFO,
};
