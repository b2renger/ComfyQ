import React, { useState, useEffect, useCallback } from 'react';
import { Wrench, Play, Square, AlertTriangle, CheckCircle2, FileText } from 'lucide-react';
import Card from '../ui/Card';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import { SERVER_URL } from '../../utils/api';

/**
 * The upkeep scripts, runnable from here instead of a console.
 *
 * They are still ordinary Python under tools/maintenance — nothing was ported —
 * and the server exposes a WHITELIST of named tasks rather than a script path,
 * so this card can only ever start one of the four things listed below.
 *
 * ★ The audit sheet matters more than it looks: the prune card reads its ACTION
 * column, so a verdict typed there is what holds a model back from the
 * deletable list. Rebuilding preserves that column (build_csv.py reads the
 * existing sheet back in) — but it is still the one thing here that changes
 * what pruning will offer, which is why a rebuild is worth running deliberately
 * rather than as a reflex.
 */
const MaintenanceScripts = ({ headers, onToast, pollMs = 1500 }) => {
    const [tasks, setTasks] = useState([]);
    const [run, setRun] = useState(null);
    const [available, setAvailable] = useState(true);
    const [busy, setBusy] = useState(null);
    const [showLog, setShowLog] = useState(false);
    const [confirming, setConfirming] = useState(null);

    const load = useCallback(async () => {
        try {
            const res = await fetch(`${SERVER_URL}/admin/maintenance/tasks`);
            const data = await res.json();
            setTasks(data.tasks || []);
            setRun(data.run || null);
            setAvailable(data.available !== false);
        } catch { /* a poll failure is not worth a toast */ }
    }, []);

    useEffect(() => {
        load();
        if (run?.status !== 'running') return undefined;
        const t = setInterval(load, pollMs);
        return () => clearInterval(t);
    }, [load, run?.status, pollMs]);

    // A run opens its own log, because the output IS the result for these —
    // a green tick says nothing about 5 absent dependencies it just listed.
    useEffect(() => { if (run?.status === 'running') setShowLog(true); }, [run?.status]);

    const start = async (key) => {
        setBusy(key);
        setConfirming(null);
        try {
            const res = await fetch(`${SERVER_URL}/admin/maintenance/run`, {
                method: 'POST', headers, body: JSON.stringify({ task: key }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
            await load();
        } catch (e) {
            onToast?.(`Could not start: ${e.message}`, 'err');
        } finally {
            setBusy(null);
        }
    };

    const stop = async () => {
        try {
            await fetch(`${SERVER_URL}/admin/maintenance/stop`, { method: 'POST', headers, body: '{}' });
            await load();
        } catch (e) { onToast?.(`Could not stop: ${e.message}`, 'err'); }
    };

    if (!available) return null;

    const running = run?.status === 'running';

    return (
        <Card>
            <div className="flex items-center justify-between mb-3">
                <h2 className="text-lg font-semibold flex items-center gap-2">
                    <Wrench size={18} /> Maintenance scripts
                </h2>
                {running && (
                    <Button variant="ghost" onClick={stop} className="text-danger">
                        <Square size={14} /> Stop
                    </Button>
                )}
            </div>

            <p className="text-sm text-muted mb-4">
                These live in <code>tools/maintenance</code>, so they travel with ComfyQ instead of
                only with a cloned drive. They read the ComfyUI path from{' '}
                <span className="whitespace-nowrap">Manage ComfyUI</span>, not from where they sit on
                disk — so they are correct whatever letter the NVMe mounts under.
            </p>

            <div className="space-y-2">
                {tasks.map(t => {
                    const isThis = run?.key === t.key;
                    return (
                        <div key={t.key}
                            className={`rounded-lg border p-3 ${isThis && running
                                ? 'border-primary bg-primary/5' : 'border-border'}`}>
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <span className="font-medium">{t.label}</span>
                                        {t.mutating
                                            ? <Badge variant="warning"><AlertTriangle size={11} /> modifies the install</Badge>
                                            : <Badge variant="default">reads only</Badge>}
                                        {t.needsComfy && <Badge variant="default">needs ComfyUI running</Badge>}
                                    </div>
                                    <p className="text-xs text-muted mt-1">{t.blurb}</p>
                                    <p className="text-[11px] text-muted/70 mt-1 font-mono truncate">
                                        {t.steps.join(' → ')}
                                    </p>
                                </div>
                                <div className="shrink-0">
                                    {isThis && running ? (
                                        <span className="text-xs text-primary whitespace-nowrap">
                                            step {(run.stepIndex || 0) + 1} of {run.steps}
                                        </span>
                                    ) : confirming === t.key ? (
                                        <div className="flex gap-1">
                                            <Button variant="danger" onClick={() => start(t.key)}>
                                                Run it
                                            </Button>
                                            <Button variant="ghost" onClick={() => setConfirming(null)}>
                                                Cancel
                                            </Button>
                                        </div>
                                    ) : (
                                        <Button variant="secondary" disabled={running || busy === t.key}
                                            onClick={() => (t.mutating ? setConfirming(t.key) : start(t.key))}>
                                            <Play size={14} /> Run
                                        </Button>
                                    )}
                                </div>
                            </div>
                            {confirming === t.key && (
                                <p className="text-xs text-warning mt-2">
                                    This rewrites files inside the ComfyUI install, and this drive is
                                    cloned to other machines. Read its output before trusting a green
                                    result.
                                </p>
                            )}
                        </div>
                    );
                })}
            </div>

            {run && (
                <div className="mt-4 pt-3 border-t border-border">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-sm">
                            {run.status === 'done' && <CheckCircle2 size={15} className="text-success" />}
                            {run.status === 'failed' && <AlertTriangle size={15} className="text-danger" />}
                            <span className="font-medium">{run.label}</span>
                            <span className="text-muted">
                                {running ? `running — ${run.step}` : run.status}
                            </span>
                        </div>
                        <Button variant="ghost" onClick={() => setShowLog(v => !v)}>
                            <FileText size={14} /> {showLog ? 'Hide output' : 'Show output'}
                        </Button>
                    </div>

                    {run.error && <p className="text-xs text-danger mt-1">{run.error}</p>}

                    {!!run.wrote?.length && (
                        <p className="text-xs text-muted mt-1">
                            wrote {run.wrote.map(w => `${w.rel} (${w.mb} MB)`).join(', ')}
                        </p>
                    )}

                    {showLog && (
                        <pre className="mt-2 max-h-80 overflow-auto rounded bg-background p-2 text-[11px]
                            leading-snug text-muted whitespace-pre-wrap">
                            {(run.output || []).join('\n') || '(no output yet)'}
                        </pre>
                    )}
                </div>
            )}
        </Card>
    );
};

export default MaintenanceScripts;
