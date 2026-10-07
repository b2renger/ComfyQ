import React, { useState, useEffect, useCallback } from 'react';
import { Archive, Undo2, Trash2, AlertTriangle, ChevronDown, ChevronUp, RotateCw } from 'lucide-react';
import Card from '../ui/Card';
import Button from '../ui/Button';
import { SERVER_URL } from '../../utils/api';

/**
 * What pruning actually did, and the way back.
 *
 * ★ This card is the reason a prune is safe to click. Pruning MOVES a model into
 * <drive>\_model_quarantine\<batch>\models\… — a rename on the same volume, so it
 * is instant, costs no space and is reversible. Without a screen for it, three
 * things were true at once and all of them bad: the modal said "cannot be undone",
 * the toast said "X GB freed", and the only way to actually reclaim the space was
 * to delete the folder by hand in Explorer — performing the one irreversible step
 * OUTSIDE the tool built to make it reversible.
 *
 * ⚠ Emptying a batch is the only irreversible action in the whole prune
 * mechanism. It is the one thing here that deletes, and it says so.
 */
const ModelQuarantine = ({ headers, onToast }) => {
    const [data, setData] = useState(null);
    const [busy, setBusy] = useState(null);
    const [open, setOpen] = useState({});
    const [confirmEmpty, setConfirmEmpty] = useState(null);

    const load = useCallback(async () => {
        try {
            const res = await fetch(`${SERVER_URL}/admin/models/quarantine`);
            setData(await res.json());
        } catch { /* a poll failure is not worth a toast */ }
    }, []);
    useEffect(() => { load(); }, [load]);

    const post = async (what, body, key) => {
        setBusy(key);
        try {
            const res = await fetch(`${SERVER_URL}/admin/models/quarantine/${what}`, {
                method: 'POST', headers, body: JSON.stringify(body),
            });
            const out = await res.json();
            if (!res.ok) throw new Error(out.error || `HTTP ${res.status}`);
            onToast?.(what === 'restore'
                ? `Moved back into models/ — ${body.rel.split('/').pop()}`
                : `Batch ${body.batch} emptied, ${out.gb ?? '?'} GB freed`);
            setConfirmEmpty(null);
            await load();
        } catch (e) {
            onToast?.(`Could not ${what}: ${e.message}`, 'err');
        } finally { setBusy(null); }
    };

    if (!data) return null;
    const batches = data.batches || [];

    return (
        <Card>
            <div className="flex items-start justify-between gap-3 mb-3">
                <div>
                    <h2 className="text-lg font-semibold flex items-center gap-2">
                        <Archive size={18} /> Quarantined models
                    </h2>
                    <p className="text-sm text-muted mt-1 max-w-3xl">
                        Pruning <strong>moves</strong> a model here rather than deleting it — a rename on
                        the same drive, so it is instant and costs nothing. Anything in this list can go
                        straight back. ⚠ <strong>The disk space is not reclaimed until you empty a
                        batch</strong>, and that step cannot be undone.
                    </p>
                </div>
                <Button variant="ghost" onClick={load}><RotateCw size={14} /> Refresh</Button>
            </div>

            {!batches.length ? (
                <p className="text-sm text-muted">
                    Nothing is quarantined. <code className="text-xs">{data.root || '(no folder yet)'}</code>
                </p>
            ) : (
                <>
                    <p className="text-sm mb-3">
                        <strong>{batches.length}</strong> batch{batches.length === 1 ? '' : 'es'} ·{' '}
                        <strong>{data.totalGb} GB</strong> held, still occupying the drive ·{' '}
                        <code className="text-xs text-muted">{data.root}</code>
                    </p>
                    <div className="space-y-2">
                        {batches.map(b => (
                            <div key={b.batch} className="rounded-lg border border-border p-3">
                                <div className="flex items-center justify-between gap-3">
                                    <button onClick={() => setOpen(o => ({ ...o, [b.batch]: !o[b.batch] }))}
                                        className="flex items-center gap-1.5 min-w-0 text-left">
                                        {open[b.batch] ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                                        <span className="font-medium">{b.batch.replace('T', ' ').replace(/-(\d\d)-(\d\d)-(\d+)Z$/, ':$1:$2')}</span>
                                        <span className="text-muted text-sm">
                                            · {b.files.length} file{b.files.length === 1 ? '' : 's'} · {b.gb} GB
                                        </span>
                                    </button>
                                    {confirmEmpty === b.batch ? (
                                        <div className="flex gap-1 shrink-0">
                                            <Button variant="danger" disabled={busy === b.batch}
                                                onClick={() => post('empty', { batch: b.batch }, b.batch)}>
                                                Delete {b.gb} GB for good
                                            </Button>
                                            <Button variant="ghost" onClick={() => setConfirmEmpty(null)}>Cancel</Button>
                                        </div>
                                    ) : (
                                        <Button variant="ghost" className="text-danger shrink-0"
                                            onClick={() => setConfirmEmpty(b.batch)}>
                                            <Trash2 size={13} /> Empty
                                        </Button>
                                    )}
                                </div>

                                {confirmEmpty === b.batch && (
                                    <p className="text-xs text-danger mt-2">
                                        ⚠ This is the only irreversible step in the prune tool. It deletes{' '}
                                        {b.files.length} file{b.files.length === 1 ? '' : 's'} permanently and
                                        frees {b.gb} GB. Several of this library's models are licence-gated
                                        downloads that need a HuggingFace token to fetch again — restore
                                        anything you are unsure about first.
                                    </p>
                                )}

                                {open[b.batch] && (
                                    <ul className="mt-2 space-y-1">
                                        {b.files.map(f => (
                                            <li key={f.rel} className="flex items-center justify-between gap-2 text-xs">
                                                <span className="min-w-0 break-all">
                                                    <span className="text-muted">{f.gb} GB</span> {f.rel}
                                                </span>
                                                <Button variant="ghost" className="shrink-0"
                                                    disabled={busy === f.rel}
                                                    onClick={() => post('restore', { batch: b.batch, rel: f.rel }, f.rel)}>
                                                    <Undo2 size={12} /> Move back
                                                </Button>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                        ))}
                    </div>
                    <p className="text-xs text-muted mt-3 flex items-start gap-2">
                        <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                        A batch travels in a cloned drive image like anything else on the volume. If you are
                        imaging this drive, either empty the batches you have decided about or expect every
                        rig to receive them.
                    </p>
                </>
            )}
        </Card>
    );
};

export default ModelQuarantine;
