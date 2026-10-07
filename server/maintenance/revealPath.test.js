const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// The reveal route hands a path to the operating system on a machine whose admin
// routes fail open when no password is set. So the guard is the feature: what it
// REFUSES matters more than what it opens, and none of these cases spawns anything —
// every one is rejected before the spawn.

const { revealPath, allowedRoots, isInside } = require('./revealPath');

let pass = 0;
const ok = (what, cond) => { assert.ok(cond, what); pass++; console.log(`  ok  ${what}`); };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'comfyq-reveal-'));
const comfy = path.join(tmp, 'ComfyUI');
// Truly outside, in its own temp tree. A sibling of the install is refused too now,
// but a separate tree makes the intent unambiguous.
const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'comfyq-outside-'));
fs.mkdirSync(path.join(comfy, 'models'), { recursive: true });
const inside = path.join(comfy, 'models', 'a.safetensors');
fs.writeFileSync(inside, 'x');
const stray = path.join(outside, 'secret.txt');
fs.writeFileSync(stray, 'x');

const config = { comfy_ui: { root_path: comfy }, assets: { dir: path.join(tmp, 'assets') } };

console.log('\nwhat it refuses, which is the point');
ok('an empty path', revealPath('', config).ok === false);
ok('a path outside every configured folder',
    revealPath(stray, config).ok === false
    && /outside the folders/.test(revealPath(stray, config).error));
ok('a file that is not there', revealPath(path.join(comfy, 'models', 'ghost.bin'), config).ok === false);
// ★ A newline or NUL would let a crafted value run past the argument on some
// platforms; refused before anything is spawned.
ok('a path containing a newline', revealPath(`${inside}\nnotepad`, config).ok === false);
ok('a path containing a NUL', revealPath(`${inside}\0`, config).ok === false);
ok('a traversal that climbs out', revealPath(path.join(comfy, '..', '..', 'Windows', 'System32'), config).ok === false);
ok('a Windows system path', revealPath('C:\\Windows\\System32\\cmd.exe', config).ok === false);
ok('a UNC path to another machine', revealPath('\\\\evil-host\\share\\x.txt', config).ok === false);

console.log('\nwhat it allows');
// ⚠ These DO spawn the file browser on this machine, so only the decision is tested
// here, through the same predicates the route uses.
const roots = allowedRoots(config);
ok('the install root is allowed', roots.some(r => r === path.resolve(comfy)));
// ★ python_embeded, but NOT the whole parent — allowing `<root>/..` admitted
// everything beside the install, which on this rig is the entire portable folder.
ok('python_embeded is allowed and the bare parent is not',
    roots.some(r => r === path.resolve(comfy, '..', 'python_embeded'))
    && !roots.some(r => r === path.resolve(comfy, '..')));
ok('the repo itself is allowed', roots.some(r => r === path.resolve(__dirname, '..', '..')));
ok('a file under models/ is inside an allowed root', roots.some(r => isInside(r, inside)));
ok('the stray file is inside none of them', !roots.some(r => isInside(r, stray)));
ok('isInside is not fooled by a shared prefix',
    !isInside(path.join(tmp, 'Comfy'), path.join(tmp, 'ComfyUI', 'x')));
ok('a configured scan dir is allowed',
    allowedRoots({ ...config, maintenance: { workflowScanDirs: [outside] } })
        .some(r => r === path.resolve(outside)));
ok('no install configured still yields the repo, not everything',
    allowedRoots({}).length >= 1 && allowedRoots({}).every(r => path.isAbsolute(r)));

fs.rmSync(tmp, { recursive: true, force: true });
fs.rmSync(outside, { recursive: true, force: true });
console.log(`\nrevealPath: all ${pass} checks passed`);
