import React from 'react';
import {
    Image,
    Video,
    Wand2,
    Music,
    Box,
    LayoutGrid,
    CheckCircle,
    Settings
} from 'lucide-react';

/**
 * WorkflowCard Component
 * 
 * Displays a single workflow as a selectable card in the admin interface.
 * Shows workflow metadata with visual category indicator.
 * 
 * @param {Object} props
 * @param {Object} props.workflow - Workflow data from registry
 * @param {boolean} props.isSelected - Whether this card is currently selected
 * @param {Function} props.onClick - Click handler for selection
 */
const WorkflowCard = ({ workflow, isSelected, onClick }) => {
    // Category icons mapping
    const categoryIcons = {
        't2i': Wand2,
        'image-edit': Image,
        'i2v': Video,
        'audio': Music,
        '3d': Box,
        'other': LayoutGrid
    };

    // Category colors for visual distinction
    const categoryColors = {
        't2i': 'from-purple-500/20 to-purple-600/10 border-purple-500/30',
        'image-edit': 'from-blue-500/20 to-blue-600/10 border-blue-500/30',
        'i2v': 'from-green-500/20 to-green-600/10 border-green-500/30',
        'audio': 'from-orange-500/20 to-orange-600/10 border-orange-500/30',
        '3d': 'from-pink-500/20 to-pink-600/10 border-pink-500/30',
        'other': 'from-slate-500/20 to-slate-600/10 border-slate-500/30'
    };

    const IconComponent = categoryIcons[workflow.category] || LayoutGrid;
    const colorClasses = categoryColors[workflow.category] || categoryColors.other;

    return (
        <div
            onClick={onClick}
            className={`
                relative cursor-pointer rounded-xl border-2 p-4 transition-all duration-200
                bg-gradient-to-br ${colorClasses}
                ${isSelected
                    ? 'ring-2 ring-primary ring-offset-2 ring-offset-background border-primary'
                    : 'hover:border-white/30 hover:scale-[1.02]'
                }
            `}
        >
            {/* Selected indicator */}
            {isSelected && (
                <div className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-primary flex items-center justify-center shadow-lg">
                    <CheckCircle size={14} className="text-white" />
                </div>
            )}

            {/* Icon and category */}
            <div className="flex items-start justify-between mb-3">
                <div className="p-2.5 rounded-lg bg-background/50 backdrop-blur-sm border border-white/10">
                    <IconComponent size={20} className="text-white" />
                </div>
                <span className="text-[10px] uppercase tracking-wider font-semibold text-white/60 bg-white/10 px-2 py-1 rounded">
                    {workflow.category}
                </span>
            </div>

            {/* Name and description */}
            <h3 className="font-semibold text-white mb-1 line-clamp-1">
                {workflow.name}
            </h3>
            <p className="text-sm text-white/60 line-clamp-2 mb-3 min-h-[40px]">
                {workflow.description}
            </p>

            {/* Stats row */}
            <div className="flex items-center gap-3 text-xs text-white/50">
                <span className="flex items-center gap-1">
                    <Settings size={12} />
                    {workflow.parameterCount} params
                </span>
                {workflow.presets && workflow.presets.length > 0 && (
                    <span className="flex items-center gap-1">
                        {workflow.presets.length} presets
                    </span>
                )}
                {workflow.estimatedTime && (
                    <span>~{workflow.estimatedTime}s</span>
                )}
            </div>

            {/* Custom metadata indicator */}
            {workflow.hasCustomMetadata && (
                <div className="absolute bottom-2 right-2">
                    <div className="w-2 h-2 rounded-full bg-green-500" title="Has custom metadata" />
                </div>
            )}
        </div>
    );
};

export default WorkflowCard;
