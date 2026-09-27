// Convert a ComfyUI API-format graph (a bundle's `<id>.api.json`) BACK into the
// UI/litegraph format ComfyUI's editor opens — the `<id>_template.json` every
// bundle is supposed to ship, so an admin can hit "Open in ComfyUI" and get an
// editable graph instead of a download-and-drag.
//
// It is the mirror of ../ui-to-api/convert.mjs and works the same way: drive
// ComfyUI's OWN frontend in headless Chrome. `app.loadApiJson()` builds real
// nodes from the live node definitions, wires the links, and calls
// `graph.arrange()` twice to lay them out; `graph.serialize()` then writes the
// UI format. Doing it through the frontend means widget order, input slots and
// node sizes come from ComfyUI itself rather than from our guesses.
//
// ★ Two things this checks, because both fail SILENTLY otherwise:
//
//   1. A class_type ComfyUI does not know does NOT throw. loadApiJson replaces
//      it with a placeholder node carrying `has_errors`, so you would get a
//      template that opens looking almost right and cannot run. Any unresolved
//      node aborts that bundle instead of writing a file.
//   2. The generated template is round-tripped straight back through
//      `graphToPrompt()` (the "Export (API)" path) and diffed against the
//      api.json it came from. A template that does not reproduce its own
//      api.json is not a usable hand-off, and the diff says which node moved.
//
//   npm install              (once, in this folder — puppeteer-core only)
//   node convert.mjs <bundle-id-or-dir> [more ...]        # writes in place
//   node convert.mjs --out <dir> <bundle ...>             # writes elsewhere
//   node convert.mjs --check <bundle ...>                 # verify only
//
// Env: COMFY_URL (default http://127.0.0.1:8188), CHROME (path to chrome/msedge),
//      WORKFLOWS (default ../../workflows).
//
// ComfyUI must be running WITH every node pack the bundle uses — the check in
// (1) is precisely what catches a missing pack.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORKFLOWS = process.env.WORKFLOWS || path.resolve(HERE, '../../workflows');

const argv = process.argv.slice(2);
let outDir = null, checkOnly = false;
const targets = [];
for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') outDir = argv[++i];
    else if (argv[i] === '--check') checkOnly = true;
    else targets.push(argv[i]);
}
if (targets.length === 0) {
    console.error('usage: node convert.mjs [--out <dir>] [--check] <bundle-id-or-dir> [more ...]');
    process.exit(2);
}

// A target may be a bundle id, a bundle directory, or an api.json path.
function resolveBundle(t) {
    let dir = t, id = path.basename(t);
    if (t.endsWith('.api.json')) { dir = path.dirname(t); id = path.basename(t, '.api.json'); }
    else if (!fs.existsSync(dir)) dir = path.join(WORKFLOWS, t);
    const api = path.join(dir, `${id}.api.json`);
    if (!fs.existsSync(api)) throw new Error(`no api.json for "${t}" (looked for ${api})`);
    return { id, dir, api };
}

const COMFY = process.env.COMFY_URL || 'http://127.0.0.1:8188';
const CHROME = process.env.CHROME || [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
].find(p => fs.existsSync(p));
if (!CHROME) { console.error('No Chrome/Edge found — set CHROME=<path>'); process.exit(2); }

// --- round-trip comparison -------------------------------------------------
// Compare the api.json we started from with the one ComfyUI exports from the
// generated template. Only what EXECUTES matters: which nodes exist, what class
// they are, and every input (a literal, or a [nodeId, slot] link).
function compareGraphs(want, got) {
    const diffs = [];
    const wk = new Set(Object.keys(want)), gk = new Set(Object.keys(got));
    for (const k of wk) if (!gk.has(k)) diffs.push(`missing node ${k} (${want[k].class_type})`);
    for (const k of gk) if (!wk.has(k)) diffs.push(`extra node ${k} (${got[k].class_type})`);
    for (const k of [...wk].filter(k => gk.has(k))) {
        const a = want[k], b = got[k];
        if (a.class_type !== b.class_type) {
            diffs.push(`node ${k}: class ${a.class_type} -> ${b.class_type}`);
            continue;
        }
        const fields = new Set([...Object.keys(a.inputs || {}), ...Object.keys(b.inputs || {})]);
        for (const f of fields) {
            const av = (a.inputs || {})[f], bv = (b.inputs || {})[f];
            if (JSON.stringify(av) !== JSON.stringify(bv)) {
                diffs.push(`node ${k} (${a.class_type}).${f}: ${JSON.stringify(av)} -> ${JSON.stringify(bv)}`);
            }
        }
    }
    return diffs;
}

// A Note telling whoever opens this what it is and where it came from. Note is
// a frontend-only node, so it never reaches the prompt — the round-trip check
// below proves that rather than assuming it.
function addNote(graph, id, text) {
    let minX = Infinity, minY = Infinity;
    for (const n of graph.nodes || []) {
        if (Array.isArray(n.pos)) { minX = Math.min(minX, n.pos[0]); minY = Math.min(minY, n.pos[1]); }
    }
    if (!Number.isFinite(minX)) { minX = 0; minY = 0; }
    const used = (graph.nodes || []).map(n => Number(n.id)).filter(Number.isFinite);
    const noteId = (used.length ? Math.max(...used) : 0) + 1;
    graph.nodes = graph.nodes || [];
    graph.nodes.unshift({
        id: noteId, type: 'Note', pos: [minX, minY - 260], size: [520, 200],
        flags: {}, order: 0, mode: 0, inputs: [], outputs: [], title: 'ComfyQ bundle',
        properties: {}, widgets_values: [text], color: '#432', bgcolor: '#653',
    });
    if (typeof graph.last_node_id === 'number') graph.last_node_id = Math.max(graph.last_node_id, noteId);
    return graph;
}

// --- drive the frontend ----------------------------------------------------
const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true,
    args: ['--window-size=1600,1000', '--no-first-run', '--disable-gpu'],
    defaultViewport: { width: 1600, height: 1000 },
});
const page = await browser.newPage();
const logs = [];
page.on('console', m => { if (/error|warn/i.test(m.type())) logs.push(`[${m.type()}] ${m.text().slice(0, 300)}`); });
page.on('pageerror', e => logs.push(`[pageerror] ${e.message.slice(0, 300)}`));
page.on('dialog', d => d.dismiss());

await page.goto(COMFY + '/', { waitUntil: 'domcontentloaded', timeout: 120000 });
// Same race as the ComfyQ opener: the app object appears before the Vue canvas
// is laid out, and arrange()/fitView touch the canvas store.
await page.waitForFunction(() => {
    const app = window.app || window.comfyAPI?.app?.app;
    const c = document.querySelector('canvas#graph-canvas') || document.querySelector('canvas');
    return app && app.graph && c && c.isConnected && c.clientWidth > 0;
}, { timeout: 180000, polling: 500 });
await new Promise(r => setTimeout(r, 4000));

let failures = 0;
const report = [];

for (const target of targets) {
    let b;
    try { b = resolveBundle(target); }
    catch (e) { console.log(`FAIL ${target}: ${e.message}`); failures++; continue; }

    const apiJson = JSON.parse(fs.readFileSync(b.api, 'utf8'));
    logs.length = 0;

    // Pass 1 — api.json -> UI graph.
    const built = await page.evaluate(async (api, name) => {
        const app = window.app || window.comfyAPI?.app?.app;
        try {
            await app.loadApiJson(api, name);
            await new Promise(r => setTimeout(r, 1200));
            const graph = app.rootGraph ? app.rootGraph.serialize() : app.graph.serialize();
            // Any node the frontend could not resolve became a placeholder.
            const bad = [];
            for (const n of graph.nodes || []) {
                const def = window.LiteGraph?.registered_node_types?.[n.type];
                if (!def) bad.push(`${n.id}: ${n.type}`);
            }
            return { ok: true, graph, bad };
        } catch (e) {
            return { ok: false, error: String((e && e.stack) || e) };
        }
    }, apiJson, b.id);

    if (!built.ok) {
        console.log(`FAIL ${b.id}: ${built.error.slice(0, 300)}`);
        report.push({ id: b.id, ok: false, error: built.error, logs: [...logs] });
        failures++;
        continue;
    }
    if (built.bad.length) {
        // Writing this would produce a template that opens looking plausible and
        // cannot run. Almost always a node pack missing from THIS ComfyUI.
        console.log(`FAIL ${b.id}: ${built.bad.length} unregistered node type(s) — ${built.bad.slice(0, 4).join(', ')}`);
        console.log('      is the node pack installed in the ComfyUI at ' + COMFY + ' ?');
        report.push({ id: b.id, ok: false, unresolved: built.bad, logs: [...logs] });
        failures++;
        continue;
    }

    const note = [
        `${b.id}`,
        '',
        'The editable version of a ComfyQ bundle, generated from its .api.json',
        'through ComfyUI\'s own frontend (tools/api-to-ui).',
        '',
        'ComfyQ RUNS the .api.json, not this file. Edit here, then re-export',
        'through tools/ui-to-api/convert.mjs to change what actually runs.',
    ].join('\n');
    const graph = addNote(built.graph, b.id, note);

    // Pass 2 — the generated template back through "Export (API)".
    const round = await page.evaluate(async (g, name) => {
        const app = window.app || window.comfyAPI?.app?.app;
        try {
            await app.loadGraphData(g, true, false, name, { openSource: 'template' });
            await new Promise(r => setTimeout(r, 1200));
            const { output } = await app.graphToPrompt();
            return { ok: true, output };
        } catch (e) {
            return { ok: false, error: String((e && e.stack) || e) };
        }
    }, graph, b.id);

    if (!round.ok) {
        console.log(`FAIL ${b.id}: template did not re-open — ${round.error.slice(0, 200)}`);
        report.push({ id: b.id, ok: false, error: round.error, logs: [...logs] });
        failures++;
        continue;
    }

    const diffs = compareGraphs(apiJson, round.output);
    const dest = path.join(outDir || b.dir, `${b.id}_template.json`);
    if (diffs.length) {
        console.log(`FAIL ${b.id}: ${diffs.length} round-trip difference(s) — NOT written`);
        for (const d of diffs.slice(0, 8)) console.log(`      ${d}`);
        report.push({ id: b.id, ok: false, diffs, logs: [...logs] });
        failures++;
        continue;
    }

    if (!checkOnly) {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, JSON.stringify(graph, null, 2) + '\n');
    }
    const n = Object.keys(apiJson).length;
    console.log(`OK   ${b.id}: ${n} nodes, round-trip identical${checkOnly ? ' (check only)' : ` -> ${path.relative(process.cwd(), dest)}`}`);
    report.push({ id: b.id, ok: true, nodes: n, logs: [...logs] });
}

fs.writeFileSync(path.join(outDir || HERE, '_report.json'), JSON.stringify(report, null, 2));
await browser.close();
process.exit(failures ? 1 : 0);
