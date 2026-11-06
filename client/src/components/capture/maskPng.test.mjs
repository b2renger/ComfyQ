// The painted file, from the browser's bytes to what the server and ComfyUI read
// (run: node client/src/components/capture/maskPng.test.mjs).
//
// The bug this pins: a canvas saved the painted area as black, so a model reading
// the picture under the mask saw a hole. The colour must survive a transparent
// pixel, end to end, and the alpha must be the inverse of the mask.
import assert from 'node:assert';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { joinPictureAndMask, encodeRgbaPng } from './maskPng.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { decodeRgba, splitMaskFile } = require(path.join(here, '../../../../server/media/maskPng.js'));

const picture = new Uint8ClampedArray([
    10, 20, 30, 255,     200, 100, 50, 255,
    0, 255, 0, 255,      1, 2, 3, 128,
]);
const painted = new Uint8ClampedArray([
    239, 68, 68, 0,      239, 68, 68, 255,
    239, 68, 68, 128,    239, 68, 68, 255,
]);

const joined = joinPictureAndMask(picture, painted);
assert.deepStrictEqual([...joined.slice(0, 8)], [10, 20, 30, 255, 200, 100, 50, 0], 'painted: colour kept, alpha 0');
assert.strictEqual(joined[11], 127, 'a soft edge keeps a partial alpha');
assert.strictEqual(joined[15], 0, 'a pixel already see-through stays so where painted');

const blob = await encodeRgbaPng(2, 2, joined);
assert.strictEqual(blob.type, 'image/png');
const file = Buffer.from(await blob.arrayBuffer());
assert.deepStrictEqual([...file.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47], 'a PNG signature');

const back = decodeRgba(file);
assert.deepStrictEqual([back.width, back.height], [2, 2]);
assert.deepStrictEqual([...back.pixels], [...joined], 'the file holds the exact bytes');

const parts = splitMaskFile(file);
assert.ok(parts.picture.length > 0 && parts.mask.length > 0);

// A larger picture, so the row filter and the compressor both really run.
const w = 64, h = 48;
const big = new Uint8ClampedArray(w * h * 4);
for (let i = 0; i < big.length; i += 4) { big[i] = i % 251; big[i + 1] = i % 241; big[i + 2] = i % 239; big[i + 3] = 255; }
const layer = new Uint8ClampedArray(w * h * 4);
for (let i = 3; i < layer.length / 2; i += 4) layer[i] = 255;
const round = decodeRgba(Buffer.from(await (await encodeRgbaPng(w, h, joinPictureAndMask(big, layer))).arrayBuffer()));
assert.deepStrictEqual([round.width, round.height], [w, h]);
assert.strictEqual(round.pixels[3], 0, 'the painted top half is transparent');
assert.strictEqual(round.pixels[round.pixels.length - 1], 255, 'the bottom half is opaque');
assert.strictEqual(round.pixels[8], big[8], 'and the colour under the paint survives');

console.log('maskPng: ok');
