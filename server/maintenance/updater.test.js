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

const { Updater, tagRank, newestTag, comfyVerdict } = require('./updater');

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

    up = await u.updatePack('pack-clean');
    ok('the pull starts', up.ok === true);
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

    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* Windows holds git handles briefly */ }
    console.log(`\n${pass} checks passed\n`);
})();
