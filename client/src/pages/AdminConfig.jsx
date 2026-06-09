import React, { useState, useEffect } from 'react';
import { Power, Save, ArrowLeft, Upload, RefreshCw, Settings, KeyRound, CheckCircle2, AlertTriangle, Pencil, Trash2, OctagonAlert, ShieldCheck, XCircle, RotateCcw, Eraser, History } from 'lucide-react';
import WorkflowSelector from '../components/WorkflowSelector';
import WorkflowMetaEditor from '../components/admin/WorkflowMetaEditor';
import Modal from '../components/ui/Modal';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import ThemeToggle from '../components/ui/ThemeToggle';
import { SERVER_URL } from '../utils/api';

const PRESET_PYTHON_HINTS = [
    { label: 'Portable (Windows)', value: '../python_embeded/python.exe' },
    { label: 'System Python (POSIX)', value: 'python3' },
    { label: 'System Python (Windows)', value: 'python' }
];

const AdminConfig = ({ currentMode }) => {
    const [config, setConfig] = useState(null);
    const [hasAdminPassword, setHasAdminPassword] = useState(false);
    const [loading, setLoading] = useState(true);
    const [pathDraft, setPathDraft] = useState({});
    const [pickedWorkflow, setPickedWorkflow] = useState(null);
    const [isActivating, setIsActivating] = useState(false);
    const [adminPassword, setAdminPassword] = useState('');
    const [passwordValid, setPasswordValid] = useState(false);
    const [newAdminPassword, setNewAdminPassword] = useState('');
    const [pwSaving, setPwSaving] = useState(false);
    const [toast, setToast] = useState(null);
    const [uploading, setUploading] = useState(false);
    const [editingWorkflowId, setEditingWorkflowId] = useState(null);
    const [refreshKey, setRefreshKey] = useState(0);
    const [deletingWorkflowId, setDeletingWorkflowId] = useState(null);
    const [calibratingIds, setCalibratingIds] = useState(new Set());
    const [showEmergencyConfirm, setShowEmergencyConfirm] = useState(false);
    const [emergencyStopping, setEmergencyStopping] = useState(false);
    const [pathChecks, setPathChecks] = useState(null);
    const [checkingPaths, setCheckingPaths] = useState(false);
    const [showCleanupConfirm, setShowCleanupConfirm] = useState(false);
    const [cleaningOutputs, setCleaningOutputs] = useState(false);
    const [showClearHistoryConfirm, setShowClearHistoryConfirm] = useState(false);
    const [clearingHistory, setClearingHistory] = useState(false);

    useEffect(() => { reloadConfig(); }, []);

    // Debounced password verification — hits the no-op /admin/verify-password
    // endpoint whenever the operator pauses typing, so the "Admin password is
    // set" chip can switch green once the correct password is entered. No
    // side effects on the server; never requested when no password is
    // configured (chip isn't rendered in that case).
    useEffect(() => {
        if (!hasAdminPassword || !adminPassword) {
            setPasswordValid(false);
            return;
        }
        let cancelled = false;
        const t = setTimeout(async () => {
            try {
                const res = await fetch(`${SERVER_URL}/admin/verify-password`, {
                    method: 'POST',
                    headers: { 'X-Admin-Password': adminPassword }
                });
                const data = await res.json();
                if (!cancelled) setPasswordValid(!!data.valid);
            } catch {
                if (!cancelled) setPasswordValid(false);
            }
        }, 300);
        return () => { cancelled = true; clearTimeout(t); };
    }, [adminPassword, hasAdminPassword]);

    const reloadConfig = async () => {
        setLoading(true);
        try {
            const res = await fetch(`${SERVER_URL}/admin/config`);
            const data = await res.json();
            setConfig(data.config);
            setHasAdminPassword(data.hasAdminPassword);
            setPathDraft({
                root_path: data.config.comfy_ui.root_path,
                python_executable: data.config.comfy_ui.python_executable,
                output_dir: data.config.comfy_ui.output_dir,
                api_host: data.config.comfy_ui.api_host,
                api_port: data.config.comfy_ui.api_port,
                lan_access: data.config.comfy_ui.lan_access ?? false,
                installation_type: data.config.comfy_ui.installation_type,
                vramBudgetGb: data.config.comfy_ui.vramBudgetGb
            });
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const showToast = (msg, kind = 'ok') => {
        setToast({ msg, kind });
        setTimeout(() => setToast(null), 4000);
    };

    const adminHeaders = () => {
        const h = { 'Content-Type': 'application/json' };
        if (adminPassword) h['X-Admin-Password'] = adminPassword;
        return h;
    };

    const savePaths = async () => {
        try {
            const res = await fetch(`${SERVER_URL}/admin/comfy`, {
                method: 'PUT', headers: adminHeaders(), body: JSON.stringify(pathDraft)
            });
            if (!res.ok) throw new Error((await res.json()).error || 'Failed to save paths');
            showToast('ComfyUI paths saved');
            await reloadConfig();
        } catch (e) { showToast(e.message, 'err'); }
    };

    const resetPathsToDefaults = async () => {
        try {
            const res = await fetch(`${SERVER_URL}/admin/default-paths`);
            if (!res.ok) throw new Error('Failed to load defaults');
            const defaults = await res.json();
            setPathDraft(prev => ({ ...prev, ...defaults }));
            setPathChecks(null);
            showToast('Form reset to workshop defaults — click Save settings to apply');
        } catch (e) { showToast(e.message, 'err'); }
    };

    const checkPaths = async () => {
        setCheckingPaths(true);
        setPathChecks(null);
        try {
            const res = await fetch(`${SERVER_URL}/admin/check-paths`, {
                method: 'POST', headers: adminHeaders(), body: JSON.stringify(pathDraft)
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Check failed');
            setPathChecks(data);
            showToast(data.ok ? 'All paths look good' : 'Some paths failed validation', data.ok ? 'ok' : 'err');
        } catch (e) {
            showToast(e.message, 'err');
        } finally {
            setCheckingPaths(false);
        }
    };

    const setPassword = async () => {
        setPwSaving(true);
        try {
            const res = await fetch(`${SERVER_URL}/admin/admin-password`, {
                method: 'PUT', headers: adminHeaders(),
                body: JSON.stringify({ password: newAdminPassword })
            });
            if (!res.ok) throw new Error((await res.json()).error || 'Failed to set password');
            showToast(newAdminPassword ? 'Admin password set' : 'Admin password cleared');
            setNewAdminPassword('');
            await reloadConfig();
        } catch (e) {
            showToast(e.message, 'err');
        } finally {
            setPwSaving(false);
        }
    };

    const activate = async () => {
        if (!pickedWorkflow) return;
        setIsActivating(true);
        try {
            const res = await fetch(`${SERVER_URL}/admin/activate-workflow`, {
                method: 'POST', headers: adminHeaders(),
                body: JSON.stringify({ workflowId: pickedWorkflow.id })
            });
            if (!res.ok) throw new Error((await res.json()).error || 'Failed to activate');
            showToast('Activating workflow and switching to student mode…');
            // Server will exit; nodemon will restart. Reload after a moment.
            setTimeout(() => window.location.assign('/user'), 2000);
        } catch (e) {
            showToast(e.message, 'err');
            setIsActivating(false);
        }
    };

    const emergencyStop = async () => {
        setEmergencyStopping(true);
        try {
            const res = await fetch(`${SERVER_URL}/admin/emergency-stop`, {
                method: 'POST', headers: adminHeaders()
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || 'Emergency stop failed');
            const parts = [];
            if (data.cancelledScheduled) parts.push(`${data.cancelledScheduled} scheduled cancelled`);
            if (data.failedInFlight) parts.push(`${data.failedInFlight} in-flight failed`);
            if (data.killedComfy) parts.push('ComfyUI killed');
            showToast(`Emergency stop: ${parts.join(', ') || 'no active jobs'} — restarting in admin mode…`);
            setTimeout(() => window.location.reload(), 2500);
        } catch (e) {
            showToast(e.message, 'err');
            setEmergencyStopping(false);
            setShowEmergencyConfirm(false);
        }
    };

    const cleanupOutputs = async () => {
        setCleaningOutputs(true);
        try {
            const res = await fetch(`${SERVER_URL}/admin/cleanup-outputs`, {
                method: 'POST', headers: adminHeaders()
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || 'Cleanup failed');
            const errs = data.errors?.length ? `, ${data.errors.length} error(s)` : '';
            const skipped = data.skippedInFlight ? `, ${data.skippedInFlight} in-flight skipped` : '';
            showToast(`Cleaned ${data.filesDeleted} file(s) across ${data.jobsCleared} job(s)${skipped}${errs}`);
            setShowCleanupConfirm(false);
        } catch (e) {
            showToast(e.message, 'err');
        } finally {
            setCleaningOutputs(false);
        }
    };

    const clearHistory = async () => {
        setClearingHistory(true);
        try {
            const res = await fetch(`${SERVER_URL}/admin/clear-history`, {
                method: 'POST', headers: adminHeaders()
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || 'Clear history failed');
            const files = data.filesDeleted ? `, ${data.filesDeleted} file(s) removed` : '';
            const errs = data.errors?.length ? `, ${data.errors.length} error(s)` : '';
            showToast(`Deleted ${data.jobsDeleted} job record(s)${files}${errs}`);
            setShowClearHistoryConfirm(false);
        } catch (e) {
            showToast(e.message, 'err');
        } finally {
            setClearingHistory(false);
        }
    };

    const resetToAdmin = async () => {
        try {
            const res = await fetch(`${SERVER_URL}/admin/reset-to-admin`, {
                method: 'POST', headers: adminHeaders()
            });
            if (!res.ok) throw new Error((await res.json()).error || 'Failed');
            showToast('Resetting to admin mode…');
            setTimeout(() => window.location.reload(), 2000);
        } catch (e) { showToast(e.message, 'err'); }
    };

    const calibrateWorkflow = async (id) => {
        setCalibratingIds(prev => new Set(prev).add(id));
        try {
            const res = await fetch(`${SERVER_URL}/workflows/${id}/calibrate`, {
                method: 'POST', headers: adminHeaders()
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Calibration failed');
            const r = data.runtime || {};
            showToast(`Calibrated "${id}": ~${r.estimatedDurationSec}s generation${r.modelLoadSec ? ` (+${r.modelLoadSec}s first-load)` : ''}`);
            setRefreshKey(k => k + 1);
        } catch (err) {
            showToast(err.message, 'err');
        } finally {
            setCalibratingIds(prev => { const next = new Set(prev); next.delete(id); return next; });
        }
    };

    const deleteWorkflow = async (id) => {
        try {
            const res = await fetch(`${SERVER_URL}/admin/workflows/${id}`, {
                method: 'DELETE', headers: adminHeaders()
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || 'Delete failed');
            showToast(`Workflow "${id}" deleted`);
            setRefreshKey(k => k + 1);
            setPickedWorkflow(prev => (prev?.id === id ? null : prev));
        } catch (err) {
            showToast(err.message, 'err');
        } finally {
            setDeletingWorkflowId(null);
        }
    };

    const uploadWorkflow = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setUploading(true);
        try {
            const fd = new FormData();
            fd.append('workflow', file);
            const headers = {};
            if (adminPassword) headers['X-Admin-Password'] = adminPassword;
            const res = await fetch(`${SERVER_URL}/admin/upload-workflow`, {
                method: 'POST', headers, body: fd
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Upload failed');
            showToast(`Workflow "${data.id}" registered (${data.parameterCount} parameters detected)`);
            await fetch(`${SERVER_URL}/workflows/refresh`, { method: 'POST' });
            setEditingWorkflowId(data.id);
        } catch (err) { showToast(err.message, 'err'); }
        finally { setUploading(false); e.target.value = ''; }
    };

    if (loading) {
        return (
            <div className="h-screen w-full bg-background flex items-center justify-center">
                <RefreshCw className="w-6 h-6 text-primary animate-spin" />
            </div>
        );
    }

    const pathsConfigured = !!(config?.comfy_ui?.root_path && config?.comfy_ui?.python_executable);

    return (
        <div className="min-h-screen bg-background text-foreground p-4 sm:p-8 space-y-6">
            <header className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-surface border border-border rounded-xl flex items-center justify-center">
                        <Settings className="w-5 h-5 text-muted" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight">ComfyQ Admin</h1>
                        <p className="text-xs text-muted">Server is in <Badge variant={config.mode === 'student' ? 'success' : 'warning'}>{config.mode}</Badge> mode</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <ThemeToggle />
                    {config.mode === 'student' && (
                        <Button variant="ghost" onClick={() => window.location.assign('/user')} icon={ArrowLeft}>Back to user</Button>
                    )}
                    {config.mode === 'student' && (
                        <Button variant="secondary" onClick={resetToAdmin} icon={Power}>Reset to admin</Button>
                    )}
                    {config.mode === 'student' && (
                        <Button variant="danger" onClick={() => setShowEmergencyConfirm(true)} icon={OctagonAlert}>
                            Stop &amp; kill all
                        </Button>
                    )}
                </div>
            </header>

            {toast && (
                <div className={`fixed top-4 right-4 z-50 px-4 py-2 rounded-lg shadow-lg flex items-center gap-2 ${toast.kind === 'err' ? 'bg-danger/20 text-danger border border-danger/30' : 'bg-primary/20 text-primary border border-primary/30'}`}>
                    {toast.kind === 'err' ? <AlertTriangle size={16} /> : <CheckCircle2 size={16} />}
                    {toast.msg}
                </div>
            )}

            {hasAdminPassword && (
                <Card className={passwordValid ? 'border-success/40' : 'border-warning/30'}>
                    <div className={`flex items-center gap-2 mb-2 ${passwordValid ? 'text-success' : 'text-warning'}`}>
                        {passwordValid ? <CheckCircle2 size={16} /> : <KeyRound size={16} />}
                        <span className="font-medium">
                            {passwordValid ? 'Admin password verified' : 'Admin password is set'}
                        </span>
                    </div>
                    <p className="text-xs text-muted mb-3">
                        {passwordValid
                            ? 'You can perform destructive actions below.'
                            : 'Provide the password to make changes below.'}
                    </p>
                    <input
                        type="password"
                        value={adminPassword}
                        onChange={(e) => setAdminPassword(e.target.value)}
                        placeholder="Admin password"
                        className={`w-full bg-background border rounded-lg p-2.5 text-white transition-colors ${passwordValid ? 'border-success/50 focus:border-success' : 'border-border'}`}
                    />
                </Card>
            )}

            <Card>
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold flex items-center gap-2"><Settings size={18} /> ComfyUI Settings</h2>
                    {pathsConfigured && <Badge variant="success">Configured</Badge>}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Field label="ComfyUI root path" value={pathDraft.root_path || ''}
                        onChange={v => setPathDraft({ ...pathDraft, root_path: v })}
                        placeholder="C:\\Apps\\AI\\ComfyUI_portable\\ComfyUI" />
                    <Field label="Python executable" value={pathDraft.python_executable || ''}
                        onChange={v => setPathDraft({ ...pathDraft, python_executable: v })}
                        placeholder="../python_embeded/python.exe">
                        <div className="flex gap-1 mt-1">
                            {PRESET_PYTHON_HINTS.map(p => (
                                <button key={p.value} type="button"
                                    onClick={() => setPathDraft({ ...pathDraft, python_executable: p.value })}
                                    className="text-[10px] px-2 py-0.5 bg-surface border border-border rounded hover:border-primary/50 text-muted">
                                    {p.label}
                                </button>
                            ))}
                        </div>
                    </Field>
                    <Field label="Output directory" value={pathDraft.output_dir || ''}
                        onChange={v => setPathDraft({ ...pathDraft, output_dir: v })}
                        placeholder="output" />
                    <Field label="VRAM budget (GB)" type="number" value={pathDraft.vramBudgetGb || 24}
                        onChange={v => setPathDraft({ ...pathDraft, vramBudgetGb: parseFloat(v) })} />
                    <Field label="ComfyUI API host" value={pathDraft.api_host || '127.0.0.1'}
                        onChange={v => setPathDraft({ ...pathDraft, api_host: v })} />
                    <Field label="ComfyUI API port" type="number" value={pathDraft.api_port || 8188}
                        onChange={v => setPathDraft({ ...pathDraft, api_port: parseInt(v, 10) })} />
                    <div className="space-y-1.5 sm:col-span-2">
                        <label className="flex items-start gap-2.5 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={!!pathDraft.lan_access}
                                onChange={(e) => setPathDraft({ ...pathDraft, lan_access: e.target.checked })}
                                className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
                            />
                            <span className="text-sm text-white">
                                Expose ComfyUI to the LAN
                                <span className="block text-xs text-muted">
                                    Binds ComfyUI to 0.0.0.0 so people on the network can open its native web UI
                                    (http://&lt;this-machine&gt;:{pathDraft.api_port || 8188}) and run classic workflows on this GPU.
                                    ComfyQ still connects over localhost. Restart required after changing.
                                </span>
                            </span>
                        </label>
                    </div>
                </div>
                {pathChecks && (
                    <div className="mt-4 rounded-lg border border-border bg-surface/50 p-3 text-sm">
                        <div className={`mb-2 font-medium ${pathChecks.ok ? 'text-success' : 'text-danger'}`}>
                            {pathChecks.ok ? 'All checks passed' : 'Some checks failed'}
                        </div>
                        <ul className="space-y-1">
                            {pathChecks.checks.map((c, i) => (
                                <li key={i} className="flex items-start gap-2">
                                    {c.ok
                                        ? <CheckCircle2 size={16} className="text-success mt-0.5 shrink-0" />
                                        : <XCircle size={16} className="text-danger mt-0.5 shrink-0" />}
                                    <div className="min-w-0">
                                        <div className="text-white">{c.label}</div>
                                        <div className="text-xs text-muted break-all">{c.detail}</div>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
                <div className="mt-4 flex justify-end gap-2">
                    <Button variant="ghost" icon={RotateCcw} onClick={resetPathsToDefaults}>
                        Reset to defaults
                    </Button>
                    <Button variant="secondary" icon={ShieldCheck}
                        disabled={checkingPaths}
                        onClick={checkPaths}>
                        {checkingPaths ? 'Checking…' : 'Check paths'}
                    </Button>
                    <Button variant="primary" icon={Save} onClick={savePaths}>Save settings</Button>
                </div>
            </Card>

            <Card>
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold flex items-center gap-2"><Upload size={18} /> Add Workflow</h2>
                </div>
                <p className="text-sm text-muted mb-3">
                    Upload a ComfyUI workflow saved in <strong className="text-white">API Format</strong>
                    (Settings → Dev mode → "Save (API Format)"). v2 does not auto-convert standard saves.
                </p>
                <label className="block">
                    <input type="file" accept=".json,application/json" onChange={uploadWorkflow}
                        disabled={uploading}
                        className="block w-full text-sm text-muted file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-primary/10 file:text-primary hover:file:bg-primary/20" />
                </label>
            </Card>

            <Card>
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold">Workflow library</h2>
                    {config.workflows.activeWorkflowId && (
                        <Badge variant="primary">Active: {config.workflows.activeWorkflowId}</Badge>
                    )}
                </div>
                <WorkflowSelector
                    key={refreshKey}
                    selectedWorkflowId={config.workflows.activeWorkflowId}
                    activeWorkflowId={config.workflows.activeWorkflowId}
                    onSelect={(w) => setPickedWorkflow(w)}
                    onEdit={(id) => setEditingWorkflowId(id)}
                    onDelete={(id) => setDeletingWorkflowId(id)}
                    onCalibrate={(id) => calibrateWorkflow(id)}
                    calibratingIds={calibratingIds}
                />
                <div className="mt-6 flex items-center justify-end gap-2 flex-wrap">
                    {pickedWorkflow && <span className="text-xs text-muted mr-auto">Selected: <code>{pickedWorkflow.id}</code></span>}
                    <Button variant="secondary" icon={Pencil}
                        disabled={!pickedWorkflow}
                        onClick={() => pickedWorkflow && setEditingWorkflowId(pickedWorkflow.id)}>
                        Edit metadata
                    </Button>
                    <Button variant="primary" icon={Power}
                        disabled={!pickedWorkflow || isActivating || !pathsConfigured}
                        onClick={activate}>
                        {isActivating ? 'Activating…' : 'Activate & start student mode'}
                    </Button>
                </div>
            </Card>

            <WorkflowMetaEditor
                workflowId={editingWorkflowId}
                adminPassword={adminPassword}
                onClose={() => setEditingWorkflowId(null)}
                onSaved={() => {
                    setRefreshKey(k => k + 1);
                    showToast('Workflow metadata saved');
                }}
            />

            <Modal isOpen={showEmergencyConfirm} onClose={() => !emergencyStopping && setShowEmergencyConfirm(false)}
                title="Stop everything and kill ComfyUI?" maxWidth="max-w-md">
                <div className="space-y-4">
                    <p className="text-sm text-slate-300">
                        This will:
                    </p>
                    <ul className="text-sm text-slate-300 space-y-1.5 list-disc pl-5">
                        <li>Cancel every scheduled job</li>
                        <li>Mark every in-flight job as failed (<code className="text-xs">emergency-stop</code>)</li>
                        <li>Kill the ComfyUI process if ComfyQ spawned it (external attached ComfyUI is left alone)</li>
                        <li>Switch the server to admin mode and restart it</li>
                    </ul>
                    <p className="text-xs text-warning">
                        Use this when something is stuck or generating something it shouldn't.
                    </p>
                    <div className="flex justify-end gap-2 pt-2 border-t border-border">
                        <Button variant="ghost" onClick={() => setShowEmergencyConfirm(false)}
                            disabled={emergencyStopping}>Cancel</Button>
                        <Button variant="danger" icon={OctagonAlert} onClick={emergencyStop}
                            isLoading={emergencyStopping}>
                            {emergencyStopping ? 'Stopping…' : 'Yes, stop everything'}
                        </Button>
                    </div>
                </div>
            </Modal>

            <Modal isOpen={!!deletingWorkflowId} onClose={() => setDeletingWorkflowId(null)}
                title="Delete workflow?" maxWidth="max-w-md">
                <div className="space-y-4">
                    <p className="text-sm text-slate-300">
                        This will permanently delete the workflow folder
                        <code className="mx-1 px-1.5 py-0.5 bg-surface rounded text-primary">{deletingWorkflowId}</code>
                        including its <code>api.json</code>, <code>meta.json</code>, and any calibration data.
                    </p>
                    <p className="text-xs text-muted">
                        Existing job records that reference this workflow will remain in the queue but won't be runnable.
                    </p>
                    <div className="flex justify-end gap-2 pt-2 border-t border-border">
                        <Button variant="ghost" onClick={() => setDeletingWorkflowId(null)}>Cancel</Button>
                        <Button variant="danger" icon={Trash2} onClick={() => deleteWorkflow(deletingWorkflowId)}>
                            Delete workflow
                        </Button>
                    </div>
                </div>
            </Modal>

            <Card>
                <h2 className="text-lg font-semibold flex items-center gap-2 mb-3"><Eraser size={18} /> Cleanup</h2>
                <p className="text-xs text-muted mb-3">
                    Delete every output file referenced by completed jobs and clear the outputs from each job record.
                    Job history (prompts, timestamps, users) is preserved — only the rendered images / videos are removed from disk.
                </p>
                <div className="flex justify-end">
                    <Button variant="danger" icon={Eraser} onClick={() => setShowCleanupConfirm(true)}>
                        Clean all outputs
                    </Button>
                </div>
            </Card>

            <Modal isOpen={showCleanupConfirm} onClose={() => !cleaningOutputs && setShowCleanupConfirm(false)}
                title="Delete all output files?" maxWidth="max-w-md">
                <div className="space-y-4">
                    <div className="flex items-start gap-3">
                        <AlertTriangle size={20} className="text-danger shrink-0 mt-0.5" />
                        <p className="text-sm text-slate-300">
                            This permanently deletes every output file (images, videos, audio) referenced by completed jobs in this deployment, across all users. Job records are kept for history but their <code>outputs</code> field is cleared.
                        </p>
                    </div>
                    <p className="text-xs text-warning">
                        This action cannot be undone. Make sure students have downloaded anything they want to keep.
                    </p>
                    <div className="flex justify-end gap-2 pt-2 border-t border-border">
                        <Button variant="ghost" onClick={() => setShowCleanupConfirm(false)}
                            disabled={cleaningOutputs}>Cancel</Button>
                        <Button variant="danger" icon={Eraser} onClick={cleanupOutputs}
                            isLoading={cleaningOutputs}>
                            {cleaningOutputs ? 'Cleaning…' : 'Yes, delete all outputs'}
                        </Button>
                    </div>
                </div>
            </Modal>

            <Card>
                <h2 className="text-lg font-semibold flex items-center gap-2 mb-3"><History size={18} /> Clear job history</h2>
                <p className="text-xs text-muted mb-3">
                    Permanently delete all finished job records (completed, failed, cancelled) and their event logs, plus any output files they reference.
                    Scheduled and in-flight jobs are kept so a running queue isn't interrupted.
                </p>
                <div className="flex justify-end">
                    <Button variant="danger" icon={Trash2} onClick={() => setShowClearHistoryConfirm(true)}>
                        Clear all history
                    </Button>
                </div>
            </Card>

            <Modal isOpen={showClearHistoryConfirm} onClose={() => !clearingHistory && setShowClearHistoryConfirm(false)}
                title="Delete all job history?" maxWidth="max-w-md">
                <div className="space-y-4">
                    <div className="flex items-start gap-3">
                        <AlertTriangle size={20} className="text-danger shrink-0 mt-0.5" />
                        <p className="text-sm text-slate-300">
                            This permanently removes every finished job record (prompts, timestamps, users, events) across all users, and deletes the output files those jobs produced. Scheduled and in-flight jobs are preserved.
                        </p>
                    </div>
                    <p className="text-xs text-warning">
                        This action cannot be undone. Make sure students have downloaded anything they want to keep.
                    </p>
                    <div className="flex justify-end gap-2 pt-2 border-t border-border">
                        <Button variant="ghost" onClick={() => setShowClearHistoryConfirm(false)}
                            disabled={clearingHistory}>Cancel</Button>
                        <Button variant="danger" icon={Trash2} onClick={clearHistory}
                            isLoading={clearingHistory}>
                            {clearingHistory ? 'Clearing…' : 'Yes, delete all history'}
                        </Button>
                    </div>
                </div>
            </Modal>

            <Card>
                <h2 className="text-lg font-semibold flex items-center gap-2 mb-3"><KeyRound size={18} /> Admin password</h2>
                <p className="text-xs text-muted mb-3">
                    {hasAdminPassword
                        ? 'A password is set. Enter the current password above, then enter a new one (or leave blank to disable).'
                        : 'No password set yet. Anyone with access to /admin can change settings. Set one to gate destructive actions.'}
                </p>
                <div className="flex items-center gap-2">
                    <input type="password" value={newAdminPassword}
                        onChange={(e) => setNewAdminPassword(e.target.value)}
                        placeholder="New admin password (blank to clear)"
                        className="flex-1 bg-background border border-border rounded-lg p-2.5 text-white" />
                    <Button variant="primary" onClick={setPassword} disabled={pwSaving}>
                        {pwSaving ? 'Saving…' : 'Save'}
                    </Button>
                </div>
            </Card>
        </div>
    );
};

const Field = ({ label, value, onChange, type = 'text', placeholder, children }) => (
    <div className="space-y-1.5">
        <label className="text-xs uppercase tracking-wider text-muted font-semibold">{label}</label>
        <input
            type={type}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            className="w-full bg-background border border-border rounded-lg p-2.5 text-white font-mono text-sm"
        />
        {children}
    </div>
);

export default AdminConfig;
