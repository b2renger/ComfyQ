// diag — one console line per step of the admin's maintenance flow, written to
// be COPIED: a fixed prefix to filter on ("ComfyQ") and a single-line JSON
// summary rather than an expandable object, which the console copies as
// "Object" and loses.
//
//   [ComfyQ prune] rescan ← 200 in 812 ms {"bundles":64,"unused":3,...}
//
// Always on: these are a handful of lines per click, and the point is that the
// next "it still doesn't work" arrives with the evidence attached.

const stamp = () => new Date().toISOString().slice(11, 23);

const compact = (data) => {
    if (data === undefined) return '';
    try {
        const s = JSON.stringify(data);
        return s.length > 1500 ? `${s.slice(0, 1500)}…(${s.length} chars)` : s;
    } catch { return String(data); }
};

export function diag(area, event, data) {
    try {
        // eslint-disable-next-line no-console
        console.log(`[ComfyQ ${area}] ${stamp()} ${event}${data === undefined ? '' : ' ' + compact(data)}`);
    } catch { /* logging must never break the page */ }
}

export function diagWarn(area, event, data) {
    try {
        // eslint-disable-next-line no-console
        console.warn(`[ComfyQ ${area}] ${stamp()} ${event}${data === undefined ? '' : ' ' + compact(data)}`);
    } catch { /* logging must never break the page */ }
}

/**
 * fetch(), logged: what was asked, the status, how long it took, and a summary
 * of the answer chosen by the caller (the full body is usually too big to paste).
 * Returns { res, data } with the body already parsed (null if it was not JSON).
 */
export async function diagFetch(area, label, url, opts = {}, summarize = (d) => d) {
    const t0 = performance.now();
    const method = (opts.method || 'GET').toUpperCase();
    let body;
    if (opts.body) { try { body = JSON.parse(opts.body); } catch { body = '(non-JSON body)'; } }
    diag(area, `${label} → ${method} ${String(url).replace(/^https?:\/\/[^/]+/, '')}`, body);
    let res, data = null;
    try {
        res = await fetch(url, opts);
    } catch (e) {
        diagWarn(area, `${label} ✗ network error after ${Math.round(performance.now() - t0)} ms`, { error: e.message });
        throw e;
    }
    const text = await res.text();
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    const ms = Math.round(performance.now() - t0);
    const summary = data ? (() => { try { return summarize(data); } catch { return data; } })() : text.slice(0, 300);
    (res.ok ? diag : diagWarn)(area, `${label} ← ${res.status} in ${ms} ms`, summary);
    return { res, data };
}
