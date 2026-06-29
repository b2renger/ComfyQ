const express = require('express');
const fs = require('fs');
const archiver = require('archiver');
const sm = require('../queue/jobStateMachine');
const ingredients = require('../storage/ingredientsStore');

function _toWireJob(job) {
    return {
        id: job.id,
        user_id: job.userId,
        status: sm.toWireStatus(job.status),
        phase: job.status,
        time_slot: job.scheduledAt,
        started_at: job.startedAt,
        finished_at: job.finishedAt,
        prompt: job.prompt,
        params: job.paramValues,
        // Slim view of the imported inputs (param key + original filename) so the
        // UI can list "what media was imported" without exposing internal paths.
        input_files: ingredients.mediaRefs(job).map(m => ({ param: m.param, name: m.original })),
        outputs: job.outputs,
        progress: job.progress,
        current_node: job.currentNode,
        workflow_id: job.workflowId,
        workflow_version: job.workflowVersion,
        error_reason: job.errorReason,
        error_phase: job.errorPhase
    };
}

function makeRouter({ queue, comfyConfig, registry }) {
    const router = express.Router();

    router.get('/', (req, res) => {
        const { since, until, user_id, status, limit } = req.query;
        const jobs = queue.list({
            since: since ? Number(since) : undefined,
            until: until ? Number(until) : undefined,
            userId: user_id,
            status,
            limit: limit ? Number(limit) : 1000
        });
        res.json({ jobs: jobs.map(_toWireJob) });
    });

    // Download a job's "ingredients" — imported media + a settings.json snapshot
    // (workflow id, every parameter, the seed, the prompt) — as a single zip, so
    // the generation can be re-created later even after the machine has switched
    // to another workflow. Streams the durable per-job folder written at
    // completion; for older jobs (or once the media was swept) it still returns
    // settings.json generated live from the job record.
    router.get('/:id/ingredients.zip', (req, res) => {
        if (!comfyConfig) return res.status(501).json({ error: 'ingredients unavailable in this mode' });
        const job = queue.get(req.params.id);
        if (!job) return res.status(404).json({ error: 'not found' });

        const wf = String(job.workflowId || 'workflow').replace(/[^a-zA-Z0-9._-]/g, '_');
        const fname = `ingredients_${wf}_${String(job.id).slice(0, 8)}.zip`;
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);

        const archive = archiver('zip', { zlib: { level: 9 } });
        archive.on('warning', (err) => { if (err.code !== 'ENOENT') console.warn('[Ingredients] zip warn:', err.message); });
        archive.on('error', (err) => { console.warn('[Ingredients] zip error:', err.message); try { res.status(500).end(); } catch { /* already streaming */ } });
        archive.pipe(res);

        const dir = ingredients.jobDir(comfyConfig, job.id);
        if (fs.existsSync(dir)) {
            archive.directory(dir, false);   // media/ + settings.json + README.txt
        } else {
            // Pre-feature job, or its imported media was already swept — give the
            // settings (always recoverable from the DB), note the missing media.
            archive.append(JSON.stringify(ingredients.buildSettings(job, registry), null, 2), { name: 'settings.json' });
            archive.append(
                'ComfyQ — job ingredients\n\nThe imported media for this job is no longer on disk ' +
                '(it predates this feature, or is older than the input-retention window), so only ' +
                'settings.json is included.\n',
                { name: 'README.txt' }
            );
        }
        archive.finalize();
    });

    router.get('/:id', (req, res) => {
        const j = queue.get(req.params.id);
        if (!j) return res.status(404).json({ error: 'not found' });
        res.json({ job: _toWireJob(j) });
    });

    router.get('/:id/events', (req, res) => {
        res.json({ events: queue.eventsFor(req.params.id) });
    });

    return router;
}

module.exports = { makeRouter };
