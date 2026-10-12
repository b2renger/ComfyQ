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

fs.rmSync(dir, { recursive: true, force: true });
console.log(`configManager: all ${ok.length} checks passed (a cloned-from drive stood in as ${gone}:)`);
