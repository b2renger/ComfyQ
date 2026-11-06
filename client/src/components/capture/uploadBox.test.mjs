// Unit test for the client's image upload box (run: node client/src/components/capture/uploadBox.test.mjs)
//
// The bug this pins: a card whose image param declared maxInputEdge 2048 resized
// a phone photo to 2048×1536, and the server refused it as larger than 1920×1080
// — on every retry, since the resize gave the same size again. So: the client
// box must never exceed the server's, and every real param must land inside it.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { uploadBox, IMAGE_MAX_LONG, IMAGE_MAX_SHORT } from './uploadBox.js';
import { resizeImageFile } from '../../utils/imageResize.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../..');
const require = createRequire(import.meta.url);

// 1. The client's ceiling IS the server's backstop, not a copy that can drift.
const uploads = require(path.join(repo, 'server/routes/uploads.js'));
assert.strictEqual(IMAGE_MAX_LONG, uploads.IMAGE_MAX_LONG, 'client long-edge cap must equal server/routes/uploads.js');
assert.strictEqual(IMAGE_MAX_SHORT, uploads.IMAGE_MAX_SHORT, 'client short-edge cap must equal server/routes/uploads.js');

// 2. The box for each kind of declaration.
assert.deepStrictEqual(uploadBox(undefined), { maxLong: 1920, maxShort: 1080 }, 'no maxInputEdge → the full box');
assert.deepStrictEqual(uploadBox(null), { maxLong: 1920, maxShort: 1080 });
assert.deepStrictEqual(uploadBox(1024), { maxLong: 1024, maxShort: 1024 }, 'a small cap stays a square cap');
assert.deepStrictEqual(uploadBox(1376), { maxLong: 1376, maxShort: 1080 }, 'short edge clamped to the server box');
assert.deepStrictEqual(uploadBox(2048), { maxLong: 1920, maxShort: 1080 }, 'a cap above the box is clamped into it');

// 3. Run each picture through the real resizeImageFile and check what it would
// upload against the server's own rule, for the sizes a student really sends.
// Only the browser's decoder and canvas are stood in for: the decoder reports the
// photo's size, the canvas records the size resizeImageFile draws at. A copy of
// its sizing maths here would only prove that the copy agrees with itself.
let decoded = null;
let drawn = null;
globalThis.createImageBitmap = async () => ({ ...decoded, close() {} });
globalThis.document = {
    createElement: () => {
        const canvas = {
            width: 0,
            height: 0,
            getContext: () => ({ drawImage() {} }),
            toBlob: (cb, type) => { drawn = [canvas.width, canvas.height]; cb(new Blob(['x'], { type })); },
        };
        return canvas;
    },
};
async function uploadedSize(w, h, { maxLong, maxShort }) {
    decoded = { width: w, height: h };
    drawn = null;
    const file = new File(['x'], 'photo.jpg', { type: 'image/jpeg' });
    const out = await resizeImageFile(file, maxLong, { maxShort });
    if (out === file) return [w, h]; // already inside the box: sent as it is
    assert.ok(drawn, 'resizeImageFile returned a new file without drawing it');
    return drawn;
}
// The stand-ins really reach the resize: a 12 MP phone photo lands on the box.
assert.deepStrictEqual(await uploadedSize(4032, 3024, uploadBox(undefined)), [1440, 1080]);
assert.deepStrictEqual(await uploadedSize(3024, 4032, uploadBox(undefined)), [1080, 1440]);
assert.deepStrictEqual(await uploadedSize(512, 512, uploadBox(undefined)), [512, 512], 'a small picture is sent unchanged');

const serverAccepts = ([w, h]) => Math.max(w, h) <= uploads.IMAGE_MAX_LONG && Math.min(w, h) <= uploads.IMAGE_MAX_SHORT;
const photos = [[4032, 3024], [3024, 4032], [4080, 3072], [3000, 3000], [1600, 1200], [1080, 1920], [512, 512]];

// Every image/mask param the library declares, plus no declaration at all.
const edges = new Set([undefined]);
const wfDir = path.join(repo, 'workflows');
let declared = 0;
for (const id of fs.readdirSync(wfDir)) {
    if (id.startsWith('_')) continue;
    const f = path.join(wfDir, id, `${id}.meta.json`);
    if (!fs.existsSync(f)) continue;
    const meta = JSON.parse(fs.readFileSync(f, 'utf8'));
    for (const p of meta.exposedParameters || []) {
        if ((p.type === 'image' || p.type === 'mask') && p.maxInputEdge != null) {
            edges.add(p.maxInputEdge);
            declared++;
        }
    }
}
assert.ok(declared > 0, 'expected the library to declare some maxInputEdge values');
for (const edge of edges) {
    for (const [w, h] of photos) {
        const out = await uploadedSize(w, h, uploadBox(edge));
        assert.ok(serverAccepts(out),
            `maxInputEdge ${edge}: a ${w}×${h} photo becomes ${out.join('×')}, which the server refuses`);
    }
}

console.log(`uploadBox: ok (${declared} declared caps, ${edges.size - 1} distinct, × ${photos.length} photo sizes)`);
