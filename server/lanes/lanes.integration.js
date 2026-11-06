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
//   5. closing a lane on its own port stops its ComfyUI and frees the port;
//   6. a reused ComfyUI still follows the launch settings: a speed-up turned
//      on while serving is applied, a workflow that cannot run with Sage gets
//      a ComfyUI without it, switching back restores it — and a restart with
//      nothing changed still restarts nothing.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

// Lane state goes to a throwaway folder, set BEFORE the first require: the
// lanes' own user/temp dirs (laneManager) and the process registry + logs
// (comfyLauncher) are read from COMFYQ_LANES_DIR when the modules load. On the
// rig's real .comfyq-lanes, a test lane for a workflow the rig is serving as
// an extra lane would adopt that live ComfyUI — and step 5 would stop it, the
// cleanup delete its folder — and every test start would count in the
// "ComfyUI started N times in the last 24 h" the admin panel shows.
const ROOT = path.resolve(__dirname, '..', '..');
const LANES = fs.mkdtempSync(path.join(os.tmpdir(), 'comfyq-lanes-state-'));
process.env.COMFYQ_LANES_DIR = LANES;
const REAL_REGISTRY = path.join(ROOT, '.comfyq-lanes', 'processes.json');
const T0_ISO = new Date().toISOString();

const { LaneManager, LANES_DIR } = require('./laneManager');
const { WorkflowRegistry } = require('../workflows/workflowRegistry');
const { JobQueue } = require('../queue/jobQueue');
const launcher = require('../workers/comfyLauncher');

const BASE = Number(process.argv[2]) || 8199;
if (path.resolve(launcher.REGISTRY).toLowerCase() === REAL_REGISTRY.toLowerCase()) {
    console.warn("WARNING: comfyLauncher does not read COMFYQ_LANES_DIR — this run writes the rig's real " +
        '.comfyq-lanes/processes.json (a check at the end will fail).');
}
const real = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
const A = 'utility_video_frame_interpolation';
const B = 'utility_video_segment_sam3';
const C = 'describe_gemma4_image_description';
const Q = 'utility_qwen_2511_unblur_upscale';       // declares it cannot run with Sage attention

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

    // 6. Launch settings, both directions (owner, 2026-11-05: "if some startup
    // flags need changing, we still need to reboot ComfyUI"). The warm base
    // ComfyUI is reused across switches, so a reuse must still honour a flag
    // a workflow cannot run with, and a setting changed since it started.
    const argvOf = async (lm, id) => ((await lm.get(id).worker.rest.ping())?.system?.argv || []).map(String);
    const lastStart = () => launcher.recentStarts(3600e3).filter(s => s.port === BASE).slice(-1)[0];
    console.log(`${at()} 6a. Sage turned ON in the settings while serving → the warm ComfyUI is relaunched with it`);
    config.comfy_ui.use_sage_attention = true;
    await lm2.close(C);                                  // base ComfyUI stays up, started without Sage
    await lm2.open(A, { primary: true });
    const sagePid = pidOf(lm2, A);
    ok('A is on the base port', lm2.get(A)?.port === BASE);
    ok('a NEW process, started with --use-sage-attention', sagePid !== basePid
        && (await argvOf(lm2, A)).includes('--use-sage-attention'));
    ok('the history says why', /without Sage attention, and this lane runs with it/.test(lastStart()?.reason || ''));

    console.log(`${at()} 6b. switch to a workflow that cannot run with Sage → relaunched without it`);
    ok(`${Q} declares it cannot run with Sage`, (registry.get(Q)?.meta?.requirements?.disabledPerfFlags || []).includes('use_sage_attention'));
    await lm2.close(A);
    await lm2.open(Q, { primary: true });
    const qPid = pidOf(lm2, Q);
    ok('a NEW process, started WITHOUT --use-sage-attention', qPid !== sagePid
        && !(await argvOf(lm2, Q)).includes('--use-sage-attention'));
    ok('the history says why', /with Sage attention, and this lane runs without it/.test(lastStart()?.reason || ''));

    console.log(`${at()} 6c. switch back → Sage restored`);
    await lm2.close(Q);
    await lm2.open(A, { primary: true });
    const backPid = pidOf(lm2, A);
    ok('a NEW process, with --use-sage-attention again', backPid !== qPid
        && (await argvOf(lm2, A)).includes('--use-sage-attention'));

    console.log(`${at()} 6d. a ComfyQ restart with nothing changed → adopted, no restart`);
    const startsBefore6d = launcher.recentStarts(3600e3).length;
    lm2.detachAll();
    const lm3 = new LaneManager({ queue, registry, configManager });
    await lm3.open(A, { primary: true });
    ok('same PID, nothing started', pidOf(lm3, A) === backPid && launcher.recentStarts(3600e3).length === startsBefore6d);

    // The rig's own registry must not have heard of any of this.
    const realReg = launcher.readRegistry(REAL_REGISTRY);
    const leaked = realReg.history.filter(h => h.at >= T0_ISO && h.port >= BASE && h.port < BASE + 32);
    ok("the rig's real process registry got nothing from this test", leaked.length === 0
        && !Object.keys(realReg.procs).some(p => Number(p) >= BASE && Number(p) < BASE + 32));
    ok('the lanes lived in the throwaway folder', path.resolve(LANES_DIR) === path.resolve(LANES));

    console.log(`${at()} cleanup`);
    await lm3.close(A);                                  // base: stays up …
    const leftover = launcher.recordFor(BASE);
    if (leftover) await launcher.killPid(leftover.pid);  // … so stop it by hand here
    launcher.recordEvent({ port: BASE, pid: leftover?.pid, event: 'stop', reason: 'lane integration test cleanup' });
    for (let i = 0; i < 40 && leftover && launcher.pidAlive(leftover.pid); i++) await new Promise(r => setTimeout(r, 250));
    // Windows keeps a dead process's files locked for a moment; a leftover
    // temp folder is not a test failure.
    for (const dir of [LANES, baseHome]) {
        try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 400 }); }
        catch (e) { console.log(`  (could not remove ${dir}: ${e.code})`); }
    }
    queue.close();
    console.log(failed ? `\n${failed} check(s) FAILED` : '\nall lane integration checks passed');
    process.exit(failed ? 1 : 0);
})().catch(e => { console.error('ERROR', e); process.exit(2); });
