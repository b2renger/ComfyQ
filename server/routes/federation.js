// Federation (Phase F) — read-only HTTP surface.
//
// GET /federation/self returns the same snapshot the UDP beacon multicasts, so
// the fleet monitor (or a future web panel) can pull a machine's status on
// demand / verify a beacon. Mounted in both admin and student mode.

const express = require('express');
const { buildSnapshot } = require('../federation/statusSnapshot');

function makeRouter({ configManager, registry, runtime, getSysInfo }) {
    const router = express.Router();

    router.get('/self', (req, res) => {
        try {
            const snap = buildSnapshot({
                configManager,
                registry,
                runtime,
                sysInfo: getSysInfo ? getSysInfo() : null
            });
            res.json(snap);
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    return router;
}

module.exports = { makeRouter };
