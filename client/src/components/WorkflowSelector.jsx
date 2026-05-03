import React, { useState, useEffect } from 'react';
import {
    Image,
    Video,
    Wand2,
    Music,
    Box,
    LayoutGrid,
    List,
    RefreshCw,
    ChevronRight,
    Sparkles,
    Clock,
    Tag
} from 'lucide-react';
import Card from './ui/Card';
import Badge from './ui/Badge';
import { SERVER_URL } from '../utils/api';

/**
 * WorkflowSelector Component
 * 
 * Displays available workflows and allows users to select one for job scheduling.
 * Supports grid/list view, category filtering, and preset selection.
 * 
 * @param {Object} props
 * @param {string} props.selectedWorkflowId - Currently selected workflow ID
 * @param {Function} props.onSelect - Callback when a workflow is selected: (workflow) => void
 * @param {Function} props.onPresetSelect - Callback when a preset is selected: (presetName, values) => void
 */
const WorkflowSelector = ({ selectedWorkflowId, onSelect, onPresetSelect }) => {
    const [workflows, setWorkflows] = useState([]);
    const [categories, setCategories] = useState({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [viewMode, setViewMode] = useState('grid'); // 'grid' | 'list'
    const [selectedCategory, setSelectedCategory] = useState('all');
    const [selectedWorkflow, setSelectedWorkflow] = useState(null);

    // Category icons mapping
    const categoryIcons = {
        't2i': Wand2,
        'image-edit': Image,
        'i2v': Video,
        'audio': Music,
        '3d': Box,
        'other': LayoutGrid
    };

    // Fetch workflows on mount
    useEffect(() => {
        fetchWorkflows();
    }, []);

    // Fetch workflow details when selection changes externally
    useEffect(() => {
        if (selectedWorkflowId && !selectedWorkflow) {
            fetchWorkflowDetails(selectedWorkflowId);
        }
    }, [selectedWorkflowId]);

    const fetchWorkflows = async () => {
        setLoading(true);
        setError(null);

        try {
            const res = await fetch(`${SERVER_URL}/admin/workflows`);
            if (!res.ok) throw new Error('Failed to fetch workflows');

            const data = await res.json();
            setWorkflows(data.workflows || []);
            setCategories(data.categories || {});
        } catch (err) {
            console.error('[WorkflowSelector] Error fetching workflows:', err);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const fetchWorkflowDetails = async (workflowId) => {
        try {
            const res = await fetch(`${SERVER_URL}/admin/workflows/${workflowId}`);
            if (!res.ok) throw new Error('Failed to fetch workflow details');

            const data = await res.json();
            setSelectedWorkflow(data);

            if (onSelect) {
                onSelect(data);
            }
        } catch (err) {
            console.error('[WorkflowSelector] Error fetching workflow details:', err);
        }
    };

    const handleWorkflowClick = (workflow) => {
        fetchWorkflowDetails(workflow.id);
    };

    const handlePresetClick = async (presetName) => {
        if (!selectedWorkflow) return;

        try {
            const res = await fetch(
                `${SERVER_URL}/admin/workflows/${selectedWorkflow.id}/presets/${presetName}`
            );
            if (!res.ok) throw new Error('Failed to apply preset');

            const data = await res.json();

            if (onPresetSelect) {
                onPresetSelect(presetName, data.values);
            }
        } catch (err) {
            console.error('[WorkflowSelector] Error applying preset:', err);
        }
    };

    const handleRefresh = () => {
        fetchWorkflows();
    };

    // Filter workflows by category
    const filteredWorkflows = selectedCategory === 'all'
        ? workflows
        : workflows.filter(w => w.category === selectedCategory);

    // Get unique categories from workflows
    const availableCategories = [...new Set(workflows.map(w => w.category))];

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
                <button
                    onClick={handleRefresh}
                    className="px-4 py-2 bg-primary/10 text-primary rounded-lg hover:bg-primary/20 transition-colors"
                >
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
                <p className="text-sm">Add workflow JSON files to the <code className="bg-surface px-2 py-1 rounded">workflows/</code> directory</p>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {/* Header with controls */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Sparkles className="w-5 h-5 text-primary" />
                    <h3 className="font-semibold">Select Workflow</h3>
                    <Badge variant="default" className="ml-2">{workflows.length}</Badge>
                </div>

                <div className="flex items-center gap-2">
                    {/* Category filter */}
                    <select
                        value={selectedCategory}
                        onChange={(e) => setSelectedCategory(e.target.value)}
                        className="bg-surface border border-border rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-primary/50"
                    >
                        <option value="all">All Categories</option>
                        {availableCategories.map(cat => (
                            <option key={cat} value={cat}>
                                {categories[cat] || cat}
                            </option>
                        ))}
                    </select>

                    {/* View mode toggle */}
                    <div className="flex bg-surface border border-border rounded-lg p-0.5">
                        <button
                            onClick={() => setViewMode('grid')}
                            className={`p-1.5 rounded ${viewMode === 'grid' ? 'bg-primary/20 text-primary' : 'text-muted hover:text-white'}`}
                        >
                            <LayoutGrid size={16} />
                        </button>
                        <button
                            onClick={() => setViewMode('list')}
                            className={`p-1.5 rounded ${viewMode === 'list' ? 'bg-primary/20 text-primary' : 'text-muted hover:text-white'}`}
                        >
                            <List size={16} />
                        </button>
                    </div>

                    {/* Refresh button */}
                    <button
                        onClick={handleRefresh}
                        className="p-1.5 text-muted hover:text-white transition-colors"
                        title="Refresh workflows"
                    >
                        <RefreshCw size={16} />
                    </button>
                </div>
            </div>

            {/* Workflow grid/list */}
            <div className={viewMode === 'grid'
                ? 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4'
                : 'space-y-2'
            }>
                {filteredWorkflows.map((workflow) => {
                    const IconComponent = categoryIcons[workflow.category] || LayoutGrid;
                    const isSelected = selectedWorkflow?.id === workflow.id;

                    return (
                        <div
                            key={workflow.id}
                            onClick={() => handleWorkflowClick(workflow)}
                            className={`
                                cursor-pointer rounded-xl border transition-all duration-200
                                ${isSelected
                                    ? 'border-primary bg-primary/10 ring-2 ring-primary/30'
                                    : 'border-border bg-surface hover:border-primary/50 hover:bg-surface/80'
                                }
                                ${viewMode === 'grid' ? 'p-4' : 'p-3 flex items-center gap-4'}
                            `}
                        >
                            {/* Icon */}
                            <div className={`
                                rounded-lg bg-background flex items-center justify-center
                                ${viewMode === 'grid' ? 'w-12 h-12 mb-3' : 'w-10 h-10 flex-shrink-0'}
                            `}>
                                <IconComponent
                                    size={viewMode === 'grid' ? 24 : 20}
                                    className={isSelected ? 'text-primary' : 'text-muted'}
                                />
                            </div>

                            {/* Content */}
                            <div className={viewMode === 'list' ? 'flex-1 min-w-0' : ''}>
                                <div className="flex items-start justify-between gap-2">
                                    <h4 className={`font-medium truncate ${isSelected ? 'text-primary-light' : 'text-white'}`}>
                                        {workflow.name}
                                    </h4>
                                    {isSelected && (
                                        <ChevronRight size={16} className="text-primary flex-shrink-0" />
                                    )}
                                </div>

                                <p className="text-sm text-muted mt-1 line-clamp-2">
                                    {workflow.description}
                                </p>

                                {/* Meta info */}
                                <div className="flex items-center gap-3 mt-2 text-xs text-muted">
                                    <span className="flex items-center gap-1">
                                        <Clock size={12} />
                                        ~{workflow.estimatedTime}s
                                    </span>
                                    {workflow.presets?.length > 0 && (
                                        <span className="flex items-center gap-1">
                                            <Tag size={12} />
                                            {workflow.presets.length} presets
                                        </span>
                                    )}
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Selected workflow details & presets */}
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
                                onClick={() => handlePresetClick(name)}
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
