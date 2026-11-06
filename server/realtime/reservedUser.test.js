// The "examples" user is reserved. (node server/realtime/reservedUser.test.js)
//
// The library's showcase jobs belong to the user "examples". A job's owner is
// just the name a student types, and an owner may delete or cancel their jobs
// without the admin password — deleting also unlinks the sweep result files
// the examples point to. So the socket handlers must refuse that name, both as
// a registered name and as a booking's user_id; then acting on an example can
// only go through the admin password. The real handlers are driven on a fake
// bus and fake sockets, as authGate.test.js does for the access gate.
'use strict';
const EventEmitter = require('events');
const { RealtimeBus, isReservedUserId } = require('./realtimeBus');

let fails = 0, passes = 0;
const check = (name, cond, extra = '') => {
    if (cond) { passes++; console.log('  ok   ' + name); }
    else { fails++; console.error('  FAIL ' + name + (extra ? '  ' + extra : '')); }
};

const config = {
    auth: { adminPasswordHash: '', accessPasswordHash: '' },
    workflows: { activeWorkflowId: 'wf' },
};
check('"storyboard" is reserved too, in any case', isReservedUserId('Storyboard') && isReservedUserId(' storyboard '));
check('an ordinary name is not', !isReservedUserId('storyboarder'));
const exampleJob = { id: 'ex1', userId: 'examples', status: 'completed', outputs: [] };
const inserted = [];
let unlinkedFor = null;
const bus = {
    connectedUsers: new Map(),
    configManager: { load: () => ({ config }) },
    // Any booking that gets past the name check stops here, with a reason of its own.
    registry: { get: () => ({ unavailable: true, reason: 'not on this rig' }) },
    queue: {
        get: (id) => (id === exampleJob.id ? exampleJob : null),
        insert: (j) => { inserted.push(j); return { id: 'new' }; },
        neededBy: () => [],
        delete: () => {},
    },
    lanes: null,
    _bumpActivity() {}, _emitFull() {}, broadcast() {},
    _deleteOutputFiles(job) { unlinkedFor = job.id; },
    _executorFor() { return { cancelJob: async () => true }; },
    io: new EventEmitter(),
};
RealtimeBus.prototype._wireEvents.call(bus);

const connect = (id) => {
    const sock = new EventEmitter();
    sock.id = id;
    sock.sent = [];
    const emitLocal = sock.emit.bind(sock);
    sock.emit = (ev, data) => { sock.sent.push({ ev, data }); };
    sock.fire = (ev, ...args) => emitLocal(ev, ...args);
    bus.io.emit('connection', sock);
    return sock;
};
const userOf = (sock) => bus.connectedUsers.get(sock.id)?.userId;

console.log('\nthe name');
check('"examples" is reserved, whatever its case or spaces',
    isReservedUserId('examples') && isReservedUserId(' Examples ') && isReservedUserId('EXAMPLES'));
check('other names are not', !isReservedUserId('ana') && !isReservedUserId('example') && !isReservedUserId('') && !isReservedUserId(null));

console.log('\nregistering');
const a = connect('aaaa1111');
a.fire('register_user', 'examples');
check('registering as "examples" is refused, with a reason the client can show',
    // SocketContext reads `message`; `reason` is kept for any other reader.
    a.sent.some(m => m.ev === 'register_refused' && /reserved/.test(m.data?.message || '') && m.data?.reason === m.data?.message),
    JSON.stringify(a.sent));
check('...and the socket keeps its guest name', userOf(a) === 'Guest-aaaa', userOf(a));
a.fire('register_user', '  Examples ');
check('the same with other case and spaces', userOf(a) === 'Guest-aaaa', userOf(a));
a.fire('register_user', 'ana');
check('an ordinary name is taken', userOf(a) === 'ana', userOf(a));
a.fire('register_user', 'examples');
check('a socket that already has a name keeps it when it asks for "examples"', userOf(a) === 'ana', userOf(a));

console.log('\nbooking');
let ack = null;
a.fire('book_job', { user_id: 'examples', prompt: 'x' }, (r) => { ack = r; });
check('a booking for user "examples" is refused, in the ack', ack && ack.ok === false && /reserved/.test(ack.error || ''), JSON.stringify(ack));
check('...and nothing is queued', inserted.length === 0);
ack = null;
a.fire('book_job', { user_id: 'Examples', prompt: 'x' }, (r) => { ack = r; });
check('the same with other case', ack && ack.ok === false && /reserved/.test(ack.error || ''), JSON.stringify(ack));
ack = null;
a.fire('book_job', { user_id: 'ana', prompt: 'x' }, (r) => { ack = r; });
check('an ordinary booking passes the name check (and stops later, for its own reason)',
    ack && ack.ok === false && /not on this rig/.test(ack.error || ''), JSON.stringify(ack));

console.log('\nacting on an example');
const b = connect('bbbb2222');
b.fire('register_user', 'examples');
b.fire('delete_job', { jobId: exampleJob.id });
check('a socket that asked for the name cannot delete an example without the admin password',
    unlinkedFor === null && b.sent.some(m => m.ev === 'error' && /admin password/.test(m.data?.message || '')),
    JSON.stringify(b.sent));

if (fails) { console.error(`\nreservedUser: ${fails} FAILED, ${passes} passed`); process.exitCode = 1; }
else console.log(`\nreservedUser: all ${passes} checks passed`);
