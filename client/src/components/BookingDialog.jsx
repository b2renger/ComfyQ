import React, { useState, useEffect } from 'react';
import Modal from './ui/Modal';
import Button from './ui/Button';
import { Sparkles, Layers, Maximize, Clock, AlertTriangle, ChevronLeft, ChevronRight, Upload, X, Image as ImageIcon } from 'lucide-react';
import { useSocket } from '../context/SocketContext';
import { SERVER_URL } from '../utils/api';

const BookingDialog = ({ isOpen, onClose, initialTime, onConfirm }) => {
    const { state } = useSocket();
    const [scheduledTime, setScheduledTime] = useState(initialTime);
    const [isCollision, setIsCollision] = useState(false);
    const [formParams, setFormParams] = useState({});
    const [imageFiles, setImageFiles] = useState({}); // { image: File, image1: File, image2: File }
    const [imagePreviews, setImagePreviews] = useState({}); // { image: dataURL, image1: dataURL, image2: dataURL }
    const [isUploading, setIsUploading] = useState(false);

    // Initialize form params from workflow config defaults
    useEffect(() => {
        if (state.workflow && state.workflow.parameter_map) {
            const initialParams = {};
            Object.entries(state.workflow.parameter_map).forEach(([key, config]) => {
                // If config is array, take first or handle logic; here assumed object
                // Handle simple vs extended definition
                const defaultValue = config.default !== undefined ? config.default : '';
                initialParams[key] = defaultValue;
            });
            setFormParams(initialParams);
        }
    }, [state.workflow]);

    useEffect(() => {
        setScheduledTime(initialTime);
    }, [initialTime]);

    useEffect(() => {
        if (!scheduledTime) return;

        const duration = state.benchmark_ms || 30000;
        const endTime = scheduledTime + duration;

        const collision = state.jobs.some(job => {
            const jobStart = job.time_slot;
            const jobEnd = jobStart + duration;
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

        // Check for required image uploads
        const imageParams = Object.entries(state.workflow?.parameter_map || {}).filter(([k, v]) => v.type === 'image');
        const missingImages = imageParams.filter(([key]) => !imageFiles[key]);

        if (isCollision || isUploading || missingImages.length > 0) return;

        setIsUploading(true);
        const uploadedFilenames = {};

        // Upload all images
        for (const [key, file] of Object.entries(imageFiles)) {
            const formData = new FormData();
            formData.append('image', file);

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
        setImageFiles({});
        setImagePreviews({});
    };

    const handleImageRemove = (paramKey) => () => {
        setImageFiles(prev => {
            const newFiles = { ...prev };
            delete newFiles[paramKey];
            return newFiles;
        });
        setImagePreviews(prev => {
            const newPreviews = { ...prev };
            delete newPreviews[paramKey];
            return newPreviews;
        });
    };

    const handleImageChange = (paramKey) => (e) => {
        const file = e.target.files[0];
        if (file) {
            setImageFiles(prev => ({ ...prev, [paramKey]: file }));
            const reader = new FileReader();
            reader.onloadend = () => {
                setImagePreviews(prev => ({ ...prev, [paramKey]: reader.result }));
            };
            reader.readAsDataURL(file);
        }
    };

    const adjustTime = (minutes) => {
        setScheduledTime(prev => prev + minutes * 60000);
    };

    const renderDynamicFields = () => {
        if (!state.workflow || !state.workflow.parameter_map) return null;

        const sortedParams = Object.entries(state.workflow.parameter_map)
            .sort(([, a], [, b]) => (a.order || 0) - (b.order || 0));

        return (
            <div className="space-y-4">
                {sortedParams.map(([key, config]) => {
                    const label = config.label || key.charAt(0).toUpperCase() + key.slice(1);
                    const type = config.type || 'text';

                    if (type === 'image') {
                        const preview = imagePreviews[key];
                        return (
                            <div key={key} className="space-y-2">
                                <label className="text-sm font-medium text-slate-300 flex items-center gap-2">
                                    <ImageIcon size={14} className="text-primary" />
                                    {label}
                                </label>
                                <div
                                    className={`relative group border-2 border-dashed rounded-xl p-4 transition-all duration-300 ${preview ? 'border-primary/50 bg-primary/5' : 'border-border hover:border-primary/30 bg-surface/30'}`}
                                >
                                    {preview ? (
                                        <div className="relative aspect-video rounded-lg overflow-hidden group/preview">
                                            <img src={preview} alt="Preview" className="w-full h-full object-cover" />
                                            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/preview:opacity-100 transition-opacity flex items-center justify-center">
                                                <button
                                                    type="button"
                                                    onClick={handleImageRemove(key)}
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
                                                <p className="text-sm font-medium text-slate-300">Click or drag image to upload</p>
                                            </div>
                                            <input type="file" className="hidden" accept="image/*" onChange={handleImageChange(key)} />
                                        </label>
                                    )}
                                </div>
                            </div>
                        );
                    }

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

                    return (
                        <div key={key} className="space-y-1.5">
                            <label className="text-sm font-medium text-slate-300">{label}</label>
                            <input
                                type={type === 'number' ? 'number' : 'text'}
                                className="w-full bg-background border border-border rounded-lg p-2.5 text-white focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all"
                                value={formParams[key] || ''}
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
