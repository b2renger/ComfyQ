import React from 'react';
import { Music } from 'lucide-react';

// Audio player for generated audio outputs (Stable Audio, ACE, …). The media
// counterpart to ModelViewer / SplatViewer / <video>: a styled wrapper around
// the native <audio controls> element, which already gives play/pause, seek,
// volume, and download across every browser — no waveform lib needed.
//
// Used both in the lightbox gallery (full size) and in grid/sidebar cards
// (`compact`). Pointer events on the controls are stopped so scrubbing or
// hitting play inside a Scheduler card doesn't bubble up and open the lightbox
// (same trick as the 3D viewers).
const AudioPlayer = ({ url, filename, className = '', compact = false }) => {
    const stop = (e) => e.stopPropagation();
    const base = filename ? filename.split('/').pop() : '';

    return (
        <div
            className={`w-full h-full flex flex-col items-center justify-center gap-3 bg-gradient-to-br from-zinc-800 to-black p-4 ${className}`}
            onClick={stop}
            onPointerDown={stop}
        >
            <div className={`rounded-full bg-primary/15 border border-primary/30 flex items-center justify-center ${compact ? 'w-10 h-10' : 'w-20 h-20'}`}>
                <Music size={compact ? 18 : 36} className="text-primary" />
            </div>
            {!compact && base && (
                <span className="text-xs text-muted font-mono max-w-full truncate px-2" title={base}>{base}</span>
            )}
            <audio
                src={url}
                controls
                preload="metadata"
                onClick={stop}
                className={`w-full ${compact ? 'max-w-[220px]' : 'max-w-md'}`}
            />
        </div>
    );
};

export default AudioPlayer;
