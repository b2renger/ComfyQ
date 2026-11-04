import React from 'react';
import { Sparkles, ChevronRight, Eye } from 'lucide-react';
import Badge from './ui/Badge';
import PromptGuideLinks from './PromptGuideLinks';

// A workflow card as a student reads it (owner, 2026-11-04: "students just
// don't get them"). In order of what a student needs:
//   1. what it DOES, in plain words — meta `title` ("Repaint a marked area from
//      words"), large;
//   2. the full technical name, small, for anyone who knows the models;
//   3. a one- or two-sentence summary with no jargon;
//   4. the prompt guides;
//   5. the technical description, folded away under "How it works".
// Shared by the scheduling page and the booking form so the two cannot drift.
// `wf` = { name, title?, summary?, description?, category?, promptGuides?, busy? }.
const WorkflowInfoCard = ({ wf, label = 'Active workflow', className = '', compact = false, example = null, onOpenExample = null }) => {
    if (!wf) return null;
    const title = wf.title || wf.name;
    const showName = wf.name && wf.name !== title;
    return (
        <div className={`rounded-lg bg-primary/5 border border-primary/20 p-3 space-y-1.5 ${className}`}>
            <div className="flex items-center gap-2 flex-wrap">
                <Sparkles size={12} className="text-primary shrink-0" />
                <span className="text-[10px] uppercase tracking-wider text-muted font-semibold">{label}</span>
                {wf.category && wf.category !== 'other' && (
                    <Badge variant="primary" className="text-[9px] py-0 h-4 uppercase">{wf.category}</Badge>
                )}
                {wf.busy && <span className="text-[10px] text-success">generating now</span>}
            </div>
            <h3 className={`${compact ? 'text-sm' : 'text-base'} font-semibold text-foreground leading-snug`}>{title}</h3>
            {showName && <p className="text-[11px] text-muted leading-snug -mt-1">{wf.name}</p>}
            {wf.summary && <p className="text-sm text-foreground/90 leading-relaxed">{wf.summary}</p>}
            {/* The card's example: one result from the library's test suite,
                chosen to show what this workflow does best, with a caption. */}
            {example && onOpenExample && (
                <button type="button" onClick={() => onOpenExample(example)}
                    className="w-full text-left flex items-start gap-2 rounded-md border border-border bg-background/60 hover:border-primary/50 px-2.5 py-2 transition-colors">
                    <Eye size={14} className="text-primary shrink-0 mt-0.5" />
                    <span className="text-xs leading-relaxed">
                        <span className="font-semibold text-foreground">See an example</span>
                        {example.batch_label && <span className="text-muted"> — {example.batch_label}</span>}
                    </span>
                </button>
            )}
            <PromptGuideLinks guides={wf.promptGuides} />
            {wf.description && (
                <details className="group">
                    <summary className="cursor-pointer select-none list-none inline-flex items-center gap-1 text-[11px] font-semibold text-muted hover:text-foreground">
                        <ChevronRight size={12} className="transition-transform group-open:rotate-90" />
                        How it works — technical details
                    </summary>
                    <p className="mt-1.5 text-xs text-muted leading-relaxed whitespace-pre-wrap">{wf.description}</p>
                </details>
            )}
        </div>
    );
};

export default WorkflowInfoCard;
