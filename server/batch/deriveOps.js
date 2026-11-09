// deriveOps — a prepared input, written in a table cell.
//
//   file:Woman.png | scale(0.3) | blur(1.2) | jpeg(40)
//   file:clip.mp4 | frame(0) | crop(0, 0.16, 1, 0.91)
//   file:original.mp4 | trim(3, 2) | vscale(0.375) | encode(35)
//
// Each step is one operation of tools/test-suite/derive_input.py, which does the
// work; this file only reads and writes the cell, and says what comes out. The
// operation objects are the ones the test suite has always used ({ op: 'scale',
// factor: 0.3 }), so a suite run and a batch prepare an input the same way.

// name → the arguments in the order a cell writes them. `box` is four numbers
// (x0, y0, x1, y1, fractions of the picture); `file` an asset (file:NAME).
const SIGNATURES = {
    frame: ['index'],
    crop: ['box'],
    flip: [],
    scale: ['factor'],
    blur: ['radius'],
    transparent: ['shape', 'box'],
    circle: ['box', 'color?', 'width?'],
    composite: ['overlay', 'box', 'key?', 'feather?'],
    jpeg: ['quality'],
    noise: ['sigma', 'seed?'],
    trim: ['start', 'duration?'],
    vscale: ['factor'],
    vblur: ['radius'],
    mute: [],
    encode: ['crf'],
};
const VIDEO_OPS = new Set(['trim', 'vscale', 'vblur', 'mute', 'encode']);
const TEXT_ARGS = new Set(['shape', 'color', 'overlay']);

// "scale(0.3)" → { op: 'scale', factor: 0.3 }, or throws with a reason.
function parseOp(text) {
    const m = /^\s*([a-z]+)\s*(?:\((.*)\))?\s*$/i.exec(text);
    if (!m) throw new Error(`"${text.trim()}" is not an operation: write name(arguments), such as scale(0.5).`);
    const name = m[1].toLowerCase();
    const sig = SIGNATURES[name];
    if (!sig) throw new Error(`"${name}" is not an operation. Known: ${Object.keys(SIGNATURES).join(', ')}.`);
    const raw = m[2] === undefined || m[2].trim() === '' ? [] : m[2].split(',').map(s => s.trim());
    const op = { op: name };
    let i = 0;
    for (const spec of sig) {
        const arg = spec.replace('?', '');
        const optional = spec.endsWith('?');
        if (arg === 'box') {
            const four = raw.slice(i, i + 4);
            if (four.length < 4) throw new Error(`${name}: a box is four numbers, x0, y0, x1, y1.`);
            op.box = four.map(Number);
            if (op.box.some(n => !Number.isFinite(n))) throw new Error(`${name}: a box is four numbers, x0, y0, x1, y1.`);
            i += 4;
            continue;
        }
        if (i >= raw.length) {
            if (optional) continue;
            throw new Error(`${name} needs ${sig.filter(s => !s.endsWith('?')).join(', ')}.`);
        }
        const v = raw[i++];
        if (TEXT_ARGS.has(arg)) op[arg] = arg === 'overlay' ? (v.startsWith('file:') ? `asset:${v.slice(5)}` : `asset:${v.replace(/^asset:/, '')}`) : v;
        else {
            const n = Number(v);
            if (!Number.isFinite(n) || v === '') throw new Error(`${name}: ${arg} is a number (got "${v}").`);
            op[arg] = n;
        }
    }
    if (i < raw.length) throw new Error(`${name} takes ${sig.length ? sig.join(', ').replace(/\?/g, '') : 'no arguments'}; "${raw.slice(i).join(', ')}" is extra.`);
    if (name === 'transparent' && !['rect', 'ellipse'].includes(op.shape)) throw new Error('transparent: the shape is rect or ellipse.');
    return op;
}

// { op: 'scale', factor: 0.3 } → "scale(0.3)"
function formatOp(op) {
    const sig = SIGNATURES[op?.op];
    if (!sig) throw new Error(`unknown operation "${op?.op}"`);
    const args = [];
    for (const spec of sig) {
        const arg = spec.replace('?', '');
        if (op[arg] === undefined || op[arg] === null) continue;
        if (arg === 'box') args.push(...op.box);
        else if (arg === 'overlay') args.push(`file:${String(op.overlay).replace(/^asset:/, '')}`);
        else args.push(op[arg]);
    }
    return args.length || !['flip', 'mute'].includes(op.op) ? `${op.op}(${args.join(', ')})` : op.op;
}

// "file:x | scale(0.3) | jpeg(40)" → { base: 'file:x', ops: [...] }
function splitPipeline(cell) {
    const parts = String(cell ?? '').split('|');
    const base = parts.shift().trim();
    return { base, ops: parts.map(p => p.trim()).filter(Boolean).map(parseOp) };
}

function formatPipeline(base, ops) {
    return [base, ...(ops || []).map(formatOp)].join(' | ');
}

// What the steps make from a source of this kind, or throws: video steps take a
// video; picture steps take a picture, or a video whose frame(…) comes first.
function outputKind(sourceKind, ops) {
    let kind = sourceKind;
    (ops || []).forEach((op, i) => {
        if (op.op === 'frame') {
            if (i !== 0 || kind !== 'video') throw new Error('frame(…) comes first, on a video.');
            kind = 'image';
        } else if (VIDEO_OPS.has(op.op)) {
            if (kind !== 'video') throw new Error(`${op.op}(…) works on a video.`);
        } else if (kind !== 'image') {
            throw new Error(`${op.op}(…) works on a picture${kind === 'video' ? ': take a frame(…) of the video first' : ''}.`);
        }
    });
    return kind;
}

// The assets an operation reads besides its source (a composite's overlay).
const extraAssets = (ops) => (ops || []).filter(o => o.overlay).map(o => String(o.overlay).replace(/^asset:/, ''));

module.exports = { parseOp, formatOp, splitPipeline, formatPipeline, outputKind, extraAssets, SIGNATURES, VIDEO_OPS };
