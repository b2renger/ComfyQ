import React, { useState, useEffect } from 'react';
import Modal from './ui/Modal';
import Button from './ui/Button';
import { Sparkles, Layers, Maximize, Clock, AlertTriangle, ChevronLeft, ChevronRight } from 'lucide-react';
import { useSocket } from '../context/SocketContext';

const BookingDialog = ({ isOpen, onClose, initialTime, onConfirm }) => {
    const { state } = useSocket();
    const [prompt, setPrompt] = useState('');
    const [steps, setSteps] = useState(20);
    const [cfg, setCfg] = useState(5);
    const [resolution, setResolution] = useState('1024x1024');
    const [scheduledTime, setScheduledTime] = useState(initialTime);
    const [isCollision, setIsCollision] = useState(false);

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

    const handleSubmit = (e) => {
        e.preventDefault();
        if (isCollision) return;

        const [width, height] = resolution.split('x').map(Number);
        onConfirm({
            prompt,
            params: { steps, cfg, width, height },
            time: scheduledTime
        });
        onClose();
        setPrompt('');
    };

    const adjustTime = (minutes) => {
        setScheduledTime(prev => prev + minutes * 60000);
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

                <div className="space-y-1.5">
                    <label className="text-sm font-medium text-slate-300">Prompt</label>
                    <textarea
                        className="w-full bg-background border border-border rounded-lg p-3 text-white focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all placeholder:text-muted/50 min-h-[100px] resize-none"
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        placeholder="Describe your imagination..."
                        autoFocus
                    />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                        <label className="text-sm font-medium text-slate-300 flex items-center gap-2">
                            <Layers size={14} className="text-primary" />
                            Steps
                        </label>
                        <input
                            type="number"
                            className="w-full bg-background border border-border rounded-lg p-2.5 text-white focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all"
                            value={steps}
                            onChange={(e) => setSteps(parseInt(e.target.value))}
                            min="1"
                            max="50"
                        />
                    </div>
                    <div className="space-y-1.5">
                        <label className="text-sm font-medium text-slate-300 flex items-center gap-2">
                            <Sparkles size={14} className="text-primary" />
                            CFG Scale
                        </label>
                        <input
                            type="number"
                            className="w-full bg-background border border-border rounded-lg p-2.5 text-white focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all"
                            value={cfg}
                            onChange={(e) => setCfg(parseFloat(e.target.value))}
                            step="0.1"
                            min="0"
                            max="20"
                        />
                    </div>
                </div>

                <div className="grid grid-cols-1 gap-4">
                    <div className="space-y-1.5">
                        <label className="text-sm font-medium text-slate-300 flex items-center gap-2">
                            <Maximize size={14} className="text-primary" />
                            Resolution
                        </label>
                        <select
                            className="w-full bg-background border border-border rounded-lg p-2.5 text-white focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all appearance-none cursor-pointer"
                            value={resolution}
                            onChange={(e) => setResolution(e.target.value)}
                        >
                            {resolutions.map(res => (
                                <option key={res.value} value={res.value}>{res.label}</option>
                            ))}
                        </select>
                    </div>
                </div>

                <div className="pt-2 flex justify-end space-x-3">
                    <Button variant="ghost" onClick={onClose} type="button">
                        Cancel
                    </Button>
                    <Button
                        variant="primary"
                        type="submit"
                        icon={Sparkles}
                        disabled={isCollision || !prompt.trim()}
                    >
                        Book Slot
                    </Button>
                </div>
            </form>
        </Modal>
    );
};

export default BookingDialog;
