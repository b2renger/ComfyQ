// reorder_job answers its ack. (node server/realtime/reorderJob.test.js)
//
// The timeline moves a bar where it is dropped and sends reorder_job. When the
// server refuses the move (someone else's job, a past time, a collision), a
// client that passed an ack must hear it, so it can put the bar back — and must
// hear "ok" when the move was taken, or it could not tell the two apart and a
// timeout would undo good moves. A client with no ack keeps getting the
// 'error' event, as before. The real handler is driven on a fake bus and fake
// sockets, as reservedUser.test.js does.
'use strict';
const EventEmitter = require('events');
const { RealtimeBus } = require('./realtimeBus');

let fails = 0, passes = 0;
const check = (name, cond, extra = '') => {
    if (cond) { passes++; console.log('  ok   ' + name); }
    else { fails++; console.error('  FAIL ' + name + (extra ? '  ' + extra : '')); }
};

const config = {
    auth: { adminPasswordHash: '', accessPasswordHash: '' },
    workflows: { activeWorkflowId: 'wf' },
};
const HOUR = 3600 * 1000;
const jobs = {
    mine: { id: 'mine', userId: 'ana', workflowId: 'wf', status: 'scheduled', scheduledAt: Date.now() + HOUR },
    theirs: { id: 'theirs', userId: 'bo', workflowId: 'wf', status: 'scheduled', scheduledAt: Date.now() + 2 * HOUR },
    done: { id: 'done', userId: 'ana', workflowId: 'wf', status: 'completed', scheduledAt: Date.now() - HOUR },
};
let collideAt = null;
const moves = [];
const bus = {
    connectedUsers: new Map(),
    configManager: { load: () => ({ config }) },
    registry: { get: () => ({ summary: { estimatedDurationSec: 30 } }) },
    queue: {
        get: (id) => jobs[id] || null,
        findCollisions: (at) => (at === collideAt ? [{ id: 'other' }] : []),
        // The real queue refuses a job that is no longer waiting.
        reorder: (id, at) => {
            if (jobs[id].status !== 'scheduled') throw new Error(`Cannot move job in status "${jobs[id].status}"`);
            moves.push({ id, at });
        },
    },
    lanes: null,
    _bumpActivity() {}, _emitFull() {}, broadcast() {},
    io: new EventEmitter(),
};
RealtimeBus.prototype._wireEvents.call(bus);

const connect = (id, name) => {
    const sock = new EventEmitter();
    sock.id = id;
    sock.sent = [];
    const emitLocal = sock.emit.bind(sock);
    sock.emit = (ev, data) => { sock.sent.push({ ev, data }); };
    sock.fire = (ev, ...args) => emitLocal(ev, ...args);
    bus.io.emit('connection', sock);
    if (name) sock.fire('register_user', name);
    return sock;
};
const errorsOf = (sock) => sock.sent.filter(m => m.ev === 'error');
const reorder = (sock, payload) => {
    let answer;
    sock.fire('reorder_job', payload, (r) => { answer = r; });
    return answer;
};

const a = connect('aaaa1111', 'ana');
const later = Date.now() + 3 * HOUR;

console.log('\nwith an ack');
let r = reorder(a, { jobId: 'mine', newTimeSlot: later });
check('a move that is taken answers ok', r && r.ok === true, JSON.stringify(r));
check('...and the job is moved', moves.length === 1 && moves[0].id === 'mine' && moves[0].at === later, JSON.stringify(moves));

r = reorder(a, { jobId: 'theirs', newTimeSlot: later });
check("moving someone else's job is refused in the ack", r && r.ok === false && /admin password/.test(r.error || ''), JSON.stringify(r));

r = reorder(a, { jobId: 'mine', newTimeSlot: Date.now() - 1000 });
check('a time in the past is refused in the ack', r && r.ok === false && /future/.test(r.error || ''), JSON.stringify(r));

r = reorder(a, { jobId: 'mine', newTimeSlot: 'soon' });
check('a value that is not a time is refused in the ack', r && r.ok === false && /future/.test(r.error || ''), JSON.stringify(r));

collideAt = later + HOUR;
r = reorder(a, { jobId: 'mine', newTimeSlot: collideAt });
check('a collision is refused in the ack', r && r.ok === false && /collision/i.test(r.error || ''), JSON.stringify(r));

r = reorder(a, { jobId: 'gone', newTimeSlot: later });
check('a job that no longer exists is refused in the ack', r && r.ok === false && /no longer exists/.test(r.error || ''), JSON.stringify(r));

r = reorder(a, { jobId: 'done', newTimeSlot: later });
check('a job the queue will not move is refused in the ack', r && r.ok === false && /Cannot move/.test(r.error || ''), JSON.stringify(r));

check('only the one good move reached the queue', moves.length === 1, JSON.stringify(moves));
check('with an ack, no refusal is sent twice as an error event', errorsOf(a).length === 0, JSON.stringify(errorsOf(a)));

console.log('\nwithout an ack (an older client)');
const b = connect('bbbb2222', 'ana');
b.fire('reorder_job', { jobId: 'mine', newTimeSlot: collideAt });
check('a refusal still arrives as an error event', errorsOf(b).some(m => /collision/i.test(m.data?.message || '')), JSON.stringify(b.sent));
b.fire('reorder_job', { jobId: 'mine', newTimeSlot: later + 5 * HOUR });
check('a taken move still works and sends nothing back', moves.length === 2 && errorsOf(b).length === 1, JSON.stringify(b.sent));

if (fails) { console.error(`\nreorderJob: ${fails} FAILED, ${passes} passed`); process.exitCode = 1; }
else console.log(`\nreorderJob: all ${passes} checks passed`);
