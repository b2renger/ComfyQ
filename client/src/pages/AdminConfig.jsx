import React, { useState, useEffect } from 'react';
import { LayoutDashboard, Save, ArrowLeft, RefreshCw, Power } from 'lucide-react';
import WorkflowUpload from '../components/admin/WorkflowUpload';
import ParameterSelector from '../components/admin/ParameterSelector';
import ConfigPreview from '../components/admin/ConfigPreview';
import { SERVER_URL } from '../utils/api';

const AdminConfig = ({ currentMode }) => {
    const [step, setStep] = useState(1); // 1: Upload, 2: Configure
    const [workflowData, setWorkflowData] = useState(null);
    const [parameters, setParameters] = useState([]);
    const [filename, setFilename] = useState('');
    const [warmupPrompt, setWarmupPrompt] = useState('A simple test generation');
    const [isSaving, setIsSaving] = useState(false);
    const [saveStatus, setSaveStatus] = useState(null);
    const [activeWorkflow, setActiveWorkflow] = useState(null);

    // Load active configuration on mount
    useEffect(() => {
        const fetchConfig = async () => {
            try {
                const res = await fetch(`${SERVER_URL}/admin/current-config`);
                if (res.ok) {
                    const data = await res.json();
                    if (data.workflow && data.workflow.template_file) {
                        const name = data.workflow.template_file.split(/[\\/]/).pop();
                        setActiveWorkflow({
                            name: name,
                            paramCount: Object.keys(data.workflow.parameter_map || {}).length,
                            warmup: data.workflow.warmup_prompt
                        });

                        // If in config mode but we have a workflow, we could auto-load it if we fetched the file content
                        // But for now, let's just show it's active.
                    }
                }
            } catch (err) {
                console.error("Failed to load current config", err);
            }
        };
        fetchConfig();
    }, []);

    const handleUploadSuccess = (data) => {
        setWorkflowData(data.workflow);
        setParameters(data.parameters);
        setFilename(data.filename);
        setStep(2);
        // Pre-fill warmup prompt if modifying existing or use default
        if (activeWorkflow && activeWorkflow.warmup) {
            setWarmupPrompt(activeWorkflow.warmup);
        }
    };

    const handleParametersChange = (updatedParams) => {
        setParameters(updatedParams);
    };

    const handleSaveAndServe = async () => {
        const enabledParams = parameters.filter(p => p.enabled);

        if (enabledParams.length === 0) {
            alert('Please enable at least one parameter for students to use.');
            return;
        }

        setIsSaving(true);
        setSaveStatus('Saving configuration...');

        try {
            const response = await fetch(`${SERVER_URL}/admin/save-config`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    workflow: workflowData,
                    filename: filename,
                    selectedParameters: parameters,
                    warmupPrompt: warmupPrompt
                }),
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Failed to save configuration');
            }

            setSaveStatus('Restarting server in Student Mode...');

            setSaveStatus('Restarting systems... Please wait.');

            // Trigger server restart
            await fetch(`${SERVER_URL}/admin/restart-server`, { method: 'POST' });

            // Wait for restart (Nodemon takes a moment)
            setTimeout(() => {
                setSaveStatus('Connecting to Student Interface...');
                setTimeout(() => {
                    window.location.href = '/user'; // Go straight to user app
                }, 1000);
            }, 5000);

        } catch (error) {
            console.error('Save failed:', error);
            setSaveStatus(`Error: ${error.message}`);
            setIsSaving(false);
        }
    };

    const handleReset = () => {
        setStep(1);
        setWorkflowData(null);
        setParameters([]);
        setFilename('');
        setSaveStatus(null);
    };

    return (
        <div className="min-h-screen bg-background text-white font-sans selection:bg-primary/20">
            {/* Header */}
            <header className="border-b border-white/5 bg-surface/50 backdrop-blur-md sticky top-0 z-50">
                <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-primary-dark flex items-center justify-center text-white font-bold shadow-lg shadow-primary/20">
                            Q
                        </div>
                        <span className="font-semibold text-lg tracking-tight">ComfyQ <span className="text-slate-500 font-normal">| Admin Config</span></span>
                    </div>

                    {currentMode === 'student' && (
                        <a href="/user" className="flex items-center gap-2 text-sm font-medium text-slate-400 hover:text-white transition-colors bg-white/5 hover:bg-white/10 px-3 py-1.5 rounded-lg border border-white/5">
                            <LayoutDashboard size={14} />
                            Go to App
                            <ArrowLeft size={14} className="rotate-180" />
                        </a>
                    )}
                </div>
            </header>

            <main className="max-w-7xl mx-auto px-6 py-8">
                {step === 1 ? (
                    <div className="mt-12 animate-in fade-in slide-in-from-bottom-4 duration-500">
                        <div className="text-center mb-12">
                            <h1 className="text-4xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-slate-400 mb-4">
                                Configure Workflow
                            </h1>
                            <p className="text-slate-400 text-lg max-w-xl mx-auto mb-8">
                                Upload a ComfyUI workflow JSON to start customizing the student interface.
                            </p>

                            {activeWorkflow && (
                                <div className="inline-flex items-center gap-3 bg-surface/50 border border-primary/20 rounded-full pl-2 pr-4 py-1.5 text-sm text-slate-300 mb-8 mx-auto">
                                    <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                                    <span>Active: <span className="text-white font-medium">{activeWorkflow.name}</span></span>
                                    <span className="text-slate-600">|</span>
                                    <span>{activeWorkflow.paramCount} params</span>
                                </div>
                            )}

                        </div>
                        <WorkflowUpload onUploadSuccess={handleUploadSuccess} />
                    </div>
                ) : (
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 animate-in fade-in duration-500">
                        {/* Left Column: Configuration */}
                        <div className="lg:col-span-7 space-y-6">
                            <div className="flex items-center justify-between pb-6 border-b border-white/5">
                                <div>
                                    <h2 className="text-2xl font-bold text-white mb-1">
                                        {filename.replace('.json', '')}
                                    </h2>
                                    <p className="text-slate-400 text-sm">
                                        Select parameters to expose to students
                                    </p>
                                </div>
                                <button
                                    onClick={handleReset}
                                    className="flex items-center gap-2 text-sm text-slate-500 hover:text-white transition-colors px-3 py-1.5 rounded-lg hover:bg-white/5"
                                >
                                    <RefreshCw size={14} />
                                    Change Workflow
                                </button>
                            </div>

                            <div className="bg-black/20 rounded-xl p-4 border border-white/5 space-y-2">
                                <label className="text-sm font-medium text-slate-300">Warmup Prompt</label>
                                <input
                                    type="text"
                                    value={warmupPrompt}
                                    onChange={(e) => setWarmupPrompt(e.target.value)}
                                    className="w-full bg-background border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:ring-1 focus:ring-primary outline-none"
                                    placeholder="Enter a simple prompt for the warmup job"
                                />
                                <p className="text-xs text-slate-500">
                                    Used to verify the workflow works before accepting student jobs.
                                </p>
                            </div>

                            <ParameterSelector
                                parameters={parameters}
                                onChange={handleParametersChange}
                            />
                        </div>

                        {/* Right Column: Preview & Action */}
                        <div className="lg:col-span-5 space-y-6">
                            <div className="sticky top-24 space-y-6">
                                <div className="bg-surface/50 border border-white/5 rounded-2xl p-6 backdrop-blur-sm">
                                    <h3 className="text-lg font-medium text-white mb-6 flex items-center gap-2">
                                        <LayoutDashboard size={18} className="text-slate-400" />
                                        Preview Interface
                                    </h3>
                                    <ConfigPreview parameters={parameters} />
                                </div>

                                <div className="bg-gradient-to-br from-primary/20 to-primary-dark/5 border border-primary/20 rounded-2xl p-6">
                                    <h3 className="text-lg font-medium text-white mb-2">Ready to Launch?</h3>
                                    <p className="text-sm text-slate-300 mb-6">
                                        This will restart the server and enable the student interface with these settings.
                                    </p>

                                    {saveStatus && (
                                        <div className="mb-4 p-3 bg-black/40 rounded-lg text-sm text-primary-light flex items-center gap-2">
                                            <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                                            {saveStatus}
                                        </div>
                                    )}

                                    <button
                                        onClick={handleSaveAndServe}
                                        disabled={isSaving || parameters.filter(p => p.enabled).length === 0}
                                        className="w-full py-3 px-4 rounded-xl bg-primary hover:bg-primary-dark disabled:opacity-50 text-white font-medium shadow-lg shadow-primary/25 hover:shadow-primary/40 transition-all transform hover:-translate-y-0.5 flex items-center justify-center gap-2"
                                    >
                                        <Power size={18} />
                                        {isSaving ? 'Configuring Server...' : 'Save & Launch Server'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </main>
        </div>
    );
};

export default AdminConfig;
