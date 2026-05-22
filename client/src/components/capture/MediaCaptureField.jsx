import React, { useRef, useState } from 'react';
import { Upload, X, Image as ImageIcon, Video as VideoIcon, Loader2 } from 'lucide-react';
import { resizeImageFile } from '../../utils/imageResize';

// Per-type fallback when the workflow's exposedParameter doesn't declare
// `maxInputEdge`. Conservative defaults that match what most diffusion / i2v
// nodes are happiest with at 5090-class throughput. Admins can override in
// the workflow metadata editor.
const DEFAULT_MAX_EDGE = {
    image: 1024,
    video: 1280
};

// MediaCaptureField — image/video upload widget for BookingDialog.
//
// One entry point: a file input, reachable by click or drag-and-drop. (The
// camera / webcam capture path was removed — it required a secure context,
// and the workshop serves plain HTTP; users upload a file from their device
// instead. On a phone the OS file picker still offers "Take Photo" itself.)
//
// For images we run resizeImageFile() between selection and onChange, so the
// parent BookingDialog never sees the original raw 12 MP phone photo — it
// receives a downscaled JPEG/PNG matching `maxInputEdge`. Video isn't resized
// here (we don't transcode in-browser; phone-native MP4s are already
// reasonably sized at 1080p).
//
// The parent's handleMediaChange receives a File directly (not an event) so
// resizing can be async.
const MediaCaptureField = ({
    paramKey,
    label,
    type,           // 'image' | 'video'
    maxInputEdge,   // optional; falls back to DEFAULT_MAX_EDGE[type]
    preview,        // dataURL string from parent's FileReader
    onChange,       // (file: File) => void
    onRemove        // () => void
}) => {
    const fileInputRef = useRef(null);
    const [processing, setProcessing] = useState(false);
    const [dragActive, setDragActive] = useState(false);
    const isVideo = type === 'video';
    const effectiveMaxEdge = maxInputEdge ?? DEFAULT_MAX_EDGE[type] ?? 1024;
    const acceptPrefix = isVideo ? 'video/' : 'image/';

    const handleFile = async (file) => {
        if (!file) return;
        // Reset the input value so picking the same file twice still fires.
        if (fileInputRef.current) fileInputRef.current.value = '';
        let processed = file;
        if (!isVideo) {
            setProcessing(true);
            try {
                processed = await resizeImageFile(file, effectiveMaxEdge);
            } finally {
                setProcessing(false);
            }
        }
        onChange(processed);
    };

    // Drag-and-drop on the dashed border container. dragenter/over must
    // preventDefault so the browser doesn't navigate to the file. We track
    // dragActive on enter/leave so the border can highlight while a file is
    // hovering. Drop filters by MIME prefix (image/* or video/*) so dropping
    // a PDF on an image field does nothing rather than uploading garbage.
    const handleDragEnter = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (processing || preview) return;
        setDragActive(true);
    };
    const handleDragOver = (e) => {
        e.preventDefault();
        e.stopPropagation();
    };
    const handleDragLeave = (e) => {
        e.preventDefault();
        e.stopPropagation();
        setDragActive(false);
    };
    const handleDrop = (e) => {
        e.preventDefault();
        e.stopPropagation();
        setDragActive(false);
        if (processing || preview) return;
        const file = e.dataTransfer?.files?.[0];
        if (!file) return;
        if (file.type && !file.type.startsWith(acceptPrefix)) {
            console.warn(`[MediaCaptureField] ignored dropped file of type ${file.type} (expected ${acceptPrefix}*)`);
            return;
        }
        handleFile(file);
    };

    return (
        <div className="space-y-2">
            <label className="text-sm font-medium text-slate-300 flex items-center gap-2 flex-wrap">
                {isVideo
                    ? <VideoIcon size={14} className="text-primary" />
                    : <ImageIcon size={14} className="text-primary" />}
                <span>{label}</span>
                {!isVideo && (
                    <span className="text-[10px] text-muted font-normal">
                        — downsized to ≤{effectiveMaxEdge}px on the long edge before upload
                    </span>
                )}
            </label>
            <div
                className={`relative border-2 border-dashed rounded-xl p-3 transition-colors ${
                    dragActive
                        ? 'border-primary bg-primary/10 ring-2 ring-primary/30'
                        : preview ? 'border-primary/50 bg-primary/5' : 'border-border bg-surface/30'
                }`}
                onDragEnter={handleDragEnter}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
            >
                {preview ? (
                    <div className="relative aspect-video rounded-lg overflow-hidden group/preview">
                        {isVideo ? (
                            <video src={preview} className="w-full h-full object-cover" muted loop autoPlay playsInline />
                        ) : (
                            <img src={preview} alt="Preview" className="w-full h-full object-cover" />
                        )}
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/preview:opacity-100 transition-opacity flex items-center justify-center">
                            <button
                                type="button"
                                onClick={onRemove}
                                className="p-2 rounded-full bg-danger text-white hover:scale-110 transition-transform"
                                title="Remove and pick another"
                            >
                                <X size={20} />
                            </button>
                        </div>
                    </div>
                ) : (
                    <label
                        className={`group flex flex-col items-center justify-center gap-2 py-6 px-2 rounded-lg border border-border bg-background/30 cursor-pointer hover:border-primary/40 hover:bg-surface/60 transition-colors ${processing ? 'opacity-50 pointer-events-none' : ''}`}
                    >
                        <div className="p-2 rounded-full bg-surface border border-border group-hover:border-primary/30 group-hover:scale-105 transition-all">
                            {processing
                                ? <Loader2 size={20} className="text-primary animate-spin" />
                                : <Upload size={20} className="text-muted group-hover:text-primary" />}
                        </div>
                        <span className="text-xs font-medium text-slate-300">
                            {processing
                                ? 'Processing…'
                                : dragActive
                                    ? `Drop ${isVideo ? 'video' : 'image'} to upload`
                                    : `Upload ${isVideo ? 'video' : 'image'}`}
                        </span>
                        <span className="text-[10px] text-muted">click to browse or drag &amp; drop</span>
                        <input
                            ref={fileInputRef}
                            type="file"
                            className="hidden"
                            accept={isVideo ? 'video/*' : 'image/*'}
                            onChange={(e) => handleFile(e.target.files?.[0])}
                        />
                    </label>
                )}
            </div>
        </div>
    );
};

export default MediaCaptureField;
