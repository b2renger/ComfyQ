const express = require('express');
const {
    isAccessLocked, loginWithAccessPassword, verifyAccessToken, tokenFromRequest
} = require('../auth/authGate');

// Access router — the pre-connection handshake for the student client.
//
// Mounted in BOTH modes and deliberately ungated: it's how a client discovers
// whether this machine needs a password at all. Everything it can reveal is a
// single boolean plus a yes/no on a password the caller already typed.
function makeRouter({ configManager }) {
    const router = express.Router();

    // Does this machine require a password, and is the token I already hold
    // still good? The client calls this on boot to decide whether to show the
    // access gate (and to skip it when a stored token is still valid).
    router.get('/status', (req, res) => {
        const locked = isAccessLocked(configManager);
        const valid = locked ? verifyAccessToken(tokenFromRequest(req), configManager) : true;
        res.json({ locked, valid });
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
