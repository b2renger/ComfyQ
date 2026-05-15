import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Camera, RefreshCw, SwitchCamera, X, AlertTriangle, CheckCircle2 } from 'lucide-react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';

// CameraCaptureModal — live webcam preview + snapshot.
//
// Lifecycle:
//   1. Mounted (only when its container opens it) → request getUserMedia
//      on the gesture handler that opened this modal. If permission is
//      granted, stream is attached to a <video> element for preview.
//   2. User clicks "Capture" → draw the current video frame to a canvas
//      at the video's native resolution → canvas.toBlob('image/jpeg', 0.92)
//      → fresh File. NOT resized here — the parent MediaCaptureField runs
//      it through resizeImageFile() so the same maxInputEdge / EXIF /
//      logging path applies as for picked files.
//   3. User clicks "Retake" → discard the snapshot, return to live preview.
//   4. User clicks "Use this shot" → onCapture(file) → onClose().
//   5. On unmount / close → stop all tracks (releases camera).
//
// Errors fall back gracefully: NotAllowedError / NotFoundError / SecurityError
// each show a banner with a "Pick a file instead" button that triggers the
// parent's file-picker fallback.

const STATUSES = {
    REQUESTING: 'requesting',
    LIVE: 'live',
    SNAPSHOT: 'snapshot',
    ERROR: 'error'
};

const CameraCaptureModal = ({ isOpen, onClose, onCapture, onFallbackToPicker }) => {
    const videoRef = useRef(null);
    const streamRef = useRef(null);
    // Don't snapshot to a *visible* canvas — we use a detached one to keep
    // the layout simple. Snapshot blob lives in state.
    const [status, setStatus] = useState(STATUSES.REQUESTING);
    const [errorMsg, setErrorMsg] = useState('');
    const [snapshot, setSnapshot] = useState(null); // { url, file }
    const [devices, setDevices] = useState([]);     // video input devices
    const [activeDeviceId, setActiveDeviceId] = useState(null);
    const [facingMode, setFacingMode] = useState('user'); // 'user' (front) | 'environment' (rear)

    const stopStream = useCallback(() => {
        if (streamRef.current) {
            for (const track of streamRef.current.getTracks()) {
                try { track.stop(); } catch { /* ignore */ }
            }
            streamRef.current = null;
        }
        if (videoRef.current) videoRef.current.srcObject = null;
    }, []);

    const requestStream = useCallback(async (deviceId, facing) => {
        setStatus(STATUSES.REQUESTING);
        setErrorMsg('');
        stopStream();
        try {
            // On the FIRST request we ask for the most permissive constraint
            // (`{ video: true }`) so any available camera satisfies it. Chrome
            // on desktop Windows has been observed to throw NotFoundError when
            // `facingMode` is requested but the device doesn't expose facing
            // metadata — even though the spec says facingMode is a hint, not
            // a hard requirement. We only narrow to facingMode / deviceId on
            // explicit user action (Switch camera).
            const constraints = {
                video: deviceId
                    ? { deviceId: { exact: deviceId } }
                    : (facing ? { facingMode: facing } : true),
                audio: false
            };
            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            streamRef.current = stream;
            if (videoRef.current) {
                videoRef.current.srcObject = stream;
                // Some browsers stall play() until metadata is loaded; tolerate it.
                try { await videoRef.current.play(); } catch { /* ignore */ }
            }
            // Re-enumerate now that we have permission — without permission,
            // device labels are blank in many browsers.
            try {
                const all = await navigator.mediaDevices.enumerateDevices();
                const videoInputs = all.filter(d => d.kind === 'videoinput');
                setDevices(videoInputs);
                if (!deviceId && videoInputs.length > 0) {
                    // Track which one the stream landed on so the UI is honest.
                    const settings = stream.getVideoTracks()[0]?.getSettings?.();
                    if (settings?.deviceId) setActiveDeviceId(settings.deviceId);
                }
            } catch { /* enumerate is non-critical */ }
            setStatus(STATUSES.LIVE);
        } catch (err) {
            console.warn('[CameraCapture] getUserMedia failed:', err?.name, err?.message);
            setStatus(STATUSES.ERROR);
            // Friendly messages for the common cases.
            if (err?.name === 'NotAllowedError') {
                setErrorMsg('Camera permission was denied. Reset it in the browser site settings, or use the file picker instead.');
            } else if (err?.name === 'NotFoundError' || err?.name === 'OverconstrainedError') {
                setErrorMsg('No camera matched the request. Check that a webcam is connected, and that Windows Settings → Privacy → Camera is enabled. If you have multiple cameras, try Switch.');
            } else if (err?.name === 'NotReadableError') {
                setErrorMsg('Camera is busy — another app (Zoom, Teams, OBS, …) is probably using it. Close that app and try again.');
            } else if (err?.name === 'SecurityError' || err?.name === 'NotSupportedError') {
                setErrorMsg('Camera access is only allowed on https or localhost. On the LAN you have to use the file picker (or set up https on the dev server).');
            } else {
                setErrorMsg(`${err?.name || 'Error'}: ${err?.message || 'unknown'}`);
            }
        }
    }, [stopStream]);

    // Kick off the stream request when the modal opens. Pass `null` for
    // facing so the initial request is the most permissive — see comment
    // in requestStream(). The user can narrow via the Switch button.
    useEffect(() => {
        if (!isOpen) return;
        setSnapshot(null);
        requestStream(null, null);
        return () => stopStream();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen]);

    const handleCapture = () => {
        const video = videoRef.current;
        if (!video || !streamRef.current) return;
        const w = video.videoWidth;
        const h = video.videoHeight;
        if (!w || !h) {
            console.warn('[CameraCapture] video has no dimensions yet — try again in a moment');
            return;
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(video, 0, 0, w, h);
        canvas.toBlob((blob) => {
            if (!blob) {
                console.warn('[CameraCapture] toBlob returned null');
                return;
            }
            const file = new File([blob], `camera-${Date.now()}.jpg`, {
                type: 'image/jpeg',
                lastModified: Date.now()
            });
            const url = URL.createObjectURL(blob);
            setSnapshot({ url, file });
            setStatus(STATUSES.SNAPSHOT);
        }, 'image/jpeg', 0.95);
    };

    const handleRetake = () => {
        if (snapshot?.url) URL.revokeObjectURL(snapshot.url);
        setSnapshot(null);
        setStatus(STATUSES.LIVE);
    };

    const handleUseShot = () => {
        if (!snapshot?.file) return;
        const fileToHandOff = snapshot.file;
        // Don't revoke the URL here — the snapshot.url might still be in the
        // browser's render queue. URL.revoke happens in cleanup below.
        stopStream();
        onCapture(fileToHandOff);
        onClose();
    };

    const handleSwitchCamera = async () => {
        if (devices.length <= 1) {
            // Single camera — try toggling facingMode anyway (helps on phones
            // where enumerateDevices returns 1 entry until permission promotes).
            const next = facingMode === 'user' ? 'environment' : 'user';
            setFacingMode(next);
            await requestStream(null, next);
            return;
        }
        // Multi-camera path: cycle through devices.
        const idx = devices.findIndex(d => d.deviceId === activeDeviceId);
        const next = devices[(idx + 1) % devices.length];
        if (next?.deviceId) {
            setActiveDeviceId(next.deviceId);
            await requestStream(next.deviceId, null);
        }
    };

    // Cleanup any lingering snapshot URLs when the modal goes away.
    useEffect(() => {
        return () => {
            if (snapshot?.url) URL.revokeObjectURL(snapshot.url);
            stopStream();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleClose = () => {
        stopStream();
        if (snapshot?.url) URL.revokeObjectURL(snapshot.url);
        setSnapshot(null);
        onClose();
    };

    const handleFallback = () => {
        stopStream();
        onClose();
        if (onFallbackToPicker) onFallbackToPicker();
    };

    return (
        <Modal isOpen={isOpen} onClose={handleClose} title="Camera" maxWidth="max-w-2xl">
            <div className="space-y-4">
                {/* Viewport */}
                <div className="relative aspect-video w-full bg-black rounded-lg overflow-hidden border border-border">
                    {/* Always-mounted <video> so the stream has a sink. Hidden when showing the snapshot. */}
                    <video
                        ref={videoRef}
                        muted
                        playsInline
                        autoPlay
                        className={`absolute inset-0 w-full h-full object-contain ${status === STATUSES.SNAPSHOT ? 'hidden' : 'block'}`}
                    />
                    {status === STATUSES.SNAPSHOT && snapshot?.url && (
                        <img
                            src={snapshot.url}
                            alt="Snapshot preview"
                            className="absolute inset-0 w-full h-full object-contain"
                        />
                    )}
                    {status === STATUSES.REQUESTING && (
                        <div className="absolute inset-0 flex items-center justify-center text-muted text-sm gap-2 bg-black/60">
                            <RefreshCw size={16} className="animate-spin" /> Requesting camera…
                        </div>
                    )}
                    {status === STATUSES.ERROR && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center text-center gap-3 p-6 bg-black/70">
                            <AlertTriangle size={28} className="text-danger" />
                            <p className="text-sm text-slate-200 max-w-md">{errorMsg}</p>
                            <Button variant="secondary" onClick={handleFallback}>
                                Pick a file instead
                            </Button>
                        </div>
                    )}
                </div>

                {/* Device info row */}
                {status === STATUSES.LIVE && devices.length > 0 && (
                    <p className="text-[10px] text-muted text-center font-mono">
                        {(() => {
                            const active = devices.find(d => d.deviceId === activeDeviceId);
                            return active?.label || `Camera ${(devices.findIndex(d => d.deviceId === activeDeviceId) + 1) || '?'}/${devices.length}`;
                        })()}
                    </p>
                )}

                {/* Controls */}
                <div className="flex items-center justify-between gap-2">
                    <Button variant="ghost" onClick={handleClose} icon={X}>Close</Button>
                    {status === STATUSES.LIVE && (
                        <div className="flex items-center gap-2">
                            {(devices.length > 1) && (
                                <Button variant="secondary" icon={SwitchCamera} onClick={handleSwitchCamera}>
                                    Switch
                                </Button>
                            )}
                            <Button variant="primary" icon={Camera} onClick={handleCapture}>
                                Capture
                            </Button>
                        </div>
                    )}
                    {status === STATUSES.SNAPSHOT && (
                        <div className="flex items-center gap-2">
                            <Button variant="secondary" icon={RefreshCw} onClick={handleRetake}>Retake</Button>
                            <Button variant="primary" icon={CheckCircle2} onClick={handleUseShot}>Use this shot</Button>
                        </div>
                    )}
                </div>
            </div>
        </Modal>
    );
};

export default CameraCaptureModal;
