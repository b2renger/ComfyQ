// ComfyQ — auto-open a workflow handed over by ComfyQ's admin panel.
//
// ComfyQ stages a workflow into ComfyUI's user/default/workflows and opens
// ComfyUI with `?comfyq_open=<name>`. This extension reads that param on load,
// fetches the staged workflow, and loads it onto the canvas — so the admin's
// "Open in ComfyUI" lands directly on the editable graph (no manual pick).
//
// Installed/updated automatically by the ComfyQ server into
// <comfy_root>/custom_nodes/comfyq_opener. Inert unless the param is present.
import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const PARAM = "comfyq_open";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// setup() runs BEFORE ComfyUI's Vue <GraphCanvas> has finished mounting, so at
// that point `app.canvas` is already truthy but the Vue *canvas store* that
// loadGraphData's fitView() reads is still null — loading then aborts the whole
// graph with "getCanvas: canvas is null". Wait for the real <canvas> element to
// be connected to the DOM and laid out (non-zero size): that only happens after
// the mount completes, which is also when the canvas store is populated.
async function waitForCanvas() {
    for (let i = 0; i < 200; i++) { // up to ~20s (this rig mounts the canvas late)
        const el = app?.canvas?.canvas; // the HTMLCanvasElement LiteGraph draws on
        if (app?.graph && el && el.isConnected && el.clientWidth > 0 && el.clientHeight > 0) {
            return true;
        }
        await sleep(100);
    }
    return false;
}

async function fetchStagedWorkflow(name) {
    const rel = `workflows/${name}.json`;
    const res = api.getUserData
        ? await api.getUserData(rel)
        : await api.fetchApi(`/userdata/${encodeURIComponent(rel)}`);
    if (!res || !res.ok) return null;
    return res.json();
}

// Load the staged graph, matching ComfyUI's own template loader exactly:
// (graphData, clean, restore_view, workflowName, {openSource:'template'}). The
// 4th/5th args register SUBGRAPH definitions, so a subgraph workflow (most of
// ours) loads runnable instead of broken. If the canvas store is still a beat
// behind (fitView → getCanvas null), retry a few times, then fall back to
// restore_view:false so the (already subgraph-registered) graph still lands
// even if the viewport-fit keeps racing.
async function loadWithRetry(graph, name) {
    let lastErr;
    for (let attempt = 0; attempt < 4; attempt++) {
        try {
            await app.loadGraphData(graph, true, true, name, { openSource: "template" });
            return true;
        } catch (e) {
            lastErr = e;
            await sleep(500);
        }
    }
    try {
        await app.loadGraphData(graph, true, false, name, { openSource: "template" });
        return true;
    } catch (e) {
        throw lastErr || e;
    }
}

app.registerExtension({
    name: "ComfyQ.Opener",
    async setup() {
        let name = null;
        try { name = new URLSearchParams(window.location.search).get(PARAM); } catch { return; }
        if (!name) return;

        // Drop the param immediately so a manual refresh doesn't re-open (which
        // would discard in-progress edits).
        try {
            const u = new URL(window.location.href);
            u.searchParams.delete(PARAM);
            window.history.replaceState({}, "", u.pathname + (u.search || "") + (u.hash || ""));
        } catch { /* non-fatal */ }

        // Fire-and-forget: return from setup() right away so we don't hold up
        // ComfyUI's startup — and specifically so we're not blocking inside the
        // very phase that mounts the canvas we're waiting on. Errors are logged,
        // never surfaced as ComfyUI's "Loading aborted" dialog.
        (async () => {
            try {
                if (!(await waitForCanvas())) {
                    console.warn("[ComfyQ] canvas never became ready — skipping auto-open");
                    return;
                }
                // Let ComfyUI's own last-session restore settle first, so ours wins.
                await sleep(500);
                const graph = await fetchStagedWorkflow(name);
                if (!graph) { console.warn(`[ComfyQ] staged workflow not found: ${name}`); return; }
                await loadWithRetry(graph, name);
                console.log(`[ComfyQ] opened workflow "${name}"`);
            } catch (e) {
                console.error(`[ComfyQ] failed to open workflow "${name}"`, e);
            }
        })();
    },
});
