import React, { useState } from 'react';
import { HardDrive, AlertTriangle, ChevronDown, ChevronUp, CircleAlert, ExternalLink, Download } from 'lucide-react';

/**
 * Whether this workflow's models are on THIS machine, where they sit, and where
 * a missing one comes from.
 *
 * ★ Two different sources, deliberately. Whether a model is PRESENT is derived
 * from the graph (server/workflows/vramEstimate.js), because what a bundle
 * actually loads is the only honest answer to "can it run here?" — the
 * hand-written `requirements.models` carries prose entries ("auto-downloaded
 * by …") and HuggingFace repo ids that no file check could satisfy. Where a
 * model COMES FROM is the meta's job, filled by tools/model-provenance from the
 * download links the workflows' own notes already carried. The two are joined
 * here by filename.
 *
 * A missing model is red because it is the one condition under which the
 * workflow cannot run at all: ComfyUI refuses the prompt with a bare "value not
 * in list" that tells a student nothing about what went wrong.
 */
const ModelReadiness = ({ vram, models = [] }) => {
    const [open, setOpen] = useState(false);
    if (!vram?.known) return null;

    // filename -> provenance. The meta may spell a name with a subfolder the way
    // ComfyUI reports it on Windows, so both sides reduce to a basename.
    const base = (v) => String(v || '').split('\\').join('/').split('/').pop();
    const prov = new Map();
    for (const m of models) if (m?.file) prov.set(base(m.file), m);

    // Where to get a file, preferring something actually fetchable.
    const link = (name) => {
        const p = prov.get(base(name));
        if (!p) return null;
        if (p.url) return { href: p.url, label: 'download', direct: true, note: p.note };
        if (p.source) return { href: p.source, label: 'source', direct: false, note: p.note };
        return p.note ? { href: null, label: null, note: p.note } : null;
    };
    const Where = ({ name }) => {
        const l = link(name);
        if (!l || !l.href) return null;
        return (
            <a href={l.href} target="_blank" rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-1 text-primary hover:underline flex-shrink-0"
                title={(l.direct
                    ? 'Direct download link for this file.'
                    : 'The page this file comes from — the exact file name inside it is not recorded.')
                    + (l.note ? `\n${l.note}` : '')}>
                {l.direct ? <Download size={11} /> : <ExternalLink size={11} />}{l.label}
            </a>
        );
    };

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
                            <span className="ml-auto flex-shrink-0 pl-2">
                                {link(name) ? 'not installed —' : 'not installed, no known source'}
                            </span>
                            <Where name={name} />
                        </div>
                    ))}
                    {later.map(name => (
                        <div key={`l-${name}`} className="flex items-start gap-2 text-warning">
                            <CircleAlert size={11} className="mt-0.5 flex-shrink-0" />
                            <span className="font-mono break-all">{name}</span>
                            <span className="ml-auto flex-shrink-0 pl-2">needed by another setting</span>
                            <Where name={name} />
                        </div>
                    ))}
                    {have.map(c => (
                        <div key={c.rel || c.name} className="flex items-start gap-2">
                            <HardDrive size={11} className="mt-0.5 flex-shrink-0 opacity-50" />
                            <span className="font-mono break-all" title={c.name}>{c.rel || c.name}</span>
                            <span className="ml-auto flex-shrink-0 pl-2 text-muted whitespace-nowrap">{c.gb} GB {c.kind}</span>
                            <Where name={c.name} />
                        </div>
                    ))}
                    {/* Declared in the meta but fetched by a node pack rather than
                        living under models/, so the disk check above can neither
                        find them nor sensibly call them missing. */}
                    {models.filter(m => m.auto).map(m => (
                        <div key={`a-${m.file}`} className="flex items-start gap-2 text-muted">
                            <Download size={11} className="mt-0.5 flex-shrink-0 opacity-50" />
                            <span className="font-mono break-all" title={m.note || ''}>{m.file}</span>
                            <span className="ml-auto flex-shrink-0 pl-2 whitespace-nowrap">fetched automatically</span>
                            {m.source && (
                                <a href={m.source} target="_blank" rel="noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                    className="inline-flex items-center gap-1 text-primary hover:underline flex-shrink-0"
                                    title={m.note || 'Where this comes from.'}>
                                    <ExternalLink size={11} />source
                                </a>
                            )}
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
