// comfyLauncher — the process registry and the log follower, without starting
// ComfyUI. The real spawn → adopt → crash → stop cycle is covered by
// server/lanes/lanes.integration.js, which needs the portable install.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const L = require('./comfyLauncher');

let failed = 0;
const ok = (msg, cond) => { console.log(`${cond ? '  ok  ' : '  FAIL'} ${msg}`); if (!cond) failed++; };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'comfyq-launcher-'));
const reg = path.join(tmp, 'processes.json');

(async () => {
    ok('a missing registry reads as empty', JSON.stringify(L.readRegistry(reg)) === '{"procs":{},"history":[]}');
    fs.writeFileSync(reg, '{ not json');
    ok('a damaged registry reads as empty instead of throwing', Object.keys(L.readRegistry(reg).procs).length === 0);

    L.recordStart({ port: 8188, pid: process.pid, userDir: null, flags: { use_sage_attention: true }, reason: 'start' }, reg);
    L.recordStart({ port: 8189, pid: 4242, userDir: path.join(tmp, 'laneA', 'user'), flags: {}, reason: 'a new lane' }, reg);
    ok('a start is recorded by port', L.recordFor(8188, reg)?.pid === process.pid);
    ok('its flags are kept (so an adopted ComfyUI is described by what it runs with)', L.recordFor(8188, reg).flags.use_sage_attention === true);
    ok('a lane is found by its user directory, whatever the case or slashes',
        L.recordsForUserDir(path.join(tmp, 'LANEA', 'user').toUpperCase(), reg).map(r => r.port).join() === '8189');
    ok('the install\'s ComfyUI (no user dir) is not mistaken for a lane', L.recordsForUserDir(path.join(tmp, 'laneB', 'user'), reg).length === 0);

    L.recordEvent({ port: 8189, pid: 9999, event: 'stop' }, reg);
    ok('a stop for a DIFFERENT pid does not drop the record', !!L.recordFor(8189, reg));
    L.recordEvent({ port: 8189, pid: 4242, event: 'exit', reason: 'exited on its own' }, reg);
    ok('an exit for the recorded pid drops the record', !L.recordFor(8189, reg));
    ok('the history keeps every event in order', L.readRegistry(reg).history.map(h => h.event).join() === 'start,start,stop,exit');
    ok('recentStarts counts starts only', L.recentStarts(3600e3, reg).length === 2);
    ok('recentStarts honours the window', L.recentStarts(-1, reg).length === 0);

    const r = L.readRegistry(reg);
    for (let i = 0; i < 300; i++) r.history.push({ at: new Date().toISOString(), event: 'start', port: 1, pid: i });
    L.writeRegistry(r, reg);
    L.recordEvent({ port: 1, event: 'adopt' }, reg);
    ok('the history is capped', L.readRegistry(reg).history.length <= 200);

    ok('this process is alive', L.pidAlive(process.pid));
    ok('a pid that does not exist is not', !L.pidAlive(2147483646));
    ok('no pid is not alive', !L.pidAlive(null));
    ok('pidsOnPort answers [] for a port nothing listens on', (await L.pidsOnPort(1)).length === 0);

    // LogTail: new data, a truncation (a new ComfyUI on the same port), fromEnd.
    const log = path.join(tmp, 'x.out.log');
    fs.writeFileSync(log, 'boot line\n');
    const seen = [];
    const t = new L.LogTail(log, d => seen.push(String(d)), { intervalMs: 50 });
    await new Promise(res => setTimeout(res, 150));
    fs.appendFileSync(log, 'second\n');
    await new Promise(res => setTimeout(res, 150));
    ok('the tail delivers what was there and what was appended', seen.join('') === 'boot line\nsecond\n');
    fs.writeFileSync(log, 'new\n');
    await new Promise(res => setTimeout(res, 150));
    ok('a truncated file is read again from the start', seen.join('').endsWith('new\n'));
    t.stop();
    const late = [];
    const t2 = new L.LogTail(log, d => late.push(String(d)), { fromEnd: true, intervalMs: 50 });
    fs.appendFileSync(log, 'after\n');
    await new Promise(res => setTimeout(res, 150));
    t2.stop();
    ok('fromEnd skips what was already there (adopting does not replay a boot)', late.join('') === 'after\n');

    fs.rmSync(tmp, { recursive: true, force: true });
    console.log(failed ? `comfyLauncher: ${failed} FAILED` : 'comfyLauncher: all checks passed');
    process.exit(failed ? 1 : 0);
})();
