import React from 'react';

// fmt — humanize a seconds-remaining number. Returns null for the cases
// where we'd rather render nothing than a misleading value.
const fmt = (sec) => {
    if (sec == null || sec < 0) return null;
    if (sec < 5) return 'finishing…';
    if (sec < 60) return `~${Math.round(sec)}s left`;
    const m = Math.floor(sec / 60);
    const s = Math.round(sec - m * 60);
    if (m > 60) return null;
    return s > 0 ? `~${m}m ${s}s left` : `~${m}m left`;
};

// Inline countdown chip — paired with ProgressViz, but standalone-usable.
// Renders nothing when the ETA can't be computed (uncalibrated workflow,
// non-processing job, etc.) so callers don't need to null-check.
const ETABadge = ({ etaSeconds, className = '' }) => {
    const label = fmt(etaSeconds);
    if (!label) return null;
    return <span className={className}>{label}</span>;
};

export default ETABadge;
