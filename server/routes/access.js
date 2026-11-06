const os = require('os');
const express = require('express');
const {
    isAccessLocked, loginWithAccessPassword, verifyAccessToken, tokenFromRequest
} = require('../auth/authGate');

// Access router — the pre-connection handshake for the student client.
//
// Mounted in BOTH modes and deliberately ungated: it's how a client discovers
// whether this machine needs a password at all. It reveals whether a password
// is needed, a yes/no on a token or password the caller already holds, and the
// machine's name — which the federation beacon and GET /federation/self already
// tell anyone on the LAN, so the gate can say which rig is asking.
function makeRouter({ configManager }) {
    const router = express.Router();

    // Does this machine require a password, and is the token I already hold
    // still good? The client calls this on boot to decide whether to show the
    // access gate (and to skip it when a stored token is still valid).
    router.get('/status', (req, res) => {
        const locked = isAccessLocked(configManager);
        const valid = locked ? verifyAccessToken(tokenFromRequest(req), configManager) : true;
        // Same source as the scheduling page's header (realtimeBus `machine`).
        const name = configManager.load().config.instance?.name || os.hostname();
        res.json({ locked, valid, name });
    });

    // Exchange the password for a token the client stores and replays on the
    // socket handshake / uploads / job listing.
    router.post('/login', express.json(), (req, res) => {
        const { password } = req.body || {};
        const { ok, token } = loginWithAccessPassword(password, configManager);
        if (!ok) return res.status(401).json({ error: 'Wrong password' });
        res.json({ ok: true, token, locked: isAccessLocked(configManager) });
    });

    return router;
}

module.exports = { makeRouter };
