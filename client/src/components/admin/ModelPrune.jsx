import React, { useState, useEffect, useCallback } from 'react';
import { HardDrive, RefreshCw, Trash2, AlertTriangle, Eye, ChevronDown, ChevronUp, FolderSearch, X, Save, FileWarning } from 'lucide-react';
import Card from '../ui/Card';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import Modal from '../ui/Modal';
import { SERVER_URL } from '../../utils/api';

/**
 * Prune the models nothing uses.
 *
 * ★ "Unused" here means referenced by NOTHING this machine knows about: no
 * bundle's api.json, no bundle's editable template, no `lora` dropdown's filter
 * prefix, and no workflow in the candidate / demo / ComfyUI-user folders. Each
 * of those classes has caught a real near-miss, so the card names the folders
 * the verdict rests on — a folder of workflows nobody told ComfyQ about would
 * make its models look deletable.
 *
 * The server re-derives all of that on the delete and refuses anything it does
 * not independently judge unused, so a page left open while a workflow was
 * added cannot talk it into removing something that is now needed.
 */
const ModelPrune = ({
    headers, onToast,
    scanDirs = [], onScanDirsChange = () => {}, onSaveScanDirs = async () => false,
    savingScanDirs = false,
}) => {
    const [report, setReport] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [picked, setPicked] = useState(() => new Set());
    const [confirming, setConfirming] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [showReview, setShowReview] = useState(false);
    const [showAll, setShowAll] = useState(false);
    const [showDirs, setShowDirs] = useState(false);
    // Opens on the confident group; the wider sets are a deliberate click.
    const [level, setLevel] = useState('high');
    const [allowLow, setAllowLow] = useState(false);
    // Where a prune actually puts things, so the confirm modal can name it rather
    // than describing a deletion that does not happen.
    const [quarantineRoot, setQuarantineRoot] = useState('');
    const [showMissing, setShowMissing] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(`${SERVER_URL}/admin/models/usage`);
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
            setReport(data);
            setPicked(new Set());
        } catch (e) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);
    useEffect(() => {
        let gone = false;
        fetch(`${SERVER_URL}/admin/models/quarantine`)
            .then(r => r.json())
            .then(d => { if (!gone) setQuarantineRoot(d.root || ''); })
            .catch(() => { /* the modal falls back to a generic path */ });
        return () => { gone = true; };
    }, []);

    const unused = report?.models?.filter(m => m.unused) || [];
    const review = report?.models?.filter(m => !m.unused && m.textOnly) || [];

    // ★ The list opens on the CONFIDENT set only. "Nothing references it" is a
    // weaker claim than it sounds — a near-miss here already put a 1.82 GB LoRA
    // two templates load on this list — so the wider sets are a deliberate
    // click, not the default view.
    const atLevel = level === 'all' ? unused : unused.filter(m => m.confidence === level);
    const shown = showAll ? atLevel : atLevel.slice(0, 25);
    const pickedRows = unused.filter(m => picked.has(m.rel));
    const pickedGb = pickedRows.reduce((t, m) => t + m.gb, 0);
    const pickedLow = pickedRows.filter(m => m.confidence === 'low');
    // Only ever true while a suspicious row is actually selected.
    const allowLowEffective = allowLow && pickedLow.length > 0;

    // Drop the acknowledgement the moment it stops applying, so it can never be
    // carried into a later, unrelated selection while its checkbox is hidden.
    // ★ Declared HERE, after pickedLow: placed above it the effect read a const
    // in its temporal dead zone, which the bundler compiled happily and the
    // page then threw on every render.
    useEffect(() => {
        if (allowLow && pickedLow.length === 0) setAllowLow(false);
    }, [allowLow, pickedLow.length]);

    const LEVELS = [
        { key: 'high', label: 'Confident', n: report?.totals?.confident, gb: report?.totals?.confidentGb, tone: 'text-success' },
        { key: 'medium', label: 'Worth a look', n: report?.totals?.unsure, gb: report?.totals?.unsureGb, tone: 'text-warning' },
        { key: 'low', label: 'Suspicious', n: report?.totals?.suspicious, gb: report?.totals?.suspiciousGb, tone: 'text-danger' },
        { key: 'all', label: 'Everything', n: unused.length, gb: report?.totals?.unusedGb, tone: 'text-muted' },
    ];
    const TONE = { high: 'text-success', medium: 'text-warning', low: 'text-danger' };

    const toggle = (rel) => setPicked(p => {
        const next = new Set(p);
        next.has(rel) ? next.delete(rel) : next.add(rel);
        return next;
    });

    const prune = async () => {
        setDeleting(true);
        try {
            const res = await fetch(`${SERVER_URL}/admin/models/prune`, {
                method: 'POST',
                headers,
                body: JSON.stringify({ files: [...picked], allowLow: allowLowEffective }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
            const refused = data.refused?.length
                ? ` ${data.refused.length} refused — ${data.refused[0].why}.`
                : '';
            onToast?.(`Moved ${data.deleted.length} file(s) (${data.freedGb} GB) to quarantine — not freed until you empty the batch.${refused}`,
                data.refused?.length ? 'err' : 'ok');
            setConfirming(false);
            setAllowLow(false);
            await load();
        } catch (e) {
            onToast?.(`Could not prune: ${e.message}`, 'err');
        } finally {
            setDeleting(false);
        }
    };

    return (
        <Card>
            <div className="flex items-center justify-between mb-3">
                <h2 className="text-lg font-semibold flex items-center gap-2">
                    <HardDrive size={18} /> Prune unused models
                </h2>
                <div className="flex items-center gap-2">
                    {report && (
                        <Badge variant={unused.length ? 'warning' : 'success'}>
                            {unused.length
                                ? `${report.totals.unusedGb} GB reclaimable`
                                : 'nothing unused'}
                        </Badge>
                    )}
                    <Button variant="secondary" icon={RefreshCw} onClick={load} disabled={loading}>
                        {loading ? 'Scanning…' : 'Rescan'}
                    </Button>
                </div>
            </div>

            {error && (
                <p className="text-sm text-danger flex items-center gap-2 mb-2">
                    <AlertTriangle size={14} />{error}
                </p>
            )}

            {report && (
                <>
                    <p className="text-xs text-muted mb-1">
                        {report.totals.all} model files on disk, {report.totals.allGb} GB in all.
                        A file counts as used when any bundle, any bundle's editable template, any
                        LoRA dropdown or any workflow in the folders below refers to it.
                    </p>
                    <p className="text-xs text-muted mb-2 flex items-start gap-1">
                        <FolderSearch size={12} className="mt-0.5 flex-shrink-0" />
                        <span>
                            Checked {report.scanned.bundles} bundles, {report.scanned.files} workflow
                            files{report.scanned.dirs?.length ? `, and ${report.scanned.dirs.length} other folder(s)` : ''}.
                            {report.scanned.missingDirs?.length > 0 && (
                                <span className="text-warning">
                                    {' '}⚠ {report.scanned.missingDirs.length} configured folder(s) could not be
                                    read ({report.scanned.missingDirs.join('; ')}) — models used only there would
                                    look unused, so fix that before deleting anything.
                                </span>
                            )}
                        </span>
                    </p>

                    {/* What the verdict rests on. Always-scanned folders are listed
                        as fixed context so nobody adds them as a row, and the
                        editable ones show where a relative entry resolved to. */}
                    <button type="button" onClick={() => setShowDirs(d => !d)}
                        className="flex items-center gap-1 text-xs text-primary hover:underline mb-3">
                        <FolderSearch size={12} />
                        Folders scanned ({report.scanned.dirs?.length || 0} extra)
                        {showDirs ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                    </button>

                    {showDirs && (
                        <div className="mb-4 rounded-lg border border-border bg-background/60 p-2 space-y-2 text-xs">
                            <p className="text-muted">
                                Always scanned, and <span className="text-foreground">recursively</span> — one parent
                                folder covers every graph nested inside it:
                            </p>
                            <ul className="text-muted/80 space-y-0.5 pl-1">
                                <li>· every bundle in <code>workflows/</code>, including its editable template</li>
                                <li>· <code>workflows/_candidate_workflows</code></li>
                                <li>· each parallel lane's own ComfyUI user folder</li>
                                <li>· <code>{report.comfyRoot ? `${report.comfyRoot}\\user\\default\\workflows` : 'ComfyUI\\user\\default\\workflows'}</code></li>
                            </ul>

                            <p className="text-muted pt-1">
                                Extra folders of workflow JSON on this machine. A path relative to the
                                ComfyUI root set in <span className="text-foreground">Manage ComfyUI</span> travels
                                between rigs that mount the drive under another letter; an absolute one is also
                                fine and the Drive-letter control rewrites it.
                            </p>

                            {(scanDirs || []).map((dir, i) => {
                                const resolved = report.scanned.configured?.find(c => c.entry === dir);
                                return (
                                    <div key={i} className="p-2 rounded-lg border border-border bg-background space-y-1">
                                        <div className="flex items-center gap-2">
                                            <input
                                                type="text"
                                                value={dir}
                                                onChange={(e) => onScanDirsChange(
                                                    scanDirs.map((d, di) => (di === i ? e.target.value : d)))}
                                                placeholder="..\..\_demo_workflows   or   D:\my_workflows"
                                                className="flex-1 bg-background border border-border rounded-md p-1.5 text-xs text-foreground font-mono"
                                            />
                                            <button type="button" title="Remove this folder"
                                                onClick={() => onScanDirsChange(scanDirs.filter((_, di) => di !== i))}
                                                className="text-muted hover:text-danger">
                                                <X size={14} />
                                            </button>
                                        </div>
                                        {resolved && resolved.resolved !== dir && (
                                            <p className={resolved.found ? 'text-muted' : 'text-warning'}>
                                                → {resolved.resolved}{resolved.found ? '' : ' — not found'}
                                            </p>
                                        )}
                                        {resolved && resolved.resolved === dir && !resolved.found && (
                                            <p className="text-warning">not found</p>
                                        )}
                                    </div>
                                );
                            })}

                            <div className="flex items-center gap-3 pt-1">
                                <button type="button"
                                    onClick={() => onScanDirsChange([...(scanDirs || []), ''])}
                                    className="text-xs font-semibold text-primary hover:underline">
                                    + Add a folder
                                </button>
                                <Button variant="secondary" icon={Save} isLoading={savingScanDirs}
                                    onClick={async () => {
                                        const ok = await onSaveScanDirs(
                                            (scanDirs || []).map(d => d.trim()).filter(Boolean));
                                        if (ok) load();
                                    }}>
                                    Save folders
                                </Button>
                            </div>
                        </div>
                    )}

                    {/* ★ The other half of the question, and the half nothing
                        reported before: a loader asks for a model that is not on
                        this disk. The readiness chip on a workflow card walks the
                        api.json only, so a weight missing from a TEMPLATE was
                        invisible — which is how a file deleted as "unused" went
                        unnoticed after three bundles' templates still loaded it. */}
                    {report.missing?.length > 0 && (
                        <div className="mb-4">
                            <button type="button" onClick={() => setShowMissing(m => !m)}
                                className="flex items-center gap-1 text-xs text-warning hover:underline">
                                <FileWarning size={12} />
                                {report.missing.length} model(s) a workflow loads are not on this disk
                                {showMissing ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                            </button>
                            {showMissing && (
                                <div className="mt-2 rounded-lg border border-warning/30 bg-warning/5 p-2 space-y-1 text-xs">
                                    {report.missing.map(m => (
                                        <div key={m.name}>
                                            <span className="font-mono break-all text-warning">{m.name}</span>
                                            <span className="text-muted">
                                                {' '}— {m.nodeTypes.filter(t => t.loader).map(t => t.type).join(', ')}
                                                {m.usedBy.length > 0 && <> · runs in {m.usedBy.join(', ')}</>}
                                                {m.templateOnly.length > 0 && <> · editable graph of {m.templateOnly.join(', ')}</>}
                                                {!m.usedBy.length && !m.templateOnly.length && m.external.length > 0
                                                    && <> · a workflow outside the bundles</>}
                                            </span>
                                        </div>
                                    ))}
                                    <p className="text-muted/80 pt-1">
                                        A missing model named by a bundle's <em>api.json</em> stops that workflow
                                        running. One named only by its editable template still runs, but
                                        "Open in ComfyUI" hands over a graph with a gap. Each bundle's card lists
                                        where its models come from.
                                    </p>
                                </div>
                            )}
                        </div>
                    )}

                    {unused.length === 0 ? (
                        <p className="text-sm text-muted">
                            Every model on this disk is referenced by something. Nothing to prune.
                        </p>
                    ) : (
                        <>
                            {/* How sure we are, per file — opening on the confident
                                set, because "nothing references it" is a weaker
                                claim than it sounds. */}
                            <div className="flex items-center gap-1 flex-wrap mb-2">
                                {LEVELS.map(l => (
                                    <button key={l.key} type="button"
                                        onClick={() => { setLevel(l.key); setShowAll(false); setPicked(new Set()); }}
                                        className={`px-2 py-1 rounded-full text-xs border transition-colors
                                            ${level === l.key
                                                ? 'border-primary/50 bg-primary/10 text-primary'
                                                : `border-border bg-surface ${l.tone} hover:border-primary/40`}`}>
                                        {l.label} <span className="opacity-70">{l.n ?? 0} · {l.gb ?? 0} GB</span>
                                    </button>
                                ))}
                            </div>

                            {level === 'high' && (
                                <p className="text-xs text-muted mb-2">
                                    Nothing on this machine mentions these and nothing on disk resembles them.
                                    The other groups are reachable above — each row says why it is not here.
                                </p>
                            )}
                            {level === 'medium' && (
                                <p className="text-xs text-warning mb-2">
                                    Nothing on this machine loads these, but something explains why each
                                    one is on the disk — a ComfyUI built-in template, a node pack's example
                                    workflow, or a recent arrival somebody may still be working with.
                                    Read the reason on each row.
                                </p>
                            )}
                            {level === 'low' && (
                                <p className="text-xs text-danger mb-2">
                                    Something about each of these is doubtful — usually that it looks like
                                    another build of a model that IS in use. Read the reason before selecting
                                    one, and do not bulk-select this group.
                                </p>
                            )}

                            <div className="max-h-80 overflow-y-auto rounded-lg border border-border divide-y divide-border">
                                {shown.map(m => (
                                    <label key={m.rel}
                                        className="flex items-start gap-2 px-2 py-1.5 text-xs cursor-pointer hover:bg-surface">
                                        <input
                                            type="checkbox"
                                            checked={picked.has(m.rel)}
                                            onChange={() => toggle(m.rel)}
                                            className="flex-shrink-0 mt-0.5"
                                        />
                                        <span className="w-20 text-right text-muted flex-shrink-0">{m.gb} GB</span>
                                        <span className={`w-16 flex-shrink-0 ${TONE[m.confidence] || 'text-muted'}`}>
                                            {m.confidence}
                                        </span>
                                        <span className="min-w-0">
                                            <span className="font-mono break-all">{m.rel}</span>
                                            {/* ★ Every reason, not only the doubts. Filtering to
                                                `lowers` meant the CONFIDENT tier — the one tier with
                                                a bulk-select button — rendered with no explanation at
                                                all, while its actual justification ("the model audit
                                                already judged this deletable: …") sat in JSON nobody
                                                can see. Doubts are sorted first so one can never be
                                                pushed out of sight by a reason to go ahead. */}
                                            {[...(m.confidenceReasons || [])]
                                                .sort((a, b) => (a.effect === 'lowers' ? 0 : 1) - (b.effect === 'lowers' ? 0 : 1))
                                                .slice(0, 3)
                                                .map(r => (
                                                    <span key={r.code}
                                                        className={`block ${r.effect === 'lowers' ? 'text-warning/80' : 'text-muted/70'}`}>
                                                        {r.effect === 'lowers' ? '⚠ ' : '→ '}{r.detail}
                                                    </span>
                                                ))}
                                            {!(m.confidenceReasons || []).length && (
                                                <span className="block text-muted/60">
                                                    nothing on this machine refers to it — no workflow, template,
                                                    dropdown, node-pack source or observed load
                                                </span>
                                            )}
                                        </span>
                                    </label>
                                ))}
                            </div>
                            {atLevel.length > shown.length && (
                                <button type="button" onClick={() => setShowAll(true)}
                                    className="mt-2 text-xs text-primary hover:underline">
                                    Show all {atLevel.length} in this group
                                </button>
                            )}

                            <div className="mt-3 flex items-center gap-2 flex-wrap">
                                {/* ★ Bulk-select ONLY on the confident tier. The
                                    "Everything" view opens on the 25 LARGEST files,
                                    which is where the suspicious ones are, and one
                                    click used to take all of them. Outside this tier
                                    a row has to be ticked after reading its reason,
                                    which is the whole point of having reasons. */}
                                {level === 'high' ? (
                                    <button type="button"
                                        onClick={() => setPicked(new Set(shown.map(m => m.rel)))}
                                        className="text-xs text-primary hover:underline">
                                        Select the {shown.length} shown
                                    </button>
                                ) : (
                                    <span className="text-xs text-muted">
                                        Tick rows individually here — bulk select is only offered for
                                        the confident group.
                                    </span>
                                )}
                                {picked.size > 0 && (
                                    <button type="button" onClick={() => setPicked(new Set())}
                                        className="text-xs text-muted hover:text-foreground hover:underline">
                                        Clear selection
                                    </button>
                                )}
                                <span className="ml-auto text-xs text-muted">
                                    {picked.size
                                        ? `${picked.size} selected · ${pickedGb.toFixed(2)} GB`
                                        : 'nothing selected'}
                                </span>
                                <Button variant="danger" icon={Trash2}
                                    disabled={!picked.size}
                                    onClick={() => setConfirming(true)}>
                                    Move to quarantine
                                </Button>
                            </div>

                            {/* The server refuses a low-confidence file unless this is
                                set, so the box is the only way past it — deliberately. */}
                            {pickedLow.length > 0 && (
                                <label className="mt-2 flex items-start gap-2 text-xs text-danger cursor-pointer">
                                    <input type="checkbox" checked={allowLow}
                                        onChange={(e) => setAllowLow(e.target.checked)}
                                        className="mt-0.5 flex-shrink-0" />
                                    <span>
                                        {pickedLow.length} of the selected file(s) are marked suspicious and the
                                        server will refuse them. Tick this only if you have read each reason and
                                        are sure — that is the point of the mark.
                                    </span>
                                </label>
                            )}
                        </>
                    )}

                    {/* ★ Kept, but every mention of them is text rather than a model
                        widget — on this rig that is one 42.98 GB file whose only
                        references are a cloud-API model name typed into an LTX
                        encoder. Shown rather than deleted: the tool errs towards
                        keeping, and a person should decide. */}
                    {review.length > 0 && (
                        <div className="mt-4 pt-3 border-t border-border">
                            <button type="button" onClick={() => setShowReview(s => !s)}
                                className="flex items-center gap-1 text-xs text-warning hover:underline">
                                <Eye size={12} />
                                {review.length} file(s), {report.totals.reviewGb} GB — kept, but worth a look
                                {showReview ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                            </button>
                            {showReview && (
                                <div className="mt-2 space-y-1">
                                    <p className="text-xs text-muted">
                                        Nothing loads these. Every mention is a node that takes a model
                                        <em> name</em> rather than opening a file — usually a cloud-API
                                        model id typed into a text widget. They are kept because the
                                        safe direction for a delete tool is to keep, but they are
                                        probably reclaimable. Check before removing by hand.
                                    </p>
                                    {review.map(m => (
                                        <div key={m.rel} className="text-xs flex items-start gap-2">
                                            <span className="w-20 text-right text-muted flex-shrink-0">{m.gb} GB</span>
                                            <span className="font-mono break-all">{m.rel}</span>
                                            <span className="ml-auto text-muted flex-shrink-0 pl-2">
                                                {m.nodeTypes.map(t => `${t.type}×${t.count}`).join(', ')}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </>
            )}

            <Modal isOpen={confirming} onClose={() => !deleting && setConfirming(false)}
                title={`Move ${picked.size} model file(s) to quarantine?`} maxWidth="max-w-xl">
                {/* ★ Three sentences that were all false until now: it said "frees X GB"
                    and "cannot be undone", when a prune is a MOVE to a folder on the same
                    drive. Reading them, someone prunes to shrink the disk, sees no space
                    freed, and deletes the quarantine by hand in Explorer — performing the
                    one irreversible step outside the tool built to make it reversible. */}
                <p className="text-sm text-muted mb-2">
                    This <span className="text-foreground">moves</span>{' '}
                    <span className="text-foreground">{pickedGb.toFixed(2)} GB</span> into a dated
                    batch under <code className="mx-1">{quarantineRoot || '<drive>\\_model_quarantine'}</code>
                    — a rename on the same drive, so it is instant and <strong>can be undone</strong> from
                    the Quarantined models card below.
                </p>
                <p className="text-sm text-warning mb-2">
                    ⚠ It does <strong>not</strong> free any disk space yet. The space comes back only when
                    you empty that batch, which is the irreversible step. Some of these are large or
                    licence-gated downloads, so getting one back may mean an account and a long wait.
                    Everything moved is recorded in
                    <code className="mx-1">server/data/pruned-models.jsonl</code>, with the link to refetch
                    it where one is known.
                </p>
                <div className="max-h-56 overflow-y-auto rounded-lg border border-border p-2 mb-3">
                    {pickedRows.map(m => (
                        <div key={m.rel} className="text-xs break-all">
                            <span className={TONE[m.confidence] || 'text-muted'}>{m.confidence}</span>
                            <span className="text-muted"> · {m.gb} GB · </span>
                            <span className="font-mono">{m.rel}</span>
                        </div>
                    ))}
                </div>
                <p className="text-xs text-muted mb-3">
                    The server checks each file again before deleting it and refuses any it finds a use
                    for, so nothing in use can be removed from here.
                </p>
                <div className="flex justify-end gap-2">
                    <Button variant="secondary" onClick={() => setConfirming(false)} disabled={deleting}>
                        Cancel
                    </Button>
                    <Button variant="danger" icon={Trash2} onClick={prune} disabled={deleting}>
                        {deleting ? 'Moving…' : `Move ${picked.size} file(s) to quarantine`}
                    </Button>
                </div>
            </Modal>
        </Card>
    );
};

export default ModelPrune;
