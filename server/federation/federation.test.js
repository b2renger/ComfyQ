// The LAN status beacon and the snapshot it carries.
// (node server/federation/federation.test.js)
//
//   * A config.json that fails the schema must not kill the server from the
//     beacon's timer. load() throws on such a file; the beacon calls it every
//     few seconds, and an uncaught throw on a timer exits Node -- which nodemon
//     does not restart for a change to config.json.
//   * With several lanes, every in-flight job is reported and each job says
//     which model it belongs to, so a monitor can put it on the right card.

const { StatusBeacon } = require('./beacon');
const { buildSnapshot } = require('./statusSnapshot');

let fails = 0, passes = 0;
const check = (name, cond, extra = '') => {
    if (cond) { passes++; console.log('  ok   ' + name); }
    else { fails++; console.error('  FAIL ' + name + (extra ? '  ' + extra : '')); }
};

console.log('\nthe beacon and a bad config.json');
let broken = true;
const sent = [];
const configManager = {
    load: () => {
        if (broken) throw new Error('Invalid config.json — fix or delete it and restart.');
        return { config: { mode: 'student', federation: { enabled: true }, auth: {}, workflows: {}, comfy_ui: {} } };
    },
};
const beacon = new StatusBeacon({ configManager, registry: { get: () => null }, runtime: {}, sysInfo: { id: 'x' } });
beacon.socket = { send: (buf) => sent.push(buf) };
beacon.group = '239.255.42.99';
beacon.port = 41999;
const warn = console.warn;
const warnings = [];
console.warn = (...a) => warnings.push(a.join(' '));
let threw = null;
try { beacon._send(); beacon._send(); } catch (e) { threw = e; }
console.warn = warn;
check('a schema failure does not throw out of the timer', threw === null, String(threw));
check('no beacon is sent while the file is bad', sent.length === 0, String(sent.length));
check('it says so once, not every tick', warnings.length === 1, JSON.stringify(warnings));
broken = false;
beacon._send();
check('once the file is fixed, beacons resume by themselves', sent.length > 0, String(sent.length));

console.log('\nthe snapshot with two lanes');
const jobs = [
    { id: 'j1', userId: 'ana', workflowId: 'wf_a', status: 'executing', prompt: 'a', scheduledAt: 1, startedAt: 2 },
    { id: 'j2', userId: 'bo', workflowId: 'wf_b', status: 'executing', prompt: 'b', scheduledAt: 3, startedAt: 4 },
    { id: 'j3', userId: 'cy', workflowId: 'wf_b', status: 'scheduled', prompt: 'c', scheduledAt: 5 },
];
const snap = buildSnapshot({
    configManager: { load: () => ({ config: { mode: 'student', federation: {}, auth: {}, workflows: {}, comfy_ui: {}, server: {} } }) },
    registry: { get: () => null },
    runtime: { queue: { list: () => jobs, listActive: () => jobs } },
    sysInfo: {},
});
check('every in-flight job is listed', snap.jobs.runningAll.map(j => j.id).join() === 'j1,j2', JSON.stringify(snap.jobs.runningAll));
check('`running` is still the first one, for older Discovery builds', snap.jobs.running && snap.jobs.running.id === 'j1');
check('each job names its workflow', snap.jobs.runningAll.every(j => j.workflowId) && snap.jobs.scheduled[0].workflowId === 'wf_b');
console.log('\none lane with a long queue beside another');
// 40 waiting on wf_a (scheduled first), then 3 on wf_b. A machine-wide cap of
// 25 listed only wf_a's, and wf_b's card read "Nothing queued".
const long = [];
for (let i = 0; i < 40; i++) long.push({ id: 'a' + i, userId: 'u', workflowId: 'wf_a', status: 'scheduled', prompt: 'p', scheduledAt: i });
for (let i = 0; i < 3; i++) long.push({ id: 'b' + i, userId: 'u', workflowId: 'wf_b', status: 'scheduled', prompt: 'p', scheduledAt: 100 + i });
const busy = buildSnapshot({
    configManager: { load: () => ({ config: { mode: 'student', federation: {}, auth: {}, workflows: {}, comfy_ui: {}, server: {} } }) },
    registry: { get: () => null },
    runtime: { queue: { list: () => long, listActive: () => long } },
    sysInfo: {},
});
const countOf = (wf) => busy.jobs.scheduled.filter(j => j.workflowId === wf).length;
check('the other lane\'s waiting jobs are still listed', countOf('wf_b') === 3, String(countOf('wf_b')));
check('the long lane is capped at 25', countOf('wf_a') === 25, String(countOf('wf_a')));
const many = [];
for (let w = 0; w < 5; w++) for (let i = 0; i < 30; i++) many.push({ id: `w${w}_${i}`, userId: 'u', workflowId: 'wf_' + w, status: 'scheduled', prompt: 'p', scheduledAt: w * 100 + i });
const crowded = buildSnapshot({
    configManager: { load: () => ({ config: { mode: 'student', federation: {}, auth: {}, workflows: {}, comfy_ui: {}, server: {} } }) },
    registry: { get: () => null },
    runtime: { queue: { list: () => many, listActive: () => many } },
    sysInfo: {},
});
check('the whole list stays bounded (60) so the datagram stays small', crowded.jobs.scheduled.length === 60, String(crowded.jobs.scheduled.length));
// Filled in queue order, the first three lanes took all 60 places and the
// fourth and fifth cards read "Nothing queued".
const perLane = [0, 1, 2, 3, 4].map(w => crowded.jobs.scheduled.filter(j => j.workflowId === 'wf_' + w).length);
check('every busy lane keeps a share of the 60 (12 each)', perLane.every(n => n === 12), JSON.stringify(perLane));
const times = crowded.jobs.scheduled.map(j => j.scheduledAt);
check('the list is still in time order, for older Discovery builds', times.every((t, i) => i === 0 || times[i - 1] <= t), JSON.stringify(times));
check('each lane keeps its EARLIEST waiting jobs', crowded.jobs.scheduled.filter(j => j.workflowId === 'wf_4').map(j => j.id).join() === Array.from({ length: 12 }, (_, i) => 'w4_' + i).join());

const idle = buildSnapshot({
    configManager: { load: () => ({ config: { mode: 'admin', federation: {}, auth: {}, workflows: {}, comfy_ui: {}, server: {} } }) },
    registry: { get: () => null }, runtime: {}, sysInfo: {},
});
check('a machine with no queue reports an empty list, not undefined', Array.isArray(idle.jobs.runningAll) && idle.jobs.runningAll.length === 0);

if (fails) { console.error(`\nfederation: ${fails} FAILED, ${passes} passed`); process.exitCode = 1; }
else console.log(`\nfederation: all ${passes} checks passed`);
