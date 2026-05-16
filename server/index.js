// ComfyQ v2 — main bootstrap.
// Composition root for the v2 architecture.
//
//   Admin mode: minimal HTTP only — admin can configure ComfyUI paths,
//                upload workflows, pick one to activate.
//   Student mode: full stack — workflow registry + sqlite queue + local
//                ComfyUI worker + job executor + realtime bus + media store.

const express = require('express');
const http = require('http');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Returns every non-internal IPv4 the server is reachable on (e.g.
// ['192.168.1.10', '10.0.0.5']). Used at boot to print URLs the admin
// can hand to students on the same LAN.
function lanAddresses() {
    const out = [];
    const ifs = os.networkInterfaces();
    for (const name of Object.keys(ifs)) {
        for (const i of ifs[name] || []) {
            if (i.family === 'IPv4' && !i.internal) out.push(i.address);
        }
    }
    return out;
}

const configManager = require('./config/configManager');
const { WorkflowRegistry } = require('./workflows/workflowRegistry');
const { JobQueue } = require('./queue/jobQueue');
const { LocalComfyUIWorker } = require('./workers/localComfyUIWorker');
const { JobExecutor } = require('./executor/jobExecutor');
const { BenchmarkService } = require('./benchmark/benchmarkService');
const { RealtimeBus } = require('./realtime/realtimeBus');
const { adminGate } = require('./auth/authGate');
const adminRoutes = require('./routes/admin');
const workflowRoutes = require('./routes/workflows');
const jobRoutes = require('./routes/jobs');
const uploadRoutes = require('./routes/uploads');
const mediaStore = require('./media/mediaStore');

// Prints the URLs students should use from another machine on the LAN.
// They open Vite (5173) in their browser; Vite serves HTTPS (self-signed)
// and proxies every backend route to this Express server over plain HTTP
// on localhost. Students see a one-time "unsafe site" warning per device,
// click through, and from then on the page can use the webcam / phone
// camera (getUserMedia requires a secure context).
function logLanUrls(serverPort) {
    const ips = lanAddresses();
    if (ips.length === 0) {
        console.log('[ComfyQ] no external network interfaces detected — LAN access unavailable.');
        return;
    }
    console.log('[ComfyQ] LAN access — share one of these URLs with students:');
    for (const ip of ips) {
        console.log(`[ComfyQ]   https://${ip}:5173   (Vite HTTPS; proxies API + websocket to localhost:${serverPort})`);
    }
    console.log('[ComfyQ] First time on each device: accept the self-signed certificate warning.');
    console.log('[ComfyQ] If a student gets a connection error, allow Node.js through Windows Firewall for "Private" networks.');
}

// Wraps logLanUrls() in a visually distinct banner so reprints (after
// ComfyUI's noisy startup) stand out in the terminal. `label` says WHY
// the banner is showing — students don't see this, but the workshop
// admin uses it to confirm each boot milestone has passed.
function printConnectionBanner(label, serverPort) {
    console.log('');
    console.log('==============================================================');
    console.log(`[ComfyQ] ${label}`);
    console.log('==============================================================');
    logLanUrls(serverPort);
    console.log('==============================================================');
    console.log('');
}

function exitForRestart() {
    console.log('[ComfyQ] Exiting for restart');
    // nodemon does NOT auto-restart on a clean exit — it only restarts on a
    // watched-file change. Bumping the mtime of this file makes nodemon's
    // watcher pick up the "change" and re-spawn us. No content edit.
    try {
        const now = new Date();
        fs.utimesSync(__filename, now, now);
    } catch (e) {
        console.warn('[ComfyQ] could not touch index.js to trigger nodemon restart:', e.message);
    }
    setTimeout(() => process.exit(0), 250);
}

async function main() {
    console.log('[ComfyQ] starting…');
    const { config: rawConfig } = configManager.load();
    const config = configManager.resolvePaths(rawConfig);
    console.log(`[ComfyQ] mode=${config.mode}`);

    const registry = new WorkflowRegistry(config.workflows.dir);
    registry.discover();
    console.log(`[ComfyQ] registry: ${registry.summaries({ includeUnavailable: false }).length} usable workflow(s)`);

    const app = express();
    app.use(cors());
    app.use(express.json({ limit: '20mb' }));
    const server = http.createServer(app);

    const gate = adminGate(configManager);

    // Mutable runtime container — populated in student mode below. Lets the
    // admin router expose student-only routes (emergency-stop) without a
    // second router mount.
    const runtime = {};

    // Routes available in both modes.
    app.use('/admin', adminRoutes.makeRouter({
        configManager, registry, adminGate: gate, exitForRestart, runtime
    }));

    if (config.mode === 'admin') {
        // Workflows route still needed (for selector). Calibration is gated.
        const dummyBenchmark = { calibrate: () => Promise.reject(new Error('Calibrate from student mode')) };
        app.use('/workflows', workflowRoutes.makeRouter({
            registry, configManager, benchmarkService: dummyBenchmark, adminGate: gate
        }));
        const port = config.server.port;
        const host = config.server.host;
        server.listen(port, host, () => {
            console.log(`[ComfyQ] admin mode — API on http://${host}:${port}  •  open the UI at https://localhost:5173`);
            logLanUrls(port);
            console.log('[ComfyQ] open the admin UI to configure ComfyUI and pick a workflow.');
        });
        return;
    }

    // ---- Student mode ----
    console.log('[ComfyQ] === student-mode bootstrap ===');
    console.log(`[ComfyQ]   active workflow: ${config.workflows.activeWorkflowId || '(none)'}`);
    console.log(`[ComfyQ]   ComfyUI root:    ${config.comfy_ui.root_path}`);
    console.log(`[ComfyQ]   ComfyUI api:     http://${config.comfy_ui.api_host}:${config.comfy_ui.api_port}`);
    console.log(`[ComfyQ]   Python:          ${config.comfy_ui.python_executable}`);
    console.log(`[ComfyQ]   VRAM budget:     ${config.comfy_ui.vramBudgetGb} GB`);

    if (!config.comfy_ui.root_path || !config.comfy_ui.python_executable) {
        console.error('[ComfyQ] ComfyUI paths are not configured. Switching to admin mode.');
        configManager.update(c => { c.mode = 'admin'; return c; });
        return exitForRestart();
    }

    console.log('[ComfyQ] opening sqlite job queue…');
    const queue = new JobQueue(config.queue.dbPath);
    const reconciled = queue.reconcileOnBoot();
    if (reconciled > 0) console.log(`[ComfyQ] reconciled ${reconciled} stale job(s) → failed: server-restart`);
    else console.log('[ComfyQ] no stale jobs to reconcile');

    console.log('[ComfyQ] starting ComfyUI worker…');
    // Reprints the LAN-URL banner at key boot milestones (WS connect,
    // comfyregistry fetch complete) so the URLs aren't buried in
    // ComfyUI's startup output. Resolved with config.server.port so the
    // banner shows the same backend port the boot-time banner did.
    const onMilestone = (label) => printConnectionBanner(label, config.server.port);
    const worker = new LocalComfyUIWorker({
        comfyConfig: config.comfy_ui,
        queueConfig: config.queue,
        onMilestone
    });
    try {
        const started = await worker.start();
        console.log(`[ComfyQ] worker ready (${started?.external ? 'attached to external ComfyUI' : 'spawned ComfyUI'})`);
    } catch (e) {
        console.error('[ComfyQ] failed to start ComfyUI worker:', e.message);
        console.error('[ComfyQ] reverting to admin mode');
        configManager.update(c => { c.mode = 'admin'; return c; });
        return exitForRestart();
    }

    const executor = new JobExecutor({ queue, worker, registry, comfyConfig: config.comfy_ui });
    executor.start();
    console.log('[ComfyQ] executor loop started');

    const benchmarkService = new BenchmarkService({ worker, registry, comfyConfig: config.comfy_ui });

    const bus = new RealtimeBus({ httpServer: server, queue, executor, registry, configManager, worker, comfyConfig: config.comfy_ui });

    // Expose student-mode runtime to the admin router (emergency-stop).
    runtime.queue = queue;
    runtime.executor = executor;
    runtime.worker = worker;

    // Mount remaining routes.
    app.use('/workflows', workflowRoutes.makeRouter({
        registry, configManager, benchmarkService, adminGate: gate
    }));
    app.use('/jobs', jobRoutes.makeRouter({ queue }));
    app.use(uploadRoutes.makeRouter({ comfyConfig: config.comfy_ui }));
    app.use(mediaStore.makeRouter(config.comfy_ui));

    // Periodic input dir sweep.
    setInterval(() => worker.uploader.sweepStale(), 60_000);

    const port = config.server.port;
    const host = config.server.host;
    server.listen(port, host, () => {
        console.log(`[ComfyQ] student mode — API on http://${host}:${port}  •  open the UI at https://localhost:5173`);
        logLanUrls(port);
        const active = config.workflows.activeWorkflowId;
        if (!active) {
            console.warn('[ComfyQ] no active workflow set; clients will see an empty parameter map.');
        } else {
            const entry = registry.get(active);
            if (entry && !entry.unavailable) {
                const exposed = entry.effective?.exposedParameters?.length ?? 0;
                const dur = entry.summary?.estimatedDurationSec ?? '?';
                const cal = entry.summary?.hasCalibration ? 'calibrated' : 'uncalibrated';
                console.log(`[ComfyQ] active workflow: ${active}  "${entry.summary?.name}"  (${exposed} params, ~${dur}s ${cal})`);
            } else {
                console.warn(`[ComfyQ] active workflow "${active}" is unavailable: ${entry?.reason || 'unknown'}`);
            }
        }
        console.log('[ComfyQ] === ready ===');
    });

    // Graceful shutdown
    process.on('SIGINT', async () => {
        console.log('[ComfyQ] shutting down…');
        executor.stop();
        await worker.shutdown();
        queue.close();
        process.exit(0);
    });
}

main().catch(e => {
    console.error('[ComfyQ] fatal:', e);
    process.exit(1);
});
