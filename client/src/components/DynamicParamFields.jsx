import React from 'react';
import { Dices } from 'lucide-react';
import MediaCaptureField from './capture/MediaCaptureField';
import MaskDrawField from './capture/MaskDrawField';

// A param qualifies as a "seed" if its key or field looks like one. Catches
// both KSampler.seed (Flux1) and RandomNoise.noise_seed (Flux2), plus any
// custom node that exposes a *_seed field.
export const isSeedParam = (key, config) => {
    const k = String(key || '').toLowerCase();
    const f = String(config?.field || '').toLowerCase();
    return k === 'seed' || k.endsWith('_seed')
        || f === 'seed' || f.endsWith('_seed');
};
export const randomSeed = () => Math.floor(Math.random() * 4294967295);

// Strip the upload prefix from a comfy input filename to show the user's
// original name (comfyq_session__<ts>_<rand>__photo.png → photo.png).
export const prettyInputName = (fn) => String(fn || '')
    .replace(/^comfyq_session__\d+_\d+__/, '')
    .replace(/^comfyq__[a-f0-9]+__/i, '');

// DynamicParamFields — the student-facing parameter form, rendered from a
// `parameter_map`. This is the SINGLE source of truth for how exposed parameters
// look to students: the real BookingDialog renders it with live booking state,
// and the admin workflow editor renders it (with throwaway state) as a live
// preview — so the preview can never drift from what students actually see.
//
// Props:
//   paramMap            { [key]: { type, label, default, options, min, max, step,
//                                  disabledWhen, required, order, field } }
//   values              { [key]: currentValue }
//   onValueChange       (key, value) => void
//   mediaPreviews       { [key]: dataURL|serverURL }  (image/video/audio/mask previews)
//   recalledMedia       { [key]: comfyFilename }      (reused-from-a-prior-job badge)
//   mediaChangeHandler  (key) => (file: File) => void
//   mediaRemoveHandler  (key) => () => void
const DynamicParamFields = ({
    paramMap,
    values = {},
    onValueChange,
    mediaPreviews = {},
    recalledMedia = {},
    mediaChangeHandler,
    mediaRemoveHandler,
}) => {
    if (!paramMap) return null;
    const setVal = (key, value) => onValueChange && onValueChange(key, value);
    const noop = () => () => {};
    const onMedia = mediaChangeHandler || noop;
    const onMediaRemove = mediaRemoveHandler || noop;

    const sortedParams = Object.entries(paramMap)
        .sort(([, a], [, b]) => (a.order || 0) - (b.order || 0));

    return (
        <div className="space-y-4">
            {sortedParams.map(([key, config]) => {
                const label = config.label || key.charAt(0).toUpperCase() + key.slice(1);
                const type = config.type || 'text';

                // Conditional gray-out: a field can declare `disabledWhen`
                // ({ param, equals }) to render disabled while another param
                // (a toggle) holds a given value — e.g. either/or prompt
                // boxes gated by an "Enhance" checkbox.
                const dw = config.disabledWhen;
                const disabled = !!dw && values[dw.param] === dw.equals;
                const ctrlLabel = dw && (paramMap[dw.param]?.label || 'the toggle above');

                // Mask input — the user paints a region on an uploaded image;
                // MaskDrawField composites it into an RGBA PNG and hands that
                // File up the SAME path as a normal upload.
                if (type === 'mask') {
                    return (
                        <MaskDrawField
                            key={key}
                            paramKey={key}
                            label={label}
                            maxInputEdge={config.maxInputEdge}
                            preview={mediaPreviews[key]}
                            recalledName={recalledMedia[key] ? prettyInputName(recalledMedia[key]) : null}
                            onChange={onMedia(key)}
                            onRemove={onMediaRemove(key)}
                        />
                    );
                }

                // Image / video / audio input — delegated to MediaCaptureField,
                // which renders the file-upload widget (click + drag-and-drop),
                // then applies maxInputEdge resizing for images.
                if (type === 'image' || type === 'video' || type === 'audio') {
                    return (
                        <MediaCaptureField
                            key={key}
                            paramKey={key}
                            label={label}
                            type={type}
                            maxInputEdge={config.maxInputEdge}
                            preview={mediaPreviews[key]}
                            recalledName={recalledMedia[key] ? prettyInputName(recalledMedia[key]) : null}
                            onChange={onMedia(key)}
                            onRemove={onMediaRemove(key)}
                        />
                    );
                }

                // Select Input
                if (type === 'select' && config.options) {
                    return (
                        <div key={key} className="space-y-1.5">
                            <label className="text-sm font-medium text-slate-300">{label}</label>
                            <select
                                className="w-full bg-background border border-border rounded-lg p-2.5 text-white focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all appearance-none cursor-pointer"
                                value={values[key] || ''}
                                onChange={(e) => setVal(key, e.target.value)}
                            >
                                {config.options.map(opt => (
                                    <option key={opt} value={opt}>{opt}</option>
                                ))}
                            </select>
                        </div>
                    );
                }

                // Checkbox / toggle Input
                if (type === 'checkbox') {
                    const checked = !!values[key];
                    return (
                        <label key={key} className="flex items-center gap-3 cursor-pointer select-none py-1">
                            <button
                                type="button"
                                role="switch"
                                aria-checked={checked}
                                onClick={() => setVal(key, !checked)}
                                className={`relative w-10 h-6 rounded-full transition-colors shrink-0 ${checked ? 'bg-primary' : 'bg-surface border border-border'}`}
                            >
                                <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-on-primary shadow transition-transform ${checked ? 'translate-x-4' : ''}`} />
                            </button>
                            <span className="text-sm font-medium text-slate-300">{label}</span>
                        </label>
                    );
                }

                // Textarea Input
                if (type === 'textarea' || key === 'prompt') {
                    return (
                        <div key={key} className={`space-y-1.5 ${disabled ? 'opacity-50' : ''}`}>
                            <label className="text-sm font-medium text-slate-300 flex items-center gap-2 flex-wrap">
                                {label}
                                {disabled && (
                                    <span className="text-[10px] font-normal text-muted normal-case">
                                        — disabled; change “{ctrlLabel}” to edit
                                    </span>
                                )}
                            </label>
                            <textarea
                                disabled={disabled}
                                className={`w-full bg-background border border-border rounded-lg p-3 text-white focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all placeholder:text-muted/50 min-h-[100px] resize-none ${disabled ? 'cursor-not-allowed' : ''}`}
                                value={values[key] || ''}
                                onChange={(e) => setVal(key, e.target.value)}
                                placeholder={`Enter ${label}...`}
                            />
                        </div>
                    );
                }

                // Seed Input — auto-randomized; re-roll button; user can type a specific value
                if (isSeedParam(key, config)) {
                    return (
                        <div key={key} className="space-y-1.5">
                            <label className="text-sm font-medium text-slate-300">{label}</label>
                            <div className="flex items-center gap-2">
                                <input
                                    type="number"
                                    className="flex-1 bg-background border border-border rounded-lg p-2.5 text-white focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all"
                                    value={values[key] ?? ''}
                                    onChange={(e) => {
                                        const v = e.target.value;
                                        setVal(key, v === '' ? '' : parseInt(v, 10) || 0);
                                    }}
                                />
                                <button
                                    type="button"
                                    onClick={() => setVal(key, randomSeed())}
                                    className="p-2.5 rounded-lg bg-surface border border-border hover:bg-white/5 text-muted hover:text-primary transition-colors"
                                    title="Randomize seed"
                                >
                                    <Dices size={18} />
                                </button>
                            </div>
                            <p className="text-[10px] text-muted ml-1">Auto-randomized each time. Click the dice to re-roll, or type a specific value.</p>
                        </div>
                    );
                }

                // Default Input (Text/Number)
                return (
                    <div key={key} className="space-y-1.5">
                        <label className="text-sm font-medium text-slate-300">{label}</label>
                        <input
                            type={type === 'number' ? 'number' : 'text'}
                            className="w-full bg-background border border-border rounded-lg p-2.5 text-white focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all"
                            value={values[key] ?? ''}
                            onChange={(e) => setVal(key, type === 'number' ? parseFloat(e.target.value) : e.target.value)}
                        />
                    </div>
                );
            })}
        </div>
    );
};

export default DynamicParamFields;
