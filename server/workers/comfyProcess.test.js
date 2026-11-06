// ComfyProcess.start() — when to launch a ComfyUI, and when NOT to.
//
// ★ ComfyUI binds its port only at the very end of its boot, so for most of a
// start nothing answers and nothing is bound. start() used to read that as
// "no ComfyUI here" and launch a second one: after a boot that outlasted
// waitForApi, or after ComfyQ restarted while its ComfyUI was still booting.
// The two raced for the port, the loser exited, and the winner was then taken
// for an external ComfyUI that ComfyQ could no longer stop or restart.
//
// Everything that would touch the machine is stubbed: no process is started or
// killed, no port is probed, and the real .comfyq-lanes registry is never read
// or written.
//
// Run with:  node server/workers/comfyProcess.test.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const launcher = require('./comfyLauncher');
const { ComfyProcess } = require('./comfyProcess');

let fails = 0;
async function test(name, fn) {
    try { await fn(); console.log(`  ok   ${name}`); }
    catch (e) { console.error(`  FAIL ${name}\n       ${e.message}`); fails++; }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'comfyq-process-'));
const root = path.join(tmp, 'ComfyUI');
fs.mkdirSync(root, { recursive: true });
fs.writeFileSync(path.join(root, 'main.py'), '');
const python = path.join(tmp, 'python.exe');
fs.writeFileSync(python, '');

// The launcher, replaced wholesale for the duration of the file.
const real = { ...launcher };
let alive, registry, launches, kills, listening, events;
function reset() {
    alive = new Set();
    registry = {};
    launches = [];
    kills = [];
    listening = [];
    events = [];
}
launcher.pidAlive = (pid) => alive.has(pid);
launcher.recordFor = (port) => registry[String(port)] || null;
launcher.recordStart = ({ port, pid, reason }) => { registry[String(port)] = { pid, userDir: null, startedAt: new Date().toISOString() }; launches.push(reason); };
launcher.recordEvent = ({ port, pid, event }) => {
    events.push(event);
    if ((event === 'stop' || event === 'exit') && registry[String(port)]?.pid === pid) delete registry[String(port)];
};
launcher.launchDetached = async () => { const pid = 5000 + launches.length; alive.add(pid); return { pid }; };
launcher.killPid = async (pid) => { kills.push(pid); alive.delete(pid); return true; };
launcher.pidsOnPort = async () => listening;

function makeProcess({ answering = () => false, bound = () => false, userDir = null } = {}) {
    const p = new ComfyProcess({
        rootPath: root, pythonExecutable: python, host: '127.0.0.1', port: 59999,
        userDir, managerOffline: false,
    });
    p.isApiResponsive = async () => answering();
    p.isPortBound = async () => bound();
    p._follow = () => {};
    p._watchPid = () => {};
    p._pollMs = 5;
    return p;
}

(async () => {
    try {
        await test('nothing there at all → one ComfyUI is launched', async () => {
            reset();
            const p = makeProcess();
            const r = await p.start();
            assert.deepStrictEqual(r, { external: false });
            assert.strictEqual(launches.length, 1);
            assert.ok(p.owned);
        });

        await test('our own ComfyUI still booting → no second launch', async () => {
            reset();
            const p = makeProcess();
            await p.start();                       // launch A
            const r = await p.start();             // a retry while A boots
            assert.deepStrictEqual(r, { external: false });
            assert.strictEqual(launches.length, 1, 'only A was ever launched');
            assert.deepStrictEqual(kills, []);
            assert.strictEqual(p.pid, 5000);
        });

        await test('our own ComfyUI silent for longer than the boot patience → replaced, and says why', async () => {
            reset();
            const p = makeProcess();
            await p.start();
            p._ownedSince = Date.now() - 11 * 60 * 1000;
            const r = await p.start();
            assert.deepStrictEqual(r, { external: false });
            assert.deepStrictEqual(kills, [5000]);
            assert.deepStrictEqual(launches, ['start', 'the previous start never answered']);
            assert.strictEqual(p.pid, 5001);
        });

        await test('ComfyQ restarted while its ComfyUI was booting → waits for it and adopts it', async () => {
            reset();
            alive.add(4242);
            registry['59999'] = { pid: 4242, userDir: null, startedAt: new Date(Date.now() - 20 * 1000).toISOString() };
            let polls = 0;
            const p = makeProcess({ answering: () => ++polls > 3 });
            listening = [4242];
            const r = await p.start();
            assert.deepStrictEqual(r, { external: false, adopted: true });
            assert.strictEqual(launches.length, 0, 'no competitor launched');
            assert.strictEqual(p.pid, 4242);
        });

        await test('a recorded start that died while we waited → a fresh launch', async () => {
            reset();
            alive.add(4242);
            registry['59999'] = { pid: 4242, userDir: null, startedAt: new Date().toISOString() };
            let polls = 0;
            const p = makeProcess({ answering: () => { if (++polls === 2) alive.delete(4242); return false; } });
            await p.start();
            assert.strictEqual(launches.length, 1);
        });

        await test('an old record is not waited for (its PID may be another program now) — and nothing is killed', async () => {
            reset();
            alive.add(4242);
            registry['59999'] = { pid: 4242, userDir: null, startedAt: new Date(Date.now() - 3 * 3600e3).toISOString() };
            const p = makeProcess();
            await p.start();
            assert.strictEqual(launches.length, 1);
            assert.deepStrictEqual(kills, []);
        });

        await test('a record for another lane\'s user directory is not ours to wait for', async () => {
            reset();
            alive.add(4242);
            registry['59999'] = { pid: 4242, userDir: path.join(tmp, 'laneB', 'user'), startedAt: new Date().toISOString() };
            const p = makeProcess({ userDir: path.join(tmp, 'laneA', 'user') });
            await p.start();
            assert.strictEqual(launches.length, 1);
            assert.deepStrictEqual(kills, []);
        });
        // ★ An owned ComfyUI that holds the port but is slow to answer (a
        // lane's retry after waitForApi gave up) used to fall into the wait for
        // a PREVIOUS ComfyQ's boot: a false "a previous ComfyQ started" line,
        // up to 10 min of patience instead of the 90 s port wait, and a false
        // 'adopt' in the restart history once it answered.
        await test('our own ComfyUI holds the port but is slow to answer → the port wait, no false adoption', async () => {
            reset();
            let bound = false;
            let answers = false;
            const p = makeProcess({ answering: () => answers, bound: () => bound });
            await p.start();                       // launch A
            bound = true;
            listening = [5000];
            let waitedForPrevious = false;
            const orig = p._waitForRecordedBoot.bind(p);
            p._waitForRecordedBoot = async () => { waitedForPrevious = true; return orig(); };
            const origPoll = p.isApiResponsive;
            let calls = 0;
            p.isApiResponsive = async () => { if (++calls > 1) answers = true; return origPoll(); };
            const r = await p.start();
            assert.strictEqual(waitedForPrevious, false, "not taken for a previous ComfyQ's boot");
            assert.deepStrictEqual(r, { external: false, adopted: true });
            assert.strictEqual(launches.length, 1, 'no second launch');
            assert.strictEqual(p.pid, 5000);
            assert.ok(!events.includes('adopt'), 'no adopt event for a ComfyUI already ours');
        });
    } finally {
        Object.assign(launcher, real);
        fs.rmSync(tmp, { recursive: true, force: true });
    }

    if (fails) { console.error(`\n${fails} failing`); process.exit(1); }
    console.log('\ncomfyProcess: all passed');
})();
