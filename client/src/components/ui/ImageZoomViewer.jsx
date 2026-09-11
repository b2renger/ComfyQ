import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, ZoomIn, ZoomOut, Maximize2, Scan, Download, ChevronLeft, ChevronRight } from 'lucide-react';
import { getImageUrl, getDownloadUrl } from '../../utils/api';

// Full-size image inspector — a near-fullscreen pan/zoom overlay so designers
// can check details (grain, edges, text) at 1:1 pixels BEFORE downloading.
//
// Rendered through a portal to document.body on purpose: it opens from inside
// the lightbox Modal, whose wrapper carries a `zoom-in-95` transform — a nested
// position:fixed element would be positioned against that box instead of the
// viewport (same reason MaskDrawField portals its paint modal).
//
// Geometry: the <img> is drawn with `transform: translate(x,y) scale(s)` and
// `transform-origin: 0 0`, so a screen point p maps to image point
// (p - offset) / scale. Zooming keeps whatever sits under the cursor pinned by
// solving that relation for the new offset.
//
// `images`: [{ filename, label }] — pass one for a single result; with several,
// the arrows (and ←/→) step through them, re-fitting on each change.
const MIN_SCALE = 0.05;
const MAX_SCALE = 16;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

const ImageZoomViewer = ({ images = [], index = 0, onIndexChange, onClose }) => {
    const n = images.length;
    const [i, setI] = useState(clamp(index, 0, Math.max(0, n - 1)));
    const cur = images[i];

    const boxRef = useRef(null);          // the pan/zoom viewport
    const [nat, setNat] = useState(null); // { w, h } natural pixel size
    const [box, setBox] = useState({ w: 0, h: 0 });
    const [t, setT] = useState({ s: 1, x: 0, y: 0 });
    const dragRef = useRef(null);
    const [dragging, setDragging] = useState(false);

    const go = useCallback((d) => {
        if (n < 2) return;
        setI((k) => {
            const next = (k + d + n) % n;
            onIndexChange?.(next);
            return next;
        });
        setNat(null);                     // re-fit once the new image reports its size
    }, [n, onIndexChange]);

    // Track the viewport box. The overlay is full-screen, so this only changes
    // on a window resize — ResizeObserver also covers the very first paint.
    useLayoutEffect(() => {
        const el = boxRef.current;
        if (!el) return;
        const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight });
        measure();
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    // Scale that shows the whole image, never upscaling a small one past 1:1.
    const fitScale = (nat && box.w && box.h) ? Math.min(1, box.w / nat.w, box.h / nat.h) : 1;

    const centerAt = useCallback((s) => {
        if (!nat) return { s, x: 0, y: 0 };
        return { s, x: (box.w - nat.w * s) / 2, y: (box.h - nat.h * s) / 2 };
    }, [nat, box.w, box.h]);

    const fit = useCallback(() => setT(centerAt(fitScale)), [centerAt, fitScale]);

    // Fit whenever a new image loads or the viewport changes size.
    useEffect(() => {
        if (nat && box.w && box.h) setT(centerAt(fitScale));
    }, [nat, box.w, box.h, fitScale, centerAt]);

    // Zoom about a fixed screen point (cursor, or the viewport centre).
    const zoomAt = useCallback((factor, px, py) => {
        setT((p) => {
            const s = clamp(p.s * factor, MIN_SCALE, MAX_SCALE);
            if (s === p.s) return p;
            const cx = px == null ? box.w / 2 : px;
            const cy = py == null ? box.h / 2 : py;
            return { s, x: cx - ((cx - p.x) / p.s) * s, y: cy - ((cy - p.y) / p.s) * s };
        });
    }, [box.w, box.h]);

    // Wheel zoom is bound natively with { passive: false }: React 18 registers
    // its own `wheel` handler at the root as PASSIVE, so preventDefault() from
    // an onWheel prop is ignored (and warns) — the page/browser would zoom
    // instead of the image.
    useEffect(() => {
        const el = boxRef.current;
        if (!el) return;
        const onWheel = (e) => {
            e.preventDefault();
            const r = el.getBoundingClientRect();
            // Normalise line/page deltas so a trackpad and a mouse wheel agree.
            const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? r.height : 1;
            zoomAt(Math.exp((-e.deltaY * unit) / 400), e.clientX - r.left, e.clientY - r.top);
        };
        el.addEventListener('wheel', onWheel, { passive: false });
        return () => el.removeEventListener('wheel', onWheel);
    }, [zoomAt]);

    const onPointerDown = (e) => {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        dragRef.current = { px: e.clientX, py: e.clientY, x: t.x, y: t.y };
        setDragging(true);
    };
    const onPointerMove = (e) => {
        const d = dragRef.current;
        if (!d) return;
        setT((p) => ({ ...p, x: d.x + (e.clientX - d.px), y: d.y + (e.clientY - d.py) }));
    };
    const endDrag = (e) => {
        if (!dragRef.current) return;
        dragRef.current = null;
        setDragging(false);
        try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    };

    // Double-click toggles fit <-> 1:1, anchored on the point clicked.
    const onDoubleClick = (e) => {
        const r = boxRef.current.getBoundingClientRect();
        const px = e.clientX - r.left, py = e.clientY - r.top;
        if (Math.abs(t.s - 1) < 0.01) zoomAt(fitScale / t.s, px, py);
        else zoomAt(1 / t.s, px, py);
    };

    // Keyboard: Esc closes, +/- zoom, 0 fits, 1 is actual pixels, arrows browse.
    // Captured on window so it wins over the parent modal's own handlers.
    useEffect(() => {
        const onKey = (e) => {
            if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
            if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomAt(1.25); }
            else if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomAt(1 / 1.25); }
            else if (e.key === '0') { e.preventDefault(); fit(); }
            else if (e.key === '1') { e.preventDefault(); zoomAt(1 / t.s); }
            else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
            else if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
        };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
    }, [onClose, zoomAt, fit, go, t.s]);

    // Lock body scroll while open, restoring whatever the parent modal had set.
    useEffect(() => {
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => { document.body.style.overflow = prev; };
    }, []);

    const download = () => {
        const a = document.createElement('a');
        a.href = getDownloadUrl(cur.filename);
        a.download = cur.filename.split('/').pop();
        document.body.appendChild(a);
        a.click();
        a.remove();
    };

    const pct = Math.round(t.s * 100);
    const isFit = Math.abs(t.s - fitScale) < 0.005;
    const isActual = Math.abs(t.s - 1) < 0.005;

    return createPortal(
        <div className="fixed inset-0 z-[100] bg-black/95 flex flex-col select-none">
            {/* Header — what you are looking at, and its true pixel size */}
            <div className="shrink-0 flex items-center gap-3 px-4 py-2.5">
                <div className="min-w-0">
                    <div className="text-sm font-medium truncate text-white">
                        {cur?.label || cur?.filename?.split('/').pop() || 'Image'}
                    </div>
                    <div className="text-[11px] text-white/50 font-mono">
                        {nat ? `${nat.w} × ${nat.h} px` : 'loading…'}{n > 1 ? ` · ${i + 1} / ${n}` : ''}
                    </div>
                </div>
                <div className="ml-auto flex items-center gap-1.5">
                    <button onClick={download} title="Download this image"
                        className="p-2 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors">
                        <Download size={18} />
                    </button>
                    <button onClick={onClose} title="Close (Esc)"
                        className="p-2 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors">
                        <X size={20} />
                    </button>
                </div>
            </div>

            {/* Pan / zoom surface */}
            <div
                ref={boxRef}
                className={`relative flex-1 min-h-0 overflow-hidden touch-none ${dragging ? 'cursor-grabbing' : 'cursor-grab'}`}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                onDoubleClick={onDoubleClick}
            >
                {cur && (
                    <img
                        key={cur.filename}
                        src={getImageUrl(cur.filename)}
                        alt={cur.label || 'Full size'}
                        draggable={false}
                        onLoad={(e) => setNat({ w: e.target.naturalWidth, h: e.target.naturalHeight })}
                        style={{
                            transform: `translate(${t.x}px, ${t.y}px) scale(${t.s})`,
                            transformOrigin: '0 0',
                            // Past ~1.5x the point is to inspect real pixels, so
                            // show them sharp instead of interpolated.
                            imageRendering: t.s > 1.5 ? 'pixelated' : 'auto',
                            visibility: nat ? 'visible' : 'hidden'
                        }}
                        className="absolute top-0 left-0 max-w-none"
                    />
                )}

                {n > 1 && (
                    <>
                        <button onClick={() => go(-1)} title="Previous (left arrow)"
                            className="absolute left-3 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/60 hover:bg-black/80 text-white transition-colors">
                            <ChevronLeft size={22} />
                        </button>
                        <button onClick={() => go(1)} title="Next (right arrow)"
                            className="absolute right-3 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/60 hover:bg-black/80 text-white transition-colors">
                            <ChevronRight size={22} />
                        </button>
                    </>
                )}
            </div>

            {/* Zoom toolbar */}
            <div className="shrink-0 flex justify-center pb-3 pt-2">
                <div className="flex items-center gap-1 rounded-xl border border-white/10 bg-black/70 backdrop-blur-md px-1.5 py-1.5 text-white">
                    <button onClick={() => zoomAt(1 / 1.25)} title="Zoom out (-)"
                        className="p-2 rounded-lg hover:bg-white/10 transition-colors"><ZoomOut size={16} /></button>
                    <span className="w-16 text-center text-xs font-mono tabular-nums text-white/80">{pct}%</span>
                    <button onClick={() => zoomAt(1.25)} title="Zoom in (+)"
                        className="p-2 rounded-lg hover:bg-white/10 transition-colors"><ZoomIn size={16} /></button>
                    <span className="mx-1 w-px self-stretch bg-white/10" />
                    <button onClick={fit} title="Fit to screen (0)"
                        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs transition-colors ${isFit ? 'bg-primary text-on-primary' : 'hover:bg-white/10'}`}>
                        <Maximize2 size={14} /> Fit
                    </button>
                    <button onClick={() => zoomAt(1 / t.s)} title="Actual pixels (1)"
                        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs transition-colors ${isActual ? 'bg-primary text-on-primary' : 'hover:bg-white/10'}`}>
                        <Scan size={14} /> 100%
                    </button>
                </div>
            </div>

            <div className="shrink-0 pb-3 text-center text-[11px] text-white/35">
                Scroll to zoom · drag to pan · double-click for 100% · Esc to close
            </div>
        </div>,
        document.body
    );
};

export default ImageZoomViewer;
