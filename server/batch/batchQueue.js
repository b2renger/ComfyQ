// batchQueue — from a batch plan (batchPlan.js) to queue rows.
//
// Kept apart from the route so each step can be tested without HTTP:
//   checkAssetImages  the upload guard, applied to pictures from the assets folder
//   stageAssets       copy those files into ComfyUI/input, once each
//   buildInserts      the JobQueue.insert() arguments, with ids and wiring
//   toPreview         the plan in the shape the storyboard card already reads
//
// Staged files are named comfyq_session__batch_<content hash>__<name>: the
// session prefix is never swept (inputUploader.sweepStale), so a finished
// batch can be run again exactly, and the hash means the same picture used by
// fifty rows, or by two batches, is copied once.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { inspectUpload } = require('../routes/uploads');
const { predictOutputKind } = require('../storyboard/storyboardPlanner');

const PHASE_FOR_KIND = { image: 'images', video: 'videos', audio: 'audio', model3d: '3D models', text: 'texts' };
const PHASE_ORDER = ['images', 'videos', 'audio', '3D models', 'texts', 'other'];

const where = (row, column) => `Row ${row}${column ? `, ${column}` : ''}`;
const line = (e) => (e.row ? `${where(e.row, e.column)}: ${e.message}` : e.message);

// One staged file: an asset, with the steps that prepare it (none for most).
const stageKey = (a) => `${a.file}${a.derive?.length ? ` | ${JSON.stringify(a.derive)}` : ''}`;

// Every distinct staged file of the plan, with the jobs (row, column) that use it.
function assetUses(plan) {
    const uses = new Map();
    for (const j of plan.jobs) {
        for (const a of j.assets) {
            const k = stageKey(a);
            if (!uses.has(k)) uses.set(k, { file: a.file, derive: a.derive || [], uses: [] });
            uses.get(k).uses.push({ row: j.row, paramKey: a.paramKey });
        }
    }
    return uses;
}

// The guard an upload goes through (no HEIC, a size in bytes and in pixels),
// for each picture the plan takes from the assets folder as it is. A prepared
// one is checked once it is made (stageAssets): its steps may be what shrinks it.
// → [{ row, column, message }]
function checkAssetImages(plan, assetsDir) {
    const errors = [];
    for (const { file, derive, uses } of assetUses(plan).values()) {
        if (derive.length) continue;
        const verdict = inspectUpload(path.join(assetsDir, file), file);
        if (verdict.ok) continue;
        const rows = [...new Set(uses.map(u => u.row))];
        errors.push({ row: rows[0], column: null, message: `"${file}": ${verdict.error}${rows.length > 1 ? ` (also used on row${rows.length > 2 ? 's' : ''} ${rows.slice(1).join(', ')})` : ''}` });
    }
    return errors;
}

function safeName(name) {
    return path.basename(name).replace(/[^A-Za-z0-9._-]/g, '_').slice(-80) || 'file';
}

// Copy each asset into ComfyUI's input folder, preparing it first when the
// table gives steps (deriveInput, the test suite's own). → Map(stageKey → staged name)
//   derive: async ({ src, ops, dest }) → dest   (injected, so a test needs no python)
// A prepared picture goes through the upload guard here; it throws, naming the
// row, when one does not pass, and nothing is queued.
async function stageAssets(plan, assetsDir, inputDir, { derive } = {}) {
    const staged = new Map();
    fs.mkdirSync(inputDir, { recursive: true });
    for (const [key, unit] of assetUses(plan)) {
        let src = path.join(assetsDir, unit.file);
        let base = safeName(unit.file);
        let tmpMade = null;
        if (unit.derive.length) {
            if (!derive) throw new Error(`Row ${unit.uses[0].row}: "${unit.file}" has steps, and nothing here can prepare it.`);
            const ext = unit.derive.some(o => ['trim', 'vscale', 'vblur', 'mute', 'encode'].includes(o.op)) ? 'mp4' : 'png';
            tmpMade = path.join(inputDir, `comfyq_batchprep_${crypto.randomBytes(6).toString('hex')}.${ext}`);
            try { await derive({ src, ops: unit.derive, dest: tmpMade }); }
            catch (e) { throw new Error(`Row ${unit.uses[0].row}: "${unit.file}" could not be prepared: ${e.message}`); }
            src = tmpMade;
            base = `${base.replace(/\.[^.]+$/, '')}_prepared.${ext}`;
            const verdict = inspectUpload(src, base);
            if (!verdict.ok) { fs.rmSync(src, { force: true }); throw new Error(`Row ${unit.uses[0].row}: "${unit.file}", prepared: ${verdict.error}`); }
        }
        try {
            const hash = crypto.createHash('sha1').update(fs.readFileSync(src)).digest('hex').slice(0, 16);
            const name = `comfyq_session__batch_${hash}__${base}`;
            const dest = path.join(inputDir, name);
            if (!fs.existsSync(dest)) {
                // Through a temporary name, so a half-copied file never carries the real one.
                const tmp = `${dest}.part`;
                fs.copyFileSync(src, tmp);
                fs.renameSync(tmp, dest);
            }
            staged.set(key, name);
        } finally {
            if (tmpMade) fs.rmSync(tmpMade, { force: true });
        }
    }
    return staged;
}

// A path segment safe on Windows and POSIX.
function segment(s, max = 60) {
    const out = String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '')
        .replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, max);
    return out || 'batch';
}

// → [insert args] in run order. Times step by each job's estimate so the
// timeline shows the batch as it will run; the order is what the queue keeps
// (scheduled_at, then created_at), so a job with no estimate still gets a
// later time than the one before it.
function buildInserts(plan, { batchId, batchLabel, folder, userId, startAt, spacing = 'estimated', staged = new Map() }) {
    const ids = new Map(plan.jobs.map(j => [j.key, uuidv4()]));
    let at = startAt;
    return plan.jobs.map((j, i) => {
        if (i > 0) {
            const prev = plan.jobs[i - 1];
            const gapSec = spacing === 'asap' ? 0
                : (prev.estimatedDurationSec || 0) + (j.workflowId !== prev.workflowId ? (j.modelLoadSec || 0) : 0);
            at += Math.max(1, Math.round(gapSec * 1000));
        }
        const paramValues = { ...j.paramValues };
        for (const a of j.assets) {
            const name = staged.get(stageKey(a));
            if (!name) throw new Error(`internal: "${a.file}" was not staged`);
            paramValues[a.paramKey] = name;
        }
        const deps = j.deps.map(d => {
            if (d.sourceJobId) return { paramKey: d.paramKey, sourceJobId: d.sourceJobId, outputIndex: d.outputIndex, kind: d.kind };
            const sourceJobId = ids.get(d.sourceKey);
            if (!sourceJobId) throw new Error(`internal: "${j.key}" has no source "${d.sourceKey}"`);
            return { paramKey: d.paramKey, sourceJobId, outputIndex: d.outputIndex, kind: d.kind };
        });
        return {
            id: ids.get(j.key),
            userId,
            workflowId: j.workflowId,
            workflowVersion: j.workflowVersion,
            scheduledAt: at,
            prompt: j.prompt,
            paramValues,
            createdBy: 'storyboard',
            batchId,
            batchLabel,
            // "<folder>/003_look.2__image_edit_flux3_klein_image_edit": the
            // storyboard card labels a job "look.2 · image edit flux3 …" from this.
            outputPrefix: `${segment(folder, 80)}/${String(i + 1).padStart(3, '0')}_${segment(j.key)}__${segment(j.workflowId)}`,
            deps,
        };
    });
}

// The plan as /storyboard/preview answers, so the same card shows a table.
function toPreview(plan, registry) {
    const counts = new Map();
    for (const j of plan.jobs) {
        const kind = predictOutputKind(registry.get(j.workflowId));
        const phase = PHASE_FOR_KIND[kind] || 'other';
        counts.set(phase, (counts.get(phase) || 0) + 1);
    }
    const phases = PHASE_ORDER.filter(p => counts.has(p)).map((label, i) => ({ phase: i, label, count: counts.get(label) }));
    const workflowRuns = [];
    for (const j of plan.jobs) {
        const lastRun = workflowRuns[workflowRuns.length - 1];
        if (lastRun && lastRun.workflowId === j.workflowId) lastRun.count++;
        else workflowRuns.push({ workflowId: j.workflowId, workflowName: j.workflowName, count: 1 });
    }
    const byKey = new Map(plan.jobs.map(j => [j.key, j]));
    const labelOf = (j, key) => {
        const p = (registry.get(j.workflowId)?.effective?.exposedParameters || []).find(q => q.key === key);
        return p?.label || key;
    };
    return {
        phases,
        workflowRuns,
        modelLoads: plan.modelLoads,
        totalJobs: plan.jobs.length,
        totalShots: new Set(plan.jobs.map(j => j.id)).size + plan.blocked.length,
        totalEstimatedSec: plan.totalEstimatedSec,
        summary: plan.errors.length || plan.blocked.length ? plan.summary : null,
        // The same problems with their row and column, for the batch editor to
        // mark the cell they belong to (the strings below are for the card).
        problems: plan.errors.map(e => ({ row: e.row ?? null, column: e.column ?? null, message: e.message })),
        cautions: plan.warnings.map(e => ({ row: e.row ?? null, column: e.column ?? null, message: e.message })),
        blocked: plan.blocked,
        errors: plan.errors.map(line),
        warnings: plan.warnings.map(line),
        blockedReasons: plan.blocked.map(b => `${where(b.row)} (${b.id}) waits on ${b.waitsOn.join(', ')}.`),
        jobs: plan.jobs.map(j => ({
            order: j.order,
            row: j.row,
            rowId: j.id,
            stateId: `row ${j.row}`,
            title: j.key,
            notes: [],
            workflowId: j.workflowId,
            estimatedDurationSec: j.estimatedDurationSec,
            deps: [
                ...j.deps.map(d => ({ paramLabel: labelOf(j, d.paramKey), sourceTitle: d.sourceKey ? `${d.sourceKey}${d.outputIndex ? ` #${d.outputIndex + 1}` : ''}` : `job ${d.sourceJobId.slice(0, 8)}` })),
                ...j.assets.map(a => ({ paramLabel: labelOf(j, a.paramKey), sourceTitle: a.file })),
            ],
        })),
    };
}

// The env lookup for job:<id>: a whole id, or a prefix naming exactly one job.
function jobLookup(queue) {
    return (ref) => {
        const exact = queue.get(ref);
        if (exact) return exact;
        const rows = queue.db.prepare(`SELECT id FROM jobs WHERE id LIKE ? LIMIT 2`).all(`${ref}%`);
        return rows.length === 1 ? queue.get(rows[0].id) : null;
    };
}

const isTableName = (name) => /\.(csv|tsv)$/i.test(String(name || ''));

module.exports = { checkAssetImages, stageAssets, buildInserts, toPreview, jobLookup, isTableName, line };
