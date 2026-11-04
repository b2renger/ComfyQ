// MOSS-Image layouts — the boxes the composer draws, as ComfyUI's
// Create Bounding Boxes node reads them from a JSON string
// (comfy_extras/nodes_bounding_boxes.py, elements_to_boxes):
//   [ { type: "obj" | "text", bbox: [y_min, x_min, y_max, x_max] (0–1000),
//       text?: (text boxes only), desc, color_palette?: ["#RRGGBB", …] }, … ]
// It is Ideogram's element shape, which is why the Ideogram composer draws it.
// MOSS-Image Layout Prompt (nodes_moss_image.py) then turns each element into
// a layout item; an object box is a "character" when its 1-based number is in
// the node's separate `character_boxes` field, so that list travels beside the
// JSON rather than inside it.
//
// Every element needs a box: the node raises "bboxes element is missing a
// valid 'bbox'" otherwise. An empty layout is an empty string, and the layout
// node then passes the prompt through unchanged.

import { normalizeHex, newElement, MAX_ELEMENT_COLORS } from './ideogramCaption.js';

const str = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));
const clampCoord = (n) => Math.max(0, Math.min(1000, Math.round(Number(n) || 0)));

// "1, 3" → Set {1, 3}
export const parseCharacters = (text) => new Set((String(text || '').match(/\d+/g) || []).map(Number));

// What the layout box holds.
export const readLayout = (text) => {
    const raw = String(text ?? '').trim();
    if (!raw) return { kind: 'empty', elements: [] };
    let value;
    try { value = JSON.parse(raw); } catch (e) { return { kind: 'broken', error: e.message }; }
    // Accept a bare list, {elements: […]}, or a whole Ideogram caption.
    const list = Array.isArray(value) ? value
        : Array.isArray(value?.elements) ? value.elements
        : Array.isArray(value?.compositional_deconstruction?.elements) ? value.compositional_deconstruction.elements
        : null;
    if (!list) return { kind: 'other', error: 'expected a list of boxes' };
    return { kind: 'list', elements: list };
};

// Raw elements (+ the character numbers) → the composer's element model.
export const layoutToElements = (list, characters) => {
    const chars = parseCharacters(characters);
    return (Array.isArray(list) ? list : []).filter(e => e && typeof e === 'object').map((e, i) => {
        const b = Array.isArray(e.bbox) && e.bbox.length === 4 ? e.bbox.map(clampCoord) : null;
        const type = e.type === 'text' ? 'text' : 'obj';
        return {
            ...newElement(type, b && b[0] < b[2] && b[1] < b[3] ? b : [300, 300, 700, 700]),
            text: str(e.text),
            desc: str(e.desc),
            palette: (Array.isArray(e.color_palette) ? e.color_palette : []).map(normalizeHex).filter(Boolean).slice(0, MAX_ELEMENT_COLORS),
            character: type === 'obj' && chars.has(i + 1),
        };
    });
};

// The composer's elements → { list, characters }, in the node's key order.
export const elementsToLayout = (elements) => {
    const list = elements.map(e => {
        const el = { type: e.type, bbox: (e.bbox || [300, 300, 700, 700]).map(clampCoord) };
        if (e.type === 'text') el.text = e.text;
        el.desc = e.desc.trim();
        if (e.palette.length) el.color_palette = e.palette.slice(0, MAX_ELEMENT_COLORS);
        return el;
    });
    const characters = elements.map((e, i) => (e.type === 'obj' && e.character ? i + 1 : null)).filter(Boolean).join(', ');
    return { list, characters };
};

// Indented so a student can read it in the field; the server compacts it.
export const formatLayout = (list) => (list.length ? JSON.stringify(list, null, 2) : '');

// Warnings for a raw element list — empty when the node will accept it as meant.
export const checkLayout = (list) => {
    const warnings = [];
    list.forEach((el, i) => {
        const where = `Box ${i + 1}`;
        if (!el || typeof el !== 'object') { warnings.push(`${where} must be an object`); return; }
        const b = el.bbox;
        const valid = Array.isArray(b) && b.length === 4 && b.every(n => Number.isFinite(n) && n >= 0 && n <= 1000);
        if (!valid) warnings.push(`${where}: needs a box — 4 numbers from 0 to 1000 [y_min, x_min, y_max, x_max]`);
        else if (b[0] >= b[2] || b[1] >= b[3]) warnings.push(`${where}: the box's min must be smaller than its max`);
        if (el.type === 'text' && !str(el.text).trim()) warnings.push(`${where}: a text box needs the words to render`);
        if (!str(el.desc).trim()) warnings.push(`${where}: add a description`);
        if (Array.isArray(el.color_palette) && el.color_palette.length > MAX_ELEMENT_COLORS) {
            warnings.push(`${where}: at most ${MAX_ELEMENT_COLORS} colors`);
        }
    });
    return warnings;
};

// Status line under the layout field.
export const describeLayout = (text) => {
    const r = readLayout(text);
    if (r.kind === 'empty') return { level: 'none', short: 'No layout — the prompt is used on its own' };
    if (r.kind === 'broken') return { level: 'error', short: 'Not valid JSON', detail: `${r.error}. The job would fail — open the composer, or clear the field.` };
    if (r.kind === 'other') return { level: 'error', short: 'Not a layout', detail: 'The field must hold a list of boxes. Open the composer to draw them.' };
    const warnings = checkLayout(r.elements);
    const n = r.elements.length;
    if (!warnings.length) return { level: 'ok', short: `${n} box${n === 1 ? '' : 'es'} ✓` };
    return { level: 'warn', short: `${warnings.length} issue${warnings.length === 1 ? '' : 's'} in the layout`, detail: warnings.join('\n') };
};
