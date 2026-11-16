// node tools/test-suite/archive_report.test.cjs
// The archive of a report keeps everything but the machine: no drive letter
// survives, known folders become labels, and nothing else changes. Pure
// functions only: no file is written.
const assert = require('assert');
const { archive, archiveName, portable } = require('./archive_report.cjs');

let n = 0;
const check = (name, fn) => { fn(); n++; console.log(`  ok  ${name}`); };

const roots = [
    ['J:\\Comfy\\ComfyUI\\output', 'output'],
    ['J:\\Comfy\\ComfyUI\\input', 'input'],
    ['J:\\Comfy\\ComfyUI', 'comfyui'],
    ['J:\\_assets', 'assets'],
];
// On a POSIX test run path.resolve would not understand a drive; the tool runs on Windows.
const onWindows = process.platform === 'win32';

check('an output path becomes output/<file>', () => {
    if (!onWindows) return;
    assert.equal(portable('J:\\Comfy\\ComfyUI\\output\\bench_a_00001_.png', roots), 'output/bench_a_00001_.png');
    assert.equal(portable('j:/comfy/comfyui/output/sub/b.mp4', roots), 'output/sub/b.mp4');
});
check('the assets folder and ComfyUI itself get their labels, the longest root first', () => {
    if (!onWindows) return;
    assert.equal(portable('J:\\_assets\\suite-inputs\\x.png', roots), 'assets/suite-inputs/x.png');
    assert.equal(portable('J:\\Comfy\\ComfyUI\\models\\m.safetensors', roots), 'comfyui/models/m.safetensors');
});
check('any other absolute path loses its drive letter', () => {
    assert.equal(portable('D:\\_demo_workflows', roots), '/_demo_workflows');
});
check('a whole report: no drive letter left, other values untouched', () => {
    const report = {
        finishedAt: '2026-11-16T09:18:47.950Z', suite: { name: 'speciality-uxui' },
        machine: { scanDirs: ['D:/_demo_workflows'] },
        results: [{ id: 'a@b', warmSec: 12.5, ok: true, outputs: [{ path: 'J:\\Comfy\\ComfyUI\\output\\a.png', file: 'a.png', bytes: 10 }],
            ingredients: [{ key: 'prompt', value: 'A chair, "quoted", no path here' }] }],
    };
    const out = archive(report, roots);
    assert.ok(!/\b[A-Za-z]:[\\/]/.test(JSON.stringify(out)), 'no drive letter survives');
    assert.equal(out.results[0].ingredients[0].value, report.results[0].ingredients[0].value);
    assert.equal(out.results[0].warmSec, 12.5);
    assert.equal(out.results[0].outputs[0].file, 'a.png');
    assert.notStrictEqual(out, report);
    assert.equal(report.results[0].outputs[0].path, 'J:\\Comfy\\ComfyUI\\output\\a.png', 'the report itself is not changed');
});
check('named by the day it finished and its suite', () => {
    assert.equal(archiveName({ finishedAt: '2026-11-16T09:18:47Z', suite: { name: 'speciality-uxui' } }), '2026-11-16-speciality-uxui.json');
    assert.equal(archiveName({ startedAt: '2026-11-10T08:00:00Z' }, 'library'), '2026-11-10-library.json');
});

console.log(`archive_report: ${n} checks passed`);
