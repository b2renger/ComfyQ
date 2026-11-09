// The batch table: reading it, and what it would queue (node server/batch/batchPlan.test.js).
// Real bundles, no ComfyUI, no queue, no disk: assets, text files and existing
// jobs are stand-ins passed in `env`.
'use strict';
const path = require('path');
const assert = require('assert');
const { parseCsv } = require('./csv');
const { planBatch, columnTarget } = require('./batchPlan');
const { WorkflowRegistry } = require('../workflows/workflowRegistry');

const registry = new WorkflowRegistry(path.resolve(__dirname, '..', '..', 'workflows'));
registry.discover();

let passed = 0;
function test(name, fn) {
    try { fn(); passed++; }
    catch (e) { console.error(`  FAIL ${name}\n       ${e.stack || e.message}`); process.exitCode = 1; }
}

const T2I = 'image_moss_image_t2i';
const EDIT = 'image_edit_flux3_klein_image_edit';
const I2V = 'video_ltx2_5_i2v';
const DESCRIBE = 'describe_gemma4_image_description';

const ASSETS = {
    'Woman.png': 'image', 'clip.mp4': 'video', 'scene-3.txt': 'text',
    'portraits/a.png': 'image', 'portraits/b.jpg': 'image', 'portraits/notes.txt': 'text',
    'pair/x.png': 'image', 'pair/y.png': 'image', 'pair/z.png': 'image',
};
const JOBS = {
    'aaaaaaaa-1111-2222-3333-444444444444': { id: 'aaaaaaaa-1111-2222-3333-444444444444', status: 'completed', outputs: [{ kind: 'image', filename: 'x.png' }] },
    'bbbbbbbb-1111-2222-3333-444444444444': { id: 'bbbbbbbb-1111-2222-3333-444444444444', status: 'failed', outputs: [] },
};
let seq = 0;
const env = {
    assetExists: (n) => Object.prototype.hasOwnProperty.call(ASSETS, n),
    listAssets: (dir) => {
        const inDir = Object.keys(ASSETS).filter(n => path.posix.dirname(n) === (dir || '.')).map(n => path.posix.basename(n));
        return inDir.length ? inDir : null;
    },
    readText: (n) => (n === 'scene-3.txt' ? 'A long prompt,\nover two lines.' : null),
    getJob: (id) => JOBS[id] || Object.values(JOBS).find(j => j.id.startsWith(id)) || null,
    random: () => ((seq++ % 7) + 1) / 10,
};
const plan = (text) => planBatch(text, registry, env);
const messages = (p) => p.errors.map(e => `${e.row}/${e.column}: ${e.message}`).join('\n');
const params = (id) => registry.get(id).effective.exposedParameters;

// ---- csv
test('csv: commas, quotes, line breaks in a cell, rows counted as the spreadsheet does', () => {
    const r = parseCsv('id,prompt\r\na,"one, two"\r\nb,"say ""hi""\nand more"\nc,x\n');
    assert.strictEqual(r.separator, ',');
    assert.deepStrictEqual(r.records.map(x => x.row), [1, 2, 3, 4]);
    assert.strictEqual(r.records[1].cells[1], 'one, two');
    assert.strictEqual(r.records[2].cells[1], 'say "hi"\nand more');
});
test('csv: a French spreadsheet saves with ";" and a byte-order mark', () => {
    const r = parseCsv('\ufeffid;workflow;prompt\nhero;moss;un, deux\n');
    assert.strictEqual(r.separator, ';');
    assert.deepStrictEqual(r.records[0].cells, ['id', 'workflow', 'prompt']);
    assert.strictEqual(r.records[1].cells[2], 'un, deux');
});
test('csv: tabs', () => {
    assert.strictEqual(parseCsv('id\tworkflow\na\tb').separator, '\t');
});
test('csv: an unclosed quote names the row it opened on', () => {
    const r = parseCsv('id,prompt\na,ok\nb,"never closed\nc,x\n');
    assert.ok(/Row 3/.test(r.error), r.error);
});

// ---- columns
test('prompt and negative find the card\'s own fields, not its plumbing', () => {
    assert.strictEqual(columnTarget('prompt', params(T2I)).key, 'prompt_117');
    assert.strictEqual(columnTarget('negative', params(T2I)).key, 'negative_105');
    assert.strictEqual(columnTarget('image', params(T2I)), null);
});

// ---- one row
test('one row: one job, every default filled, a fresh seed recorded', () => {
    const p = plan(`id,workflow,prompt\nhero,${T2I},a red door\n`);
    assert.deepStrictEqual(p.errors, []);
    assert.strictEqual(p.jobs.length, 1);
    const j = p.jobs[0];
    assert.strictEqual(j.key, 'hero');
    assert.strictEqual(j.row, 2);
    assert.strictEqual(j.workflowId, T2I);
    assert.strictEqual(j.prompt, 'a red door');
    assert.strictEqual(j.paramValues.prompt_117, 'a red door');
    assert.strictEqual(j.paramValues.steps_107, 25, 'a default the row does not set');
    assert.ok(Number.isInteger(j.paramValues.seed_107), 'the seed it will run with is recorded');
    assert.ok(p.totalEstimatedSec > 0);
    assert.strictEqual(p.modelLoads, 1);
});
test('a short workflow name resolves as in storyboards; an unknown one is an error on its cell', () => {
    assert.strictEqual(plan('workflow,prompt\nmoss_image_t2i,x\n').jobs[0].workflowId, T2I);
    const p = plan('workflow,prompt\nno_such_card,x\n');
    assert.strictEqual(p.jobs.length, 0);
    assert.strictEqual(p.errors[0].row, 2);
    assert.strictEqual(p.errors[0].column, 'workflow');
});
test('values: range, a decimal comma, choices matched loosely, yes and no in French', () => {
    const ok = plan(`workflow;prompt;steps_107;megapixels_19;aspect_ratio_19;slg_124\n${T2I};x;30;1,5;1:1 (square);oui\n`);
    assert.deepStrictEqual(ok.errors, []);
    const v = ok.jobs[0].paramValues;
    assert.strictEqual(v.steps_107, 30);
    assert.strictEqual(v.megapixels_19, 1.5);
    assert.strictEqual(v.aspect_ratio_19, '1:1 (Square)');
    assert.strictEqual(v.slg_124, true);
    const bad = plan(`workflow,prompt,steps_107,aspect_ratio_19,slg_124\n${T2I},x,500,7:3,maybe\n`);
    assert.strictEqual(bad.errors.length, 3, messages(bad));
    assert.ok(bad.errors.every(e => e.row === 2));
    assert.ok(/maximum, 60/.test(messages(bad)));
    assert.ok(/not one of the choices/.test(messages(bad)));
});
test('a column the card does not have: an error where it is filled, nothing where it is empty', () => {
    const p = plan(`id,workflow,prompt,image\na,${T2I},x,\nb,${T2I},x,file:Woman.png\n`);
    assert.strictEqual(p.errors.length, 1, messages(p));
    assert.deepStrictEqual([p.errors[0].row, p.errors[0].column], [3, 'image']);
});
test('two columns that set one field are refused', () => {
    const p = plan(`workflow,prompt,prompt_117\n${T2I},a,b\n${T2I},a,\n`);
    assert.strictEqual(p.errors.length, 1, messages(p));
    assert.deepStrictEqual([p.errors[0].row, p.errors[0].column], [2, 'prompt_117']);
});
test('notes and comment rows are for people', () => {
    const p = plan(`id,workflow,prompt,notes\n# the opening shot\nhero,${T2I},x,check the door colour\n`);
    assert.deepStrictEqual(p.errors, []);
    assert.strictEqual(p.jobs.length, 1);
});
test('a long prompt from a text file', () => {
    const p = plan(`workflow,prompt\n${T2I},text:scene-3.txt\n${T2I},text:missing.txt\n`);
    assert.strictEqual(p.errors.length, 1);
    assert.strictEqual(p.errors[0].row, 3);
    assert.strictEqual(p.jobs.length, 1, 'the plan keeps the clean rows; the route refuses the batch');
    assert.strictEqual(p.jobs[0].prompt, 'A long prompt,\nover two lines.');
});
test('ids: unique, and written so a cell can name them', () => {
    const p = plan(`id,workflow,prompt\nhero,${T2I},x\nhero,${T2I},y\n2nd,${T2I},z\n`);
    assert.strictEqual(p.errors.length, 2, messages(p));
    assert.ok(/already used on row 2/.test(messages(p)));
});
test('the seed column: fixed, stepped by repeat, refused on a card without one', () => {
    const p = plan(`id,workflow,prompt,seed,repeat\nhero,${T2I},x,10,3\n`);
    assert.deepStrictEqual(p.jobs.map(j => [j.key, j.paramValues.seed_107]), [['hero.1', 10], ['hero.2', 11], ['hero.3', 12]]);
    const c = plan(`workflow,prompt,steps_107\n${T2I},x,\n`);
    assert.deepStrictEqual(c.errors, []);
    const s = plan(`workflow,prompt,seed_107\n${T2I},x,5\n`);
    assert.ok(/"seed" column/.test(messages(s)));
});

// ---- inputs
test('a row feeds a later one, and may be written below it', () => {
    const p = plan(`id,workflow,prompt,image\nmove,${I2V},it walks,hero\nhero,${T2I},a dog,\n`);
    assert.deepStrictEqual(p.errors, [], messages(p));
    assert.deepStrictEqual(p.jobs.map(j => j.key), ['hero', 'move'], 'the source runs first');
    const dep = p.jobs[1].deps[0];
    assert.deepStrictEqual(dep, { paramKey: dep.paramKey, sourceKey: 'hero', outputIndex: 0, kind: 'image' });
    assert.strictEqual(p.modelLoads, 2);
});
test('hero#2 is the second output', () => {
    const p = plan(`id,workflow,prompt,image\nhero,${T2I},a dog,\nedit,${EDIT},make it blue,hero#2\n`);
    assert.strictEqual(p.jobs[1].deps[0].outputIndex, 1);
});
test('an input of the wrong kind is refused', () => {
    const p = plan(`id,workflow,prompt,image\nhero,${T2I},a dog,\nmove,${I2V},walks,hero\nmore,${EDIT},blue,move\nsaid,${EDIT},blue,file:clip.mp4\n`);
    assert.strictEqual(p.errors.length, 2, messages(p));
    assert.ok(/makes a video, and this input takes an image/.test(messages(p)));
    assert.ok(/"clip.mp4" is a video/.test(messages(p)));
    const t = plan(`id,workflow,image,prompt\ncap,${DESCRIBE},file:Woman.png,\nedit,${EDIT},cap,blue\n`);
    assert.ok(/makes a text/.test(messages(t)), messages(t));
});
test('a required input left empty, a missing file, a path out of the folder', () => {
    const p = plan(`workflow,prompt,image\n${EDIT},x,\n${EDIT},x,file:nope.png\n${EDIT},x,file:../secret.png\n${EDIT},x,file:C:/a.png\n`);
    assert.deepStrictEqual(p.errors.map(e => e.row), [2, 3, 4, 5], messages(p));
    assert.ok(/needs an image/.test(p.errors[0].message));
});
test('a reference to nothing, to itself, and a loop', () => {
    const p = plan(`id,workflow,prompt,image\na,${EDIT},x,ghost\nb,${EDIT},x,b\nc,${EDIT},x,d\nd,${EDIT},x,c\n`);
    assert.strictEqual(p.jobs.length, 0);
    assert.ok(/No row has the id "ghost"/.test(messages(p)));
    assert.ok(/its own result/.test(messages(p)));
    assert.ok(/loop: c → d|loop: d → c/.test(messages(p)), messages(p));
});
test('a row waiting on a broken row is blocked, not queued; the rest still plan', () => {
    const p = plan(`id,workflow,prompt,image\nhero,${T2I},x,file:Woman.png\nedit,${EDIT},blue,hero\nother,${T2I},y,\n`);
    assert.deepStrictEqual(p.blocked.map(b => [b.id, b.waitsOn]), [['edit', ['hero']]]);
    assert.deepStrictEqual(p.jobs.map(j => j.key), ['other']);
    assert.ok(/Nothing is queued/.test(p.summary));
});
test('job: an output of a job that exists', () => {
    const p = plan(`workflow,prompt,image\n${EDIT},x,job:aaaaaaaa\n${EDIT},x,job:aaaaaaaa#2\n${EDIT},x,job:bbbbbbbb\n${EDIT},x,job:cccccccc\n`);
    assert.strictEqual(p.jobs[0].deps[0].sourceJobId, JOBS['aaaaaaaa-1111-2222-3333-444444444444'].id);
    assert.deepStrictEqual(p.errors.map(e => e.row), [3, 4, 5], messages(p));
    assert.ok(/made 1 output, not 2/.test(messages(p)));
    assert.ok(/failed/.test(messages(p)));
});
test('file: stages an asset', () => {
    const p = plan(`workflow,prompt,image\n${EDIT},x,file:Woman.png\n`);
    assert.deepStrictEqual(p.jobs[0].assets, [{ paramKey: p.jobs[0].assets[0].paramKey, file: 'Woman.png' }]);
    assert.deepStrictEqual(p.jobs[0].deps, []);
});

// ---- copies
test('folder: one job per file of the right kind, in name order', () => {
    const p = plan(`id,workflow,prompt,image\nshot,${EDIT},x,folder:portraits/\n`);
    assert.deepStrictEqual(p.errors, [], messages(p));
    assert.deepStrictEqual(p.jobs.map(j => [j.key, j.assets[0].file]), [['shot.1', 'portraits/a.png'], ['shot.2', 'portraits/b.jpg']]);
    const none = plan(`workflow,video\nutility_seedvr2_hd_upscale,folder:portraits\n`);
    assert.ok(/has no video file/.test(messages(none)), messages(none));
});
test('a row fed by a row of several jobs makes one job for each, paired in order', () => {
    const p = plan(`id,workflow,prompt,image\nshot,${EDIT},x,folder:portraits\nmove,${I2V},walks,shot\none,${I2V},walks,shot.2\n`);
    assert.deepStrictEqual(p.errors, [], messages(p));
    const move = p.jobs.filter(j => j.id === 'move');
    assert.deepStrictEqual(move.map(j => j.deps[0].sourceKey), ['shot.1', 'shot.2']);
    assert.deepStrictEqual(p.jobs.filter(j => j.id === 'one').map(j => j.deps[0].sourceKey), ['shot.2']);
    const bad = plan(`id,workflow,prompt,image\nshot,${EDIT},x,folder:portraits\nmove,${I2V},walks,shot.3\n`);
    assert.ok(/no copy 3/.test(messages(bad)), messages(bad));
});
test('inputs of different widths cannot be paired', () => {
    const FLF = 'video_ltx2_5_flf2v';
    const p = plan(`id,workflow,prompt,image,image2\nkeys,${FLF},x,folder:portraits,folder:pair\n`);
    assert.ok(/cannot be paired: image 2, image2 3/.test(messages(p)), messages(p));
});
test('repeat times a folder: every file, every repeat', () => {
    const p = plan(`id,workflow,prompt,image,repeat,seed\nshot,${EDIT},x,folder:portraits,2,7\n`);
    assert.deepStrictEqual(p.jobs.map(j => [j.key, j.assets[0].file, j.paramValues[Object.keys(j.paramValues).find(k => /seed/.test(k))]]),
        [['shot.1', 'portraits/a.png', 7], ['shot.2', 'portraits/a.png', 8], ['shot.3', 'portraits/b.jpg', 7], ['shot.4', 'portraits/b.jpg', 8]]);
});

// ---- the plan as a whole
test('order: spreadsheet order, except where an input comes later', () => {
    const p = plan(`id,workflow,prompt,image\na,${T2I},x,\nb,${EDIT},y,c\nc,${T2I},z,\nd,${T2I},w,\n`);
    assert.deepStrictEqual(p.jobs.map(j => j.key), ['a', 'c', 'b', 'd']);
    assert.deepStrictEqual(p.jobs.map(j => j.order), [0, 1, 2, 3]);
});
test('no workflow column, an empty table, a row too wide', () => {
    assert.ok(/"workflow"/.test(plan('id,prompt\na,b\n').errors[0].message));
    assert.ok(/empty/.test(plan('\n\n').errors[0].message));
    const wide = plan(`workflow,prompt\n${T2I},a,b\n`);
    assert.ok(/needs quotes/.test(messages(wide)), messages(wide));
});

// ---- the assets folder on disk
test('assetEnv: names stay inside the assets folder', () => {
    const fs = require('fs');
    const os = require('os');
    const { assetEnv } = require('./assetEnv');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'comfyq-batch-'));
    try {
        const root = path.join(tmp, 'assets');
        fs.mkdirSync(path.join(root, 'shots'), { recursive: true });
        fs.writeFileSync(path.join(root, 'a.png'), 'x');
        fs.writeFileSync(path.join(root, 'shots', 'b.png'), 'x');
        fs.writeFileSync(path.join(root, 'scene.txt'), '﻿line one\r\nline two\r\n');
        fs.writeFileSync(path.join(tmp, 'outside.txt'), 'secret');
        const e = assetEnv(root);
        assert.strictEqual(e.assetExists('a.png'), true);
        assert.strictEqual(e.assetExists('shots/b.png'), true);
        assert.strictEqual(e.assetExists('shots'), false, 'a folder is not a file');
        assert.strictEqual(e.assetExists('../outside.txt'), false);
        assert.strictEqual(e.assetExists(path.join(tmp, 'outside.txt')), false);
        assert.strictEqual(e.readText('../outside.txt'), null);
        assert.strictEqual(e.readText('scene.txt'), 'line one\nline two');
        assert.deepStrictEqual(e.listAssets('shots'), ['b.png']);
        assert.deepStrictEqual(e.listAssets(null).sort(), ['a.png', 'scene.txt']);
        assert.strictEqual(e.listAssets('..'), null);
        assert.strictEqual(assetEnv(null).assetExists('a.png'), false, 'no assets folder set: nothing exists');
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

console.log(`batchPlan: ${passed} ok${process.exitCode ? ', with failures' : ''}`);
