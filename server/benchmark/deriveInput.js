// deriveInput — prepare an input with tools/test-suite/derive_input.py, through
// ComfyUI's own python (PIL, numpy, cv2 and av are there; nothing is added to
// ComfyQ). Used by the test suite's sweep and by a batch's staging, so a suite
// run and a batch prepare an input the same way.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const DERIVE_SCRIPT = path.resolve(__dirname, '..', '..', 'tools', 'test-suite', 'derive_input.py');
const VIDEO_OPS = new Set(['trim', 'vscale', 'vblur', 'mute', 'encode']);

// ComfyUI's python: the configured one, else the portable install's.
function comfyPython(config) {
    const root = config?.comfy_ui?.root_path || '';
    const exe = config?.comfy_ui?.python_executable || '';
    const cands = [];
    if (exe) cands.push(path.isAbsolute(exe) ? exe : path.resolve(root || '.', exe));
    if (root) cands.push(path.resolve(root, '..', 'python_embeded', 'python.exe'));
    return cands.find(p => { try { return fs.statSync(p).isFile(); } catch { return false; } }) || null;
}

// The extension the result gets: a clip when any step is a video step.
const derivedExt = (ops) => ((ops || []).some(o => VIDEO_OPS.has(o?.op)) ? 'mp4' : 'png');

// → the path written (dest), or rejects with the script's reason.
function deriveInput({ python, src, ops, dest, assetsDir = null, timeoutMs = 120000 }) {
    return new Promise((resolve, reject) => {
        if (!python || !fs.existsSync(DERIVE_SCRIPT)) return reject(new Error('ComfyUI\'s python or derive_input.py is missing'));
        // python_embeded pins sys.path (python312._pth): the script cannot import
        // its neighbours unless this bootstrap puts its folder on the path.
        const boot = "import runpy, sys, os; p = sys.argv[1]; "
            + "sys.path.insert(0, os.path.dirname(os.path.abspath(p))); "
            + "sys.argv = sys.argv[1:]; runpy.run_path(p, run_name='__main__')";
        let out = '', err = '';
        const child = spawn(python, ['-c', boot, DERIVE_SCRIPT], {
            env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' }, windowsHide: true,
        });
        const timer = setTimeout(() => { try { child.kill(); } catch { /* gone */ } reject(new Error('timed out')); }, timeoutMs);
        child.stdout.on('data', d => { out += d.toString('utf8'); });
        child.stderr.on('data', d => { err += d.toString('utf8'); });
        child.on('error', e => { clearTimeout(timer); reject(e); });
        child.on('close', () => {
            clearTimeout(timer);
            let res = null;
            try { res = JSON.parse(out); } catch { /* fall through */ }
            if (res?.ok && fs.existsSync(dest)) return resolve(dest);
            reject(new Error(res?.error || err.trim().split('\n').pop() || 'no result'));
        });
        try { child.stdin.write(JSON.stringify({ src, dest, ops, assets: assetsDir })); child.stdin.end(); } catch { /* closed */ }
    });
}

module.exports = { deriveInput, comfyPython, derivedExt, DERIVE_SCRIPT };
