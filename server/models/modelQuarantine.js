const fs = require('fs');
const path = require('path');

// Pruning MOVES a model, it does not delete it.
//
// ★★ This is the change that makes the whole mechanism survivable. Every
// safeguard before it — the scan, the confidence score, the gate — reduces the
// chance of a wrong verdict; none of them makes a wrong verdict recoverable. A
// rename on the same volume is instant and costs no extra space, so there is no
// reason to pay for certainty with irreversibility.
//
// Two real incidents argue for it. A 0.23 GB VAE was deleted because the scan
// did not walk subgraphs; getting it back needed a lucky guess at the right
// HuggingFace repo. And ComfyUI-Trellis2's 7.54 GB fp8 set was offered with a
// reason that argued for deleting it — that one was caught, but only by a
// review that happened to run first.
//
// The layout mirrors the models tree so a restore is unambiguous:
//     <quarantine>/<ISO stamp>/<the file's path under models/>
// A stamped batch means two prunes of the same filename cannot collide, and the
// admin can see what went together.
//
// ★ Same volume on purpose: the quarantine sits beside the ComfyUI install, not
// in the repo, because moving 40 GB across volumes would be a copy — slow, and
// it could fill the disk the queue database lives on. This is also where
// _maintenance/model-audit/prune-models.ps1 already puts its own quarantine,
// so the two agree.

const DEFAULT_DIR_NAME = '_model_quarantine';

/** Where quarantined models go: config override, else beside the install. */
function quarantineRoot({ comfyRoot, configured }) {
    if (configured) return path.resolve(configured);
    if (!comfyRoot) return null;
    // <drive>\_model_quarantine — the same place prune-models.ps1 uses.
    return path.join(path.parse(path.resolve(comfyRoot)).root, DEFAULT_DIR_NAME);
}

/** True when both paths are on the same volume, so a move is a rename. */
function sameVolume(a, b) {
    return path.parse(path.resolve(a)).root.toLowerCase()
        === path.parse(path.resolve(b)).root.toLowerCase();
}

/**
 * Move one model out of the tree.
 *
 * @returns {{ok: boolean, to?: string, bytes?: number, error?: string}}
 */
function quarantineFile({ abs, rel, root, batch }) {
    if (!root) return { ok: false, error: 'no quarantine folder is configured' };
    // `rel` is models/<kind>/<name>; keep that shape under the batch.
    const target = path.join(root, batch, rel.split('/').join(path.sep));
    try {
        const bytes = fs.statSync(abs).size;
        fs.mkdirSync(path.dirname(target), { recursive: true });
        if (sameVolume(abs, target)) {
            fs.renameSync(abs, target);
        } else {
            // A different volume means a real copy. Do it, but verify the size
            // before unlinking the original — a truncated copy plus a deleted
            // source is the one outcome worse than not pruning at all.
            fs.copyFileSync(abs, target);
            if (fs.statSync(target).size !== bytes) {
                try { fs.rmSync(target); } catch { /* best effort */ }
                return { ok: false, error: 'the copy to quarantine came out the wrong size' };
            }
            fs.rmSync(abs);
        }
        return { ok: true, to: target, bytes };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

/** Everything currently held, newest batch first. */
function listQuarantine({ root }) {
    if (!root || !fs.existsSync(root)) return { root, batches: [], totalGb: 0 };
    const batches = [];
    let total = 0;
    for (const name of fs.readdirSync(root).sort().reverse()) {
        const dir = path.join(root, name);
        let st;
        try { st = fs.statSync(dir); } catch { continue; }
        if (!st.isDirectory()) continue;
        const files = [];
        const walk = (d) => {
            let entries = [];
            try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
            for (const e of entries) {
                const p = path.join(d, e.name);
                if (e.isDirectory()) { walk(p); continue; }
                let size = 0;
                try { size = fs.statSync(p).size; } catch { continue; }
                files.push({
                    rel: path.relative(dir, p).split(path.sep).join('/'),
                    gb: +(size / 1024 ** 3).toFixed(2),
                    bytes: size,
                });
                total += size;
            }
        };
        walk(dir);
        if (files.length) batches.push({ batch: name, files, gb: +(files.reduce((t, f) => t + f.bytes, 0) / 1024 ** 3).toFixed(2) });
    }
    return { root, batches, totalGb: +(total / 1024 ** 3).toFixed(2) };
}

/**
 * Put one file back where it came from.
 *
 * Refuses rather than overwrites: if something now occupies that path, the
 * admin should look before either copy is lost.
 */
function restoreFile({ root, batch, rel, comfyRoot }) {
    if (!root || !comfyRoot) return { ok: false, error: 'paths are not configured' };
    const from = path.join(root, batch, rel.split('/').join(path.sep));
    const back = path.resolve(comfyRoot, rel);
    const modelsRoot = path.resolve(comfyRoot, 'models');
    if (!back.startsWith(modelsRoot + path.sep)) {
        return { ok: false, error: 'that path is not inside the models folder' };
    }
    if (!fs.existsSync(from)) return { ok: false, error: 'not in quarantine' };
    if (fs.existsSync(back)) return { ok: false, error: 'a file is already at that path — look before replacing it' };
    try {
        fs.mkdirSync(path.dirname(back), { recursive: true });
        if (sameVolume(from, back)) fs.renameSync(from, back);
        else { fs.copyFileSync(from, back); fs.rmSync(from); }
        return { ok: true, to: `models/${rel.replace(/^models\//, '')}` };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

/** Finally let a batch go. This is the only irreversible step. */
function emptyBatch({ root, batch }) {
    if (!root || !batch) return { ok: false, error: 'paths are not configured' };
    const dir = path.join(root, batch);
    // Never follow a reparse point out of the quarantine: a junction here would
    // put rm -r on whatever it points at. CLAUDE.md records a junction once
    // pointing at the only copy of a node pack.
    let st;
    try { st = fs.lstatSync(dir); } catch { return { ok: false, error: 'no such batch' }; }
    if (st.isSymbolicLink()) return { ok: false, error: 'that path is a link, not a folder' };
    if (!path.resolve(dir).startsWith(path.resolve(root) + path.sep)) {
        return { ok: false, error: 'outside the quarantine folder' };
    }
    try {
        fs.rmSync(dir, { recursive: true, force: true });
        return { ok: true };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

module.exports = {
    quarantineRoot, quarantineFile, listQuarantine, restoreFile, emptyBatch,
    sameVolume, DEFAULT_DIR_NAME,
};
