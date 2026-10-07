const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// Open a file in the operating system's file browser, on the machine ComfyQ runs on.
//
// ★ Why a server route rather than a link. A browser cannot open a `file://` path
// from an http page — it has been blocked for years — so "make the paths clickable"
// has to be done by the host. The admin panel is also routinely opened from another
// computer (there is a Copy-admin-link button for exactly that), so this reveals the
// file on THE RIG's desktop, not the viewer's. That is the useful behaviour when you
// are sitting at the rig and the wrong one when you are not, so the UI offers Copy
// path beside it and says which machine it acts on.
//
// ⚠ It spawns a shell-less process with the path as a single argv entry, and refuses
// any path that does not sit inside one of the folders ComfyQ already works with.
// An admin button that took an arbitrary path and handed it to the OS would be a
// remote "open anything" on a machine whose admin routes fail open when no password
// is set.

/** The only places a revealable file can live. */
function allowedRoots(config) {
    const c = config || {};
    const root = c.comfy_ui?.root_path || '';
    const roots = [];
    if (root) {
        roots.push(root);
        // ★ The one sibling, not the whole parent. Allowing `<root>/..` admitted
        // everything sitting beside the install — on this rig that is the entire
        // ComfyUI_windows_portable folder, and on a layout where the install sits at
        // a drive root it would be the drive. Caught by the test that expected a
        // stray file to be refused and found it allowed.
        roots.push(path.resolve(root, '..', 'python_embeded'));
    }
    if (c.comfy_ui?.output_dir) roots.push(c.comfy_ui.output_dir);
    if (c.assets?.dir) roots.push(c.assets.dir);
    if (c.maintenance?.quarantineDir) roots.push(c.maintenance.quarantineDir);
    for (const d of (c.maintenance?.workflowScanDirs || [])) {
        roots.push(path.isAbsolute(d) ? d : path.resolve(root || '.', d));
    }
    roots.push(path.resolve(__dirname, '..', '..'));  // the repo itself
    return roots.filter(Boolean).map(r => path.resolve(r));
}

function isInside(parent, child) {
    const rel = path.relative(parent, child);
    return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * @returns {{ok: boolean, error?: string, path?: string, how?: string}}
 */
function revealPath(target, config) {
    const raw = String(target || '').trim();
    if (!raw) return { ok: false, error: 'no path given' };
    // Reject a path with a NUL or a newline before it reaches the OS.
    if (/[\0\r\n]/.test(raw)) return { ok: false, error: 'that is not a path' };

    let abs;
    try { abs = path.resolve(raw); } catch { return { ok: false, error: 'that is not a path' }; }

    const roots = allowedRoots(config);
    if (!roots.some(r => isInside(r, abs) || r === abs)) {
        return {
            ok: false,
            error: 'that file is outside the folders ComfyQ works with, so it will not be opened',
        };
    }
    let st;
    try { st = fs.statSync(abs); } catch { return { ok: false, error: 'that file is not on this machine any more' }; }

    // Select the file inside its folder where the platform can; otherwise open the
    // folder, which is still the thing someone wanted.
    const dir = st.isDirectory() ? abs : path.dirname(abs);
    try {
        if (process.platform === 'win32') {
            // explorer.exe returns a non-zero exit code even on success, so the exit
            // code is deliberately not checked.
            spawn('explorer.exe', st.isDirectory() ? [abs] : [`/select,${abs}`], {
                detached: true, stdio: 'ignore', windowsHide: false,
            }).unref();
            return { ok: true, path: abs, how: st.isDirectory() ? 'opened the folder' : 'selected the file' };
        }
        if (process.platform === 'darwin') {
            spawn('open', st.isDirectory() ? [abs] : ['-R', abs], { detached: true, stdio: 'ignore' }).unref();
            return { ok: true, path: abs, how: 'revealed in Finder' };
        }
        spawn('xdg-open', [dir], { detached: true, stdio: 'ignore' }).unref();
        return { ok: true, path: dir, how: 'opened the folder' };
    } catch (e) {
        return { ok: false, error: `could not open the file browser: ${e.message}` };
    }
}

module.exports = { revealPath, allowedRoots, isInside };
