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

const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const { JobQueue } = require('../queue/jobQueue');
const sm = require('../queue/jobStateMachine');
const { parseStoryboard } = require('../storyboard/storyboardParser');
const { planStoryboard } = require('../storyboard/storyboardPlanner');
const cleanup = require('../storage/jobCleanup');

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
    function readMarkdown(req) {
        if (req.file) return { markdown: req.file.buffer.toString('utf8'), name: req.file.originalname };
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
        if (Buffer.byteLength(doc.markdown, 'utf8') > MAX_BYTES) {
            throw { status: 413, error: `Storyboard too large (max ${MAX_BYTES / 1024 / 1024} MB).` };
        }

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

    router.post('/preview', adminGate, uploadOrJson, (req, res) => {
        const c = ctx();
        try {
            const { doc, parsed, plan, outputFolder } = buildPlan(req, c.queue);
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
                totalShots: parsed.items.length,
                totalEstimatedSec: plan.totalEstimatedSec,
                warnings: [...parsed.warnings, ...plan.warnings],
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

    router.post('/queue', adminGate, uploadOrJson, (req, res) => {
        const c = ctx();
        let restartTo = null;
        try {
            const { doc, parsed, plan } = buildPlan(req, c.queue);

            // Refuse the batch outright when any item could not be planned. A
            // storyboard is one piece of work: queueing 38 of 42 generations
            // and reporting the rest as a warning leaves an admin to discover
            // the holes an hour later. `force: true` opts into the partial run.
            const force = req.body?.force === true || req.body?.force === 'true';
            if (plan.errors.length > 0 && !force) {
                return res.status(422).json({
                    error: plan.summary || `${plan.errors.length} shot(s) could not be queued.`,
                    errors: plan.errors,
                    blockedReasons: plan.blockedReasons,
                    warnings: [...parsed.warnings, ...plan.warnings],
                    hint: 'Fix the storyboard and upload it again, or resend with force=true to queue the rest.'
                });
            }
            if (plan.jobs.length === 0) {
                return res.status(422).json({ error: 'Nothing to queue.', errors: plan.errors });
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
            if (!c.serving) {
                restartTo = plan.jobs[0].workflowId;
                configManager.update(cfg => {
                    cfg.workflows.activeWorkflowId = restartTo;
                    cfg.mode = 'student';
                    return cfg;
                });
                console.log(`[Storyboard] starting the queue — serving "${restartTo}" (first workflow in the batch)`);
            }

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
                errors: plan.errors,
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
                    if (c.executor) await c.executor.cancelJob(job.id);
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
