const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

// Updating ComfyUI and the node packs.
//
// ★★ The assertion this file exists for is the one about WORDING: a run that
// changed nothing must say so. On 2026-10-08 the portable's stable updater ran
// correctly and left the rig on the version it started on — because that was
// already the newest release — and nothing in the output said so, so a day's
// work was planned on the belief that a known failure would now be fixed. The
// sentence is the feature, so it is pinned here rather than trusted.
//
// The git-backed cases build real repositories under the OS temp dir. ⚠ Never
// under server/ — a sweep keeps library-sweep-latest.json there and the report
// route serves it, so a test that writes into it reports on the machine rather
// than on the code.

const { Updater, tagRank, newestTag, comfyVerdict, comfyStoppedVerdict } = require('./updater');

let pass = 0;
const ok = (what, cond) => { assert.ok(cond, what); pass++; console.log(`  ok  ${what}`); };

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'comfyq-updater-'));
const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        GIT_AUTHOR_NAME: 'test', GIT_AUTHOR_EMAIL: 't@t',
        GIT_COMMITTER_NAME: 'test', GIT_COMMITTER_EMAIL: 't@t',
    },
    windowsHide: true,
}).trim();

/** A repo with one commit, plus whatever files are asked for. */
function repo(name, files = {}) {
    const dir = path.join(TMP, name);
    fs.mkdirSync(dir, { recursive: true });
    git(dir, 'init', '-q', '-b', 'main');
    fs.writeFileSync(path.join(dir, 'seed.txt'), 'seed\n');
    for (const [rel, body] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
        fs.writeFileSync(path.join(dir, rel), body);
    }
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'one');
    return dir;
}

function updaterFor(root, mode = 'admin') {
    return new Updater({
        config: () => ({ comfy_ui: { root_path: root, python_executable: '' } }),
        mode: () => mode,
    });
}

// ---------------------------------------------------------------------------
console.log('\nordering releases the way the vendor updater does');
ok('v0.39.1 outranks v0.39.0', tagRank('v0.39.1') > tagRank('v0.39.0'));
ok('v0.39.1 outranks v0.38.2', tagRank('v0.39.1') > tagRank('v0.38.2'));
// ★ The trap in string ordering: "v0.4.0" sorts after "v0.39.1" as text while
// being an older release. The numeric rank is what makes the comparison right.
ok('v0.39.1 outranks v0.4.0, which text sorting gets backwards',
    tagRank('v0.39.1') > tagRank('v0.4.0'));
ok('a non-version tag has no rank', tagRank('nightly') === null);
ok('the newest of a mixed list', newestTag(['v0.38.0', 'nightly', 'v0.39.1', 'v0.39.0']) === 'v0.39.1');
ok('a list with no version tags has no newest', newestTag(['nightly', 'latest']) === null);
ok('an empty list is handled', newestTag([]) === null);

// ---------------------------------------------------------------------------
console.log('\n★★ an update that changed nothing SAYS so');
const still = comfyVerdict({ before: '0.39.1', after: '0.39.1', moved: false });
ok('it does not claim an update', !/^Updated/.test(still.text));
ok('it names the version it is still on', still.text.includes('0.39.1'));
ok('it says nothing moved', /nothing moved/i.test(still.text));
// ⚠ The operative half: a restart on a no-op run would have the admin bounce
// ComfyUI and conclude the update is live when nothing changed.
ok('it does not ask for a restart', !/restart/i.test(still.text.replace(/Nothing needs restarting\./, '')));
ok('it explains that an untagged commit is not a release', /untagged/i.test(still.text));

const moved = comfyVerdict({ before: '0.39.1', after: '0.40.0', moved: true });
ok('a real update says what it went from and to',
    moved.text.includes('0.39.1') && moved.text.includes('0.40.0'));
ok('a real update asks for a restart', /restarted/i.test(moved.text));
ok('a real update does not say nothing moved', !/nothing moved/i.test(moved.text));
// ★ Decided on the commit, not the version string: master moves without the
// version changing, so equal labels must still be reportable as an update.
ok('an update with an unchanged version string is still reported as one',
    /^Updated/.test(comfyVerdict({ before: '0.39.1', after: '0.39.1', moved: true }).text));

// ★ A STOPPED update is not "nothing happened": update.py checks out master and
// pulls before it checks out the newest tag, so a stop in between can leave the
// install on untagged master — with the same version string it started on.
const stoppedMoved = comfyStoppedVerdict({
    before: { label: '0.43.2', head: 'aaa1111' }, after: { label: '0.43.2', head: 'bbb2222' }, moved: true,
});
ok('a stop that moved HEAD names both commits, not just the unchanged version',
    stoppedMoved.includes('aaa1111') && stoppedMoved.includes('bbb2222'));
ok('...says it stopped part-way and asks for a restart',
    /stopped part-way/i.test(stoppedMoved) && /restarted/i.test(stoppedMoved));
ok('...and warns that local edits may already be stashed', /stash/i.test(stoppedMoved));
const stoppedStill = comfyStoppedVerdict({
    before: { label: '0.43.2', head: 'aaa1111' }, after: { label: '0.43.2', head: 'aaa1111' }, moved: false,
});
ok('a stop before HEAD moved says so, and asks for no restart',
    /before anything moved/i.test(stoppedStill) && !/restart/i.test(stoppedStill));

// ---------------------------------------------------------------------------
console.log('\nreading the state of the install');
const install = repo('ComfyUI', {
    'comfyui_version.py': '__version__ = "0.39.1"\n',
    'custom_nodes/.keep': '',
});
git(install, 'tag', 'v0.38.0');
git(install, 'tag', 'v0.39.1');
// The portable layout: `update/` is a SIBLING of the ComfyUI root, which is
// where the vendor's updater and its pinned dependency list live.
const UPD = path.join(TMP, 'update');
fs.mkdirSync(UPD, { recursive: true });
fs.writeFileSync(path.join(UPD, 'update.py'), '# stands in for the vendor updater\n');
fs.writeFileSync(path.join(UPD, 'current_requirements.txt'),
    'comfyui-frontend-package==1.53.10\ntorch\ntorchvision\neinops\n# a comment\n\nnumpy>=1.25.0\n');
const u = updaterFor(install);
let st = u.comfyState();
ok('the version comes from what ComfyUI says about itself', st.version === '0.39.1');
ok('it is seen as a git checkout', st.isGit === true);
ok('the newest local tag is found', st.newestLocalTag === 'v0.39.1');
// Both tags point at the same commit here, which is the real shape: a release
// tag sits on the commit the install is checked out at.
ok('being on the newest tag is recognised', st.onNewestLocalTag === true);
ok('nothing reads as modified in a clean tree', st.dirty.length === 0);

fs.writeFileSync(path.join(install, 'untracked.log'), 'x');
st = u.comfyState();
ok('an untracked file is counted, not called a modification',
    st.untracked === 1 && st.dirty.length === 0);
// ⚠ Why the split matters: the vendor updater STASHES tracked edits onto a
// backup branch. An untracked log (ComfyQ writes two into the install) must not
// make the panel warn about losing work.
fs.writeFileSync(path.join(install, 'seed.txt'), 'edited\n');
st = u.comfyState();
ok('a tracked edit is reported by name', st.dirty.includes('seed.txt'));

// ---------------------------------------------------------------------------
console.log('\nrefusing to update ComfyUI over work it would stash');
(async () => {
    let out = await u.updateComfy();
    ok('a modified install is refused', out.ok === false);
    ok('the refusal names the file', String(out.error).includes('seed.txt'));
    ok('the refusal says the edits would be stashed', /stash/i.test(out.error));
    ok('the files are handed back for the UI to show', (out.dirty || []).includes('seed.txt'));

    // ★ With the edit accepted it gets past that guard and fails on the next
    // honest obstacle instead — here, that ComfyUI's python is not where the
    // config says. The point is that accepting is what moves it along, and that
    // the acceptance is a separate deliberate act rather than something derived
    // from the danger itself (the shape that made allowLow and acceptRisky
    // decorative on two earlier occasions).
    out = await u.updateComfy({ acceptStash: true });
    ok('accepting the stash gets past that guard, and the next refusal is a different one',
        out.ok === false && !/stash/i.test(out.error));
    ok('and the next refusal is the real obstacle', /python/i.test(out.error));

    // -----------------------------------------------------------------------
    console.log('\n⚠ an update refuses while the rig is serving a class');
    const serving = updaterFor(install, 'student');
    const sv = await serving.updateComfy({ acceptStash: true });
    ok('student mode is refused', sv.ok === false);
    ok('it says why, and what to do', /serving students/i.test(sv.error) && /admin mode/i.test(sv.error));
    ok('a pack update is refused in student mode too',
        (await serving.updatePack('anything')).ok === false);

    // -----------------------------------------------------------------------
    console.log('\nwhich packs can be updated, and why the rest cannot');
    const cn = path.join(install, 'custom_nodes');
    // A pack ComfyUI-Manager unpacked: a real folder with no .git at all.
    fs.mkdirSync(path.join(cn, 'comfyui-unpacked'), { recursive: true });
    fs.writeFileSync(path.join(cn, 'comfyui-unpacked', '__init__.py'), '');
    // A pack that is a clone, cleanly up to date with its origin.
    const origin = repo('origin-clean', { 'nodes.py': 'x\n' });
    execFileSync('git', ['clone', '-q', origin, path.join(cn, 'pack-clean')], { windowsHide: true });
    // A pack that is a clone the owner has edited in place.
    const originB = repo('origin-dirty', { 'nodes.py': 'x\n' });
    execFileSync('git', ['clone', '-q', originB, path.join(cn, 'pack-dirty')], { windowsHide: true });
    fs.writeFileSync(path.join(cn, 'pack-dirty', 'nodes.py'), 'locally edited\n');

    const states = await u.packStates({ fetch: false });
    const byName = Object.fromEntries((states.packs || []).map(p => [p.name, p]));
    ok('all three packs are listed', !!byName['comfyui-unpacked'] && !!byName['pack-clean'] && !!byName['pack-dirty']);
    // ★ 24 of this rig's 45 packs are copies, not clones. Saying "not a git
    // clone" is the whole point: an Update button there could never work.
    ok('a copy is blocked, with the reason', /not a git clone/i.test(byName['comfyui-unpacked'].blocked));
    ok('a copy is marked as not a clone', byName['comfyui-unpacked'].isGit === false);
    ok('a clean clone is offered', byName['pack-clean'].blocked === null);
    ok('a clean clone reports where it stands', !!byName['pack-clean'].head);
    ok('a clean clone is level with its origin', byName['pack-clean'].behind === 0);
    // ⚠⚠ The case that matters on this rig: ComfyUI-QwenImage21-FunControlNet is
    // a working copy the owner develops in place. A pull must not decide what
    // happens to their uncommitted work.
    ok('a clone with local edits is blocked', !!byName['pack-dirty'].blocked);
    ok('the block names the edited file', byName['pack-dirty'].blocked.includes('nodes.py'));
    ok('the block says to commit or stash first', /commit or stash/i.test(byName['pack-dirty'].blocked));
    ok('it is worded as a working copy, not a fault', /working copy/i.test(byName['pack-dirty'].blocked));

    let up = await u.updatePack('pack-dirty');
    ok('updating a pack with local edits is refused', up.ok === false);
    ok('and the refusal is the same reason the list gave', up.error.includes('nodes.py'));

    // -----------------------------------------------------------------------
    console.log('\nan update that is really available, and one that is not');
    fs.writeFileSync(path.join(origin, 'nodes.py'), 'x\nnew upstream line\n');
    git(origin, 'commit', '-aqm', 'upstream moved on');
    const fetched = await u.packStates({ fetch: true, only: 'pack-clean' });
    const clean = fetched.packs[0];
    ok('one commit behind is seen after a fetch', clean.behind === 1);
    ok('the incoming commit is named, so it can be read before pulling',
        (clean.incoming[0] || '').includes('upstream moved on'));

    // ★ Fired together, the way two quick clicks arrive: the first one's fetch
    // takes seconds, and the run slot used to be claimed only after it — so the
    // second Update (and Update ComfyUI) slipped in and the runs overwrote each
    // other's status.
    const fired = await Promise.all([
        u.updatePack('pack-clean'), u.updatePack('pack-clean'), u.updateComfy({ acceptStash: true }),
    ]);
    up = fired[0];
    ok('the pull starts', up.ok === true);
    ok('★ a second Update fired during the first one\'s fetch is refused',
        fired[1].ok === false && /being checked|already being updated/.test(fired[1].error));
    ok('★ ...and so is Update ComfyUI, with that reason rather than a later one',
        fired[2].ok === false && /being checked|already being updated/.test(fired[2].error));
    await new Promise(r => setTimeout(r, 2500));
    const run = u.status();
    ok('it finishes', run.status === 'done');
    ok('the new code is on disk',
        fs.readFileSync(path.join(cn, 'pack-clean', 'nodes.py'), 'utf8').includes('new upstream line'));
    ok('it reports from and to', run.verdict.includes(run.before.head) && run.verdict.includes(run.after.head));
    ok('it asks for a ComfyUI restart', run.needsRestart === true && /restart/i.test(run.verdict));

    u.forget();
    const again = await u.updatePack('pack-clean');
    // ★ Not "ok" with an empty log: a second click must say it is level rather
    // than report a successful update that did nothing. Same honesty rule as
    // the ComfyUI verdict above.
    ok('a second update says it is already up to date', again.upToDate === true);
    ok('and does not claim to have updated anything', !/updated/i.test(again.verdict));

    // -----------------------------------------------------------------------
    console.log('\nStop is a cancel, not a failure with an invented cause');
    fs.writeFileSync(path.join(origin, 'nodes.py'), 'x\nnew upstream line\nand another\n');
    git(origin, 'commit', '-aqm', 'upstream moved again');
    const stopper = updaterFor(install);
    const realSpawn = stopper._spawn.bind(stopper);
    // The pull hangs until it is killed; the fetch before it is real.
    stopper._spawn = (cmd, args, opts) => (args.includes('pull')
        ? new Promise((resolve) => { stopper._child = { kill: () => resolve(1) }; })
        : realSpawn(cmd, args, opts));
    ok('the pull starts', (await stopper.updatePack('pack-clean')).ok === true);
    ok('Stop is accepted', stopper.stop().ok === true);
    await new Promise(r => setTimeout(r, 50));
    ok('★ a stopped pack update reads as cancelled', stopper.status().status === 'cancelled');
    // The old message blamed a diverged history for every non-zero exit.
    ok('...and does not claim the history diverged', !/diverged/i.test(stopper.status().error || ''));
    ok('a stop before the pull moved anything says so', /before anything moved/i.test(stopper.status().verdict || ''));
    ok('...and asks for no restart', stopper.status().needsRestart === false);

    // ★ A killed pull can already have moved HEAD. The run must say where the
    // pack landed and ask for a restart — and must stay 'running' until the
    // child has exited, or the panel stops polling before that is known.
    const packDir = path.join(cn, 'pack-clean');
    const headBefore = git(packDir, 'rev-parse', '--short', 'HEAD');
    const mover = updaterFor(install);
    const moverSpawn = mover._spawn.bind(mover);
    mover._spawn = (cmd, args, opts) => (args.includes('pull')
        ? new Promise((resolve) => {
            mover._child = {
                kill: () => setTimeout(() => { git(packDir, 'pull', '-q', '--ff-only'); resolve(1); }, 30),
            };
        })
        : moverSpawn(cmd, args, opts));
    ok('the pull starts again', (await mover.updatePack('pack-clean')).ok === true);
    ok('Stop is accepted', mover.stop().ok === true);
    ok('★ until the child exits the run is still running, so the panel keeps polling',
        mover.status().status === 'running' && mover.status().stopping === true);
    ok('...and says it is stopping', /stopping/i.test(mover.status().step || ''));
    await new Promise(r => setTimeout(r, 400));
    const stopped = mover.status();
    const headAfter = git(packDir, 'rev-parse', '--short', 'HEAD');
    ok('the stub really moved HEAD', headAfter !== headBefore);
    ok('★ a stopped pull that moved HEAD reads as cancelled', stopped.status === 'cancelled');
    ok('★ ...and is recorded as having moved', stopped.moved === true);
    ok('★ ...and asks for a ComfyUI restart', stopped.needsRestart === true);
    ok('★ ...and its verdict names where it was and where it is now',
        /stopped part-way/i.test(stopped.verdict || '')
        && stopped.verdict.includes(headBefore) && stopped.verdict.includes(headAfter));

    // -----------------------------------------------------------------------
    console.log('\nthe folder never reaches git as a path from the request');
    for (const bad of ['../../evil', 'pack-clean/../..', '', 'nope', 'comfyui-unpacked/..']) {
        const r = await u.updatePack(bad);
        ok(`refused: ${JSON.stringify(bad)}`, r.ok === false);
    }
    // ★ The guard is an allow-list built from what is on disk, not a sanitiser:
    // the only strings that pass are folder names listInstalledPacks returned.
    ok('a real copy is refused for the right reason, not by path shape',
        /not a git clone/i.test((await u.updatePack('comfyui-unpacked')).error));

    // -----------------------------------------------------------------------
    console.log('\nthe pinned dependency list is read, and its danger named');
    const reqs = u.comfyRequirements();
    ok('the pinned list is found beside the install', reqs.exists === true);
    ok('comments and blank lines are dropped', !reqs.lines.some(l => l.startsWith('#') || l === ''));
    // ⚠⚠ This is the real landmine: bare `torch` against an install held at
    // 2.8.0+cu128 for the Pixal3D and TRELLIS2 packs.
    ok('bare torch is named as risky', reqs.risky.includes('torch'));
    ok('torchvision is named as risky', reqs.risky.includes('torchvision'));
    ok('a pinned numpy range is named as risky', reqs.risky.some(l => l.startsWith('numpy')));
    ok('an ordinary dependency is not', !reqs.risky.includes('einops'));

    const refused = await u.updateComfyDeps();
    ok('pip is refused until the risk is accepted explicitly', refused.ok === false);
    ok('the refusal names torch', /torch/.test(refused.error));
    ok('the refusal names the pin it would break', /2\.8\.0\+cu128/.test(refused.error));
    ok('the risky lines are handed back for the UI to print', (refused.risky || []).includes('torch'));
    // ★ The acceptance is what moves it along, and it is a separate deliberate
    // act rather than anything derived from the danger itself.
    const accepted = await u.updateComfyDeps({ acceptRisky: true });
    ok('accepting it gets past that gate', !/Say so explicitly/.test(accepted.error || ''));

    // -----------------------------------------------------------------------
    console.log('\n★ an install AHEAD of the newest release is not offered a "newer" one');
    // update_comfyui.bat (the non-stable one, beside the stable one) leaves the
    // install on master past the newest tag. The stable updater would check
    // the tag out — a downgrade — so calling that "a newer release" is wrong.
    const comfyOrigin = repo('comfy-origin', { 'comfyui_version.py': '__version__ = "0.43.2"\n' });
    git(comfyOrigin, 'tag', 'v0.43.2');
    const ahead = path.join(TMP, 'comfy-ahead');
    execFileSync('git', ['clone', '-q', comfyOrigin, ahead], { windowsHide: true });
    fs.writeFileSync(path.join(ahead, 'master.txt'), 'past the release\n');
    git(ahead, 'add', '-A');
    git(ahead, 'commit', '-qm', 'master moved on, untagged');
    const au = updaterFor(ahead);
    const ast = au.comfyState();
    ok('it is not on the newest tag', ast.onNewestLocalTag === false);
    ok('it is recognised as AHEAD of it', ast.aheadOfNewestTag === true);
    let achk = await au.checkComfy();
    ok('the check reached the remote', achk.fetched === true);
    ok('★ no update is offered', achk.updateAvailable === false);
    ok('the verdict says it is ahead, and that the stable updater would go back',
        /ahead/i.test(achk.verdict) && /back/i.test(achk.verdict) && !/newer release is available/i.test(achk.verdict));
    // ...while a real new release past it is still reported as one.
    fs.writeFileSync(path.join(comfyOrigin, 'comfyui_version.py'), '__version__ = "0.44.0"\n');
    git(comfyOrigin, 'commit', '-aqm', 'release');
    git(comfyOrigin, 'tag', 'v0.44.0');
    achk = await au.checkComfy();
    ok('a newer tag that is not in the install is still offered',
        achk.updateAvailable === true && /v0\.44\.0/.test(achk.verdict) && achk.aheadOfNewestTag === false);

    // -----------------------------------------------------------------------
    console.log('\n★ what we wait for from ComfyUI: the check says when a release holds it');
    // RelayVSR landed on master after v0.44.0 (2026-11-05). The owner chose to
    // wait for a stable release; the check that fetches releases says when.
    const wOrigin = repo('comfy-wait-origin', { 'comfyui_version.py': '__version__ = "0.44.2"\n' });
    git(wOrigin, 'tag', 'v0.44.2');
    fs.writeFileSync(path.join(wOrigin, 'model_vsr.py'), '# RelayVSR\n');
    git(wOrigin, 'add', '-A');
    git(wOrigin, 'commit', '-qm', 'Support RelayVSR');
    const awaited = execFileSync('git', ['-C', wOrigin, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const wClone = path.join(TMP, 'comfy-wait');
    execFileSync('git', ['clone', '-q', wOrigin, wClone], { windowsHide: true });
    git(wClone, 'checkout', '-q', 'v0.44.2');
    const waitingFile = path.join(TMP, 'comfyui-waiting.json');
    fs.writeFileSync(waitingFile, JSON.stringify({ waiting: [
        { since: '2026-11-09', what: 'RelayVSR', commit: awaited, then: 'Build the RelayVSR card.' },
        { since: '2026-11-09', what: 'Something never fetched', commit: 'f'.repeat(40), then: 'x' },
    ] }));
    const wu = new Updater({ config: () => ({ comfy_ui: { root_path: wClone, python_executable: '' } }), mode: () => 'admin', waitingFile });
    let wchk = await wu.checkComfy();
    ok('before a release holds it: still waiting', wchk.waiting[0].known === true && wchk.waiting[0].release === null
        && /Still waiting \(since 2026-11-09\): RelayVSR/.test(wchk.verdict), wchk.verdict);
    ok('a commit this checkout does not have is unknown, not "not released"', wchk.waiting[1].known === false
        && /Whether Something never fetched has been released is unknown/.test(wchk.verdict));
    fs.writeFileSync(path.join(wOrigin, 'comfyui_version.py'), '__version__ = "0.45.0"\n');
    git(wOrigin, 'commit', '-aqm', 'ComfyUI v0.45.0');
    git(wOrigin, 'tag', 'v0.45.0');
    fs.writeFileSync(path.join(wOrigin, 'comfyui_version.py'), '__version__ = "0.45.1"\n');
    git(wOrigin, 'commit', '-aqm', 'ComfyUI v0.45.1');
    git(wOrigin, 'tag', 'v0.45.1');
    wchk = await wu.checkComfy();
    ok('once a release holds it, the check names the FIRST such release and what to do',
        wchk.waiting[0].release === 'v0.45.0' && /RelayVSR is in v0\.45\.0\. Build the RelayVSR card\./.test(wchk.verdict), wchk.verdict);
    ok('the update itself is offered as usual', wchk.updateAvailable === true);
    const real = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'tools', 'maintenance', 'comfyui-waiting.json'), 'utf8'));
    ok('the repo\'s list reads, and every entry has a full commit id', Array.isArray(real.waiting)
        && real.waiting.every(w => /^[0-9a-f]{40}$/.test(w.commit) && w.what && w.then && w.since));

    // -----------------------------------------------------------------------
    console.log('\n★ a folder git refuses over its owner says so, with the fix');
    // A drive cloned onto another machine belongs to another Windows user, and
    // git then refuses every read ("dubious ownership"). The pack used to show
    // no commit and, after a check, "could not reach its remote". Simulated with
    // git's own test switch; the global and system config are kept out of it,
    // since this rig's global config already trusts "*".
    {
        const ru = updaterFor(install);
        const emptyCfg = path.join(TMP, 'empty.gitconfig');
        fs.writeFileSync(emptyCfg, '');
        const env = { GIT_TEST_ASSUME_DIFFERENT_OWNER: '1', GIT_CONFIG_GLOBAL: emptyCfg, GIT_CONFIG_NOSYSTEM: '1' };
        const saved = {};
        for (const k of Object.keys(env)) { saved[k] = process.env[k]; process.env[k] = env[k]; }
        try {
            const row = (await ru.packStates({ fetch: true, only: 'pack-clean' })).packs[0];
            ok('the pack names the refusal and the one-line fix',
                /git refuses this folder/.test(row.blocked || '') && /safe\.directory "\*"/.test(row.blocked));
            ok('...not an unreachable remote', !/remote/.test(row.blocked || ''));
            ok('...and claims no commit it could not read', row.head === null);
            const upr = await ru.updatePack('pack-clean');
            ok('updating it is refused with that reason', upr.ok === false && /safe\.directory/.test(upr.error));
            ok('ComfyUI itself carries the same reason', /safe\.directory/.test(ru.comfyState().gitRefused || ''));
            const rchk = await ru.checkComfy();
            ok('checking ComfyUI says why, rather than "could not reach the remote"',
                /safe\.directory/.test(rchk.verdict) && !/reach the remote/i.test(rchk.verdict)
                && rchk.updateAvailable === false);
            // ★ The vendor updater switches git's ownership check off for itself,
            // so it would stash and pull here — while neither the stash warning
            // nor before/after could be read, and a real update read "Nothing moved".
            const rup = await ru.updateComfy();
            ok('updating ComfyUI is refused with that reason', rup.ok === false && /safe\.directory/.test(rup.error));
            ok('...and nothing was started', ru.status() === null);
            // A check over refused packs must not call them unreachable.
            ok('a check can start', ru.checkAll().ok === true);
            for (let i = 0; i < 400 && ru.scan().status === 'running'; i++) {
                await new Promise(r => setTimeout(r, 50));
            }
            const rscan = ru.scan();
            ok('the check finished', rscan.status === 'done');
            ok('★ refused packs are not counted as unreachable', rscan.unreachable === 0);
            ok('...they are counted as refused, one per git pack',
                rscan.refused > 0 && rscan.refused === rscan.packs.filter(p => p.isGit).length);
        } finally {
            for (const k of Object.keys(env)) {
                if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
            }
        }
        ok('once git reads the folder again, the reason is gone', ru.comfyState().gitRefused === undefined);
        ru._gitSync(TMP, ['rev-parse', 'HEAD']);
        ok('an ordinary failed read is not taken for an ownership refusal', ru._gitRefusedDir === null);
    }

    // -----------------------------------------------------------------------
    console.log('\nan install that is not a git checkout at all');
    const plain = path.join(TMP, 'unpacked-comfy');
    fs.mkdirSync(plain, { recursive: true });
    fs.writeFileSync(path.join(plain, 'comfyui_version.py'), '__version__ = "0.37.0"\n');
    const pu = updaterFor(plain);
    const pst = pu.comfyState();
    ok('its version is still read', pst.version === '0.37.0');
    ok('it is not called a git checkout', pst.isGit === false);
    const chk = await pu.checkComfy();
    ok('checking says there is nothing to compare against, rather than "up to date"',
        chk.ok === true && /not a git checkout/i.test(chk.verdict));
    ok('and it does not claim an update is available', chk.updateAvailable === false);

    // -----------------------------------------------------------------------
    console.log('\na missing install is said to be missing');
    const none = updaterFor(path.join(TMP, 'does-not-exist'));
    ok('state reports it absent', none.comfyState().present === false);
    ok('checking refuses', (await none.checkComfy()).ok === false);
    ok('updating refuses', (await none.updateComfy()).ok === false);

    // -----------------------------------------------------------------------
    console.log('\n★ an update re-applies the comfy-kitchen fixes (2026-11-12)');
    // pip reinstalls comfy-kitchen when ComfyUI's pin moves and drops the local
    // fix; the step runs the real script path, and its verdict reaches the run.
    const kitchenRun = (lines, code) => {
        const k = updaterFor(path.join(TMP, 'does-not-exist'));
        const calls = [];
        k._spawn = async (cmd, args, opts) => { calls.push({ cmd, args }); for (const l of lines) opts.run.output.push(l); return code; };
        const run = { output: [] };
        return k._reapplyKitchenFixes('py.exe', run).then(c => ({ run, calls, code: c }));
    };
    const fresh = await kitchenRun(['2 applied, 0 already in place, 0 missing, 0 FAILED', 'ALL CHECKS PASSED'], 0);
    ok('it runs fix_comfy_kitchen.py with ComfyUI\'s python, no flags',
        fresh.calls.length === 1 && fresh.calls[0].cmd === 'py.exe'
        && fresh.calls[0].args.length === 2 && /fix_comfy_kitchen\.py$/.test(fresh.calls[0].args[1]));
    ok('the script it runs exists in the repo', fs.existsSync(fresh.calls[0].args[1]));
    ok('a fix written now asks for a ComfyUI restart', fresh.run.kitchenFixes === 'ok' && fresh.run.kitchenApplied === true);
    ok('the step label is cleared afterwards', fresh.run.step === null);
    const already = await kitchenRun(['0 applied, 2 already in place, 0 missing, 0 FAILED'], 0);
    ok('fixes already in place ask for nothing', already.run.kitchenFixes === 'ok' && already.run.kitchenApplied === false);
    const refusedFix = await kitchenRun(['0 applied, 0 already in place, 0 missing, 1 FAILED'], 1);
    ok('a refusal is recorded on the run, not thrown', refusedFix.run.kitchenFixes === 'failed' && refusedFix.code === 1);
    // The tally is read from the tail: a long update log trimmed from the front
    // must not hide it.
    const long = await kitchenRun([...Array(60).fill('noise'), '1 applied, 1 already in place, 0 missing, 0 FAILED'], 0);
    ok('the tally is found at the end of a long log', long.run.kitchenApplied === true);

    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* Windows holds git handles briefly */ }
    console.log(`\n${pass} checks passed\n`);
})();
