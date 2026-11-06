// The admin router: which routes the admin password protects, that a throw in
// an async handler cannot take the server down, and that the workflow editor
// keeps each parameter's stored key.
// (node server/routes/admin.test.js)
//
// Written because five config writes -- one of which runs whatever program the
// request names -- shipped without the gate while the README called the admin
// password "the boundary", and nothing would have noticed the next one. The
// walk below fails on any new non-GET route that forgets it.

const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const bcrypt = require('bcryptjs');
const { adminGate } = require('../auth/authGate');
const admin = require('./admin');
const { parseWorkflow } = require('../workflows/workflowParser');

const REPO = path.resolve(__dirname, '..', '..');
const PW = 'workshop123';
const HASH = bcrypt.hashSync(PW, 4);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'comfyq-admin-'));
fs.mkdirSync(path.join(tmp, 'custom_nodes', 'PackA'), { recursive: true });

let fails = 0, passes = 0;
const check = (name, cond, extra = '') => {
    if (cond) { passes++; console.log('  ok   ' + name); }
    else { fails++; console.error('  FAIL ' + name + (extra ? '  ' + extra : '')); }
};

// The surface the router uses, in memory. `hash` is switched per section.
let hash = HASH;
let stored = {
    mode: 'admin',
    comfy_ui: { root_path: tmp, api_port: 8188 },
    federation: { enabled: true },
    instance: { name: 'rig' },
    workflows: { activeWorkflowId: null, dir: path.join(REPO, 'workflows') },
    maintenance: {},
};
const configManager = {
    load: () => ({ config: { ...stored, auth: { adminPasswordHash: hash, accessPasswordHash: '' } } }),
    update: (fn) => { stored = fn(JSON.parse(JSON.stringify(stored))) || stored; return stored; },
    resolvePaths: (c) => c,
    detectComfyPaths: () => null,
};
const registry = { get: () => null, list: () => [], summaries: () => [], discover() {} };

const pipCalls = [];
const runtime = {
    packs: {
        pipInstall: async (folder) => { pipCalls.push(folder); throw new Error('pip blew up'); },
    },
    sweep: { start: async () => ({ ok: true }), status: () => null, lastReport: () => null },
};
const restarts = [];

const router = admin.makeRouter({
    configManager, registry, adminGate: adminGate(configManager),
    exitForRestart: (to) => restarts.push(to), runtime,
});
const app = express();
app.use('/admin', router);

// Routes that are meant to answer without the password, and why.
const OPEN = new Set([
    'POST /verify-password',   // says whether a password is right; changes nothing
    'POST /autodetect-paths',  // read-only: returns what it found, saves nothing
]);

const srv = app.listen(0, async () => {
    const base = `http://127.0.0.1:${srv.address().port}/admin`;
    const call = (method, p, { body, pw } = {}) => fetch(base + p, {
        method,
        headers: { 'Content-Type': 'application/json', ...(pw ? { 'X-Admin-Password': pw } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
    });

    try {
        // ------------------------------------------------ the gate walk ----
        console.log('\nevery route that changes something asks for the admin password');
        const writes = [];
        for (const layer of router.stack) {
            if (!layer.route) continue;
            for (const m of Object.keys(layer.route.methods)) {
                if (m === 'get' || m === '_all') continue;
                writes.push(`${m.toUpperCase()} ${layer.route.path}`);
            }
        }
        check('the router has write routes to walk', writes.length > 40, String(writes.length));
        const open = [];
        for (const w of writes) {
            if (OPEN.has(w)) continue;
            const [method, p] = w.split(' ');
            const r = await call(method, p.replace(/:[A-Za-z]+/g, 'x'), { body: {} });
            if (r.status !== 401) open.push(`${w} -> ${r.status}`);
        }
        check('no write route answers without the password', open.length === 0, open.join(', '));
        for (const w of OPEN) check(`${w} is still a route (the allow-list is not stale)`, writes.includes(w));
        check('nothing was restarted by the walk', restarts.length === 0, JSON.stringify(restarts));

        for (const [m, p] of [['PUT', '/comfy'], ['POST', '/check-paths'], ['POST', '/activate-workflow'],
            ['PUT', '/federation'], ['PUT', '/instance']]) {
            const r = await call(m, p, { body: {} });
            check(`${m} ${p} without the password is refused`, r.status === 401, String(r.status));
        }
        const r1 = await call('PUT', '/comfy', { body: { python_executable: '\\\\host\\share\\x.exe' } });
        check('a refused PUT /comfy saved nothing',
            r1.status === 401 && stored.comfy_ui.python_executable === undefined, String(stored.comfy_ui.python_executable));

        // --------------------------------------- with the right password ----
        console.log('\nthe admin panel, which sends the password, still works');
        let r = await call('PUT', '/federation', { body: { enabled: false }, pw: PW });
        check('PUT /federation with the password is applied', r.status === 200 && stored.federation.enabled === false, String(r.status));
        r = await call('PUT', '/federation', { body: { enabled: true }, pw: 'wrong' });
        check('a wrong password is refused', r.status === 401 && stored.federation.enabled === false, String(r.status));

        // --------------------------------------------- first-run setup ----
        console.log('\nwith no admin password set, setup is open as before');
        hash = '';
        r = await call('PUT', '/comfy', { body: { api_port: 8190 } });
        check('PUT /comfy without a password configured goes through', r.status === 200 && stored.comfy_ui.api_port === 8190, String(r.status));
        r = await call('PUT', '/federation', { body: { enabled: true } });
        check('PUT /federation without a password configured goes through', r.status === 200 && stored.federation.enabled === true);

        // ------------------------------------------------- node pack pip ----
        console.log('\npip is given a pack NAME, and a throw cannot take the server down');
        r = await call('POST', '/nodepacks/pip', { body: {} });
        check('no folder at all is a 400, not a crash', r.status === 400, String(r.status));
        r = await call('POST', '/nodepacks/pip', { body: { folder: '..\\..\\elsewhere' } });
        check('a path is refused', r.status === 400, String(r.status));
        r = await call('POST', '/nodepacks/pip', { body: { folder: 'NotInstalled' } });
        check('a pack that is not in custom_nodes is refused', r.status === 400, String(r.status));
        check('none of those reached pip', pipCalls.length === 0, JSON.stringify(pipCalls));
        const logged = [], logErr = console.error;
        console.error = (...x) => logged.push(x.join(' '));   // the route logs the failure; keep the output readable
        r = await call('POST', '/nodepacks/pip', { body: { folder: 'PackA' } });
        const d = await r.json().catch(() => ({}));
        console.error = logErr;
        check('the failure is logged on the server', logged.some(l => /pip blew up/.test(l)), JSON.stringify(logged).slice(0, 120));
        check('an installed pack reaches pip', pipCalls.length === 1 && pipCalls[0] === 'PackA', JSON.stringify(pipCalls));
        check('pip throwing answers 500 with its message', r.status === 500 && /pip blew up/.test(d.error || ''), `${r.status} ${JSON.stringify(d)}`);
        r = await call('GET', '/mode');
        check('and the server is still answering afterwards', r.status === 200);

        // ------------------------------------------ quarantine restore ----
        console.log('\na restore names a file IN the quarantine');
        for (const body of [{ batch: '..', rel: 'models/x.safetensors' }, { batch: 'a/b', rel: 'models/x' },
            { batch: '2026-01-01T00-00-00Z', rel: 'models/../../x' }, { batch: '2026-01-01T00-00-00Z' }, {}]) {
            r = await call('POST', '/models/quarantine/restore', { body });
            // The route's own message: restoreFile refuses most of these too,
            // so a bare 400 would pass with the route's check removed.
            const e = (await r.json().catch(() => ({}))).error || '';
            check(`${JSON.stringify(body)} is refused by the route`, r.status === 400 && /not a file in the quarantine/.test(e), `${r.status} ${e}`);
        }

        // ---------------------------------------------- the sweep suite ----
        console.log('\nthe library sweep takes a suite NAME, never a path');
        for (const s of ['C:/Windows/win.ini', '../../config.json', 'x.json', 'a/b']) {
            r = await call('POST', '/library-sweep/run', { body: { suite: s } });
            const e = (await r.json()).error || '';
            check(`"${s}" is refused before anything is read`, r.status === 400 && /letters, digits/.test(e), `${r.status} ${e}`);
        }

        // ------------------------------- a sweep must not be restarted ----
        console.log('\nActivate & serve from admin mode does not restart over a running sweep');
        registry.get = (id) => (id === 'wf_b' ? { summary: { name: 'B' }, effective: { exposedParameters: [] } } : null);
        const realStatus = runtime.sweep.status;
        stored.mode = 'admin';
        stored.workflows.activeWorkflowId = 'wf_a';
        stored.workflows.extraLaneWorkflowIds = ['old_lane'];
        const restartsBefore = restarts.length;
        for (const state of ['running', 'stopping']) {
            runtime.sweep.status = () => ({ state });
            r = await call('POST', '/activate-workflow', { body: { workflowId: 'wf_b' } });
            const e = (await r.json().catch(() => ({}))).error || '';
            check(`a sweep that is ${state} refuses it`, r.status === 409 && /library sweep is running/.test(e), `${r.status} ${e}`);
        }
        await new Promise(ok => setTimeout(ok, 350));
        check('… and nothing was switched or restarted',
            stored.mode === 'admin' && stored.workflows.activeWorkflowId === 'wf_a' && restarts.length === restartsBefore,
            `${stored.mode} ${stored.workflows.activeWorkflowId} ${JSON.stringify(restarts)}`);
        runtime.sweep.status = () => ({ state: 'done' });
        r = await call('POST', '/activate-workflow', { body: { workflowId: 'wf_b' } });
        check('a finished sweep does not', r.status === 200 && stored.mode === 'student' && stored.workflows.activeWorkflowId === 'wf_b', String(r.status));
        check('… and no extra lane from before comes back beside it', stored.workflows.extraLaneWorkflowIds.length === 0,
            JSON.stringify(stored.workflows.extraLaneWorkflowIds));
        runtime.sweep.status = realStatus;
        await new Promise(ok => setTimeout(ok, 350));   // let the stubbed restart land

        // -------------------------------------- Stop & kill all ----
        console.log('\nStop & kill all forgets the extra lanes, as Reset to admin does');
        runtime.queue = { list: () => [], transitionStatus() {}, delete() {} };
        runtime.worker = { rest: { interrupt: async () => {} }, process: { owned: false, stop: async () => {} } };
        stored.mode = 'student';
        stored.workflows.extraLaneWorkflowIds = ['old_lane'];
        r = await call('POST', '/emergency-stop', { body: {} });
        check('the emergency stop answers', r.status === 200, String(r.status));
        check('… back in admin mode with no extra lane remembered',
            stored.mode === 'admin' && stored.workflows.extraLaneWorkflowIds.length === 0,
            `${stored.mode} ${JSON.stringify(stored.workflows.extraLaneWorkflowIds)}`);
        await new Promise(ok => setTimeout(ok, 350));

        // --------------------------------------------- deleting a workflow ----
        console.log('\ndeleting a workflow');
        const wfDir = path.join(tmp, 'workflows');
        const realDir = stored.workflows.dir;
        stored.workflows.dir = wfDir;   // never the repo's own workflows
        stored.workflows.activeWorkflowId = 'wf_b';
        r = await call('DELETE', '/workflows/wf_b');
        let e = (await r.json().catch(() => ({}))).error || '';
        check('the active workflow is refused, without suggesting admin mode (it is still active there)',
            r.status === 409 && /activate another workflow first/.test(e) && !/admin mode/.test(e), `${r.status} ${e}`);
        fs.mkdirSync(path.join(wfDir, 'zz_stale'), { recursive: true });
        fs.writeFileSync(path.join(wfDir, 'zz_stale', 'zz_stale.api.json'), '{}');
        stored.workflows.extraLaneWorkflowIds = ['zz_stale'];
        stored.mode = 'student';
        r = await call('DELETE', '/workflows/zz_stale');
        e = (await r.json().catch(() => ({}))).error || '';
        check('while serving, a workflow on its way back into a lane is refused', r.status === 409 && /close the lane/.test(e), `${r.status} ${e}`);
        stored.mode = 'admin';
        r = await call('DELETE', '/workflows/zz_stale');
        e = (await r.json().catch(() => ({}))).error || '';
        check('in admin mode a left-over lane list does not block the delete',
            r.status === 200 && !fs.existsSync(path.join(wfDir, 'zz_stale')), `${r.status} ${e}`);
        stored.workflows.dir = realDir;
        delete runtime.queue;
        delete runtime.worker;
    } catch (e) {
        fails++;
        console.error('  FAIL the route checks threw:', e);
    }

    // ------------------------------------------- the editor's merge ----
    console.log('\nthe workflow editor keeps every stored parameter key');
    const { mergeEditData } = admin;
    const syn = mergeEditData(
        [
            { key: 'cliptextencode_text_6', nodeId: '6', field: 'text', order: 0 },
            { key: 'prompt', nodeId: '9', field: 'seed', order: 1 },   // an auto key equal to a stored one
        ],
        [{ key: 'prompt', nodeId: '6', field: 'text', type: 'textarea', label: 'Prompt', order: 0 }],
    );
    check('an exposed param keeps its hand-written key', syn[0].key === 'prompt' && syn[0].enabled === true, JSON.stringify(syn[0]));
    check('a hidden param whose automatic key collides gets another one',
        syn[1].key !== 'prompt' && syn[1].enabled === false, syn[1].key);

    let bundles = 0, renamedBefore = 0;
    const lost = [], dupes = [];
    for (const id of fs.readdirSync(path.join(REPO, 'workflows'))) {
        if (id.startsWith('_') || id.startsWith('.')) continue;
        const metaPath = path.join(REPO, 'workflows', id, `${id}.meta.json`);
        const apiPath = path.join(REPO, 'workflows', id, `${id}.api.json`);
        if (!fs.existsSync(metaPath) || !fs.existsSync(apiPath)) continue;
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        const detected = parseWorkflow(JSON.parse(fs.readFileSync(apiPath, 'utf8'))).parameters;
        const merged = mergeEditData(detected, meta.exposedParameters || []);
        bundles++;
        const byField = new Map(merged.map(m => [`${m.nodeId}:${m.field}`, m]));
        for (const p of meta.exposedParameters || []) {
            const m = byField.get(`${p.nodeId}:${p.field}`);
            if (!m) continue;
            const auto = detected.find(d => d.nodeId === p.nodeId && d.field === p.field)?.key;
            if (auto !== p.key) renamedBefore++;
            if (m.key !== p.key) lost.push(`${id}: ${p.key} -> ${m.key}`);
        }
        const keys = merged.map(m => m.key);
        if (new Set(keys).size !== keys.length) dupes.push(id);
    }
    check('the library was read', bundles > 50, String(bundles));
    check('it holds hand-written keys the old merge would have renamed', renamedBefore > 0, String(renamedBefore));
    check('no stored key changes through the editor', lost.length === 0, lost.slice(0, 5).join('; '));
    check('no bundle ends up with two rows sharing a key', dupes.length === 0, dupes.join(', '));

    srv.closeAllConnections();
    srv.close();
    fs.rmSync(tmp, { recursive: true, force: true });
    if (fails) { console.error(`\nadmin routes: ${fails} FAILED, ${passes} passed`); process.exitCode = 1; return; }
    console.log(`\nadmin routes: all ${passes} checks passed`);
});
