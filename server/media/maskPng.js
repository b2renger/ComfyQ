// A painted mask travels as one RGBA PNG, which is what ComfyUI's LoadImage wants:
// RGB is the picture and `1 - alpha` the mask. This module takes such a file
// apart again, so a job's picture and its mask can be kept and re-used separately
// (the ingredients, and re-editing a mask with "Use these settings").
//
// Pure JS on purpose: the only native dependency this project accepts is
// better-sqlite3. It reads 8-bit RGBA PNGs, the only kind MaskDrawField writes, and
// returns null for anything else, so a caller treats "not one of ours" as nothing
// to split.
'use strict';
const zlib = require('zlib');

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const RGBA = 6, GRAY = 0, RGB = 2;
const CHANNELS = { [GRAY]: 1, [RGB]: 3, [RGBA]: 4 };

function paeth(a, b, c) {
    const p = a + b - c;
    const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    if (pa <= pb && pa <= pc) return a;
    return pb <= pc ? b : c;
}

// → { width, height, pixels } (top row first, 4 bytes a pixel), or null.
function decodeRgba(buf) {
    if (!Buffer.isBuffer(buf) || buf.length < 45 || !buf.subarray(0, 8).equals(SIGNATURE)) return null;
    let width = 0, height = 0, colour = -1, depth = 0, interlace = 0;
    const idat = [];
    for (let at = 8; at + 8 <= buf.length;) {
        const len = buf.readUInt32BE(at);
        const type = buf.toString('ascii', at + 4, at + 8);
        const data = buf.subarray(at + 8, at + 8 + len);
        if (type === 'IHDR') {
            width = data.readUInt32BE(0); height = data.readUInt32BE(4);
            depth = data[8]; colour = data[9]; interlace = data[12];
        } else if (type === 'IDAT') idat.push(data);
        else if (type === 'IEND') break;
        at += 12 + len;
    }
    if (depth !== 8 || colour !== RGBA || interlace !== 0 || !width || !height || !idat.length) return null;

    let raw;
    try { raw = zlib.inflateSync(Buffer.concat(idat)); } catch { return null; }
    const stride = width * 4;
    if (raw.length < (stride + 1) * height) return null;

    const pixels = Buffer.alloc(stride * height);
    for (let y = 0; y < height; y++) {
        const filter = raw[y * (stride + 1)];
        const line = y * (stride + 1) + 1;
        const out = y * stride;
        for (let x = 0; x < stride; x++) {
            const left = x >= 4 ? pixels[out + x - 4] : 0;
            const up = y > 0 ? pixels[out + x - stride] : 0;
            const corner = y > 0 && x >= 4 ? pixels[out + x - stride - 4] : 0;
            let add;
            switch (filter) {
                case 0: add = 0; break;
                case 1: add = left; break;
                case 2: add = up; break;
                case 3: add = (left + up) >> 1; break;
                case 4: add = paeth(left, up, corner); break;
                default: return null;
            }
            pixels[out + x] = (raw[line + x] + add) & 255;
        }
    }
    return { width, height, pixels };
}

function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body));
    return Buffer.concat([len, body, crc]);
}

// `pixels` holds CHANNELS[colour] bytes a pixel.
function encode(width, height, colour, pixels) {
    const stride = width * CHANNELS[colour];
    const raw = Buffer.alloc((stride + 1) * height);
    for (let y = 0; y < height; y++) {
        pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8;
    ihdr[9] = colour;
    return Buffer.concat([
        SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0)),
    ]);
}

// The picture with no mask in it: every pixel opaque, RGB as it was.
function picturePng({ width, height, pixels }) {
    const out = Buffer.alloc(width * height * 3);
    for (let i = 0, o = 0; i < pixels.length; i += 4, o += 3) {
        out[o] = pixels[i]; out[o + 1] = pixels[i + 1]; out[o + 2] = pixels[i + 2];
    }
    return encode(width, height, RGB, out);
}

// The mask as ComfyUI's own editor shows it: white where the model repaints.
function maskPng({ width, height, pixels }) {
    const out = Buffer.alloc(width * height);
    for (let i = 3, o = 0; i < pixels.length; i += 4, o++) out[o] = 255 - pixels[i];
    return encode(width, height, GRAY, out);
}

/** → { picture: Buffer, mask: Buffer } for a painted file, or null. */
function splitMaskFile(buf) {
    const img = decodeRgba(buf);
    if (!img) return null;
    return { picture: picturePng(img), mask: maskPng(img) };
}

module.exports = { splitMaskFile, decodeRgba, encode, RGBA, GRAY, RGB };
