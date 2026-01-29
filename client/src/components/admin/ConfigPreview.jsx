import React, { useState } from 'react';
import { Upload, X, Image as ImageIcon, Video as VideoIcon, Sparkles, Clock, AlertTriangle } from 'lucide-react';

const ConfigPreview = ({ parameters }) => {
    // Only show enabled parameters
    const enabledParams = parameters.filter(p => p.enabled);

    // Mock state for interactions
    const [formState, setFormState] = useState(
        parameters.reduce((acc, p) => ({ ...acc, [p.key]: p.defaultValue }), {})
    );

    if (enabledParams.length === 0) {
        return (
            <div className="h-full flex items-center justify-center text-slate-500 bg-surface/30 rounded-2xl border border-dashed border-white/10">
                <p>Select parameters to see preview</p>
            </div>
        );
    }

    return (
        <div className="bg-surface border border-white/10 rounded-2xl shadow-xl overflow-hidden max-w-md mx-auto">
            {/* Header */}
            <div className="p-4 border-b border-white/5 flex items-center gap-3 bg-white/5">
                <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-primary">
                    <Sparkles size={16} />
                </div>
                <div>
                    <h3 className="font-semibold text-white">New Booking</h3>
                    <p className="text-xs text-slate-400">Preview of student view</p>
                </div>
            </div>

            {/* Content */}
            <div className="p-6 space-y-6 max-h-[600px] overflow-y-auto custom-scrollbar">

                {/* Time Selection Mock */}
                <div className="space-y-2 pb-4 border-b border-white/5">
                    <label className="text-sm font-medium text-slate-300 flex items-center gap-2">
                        <Clock size={14} className="text-primary" />
                        Selected Time
                    </label>
                    <div className="bg-black/20 rounded-lg p-3 text-sm text-white flex justify-between items-center">
                        <span>Today, 2:30 PM</span>
                        <span className="text-xs text-slate-400 bg-white/5 px-2 py-1 rounded">30 min</span>
                    </div>
                </div>

                {/* Dynamic Fields */}
                <div className="space-y-5">
                    {enabledParams.map((param) => {
                        const isVideo = param.type === 'video';
                        const isImage = param.type === 'image';
                        return (
                            <div key={param.key} className="space-y-2">
                                <label className="text-sm font-medium text-slate-300 flex items-center gap-2">
                                    {isImage && <ImageIcon size={14} className="text-primary" />}
                                    {isVideo && <VideoIcon size={14} className="text-primary" />}
                                    {param.label}
                                </label>

                                {isImage || isVideo ? (
                                    <div className="relative group border-2 border-dashed border-border hover:border-primary/30 bg-surface/30 rounded-xl p-4 transition-all duration-300">
                                        <label className="flex flex-col items-center justify-center space-y-3 cursor-not-allowed py-4">
                                            <div className="p-3 rounded-full bg-surface border border-border">
                                                <Upload size={24} className="text-muted" />
                                            </div>
                                            <div className="text-center">
                                                <p className="text-sm font-medium text-slate-300">Upload {isVideo ? 'Video' : 'Image'}</p>
                                                <p className="text-xs text-slate-500 mt-1">Preview only</p>
                                            </div>
                                        </label>
                                    </div>
                                ) : param.type === 'textarea' ? (
                                    <textarea
                                        value={formState[param.key]}
                                        readOnly
                                        className="w-full bg-background border border-border rounded-lg p-3 text-sm text-slate-300 focus:ring-0 outline-none min-h-[100px] resize-none opacity-80 cursor-default"
                                    />
                                ) : param.type === 'select' ? (
                                    <div className="relative">
                                        <select
                                            disabled
                                            className="w-full bg-background border border-border rounded-lg p-2.5 text-sm text-slate-300 appearance-none opacity-80"
                                        >
                                            <option>{param.defaultValue || 'Default Option'}</option>
                                        </select>
                                    </div>
                                ) : (
                                    <input
                                        type={param.type === 'number' ? 'number' : 'text'}
                                        value={formState[param.key]}
                                        readOnly
                                        className="w-full bg-background border border-border rounded-lg p-2.5 text-sm text-slate-300 focus:ring-0 outline-none opacity-80 cursor-default"
                                    />
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-white/5 bg-black/20 flex justify-end gap-3 opacity-80">
                <button disabled className="px-4 py-2 rounded-lg text-sm font-medium text-slate-400 hover:text-white transition-colors">
                    Cancel
                </button>
                <button disabled className="px-6 py-2 rounded-lg text-sm font-medium bg-primary text-white shadow-lg shadow-primary/20">
                    Confirm Booking
                </button>
            </div>
        </div>
    );
};

export default ConfigPreview;
