// Ideogram 4 structured captions — parse, check and write the JSON prompt the
// model was trained on.
//
// Written from Ideogram's published schema (ideogram-oss/ideogram4,
// docs/prompting.md, "JSON caption schema"):
//   { high_level_description?, style_description?, compositional_deconstruction }
//   style_description: aesthetics, lighting, photo, medium, color_palette?   (photo)
//                   or aesthetics, lighting, medium, art_style, color_palette? (non-photo)
//   compositional_deconstruction: background, elements[]
//   element: type "obj":  type, bbox?, desc, color_palette?
//            type "text": type, bbox?, text, desc, color_palette?
//   bbox = [y_min, x_min, y_max, x_max], integers 0–1000, origin top-left
//   colors = uppercase #RRGGBB; ≤16 in the style palette, ≤5 per element
// Key order matters to the model, so captions are always rebuilt in that order.
//
// Why ComfyQ cares: a prompt that isn't in this format is far more likely to
// come back as the gray "Image blocked by safety filter" picture (Ideogram's own
// doc says false positives are high for non-JSON prompts).

export const MAX_STYLE_COLORS = 16;
export const MAX_ELEMENT_COLORS = 5;
export const MEDIUM_SUGGESTIONS = ['illustration', '3d_render', 'painting', 'graphic_design'];

const HEX_RE = /^#[0-9A-F]{6}$/;
const TOP_KEYS = ['high_level_description', 'style_description', 'compositional_deconstruction'];
const PHOTO_KEYS = ['aesthetics', 'lighting', 'photo', 'medium', 'color_palette'];
const ART_KEYS = ['aesthetics', 'lighting', 'medium', 'art_style', 'color_palette'];
const OBJ_KEYS = ['type', 'bbox', 'desc', 'color_palette'];
const TEXT_KEYS = ['type', 'bbox', 'text', 'desc', 'color_palette'];

let nextId = 1;
const newId = () => `el${nextId++}`;

// "#abc" / "abc123" / "#aabbcc" → "#AABBCC"; null when it isn't a color.
export const normalizeHex = (value) => {
    let s = String(value || '').trim().replace(/^#/, '');
    if (/^[0-9a-f]{3}$/i.test(s)) s = s.split('').map(c => c + c).join('');
    return /^[0-9a-f]{6}$/i.test(s) ? `#${s.toUpperCase()}` : null;
};

// "9:16 (Portrait Widescreen)" → 0.5625 (width / height). 1 when unreadable.
export const aspectFromOption = (option) => {
    const m = String(option || '').match(/(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)/);
    if (!m) return 1;
    const w = parseFloat(m[1]), h = parseFloat(m[2]);
    return w > 0 && h > 0 ? w / h : 1;
};

// What the text in a prompt box is: an Ideogram caption object, JSON of some
// other shape, broken JSON, or plain text.
export const readPrompt = (text) => {
    const raw = String(text ?? '');
    if (!raw.trim()) return { kind: 'empty' };
    try {
        const value = JSON.parse(raw);
        if (value && typeof value === 'object' && !Array.isArray(value)) return { kind: 'object', value };
        return { kind: 'other-json', value };
    } catch (e) {
        return /^\s*[{[]/.test(raw) ? { kind: 'broken', error: e.message } : { kind: 'plain' };
    }
};

const outOfOrder = (keys, expected) => {
    const known = keys.filter(k => expected.includes(k));
    const sorted = [...known].sort((a, b) => expected.indexOf(a) - expected.indexOf(b));
    return known.some((k, i) => k !== sorted[i]);
};

const checkPalette = (palette, max, where, warnings) => {
    if (palette === undefined) return;
    if (!Array.isArray(palette)) { warnings.push(`${where}: color_palette must be a list of colors`); return; }
    if (palette.length > max) warnings.push(`${where}: at most ${max} colors (has ${palette.length})`);
    const bad = palette.filter(c => typeof c !== 'string' || !HEX_RE.test(c));
    if (bad.length) warnings.push(`${where}: colors must be uppercase #RRGGBB (${bad.slice(0, 3).join(', ')})`);
};

// Warnings for a parsed caption — empty when it matches the schema.
export const checkCaption = (caption) => {
    const warnings = [];
    if (!caption || typeof caption !== 'object' || Array.isArray(caption)) {
        return ['The prompt must be a JSON object.'];
    }
    const keys = Object.keys(caption);
    const unknown = keys.filter(k => !TOP_KEYS.includes(k));
    if (unknown.length) warnings.push(`Unknown top-level keys: ${unknown.join(', ')} — Ideogram 4 only knows ${TOP_KEYS.join(', ')}`);
    if (outOfOrder(keys, TOP_KEYS)) warnings.push(`Top-level keys should be in the order ${TOP_KEYS.join(' → ')}`);
    if (!caption.high_level_description) warnings.push('Add a high_level_description (strongly recommended).');

    const style = caption.style_description;
    if (style !== undefined) {
        if (!style || typeof style !== 'object') warnings.push('style_description must be an object');
        else {
            const sk = Object.keys(style);
            const hasPhoto = 'photo' in style, hasArt = 'art_style' in style;
            if (hasPhoto === hasArt) warnings.push('style_description needs exactly one of "photo" or "art_style"');
            for (const k of ['aesthetics', 'lighting', 'medium']) if (!(k in style)) warnings.push(`style_description is missing "${k}"`);
            const expected = hasArt && !hasPhoto ? ART_KEYS : PHOTO_KEYS;
            const extra = sk.filter(k => !PHOTO_KEYS.includes(k) && !ART_KEYS.includes(k));
            if (extra.length) warnings.push(`style_description: unknown keys ${extra.join(', ')}`);
            else if (outOfOrder(sk, expected)) warnings.push(`style_description keys should be in the order ${expected.join(' → ')}`);
            for (const k of ['aesthetics', 'lighting', 'photo', 'medium', 'art_style']) {
                if (k in style && !String(style[k] ?? '').trim()) warnings.push(`Style: "${k}" is empty`);
            }
            checkPalette(style.color_palette, MAX_STYLE_COLORS, 'style_description', warnings);
        }
    }

    const comp = caption.compositional_deconstruction;
    if (!comp || typeof comp !== 'object') {
        warnings.push('compositional_deconstruction is required (with "background" and "elements")');
        return warnings;
    }
    const ck = Object.keys(comp);
    // Boxes are what keep Ideogram's safety filter quiet. Measured on the rig
    // (2026-09-17, one benign prompt, 5 seeds): no box at all → blocked 5/5;
    // one box on the subject → 0/5. Worth a warning, not just a nicety.
    if (Array.isArray(comp.elements) && comp.elements.length === 0) {
        warnings.push('No elements yet — add at least one, with a box, or the safety filter will very likely block the image.');
    }
    if (!('background' in comp)) warnings.push('compositional_deconstruction is missing "background"');
    else if (!String(comp.background ?? '').trim()) warnings.push('Describe the background');
    if (!Array.isArray(comp.elements)) warnings.push('compositional_deconstruction.elements must be a list');
    const compExtra = ck.filter(k => k !== 'background' && k !== 'elements');
    if (compExtra.length) warnings.push(`compositional_deconstruction: unknown keys ${compExtra.join(', ')}`);
    else if (outOfOrder(ck, ['background', 'elements'])) warnings.push('"background" must come before "elements"');

    (Array.isArray(comp.elements) ? comp.elements : []).forEach((el, i) => {
        const where = `Element ${i + 1}`;
        if (!el || typeof el !== 'object') { warnings.push(`${where} must be an object`); return; }
        if (el.type !== 'obj' && el.type !== 'text') { warnings.push(`${where}: type must be "obj" or "text"`); return; }
        const expected = el.type === 'text' ? TEXT_KEYS : OBJ_KEYS;
        const ek = Object.keys(el);
        const extra = ek.filter(k => !expected.includes(k));
        if (extra.length) warnings.push(`${where}: unknown keys ${extra.join(', ')}`);
        else if (outOfOrder(ek, expected)) warnings.push(`${where}: keys should be in the order ${expected.join(' → ')}`);
        if (el.type === 'text' && typeof el.text !== 'string') warnings.push(`${where}: a text element needs "text" (the words to render)`);
        if (!el.desc) warnings.push(`${where}: add a "desc"`);
        if (el.bbox === undefined) {
            warnings.push(`${where}: no box — draw one on the canvas. Captions whose elements have no box are the ones the safety filter blocks.`);
        }
        if (el.bbox !== undefined) {
            const b = el.bbox;
            const valid = Array.isArray(b) && b.length === 4 && b.every(n => Number.isInteger(n) && n >= 0 && n <= 1000);
            if (!valid) warnings.push(`${where}: bbox must be 4 whole numbers from 0 to 1000 [y_min, x_min, y_max, x_max]`);
            else if (b[0] >= b[2] || b[1] >= b[3]) warnings.push(`${where}: bbox min must be smaller than max`);
        }
        checkPalette(el.color_palette, MAX_ELEMENT_COLORS, where, warnings);
    });
    return warnings;
};

// ---------------------------------------------------------------------------
// Editor model <-> caption

const str = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));
const palette = (v) => (Array.isArray(v) ? v.map(normalizeHex).filter(Boolean) : []);
const clampCoord = (n) => Math.max(0, Math.min(1000, Math.round(Number(n) || 0)));

export const emptyModel = () => ({
    highLevel: '',
    styleMode: 'photo',          // 'photo' | 'art' | 'none'
    aesthetics: '',
    lighting: '',
    photo: '',
    artStyle: '',
    medium: '',
    palette: [],
    background: '',
    elements: [],
});

export const newElement = (type = 'obj', bbox = [300, 300, 700, 700]) => ({
    id: newId(), type, bbox, text: '', desc: '', palette: [],
});

const KNOWN_TOP = new Set(TOP_KEYS);

// Every string / number in a JSON value as "path: value" lines, so a prompt
// written in some other JSON shape can become a starting description instead
// of being thrown away.
export const flattenToText = (value) => {
    const lines = [];
    const walk = (v, path) => {
        if (v == null) return;
        if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
            const s = String(v).trim();
            if (s) lines.push(path ? `${path}: ${s}` : s);
        } else if (Array.isArray(v)) {
            const flat = v.every(x => typeof x !== 'object' || x === null);
            if (flat) { const s = v.filter(x => x != null && String(x).trim()).join(', '); if (s) lines.push(path ? `${path}: ${s}` : s); }
            else v.forEach(x => walk(x, path));
        } else if (typeof v === 'object') {
            for (const [k, x] of Object.entries(v)) walk(x, path ? `${path} ${k.replace(/_/g, ' ')}` : k.replace(/_/g, ' '));
        }
    };
    walk(value, '');
    return lines.join('; ');
};

// Does this object use Ideogram's caption keys at all?
export const looksLikeCaption = (obj) =>
    !!obj && typeof obj === 'object' && Object.keys(obj).some(k => KNOWN_TOP.has(k));

// A caption object (any shape) → editor model. Unknown keys are dropped.
export const captionToModel = (caption) => {
    const m = emptyModel();
    if (!caption || typeof caption !== 'object') return m;
    m.highLevel = str(caption.high_level_description);
    const s = caption.style_description;
    if (s && typeof s === 'object') {
        m.styleMode = 'art_style' in s && !('photo' in s) ? 'art' : 'photo';
        m.aesthetics = str(s.aesthetics);
        m.lighting = str(s.lighting);
        m.photo = str(s.photo);
        m.artStyle = str(s.art_style);
        m.medium = str(s.medium);
        m.palette = palette(s.color_palette).slice(0, MAX_STYLE_COLORS);
    } else {
        m.styleMode = 'none';
    }
    const c = caption.compositional_deconstruction;
    if (c && typeof c === 'object') {
        m.background = str(c.background);
        m.elements = (Array.isArray(c.elements) ? c.elements : []).filter(e => e && typeof e === 'object').map(e => {
            const b = Array.isArray(e.bbox) && e.bbox.length === 4 ? e.bbox.map(clampCoord) : null;
            const bbox = b && b[0] < b[2] && b[1] < b[3] ? b : null;
            return {
                id: newId(),
                type: e.type === 'text' ? 'text' : 'obj',
                bbox,
                text: str(e.text),
                desc: str(e.desc),
                palette: palette(e.color_palette).slice(0, MAX_ELEMENT_COLORS),
            };
        });
    }
    return m;
};

// Editor model → caption object with the schema's key order. Empty optional
// fields (palettes, a style section left blank) are left out.
export const modelToCaption = (m) => {
    const caption = {};
    if (m.highLevel.trim()) caption.high_level_description = m.highLevel.trim();
    if (m.styleMode !== 'none') {
        const style = { aesthetics: m.aesthetics.trim(), lighting: m.lighting.trim() };
        if (m.styleMode === 'photo') {
            style.photo = m.photo.trim();
            style.medium = m.medium.trim() || 'photograph';
        } else {
            style.medium = m.medium.trim();
            style.art_style = m.artStyle.trim();
        }
        if (m.palette.length) style.color_palette = m.palette.slice(0, MAX_STYLE_COLORS);
        caption.style_description = style;
    }
    caption.compositional_deconstruction = {
        background: m.background.trim(),
        elements: m.elements.map(e => {
            const el = { type: e.type };
            if (e.bbox) el.bbox = e.bbox.map(clampCoord);
            if (e.type === 'text') el.text = e.text;
            el.desc = e.desc.trim();
            if (e.palette.length) el.color_palette = e.palette.slice(0, MAX_ELEMENT_COLORS);
            return el;
        }),
    };
    return caption;
};

// How the composer writes the caption into the prompt box: indented so a student
// can still read and tweak it. The server sends it to the model compacted.
export const formatCaption = (caption) => JSON.stringify(caption, null, 2);
