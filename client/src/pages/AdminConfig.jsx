import React, { useState, useEffect } from 'react';
import { LayoutDashboard, Save, ArrowLeft, RefreshCw, Power, Upload, Plus, X, Check, Settings, Layers } from 'lucide-react';
import WorkflowCard from '../components/admin/WorkflowCard';
import WorkflowUpload from '../components/admin/WorkflowUpload';
import ParameterSelector from '../components/admin/ParameterSelector';
import ConfigPreview from '../components/admin/ConfigPreview';
import { SERVER_URL } from '../utils/api';

/**
 * Admin Configuration Page (v2 Redesign)
 * 
 * Main interface for administrators to set up the ComfyQ server.
 * 
 * New Two-Section Layout:
 * 1. Select Existing Workflow - Cards from registry
 * 2. Upload New Workflow - Parse, configure, and save
 * 
 * @param {Object} props
 * @param {string} props.currentMode - 'admin' or 'student'
 */
const AdminConfig = ({ currentMode }) => {
    // View mode: 'select' | 'upload' | 'configure' | 'edit-existing'
    const [viewMode, setViewMode] = useState('select');

    // Workflow registry data
    const [workflows, setWorkflows] = useState([]);
    const [categories, setCategories] = useState({});
    const [loadingWorkflows, setLoadingWorkflows] = useState(true);

    // Selected workflow for activation
    const [selectedWorkflow, setSelectedWorkflow] = useState(null);
    const [selectedWorkflowDetails, setSelectedWorkflowDetails] = useState(null);

    // New workflow upload data
    const [uploadedWorkflow, setUploadedWorkflow] = useState(null);
    const [uploadedParameters, setUploadedParameters] = useState([]);
    const [uploadedFilename, setUploadedFilename] = useState('');

    // New workflow metadata form
    const [newWorkflowName, setNewWorkflowName] = useState('');
    const [newWorkflowDescription, setNewWorkflowDescription] = useState('');
    const [newWorkflowCategory, setNewWorkflowCategory] = useState('other');

    // Saving state
    const [isSaving, setIsSaving] = useState(false);
    const [saveStatus, setSaveStatus] = useState(null);

    // Edit existing workflow state
    const [editingParameters, setEditingParameters] = useState([]);
    const [warmupPrompt, setWarmupPrompt] = useState('A simple test generation');

    // Load workflows on mount
    useEffect(() => {
        fetchWorkflows();
    }, []);

    const fetchWorkflows = async () => {
        setLoadingWorkflows(true);
        try {
            const res = await fetch(`${SERVER_URL}/admin/workflows`);
            if (res.ok) {
                const data = await res.json();
                setWorkflows(data.workflows || []);
                setCategories(data.categories || {});
            }
        } catch (err) {
            console.error('[AdminConfig] Failed to load workflows:', err);
        } finally {
            setLoadingWorkflows(false);
        }
    };

    const fetchWorkflowDetails = async (workflowId) => {
        try {
            const res = await fetch(`${SERVER_URL}/admin/workflows/${workflowId}`);
            if (res.ok) {
                const data = await res.json();
                setSelectedWorkflowDetails(data);
            }
        } catch (err) {
            console.error('[AdminConfig] Failed to load workflow details:', err);
        }
    };

    const handleWorkflowSelect = (workflow) => {
        setSelectedWorkflow(workflow);
        fetchWorkflowDetails(workflow.id);
    };

    const handleRefreshWorkflows = async () => {
        try {
            await fetch(`${SERVER_URL}/admin/workflows/refresh`, { method: 'POST' });
            fetchWorkflows();
        } catch (err) {
            console.error('[AdminConfig] Failed to refresh:', err);
        }
    };

    /**
     * Handler for successful workflow upload.
     * Transitions to configure view.
     */
    const handleUploadSuccess = (data) => {
        setUploadedWorkflow(data.workflow);
        setUploadedParameters(data.parameters);
        setUploadedFilename(data.filename);
        setNewWorkflowName(data.filename.replace('.json', '').replace(/[-_]/g, ' '));
        setViewMode('configure');
    };

    const handleParametersChange = (updatedParams) => {
        setUploadedParameters(updatedParams);
    };

    /**
     * Save new workflow to registry
     */
    const handleSaveNewWorkflow = async () => {
        const enabledParams = uploadedParameters.filter(p => p.enabled);

        if (enabledParams.length === 0) {
            alert('Please enable at least one parameter.');
            return;
        }

        if (!newWorkflowName.trim()) {
            alert('Please enter a workflow name.');
            return;
        }

        setIsSaving(true);
        setSaveStatus('Saving workflow...');

        try {
            const response = await fetch(`${SERVER_URL}/admin/workflows/save`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    workflow: uploadedWorkflow,
                    filename: uploadedFilename,
                    name: newWorkflowName,
                    description: newWorkflowDescription,
                    category: newWorkflowCategory,
                    exposedParameters: enabledParams.map(p => ({
                        nodeId: p.nodeId,
                        field: p.field,
                        label: p.label,
                        type: p.type,
                        required: p.type === 'image' || p.type === 'video',
                        order: p.order,
                        default: p.defaultValue
                    }))
                })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Failed to save workflow');
            }

            setSaveStatus('Workflow saved! Refreshing...');
            await fetchWorkflows();

            // Reset and go back to select view
            setTimeout(() => {
                resetUploadState();
                setViewMode('select');
                setSaveStatus(null);
            }, 1500);

        } catch (error) {
            console.error('Save failed:', error);
            setSaveStatus(`Error: ${error.message}`);
        } finally {
            setIsSaving(false);
        }
    };

    /**
     * Activate selected workflow (switch to student mode)
     */
    const handleActivateWorkflow = async () => {
        if (!selectedWorkflowDetails) return;

        setIsSaving(true);
        setSaveStatus('Activating workflow...');

        try {
            // Use the existing save-config endpoint with the selected workflow
            const response = await fetch(`${SERVER_URL}/admin/save-config`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    workflow: selectedWorkflowDetails.workflow || {},
                    filename: selectedWorkflow.relativePath ? selectedWorkflow.relativePath.replace(/^\.\/workflows\//, '') : selectedWorkflow.id + '.json',
                    selectedParameters: Object.entries(selectedWorkflowDetails.parameterMap || {}).map(([key, param]) => ({
                        key,
                        nodeId: param.node_id,
                        field: param.field,
                        type: param.type,
                        label: param.label,
                        defaultValue: param.default,
                        enabled: true,
                        order: param.order
                    })),
                    warmupPrompt: 'Test prompt'
                })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Failed to activate workflow');
            }

            setSaveStatus('Restarting server in Student Mode...');

            // Trigger server restart
            await fetch(`${SERVER_URL}/admin/restart-server`, { method: 'POST' });

            setTimeout(() => {
                setSaveStatus('Connecting to Student Interface...');
                setTimeout(() => {
                    window.location.href = '/user';
                }, 1000);
            }, 5000);

        } catch (error) {
            console.error('Activation failed:', error);
            setSaveStatus(`Error: ${error.message}`);
            setIsSaving(false);
        }
    };

    /**
     * Enter parameter editing mode for selected workflow
     */
    const handleEditParameters = async () => {
        if (!selectedWorkflow) return;

        try {
            // Fetch ALL parameters by parsing the workflow
            const res = await fetch(`${SERVER_URL}/admin/workflows/${selectedWorkflow.id}/all-parameters`);
            if (!res.ok) {
                throw new Error('Failed to fetch workflow parameters');
            }

            const data = await res.json();

            // Mark parameters as enabled if they're in the metadata's exposed list
            const exposedParamKeys = new Set(
                (selectedWorkflowDetails?.metadata?.exposedParameters || []).map(p =>
                    `${p.field}_${p.nodeId}`
                )
            );

            const params = data.parameters.map(param => ({
                ...param,
                enabled: exposedParamKeys.has(param.key) || exposedParamKeys.size === 0
            }));

            setEditingParameters(params);
            setUploadedFilename(data.filename || selectedWorkflow.id + '.json');
            setViewMode('edit-existing');
        } catch (error) {
            console.error('[AdminConfig] Failed to load parameters:', error);
            alert('Failed to load workflow parameters. Please try again.');
        }
    };

    const handleEditParametersChange = (updatedParams) => {
        setEditingParameters(updatedParams);
    };

    /**
     * Activate workflow with edited parameters
     */
    const handleActivateWithEditedParams = async () => {
        const enabledParams = editingParameters.filter(p => p.enabled);

        if (enabledParams.length === 0) {
            alert('Please enable at least one parameter.');
            return;
        }

        setIsSaving(true);
        setSaveStatus('Activating workflow with custom parameters...');

        try {
            const response = await fetch(`${SERVER_URL}/admin/save-config`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    workflow: selectedWorkflowDetails.apiWorkflow || selectedWorkflowDetails.workflow || {},
                    filename: selectedWorkflow.relativePath ? selectedWorkflow.relativePath.replace(/^\.\/workflows\//, '') : selectedWorkflow.id + '.json',
                    selectedParameters: enabledParams,
                    warmupPrompt: warmupPrompt
                })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Failed to activate workflow');
            }

            setSaveStatus('Restarting server in Student Mode...');

            await fetch(`${SERVER_URL}/admin/restart-server`, { method: 'POST' });

            setTimeout(() => {
                setSaveStatus('Connecting to Student Interface...');
                setTimeout(() => {
                    window.location.href = '/user';
                }, 1000);
            }, 5000);

        } catch (error) {
            console.error('Activation failed:', error);
            setSaveStatus(`Error: ${error.message}`);
            setIsSaving(false);
        }
    };

    const resetUploadState = () => {
        setUploadedWorkflow(null);
        setUploadedParameters([]);
        setUploadedFilename('');
        setNewWorkflowName('');
        setNewWorkflowDescription('');
        setNewWorkflowCategory('other');
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
                {/* Tab Navigation */}
                <div className="flex items-center gap-4 mb-8">
                    <button
                        onClick={() => { setViewMode('select'); resetUploadState(); }}
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all ${viewMode === 'select'
                            ? 'bg-primary text-white shadow-lg shadow-primary/25'
                            : 'bg-surface text-slate-400 hover:text-white hover:bg-surface/80'
                            }`}
                    >
                        <Layers size={18} />
                        Existing Workflows
                    </button>
                    <button
                        onClick={() => setViewMode('upload')}
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all ${viewMode === 'upload' || viewMode === 'configure'
                            ? 'bg-primary text-white shadow-lg shadow-primary/25'
                            : 'bg-surface text-slate-400 hover:text-white hover:bg-surface/80'
                            }`}
                    >
                        <Plus size={18} />
                        Upload New
                    </button>

                    <div className="flex-1" />

                    <button
                        onClick={handleRefreshWorkflows}
                        className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
                        title="Refresh workflows"
                    >
                        <RefreshCw size={18} />
                    </button>
                </div>

                {/* SELECT EXISTING WORKFLOW VIEW */}
                {viewMode === 'select' && (
                    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                        <div className="text-center mb-8">
                            <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-slate-400 mb-2">
                                Select Workflow
                            </h1>
                            <p className="text-slate-400">
                                Choose a workflow from the registry to activate
                            </p>
                        </div>

                        {loadingWorkflows ? (
                            <div className="flex items-center justify-center py-12">
                                <RefreshCw className="w-6 h-6 text-primary animate-spin" />
                                <span className="ml-3 text-muted">Loading workflows...</span>
                            </div>
                        ) : workflows.length === 0 ? (
                            <div className="text-center py-12 text-slate-400">
                                <Layers className="w-12 h-12 mx-auto mb-4 opacity-50" />
                                <p className="mb-2">No workflows found</p>
                                <p className="text-sm">Upload a workflow or add JSON files to the <code className="bg-surface px-2 py-1 rounded">workflows/</code> folder</p>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                                {workflows.map((workflow) => (
                                    <WorkflowCard
                                        key={workflow.id}
                                        workflow={workflow}
                                        isSelected={selectedWorkflow?.id === workflow.id}
                                        onClick={() => handleWorkflowSelect(workflow)}
                                    />
                                ))}
                            </div>
                        )}

                        {/* Selected Workflow Details Panel */}
                        {selectedWorkflow && selectedWorkflowDetails && (
                            <div className="mt-8 bg-surface/50 border border-white/10 rounded-2xl p-6 animate-in fade-in slide-in-from-bottom-2">
                                <div className="flex items-start justify-between mb-4">
                                    <div>
                                        <h2 className="text-xl font-bold text-white mb-1">{selectedWorkflow.name}</h2>
                                        <p className="text-slate-400">{selectedWorkflow.description}</p>
                                    </div>
                                    <button
                                        onClick={() => { setSelectedWorkflow(null); setSelectedWorkflowDetails(null); }}
                                        className="p-2 text-slate-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                                    >
                                        <X size={18} />
                                    </button>
                                </div>

                                <div className="flex flex-wrap gap-4 mb-6 text-sm">
                                    <div className="flex items-center gap-2 bg-white/5 px-3 py-1.5 rounded-lg">
                                        <Settings size={14} className="text-primary" />
                                        <span>{Object.keys(selectedWorkflowDetails.parameterMap || {}).length} Parameters</span>
                                    </div>
                                    {selectedWorkflow.presets && selectedWorkflow.presets.length > 0 && (
                                        <div className="flex items-center gap-2 bg-white/5 px-3 py-1.5 rounded-lg">
                                            <Layers size={14} className="text-secondary" />
                                            <span>{selectedWorkflow.presets.length} Presets</span>
                                        </div>
                                    )}
                                </div>

                                {saveStatus && (
                                    <div className="mb-4 p-3 bg-black/40 rounded-lg text-sm text-primary-light flex items-center gap-2">
                                        <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                                        {saveStatus}
                                    </div>
                                )}

                                <div className="flex gap-3">
                                    <button
                                        onClick={handleEditParameters}
                                        disabled={isSaving}
                                        className="flex-1 py-3 px-4 rounded-xl bg-surface border border-white/10 hover:border-white/30 text-white font-medium transition-all flex items-center justify-center gap-2"
                                    >
                                        <Settings size={18} />
                                        Configure Params
                                    </button>
                                    <button
                                        onClick={handleActivateWorkflow}
                                        disabled={isSaving}
                                        className="flex-1 py-3 px-4 rounded-xl bg-primary hover:bg-primary-dark disabled:opacity-50 text-white font-medium shadow-lg shadow-primary/25 hover:shadow-primary/40 transition-all transform hover:-translate-y-0.5 flex items-center justify-center gap-2"
                                    >
                                        <Power size={18} />
                                        {isSaving ? 'Activating...' : 'Quick Launch'}
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* UPLOAD NEW WORKFLOW VIEW */}
                {viewMode === 'upload' && (
                    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                        <div className="text-center mb-8">
                            <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-slate-400 mb-2">
                                Upload New Workflow
                            </h1>
                            <p className="text-slate-400">
                                Import a ComfyUI workflow JSON to add to the registry
                            </p>
                        </div>
                        <WorkflowUpload onUploadSuccess={handleUploadSuccess} />
                    </div>
                )}

                {/* CONFIGURE NEW WORKFLOW VIEW */}
                {viewMode === 'configure' && uploadedWorkflow && (
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 animate-in fade-in duration-500">
                        {/* Left Column: Configuration */}
                        <div className="lg:col-span-7 space-y-6">
                            <div className="flex items-center justify-between pb-6 border-b border-white/5">
                                <div>
                                    <h2 className="text-2xl font-bold text-white mb-1">Configure New Workflow</h2>
                                    <p className="text-slate-400 text-sm">Set up metadata and select parameters to expose</p>
                                </div>
                                <button
                                    onClick={() => { resetUploadState(); setViewMode('upload'); }}
                                    className="flex items-center gap-2 text-sm text-slate-500 hover:text-white transition-colors px-3 py-1.5 rounded-lg hover:bg-white/5"
                                >
                                    <X size={14} />
                                    Cancel
                                </button>
                            </div>

                            {/* Metadata Form */}
                            <div className="bg-black/20 rounded-xl p-4 border border-white/5 space-y-4">
                                <div>
                                    <label className="text-sm font-medium text-slate-300">Workflow Name *</label>
                                    <input
                                        type="text"
                                        value={newWorkflowName}
                                        onChange={(e) => setNewWorkflowName(e.target.value)}
                                        className="w-full mt-1 bg-background border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:ring-1 focus:ring-primary outline-none"
                                        placeholder="My Awesome Workflow"
                                    />
                                </div>
                                <div>
                                    <label className="text-sm font-medium text-slate-300">Description</label>
                                    <textarea
                                        value={newWorkflowDescription}
                                        onChange={(e) => setNewWorkflowDescription(e.target.value)}
                                        className="w-full mt-1 bg-background border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:ring-1 focus:ring-primary outline-none resize-none"
                                        rows={2}
                                        placeholder="What does this workflow do?"
                                    />
                                </div>
                                <div>
                                    <label className="text-sm font-medium text-slate-300">Category</label>
                                    <select
                                        value={newWorkflowCategory}
                                        onChange={(e) => setNewWorkflowCategory(e.target.value)}
                                        className="w-full mt-1 bg-background border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:ring-1 focus:ring-primary outline-none"
                                    >
                                        {Object.entries(categories).map(([key, label]) => (
                                            <option key={key} value={key}>{label}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            <ParameterSelector
                                parameters={uploadedParameters}
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
                                    <ConfigPreview parameters={uploadedParameters} />
                                </div>

                                <div className="bg-gradient-to-br from-primary/20 to-primary-dark/5 border border-primary/20 rounded-2xl p-6">
                                    <h3 className="text-lg font-medium text-white mb-2">Save to Registry</h3>
                                    <p className="text-sm text-slate-300 mb-6">
                                        This will save the workflow and make it available for selection.
                                    </p>

                                    {saveStatus && (
                                        <div className="mb-4 p-3 bg-black/40 rounded-lg text-sm text-primary-light flex items-center gap-2">
                                            <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                                            {saveStatus}
                                        </div>
                                    )}

                                    <button
                                        onClick={handleSaveNewWorkflow}
                                        disabled={isSaving || uploadedParameters.filter(p => p.enabled).length === 0 || !newWorkflowName.trim()}
                                        className="w-full py-3 px-4 rounded-xl bg-primary hover:bg-primary-dark disabled:opacity-50 text-white font-medium shadow-lg shadow-primary/25 hover:shadow-primary/40 transition-all transform hover:-translate-y-0.5 flex items-center justify-center gap-2"
                                    >
                                        <Save size={18} />
                                        {isSaving ? 'Saving...' : 'Save Workflow'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* EDIT EXISTING WORKFLOW PARAMS VIEW */}
                {viewMode === 'edit-existing' && selectedWorkflow && (
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 animate-in fade-in duration-500">
                        {/* Left Column: Parameter Configuration */}
                        <div className="lg:col-span-7 space-y-6">
                            <div className="flex items-center justify-between pb-6 border-b border-white/5">
                                <div>
                                    <h2 className="text-2xl font-bold text-white mb-1">{selectedWorkflow.name}</h2>
                                    <p className="text-slate-400 text-sm">Configure parameters to expose to students</p>
                                </div>
                                <button
                                    onClick={() => { setViewMode('select'); setEditingParameters([]); }}
                                    className="flex items-center gap-2 text-sm text-slate-500 hover:text-white transition-colors px-3 py-1.5 rounded-lg hover:bg-white/5"
                                >
                                    <X size={14} />
                                    Cancel
                                </button>
                            </div>

                            {/* Warmup Prompt */}
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
                                parameters={editingParameters}
                                onChange={handleEditParametersChange}
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
                                    <ConfigPreview parameters={editingParameters} />
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
                                        onClick={handleActivateWithEditedParams}
                                        disabled={isSaving || editingParameters.filter(p => p.enabled).length === 0}
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
