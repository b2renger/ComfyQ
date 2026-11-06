// The two passwords: the admin password that gates destructive actions, and the
// student access password that decides who may use a machine at all.
// (node server/auth/authGate.test.js)
//
// The access gate was verified once, by hand, when it was written; nothing in
// the repository checked it after that. These are the promises it makes: an
// open machine stays open, a locked one refuses without the token, changing or
// clearing the password kills every token already handed out, the admin can
// always get through, and a socket is held to the same rule as a request.

const {
    adminGate, checkAdminPassword, isAuthorizedForJob, setAccessPassword, isAccessLocked,
    loginWithAccessPassword, verifyAccessToken, tokenFromRequest, accessGate, setAdminPassword,
} = require('./authGate');
const { RealtimeBus } = require('../realtime/realtimeBus');

let fails = 0, passes = 0;
const check = (name, cond, extra = '') => {
    if (cond) { passes++; console.log('  ok   ' + name); }
    else { fails++; console.error('  FAIL ' + name + (extra ? '  ' + extra : '')); }
};

let config = { auth: { adminPasswordHash: '', accessPasswordHash: '' } };
const configManager = {
    load: () => ({ config }),
    update: (fn) => { config = fn(JSON.parse(JSON.stringify(config))) || config; return config; },
};

// Run an express-style middleware once; returns 'next' or the status it sent.
function run(mw, req) {
    let out = null;
    const res = { status: (s) => ({ json: () => { out = s; } }) };
    mw({ headers: {}, query: {}, ...req }, res, () => { out = 'next'; });
    return out;
}

console.log('\nadmin password');
const gate = adminGate(configManager);
check('no admin password set: the gate lets everything through', run(gate, {}) === 'next');
check('no admin password set: checkAdminPassword passes', checkAdminPassword('', configManager) === true);
setAdminPassword('teacher', configManager);
check('set: no header is refused', run(gate, {}) === 401);
check('set: a wrong password is refused', run(gate, { headers: { 'x-admin-password': 'nope' } }) === 401);
check('set: the right password passes', run(gate, { headers: { 'x-admin-password': 'teacher' } }) === 'next');

console.log('\nacting on a job');
const job = { userId: 'ana' };
check('your own job is always yours', isAuthorizedForJob({ socketUserId: 'ana', job, configManager }).allowed === true);
check('someone else\'s job needs the password', isAuthorizedForJob({ socketUserId: 'bo', job, configManager }).allowed === false);
check('a wrong password is refused', isAuthorizedForJob({ socketUserId: 'bo', providedPassword: 'nope', job, configManager }).allowed === false);
const asAdmin = isAuthorizedForJob({ socketUserId: 'bo', providedPassword: 'teacher', job, configManager });
check('the right password is allowed, as admin', asAdmin.allowed === true && asAdmin.asAdmin === true);
setAdminPassword('', configManager);
check('with NO admin password, a cross-user action is refused (no silent "everyone is admin")',
    isAuthorizedForJob({ socketUserId: 'bo', providedPassword: 'anything', job, configManager }).allowed === false);

console.log('\naccess password');
const access = accessGate(configManager);
check('an open machine is not locked', isAccessLocked(configManager) === false);
check('an open machine lets a request through', run(access, {}) === 'next');
check('an open machine accepts any token', verifyAccessToken('', configManager) === true);
check('logging in to an open machine gives an empty token', loginWithAccessPassword('', configManager).ok === true);

setAdminPassword('teacher', configManager);
setAccessPassword('class-a', configManager);
check('a locked machine says so', isAccessLocked(configManager) === true);
check('locked: no token is refused', run(access, {}) === 401);
check('locked: a made-up token is refused', run(access, { headers: { 'x-access-token': 'f'.repeat(64) } }) === 401);
check('locked: a wrong password gives no token', loginWithAccessPassword('class-b', configManager).ok === false);
const login = loginWithAccessPassword('class-a', configManager);
check('locked: the right password gives a token', login.ok === true && /^[0-9a-f]{64}$/.test(login.token));
check('the token passes in the X-Access-Token header', run(access, { headers: { 'x-access-token': login.token } }) === 'next');
check('the token passes as ?access_token= (an <a href> download cannot set headers)',
    run(access, { query: { access_token: login.token } }) === 'next');
check('tokenFromRequest prefers the header', tokenFromRequest({ headers: { 'x-access-token': 'h' }, query: { access_token: 'q' } }) === 'h');
check('the admin password gets through a locked machine', run(access, { headers: { 'x-admin-password': 'teacher' } }) === 'next');
check('a wrong admin password does not', run(access, { headers: { 'x-admin-password': 'nope' } }) === 401);

setAccessPassword('class-b', configManager);
check('changing the password kills the old token', verifyAccessToken(login.token, configManager) === false);
check('… so the old token is refused at the gate', run(access, { headers: { 'x-access-token': login.token } }) === 401);
const login2 = loginWithAccessPassword('class-b', configManager);
check('the new password gives a new token that works', login2.token !== login.token && verifyAccessToken(login2.token, configManager));
setAccessPassword('', configManager);
check('clearing it reopens the machine', isAccessLocked(configManager) === false && run(access, {}) === 'next');
setAccessPassword('class-b', configManager);
check('setting the same password again issues a different token (a new salt)', verifyAccessToken(login2.token, configManager) === false);

console.log('\nthe socket handshake follows the same rule');
let handshake = null;
const fakeBus = { configManager, io: { use: (fn) => { handshake = fn; } } };
RealtimeBus.prototype._wireAccessGate.call(fakeBus);
const shake = (auth) => {
    let err = 'unset';
    const socket = { handshake: { auth, query: {} }, data: {} };
    handshake(socket, (e) => { err = e || null; });
    return { err, socket };
};
let s = shake({});
check('a socket with no token is refused, marked accessRequired', s.err && s.err.data && s.err.data.accessRequired === true);
const tok = loginWithAccessPassword('class-b', configManager).token;
s = shake({ accessToken: tok });
check('a socket with the token connects, and keeps it for later checks', s.err === null && s.socket.data.accessToken === tok);

const kicked = [];
const mkSock = (id, token) => ({
    id, data: { accessToken: token },
    emit: (ev) => kicked.push(`${id}:${ev}`), disconnect: () => kicked.push(`${id}:gone`),
});
const live = new Map([['a', mkSock('a', tok)], ['b', mkSock('b', 'stale')]]);
const busWithSockets = { configManager, io: { sockets: { sockets: live } } };
let dropped = RealtimeBus.prototype.enforceAccess.call(busWithSockets);
check('a password change disconnects only the sockets without a valid token',
    dropped === 1 && kicked.includes('b:access_revoked') && kicked.includes('b:gone') && !kicked.some(k => k.startsWith('a:')), JSON.stringify(kicked));
setAccessPassword('class-c', configManager);
dropped = RealtimeBus.prototype.enforceAccess.call(busWithSockets);
check('after another change the remaining socket goes too', kicked.includes('a:gone'), `${dropped} ${JSON.stringify(kicked)}`);

console.log('\nGET /access/status names the machine, so the gate can say which rig asks');
{
    const router = require('../routes/access').makeRouter({ configManager });
    const status = (cfgInstance) => {
        config = { ...config, instance: cfgInstance };
        const layer = router.stack.find(l => l.route?.path === '/status');
        let body = null;
        layer.route.stack[0].handle({ headers: {}, query: {} }, { json: (b) => { body = b; } });
        return body;
    };
    let b = status({ name: 'Rig 3' });
    check('the configured instance name', b?.name === 'Rig 3' && typeof b.locked === 'boolean', JSON.stringify(b));
    b = status(undefined);
    check('the hostname when no name is configured', b?.name === require('os').hostname(), JSON.stringify(b));
}

if (fails) { console.error(`\nauthGate: ${fails} FAILED, ${passes} passed`); process.exitCode = 1; }
else console.log(`\nauthGate: all ${passes} checks passed`);
