#!/usr/bin/env node
// Print the path to ComfyUI's bundled python, from ComfyQ's own config.
//
// AUDIT.bat needs the interpreter before it can run any Python, so it cannot
// ask comfyq_paths.py — and a .bat cannot read JSON. Node is already a hard
// requirement for ComfyQ, so this is the smallest reliable bridge.
// Prints nothing (and exits 1) when it cannot be determined, which is the
// caller's cue to fall back.
const fs = require('fs');
const path = require('path');

let dir = __dirname;
let root = null;
for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, 'package.json')) && fs.existsSync(path.join(dir, 'workflows'))) {
        root = dir;
        break;
    }
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
}

const candidates = [];
if (process.env.COMFY_ROOT) candidates.push(process.env.COMFY_ROOT);
if (root) {
    try {
        const cfg = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));
        if (cfg.comfy_ui?.root_path) candidates.push(cfg.comfy_ui.root_path);
    } catch { /* no config on this machine */ }
}

for (const c of candidates) {
    const py = path.resolve(c, '..', 'python_embeded', 'python.exe');
    if (fs.existsSync(py)) { console.log(py); process.exit(0); }
}
process.exit(1);
