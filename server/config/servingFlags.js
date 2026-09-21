const fs = require('fs');
const path = require('path');

// Two markers decide what a ComfyQ machine does when it starts, both kept in
// the gitignored server/data/ next to the job queue.
//
//   .boot-student — ONE-SHOT. /activate-workflow drops it right before the
//                   restart it triggers, and boot consumes (deletes) it.
//
//   .serving      — STANDING intent: "this machine is meant to be serving a
//                   class." Boot reads it WITHOUT consuming it, so a restart
//                   nobody asked for — a crash, nodemon, a power cut, a
//                   Windows update — brings the machine back serving instead
//                   of silently landing in admin mode while every student tab
//                   keeps reconnecting to a server that no longer schedules.
//                   Cleared by the deliberate stops (reset-to-admin,
//                   emergency-stop) and by a student boot that failed, so a
//                   machine that CANNOT serve settles in admin rather than
//                   restarting into the same failure forever.
//
// ★ Both live under server/data/, which travels inside a cloned drive image
//   (as the sqlite queue does): a rig imaged from a serving machine boots
//   serving that workflow. Delete server/data/.serving on the master image if
//   that is not wanted.

const DATA_DIR = path.join(__dirname, '..', 'data');
const STUDENT_BOOT_FLAG = path.join(DATA_DIR, '.boot-student');
const SERVING_INTENT_FLAG = path.join(DATA_DIR, '.serving');

function _write(file) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '');
}

function _remove(file) {
    if (fs.existsSync(file)) fs.unlinkSync(file);
}

function markNextBootStudent(file = STUDENT_BOOT_FLAG) {
    try { _write(file); }
    catch (e) { console.warn('[ComfyQ] could not write student-boot flag:', e.message); }
}

/** True exactly once after markNextBootStudent(); deletes the flag. */
function consumeStudentBootFlag(file = STUDENT_BOOT_FLAG) {
    try {
        if (fs.existsSync(file)) { fs.unlinkSync(file); return true; }
    } catch (e) {
        console.warn('[ComfyQ] could not clear student-boot flag:', e.message);
    }
    return false;
}

function setServingIntent(on, file = SERVING_INTENT_FLAG) {
    try { if (on) _write(file); else _remove(file); }
    catch (e) { console.warn('[ComfyQ] could not update the serving flag:', e.message); }
}

function isServingIntended(file = SERVING_INTENT_FLAG) {
    try { return fs.existsSync(file); }
    catch { return false; }
}

/**
 * The mode this boot runs in. `oneShot` is the consumed .boot-student flag,
 * `intended` the standing .serving marker. Kept as a pure function so the
 * decision is testable without booting a server.
 */
function resolveBootMode(oneShot, intended) {
    return (oneShot || intended) ? 'student' : 'admin';
}

module.exports = {
    STUDENT_BOOT_FLAG,
    SERVING_INTENT_FLAG,
    markNextBootStudent,
    consumeStudentBootFlag,
    setServingIntent,
    isServingIntended,
    resolveBootMode,
};
