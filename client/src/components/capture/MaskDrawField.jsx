import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Upload, X, Brush, Eraser, Undo2, Trash2, Loader2, AlertTriangle, RotateCw } from 'lucide-react';
import { resizeImageFile } from '../../utils/imageResize';

// MaskDrawField — paint-a-mask input widget for BookingDialog (param type
// 'mask'). The user uploads a base image, brushes over the region they want
// the workflow to REPLACE, and we composite that into a single RGBA PNG where
// the painted area is TRANSPARENT. ComfyUI's LoadImage derives its MASK output
// as `1 - alpha`, so transparent (alpha 0) → mask 1.0 → "inpaint here", and
// opaque (alpha 255) → mask 0.0 → "keep". The IMAGE output (0) is the RGB base.
// One file carries both the picture and the mask — no graph rewiring needed.
//
// The produced File (image/png, alpha intact) is handed up via onChange(file)
// exactly like an uploaded image, so the rest of the pipeline (POST /upload →
// generic materializer → LoadImage) is unchanged. We deliberately compose at
// the final, box-fitted resolution and do NOT re-run resizeImageFile on the
// result — a second canvas pass would antialias the hard mask edges.
//
// Mask convention is enforced here via globalCompositeOperation:
//  - paint:   strokes drawn opaque (red) onto an offscreen mask canvas
//  - export:  drawImage(base) then destination-out drawImage(maskCanvas), which
//             erases the base's alpha wherever the mask is opaque → transparency
//             exactly under the painted region.

const DEFAULT_IMAGE_MAX_LONG = 1920;
const DEFAULT_IMAGE_MAX_SHORT = 1080;
const MAX_UNDO = 24;
// The brush colour is purely for on-screen visibility — pick whatever contrasts
// with the picture. On export only the ALPHA matters (destination-out), so the
// colour never changes the produced mask.
const DEFAULT_MASK_COLOR = '#ef4444'; // red-500
const MASK_COLOR_PRESETS = ['#ef4444', '#22c55e', '#3b82f6', '#eab308', '#ffffff'];

async function fileToBitmap(file) {
    if (typeof createImageBitmap === 'function') {
        try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); }
        catch { try { return await createImageBitmap(file); } catch { /* fall through */ } }
    }
    return await new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
        img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
        img.src = url;
    });
}

const MaskDrawField = ({
    paramKey,
    label,
    maxInputEdge,   // optional long-edge cap; falls back to the 1920×1080 box
    preview,        // data/server URL — used only to thumbnail a recalled mask
    recalledName,   // set when a mask from a prior job is being reused
    onChange,       // (file: File) => void — the composited RGBA PNG
    onRemove        // () => void
}) => {
    const displayRef = useRef(null);  // the visible, paint-on canvas
    const maskRef = useRef(null);     // offscreen: opaque strokes = the mask
    const baseRef = useRef(null);     // ImageBitmap/Image of the base picture
    const undoStack = useRef([]);     // ImageData snapshots (pre-stroke)
    const drawing = useRef(false);
    const lastPt = useRef(null);
    const fileInputRef = useRef(null);

    const [dims, setDims] = useState(null);     // { w, h } once a base is loaded
    const [brush, setBrush] = useState(48);
    const [erase, setErase] = useState(false);
    const [brushColor, setBrushColor] = useState(DEFAULT_MASK_COLOR);
    const [strokes, setStrokes] = useState(0);
    const [processing, setProcessing] = useState(false);
    const [error, setError] = useState('');
    const [dragActive, setDragActive] = useState(false);

    const maxLong = maxInputEdge ?? DEFAULT_IMAGE_MAX_LONG;
    const maxShort = maxInputEdge ?? DEFAULT_IMAGE_MAX_SHORT;
    const reusing = !!recalledName && !dims;

    // Redraw the visible canvas: base picture + a translucent overlay of the
    // mask so the user sees what they've painted.
    const redraw = useCallback(() => {
        const cv = displayRef.current, base = baseRef.current, mask = maskRef.current;
        if (!cv || !base || !mask) return;
        const ctx = cv.getContext('2d');
        ctx.clearRect(0, 0, cv.width, cv.height);
        ctx.drawImage(base, 0, 0);
        ctx.save();
        ctx.globalAlpha = 0.45;
        ctx.drawImage(mask, 0, 0);
        ctx.restore();
    }, []);

    // Composite base + mask into an RGBA PNG (painted → transparent) and emit it.
    const commit = useCallback(() => {
        const base = baseRef.current, mask = maskRef.current;
        if (!base || !mask) return;
        const out = document.createElement('canvas');
        out.width = base.width; out.height = base.height;
        const ctx = out.getContext('2d');
        ctx.drawImage(base, 0, 0);
        ctx.globalCompositeOperation = 'destination-out';
        ctx.drawImage(mask, 0, 0); // erase base alpha where the mask is opaque
        ctx.globalCompositeOperation = 'source-over';
        out.toBlob((blob) => {
            if (!blob) return;
            onChange(new File([blob], `mask-${paramKey}.png`, { type: 'image/png' }));
        }, 'image/png');
    }, [onChange, paramKey]);

    // Size the visible canvas to the base resolution whenever a base loads.
    useEffect(() => {
        if (!dims) return;
        const cv = displayRef.current;
        if (!cv) return;
        cv.width = dims.w; cv.height = dims.h;
        redraw();
    }, [dims, redraw]);

    const loadBase = async (file) => {
        if (!file) return;
        setError('');
        if (fileInputRef.current) fileInputRef.current.value = '';
        setProcessing(true);
        try {
            // resizeImageFile rejects HEIC / oversize and fits the box; it keeps
            // PNG sources as PNG. We only need a box-fitted bitmap to paint on.
            const fitted = await resizeImageFile(file, maxLong, { maxShort });
            const bmp = await fileToBitmap(fitted);
            const w = bmp.width || bmp.naturalWidth;
            const h = bmp.height || bmp.naturalHeight;
            if (!w || !h) throw new Error('Couldn’t read this image. Use a standard JPEG or PNG.');
            baseRef.current = bmp;
            const mask = document.createElement('canvas');
            mask.width = w; mask.height = h;
            maskRef.current = mask;
            undoStack.current = [];
            setStrokes(0);
            setDims({ w, h });
        } catch (e) {
            setError(e?.message || 'Couldn’t process this image. Use a smaller JPEG or PNG.');
        } finally {
            setProcessing(false);
        }
    };

    // ---- pointer painting ----
    const ptFromEvent = (e) => {
        const cv = displayRef.current;
        const rect = cv.getBoundingClientRect();
        return {
            x: (e.clientX - rect.left) * (cv.width / rect.width),
            y: (e.clientY - rect.top) * (cv.height / rect.height),
        };
    };

    const strokeTo = (pt) => {
        const mask = maskRef.current;
        if (!mask) return;
        const ctx = mask.getContext('2d');
        ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = brush;
        // Eraser removes painted mask; brush adds it. Both only matter by alpha.
        ctx.globalCompositeOperation = erase ? 'destination-out' : 'source-over';
        ctx.strokeStyle = brushColor; ctx.fillStyle = brushColor;
        const from = lastPt.current || pt;
        ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(pt.x, pt.y); ctx.stroke();
        ctx.beginPath(); ctx.arc(pt.x, pt.y, brush / 2, 0, Math.PI * 2); ctx.fill(); // round the tip / single taps
        ctx.globalCompositeOperation = 'source-over';
        lastPt.current = pt;
        redraw();
    };

    const onPointerDown = (e) => {
        if (!dims) return;
        e.preventDefault();
        try { displayRef.current.setPointerCapture?.(e.pointerId); } catch { /* ignore */ }
        // Snapshot the mask BEFORE this stroke so Undo can restore it.
        try {
            const mask = maskRef.current;
            const snap = mask.getContext('2d').getImageData(0, 0, mask.width, mask.height);
            undoStack.current.push(snap);
            if (undoStack.current.length > MAX_UNDO) undoStack.current.shift();
        } catch { /* getImageData can throw on tainted canvas; never here (same-origin) */ }
        drawing.current = true;
        lastPt.current = null;
        strokeTo(ptFromEvent(e));
    };
    const onPointerMove = (e) => {
        if (!drawing.current) return;
        e.preventDefault();
        strokeTo(ptFromEvent(e));
    };
    const endStroke = () => {
        if (!drawing.current) return;
        drawing.current = false;
        lastPt.current = null;
        setStrokes((n) => n + 1);
        commit();
    };

    const undo = () => {
        const mask = maskRef.current;
        if (!mask) return;
        const snap = undoStack.current.pop();
        const ctx = mask.getContext('2d');
        if (snap) ctx.putImageData(snap, 0, 0);
        else ctx.clearRect(0, 0, mask.width, mask.height);
        setStrokes((n) => Math.max(0, n - 1));
        redraw();
        commit();
    };

    // Change the mask colour. Recolours the already-painted strokes too, via
    // source-in (result = newColour where the mask is opaque, alpha preserved),
    // so the whole region stays one colour. Cosmetic only: the alpha geometry —
    // and therefore the exported PNG — is unchanged, so no re-commit is needed.
    const applyColor = (color) => {
        setBrushColor(color);
        const mask = maskRef.current;
        if (!mask) return;
        const ctx = mask.getContext('2d');
        ctx.save();
        ctx.globalCompositeOperation = 'source-in';
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, mask.width, mask.height);
        ctx.restore();
        redraw();
    };

    const clearMask = () => {
        const mask = maskRef.current;
        if (!mask) return;
        mask.getContext('2d').clearRect(0, 0, mask.width, mask.height);
        undoStack.current = [];
        setStrokes(0);
        redraw();
        commit(); // empty mask: a valid (no-op) file so the field stays satisfied
    };

    const reset = () => {
        baseRef.current = null; maskRef.current = null; undoStack.current = [];
        setDims(null); setStrokes(0); setError(''); setErase(false);
        onRemove(); // clears the parent's mediaFiles + recalledMedia for this key
    };

    // ---- drag & drop onto the upload dropzone ----
    const onDragEnter = (e) => { e.preventDefault(); e.stopPropagation(); if (!processing) setDragActive(true); };
    const onDragOver = (e) => { e.preventDefault(); e.stopPropagation(); };
    const onDragLeave = (e) => { e.preventDefault(); e.stopPropagation(); setDragActive(false); };
    const onDrop = (e) => {
        e.preventDefault(); e.stopPropagation(); setDragActive(false);
        if (processing) return;
        const file = e.dataTransfer?.files?.[0];
        if (!file) return;
        if (file.type && !file.type.startsWith('image/')) return;
        loadBase(file);
    };

    return (
        <div className="space-y-2">
            <label className="text-sm font-medium text-slate-300 flex items-center gap-2 flex-wrap">
                <Brush size={14} className="text-primary" />
                <span>{label}</span>
                <span className="text-[10px] text-muted font-normal">— paint the area to replace</span>
            </label>

            {reusing ? (
                // A mask reused from a prior job ("Use these settings"). We can't
                // re-edit the baked-in mask, so show it and offer a fresh start.
                <div className="relative border-2 border-dashed border-primary/50 bg-primary/5 rounded-xl p-3">
                    <div className="relative aspect-video rounded-lg overflow-hidden bg-background">
                        <span className="absolute top-1.5 left-1.5 z-10 px-1.5 py-0.5 rounded-md bg-primary/90 text-on-primary text-[9px] font-semibold inline-flex items-center gap-1" title={recalledName}>
                            <RotateCw size={9} /> Reused mask
                        </span>
                        {preview && <img src={preview} alt="Reused mask" className="w-full h-full object-contain" />}
                    </div>
                    <button
                        type="button"
                        onClick={reset}
                        className="mt-2 w-full text-xs font-medium py-2 rounded-lg border border-border bg-surface/60 hover:border-primary/40 hover:bg-surface transition-colors text-foreground"
                    >
                        Draw a new mask
                    </button>
                </div>
            ) : !dims ? (
                // Stage 1 — pick a base image.
                <div
                    className={`relative border-2 border-dashed rounded-xl p-3 transition-colors ${
                        dragActive ? 'border-primary bg-primary/10 ring-2 ring-primary/30' : 'border-border bg-surface/30'
                    }`}
                    onDragEnter={onDragEnter}
                    onDragOver={onDragOver}
                    onDragLeave={onDragLeave}
                    onDrop={onDrop}
                >
                    <label className={`group flex flex-col items-center justify-center gap-2 py-6 px-2 rounded-lg border border-border bg-background/30 cursor-pointer hover:border-primary/40 hover:bg-surface/60 transition-colors ${processing ? 'opacity-50 pointer-events-none' : ''}`}>
                        <div className="p-2 rounded-full bg-surface border border-border group-hover:border-primary/30 group-hover:scale-105 transition-all">
                            {processing
                                ? <Loader2 size={20} className="text-primary animate-spin" />
                                : <Upload size={20} className="text-muted group-hover:text-primary" />}
                        </div>
                        <span className="text-xs font-medium text-slate-300">
                            {processing ? 'Processing…' : dragActive ? 'Drop image to paint on' : 'Upload an image to mask'}
                        </span>
                        <span className="text-[10px] text-muted">click to browse or drag &amp; drop</span>
                        <input
                            ref={fileInputRef}
                            type="file"
                            className="hidden"
                            accept="image/*"
                            onChange={(e) => loadBase(e.target.files?.[0])}
                        />
                    </label>
                </div>
            ) : (
                // Stage 2 — paint the mask.
                <div className="border-2 border-dashed border-primary/50 bg-primary/5 rounded-xl p-3 space-y-2.5">
                    <div className="flex items-center gap-2 flex-wrap">
                        <button
                            type="button"
                            onClick={() => setErase(false)}
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                                !erase ? 'bg-primary text-on-primary border-primary' : 'bg-surface/60 text-foreground border-border hover:border-primary/40'
                            }`}
                            title="Brush — mark the area to replace"
                        >
                            <Brush size={14} /> Brush
                        </button>
                        <button
                            type="button"
                            onClick={() => setErase(true)}
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                                erase ? 'bg-primary text-on-primary border-primary' : 'bg-surface/60 text-foreground border-border hover:border-primary/40'
                            }`}
                            title="Eraser — un-mark"
                        >
                            <Eraser size={14} /> Erase
                        </button>
                        <div className="flex items-center gap-1.5 ml-1">
                            <span className="text-[10px] text-muted">Size</span>
                            <input
                                type="range"
                                min={8}
                                max={160}
                                step={2}
                                value={brush}
                                onChange={(e) => setBrush(Number(e.target.value))}
                                className="w-20 accent-primary cursor-pointer"
                                title={`Brush size: ${brush}px`}
                            />
                        </div>
                        <div className="flex items-center gap-1.5 ml-1">
                            <span className="text-[10px] text-muted">Colour</span>
                            {MASK_COLOR_PRESETS.map((c) => (
                                <button
                                    key={c}
                                    type="button"
                                    onClick={() => applyColor(c)}
                                    className={`w-5 h-5 rounded-full transition-transform hover:scale-110 ${
                                        brushColor.toLowerCase() === c ? 'ring-2 ring-primary' : 'border border-border'
                                    }`}
                                    style={{ backgroundColor: c }}
                                    title={`Mask colour ${c}`}
                                    aria-label={`Mask colour ${c}`}
                                />
                            ))}
                            <input
                                type="color"
                                value={brushColor}
                                onChange={(e) => applyColor(e.target.value)}
                                className="w-6 h-6 rounded-md border border-border bg-transparent cursor-pointer p-0"
                                title="Custom mask colour"
                                aria-label="Custom mask colour"
                            />
                        </div>
                        <div className="flex items-center gap-1.5 ml-auto">
                            <button
                                type="button"
                                onClick={undo}
                                disabled={strokes === 0}
                                className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium border border-border bg-surface/60 text-foreground hover:border-primary/40 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                title="Undo last stroke"
                            >
                                <Undo2 size={14} />
                            </button>
                            <button
                                type="button"
                                onClick={clearMask}
                                disabled={strokes === 0}
                                className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium border border-border bg-surface/60 text-foreground hover:border-danger/50 hover:text-danger transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                title="Clear the mask"
                            >
                                <Trash2 size={14} />
                            </button>
                            <button
                                type="button"
                                onClick={reset}
                                className="p-1.5 rounded-full bg-danger text-on-primary hover:scale-110 transition-transform"
                                title="Use a different image"
                            >
                                <X size={14} />
                            </button>
                        </div>
                    </div>

                    <div className="rounded-lg overflow-hidden bg-background flex items-center justify-center" style={{ maxHeight: '48vh' }}>
                        <canvas
                            ref={displayRef}
                            onPointerDown={onPointerDown}
                            onPointerMove={onPointerMove}
                            onPointerUp={endStroke}
                            onPointerLeave={endStroke}
                            onPointerCancel={endStroke}
                            className="block cursor-crosshair select-none"
                            style={{ maxWidth: '100%', maxHeight: '48vh', width: 'auto', height: 'auto', touchAction: 'none' }}
                        />
                    </div>

                    {strokes === 0 && (
                        <p className="text-[11px] text-muted flex items-center gap-1.5">
                            <AlertTriangle size={12} className="text-amber-400 shrink-0" />
                            Paint over the region you want the model to replace before booking.
                        </p>
                    )}
                </div>
            )}

            {error && (
                <div className="flex items-start gap-2 text-danger text-xs font-medium bg-danger/10 p-2.5 rounded-lg border border-danger/20">
                    <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                    <span>{error}</span>
                </div>
            )}
        </div>
    );
};

export default MaskDrawField;
