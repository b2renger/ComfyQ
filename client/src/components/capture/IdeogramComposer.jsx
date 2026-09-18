import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
    X, Check, Plus, Type, Box, Trash2, ChevronUp, ChevronDown, LayoutTemplate,
    AlertTriangle, CheckCircle2, Camera, Palette, Maximize, Minimize,
} from 'lucide-react';
import {
    readPrompt, checkCaption, captionToModel, modelToCaption, formatCaption, emptyModel,
    newElement, aspectFromOption, normalizeHex, flattenToText, looksLikeCaption,
    MAX_STYLE_COLORS, MAX_ELEMENT_COLORS, MEDIUM_SUGGESTIONS,
} from '../../utils/ideogramCaption';

// Visual composer for Ideogram 4's structured JSON prompt.
//
// The student lays out the picture instead of hand-writing JSON: drag on the
// canvas to place an object or a piece of text, describe it, pick colors, fill
// in the style and background. Apply writes a caption in Ideogram's exact
// schema and key order back into the prompt box. Rendered by DynamicParamFields
// for any textarea param whose meta says `"format": "ideogram4-caption"`.

const MIN_BOX = 20;                     // smallest box edge, in 0–1000 units
const clamp = (n) => Math.max(0, Math.min(1000, Math.round(n)));
// One distinct color per element, so overlapping boxes stay tellable apart.
const ELEMENT_COLORS = ['#38BDF8', '#F472B6', '#A3E635', '#FB923C', '#A78BFA', '#2DD4BF', '#FACC15', '#F87171'];
const colorAt = (i) => ELEMENT_COLORS[i % ELEMENT_COLORS.length];

// ---------------------------------------------------------------------------
// Status of the prompt box, shown under it in the booking form.

export const describePrompt = (text) => {
    const r = readPrompt(text);
    if (r.kind === 'empty') return { level: 'none' };
    if (r.kind === 'broken') {
        return { level: 'error', short: 'Not valid JSON', detail: `${r.error}. Ideogram 4 will most likely return “Image blocked by safety filter”.` };
    }
    if (r.kind !== 'object' || !looksLikeCaption(r.value)) {
        return {
            level: 'warn',
            short: r.kind === 'object' ? 'Not Ideogram’s JSON format' : 'Plain text',
            detail: 'Ideogram 4 only understands its own JSON caption and often blocks anything else. Open the composer to turn it into one.',
        };
    }
    const warnings = checkCaption(r.value);
    if (warnings.length === 0) return { level: 'ok', short: 'Ideogram caption ✓' };
    return { level: 'warn', short: `${warnings.length} format issue${warnings.length === 1 ? '' : 's'}`, detail: warnings.join('\n') };
};

// ---------------------------------------------------------------------------
// Small form pieces

const inputCls = 'w-full bg-background border border-border rounded-lg px-2.5 py-2 text-sm text-foreground placeholder:text-muted/60 focus:ring-2 focus:ring-primary focus:border-transparent outline-none';

const Field = ({ label, hint, children }) => (
    <label className="block space-y-1">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</span>
        {children}
        {hint && <span className="block text-[10px] text-muted/80">{hint}</span>}
    </label>
);

const TextArea = ({ value, onChange, rows = 2, placeholder }) => (
    <textarea
        className={`${inputCls} resize-y leading-relaxed`}
        rows={rows}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
    />
);

const PaletteEditor = ({ colors, max, onChange }) => {
    const [pick, setPick] = useState('#3366FF');
    const full = colors.length >= max;
    const add = () => {
        const hex = normalizeHex(pick);
        if (!hex || full || colors.includes(hex)) return;
        onChange([...colors, hex]);
    };
    return (
        <div className="space-y-1.5">
            <div className="flex flex-wrap gap-1.5">
                {colors.map((c) => (
                    <button
                        key={c}
                        type="button"
                        onClick={() => onChange(colors.filter(x => x !== c))}
                        className="group relative w-7 h-7 rounded-md border border-border shadow-sm"
                        style={{ backgroundColor: c }}
                        title={`${c} — click to remove`}
                    >
                        <X size={12} className="absolute inset-0 m-auto text-white opacity-0 group-hover:opacity-100 drop-shadow" />
                    </button>
                ))}
                {colors.length === 0 && <span className="text-[11px] text-muted italic">No colors — optional</span>}
            </div>
            <div className="flex items-center gap-1.5">
                <input
                    type="color"
                    value={pick}
                    onChange={(e) => setPick(e.target.value)}
                    className="w-9 h-8 rounded border border-border bg-background cursor-pointer"
                    disabled={full}
                />
                <button
                    type="button"
                    onClick={add}
                    disabled={full}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-border bg-surface text-xs text-foreground hover:bg-surface/70 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                    <Plus size={12} /> Add color
                </button>
                <span className="text-[10px] text-muted ml-auto">{colors.length}/{max}</span>
            </div>
        </div>
    );
};

const Section = ({ icon: Icon, title, children, right }) => (
    <section className="space-y-3 border-b border-border pb-4">
        <div className="flex items-center gap-2">
            <Icon size={14} className="text-primary" />
            <h4 className="text-xs font-bold uppercase tracking-widest text-foreground">{title}</h4>
            {right && <div className="ml-auto">{right}</div>}
        </div>
        {children}
    </section>
);

// ---------------------------------------------------------------------------
// The composer modal

// The prompt box's text → the composer's starting model, plus a note when the
// text wasn't an Ideogram caption.
const loadPrompt = (value) => {
    const r = readPrompt(value);
    const model = emptyModel();
    if (r.kind === 'object' && looksLikeCaption(r.value)) {
        return { model: captionToModel(r.value), notice: '' };
    }
    if (r.kind === 'object' || r.kind === 'other-json') {
        model.highLevel = typeof r.value === 'string' ? r.value : flattenToText(r.value);
        return { model, notice: 'This prompt wasn’t in Ideogram’s format, so its text became the high-level description. Rewrite it as one or two sentences, then add the style, background and elements.' };
    }
    if (r.kind === 'plain') {
        model.highLevel = String(value).trim();
        return { model, notice: 'Your text became the high-level description. Now add the style, the background and the elements.' };
    }
    if (r.kind === 'broken') {
        return { model, notice: `The prompt box doesn’t contain valid JSON (${r.error}), so the composer starts empty. The prompt box stays unchanged until you press Apply.` };
    }
    return { model, notice: '' };
};

// Mounted only while open, so every opening starts from the prompt box's
// current text (no frame of the previous session).
const IdeogramComposer = ({ value, aspectOption, label, onApply, onClose }) => {
    const [initial] = useState(() => loadPrompt(value));
    const [model, setModel] = useState(initial.model);
    const [selectedId, setSelectedId] = useState(initial.model.elements[0]?.id ?? null);
    const [notice, setNotice] = useState(initial.notice);
    const [draft, setDraft] = useState(null);        // box being drawn: [y1,x1,y2,x2]
    const [stageSize, setStageSize] = useState({ w: 0, h: 0 });
    const [wideCanvas, setWideCanvas] = useState(false);
    const areaRef = useRef(null);
    const stageRef = useRef(null);
    const drag = useRef(null);
    const aspect = aspectFromOption(aspectOption);

    const update = useCallback((patch) => setModel(m => ({ ...m, ...patch })), []);
    const updateElement = useCallback((id, patch) => setModel(m => ({
        ...m, elements: m.elements.map(el => (el.id === id ? { ...el, ...patch } : el)),
    })), []);
    const removeElement = useCallback((id) => {
        setModel(m => ({ ...m, elements: m.elements.filter(el => el.id !== id) }));
        setSelectedId(s => (s === id ? null : s));
    }, []);
    const addElement = (type) => {
        const el = newElement(type, type === 'text' ? [100, 200, 220, 800] : [300, 300, 700, 700]);
        setModel(m => ({ ...m, elements: [...m.elements, el] }));
        setSelectedId(el.id);
    };
    const moveElement = (id, dir) => setModel(m => {
        const i = m.elements.findIndex(el => el.id === id);
        const j = i + dir;
        if (i < 0 || j < 0 || j >= m.elements.length) return m;
        const els = [...m.elements];
        [els[i], els[j]] = [els[j], els[i]];
        return { ...m, elements: els };
    });

    // Largest stage with the job's aspect ratio that fits the canvas area.
    useEffect(() => {
        if (!areaRef.current) return;
        const el = areaRef.current;
        const fit = () => {
            const aw = el.clientWidth, ah = el.clientHeight;
            if (!aw || !ah) return;
            const w = Math.min(aw, ah * aspect);
            setStageSize({ w: Math.floor(w), h: Math.floor(w / aspect) });
        };
        fit();
        const ro = new ResizeObserver(fit);
        ro.observe(el);
        return () => ro.disconnect();
    }, [aspect, wideCanvas]);

    // Keys: Escape closes without applying; Delete removes the selected element
    // unless the student is typing in a field.
    useEffect(() => {
        const onKey = (e) => {
            if (e.key === 'Escape') { onClose(); return; }
            const tag = (e.target?.tagName || '').toLowerCase();
            if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId && !['input', 'textarea', 'select'].includes(tag)) {
                e.preventDefault();
                removeElement(selectedId);
            }
        };
        window.addEventListener('keydown', onKey);
        const prevOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prevOverflow; };
    }, [onClose, selectedId, removeElement]);

    // ---- canvas pointer handling ------------------------------------------
    const pointAt = (e) => {
        const r = stageRef.current.getBoundingClientRect();
        return { x: clamp(((e.clientX - r.left) / r.width) * 1000), y: clamp(((e.clientY - r.top) / r.height) * 1000) };
    };

    const onPointerDown = (e) => {
        if (e.button !== 0 || !stageRef.current) return;
        const p = pointAt(e);
        const handle = e.target.closest('[data-handle]');
        const boxEl = e.target.closest('[data-box]');
        stageRef.current.setPointerCapture(e.pointerId);
        if (handle || boxEl) {
            const id = (handle || boxEl).getAttribute(handle ? 'data-handle' : 'data-box');
            const el = model.elements.find(x => x.id === id);
            if (!el?.bbox) return;
            setSelectedId(id);
            drag.current = { mode: handle ? 'resize' : 'move', id, start: p, orig: el.bbox };
        } else {
            drag.current = { mode: 'new', start: p };
            setDraft([p.y, p.x, p.y, p.x]);
        }
        e.preventDefault();
    };

    const onPointerMove = (e) => {
        const d = drag.current;
        if (!d) return;
        const p = pointAt(e);
        if (d.mode === 'new') {
            // Kept on the ref too: pointerup can arrive before React re-renders
            // with the last move, and the box must end where the pointer did.
            d.box = [Math.min(d.start.y, p.y), Math.min(d.start.x, p.x), Math.max(d.start.y, p.y), Math.max(d.start.x, p.x)];
            setDraft(d.box);
        } else if (d.mode === 'move') {
            const [y1, x1, y2, x2] = d.orig;
            const dy = Math.max(-y1, Math.min(1000 - y2, p.y - d.start.y));
            const dx = Math.max(-x1, Math.min(1000 - x2, p.x - d.start.x));
            updateElement(d.id, { bbox: [y1 + dy, x1 + dx, y2 + dy, x2 + dx] });
        } else if (d.mode === 'resize') {
            const [y1, x1] = d.orig;
            updateElement(d.id, { bbox: [y1, x1, Math.max(y1 + MIN_BOX, p.y), Math.max(x1 + MIN_BOX, p.x)] });
        }
    };

    const onPointerUp = () => {
        const d = drag.current;
        drag.current = null;
        if (d?.mode !== 'new') return;
        const box = d.box;
        setDraft(null);
        if (!box || box[2] - box[0] < MIN_BOX || box[3] - box[1] < MIN_BOX) {
            setSelectedId(null);                    // a click on empty canvas
            return;
        }
        const el = newElement('obj', box);
        setModel(m => ({ ...m, elements: [...m.elements, el] }));
        setSelectedId(el.id);
    };

    // ---- output -----------------------------------------------------------
    const caption = useMemo(() => modelToCaption(model), [model]);
    const warnings = useMemo(() => checkCaption(caption), [caption]);
    const selected = model.elements.find(el => el.id === selectedId) || null;

    const apply = () => { onApply(formatCaption(caption)); onClose(); };

    const boxStyle = ([y1, x1, y2, x2]) => ({
        top: `${y1 / 10}%`, left: `${x1 / 10}%`, height: `${(y2 - y1) / 10}%`, width: `${(x2 - x1) / 10}%`,
    });

    return createPortal(
        <div className="fixed inset-0 z-[100] flex flex-col bg-background/95 backdrop-blur-sm text-foreground">
            {/* Header */}
            <div className="flex items-center gap-3 flex-wrap px-3 sm:px-4 py-2.5 border-b border-border bg-surface/80 shrink-0">
                <div className="flex items-center gap-2 text-sm font-medium min-w-0">
                    <LayoutTemplate size={15} className="text-primary shrink-0" />
                    <span className="truncate">Compose — {label}</span>
                </div>
                <span className="text-[11px] text-muted hidden md:inline">
                    Canvas {aspectOption || '1:1'} · drag on the canvas to add an element · Delete removes the selected one
                </span>
                <div className="ml-auto flex items-center gap-2">
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-3 py-1.5 rounded-lg border border-border text-sm text-muted hover:text-foreground hover:bg-surface"
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={apply}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-on-primary text-sm font-semibold hover:opacity-90"
                        title="Write this caption into the prompt box"
                    >
                        <Check size={15} /> Apply
                    </button>
                </div>
            </div>

            {notice && (
                <div className="shrink-0 px-3 sm:px-4 py-2 text-xs bg-primary/10 border-b border-primary/20 flex items-start gap-2">
                    <AlertTriangle size={13} className="text-primary shrink-0 mt-0.5" />
                    <span className="flex-1">{notice}</span>
                    <button type="button" onClick={() => setNotice('')} className="text-muted hover:text-foreground"><X size={13} /></button>
                </div>
            )}

            <div className="flex-1 min-h-0 flex flex-col lg:flex-row">
                {/* Canvas */}
                <div className={`${wideCanvas ? 'lg:flex-[3]' : 'lg:flex-[2]'} min-h-[45vh] lg:min-h-0 flex flex-col p-3 sm:p-4 gap-2`}>
                    <div className="flex items-center gap-2 shrink-0">
                        <button type="button" onClick={() => addElement('obj')} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-border bg-surface text-xs hover:bg-surface/70">
                            <Box size={13} /> Add object
                        </button>
                        <button type="button" onClick={() => addElement('text')} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-border bg-surface text-xs hover:bg-surface/70">
                            <Type size={13} /> Add text
                        </button>
                        <button
                            type="button"
                            onClick={() => setWideCanvas(v => !v)}
                            className="ml-auto hidden lg:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-border bg-surface text-xs hover:bg-surface/70"
                            title={wideCanvas ? 'Give the side panel more room' : 'Give the canvas more room'}
                        >
                            {wideCanvas ? <Minimize size={13} /> : <Maximize size={13} />} {wideCanvas ? 'Smaller canvas' : 'Bigger canvas'}
                        </button>
                    </div>
                    <div ref={areaRef} className="flex-1 min-h-0 flex items-center justify-center">
                        <div
                            ref={stageRef}
                            onPointerDown={onPointerDown}
                            onPointerMove={onPointerMove}
                            onPointerUp={onPointerUp}
                            onPointerCancel={onPointerUp}
                            className="relative rounded-md border border-border shadow-2xl select-none cursor-crosshair overflow-hidden bg-surface"
                            style={{
                                width: stageSize.w, height: stageSize.h, touchAction: 'none',
                                backgroundImage: 'linear-gradient(rgba(127,127,127,0.12) 1px, transparent 1px), linear-gradient(90deg, rgba(127,127,127,0.12) 1px, transparent 1px)',
                                backgroundSize: '10% 10%',
                            }}
                        >
                            {model.palette.length > 0 && (
                                <div className="absolute bottom-0 left-0 right-0 h-1.5 flex pointer-events-none opacity-80">
                                    {model.palette.map(c => <div key={c} className="flex-1" style={{ backgroundColor: c }} />)}
                                </div>
                            )}
                            {model.elements.map((el, i) => el.bbox && (
                                <div
                                    key={el.id}
                                    data-box={el.id}
                                    className={`absolute rounded-sm cursor-move ${el.type === 'text' ? 'border-2 border-dashed' : 'border-2'} ${el.id === selectedId ? 'z-10' : ''}`}
                                    style={{
                                        ...boxStyle(el.bbox),
                                        borderColor: colorAt(i),
                                        backgroundColor: `${colorAt(i)}${el.id === selectedId ? '33' : '14'}`,
                                        boxShadow: el.id === selectedId ? `0 0 0 2px ${colorAt(i)}` : undefined,
                                    }}
                                >
                                    <span className="absolute top-0 left-0 max-w-full truncate px-1 py-0.5 text-[10px] font-semibold leading-none rounded-br text-black" style={{ backgroundColor: colorAt(i) }}>
                                        {i + 1} · {el.type === 'text' ? (el.text ? `T “${el.text}”` : 'T text') : (el.desc ? el.desc.slice(0, 40) : 'object')}
                                    </span>
                                    <span
                                        data-handle={el.id}
                                        className="absolute -bottom-1.5 -right-1.5 w-3.5 h-3.5 rounded-sm border-2 border-background cursor-nwse-resize"
                                        style={{ backgroundColor: colorAt(i) }}
                                    />
                                </div>
                            ))}
                            {draft && <div className="absolute border-2 border-dashed border-foreground/70 bg-foreground/5 pointer-events-none" style={boxStyle(draft)} />}
                            {model.elements.length === 0 && !draft && (
                                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                    <p className="text-xs text-muted text-center px-6">Drag here to place the first element — a subject, an object, or a piece of text.</p>
                                </div>
                            )}
                        </div>
                    </div>
                    {/* Both learned by rendering test layouts on the rig. */}
                    <p className="shrink-0 text-[11px] text-muted leading-relaxed">
                        Draw each box the shape the thing should be — Ideogram follows box shape closely.
                        Boxes that sit apart in empty corners can make it split the frame into separate panels;
                        keeping them adjacent, or adding boxes for the floor and walls, keeps one scene.
                    </p>
                </div>

                {/* Side panel */}
                <div className={`${wideCanvas ? 'lg:flex-[2]' : 'lg:flex-[3]'} lg:max-w-2xl min-h-0 overflow-y-auto custom-scrollbar border-t lg:border-t-0 lg:border-l border-border p-3 sm:p-4 space-y-4`}>
                    <Section icon={LayoutTemplate} title="Picture">
                        <Field label="High-level description" hint="One or two sentences summing up the whole image.">
                            <TextArea value={model.highLevel} onChange={v => update({ highLevel: v })} rows={3} placeholder="A medium-shot photograph of a barista pouring latte art in a cozy café." />
                        </Field>
                        <Field label="Background" hint="Required — the setting behind the elements.">
                            <TextArea value={model.background} onChange={v => update({ background: v })} rows={2} placeholder="A warm café interior with wooden shelves, softly out of focus." />
                        </Field>
                    </Section>

                    <Section icon={Camera} title="Style">
                        <div className="grid grid-cols-3 gap-1 bg-surface border border-border rounded-lg p-1">
                            {[['photo', 'Photo'], ['art', 'Art style'], ['none', 'No style']].map(([k, l]) => (
                                <button
                                    key={k}
                                    type="button"
                                    onClick={() => update({ styleMode: k })}
                                    className={`px-2 py-1.5 rounded-md text-xs font-semibold ${model.styleMode === k ? 'bg-primary text-on-primary' : 'text-muted hover:text-foreground'}`}
                                >
                                    {l}
                                </button>
                            ))}
                        </div>
                        {model.styleMode !== 'none' && (
                            <>
                                <div className="grid sm:grid-cols-2 gap-3">
                                    <Field label="Aesthetics" hint="Mood keywords, e.g. moody, cinematic, desaturated">
                                        <input className={inputCls} value={model.aesthetics} onChange={e => update({ aesthetics: e.target.value })} />
                                    </Field>
                                    <Field label="Lighting" hint="e.g. golden hour, rim light, soft shadows">
                                        <input className={inputCls} value={model.lighting} onChange={e => update({ lighting: e.target.value })} />
                                    </Field>
                                </div>
                                {model.styleMode === 'photo' ? (
                                    <div className="grid sm:grid-cols-2 gap-3">
                                        <Field label="Photo" hint="Camera and lens, e.g. 35mm, f/1.4, shallow depth of field">
                                            <input className={inputCls} value={model.photo} onChange={e => update({ photo: e.target.value })} />
                                        </Field>
                                        <Field label="Medium" hint="Usually “photograph”">
                                            <input className={inputCls} placeholder="photograph" value={model.medium} onChange={e => update({ medium: e.target.value })} />
                                        </Field>
                                    </div>
                                ) : (
                                    <div className="grid sm:grid-cols-2 gap-3">
                                        <Field label="Medium" hint="illustration, 3d_render, painting, graphic_design…">
                                            <input className={inputCls} list="ideogram-mediums" value={model.medium} onChange={e => update({ medium: e.target.value })} />
                                            <datalist id="ideogram-mediums">
                                                {MEDIUM_SUGGESTIONS.map(m => <option key={m} value={m} />)}
                                            </datalist>
                                        </Field>
                                        <Field label="Art style" hint="e.g. flat vector illustration, bold outlines">
                                            <input className={inputCls} value={model.artStyle} onChange={e => update({ artStyle: e.target.value })} />
                                        </Field>
                                    </div>
                                )}
                                <Field label="Color palette" hint="Dominant colors of the whole image — include the background's.">
                                    <PaletteEditor colors={model.palette} max={MAX_STYLE_COLORS} onChange={v => update({ palette: v })} />
                                </Field>
                            </>
                        )}
                    </Section>

                    <Section icon={Box} title={`Elements (${model.elements.length})`}>
                        {model.elements.length === 0 ? (
                            <p className="text-xs text-muted">
                                Draw a box on the canvas, or use Add object / Add text. Put every word to render in its own text element.
                                <span className="block mt-1 text-amber-500">Give every element a box: prompts whose elements have no box are the ones Ideogram blocks with its gray “safety filter” picture.</span>
                            </p>
                        ) : (
                            <div className="space-y-1">
                                {model.elements.map((el, i) => (
                                    <button
                                        key={el.id}
                                        type="button"
                                        onClick={() => setSelectedId(el.id)}
                                        className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left text-xs border ${el.id === selectedId ? 'border-primary bg-primary/10' : 'border-transparent hover:bg-surface'}`}
                                    >
                                        {el.type === 'text' ? <Type size={12} className="shrink-0" style={{ color: colorAt(i) }} /> : <Box size={12} className="shrink-0" style={{ color: colorAt(i) }} />}
                                        <span className="font-mono text-muted">{i + 1}</span>
                                        <span className="truncate flex-1">{el.type === 'text' ? (el.text ? `“${el.text}”` : <em className="text-muted">no text yet</em>) : (el.desc || <em className="text-muted">no description yet</em>)}</span>
                                        {!el.bbox && <span className="text-[9px] uppercase tracking-wider text-muted">no box</span>}
                                    </button>
                                ))}
                            </div>
                        )}

                        {selected && (
                            <div className="rounded-lg border border-border bg-surface/40 p-3 space-y-3">
                                <div className="flex items-center gap-1.5">
                                    <div className="grid grid-cols-2 gap-1 bg-background border border-border rounded-md p-0.5">
                                        {[['obj', 'Object'], ['text', 'Text']].map(([k, l]) => (
                                            <button
                                                key={k}
                                                type="button"
                                                onClick={() => updateElement(selected.id, { type: k })}
                                                className={`px-2 py-1 rounded text-[11px] font-semibold ${selected.type === k ? 'bg-primary text-on-primary' : 'text-muted hover:text-foreground'}`}
                                            >
                                                {l}
                                            </button>
                                        ))}
                                    </div>
                                    <button type="button" onClick={() => moveElement(selected.id, -1)} className="ml-auto p-1.5 rounded border border-border hover:bg-surface" title="Move up the list"><ChevronUp size={13} /></button>
                                    <button type="button" onClick={() => moveElement(selected.id, 1)} className="p-1.5 rounded border border-border hover:bg-surface" title="Move down the list"><ChevronDown size={13} /></button>
                                    <button type="button" onClick={() => removeElement(selected.id)} className="p-1.5 rounded border border-danger/30 text-danger hover:bg-danger/10" title="Delete this element"><Trash2 size={13} /></button>
                                </div>
                                {selected.type === 'text' && (
                                    <Field label="Text to render" hint="Exactly the words that should appear in the image.">
                                        <input className={inputCls} value={selected.text} onChange={e => updateElement(selected.id, { text: e.target.value })} />
                                    </Field>
                                )}
                                <Field label="Description" hint={selected.type === 'text' ? 'How the text looks: font, size, color, where it sits.' : 'What it is, what it looks like, its pose or material.'}>
                                    <TextArea value={selected.desc} onChange={v => updateElement(selected.id, { desc: v })} rows={3} />
                                </Field>
                                <Field label="Colors" hint="Optional, up to 5.">
                                    <PaletteEditor colors={selected.palette} max={MAX_ELEMENT_COLORS} onChange={v => updateElement(selected.id, { palette: v })} />
                                </Field>
                                {/* Measured on the rig: a text element in a tall,
                                    narrow box comes out rotated 90° (sometimes
                                    upside down), because the box shape sets the
                                    orientation of the words. */}
                                {selected.type === 'text' && selected.bbox
                                    && (selected.bbox[2] - selected.bbox[0]) > 1.6 * (selected.bbox[3] - selected.bbox[1]) && (
                                        <p className="text-[11px] text-amber-500 flex items-start gap-1.5">
                                            <AlertTriangle size={12} className="shrink-0 mt-0.5" />
                                            This box is much taller than it is wide, so Ideogram will set the words vertically. Draw a wide box for horizontal text.
                                        </p>
                                    )}
                                <div className="flex items-center gap-2 text-[11px] text-muted">
                                    {selected.bbox ? (
                                        <>
                                            <span className="font-mono">box [{selected.bbox.join(', ')}]</span>
                                            <button type="button" onClick={() => updateElement(selected.id, { bbox: null })} className="ml-auto underline hover:text-foreground" title="Let the model decide where it goes — more likely to be blocked by the safety filter">No position</button>
                                        </>
                                    ) : (
                                        <>
                                            <span className="text-amber-500">No box — likely to be blocked.</span>
                                            <button type="button" onClick={() => updateElement(selected.id, { bbox: [300, 300, 700, 700] })} className="ml-auto underline hover:text-foreground">Place on canvas</button>
                                        </>
                                    )}
                                </div>
                            </div>
                        )}
                    </Section>

                    <Section
                        icon={warnings.length ? AlertTriangle : CheckCircle2}
                        title="Check"
                        right={warnings.length === 0 ? <span className="text-[11px] text-success font-semibold">Matches Ideogram 4’s format</span> : null}
                    >
                        {warnings.length > 0 && (
                            <ul className="space-y-1">
                                {warnings.map((w, i) => (
                                    <li key={i} className="flex items-start gap-1.5 text-xs text-amber-500">
                                        <AlertTriangle size={12} className="shrink-0 mt-0.5" /> <span>{w}</span>
                                    </li>
                                ))}
                            </ul>
                        )}
                        <details className="text-xs">
                            <summary className="cursor-pointer text-muted hover:text-foreground inline-flex items-center gap-1"><Palette size={12} /> Show the JSON</summary>
                            <pre className="mt-2 max-h-72 overflow-auto custom-scrollbar rounded-md bg-background border border-border p-2 text-[11px] leading-snug whitespace-pre-wrap break-words">{formatCaption(caption)}</pre>
                        </details>
                    </Section>
                </div>
            </div>
        </div>,
        document.body
    );
};

// The composer's entry point in the booking form: a "Compose" button and the
// prompt's format status, placed under the prompt box.
export const IdeogramPromptTools = ({ value, onChange, disabled, aspectOption, label }) => {
    const [open, setOpen] = useState(false);
    const status = useMemo(() => describePrompt(value), [value]);
    const close = useCallback(() => setOpen(false), []);
    const tone = {
        ok: 'text-success',
        warn: 'text-amber-500',
        error: 'text-danger',
    }[status.level];
    return (
        <div className="flex items-start gap-2 flex-wrap">
            <button
                type="button"
                disabled={disabled}
                onClick={() => setOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-on-primary text-xs font-semibold hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
            >
                <LayoutTemplate size={13} /> Compose visually
            </button>
            {status.level !== 'none' && (
                <div className={`flex-1 min-w-[12rem] text-[11px] ${tone}`}>
                    <span className="font-semibold inline-flex items-center gap-1">
                        {status.level === 'ok' ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />}
                        {status.short}
                    </span>
                    {status.detail && <span className="block text-muted whitespace-pre-line">{status.detail}</span>}
                </div>
            )}
            {open && <IdeogramComposer
                value={value}
                aspectOption={aspectOption}
                label={label}
                onApply={onChange}
                onClose={close}
            />}
        </div>
    );
};

export default IdeogramComposer;
