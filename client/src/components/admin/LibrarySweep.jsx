import React, { useState, useEffect, useCallback } from 'react';
import {
    ListChecks, Play, Square, AlertTriangle, CheckCircle2, Eye, ChevronDown, ChevronUp, Clock, Database,
    ClipboardCopy, Download, FolderOpen, Trash2,
} from 'lucide-react';
import Card from '../ui/Card';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import { SERVER_URL } from '../../utils/api';
import { copyToClipboard } from '../../utils/clipboard';

/**
 * Run every workflow once, and say what actually came out.
 *
 * ★ Two questions nothing else here can answer. Does each bundle still work —
 * which only a real run and a look at the output can settle, since this rig has
 * twice shipped a bundle that reported success and saved BLACK images. And which
 * model files does the library actually open — the one signal in the prune tool
 * that is an observation rather than an inference.
 *
 * So the results are deliberately not a row of green ticks: every output is
 * measured (size, luminance, spread, frame count) and anything black, flat, empty
 * or single-framed is named for a human to open. A bundle that "succeeded" with
 * no output at all is called out too.
 */
const LibrarySweep = ({ headers, onToast, mode, pollMs = 4000 }) => {
    const [data, setData] = useState(null);
    const [busy, setBusy] = useState(false);
    const [open, setOpen] = useState(false);
    const [confirming, setConfirming] = useState(false);
    const [confirmClear, setConfirmClear] = useState(false);
    const [copying, setCopying] = useState(false);
    // One row open at a time: a result preview is a full-size image, and sixty of
    // them at once is how the results grid used to crawl.
    const [inspecting, setInspecting] = useState(null);

    const load = useCallback(async () => {
        try {
            const res = await fetch(`${SERVER_URL}/admin/library-sweep`);
            setData(await res.json());
        } catch { /* a poll failure is not worth a toast */ }
    }, []);

    useEffect(() => { load(); }, [load]);
    const running = data?.run?.state === 'running' || data?.run?.state === 'stopping';
    useEffect(() => {
        if (!running) return undefined;
        const t = setInterval(load, pollMs);
        return () => clearInterval(t);
    }, [running, load, pollMs]);
    useEffect(() => { if (running) setOpen(true); }, [running]);

    const post = async (what, body = {}) => {
        setBusy(true);
        setConfirming(false);
        try {
            const res = await fetch(`${SERVER_URL}/admin/library-sweep/${what}`, {
                method: 'POST', headers, body: JSON.stringify(body),
            });
            const out = await res.json();
            if (!res.ok) throw new Error(out.error || `HTTP ${res.status}`);
            if (out.note) onToast?.(out.note);
            if (what === clear) { setConfirmClear(false); setOpen(false); setInspecting(null); onToast?.(`Cleared ${out.removed ?? 0} report file(s)`); }
            await load();
        } catch (e) {
            onToast?.(e.message, 'err');
        } finally { setBusy(false); }
    };

    // ★ Fetched from the server, not assembled here: the text carries the machine
    // context and the cross-reference against the prune list, neither of which the
    // browser has. copyToClipboard because navigator.clipboard is undefined on
    // plain HTTP off localhost, which is how every rig but this one is reached.
    const copyReport = async () => {
        setCopying(true);
        try {
            const res = await fetch(`${SERVER_URL}/admin/library-sweep/report.txt`);
            const text = await res.text();
            if (!res.ok) throw new Error(text || `HTTP ${res.status}`);
            const copied = await copyToClipboard(text);
            onToast?.(
                copied
                    ? `Report copied — ${text.split('\n').length} lines, paste it straight back`
                    : 'Could not reach the clipboard — use the .txt button instead',
                copied ? 'ok' : 'err');
        } catch (e) {
            onToast?.(`Could not build the report: ${e.message}`, 'err');
        } finally { setCopying(false); }
    };

    if (!data || data.available === false) return null;

    // A finished run in memory, else the last one off disk — so the results
    // survive a server restart, which a two-hour run makes likely.
    const run = data.run || data.last || null;
    const results = run?.results || [];
    const s = run?.summary || null;
    const serving = mode === 'student';
    // Which bundles the last sweep never reached, so a run that was cut short can
    // be finished rather than restarted.
    const covered = new Set(results.map(r => r.id));
    const remaining = (data.bundles || []).filter(id => !covered.has(id));
    const mins = (sec) => (sec == null ? '—' : sec >= 90 ? `${Math.round(sec / 60)} min` : `${sec}s`);

    return (
        <Card>
            <div className="flex items-start justify-between gap-3 mb-3">
                <div>
                    <h2 className="text-lg font-semibold flex items-center gap-2">
                        <ListChecks size={18} /> Run the whole library
                    </h2>
                    <p className="text-sm text-muted mt-1 max-w-3xl">
                        Runs every workflow once with sample inputs, then measures what each one
                        produced. It answers two things nothing else does: <strong>does each bundle
                        still work</strong>, and <strong>which model files the library actually
                        opens</strong> — which is what lets pruning rest on observation instead of
                        inference. About <strong>2 hours</strong> for the whole library on this card.
                    </p>
                </div>
                <div className="shrink-0 flex gap-2">
                    {/* ★ The report is the deliverable, so offer it wherever a run exists —
                        including the last one off disk, since a two-hour run is usually read
                        after a restart. Copy rather than download is the common case: it is
                        meant to be pasted into a chat. */}
                    {(results.length > 0) && (
                        <>
                            <Button variant="ghost" onClick={copyReport} disabled={copying}>
                                <ClipboardCopy size={14} /> {copying ? 'Copying…' : 'Copy report'}
                            </Button>
                            <a href={`${SERVER_URL}/admin/library-sweep/report.txt?download=1`}
                                className="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg
                                    bg-transparent hover:bg-white/5 text-muted hover:text-foreground"
                                title="Save the report as a .txt file">
                                <Download size={14} /> .txt
                            </a>
                            {/* ★ A partial or recovered report reads like a verdict on the
                                library while covering half of it, so being able to throw it
                                away is part of trusting the next one. It never removes the
                                bench_* outputs — those are evidence. */}
                            {!running && (confirmClear ? (
                                <>
                                    <Button variant="danger" disabled={busy} onClick={() => post('clear')}>
                                        Discard these results
                                    </Button>
                                    <Button variant="ghost" onClick={() => setConfirmClear(false)}>Cancel</Button>
                                </>
                            ) : (
                                <Button variant="ghost" onClick={() => setConfirmClear(true)}
                                    title="Forget these results. The output files it produced are left alone.">
                                    <Trash2 size={14} /> Clear
                                </Button>
                            ))}
                        </>
                    )}
                    {running ? (
                        <Button variant="ghost" className="text-danger" onClick={() => post('stop')} disabled={busy}>
                            <Square size={14} /> Stop
                        </Button>
                    ) : confirming ? (
                        <>
                            <Button variant="danger" onClick={() => post('run')} disabled={busy}>Start the sweep</Button>
                            <Button variant="ghost" onClick={() => setConfirming(false)}>Cancel</Button>
                        </>
                    ) : (
                        <>
                            {/* ★ A sweep is two hours long and ComfyQ restarts on any server
                                edit under nodemon, so an interrupted run is the normal case,
                                not the exception — the first real sweep here stopped at 32 of
                                61 that way. Offer the remainder rather than making someone
                                re-run what already passed. */}
                            {remaining.length > 0 && remaining.length < (data.bundleCount || Infinity) && (
                                <Button variant="secondary" disabled={busy || serving}
                                    onClick={() => post('run', { ids: remaining })}
                                    title={`Run only the ${remaining.length} bundle(s) the last sweep did not reach.`}>
                                    <Play size={14} /> Run the remaining {remaining.length}
                                </Button>
                            )}
                            <Button variant="secondary" onClick={() => setConfirming(true)} disabled={busy || serving}
                                title={serving ? 'Stop serving first — a sweep holds the GPU for about two hours.' : undefined}>
                                <Play size={14} /> Run every workflow
                            </Button>
                        </>
                    )}
                </div>
            </div>

            {serving && !running && (
                <p className="text-xs text-warning flex items-start gap-2 mb-3">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                    This machine is serving students. The sweep holds the GPU for about two hours and
                    restarts ComfyUI between workflows that need different performance flags, so it runs
                    from admin mode only — use <strong>Stop serving</strong> first.
                </p>
            )}

            {confirming && (
                <p className="text-xs text-warning mb-3">
                    This occupies the GPU for roughly two hours, recalibrates every bundle's timing and
                    VRAM figures, and writes sample outputs into ComfyUI's output folder. It can be
                    stopped between workflows. Hand-measured timings (<code>source: manual</code>) are
                    put back afterwards.
                </p>
            )}

            {/* progress */}
            {running && (
                <div className="rounded-lg border border-primary/40 bg-primary/5 p-3 mb-3">
                    <div className="flex items-center justify-between text-sm">
                        <span>
                            <strong>{run.done}</strong> of {run.total} ·{' '}
                            {run.current ? <>running <code>{run.current.id}</code></> : 'between workflows'}
                        </span>
                        <span className="text-muted flex items-center gap-1">
                            <Clock size={13} /> {run.etaSec != null ? `~${mins(run.etaSec)} left` : 'estimating…'}
                        </span>
                    </div>
                    <div className="mt-2 h-1.5 rounded-full bg-border overflow-hidden">
                        <div className="h-full bg-primary transition-all"
                            style={{ width: `${run.total ? (run.done / run.total) * 100 : 0}%` }} />
                    </div>
                </div>
            )}

            {/* summary */}
            {s && (
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 mb-3">
                    <Stat label="ran" value={`${s.succeeded} of ${s.ran}`} tone={s.failed ? 'warn' : 'ok'} />
                    <Stat label="failed" value={s.failed} tone={s.failed ? 'bad' : 'ok'} />
                    <Stat label="suspect output" value={s.withFlaggedOutput + s.noOutput}
                        tone={(s.withFlaggedOutput + s.noOutput) ? 'bad' : 'ok'} />
                    <Stat label="model files opened" value={s.distinctModelsOpened}
                        tone={s.recorderAvailable === false ? 'warn' : 'ok'} />
                </div>
            )}

            {s && s.recorderAvailable === false && (
                <p className="text-xs text-warning flex items-start gap-2 mb-3">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                    ComfyUI was not recording which models it opened when this ran, so the
                    “model files opened” column is empty and <strong>pruning cannot lean on
                    observation</strong>. The recorder installs itself the next time ComfyQ starts
                    ComfyUI — restart the backend, then sweep again.
                </p>
            )}

            {s && s.distinctModelsOpened > 0 && (
                <p className="text-xs text-muted flex items-start gap-2 mb-3">
                    <Database size={14} className="mt-0.5 shrink-0" />
                    {s.distinctModelsOpened} distinct model file(s) were opened by at least one
                    workflow. ⚠ The reverse does not hold: a file nobody opened is <em>not</em> proven
                    unused — a setting nobody exercised (Fast mode off, the second entry in a dropdown)
                    leaves no trace either. Treat this as a reason to KEEP, never as permission to delete.
                </p>
            )}

            {/* results */}
            {results.length > 0 && (
                <>
                    <button onClick={() => setOpen(v => !v)}
                        className="text-xs text-muted hover:text-foreground flex items-center gap-1">
                        {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                        {open ? 'Hide' : 'Show'} the {results.length} result(s)
                        {run.state && run.state !== 'running' ? ` · ${run.state}` : ''}
                        {run.reportPath ? ` · ${run.reportPath}` : ''}
                    </button>

                    {open && (
                        <div className="mt-2 space-y-1.5 max-h-[32rem] overflow-y-auto pr-1">
                            {/* anything wrong first — a green list nobody reads is the failure mode */}
                            {[...results]
                                .sort((a, b) => score(b) - score(a))
                                .map(r => (
                                    <div key={r.id}
                                        className={`rounded-lg border p-2.5 text-xs ${score(r) > 0
                                            ? 'border-danger/40 bg-danger/5' : 'border-border'}`}>
                                        <div className="flex items-start justify-between gap-2">
                                            <div className="min-w-0">
                                                <span className="font-medium">{r.name}</span>
                                                <span className="text-muted"> · {r.id}</span>
                                                {r.experimental && <Badge variant="warning" className="ml-1 !px-1.5 !py-0">experimental</Badge>}
                                            </div>
                                            <div className="shrink-0 flex items-center gap-2 text-muted">
                                                {r.ok
                                                    ? <CheckCircle2 size={13} className="text-success" />
                                                    : <AlertTriangle size={13} className="text-danger" />}
                                                <span>{mins(r.wallSec)}</span>
                                                {r.vramPeakGb ? <span>{r.vramPeakGb} GB</span> : null}
                                            </div>
                                        </div>

                                        {r.error && (
                                            <>
                                                <p className="text-danger mt-1">
                                                    failed: {r.error}
                                                    {r.failedNode ? <span className="text-muted"> · at node {r.failedNode}</span> : null}
                                                </p>
                                                {r.traceback && (
                                                    <details className="mt-1">
                                                        <summary className="text-[11px] text-primary cursor-pointer">traceback</summary>
                                                        <pre className="mt-1 max-h-56 overflow-auto rounded bg-background p-2 text-[10px] whitespace-pre-wrap">{r.traceback}</pre>
                                                    </details>
                                                )}
                                            </>
                                        )}

                                        {r.ok && !(r.outputs || []).length && (
                                            <p className="text-danger mt-1">
                                                reported success but produced no output file — look at this one
                                            </p>
                                        )}

                                        {(r.flagged || []).length > 0 && (
                                            <p className="text-danger mt-1">
                                                {r.flagged.map(f => `${f.file}: ${(f.flags || []).join(', ') || f.error}`).join(' · ')}
                                            </p>
                                        )}

                                        {(r.outputs || []).length > 0 && (
                                            <p className="text-muted mt-1 flex items-start gap-1">
                                                <Eye size={12} className="mt-0.5 shrink-0" />
                                                {r.outputs.map(o => (
                                                    <span key={o.file} className="mr-2">
                                                        {o.file}
                                                        {o.width ? ` ${o.width}×${o.height}` : ''}
                                                        {o.frames ? ` · ${o.frames}f` : ''}
                                                        {o.mean != null ? ` · luma ${o.mean}` : ''}
                                                    </span>
                                                ))}
                                            </p>
                                        )}

                                        {(r.observedModels || []).length > 0 && (
                                            <p className="text-muted/70 mt-1">
                                                opened {r.observedModels.length} model file(s):{' '}
                                                {r.observedModels.slice(0, 4).join(', ')}
                                                {r.observedModels.length > 4 ? ` +${r.observedModels.length - 4} more` : ''}
                                            </p>
                                        )}
                                        {r.runtimeKept && <p className="text-muted/70 mt-1">{r.runtimeKept}</p>}

                                        {/* ★ The point of the card over the text report: a human can
                                            SEE the result and read what produced it. */}
                                        <button onClick={() => setInspecting(v => v === r.id ? null : r.id)}
                                            className="mt-1.5 text-[11px] text-primary hover:underline flex items-center gap-1">
                                            <Eye size={11} />
                                            {inspecting === r.id ? 'Hide' : 'Inspect'} ingredients and result
                                        </button>
                                        {inspecting === r.id && <Inspect r={r} headers={headers} onToast={onToast} />}
                                    </div>
                                ))}
                        </div>
                    )}
                </>
            )}

            {!results.length && !running && (
                <p className="text-xs text-muted">
                    Nothing has been swept yet. Worth doing before pruning models, and after updating
                    ComfyUI or a node pack — those are the changes that break a bundle silently.
                </p>
            )}
        </Card>
    );
};

/**
 * What went in, and what came out — for a human, not for a machine.
 *
 * ★ The result is SHOWN, not described. A luma figure is a proxy; the owner asked
 * to inspect the output, and ComfyQ's own /images route already serves anything in
 * the output folder, so the actual picture or clip goes on screen. Every file also
 * carries its absolute path, because the next thing you want is to open it.
 *
 * ★ Ingredients are the EFFECTIVE values: a prompt almost always comes from the
 * graph's own literal rather than from the calibration, so each row says where its
 * value came from. Without that, "the prompt" would silently be blank.
 */
const Inspect = ({ r, headers, onToast }) => {
    const ing = r.ingredients || [];
    const outs = r.outputs || [];
    const isImg = (f) => /\.(png|jpe?g|webp|bmp)$/i.test(f || '');
    const isVid = (f) => /\.(mp4|webm|mov|mkv)$/i.test(f || '');
    const isAud = (f) => /\.(mp3|wav|flac|ogg|opus|m4a)$/i.test(f || '');

    // ★ A path is only clickable via the host: a browser will not follow file://
    // from an http page. This opens it on THE RIG's desktop, which is what you want
    // sitting at the machine and useless from a laptop — so Copy sits beside it.
    const reveal = async (p) => {
        try {
            const res = await fetch(`${SERVER_URL}/admin/reveal`, {
                method: 'POST', headers, body: JSON.stringify({ path: p }),
            });
            const out = await res.json();
            if (!res.ok) throw new Error(out.error || `HTTP ${res.status}`);
            onToast?.(`Opened on the rig — ${out.how}`);
        } catch (e) { onToast?.(e.message, 'err'); }
    };
    const PathLink = ({ p }) => (
        <span className="flex items-start gap-1.5 flex-wrap">
            <button onClick={() => reveal(p)} title="Open this file in the file browser ON THE RIG"
                className="text-primary hover:underline inline-flex items-center gap-1 shrink-0">
                <FolderOpen size={11} /> show on rig
            </button>
            <button onClick={() => copyToClipboard(p).then(ok => onToast?.(ok ? 'Path copied' : 'Could not copy', ok ? 'ok' : 'err'))}
                title="Copy the full path" className="text-muted hover:text-foreground shrink-0">
                <ClipboardCopy size={11} />
            </button>
            <code className="text-[10px] text-muted/70 break-all">{p}</code>
        </span>
    );
    return (
        <div className="mt-2 grid gap-3 lg:grid-cols-2 rounded-lg border border-border bg-background/40 p-2.5">
            <div className="min-w-0">
                <div className="text-[11px] uppercase tracking-wider text-muted mb-1.5">Ingredients</div>
                {!ing.length && (
                    <p className="text-[11px] text-muted">
                        Not recorded — this row predates ingredient capture, or was recovered from disk.
                    </p>
                )}
                <dl className="space-y-1.5">
                    {ing.map(g => (
                        <div key={g.key}>
                            <dt className="text-[11px] text-muted">
                                {g.label}
                                <span className="text-muted/60"> · {g.type} · {g.node} · {g.from}</span>
                            </dt>
                            <dd className="text-[11px] break-words">
                                {g.sourcePath ? (
                                    <>
                                        <PathLink p={g.sourcePath} />
                                        {g.staged && <div className="text-muted/60">staged as {g.staged}</div>}
                                    </>
                                ) : (g.value === null || g.value === undefined || g.value === '')
                                    ? <span className="text-muted/60">(empty)</span>
                                    : <span className="whitespace-pre-wrap">{String(g.value)}
                                        {g.truncated ? ` … (${g.truncated} chars)` : ''}</span>}
                            </dd>
                        </div>
                    ))}
                </dl>
            </div>

            <div className="min-w-0">
                <div className="text-[11px] uppercase tracking-wider text-muted mb-1.5">
                    Result{outs.length > 1 ? `s (${outs.length})` : ''}
                </div>
                {!outs.length && (
                    <p className="text-[11px] text-muted">
                        No file. {r.category === 'description'
                            ? 'This workflow answers with text, so that is expected.'
                            : 'That is worth a look — the run reported success.'}
                    </p>
                )}
                <div className="space-y-2">
                    {outs.map(o => (
                        <div key={o.file}>
                            {/* ★ A caption IS the result for a describe workflow. It arrives
                                as text through a PreviewAny node and touches no file, so
                                showing it is the only way to read what the bundle exists to
                                produce. */}
                            {o.kind === 'text' && (
                                <div className="rounded border border-border bg-background/60 p-2">
                                    <div className="text-[10px] uppercase tracking-wider text-muted mb-1">
                                        text result · {o.file} · {o.chars} characters
                                    </div>
                                    <p className="whitespace-pre-wrap text-[11px] leading-relaxed max-h-48 overflow-y-auto">
                                        {o.text}
                                    </p>
                                    <button
                                        onClick={() => copyToClipboard(o.text).then(ok => onToast?.(ok ? 'Text copied' : 'Could not copy', ok ? 'ok' : 'err'))}
                                        className="mt-1 text-[11px] text-primary hover:underline inline-flex items-center gap-1">
                                        <ClipboardCopy size={11} /> copy the text
                                    </button>
                                </div>
                            )}
                            {isImg(o.file) && (
                                <a href={`${SERVER_URL}/images/${encodeURIComponent(o.file)}`} target="_blank" rel="noreferrer">
                                    <img src={`${SERVER_URL}/images/${encodeURIComponent(o.file)}`} alt={o.file}
                                        loading="lazy"
                                        className="max-h-48 rounded border border-border bg-black/20" />
                                </a>
                            )}
                            {isVid(o.file) && (
                                <video src={`${SERVER_URL}/images/${encodeURIComponent(o.file)}`} controls muted
                                    preload="metadata" className="max-h-48 rounded border border-border" />
                            )}
                            {isAud(o.file) && (
                                <audio src={`${SERVER_URL}/images/${encodeURIComponent(o.file)}`} controls className="w-full" />
                            )}
                            <div className="text-[11px] text-muted mt-1">
                                {o.width ? `${o.width}×${o.height}` : o.kind || ''}
                                {o.frames != null ? ` · ${o.frames} frames${o.fps ? ` @ ${o.fps}fps` : ''}` : ''}
                                {o.seconds != null ? ` · ${o.seconds}s` : ''}
                                {o.mean != null ? ` · luma ${o.mean} (spread ${o.std})` : ''}
                                {o.bytes != null ? ` · ${(o.bytes / 1024 ** 2).toFixed(2)} MB` : ''}
                                {(o.flags || []).length ? <span className="text-danger"> · {o.flags.join(', ')}</span> : null}
                            </div>
                            {o.path && <PathLink p={o.path} />}
                            {o.kind !== 'text' && (
                                <a className="text-[11px] text-primary hover:underline"
                                    href={`${SERVER_URL}/images/${encodeURIComponent(o.file)}?download=1`}>
                                    download
                                </a>
                            )}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

// Sort the problems to the top: a failure, then suspect output, then no output.
function score(r) {
    if (!r.ok) return 3;
    if (!(r.outputs || []).length) return 2;
    if ((r.flagged || []).length) return 1;
    return 0;
}

const Stat = ({ label, value, tone }) => (
    <div className={`rounded-lg border p-2.5 ${tone === 'bad' ? 'border-danger/40 bg-danger/5'
        : tone === 'warn' ? 'border-warning/40 bg-warning/5' : 'border-border'}`}>
        <div className="text-lg font-semibold leading-none">{value}</div>
        <div className="text-[11px] uppercase tracking-wider text-muted mt-1">{label}</div>
    </div>
);

export default LibrarySweep;
