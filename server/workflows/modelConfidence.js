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
        && !/^v\d/i.test(p) && !/^x\d+$/i.test(p));
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
        out.set(String(m.name).toLowerCase(), {
            classify: String(m.classify || '').toUpperCase(),
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
    if (!(report.scanned?.configured || []).length) {
        blind.push('no extra workflow folders are configured, so only ComfyQ\'s own are covered');
    }

    for (const m of report.models) {
        if (!m.unused) { m.confidence = null; m.confidenceReasons = []; continue; }
        const reasons = [];
        const folded = m.name.toLowerCase();
        const key = familyKey(m.name);

        const sibling = (usedFamilies.get(key) || []).filter(n => n.toLowerCase() !== folded);
        if (sibling.length) {
            reasons.push({
                code: 'variant-sibling', effect: 'lowers',
                detail: `looks like another build of ${sibling.slice(0, 2).join(', ')}, which is in use`
                    + ' — check you are not deleting the one a workflow actually wants',
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
        if (GENERIC_NAMES.has(folded)) {
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
        const strong = ['variant-sibling', 'near-missing', 'generic-name', 'audit-keep'];
        const soft = ['reference-template', 'recently-added', 'scan-incomplete'];

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

module.exports = { scoreDeletable, familyKey, referenceNames, auditVerdicts, GENERIC_NAMES };
