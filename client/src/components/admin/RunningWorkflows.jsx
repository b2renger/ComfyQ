import React from 'react';
import { Radio, Square, RefreshCw, Power, MemoryStick, ExternalLink, Users } from 'lucide-react';
import Card from '../ui/Card';
import Badge from '../ui/Badge';
import LinkOut from '../ui/ExternalLink';

/**
 * What this machine is serving right now, one row per lane, each stoppable.
 *
 * ★ Every lane can be closed on its own while another keeps serving (owner,
 * 2026-11-04) — the main lane included: "main" then moves to the next lane, and
 * the install's ComfyUI stays up with its models unloaded, so nothing restarts.
 * Only the LAST lane gets the heavier "Stop serving": with nothing left, the
 * server goes back to admin mode and students can no longer book — the same
 * thing the header's "Reset to admin" does. Mirrors the per-card controls in
 * WorkflowSelector so the two cannot drift.
 *
 * Empty whenever nothing is served, which is the honest reading of an admin-mode
 * machine: it answers HTTP and schedules nothing.
 *
 * Each row also links to the two interfaces a lane has: the student page opened
 * on that lane (`/user?workflow=<id>`, the same link the Discovery app opens) and
 * that lane's own ComfyUI on its port. Both are built from the address this
 * panel was opened on, so they work from a laptop too — except the ComfyUI one
 * when ComfyUI listens on localhost only, which is said rather than linked.
 */
const RunningWorkflows = ({
    lanes = [], card = null, serving = false,
    onCloseLane = null, closingLaneId = null,
    onDeactivate = null, deactivating = false, lanAccess = false, restarts = null,
}) => {
    const host = window.location.hostname;
    const onRig = host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
    const comfyReachable = lanAccess || onRig;
    const linkCls = 'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-background border border-border text-muted hover:text-foreground hover:border-primary/50 transition-colors';
    const free = card?.vramGb
        ? Math.max(0, +(card.vramGb - card.usedGb - 2).toFixed(2))
        : null;

    return (
        <Card>
            <div className="flex items-center justify-between mb-3">
                <h2 className="text-lg font-semibold flex items-center gap-2">
                    <Radio size={18} /> Running
                </h2>
                <Badge variant={lanes.length ? 'success' : 'default'}>
                    {lanes.length
                        ? `${lanes.length} workflow${lanes.length > 1 ? 's' : ''} served`
                        : 'Nothing served'}
                </Badge>
            </div>

            {lanes.length === 0 ? (
                <p className="text-sm text-muted">
                    This machine is not serving a workflow, so students cannot book anything on it.
                    Pick one in the library below and use <span className="text-foreground">Activate &amp; serve</span>.
                </p>
            ) : (
                <>
                    {card?.vramGb && (
                        <p className="text-xs text-muted mb-1">
                            {card.usedGb} of {card.vramGb} GB of models resident
                            {free !== null && <> · {free} GB free for another workflow</>}
                        </p>
                    )}
                    {/* How often ComfyUI had to (re)start, and the last reason —
                        so a machine that keeps reloading is visible, not felt. */}
                    {restarts && (
                        <p className="text-xs text-muted mb-3" title={(restarts.history || []).slice(0, 8)
                            .map(h => `${new Date(h.at).toLocaleTimeString()} ${h.event} :${h.port}${h.reason ? ` — ${h.reason}` : ''}`).join('\n')}>
                            ComfyUI started {restarts.last24h} time{restarts.last24h === 1 ? '' : 's'} in the last 24 h
                            {(() => {
                                const last = (restarts.history || []).find(h => h.event === 'start');
                                return last ? <> · last: {last.reason || 'start'} ({new Date(last.at).toLocaleTimeString()})</> : null;
                            })()}
                            {' '}· it keeps running when ComfyQ restarts
                        </p>
                    )}
                    <div className="space-y-2">
                        {lanes.map(l => {
                            const closing = closingLaneId === l.workflowId;
                            return (
                                <div key={l.workflowId}
                                    className="flex items-center gap-3 flex-wrap px-3 py-2 rounded-lg bg-surface border border-border">
                                    <span className="inline-flex items-center gap-1.5 text-success flex-shrink-0">
                                        <Radio size={13} />
                                        <span className="text-sm font-medium text-foreground">{l.name}</span>
                                    </span>
                                    {l.primary && lanes.length > 1 && <Badge variant="primary">main</Badge>}
                                    {l.busy && <Badge variant="success">generating</Badge>}
                                    <code className="text-xs text-muted">{l.workflowId}</code>
                                    <span className="text-xs text-muted">:{l.port}</span>
                                    {l.vramGb != null && (
                                        <span className="inline-flex items-center gap-1 text-xs text-muted">
                                            <MemoryStick size={11} />{l.vramGb} GB
                                        </span>
                                    )}

                                    <div className="ml-auto flex items-center gap-2 flex-wrap">
                                    <LinkOut
                                        href={`${window.location.origin}/user?workflow=${encodeURIComponent(l.workflowId)}`}
                                        className={linkCls}
                                        title="Open the student page in a new tab, with this workflow picked for booking."
                                    >
                                        <Users size={13} /><span>Student page</span>
                                    </LinkOut>
                                    {comfyReachable ? (
                                        <LinkOut
                                            href={`${window.location.protocol}//${host}:${l.port}/`}
                                            className={linkCls}
                                            title={`Open the ComfyUI this lane runs on (port ${l.port}) in a new tab.`}
                                        >
                                            <ExternalLink size={13} /><span>ComfyUI</span>
                                        </LinkOut>
                                    ) : (
                                        <span
                                            className={`${linkCls} opacity-50 cursor-not-allowed`}
                                            title={`This ComfyUI listens on the rig only, so it cannot be opened from this computer. Turn on "Expose ComfyUI to the LAN" under Manage ComfyUI, or open http://localhost:${l.port} on the rig itself.`}
                                        >
                                            <ExternalLink size={13} /><span>ComfyUI</span>
                                        </span>
                                    )}

                                    {/* Any lane just goes while another is served. The LAST
                                        one going means the machine stops serving, so it gets
                                        the heavier label. */}
                                    {lanes.length === 1 ? (
                                        serving && onDeactivate && (
                                            <button
                                                type="button"
                                                disabled={deactivating}
                                                onClick={() => onDeactivate(l.workflowId)}
                                                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-background border border-border hover:border-danger/50 text-muted hover:text-danger transition-colors disabled:opacity-60 disabled:cursor-wait"
                                                title="Stop serving — puts the server back in admin mode, so students can no longer book on this machine."
                                            >
                                                {deactivating ? <RefreshCw size={13} className="animate-spin" /> : <Power size={13} />}
                                                <span>{deactivating ? 'Stopping…' : 'Stop serving'}</span>
                                            </button>
                                        )
                                    ) : onCloseLane && (
                                        <button
                                            type="button"
                                            disabled={closing}
                                            onClick={() => onCloseLane(l.workflowId)}
                                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-background border border-border hover:border-danger/50 text-muted hover:text-danger transition-colors disabled:opacity-60 disabled:cursor-wait"
                                            title={l.base
                                                ? "Stop serving this workflow and give its VRAM back. The machine keeps serving the others; this ComfyUI stays up (models unloaded) and is reused by the next workflow you serve."
                                                : 'Stop this lane and give its VRAM back. The machine keeps serving the others.'}
                                        >
                                            {closing ? <RefreshCw size={13} className="animate-spin" /> : <Square size={13} />}
                                            <span>{closing ? 'Closing…' : 'Close lane'}</span>
                                        </button>
                                    )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </>
            )}
        </Card>
    );
};

export default RunningWorkflows;
