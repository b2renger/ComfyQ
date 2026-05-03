const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { v4: uuidv4 } = require('uuid');
const sm = require('./jobStateMachine');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    workflow_id TEXT NOT NULL,
    workflow_version TEXT,
    status TEXT NOT NULL,
    scheduled_at INTEGER NOT NULL,
    started_at INTEGER,
    finished_at INTEGER,
    prompt_id TEXT,
    prompt TEXT,
    param_values TEXT NOT NULL,
    input_files TEXT NOT NULL,
    outputs TEXT NOT NULL,
    progress TEXT NOT NULL,
    current_node TEXT,
    error_reason TEXT,
    error_phase TEXT,
    created_by TEXT,
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_scheduled_at ON jobs(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_jobs_user ON jobs(user_id);

CREATE TABLE IF NOT EXISTS job_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id TEXT NOT NULL,
    ts INTEGER NOT NULL,
    from_status TEXT,
    to_status TEXT NOT NULL,
    payload TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_job ON job_events(job_id);
`;

function rowToJob(r) {
    if (!r) return null;
    return {
        id: r.id,
        userId: r.user_id,
        workflowId: r.workflow_id,
        workflowVersion: r.workflow_version || null,
        status: r.status,
        scheduledAt: r.scheduled_at,
        startedAt: r.started_at || null,
        finishedAt: r.finished_at || null,
        promptId: r.prompt_id || null,
        prompt: r.prompt || '',
        paramValues: JSON.parse(r.param_values || '{}'),
        inputFiles: JSON.parse(r.input_files || '[]'),
        outputs: JSON.parse(r.outputs || '[]'),
        progress: JSON.parse(r.progress || '{}'),
        currentNode: r.current_node || null,
        errorReason: r.error_reason || null,
        errorPhase: r.error_phase || null,
        createdBy: r.created_by || null,
        createdAt: r.created_at
    };
}

class JobQueue {
    constructor(dbPath) {
        fs.mkdirSync(path.dirname(dbPath), { recursive: true });
        this.db = new Database(dbPath);
        this.db.pragma('journal_mode = WAL');
        this.db.pragma('foreign_keys = ON');
        this.db.exec(SCHEMA);
        this._listeners = new Set();
    }

    onChange(cb) { this._listeners.add(cb); return () => this._listeners.delete(cb); }
    _emit() { for (const cb of this._listeners) try { cb(); } catch (e) { console.error('[Queue] listener err:', e); } }

    // Move any in-flight job (pre-restart) to FAILED with reason 'server-restart'.
    reconcileOnBoot() {
        const inflight = [
            sm.STATES.UPLOADING_INPUTS,
            sm.STATES.SUBMITTED,
            sm.STATES.EXECUTING,
            sm.STATES.COLLECTING_OUTPUTS
        ];
        const placeholders = inflight.map(() => '?').join(',');
        const rows = this.db.prepare(`SELECT id, status FROM jobs WHERE status IN (${placeholders})`).all(...inflight);
        const tx = this.db.transaction(() => {
            for (const r of rows) {
                this.db.prepare(
                    `UPDATE jobs SET status=?, finished_at=?, error_reason=?, error_phase=? WHERE id=?`
                ).run(sm.STATES.FAILED, Date.now(), 'server-restart', r.status, r.id);
                this.db.prepare(
                    `INSERT INTO job_events (job_id, ts, from_status, to_status, payload) VALUES (?,?,?,?,?)`
                ).run(r.id, Date.now(), r.status, sm.STATES.FAILED, JSON.stringify({ reason: 'server-restart' }));
            }
        });
        tx();
        if (rows.length > 0) {
            console.log(`[Queue] Reconciled ${rows.length} in-flight job(s) → failed: server-restart`);
            this._emit();
        }
        return rows.length;
    }

    insert({ userId, workflowId, workflowVersion, scheduledAt, prompt = '', paramValues = {}, createdBy = null }) {
        const id = uuidv4();
        const now = Date.now();
        this.db.prepare(`
            INSERT INTO jobs (id, user_id, workflow_id, workflow_version, status, scheduled_at,
                              prompt, param_values, input_files, outputs, progress, created_by, created_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
        `).run(
            id, userId, workflowId, workflowVersion || null,
            sm.STATES.SCHEDULED, scheduledAt,
            prompt, JSON.stringify(paramValues), '[]', '[]', '{}',
            createdBy, now
        );
        this.db.prepare(
            `INSERT INTO job_events (job_id, ts, from_status, to_status, payload) VALUES (?,?,?,?,?)`
        ).run(id, now, null, sm.STATES.SCHEDULED, null);
        this._emit();
        return this.get(id);
    }

    get(jobId) {
        const r = this.db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(jobId);
        return rowToJob(r);
    }

    list({ since, until, userId, status, limit = 1000 } = {}) {
        const conds = [];
        const args = [];
        if (since != null) { conds.push('scheduled_at >= ?'); args.push(since); }
        if (until != null) { conds.push('scheduled_at <= ?'); args.push(until); }
        if (userId)        { conds.push('user_id = ?');       args.push(userId); }
        if (status)        { conds.push('status = ?');        args.push(status); }
        const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
        const rows = this.db.prepare(`SELECT * FROM jobs ${where} ORDER BY scheduled_at ASC LIMIT ?`).all(...args, limit);
        return rows.map(rowToJob);
    }

    findReady(now = Date.now()) {
        const r = this.db.prepare(`
            SELECT * FROM jobs WHERE status = ? AND scheduled_at <= ? ORDER BY scheduled_at ASC LIMIT 1
        `).get(sm.STATES.SCHEDULED, now);
        return rowToJob(r);
    }

    findCollisions(scheduledAt, durationMs, excludeJobId = null) {
        const endAt = scheduledAt + durationMs;
        const args = [scheduledAt, endAt];
        let q = `
            SELECT id, scheduled_at FROM jobs
            WHERE status NOT IN ('failed', 'cancelled', 'completed')
              AND scheduled_at < ?
              AND (scheduled_at + ?) > ?
        `;
        // Approximate: same fixed duration on both sides. Caller should pass the expected duration.
        // We can't store per-job duration without joining; for v2 collision detection we treat
        // each in-flight/scheduled job as occupying [scheduled_at, scheduled_at + durationMs).
        const rows = this.db.prepare(`
            SELECT id, scheduled_at FROM jobs
            WHERE status NOT IN ('failed', 'cancelled', 'completed')
              AND scheduled_at < ?
              AND (scheduled_at + ?) > ?
              ${excludeJobId ? 'AND id != ?' : ''}
        `).all(...(excludeJobId ? [endAt, durationMs, scheduledAt, excludeJobId] : [endAt, durationMs, scheduledAt]));
        return rows.map(r => r.id);
    }

    transitionStatus(jobId, toStatus, { payload = null, now = Date.now() } = {}) {
        const job = this.get(jobId);
        if (!job) throw new Error(`Job not found: ${jobId}`);
        if (!sm.canTransition(job.status, toStatus)) {
            throw new Error(`Illegal transition ${job.status} → ${toStatus} for job ${jobId}`);
        }
        const updates = ['status = ?'];
        const args = [toStatus];
        if (toStatus === sm.STATES.UPLOADING_INPUTS && !job.startedAt) {
            updates.push('started_at = ?'); args.push(now);
        }
        if (sm.isTerminal(toStatus)) {
            updates.push('finished_at = ?'); args.push(now);
        }
        if (payload?.errorReason !== undefined) { updates.push('error_reason = ?'); args.push(payload.errorReason); }
        if (payload?.errorPhase  !== undefined) { updates.push('error_phase = ?');  args.push(payload.errorPhase); }
        if (payload?.promptId    !== undefined) { updates.push('prompt_id = ?');    args.push(payload.promptId); }
        if (payload?.inputFiles  !== undefined) { updates.push('input_files = ?');  args.push(JSON.stringify(payload.inputFiles)); }
        if (payload?.outputs     !== undefined) { updates.push('outputs = ?');      args.push(JSON.stringify(payload.outputs)); }
        args.push(jobId);
        this.db.prepare(`UPDATE jobs SET ${updates.join(', ')} WHERE id = ?`).run(...args);
        this.db.prepare(
            `INSERT INTO job_events (job_id, ts, from_status, to_status, payload) VALUES (?,?,?,?,?)`
        ).run(jobId, now, job.status, toStatus, payload ? JSON.stringify(payload) : null);
        this._emit();
        return this.get(jobId);
    }

    updateProgress(jobId, { stepsDone, stepsTotal, currentNode, currentNodeTitle } = {}) {
        const job = this.get(jobId);
        if (!job) return null;
        const progress = { ...job.progress };
        if (stepsDone   != null) progress.stepsDone   = stepsDone;
        if (stepsTotal  != null) progress.stepsTotal  = stepsTotal;
        if (currentNodeTitle != null) progress.currentNodeTitle = currentNodeTitle;
        const node = currentNode != null ? currentNode : job.currentNode;
        this.db.prepare(`UPDATE jobs SET progress = ?, current_node = ? WHERE id = ?`)
            .run(JSON.stringify(progress), node, jobId);
        this._emit();
        return this.get(jobId);
    }

    setOutputs(jobId, outputs) {
        this.db.prepare(`UPDATE jobs SET outputs = ? WHERE id = ?`)
            .run(JSON.stringify(outputs || []), jobId);
        this._emit();
        return this.get(jobId);
    }

    reorder(jobId, newScheduledAt) {
        const job = this.get(jobId);
        if (!job) throw new Error(`Job not found: ${jobId}`);
        if (job.status !== sm.STATES.SCHEDULED) throw new Error(`Cannot move job in status "${job.status}"`);
        this.db.prepare(`UPDATE jobs SET scheduled_at = ? WHERE id = ?`).run(newScheduledAt, jobId);
        this._emit();
        return this.get(jobId);
    }

    delete(jobId) {
        this.db.prepare(`DELETE FROM job_events WHERE job_id = ?`).run(jobId);
        this.db.prepare(`DELETE FROM jobs WHERE id = ?`).run(jobId);
        this._emit();
    }

    eventsFor(jobId) {
        return this.db.prepare(`SELECT * FROM job_events WHERE job_id = ? ORDER BY id ASC`).all(jobId);
    }

    close() { this.db.close(); }
}

module.exports = { JobQueue };
