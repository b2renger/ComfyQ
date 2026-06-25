import React, { useState, useEffect, useRef } from 'react';
import Modal from './ui/Modal';
import Button from './ui/Button';
import { Sparkles, Layers, Maximize, Clock, AlertTriangle, ChevronLeft, ChevronRight, Upload, X, Image as ImageIcon, Video as VideoIcon, Dices, Info } from 'lucide-react';
import { useSocket } from '../context/SocketContext';
import { SERVER_URL, getInputUrl } from '../utils/api';
import MediaCaptureField from './capture/MediaCaptureField';
import MaskDrawField from './capture/MaskDrawField';

// Param types whose value is an uploaded file (handled via mediaFiles + /upload
// + recall), as opposed to a plain form value. 'mask' is an image the user
// paints in-browser (MaskDrawField) but is otherwise an image upload.
const MEDIA_TYPES = ['image', 'video', 'audio', 'mask'];

/**
 * Booking Dialog Component
 * 
 * A modal form for users to schedule new jobs.
 * 
 * Features:
 * - Dynamic form generation based on workflow configuration
 * - Drag-and-drop media uploads (images, videos)
 * - Time slot selection with collision detection
 * - Client-side validation
 * 
 * @param {Object} props
 * @param {boolean} props.isOpen - Visibility state
 * @param {Function} props.onClose - Close handler
 * @param {number} props.initialTime - Default start time for the job
 * @param {Function} props.onConfirm - Submit handler ({ prompt, params, time })
 */
// Pick the user-visible "headline" prompt out of the submitted form values.
// Workflows expose their text inputs under different keys (`prompt`,
// `positive_prompt`, `text`, etc.) — we look for the most prompt-like
// textarea-typed param and return its current value, falling back to a
// looser match if no parameterMap is available.
function pickHeadlinePrompt(finalParams, parameterMap = {}) {
    // 1. Literal `prompt` key wins if filled — old behavior, preserved.
    if (typeof finalParams.prompt === 'string' && finalParams.prompt.trim()) {
        return finalParams.prompt;
    }
    // 2. Prefer textarea-typed params, skipping anything that smells negative.
    const score = (k) => (/positive/i.test(k) ? 0 : /prompt/i.test(k) ? 1 : 2);
    const textareaKeys = Object.entries(parameterMap || {})
        .filter(([, p]) => p?.type === 'textarea')
        .map(([k]) => k)
        .filter(k => !/negative|neg/i.test(k))
        .sort((a, b) => score(a) - score(b));
    for (const k of textareaKeys) {
        const v = finalParams[k];
        if (typeof v === 'string' && v.trim()) return v;
    }
    // 3. Fallback — no parameterMap or no textarea typed param matched.
    //    Scan finalParams for anything prompt-shaped.
    for (const [k, v] of Object.entries(finalParams)) {
        if (typeof v === 'string' && v.trim() && /prompt|^text$/i.test(k) && !/negative|neg/i.test(k)) {
            return v;
        }
    }
    return '';
}

// A param qualifies as a "seed" if its key or field looks like one. Catches
// both KSampler.seed (Flux1) and RandomNoise.noise_seed (Flux2), plus any
// custom node that exposes a *_seed field.
const isSeedParam = (key, config) => {
    const k = String(key || '').toLowerCase();
    const f = String(config?.field || '').toLowerCase();
    return k === 'seed' || k.endsWith('_seed')
        || f === 'seed' || f.endsWith('_seed');
};
const randomSeed = () => Math.floor(Math.random() * 4294967295);

// Strip the upload prefix from a comfy input filename to show the user's
// original name (comfyq_session__<ts>_<rand>__photo.png → photo.png).
const prettyInputName = (fn) => String(fn || '')
    .replace(/^comfyq_session__\d+_\d+__/, '')
    .replace(/^comfyq__[a-f0-9]+__/i, '');

const BookingDialog = ({ isOpen, onClose, initialTime, onConfirm, initialParams }) => {
    const { state } = useSocket();
    const [scheduledTime, setScheduledTime] = useState(initialTime);
    const [isCollision, setIsCollision] = useState(false);
    const [formParams, setFormParams] = useState({});
    const [mediaFiles, setMediaFiles] = useState({}); // { paramKey: File }
    const [mediaPreviews, setMediaPreviews] = useState({}); // { paramKey: dataURL }
    const [recalledMedia, setRecalledMedia] = useState({}); // { paramKey: comfyFilename } reused from a prior job
    const [isUploading, setIsUploading] = useState(false);
    const [uploadError, setUploadError] = useState(''); // server-side upload rejection (too big / HEIC)

    // Initialize form params once per dialog-open session. We deliberately do
    // NOT depend on state.workflow — the server rebroadcasts state_update on a
    // heartbeat (every 5s) with a fresh parameter_map object reference, which
    // would otherwise wipe whatever the user has typed.
    const stateRef = useRef(state);
    useEffect(() => { stateRef.current = state; }, [state]);

    useEffect(() => {
        if (!isOpen) return;
        const wf = stateRef.current.workflow;
        if (!wf?.parameter_map) return;
        const next = {};
        const recalledM = {};
        Object.entries(wf.parameter_map).forEach(([key, config]) => {
            const recalled = initialParams?.[key];
            const isMedia = MEDIA_TYPES.includes(config.type);
            if (isMedia) {
                // Recall path for media: reuse the asset the recalled job used.
                // Its uploaded filename is still in ComfyUI/input (session uploads
                // aren't TTL-swept), so the new job can reference it directly —
                // no re-upload needed. The user can still Replace it.
                if (typeof recalled === 'string' && recalled) recalledM[key] = recalled;
            } else if (recalled !== undefined) {
                next[key] = recalled;
            } else if (isSeedParam(key, config)) {
                next[key] = randomSeed();
            } else {
                next[key] = config.default !== undefined ? config.default : '';
            }
        });
        // Show the reused asset right away: its file is still served from
        // ComfyUI/input, so we point the preview at it (image renders, video/
        // audio play) instead of leaving the field empty.
        const recalledPreviews = {};
        Object.entries(recalledM).forEach(([k, fn]) => { recalledPreviews[k] = getInputUrl(fn); });
        setFormParams(next);
        setRecalledMedia(recalledM);
        setMediaFiles({});
        setMediaPreviews(recalledPreviews);
        setUploadError('');
    }, [isOpen, initialParams]);

    useEffect(() => {
        setScheduledTime(initialTime);
    }, [initialTime]);

    /**
     * Collision Detection Effect
     * 
     * Checks if the selected time slot overlaps with any existing jobs.
     * Uses the global job state and benchmark duration to calculate start/end times.
     */
    useEffect(() => {
        // ASAP mode (no slot picked) can't collide — the server queues it next.
        if (!scheduledTime) { setIsCollision(false); return; }

        const duration = state.benchmark_ms || 30000;
        const endTime = scheduledTime + duration;

        const collision = state.jobs.some(job => {
            const jobStart = job.time_slot;
            const jobEnd = jobStart + duration;
            // Check for overlap: (StartA < EndB) and (EndA > StartB)
            return (scheduledTime < jobEnd) && (endTime > jobStart);
        });

        setIsCollision(collision);
    }, [scheduledTime, state.jobs, state.benchmark_ms]);

    const resolutions = [
        { label: 'Square (1024x1024)', value: '1024x1024' },
        { label: 'Portrait (832x1216)', value: '832x1216' },
        { label: 'Landscape (1216x832)', value: '1216x832' },
        { label: 'Smartphone (768x1344)', value: '768x1344' },
        { label: 'Cinematic (1408x768)', value: '1408x768' },
    ];

    const handleSubmit = async (e) => {
        e.preventDefault();

        // Check for required media uploads (image, video, or audio)
        const mediaParams = Object.entries(state.workflow?.parameter_map || {})
            .filter(([, v]) => MEDIA_TYPES.includes(v.type));
        const missingMedia = mediaParams.filter(([key]) => !mediaFiles[key] && !recalledMedia[key]);

        if (isCollision || isUploading || missingMedia.length > 0) return;

        setIsUploading(true);
        setUploadError('');
        const uploadedFilenames = {};

        // Upload all media files
        for (const [key, file] of Object.entries(mediaFiles)) {
            const formData = new FormData();
            formData.append('file', file); // Use 'file' as per updated server route
            const fieldLabel = state.workflow?.parameter_map?.[key]?.label || key;

            try {
                const response = await fetch(`${SERVER_URL}/upload`, {
                    method: 'POST',
                    body: formData,
                });
                // The server caps image size/dimensions and rejects HEIC; surface
                // its message instead of submitting a job with a missing input.
                if (!response.ok) {
                    const data = await response.json().catch(() => ({}));
                    setUploadError(`${fieldLabel}: ${data.error || 'upload was rejected by the server.'}`);
                    setIsUploading(false);
                    return;
                }
                const data = await response.json();
                uploadedFilenames[key] = data.filename;
            } catch (error) {
                console.error(`Upload failed for ${key}:`, error);
                setUploadError(`${fieldLabel}: upload failed — check your connection and try again.`);
                setIsUploading(false);
                return;
            }
        }

        // Prepare final params. recalledMedia carries comfy filenames reused
        // from a prior job (no re-upload); a freshly uploaded file for the same
        // key overrides it.
        const finalParams = { ...formParams, ...recalledMedia, ...uploadedFilenames };

        // Pick the user-visible "headline" prompt. Workflows expose textarea
        // inputs under different keys — `prompt` for Flux, `positive_prompt`
        // for LTX i2v, `text` for some primitive-fallback parses. The server
        // stores ONE field for the cards / lightbox / search, so surface the
        // value the user actually typed regardless of its key.
        const headlinePrompt = pickHeadlinePrompt(finalParams, state.workflow?.parameter_map);

        onConfirm({
            prompt: headlinePrompt,
            params: finalParams,
            time: scheduledTime
        });
        setIsUploading(false);
        onClose();
        setMediaFiles({});
        setMediaPreviews({});
    };

    const handleMediaRemove = (paramKey) => () => {
        setMediaFiles(prev => {
            const newFiles = { ...prev };
            delete newFiles[paramKey];
            return newFiles;
        });
        setMediaPreviews(prev => {
            const newPreviews = { ...prev };
            delete newPreviews[paramKey];
            return newPreviews;
        });
        setRecalledMedia(prev => {
            const n = { ...prev };
            delete n[paramKey];
            return n;
        });
    };

    // Called by MediaCaptureField with a (possibly already-resized) File.
    // The component handles the input event + EXIF-aware resize; we just
    // stash the file and generate a preview thumbnail. Resizing means the
    // preview reflects what'll actually be uploaded, not the raw camera shot.
    const handleMediaChange = (paramKey) => (file) => {
        if (!file) return;
        setMediaFiles(prev => ({ ...prev, [paramKey]: file }));
        // A fresh upload supersedes any recalled (reused) asset for this key.
        setRecalledMedia(prev => {
            const n = { ...prev };
            delete n[paramKey];
            return n;
        });
        const reader = new FileReader();
        reader.onloadend = () => {
            setMediaPreviews(prev => ({ ...prev, [paramKey]: reader.result }));
        };
        reader.readAsDataURL(file);
    };

    const adjustTime = (minutes) => {
        setScheduledTime(prev => prev + minutes * 60000);
    };

    /**
     * Renders dynamic form fields based on the workflow configuration.
     * Handles different input types: text, number, select, image, video.
     */
    const renderDynamicFields = () => {
        if (!state.workflow || !state.workflow.parameter_map) return null;

        const sortedParams = Object.entries(state.workflow.parameter_map)
            .sort(([, a], [, b]) => (a.order || 0) - (b.order || 0));

        return (
            <div className="space-y-4">
                {sortedParams.map(([key, config]) => {
                    const label = config.label || key.charAt(0).toUpperCase() + key.slice(1);
                    const type = config.type || 'text';

                    // Conditional gray-out: a field can declare `disabledWhen`
                    // ({ param, equals }) to render disabled while another param
                    // (a toggle) holds a given value — e.g. either/or prompt
                    // boxes gated by an "Enhance" checkbox.
                    const dw = config.disabledWhen;
                    const disabled = !!dw && formParams[dw.param] === dw.equals;
                    const ctrlLabel = dw && (state.workflow.parameter_map[dw.param]?.label || 'the toggle above');

                    // Mask input — the user paints a region on an uploaded
                    // image; MaskDrawField composites it into an RGBA PNG and
                    // hands that File up the SAME path as a normal upload (it
                    // stashes into mediaFiles and is POSTed on submit).
                    if (type === 'mask') {
                        return (
                            <MaskDrawField
                                key={key}
                                paramKey={key}
                                label={label}
                                maxInputEdge={config.maxInputEdge}
                                preview={mediaPreviews[key]}
                                recalledName={recalledMedia[key] ? prettyInputName(recalledMedia[key]) : null}
                                onChange={handleMediaChange(key)}
                                onRemove={handleMediaRemove(key)}
                            />
                        );
                    }

                    // Image / video input — delegated to MediaCaptureField,
                    // which renders the file-upload widget (click + drag-and-
                    // drop), then applies maxInputEdge resizing for images
                    // before handing the File back.
                    if (type === 'image' || type === 'video' || type === 'audio') {
                        return (
                            <MediaCaptureField
                                key={key}
                                paramKey={key}
                                label={label}
                                type={type}
                                maxInputEdge={config.maxInputEdge}
                                preview={mediaPreviews[key]}
                                recalledName={recalledMedia[key] ? prettyInputName(recalledMedia[key]) : null}
                                onChange={handleMediaChange(key)}
                                onRemove={handleMediaRemove(key)}
                            />
                        );
                    }

                    // Select Input
                    if (type === 'select' && config.options) {
                        return (
                            <div key={key} className="space-y-1.5">
                                <label className="text-sm font-medium text-slate-300">{label}</label>
                                <select
                                    className="w-full bg-background border border-border rounded-lg p-2.5 text-white focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all appearance-none cursor-pointer"
                                    value={formParams[key] || ''}
                                    onChange={(e) => setFormParams({ ...formParams, [key]: e.target.value })}
                                >
                                    {config.options.map(opt => (
                                        <option key={opt} value={opt}>{opt}</option>
                                    ))}
                                </select>
                            </div>
                        );
                    }

                    // Checkbox / toggle Input
                    if (type === 'checkbox') {
                        const checked = !!formParams[key];
                        return (
                            <label key={key} className="flex items-center gap-3 cursor-pointer select-none py-1">
                                <button
                                    type="button"
                                    role="switch"
                                    aria-checked={checked}
                                    onClick={() => setFormParams({ ...formParams, [key]: !checked })}
                                    className={`relative w-10 h-6 rounded-full transition-colors shrink-0 ${checked ? 'bg-primary' : 'bg-surface border border-border'}`}
                                >
                                    <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-on-primary shadow transition-transform ${checked ? 'translate-x-4' : ''}`} />
                                </button>
                                <span className="text-sm font-medium text-slate-300">{label}</span>
                            </label>
                        );
                    }

                    // Textarea Input
                    if (type === 'textarea' || key === 'prompt') {
                        return (
                            <div key={key} className={`space-y-1.5 ${disabled ? 'opacity-50' : ''}`}>
                                <label className="text-sm font-medium text-slate-300 flex items-center gap-2 flex-wrap">
                                    {label}
                                    {disabled && (
                                        <span className="text-[10px] font-normal text-muted normal-case">
                                            — disabled; change “{ctrlLabel}” to edit
                                        </span>
                                    )}
                                </label>
                                <textarea
                                    disabled={disabled}
                                    className={`w-full bg-background border border-border rounded-lg p-3 text-white focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all placeholder:text-muted/50 min-h-[100px] resize-none ${disabled ? 'cursor-not-allowed' : ''}`}
                                    value={formParams[key] || ''}
                                    onChange={(e) => setFormParams({ ...formParams, [key]: e.target.value })}
                                    placeholder={`Enter ${label}...`}
                                />
                            </div>
                        );
                    }

                    // Seed Input — auto-randomized; re-roll button; user can type a specific value
                    if (isSeedParam(key, config)) {
                        return (
                            <div key={key} className="space-y-1.5">
                                <label className="text-sm font-medium text-slate-300">{label}</label>
                                <div className="flex items-center gap-2">
                                    <input
                                        type="number"
                                        className="flex-1 bg-background border border-border rounded-lg p-2.5 text-white focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all"
                                        value={formParams[key] ?? ''}
                                        onChange={(e) => {
                                            const v = e.target.value;
                                            setFormParams({ ...formParams, [key]: v === '' ? '' : parseInt(v, 10) || 0 });
                                        }}
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setFormParams({ ...formParams, [key]: randomSeed() })}
                                        className="p-2.5 rounded-lg bg-surface border border-border hover:bg-white/5 text-muted hover:text-primary transition-colors"
                                        title="Randomize seed"
                                    >
                                        <Dices size={18} />
                                    </button>
                                </div>
                                <p className="text-[10px] text-muted ml-1">Auto-randomized each time. Click the dice to re-roll, or type a specific value.</p>
                            </div>
                        );
                    }

                    // Default Input (Text/Number)
                    return (
                        <div key={key} className="space-y-1.5">
                            <label className="text-sm font-medium text-slate-300">{label}</label>
                            <input
                                type={type === 'number' ? 'number' : 'text'}
                                className="w-full bg-background border border-border rounded-lg p-2.5 text-white focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all"
                                value={formParams[key] ?? ''}
                                onChange={(e) => setFormParams({ ...formParams, [key]: type === 'number' ? parseFloat(e.target.value) : e.target.value })}
                            />
                        </div>
                    );
                })}
            </div>
        );
    };

    const handleTimeChange = (e) => {
        const [hours, minutes] = e.target.value.split(':').map(Number);
        const newDate = new Date(scheduledTime);
        newDate.setHours(hours);
        newDate.setMinutes(minutes);
        newDate.setSeconds(0);
        newDate.setMilliseconds(0);
        setScheduledTime(newDate.getTime());
    };

    const timeValue = scheduledTime
        ? new Date(scheduledTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
        : '';

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Book Generation Slot" maxWidth="max-w-lg">
            <form onSubmit={handleSubmit} className="space-y-6">
                {state.workflow_info?.id && (state.workflow_info.description || state.workflow_info.name) && (
                    <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 space-y-2">
                        <div className="flex items-center gap-2">
                            <Info size={14} className="text-primary shrink-0" />
                            <span className="text-[10px] uppercase tracking-widest font-bold text-muted">Active workflow</span>
                            <span className="text-sm font-semibold text-foreground">{state.workflow_info.name}</span>
                            {state.workflow_info.category && state.workflow_info.category !== 'other' && (
                                <span className="text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                                    {state.workflow_info.category}
                                </span>
                            )}
                        </div>
                        {state.workflow_info.description && (
                            <p className="text-xs text-slate-300 leading-relaxed whitespace-pre-wrap">
                                {state.workflow_info.description}
                            </p>
                        )}
                    </div>
                )}
                <div className="space-y-4 border-b border-border pb-6">
                    <div className="flex flex-col space-y-3">
                        <label className="text-sm font-medium text-slate-300 flex items-center gap-2">
                            <Clock size={14} className="text-primary" />
                            When to run
                        </label>
                        {/* Segmented toggle — ASAP (no slot) vs a specific time. */}
                        <div className="grid grid-cols-2 gap-1 bg-surface border border-border rounded-lg p-1">
                            <button
                                type="button"
                                onClick={() => setScheduledTime(null)}
                                className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-xs font-semibold transition-colors ${!scheduledTime ? 'bg-primary text-on-primary shadow' : 'text-muted hover:text-foreground'}`}
                            >
                                <Sparkles size={13} /> As soon as possible
                            </button>
                            <button
                                type="button"
                                onClick={() => { if (!scheduledTime) setScheduledTime(Date.now()); }}
                                className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-xs font-semibold transition-colors ${scheduledTime ? 'bg-primary text-on-primary shadow' : 'text-muted hover:text-foreground'}`}
                            >
                                <Clock size={13} /> Pick a time
                            </button>
                        </div>
                        {scheduledTime ? (
                            <>
                                <div className="flex items-center space-x-2">
                                    <button
                                        type="button"
                                        onClick={() => adjustTime(-1)}
                                        className="p-2 rounded-lg bg-surface border border-border hover:bg-white/5 transition-colors text-muted hover:text-white"
                                    >
                                        <ChevronLeft size={20} />
                                    </button>
                                    <div className="relative flex-1">
                                        <input
                                            type="time"
                                            value={timeValue}
                                            onChange={handleTimeChange}
                                            className="w-full bg-background border border-border rounded-lg p-2.5 text-white font-mono text-center focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all"
                                        />
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => adjustTime(1)}
                                        className="p-2 rounded-lg bg-surface border border-border hover:bg-white/5 transition-colors text-muted hover:text-white"
                                    >
                                        <ChevronRight size={20} />
                                    </button>
                                </div>

                                {isCollision ? (
                                    <div className="flex items-center gap-2 text-danger text-xs font-medium bg-danger/10 p-2.5 rounded-lg border border-danger/20 animate-in fade-in slide-in-from-top-1">
                                        <AlertTriangle size={14} />
                                        This time slot is already taken. Please choose another one.
                                    </div>
                                ) : (
                                    <p className="text-[10px] text-muted uppercase tracking-wider font-semibold ml-1">
                                        Slot is available
                                    </p>
                                )}
                            </>
                        ) : (
                            <p className="text-[11px] text-muted ml-1">
                                Runs as soon as the queue is free — the next open spot.
                            </p>
                        )}
                    </div>
                </div>

                {/* Dynamic Fields Rendering */}
                {/* Dynamic Fields Rendering */}
                {renderDynamicFields()}

                {uploadError && (
                    <div className="flex items-start gap-2 text-danger text-xs font-medium bg-danger/10 p-2.5 rounded-lg border border-danger/20">
                        <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                        <span>{uploadError}</span>
                    </div>
                )}

                <div className="pt-2 flex justify-end space-x-3">
                    <Button variant="ghost" onClick={onClose} type="button">
                        Cancel
                    </Button>
                    <Button
                        variant="primary"
                        type="submit"
                        icon={Sparkles}
                        disabled={isCollision || isUploading}
                    >
                        {isUploading ? 'Uploading...' : scheduledTime ? 'Book Slot' : 'Start ASAP'}
                    </Button>
                </div>
            </form>
        </Modal>
    );
};

export default BookingDialog;
