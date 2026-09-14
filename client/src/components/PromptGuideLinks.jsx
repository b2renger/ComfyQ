import React from 'react';
import { BookOpen, ExternalLink } from 'lucide-react';

// Official prompting guides for the active workflow's model family (meta
// `promptGuides: [{ label, url, tip? }]`). Shown up front — on the Timeline's
// active-workflow card and at the top of the booking dialog — because LTX,
// MiniMax and Ideogram in particular reward prompts written the way their
// makers recommend. `compact` renders links only (admin library cards).
const PromptGuideLinks = ({ guides, compact = false }) => {
    const list = (guides || []).filter(g => g && g.url);
    if (list.length === 0) return null;

    const links = (
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {list.map(g => (
                <a
                    key={g.url}
                    href={g.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={e => e.stopPropagation()}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-primary underline underline-offset-2 hover:opacity-80"
                >
                    {g.label || 'Prompt guide'}
                    <ExternalLink size={11} className="shrink-0" />
                </a>
            ))}
        </span>
    );

    if (compact) {
        return (
            <div className="flex items-center gap-1.5 mt-1">
                <BookOpen size={12} className="text-primary shrink-0" />
                {links}
            </div>
        );
    }

    const tips = list.map(g => g.tip).filter(Boolean);
    return (
        <div className="rounded-md border border-primary/25 bg-background/60 px-2.5 py-2 space-y-1">
            <div className="flex items-start gap-2 flex-wrap">
                <span className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-bold text-foreground shrink-0 pt-0.5">
                    <BookOpen size={12} className="text-primary" />
                    Prompt guide
                </span>
                {links}
            </div>
            {tips.map((t, i) => (
                <p key={i} className="text-xs text-muted leading-relaxed">{t}</p>
            ))}
        </div>
    );
};

export default PromptGuideLinks;
