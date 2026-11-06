// Job ingredients — what the "Download ingredients (.zip)" button returns.
//
// Drives the real /jobs/:id/ingredients.zip route over HTTP against a throwaway
// ComfyUI folder, and reads the zip back byte for byte.
//
// Run with:  node server/storage/ingredientsStore.test.js

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const express = require('express');
const ingredients = require('./ingredientsStore');
const { makeRouter } = require('../routes/jobs');

let fails = 0;
async function test(name, fn) {
    try { await fn(); console.log(`  ok   ${name}`); }
    catch (e) { console.error(`  FAIL ${name}\n       ${e.message}`); fails++; }
}

// A zip's entries, read from its central directory (archiver writes sizes there
// even when it streams, so local headers may carry zeros).
function unzip(buf) {
    const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    assert.ok(eocd >= 0, 'not a zip');
    const count = buf.readUInt16LE(eocd + 10);
    let off = buf.readUInt32LE(eocd + 16);
    const out = new Map();
    for (let i = 0; i < count; i++) {
        const method = buf.readUInt16LE(off + 10);
        const csize = buf.readUInt32LE(off + 20);
        const nlen = buf.readUInt16LE(off + 28), xlen = buf.readUInt16LE(off + 30), clen = buf.readUInt16LE(off + 32);
        const lho = buf.readUInt32LE(off + 42);
        const name = buf.subarray(off + 46, off + 46 + nlen).toString('utf8');
        const start = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
        const data = buf.subarray(start, start + csize);
        if (!name.endsWith('/')) out.set(name, method === 8 ? zlib.inflateRawSync(data) : Buffer.from(data));
        off += 46 + nlen + xlen + clen;
    }
    return out;
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'comfyq-ingredients-'));
const comfyConfig = { root_path: root };
const input = path.join(root, 'input');
fs.mkdirSync(input);
const put = (name, body) => fs.writeFileSync(path.join(input, name), body);
put('comfyq_session__1_2__Woman.png', 'PNG-woman');
put('comfyq_session__1_3__clip.mp4', 'MP4-clip');
put('comfyq_session__1_4__Woman.png', 'PNG-other-woman');
// A file outside the input folder that a crafted value would try to reach.
fs.writeFileSync(path.join(root, 'config.json'), 'SECRET');

const jobs = {
    // A showcase example: seeded, never ran through the executor, so no snapshot.
    example: {
        id: 'example-0001', userId: 'examples', workflowId: 'video_x', createdBy: 'library-sweep',
        batchLabel: 'The picture becomes the first frame.', prompt: 'a woman walks',
        paramValues: { image: 'comfyq_session__1_2__Woman.png', video: 'comfyq_session__1_3__clip.mp4', prompt: 'a woman walks', seed: 42 },
    },
    gone: {
        id: 'gone-0001', userId: 'ana', workflowId: 'image_x',
        paramValues: { image: 'comfyq_session__9_9__Gone.png', ref: 'comfyq_session__1_2__Woman.png' },
    },
    noMedia: { id: 'nomedia-0001', userId: 'ana', workflowId: 'image_t2i', paramValues: { prompt: 'a lighthouse', seed: 7 } },
    escape: { id: 'escape-0001', userId: 'ana', workflowId: 'image_x', paramValues: { image: 'comfyq_/../../config.json' } },
    sameName: {
        id: 'same-0001', userId: 'ana', workflowId: 'image_x',
        paramValues: { a: 'comfyq_session__1_2__Woman.png', b: 'comfyq_session__1_4__Woman.png' },
    },
    snapshot: { id: 'snap-0001', userId: 'ana', workflowId: 'image_x', paramValues: { image: 'comfyq_session__1_2__Woman.png' } },
};
const queue = { get: (id) => Object.values(jobs).find(j => j.id === id) || null };
const registry = { get: (id) => ({ summary: { name: 'Card ' + id, category: 'i2v' } }) };

(async () => {
    const app = express();
    app.use('/jobs', makeRouter({ queue, comfyConfig, registry }));
    const server = await new Promise(res => { const s = app.listen(0, '127.0.0.1', () => res(s)); });
    const base = `http://127.0.0.1:${server.address().port}/jobs/`;
    const zipOf = async (id) => {
        const r = await fetch(base + id + '/ingredients.zip');
        assert.strictEqual(r.status, 200);
        return unzip(Buffer.from(await r.arrayBuffer()));
    };

    await test('a job with no snapshot still gets the media that is on disk (the showcase examples)', async () => {
        const z = await zipOf(jobs.example.id);
        assert.strictEqual(String(z.get('media/Woman.png')), 'PNG-woman');
        assert.strictEqual(String(z.get('media/clip.mp4')), 'MP4-clip');
        const s = JSON.parse(z.get('settings.json'));
        assert.deepStrictEqual(s.imported_media.map(m => m.file), ['Woman.png', 'clip.mp4']);
        assert.strictEqual(s.seed.seed, 42);
        assert.doesNotMatch(String(z.get('README.txt')), /no longer|Not included/);
    });

    await test('a showcase example carries what it shows', async () => {
        const s = JSON.parse((await zipOf(jobs.example.id)).get('settings.json'));
        assert.strictEqual(s.shows, 'The picture becomes the first frame.');
        const t = JSON.parse((await zipOf(jobs.noMedia.id)).get('settings.json'));
        assert.strictEqual(t.shows, undefined);
    });

    await test('the README names only the files that are really gone', async () => {
        const z = await zipOf(jobs.gone.id);
        assert.strictEqual(String(z.get('media/Woman.png')), 'PNG-woman');
        const readme = String(z.get('README.txt'));
        assert.match(readme, /image: Gone\.png/);
        assert.doesNotMatch(readme, /ref:/);
    });

    await test('a job that imported nothing gets settings and a plain README, no apology', async () => {
        const z = await zipOf(jobs.noMedia.id);
        assert.deepStrictEqual([...z.keys()].sort(), ['README.txt', 'settings.json']);
        assert.doesNotMatch(String(z.get('README.txt')), /no longer|Not included/);
    });

    await test('a value that climbs out of the input folder is never read', async () => {
        const z = await zipOf(jobs.escape.id);
        for (const [name, data] of z) assert.ok(!String(data).includes('SECRET'), `${name} leaked the file`);
        assert.ok(![...z.keys()].some(n => n.startsWith('media/')));
        assert.match(String(z.get('README.txt')), /Not included/);
        const dir = ingredients.persist({ comfyConfig, job: jobs.escape, registry });
        assert.ok(!fs.existsSync(path.join(dir, 'media')), 'persist copied it');
        fs.rmSync(dir, { recursive: true, force: true });
    });

    await test('two uploads with the same original name both survive', async () => {
        const z = await zipOf(jobs.sameName.id);
        assert.strictEqual(String(z.get('media/Woman.png')), 'PNG-woman');
        assert.strictEqual(String(z.get('media/Woman_1.png')), 'PNG-other-woman');
    });

    await test('a persisted snapshot is served as written, and outlives its input', async () => {
        assert.ok(ingredients.persist({ comfyConfig, job: jobs.snapshot, registry }));
        fs.renameSync(path.join(input, 'comfyq_session__1_2__Woman.png'), path.join(root, 'moved.png'));
        try {
            const z = await zipOf(jobs.snapshot.id);
            assert.strictEqual(String(z.get('media/Woman.png')), 'PNG-woman');
            assert.doesNotMatch(String(z.get('README.txt')), /Not included/);
        } finally {
            fs.renameSync(path.join(root, 'moved.png'), path.join(input, 'comfyq_session__1_2__Woman.png'));
        }
    });

    await test('persist and the live zip name the files the same way', async () => {
        const live = await zipOf(jobs.sameName.id);
        ingredients.persist({ comfyConfig, job: jobs.sameName, registry });
        const snap = await zipOf(jobs.sameName.id);
        const media = (z) => [...z.keys()].filter(n => n.startsWith('media/')).sort();
        assert.deepStrictEqual(media(snap), media(live));
    });

    await test('the seed block holds the node-numbered seed keys, and nothing that merely contains "seed"', async () => {
        const s = ingredients.buildSettings({
            id: 'seeds', workflowId: 'w',
            paramValues: {
                ksampler_seed_3: 5, seed_7: 1, seed_52_3: 9, randomnoise_noise_seed_75_73: 11,
                seedvr2postprocessing_color_correction_method_66_59: 'lab'
            }
        }, registry);
        assert.deepStrictEqual(s.seed, { ksampler_seed_3: 5, seed_7: 1, seed_52_3: 9, randomnoise_noise_seed_75_73: 11 });
    });

    await test('an unknown job is a 404', async () => {
        const r = await fetch(base + 'nope/ingredients.zip');
        assert.strictEqual(r.status, 404);
    });

    server.close();
    fs.rmSync(root, { recursive: true, force: true });
    if (fails) { console.error(`\n${fails} failing`); process.exit(1); }
    console.log('\ningredientsStore: all passed');
})();
