import React, { useState } from 'react';
import { HardDrive, AlertTriangle, ChevronDown, ChevronUp, CircleAlert } from 'lucide-react';

/**
 * Whether this workflow's models are on THIS machine, and where they sit.
 *
 * The list is derived from the graph (server/workflows/vramEstimate.js), not
 * from the hand-written `requirements.models` in meta.json. What a bundle
 * actually loads is the only honest answer to "can it run here?", and the meta
 * list carries prose entries ("auto-downloaded by …") and HuggingFace repo ids
 * that no file check could ever satisfy.
 *
 * A missing model is red because it is the one condition under which the
 * workflow cannot run at all: ComfyUI refuses the prompt with a bare "value not
 * in list" that tells a student nothing about what went wrong.
 */
const ModelReadiness = ({ vram }) => {
    const [open, setOpen] = useState(false);
    if (!vram?.known) return null;

    const missing = vram.unresolved || [];
    // Missing, but behind a switch the defaults leave the other way: it runs
    // today and fails the moment someone flips that toggle. Amber, not red.
    const later = vram.unresolvedInactive || [];
    const have = vram.components || [];
    const Chevron = open ? ChevronUp : ChevronDown;

    const tone = missing.length ? 'text-danger'
        : later.length ? 'text-warning'
            : 'text-muted hover:text-foreground';
    const label = missing.length ? `${missing.length} model${missing.length > 1 ? 's' : ''} missing`
        : later.length ? `${have.length} on disk, ${later.length} missing for other settings`
            : `${have.length} model${have.length > 1 ? 's' : ''} on disk`;
    const title = missing.length
        ? `This workflow cannot run on this machine: ${missing.length} model file(s) it loads are not installed.\n${missing.join('\n')}`
        : later.length
            ? `Runs on its default settings, but ${later.length} model(s) reached through another setting are not installed:\n${later.join('\n')}`
            : `All ${have.length} model files this workflow loads are on this machine. Click to see where.`;

    return (
        <>
            <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }}
                className={`flex items-center gap-1 ${tone}`}
                title={title}
            >
                {missing.length || later.length ? <AlertTriangle size={12} /> : <HardDrive size={12} />}
                {label}
                <Chevron size={11} />
            </button>

            {open && (
                /* w-full makes this take its own line inside the chips' flex-wrap row. */
                <div
                    className="w-full mt-1 rounded-lg border border-border bg-background/60 p-2 space-y-1"
                    onClick={(e) => e.stopPropagation()}
                >
                    {missing.map(name => (
                        <div key={`m-${name}`} className="flex items-start gap-2 text-danger">
                            <AlertTriangle size={11} className="mt-0.5 flex-shrink-0" />
                            <span className="font-mono break-all">{name}</span>
                            <span className="ml-auto flex-shrink-0 pl-2">not installed</span>
                        </div>
                    ))}
                    {later.map(name => (
                        <div key={`l-${name}`} className="flex items-start gap-2 text-warning">
                            <CircleAlert size={11} className="mt-0.5 flex-shrink-0" />
                            <span className="font-mono break-all">{name}</span>
                            <span className="ml-auto flex-shrink-0 pl-2">needed by another setting</span>
                        </div>
                    ))}
                    {have.map(c => (
                        <div key={c.rel || c.name} className="flex items-start gap-2">
                            <HardDrive size={11} className="mt-0.5 flex-shrink-0 opacity-50" />
                            <span className="font-mono break-all" title={c.name}>{c.rel || c.name}</span>
                            <span className="ml-auto flex-shrink-0 pl-2 text-muted whitespace-nowrap">{c.gb} GB {c.kind}</span>
                        </div>
                    ))}
                    {!!vram.prunedGb && (
                        <p className="text-muted/70 pt-1">
                            A further {vram.prunedGb} GB is installed for settings this workflow does not use by
                            default, and is not listed or counted.
                        </p>
                    )}
                </div>
            )}
        </>
    );
};

export default ModelReadiness;
