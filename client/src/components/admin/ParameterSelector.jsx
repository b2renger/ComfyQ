import React, { useState } from 'react';
import { Settings, Check, Type, Image as ImageIcon, Hash, List, AlignLeft, Info } from 'lucide-react';

const TYPE_ICONS = {
    text: Type,
    textarea: AlignLeft,
    number: Hash,
    image: ImageIcon,
    select: List,
    checkbox: Check
};

const ParameterSelector = ({ parameters, onChange }) => {
    // Local state to manage edits before propagation
    // However, for simplicity allowing parent to control state is better if changes are frequent,
    // but here we might just map through the props.
    // Assuming 'parameters' prop is the array of config objects.

    const handleToggle = (key) => {
        const updated = parameters.map(p =>
            p.key === key ? { ...p, enabled: !p.enabled } : p
        );
        onChange(updated);
    };

    const handleLabelChange = (key, newLabel) => {
        const updated = parameters.map(p =>
            p.key === key ? { ...p, label: newLabel } : p
        );
        onChange(updated);
    };

    const handleTypeChange = (key, newType) => {
        const updated = parameters.map(p =>
            p.key === key ? { ...p, type: newType } : p
        );
        onChange(updated);
    };

    const handleDefaultChange = (key, newDefault) => {
        const updated = parameters.map(p =>
            p.key === key ? { ...p, defaultValue: newDefault } : p
        );
        onChange(updated);
    };

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-medium text-white flex items-center gap-2">
                    <Settings className="text-primary" size={20} />
                    Configure Parameters
                </h3>
                <span className="text-sm text-slate-400">
                    {parameters.filter(p => p.enabled).length} parameters selected
                </span>
            </div>

            <div className="grid gap-3">
                {parameters.map((param) => {
                    const Icon = TYPE_ICONS[param.type] || Type;

                    return (
                        <div
                            key={param.key}
                            className={`
                                group relative p-4 rounded-xl border transition-all duration-200
                                ${param.enabled
                                    ? 'bg-surface border-primary/30 shadow-lg shadow-black/20'
                                    : 'bg-surface/30 border-white/5 opacity-70 hover:opacity-100 hover:border-white/10'
                                }
                            `}
                        >
                            <div className="flex items-start gap-4">
                                {/* Checkbox / Toggle */}
                                <div className="pt-1">
                                    <button
                                        onClick={() => handleToggle(param.key)}
                                        className={`
                                            w-5 h-5 rounded border flex items-center justify-center transition-colors
                                            ${param.enabled
                                                ? 'bg-primary border-primary text-white'
                                                : 'border-slate-500 hover:border-slate-400'
                                            }
                                        `}
                                    >
                                        {param.enabled && <Check size={14} />}
                                    </button>
                                </div>

                                {/* Content */}
                                <div className="flex-1 space-y-3">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2 text-sm text-slate-400">
                                            <span className="font-mono text-xs bg-black/30 px-1.5 py-0.5 rounded">
                                                Node {param.nodeId}
                                            </span>
                                            <span>•</span>
                                            <span className="font-mono text-xs opacity-70">
                                                {param.nodeType}.{param.field}
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <Icon size={14} className="text-slate-500" />
                                            <select
                                                value={param.type}
                                                onChange={(e) => handleTypeChange(param.key, e.target.value)}
                                                className="bg-transparent text-xs text-slate-400 border-none focus:ring-0 cursor-pointer hover:text-white"
                                            >
                                                <option value="text">Text Input</option>
                                                <option value="textarea">Text Area</option>
                                                <option value="number">Number</option>
                                                <option value="image">Image Upload</option>
                                                <option value="select">Select Dropdown</option>
                                            </select>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div className="space-y-1">
                                            <label className="text-xs font-medium text-slate-500 uppercase tracking-wider">Label</label>
                                            <input
                                                type="text"
                                                value={param.label}
                                                onChange={(e) => handleLabelChange(param.key, e.target.value)}
                                                disabled={!param.enabled}
                                                className="w-full bg-black/20 border border-white/5 rounded-lg px-3 py-2 text-sm text-white focus:ring-1 focus:ring-primary focus:border-primary/50 outline-none disabled:opacity-50"
                                                placeholder="User-facing label"
                                            />
                                        </div>

                                        <div className="space-y-1">
                                            <label className="text-xs font-medium text-slate-500 uppercase tracking-wider">Default Value</label>
                                            {param.type === 'textarea' ? (
                                                <textarea
                                                    value={param.defaultValue}
                                                    onChange={(e) => handleDefaultChange(param.key, e.target.value)}
                                                    disabled={!param.enabled}
                                                    className="w-full bg-black/20 border border-white/5 rounded-lg px-3 py-2 text-sm text-white focus:ring-1 focus:ring-primary focus:border-primary/50 outline-none disabled:opacity-50 h-[38px] leading-tight resize-none"
                                                />
                                            ) : (
                                                <input
                                                    type={param.type === 'number' ? 'number' : 'text'}
                                                    value={param.defaultValue}
                                                    onChange={(e) => handleDefaultChange(param.key, e.target.value)}
                                                    disabled={!param.enabled}
                                                    className="w-full bg-black/20 border border-white/5 rounded-lg px-3 py-2 text-sm text-white focus:ring-1 focus:ring-primary focus:border-primary/50 outline-none disabled:opacity-50"
                                                />
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    );
                })}

                {parameters.length === 0 && (
                    <div className="text-center py-12 text-slate-500">
                        No configurable parameters found in this workflow
                    </div>
                )}
            </div>
        </div>
    );
};

export default ParameterSelector;
