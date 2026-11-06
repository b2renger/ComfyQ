import React, { useState } from 'react';
import { HardDrive, AlertTriangle, ChevronDown, ChevronUp, CircleAlert, ExternalLink, Download, HardDriveDownload } from 'lucide-react';
import { SERVER_URL } from '../../utils/api';
import LinkOut from '../ui/ExternalLink';

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
const ModelReadiness = ({ vram, models = [], headers = {} }) => {
    const [open, setOpen] = useState(false);
    // basename -> 'busy' | 'queued' | an error to show inline.
    const [jobs, setJobs] = useState({});
    // basename -> { folders, choice }: the downloader could not tell which
    // models/ folder the file belongs in, so the admin picks one.
    const [dirAsk, setDirAsk] = useState({});
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
        // ★ Labelled by WHERE IT LANDS, not by what it does. This is a browser
        // download: it saves to the machine running the panel -- which is
        // routinely a laptop, not the rig -- under the repo's own filename.
        // Called "download" it read as the way to install a missing model, and
        // that is exactly how a model ends up in the wrong folder under the
        // wrong name. "fetch to rig" beside it is the one that installs.
        // A gated repo answers 401 to a browser that is not signed in, so a
        // direct link would open a login wall: say so, and point at the repo
        // page where the licence is accepted.
        const gate = p.gated ? 'Gated on HuggingFace: sign in and accept the licence on the repo page first.' : null;
        const note = [gate, p.note].filter(Boolean).join('\n') || undefined;
        if (p.url) return { href: p.url, label: p.gated ? 'to my computer (login)' : 'to my computer', direct: true, note };
        if (p.source) return { href: p.source, label: 'source', direct: false, note };
        return p.note ? { href: null, label: null, note: p.note } : null;
    };
    // ★★ Fetch it onto THE RIG, not onto whoever has the panel open.
    // The server-side downloader has existed since 2026-10-05 -- resume, a
    // free-space check, a .part renamed only once the byte count matches, 29
    // tests -- and until now NOTHING in the client ever POSTed its route: the
    // only thing a missing row offered was an <a href> to HuggingFace, which
    // lands the file on the laptop. That is the exact failure the server-side
    // downloader was built to prevent, so it had no way to be used for the one
    // job it exists for.
    //
    // ★ `name` carries the DECLARED filename, not the URL's basename, and that
    // is load-bearing: a repo can publish an 80-character checkpoint name that
    // the bundle renames (the Qwen multiple-angles LoRAs), and a file saved
    // under the repo's name would still read as missing AND be invisible to a
    // `lora` dropdown's optionsFilter.
    //
    // ★ `dir` only for the case the server cannot decide: neither the link nor
    // the declared type names a models/ folder, so it answers 409 + needsDir.
    // That used to be a dead end — the error printed and nothing offered a
    // folder — so ask, from the folders this install actually has, and retry.
    const fetchToRig = async (name, dir) => {
        const p = prov.get(base(name));
        if (!p?.url) return;
        const k = base(name);
        setJobs(j => ({ ...j, [k]: 'busy' }));
        try {
            const res = await fetch(`${SERVER_URL}/admin/models/download`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...headers },
                body: JSON.stringify({ name: p.file, url: p.url, type: p.type, ...(dir ? { dir } : {}) }),
            });
            const out = await res.json();
            if (res.status === 409 && out.needsDir && !dir) {
                const fr = await fetch(`${SERVER_URL}/admin/models/folders`, { headers });
                const folders = (await fr.json().catch(() => ({})))?.folders || [];
                if (!folders.length) throw new Error(out.error || 'cannot tell which model folder this goes in');
                setDirAsk(a => ({ ...a, [k]: { folders, choice: '' } }));
                setJobs(j => { const n = { ...j }; delete n[k]; return n; });
                return;
            }
            if (!res.ok) throw new Error(out.error || `HTTP ${res.status}`);
            setDirAsk(a => { const n = { ...a }; delete n[k]; return n; });
            setJobs(j => ({ ...j, [k]: 'queued' }));
        } catch (e) {
            setJobs(j => ({ ...j, [k]: e.message }));
        }
    };

    // ★ Plain functions, called as {toRig(name)} / {where(name)} — not components.
    // Declared in this render body, <ToRig/> was a new component TYPE on every
    // render, and the admin page re-renders every 5 s (the lanes poll): React threw
    // each button away and rebuilt it, dropping keyboard focus and losing a click
    // whose press and release straddled a tick.
    const toRig = (name) => {
        const p = prov.get(base(name));
        if (!p?.url) return null;
        const st = jobs[base(name)];
        if (st === 'queued') {
            return <span className="flex-shrink-0 text-success whitespace-nowrap">fetching — see Maintenance</span>;
        }
        return (
            <button type="button"
                disabled={st === 'busy'}
                onClick={(e) => { e.stopPropagation(); fetchToRig(name); }}
                className="inline-flex items-center gap-1 text-primary hover:underline flex-shrink-0 disabled:opacity-50"
                title={'Download it onto THIS machine, into the right model folder.\n'
                    + 'Saved as ' + p.file + (p.file !== (p.url || '').split('/').pop()
                        ? ' (the repo publishes it under a different name)' : '')}>
                <HardDriveDownload size={11} />{st === 'busy' ? '…' : 'fetch to rig'}
            </button>
        );
    };

    // The folder question, under the row it belongs to.
    const askDir = (name) => {
        const k = base(name);
        const ask = dirAsk[k];
        if (!ask) return null;
        const p = prov.get(k);
        return (
            <div className="flex flex-wrap items-center gap-2 pl-4 text-foreground">
                <span>
                    Neither the link nor the declared type says which model folder {p?.file || k} goes
                    in. Pick the one ComfyUI loads it from:
                </span>
                <select value={ask.choice}
                    onChange={(e) => { const v = e.target.value; setDirAsk(a => ({ ...a, [k]: { ...a[k], choice: v } })); }}
                    className="bg-background border border-border rounded px-1.5 py-0.5 font-mono">
                    <option value="">choose a folder…</option>
                    {ask.folders.map(f => <option key={f} value={f}>models/{f}</option>)}
                </select>
                <button type="button" disabled={!ask.choice || jobs[k] === 'busy'}
                    onClick={() => fetchToRig(name, ask.choice)}
                    className="inline-flex items-center gap-1 text-primary hover:underline disabled:opacity-50">
                    <HardDriveDownload size={11} />{jobs[k] === 'busy' ? '…' : 'fetch to rig'}
                </button>
                <button type="button"
                    onClick={() => setDirAsk(a => { const n = { ...a }; delete n[k]; return n; })}
                    className="text-muted hover:text-foreground">
                    cancel
                </button>
            </div>
        );
    };

    const where = (name) => {
        const l = link(name);
        if (!l || !l.href) return null;
        return (
            <LinkOut href={l.href}
                className="inline-flex items-center gap-1 text-primary hover:underline flex-shrink-0"
                title={(l.direct
                    ? 'Downloads through your browser, onto the computer you are reading this on, '
                      + "under the repo's own filename. To install it on the rig, use “fetch to rig”."
                    : 'The page this file comes from — the exact file name inside it is not recorded.')
                    + (l.note ? `\n${l.note}` : '')}>
                {l.direct ? <Download size={11} /> : <ExternalLink size={11} />}{l.label}
            </LinkOut>
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
                        <React.Fragment key={`m-${name}`}>
                            <div className="flex items-start gap-2 text-danger">
                                <AlertTriangle size={11} className="mt-0.5 flex-shrink-0" />
                                <span className="font-mono break-all">{name}</span>
                                <span className="ml-auto flex-shrink-0 pl-2">
                                    {link(name) ? 'not installed —' : 'not installed, no known source'}
                                </span>
                                {toRig(name)}
                                {where(name)}
                            </div>
                            {askDir(name)}
                        </React.Fragment>
                    ))}
                    {missing.concat(later).map(name => base(name)).filter(k => jobs[k] && jobs[k] !== 'busy' && jobs[k] !== 'queued').map(k => (
                        <p key={`e-${k}`} className="text-danger pl-4">{k}: {jobs[k]}</p>
                    ))}
                    {later.map(name => (
                        <React.Fragment key={`l-${name}`}>
                            <div className="flex items-start gap-2 text-warning">
                                <CircleAlert size={11} className="mt-0.5 flex-shrink-0" />
                                <span className="font-mono break-all">{name}</span>
                                <span className="ml-auto flex-shrink-0 pl-2">needed by another setting</span>
                                {toRig(name)}
                                {where(name)}
                            </div>
                            {askDir(name)}
                        </React.Fragment>
                    ))}
                    {have.map(c => (
                        <div key={c.rel || c.name} className="flex items-start gap-2">
                            <HardDrive size={11} className="mt-0.5 flex-shrink-0 opacity-50" />
                            <span className="font-mono break-all" title={c.name}>{c.rel || c.name}</span>
                            <span className="ml-auto flex-shrink-0 pl-2 text-muted whitespace-nowrap">{c.gb} GB {c.kind}</span>
                            {where(c.name)}
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
                                <LinkOut href={m.source}
                                    className="inline-flex items-center gap-1 text-primary hover:underline flex-shrink-0"
                                    title={m.note || 'Where this comes from.'}>
                                    <ExternalLink size={11} />source
                                </LinkOut>
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
