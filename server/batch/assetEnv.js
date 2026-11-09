// assetEnv — what a batch plan may read from the assets folder.
//
// Every name a table gives is relative to the assets folder and must stay in
// it: the real path of what it names is checked, so neither "..", a full path
// nor a link inside the folder can reach a file elsewhere. Read only; nothing
// here writes.

const fs = require('fs');
const path = require('path');

const MAX_TEXT_BYTES = 256 * 1024;

function assetEnv(assetsDir) {
    if (!assetsDir) {
        return { assetExists: () => false, listAssets: () => null, readText: () => null, catalog: () => ({ files: [], folders: [], truncated: false }), dir: null };
    }
    let root;
    try { root = fs.realpathSync(assetsDir); } catch { root = null; }

    // The real path of a name, or null when it is missing or leaves the folder.
    const inside = (name) => {
        if (!root || !name || path.isAbsolute(name)) return null;
        let real;
        try { real = fs.realpathSync(path.join(root, name)); } catch { return null; }
        const rel = path.relative(root, real);
        if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
        return real;
    };
    const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };

    return {
        dir: root,
        assetExists: (name) => { const p = inside(name); return !!p && isFile(p); },
        // Files only, not folders below; hidden files left out.
        listAssets: (dir) => {
            const p = dir ? inside(dir) : root;
            if (!p) return null;
            try {
                return fs.readdirSync(p, { withFileTypes: true })
                    .filter(d => d.isFile() && !d.name.startsWith('.'))
                    .map(d => d.name);
            } catch { return null; }
        },
        // What the batch editor's picker offers: files of a kind it can use, and
        // the folders holding them, a few levels deep. Capped, so a huge assets
        // folder cannot freeze the page; `truncated` says when the cap was hit.
        //   → { files: [{ path, kind }], folders: [{ path, counts: { image: n, … } }], truncated }
        catalog: ({ maxDepth = 3, maxFiles = 3000, classify } = {}) => {
            const files = [];
            const folders = [];
            let truncated = false;
            const walk = (rel, depth) => {
                let entries;
                try { entries = fs.readdirSync(rel ? path.join(root, rel) : root, { withFileTypes: true }); } catch { return; }
                const counts = {};
                for (const d of entries.sort((a, b) => a.name.localeCompare(b.name))) {
                    if (d.name.startsWith('.')) continue;
                    const p = rel ? `${rel}/${d.name}` : d.name;
                    if (d.isDirectory()) { if (depth < maxDepth) walk(p, depth + 1); continue; }
                    if (!d.isFile()) continue;
                    const kind = classify ? classify(d.name) : null;
                    if (!kind) continue;
                    counts[kind] = (counts[kind] || 0) + 1;
                    if (files.length >= maxFiles) { truncated = true; continue; }
                    files.push({ path: p, kind });
                }
                if (rel && Object.keys(counts).length) folders.push({ path: rel, counts });
            };
            if (root) walk('', 0);
            folders.sort((a, b) => a.path.localeCompare(b.path));
            return { files, folders, truncated };
        },
        readText: (name) => {
            const p = inside(name);
            if (!p || !isFile(p) || fs.statSync(p).size > MAX_TEXT_BYTES) return null;
            return fs.readFileSync(p, 'utf8').replace(/^﻿/, '').replace(/\r\n/g, '\n').trimEnd();
        },
    };
}

module.exports = { assetEnv, MAX_TEXT_BYTES };
