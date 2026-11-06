// resolveChainedInputs — staging a finished job's output as the next job's input.
//
// The staged `comfyq_chain__` copy is swept 24 h after its modification time.
// On Windows a plain copy keeps the SOURCE's time, so a frame rendered more than
// a day before it was consumed (a retry the next morning, a batch left overnight)
// was "stale" the moment it was staged and the next sweep could delete it before
// LoadImage read it. Pinned here against a real temp directory and the real sweep.
//
// Run with:  node server/executor/chainedInputs.test.js

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { resolveChainedInputs, CHAIN_PREFIX } = require('./chainedInputs');
const { InputUploader } = require('../workers/inputUploader');

let fails = 0;
function test(name, fn) {
    try { fn(); console.log(`  ok   ${name}`); }
    catch (e) { console.error(`  FAIL ${name}\n       ${e.message}`); fails++; }
}

const DAY = 24 * 60 * 60 * 1000;
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'comfyq-chain-'));
const outputDir = path.join(root, 'output');
const inputDir = path.join(root, 'input');
fs.mkdirSync(outputDir, { recursive: true });
const comfyConfig = { root_path: root, output_dir: outputDir };

function sourceJob(id, filename, ageMs) {
    const f = path.join(outputDir, filename);
    fs.writeFileSync(f, 'frame');
    const t = new Date(Date.now() - ageMs);
    fs.utimesSync(f, t, t);
    return { id, status: 'completed', outputs: [{ kind: 'image', type: 'output', subfolder: '', filename }] };
}

try {
    test('a frame rendered two days ago is staged dated now and survives the chain sweep', () => {
        const src = sourceJob('src00000-0000', 'shot1_00001_.png', 2 * DAY);
        const queue = { get: id => (id === src.id ? src : null) };
        const job = { id: 'next0000-0000', paramValues: { prompt: 'x' } };
        const deps = [{ paramKey: 'image', sourceJobId: src.id, kind: 'image', outputIndex: 0 }];

        const r = resolveChainedInputs({ job, deps, queue, comfyConfig });
        assert.deepStrictEqual(r.errors, []);
        const staged = r.paramValues.image;
        assert.ok(staged.startsWith(CHAIN_PREFIX), `staged under the chain prefix (${staged})`);
        const age = Date.now() - fs.statSync(path.join(inputDir, staged)).mtimeMs;
        assert.ok(age < 60 * 1000, `staged copy is dated now (age ${Math.round(age / 1000)} s)`);

        new InputUploader({ comfyInputDir: inputDir, retentionMinutes: 30 }).sweepStale();
        assert.ok(fs.existsSync(path.join(inputDir, staged)), 'the sweep keeps it for the next job');
        // The source output itself is untouched.
        const srcAge = Date.now() - fs.statSync(path.join(outputDir, 'shot1_00001_.png')).mtimeMs;
        assert.ok(srcAge > DAY, 'the output keeps its own date');
    });
} finally {
    try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* best effort */ }
}

if (fails) { console.error(`\n${fails} failing`); process.exit(1); }
console.log('\nchainedInputs: all checks passed');
