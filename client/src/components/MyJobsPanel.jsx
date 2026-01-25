import React from 'react';
import { useSocket } from '../context/SocketContext';
import Card from './ui/Card';
import Badge from './ui/Badge';
import { Sparkles, Clock, CheckCircle2, AlertCircle, Image as ImageIcon, Search, X, Download } from 'lucide-react';

const MyJobsPanel = ({ onClose }) => {
    const { state, username } = useSocket();

    // Filter jobs for current user
    const myJobs = state.jobs
        .filter(job => job.user_id === username)
        .sort((a, b) => b.time_slot - a.time_slot);

    return (
        <Card className="h-full flex flex-col border-l border-border rounded-none bg-surface/30 backdrop-blur-sm shadow-2xl relative" noPadding>
            <div className="p-4 sm:p-6 border-b border-border flex items-center justify-between bg-surface/50 z-10 shrink-0">
                <div className="flex items-center space-x-3">
                    {onClose && (
                        <button
                            onClick={onClose}
                            className="p-2 -ml-2 text-muted hover:text-white xl:hidden transition-colors rounded-lg hover:bg-white/5"
                        >
                            <X size={20} />
                        </button>
                    )}
                    <div>
                        <h3 className="font-bold text-base sm:text-lg tracking-tight text-white leading-none">My Generations</h3>
                        <p className="text-[10px] text-muted font-medium mt-1 uppercase tracking-widest leading-none">Job Queue</p>
                    </div>
                </div>
                <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center border border-primary/20 shrink-0">
                    <span className="text-xs font-bold text-primary">{myJobs.length}</span>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar bg-black/20">
                {myJobs.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-center space-y-4 opacity-30 py-12">
                        <div className="p-4 bg-muted/10 rounded-full">
                            <Search size={32} />
                        </div>
                        <div className="space-y-1">
                            <p className="text-sm font-medium">No active jobs</p>
                            <p className="text-xs text-muted">Book a slot on the timeline</p>
                        </div>
                    </div>
                ) : (
                    myJobs.map((job) => (
                        <div
                            key={job.id}
                            className="group relative bg-background/40 border border-border/40 rounded-xl p-4 hover:border-primary/20 transition-all duration-300 hover:shadow-lg hover:shadow-primary/5 active:scale-[0.98]"
                        >
                            <div className="flex justify-between items-start mb-3">
                                <div className="space-y-1">
                                    <div className="flex items-center space-x-2">
                                        <Clock size={12} className="text-muted" />
                                        <span className="text-[10px] font-mono text-muted uppercase tracking-tighter">
                                            {new Date(job.time_slot).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                        </span>
                                    </div>
                                    <Badge
                                        variant={job.status === 'completed' ? 'success' : job.status === 'processing' ? 'warning' : 'primary'}
                                        className="text-[9px] uppercase font-bold py-0 h-4"
                                    >
                                        {job.status}
                                    </Badge>
                                </div>
                                {job.result_filename && (
                                    <div className="flex flex-col items-center space-y-2">
                                        <div
                                            className="w-12 h-12 rounded-lg overflow-hidden border border-border group-hover:border-primary/40 transition-colors bg-black cursor-pointer shadow-md"
                                            onClick={() => window.open(`http://localhost:3000/images/${job.result_filename}`, '_blank')}
                                        >
                                            <img
                                                src={`http://localhost:3000/images/${job.result_filename}`}
                                                alt="Preview"
                                                className="w-full h-full object-cover transition-transform group-hover:scale-110"
                                            />
                                        </div>
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                const link = document.createElement('a');
                                                link.href = `http://localhost:3000/download/${job.result_filename}`;
                                                link.download = job.result_filename;
                                                document.body.appendChild(link);
                                                link.click();
                                                document.body.removeChild(link);
                                            }}
                                            className="p-1.5 rounded-md bg-white/5 hover:bg-primary/20 text-muted hover:text-primary transition-all duration-200 border border-border/50 hover:border-primary/30"
                                            title="Download Image"
                                        >
                                            <Download size={12} />
                                        </button>
                                    </div>
                                )}
                            </div>

                            <p className="text-xs text-slate-400 line-clamp-2 leading-relaxed italic pr-2" title={job.prompt}>
                                "{job.prompt}"
                            </p>

                            {job.status === 'processing' && (
                                <div className="mt-3 space-y-2">
                                    {job.current_node && <p className="text-[9px] text-primary/60 font-medium">Node: {job.current_node}</p>}
                                    {job.progress ? (
                                        <>
                                            <div className="flex justify-between text-[9px] font-mono text-primary/80">
                                                <span>Step {job.progress.value} of {job.progress.max}</span>
                                                {job.s_it && <span>{job.s_it} s/it</span>}
                                                <span>{Math.round((job.progress.value / job.progress.max) * 100)}%</span>
                                            </div>
                                            <div className="w-full bg-muted/10 h-1 rounded-full overflow-hidden">
                                                <div
                                                    className="h-full bg-primary shadow-[0_0_8px_rgba(99,102,241,0.5)] transition-all duration-300"
                                                    style={{ width: `${(job.progress.value / job.progress.max) * 100}%` }}
                                                />
                                            </div>
                                        </>
                                    ) : (
                                        <div className="w-full bg-muted/10 h-1 rounded-full overflow-hidden">
                                            <div className="h-full bg-primary animate-progress-indeterminate shadow-[0_0_8px_rgba(99,102,241,0.5)]" />
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    ))
                )}
            </div>
        </Card>
    );
};

export default MyJobsPanel;
