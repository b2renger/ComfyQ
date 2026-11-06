// Writes the RGBA PNG a mask travels as: RGB is the picture, `1 - alpha` the mask.
//
// It has to be written by hand. A canvas keeps premultiplied pixels, so where alpha
// is 0 it has already thrown the colour away, and destination-out plus toBlob saved
// the painted area as black. ComfyUI's own mask editor keeps the picture there, and
// a model that looks under the mask must see what students see. getImageData reads
// two opaque-or-empty layers, and the two are only joined here, in plain bytes.

// Join a picture and a painted layer, both as RGBA pixels of the same size. A
// painted pixel loses alpha and keeps its colour.
export function joinPictureAndMask(picture, painted) {
    const out = new Uint8Array(picture.length);
    for (let i = 0; i < picture.length; i += 4) {
        out[i] = picture[i];
        out[i + 1] = picture[i + 1];
        out[i + 2] = picture[i + 2];
        out[i + 3] = Math.round(picture[i + 3] * (255 - painted[i + 3]) / 255);
    }
    return out;
}

const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c >>> 0;
    }
    return t;
})();

function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
    const out = new Uint8Array(12 + data.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
}

async function deflate(bytes) {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

// Each row is stored as the difference with the pixel to its left (PNG filter 1),
// which keeps a photo near the size of a normal PNG instead of its raw 4 bytes a pixel.
export async function encodeRgbaPng(width, height, pixels) {
    const stride = width * 4;
    const raw = new Uint8Array((stride + 1) * height);
    for (let y = 0; y < height; y++) {
        const at = y * (stride + 1);
        const from = y * stride;
        raw[at] = 1;
        for (let x = 0; x < stride; x++) {
            raw[at + 1 + x] = (pixels[from + x] - (x >= 4 ? pixels[from + x - 4] : 0)) & 255;
        }
    }
    const ihdr = new Uint8Array(13);
    const view = new DataView(ihdr.buffer);
    view.setUint32(0, width);
    view.setUint32(4, height);
    ihdr[8] = 8;   // bits per channel
    ihdr[9] = 6;   // RGBA
    const parts = [
        new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', ihdr),
        chunk('IDAT', await deflate(raw)),
        chunk('IEND', new Uint8Array(0)),
    ];
    return new Blob(parts, { type: 'image/png' });
}
