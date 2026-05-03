const express = require('express');
const sm = require('../queue/jobStateMachine');

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
        outputs: job.outputs,
        progress: job.progress,
        current_node: job.currentNode,
        workflow_id: job.workflowId,
        workflow_version: job.workflowVersion,
        error_reason: job.errorReason,
        error_phase: job.errorPhase
    };
}

function makeRouter({ queue }) {
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
