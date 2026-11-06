// InputUploader — the code that DELETES files in ComfyUI/input.
//
// Its prefix rules are the only thing keeping the seeded examples' inputs
// (`comfyq_session__…`), the shared placeholder and everybody else's files in
// ComfyUI/input alive, so they are pinned here against a real temp directory.
//
// Run with:  node server/workers/inputUploader.test.js

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { InputUploader, PLACEHOLDER_IMAGE, stageCopy } = require('./inputUploader');

let fails = 0;
function test(name, fn) {
    try { fn(); console.log(`  ok   ${name}`); }
    catch (e) { console.error(`  FAIL ${name}\n       ${e.message}`); fails++; }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'comfyq-inputs-'));
const DAY = 24 * 60 * 60 * 1000;

function fresh() {
    const dir = fs.mkdtempSync(path.join(tmp, 'input-'));
    return { dir, up: new InputUploader({ comfyInputDir: dir, retentionMinutes: 30 }) };
}
function put(dir, name, ageMs = 0) {
    const f = path.join(dir, name);
    fs.writeFileSync(f, 'x');
    const t = new Date(Date.now() - ageMs);
    fs.utimesSync(f, t, t);
    return f;
}
const exists = (dir, name) => fs.existsSync(path.join(dir, name));

try {
    test('an old job input (comfyq__) is swept; a fresh one is kept', () => {
        const { dir, up } = fresh();
        put(dir, 'comfyq__abcd1234__a.png', 31 * 60 * 1000);
        put(dir, 'comfyq__abcd1234__b.png', 60 * 1000);
        assert.strictEqual(up.sweepStale(), 1);
        assert.ok(!exists(dir, 'comfyq__abcd1234__a.png'));
        assert.ok(exists(dir, 'comfyq__abcd1234__b.png'));
    });

    test('session uploads, the placeholder and files ComfyQ did not make survive at any age', () => {
        const { dir, up } = fresh();
        const year = 365 * DAY;
        put(dir, 'comfyq_session__0_0__Woman.png', year);
        put(dir, PLACEHOLDER_IMAGE, year);
        put(dir, 'reference_from_2025.png', year);
        put(dir, 'my_comfyq__notes.png', year);
        assert.strictEqual(up.sweepStale(), 0);
        for (const n of ['comfyq_session__0_0__Woman.png', PLACEHOLDER_IMAGE, 'reference_from_2025.png', 'my_comfyq__notes.png']) {
            assert.ok(exists(dir, n), `${n} kept`);
        }
    });

    test('a storyboard chain frame outlives the normal window and goes after a day', () => {
        const { dir, up } = fresh();
        put(dir, 'comfyq_chain__abcd1234__frame.png', 2 * 60 * 60 * 1000);
        put(dir, 'comfyq_chain__ef567890__frame.png', DAY + 60 * 1000);
        assert.strictEqual(up.sweepStale(), 1);
        assert.ok(exists(dir, 'comfyq_chain__abcd1234__frame.png'));
        assert.ok(!exists(dir, 'comfyq_chain__ef567890__frame.png'));
    });

    test('cleanupJob removes only that job\'s own inputs', () => {
        const { dir, up } = fresh();
        put(dir, 'comfyq__abcd1234__a.png');
        put(dir, 'comfyq__abcd1234__b.mp4');
        put(dir, 'comfyq__ffff0000__other.png');
        put(dir, 'comfyq_chain__abcd1234__frame.png');
        put(dir, 'comfyq_session__0_0__Woman.png');
        assert.strictEqual(up.cleanupJob('abcd1234-0000-0000-0000-000000000000'), 2);
        assert.ok(!exists(dir, 'comfyq__abcd1234__a.png'));
        assert.ok(!exists(dir, 'comfyq__abcd1234__b.mp4'));
        for (const n of ['comfyq__ffff0000__other.png', 'comfyq_chain__abcd1234__frame.png', 'comfyq_session__0_0__Woman.png']) {
            assert.ok(exists(dir, n), `${n} kept`);
        }
    });

    // ★ On Windows copyFileSync keeps the SOURCE's modification time, so a
    // calibration asset dated last year was "stale" the moment it was staged
    // and the next minute's sweep could delete it before ComfyUI read it.
    test('a staged copy of an old file is not swept by the next tick', () => {
        const { dir, up } = fresh();
        const src = put(tmp, 'old_asset.png', 365 * DAY);
        const rec = up.copy({ jobId: 'bench-im-0000', paramKey: 'image', originalName: 'old asset.png', source: src });
        assert.strictEqual(rec.comfyFilename, 'comfyq__bench-im__old_asset.png');
        assert.ok(Date.now() - fs.statSync(rec.destPath).mtimeMs < 60 * 1000, 'the copy is dated now');
        assert.strictEqual(up.sweepStale(), 0);
        assert.ok(exists(dir, rec.comfyFilename));
    });

    // The same trap for a storyboard frame: a shot retried the next morning
    // copies a source rendered more than a day earlier, which the chain TTL
    // would otherwise sweep before ComfyUI's LoadImage reaches it.
    test('a chain frame staged from an output over a day old is kept', () => {
        const { dir, up } = fresh();
        const src = put(tmp, 'yesterdays_frame.png', 2 * DAY);
        stageCopy(src, path.join(dir, 'comfyq_chain__abcd1234__image__yesterdays_frame.png'));
        assert.strictEqual(up.sweepStale(), 0);
        assert.ok(exists(dir, 'comfyq_chain__abcd1234__image__yesterdays_frame.png'));
        assert.ok(fs.existsSync(src), 'the source itself is untouched');
        assert.ok(Date.now() - fs.statSync(src).mtimeMs > DAY, 'and keeps its own date');
    });

    test('a buffer is written under the namespaced name', () => {
        const { dir, up } = fresh();
        const rec = up.copy({ jobId: 'abcd1234', paramKey: 'image', originalName: 'a b.png', source: Buffer.from('png') });
        assert.strictEqual(rec.comfyFilename, 'comfyq__abcd1234__a_b.png');
        assert.strictEqual(fs.readFileSync(path.join(dir, rec.comfyFilename), 'utf8'), 'png');
    });

    test('the placeholder is written once and reused', () => {
        const { dir, up } = fresh();
        assert.strictEqual(up.ensurePlaceholderImage(), PLACEHOLDER_IMAGE);
        const first = fs.statSync(path.join(dir, PLACEHOLDER_IMAGE)).mtimeMs;
        up.ensurePlaceholderImage();
        assert.strictEqual(fs.statSync(path.join(dir, PLACEHOLDER_IMAGE)).mtimeMs, first);
    });
} finally {
    fs.rmSync(tmp, { recursive: true, force: true });
}

if (fails) { console.error(`\n${fails} failing`); process.exit(1); }
console.log('\nall input-uploader tests passed');
