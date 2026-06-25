import React, { useEffect, useState, useMemo } from 'react';
import { Save, X, Eye, EyeOff, AlertTriangle, RefreshCw, CheckCircle2, Filter, ArrowUp, ArrowDown } from 'lucide-react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import { SERVER_URL } from '../../utils/api';

const CATEGORIES = [
    { value: 't2i', label: 'Text to Image' },
    { value: 'image-edit', label: 'Image Editing' },
    { value: 'i2v', label: 'Image to Video' },
    { value: 'i2i', label: 'Image to Image' },
    { value: 'audio', label: 'Audio Generation' },
    { value: '3d', label: '3D Generation' },
    { value: 'preprocessor', label: 'Preprocessor' },
    { value: 'description', label: 'Description (image/video → text)' },
    { value: 'other', label: 'Other' }
];

const PARAM_TYPES = ['text', 'textarea', 'number', 'select', 'checkbox', 'image', 'video', 'audio', 'mask'];

// Field names that are usually infrastructure, not student-facing.
const INFRASTRUCTURE_FIELDS = new Set([
    'unet_name', 'vae_name', 'clip_name', 'clip_name1', 'clip_name2',
    'weight_dtype', 'device', 'type', 'upscale_method', 'resolution_steps',
    'megapixels', 'batch_size'
]);

const isInfrastructureParam = (p) => INFRASTRUCTURE_FIELDS.has(p.field);

const WorkflowMetaEditor = ({ workflowId, adminPassword, onClose, onSaved }) => {
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);
    const [meta, setMeta] = useState(null);
    const [params, setParams] = useState([]);
    const [filter, setFilter] = useState('all'); // all | enabled | disabled

    const headers = useMemo(() => {
        const h = { 'Content-Type': 'application/json' };
        if (adminPassword) h['X-Admin-Password'] = adminPassword;
        return h;
    }, [adminPassword]);

    useEffect(() => {
        if (!workflowId) return;
        let cancelled = false;
        (async () => {
            setLoading(true); setError(null);
            try {
                const res = await fetch(`${SERVER_URL}/admin/workflows/${workflowId}/edit-data`, { headers });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || 'Failed to load workflow');
                if (cancelled) return;
                setMeta(data.meta);
                setParams(data.detectedParameters);
            } catch (e) {
                if (!cancelled) setError(e.message);
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [workflowId, headers]);

    const updateMeta = (patch) => setMeta(m => ({ ...m, ...patch }));

    const updateParam = (idx, patch) => {
        setParams(prev => prev.map((p, i) => i === idx ? { ...p, ...patch } : p));
    };

    const setAllEnabled = (enabled) => {
        setParams(prev => prev.map(p => ({ ...p, enabled })));
    };

    // Reorder a parameter relative to the *visible* list. "up" / "down"
    // swap with the previous / next param in the same filtered view, but
    // we mutate the underlying `params` array directly so the persisted
    // `order` field (set at save time from the array index) matches the
    // admin's intended ordering. Disabled (hidden) items keep their
    // relative positions and are not skipped over here — that mirrors what
    // students will see when the filter is "all".
    const moveParam = (visibleIdx, direction) => {
        const current = visibleParams[visibleIdx];
        const swapWith = visibleParams[visibleIdx + (direction === 'up' ? -1 : 1)];
        if (!current || !swapWith) return;
        const a = params.indexOf(current);
        const b = params.indexOf(swapWith);
        if (a < 0 || b < 0) return;
        setParams(prev => {
            const next = prev.slice();
            [next[a], next[b]] = [next[b], next[a]];
            return next;
        });
    };

    const hideInfrastructure = () => {
        setParams(prev => prev.map(p => isInfrastructureParam(p) ? { ...p, enabled: false } : p));
    };

    const visibleParams = useMemo(() => {
        if (filter === 'enabled') return params.filter(p => p.enabled);
        if (filter === 'disabled') return params.filter(p => !p.enabled);
        return params;
    }, [params, filter]);

    const enabledCount = params.filter(p => p.enabled).length;

    const save = async () => {
        if (!meta) return;
        setSaving(true); setError(null);
        try {
            const exposedParameters = params
                .filter(p => p.enabled)
                .map((p, i) => ({
                    key: p.key,
                    nodeId: p.nodeId,
                    field: p.field,
                    type: p.type,
                    label: p.label,
                    default: coerceDefault(p),
                    options: p.options && p.options.length > 0 ? p.options : undefined,
                    min: p.min,
                    max: p.max,
                    step: p.step,
                    // Only persisted when set on image/video params. Stored as
                    // an int; the schema rejects 0/negatives.
                    maxInputEdge: (p.type === 'image' || p.type === 'video' || p.type === 'mask') && p.maxInputEdge
                        ? Math.max(1, parseInt(p.maxInputEdge, 10))
                        : undefined,
                    required: p.required ?? false,
                    order: i
                }));
            const payload = {
                ...meta,
                exposedParameters
            };
            const res = await fetch(`${SERVER_URL}/admin/workflows/${workflowId}/meta`, {
                method: 'PUT', headers, body: JSON.stringify(payload)
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Save failed');
            await fetch(`${SERVER_URL}/workflows/refresh`, { method: 'POST' });
            if (onSaved) onSaved(workflowId);
            onClose();
        } catch (e) {
            setError(e.message);
        } finally {
            setSaving(false);
        }
    };

    if (!workflowId) return null;

    return (
        <Modal isOpen={!!workflowId} onClose={onClose} title={`Edit workflow: ${workflowId}`} maxWidth="max-w-5xl">
            {loading && (
                <div className="flex items-center justify-center py-12 text-muted">
                    <RefreshCw className="w-5 h-5 animate-spin mr-2" />
                    Loading workflow…
                </div>
            )}

            {!loading && error && (
                <div className="p-4 bg-danger/10 border border-danger/30 rounded-lg flex items-center gap-2 text-danger">
                    <AlertTriangle size={16} /> {error}
                </div>
            )}

            {!loading && meta && (
                <div className="space-y-6">
                    {/* Basic info */}
                    <section className="space-y-3">
                        <h4 className="text-sm font-semibold uppercase tracking-wider text-muted">Basic info</h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <Field label="Name" value={meta.name} onChange={v => updateMeta({ name: v })} />
                            <Field label="Category" type="select" value={meta.category}
                                onChange={v => updateMeta({ category: v })}
                                options={CATEGORIES} />
                            <Field label="Author" value={meta.author} onChange={v => updateMeta({ author: v })} />
                            <Field label="Version" value={meta.version} onChange={v => updateMeta({ version: v })} />
                            <Field label="Estimated duration (s)" type="number"
                                value={meta.estimatedDurationSec}
                                onChange={v => updateMeta({ estimatedDurationSec: parseFloat(v) || 60 })} />
                            <Field label="Max runtime (s)" type="number"
                                value={meta.maxRuntimeSec}
                                onChange={v => updateMeta({ maxRuntimeSec: parseFloat(v) || 600 })} />
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-xs uppercase tracking-wider text-muted font-semibold">Description</label>
                            <textarea
                                value={meta.description || ''}
                                onChange={(e) => updateMeta({ description: e.target.value })}
                                className="w-full bg-background border border-border rounded-lg p-2.5 text-white text-sm min-h-[60px]"
                            />
                        </div>
                    </section>

                    {/* Parameters */}
                    <section className="space-y-3">
                        <div className="flex items-center justify-between flex-wrap gap-2">
                            <div className="flex items-center gap-3">
                                <h4 className="text-sm font-semibold uppercase tracking-wider text-muted">
                                    Parameters
                                </h4>
                                <span className="text-xs text-muted">
                                    {enabledCount} of {params.length} exposed
                                </span>
                            </div>
                            <div className="flex items-center gap-2 text-xs">
                                <button onClick={hideInfrastructure}
                                    className="px-2 py-1 rounded bg-surface border border-border hover:border-primary/40 text-muted hover:text-white">
                                    <Filter size={12} className="inline -mt-0.5 mr-1" />
                                    Hide infrastructure
                                </button>
                                <button onClick={() => setAllEnabled(true)}
                                    className="px-2 py-1 rounded bg-surface border border-border hover:border-primary/40 text-muted hover:text-white">
                                    Enable all
                                </button>
                                <button onClick={() => setAllEnabled(false)}
                                    className="px-2 py-1 rounded bg-surface border border-border hover:border-primary/40 text-muted hover:text-white">
                                    Disable all
                                </button>
                                <select value={filter} onChange={e => setFilter(e.target.value)}
                                    className="bg-surface border border-border rounded px-2 py-1 text-muted">
                                    <option value="all">Show all</option>
                                    <option value="enabled">Only enabled</option>
                                    <option value="disabled">Only disabled</option>
                                </select>
                            </div>
                        </div>

                        <p className="text-[10px] text-muted">
                            Drag-equivalent: use the ▲/▼ buttons to reorder. The order set here is exactly the order students see in the booking dialog.
                        </p>
                        <div className="space-y-2 max-h-[60vh] overflow-y-auto custom-scrollbar pr-2">
                            {visibleParams.map((p, visibleIdx) => {
                                const idx = params.indexOf(p);
                                const isFirst = visibleIdx === 0;
                                const isLast = visibleIdx === visibleParams.length - 1;
                                return (
                                    <div key={p.key}
                                        className={`p-3 rounded-lg border transition-colors ${p.enabled ? 'bg-surface border-primary/30' : 'bg-surface/40 border-border opacity-70'}`}>
                                        <div className="flex items-start gap-3">
                                            <div className="flex flex-col items-center gap-1 shrink-0">
                                                <button onClick={() => updateParam(idx, { enabled: !p.enabled })}
                                                    className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${p.enabled ? 'bg-primary border-primary text-white' : 'border-slate-500 hover:border-slate-300'}`}
                                                    title={p.enabled ? 'Hide from students' : 'Show to students'}>
                                                    {p.enabled ? <Eye size={12} /> : <EyeOff size={12} />}
                                                </button>
                                                <button onClick={() => moveParam(visibleIdx, 'up')}
                                                    disabled={isFirst}
                                                    className="w-5 h-5 rounded border border-border text-muted hover:text-white hover:border-primary/40 disabled:opacity-30 disabled:hover:text-muted disabled:hover:border-border flex items-center justify-center transition-colors"
                                                    title="Move up">
                                                    <ArrowUp size={12} />
                                                </button>
                                                <button onClick={() => moveParam(visibleIdx, 'down')}
                                                    disabled={isLast}
                                                    className="w-5 h-5 rounded border border-border text-muted hover:text-white hover:border-primary/40 disabled:opacity-30 disabled:hover:text-muted disabled:hover:border-border flex items-center justify-center transition-colors"
                                                    title="Move down">
                                                    <ArrowDown size={12} />
                                                </button>
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2 text-[10px] text-muted mb-2 font-mono">
                                                    <span className="bg-black/30 px-1.5 py-0.5 rounded">#{visibleIdx + 1}</span>
                                                    <span>·</span>
                                                    <span className="bg-black/30 px-1.5 py-0.5 rounded">node {p.nodeId}</span>
                                                    <span>·</span>
                                                    <span className="opacity-70 truncate">{p.field}</span>
                                                </div>
                                                <div className="grid grid-cols-1 md:grid-cols-12 gap-2 items-start">
                                                    <div className="md:col-span-5 space-y-1">
                                                        <label className="text-[10px] uppercase tracking-wider text-muted font-semibold">Display name (shown to students)</label>
                                                        <input type="text" value={p.label || ''}
                                                            disabled={!p.enabled}
                                                            onChange={e => updateParam(idx, { label: e.target.value })}
                                                            className="w-full bg-background border border-border rounded px-2 py-1.5 text-sm text-white disabled:opacity-50" />
                                                    </div>
                                                    <div className="md:col-span-3 space-y-1">
                                                        <label className="text-[10px] uppercase tracking-wider text-muted font-semibold">Type</label>
                                                        <select value={p.type}
                                                            disabled={!p.enabled}
                                                            onChange={e => updateParam(idx, { type: e.target.value })}
                                                            className="w-full bg-background border border-border rounded px-2 py-1.5 text-sm text-white disabled:opacity-50">
                                                            {PARAM_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                                                        </select>
                                                    </div>
                                                    <div className="md:col-span-4 space-y-1">
                                                        <label className="text-[10px] uppercase tracking-wider text-muted font-semibold">Default</label>
                                                        {p.type === 'textarea' ? (
                                                            <textarea value={p.default ?? ''}
                                                                disabled={!p.enabled}
                                                                onChange={e => updateParam(idx, { default: e.target.value })}
                                                                className="w-full bg-background border border-border rounded px-2 py-1.5 text-sm text-white disabled:opacity-50 min-h-[34px] resize-y" />
                                                        ) : p.type === 'checkbox' ? (
                                                            <select value={String(!!p.default)}
                                                                disabled={!p.enabled}
                                                                onChange={e => updateParam(idx, { default: e.target.value === 'true' })}
                                                                className="w-full bg-background border border-border rounded px-2 py-1.5 text-sm text-white disabled:opacity-50">
                                                                <option value="false">false</option>
                                                                <option value="true">true</option>
                                                            </select>
                                                        ) : (
                                                            <input type={p.type === 'number' ? 'number' : 'text'}
                                                                value={p.default ?? ''}
                                                                disabled={!p.enabled}
                                                                onChange={e => updateParam(idx, {
                                                                    default: p.type === 'number'
                                                                        ? (e.target.value === '' ? '' : parseFloat(e.target.value))
                                                                        : e.target.value
                                                                })}
                                                                className="w-full bg-background border border-border rounded px-2 py-1.5 text-sm text-white disabled:opacity-50" />
                                                        )}
                                                    </div>
                                                    {p.type === 'select' && p.enabled && (
                                                        <div className="md:col-span-12 space-y-1">
                                                            <label className="text-[10px] uppercase tracking-wider text-muted font-semibold">Options (comma-separated)</label>
                                                            <input type="text"
                                                                value={(p.options || []).join(', ')}
                                                                onChange={e => updateParam(idx, {
                                                                    options: e.target.value.split(',').map(s => s.trim()).filter(Boolean)
                                                                })}
                                                                className="w-full bg-background border border-border rounded px-2 py-1.5 text-sm text-white" />
                                                        </div>
                                                    )}
                                                    {p.type === 'number' && p.enabled && (
                                                        <div className="md:col-span-12 grid grid-cols-3 gap-2">
                                                            <NumField label="min" value={p.min} onChange={v => updateParam(idx, { min: v })} />
                                                            <NumField label="max" value={p.max} onChange={v => updateParam(idx, { max: v })} />
                                                            <NumField label="step" value={p.step} onChange={v => updateParam(idx, { step: v })} />
                                                        </div>
                                                    )}
                                                    {(p.type === 'image' || p.type === 'video' || p.type === 'mask') && p.enabled && (
                                                        <div className="md:col-span-12 space-y-1">
                                                            <label className="text-[10px] uppercase tracking-wider text-muted font-semibold">
                                                                Max input edge (px)
                                                            </label>
                                                            <input type="number" min="64" step="64"
                                                                placeholder={p.type === 'video' ? '1280 (default)' : '1024 (default)'}
                                                                value={p.maxInputEdge ?? ''}
                                                                onChange={e => updateParam(idx, {
                                                                    maxInputEdge: e.target.value === '' ? undefined : parseInt(e.target.value, 10)
                                                                })}
                                                                className="w-full bg-background border border-border rounded px-2 py-1.5 text-sm text-white" />
                                                            <p className="text-[10px] text-muted leading-snug">
                                                                Client downsizes the longer edge to this many pixels before upload — saves LAN bandwidth and matches the workflow's working resolution. Leave blank to use the {p.type === 'video' ? '1280' : '1024'}px default. Aspect ratio is preserved; never upscales.
                                                            </p>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                            {visibleParams.length === 0 && (
                                <p className="text-sm text-muted text-center py-8">No parameters match the filter.</p>
                            )}
                        </div>
                    </section>

                    <div className="flex justify-end gap-2 pt-2 border-t border-border">
                        <Button variant="ghost" onClick={onClose} icon={X}>Cancel</Button>
                        <Button variant="primary" onClick={save} icon={saving ? RefreshCw : Save}
                            disabled={saving}>
                            {saving ? 'Saving…' : 'Save metadata'}
                        </Button>
                    </div>
                </div>
            )}
        </Modal>
    );
};

const Field = ({ label, value, onChange, type = 'text', options }) => (
    <div className="space-y-1.5">
        <label className="text-xs uppercase tracking-wider text-muted font-semibold">{label}</label>
        {type === 'select' ? (
            <select value={value || ''} onChange={(e) => onChange(e.target.value)}
                className="w-full bg-background border border-border rounded-lg p-2 text-white text-sm">
                {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
        ) : (
            <input type={type} value={value ?? ''} onChange={(e) => onChange(e.target.value)}
                className="w-full bg-background border border-border rounded-lg p-2 text-white text-sm" />
        )}
    </div>
);

const NumField = ({ label, value, onChange }) => (
    <div className="space-y-1">
        <label className="text-[10px] uppercase tracking-wider text-muted font-semibold">{label}</label>
        <input type="number"
            value={value ?? ''}
            onChange={(e) => onChange(e.target.value === '' ? undefined : parseFloat(e.target.value))}
            className="w-full bg-background border border-border rounded px-2 py-1.5 text-sm text-white" />
    </div>
);

function coerceDefault(p) {
    if (p.type === 'number') {
        if (p.default === '' || p.default == null) return 0;
        const n = parseFloat(p.default);
        return isNaN(n) ? 0 : n;
    }
    if (p.type === 'checkbox') return !!p.default;
    return p.default ?? '';
}

export default WorkflowMetaEditor;
