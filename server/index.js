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

function exitForRestart() {
    console.log('[ComfyQ] Exiting for restart');
    setTimeout(() => process.exit(0), 100);
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

    // Routes available in both modes.
    app.use('/admin', adminRoutes.makeRouter({
        configManager, registry, adminGate: gate, exitForRestart
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
            console.log(`[ComfyQ] admin mode listening on http://${host}:${port}`);
            console.log('[ComfyQ] open the admin UI to configure ComfyUI and pick a workflow.');
        });
        return;
    }

    // ---- Student mode ----
    if (!config.comfy_ui.root_path || !config.comfy_ui.python_executable) {
        console.error('[ComfyQ] ComfyUI paths are not configured. Switching to admin mode.');
        configManager.update(c => { c.mode = 'admin'; return c; });
        return exitForRestart();
    }

    const queue = new JobQueue(config.queue.dbPath);
    const reconciled = queue.reconcileOnBoot();
    if (reconciled > 0) console.log(`[ComfyQ] reconciled ${reconciled} stale job(s)`);

    const worker = new LocalComfyUIWorker({
        comfyConfig: config.comfy_ui,
        queueConfig: config.queue
    });
    try {
        await worker.start();
    } catch (e) {
        console.error('[ComfyQ] failed to start ComfyUI worker:', e.message);
        console.error('[ComfyQ] reverting to admin mode');
        configManager.update(c => { c.mode = 'admin'; return c; });
        return exitForRestart();
    }

    const executor = new JobExecutor({ queue, worker, registry, comfyConfig: config.comfy_ui });
    executor.start();

    const benchmarkService = new BenchmarkService({ worker, registry, comfyConfig: config.comfy_ui });

    const bus = new RealtimeBus({ httpServer: server, queue, executor, registry, configManager, worker });

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
        console.log(`[ComfyQ] student mode listening on http://${host}:${port}`);
        const active = config.workflows.activeWorkflowId;
        if (!active) {
            console.warn('[ComfyQ] no active workflow set; clients will see an empty parameter map.');
        } else {
            console.log(`[ComfyQ] active workflow: ${active}`);
        }
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
