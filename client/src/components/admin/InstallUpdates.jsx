import React, { useState, useEffect, useCallback } from 'react';
import {
    RefreshCw, AlertTriangle, CheckCircle2, GitBranch, Package,
    Download, RotateCw, Terminal, ChevronDown, ChevronUp, Info,
} from 'lucide-react';
import Card from '../ui/Card';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import { SERVER_URL } from '../../utils/api';

/**
 * Updating ComfyUI, and updating each node pack on its own.
 *
 * ★★ The design rule here came from being burned by the opposite. On
 * 2026-10-08 the portable's stable updater was run, it behaved correctly, and
 * the rig stayed on v0.39.1 — because that IS the newest release and master had
 * merely moved on untagged. Nothing said so, and a day was planned on the
 * belief that a known failure would therefore be fixed. So:
 *
 *   - the installed version is always on screen, not only after an update;
 *   - a run that changed nothing says "nothing moved" and does not ask for a
 *     restart;
 *   - before a check has been run this says the network has not been asked,
 *     rather than showing a reassuring green nothing.
 *
 * ⚠ Nothing here restarts ComfyUI. An update is not live until it does, and on
 * this fleet that is the operator's call because the machine may be mid-class.
 */
const InstallUpdates = ({ headers, onToast, mode, pollMs = 1500 }) => {
    const [data, setData] = useState(null);
    const [busy, setBusy] = useState(null);
    const [acceptStash, setAcceptStash] = useState(false);
    const [acceptDeps, setAcceptDeps] = useState(false);
    const [showAll, setShowAll] = useState(false);
    const [showOutput, setShowOutput] = useState(true);

    const load = useCallback(async () => {
        try {
            const res = await fetch(`${SERVER_URL}/admin/updates`);
            setData(await res.json());
        } catch { /* a poll failure is not worth a toast */ }
    }, []);

    useEffect(() => { load(); }, [load]);

    const run = data?.run;
    const scan = data?.scan;
    const working = run?.status === 'running' || scan?.status === 'running';
    useEffect(() => {
        if (!working) return undefined;
        const t = setInterval(load, pollMs);
        return () => clearInterval(t);
    }, [working, load, pollMs]);

    const post = async (what, body, label) => {
        setBusy(label);
        try {
            const res = await fetch(`${SERVER_URL}/admin/updates/${what}`, {
                method: 'POST', headers, body: JSON.stringify(body || {}),
            });
            const out = await res.json();
            if (!res.ok) throw new Error(out.error || `HTTP ${res.status}`);
            if (out.verdict) onToast?.(out.verdict, out.upToDate ? 'info' : 'ok');
            await load();
            return out;
        } catch (e) {
            onToast?.(e.message, 'err');
            return null;
        } finally {
            setBusy(null);
        }
    };

    if (!data?.available) return null;

    const comfy = data.comfy || {};
    const deps = data.comfyRequirements || { exists: false, risky: [] };
    const serving = mode === 'student';
    const checked = !!scan && scan.status !== 'running';
    const packs = scan?.packs || [];
    const withUpdates = packs.filter(p => (p.behind || 0) > 0);
    const clones = packs.filter(p => p.isGit);
    const copies = packs.filter(p => !p.isGit);
    const shown = showAll ? packs : withUpdates;

    const installed = comfy.version || comfy.describe || comfy.head || 'unknown';

    return (
        <Card>
            <div className="flex items-center justify-between mb-3">
                <h2 className="text-lg font-semibold flex items-center gap-2">
                    <RefreshCw size={18} /> Updates
                </h2>
                <Button variant="secondary" disabled={working || busy === 'check'}
                    onClick={() => post('check', {}, 'check')}>
                    <RotateCw size={14} className={scan?.status === 'running' ? 'animate-spin' : undefined} />
                    {scan?.status === 'running'
                        ? `Checking ${scan.done}/${scan.total}…`
                        : 'Check for updates'}
                </Button>
            </div>

            {serving && (
                <p className="text-sm text-warning flex items-start gap-2 mb-3">
                    <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                    This machine is serving students. An update changes what the next job runs
                    and only takes effect when ComfyUI restarts, so updating is refused until
                    you stop serving.
                </p>
            )}

            {/* ---------------------------------------------------------- ComfyUI */}
            <div className="rounded-lg border border-border p-3">
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <div className="font-medium flex items-center gap-2">
                            ComfyUI {installed}
                            {comfy.isGit && comfy.onNewestLocalTag && (
                                <Badge variant="default" className="!px-1.5 !py-0">
                                    on {comfy.newestLocalTag}
                                </Badge>
                            )}
                        </div>
                        <div className="text-xs text-muted mt-0.5 break-all">
                            {comfy.head ? `commit ${comfy.head}` : 'not a git checkout'}
                            {comfy.branch && comfy.branch !== 'HEAD' ? ` · branch ${comfy.branch}` : ''}
                            {comfy.newestLocalTag ? ` · newest release seen: ${comfy.newestLocalTag}` : ''}
                        </div>
                        {!comfy.present && (
                            <div className="text-xs text-danger mt-1">
                                The configured ComfyUI path does not exist — set it under
                                ComfyUI settings first.
                            </div>
                        )}
                        {comfy.present && !comfy.updaterPresent && (
                            <div className="text-xs text-warning mt-1">
                                There is no <code>update/update.py</code> beside this install, so this
                                is not the portable layout ComfyQ can update. Update it the way it
                                was installed.
                            </div>
                        )}
                    </div>
                    <div className="shrink-0">
                        <Button variant="secondary"
                            disabled={serving || working || !comfy.updaterPresent
                                || (comfy.dirty?.length > 0 && !acceptStash)}
                            title={comfy.dirty?.length > 0 && !acceptStash
                                ? "ComfyUI's own files are modified — tick the box below first."
                                : undefined}
                            onClick={() => post('comfyui', { acceptStash }, 'comfyui')}>
                            <Download size={14} /> Update ComfyUI
                        </Button>
                    </div>
                </div>

                {/* ★ What a check actually concluded, in a sentence. This is the line
                    whose absence cost a day. */}
                {scan?.comfy?.verdict && (
                    <p className={`text-xs mt-2 flex items-start gap-1.5 ${
                        scan.comfy.updateAvailable ? 'text-foreground' : 'text-muted'}`}>
                        {scan.comfy.updateAvailable
                            ? <Download size={13} className="mt-0.5 shrink-0" />
                            : <Info size={13} className="mt-0.5 shrink-0" />}
                        {scan.comfy.verdict}
                    </p>
                )}
                {!scan && (
                    <p className="text-xs text-muted mt-2">
                        Nothing has been asked of the network yet — press <em>Check for updates</em> to
                        find out whether a newer release exists. Updating without checking is
                        safe, it simply lands on the newest release, which may be this one.
                    </p>
                )}

                {/* ⚠ Tracked edits, because the vendor updater stashes them onto a
                    backup branch. Untracked files are deliberately not warned about:
                    ComfyQ itself writes two into the install. */}
                {comfy.dirty?.length > 0 && (
                    <div className="mt-2">
                        <p className="text-xs text-warning">
                            ⚠ {comfy.dirty.length} of ComfyUI's own file{comfy.dirty.length === 1 ? ' is' : 's are'}{' '}
                            modified here: {comfy.dirty.slice(0, 6).join(', ')}
                            {comfy.dirty.length > 6 ? `, +${comfy.dirty.length - 6} more` : ''}.
                            The updater stashes them onto a <code>backup_branch_&lt;date&gt;</code> before
                            it pulls, so they are recoverable but they stop being applied.
                        </p>
                        <label className="mt-1 flex items-start gap-2 text-xs text-warning">
                            <input type="checkbox" className="mt-0.5" checked={acceptStash}
                                onChange={e => setAcceptStash(e.target.checked)} />
                            <span>I accept that those edits are stashed onto a backup branch.</span>
                        </label>
                    </div>
                )}

                {/* ⚠⚠ The step that can take the rig out, with its own gate. */}
                {deps.exists && (
                    <div className="mt-3 pt-2 border-t border-border">
                        <div className="flex items-start justify-between gap-3">
                            <p className="text-xs text-muted">
                                ComfyUI's own pinned dependencies (<code>current_requirements.txt</code>,{' '}
                                {deps.lines.length} lines). ComfyUI reinstalls its frontend packages by
                                itself at boot, so this is rarely needed.
                            </p>
                            <Button variant="ghost" className="shrink-0"
                                disabled={serving || working
                                    || (deps.risky.length > 0 && !acceptDeps)}
                                onClick={() => post('comfyui-deps', { acceptRisky: acceptDeps }, 'deps')}>
                                <Terminal size={13} /> Run pip
                            </Button>
                        </div>
                        {deps.risky.length > 0 && (
                            <>
                                <p className="text-xs text-warning mt-1">
                                    ⚠ This list replaces packages the whole install shares:{' '}
                                    {deps.risky.join(', ')}. <strong>torch here is deliberately held at
                                    2.8.0+cu128</strong> because the Pixal3D and TRELLIS2 packs need it, and
                                    one <code>python_embeded</code> is shared by every lane and every rig
                                    imaged from this drive.
                                </p>
                                <label className="mt-1 flex items-start gap-2 text-xs text-warning">
                                    <input type="checkbox" className="mt-0.5" checked={acceptDeps}
                                        onChange={e => setAcceptDeps(e.target.checked)} />
                                    <span>
                                        I accept that this may replace {deps.risky.join(', ')} for every
                                        workflow on this machine.
                                    </span>
                                </label>
                            </>
                        )}
                    </div>
                )}
            </div>

            {/* ------------------------------------------------------- node packs */}
            <div className="mt-4">
                <div className="flex items-center justify-between">
                    <h3 className="text-sm font-medium flex items-center gap-2">
                        <Package size={15} /> Node packs
                    </h3>
                    {checked && (
                        <span className="text-xs text-muted">
                            {withUpdates.length === 0
                                ? `${clones.length} clone${clones.length === 1 ? '' : 's'} level with their remotes`
                                : `${withUpdates.length} with an update`}
                            {copies.length > 0 && ` · ${copies.length} cannot be updated`}
                        </span>
                    )}
                </div>

                {!checked && (
                    <p className="text-xs text-muted mt-1">
                        Which packs are behind is only known after a check — it is one network
                        request per pack, so it is never done on its own.
                    </p>
                )}

                {checked && scan.unreachable > 0 && (
                    <p className="text-xs text-warning mt-1 flex items-start gap-1.5">
                        <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                        {scan.unreachable} pack{scan.unreachable === 1 ? '' : 's'} could not be reached,
                        so whether they have updates is unknown — not "up to date". These rigs are
                        often on a LAN that cannot reach github.
                    </p>
                )}

                {checked && withUpdates.length === 0 && scan.unreachable === 0 && (
                    <p className="text-xs text-muted mt-1 flex items-start gap-1.5">
                        <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-success" />
                        Every pack that can be updated is level with its remote.
                    </p>
                )}

                {checked && (
                    <div className="mt-2 space-y-2">
                        {shown.map(p => {
                            const behind = p.behind || 0;
                            return (
                                <div key={p.name}
                                    className={`rounded-lg border p-2.5 ${behind > 0
                                        ? 'border-primary/40 bg-primary/5' : 'border-border'}`}>
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <div className="text-sm font-medium flex items-center gap-1.5">
                                                {p.isGit
                                                    ? <GitBranch size={12} className="text-success shrink-0" />
                                                    : <Package size={12} className="text-muted shrink-0" />}
                                                <span className="truncate">{p.name}</span>
                                                {behind > 0 && (
                                                    <Badge variant="warning" className="!px-1.5 !py-0">
                                                        {behind} behind
                                                    </Badge>
                                                )}
                                            </div>
                                            {p.head && (
                                                <div className="text-xs text-muted mt-0.5 truncate"
                                                    title={p.subject || ''}>
                                                    at {p.head}
                                                    {p.date ? ` (${p.date})` : ''}
                                                    {p.subject ? ` — ${p.subject}` : ''}
                                                </div>
                                            )}
                                            {/* ★ The incoming commits, so they can be read BEFORE pulling.
                                                A node pack update changes what a student's job runs. */}
                                            {p.incoming?.length > 0 && (
                                                <ul className="mt-1 text-[11px] text-muted leading-snug">
                                                    {p.incoming.map(c => (
                                                        <li key={c} className="truncate">· {c}</li>
                                                    ))}
                                                </ul>
                                            )}
                                            {p.blocked && (
                                                <div className="text-xs text-warning mt-1">{p.blocked}</div>
                                            )}
                                        </div>
                                        <div className="shrink-0">
                                            {behind > 0 && !p.blocked && (
                                                <Button variant="secondary"
                                                    disabled={serving || working || busy === p.name}
                                                    onClick={() => post('pack', { folder: p.name }, p.name)}>
                                                    <Download size={13} /> Update
                                                </Button>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}

                        <button onClick={() => setShowAll(v => !v)}
                            className="text-xs text-muted hover:text-foreground flex items-center gap-1">
                            {showAll ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                            {showAll
                                ? 'Show only what has an update'
                                : `Show all ${packs.length} packs, and why some cannot be updated`}
                        </button>
                    </div>
                )}
            </div>

            {/* ------------------------------------------------------- the last run */}
            {run && (
                <div className="mt-4 pt-3 border-t border-border">
                    <div className="flex items-center justify-between">
                        <div className="text-sm flex items-center gap-2 min-w-0">
                            {run.status === 'failed' && <AlertTriangle size={14} className="text-danger" />}
                            {run.status === 'done' && <CheckCircle2 size={14} className="text-success" />}
                            <span className="font-medium truncate">{run.label}</span>
                            <span className="text-muted">{run.step || run.status}</span>
                        </div>
                        <div className="flex gap-1 shrink-0">
                            {run.status === 'running' && (
                                <Button variant="ghost" onClick={() => post('stop', {}, 'stop')}>Stop</Button>
                            )}
                            {run.status !== 'running' && (
                                <Button variant="ghost" onClick={() => post('forget', {}, 'forget')}>Clear</Button>
                            )}
                        </div>
                    </div>

                    {/* ★ The verdict, which is the whole point: an update that moved
                        nothing says so instead of reading like one that worked. */}
                    {run.verdict && (
                        <p className={`text-xs mt-1 ${run.moved ? 'text-foreground' : 'text-muted'}`}>
                            {run.verdict}
                        </p>
                    )}
                    {run.error && <p className="text-xs text-danger mt-1">{run.error}</p>}

                    {run.needsRestart && (
                        <p className="text-xs text-warning mt-1">
                            ComfyUI has to be restarted before it runs this. Nothing restarts by
                            itself here — use <em>Restart ComfyUI</em> under the backend card when the
                            machine is free.
                        </p>
                    )}
                    {run.requirementsChanged && (
                        <p className="text-xs text-warning mt-1">
                            Its <code>requirements.txt</code> changed in this update. Read it before
                            running pip for it — one python_embeded is shared by the whole install.
                        </p>
                    )}

                    {run.output?.length > 0 && (
                        <>
                            <button onClick={() => setShowOutput(v => !v)}
                                className="mt-1 text-xs text-muted hover:text-foreground flex items-center gap-1">
                                {showOutput ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                                {run.output.length} lines of output
                            </button>
                            {showOutput && (
                                <pre className="mt-1 max-h-48 overflow-auto rounded bg-background p-2
                                    text-[11px] leading-snug text-muted whitespace-pre-wrap">
                                    {run.output.slice(-60).join('\n')}
                                </pre>
                            )}
                        </>
                    )}
                </div>
            )}
        </Card>
    );
};

export default InstallUpdates;
