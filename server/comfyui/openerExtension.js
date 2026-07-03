const fs = require('fs');
const path = require('path');

// The ComfyQ opener is a tiny frontend-only ComfyUI extension (see ./opener)
// that auto-opens a workflow passed via `?comfyq_open=<name>`. We install it
// into the user's ComfyUI `custom_nodes` so "Open in ComfyUI" can hand over the
// editable graph directly instead of asking the admin to pick it from a menu.
//
// Bump OPENER_VERSION whenever ./opener changes so installs refresh (and callers
// know to restart a running ComfyUI to pick up the new web asset).
const OPENER_VERSION = '3';
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

    fs.mkdirSync(path.join(dest, 'js'), { recursive: true });
    fs.copyFileSync(path.join(SRC, '__init__.py'), path.join(dest, '__init__.py'));
    fs.copyFileSync(path.join(SRC, 'js', 'comfyq_opener.js'), path.join(dest, 'js', 'comfyq_opener.js'));
    fs.writeFileSync(verFile, OPENER_VERSION);
    return { wrote: true, dir: dest };
}

module.exports = { ensureInstalled, OPENER_VERSION };
