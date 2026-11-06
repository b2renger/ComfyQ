// The server-side backstop on uploads: a picture must fit 2048×2048 in either
// orientation, and HEIC is refused whatever it is called. The client resizes
// first; this is what stops a bypassed or failed resize from sending a 40 MP
// phone photo to ComfyUI, where the decode plus the model load runs the GPU box
// out of memory.
// (node server/routes/uploads.test.js)

const fs = require('fs');
const os = require('os');
const path = require('path');
const { inspectUpload, IMAGE_MAX_LONG, IMAGE_MAX_SHORT } = require('./uploads');

let fails = 0, passes = 0;
const check = (name, cond, extra = '') => {
    if (cond) { passes++; console.log('  ok   ' + name); }
    else { fails++; console.error('  FAIL ' + name + (extra ? '  ' + extra : '')); }
};

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'comfyq-uploads-'));
// A PNG header is all image-size reads: the signature and the IHDR chunk.
function png(name, w, h) {
    const b = Buffer.alloc(33);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
    b.writeUInt32BE(13, 8);
    b.write('IHDR', 12, 'ascii');
    b.writeUInt32BE(w, 16);
    b.writeUInt32BE(h, 20);
    b[24] = 8; b[25] = 6;
    const p = path.join(dir, name);
    fs.writeFileSync(p, b);
    return p;
}
function file(name, buf) { const p = path.join(dir, name); fs.writeFileSync(p, buf); return p; }

check('the box is 2048×2048', IMAGE_MAX_LONG === 2048 && IMAGE_MAX_SHORT === 2048);
check('a 2048×2048 picture is accepted', inspectUpload(png('a.png', 2048, 2048), 'a.png').ok === true);
check('a 2048×1536 picture is accepted', inspectUpload(png('b.png', 2048, 1536), 'b.png').ok === true);
let r = inspectUpload(png('c.png', 2049, 1080), 'c.png');
check('one pixel too wide is refused with 413', r.ok === false && r.status === 413, JSON.stringify(r));
r = inspectUpload(png('d.png', 1600, 2049), 'd.png');
check('one pixel too tall is refused with 413', r.ok === false && r.status === 413, JSON.stringify(r));
r = inspectUpload(file('e.heic', Buffer.from('x')), 'e.heic');
check('a .heic name is refused with 415', r.ok === false && r.status === 415, JSON.stringify(r));
const heic = Buffer.alloc(32); heic.write('ftypheic', 4, 'ascii');
r = inspectUpload(file('f.jpg', heic), 'f.jpg');
check('a HEIC renamed to .jpg is still refused', r.ok === false && r.status === 415, JSON.stringify(r));
check('a video is not measured as a picture', inspectUpload(file('g.mp4', Buffer.alloc(64)), 'g.mp4').ok === true);
r = inspectUpload(file('h.png', Buffer.from('not a png')), 'h.png');
check('a broken picture is a 400 with a reason', r.ok === false && r.status === 400 && !!r.error, JSON.stringify(r));
r = inspectUpload(path.join(dir, 'missing.png'), 'missing.png');
check('a file that is not there is a 400', r.ok === false && r.status === 400);

fs.rmSync(dir, { recursive: true, force: true });
if (fails) { console.error(`\nuploads: ${fails} FAILED, ${passes} passed`); process.exitCode = 1; }
else console.log(`\nuploads: all ${passes} checks passed`);
