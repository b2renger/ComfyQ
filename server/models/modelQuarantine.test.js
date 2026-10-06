// Pruning MOVES a model. Does it move, come back, and refuse the dangerous cases?
// (node server/models/modelQuarantine.test.js)
//
// This is the safety net under every other safeguard: the scan, the score and
// the gate each reduce the chance of a wrong verdict, and only this makes a
// wrong verdict recoverable. So its own failure modes matter more than most.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
    quarantineRoot, quarantineFile, listQuarantine, restoreFile, emptyBatch, sameVolume,
} = require('./modelQuarantine');

const ok = [];
const check = (label, cond) => { assert.ok(cond, label); ok.push(label); };

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'comfyq-q-'));
const comfy = path.join(root, 'ComfyUI');
const qRoot = path.join(root, '_quarantine');
const put = (rel, bytes = 4096) => {
    const p = path.join(comfy, rel.split('/').join(path.sep));
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, Buffer.alloc(bytes, 3));
    return p;
};

const BATCH = '2026-10-06T10-00-00-000Z';

// 1. where it goes by default: beside the install, on the same volume, which is
//    also where _maintenance/prune-models.ps1 puts its own.
const dflt = quarantineRoot({ comfyRoot: comfy });
check('the default quarantine sits at the volume root', dflt === path.join(path.parse(comfy).root, '_model_quarantine'));
check('...and is on the same volume as the models, so a move is a rename',
    sameVolume(dflt, comfy));
check('a configured folder wins', quarantineRoot({ comfyRoot: comfy, configured: qRoot }) === path.resolve(qRoot));

// 2. the move itself
const absA = put('models/loras/a.safetensors');
const movedA = quarantineFile({ abs: absA, rel: 'models/loras/a.safetensors', root: qRoot, batch: BATCH });
check('the file moves', movedA.ok === true);
check('...out of the models tree', !fs.existsSync(absA));
check('...into the batch, keeping its path under models/',
    fs.existsSync(path.join(qRoot, BATCH, 'models', 'loras', 'a.safetensors')));
check('...and reports the real byte count', movedA.bytes === 4096);

// 3. ★ Two prunes of the SAME filename must not collide, which is what the
//    per-batch stamp is for — otherwise the second would overwrite the first
//    copy of a file the admin might still want back.
const absA2 = put('models/loras/a.safetensors');
const BATCH2 = '2026-10-06T11-00-00-000Z';
const movedA2 = quarantineFile({ abs: absA2, rel: 'models/loras/a.safetensors', root: qRoot, batch: BATCH2 });
check('the same filename pruned twice keeps both copies', movedA2.ok
    && fs.existsSync(path.join(qRoot, BATCH, 'models', 'loras', 'a.safetensors'))
    && fs.existsSync(path.join(qRoot, BATCH2, 'models', 'loras', 'a.safetensors')));

// 4. the listing an admin reads before letting anything go
const listed = listQuarantine({ root: qRoot });
check('both batches are listed, newest first',
    listed.batches.length === 2 && listed.batches[0].batch === BATCH2);
check('with a size that adds up', listed.totalGb === +(8192 / 1024 ** 3).toFixed(2));

// 5. ★ restore, which is the whole point
const back = restoreFile({ root: qRoot, batch: BATCH, rel: 'models/loras/a.safetensors', comfyRoot: comfy });
check('a quarantined model goes back where it came from', back.ok === true
    && fs.existsSync(path.join(comfy, 'models', 'loras', 'a.safetensors')));
check('...and leaves the quarantine',
    !fs.existsSync(path.join(qRoot, BATCH, 'models', 'loras', 'a.safetensors')));

// 6. ★ it REFUSES to overwrite. If something now sits at that path the admin
//    must look first — silently replacing it would lose whichever copy is the
//    one they wanted.
const clash = restoreFile({ root: qRoot, batch: BATCH2, rel: 'models/loras/a.safetensors', comfyRoot: comfy });
check('restoring onto an occupied path is refused, not forced',
    clash.ok === false && /already at that path/.test(clash.error));

// 7. a restore may not be talked into writing outside models/
for (const rel of ['../../evil.safetensors', 'models/../../evil.safetensors']) {
    const out = restoreFile({ root: qRoot, batch: BATCH2, rel, comfyRoot: comfy });
    check(`a restore path escaping models/ is refused (${rel})`, out.ok === false);
}
check('restoring something not held is refused',
    restoreFile({ root: qRoot, batch: BATCH2, rel: 'models/loras/nope.safetensors', comfyRoot: comfy }).ok === false);

// 8. emptying: the one irreversible step, and it must not follow a link out
check('an unknown batch cannot be emptied', emptyBatch({ root: qRoot, batch: 'nope' }).ok === false);
for (const bad of ['..', '../..']) {
    check(`emptying cannot escape the quarantine (${bad})`,
        emptyBatch({ root: qRoot, batch: bad }).ok === false);
}
const emptied = emptyBatch({ root: qRoot, batch: BATCH2 });
check('a real batch can finally be let go', emptied.ok === true
    && !fs.existsSync(path.join(qRoot, BATCH2)));
check('and the listing reflects it', listQuarantine({ root: qRoot }).batches.length === 0);

// 9. a missing source is an error, not a silent success
check('quarantining a file that is not there fails',
    quarantineFile({ abs: path.join(comfy, 'models', 'loras', 'ghost.safetensors'),
        rel: 'models/loras/ghost.safetensors', root: qRoot, batch: BATCH }).ok === false);
check('and with no quarantine folder it refuses rather than deleting',
    quarantineFile({ abs: absA, rel: 'models/loras/a.safetensors', root: null, batch: BATCH }).ok === false);

fs.rmSync(root, { recursive: true, force: true });
console.log(`modelQuarantine: all ${ok.length} checks passed`);
