// ComfyQ — auto-open a workflow handed over by ComfyQ's admin panel.
//
// ComfyQ stages a workflow into ComfyUI's user/default/workflows and opens
// ComfyUI with `?comfyq_open=<name>`. This extension reads that param on load,
// fetches the staged workflow, and loads it onto the canvas — so the admin's
// "Open in ComfyUI" lands directly on the editable graph (no manual pick).
//
// Installed/updated automatically by the ComfyQ server into
// <comfy_root>/custom_nodes/comfyq_opener. Inert unless the param is present.
//
// ★★ The race that made it open "the wrong workflow" (v5). ComfyUI restores the
// browser's previous session — its open tabs and the last active graph — on its
// own schedule. On a fast machine that finishes before we load; on a slow one,
// or a cold first load, it finishes AFTER, and it replaces the canvas graph while
// our tab stays selected: the tab reads "my_workflow" and the canvas shows the
// previous session's nodes. Reproduced with the CPU throttled 6x. So now:
//   1. wait until ComfyUI's own restore has SETTLED (the canvas graph has stopped
//      changing for a while), then load;
//   2. afterwards, keep checking that the canvas really holds the staged graph,
//      and load it again if anything replaced it.
import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const PARAM = "comfyq_open";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// setup() runs BEFORE ComfyUI's Vue <GraphCanvas> has finished mounting, so at
// that point `app.canvas` is already truthy but the Vue canvas store that
// loadGraphData's fitView() reads is still null. Wait for the real <canvas> to
// be connected and laid out, which only happens once the mount is complete.
async function waitForCanvas(limitMs) {
    const end = Date.now() + limitMs;
    while (Date.now() < end) {
        const el = app?.canvas?.canvas;
        if (app?.graph && el && el.isConnected && el.clientWidth > 0 && el.clientHeight > 0) return true;
        await sleep(100);
    }
    return false;
}

// What is on the canvas right now, as top-level node ids + types.
function canvasEntries() {
    const nodes = app?.graph?._nodes || app?.graph?.nodes || [];
    return nodes.map((n) => `${n.id}:${n.type}`);
}
function canvasSignature() { return canvasEntries().sort().join("|"); }

// ★ "Replaced", not "changed". The admin may start editing at once — adding a
// node changes the canvas but leaves ours on it. Only when most of the staged
// graph's nodes are GONE is another workflow on the canvas.
function looksReplaced(wantEntries) {
    if (!wantEntries.length) return false;
    const have = new Set(canvasEntries());
    const kept = wantEntries.filter((e) => have.has(e)).length;
    return kept < wantEntries.length / 2;
}

// ComfyUI's session restore is done when the canvas has stopped changing for a
// while. Bounded: a browser with nothing to restore settles at once.
async function waitForQuiet(quietMs, limitMs) {
    const end = Date.now() + limitMs;
    let last = canvasSignature();
    let since = Date.now();
    while (Date.now() < end) {
        await sleep(200);
        const now = canvasSignature();
        if (now !== last) { last = now; since = Date.now(); continue; }
        if (Date.now() - since >= quietMs) return true;
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

// Load the staged graph exactly as ComfyUI's own template loader does:
// (graphData, clean, restore_view, workflowName, {openSource:'template'}). The
// 4th/5th args register SUBGRAPH definitions, so a subgraph workflow (most of
// ours) loads runnable instead of broken. If the canvas store is a beat behind
// (fitView → getCanvas null), retry, then fall back to restore_view:false.
async function load(graph, name) {
    let lastErr;
    for (let attempt = 0; attempt < 4; attempt++) {
        try {
            await app.loadGraphData(graph, true, true, name, { openSource: "template" });
            return;
        } catch (e) {
            lastErr = e;
            await sleep(500);
        }
    }
    try {
        await app.loadGraphData(graph, true, false, name, { openSource: "template" });
    } catch (e) {
        throw lastErr || e;
    }
}

// Load again INTO our existing tab. Passing the name a second time would open
// "name (2)" beside a tab that still holds the other workflow under our name —
// and saving that one would write the wrong graph into the staged file.
async function reloadInto(graph, name) {
    try {
        const wfs = app?.extensionManager?.workflow;
        const mine = (wfs?.openWorkflows || []).find((w) => (w.filename || w.path || "").replace(/\.json$/, "").split("/").pop() === name);
        if (mine) {
            await app.loadGraphData(graph, true, true, mine, { openSource: "template" });
            return;
        }
    } catch (e) {
        console.warn("[ComfyQ] could not reload into the open tab, opening it again", e);
    }
    await load(graph, name);
}

async function openStaged(name) {
    if (!(await waitForCanvas(60000))) {
        console.warn("[ComfyQ] canvas never became ready — skipping auto-open");
        return;
    }
    const graph = await fetchStagedWorkflow(name);
    if (!graph) { console.warn(`[ComfyQ] staged workflow not found: ${name}`); return; }
    const want = (graph.nodes || []).map((n) => `${n.id}:${n.type}`);

    // 1. Let ComfyUI finish restoring the previous session first.
    await waitForQuiet(1500, 30000);
    await load(graph, name);

    // 2. Then make sure nothing replaced it. A restore that was still in flight
    //    lands here; load again (at most twice) rather than leave the admin
    //    looking at another workflow under this one's name.
    //    The watch ends the moment the admin touches the canvas or the keyboard:
    //    from then on, whatever is on screen is theirs.
    let touched = false;
    const stop = () => { touched = true; };
    window.addEventListener("pointerdown", stop, { capture: true, once: true });
    window.addEventListener("keydown", stop, { capture: true, once: true });
    let reloads = 0;
    const end = Date.now() + 20000;
    while (Date.now() < end && !touched) {
        await sleep(500);
        if (touched || !looksReplaced(want)) continue;
        if (reloads >= 2) {
            console.warn(`[ComfyQ] "${name}" keeps being replaced on the canvas — open it from the Workflows menu`);
            return;
        }
        reloads++;
        console.warn(`[ComfyQ] the canvas was replaced after opening "${name}" — loading it again (${reloads})`);
        await waitForQuiet(1000, 10000);
        await reloadInto(graph, name);
    }
    window.removeEventListener("pointerdown", stop, { capture: true });
    window.removeEventListener("keydown", stop, { capture: true });
    console.log(`[ComfyQ] opened workflow "${name}"${reloads ? ` after ${reloads} reload(s)` : ""}`);
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

        // Fire-and-forget: return from setup() at once so ComfyUI's startup —
        // including the canvas mount we wait for — is not held up. Errors are
        // logged, never surfaced as ComfyUI's "Loading aborted" dialog.
        openStaged(name).catch((e) => console.error(`[ComfyQ] failed to open workflow "${name}"`, e));
    },
});
