// Deleting a job's files: its own, and nobody else's.
// (node server/storage/jobCleanup.test.js)
//
// removeJobArtifacts deletes from ComfyUI/input and the output folder, which is
// why it needs a test of what it KEEPS as much as of what it removes. The input
// folder is shared: another job's chained frame sits next to this one's, and a
// comfyq_session__ upload can back several jobs and examples at once (five
// seeded examples point at the same staged Woman.png). Only the chained frames
// named after THIS job (comfyq_chain__<its id8>__…) are its own.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { removeJobArtifacts } = require('./jobCleanup');
const ingredientsStore = require('./ingredientsStore');
const { CHAIN_PREFIX } = require('../executor/chainedInputs');

const ok = [];
const check = (label, cond) => { assert.ok(cond, label); ok.push(label); };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'comfyq-cleanup-'));
const cfg = { root_path: tmp, output_dir: path.join(tmp, 'output') };
const write = (abs, text = 'x') => {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, text);
    return abs;
};

const job = {
    id: 'aaaaaaaa-1111-4111-8111-111111111111',
    outputs: [
        { filename: 'comfyq_job_00001_.png', subfolder: '', type: 'output' },
        { filename: 'track.mp3', subfolder: 'audio', type: 'output' },
        { kind: 'text', text: 'a caption has no file' },
    ],
};
const other = { id: 'bbbbbbbb-2222-4222-8222-222222222222' };

const out1 = write(path.join(cfg.output_dir, 'comfyq_job_00001_.png'));
const out2 = write(path.join(cfg.output_dir, 'audio', 'track.mp3'));
const otherOut = write(path.join(cfg.output_dir, 'comfyq_other_00001_.png'));
const ingr = ingredientsStore.jobDir(cfg, job.id);
write(path.join(ingr, 'settings.json'), '{}');
write(path.join(ingr, 'media', 'Woman.png'));
const otherIngr = ingredientsStore.jobDir(cfg, other.id);
write(path.join(otherIngr, 'settings.json'), '{}');
const input = path.join(tmp, 'input');
const mine = write(path.join(input, `${CHAIN_PREFIX}${job.id.slice(0, 8)}__image__frame.png`));
const theirs = write(path.join(input, `${CHAIN_PREFIX}${other.id.slice(0, 8)}__image__frame.png`));
const shared = write(path.join(input, 'comfyq_session__0_0__Woman.png'));

const r = removeJobArtifacts({ job, comfyConfig: cfg });

check('the job\'s output files are deleted, a subfolder one included',
    !fs.existsSync(out1) && !fs.existsSync(out2));
check('...and counted (a text output has no file and is skipped, not an error)', r.outputs === 2);
check('its ingredients snapshot is deleted', !fs.existsSync(ingr) && r.ingredients === 1);
check('its own chained input frame is deleted', !fs.existsSync(mine) && r.inputs === 1);
check('★ another job\'s chained frame is kept', fs.existsSync(theirs));
check('★ a shared comfyq_session__ upload is kept', fs.existsSync(shared));
check('another job\'s output and ingredients are kept',
    fs.existsSync(otherOut) && fs.existsSync(path.join(otherIngr, 'settings.json')));

// Running it again finds nothing and says so, rather than throwing.
const again = removeJobArtifacts({ job, comfyConfig: cfg });
check('a second run removes nothing and does not throw',
    again.outputs === 0 && again.ingredients === 0 && again.inputs === 0);

// A rig whose ComfyUI has never staged an input has no input folder at all.
const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'comfyq-cleanup-bare-'));
let bareResult;
assert.doesNotThrow(() => {
    bareResult = removeJobArtifacts({ job, comfyConfig: { root_path: bare, output_dir: path.join(bare, 'output') } });
});
check('a missing input folder is not an error', bareResult.inputs === 0 && bareResult.outputs === 0);

check('no job or no config does nothing',
    removeJobArtifacts({ job: null, comfyConfig: cfg }).outputs === 0
    && removeJobArtifacts({ job, comfyConfig: null }).inputs === 0);

fs.rmSync(tmp, { recursive: true, force: true });
fs.rmSync(bare, { recursive: true, force: true });
console.log(`jobCleanup: all ${ok.length} checks passed`);
