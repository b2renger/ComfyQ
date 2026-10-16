// modelAccessLog — what counts as an observed LOAD.
//
// ComfyUI 0.40's asset scanner resolves every model at startup, and the
// recorder used to log each of those as a load, which protected the whole disk
// from pruning. The fixed recorder marks real loads `ctx: "prompt"`; older
// records are judged by shape. Both halves are pinned here.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readAccessLog, invalidateAccessLog, namesOpenedBetween, genuineRows, parseRows, BURST } = require('./modelAccessLog');

let pass = 0;
const ok = (what, cond) => { assert.ok(cond, what); pass++; };

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'comfyq-access-'));
const log = path.join(root, 'comfyq_model_access.jsonl');
const rec = (at, name, extra = {}) => JSON.stringify({ at, path: path.join(root, 'models', 'x', name), how: 'folder_paths', ...extra });

const lines = [];
// A startup scan: 60 different models within two seconds (legacy, no ctx).
for (let i = 0; i < 60; i++) lines.push(rec(1000 + (i % 2), `scanned_${i}.safetensors`));
// The old SDXL base was ONLY ever seen in such a scan.
lines.push(rec(1000, 'sd_xl_base_1.0.safetensors'));
// A real workflow run long after (legacy): a few models over a few seconds.
lines.push(rec(5000, 'unet_a.safetensors'), rec(5001, 'clip_a.safetensors'), rec(5003, 'vae_a.safetensors'));
// A run recorded by the fixed recorder, during ANOTHER scan burst: still counts.
for (let i = 0; i < 40; i++) lines.push(rec(9000, `scan2_${i}.safetensors`));
lines.push(rec(9000, 'loaded_mid_scan.safetensors', { ctx: 'prompt' }));
// Recorder v9's leak (2026-10-16): the asset scan overlapped a prompt, so a
// whole-disk burst arrived TAGGED as prompt loads. Shape still decides.
for (let i = 0; i < 30; i++) lines.push(rec(12000, `tagged_scan_${i}.safetensors`, { ctx: 'prompt' }));
// …while a real prompt's handful of loads keeps counting.
lines.push(rec(15000, 'real_unet.safetensors', { ctx: 'prompt' }), rec(15001, 'real_vae.safetensors', { ctx: 'prompt' }));
lines.push('{ torn');
fs.writeFileSync(log, lines.join('\n') + '\n');
invalidateAccessLog();

const r = readAccessLog(root);
ok('a model seen only in a startup scan is not observed', !r.byName.has('sd_xl_base_1.0.safetensors'));
ok('none of the scanned names is observed', ![...r.byName.keys()].some(n => n.startsWith('scanned_') || n.startsWith('scan2_')));
ok('a real run of a few models still is', ['unet_a', 'clip_a', 'vae_a'].every(n => r.byName.has(`${n}.safetensors`)));
ok('a prompt-time record counts even inside a scan burst', r.byName.has('loaded_mid_scan.safetensors'));
ok('a scan burst tagged as prompt loads is still a scan', ![...r.byName.keys()].some(n => n.startsWith('tagged_scan_')));
ok('a real prompt beside it still counts', r.byName.has('real_unet.safetensors') && r.byName.has('real_vae.safetensors'));
ok('the report says how many records were discounted as a scan', r.ignoredAsScan === 61 + 40 + 30);
ok('a torn line does not break the read', r.available === true);

ok('the sweep window reads the same way',
    JSON.stringify(namesOpenedBetween(root, 999000, 1002000)) === '[]'
    && namesOpenedBetween(root, 4999000, 5004000).length === 3);

// The threshold sits between what was measured: < 10 for a run, > 50 for a scan.
const just = [];
for (let i = 0; i < BURST - 1; i++) just.push({ at: 7000, name: `n${i}`, path: `n${i}` });
ok(`${BURST - 1} models in a window still count as loads`, genuineRows(just).length === BURST - 1);
just.push({ at: 7001, name: 'one_more', path: 'one_more' });
ok(`${BURST} models in a window are a scan`, genuineRows(just).length === 0);
ok('parseRows skips a torn line', parseRows('{"at":1,"path":"a.safetensors"}\n{ torn\n').length === 1);

fs.rmSync(root, { recursive: true, force: true });
console.log(`modelAccessLog: all ${pass} checks passed`);
