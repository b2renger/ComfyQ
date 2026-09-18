import React, { useEffect, useRef } from 'react';
import { isVideo, isModel3d, isSplat, isAudio, getImageUrl } from '../../utils/api';
import { Play, Sparkles, FileText, Box } from 'lucide-react';
import ModelViewer from './ModelViewer';
import AudioPlayer from './AudioPlayer';
import { useInView } from '../../hooks/useInView';

// A card's video: plays while it is on screen, pauses when it scrolls away, so
// a grid of results doesn't keep dozens of decoders running.
const LazyVideo = ({ url, className, showPlayIcon }) => {
    const [ref, inView] = useInView();
    const videoRef = useRef(null);
    useEffect(() => {
        const v = videoRef.current;
        if (!v) return;
        if (inView) { const p = v.play(); if (p?.catch) p.catch(() => { /* autoplay refused — the poster frame stays */ }); }
        else v.pause();
    }, [inView]);
    return (
        <div ref={ref} className={`relative w-full h-full ${className}`}>
            <video
                ref={videoRef}
                src={url}
                className="w-full h-full object-cover"
                muted
                loop
                playsInline
                preload="metadata"
            />
            {showPlayIcon && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/20 pointer-events-none">
                    <div className="p-2 rounded-full bg-white/20 backdrop-blur-sm border border-white/30">
                        <Play size={16} className="text-white fill-current" />
                    </div>
                </div>
            )}
        </div>
    );
};

// A card's 3D mesh: the viewer (and its WebGL context) exists only while the
// card is on screen. Off screen it is a placeholder, so scrolling past many 3D
// results can't exhaust the browser's context limit.
const LazyModel = ({ url, className }) => {
    const [ref, inView] = useInView();
    return (
        <div ref={ref} className="w-full h-full">
            {inView
                ? <ModelViewer url={url} className={className} compact />
                : <div className={`w-full h-full flex items-center justify-center bg-black text-muted ${className}`}><Box size={24} /></div>}
        </div>
    );
};

const MediaPreview = ({ filename, className = '', alt = 'Preview', showPlayIcon = true, text = null }) => {
    // Text-output jobs (image captioning / LLM describe) have no media file —
    // show a snippet tile instead of a broken <img>.
    if (!filename && text) {
        return (
            <div className={`w-full h-full flex flex-col bg-surface ${className}`}>
                <div className="px-2 pt-2 text-muted shrink-0"><FileText size={14} /></div>
                <p className="px-2 pb-2 pt-1 text-[10px] leading-snug text-slate-300 overflow-hidden flex-1">{text}</p>
            </div>
        );
    }
    const isVid = isVideo(filename);
    const is3d = isModel3d(filename);
    const splat = isSplat(filename);
    const audio = isAudio(filename);
    const url = getImageUrl(filename);

    // Audio outputs render a compact player right in the card/sidebar.
    if (audio) {
        return <AudioPlayer url={url} filename={filename} className={className} compact />;
    }

    // Gaussian splats render live only in the lightbox gallery (one or two
    // instances). In thumbnail grids/sidebars they'd be too costly to draw per
    // card, so show a static placeholder. In practice the wire prefers a GLB
    // thumbnail for splat jobs, so this is mostly a safety net.
    if (splat) {
        return (
            <div className={`w-full h-full flex flex-col items-center justify-center gap-1 bg-black text-muted ${className}`}>
                <Sparkles size={24} />
                <span className="text-[10px] uppercase tracking-wider">Gaussian splat</span>
            </div>
        );
    }

    // 3D models render an interactive viewer right in the card — same
    // ModelViewer component as the lightbox, in compact mode (no help-text
    // overlay, no big loader). Render-on-demand keeps idle GPU draws at
    // zero. Pointer events are swallowed by ModelViewer so drag-to-rotate
    // doesn't trigger parent click handlers (eg the Scheduler card click
    // that opens the lightbox — user clicks outside the viewer for that).
    if (is3d) {
        return <LazyModel url={url} className={className} />;
    }

    if (isVid) {
        return <LazyVideo url={url} className={className} showPlayIcon={showPlayIcon} />;
    }

    return (
        <img
            src={url}
            alt={alt}
            loading="lazy"
            className={`w-full h-full object-cover ${className}`}
        />
    );
};

export default MediaPreview;
