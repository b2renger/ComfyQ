const bcrypt = require('bcryptjs');
const crypto = require('crypto');

// AuthGate — verifies the admin password for destructive routes / socket
// actions. Classroom trust model: a single admin password gates cross-user
// actions. If `adminPasswordHash` is empty, gating is disabled (everyone
// is admin — useful for solo dev).

function setAdminPassword(plaintext, configManager) {
    if (!plaintext) {
        configManager.update(c => { c.auth.adminPasswordHash = ''; return c; });
        return;
    }
    const hash = bcrypt.hashSync(plaintext, 10);
    configManager.update(c => { c.auth.adminPasswordHash = hash; return c; });
}

function checkAdminPassword(plaintext, configManager) {
    const { config } = configManager.load();
    const hash = config.auth.adminPasswordHash || '';
    if (!hash) return true; // gating disabled
    if (!plaintext) return false;
    return bcrypt.compareSync(plaintext, hash);
}

function adminGate(configManager) {
    return (req, res, next) => {
        const { config } = configManager.load();
        const hash = config.auth.adminPasswordHash || '';
        if (!hash) return next(); // gating disabled
        const provided = req.headers['x-admin-password'];
        if (!provided || !bcrypt.compareSync(provided, hash)) {
            return res.status(401).json({ error: 'admin password required' });
        }
        next();
    };
}

// Helper for socket events: returns { allowed, reason }.
// Acting on your OWN job is always allowed. Foreign actions REQUIRE an admin
// password — and if no password is configured the foreign action is refused
// (no silent "everyone is admin" mode for cross-user deletes).
function isAuthorizedForJob({ socketUserId, providedPassword, job, configManager }) {
    if (job.userId === socketUserId) return { allowed: true };
    const { config } = configManager.load();
    const hash = config.auth.adminPasswordHash || '';
    if (!hash) return { allowed: false, reason: 'admin password not set — cross-user actions are disabled' };
    if (!providedPassword) return { allowed: false, reason: 'admin password required for this action' };
    if (!bcrypt.compareSync(providedPassword, hash)) return { allowed: false, reason: 'wrong admin password' };
    return { allowed: true, asAdmin: true };
}

// ---------------------------------------------------------------------------
// Access password — "who may use this machine at all"
// ---------------------------------------------------------------------------
// Independent from the admin password. Use case: an admin serves a workflow on
// a rig but wants it reserved for one group of students, so they set an access
// password; the client asks for it before connecting. Empty hash = open access
// (the default, and byte-for-byte the old behavior).
//
// Clients never store the plaintext. On a correct password the server hands
// back a TOKEN derived deterministically from the stored bcrypt hash, so:
//   * verifying a token is a cheap sha256 compare (bcrypt at cost 10 is ~100ms,
//     far too slow for a socket handshake + every upload),
//   * tokens survive a server restart (no session table to rebuild),
//   * changing or clearing the password rotates the hash, which invalidates
//     every token already handed out.

function setAccessPassword(plaintext, configManager) {
    if (!plaintext) {
        configManager.update(c => { c.auth.accessPasswordHash = ''; return c; });
        return;
    }
    const hash = bcrypt.hashSync(plaintext, 10);
    configManager.update(c => { c.auth.accessPasswordHash = hash; return c; });
}

function accessHash(configManager) {
    const { config } = configManager.load();
    return config.auth?.accessPasswordHash || '';
}

// True when this machine requires a password before anyone can use it.
function isAccessLocked(configManager) {
    return !!accessHash(configManager);
}

function tokenFromHash(hash) {
    if (!hash) return '';
    return crypto.createHash('sha256').update(`comfyq-access-v1:${hash}`).digest('hex');
}

// Returns the access token for a correct password, or '' when the password is
// wrong. When no password is configured the machine is open: returns ''.
function loginWithAccessPassword(plaintext, configManager) {
    const hash = accessHash(configManager);
    if (!hash) return { ok: true, token: '' };            // open machine
    if (!plaintext || !bcrypt.compareSync(plaintext, hash)) return { ok: false, token: '' };
    return { ok: true, token: tokenFromHash(hash) };
}

function verifyAccessToken(token, configManager) {
    const hash = accessHash(configManager);
    if (!hash) return true;                               // open machine
    if (!token) return false;
    const expected = tokenFromHash(hash);
    const a = Buffer.from(String(token));
    const b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Accept the token from a header (normal fetch calls) or a query param — plain
// <a href> downloads (the job "ingredients" zip) can't set headers.
function tokenFromRequest(req) {
    return req.headers?.['x-access-token'] || req.query?.access_token || '';
}

// Express middleware for student-facing routes. Passes when the machine is
// open, when a valid access token is presented, or when the caller proves it
// is the admin (so the admin panel keeps working on a locked machine).
function accessGate(configManager) {
    return (req, res, next) => {
        if (!isAccessLocked(configManager)) return next();
        if (verifyAccessToken(tokenFromRequest(req), configManager)) return next();
        const adminPw = req.headers['x-admin-password'];
        if (adminPw && checkAdminPassword(adminPw, configManager)) return next();
        return res.status(401).json({ error: 'access password required', accessRequired: true });
    };
}

module.exports = {
    setAdminPassword, checkAdminPassword, adminGate, isAuthorizedForJob,
    setAccessPassword, isAccessLocked, loginWithAccessPassword, verifyAccessToken,
    tokenFromRequest, accessGate
};
