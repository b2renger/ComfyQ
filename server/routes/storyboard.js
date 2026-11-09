// Storyboard batch queueing.
//
//   POST   /storyboard/preview            parse + plan, create nothing
//   POST   /storyboard/queue              parse + plan + create every job
//   GET    /storyboard/batches            batches in the queue, newest first
//   GET    /storyboard/batches/:id        one batch's jobs
//   POST   /storyboard/batches/:id/retry  re-run the shots that failed
//   DELETE /storyboard/batches/:id        cancel + remove a batch
//
// Both write paths accept either a multipart upload (field `file`) or a JSON
// body `{ markdown }`, so it works from a browser file picker and from curl.
//
// A .csv or .tsv upload, or a JSON body `{ table }`, is a batch table instead
// (docs/batch-format.md, server/batch/). It answers in the same shape and is
// queued the same way, so the one card takes either; the batches it makes are
// listed, retried and removed by the routes below like any other.
//
// Preview and queue run the SAME parse + plan, so what an admin approves is
// exactly what gets created; queueing is a separate call purely so a 40-job,
// hour-long batch is never one accidental click away.
//
// Available in BOTH modes. The document itself names every workflow it needs,
// so requiring an admin to first pick and serve an unrelated one would be
// backwards. In admin mode the queue's sqlite file is opened directly (the
// same trick /admin/clear-history uses), the jobs are written, and the machine
// is then switched to student mode serving the batch's own first workflow —
// which is what brings the executor up to drain it.

const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const { JobQueue } = require('../queue/jobQueue');
const sm = require('../queue/jobStateMachine');
const { parseStoryboard } = require('../storyboard/storyboardParser');
const { planStoryboard } = require('../storyboard/storyboardPlanner');
const { planBatch, describeCards } = require('../batch/batchPlan');
const { assetEnv } = require('../batch/assetEnv');
const batchQueue = require('../batch/batchQueue');
const { listModelFiles, withoutExcluded } = require('../workflows/modelOptions');
const { classify } = require('../media/mediaTypes');
const { deriveInput, comfyPython } = require('../benchmark/deriveInput');
const { suitePath, suiteFromTable, validateSuite } = require('../benchmark/suitePlan');
const cleanup = require('../storage/jobCleanup');
const { sweepBlocksRestart, SWEEP_RUNNING_MESSAGE } = require('./sweepGuard');

// Storyboards are prose; a megabyte is already an enormous one.
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_JOBS = 500;
// Nominal runtime allowed for the last job already on the timeline, so a new
// batch starts after it rather than on top of it.
const TAIL_PAD_MS = 60 * 1000;

// Open the configured queue file directly. Used only in admin mode, where no
// JobQueue instance exists yet; the caller must release it.
function openQueueAdHoc(resolvedConfig) {
    const q = new JobQueue(resolvedConfig.queue.dbPath);
    q._adHoc = true;
    return q;
}

// "003_S0__Reference-image-1__flux2_klein..." -> "S0 · Reference image 1".
// Falls back to the prompt so a job queued before output prefixes existed still
// reads as something.
function labelOf(job) {
    const parts = String(job.outputPrefix || '').split('/').pop().split('__');
    if (parts.length >= 2) {
        const section = parts[0].replace(/^\d+_/, '').replace(/-/g, ' ');
        const title = parts[1].replace(/-/g, ' ');
        return `${section} · ${title}`;
    }
    return String(job.prompt || '').slice(0, 60) || job.workflowId;
}

function makeRouter({ configManager, registry, runtime, adminGate, exitForRestart }) {
    const router = express.Router();
    const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_BYTES } });

    // Everything the routes need, resolved fresh per request so a mode switch
    // (or an edited ComfyUI path) is picked up without a router rebuild.
    // `serving` means the executor is live and will drain the queue on its own.
    function ctx() {
        const config = configManager.resolvePaths(configManager.load().config);
        const queue = runtime?.queue || openQueueAdHoc(config);
        return {
            config,
            queue,
            executor: runtime?.executor || null,
            comfyConfig: config.comfy_ui,
            serving: !!runtime?.executor,
            release: () => { if (queue._adHoc) { try { queue.close(); } catch { /* already closed */ } } }
        };
    }

    // Accept the document from a file field or a JSON body, whichever came.
    // A table carries `table` instead of `markdown`.
    function readMarkdown(req) {
        if (req.file && batchQueue.isTableName(req.file.originalname)) {
            return { table: req.file.buffer.toString('utf8'), name: req.file.originalname };
        }
        if (req.file) return { markdown: req.file.buffer.toString('utf8'), name: req.file.originalname };
        const table = req.body?.table;
        if (typeof table === 'string' && table.trim()) return { table, name: req.body?.name || 'batch.csv' };
        const md = req.body?.markdown;
        if (typeof md === 'string' && md.trim()) return { markdown: md, name: req.body?.name || 'storyboard.md' };
        return null;
    }

    function uploadOrJson(req, res, next) {
        upload.single('file')(req, res, (err) => {
            if (err) {
                if (err.code === 'LIMIT_FILE_SIZE') {
                    return res.status(413).json({ error: `Storyboard too large (max ${MAX_BYTES / 1024 / 1024} MB).` });
                }
                return res.status(400).json({ error: err.message || 'Upload failed.' });
            }
            next();
        });
    }

    // Parse + plan. Throws a { status, error } shaped object on bad input.
    function buildPlan(req, queue) {
        const doc = readMarkdown(req);
        if (!doc) throw { status: 400, error: 'No storyboard supplied — send a `file` upload or a JSON body { markdown }.' };

        // The multipart path is capped by multer; a JSON body is only bounded
        // by express.json's much larger limit, so cap it here too.
        if (Buffer.byteLength(doc.markdown ?? doc.table, 'utf8') > MAX_BYTES) {
            throw { status: 413, error: `Storyboard too large (max ${MAX_BYTES / 1024 / 1024} MB).` };
        }
        if (doc.table != null) return buildTablePlan(req, queue, doc);

        let parsed;
        try { parsed = parseStoryboard(doc.markdown); }
        catch (e) { throw { status: 400, error: e.message }; }

        const spacing = req.body?.spacing === 'asap' ? 'asap' : 'estimated';
        // Where the results land, as a folder under ComfyUI's output dir.
        // Defaults to the document's own name so two storyboards never mix.
        const outputFolder = String(req.body?.folder ?? doc.name.replace(/\.[^.]+$/, '')).slice(0, 80);
        const userId = String(req.body?.user_id || req.body?.userId || 'storyboard').slice(0, 64);
        // Start the batch AFTER everything already on the timeline. nextFreeSlot
        // only steps over jobs its duration window overlaps, so asking it for a
        // 1s slot would drop the batch at "now", interleaved with (and ahead of)
        // bookings students already made. The pad stands in for the last pending
        // job's own runtime, which the queue does not record.
        const busyUntil = queue.latestActiveStart();
        const startAt = Math.max(Date.now(), busyUntil ? busyUntil + TAIL_PAD_MS : 0);
        const plan = planStoryboard(parsed, registry, { userId, startAt, spacing, outputFolder });

        return { doc, parsed, plan, spacing, userId, outputFolder };
    }

    // A batch table: plan it against this machine's cards, assets folder and
    // queue. Pictures from the assets folder go through the upload guard here,
    // so the preview already says which are too large.
    function buildTablePlan(req, queue, doc) {
        const config = configManager.resolvePaths(configManager.load().config);
        const assetsDir = config.assets?.dir || null;
        const comfyRoot = config.comfy_ui?.root_path;
        const plan = planBatch(doc.table, registry, {
            ...assetEnv(assetsDir),
            getJob: batchQueue.jobLookup(queue),
            optionsFor: (p) => comfyRoot
                ? withoutExcluded(listModelFiles(comfyRoot, p.optionsDir || 'loras', p.optionsFilter || ''), p.optionsExclude)
                : null,
        });
        if (assetsDir && plan.jobs.length) {
            plan.errors.push(...batchQueue.checkAssetImages(plan, assetsDir));
            plan.errors.sort((a, b) => (a.row ?? 0) - (b.row ?? 0));
        }
        const spacing = req.body?.spacing === 'asap' ? 'asap' : 'estimated';
        const outputFolder = String(req.body?.folder ?? doc.name.replace(/\.[^.]+$/, '')).slice(0, 80);
        const userId = String(req.body?.user_id || req.body?.userId || 'storyboard').slice(0, 64);
        const busyUntil = queue.latestActiveStart();
        const startAt = Math.max(Date.now(), busyUntil ? busyUntil + TAIL_PAD_MS : 0);
        return { doc, table: true, plan, preview: batchQueue.toPreview(plan, registry), assetsDir, config, spacing, userId, outputFolder, startAt };
    }

    // A batch runs one job at a time on one ComfyUI, because later jobs consume
    // what earlier ones made. Extra lanes would compete with it for the card.
    function extraLanesMessage() {
        const open = runtime?.lanes?.list?.() || [];
        if (open.length < 2) return null;
        return `A batch needs the whole machine: close the extra lanes first (${open.filter(l => !l.primary).map(l => l.name).join(', ')}).`;
    }

    router.post('/preview', adminGate, uploadOrJson, (req, res) => {
        const c = ctx();
        try {
            const built = buildPlan(req, c.queue);
            const lanesWarning = extraLanesMessage();
            if (built.table) {
                const p = built.preview;
                return res.json({
                    name: built.doc.name,
                    format: 'table',
                    serving: c.serving,
                    outputFolder: built.outputFolder,
                    outputDir: c.comfyConfig?.output_dir || null,
                    states: [],
                    ...p,
                    warnings: [...(lanesWarning ? [lanesWarning] : []), ...p.warnings],
                });
            }
            const { doc, parsed, plan, outputFolder } = built;
            res.json({
                name: doc.name,
                serving: c.serving,
                outputFolder,
                outputDir: c.comfyConfig?.output_dir || null,
                states: plan.states.map(s => ({ id: s.id, kind: s.kind, transitions: s.transitions })),
                phases: plan.phases,
                workflowRuns: plan.workflowRuns,
                modelLoads: plan.modelLoads,
                totalJobs: plan.jobs.length,
                totalShots: plan.totalShots,
                totalEstimatedSec: plan.totalEstimatedSec,
                warnings: [...(lanesWarning ? [lanesWarning] : []), ...parsed.warnings, ...plan.warnings],
                errors: [...(parsed.errors || []), ...plan.errors],
                blockedReasons: plan.blockedReasons,
                summary: plan.summary,
                jobs: plan.jobs
            });
        } catch (e) {
            if (e && e.status) return res.status(e.status).json({ error: e.error });
            res.status(500).json({ error: e.message });
        } finally { c.release(); }
    });

    // Admin mode drains nothing: serve the batch's first workflow, so the
    // restart that follows brings the executor up. → the workflow id.
    function startServing(workflowId) {
        configManager.update(cfg => {
            cfg.workflows.activeWorkflowId = workflowId;
            cfg.mode = 'student';
            // Nothing is served in admin mode: no extra lane to bring back.
            cfg.workflows.extraLaneWorkflowIds = [];
            return cfg;
        });
        console.log(`[Storyboard] starting the queue — serving "${workflowId}" (first workflow in the batch)`);
        return workflowId;
    }

    // Queue a planned table. → { status, body } for a refusal, else { body, restartTo }.
    // There is no force for a table: a row is fixed in the spreadsheet, and a
    // batch with a hole in it is found an hour later.
    async function queueTable(built, c) {
        const { plan, preview } = built;
        if (plan.errors.length || plan.blocked.length) {
            return { status: 422, body: {
                error: plan.summary,
                errors: preview.errors,
                blockedReasons: preview.blockedReasons,
                warnings: preview.warnings,
                hint: 'Fix the table and upload it again.'
            } };
        }
        if (plan.jobs.length === 0) return { status: 422, body: { error: 'Nothing to queue.', errors: [] } };
        if (plan.jobs.length > MAX_JOBS) {
            return { status: 413, body: { error: `That table makes ${plan.jobs.length} jobs; the limit is ${MAX_JOBS}.` } };
        }
        // Files first, prepared where the table gives steps. A file that cannot be
        // prepared, or comes out too large, stops the batch before any row is written.
        let staged;
        try {
            const python = comfyPython(built.config);
            staged = plan.jobs.some(j => j.assets.length)
                ? await batchQueue.stageAssets(plan, built.assetsDir, path.resolve(built.config.comfy_ui.root_path, 'input'), {
                    derive: ({ src, ops, dest }) => deriveInput({ python, src, ops, dest, assetsDir: built.assetsDir }),
                })
                : new Map();
        } catch (e) {
            return { status: 422, body: { error: e.message, errors: [e.message] } };
        }
        const batchId = uuidv4();
        const batchLabel = String(built.doc.name || 'batch.csv').slice(0, 120);
        const rows = batchQueue.buildInserts(plan, {
            batchId, batchLabel, folder: built.outputFolder, userId: built.userId,
            startAt: built.startAt, spacing: built.spacing, staged,
        });
        // One transaction: a half-written batch would leave dependants
        // pointing at jobs that do not exist.
        c.queue.db.transaction(() => { for (const r of rows) c.queue.insert(r); })();
        console.log(`[Storyboard] queued ${rows.length} job(s) from the table "${batchLabel}" — batch ${batchId.slice(0, 8)}, `
            + `${plan.modelLoads} model load(s)${staged.size ? `, ${staged.size} file(s) from the assets folder` : ''}`);
        const restartTo = c.serving ? null : startServing(plan.jobs[0].workflowId);
        return { restartTo, body: {
            ok: true,
            format: 'table',
            batchId,
            batchLabel,
            outputFolder: rows[0].outputPrefix.split('/')[0],
            totalJobs: rows.length,
            phases: preview.phases,
            workflowRuns: preview.workflowRuns,
            modelLoads: preview.modelLoads,
            totalEstimatedSec: preview.totalEstimatedSec,
            startingWorkflowId: restartTo,
            restarting: !!restartTo,
            warnings: preview.warnings,
            errors: [],
            jobs: rows.map((r, i) => ({ id: r.id, order: i, title: plan.jobs[i].key, workflowId: r.workflowId,
                scheduledAt: r.scheduledAt, dependsOn: r.deps.map(d => d.sourceJobId) })),
        } };
    }

    router.post('/queue', adminGate, uploadOrJson, async (req, res) => {
        const c = ctx();
        let restartTo = null;
        try {
            // From admin mode the batch starts by restarting the server, which
            // would kill a library sweep mid-bundle. Refused before anything
            // is queued, so the batch is not left half-started.
            if (!c.serving && sweepBlocksRestart(runtime)) {
                return res.status(409).json({ error: SWEEP_RUNNING_MESSAGE });
            }
            const lanesRefusal = extraLanesMessage();
            if (lanesRefusal) return res.status(409).json({ error: lanesRefusal, code: 'lanes-open' });
            const built = buildPlan(req, c.queue);
            if (built.table) {
                const answer = await queueTable(built, c);
                if (answer.status) return res.status(answer.status).json(answer.body);
                restartTo = answer.restartTo;
                return res.json(answer.body);
            }
            const { doc, parsed, plan } = built;

            // Refuse the batch outright when any item could not be planned. A
            // storyboard is one piece of work: queueing 38 of 42 generations
            // and reporting the rest as a warning leaves an admin to discover
            // the holes an hour later. `force: true` opts into the partial run.
            //
            // ★ The PARSER's errors count too. A `##` with no `###` line is
            // dropped from the items before the planner sees it, so checking
            // only the plan queued 41 of 42 shots and said nothing -- the
            // exact outcome the parser files those as errors to prevent.
            // /preview always merged the two; this route now does as well.
            const force = req.body?.force === true || req.body?.force === 'true';
            const allErrors = [...(parsed.errors || []), ...plan.errors];
            if (allErrors.length > 0 && !force) {
                return res.status(422).json({
                    error: plan.summary || `${allErrors.length} problem(s) in the storyboard — nothing was queued.`,
                    errors: allErrors,
                    blockedReasons: plan.blockedReasons,
                    warnings: [...parsed.warnings, ...plan.warnings],
                    hint: 'Fix the storyboard and upload it again, or resend with force=true to queue the rest.'
                });
            }
            if (plan.jobs.length === 0) {
                return res.status(422).json({ error: 'Nothing to queue.', errors: allErrors });
            }
            if (plan.jobs.length > MAX_JOBS) {
                return res.status(413).json({ error: `That storyboard is ${plan.jobs.length} generations; the limit is ${MAX_JOBS}.` });
            }

            const batchId = uuidv4();
            const batchLabel = String(req.body?.label || doc.name || 'storyboard').slice(0, 120);

            // Ids are allocated up front and keyed by the storyboard item they
            // came from, so a dependency can name its source regardless of the
            // order rows are inserted in.
            const idByItem = new Map(plan.jobs.map(j => [j.itemIndex, uuidv4()]));

            const created = [];
            const insert = () => {
            for (const j of plan.jobs) {
                const deps = j.deps.map(d => {
                    const sourceJobId = idByItem.get(d.sourceItemIndex);
                    // The planner drops any job whose source it could not plan,
                    // so this cannot happen. Refuse rather than queue a job with
                    // its media parameter silently unbound — ComfyUI would fall
                    // back to whatever filename the api.json shipped with.
                    if (!sourceJobId) {
                        throw new Error(`internal: "${j.title}" has no source for "${d.paramKey}"`);
                    }
                    return { paramKey: d.paramKey, sourceJobId, outputIndex: d.outputIndex, kind: d.kind };
                });
                const job = c.queue.insert({
                    id: idByItem.get(j.itemIndex),
                    userId: j.userId,
                    workflowId: j.workflowId,
                    workflowVersion: j.workflowVersion,
                    scheduledAt: j.scheduledAt,
                    prompt: j.prompt,
                    paramValues: j.paramValues,
                    createdBy: 'storyboard',
                    batchId,
                    batchLabel,
                    outputPrefix: j.outputPrefix,
                    deps
                });
                created.push({
                    id: job.id, order: j.order, phase: j.phaseLabel,
                    stateId: j.stateId, title: j.title,
                    workflowId: j.workflowId, scheduledAt: j.scheduledAt,
                    dependsOn: deps.map(d => d.sourceJobId)
                });
            }
            };
            // One transaction: a half-written batch would leave dependants
            // pointing at jobs that do not exist.
            c.queue.db.transaction(insert)();

            console.log(`[Storyboard] queued ${created.length} job(s) from "${batchLabel}" — batch ${batchId.slice(0, 8)} ` +
                `(${plan.phases.map(p => `${p.count} ${p.label}`).join(', ')}; ` +
                `${plan.modelLoads} model load(s): ${plan.workflowRuns.map(r => `${r.count}x ${r.workflowId}`).join(', ')})`);

            // Nothing is draining the queue in admin mode. The storyboard names
            // its own workflows, so serve the one it starts with and restart —
            // that is what brings the executor up. Already serving: the running
            // executor picks the batch up on its next tick, no restart.
            if (!c.serving) restartTo = startServing(plan.jobs[0].workflowId);

            res.json({
                ok: true,
                batchId,
                batchLabel,
                outputFolder: plan.jobs[0].outputPrefix.split('/')[0],
                totalJobs: created.length,
                phases: plan.phases,
                workflowRuns: plan.workflowRuns,
                modelLoads: plan.modelLoads,
                totalEstimatedSec: plan.totalEstimatedSec,
                startingWorkflowId: restartTo,
                restarting: !!restartTo,
                warnings: [...parsed.warnings, ...plan.warnings],
                errors: allErrors,
                jobs: created
            });
        } catch (e) {
            if (e && e.status) return res.status(e.status).json({ error: e.error });
            console.error('[Storyboard] queue failed:', e);
            res.status(500).json({ error: e.message });
        } finally {
            c.release();
            // After the response is on the wire, not before.
            if (restartTo && exitForRestart) setTimeout(() => exitForRestart('student'), 250);
        }
    });

    // The batch editor's two lists: the cards a row can name, in the table's
    // terms, and what the assets folder holds for its input picker. Read-only.
    router.get('/cards', adminGate, (req, res) => {
        try {
            const config = configManager.resolvePaths(configManager.load().config);
            const comfyRoot = config.comfy_ui?.root_path;
            res.json({ cards: describeCards(registry, {
                optionsFor: (p) => comfyRoot
                    ? withoutExcluded(listModelFiles(comfyRoot, p.optionsDir || 'loras', p.optionsFilter || ''), p.optionsExclude)
                    : null,
            }) });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    router.get('/assets', adminGate, (req, res) => {
        try {
            const config = configManager.resolvePaths(configManager.load().config);
            const env = assetEnv(config.assets?.dir || null);
            const kindOf = (name) => {
                const k = classify(name).kind;
                return ['image', 'video', 'audio', 'model3d'].includes(k) ? k : (/\.txt$/i.test(name) ? 'text' : null);
            };
            res.json({ dir: env.dir, ...env.catalog({ classify: kindOf }) });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // The test suite, as the table it is (tools/test-suite/<name>.suite.csv), for
    // the batch editor to open and save without a file. By NAME only: a path
    // from a browser must never choose which file is read or written.
    router.get('/suite/:name', adminGate, (req, res) => {
        let file;
        try { file = suitePath(req.params.name); } catch (e) { return res.status(400).json({ error: e.message }); }
        if (!/\.csv$/.test(file) || !fs.existsSync(file)) return res.status(404).json({ error: `there is no table for the suite "${req.params.name}"` });
        res.json({ name: req.params.name, file: path.relative(path.resolve(__dirname, '..', '..'), file), table: fs.readFileSync(file, 'utf8') });
    });

    // Save an edited suite. It is checked as a batch table AND as a suite (one
    // run per row, ids that are cards or card@variant, every card known) before
    // the file is replaced, so a save can never leave a suite that will not run.
    router.put('/suite/:name', adminGate, express.json({ limit: '4mb' }), (req, res) => {
        let file;
        try { file = suitePath(req.params.name); } catch (e) { return res.status(400).json({ error: e.message }); }
        if (!/\.csv$/.test(file)) return res.status(409).json({ error: `the suite "${req.params.name}" is not a table; convert it with tools/test-suite/to_table.cjs first` });
        const table = req.body?.table;
        if (typeof table !== 'string' || !table.trim()) return res.status(400).json({ error: 'No table was sent.' });
        if (Buffer.byteLength(table, 'utf8') > MAX_BYTES) return res.status(413).json({ error: `The table is too large (max ${MAX_BYTES / 1024 / 1024} MB).` });
        const suite = suiteFromTable(table, registry, { name: req.params.name, file });
        const check = validateSuite(suite, registry);
        if (check.errors.length) return res.status(422).json({ error: `${check.errors.length} problem(s): the suite was not saved.`, errors: check.errors, warnings: check.warnings });
        const tmp = `${file}.part`;
        fs.writeFileSync(tmp, table.replace(/\r?\n/g, '\r\n'));
        fs.renameSync(tmp, file);
        console.log(`[Storyboard] saved the test suite "${req.params.name}" from the batch editor: ${suite.runs.length} runs`);
        res.json({ ok: true, runs: suite.runs.length, warnings: check.warnings });
    });

    router.get('/batches', adminGate, (req, res) => {
        const c = ctx();
        try {
            // Name the shot currently in flight, so the collapsed row can say
            // what the machine is doing rather than just how many are left.
            const batches = c.queue.listBatches().map(b => {
                if (!b.running) return { ...b, current: null };
                const inFlight = c.queue.listBatch(b.batchId).find(j => sm.isInFlight(j.status));
                return {
                    ...b,
                    current: inFlight ? {
                        label: labelOf(inFlight),
                        workflowId: inFlight.workflowId,
                        progress: (inFlight.progress?.stepsDone != null && inFlight.progress?.stepsTotal)
                            ? { value: inFlight.progress.stepsDone, max: inFlight.progress.stepsTotal }
                            : null
                    } : null
                };
            });
            res.json({ batches, serving: c.serving });
        } finally { c.release(); }
    });

    router.get('/batches/:id', adminGate, (req, res) => {
        const c = ctx();
        try {
            const jobs = c.queue.listBatch(req.params.id);
            if (jobs.length === 0) return res.status(404).json({ error: 'unknown batch' });
            res.json({
                batchId: req.params.id,
                batchLabel: jobs[0].batchLabel,
                outputFolder: (jobs[0].outputPrefix || '').split('/')[0] || null,
                jobs: jobs.map(j => ({
                    id: j.id,
                    status: j.status,
                    workflow_id: j.workflowId,
                    scheduled_at: j.scheduledAt,
                    started_at: j.startedAt,
                    finished_at: j.finishedAt,
                    prompt: j.prompt,
                    // The shot's own name, so the progress list reads like the
                    // storyboard rather than like a list of uuids.
                    output_prefix: j.outputPrefix,
                    label: labelOf(j),
                    progress: (j.progress?.stepsDone != null && j.progress?.stepsTotal)
                        ? { value: j.progress.stepsDone, max: j.progress.stepsTotal }
                        : null,
                    outputs: j.outputs,
                    error_reason: j.errorReason,
                    depends_on: c.queue.depsFor(j.id)
                }))
            });
        } finally { c.release(); }
    });

    // Re-run the shots of a batch that failed, after whatever broke them has
    // been fixed on the server (a stale dropdown option, an acceleration flag,
    // a model that was missing). Requeueing beats re-uploading the document:
    // the completed shots keep their outputs, and the failed ones keep their
    // place in the run order and their job_deps wiring.
    router.post('/batches/:id/retry', adminGate, (req, res) => {
        const c = ctx();
        try {
            const jobs = c.queue.listBatch(req.params.id);
            if (jobs.length === 0) return res.status(404).json({ error: 'unknown batch' });

            const states = [sm.STATES.FAILED];
            if (req.query.includeCancelled === '1') states.push(sm.STATES.CANCELLED);
            const targets = jobs.filter(j => states.includes(j.status));
            if (targets.length === 0) return res.json({ ok: true, retried: 0, jobs: [] });

            // ONE transaction, on purpose. A batch's failed set mixes shots that
            // failed on their own with shots cascade-failed as
            // 'dependency-failed'; requeueing them together means that by the
            // executor's next tick none of them is FAILED any more, so
            // failBlockedJobs() has nothing to collapse and the order in which
            // they were requeued cannot matter.
            c.queue.db.transaction(() => {
                for (const job of targets) c.queue.requeue(job.id, 'retry');
            })();

            // A shot whose source was DELETED rather than merely failed can
            // never run; say so rather than letting it look retried.
            const stillBlocked = targets.filter(job =>
                c.queue.depsFor(job.id).some(d => !c.queue.get(d.sourceJobId))
            ).map(job => job.id);

            console.log(`[Storyboard] retrying ${targets.length} shot(s) of batch ${req.params.id.slice(0, 8)}` +
                (stillBlocked.length ? ` (${stillBlocked.length} still missing their input)` : ''));
            res.json({
                ok: true,
                retried: targets.length,
                stillBlocked,
                jobs: targets.map(j => ({ id: j.id, label: labelOf(j), workflowId: j.workflowId }))
            });
        } catch (e) {
            console.error('[Storyboard] retry failed:', e);
            res.status(500).json({ error: e.message });
        } finally { c.release(); }
    });

    // Stop a batch: cancel whatever is running or waiting, then remove the
    // records. Completed jobs are left alone — their outputs are the point.
    router.delete('/batches/:id', adminGate, async (req, res) => {
        const c = ctx();
        try {
            const jobs = c.queue.listBatch(req.params.id);
            if (jobs.length === 0) return res.status(404).json({ error: 'unknown batch' });
            const keepCompleted = req.query.keepCompleted !== '0';
            let cancelled = 0, removed = 0;
            for (const job of jobs) {
                if (sm.isInFlight(job.status)) {
                    // Only a live executor can interrupt ComfyUI. In admin mode
                    // there is nothing running, so the row is simply retired.
                    // ★ The job's OWN lane: the main executor only cancels a job
                    // it is running itself, so a shot rendering on a second lane
                    // went on to the end and wrote its files after the cleanup
                    // below. Same rule as RealtimeBus._executorFor.
                    const ex = runtime?.lanes?.get?.(job.workflowId)?.executor || c.executor;
                    if (ex) await ex.cancelJob(job.id);
                    else { try { c.queue.transitionStatus(job.id, sm.STATES.CANCELLED); } catch { /* terminal */ } }
                    cancelled++;
                } else if (job.status === sm.STATES.SCHEDULED) {
                    try { c.queue.transitionStatus(job.id, sm.STATES.CANCELLED); cancelled++; } catch { /* raced to terminal */ }
                }
                if (keepCompleted && job.status === sm.STATES.COMPLETED) continue;
                // Take the job's files with it — outputs, the durable
                // ingredients snapshot, and any frames staged as another job's
                // input. Otherwise a cancelled 500-job batch leaves gigabytes.
                cleanup.removeJobArtifacts({ job, comfyConfig: c.comfyConfig });
                c.queue.delete(job.id);
                removed++;
            }
            res.json({ ok: true, cancelled, removed });
        } catch (e) { res.status(500).json({ error: e.message }); }
        finally { c.release(); }
    });

    return router;
}

module.exports = { makeRouter, MAX_JOBS };
