// A batch table through the storyboard routes: the requests the admin card
// makes, against the real router, with stand-ins for the config and a queue
// in a temporary folder (node server/batch/batchRoutes.test.js).
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const express = require('express');
const bcrypt = require('bcryptjs');
const { WorkflowRegistry } = require('../workflows/workflowRegistry');
const { JobQueue } = require('../queue/jobQueue');
const { adminGate } = require('../auth/authGate');
const storyboard = require('../routes/storyboard');

const REPO = path.resolve(__dirname, '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-routes-'));
const assets = path.join(tmp, 'assets');
fs.mkdirSync(path.join(assets, 'shots'), { recursive: true });
const PW = 'workshop123';

// A PNG of the given size: a real header (what the guard reads) and one row of data.
function png(width, height) {
    const chunk = (type, data) => {
        const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
        const body = Buffer.concat([Buffer.from(type), data]);
        const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32 ? zlib.crc32(body) >>> 0 : 0);
        return Buffer.concat([len, body, crc]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8; ihdr[9] = 2;
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr),
        chunk('IDAT', zlib.deflateSync(Buffer.alloc(1 + width * 3))), chunk('IEND', Buffer.alloc(0))]);
}
fs.writeFileSync(path.join(assets, 'Woman.png'), png(64, 64));
fs.writeFileSync(path.join(assets, 'shots', 'a.png'), png(32, 32));
fs.writeFileSync(path.join(assets, 'shots', 'b.png'), png(48, 48));
fs.writeFileSync(path.join(assets, 'huge.png'), png(3000, 2000));

let mode = 'admin';
let activeWorkflowId = null;
const hash = bcrypt.hashSync(PW, 10);
const baseConfig = () => ({
    mode,
    auth: { adminPasswordHash: hash },
    workflows: { activeWorkflowId, dir: path.join(REPO, 'workflows') },
    queue: { dbPath: path.join(tmp, 'queue.db') },
    comfy_ui: { root_path: tmp, output_dir: path.join(tmp, 'output') },
    assets: { dir: assets },
});
const configManager = {
    load: () => ({ config: baseConfig() }),
    resolvePaths: (c) => c,
    update: (fn) => { const c = fn(baseConfig()); mode = c.mode; activeWorkflowId = c.workflows.activeWorkflowId; return c; },
};
const registry = new WorkflowRegistry(path.join(REPO, 'workflows'));
registry.discover();
const runtime = {};
const restarts = [];

const app = express();
app.use(express.json({ limit: '20mb' }));
app.use('/storyboard', storyboard.makeRouter({
    configManager, registry, runtime, adminGate: adminGate(configManager), exitForRestart: (to) => restarts.push(to),
}));

let fails = 0;
const check = (name, cond, extra = '') => {
    if (!cond) { console.error('  FAIL ' + name + (extra ? '  ' + extra : '')); fails++; }
};

const T2I = 'image_moss_image_t2i';
const EDIT = 'image_edit_flux3_klein_image_edit';
const GOOD = [
    'id,workflow,prompt,image',
    `hero,${T2I},a red door,`,
    `look,${EDIT},make it blue,hero`,
    `same,${EDIT},make it green,file:Woman.png`,
    `again,${EDIT},make it gold,file:Woman.png`,
    `each,${EDIT},make it old,folder:shots`,
].join('\n');

const srv = app.listen(0, '127.0.0.1', async () => {
    const base = `http://127.0.0.1:${srv.address().port}`;
    const H = { 'X-Admin-Password': PW };
    const form = (text, name = 'shots.csv', extra = {}) => {
        const f = new FormData();
        f.append('file', new Blob([text], { type: 'text/csv' }), name);
        for (const [k, v] of Object.entries(extra)) f.append(k, v);
        return f;
    };
    const post = async (route, body, headers = H) => {
        const r = await fetch(base + route, { method: 'POST', headers, body });
        return { status: r.status, d: await r.json() };
    };
    try {
        let { status, d } = await post('/storyboard/preview', form(GOOD));
        check('a .csv is read as a table', status === 200 && d.format === 'table', `${status} ${JSON.stringify(d).slice(0, 300)}`);
        check('six jobs, no errors', d.totalJobs === 6 && d.errors.length === 0, JSON.stringify(d.errors));
        check('the card\'s fields are there', Array.isArray(d.phases) && d.phases[0].label === 'images' && d.modelLoads === 2 && d.outputFolder === 'shots');
        check('a job says what it uses', d.jobs[1].deps[0].sourceTitle === 'hero' && d.jobs[2].deps[0].sourceTitle === 'Woman.png', JSON.stringify(d.jobs[1].deps));
        check('folder copies are named', d.jobs.map(j => j.title).join(' ') === 'hero look same again each.1 each.2', d.jobs.map(j => j.title).join(' '));

        ({ status } = await post('/storyboard/preview', form(GOOD), {}));
        check('the admin password is required', status === 401, String(status));

        ({ status, d } = await post('/storyboard/preview', form(`workflow,prompt,image\n${EDIT},x,file:huge.png\n${EDIT},x,\n`)));
        check('a picture larger than an upload may be is refused at preview', d.errors.some(e => /^Row 2: "huge.png": Image is too large \(3000×2000\)/.test(e)), JSON.stringify(d.errors));
        check('errors carry row and column', d.errors.some(e => /^Row 3, image: /.test(e)), JSON.stringify(d.errors));
        check('a refused table has a summary', /Nothing is queued/.test(d.summary || ''), d.summary);

        ({ status, d } = await post('/storyboard/queue', form(`workflow,prompt,image\n${EDIT},x,\n`)));
        check('queue refuses a table with an error', status === 422 && /Row 2, image/.test(d.errors[0]), `${status} ${JSON.stringify(d)}`);
        ({ status, d } = await post('/storyboard/queue', form(`workflow,prompt,image\n${EDIT},x,\n`, 'shots.csv', { force: 'true' })));
        check('force does not apply to a table', status === 422, String(status));
        let q = new JobQueue(path.join(tmp, 'queue.db'));
        check('nothing was queued', q.listBatches().length === 0);
        q.close();
        check('nothing was served', mode === 'admin' && restarts.length === 0);

        ({ status, d } = await post('/storyboard/queue', form(GOOD)));
        check('queue takes a clean table', status === 200 && d.ok && d.totalJobs === 6, `${status} ${JSON.stringify(d).slice(0, 300)}`);
        check('in admin mode it serves the first workflow and restarts', d.restarting && mode === 'student' && activeWorkflowId === T2I, `${mode} ${activeWorkflowId}`);
        await new Promise(r => setTimeout(r, 400));
        check('the restart is asked for once', restarts.length === 1, String(restarts.length));

        q = new JobQueue(path.join(tmp, 'queue.db'));
        const jobs = q.listBatch(d.batchId);
        check('six rows in one batch, in order', jobs.length === 6 && jobs.every((j, i) => i === 0 || j.scheduledAt > jobs[i - 1].scheduledAt));
        const byTitle = new Map(d.jobs.map(j => [j.title, j.id]));
        const lookDeps = q.depsFor(byTitle.get('look'));
        check('look waits on hero', lookDeps.length === 1 && lookDeps[0].sourceJobId === byTitle.get('hero') && lookDeps[0].kind === 'image', JSON.stringify(lookDeps));
        const input = path.join(tmp, 'input');
        const staged = fs.readdirSync(input);
        check('three distinct files staged, Woman.png once', staged.length === 3 && staged.every(n => n.startsWith('comfyq_session__batch_')), staged.join(', '));
        const same = q.get(byTitle.get('same'));
        const again = q.get(byTitle.get('again'));
        const key = Object.keys(same.paramValues).find(k => String(same.paramValues[k]).startsWith('comfyq_session__batch_'));
        check('the staged name is the job\'s input', key && staged.includes(same.paramValues[key]) && same.paramValues[key] === again.paramValues[key], JSON.stringify(same.paramValues));
        check('each job has its own output name', jobs.every(j => /^shots\/\d{3}_[\w.-]+__[\w-]+$/.test(j.outputPrefix)), jobs.map(j => j.outputPrefix).join(' '));
        check('a seed is recorded', typeof q.get(byTitle.get('hero')).paramValues.seed_107 === 'number');
        const heroId = byTitle.get('hero');
        q.close();

        // job:<prefix> names a job that already exists.
        ({ status, d } = await post('/storyboard/preview', JSON.stringify({ table: `workflow,prompt,image\n${EDIT},x,job:${heroId.slice(0, 8)}\n`, name: 'next.csv' }),
            { ...H, 'Content-Type': 'application/json' }));
        check('a JSON { table } body works, and job:<prefix> finds the job', status === 200 && d.errors.length === 0 && /^job /.test(d.jobs[0].deps[0].sourceTitle), `${status} ${JSON.stringify(d.errors)}`);

        const md = fs.readFileSync(path.join(REPO, 'server', 'storyboard', 'fixtures', 'example.md'), 'utf8');
        ({ status, d } = await post('/storyboard/preview', form(md, 'red.md')));
        check('a .md file is still a storyboard', status === 200 && d.format !== 'table' && d.totalJobs === 42, `${status} ${d.totalJobs}`);
    } catch (e) {
        console.error('  FAIL ' + (e.stack || e.message));
        fails++;
    } finally {
        srv.close();
        try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* the queue file on Windows */ }
        console.log(`batchRoutes: ${fails ? `${fails} failed` : 'ok'}`);
        process.exitCode = fails ? 1 : 0;
    }
});
