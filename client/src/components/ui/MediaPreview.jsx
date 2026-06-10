import React from 'react';
import { isVideo, isModel3d, isSplat, getImageUrl } from '../../utils/api';
import { Play, Sparkles } from 'lucide-react';
import ModelViewer from './ModelViewer';

const MediaPreview = ({ filename, className = '', alt = 'Preview', showPlayIcon = true }) => {
    const isVid = isVideo(filename);
    const is3d = isModel3d(filename);
    const splat = isSplat(filename);
    const url = getImageUrl(filename);

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
        return <ModelViewer url={url} className={className} compact />;
    }

    if (isVid) {
        return (
            <div className={`relative w-full h-full ${className}`}>
                <video
                    src={url}
                    className="w-full h-full object-cover"
                    muted
                    loop
                    playsInline
                    autoPlay
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
    }

    return (
        <img
            src={url}
            alt={alt}
            className={`w-full h-full object-cover ${className}`}
        />
    );
};

export default MediaPreview;
