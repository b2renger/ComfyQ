// Convert ComfyUI UI/litegraph workflows (the `_template.json` / candidate
// format) to API format using ComfyUI's OWN frontend in headless Chrome:
// load each graph with app.loadGraphData, then app.graphToPrompt() — the exact
// code path behind "Export (API)". Subgraphs, bypassed/muted nodes, primitives
// and reroutes are flattened exactly as ComfyUI would, instead of by hand.
//
// Needs a running ComfyUI with every node pack the workflows use. Verified
// 2026-09-14 by converting four production templates and diffing against their
// hand-made api.json: identical apart from the documented hand edits.
//
//   npm install            (once, in this folder — puppeteer-core only)
//   node convert.mjs <outDir> <workflow.json> [more.json ...]
//
// Env: COMFY_URL (default http://127.0.0.1:8188), CHROME (path to chrome/msedge).
// Watch the console warnings it prints: "[ExecutableNodeDTO.resolveOutput] No
// input types match…" means a BYPASSED node sat in a live path and ComfyUI
// dropped the link — the converted graph is then missing a required input.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';

const [outDir, ...files] = process.argv.slice(2);
if (!outDir || files.length === 0) {
    console.error('usage: node convert.mjs <outDir> <workflow.json> [more.json ...]');
    process.exit(2);
}
const COMFY = process.env.COMFY_URL || 'http://127.0.0.1:8188';
const CHROME = process.env.CHROME || [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
].find(p => fs.existsSync(p));
if (!CHROME) { console.error('No Chrome/Edge found — set CHROME=<path>'); process.exit(2); }
fs.mkdirSync(outDir, { recursive: true });

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
// Wait for the app AND a laid-out canvas: loadGraphData fits the view and throws
// if the Vue canvas store isn't mounted yet (same race as the ComfyQ opener).
await page.waitForFunction(() => {
    const app = window.app || window.comfyAPI?.app?.app;
    const c = document.querySelector('canvas#graph-canvas') || document.querySelector('canvas');
    return app && app.graph && c && c.isConnected && c.clientWidth > 0;
}, { timeout: 180000, polling: 500 });
await new Promise(r => setTimeout(r, 4000));

const report = [];
for (const file of files) {
    const name = path.basename(file, '.json');
    const graph = JSON.parse(fs.readFileSync(file, 'utf8'));
    logs.length = 0;
    const res = await page.evaluate(async (graph, name) => {
        const app = window.app || window.comfyAPI?.app?.app;
        try {
            await app.loadGraphData(graph, true, false, name, { openSource: 'template' });
            await new Promise(r => setTimeout(r, 1500));
            const { output } = await app.graphToPrompt();
            return { ok: true, output };
        } catch (e) {
            return { ok: false, error: String((e && e.stack) || e) };
        }
    }, graph, name);
    if (res.ok) {
        fs.writeFileSync(path.join(outDir, `${name}.api.json`), JSON.stringify(res.output, null, 2));
        console.log(`OK   ${name}: ${Object.keys(res.output).length} nodes${logs.length ? ` (${logs.length} console warnings — see _report.json)` : ''}`);
        report.push({ name, ok: true, nodes: Object.keys(res.output).length, logs: [...logs] });
    } else {
        console.log(`FAIL ${name}: ${res.error.slice(0, 300)}`);
        report.push({ name, ok: false, error: res.error, logs: [...logs] });
    }
}
fs.writeFileSync(path.join(outDir, '_report.json'), JSON.stringify(report, null, 2));
await browser.close();
