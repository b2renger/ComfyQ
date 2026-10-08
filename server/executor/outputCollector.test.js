const assert = require('assert');

// Which of a node's UI strings is a RESULT and which is plumbing.
//
// Every fixture below is a real payload shape from the 2026-10-07 library sweep,
// not an invented one — the sweep is what proved seven production bundles were
// publishing a tile reading "3" or "1x512x512" to students beside the picture.

const { collectFromHistory } = require('./outputCollector');

let pass = 0;
const ok = (what, cond) => { assert.ok(cond, what); pass++; console.log(`  ok  ${what}`); };

const img = (nodeId, filename) => ({ [nodeId]: { images: [{ filename, subfolder: '', type: 'output' }] } });
const texts = (nodeId, arr) => ({ [nodeId]: { text: arr } });
const kinds = (out) => out.map(o => o.kind);
const textsOf = (out) => out.filter(o => o.kind === 'text').map(o => o.text);

console.log('\nplumbing beside a real file is dropped');
// image_edit_bernini_r_image_editing — node 76:57:1 taps a combo's line index.
ok('a bare number next to an image', textsOf(collectFromHistory(
    { outputs: { ...img('31', 'x.png'), ...texts('76:57:1', ['3']) } })).length === 0);
ok('the image itself is still collected', kinds(collectFromHistory(
    { outputs: { ...img('31', 'x.png'), ...texts('76:57:1', ['3']) } })).includes('image'));
// video_liveportrait_image2video — two tensor shapes previewed.
ok('a tensor shape next to a video', textsOf(collectFromHistory(
    { outputs: { ...img('182', 'v.mp4'), ...texts('78', ['1x512x512']), ...texts('182b', ['128x1024x1024']) } })).length === 0);
// audio_stable_audio_3_medium — a sample count.
ok('a sample count next to audio', textsOf(collectFromHistory(
    { outputs: { ...img('60', 'a.flac'), ...texts('52:42', ['150']) } })).length === 0);

console.log('\na real answer is never dropped');
const caption = 'This is a digital rendering of a vibrant red sports car parked on an asphalt road.';
ok('a caption that is the only output', textsOf(collectFromHistory(
    { outputs: texts('4', [caption]) }))[0] === caption);
// ★ The safety net that makes the rule safe without knowing the workflow: when text
// is all there is, it is the result whatever it looks like.
ok('a one-word answer that is the only output survives',
    textsOf(collectFromHistory({ outputs: texts('4', ['yes']) }))[0] === 'yes');
ok('a bare number that is the only output survives',
    textsOf(collectFromHistory({ outputs: texts('4', ['42']) }))[0] === '42');
// A prose caption alongside a picture is a legitimate pairing (a describe-and-draw
// graph), so prose is kept even when files are present.
ok('prose is kept beside an image', textsOf(collectFromHistory(
    { outputs: { ...img('9', 'x.png'), ...texts('4', [caption]) } }))[0] === caption);
ok('a multi-line caption counts as prose', textsOf(collectFromHistory(
    { outputs: { ...img('9', 'x.png'), ...texts('4', ['line one\nline two']) } })).length === 1);

console.log('\nthe pre-existing rules still hold');
ok('an empty string is never an output',
    collectFromHistory({ outputs: texts('4', ['', '   ']) }).length === 0);
ok('a filename already served as media is not re-emitted as text',
    textsOf(collectFromHistory({ outputs: { ...img('9', 'x.png'), ...texts('9b', ['x.png']) } })).length === 0);
ok('no outputs at all yields nothing', collectFromHistory({ outputs: {} }).length === 0);
ok('a missing history entry yields nothing', collectFromHistory(null).length === 0);

console.log(`\noutputCollector: all ${pass} checks passed`);
