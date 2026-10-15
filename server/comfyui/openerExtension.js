const fs = require('fs');
const path = require('path');

// The ComfyQ opener is a tiny frontend-only ComfyUI extension (see ./opener)
// that auto-opens a workflow passed via `?comfyq_open=<name>`. We install it
// into the user's ComfyUI `custom_nodes` so "Open in ComfyUI" can hand over the
// editable graph directly instead of asking the admin to pick it from a menu.
//
// Bump OPENER_VERSION whenever ./opener changes so installs refresh (and callers
// know to restart a running ComfyUI to pick up the new web asset).
// 4: __init__.py gained the model-access recorder — see opener/__init__.py.
//    ⚠ A bump needs a ComfyUI restart to take effect (the admin's own
//    "Activate & serve" performs one), and for the JS half a browser
//    hard-refresh, because the module is HTTP-cached.
// 5: waits for ComfyUI's own session restore to settle, then checks the canvas
//    really holds the staged graph — on a slow machine the restore landed after
//    the load and showed the previous workflow under this one's name. And the
//    script is now installed under a VERSIONED file name: ComfyUI lists web
//    extensions per request, so a new version is a new URL and no browser can
//    keep running a cached old one (the hard refresh this note used to ask for).
// 6: a reload after a lost race writes into OUR tab instead of opening "name (2)".
const OPENER_VERSION = '6';
const SRC = path.join(__dirname, 'opener');
const DEST_NAME = 'comfyq_opener';

// Ensure the extension is present + current in <comfyRoot>/custom_nodes.
// Returns { wrote } — `wrote:true` means files changed, so a *running* ComfyUI
// must be restarted to load them (custom_node web dirs are scanned at startup).
function ensureInstalled(comfyRoot) {
    if (!comfyRoot) throw new Error('ComfyUI root path is required to install the opener extension');
    const dest = path.join(comfyRoot, 'custom_nodes', DEST_NAME);
    const verFile = path.join(dest, '.comfyq_version');
    let current = null;
    try { current = fs.readFileSync(verFile, 'utf8').trim(); } catch { /* not installed yet */ }
    if (current === OPENER_VERSION) return { wrote: false, dir: dest };

    const jsDir = path.join(dest, 'js');
    fs.mkdirSync(jsDir, { recursive: true });
    fs.copyFileSync(path.join(SRC, '__init__.py'), path.join(dest, '__init__.py'));
    // Exactly one script, under this version's name: two would both run.
    const script = `comfyq_opener_v${OPENER_VERSION}.js`;
    for (const n of fs.readdirSync(jsDir)) {
        if (n.endsWith('.js') && n !== script) fs.rmSync(path.join(jsDir, n), { force: true });
    }
    fs.copyFileSync(path.join(SRC, 'js', 'comfyq_opener.js'), path.join(jsDir, script));
    fs.writeFileSync(verFile, OPENER_VERSION);
    return { wrote: true, dir: dest };
}

module.exports = { ensureInstalled, OPENER_VERSION };
