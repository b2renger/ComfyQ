// The path check behind /images, /download and /media -- routes served with no
// password in both modes, so this check is all that keeps a request inside
// ComfyUI's output and temp folders.
// (node server/media/mediaStore.test.js)

const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');

// A lane's temp files live under COMFYQ_LANES_DIR when it is set (laneManager
// reads the same variable). Point it at a scratch folder BEFORE the module
// loads, so the test never reads the rig's real .comfyq-lanes and can check
// that every module agrees on where lanes are.
const lanesTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'comfyq-media-lanes-'));
fs.mkdirSync(path.join(lanesTmp, 'some_lane', 'temp'), { recursive: true });
fs.writeFileSync(path.join(lanesTmp, 'some_lane', 'temp', 'lane_preview.png'), 'lane');
process.env.COMFYQ_LANES_DIR = lanesTmp;

const { _resolveSafe, makeRouter, LANES_DIR: mediaLanesDir } = require('./mediaStore');
// The same folder is worked out in three places (here, the lane manager, and
// the launcher that records each ComfyUI's process); they must not drift apart.
const { LANES_DIR: laneManagerLanesDir } = require('../lanes/laneManager');
const { STATE_DIR: launcherStateDir } = require('../workers/comfyLauncher');

let fails = 0, passes = 0;
const check = (name, cond, extra = '') => {
    if (cond) { passes++; console.log('  ok   ' + name); }
    else { fails++; console.error('  FAIL ' + name + (extra ? '  ' + extra : '')); }
};

check('mediaStore, laneManager and comfyLauncher agree on the lanes folder',
    [mediaLanesDir, laneManagerLanesDir, launcherStateDir].every(d => d === path.resolve(lanesTmp)),
    JSON.stringify([mediaLanesDir, laneManagerLanesDir, launcherStateDir]));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'comfyq-media-'));
const comfyRoot = path.join(tmp, 'ComfyUI');
const output = path.join(comfyRoot, 'output');
fs.mkdirSync(path.join(output, 'audio'), { recursive: true });
fs.mkdirSync(path.join(comfyRoot, 'temp'), { recursive: true });
fs.mkdirSync(path.join(comfyRoot, 'output_old'), { recursive: true });
fs.writeFileSync(path.join(output, 'pic.png'), 'png');
fs.writeFileSync(path.join(output, 'audio', 'track.mp3'), 'mp3');
fs.writeFileSync(path.join(comfyRoot, 'output_old', 'secret.png'), 'secret');
fs.writeFileSync(path.join(comfyRoot, 'config.json'), '{}');

console.log('\n_resolveSafe');
check('a plain name resolves inside the root', _resolveSafe(output, 'pic.png') === path.join(output, 'pic.png'));
check('a subfolder name resolves inside the root', _resolveSafe(output, 'audio/track.mp3') === path.join(output, 'audio', 'track.mp3'));
check('an absolute path inside the root is allowed', _resolveSafe(output, path.join(output, 'pic.png')) === path.join(output, 'pic.png'));
check('".." is refused', _resolveSafe(output, '../config.json') === null);
check('an encoded ".." is refused', _resolveSafe(output, '%2e%2e%2fconfig.json') === null);
check('a twice-encoded ".." is only a literal name inside the root',
    String(_resolveSafe(output, '%252e%252e%252fconfig.json')).startsWith(output + path.sep));
check('an absolute path elsewhere is refused', _resolveSafe(output, path.join(comfyRoot, 'config.json')) === null);
check('a sibling folder sharing the root\'s name prefix is refused',
    _resolveSafe(output, path.join(comfyRoot, 'output_old', 'secret.png')) === null,
    String(_resolveSafe(output, path.join(comfyRoot, 'output_old', 'secret.png'))));
check('the root itself is not a file to serve', _resolveSafe(output, '.') === null && _resolveSafe(output, output) === null);
if (process.platform === 'win32') {
    check('a drive path is refused', _resolveSafe(output, 'C:/Windows/win.ini') === null);
    check('a UNC path is refused', _resolveSafe(output, '\\\\server\\share\\x.png') === null);
    check('a different letter case of the root still counts as inside (Windows)',
        _resolveSafe(output, path.join(output, 'pic.png').toUpperCase()) !== null);
}

console.log('\nthrough the routes');
const app = express();
app.use(makeRouter({ output_dir: output, root_path: comfyRoot }));
const srv = app.listen(0, async () => {
    const base = `http://127.0.0.1:${srv.address().port}`;
    try {
        let r = await fetch(`${base}/images/pic.png`);
        check('/images serves a result', r.status === 200 && (await r.text()) === 'png', String(r.status));
        r = await fetch(`${base}/images/audio/track.mp3`);
        check('/images serves a result in a subfolder', r.status === 200, String(r.status));
        r = await fetch(`${base}/media/_any/pic.png`);
        check('/media/_any still serves (through /media/:kind)', r.status === 200, String(r.status));
        r = await fetch(`${base}/media/video/pic.png`);
        check('/media/<another kind> is served too, as before', r.status === 200, String(r.status));
        r = await fetch(`${base}/download/pic.png`);
        check('/download sends it as an attachment', r.status === 200 && /attachment/.test(r.headers.get('content-disposition') || ''));
        r = await fetch(`${base}/images/${encodeURIComponent(path.join(comfyRoot, 'output_old', 'secret.png'))}`);
        check('the sibling folder is not served', r.status === 404, String(r.status));
        r = await fetch(`${base}/images/${encodeURIComponent(path.join(comfyRoot, 'config.json'))}`);
        check('a file outside the roots is not served', r.status === 404, String(r.status));
        r = await fetch(`${base}/images/lane_preview.png`);
        check('a lane\'s temp file is found under COMFYQ_LANES_DIR, where laneManager puts lanes',
            r.status === 200 && (await r.text()) === 'lane', String(r.status));
    } catch (e) {
        fails++;
        console.error('  FAIL the route checks threw:', e);
    }
    srv.closeAllConnections();
    srv.close();
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(lanesTmp, { recursive: true, force: true });
    if (fails) { console.error(`\nmediaStore: ${fails} FAILED, ${passes} passed`); process.exitCode = 1; return; }
    console.log(`\nmediaStore: all ${passes} checks passed`);
});
