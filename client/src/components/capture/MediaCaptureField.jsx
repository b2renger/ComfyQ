import React, { useRef, useState } from 'react';
import { Upload, X, Camera, Image as ImageIcon, Video as VideoIcon, Loader2 } from 'lucide-react';
import { resizeImageFile } from '../../utils/imageResize';
import CameraCaptureModal from './CameraCaptureModal';

// Live webcam capture is only attempted when:
//   - the browser supplies navigator.mediaDevices.getUserMedia, AND
//   - we're in a secure context (HTTPS or http://localhost). Plain http
//     on a LAN IP — the workshop's default setup — is blocked by every
//     modern browser, so we fall back to the OS-native file picker
//     (which on phones opens the camera, on desktop just shows files).
//   - the param is an image. Video recording needs MediaRecorder, which
//     is M4-4. Today video always goes through the file picker.
function canUseLiveCamera(type) {
    if (type !== 'image') return false;
    if (typeof navigator === 'undefined') return false;
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') return false;
    if (typeof window !== 'undefined' && window.isSecureContext === false) return false;
    return true;
}

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
// Two entry points, both routing through the same `onChange` handler:
//   1. "Upload file"  — hidden <input type="file"> (file picker / drag-equiv)
//   2. "Use camera"   — hidden <input type="file" capture="environment">
//      On phones this delegates to the OS camera app (returns native JPEG/MP4).
//      On desktop browsers it's treated as a regular file picker — harmless.
//
// For images we run resizeImageFile() between selection and onChange, so the
// parent BookingDialog never sees the original raw 12 MP phone photo — it
// receives a downscaled JPEG/PNG matching `maxInputEdge`. Video isn't resized
// here (we don't transcode in-browser in M4-1; phone-native MP4s are already
// reasonably sized at 1080p and that's a problem for M5's ffmpeg work).
//
// IMPORTANT: backwards compat — the parent's existing handleMediaChange
// signature accepted an event; we now hand it a File directly so resizing
// can be async. BookingDialog adapts its handler accordingly.
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
    const cameraInputRef = useRef(null);
    const [processing, setProcessing] = useState(false);
    const [showCamera, setShowCamera] = useState(false);
    const isVideo = type === 'video';
    const effectiveMaxEdge = maxInputEdge ?? DEFAULT_MAX_EDGE[type] ?? 1024;
    const useLivePreview = canUseLiveCamera(type);

    const handleFile = async (file) => {
        if (!file) return;
        // Reset the input value so picking the same file twice still fires.
        if (fileInputRef.current) fileInputRef.current.value = '';
        if (cameraInputRef.current) cameraInputRef.current.value = '';
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
            <div className={`relative border-2 border-dashed rounded-xl p-3 transition-colors ${preview ? 'border-primary/50 bg-primary/5' : 'border-border bg-surface/30'}`}>
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
                    <div className="flex flex-col sm:flex-row gap-2">
                        {/* Upload pane — file picker (existing behavior preserved) */}
                        <label
                            className={`group flex-1 flex flex-col items-center justify-center gap-2 py-3 px-2 rounded-lg border border-border bg-background/30 cursor-pointer hover:border-primary/40 hover:bg-surface/60 transition-colors ${processing ? 'opacity-50 pointer-events-none' : ''}`}
                        >
                            <div className="p-2 rounded-full bg-surface border border-border group-hover:border-primary/30 group-hover:scale-105 transition-all">
                                {processing
                                    ? <Loader2 size={20} className="text-primary animate-spin" />
                                    : <Upload size={20} className="text-muted group-hover:text-primary" />}
                            </div>
                            <span className="text-xs font-medium text-slate-300">
                                {processing ? 'Processing…' : `Upload ${isVideo ? 'video' : 'image'}`}
                            </span>
                            <span className="text-[10px] text-muted">from this device</span>
                            <input
                                ref={fileInputRef}
                                type="file"
                                className="hidden"
                                accept={isVideo ? 'video/*' : 'image/*'}
                                onChange={(e) => handleFile(e.target.files?.[0])}
                            />
                        </label>
                        {/* Camera pane:
                            - Image + secure context  → live webcam preview modal (M4-2)
                            - Otherwise (video, or http LAN where getUserMedia is blocked)
                              → OS-native file picker with capture="environment" (M4-1).
                              On phones that becomes the OS camera; on desktop it's a
                              regular file picker, which is the best we can do without
                              a secure context. */}
                        <button
                            type="button"
                            disabled={processing}
                            onClick={() => useLivePreview ? setShowCamera(true) : cameraInputRef.current?.click()}
                            className="group flex-1 flex flex-col items-center justify-center gap-2 py-3 px-2 rounded-lg border border-border bg-background/30 hover:border-primary/40 hover:bg-surface/60 transition-colors disabled:opacity-50"
                        >
                            <div className="p-2 rounded-full bg-surface border border-border group-hover:border-primary/30 group-hover:scale-105 transition-all">
                                <Camera size={20} className="text-muted group-hover:text-primary" />
                            </div>
                            <span className="text-xs font-medium text-slate-300">Use camera</span>
                            <span className="text-[10px] text-muted">
                                {isVideo
                                    ? 'records via phone camera'
                                    : useLivePreview
                                        ? 'live preview + snapshot'
                                        : 'snaps with phone camera'}
                            </span>
                        </button>
                        <input
                            ref={cameraInputRef}
                            type="file"
                            className="hidden"
                            accept={isVideo ? 'video/*' : 'image/*'}
                            capture="environment"
                            onChange={(e) => handleFile(e.target.files?.[0])}
                        />
                        <CameraCaptureModal
                            isOpen={showCamera}
                            onClose={() => setShowCamera(false)}
                            onCapture={(file) => handleFile(file)}
                            onFallbackToPicker={() => cameraInputRef.current?.click()}
                        />
                    </div>
                )}
            </div>
        </div>
    );
};

export default MediaCaptureField;
