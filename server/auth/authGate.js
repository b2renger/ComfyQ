const bcrypt = require('bcryptjs');

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

module.exports = { setAdminPassword, checkAdminPassword, adminGate, isAuthorizedForJob };
