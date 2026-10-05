import React, { useState, useEffect, useCallback } from 'react';
import { Download, RefreshCw, X, Trash2, AlertTriangle, CheckCircle2, KeyRound } from 'lucide-react';
import Card from '../ui/Card';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import { SERVER_URL } from '../../utils/api';

/**
 * Models being fetched onto THIS machine.
 *
 * ★ Server-side downloads, not browser ones, and the reason is worth knowing:
 * the admin panel is routinely open on another computer (there is a Copy-admin-
 * link button for exactly that), so a browser download lands on whoever's
 * laptop is open rather than on the rig that needs the weights. And
 * showDirectoryPicker — the only web API that could choose a folder — needs a
 * secure context, which plain HTTP on the LAN is not.
 *
 * A `.part` file is renamed only once the byte count matches, so an interrupted
 * download can never be mistaken for an installed model. That matters twice
 * over here: a half file would read as INSTALLED to the prune tool, which would
 * then call it unused.
 */
const ModelDownloads = ({ headers, onToast, hasHfToken = false, pollMs = 1500 }) => {
    const [rows, setRows] = useState([]);
    const [available, setAvailable] = useState(true);
    const [busy, setBusy] = useState(null);

    const load = useCallback(async () => {
        try {
            const res = await fetch(`${SERVER_URL}/admin/models/downloads`);
            const data = await res.json();
            setRows(data.downloads || []);
            setAvailable(data.available !== false);
        } catch { /* a poll failure is not worth a toast */ }
    }, []);

    useEffect(() => {
        load();
        // Poll only while something is in flight, so an idle panel is free.
        const active = rows.some(r => ['queued', 'downloading'].includes(r.status));
        if (!active) return undefined;
        const t = setInterval(load, pollMs);
        return () => clearInterval(t);
    }, [load, rows, pollMs]);

    const act = async (what, key) => {
        setBusy(key);
        try {
            const res = await fetch(`${SERVER_URL}/admin/models/download/${what}`, {
                method: 'POST', headers, body: JSON.stringify({ key }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
            await load();
        } catch (e) {
            onToast?.(`Could not ${what}: ${e.message}`, 'err');
        } finally {
            setBusy(null);
        }
    };

    const gb = (b) => (Number(b || 0) / 1024 ** 3).toFixed(2);
    const active = rows.filter(r => ['queued', 'downloading'].includes(r.status));

    if (!available) return null;

    return (
        <Card>
            <div className="flex items-center justify-between mb-3">
                <h2 className="text-lg font-semibold flex items-center gap-2">
                    <Download size={18} /> Model downloads
                </h2>
                <div className="flex items-center gap-2">
                    {active.length > 0 && <Badge variant="primary">{active.length} in flight</Badge>}
                    <Button variant="secondary" icon={RefreshCw} onClick={load}>Refresh</Button>
                </div>
            </div>

            {rows.length === 0 ? (
                <p className="text-sm text-muted">
                    Nothing downloading. A workflow card shows a download link beside any model it
                    needs that is not on this machine; the file is fetched straight onto this rig,
                    into the folder its download link says it belongs in.
                    {!hasHfToken && (
                        <span className="block mt-1 flex items-start gap-1 text-warning">
                            <KeyRound size={12} className="mt-0.5 flex-shrink-0" />
                            <span>
                                No HuggingFace token is set, so gated repositories (FLUX.2 and LTX-2.5
                                among them) will refuse. Add one under Manage ComfyUI.
                            </span>
                        </span>
                    )}
                </p>
            ) : (
                <div className="space-y-2">
                    {rows.map(r => {
                        const pct = r.total ? Math.min(100, Math.round(100 * r.received / r.total)) : null;
                        const tone = r.status === 'done' ? 'text-success'
                            : r.status === 'failed' ? 'text-danger'
                                : r.status === 'cancelled' ? 'text-muted' : 'text-primary';
                        return (
                            <div key={r.key} className="px-3 py-2 rounded-lg bg-surface border border-border text-xs">
                                <div className="flex items-center gap-2 flex-wrap">
                                    <span className={tone}>
                                        {r.status === 'done' ? <CheckCircle2 size={13} />
                                            : r.status === 'failed' ? <AlertTriangle size={13} />
                                                : <Download size={13} />}
                                    </span>
                                    <span className="font-mono break-all text-foreground">{r.dest}</span>
                                    <span className={`${tone} flex-shrink-0`}>{r.status}</span>
                                    <span className="ml-auto text-muted flex-shrink-0">
                                        {gb(r.received)}{r.total ? ` / ${gb(r.total)}` : ''} GB
                                        {pct !== null && r.status === 'downloading' ? ` · ${pct}%` : ''}
                                    </span>
                                    {['queued', 'downloading'].includes(r.status) ? (
                                        <button type="button" title="Stop — what has arrived is kept, so it can resume"
                                            disabled={busy === r.key}
                                            onClick={() => act('cancel', r.key)}
                                            className="text-muted hover:text-danger flex-shrink-0">
                                            <X size={14} />
                                        </button>
                                    ) : (
                                        <button type="button" title="Remove this row"
                                            disabled={busy === r.key}
                                            onClick={() => act('forget', r.key)}
                                            className="text-muted hover:text-danger flex-shrink-0">
                                            <Trash2 size={13} />
                                        </button>
                                    )}
                                </div>
                                {pct !== null && ['downloading', 'cancelled'].includes(r.status) && (
                                    <div className="mt-1.5 h-1 rounded-full bg-background overflow-hidden">
                                        <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
                                    </div>
                                )}
                                {r.error && <p className="mt-1 text-danger">{r.error}</p>}
                                {r.placedWhy && r.status !== 'failed' && (
                                    <p className="mt-1 text-muted/80">Placed because {r.placedWhy}.</p>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </Card>
    );
};

export default ModelDownloads;
