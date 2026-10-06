const fs = require('fs');
const path = require('path');
const { refsInGraph } = require('./modelUsage');

// How sure are we that a model is really safe to delete?
//
// "Nothing references it" is a weaker statement than it looks, and this project
// has the scars to prove it: a 1.82 GB LoRA sat on the delete list while two
// templates loaded it through a field the scan did not read, and a 0.23 GB VAE
// was actually deleted because the scan did not descend into subgraphs. Both
// bugs are fixed — and both would have been caught earlier by a reader who was
// told "this looks like another build of a file that IS used".
//
// ★ So the score is not a number anybody has to trust: every verdict carries
// the named reasons behind it, and the UI shows them. A score you cannot
// interrogate is worse than no score, because it converts doubt into a
// comforting badge.
//
//   high    nothing anywhere refers to it, nothing resembles it, nobody has
//           touched it lately, and the scan saw every folder it was told about
//   medium  safe as far as we can tell, but something about it deserves a look
//   low     actively suspicious — do not bulk-select these

// Tokens that distinguish one BUILD of a model from another rather than one
// model from another. Stripping them gives a "family" key, so
// `..._turbo_8step_v1.0_comfyui_bf16` and `..._turbo_4step_v1.0_768p_comfyui_bf16`
// collapse to the same family — which is exactly the pair that nearly cost us
// 1.82 GB.
const VARIANT_TOKENS = [
    'fp8', 'fp16', 'fp32', 'bf16', 'int8', 'int4', 'nvfp4', 'awq', 'gptq',
    'e4m3fn', 'e5m2', 'mixed', 'scaled', 'convrot', 'pruned', 'quantized',
    'distilled', 'turbo', 'lightning', 'lightx2v', 'comfyui', 'comfy', 'kj',
    'sharp', 'ema', 'dev', 'base', 'full', 'small', 'medium', 'large', 'xl',
    'step', 'steps', 'rank', 'alpha', 'lora', 'v', 'ver', 'version',
    // `landmark_model.pth` and `landmark.onnx` are one model in two formats;
    // without this they key apart and neither warns about the other.
    'model', 'weights', 'ckpt', 'checkpoint',
    'q2k', 'q3km', 'q4km', 'q4_0', 'q5km', 'q6k', 'q8_0', 'gguf',
    '480p', '576p', '720p', '768p', '1024', '1080p', '2k', '4k',
];
const VARIANT_RX = new RegExp(`^(?:${VARIANT_TOKENS.join('|')})$`, 'i');

// Basenames too generic for a by-filename match to mean anything. A repo that
// ships `model.safetensors` gives no way to tell one copy from another.
const GENERIC_NAMES = new Set([
    'model.safetensors', 'model.bin', 'model.pt', 'model.pth', 'model.ckpt',
    'diffusion_pytorch_model.safetensors', 'diffusion_pytorch_model.bin',
    'pytorch_model.bin', 'pytorch_model.safetensors',
    'weights.safetensors', 'weights.pth', 'checkpoint.safetensors',
    'adapter_model.safetensors', 'open_clip_pytorch_model.safetensors',
]);

const RECENT_DAYS = 30;

/** A family key: the stem with build/precision/size tokens and bare numbers removed. */
function familyKey(name) {
    const stem = String(name).replace(/\.[^.]+$/, '').toLowerCase();
    const parts = stem.split(/[^a-z0-9]+/i).filter(Boolean);
    const kept = parts.filter(p => !VARIANT_RX.test(p) && !/^\d+$/.test(p)
        // "4step", "8steps", "v1", "rank256", "x2"
        && !/^\d+(step|steps|px|k|b)$/i.test(p)
        && !/^v\d/i.test(p) && !/^x\d+$/i.test(p))
        // ★ Only NOW strip a version digit glued to a word: `wan2` -> `wan`.
        // Doing it before the filter would turn `bf16` into `bf` + `16`, and `bf`
        // is not in the variant list, so the precision token would survive and
        // split families that used to group — measured against the audit's own
        // BUILD clustering, that dropped agreement from 24 of 27 pairs to 7.
        //
        // The case this fixes is `wan_2.1_vae` against `Wan2.1_VAE`: one model
        // written two ways, keyed `wan-vae` against `wan2-vae`, so neither
        // carried a variant-sibling warning. It deliberately OVER-groups — flux1
        // and flux2 key alike, and they are different models. That is the safe
        // direction: the warning forces confidence DOWN, so a false sibling
        // costs a sentence of noise, while a missed one can let the wrong half
        // of a pair be deleted.
        .map(p => p.replace(/\d+$/, '') || p);
    return kept.join('-');
}

let _refCache = { root: null, at: 0, names: null };
const REF_TTL_MS = 10 * 60 * 1000;

/**
 * Weight filenames mentioned by material that SHIPS with ComfyUI rather than by
 * anything on this rig: the bundled workflow templates, each node pack's own
 * example workflows, and ComfyUI's blueprints.
 *
 * ★ These do NOT make a model "used" — a bundled template names a model whether
 * or not you have it, and treating them as uses would move 408 of the 479 GB
 * off the delete list and gut the tool. But they are the EXPLANATION for why a
 * file is on the disk at all: somebody opened a built-in template and let it
 * download. Deleting one is fine; it just means that template needs its model
 * again. Worth knowing before you delete 40 GB, so it lowers confidence to
 * medium rather than hiding the row.
 *
 * ~1070 files and ~820 ms on this rig, so it is cached for ten minutes.
 */
function referenceNames(comfyRoot) {
    const root = comfyRoot ? path.resolve(comfyRoot) : null;
    if (_refCache.names && _refCache.root === root && (Date.now() - _refCache.at) < REF_TTL_MS) {
        return _refCache.names;
    }
    const names = new Map();   // folded name -> which source mentioned it
    if (!root) return names;

    const SKIP = new Set(['.git', 'node_modules', '__pycache__', '.cache', '__manager']);
    const walk = (dir, out = []) => {
        let entries = [];
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
        for (const e of entries) {
            const p = path.join(dir, e.name);
            if (e.isDirectory()) { if (!SKIP.has(e.name.toLowerCase())) walk(p, out); }
            else if (e.name.endsWith('.json')) out.push(p);
        }
        return out;
    };

    const sources = [
        ['a ComfyUI built-in template', path.resolve(root, '..', 'python_embeded', 'Lib',
            'site-packages', 'comfyui_workflow_templates_json')],
        ['a ComfyUI blueprint', path.join(root, 'blueprints')],
        ["a node pack's own example workflow", path.join(root, 'custom_nodes')],
    ];
    for (const [label, dir] of sources) {
        if (!fs.existsSync(dir)) continue;
        for (const p of walk(dir)) {
            let graph;
            try { graph = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { continue; }
            for (const [name] of refsInGraph(graph)) {
                if (!names.has(name)) names.set(name, label);
            }
        }
    }
    _refCache = { root, at: Date.now(), names };
    return names;
}

/** The model audit's own written verdict per file, when it has been run here. */
function auditVerdicts(repoRoot) {
    const out = new Map();
    if (!repoRoot) return out;
    const p = path.join(repoRoot, 'tools', 'maintenance', 'model-audit', 'decisions.json');
    let doc;
    try { doc = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return out; }
    for (const m of doc.models || []) {
        if (!m?.name) continue;
        // ★ `final` BEFORE `classify`. The audit records its first-pass verdict in
        // `classify` and the verdict it reached AFTER challenging that pass in
        // `final` — build_csv.py:255 reads `final or classify` for exactly this
        // reason. Reading only `classify` meant we quoted the overturned opinion:
        // measured on this disk, 62 rows disagree, and 17 of them are unused
        // right now — 93.10 GB whose first pass said DELETE and whose settled
        // verdict says KEEP or REVIEW. Twelve sat at `medium`, which the prune
        // route does NOT gate, so the audit's own correction was being used as
        // an argument for deleting the files it had decided to save.
        out.set(String(m.name).toLowerCase(), {
            classify: String(m.final || m.classify || '').toUpperCase(),
            reason: m.reason || '',
        });
    }
    return out;
}

/**
 * Attach `confidence` and `confidenceReasons` to each model in a usage report.
 *
 * @param {object} report    what buildModelUsage returned (mutated in place)
 * @param {object} opts
 * @param {string} opts.comfyRoot
 * @param {string} [opts.repoRoot]  for the audit's decisions.json
 * @param {number} [opts.now]       epoch ms, injected so a test is not clock-dependent
 */
function scoreDeletable(report, { comfyRoot, repoRoot, now = Date.now() } = {}) {
    const refs = referenceNames(comfyRoot);
    const audit = auditVerdicts(repoRoot);

    // Families of the files that ARE spoken for, so a lookalike can be spotted.
    const usedFamilies = new Map();
    for (const m of report.models) {
        if (m.unused) continue;
        const key = familyKey(m.name);
        if (!key) continue;
        if (!usedFamilies.has(key)) usedFamilies.set(key, []);
        usedFamilies.get(key).push(m.name);
    }
    // …and of what a loader wants but cannot find: a near-match there suggests
    // this file IS that model under a different spelling.
    const missingFamilies = new Map();
    for (const m of report.missing || []) {
        const key = familyKey(m.name);
        if (!key) continue;
        if (!missingFamilies.has(key)) missingFamilies.set(key, []);
        missingFamilies.get(key).push(m.name);
    }

    // ★ A scan that could not read a folder it was told about is wrong about
    // EVERY row, not just that folder's models — so this caps the whole report.
    const blind = [];
    if (report.scanned?.missingDirs?.length) {
        blind.push(`${report.scanned.missingDirs.length} configured folder(s) could not be read`);
    }
    // ★ Count what the ADMIN configured, not the array the route scans. The route
    // appends <comfyRoot>/user/default/workflows to `extraDirs` before handing it
    // over, and `scanned.configured` is built from that — so this clause could
    // never fire on any path that can move a file, which is the one path it was
    // written for. Measured: with the list empty, 5 more files (69.32 GB) read as
    // unused and not one of them carried a scan-incomplete reason. An empty list
    // is the NORMAL state of a freshly cloned rig, because config.json is
    // gitignored and per-machine.
    const configuredByAdmin = report.scanDirs || report.scanned?.configured || [];
    if (!configuredByAdmin.length) {
        blind.push('no extra workflow folders are configured, so only ComfyQ\'s own are covered');
    }

    for (const m of report.models) {
        if (!m.unused) { m.confidence = null; m.confidenceReasons = []; continue; }
        const reasons = [];
        const folded = m.name.toLowerCase();
        const key = familyKey(m.name);

        const sibling = (usedFamilies.get(key) || []).filter(n => n.toLowerCase() !== folded);
        if (sibling.length) {
            // ★ The wording matters as much as the signal. This used to read
            // "check you are not deleting the one a workflow actually wants",
            // which an admin resolves by keeping the build that IS in use and
            // deleting the lookalike — so the brake became the argument for
            // pulling the trigger. It did exactly that to ComfyUI-Trellis2's
            // 7.54 GB fp8 set, whose bf16 twins are in use and which the same
            // pack loads when you pick the other dropdown option. State the
            // fact and the risk; point at no conclusion.
            reasons.push({
                code: 'variant-sibling', effect: 'lowers',
                detail: `a different build of the same model is in use (${sibling.slice(0, 2).join(', ')}).`
                    + ' A node pack or a workflow setting can switch between builds, so this one may be'
                    + ' needed as well — find what loads it before deleting either.',
            });
        }
        const nearMissing = (missingFamilies.get(key) || []);
        if (nearMissing.length) {
            reasons.push({
                code: 'near-missing', effect: 'lowers',
                detail: `a workflow is asking for ${nearMissing[0]}, which it cannot find`
                    + ' — this file may be that model under a different name',
            });
        }
        // ★ Several copies of this basename on disk. Usage is matched by
        // basename, so a reference could have meant any of them — and the
        // report only describes one. Deleting the described copy can leave the
        // SAME high-confidence row pointing at the copy that is in use, which
        // is a two-step path to breaking a workflow.
        if ((m.otherCopies || []).length) {
            reasons.push({
                code: 'duplicate-basename', effect: 'lowers',
                detail: `this filename also exists at ${m.otherCopies.slice(0, 2).join(', ')}`
                    + ' — usage is matched by filename, so we cannot tell the copies apart',
            });
        }
        // ★ Read the row's own flag, not a second copy of the list. There WERE
        // two: modelUsage decided `genericName` and this read a set of its own,
        // so widening one left the other behind — `model.fp16.safetensors` was
        // flagged generic by the scan and still scored CONFIDENT here, which
        // made the force-low guard decorative for exactly the names it exists
        // for. The local set stays only as a fallback for a caller that hands us
        // rows from somewhere else.
        if (m.genericName || GENERIC_NAMES.has(folded)) {
            reasons.push({
                code: 'generic-name', effect: 'lowers',
                detail: 'the filename is too generic to match reliably: several repos ship a file'
                    + ' by this name, and usage here is matched by filename alone',
            });
        }
        const verdict = audit.get(folded);
        if (verdict && /KEEP|REVIEW|BUILD/.test(verdict.classify)) {
            reasons.push({
                code: 'audit-keep', effect: 'lowers',
                detail: `the model audit marked this ${verdict.classify}`
                    + (verdict.reason ? `: ${String(verdict.reason).slice(0, 180)}` : ''),
            });
        }

        const src = refs.get(folded);
        if (src) {
            reasons.push({
                code: 'reference-template', effect: 'lowers',
                detail: `named by ${src} — nothing on this machine uses it, but that is why it is`
                    + ' on the disk. Deleting it means that template needs the model again.',
            });
        }
        if (m.mtimeMs && (now - m.mtimeMs) < RECENT_DAYS * 86400000) {
            const days = Math.max(1, Math.round((now - m.mtimeMs) / 86400000));
            reasons.push({
                code: 'recently-added', effect: 'lowers',
                detail: `arrived ${days} day(s) ago — someone may be in the middle of using it`,
            });
        }
        for (const why of blind) {
            reasons.push({ code: 'scan-incomplete', effect: 'lowers', detail: why });
        }

        if (verdict && verdict.classify === 'DELETE') {
            reasons.push({
                code: 'audit-delete', effect: 'raises',
                detail: 'the model audit already judged this one deletable'
                    + (verdict.reason ? `: ${String(verdict.reason).slice(0, 180)}` : ''),
            });
        }

        const codes = new Set(reasons.filter(r => r.effect === 'lowers').map(r => r.code));
        // Doubt about WHICH file this is cannot be argued away by anything else.
        // ★ scan-incomplete is STRONG. It used to be soft, which resolved to
        // "medium" — and medium was ungated, so a scan that could not read a
        // folder it was told about still deleted. The comment above it always
        // claimed it capped the whole report; now it does.
        const strong = ['variant-sibling', 'near-missing', 'generic-name', 'audit-keep',
            'duplicate-basename', 'scan-incomplete'];
        const soft = ['reference-template', 'recently-added'];

        if (strong.some(c => codes.has(c))) m.confidence = 'low';
        else if (soft.some(c => codes.has(c))) m.confidence = 'medium';
        else m.confidence = 'high';

        if (m.confidence === 'high' && !reasons.length) {
            reasons.push({
                code: 'no-trace', effect: 'raises',
                detail: 'no workflow, template, LoRA dropdown or example graph on this machine'
                    + ' mentions it, and nothing on disk resembles it',
            });
        }
        m.confidenceReasons = reasons;
    }

    const unused = report.models.filter(m => m.unused);
    const tally = (level) => unused.filter(m => m.confidence === level);
    report.totals = {
        ...report.totals,
        confident: tally('high').length,
        confidentGb: +tally('high').reduce((t, m) => t + m.gb, 0).toFixed(2),
        unsure: tally('medium').length,
        unsureGb: +tally('medium').reduce((t, m) => t + m.gb, 0).toFixed(2),
        suspicious: tally('low').length,
        suspiciousGb: +tally('low').reduce((t, m) => t + m.gb, 0).toFixed(2),
    };
    report.scanned = { ...report.scanned, blind };
    return report;
}

function invalidateReferenceNames() { _refCache = { root: null, at: 0, names: null }; }

// name -> the audit's hand-written note on where the file came from. This is
// the field that makes a removal reversible, and it was being read for its
// verdict and then thrown away.
function auditRedownload(repoRoot) {
    const out = new Map();
    const p = path.join(repoRoot || '', 'tools', 'maintenance', 'model-audit', 'decisions.json');
    let doc;
    try { doc = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return out; }
    for (const m of doc.models || []) {
        const re = String(m?.redownload || '').trim();
        if (m?.name && re && !/^unknown/i.test(re)) out.set(String(m.name).toLowerCase(), re);
    }
    return out;
}

module.exports = {
    scoreDeletable, familyKey, referenceNames, auditVerdicts, auditRedownload,
    invalidateReferenceNames, GENERIC_NAMES,
};
