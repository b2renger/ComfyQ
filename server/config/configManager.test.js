// Does a configured folder follow the drive when this image is cloned to a
// machine that mounts it under a different letter?
// (node server/config/configManager.test.js)
//
// Worth a test because the code only ever runs on a cloned drive: it would
// otherwise sit unexercised until the one boot where it matters. And a scan
// folder is the path where being wrong is quiet — a folder that cannot be read
// makes every model only that folder references look UNUSED.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { followDriveLetter } = require('./configManager');

const ok = [];
const check = (label, cond) => { assert.ok(cond, label); ok.push(label); };

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'comfyq-drive-'));
const here = path.parse(dir).root.slice(0, 1);          // the letter the temp dir is on
const real = path.join(dir, 'demo_workflows');
fs.mkdirSync(real);

// A letter that is certainly not mounted stands in for the drive the image was
// cloned FROM.
const gone = ['Q', 'X', 'Y', 'Z'].find((L) => !fs.existsSync(`${L}:\\`)) || 'Q';
const stale = gone + real.slice(1);
const root = `${here}:\\ComfyUI_windows_portable\\ComfyUI`;

check('an entry whose drive is gone follows the detected drive',
    followDriveLetter([stale], root)[0] === real);

check('an entry that still resolves is returned untouched',
    followDriveLetter([real], root)[0] === real);

// The dangerous mistake would be inventing a path: a folder that is missing for
// some other reason must stay missing, so the scan reports it instead of
// silently scanning somewhere else.
const nowhere = gone + path.join(dir, 'never_existed').slice(1);
check('a folder missing for another reason is left to be reported',
    followDriveLetter([nowhere], root)[0] === nowhere);

check('a relative entry is untouched (it resolves against the ComfyUI root)',
    followDriveLetter(['../../_demo_workflows'], root)[0] === '../../_demo_workflows');

check('a UNC path is not treated as a drive letter',
    followDriveLetter(['\\\\server\\share\\workflows'], root)[0] === '\\\\server\\share\\workflows');

check('a junk entry cannot crash the boot',
    JSON.stringify(followDriveLetter([null, 42, real], root)) === JSON.stringify([null, 42, real]));

check('a POSIX install root rewrites nothing',
    followDriveLetter([stale], '/mnt/nvme/ComfyUI')[0] === stale);

check('an empty list is handled', followDriveLetter([], root).length === 0);
check('a missing list is handled', followDriveLetter(undefined, root) === undefined);

const said = [];
followDriveLetter([stale], root, (m) => said.push(m));
check('it says what it moved', said.length === 1 && said[0].includes(real));
followDriveLetter([real], root, (m) => said.push(m));
check('it says nothing when nothing moved', said.length === 1);

// Several entries at once, mixed: the one that can be followed is, the others
// are left exactly as they were.
const mixed = followDriveLetter([stale, real, nowhere, 'relative/dir'], root);
check('a mixed list is handled entry by entry',
    mixed[0] === real && mixed[1] === real && mixed[2] === nowhere && mixed[3] === 'relative/dir');

// ---- Which ComfyUI a clone picks up ----------------------------------------
// The drive ComfyQ runs from must be searched before the others. In C..Z order,
// a clone mounted as K: on a rig with its own D:\ComfyUI_windows_portable_nvidia
// was repointed at THAT install.
const { comfyCandidates, detectComfyPaths, writeAtomic, keepBrokenCopy } = require('./configManager');
const order = Array.from(comfyCandidates(['C', 'D', 'K'], 'K:\\ComfyQ', () => []));
const firstOn = (L) => order.findIndex(p => p.toUpperCase().startsWith(`${L}:`));
check('the install beside the checkout is tried first',
    order[0] === 'K:\\ComfyUI_windows_portable_nvidia\\ComfyUI_windows_portable\\ComfyUI');
check('ComfyQ\'s own drive comes before C: and D:', firstOn('K') < firstOn('C') && firstOn('K') < firstOn('D'));
check('C: still comes before D: after it, as before', firstOn('C') < firstOn('D'));
check('no path is tried twice', new Set(order.map(p => p.toLowerCase())).size === order.length);
const nested = Array.from(comfyCandidates(['C'], 'D:\\Work\\ComfyQ', () => []));
check('a checkout in a sub-folder looks beside itself first',
    nested[0] === 'D:\\Work\\ComfyUI_windows_portable_nvidia\\ComfyUI_windows_portable\\ComfyUI');
const listed = [];
const lazy = comfyCandidates(['C', 'D'], 'X:\\ComfyQ', (d) => { listed.push(d); return ['ComfyUI_other']; });
for (const p of lazy) { if (p.startsWith('C:')) break; }
check('a drive is only listed when the search reaches it', listed.length === 0 || (listed.length === 1 && listed[0] === 'C:\\'),
    JSON.stringify(listed));

if (process.platform === 'win32') {
    const fake = fs.mkdtempSync(path.join(os.tmpdir(), 'comfyq-detect-'));
    const root = path.join(fake, 'ComfyUI_windows_portable_nvidia', 'ComfyUI_windows_portable', 'ComfyUI');
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, 'main.py'), '');
    fs.mkdirSync(path.join(root, '..', 'python_embeded'), { recursive: true });
    fs.writeFileSync(path.join(root, '..', 'python_embeded', 'python.exe'), '');
    const found = detectComfyPaths({ projectRoot: path.join(fake, 'ComfyQ') });
    check('detect finds the install beside the checkout before scanning drives',
        found && found.root_path === root && found.installation_type === 'portable', JSON.stringify(found));
    fs.rmSync(fake, { recursive: true, force: true });
}

// ---- config.json is never lost to a typo or a power cut -------------------
const cfgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'comfyq-cfg-'));
const cfgFile = path.join(cfgDir, 'config.json');
writeAtomic(cfgFile, '{"a":1}');
check('an atomic write lands the content', fs.readFileSync(cfgFile, 'utf8') === '{"a":1}');
writeAtomic(cfgFile, '{"a":2}');
check('and replaces it', fs.readFileSync(cfgFile, 'utf8') === '{"a":2}');
check('no temporary file is left behind', !fs.existsSync(cfgFile + '.tmp'));
// The temporary file cannot be written (here a folder is in its way; on the
// rig, a full volume): the save fails and config.json keeps what it had.
fs.mkdirSync(cfgFile + '.tmp');
let tmpThrew = false;
try { writeAtomic(cfgFile, '{"a":3}'); } catch { tmpThrew = true; }
check('a temporary file that cannot be written fails the save', tmpThrew);
check('… and leaves config.json as it was', fs.readFileSync(cfgFile, 'utf8') === '{"a":2}');
fs.rmSync(cfgFile + '.tmp', { recursive: true, force: true });
fs.writeFileSync(cfgFile, '{"auth": {"adminPasswordHash": "x"},}');
const aside = keepBrokenCopy(cfgFile, 123);
check('a broken config.json is kept beside it', aside === cfgFile + '.broken-123.bak'
    && fs.readFileSync(aside, 'utf8').includes('adminPasswordHash'));
check('… under a name the repo ignores (it holds secrets)', /\.bak$/.test(aside));
check('nothing is kept when there is no file to keep', keepBrokenCopy(path.join(cfgDir, 'missing.json')) === null);
fs.rmSync(cfgDir, { recursive: true, force: true });

fs.rmSync(dir, { recursive: true, force: true });
console.log(`configManager: all ${ok.length} checks passed (a cloned-from drive stood in as ${gone}:)`);
