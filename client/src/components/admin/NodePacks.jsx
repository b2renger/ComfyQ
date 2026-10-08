import React, { useState, useEffect, useCallback } from 'react';
import {
    Package, AlertTriangle, CheckCircle2, Download, GitBranch, RotateCw,
    HelpCircle, ChevronDown, ChevronUp, Terminal,
} from 'lucide-react';
import Card from '../ui/Card';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import { SERVER_URL } from '../../utils/api';

/**
 * The node packs this machine has, and the ones a bundle needs and cannot find.
 *
 * ★ This is the quietest way a bundle can be unrunnable. A missing MODEL at
 * least names itself in ComfyUI's refusal; a missing PACK means the class_type
 * does not exist, so the prompt is rejected wholesale and nothing points at the
 * pack that was wanted. On this rig the answer is zero — the case this serves is
 * a fresh machine, or a rig imaged before a pack was added.
 *
 * Installing is a git clone into custom_nodes, from ComfyQ's own backend rather
 * than through ComfyUI-Manager. ⚠ pip is a separate click on purpose: one
 * python_embeded is shared by every lane and every rig imaged from this drive,
 * and a pack's requirements can quietly replace a package the rest depends on.
 */
const NodePacks = ({ headers, onToast, pollMs = 2000 }) => {
    const [data, setData] = useState(null);
    const [busy, setBusy] = useState(null);
    const [showInstalled, setShowInstalled] = useState(false);
    const [manual, setManual] = useState('');
    // Per-pack acknowledgement of a risky requirements.txt. Deliberately NOT
    // derived from the requirements themselves — deriving it is what made the
    // server's guard decorative, since it was then true in exactly the case the
    // guard exists for.
    const [accepted, setAccepted] = useState({});

    const load = useCallback(async () => {
        try {
            const res = await fetch(`${SERVER_URL}/admin/nodepacks`);
            setData(await res.json());
        } catch { /* a poll failure is not worth a toast */ }
    }, []);

    useEffect(() => { load(); }, [load]);

    const jobs = data?.jobs || [];
    const working = jobs.some(j => ['cloning', 'pip'].includes(j.status));
    useEffect(() => {
        if (!working) return undefined;
        const t = setInterval(load, pollMs);
        return () => clearInterval(t);
    }, [working, load, pollMs]);

    const post = async (what, body, label) => {
        setBusy(label);
        try {
            const res = await fetch(`${SERVER_URL}/admin/nodepacks/${what}`, {
                method: 'POST', headers, body: JSON.stringify(body),
            });
            const out = await res.json();
            if (!res.ok) throw new Error(out.error || `HTTP ${res.status}`);
            await load();
            return out;
        } catch (e) {
            onToast?.(e.message, 'err');
            return null;
        } finally {
            setBusy(null);
        }
    };

    if (!data) return null;

    const missing = data.packs || [];
    const unknown = data.unknownClasses || [];
    const installed = data.installed || [];
    const gaps = Object.keys(data.missingByBundle || {}).length;

    return (
        <Card>
            <div className="flex items-center justify-between mb-3">
                <h2 className="text-lg font-semibold flex items-center gap-2">
                    <Package size={18} /> Node packs
                </h2>
                <Button variant="ghost" onClick={load}><RotateCw size={14} /> Refresh</Button>
            </div>

            {/* What the answer rests on. An unknown class list must not read as "all good". */}
            {!data.known ? (
                <p className="text-sm text-warning flex items-start gap-2">
                    <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                    Whether a pack is missing cannot be told right now — ComfyUI is not
                    answering and there is no cached node list. Run <em>Rebuild the model
                    audit</em> under Maintenance with ComfyUI up, or start the backend.
                </p>
            ) : gaps === 0 ? (
                <p className="text-sm text-muted flex items-start gap-2">
                    <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-success" />
                    Every node every one of the {data.bundlesChecked} bundles needs is
                    installed here.{' '}
                    {data.source === 'cache' && (
                        <span className="text-warning">
                            Read from the audit's cached node list, not from a running ComfyUI.
                        </span>
                    )}
                </p>
            ) : (
                <p className="text-sm text-danger flex items-start gap-2">
                    <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                    {gaps} bundle{gaps === 1 ? '' : 's'} ask{gaps === 1 ? 's' : ''} for a node
                    this ComfyUI does not have. Those bundles are rejected at submit — the
                    student sees a failure that names no pack.
                </p>
            )}

            {/* Packs to install */}
            {missing.length > 0 && (
                <div className="mt-4 space-y-2">
                    {missing.map(p => {
                        const job = jobs.find(j => j.folder === p.folder);
                        return (
                            <div key={p.url} className="rounded-lg border border-danger/30 bg-danger/5 p-3">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <div className="font-medium">{p.title}</div>
                                        <div className="text-xs text-muted mt-0.5 break-all">{p.url}</div>
                                        <div className="text-xs text-muted mt-1">
                                            provides {p.classes.join(', ')}
                                        </div>
                                        <div className="text-xs text-muted">
                                            needed by {p.bundles.join(', ')}
                                        </div>
                                        {p.installed && (
                                            <div className="text-xs text-warning mt-1">
                                                custom_nodes/{p.folder} already exists, yet the class is
                                                absent — it failed to import rather than being missing.
                                                Cloning again will not fix that; check ComfyUI's log.
                                            </div>
                                        )}
                                    </div>
                                    <div className="shrink-0">
                                        {job ? (
                                            <span className="text-xs whitespace-nowrap">{job.status}</span>
                                        ) : (
                                            <Button variant="secondary" disabled={p.installed || busy === p.url}
                                                onClick={() => post('install', { url: p.url }, p.url)}>
                                                <Download size={14} /> Install
                                            </Button>
                                        )}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {unknown.length > 0 && (
                <div className="mt-3 text-xs text-muted">
                    <div className="flex items-center gap-1 font-medium text-warning">
                        <HelpCircle size={13} /> {unknown.length} class(es) no pack database knows
                    </div>
                    {unknown.map(u => (
                        <div key={u.name} className="ml-4">
                            {u.name} — wanted by {u.bundles.join(', ')}
                        </div>
                    ))}
                    <p className="ml-4 mt-1">
                        Either a pack newer than ComfyUI-Manager's map
                        {data.mapAt ? ` (${new Date(data.mapAt).toISOString().slice(0, 10)})` : ''},
                        or a node written locally. Install it by URL below.
                    </p>
                </div>
            )}

            {/* Jobs in flight, and the two things that follow a clone */}
            {jobs.length > 0 && (
                <div className="mt-4 pt-3 border-t border-border space-y-3">
                    {jobs.map(j => (
                        <div key={j.folder}>
                            <div className="flex items-center justify-between">
                                <div className="text-sm flex items-center gap-2 min-w-0">
                                    {j.status === 'failed' && <AlertTriangle size={14} className="text-danger" />}
                                    {['cloned', 'done'].includes(j.status) && <CheckCircle2 size={14} className="text-success" />}
                                    <span className="font-medium truncate">{j.folder}</span>
                                    <span className="text-muted">{j.step || j.status}</span>
                                </div>
                                <div className="flex gap-1 shrink-0">
                                    {j.status === 'cloned' && j.requirements?.exists && !j.pipRan && (
                                        // ★ The flag is sent only when someone ticked the box below.
                                        // It used to be `risky.length > 0` — true in exactly the case
                                        // the server's guard exists for, so "say so explicitly" was
                                        // satisfied by the client on the user's behalf and the
                                        // interlock could never fire. Same shape as the allowLow bug.
                                        <Button variant="secondary"
                                            disabled={busy === j.folder
                                                || (j.requirements.risky.length > 0 && !accepted[j.folder])}
                                            title={j.requirements.risky.length > 0 && !accepted[j.folder]
                                                ? 'Tick the box below first — these requirements replace packages the whole install shares.'
                                                : undefined}
                                            onClick={() => post('pip', {
                                                folder: j.folder,
                                                acceptRisky: !!accepted[j.folder],
                                            }, j.folder)}>
                                            <Terminal size={13} /> Run pip
                                        </Button>
                                    )}
                                    {!['cloning', 'pip'].includes(j.status) && (
                                        <Button variant="ghost"
                                            onClick={() => post('forget', { folder: j.folder }, j.folder)}>
                                            Clear
                                        </Button>
                                    )}
                                </div>
                            </div>
                            {j.error && <p className="text-xs text-danger">{j.error}</p>}
                            {j.requirements?.risky?.length > 0 && !j.pipRan && (
                                <>
                                    <p className="text-xs text-warning mt-1">
                                        ⚠ Its requirements replace packages the whole install shares:{' '}
                                        {j.requirements.risky.join(', ')}. A pack that pulled the CPU
                                        onnxruntime wheel once cost this rig 12× on pose detection, with no
                                        error anywhere. Many packs run fine without pip — try the pack first.
                                    </p>
                                    <label className="mt-1 flex items-start gap-2 text-xs text-warning">
                                        <input type="checkbox" className="mt-0.5"
                                            checked={!!accepted[j.folder]}
                                            onChange={e => setAccepted(a => ({ ...a, [j.folder]: e.target.checked }))} />
                                        <span>
                                            I accept that this replaces {j.requirements.risky.join(', ')} for
                                            every workflow on this machine, and that this drive is cloned to
                                            other rigs.
                                        </span>
                                    </label>
                                </>
                            )}
                            {j.needsRestart && (
                                <p className="text-xs text-muted mt-1">
                                    ComfyUI has to be restarted before it loads this. Nothing restarts by
                                    itself here — do it when the machine is free.
                                </p>
                            )}
                            {j.output?.length > 0 && (
                                <pre className="mt-1 max-h-40 overflow-auto rounded bg-background p-2
                                    text-[11px] leading-snug text-muted whitespace-pre-wrap">
                                    {j.output.slice(-40).join('\n')}
                                </pre>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {/* Install something by hand */}
            <div className="mt-4 pt-3 border-t border-border">
                <label className="text-xs text-muted">Install a pack by URL</label>
                <div className="flex gap-2 mt-1">
                    <input value={manual} onChange={e => setManual(e.target.value)}
                        placeholder="https://github.com/author/ComfyUI-Something"
                        className="flex-1 rounded bg-background border border-border px-2 py-1.5 text-sm" />
                    <Button variant="secondary" disabled={!manual.trim() || busy === 'manual'}
                        onClick={async () => {
                            const out = await post('install', { url: manual.trim() }, 'manual');
                            if (out?.ok) setManual('');
                        }}>
                        <Download size={14} /> Clone
                    </Button>
                </div>
                <p className="text-[11px] text-muted mt-1">
                    A plain https repo on github, gitlab or codeberg. It clones into
                    <code> custom_nodes</code> — the supported extension point, which is why
                    ComfyUI's own files are never touched.
                </p>
            </div>

            {/* What is here already */}
            <button onClick={() => setShowInstalled(v => !v)}
                className="mt-3 text-xs text-muted hover:text-foreground flex items-center gap-1">
                {showInstalled ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                {installed.length} installed · {installed.filter(p => p.isGit).length} can be updated
            </button>
            {showInstalled && (
                <div className="mt-2 grid gap-1 sm:grid-cols-2">
                    {installed.map(p => (
                        <div key={p.name} className="text-xs flex items-center gap-1.5 min-w-0">
                            {p.isGit
                                ? <GitBranch size={11} className="text-success shrink-0" />
                                : <Package size={11} className="text-muted shrink-0" />}
                            <span className="truncate" title={p.remote || 'no git remote — installed as a copy'}>
                                {p.name}
                            </span>
                            {p.requirements?.length > 0 && (
                                <Badge variant="warning" className="!px-1.5 !py-0">shared deps</Badge>
                            )}
                        </div>
                    ))}
                    <p className="text-[11px] text-muted sm:col-span-2 mt-1">
                        A pack with no branch icon arrived as a copy (ComfyUI-Manager unpacks rather
                        than clones), so there is no remote to pull from — reinstalling it by URL is
                        what makes it updatable.
                        {' '}★ <strong>To actually update one, use the Updates card under
                        Maintenance</strong> — this card only answers whether your bundles have the
                        nodes they need.
                    </p>
                </div>
            )}
        </Card>
    );
};

export default NodePacks;
