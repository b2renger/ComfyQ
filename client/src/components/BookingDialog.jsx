import React, { useState, useEffect, useRef } from 'react';
import Modal from './ui/Modal';
import Button from './ui/Button';
import { Sparkles, Layers, Maximize, Clock, AlertTriangle, ChevronLeft, ChevronRight, Upload, X, Image as ImageIcon, Video as VideoIcon, Dices, Info } from 'lucide-react';
import { useSocket } from '../context/SocketContext';
import { SERVER_URL } from '../utils/api';

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

const BookingDialog = ({ isOpen, onClose, initialTime, onConfirm, initialParams }) => {
    const { state } = useSocket();
    const [scheduledTime, setScheduledTime] = useState(initialTime);
    const [isCollision, setIsCollision] = useState(false);
    const [formParams, setFormParams] = useState({});
    const [mediaFiles, setMediaFiles] = useState({}); // { paramKey: File }
    const [mediaPreviews, setMediaPreviews] = useState({}); // { paramKey: dataURL }
    const [isUploading, setIsUploading] = useState(false);

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
        Object.entries(wf.parameter_map).forEach(([key, config]) => {
            // Recall path: an explicit initialParams takes precedence — except
            // for image/video/audio inputs (those filenames are session-scoped
            // and may have been swept; force the user to re-upload).
            const recalled = initialParams?.[key];
            const isMedia = ['image', 'video', 'audio'].includes(config.type);
            if (recalled !== undefined && !isMedia) {
                next[key] = recalled;
            } else if (isSeedParam(key, config)) {
                next[key] = randomSeed();
            } else {
                next[key] = config.default !== undefined ? config.default : '';
            }
        });
        setFormParams(next);
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
        if (!scheduledTime) return;

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

        // Check for required media uploads (image or video)
        const mediaParams = Object.entries(state.workflow?.parameter_map || {})
            .filter(([k, v]) => v.type === 'image' || v.type === 'video');
        const missingMedia = mediaParams.filter(([key]) => !mediaFiles[key]);

        if (isCollision || isUploading || missingMedia.length > 0) return;

        setIsUploading(true);
        const uploadedFilenames = {};

        // Upload all media files
        for (const [key, file] of Object.entries(mediaFiles)) {
            const formData = new FormData();
            formData.append('file', file); // Use 'file' as per updated server route

            try {
                const response = await fetch(`${SERVER_URL}/upload`, {
                    method: 'POST',
                    body: formData,
                });
                const data = await response.json();
                uploadedFilenames[key] = data.filename;
            } catch (error) {
                console.error(`Upload failed for ${key}:`, error);
                setIsUploading(false);
                return;
            }
        }

        // Prepare final params
        const finalParams = { ...formParams, ...uploadedFilenames };

        onConfirm({
            prompt: finalParams.prompt || '',
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
    };

    const handleMediaChange = (paramKey) => (e) => {
        const file = e.target.files[0];
        if (file) {
            setMediaFiles(prev => ({ ...prev, [paramKey]: file }));
            const reader = new FileReader();
            reader.onloadend = () => {
                setMediaPreviews(prev => ({ ...prev, [paramKey]: reader.result }));
            };
            reader.readAsDataURL(file);
        }
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

                    // Media Upload Input
                    if (type === 'image' || type === 'video') {
                        const preview = mediaPreviews[key];
                        const isVideoType = type === 'video';
                        return (
                            <div key={key} className="space-y-2">
                                <label className="text-sm font-medium text-slate-300 flex items-center gap-2">
                                    {isVideoType ? <VideoIcon size={14} className="text-primary" /> : <ImageIcon size={14} className="text-primary" />}
                                    {label}
                                </label>
                                <div
                                    className={`relative group border-2 border-dashed rounded-xl p-4 transition-all duration-300 ${preview ? 'border-primary/50 bg-primary/5' : 'border-border hover:border-primary/30 bg-surface/30'}`}
                                >
                                    {preview ? (
                                        <div className="relative aspect-video rounded-lg overflow-hidden group/preview">
                                            {isVideoType ? (
                                                <video src={preview} className="w-full h-full object-cover" muted loop autoPlay />
                                            ) : (
                                                <img src={preview} alt="Preview" className="w-full h-full object-cover" />
                                            )}
                                            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/preview:opacity-100 transition-opacity flex items-center justify-center">
                                                <button
                                                    type="button"
                                                    onClick={handleMediaRemove(key)}
                                                    className="p-2 rounded-full bg-danger text-white hover:scale-110 transition-transform"
                                                >
                                                    <X size={20} />
                                                </button>
                                            </div>
                                        </div>
                                    ) : (
                                        <label className="flex flex-col items-center justify-center space-y-3 cursor-pointer py-4">
                                            <div className="p-3 rounded-full bg-surface border border-border group-hover:border-primary/30 group-hover:scale-110 transition-all duration-300">
                                                <Upload size={24} className="text-muted group-hover:text-primary" />
                                            </div>
                                            <div className="text-center">
                                                <p className="text-sm font-medium text-slate-300">Click or drag {type} to upload</p>
                                            </div>
                                            <input type="file" className="hidden" accept={isVideoType ? "video/*" : "image/*"} onChange={handleMediaChange(key)} />
                                        </label>
                                    )}
                                </div>
                            </div>
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

                    // Textarea Input
                    if (type === 'textarea' || key === 'prompt') {
                        return (
                            <div key={key} className="space-y-1.5">
                                <label className="text-sm font-medium text-slate-300">{label}</label>
                                <textarea
                                    className="w-full bg-background border border-border rounded-lg p-3 text-white focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all placeholder:text-muted/50 min-h-[100px] resize-none"
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

    const timeValue = new Date(scheduledTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Book Generation Slot" maxWidth="max-w-lg">
            <form onSubmit={handleSubmit} className="space-y-6">
                {state.workflow_info?.id && (state.workflow_info.description || state.workflow_info.name) && (
                    <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 space-y-2">
                        <div className="flex items-center gap-2">
                            <Info size={14} className="text-primary shrink-0" />
                            <span className="text-[10px] uppercase tracking-widest font-bold text-muted">Active workflow</span>
                            <span className="text-sm font-semibold text-primary-light">{state.workflow_info.name}</span>
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
                            Schedule Time
                        </label>
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
                    </div>
                </div>

                {/* Dynamic Fields Rendering */}
                {/* Dynamic Fields Rendering */}
                {renderDynamicFields()}

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
                        {isUploading ? 'Uploading...' : 'Book Slot'}
                    </Button>
                </div>
            </form>
        </Modal>
    );
};

export default BookingDialog;
