import React from 'react';
import { Clock, Sparkles, X, Download } from 'lucide-react';
import Card from './ui/Card';
import Badge from './ui/Badge';
import MediaPreview from './ui/MediaPreview';
import WorkflowChip from './ui/WorkflowChip';
import ProgressViz from './ui/ProgressViz';
import { getDownloadUrl } from '../utils/api';
import { getUserColor } from '../utils/userColor';
import { getDisplayPrompt, getPrimaryDownloadFilename, getGenerationMs, formatDuration, getJobText } from '../utils/jobDisplay';
import { computeEtaSeconds } from '../utils/jobEta';

// One result card in the Scheduler grid.
//
// Memoized on purpose: the server broadcasts state on every job change, and a
// running job's progress changes several times a second. Because mergeState
// keeps the identity of jobs that did not change, this component re-renders
// only for the card whose job actually changed — not for all of them (a
// workshop day's grid holds hundreds). Keep the props primitive or stable:
// anything rebuilt on each parent render (an inline object or arrow) would
// defeat the memo.
const JobCard = React.memo(function JobCard({
    job, isMine, isSelected, workflowsById, workflowInfo, onOpen, onRequestAction,
}) {
    const isScheduled = job.status === 'scheduled';
    const isProcessing = job.status === 'processing';
    const isCompletedOrFailed = job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled';
    const hasAction = isScheduled || isProcessing || isCompletedOrFailed;
    const prompt = getDisplayPrompt(job);
    const color = getUserColor(job.user_id);
    const genMs = getGenerationMs(job);
    const imgCount = (job.outputs || []).filter(o => o.kind === 'image' && o.type !== 'temp').length;

    const requestAction = (e) => {
        e.stopPropagation();
        let title, message, kind;
        if (isProcessing) {
            title = 'Cancel running job?';
            message = isMine
                ? 'This will interrupt ComfyUI for your job. The job will be marked as cancelled.'
                : `Cancel ${job.user_id}'s running job? ComfyUI will be interrupted.`;
            kind = 'cancel';
        } else if (isScheduled) {
            title = 'Cancel scheduled job?';
            message = isMine
                ? 'Remove this scheduled job from the timeline?'
                : `Remove ${job.user_id}'s scheduled job from the timeline?`;
            kind = 'delete';
        } else {
            title = 'Delete this result?';
            message = isMine
                ? 'Delete this job record and its output file from disk? This cannot be undone.'
                : `Delete ${job.user_id}'s job record and output file from disk? This cannot be undone.`;
            kind = 'delete';
        }
        onRequestAction({ jobId: job.id, kind, isMine, title, message, userId: job.user_id });
    };

    const download = (e) => {
        e.stopPropagation();
        const dl = getPrimaryDownloadFilename(job);
        if (!dl) return;
        const link = document.createElement('a');
        link.href = getDownloadUrl(dl);
        link.download = dl;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    return (
        <Card
            className={`group relative overflow-hidden transition-all duration-300 hover:scale-[1.02] cursor-pointer ${isSelected ? 'ring-2 ring-primary border-primary/50' : 'hover:border-primary/30'}`}
            onClick={() => onOpen(job)}
        >
            {(hasAction || isMine) && (
                <div className="absolute top-0 right-0 flex items-center z-10">
                    {hasAction && (
                        <button
                            onClick={requestAction}
                            className="p-1.5 bg-danger/10 text-danger hover:bg-danger hover:text-on-primary transition-colors rounded-bl-lg border-l border-b border-danger/20"
                            title={isMine
                                ? (isProcessing ? 'Cancel running job?' : isScheduled ? 'Cancel scheduled job?' : 'Delete this result?')
                                : 'Admin password required'}
                        >
                            <X size={12} />
                        </button>
                    )}
                    {isMine && (
                        <div className="p-1 px-2 bg-primary/20 text-primary text-[8px] font-bold uppercase tracking-tighter rounded-bl-lg border-l border-b border-primary/20">
                            Yours
                        </div>
                    )}
                </div>
            )}

            <div className="flex flex-col h-full space-y-4">
                <div className="flex justify-between items-start">
                    <div className="space-y-1">
                        <div className="flex items-center space-x-2">
                            <Clock size={12} className="text-muted" />
                            <span className="text-[10px] font-mono text-muted">{new Date(job.time_slot).toLocaleTimeString()}</span>
                        </div>
                        <Badge variant={job.status === 'completed' ? 'success' : isProcessing ? 'warning' : 'primary'}>
                            {job.status}
                        </Badge>
                    </div>
                    <span className="text-[10px] text-muted font-mono">#{job.id.substring(0, 6)}</span>
                </div>

                <div className="flex-1 aspect-video bg-background rounded-lg border border-border/50 flex items-center justify-center overflow-hidden relative shadow-inner">
                    {job.status === 'completed' ? (
                        <div className="relative w-full h-full group/img">
                            <MediaPreview filename={getPrimaryDownloadFilename(job) || job.result_filename} text={getJobText(job)} />
                            {imgCount > 1 && (
                                <span className="absolute top-2 left-2 px-2 py-0.5 rounded-full bg-black/70 text-white text-[10px] font-semibold backdrop-blur-md border border-white/10 pointer-events-none">
                                    {imgCount} views
                                </span>
                            )}
                            <button
                                onClick={download}
                                className="absolute bottom-2 right-2 p-2 rounded-full bg-black/60 hover:bg-primary text-white backdrop-blur-md opacity-0 group-hover/img:opacity-100 transition-all duration-300 scale-75 group-hover/img:scale-100 shadow-lg border border-white/10"
                                title="Download Image"
                            >
                                <Download size={14} />
                            </button>
                        </div>
                    ) : (
                        <div className="flex flex-col items-center text-muted/20 w-full px-4">
                            <Sparkles size={32} className={isProcessing ? 'animate-pulse text-primary/50' : ''} />
                            <span className="text-[10px] mt-2 font-medium">
                                {isProcessing ? (job.current_node ? `Executing: ${job.current_node}` : 'Generating...') : 'Pending'}
                            </span>
                            {isProcessing && job.progress && (
                                <div className="w-full mt-4">
                                    <ProgressViz
                                        progress={job.progress}
                                        etaSeconds={computeEtaSeconds(job, workflowsById, workflowInfo)}
                                        size="sm"
                                    />
                                </div>
                            )}
                        </div>
                    )}
                    {isProcessing && !job.progress && (
                        <div className="absolute bottom-0 left-0 right-0 p-2">
                            <ProgressViz progress={null} currentNode={job.current_node} size="sm" />
                        </div>
                    )}
                </div>

                <p className="text-xs text-slate-300 line-clamp-2 italic leading-relaxed">
                    {prompt ? `"${prompt}"` : <span className="text-muted not-italic">no prompt</span>}
                </p>

                <div className="flex items-center justify-between pt-2 border-t border-border/30 gap-2">
                    <div className="flex items-center space-x-1.5 overflow-hidden" title={`User: ${job.user_id || 'anonymous'}`}>
                        <div className="w-3 h-3 rounded-full shrink-0 ring-1 ring-black/30" style={{ backgroundColor: color.dot }} />
                        <span className="text-[10px] truncate font-medium" style={{ color: color.ring }}>
                            {isMine ? 'You' : job.user_id}
                        </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                        {job.status === 'completed' && genMs != null && (
                            <span className="flex items-center gap-1 text-[10px] text-muted whitespace-nowrap" title="Time to generate">
                                <Clock size={10} />{formatDuration(genMs)}
                            </span>
                        )}
                        <WorkflowChip workflowId={job.workflow_id} workflowsById={workflowsById} />
                    </div>
                </div>
            </div>
        </Card>
    );
});

export default JobCard;
