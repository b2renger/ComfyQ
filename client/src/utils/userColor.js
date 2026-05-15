// Deterministic per-user color assignment.
//
// Every username hashes (FNV-1a, fast, deterministic, no crypto needed) to an
// index in a curated 12-color palette. Same name always lands on the same
// color across browsers, sessions, and reloads — that's the whole point: a
// student sees their own pink hue every time, and recognizes their classmate's
// blue at a glance whether they're looking at the timeline, the All Jobs
// grid, or the MyJobs sidebar.
//
// Each palette entry exposes three correlated shades because the dark UI
// uses them differently:
//   - dot:  saturated foreground, used for small dots / icons / avatars
//   - ring: lighter accent for borders / outlines on dark surfaces
//   - bg:   low-alpha background tint that doesn't fight body text
//
// All hues are picked from Tailwind's 400/500 line and tested against the
// existing #0f172a-ish background — enough contrast to read at a glance,
// not so saturated that two adjacent cards look like a clown car.
//
// Why 12 hues, not 16 or 24? At a workshop with ~10 students we want
// collisions to be rare-but-possible, not impossible. If collisions matter
// (large classroom), the obvious next step is hash-into-HSL with a fixed
// L/S — left as a comment, not implemented.

const PALETTE = [
    { dot: '#ef4444', ring: '#f87171', bg: 'rgba(239,68,68,0.15)' },   // red
    { dot: '#f97316', ring: '#fb923c', bg: 'rgba(249,115,22,0.15)' },  // orange
    { dot: '#eab308', ring: '#facc15', bg: 'rgba(234,179,8,0.15)' },   // yellow
    { dot: '#84cc16', ring: '#a3e635', bg: 'rgba(132,204,22,0.15)' },  // lime
    { dot: '#22c55e', ring: '#4ade80', bg: 'rgba(34,197,94,0.15)' },   // green
    { dot: '#10b981', ring: '#34d399', bg: 'rgba(16,185,129,0.15)' },  // emerald
    { dot: '#06b6d4', ring: '#22d3ee', bg: 'rgba(6,182,212,0.15)' },   // cyan
    { dot: '#3b82f6', ring: '#60a5fa', bg: 'rgba(59,130,246,0.15)' },  // blue
    { dot: '#6366f1', ring: '#818cf8', bg: 'rgba(99,102,241,0.15)' },  // indigo
    { dot: '#8b5cf6', ring: '#a78bfa', bg: 'rgba(139,92,246,0.15)' },  // violet
    { dot: '#d946ef', ring: '#e879f9', bg: 'rgba(217,70,239,0.15)' },  // fuchsia
    { dot: '#ec4899', ring: '#f472b6', bg: 'rgba(236,72,153,0.15)' }   // pink
];

// Neutral fallback for the "Anonymous" / null case — looks intentionally
// grey so users notice they should set a username.
const ANON = { dot: '#94a3b8', ring: '#cbd5e1', bg: 'rgba(148,163,184,0.15)' };

// FNV-1a 32-bit. Stable across JS engines (Math.random / crypto would not be).
function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619) >>> 0;
    }
    return h;
}

export function getUserColor(username) {
    if (!username || typeof username !== 'string') return ANON;
    return PALETTE[hash(username) % PALETTE.length];
}

// Exposed for debugging / palette previews.
export const USER_COLOR_PALETTE = PALETTE;
