// The Maintenance tab's script runner: Stop is a cancel, not a failure, and a
// stopped run never carries on inside the next one.
// (node server/maintenance/scriptRunner.test.js)
//
// ★ Two things went wrong before this test existed. Pressing Stop killed the
// child, the child exited non-zero, and the run then reported itself as
// "failed — rescan.py exited with code 1", a cause that was never true. And a
// run stopped during its object-info fetch (no child to kill yet) checked the
// SHARED run slot when the fetch came back — which by then held the next task,
// status 'running' — so it went on to rescan and rebuild model-audit.csv inside
// a task the admin had started for something else.
//
// Python and the fetch are stubbed: what is under test is the runner's own
// bookkeeping, and it needs neither ComfyUI nor an interpreter.
const assert = require('assert');

const { ScriptRunner, TASKS } = require('./scriptRunner');

const ok = [];
const check = (label, cond) => { assert.ok(cond, label); ok.push(label); };

/** A promise the test resolves by hand. */
function deferred() {
    let resolve;
    const promise = new Promise(r => { resolve = r; });
    return { promise, resolve };
}

function runner() {
    const r = new ScriptRunner({ config: () => ({}) });
    r._python = () => 'python';
    r.calls = [];
    return r;
}

const tick = () => new Promise(r => setTimeout(r, 10));

(async () => {
    // 1. the whitelist
    const r0 = runner();
    check('an unknown task is refused', (await r0.start('rm -rf /')).ok === false);
    const portable = TASKS.find(t => t.key === 'portablize-paths');
    // The card used to promise a drive-letter repair the script never does.
    check('the TRELLIS2 path task says what it really touches',
        /TRELLIS2/.test(portable.label) && !/drive letter so it survives/i.test(portable.blurb));

    // 2. ★ Stop during a python step leaves the run CANCELLED, with no invented cause
    const r1 = runner();
    r1._python_step = (py, script) => new Promise((resolve) => {
        r1.calls.push(script);
        // Killing the child makes it exit non-zero, the way a real kill does.
        r1._child = { kill: () => resolve(1) };
    });
    await r1.start('audit-verify');
    await tick();
    check('the task is running', r1.status().status === 'running');
    check('Stop is accepted', r1.stop().ok === true);
    await tick();
    check('★ a stopped run reads as cancelled, not failed', r1.status().status === 'cancelled');
    check('...and carries no made-up exit-code error', r1.status().error === null);

    // 3. ★ a run stopped mid-fetch does not continue inside the next task
    const r2 = runner();
    const fetchGate = deferred();
    const verifyGate = deferred();
    r2._fetchObjectInfo = (writes, run) => fetchGate.promise;
    r2._python_step = (py, script, run) => {
        r2.calls.push(script);
        if (run) run.output.push(`ran ${script}`);
        return script === 'model-audit/verify_audit.py' ? verifyGate.promise : Promise.resolve(0);
    };
    await r2.start('audit-rebuild');
    await tick();
    check('the rebuild is fetching the node list', r2.status().step === 'object-info');
    r2.stop();                       // no child yet: only the flag changes
    check('a new task may start once the old one is stopped', (await r2.start('audit-verify')).ok === true);
    fetchGate.resolve();             // the old fetch finally comes back
    await tick();
    check('★ the stopped rebuild does not go on to rescan',
        !r2.calls.some(s => /rescan|build_csv|scan_links/.test(s)));
    verifyGate.resolve(0);
    await tick();
    const st = r2.status();
    check('the new task finishes as itself', st.key === 'audit-verify' && st.status === 'done');
    check('...with only its own output', st.output.every(l => !/rescan|build_csv/.test(l)));

    // 4. a real failure is still a failure
    const r3 = runner();
    r3._python_step = () => Promise.resolve(2);
    await r3.start('audit-verify');
    await tick();
    check('a step that exits non-zero on its own is reported as failed',
        r3.status().status === 'failed' && /exited with code 2/.test(r3.status().error));

    console.log(`scriptRunner: all ${ok.length} checks passed`);
})().catch((e) => { console.error(e); process.exit(1); });
