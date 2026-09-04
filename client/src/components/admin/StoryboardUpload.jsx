import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
    FileText, Upload, AlertTriangle, XCircle, Trash2, RefreshCw, Layers, FolderOpen, RotateCcw,
    Image as ImageIcon, Video, Music, ChevronDown, ChevronRight, ListOrdered,
    CheckCircle2, Loader2, Clock, Ban
} from 'lucide-react';
import Button from '../ui/Button';
import Badge from '../ui/Badge';
import { SERVER_URL } from '../../utils/api';

// StoryboardUpload — drop one markdown document, see exactly what it will
// queue, then queue it.
//
// Preview and queue hit the SAME parse + plan on the server, so the table below
// is not an approximation of what will run: it IS what will run. That is the
// whole reason queueing is a second, deliberate click — a storyboard is
// routinely 40+ generations and an hour of GPU time.

const PHASE_ICON = { images: ImageIcon, videos: Video, audio: Music };

function fmtDuration(sec) {
    if (!sec || sec < 0) return '—';
    if (sec < 90) return `${Math.round(sec)}s`;
    const m = Math.round(sec / 60);
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60);
    return `${h}h ${m % 60}min`;
}

function fmtTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// One shot in the expanded batch: where it is, and — while it is sampling —
// how far in. The failure reason is shown inline because that is almost always
// the thing an admin needs (a missing model, an unsupported flag), and hunting
// for it in the server log during a workshop is not realistic.
const STATUS_LOOK = {
    completed: { Icon: CheckCircle2, cls: 'text-success' },
    failed: { Icon: XCircle, cls: 'text-danger' },
    cancelled: { Icon: Ban, cls: 'text-muted' },
    scheduled: { Icon: Clock, cls: 'text-muted' }
};

const ShotRow = ({ job, index }) => {
    const look = STATUS_LOOK[job.status] || { Icon: Loader2, cls: 'text-primary animate-spin' };
    const { Icon, cls } = look;
    const pct = job.progress?.max ? Math.round((job.progress.value / job.progress.max) * 100) : null;
    const running = !STATUS_LOOK[job.status];
    return (
        <div className="text-xs">
            <div className="flex items-center gap-2 py-0.5">
                <Icon size={13} className={`shrink-0 ${cls}`} />
                <span className="text-muted tabular-nums w-6 shrink-0">{index + 1}</span>
                <span className={`truncate ${running ? 'text-foreground font-medium' : ''}`}>
                    {job.label}
                </span>
                <span className="ml-auto text-muted shrink-0">
                    {running && pct != null ? `generating ${pct}%`
                        : running ? 'generating…'
                            : job.status === 'completed' ? `generated · ${job.outputs?.length || 0} file${job.outputs?.length === 1 ? '' : 's'}`
                                : job.status === 'scheduled' ? 'pending'
                                    : job.status}
                </span>
            </div>
            {running && pct != null && (
                <div className="h-0.5 bg-background rounded-full overflow-hidden ml-7 mr-1 mb-1">
                    <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
                </div>
            )}
            {job.error_reason && (
                <p className="text-danger ml-7 mb-1 break-words">{job.error_reason}</p>
            )}
        </div>
    );
};

const StoryboardUpload = ({ adminPassword, serving, notify }) => {
    const [file, setFile] = useState(null);
    const [preview, setPreview] = useState(null);
    const [previewing, setPreviewing] = useState(false);
    const [previewError, setPreviewError] = useState(null);
    const [queueing, setQueueing] = useState(false);
    const [spacing, setSpacing] = useState('estimated');
    const [showJobs, setShowJobs] = useState(false);
    const [folder, setFolder] = useState('');
    const [batches, setBatches] = useState([]);
    const [openBatchId, setOpenBatchId] = useState(null);
    const [detail, setDetail] = useState(null);
    const [removingId, setRemovingId] = useState(null);
    const [retryingId, setRetryingId] = useState(null);
    const [isDragging, setIsDragging] = useState(false);
    const [restarting, setRestarting] = useState(false);
    const inputRef = useRef(null);

    const authHeaders = useCallback(() => (
        adminPassword ? { 'X-Admin-Password': adminPassword } : {}
    ), [adminPassword]);

    const loadDetail = useCallback(async (batchId) => {
        if (!batchId) { setDetail(null); return; }
        try {
            const res = await fetch(`${SERVER_URL}/storyboard/batches/${encodeURIComponent(batchId)}`,
                { headers: authHeaders() });
            if (!res.ok) return;
            setDetail(await res.json());
        } catch { /* server may be restarting */ }
    }, [authHeaders]);

    const loadBatches = useCallback(async () => {
        try {
            const res = await fetch(`${SERVER_URL}/storyboard/batches`, { headers: authHeaders() });
            if (!res.ok) return;                       // not serving / wrong password
            const data = await res.json();
            setBatches(data.batches || []);
        } catch { /* server may be restarting */ }
    }, [authHeaders]);

    useEffect(() => { loadBatches(); }, [loadBatches]);

    const busy = batches.some(b => (b.pending || 0) + (b.running || 0) > 0);
    // Poll unconditionally. Gating this on "is anything busy?" meant that after
    // queueing from an idle machine — which restarts the server — the first
    // fetch failed while it was down, the list stayed empty, nothing looked
    // busy, and the card never polled again: a batch that was actually running
    // showed as frozen.
    useEffect(() => {
        const t = setInterval(loadBatches, 3000);
        return () => clearInterval(t);
    }, [loadBatches]);

    // The expanded batch refreshes faster — this is the progress view, and a
    // sampler step count that updates every few seconds reads as stuck.
    useEffect(() => { loadDetail(openBatchId); }, [openBatchId, loadDetail]);
    useEffect(() => {
        if (!openBatchId) return;
        const t = setInterval(() => loadDetail(openBatchId), 1500);
        return () => clearInterval(t);
    }, [openBatchId, loadDetail]);

    // Open whichever batch is actually working, so "what is running now?" is
    // answered without anyone having to click.
    useEffect(() => {
        if (openBatchId) return;
        const live = batches.find(b => (b.running || 0) + (b.pending || 0) > 0);
        if (live) setOpenBatchId(live.batchId);
    }, [batches, openBatchId]);

    const runPreview = async (f) => {
        setPreviewing(true);
        setPreviewError(null);
        setPreview(null);
        try {
            const form = new FormData();
            form.append('file', f);
            if (folder) form.append('folder', folder);
            // No Content-Type — the browser must set the multipart boundary.
            const res = await fetch(`${SERVER_URL}/storyboard/preview`, {
                method: 'POST', headers: authHeaders(), body: form
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Could not read that storyboard');
            setPreview(data);
            if (!folder && data.outputFolder) setFolder(data.outputFolder);
        } catch (e) {
            setPreviewError(e.message);
        } finally {
            setPreviewing(false);
        }
    };

    const pickFile = (f) => {
        if (!f) return;
        if (!/\.(md|markdown|txt)$/i.test(f.name)) {
            setPreviewError('Please choose a markdown (.md) storyboard.');
            return;
        }
        setFile(f);
        setShowJobs(false);
        runPreview(f);
    };

    const clearFile = () => {
        setFile(null); setPreview(null); setPreviewError(null); setShowJobs(false);
        if (inputRef.current) inputRef.current.value = '';
    };

    const queueBatch = async () => {
        if (!file) return;
        setQueueing(true);
        try {
            const form = new FormData();
            form.append('file', file);
            form.append('spacing', spacing);
            form.append('label', file.name);
            if (folder) form.append('folder', folder);
            const res = await fetch(`${SERVER_URL}/storyboard/queue`, {
                method: 'POST', headers: authHeaders(), body: form
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Could not queue the storyboard');
            const summary = data.phases.filter(p => p.count > 0).map(p => `${p.count} ${p.label}`).join(', ');
            if (data.restarting) {
                // The server is switching to student mode to start the executor;
                // it drops the connection for a few seconds.
                setRestarting(true);
                notify(`Queued ${data.totalJobs} generations (${summary}) — starting the queue on ${data.startingWorkflowId}…`);
                setTimeout(() => { setRestarting(false); loadBatches(); }, 6000);
            } else {
                notify(`Queued ${data.totalJobs} generations — ${summary}`);
                loadBatches();
            }
            clearFile();
        } catch (e) {
            notify(e.message, 'err');
        } finally {
            setQueueing(false);
        }
    };

    // Re-run only the shots that failed, once whatever broke them is fixed on
    // the server. The completed shots keep their outputs; the failed ones keep
    // their place in the run order and their wiring.
    const retryBatch = async (batchId) => {
        setRetryingId(batchId);
        try {
            const res = await fetch(`${SERVER_URL}/storyboard/batches/${encodeURIComponent(batchId)}/retry`, {
                method: 'POST', headers: authHeaders()
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Could not retry those shots');
            if (data.retried === 0) notify('Nothing to retry — no shot in this batch has failed.');
            else notify(`Re-queued ${data.retried} shot${data.retried === 1 ? '' : 's'}` +
                (data.stillBlocked?.length
                    ? ` — ${data.stillBlocked.length} still cannot run, their input was deleted`
                    : ''), data.stillBlocked?.length ? 'err' : 'ok');
            loadBatches();
            loadDetail(batchId);
        } catch (e) {
            notify(e.message, 'err');
        } finally {
            setRetryingId(null);
        }
    };

    const removeBatch = async (batchId) => {
        setRemovingId(batchId);
        try {
            const res = await fetch(`${SERVER_URL}/storyboard/batches/${encodeURIComponent(batchId)}`, {
                method: 'DELETE', headers: authHeaders()
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Could not stop that batch');
            notify(`Stopped ${data.cancelled} job(s), removed ${data.removed}`);
            loadBatches();
        } catch (e) {
            notify(e.message, 'err');
        } finally {
            setRemovingId(null);
        }
    };

    const onDrag = (e) => {
        e.preventDefault(); e.stopPropagation();
        if (e.type === 'dragenter' || e.type === 'dragover') setIsDragging(true);
        else if (e.type === 'dragleave') setIsDragging(false);
    };
    const onDrop = (e) => {
        e.preventDefault(); e.stopPropagation();
        setIsDragging(false);
        pickFile(e.dataTransfer.files?.[0]);
    };

    const errors = preview?.errors || [];
    const warnings = preview?.warnings || [];
    const canQueue = preview && preview.totalJobs > 0 && errors.length === 0;

    return (
        <div className="space-y-4">
            {/* ---- drop zone ---- */}
            {!file && (
                <div
                    onDragEnter={onDrag} onDragLeave={onDrag} onDragOver={onDrag} onDrop={onDrop}
                    className={`relative border-2 border-dashed rounded-xl p-6 text-center transition-colors cursor-pointer
                        ${isDragging ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/50'}`}
                >
                    <input
                        ref={inputRef} type="file" accept=".md,.markdown,text/markdown"
                        onChange={(e) => pickFile(e.target.files?.[0])}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    />
                    <FileText size={28} className="mx-auto mb-2 text-muted" />
                    <p className="text-sm font-medium">Drop a storyboard .md file, or click to choose one</p>
                    <p className="text-xs text-muted mt-1">
                        Every shot it describes is queued: images first, then the videos that use them, then audio.
                    </p>
                </div>
            )}

            {/* ---- the chosen file ---- */}
            {file && (
                <div className="flex items-center gap-2 text-sm">
                    <FileText size={16} className="text-muted shrink-0" />
                    <span className="font-medium truncate">{file.name}</span>
                    <span className="text-xs text-muted">({Math.round(file.size / 1024)} KB)</span>
                    <div className="ml-auto flex items-center gap-2">
                        <Button variant="ghost" size="sm" icon={RefreshCw}
                            onClick={() => runPreview(file)} isLoading={previewing}>Re-read</Button>
                        <Button variant="ghost" size="sm" icon={XCircle} onClick={clearFile}>Remove</Button>
                    </div>
                </div>
            )}

            {previewing && <p className="text-sm text-muted">Reading the storyboard…</p>}

            {previewError && (
                <div className="p-3 rounded-lg border border-danger/20 bg-danger/10 text-danger text-sm flex gap-2">
                    <XCircle size={16} className="shrink-0 mt-0.5" />
                    <span className="whitespace-pre-wrap">{previewError}</span>
                </div>
            )}

            {/* ---- the plan ---- */}
            {preview && (
                <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={canQueue ? 'success' : 'default'}>
                            {preview.totalJobs} generation{preview.totalJobs === 1 ? '' : 's'}
                        </Badge>
                        {preview.phases.filter(p => p.count > 0).map(p => {
                            const Icon = PHASE_ICON[p.label] || ListOrdered;
                            return (
                                <span key={p.label}
                                    className="inline-flex items-center gap-1.5 text-xs text-muted border border-border rounded-full px-2.5 py-0.5">
                                    <Icon size={12} /> {p.count} {p.label}
                                </span>
                            );
                        })}
                        <span className="text-xs text-muted">
                            ≈ {fmtDuration(preview.totalEstimatedSec)} of GPU time
                        </span>
                    </div>

                    {preview.workflowRuns?.length > 0 && (
                        <div className="text-xs text-muted">
                            <p className="flex items-center gap-1.5 mb-1">
                                <Layers size={12} />
                                Grouped into {preview.modelLoads} model load{preview.modelLoads === 1 ? '' : 's'},
                                in this order:
                            </p>
                            <div className="flex flex-wrap gap-1.5">
                                {preview.workflowRuns.map((r, i) => (
                                    <span key={i}
                                        className="inline-flex items-center gap-1 border border-border rounded px-1.5 py-0.5">
                                        <span className="text-foreground tabular-nums">{r.count}×</span> {r.workflowId}
                                    </span>
                                ))}
                            </div>
                            <p className="mt-1">
                                Each load costs a minute or two on top of the estimate above, so the shots
                                are ordered to load every model once rather than once per shot.
                            </p>
                        </div>
                    )}

                    {errors.length > 0 && (
                        <div className="p-3 rounded-lg border border-danger/20 bg-danger/10 text-sm">
                            <p className="flex items-center gap-2 font-medium text-danger mb-1">
                                <XCircle size={16} /> {preview.summary || `${errors.length} shots cannot be queued`}
                            </p>
                            <ul className="list-disc pl-5 space-y-0.5 text-danger/90 max-h-48 overflow-y-auto">
                                {errors.map((e, i) => <li key={i}>{e}</li>)}
                            </ul>
                            {preview.blockedReasons?.length > 0 && (
                                <details className="mt-2">
                                    <summary className="cursor-pointer text-xs text-danger/80">
                                        {preview.blockedReasons.length} more shot
                                        {preview.blockedReasons.length === 1 ? '' : 's'} only wait on those — fix the
                                        list above first
                                    </summary>
                                    <ul className="list-disc pl-5 mt-1 space-y-0.5 text-danger/70 max-h-32 overflow-y-auto">
                                        {preview.blockedReasons.map((e, i) => <li key={i}>{e}</li>)}
                                    </ul>
                                </details>
                            )}
                            <p className="text-xs text-danger/80 mt-2">
                                Nothing is queued. A shot with a missing input would render the workflow's own
                                leftover test picture and report success, so the whole document is refused.
                            </p>
                        </div>
                    )}

                    {warnings.length > 0 && (
                        <div className="p-3 rounded-lg border border-warning/20 bg-warning/10 text-sm">
                            <p className="flex items-center gap-2 font-medium text-warning mb-1">
                                <AlertTriangle size={16} /> {warnings.length} thing{warnings.length === 1 ? '' : 's'} to check
                            </p>
                            <ul className="list-disc pl-5 space-y-0.5 text-warning/90 max-h-40 overflow-y-auto">
                                {warnings.map((w, i) => <li key={i}>{w}</li>)}
                            </ul>
                        </div>
                    )}

                    {preview.totalJobs > 0 && (
                        <>
                            <button type="button" onClick={() => setShowJobs(v => !v)}
                                className="flex items-center gap-1.5 text-xs text-muted hover:text-foreground transition-colors">
                                {showJobs ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                {showJobs ? 'Hide' : 'Show'} the run order
                            </button>

                            {showJobs && (
                                <div className="border border-border rounded-lg overflow-hidden">
                                    <div className="max-h-80 overflow-y-auto">
                                        <table className="w-full text-xs">
                                            <thead className="bg-background/60 sticky top-0">
                                                <tr className="text-left text-muted">
                                                    <th className="px-2 py-1.5 font-medium">#</th>
                                                    <th className="px-2 py-1.5 font-medium">Shot</th>
                                                    <th className="px-2 py-1.5 font-medium">Workflow</th>
                                                    <th className="px-2 py-1.5 font-medium">Uses</th>
                                                    <th className="px-2 py-1.5 font-medium text-right">Est.</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {preview.jobs.map((j) => (
                                                    <tr key={j.order} className="border-t border-border/60">
                                                        <td className="px-2 py-1.5 text-muted tabular-nums">{j.order + 1}</td>
                                                        <td className="px-2 py-1.5">
                                                            <span className="text-muted">{j.stateId}</span>
                                                            <span className="mx-1 text-muted">·</span>
                                                            {j.title}
                                                            {j.notes?.length > 0 && (
                                                                <span className="block text-muted italic">{j.notes.join('; ')}</span>
                                                            )}
                                                        </td>
                                                        <td className="px-2 py-1.5 text-muted">
                                                            {j.workflowId}
                                                            {j.substitutedFrom && (
                                                                <span className="block italic">
                                                                    named no anchor, so not {j.substitutedFrom}
                                                                </span>
                                                            )}
                                                        </td>
                                                        <td className="px-2 py-1.5 text-muted">
                                                            {j.deps.length === 0
                                                                ? '—'
                                                                : j.deps.map((d, i) => (
                                                                    <span key={i} className="block">
                                                                        <span className="text-foreground">{d.paramLabel}</span>
                                                                        {' ← '}{d.sourceTitle}
                                                                    </span>
                                                                ))}
                                                        </td>
                                                        <td className="px-2 py-1.5 text-right text-muted tabular-nums">
                                                            {fmtDuration(j.estimatedDurationSec)}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}
                        </>
                    )}

                    <div className="flex flex-wrap items-center gap-3 pt-1">
                        <label className="flex items-center gap-2 text-xs text-muted">
                            <FolderOpen size={12} /> Output folder
                            <input
                                type="text" value={folder} onChange={(e) => setFolder(e.target.value)}
                                placeholder={preview.outputFolder || 'storyboard'}
                                className="bg-background border border-border rounded-lg px-2 py-1 text-xs text-foreground w-48"
                            />
                        </label>
                        <label className="flex items-center gap-2 text-xs text-muted">
                            Timeline
                            <select value={spacing} onChange={(e) => setSpacing(e.target.value)}
                                className="bg-background border border-border rounded-lg px-2 py-1 text-xs text-foreground">
                                <option value="estimated">Spread by estimated duration</option>
                                <option value="asap">Back to back (dedicated machine)</option>
                            </select>
                        </label>
                        <Button icon={Upload} onClick={queueBatch} isLoading={queueing || restarting} disabled={!canQueue}>
                            {restarting ? 'Starting…'
                                : queueing ? 'Queueing…'
                                    : serving
                                        ? `Queue ${preview.totalJobs} generation${preview.totalJobs === 1 ? '' : 's'}`
                                        : `Queue ${preview.totalJobs} and start`}
                        </Button>
                    </div>
                    {canQueue && (
                        <p className="text-xs text-muted">
                            Results land in <span className="text-foreground">{preview.outputDir || 'the ComfyUI output dir'}</span>
                            {' / '}<span className="text-foreground">{folder || preview.outputFolder}</span>, one file per shot named
                            {' '}<span className="text-foreground">001_SECTION__Shot-title__workflow</span> — the storyboard's own headings.
                        </p>
                    )}
                    {!serving && canQueue && (
                        <p className="text-xs text-muted">
                            This machine isn't serving yet. Queueing will start it on{' '}
                            <span className="text-foreground">{preview.jobs[0].workflowId}</span> — the first
                            workflow the storyboard uses — and restart the server, which takes a few seconds.
                        </p>
                    )}
                </div>
            )}

            {/* ---- batches already in the queue ---- */}
            {batches.length > 0 && (
                <div className="pt-3 border-t border-border space-y-2">
                    <div className="flex items-center justify-between">
                        <h3 className="text-sm font-medium">Queued storyboards</h3>
                        <Button variant="ghost" size="sm" icon={RefreshCw} onClick={loadBatches}>Refresh</Button>
                    </div>
                    {batches.map(b => {
                        const done = (b.completed || 0) + (b.failed || 0);
                        const pct = b.total ? Math.round((done / b.total) * 100) : 0;
                        return (
                            <div key={b.batchId} className="border border-border rounded-lg p-3">
                                <div className="flex items-center gap-2 mb-2">
                                    <button type="button"
                                        onClick={() => setOpenBatchId(openBatchId === b.batchId ? null : b.batchId)}
                                        className="flex items-center gap-2 min-w-0 text-left hover:text-primary transition-colors">
                                        {openBatchId === b.batchId ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                        <FileText size={14} className="text-muted shrink-0" />
                                        <span className="text-sm font-medium truncate">{b.batchLabel || b.batchId.slice(0, 8)}</span>
                                    </button>
                                    <span className="text-xs text-muted">{fmtTime(b.createdAt)}</span>
                                    <div className="ml-auto flex items-center gap-2">
                                        {b.failed > 0 && (
                                            <Button variant="secondary" size="sm" icon={RotateCcw}
                                                isLoading={retryingId === b.batchId}
                                                onClick={() => retryBatch(b.batchId)}>
                                                Retry failed ({b.failed})
                                            </Button>
                                        )}
                                        <Button variant="danger" size="sm" icon={Trash2}
                                            isLoading={removingId === b.batchId}
                                            onClick={() => removeBatch(b.batchId)}>Stop &amp; remove</Button>
                                    </div>
                                </div>
                                <div className="h-1.5 bg-background rounded-full overflow-hidden mb-1.5">
                                    <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
                                </div>
                                <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
                                    <span className="text-foreground">{done} / {b.total} finished</span>
                                    <span className="text-success">{b.completed || 0} generated</span>
                                    <span>{b.pending || 0} pending</span>
                                    {b.failed > 0 && <span className="text-danger">{b.failed} failed</span>}
                                </div>
                                {b.current && (
                                    <p className="flex items-center gap-1.5 text-xs text-primary mt-1 min-w-0">
                                        <Loader2 size={12} className="animate-spin shrink-0" />
                                        <span className="truncate">Generating: {b.current.label}</span>
                                        {b.current.progress && (
                                            <span className="ml-auto tabular-nums shrink-0">
                                                {Math.round((b.current.progress.value / b.current.progress.max) * 100)}%
                                            </span>
                                        )}
                                    </p>
                                )}
                                {!b.current && b.pending > 0 && serving === false && (
                                    <p className="text-xs text-warning mt-1">
                                        Waiting for the machine to start serving.
                                    </p>
                                )}

                                {openBatchId === b.batchId && detail?.batchId === b.batchId && (
                                    <div className="mt-3 border-t border-border pt-2">
                                        {detail.outputFolder && (
                                            <p className="text-xs text-muted mb-2 flex items-center gap-1.5">
                                                <FolderOpen size={12} /> {detail.outputFolder}/
                                            </p>
                                        )}
                                        <div className="max-h-72 overflow-y-auto space-y-0.5">
                                            {detail.jobs.map((j, i) => <ShotRow key={j.id} job={j} index={i} />)}
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

export default StoryboardUpload;
