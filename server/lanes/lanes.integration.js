// Lane integration test — REAL ComfyUI processes, on throwaway ports, CPU only.
//
// Not part of `npm run test:storyboard`: it boots three ComfyUIs (about a
// minute each, ~1 GB of RAM each, no GPU) and needs the portable install. Run
// it by hand after touching LaneManager, ComfyProcess or comfyLauncher:
//
//   node server/lanes/lanes.integration.js [basePort=8199]
//
// What it proves, in order (the owner's two asks of 2026-11-04: stop any lane
// on its own; restart ComfyUI as little as possible):
//   1. two lanes open — the first on the base port, the second on its own;
//   2. the MAIN lane can be closed while the other keeps serving: main moves to
//      it, the install's ComfyUI stays up (models unloaded), config follows;
//   3. a new lane reuses that warm base ComfyUI — no new process;
//   4. a "ComfyQ restart" (a second LaneManager on the same config) re-adopts
//      every lane's ComfyUI — same PIDs, no new process;
//   5. closing a lane on its own port stops its ComfyUI and frees the port.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { LaneManager } = require('./laneManager');
const { WorkflowRegistry } = require('../workflows/workflowRegistry');
const { JobQueue } = require('../queue/jobQueue');
const launcher = require('../workers/comfyLauncher');

const BASE = Number(process.argv[2]) || 8199;
const ROOT = path.resolve(__dirname, '..', '..');
const real = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
const A = 'utility_video_frame_interpolation';
const B = 'utility_video_segment_sam3';
const C = 'describe_gemma4_image_description';

// The test's "base" ComfyUI gets its own user/temp directories: the real
// install's user dir is held by the rig's own ComfyUI (ComfyUI locks its
// comfyui.db), and a test must never touch a rig's real state anyway.
const baseHome = fs.mkdtempSync(path.join(os.tmpdir(), 'comfyq-lanes-base-'));
let config = {
    ...real,
    comfy_ui: { ...real.comfy_ui, api_port: BASE, lan_access: false, extra_args: ['--cpu'],
        use_sage_attention: false, fp16_accumulation: false,
        user_dir: path.join(baseHome, 'user'), temp_dir: baseHome },
    workflows: { ...real.workflows, activeWorkflowId: A, extraLaneWorkflowIds: [] },
    instance: { ...real.instance, vramGb: 1000 },     // the VRAM check is not under test
};
const configManager = {
    load: () => ({ config }),
    update: (fn) => { config = fn(JSON.parse(JSON.stringify(config))) || config; return config; },
};
const registry = new WorkflowRegistry(path.join(ROOT, 'workflows'));
registry.discover();
const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'comfyq-lanes-it-'));
const queue = new JobQueue(path.join(dbDir, 'q.sqlite'));

let failed = 0;
const ok = (msg, cond) => { console.log(`${cond ? '  ok  ' : '  FAIL'} ${msg}`); if (!cond) failed++; };
const t0 = Date.now();
const at = () => `${((Date.now() - t0) / 1000).toFixed(0)}s`;
const quietComfy = () => {
    const w = process.stdout.write.bind(process.stdout);
    process.stdout.write = (c, ...r) => (String(c).startsWith('[ComfyUI]') ? true : w(c, ...r));
    const e = process.stderr.write.bind(process.stderr);
    process.stderr.write = (c, ...r) => (String(c).startsWith('[ComfyUI!]') ? true : e(c, ...r));
};
const pidOf = (lm, id) => lm.get(id)?.worker?.process?.pid || null;

(async () => {
    quietComfy();
    const lm = new LaneManager({ queue, registry, configManager });

    console.log(`${at()} 1. open two lanes`);
    await lm.open(A, { primary: true });
    await lm.open(B, { force: true });
    ok('A runs on the base port, on the install\'s directories', lm.get(A).port === BASE && lm.get(A).base);
    ok('B runs on its own port with its own directories', lm.get(B).port !== BASE && !lm.get(B).base);
    ok('A is the main lane', lm.mainLane().workflowId === A);
    ok('config: active A, extras [B]', config.workflows.activeWorkflowId === A
        && JSON.stringify(config.workflows.extraLaneWorkflowIds) === JSON.stringify([B]));
    const basePid = pidOf(lm, A);
    const bPid = pidOf(lm, B);

    console.log(`${at()} 2. close the MAIN lane while B keeps serving`);
    await lm.close(A);
    ok('B is still served and is now main', !!lm.get(B) && lm.mainLane().workflowId === B);
    ok('config: active B, no extras', config.workflows.activeWorkflowId === B
        && config.workflows.extraLaneWorkflowIds.length === 0);
    ok('the base ComfyUI is still running (same PID)', launcher.pidAlive(basePid)
        && (await launcher.pidsOnPort(BASE)).includes(basePid));
    ok("B's ComfyUI was not touched", launcher.pidAlive(bPid) && pidOf(lm, B) === bPid);

    console.log(`${at()} 3. a new lane reuses the warm base ComfyUI`);
    const startsBefore = launcher.recentStarts(3600e3).length;
    await lm.open(C, { force: true });
    ok('C was placed on the base port', lm.get(C).port === BASE && lm.get(C).base);
    ok('C runs on the SAME ComfyUI process — no new start', pidOf(lm, C) === basePid
        && launcher.recentStarts(3600e3).length === startsBefore);
    ok('config: active B, extras [C]', config.workflows.activeWorkflowId === B
        && JSON.stringify(config.workflows.extraLaneWorkflowIds) === JSON.stringify([C]));

    console.log(`${at()} 4. "ComfyQ restarts": a fresh LaneManager re-adopts both lanes`);
    lm.detachAll();
    const lm2 = new LaneManager({ queue, registry, configManager });
    const saved = lm2.rememberedExtras();
    lm2.holdForRestore(saved);
    await lm2.open(config.workflows.activeWorkflowId, { primary: true });
    await lm2.restoreRemembered(saved);
    ok('B came back on its own port, same PID', lm2.get(B)?.port === lm.get(B)?.port && pidOf(lm2, B) === bPid);
    ok('C came back on the base port, same PID', lm2.get(C)?.port === BASE && pidOf(lm2, C) === basePid);
    ok('nothing was started to do it', launcher.recentStarts(3600e3).length === startsBefore);
    ok('both are owned (can be stopped)', lm2.get(B).worker.process.owned && lm2.get(C).worker.process.owned);
    ok('config unchanged by the restore: active B, extras [C]', config.workflows.activeWorkflowId === B
        && JSON.stringify(config.workflows.extraLaneWorkflowIds) === JSON.stringify([C]));

    console.log(`${at()} 5. close B — its own ComfyUI stops`);
    const bPort = lm2.get(B).port;
    await lm2.close(B);
    ok("B's ComfyUI is gone and its port is free", !launcher.pidAlive(bPid) && (await launcher.pidsOnPort(bPort)).length === 0);
    ok('C is main now', lm2.mainLane()?.workflowId === C);

    console.log(`${at()} cleanup`);
    await lm2.close(C);                                  // base: stays up …
    await lm2.get(C)?.worker?.process?.stop();
    const leftover = launcher.recordFor(BASE);
    if (leftover) await launcher.killPid(leftover.pid);  // … so stop it by hand here
    launcher.recordEvent({ port: BASE, pid: leftover?.pid, event: 'stop', reason: 'lane integration test cleanup' });
    for (let i = 0; i < 40 && leftover && launcher.pidAlive(leftover.pid); i++) await new Promise(r => setTimeout(r, 250));
    // Windows keeps a dead process's files locked for a moment; a leftover
    // temp folder is not a test failure.
    for (const dir of [...[A, B, C].map(id => path.join(ROOT, '.comfyq-lanes', id)), baseHome]) {
        try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 400 }); }
        catch (e) { console.log(`  (could not remove ${dir}: ${e.code})`); }
    }
    queue.close();
    console.log(failed ? `\n${failed} check(s) FAILED` : '\nall lane integration checks passed');
    process.exit(failed ? 1 : 0);
})().catch(e => { console.error('ERROR', e); process.exit(2); });
