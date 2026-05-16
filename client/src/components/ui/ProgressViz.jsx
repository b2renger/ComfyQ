import React from 'react';
import ETABadge from './ETABadge';

// ProgressViz — unified job-progress block, shared by MyJobsPanel (sidebar)
// and Scheduler's Recent Generations grid. Two visual sizes:
//   size='md' — sidebar (text-[9px], shows "Node:" label + ETA inline)
//   size='sm' — grid cell (text-[8px], no "Node:" label — caller already
//               shows the executing-node line outside this component)
//
// When `progress` is null, falls through to the indeterminate striped bar
// so callers can use one component for both phases of a processing job.
const ProgressViz = ({ progress, currentNode, etaSeconds, size = 'md' }) => {
    const isSm = size === 'sm';
    const textSize = isSm ? 'text-[8px] text-primary/70' : 'text-[9px] text-primary/80';
    const nodeText = isSm ? 'text-[8px] text-primary/50' : 'text-[9px] text-primary/60';

    if (!progress) {
        return (
            <div className="space-y-1.5">
                {currentNode && !isSm && (
                    <p className={`${nodeText} font-medium`}>Node: {currentNode}</p>
                )}
                {currentNode && isSm && (
                    <p className={`${nodeText} mb-1`}>Node: {currentNode}</p>
                )}
                <div className="w-full bg-muted/10 h-1 rounded-full overflow-hidden">
                    <div className="h-full bg-primary animate-progress-indeterminate shadow-[0_0_8px_rgba(113,113,122,0.4)]" />
                </div>
            </div>
        );
    }

    const pct = progress.max > 0 ? (progress.value / progress.max) * 100 : 0;
    return (
        <div className="space-y-1.5">
            {currentNode && !isSm && (
                <p className={`${nodeText} font-medium`}>Node: {currentNode}</p>
            )}
            <div className={`flex justify-between font-mono ${textSize}`}>
                <span>Step {progress.value} of {progress.max}</span>
                <ETABadge etaSeconds={etaSeconds} className="text-primary/60" />
                <span>{Math.round(pct)}%</span>
            </div>
            <div className="w-full bg-muted/10 h-1 rounded-full overflow-hidden">
                <div
                    className="h-full bg-primary shadow-[0_0_8px_rgba(113,113,122,0.4)] transition-all duration-300"
                    style={{ width: `${pct}%` }}
                />
            </div>
        </div>
    );
};

export default ProgressViz;
