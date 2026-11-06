// node server/workflows/workflowParser.test.js
//
// The parser types every primitive input it finds, and "Add workflow" writes
// that guess straight into a new meta.json. A wrong media type is not cosmetic:
// it makes the field a REQUIRED upload, and calibration stages a picture into it.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { parseWorkflow, inferType, mediaFromValue } = require('./workflowParser');

let pass = 0;
const check = (what, cond) => { assert.ok(cond, what); pass++; console.log(`  ok  ${what}`); };

// ── inferType: a media type needs a value that can be a file name ──────────
check('LoadImage.image = "x.png" is an image', inferType('image', 'x.png') === 'image');
check('a mask field holding a file name is a mask', inferType('mask', 'paint.png') === 'mask');
check('LoadVideo.file-style video name is a video', inferType('video', 'clip.mp4') === 'video');
check('LoadAudio.audio = "a.wav" is audio', inferType('audio', 'a.wav') === 'audio');
check('model_file stays a 3D mesh', inferType('model_file', 'mesh.glb') === 'model3d');
// The real shapes from the library (InpaintCropImproved, InpaintModelConditioning,
// MoGeInference, ImageCropToMask) that came out as required mask uploads.
check('mask_blend_pixels = 64 is a number', inferType('mask_blend_pixels', 64) === 'number');
check('grow_mask = 0 is a number', inferType('grow_mask', 0) === 'number');
check('mask_invert = false is a checkbox', inferType('mask_invert', false) === 'checkbox');
check('noise_mask = true is a checkbox', inferType('noise_mask', true) === 'checkbox');
check('apply_mask = true is a checkbox', inferType('apply_mask', true) === 'checkbox');
check('an image-named number is a number', inferType('image_count', 4) === 'number');
check('a video-named boolean is a checkbox', inferType('save_video', true) === 'checkbox');

// ── a filled value decides by its extension, not by the field's name ───────
// MiniMaxH3ReferenceToVideo, AudioEncoderLoader: a dropdown word and a weight.
check('ref_image_size = "match" (a dropdown) is not an image', inferType('ref_image_size', 'match') === 'text');
check('audio_encoder_name = a .safetensors weight is not audio',
    inferType('audio_encoder_name', 'sheetsage2_bf16.safetensors') === 'text');
check('an image-named URL is not an upload', inferType('image_url', 'https://example.com/a') === 'text');
// A URL with a picture's extension is still an address, not a file to upload.
check('a URL ending in .png is text', inferType('url', 'https://example.com/a.png') === 'text');
check('an image-named URL ending in .jpg is not an image',
    inferType('image_url', 'https://huggingface.co/x/resolve/main/b.jpg') !== 'image');
check('a URL ending in .mp4 is not a video', inferType('video_url', 'https://example.com/clip.mp4') !== 'video');
check('a weight with an image-like stem is still a weight', inferType('image_encoder', 'clip_vision_h.png.safetensors') === 'text');
check('LoadVideo.file = "clip.mp4" is a video', inferType('file', 'clip.mp4') === 'video');
check('an empty LoadVideo.file is a video (the node says so)', inferType('file', '', 'LoadVideo') === 'video');
check('an empty `file` on a node that names no media is text', inferType('file', '', 'SaveText') === 'text');
check('an upload annotated [input] keeps its type',
    inferType('image', 'clipspace/clipspace-painted-masked-1782996578171.png [input]') === 'image');
check('a mask field holding an annotated picture is a mask', inferType('mask', 'paint.png [input]') === 'mask');
check('an empty LoadImage slot is still an image upload', inferType('image', '') === 'image');
check('an empty model_file is a 3D mesh', inferType('model_file', '') === 'model3d');
check('a model_file naming a mesh is a 3D mesh', inferType('model_file', '3d/spot_the_cow.obj') === 'model3d');
check('a model-named weight is not a mesh', inferType('model_name', 'x.safetensors') === 'text');

// ── parseWorkflow: required follows the type ────────────────────────────────
const parsed = parseWorkflow({
    1: { class_type: 'LoadImage', inputs: { image: 'x.png' } },
    2: { class_type: 'InpaintCropImproved', inputs: { mask_blend_pixels: 64, mask_invert: false, image: ['1', 0] } },
    3: { class_type: 'InpaintModelConditioning', inputs: { noise_mask: true } },
});
const byField = (f) => parsed.parameters.find(p => p.field === f);
check('an uploaded image is required', byField('image').type === 'image' && byField('image').required === true);
check('mask_blend_pixels is an optional number', byField('mask_blend_pixels').type === 'number' && byField('mask_blend_pixels').required === false);
check('mask_invert is an optional checkbox', byField('mask_invert').type === 'checkbox' && byField('mask_invert').required === false);
check('noise_mask is an optional checkbox', byField('noise_mask').type === 'checkbox' && byField('noise_mask').required === false);
check('a link is not a primitive', parsed.parameters.filter(p => p.field === 'image').length === 1);

// ── frontend-only widget values are not parameters ──────────────────────────
const ui = parseWorkflow({
    1: { class_type: 'LoadVideo', inputs: { file: 'clip.mp4', 'video-preview': '' } },
    2: { class_type: 'LoadAudio', inputs: { audio: 'a.mp3', audioUI: '/api/view?filename=a.mp3&type=input' } },
    3: { class_type: 'SaveGLB', inputs: { filename_prefix: '3d/x', image: '', mesh: ['9', 0] } },
    4: { class_type: 'LoadImage', inputs: { image: '' } },
});
const uiFields = ui.parameters.map(p => `${p.classType}.${p.field}`);
check('a video player preview is not offered', !uiFields.includes('LoadVideo.video-preview'));
check('an audio player state is not offered', !uiFields.includes('LoadAudio.audioUI'));
check('SaveGLB\'s canvas preview is not offered', !uiFields.includes('SaveGLB.image'));
check('LoadImage\'s empty image is still offered, as a required image',
    ui.parameters.some(p => p.classType === 'LoadImage' && p.field === 'image' && p.type === 'image' && p.required));
check('LoadVideo.file is a required video', ui.parameters.some(p => p.field === 'file' && p.type === 'video' && p.required));

// ── the whole library: an upload is only ever something that can be a file ─
const MEDIA = ['image', 'video', 'audio', 'mask', 'model3d'];
const wfDir = path.resolve(__dirname, '..', '..', 'workflows');
let graphs = 0, loadVideoFiles = 0, annotated = 0;
const bad = [], notFile = [], videoMissed = [], annotatedMissed = [], frontendShown = [];
for (const id of fs.readdirSync(wfDir)) {
    if (id.startsWith('_')) continue;
    const p = path.join(wfDir, id, `${id}.api.json`);
    if (!fs.existsSync(p)) continue;
    graphs++;
    for (const prm of parseWorkflow(JSON.parse(fs.readFileSync(p, 'utf8'))).parameters) {
        const where = `${id} ${prm.nodeId}.${prm.field}=${JSON.stringify(prm.default)}`;
        const media = MEDIA.includes(prm.type);
        if (media && typeof prm.default !== 'string' && prm.default !== null) bad.push(where);
        // A filled media default must be a media file: "match", a weight, a URL is a setting.
        if (media && typeof prm.default === 'string' && prm.default.trim() !== ''
            && (!mediaFromValue(prm.default) || /:\/\//.test(prm.default))) notFile.push(where);
        if (prm.classType === 'LoadVideo' && prm.field === 'file') {
            loadVideoFiles++;
            if (prm.type !== 'video') videoMissed.push(where);
        }
        if (prm.classType === 'LoadImage' && prm.field === 'image' && /\[input\]\s*$/.test(String(prm.default))) {
            annotated++;
            if (prm.type !== 'image') annotatedMissed.push(where);
        }
        if (['video-preview', 'audioUI'].includes(prm.field) || (prm.classType === 'SaveGLB' && prm.field === 'image')) frontendShown.push(where);
    }
}
check(`no number or boolean reads as an upload across ${graphs} bundles (${bad.slice(0, 3).join(', ')})`, bad.length === 0);
check(`no dropdown word, weight or URL reads as an upload (${notFile.slice(0, 3).join(', ')})`, notFile.length === 0);
check(`every LoadVideo.file is a video upload (${loadVideoFiles} in the library; ${videoMissed.slice(0, 3).join(', ')})`,
    loadVideoFiles > 0 && videoMissed.length === 0);
check(`a clipspace [input] picture stays an image (${annotated} in the library; ${annotatedMissed.slice(0, 3).join(', ')})`,
    annotated > 0 && annotatedMissed.length === 0);
check(`no frontend-only widget is offered as a parameter (${frontendShown.slice(0, 3).join(', ')})`, frontendShown.length === 0);

console.log(`\nworkflowParser: all ${pass} checks passed`);
