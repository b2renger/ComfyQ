/**
 * The Ideogram 4 composer rebuilds the caption it writes into the prompt box.
 * Ideogram reads the keys in the schema's order, and a caption out of that
 * shape (or an element with no box) is the one that comes back as the gray
 * "Image blocked by safety filter" picture. So: a caption read into the editor
 * and written back must keep every field and the key order, and the checker
 * must stay quiet on a good caption and speak up on each known fault.
 *
 * Run: node client/src/utils/ideogramCaption.test.mjs
 */
import assert from 'node:assert';
import fs from 'node:fs';
import {
    readPrompt, checkCaption, captionToModel, modelToCaption, normalizeHex, aspectFromOption,
    emptyModel, newElement, formatCaption, MAX_STYLE_COLORS, MAX_ELEMENT_COLORS,
} from './ideogramCaption.js';

const TOP_KEYS = ['high_level_description', 'style_description', 'compositional_deconstruction'];
const PHOTO_KEYS = ['aesthetics', 'lighting', 'photo', 'medium', 'color_palette'];
const ART_KEYS = ['aesthetics', 'lighting', 'medium', 'art_style', 'color_palette'];
const OBJ_KEYS = ['type', 'bbox', 'desc', 'color_palette'];
const TEXT_KEYS = ['type', 'bbox', 'text', 'desc', 'color_palette'];

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.deepStrictEqual(a, b, msg); checks++; };

const photoCaption = {
    high_level_description: 'A lighthouse keeper on a rainy pier at dusk',
    style_description: {
        aesthetics: 'moody, cinematic',
        lighting: 'cold rim light from the lamp',
        photo: '35mm, shallow depth of field',
        medium: 'photograph',
        color_palette: ['#1A2B3C', '#F5E6C8'],
    },
    compositional_deconstruction: {
        background: 'A stormy sea and a striped lighthouse',
        elements: [
            { type: 'obj', bbox: [200, 300, 950, 700], desc: 'An old keeper in a yellow oilskin', color_palette: ['#E8C547'] },
            { type: 'text', bbox: [40, 100, 160, 900], text: 'MAREN', desc: 'Weathered painted letters on the railing' },
        ],
    },
};

const artCaption = {
    high_level_description: 'A poster for a harbour festival',
    style_description: {
        aesthetics: 'bold, flat',
        lighting: 'even',
        medium: 'graphic_design',
        art_style: 'screen print, two inks',
        color_palette: ['#D7263D', '#02182B'],
    },
    compositional_deconstruction: {
        background: 'A plain cream paper',
        elements: [
            { type: 'text', bbox: [50, 80, 250, 920], text: 'HARBOUR DAYS', desc: 'Heavy condensed capitals', color_palette: ['#D7263D'] },
            { type: 'obj', bbox: [300, 150, 950, 850], desc: 'A sailing boat seen side on' },
        ],
    },
};

// Every key at every level, in the order the schema gives it.
const keyOrderMatches = (caption) => {
    const inOrder = (keys, expected) => {
        const idx = keys.map(k => expected.indexOf(k));
        return idx.every(i => i >= 0) && idx.every((v, i) => i === 0 || v > idx[i - 1]);
    };
    if (!inOrder(Object.keys(caption), TOP_KEYS)) return false;
    const s = caption.style_description;
    if (s && !inOrder(Object.keys(s), 'art_style' in s ? ART_KEYS : PHOTO_KEYS)) return false;
    const c = caption.compositional_deconstruction;
    if (!inOrder(Object.keys(c), ['background', 'elements'])) return false;
    return c.elements.every(e => inOrder(Object.keys(e), e.type === 'text' ? TEXT_KEYS : OBJ_KEYS));
};

// ── A good caption: checked clean, and round-trips exactly ───────────────────
for (const [name, caption] of [['photo', photoCaption], ['art', artCaption]]) {
    eq(checkCaption(caption), [], `${name}: a complete, boxed caption has no warnings`);
    const back = modelToCaption(captionToModel(caption));
    eq(back, caption, `${name}: captionToModel → modelToCaption keeps every field`);
    eq(JSON.stringify(back), JSON.stringify(caption), `${name}: … and the key order`);
    ok(keyOrderMatches(back), `${name}: keys follow the schema at every level`);
    eq(checkCaption(back), [], `${name}: the rebuilt caption is still clean`);
}

// The card's own default prompt must be a clean caption that survives the
// composer unchanged — it is what a student sees first.
{
    const metaUrl = new URL('../../../workflows/image_ideogram4_t2i/image_ideogram4_t2i.meta.json', import.meta.url);
    if (fs.existsSync(metaUrl)) {
        const meta = JSON.parse(fs.readFileSync(metaUrl, 'utf8'));
        const p = (meta.exposedParameters || []).find(x => x.format === 'ideogram4-caption');
        ok(p && typeof p.default === 'string', 'the Ideogram card has a caption prompt with a default');
        const r = readPrompt(p.default);
        eq(r.kind, 'object', 'the default prompt is a JSON object');
        eq(checkCaption(r.value), [], 'the default caption has no warnings');
        eq(JSON.stringify(modelToCaption(captionToModel(r.value))), JSON.stringify(r.value),
            'the default caption round-trips through the composer exactly');
    }
}

// ── The model writes the schema's order whatever order it was read in ────────
{
    const shuffled = {
        compositional_deconstruction: {
            elements: [{ desc: 'A cat', bbox: [100, 100, 900, 900], type: 'obj' }],
            background: 'A sofa',
        },
        style_description: { medium: 'photograph', photo: 'macro', lighting: 'soft', aesthetics: 'warm' },
        high_level_description: 'A cat asleep',
    };
    ok(checkCaption(shuffled).some(w => /Top-level keys should be in the order/.test(w)), 'out-of-order top keys are reported');
    ok(checkCaption(shuffled).some(w => /style_description keys should be in the order/.test(w)), 'out-of-order style keys are reported');
    ok(checkCaption(shuffled).some(w => /"background" must come before "elements"/.test(w)), 'elements before background is reported');
    ok(checkCaption(shuffled).some(w => /Element 1: keys should be in the order/.test(w)), 'out-of-order element keys are reported');
    const fixed = modelToCaption(captionToModel(shuffled));
    ok(keyOrderMatches(fixed), 'the composer rewrites a shuffled caption in schema order');
    eq(checkCaption(fixed), [], 'and the rewritten caption is clean');
}

// Style modes: photo writes photo + medium (default "photograph"), art writes
// medium + art_style, none leaves the style section out.
{
    const m = emptyModel();
    m.highLevel = 'x'; m.background = 'y';
    m.elements = [{ ...newElement('obj', [0, 0, 500, 500]), desc: 'z' }];
    m.styleMode = 'photo'; m.aesthetics = 'a'; m.lighting = 'l';
    eq(Object.keys(modelToCaption(m).style_description), ['aesthetics', 'lighting', 'photo', 'medium']);
    eq(modelToCaption(m).style_description.medium, 'photograph', 'a photo with no medium is a photograph');
    m.styleMode = 'art'; m.medium = 'painting'; m.artStyle = 'gouache';
    eq(Object.keys(modelToCaption(m).style_description), ['aesthetics', 'lighting', 'medium', 'art_style']);
    m.styleMode = 'none';
    eq(Object.keys(modelToCaption(m)), ['high_level_description', 'compositional_deconstruction']);
    // A caption with no style section reads back as "none", not as an empty photo.
    eq(captionToModel(modelToCaption(m)).styleMode, 'none');
    // Text elements keep their words even when empty-looking; objects never get "text".
    const t = { ...newElement('text', [0, 0, 100, 900]), text: 'HI', desc: 'sign' };
    m.elements = [t];
    eq(Object.keys(modelToCaption(m).compositional_deconstruction.elements[0]), ['type', 'bbox', 'text', 'desc']);
}

// ── Palettes: uppercase #RRGGBB, capped ──────────────────────────────────────
{
    const many = Array.from({ length: 20 }, (_, i) => `#${(i * 7 + 16).toString(16).padStart(2, '0')}aa${'bb'}`);
    const loud = {
        high_level_description: 'x',
        style_description: { aesthetics: 'a', lighting: 'l', photo: 'p', medium: 'photograph', color_palette: many },
        compositional_deconstruction: {
            background: 'b',
            elements: [{ type: 'obj', bbox: [0, 0, 10, 10], desc: 'd', color_palette: ['#abc', 'ff0000', '#00ff00', '#0000FF', '#111111', '#222222', '#333333'] }],
        },
    };
    ok(checkCaption(loud).some(w => /style_description: at most 16 colors/.test(w)), 'more than 16 style colours is reported');
    ok(checkCaption(loud).some(w => /Element 1: at most 5 colors/.test(w)), 'more than 5 element colours is reported');
    ok(checkCaption(loud).some(w => /uppercase #RRGGBB/.test(w)), 'lowercase / short hex is reported');
    const back = modelToCaption(captionToModel(loud));
    eq(back.style_description.color_palette.length, MAX_STYLE_COLORS, 'style palette capped at 16');
    eq(back.compositional_deconstruction.elements[0].color_palette.length, MAX_ELEMENT_COLORS, 'element palette capped at 5');
    eq(back.compositional_deconstruction.elements[0].color_palette.slice(0, 2), ['#AABBCC', '#FF0000'], 'colours come out uppercase #RRGGBB');
    ok(back.style_description.color_palette.every(c => /^#[0-9A-F]{6}$/.test(c)), 'every style colour is uppercase #RRGGBB');
    eq(checkCaption(back), [], 'the rebuilt caption is clean');
}

// ── Each known fault is named ────────────────────────────────────────────────
{
    const noBox = JSON.parse(JSON.stringify(photoCaption));
    delete noBox.compositional_deconstruction.elements[0].bbox;
    ok(checkCaption(noBox).some(w => /Element 1: no box/.test(w)), 'an element with no box is reported');
    // The composer keeps a missing box missing (it never invents one).
    ok(!('bbox' in modelToCaption(captionToModel(noBox)).compositional_deconstruction.elements[0]), 'a missing box stays missing');

    const empty = JSON.parse(JSON.stringify(photoCaption));
    empty.compositional_deconstruction.elements = [];
    ok(checkCaption(empty).some(w => /No elements yet/.test(w)), 'an empty element list is reported');

    const badBox = JSON.parse(JSON.stringify(photoCaption));
    badBox.compositional_deconstruction.elements[0].bbox = [700, 300, 200, 700];
    ok(checkCaption(badBox).some(w => /bbox min must be smaller than max/.test(w)), 'an inverted box is reported');
    badBox.compositional_deconstruction.elements[0].bbox = [0, 0, 1200, 500];
    ok(checkCaption(badBox).some(w => /bbox must be 4 whole numbers/.test(w)), 'a box past 1000 is reported');

    const both = JSON.parse(JSON.stringify(photoCaption));
    both.style_description.art_style = 'x';
    ok(checkCaption(both).some(w => /exactly one of "photo" or "art_style"/.test(w)), 'photo and art_style together are reported');

    ok(checkCaption({ subject: 'x' }).some(w => /Unknown top-level keys: subject/.test(w)), 'an invented key is named');
    ok(checkCaption({ high_level_description: 'x' }).some(w => /compositional_deconstruction is required/.test(w)), 'a caption with no composition is reported');
    eq(checkCaption([]), ['The prompt must be a JSON object.']);
}

// ── What the prompt box holds ────────────────────────────────────────────────
eq(readPrompt('').kind, 'empty');
eq(readPrompt('   \n ').kind, 'empty');
eq(readPrompt(undefined).kind, 'empty');
eq(readPrompt('a red fox in the snow').kind, 'plain');
eq(readPrompt('{"high_level_description": "x",').kind, 'broken');
eq(readPrompt('[1, 2').kind, 'broken');
eq(readPrompt(JSON.stringify(photoCaption)).kind, 'object');
eq(readPrompt('[1, 2]').kind, 'other-json');
eq(readPrompt('"just a string"').kind, 'other-json');

// ── Helpers ──────────────────────────────────────────────────────────────────
eq(normalizeHex('#abc'), '#AABBCC');
eq(normalizeHex('abc'), '#AABBCC');
eq(normalizeHex('a1b2c3'), '#A1B2C3');
eq(normalizeHex('#A1B2C3'), '#A1B2C3');
eq(normalizeHex('red'), null);
eq(normalizeHex('#abcd'), null);
eq(aspectFromOption('9:16 (Portrait Widescreen)'), 9 / 16);
eq(aspectFromOption('1:1 (Square)'), 1);
eq(aspectFromOption('nonsense'), 1);
// The composer writes the caption indented, so a student can read it.
ok(formatCaption(photoCaption).includes('\n  "style_description"'), 'formatCaption indents');
eq(JSON.parse(formatCaption(photoCaption)), photoCaption);

console.log(`ideogramCaption: ${checks} checks passed`);
