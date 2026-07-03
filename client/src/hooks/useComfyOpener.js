import { useState, useCallback, useMemo } from 'react';
import { SERVER_URL } from '../utils/api';

// useComfyOpener — the shared "Open in ComfyUI" flow used by the admin panel
// (per-card button) and the workflow meta editor.
//
// Given a workflow id, openInComfy():
//   1. opens a tab synchronously (inside the click gesture so the browser
//      doesn't block it), steered to ComfyUI once we know the port;
//   2. calls POST /admin/workflows/:id/open-in-comfyui, which stages the bundle's
//      UI-format template into ComfyUI's user workflows AND ensures the ComfyQ
//      opener extension is loaded (launching/restarting ComfyUI as needed);
//   3. steers the tab to `<comfyui>/?comfyq_open=<id>` — the opener extension
//      reads that param and loads the workflow straight onto the canvas.
//
// Fallbacks: `autoOpen:false` (e.g. an external ComfyUI we can't restart to load
// the opener) → open ComfyUI and tell the admin to pick it from the Workflows
// sidebar; 409 (no template) → download the API graph to drag onto the canvas.
//
// notify(msg, kind) surfaces progress/result — pass a toast (admin panel) or an
// inline setter (meta editor). `openingId` is the id currently opening (null
// when idle) so a specific card/button can show a spinner.
export function useComfyOpener({ adminPassword, notify } = {}) {
    const [openingId, setOpeningId] = useState(null);

    const headers = useMemo(() => {
        const h = { 'Content-Type': 'application/json' };
        if (adminPassword) h['X-Admin-Password'] = adminPassword;
        return h;
    }, [adminPassword]);

    const openInComfy = useCallback(async (workflowId) => {
        if (!workflowId) return;
        const tab = window.open('about:blank', '_blank');
        if (tab) {
            try { tab.document.write('<title>Opening ComfyUI…</title><body style="font:14px sans-serif;padding:2rem;color:#888">Starting ComfyUI…</body>'); } catch { /* ignore */ }
        }
        setOpeningId(workflowId);
        notify?.('Opening in ComfyUI — starting/restarting it if needed (can take up to ~90s)…', 'ok');
        let port = 8188;
        let problem = '';
        let autoOpen = false;   // opener extension confirmed → land straight on the graph
        let staged = false;     // template staged (sidebar handoff works even without autoOpen)
        let openName = `${workflowId}_template`; // the staged workflow's name in ComfyUI
        try {
            const r = await fetch(`${SERVER_URL}/admin/workflows/${encodeURIComponent(workflowId)}/open-in-comfyui`, { method: 'POST', headers });
            if (r.ok) {
                const d = await r.json().catch(() => ({}));
                if (d.port) port = d.port;
                if (d.openName) openName = d.openName;
                autoOpen = !!d.autoOpen;
                staged = true;
            } else if (r.status === 409) {
                // No editable template — fall back to downloading the graph to drag.
                const ed = await (await fetch(`${SERVER_URL}/admin/workflows/${encodeURIComponent(workflowId)}/edit-data`, { headers })).json().catch(() => ({}));
                const data = ed.templateWorkflow || ed.apiWorkflow;
                if (data) downloadJsonBlob(JSON.stringify(data, null, 2), ed.templateWorkflow ? `${workflowId}.json` : `${workflowId}.api.json`);
                const s = await (await fetch(`${SERVER_URL}/admin/comfyui/status`, { headers })).json().catch(() => ({}));
                if (s.port) port = s.port;
            } else {
                const e = await r.json().catch(() => ({}));
                throw new Error(e.error || 'could not open in ComfyUI');
            }
        } catch (e) {
            problem = e.message || String(e);
        } finally {
            setOpeningId(null);
        }
        const base = `${window.location.protocol}//${window.location.hostname}:${port}/`;
        const url = (staged && autoOpen) ? `${base}?comfyq_open=${encodeURIComponent(openName)}` : base;
        if (tab) tab.location = url; else window.open(url, '_blank', 'noopener');
        if (staged && autoOpen) {
            notify?.(problem
                ? `Opened ComfyUI, but hit a problem (${problem}). If the graph didn’t load, open “${openName}” from the Workflows menu.`
                : `Opening “${workflowId}” in ComfyUI — the graph loads automatically.`,
            problem ? 'err' : 'ok');
        } else if (staged) {
            notify?.(`ComfyUI is open — open “${openName}” from the Workflows menu (folder icon, top-left) to edit the graph.`, 'ok');
        } else {
            notify?.(problem
                ? `Couldn’t open “${workflowId}” in ComfyUI (${problem}).`
                : 'ComfyUI is open — drag the downloaded workflow onto its canvas.',
            problem ? 'err' : 'ok');
        }
    }, [headers, notify]);

    return { openingId, openInComfy };
}

function downloadJsonBlob(text, filename) {
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}
