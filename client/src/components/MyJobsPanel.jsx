import React, { useState } from 'react';
import { useSocket } from '../context/SocketContext';
import Card from './ui/Card';
import Badge from './ui/Badge';
import { Sparkles, Clock, CheckCircle2, AlertCircle, Image as ImageIcon, Search, X, Download } from 'lucide-react';
import MediaPreview from './ui/MediaPreview';
import WorkflowChip from './ui/WorkflowChip';
import ProgressViz from './ui/ProgressViz';
import { getImageUrl, getDownloadUrl } from '../utils/api';
import { getUserColor } from '../utils/userColor';
import { getDisplayPrompt, getPrimaryDownloadFilename, getGenerationMs, formatDuration } from '../utils/jobDisplay';
import { computeEtaSeconds } from '../utils/jobEta';

/**
 * My Jobs Panel Component
 * 
 * A sidebar/panel that displays a list of all jobs in the system, sorted by time.
 * Provides a quick overview of job status, progress, and results.
 * 
 * Features:
 * - List of all jobs (scheduled, processing, completed)
 * - Real-time progress bars for processing jobs
 * - Media previews and download buttons for completed jobs
 * - Responsive design (sidebar on desktop, overlay on mobile)
 * 
 * @param {Object} props
 * @param {Function} [props.onClose] - Handler to close panel (client-mobile only)
 */
const MyJobsPanel = ({ onClose }) => {
    const { state, username, workflowsById } = useSocket();
    const userColor = getUserColor(username);
    const [searchQuery, setSearchQuery] = useState('');

    // Sidebar shows ONLY the current user's jobs — the main grid has tabs
    // (My / All) for cross-user views. Anonymous users (no username) see
    // nothing in the sidebar.
    const q = searchQuery.trim().toLowerCase();
    const allJobs = state.jobs
        .filter(j => username && j.user_id === username)
        .filter(j => !q || getDisplayPrompt(j).toLowerCase().includes(q))
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
                        <div className="flex items-center gap-1.5 mt-1">
                            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: userColor.dot }} />
                            <p
                                className="text-[10px] font-medium uppercase tracking-widest leading-none"
                                style={{ color: userColor.ring }}
                            >
                                {username || 'Anonymous'}
                            </p>
                        </div>
                    </div>
                </div>
                <div
                    className="w-8 h-8 rounded-xl flex items-center justify-center border shrink-0"
                    style={{ backgroundColor: userColor.bg, borderColor: userColor.ring + '40' }}
                >
                    <span className="text-xs font-bold" style={{ color: userColor.ring }}>{allJobs.length}</span>
                </div>
            </div>

            {/* Search box — filters allJobs in place. Hidden for anonymous
                users since they have nothing to search through. */}
            {username && (
                <div className="px-4 py-3 border-b border-border bg-surface/20 shrink-0">
                    <div className="relative">
                        <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
                        <input
                            type="search"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Search your prompts…"
                            className="w-full bg-background/50 border border-border rounded-md pl-7 pr-7 py-1.5 text-xs text-white placeholder-muted focus:outline-none focus:border-primary/50"
                        />
                        {searchQuery && (
                            <button
                                type="button"
                                onClick={() => setSearchQuery('')}
                                className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 rounded text-muted hover:text-white hover:bg-white/5"
                                title="Clear"
                            >
                                <X size={12} />
                            </button>
                        )}
                    </div>
                </div>
            )}

            <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar bg-black/20">
                {allJobs.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-center space-y-4 opacity-30 py-12">
                        <div className="p-4 bg-muted/10 rounded-full">
                            <Search size={32} />
                        </div>
                        <div className="space-y-1">
                            {q ? (
                                <>
                                    <p className="text-sm font-medium">No matches</p>
                                    <p className="text-xs text-muted">Nothing in your jobs contains "{searchQuery}"</p>
                                </>
                            ) : (
                                <>
                                    <p className="text-sm font-medium">No active jobs</p>
                                    <p className="text-xs text-muted">Book a slot on the timeline</p>
                                </>
                            )}
                        </div>
                    </div>
                ) : (
                    allJobs.map((job) => (
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
                                            onClick={() => window.open(getImageUrl(job.result_filename), '_blank')}
                                            title="Open preview in new tab"
                                        >
                                            {/* Sidebar thumb intentionally uses result_filename (PNG
                                                preview for 3D jobs), not the GLB — a 48px WebGL
                                                viewer is too small to be useful. The download button
                                                below still grabs the GLB via getPrimaryDownloadFilename. */}
                                            <MediaPreview
                                                filename={job.result_filename}
                                                className="transition-transform group-hover:scale-110"
                                                showPlayIcon={false}
                                            />
                                        </div>
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                const dl = getPrimaryDownloadFilename(job);
                                                if (!dl) return;
                                                const link = document.createElement('a');
                                                link.href = getDownloadUrl(dl);
                                                link.download = dl;
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

                            {(() => {
                                const prompt = getDisplayPrompt(job);
                                return (
                                    <p className="text-xs text-slate-400 line-clamp-2 leading-relaxed italic pr-2" title={prompt}>
                                        {prompt ? `"${prompt}"` : <span className="text-muted not-italic">no prompt</span>}
                                    </p>
                                );
                            })()}
                            <div className="mt-2 flex items-center justify-between gap-2">
                                <WorkflowChip workflowId={job.workflow_id} workflowsById={workflowsById} />
                                {(() => {
                                    const genMs = getGenerationMs(job);
                                    return job.status === 'completed' && genMs != null ? (
                                        <span className="flex items-center gap-1 text-[10px] text-muted whitespace-nowrap shrink-0" title="Time to generate">
                                            <Clock size={10} />{formatDuration(genMs)}
                                        </span>
                                    ) : null;
                                })()}
                            </div>

                            {job.status === 'processing' && (
                                <div className="mt-3">
                                    <ProgressViz
                                        progress={job.progress}
                                        currentNode={job.current_node}
                                        etaSeconds={computeEtaSeconds(job, workflowsById, state.workflow_info)}
                                        size="md"
                                    />
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
