const fs = require('fs');
const path = require('path');

// Copies of a bundle's template that "Open in ComfyUI" left in a ComfyUI
// user-workflows folder.
//
// Staging writes `<id>_template.json` (before 2026-07-01: `<id>.json`) into the
// install's user/default/workflows, or a lane's own user folder. Once the bundle
// is deleted, that copy is the one thing still naming its models, so the prune
// tool would protect them for ever — the Ideogram 4 bundle's two UNETs are held
// exactly this way on the rig this was written on.
//
// ★ Only a copy whose GRAPH is still the bundle's own is ours to remove. ComfyUI
// re-serialises a file it opens (view position, workflow id), so bytes are the
// wrong test; nodes, their widget values, their mode and the links are the right
// one. A copy somebody edited is their work: it is kept and named.

/**
 * A comparable summary of a UI-format graph, or null when there is no UI graph
 * to compare. ★ Null is never a match: two empty fingerprints are equal, which
 * would read an unrelated API-format file as "unchanged" and delete it.
 */
function graphFingerprint(g) {
    if (!g || typeof g !== 'object') return null;
    if (!Array.isArray(g.nodes) || !g.nodes.length) return null;
    const nodes = g.nodes
        .map(n => [n.id, n.type, JSON.stringify(n.widgets_values ?? null), n.mode ?? 0])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    const links = (Array.isArray(g.links) ? g.links : []).map(l => JSON.stringify(l)).sort();
    const subs = (g.definitions?.subgraphs || []).map(sg => graphFingerprint(sg) || '').sort();
    return JSON.stringify({ nodes, links, subs });
}

function fingerprintFile(file) {
    try { return graphFingerprint(JSON.parse(fs.readFileSync(file, 'utf8'))); } catch { return null; }
}

/**
 * Where a bundle's staged copies can be.
 *
 * @param {string} id
 * @param {string} comfyRoot
 * @param {string} lanesRoot   <repo>/.comfyq-lanes — a lane that once served the
 *                             bundle has its own user folder per profile
 */
function stagedCopiesOf(id, { comfyRoot, lanesRoot, templateFingerprint }) {
    const dirs = [];
    if (comfyRoot) dirs.push(path.join(comfyRoot, 'user', 'default', 'workflows'));
    if (lanesRoot) {
        const laneUser = path.join(lanesRoot, id, 'user');
        try {
            for (const prof of fs.readdirSync(laneUser)) dirs.push(path.join(laneUser, prof, 'workflows'));
        } catch { /* no lane ever served it */ }
    }
    const out = [];
    for (const dir of dirs) {
        for (const name of [`${id}_template.json`, `${id}.json`]) {
            const file = path.join(dir, name);
            if (!fs.existsSync(file)) continue;
            const fp = fingerprintFile(file);
            out.push({ file, unchanged: !!templateFingerprint && fp === templateFingerprint });
        }
    }
    return out;
}

/** The fingerprint of a bundle folder's template, or null when it has none. */
function bundleTemplateFingerprint(bundleDir) {
    let names = [];
    try { names = fs.readdirSync(bundleDir); } catch { return null; }
    const id = path.basename(bundleDir);
    // The canonical name first; the registry's fallback (any *template.json) after.
    const pick = names.includes(`${id}_template.json`) ? `${id}_template.json`
        : names.find(n => n.endsWith('template.json'));
    return pick ? fingerprintFile(path.join(bundleDir, pick)) : null;
}

/**
 * Remove the unchanged copies, keep and report the edited ones.
 * @returns {{ removed: string[], kept: string[] }}
 */
function removeStagedCopies(copies) {
    const removed = [], kept = [];
    for (const c of copies) {
        if (!c.unchanged) { kept.push(c.file); continue; }
        try { fs.rmSync(c.file); removed.push(c.file); } catch { kept.push(c.file); }
    }
    return { removed, kept };
}

module.exports = { graphFingerprint, stagedCopiesOf, bundleTemplateFingerprint, removeStagedCopies };
