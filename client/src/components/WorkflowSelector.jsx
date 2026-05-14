import React, { useState, useEffect } from 'react';
import {
    Image, Video, Wand2, Music, Box, LayoutGrid, List,
    RefreshCw, ChevronRight, Sparkles, Clock, Tag,
    Pencil, Trash2, Gauge, Cpu
} from 'lucide-react';
import Card from './ui/Card';
import Badge from './ui/Badge';
import { SERVER_URL } from '../utils/api';

/**
 * WorkflowSelector
 * Lists workflows from /workflows and lets the admin pick one.
 * Calls onSelect(workflowDetails) when a workflow is chosen.
 * Calls onPresetSelect(name, values) when a preset chip is clicked.
 */
const WorkflowSelector = ({ selectedWorkflowId, activeWorkflowId, onSelect, onPresetSelect, onEdit, onDelete, onCalibrate, calibratingIds = new Set() }) => {
    const [workflows, setWorkflows] = useState([]);
    const [categories, setCategories] = useState({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [viewMode, setViewMode] = useState('grid');
    const [selectedCategory, setSelectedCategory] = useState('all');
    const [selectedWorkflow, setSelectedWorkflow] = useState(null);

    const categoryIcons = {
        't2i': Wand2, 'image-edit': Image, 'i2v': Video, 'i2i': Image,
        'audio': Music, '3d': Box, 'preprocessor': Box, 'other': LayoutGrid
    };

    const fetchWorkflows = async () => {
        setLoading(true); setError(null);
        try {
            const res = await fetch(`${SERVER_URL}/workflows`);
            if (!res.ok) throw new Error('Failed to fetch workflows');
            const data = await res.json();
            setWorkflows(data.workflows || []);
            setCategories(data.categories || {});
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchWorkflows(); }, []);

    useEffect(() => {
        if (selectedWorkflowId && (!selectedWorkflow || selectedWorkflow.id !== selectedWorkflowId)) {
            fetchDetails(selectedWorkflowId);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedWorkflowId]);

    const fetchDetails = async (id) => {
        try {
            const res = await fetch(`${SERVER_URL}/workflows/${id}`);
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body.error || 'Failed to fetch workflow details');
            }
            const data = await res.json();
            setSelectedWorkflow(data);
            if (onSelect) onSelect(data);
        } catch (err) {
            console.error('[WorkflowSelector]', err);
        }
    };

    const handleClick = (w) => fetchDetails(w.id);

    const handlePreset = async (name) => {
        if (!selectedWorkflow) return;
        try {
            const res = await fetch(`${SERVER_URL}/workflows/${selectedWorkflow.id}/presets/${name}`);
            if (!res.ok) throw new Error('Failed to apply preset');
            const data = await res.json();
            if (onPresetSelect) onPresetSelect(name, data.values);
        } catch (err) {
            console.error('[WorkflowSelector]', err);
        }
    };

    const usable = workflows.filter(w => !w.unavailable);
    const filtered = selectedCategory === 'all' ? usable : usable.filter(w => w.category === selectedCategory);
    const availableCategories = [...new Set(usable.map(w => w.category))];

    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <RefreshCw className="w-6 h-6 text-primary animate-spin" />
                <span className="ml-3 text-muted">Loading workflows...</span>
            </div>
        );
    }

    if (error) {
        return (
            <div className="text-center py-8">
                <p className="text-danger mb-4">Error: {error}</p>
                <button onClick={fetchWorkflows} className="px-4 py-2 bg-primary/10 text-primary rounded-lg hover:bg-primary/20 transition-colors">
                    Retry
                </button>
            </div>
        );
    }

    if (workflows.length === 0) {
        return (
            <div className="text-center py-12 text-muted">
                <LayoutGrid className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p className="mb-2">No workflows found</p>
                <p className="text-sm">Add a folder under <code className="bg-surface px-2 py-1 rounded">workflows/</code> with <code>{'<id>.api.json'}</code> + <code>{'<id>.meta.json'}</code></p>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Sparkles className="w-5 h-5 text-primary" />
                    <h3 className="font-semibold">Select Workflow</h3>
                    <Badge variant="default" className="ml-2">{usable.length}</Badge>
                </div>
                <div className="flex items-center gap-2">
                    <select
                        value={selectedCategory}
                        onChange={(e) => setSelectedCategory(e.target.value)}
                        className="bg-surface border border-border rounded-lg px-3 py-1.5 text-sm text-white"
                    >
                        <option value="all">All Categories</option>
                        {availableCategories.map(cat => (
                            <option key={cat} value={cat}>{categories[cat] || cat}</option>
                        ))}
                    </select>
                    <div className="flex bg-surface border border-border rounded-lg p-0.5">
                        <button onClick={() => setViewMode('grid')} className={`p-1.5 rounded ${viewMode === 'grid' ? 'bg-primary/20 text-primary' : 'text-muted hover:text-white'}`}>
                            <LayoutGrid size={16} />
                        </button>
                        <button onClick={() => setViewMode('list')} className={`p-1.5 rounded ${viewMode === 'list' ? 'bg-primary/20 text-primary' : 'text-muted hover:text-white'}`}>
                            <List size={16} />
                        </button>
                    </div>
                    <button onClick={fetchWorkflows} className="p-1.5 text-muted hover:text-white" title="Refresh">
                        <RefreshCw size={16} />
                    </button>
                </div>
            </div>

            <div className={viewMode === 'grid'
                ? 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4'
                : 'space-y-2'}>
                {filtered.map((w) => {
                    const IconComponent = categoryIcons[w.category] || LayoutGrid;
                    const isSelected = selectedWorkflow?.id === w.id;
                    const isActive = activeWorkflowId === w.id;
                    const isCalibrating = calibratingIds.has(w.id);
                    return (
                        <div
                            key={w.id}
                            onClick={() => handleClick(w)}
                            className={`group relative cursor-pointer rounded-xl border transition-all duration-200
                                ${isSelected ? 'border-primary bg-primary/10 ring-2 ring-primary/30' : 'border-border bg-surface hover:border-primary/50 hover:bg-surface/80'}
                                ${viewMode === 'grid' ? 'p-4' : 'p-3 flex items-center gap-4'}`}
                        >
                            {/* Per-card action buttons (visible on hover; always visible if selected) */}
                            {(onEdit || onDelete || onCalibrate) && (
                                <div className={`absolute top-2 right-2 flex items-center gap-1 transition-opacity ${isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                                    {onCalibrate && (
                                        <button
                                            type="button"
                                            disabled={isCalibrating}
                                            onClick={(e) => { e.stopPropagation(); onCalibrate(w.id); }}
                                            className="p-1.5 rounded-md bg-background/90 border border-border hover:border-primary/50 text-muted hover:text-primary transition-colors disabled:opacity-50 disabled:cursor-wait"
                                            title={isCalibrating ? 'Calibrating…' : 'Calibrate (measure generation time)'}
                                        >
                                            {isCalibrating ? <RefreshCw size={12} className="animate-spin" /> : <Gauge size={12} />}
                                        </button>
                                    )}
                                    {onEdit && (
                                        <button
                                            type="button"
                                            onClick={(e) => { e.stopPropagation(); onEdit(w.id); }}
                                            className="p-1.5 rounded-md bg-background/90 border border-border hover:border-primary/50 text-muted hover:text-primary transition-colors"
                                            title="Edit metadata & parameters"
                                        >
                                            <Pencil size={12} />
                                        </button>
                                    )}
                                    {onDelete && (
                                        <button
                                            type="button"
                                            disabled={isActive}
                                            onClick={(e) => { e.stopPropagation(); onDelete(w.id); }}
                                            className="p-1.5 rounded-md bg-background/90 border border-border hover:border-danger/50 text-muted hover:text-danger transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                                            title={isActive ? 'Cannot delete the active workflow' : 'Delete workflow'}
                                        >
                                            <Trash2 size={12} />
                                        </button>
                                    )}
                                </div>
                            )}

                            <div className={`rounded-lg bg-background flex items-center justify-center
                                ${viewMode === 'grid' ? 'w-12 h-12 mb-3' : 'w-10 h-10 flex-shrink-0'}`}>
                                <IconComponent size={viewMode === 'grid' ? 24 : 20}
                                    className={isSelected ? 'text-primary' : 'text-muted'} />
                            </div>
                            <div className={viewMode === 'list' ? 'flex-1 min-w-0' : ''}>
                                <div className="flex items-start justify-between gap-2">
                                    <h4 className={`font-medium truncate ${isSelected ? 'text-primary-light' : 'text-white'}`}>{w.name}</h4>
                                    {isSelected && <ChevronRight size={16} className="text-primary flex-shrink-0" />}
                                </div>
                                <p className="text-sm text-muted mt-1 line-clamp-2">{w.description}</p>
                                <div className="flex items-center gap-3 mt-2 text-xs text-muted flex-wrap">
                                    <span className="flex items-center gap-1" title={w.hasCalibration && w.calibration?.calibratedAt
                                        ? `Calibrated ${new Date(w.calibration.calibratedAt).toLocaleString()}${w.calibration.coldDurationSec ? ` · cold run ${w.calibration.coldDurationSec}s (model load ${w.calibration.modelLoadSec}s)` : ''}`
                                        : 'Not yet calibrated — estimate from meta.json'}>
                                        <Clock size={12} />~{w.estimatedDurationSec}s {w.hasCalibration ? '' : '(uncalibrated)'}
                                    </span>
                                    {w.hasCalibration && w.calibration?.gpu && (
                                        <span className="flex items-center gap-1 text-success/80"
                                            title={`Time measured on this GPU. Move to a different GPU and re-calibrate for an accurate estimate.`}>
                                            <Cpu size={12} />{w.calibration.gpu}
                                        </span>
                                    )}
                                    {w.presets?.length > 0 && (
                                        <span className="flex items-center gap-1">
                                            <Tag size={12} />{w.presets.length} presets
                                        </span>
                                    )}
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>

            {selectedWorkflow && selectedWorkflow.metadata?.presets && Object.keys(selectedWorkflow.metadata.presets).length > 0 && (
                <Card className="mt-4 border-primary/30">
                    <div className="flex items-center gap-2 mb-3">
                        <Sparkles size={16} className="text-primary" />
                        <span className="font-medium text-sm">Quick Presets</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {Object.entries(selectedWorkflow.metadata.presets).map(([name, preset]) => (
                            <button
                                key={name}
                                onClick={() => handlePreset(name)}
                                className="px-3 py-1.5 bg-background hover:bg-primary/10 border border-border hover:border-primary/50 rounded-lg text-sm transition-colors"
                                title={preset.description || `Apply ${name} preset`}
                            >
                                {preset.label || name}
                            </button>
                        ))}
                    </div>
                </Card>
            )}
        </div>
    );
};

export default WorkflowSelector;
