// Boot-mode markers: does a machine come back serving after a restart nobody
// asked for, and does it stop when told to? (node server/config/servingFlags.test.js)
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
    markNextBootStudent, consumeStudentBootFlag,
    setServingIntent, isServingIntended, resolveBootMode,
} = require('./servingFlags');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'comfyq-flags-'));
const BOOT = path.join(dir, '.boot-student');
const SERVE = path.join(dir, '.serving');

// Replays a boot exactly as index.js does it.
const boot = () => {
    const oneShot = consumeStudentBootFlag(BOOT);
    const resume = !oneShot && isServingIntended(SERVE);
    return resolveBootMode(oneShot, resume);
};
// Replays exitForRestart(nextMode).
const restart = (nextMode) => {
    if (nextMode === 'student') { markNextBootStudent(BOOT); setServingIntent(true, SERVE); }
    else if (nextMode === 'admin') setServingIntent(false, SERVE);
};

const ok = [];
const check = (label, cond) => { assert.ok(cond, label); ok.push(label); };

// A machine nobody has activated stays out of the way.
check('a fresh machine boots in admin', boot() === 'admin');
check('...repeatedly', boot() === 'admin');

// Activating a workflow serves, and KEEPS serving across restarts nobody asked for.
restart('student');
check('after /activate-workflow the next boot serves', boot() === 'student');
check('the one-shot flag was consumed', !fs.existsSync(BOOT));
check('the standing serving intent remains', fs.existsSync(SERVE));
check('a crash / nodemon / power cut still comes back serving', boot() === 'student');
check('...and again', boot() === 'student');

// A neutral restart (POST /admin/restart-server) leaves it serving.
restart(undefined);
check('a plain server restart keeps the machine serving', boot() === 'student');

// Stopping on purpose stops it — and stays stopped.
restart('admin');
check('Reset to admin stops serving', boot() === 'admin');
check('...and the next boot too (no resurrection)', boot() === 'admin');
check('the serving marker is gone', !fs.existsSync(SERVE));

// A failed student boot clears the intent, so a machine that cannot serve
// settles in admin instead of restarting into the same failure forever.
restart('student');
check('serving again', boot() === 'student');
restart('admin');                      // what the boot-failure path does
check('a failed student boot does not loop', boot() === 'admin');

// The one-shot flag alone still works even with no standing intent (the path
// /activate-workflow uses on a machine that was in admin).
markNextBootStudent(BOOT);
check('the one-shot flag alone serves once', boot() === 'student');

fs.rmSync(dir, { recursive: true, force: true });
console.log(`servingFlags: all ${ok.length} checks passed`);
