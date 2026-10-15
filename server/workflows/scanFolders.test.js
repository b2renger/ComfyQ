// scanFolders — which workflow folders count, and which the admin switched off.
// Switching one off changes what the prune tool will offer, so the mapping from
// config to engine options is pinned here case by case.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { scanSetup, cleanOffList } = require('./scanFolders');

let pass = 0;
const ok = (what, cond) => { assert.ok(cond, what); pass++; };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'comfyq-scanfolders-'));
const repo = path.join(tmp, 'ComfyQ');
const comfy = path.join(tmp, 'ComfyUI');
fs.mkdirSync(path.join(repo, 'workflows', '_candidate_workflows'), { recursive: true });
fs.mkdirSync(path.join(comfy, 'user', 'default', 'workflows'), { recursive: true });
fs.mkdirSync(path.join(tmp, 'demo'), { recursive: true });
const userWf = path.join(comfy, 'user', 'default', 'workflows');
const demoAbs = path.join(tmp, 'demo');

const cfg = (maintenance) => ({ comfy_ui: { root_path: comfy }, maintenance });

// Everything on — what an existing config.json (no scanDirsOff) gets.
{
    const s = scanSetup(cfg({ workflowScanDirs: [demoAbs, '..\\relative_demo'] }), { repoRoot: repo });
    ok('the four built-in folders are listed', s.folders.filter(f => f.kind === 'default').length === 4);
    ok('the bundles are locked on', s.folders.find(f => f.key === 'bundles').locked === true);
    ok('custom folders are listed after them', s.folders.filter(f => f.kind === 'custom').length === 2);
    ok('a relative entry resolves against the ComfyUI root',
        s.folders.find(f => f.entry === '..\\relative_demo').path === path.resolve(comfy, '..\\relative_demo'));
    ok('a missing folder is reported as such', s.folders.find(f => f.entry === '..\\relative_demo').exists === false);
    ok('with nothing off: custom folders and ComfyUI\'s own are scanned',
        s.usageOpts.extraDirs.includes(demoAbs) && s.usageOpts.extraDirs.includes(userWf));
    ok('...nothing is excluded', s.usageOpts.excludedDirs.length === 0);
    ok('...candidates and lanes are included', s.usageOpts.includeCandidates && s.usageOpts.includeLanes);
}

// Switching things off.
{
    const s = scanSetup(cfg({
        workflowScanDirs: [demoAbs],
        scanDirsOff: [demoAbs, 'comfyui-user', 'candidates', 'lanes', 'bundles'],
    }), { repoRoot: repo });
    ok('a custom folder switched off is excluded, not dropped',
        !s.usageOpts.extraDirs.includes(demoAbs) && s.usageOpts.excludedDirs.includes(demoAbs));
    ok('ComfyUI\'s own folder switched off is excluded', s.usageOpts.excludedDirs.includes(userWf)
        && !s.usageOpts.extraDirs.includes(userWf));
    ok('candidates and lanes switched off', !s.usageOpts.includeCandidates && !s.usageOpts.includeLanes);
    ok('the bundles cannot be switched off, even by a hand-edited config',
        s.folders.find(f => f.key === 'bundles').on === true);
    ok('every custom entry still counts as configured (the admin DID configure it)',
        s.configured.length === 1 && s.configured[0] === demoAbs);
}

// What the panel may store.
{
    const cleaned = cleanOffList(['bundles', 'candidates', 'comfyui-user', 'lanes', 'C:\\gone', 'D:\\kept', 'nonsense'], ['D:\\kept']);
    ok('the locked default is never stored as off', !cleaned.includes('bundles'));
    ok('the switchable defaults are kept', ['candidates', 'comfyui-user', 'lanes'].every(k => cleaned.includes(k)));
    ok('an off entry for a folder no longer listed is dropped', !cleaned.includes('C:\\gone'));
    ok('an off entry for a listed folder is kept', cleaned.includes('D:\\kept'));
    ok('an unknown key is dropped', !cleaned.includes('nonsense'));
    ok('duplicates collapse', cleanOffList(['lanes', 'lanes'], []).length === 1);
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`scanFolders: all ${pass} checks passed`);
