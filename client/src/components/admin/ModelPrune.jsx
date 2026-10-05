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

    const unused = report?.models?.filter(m => m.unused) || [];
    const review = report?.models?.filter(m => !m.unused && m.textOnly) || [];
    const shown = showAll ? unused : unused.slice(0, 25);
    const pickedGb = unused
        .filter(m => picked.has(m.rel))
        .reduce((t, m) => t + m.gb, 0);

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
                body: JSON.stringify({ files: [...picked] }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
            const refused = data.refused?.length
                ? ` ${data.refused.length} refused — ${data.refused[0].why}.`
                : '';
            onToast?.(`Deleted ${data.deleted.length} file(s), ${data.freedGb} GB freed.${refused}`,
                data.refused?.length ? 'err' : 'ok');
            setConfirming(false);
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
                            <div className="max-h-80 overflow-y-auto rounded-lg border border-border divide-y divide-border">
                                {shown.map(m => (
                                    <label key={m.rel}
                                        className="flex items-center gap-2 px-2 py-1.5 text-xs cursor-pointer hover:bg-surface">
                                        <input
                                            type="checkbox"
                                            checked={picked.has(m.rel)}
                                            onChange={() => toggle(m.rel)}
                                            className="flex-shrink-0"
                                        />
                                        <span className="w-20 text-right text-muted flex-shrink-0">{m.gb} GB</span>
                                        <span className="w-24 text-muted flex-shrink-0 truncate">{m.kind}</span>
                                        <span className="font-mono break-all">{m.rel}</span>
                                    </label>
                                ))}
                            </div>
                            {unused.length > shown.length && (
                                <button type="button" onClick={() => setShowAll(true)}
                                    className="mt-2 text-xs text-primary hover:underline">
                                    Show all {unused.length} — {report.totals.unusedGb} GB
                                </button>
                            )}

                            <div className="mt-3 flex items-center gap-2 flex-wrap">
                                <button type="button"
                                    onClick={() => setPicked(new Set(shown.map(m => m.rel)))}
                                    className="text-xs text-primary hover:underline">
                                    Select the {shown.length} shown
                                </button>
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
                                    Delete selected
                                </Button>
                            </div>
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
                title={`Delete ${picked.size} model file(s)?`} maxWidth="max-w-xl">
                <p className="text-sm text-muted mb-2">
                    This frees <span className="text-foreground">{pickedGb.toFixed(2)} GB</span> and
                    cannot be undone. Some of these are large or licence-gated downloads, so getting one
                    back may mean an account and a long wait. What is removed is written to
                    <code className="mx-1">server/data/pruned-models.json</code> so there is a record.
                </p>
                <div className="max-h-56 overflow-y-auto rounded-lg border border-border p-2 mb-3">
                    {unused.filter(m => picked.has(m.rel)).map(m => (
                        <div key={m.rel} className="text-xs font-mono break-all">
                            {m.gb} GB · {m.rel}
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
                        {deleting ? 'Deleting…' : `Delete ${picked.size} file(s)`}
                    </Button>
                </div>
            </Modal>
        </Card>
    );
};

export default ModelPrune;
