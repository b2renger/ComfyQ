import React from 'react';
import { Wand2 } from 'lucide-react';

/**
 * Small inline chip identifying which workflow produced a given job.
 * Resolves workflow_id → display name via the SocketContext map; falls back
 * to the raw id if the workflow has been deleted from the library.
 */
const WorkflowChip = ({ workflowId, workflowsById, className = '' }) => {
    if (!workflowId) return null;
    const wf = workflowsById?.[workflowId];
    const name = wf?.name || workflowId;
    return (
        <span
            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-primary/10 border border-primary/20 text-[9px] uppercase tracking-wider text-primary max-w-[160px] ${className}`}
            title={`Workflow: ${name}${wf ? '' : ' (no longer in library)'}`}
        >
            <Wand2 size={9} className="shrink-0" />
            <span className="truncate">{name}</span>
        </span>
    );
};

export default WorkflowChip;
