import React, { useState, useEffect } from 'react';
import { Power, Save, ArrowLeft, Upload, RefreshCw, Settings, KeyRound, CheckCircle2, AlertTriangle } from 'lucide-react';
import WorkflowSelector from '../components/WorkflowSelector';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
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
    const [newAdminPassword, setNewAdminPassword] = useState('');
    const [pwSaving, setPwSaving] = useState(false);
    const [toast, setToast] = useState(null);
    const [uploading, setUploading] = useState(false);

    useEffect(() => { reloadConfig(); }, []);

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
        <div className="min-h-screen bg-background text-white p-4 sm:p-8 space-y-6">
            <header className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-gradient-to-br from-primary to-secondary rounded-xl flex items-center justify-center">
                        <Settings className="w-5 h-5" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight">ComfyQ Admin</h1>
                        <p className="text-xs text-muted">Server is in <Badge variant={config.mode === 'student' ? 'success' : 'warning'}>{config.mode}</Badge> mode</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {config.mode === 'student' && (
                        <Button variant="ghost" onClick={() => window.location.assign('/user')} icon={ArrowLeft}>Back to user</Button>
                    )}
                    {config.mode === 'student' && (
                        <Button variant="secondary" onClick={resetToAdmin} icon={Power}>Reset to admin</Button>
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
                <Card className="border-warning/30">
                    <div className="flex items-center gap-2 text-warning mb-2">
                        <KeyRound size={16} /><span className="font-medium">Admin password is set</span>
                    </div>
                    <p className="text-xs text-muted mb-3">Provide the password to make changes below.</p>
                    <input
                        type="password"
                        value={adminPassword}
                        onChange={(e) => setAdminPassword(e.target.value)}
                        placeholder="Admin password"
                        className="w-full bg-background border border-border rounded-lg p-2.5 text-white"
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
                </div>
                <div className="mt-4 flex justify-end">
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
                    selectedWorkflowId={config.workflows.activeWorkflowId}
                    onSelect={(w) => setPickedWorkflow(w)}
                />
                <div className="mt-6 flex items-center justify-end gap-2">
                    {pickedWorkflow && <span className="text-xs text-muted">Selected: <code>{pickedWorkflow.id}</code></span>}
                    <Button variant="primary" icon={Power}
                        disabled={!pickedWorkflow || isActivating || !pathsConfigured}
                        onClick={activate}>
                        {isActivating ? 'Activating…' : 'Activate & start student mode'}
                    </Button>
                </div>
            </Card>

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
