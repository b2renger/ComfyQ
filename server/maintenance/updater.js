const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const { listInstalledPacks, readRequirements, invalidateNodePacks } = require('../workflows/nodePacks');

// Update ComfyUI, and update one node pack at a time, from the admin panel.
//
// ★★ The reason this is a feature and not a console habit. On 2026-10-08 the
// owner ran the portable's own stable updater, it did exactly what it is
// supposed to do, and the rig stayed on v0.39.1 — because v0.39.1 IS the newest
// release and master had merely moved on untagged. Nothing said so, so a day's
// work was planned on the belief that ComfyUI and the packs had moved and that
// a known failure would therefore be fixed. **So the headline here is not the
// button. It is that this reports the version before and after, and says
// plainly when nothing moved.** An updater that reports "Done" after changing
// nothing is worse than no updater.
//
// ★ ComfyUI is updated through the portable's OWN `update/update.py --stable`
// rather than a git sequence of ours. It is the vendor's script, already on
// disk, and it does three things we would otherwise have to get right by hand:
// it stashes local changes, it makes a `backup_branch_<date>`, and it can
// replace itself. Reimplementing that is inventing risk on a drive cloned to
// several rigs.
//
// ⚠ A node pack is pulled `--ff-only`, and never while its tree is dirty. Both
// matter on this fleet rather than in principle:
// `custom_nodes/ComfyUI-QwenImage21-FunControlNet` is a working copy the owner
// develops in place, so a pull that merged or discarded would eat their own
// work. A dirty tree is the normal state of a working copy, not a fault — so it
// is reported as a reason this pack is not offered, not as an error.
//
// ⚠ pip is a separate, explicitly acknowledged step in both halves. The
// portable's `current_requirements.txt` asks for bare `torch`, `torchvision`,
// `numpy` and `transformers`, and this install is deliberately held at
// torch 2.8.0+cu128 because the Pixal3D and TRELLIS2 packs need it. Running
// that list unasked is how the pin dies — and one python_embeded is shared by
// every lane and every rig imaged from this drive.
//
// ⚠ Nothing here restarts ComfyUI. An update is not live until it does, and a
// restart is the operator's call because the machine may be mid-class.

const GIT_TIMEOUT_MS = 3 * 60 * 1000;
const UPDATE_TIMEOUT_MS = 15 * 60 * 1000;
const PIP_TIMEOUT_MS = 30 * 60 * 1000;

// ★ git refuses to read a repository another Windows user owns ("detected
// dubious ownership") — the normal state of a drive cloned onto a new machine.
// Every read then fails, and without this the pack showed no commit and, after
// a check, "could not reach its remote": a false reason with no way forward.
const SAFE_DIRECTORY_FIX = 'git refuses this folder: run git config --global --add safe.directory "*" '
    + 'once on this machine';
function isOwnershipRefusal(stderr) {
    return /dubious ownership/i.test(String(stderr || ''));
}

/** `v0.39.1` -> a sortable number, ordered the way the vendor's updater orders it. */
function tagRank(tag) {
    const m = /^v(\d+)\.(\d+)\.(\d+)$/.exec(String(tag || '').trim());
    if (!m) return null;
    return (+m[1]) * 1e10 + (+m[2]) * 1e5 + (+m[3]);
}

/** The newest `vX.Y.Z` in a list, ignoring anything that is not one. */
function newestTag(tags) {
    let best = null;
    for (const t of tags || []) {
        const r = tagRank(t);
        if (r != null && (!best || r > best.rank)) best = { tag: t, rank: r };
    }
    return best ? best.tag : null;
}

/**
 * The sentence a finished ComfyUI update should print.
 *
 * Pulled out of the run so it can be tested without a git repo: this wording IS
 * the feature (see the header), so it is pinned by a test rather than trusted.
 */
function comfyVerdict({ before, after, moved }) {
    if (moved) {
        return {
            moved,
            text: `Updated ${before} → ${after}. ComfyUI must be restarted before it runs the new code.`,
        };
    }
    return {
        moved,
        text: `Nothing moved — still ${after}, which is already the newest tagged release. `
            + 'The updater ran correctly; there was simply no newer release to take. Development '
            + 'continues past it, but an untagged commit is not a release. Nothing needs restarting.',
    };
}

/** "0.43.2 (a1b2c3d)": the version alone cannot show a move onto untagged master. */
function where(s) {
    if (!s) return 'unknown';
    if (s.head && s.label && s.label !== s.head) return `${s.label} (${s.head})`;
    return s.label || s.head || 'unknown';
}

/**
 * The sentence a STOPPED ComfyUI update should print.
 *
 * ★ A stop is not "nothing happened". update.py stashes local edits, checks out
 * master and pulls BEFORE it checks out the newest tag, so a stop in between
 * can leave the install on an untagged master commit. Without this the run read
 * as just "cancelled", with no restart warning, wherever HEAD had got to.
 */
function comfyStoppedVerdict({ before, after, moved }) {
    if (moved) {
        return `Stopped part-way: ComfyUI is now at ${where(after)} (was ${where(before)}), which may be `
            + 'an untagged commit rather than a release. Read the output above before running anything — '
            + 'the updater may already have stashed local edits. ComfyUI must be restarted before it runs '
            + 'this code; running Update ComfyUI again should finish the move to the newest release.';
    }
    return `Stopped before anything moved — ComfyUI is still at ${where(after)}. The updater may already `
        + 'have stashed local edits; read the output above.';
}

class Updater {
    /**
     * @param {object} opts
     * @param {() => object} opts.config  read fresh, so an edited path is honoured
     * @param {() => string} [opts.mode]  'admin' | 'student'
     */
    constructor({ config, mode = () => 'admin' }) {
        this._config = config;
        this._mode = mode;
        this._run = null;       // the one update in flight, or the last finished
        this._child = null;
        this._scan = null;      // the last "what has updates?" sweep
        this._claim = null;     // a pack being fetched just before its update begins
        this._localCache = null;
    }

    _now() { return Date.now(); }

    _root() { return (this._config() || {}).comfy_ui?.root_path || ''; }
    _updateDir() {
        const r = this._root();
        return r ? path.resolve(r, '..', 'update') : null;
    }
    _customNodes() {
        const r = this._root();
        return r ? path.join(r, 'custom_nodes') : null;
    }
    _python() {
        const cfg = this._config() || {};
        const root = this._root();
        const exe = cfg.comfy_ui?.python_executable || '';
        const cands = [];
        if (exe) cands.push(path.isAbsolute(exe) ? exe : path.resolve(root || '.', exe));
        if (root) cands.push(path.resolve(root, '..', 'python_embeded', 'python.exe'));
        return cands.find(p => { try { return fs.statSync(p).isFile(); } catch { return false; } }) || null;
    }

    status() { return this._run ? { ...this._run, output: this._run.output.slice(-200) } : null; }

    scan() { return this._scan ? { ...this._scan } : null; }

    /**
     * Reach every remote and say what has an update waiting.
     *
     * ★ A background sweep the caller polls, not an awaited request. One fetch
     * per git pack is twenty network round trips on this rig, and a request
     * that sits open for two minutes reads as a hung panel.
     *
     * ⚠ Never automatic. A fetch needs the internet, and these rigs are
     * routinely on a managed LAN or none at all -- so "no updates" must never
     * be something the panel concluded on its own from a failed fetch.
     */
    checkAll() {
        if (this._scan && this._scan.status === 'running') {
            return { ok: false, error: 'a check is already running' };
        }
        this._scan = {
            status: 'running', startedAt: new Date().toISOString(),
            comfy: null, packs: [], done: 0, total: 0, unreachable: 0, refused: 0,
        };
        const scan = this._scan;
        (async () => {
            scan.comfy = await this.checkComfy();
            const cn = this._customNodes();
            const all = cn && fs.existsSync(cn) ? listInstalledPacks(this._root()) : [];
            const git = all.filter(p => p.isGit);
            scan.total = git.length;

            // Four at a time: enough to be quick on a LAN, few enough that a
            // rig behind a slow link is not hammering twenty sockets.
            const queue = [...git];
            const worker = async () => {
                for (;;) {
                    const p = queue.shift();
                    if (!p) return;
                    const one = await this.packStates({ fetch: true, only: p.name });
                    const row = one.ok ? one.packs[0] : null;
                    if (row) {
                        scan.packs.push(row);
                        // A folder git refuses was never fetched: that is not an
                        // unreachable remote, and saying so sends people to the network.
                        if (row.gitRefused) scan.refused++;
                        else if (row.fetched === false) scan.unreachable++;
                    }
                    scan.done++;
                }
            };
            await Promise.all([worker(), worker(), worker(), worker()]);
            // The copies, so the UI can say why they are not offered.
            for (const p of all.filter(p => !p.isGit)) {
                scan.packs.push({
                    name: p.name, isGit: false, remote: null,
                    hasRequirements: p.hasRequirements, disabled: p.disabled,
                    head: null, subject: null, date: null, branch: null,
                    dirty: [], untracked: 0, behind: null, incoming: [], fetched: false,
                    blocked: 'not a git clone — ComfyUI-Manager unpacked it as a copy, so there is '
                        + 'no remote to pull from. Re-installing it by URL is what makes it updatable.',
                });
            }
            scan.packs.sort((a, b) => {
                // Anything with an update first; that is what the screen is for.
                const av = (a.behind || 0) > 0 ? 0 : (a.isGit ? 1 : 2);
                const bv = (b.behind || 0) > 0 ? 0 : (b.isGit ? 1 : 2);
                return av - bv || a.name.localeCompare(b.name);
            });
            scan.status = 'done';
            scan.finishedAt = new Date().toISOString();
            scan.withUpdates = scan.packs.filter(p => (p.behind || 0) > 0).length;
        })().catch(e => { scan.status = 'failed'; scan.error = e.message; });
        return { ok: true };
    }

    // ---------------------------------------------------------------- ComfyUI

    /**
     * Where this install stands. No network and no writes, so it is safe to
     * call on every page load.
     */
    comfyState() {
        const root = this._root();
        const out = {
            root, present: false, version: null, head: null, describe: null, branch: null,
            isGit: false, updaterPresent: false,
            newestLocalTag: null, onNewestLocalTag: null, aheadOfNewestTag: false,
            dirty: [], untracked: 0,
        };
        if (!root || !fs.existsSync(root)) return out;
        out.present = true;
        const upd = this._updateDir();
        out.updaterPresent = !!upd && fs.existsSync(path.join(upd, 'update.py'));

        // The authoritative version is the one ComfyUI reports about itself;
        // `git describe` can disagree while a head is detached mid-update.
        try {
            const txt = fs.readFileSync(path.join(root, 'comfyui_version.py'), 'utf8');
            const m = /__version__\s*=\s*["']([^"']+)["']/.exec(txt);
            if (m) out.version = m[1];
        } catch { /* git below may still answer */ }

        out.isGit = fs.existsSync(path.join(root, '.git'));
        if (!out.isGit) return out;
        out.head = this._gitSync(root, ['rev-parse', '--short', 'HEAD']);
        if (out.head == null && this._gitRefusedDir === root) {
            out.gitRefused = SAFE_DIRECTORY_FIX;
            return out;
        }
        out.describe = this._gitSync(root, ['describe', '--tags', '--always']);
        out.branch = this._gitSync(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
        const tags = (this._gitSync(root, ['tag', '--list', 'v*']) || '').split(/\r?\n/).filter(Boolean);
        out.newestLocalTag = newestTag(tags);
        if (out.newestLocalTag) {
            const tagSha = this._gitSync(root, ['rev-list', '-n', '1', out.newestLocalTag]);
            const headSha = this._gitSync(root, ['rev-parse', 'HEAD']);
            out.onNewestLocalTag = !!tagSha && !!headSha && tagSha === headSha;
            // ★ "Not on the newest tag" has two opposite meanings. Behind it, the
            // stable updater moves forward. AHEAD of it — on master past the
            // release, which update_comfyui.bat (the non-stable one, in the same
            // folder) leaves you on — the stable updater checks the tag out,
            // i.e. it moves BACK. Commits in the tag that HEAD lacks: 0 means
            // the tag is already behind HEAD.
            // ⚠ Read from the LOCAL tags, with no fetch. update.py fetches
            // before it picks the tag, so "moves back" holds only if no newer
            // release was published since the last fetch; checkComfy fetches
            // first and is the one place this can be stated as fact.
            if (out.onNewestLocalTag === false) {
                const missing = this._gitSync(root, ['rev-list', '--count', `HEAD..${out.newestLocalTag}`]);
                out.aheadOfNewestTag = missing === '0';
            }
        }
        // ★ Tracked modifications are reported because the vendor updater
        // STASHES them onto a backup branch. That is recoverable, but it is not
        // what someone who hand-patched ComfyUI expects — and this install has
        // been hand-patched before (the ID-V2V four-file patch).
        const w = this._worktree(root);
        out.dirty = w.dirty;
        out.untracked = w.untracked;
        return out;
    }

    /**
     * Fetch, then say whether a newer RELEASE exists.
     *
     * ★ Deliberately separate from updating: "is there anything to get?" is the
     * question that was unanswerable this morning, and it costs one fetch and
     * changes nothing.
     */
    async checkComfy() {
        const st = this.comfyState();
        if (!st.present) return { ok: false, error: 'no ComfyUI install is configured' };
        if (!st.isGit) {
            return {
                ok: true, ...st, fetched: false, updateAvailable: false,
                verdict: 'This install is not a git checkout, so there is no release to compare it '
                    + 'against — it was unpacked from an archive. Update it the way it was installed.',
            };
        }
        if (st.gitRefused) {
            return {
                ok: true, ...st, fetched: false, updateAvailable: false,
                verdict: `Whether a newer release exists is unknown: ${st.gitRefused}. `
                    + `What is installed is ${st.version || 'unclear'}.`,
            };
        }
        const log = [];
        const code = await this._spawnQuiet('git', ['-C', st.root, 'fetch', '--tags', 'origin'],
            { cwd: st.root, timeout: GIT_TIMEOUT_MS, log });
        const after = this.comfyState();
        const fetched = code === 0;
        const available = fetched && !!after.newestLocalTag && after.onNewestLocalTag === false
            && !after.aheadOfNewestTag;
        let verdict;
        if (!fetched) {
            verdict = 'Could not reach the remote, so whether a newer release exists is unknown. '
                + `What is installed is ${after.version || after.describe || 'unclear'}.`;
        } else if (!after.newestLocalTag) {
            verdict = 'The remote has no version tags to compare against.';
        } else if (after.aheadOfNewestTag) {
            verdict = `Installed is an untagged commit (${after.describe || after.head}) AHEAD of the `
                + `newest release, ${after.newestLocalTag}. There is no newer release to take. `
                + `Update ComfyUI runs the stable updater, which would move it BACK to ${after.newestLocalTag}.`;
        } else if (available) {
            verdict = `A newer release is available: ${after.newestLocalTag} `
                + `(installed: ${after.version || after.describe}).`;
        } else {
            verdict = `Already on the newest release, ${after.newestLocalTag}. `
                + 'Development has moved on past it, but an untagged commit is not a release, so '
                + 'updating now would land on this same version.';
        }
        return { ok: true, ...after, fetched, updateAvailable: available, verdict, output: log.slice(-60) };
    }

    /**
     * Run the portable's own stable updater, and report before -> after.
     *
     * @param {object} [opts]
     * @param {boolean} [opts.acceptStash]  tracked edits were shown and accepted
     */
    async updateComfy(opts = {}) {
        const busy = this._busy();
        if (busy) return busy;
        const st = this.comfyState();
        if (!st.present) return { ok: false, error: 'no ComfyUI install is configured' };
        if (!st.updaterPresent) {
            return {
                ok: false,
                error: 'this install has no update/update.py beside it, so it is not the portable layout '
                    + 'this can drive. Update it the way it was installed.',
            };
        }
        // ★ The vendor updater turns git's ownership check off for itself
        // (pygit2 GIT_OPT_SET_OWNER_VALIDATION 0), so it WOULD stash, pull and
        // check out here. But with git refusing us, neither the stash warning
        // below (no tracked edits can be read) nor the before/after commit can
        // be evaluated — and a real update then reported "Nothing moved".
        if (st.gitRefused) {
            return {
                ok: false,
                error: `whether ComfyUI's own files are modified, and where it stands, cannot be read: ${st.gitRefused}`,
            };
        }
        if (st.dirty.length && !opts.acceptStash) {
            return {
                ok: false,
                error: `ComfyUI's own files have been modified here (${st.dirty.slice(0, 6).join(', ')}`
                    + `${st.dirty.length > 6 ? `, +${st.dirty.length - 6} more` : ''}). The updater stashes `
                    + 'those onto a backup branch before it pulls. Say so explicitly to go ahead.',
                dirty: st.dirty,
            };
        }
        const py = this._python();
        if (!py) {
            return { ok: false, error: "ComfyUI's python could not be found — check the paths under Manage ComfyUI" };
        }

        const was = st.version || st.describe || st.head || 'unknown';
        const run = this._begin('comfyui', 'ComfyUI', `updating from ${was}`);
        run.before = { version: st.version, describe: st.describe, head: st.head, label: was };

        (async () => {
            const dir = this._updateDir();
            const target = this._root() + path.sep;
            // ★ Mirrors update_comfyui_stable.bat, including its self-update
            // dance: update.py can ship a replacement for itself, and skipping
            // that is how an updater quietly stops being able to update.
            let code = await this._spawn(py, ['-s', './update.py', target, '--stable'],
                { cwd: dir, timeout: UPDATE_TIMEOUT_MS, run });
            const fresh = path.join(dir, 'update_new.py');
            if (code === 0 && !run.stopping && fs.existsSync(fresh)) {
                run.step = 'the updater replaced itself — running it again';
                try {
                    fs.renameSync(fresh, path.join(dir, 'update.py'));
                    code = await this._spawn(py,
                        ['-s', './update.py', target, '--skip_self_update', '--stable'],
                        { cwd: dir, timeout: UPDATE_TIMEOUT_MS, run });
                } catch (e) {
                    run.output.push(`could not replace update.py: ${e.message}`);
                }
            }
            const now = this.comfyState();
            const is = now.version || now.describe || now.head || 'unknown';
            run.after = { version: now.version, describe: now.describe, head: now.head, label: is };
            run.step = null;
            // Stopped by the admin: the killed updater exits non-zero, and that
            // is a cancel, not a failure with a cause to report — but it may
            // already have moved the install, so say where it landed.
            if (run.stopping) {
                run.status = 'cancelled';
                run.moved = run.before.head !== run.after.head;
                run.needsRestart = run.moved;
                run.verdict = comfyStoppedVerdict({ before: run.before, after: run.after, moved: run.moved });
                run.requirements = this.comfyRequirements();
                if (run.moved) invalidateNodePacks();
                return;
            }
            if (code !== 0) {
                run.status = 'failed';
                run.error = `the updater exited with code ${code} — read its output above before retrying`;
                return;
            }
            run.status = 'done';
            // ★ Decided on the COMMIT, not the version string. master can move
            // without the version changing, and a release can be re-tagged —
            // the sha is what actually decides what runs.
            run.moved = run.before.head !== run.after.head;
            run.needsRestart = run.moved;
            run.verdict = comfyVerdict({ before: was, after: is, moved: run.moved }).text;
            run.requirements = this.comfyRequirements();
            invalidateNodePacks();
        })().catch(e => { run.status = 'failed'; run.error = e.message; });

        return { ok: true };
    }

    /** The portable's pinned dependency list, with the lines that would hurt named. */
    comfyRequirements() {
        const dir = this._updateDir();
        if (!dir || !fs.existsSync(path.join(dir, 'current_requirements.txt'))) {
            return { exists: false, lines: [], risky: [] };
        }
        return readRequirements(dir, 'current_requirements.txt');
    }

    /**
     * pip against the portable's pinned list. Explicit, acknowledged, separate.
     *
     * ⚠ This is the step that can take the whole rig out: on this install that
     * list asks for bare torch, which is pinned to 2.8.0+cu128 for Pixal3D and
     * TRELLIS2. Hence its own gate, naming the packages by name.
     */
    async updateComfyDeps({ acceptRisky = false } = {}) {
        const busy = this._busy();
        if (busy) return busy;
        const reqs = this.comfyRequirements();
        if (!reqs.exists) return { ok: false, error: 'there is no current_requirements.txt beside this install' };
        if (reqs.risky.length && !acceptRisky) {
            return {
                ok: false,
                error: 'this list replaces packages the whole install shares: ' + reqs.risky.join(', ')
                    + '. torch here is deliberately held at 2.8.0+cu128 for the Pixal3D and TRELLIS2 '
                    + 'packs. Say so explicitly to go ahead.',
                risky: reqs.risky,
            };
        }
        const py = this._python();
        if (!py) return { ok: false, error: "ComfyUI's python could not be found" };
        const run = this._begin('comfyui-deps', "ComfyUI's dependencies",
            'pip install -r current_requirements.txt');
        run.requirements = reqs;
        (async () => {
            const code = await this._spawn(py,
                ['-s', '-m', 'pip', 'install', '-r', path.join(this._updateDir(), 'current_requirements.txt')],
                { cwd: this._updateDir(), timeout: PIP_TIMEOUT_MS, run });
            if (run.stopping) { run.status = 'cancelled'; run.step = null; run.needsRestart = true; return; }
            run.status = code === 0 ? 'done' : 'failed';
            run.step = null;
            run.needsRestart = true;
            if (code !== 0) run.error = `pip exited with code ${code}`;
            else {
                run.verdict = 'Dependencies installed. Restart ComfyUI, then render one heavy bundle '
                    + 'before trusting the rig — this step can move torch, and the failure that causes '
                    + 'is silent.';
            }
        })().catch(e => { run.status = 'failed'; run.error = e.message; });
        return { ok: true };
    }

    // --------------------------------------------------------------- the packs

    /**
     * Every installed pack, and what updating it would mean.
     *
     * @param {object} [opts]
     * @param {boolean} [opts.fetch]  reach the remotes to learn what is behind
     * @param {string}  [opts.only]   just this folder
     */
    async packStates({ fetch: doFetch = false, only = null } = {}) {
        const cn = this._customNodes();
        if (!cn || !fs.existsSync(cn)) return { ok: false, error: 'no ComfyUI install is configured' };
        const packs = listInstalledPacks(this._root()).filter(p => !only || p.name === only);
        const out = [];
        for (const p of packs) {
            const dir = path.join(cn, p.name);
            const row = {
                name: p.name, isGit: p.isGit, remote: p.remote,
                hasRequirements: p.hasRequirements, disabled: p.disabled,
                head: null, subject: null, date: null, branch: null,
                dirty: [], untracked: 0,
                behind: null, incoming: [], fetched: false, gitRefused: false,
                // Why this pack cannot be updated from here, in words.
                blocked: null,
            };
            if (!p.isGit) {
                // ★ 24 of this rig's 45 packs arrived through ComfyUI-Manager,
                // which unpacks a copy rather than cloning. Offering them an
                // Update button would be offering something that cannot work.
                row.blocked = 'not a git clone — ComfyUI-Manager unpacked it as a copy, so there is no '
                    + 'remote to pull from. Re-installing it by URL is what makes it updatable.';
                out.push(row);
                continue;
            }
            row.head = this._gitSync(dir, ['rev-parse', '--short', 'HEAD']);
            if (row.head == null && this._gitRefusedDir === dir) {
                // Nothing else git says about this folder can be read, and a
                // fetch would fail the same way and read as an unreachable remote.
                // Flagged so a check counts it as refused, not unreachable.
                row.blocked = SAFE_DIRECTORY_FIX;
                row.gitRefused = true;
                out.push(row);
                continue;
            }
            row.subject = this._gitSync(dir, ['log', '-1', '--format=%s']);
            row.date = this._gitSync(dir, ['log', '-1', '--format=%ad', '--date=short']);
            row.branch = this._gitSync(dir, ['rev-parse', '--abbrev-ref', 'HEAD']);
            const w = this._worktree(dir);
            row.dirty = w.dirty;
            row.untracked = w.untracked;

            if (doFetch) {
                const log = [];
                const code = await this._spawnQuiet('git', ['-C', dir, 'fetch', 'origin'],
                    { cwd: dir, timeout: GIT_TIMEOUT_MS, log });
                row.fetched = code === 0;
                if (!row.fetched) {
                    row.blocked = 'could not reach its remote, so what is available is unknown';
                }
            }
            const upstream = this._upstream(dir);
            if (upstream) {
                const n = this._gitSync(dir, ['rev-list', '--count', `HEAD..${upstream}`]);
                row.behind = n == null ? null : Number(n);
                if (row.behind > 0) {
                    row.incoming = (this._gitSync(dir, ['log', '--format=%h %s', `HEAD..${upstream}`]) || '')
                        .split(/\r?\n/).filter(Boolean).slice(0, 12);
                }
            } else if (!row.blocked) {
                row.blocked = 'no upstream branch is tracked, so there is nothing to compare against';
            }
            // ★ Refused up front, and worded as a state rather than a fault:
            // this is the pack the owner develops in place, and uncommitted work
            // is what a working copy looks like.
            if (!row.blocked && row.dirty.length) {
                row.blocked = `it has uncommitted changes (${row.dirty.slice(0, 4).join(', ')}`
                    + `${row.dirty.length > 4 ? `, +${row.dirty.length - 4} more` : ''}) — commit or stash `
                    + 'them first. This is a working copy, and a pull must not decide that for you.';
            }
            out.push(row);
        }
        return { ok: true, packs: out };
    }

    /**
     * What is installed, from the filesystem alone — no git, no network.
     *
     * ★ This is what the page load gets. `packStates({fetch:false})` looked
     * cheap because it makes no network call, but it is ~6 git subprocesses per
     * pack and there are 44 here: measured at **3.1 s per request**, during
     * which the card rendered as nothing at all. So the route answers instantly
     * with what is installed and which of it is a real clone, and the per-pack
     * commit, dirty state and behind-count arrive with the check that was going
     * to touch the network anyway.
     */
    installedPacks() {
        const cn = this._customNodes();
        if (!cn || !fs.existsSync(cn)) return [];
        return listInstalledPacks(this._root()).map(p => ({
            name: p.name, isGit: p.isGit, remote: p.remote,
            hasRequirements: p.hasRequirements, disabled: p.disabled,
            head: null, subject: null, date: null, branch: null,
            dirty: [], untracked: 0, behind: null, incoming: [], fetched: false,
            blocked: p.isGit ? null
                : 'not a git clone — ComfyUI-Manager unpacked it as a copy, so there is no '
                  + 'remote to pull from. Re-installing it by URL is what makes it updatable.',
        }));
    }

    /**
     * The packs as they stand locally — no network, briefly cached.
     *
     * ★ Called on every page load, so the card can show WHAT IS INSTALLED and
     * which of it is updatable before anyone presses Check. The first cut
     * returned nothing here and the pack list only appeared after a check, which
     * made the whole feature invisible by default — reported by the owner as
     * "I don't see the feature to update node packs". Being unable to say
     * whether a pack is BEHIND without the network is not a reason to hide the
     * pack.
     *
     * Cached because it is ~6 git reads per pack and there are 44 of them here.
     */
    async localPackStates() {
        const now = this._now();
        if (this._localCache && (now - this._localCache.at) < 10000) return this._localCache.value;
        const out = await this.packStates({ fetch: false });
        this._localCache = { at: now, value: out };
        return out;
    }

    /** Fast-forward one pack. Never a merge, never over local work. */
    async updatePack(folder) {
        const busy = this._busy();
        if (busy) return busy;
        const cn = this._customNodes();
        if (!cn) return { ok: false, error: 'no ComfyUI install is configured' };
        // ★ The folder is matched against what is actually on disk rather than
        // path-joined from the request: this string would otherwise reach git as
        // a directory argument, straight from a browser.
        const known = listInstalledPacks(this._root()).find(p => p.name === folder);
        if (!known) return { ok: false, error: 'no such node pack' };
        if (!known.isGit) {
            return { ok: false, error: `custom_nodes/${folder} is not a git clone — there is nothing to pull from` };
        }
        const dir = path.join(cn, folder);
        // ★ Claim the slot BEFORE the fetch below. It takes seconds, and the
        // run slot is only taken by _begin after it — so a second Update (this
        // pack, another pack, or ComfyUI itself) used to pass _busy() inside
        // that window, and the two runs overwrote each other's status and
        // Stop could only reach the last child.
        this._claim = folder;
        let before;
        try {
            before = await this.packStates({ fetch: true, only: folder });
        } finally {
            this._claim = null;
        }
        const row = before.ok ? before.packs[0] : null;
        if (row?.blocked) return { ok: false, error: row.blocked };
        if (row && row.behind === 0) {
            return { ok: true, upToDate: true, verdict: `${folder} is already up to date, at ${row.head}.` };
        }

        const run = this._begin(`pack:${folder}`, folder, 'git pull --ff-only');
        run.before = { head: row?.head, subject: row?.subject };
        run.incoming = row?.incoming || [];
        const reqBefore = readRequirements(dir);

        (async () => {
            // --ff-only: a pack whose history has diverged is reported, never
            // merged. Nothing is resolved on someone else's behalf here.
            const code = await this._spawn('git', ['-C', dir, 'pull', '--ff-only'],
                { cwd: dir, timeout: GIT_TIMEOUT_MS, run });
            run.after = {
                head: this._gitSync(dir, ['rev-parse', '--short', 'HEAD']),
                subject: this._gitSync(dir, ['log', '-1', '--format=%s']),
            };
            run.step = null;
            // A killed pull may still have moved HEAD: say where it is now, and
            // drop the cached list either way.
            if (run.stopping) {
                run.status = 'cancelled';
                run.moved = run.before.head !== run.after.head;
                run.needsRestart = run.moved;
                if (!run.after.head) {
                    // Unknown is not "did not move" — and restarting is the safe side.
                    run.verdict = `Stopped part-way, and where ${folder} now stands could not be read. `
                        + 'Read the output above and check the folder before restarting ComfyUI.';
                    invalidateNodePacks();
                    this._localCache = null;
                    return;
                }
                if (run.moved) {
                    const reqAfter = readRequirements(dir);
                    run.requirements = reqAfter;
                    run.requirementsChanged = reqBefore.lines.join('\n') !== reqAfter.lines.join('\n');
                    invalidateNodePacks();
                }
                run.verdict = run.moved
                    ? `Stopped part-way: ${folder} is now at ${run.after.head} (was ${run.before.head}). `
                        + 'Read the output above. ComfyUI must be restarted before it loads the new code.'
                        + (run.requirementsChanged
                            ? ' Its requirements.txt changed — read it before running pip.'
                            : '')
                    : `Stopped before anything moved — ${folder} is still at ${run.after.head}.`;
                this._localCache = null;
                return;
            }
            if (code !== 0) {
                // ★ Not "its history has diverged": that is one cause among
                // several (the remote unreachable, an untracked file in the way,
                // a timeout), and asserting it sent people looking for the
                // wrong thing. Say what is known.
                run.status = 'failed';
                run.error = `git pull --ff-only failed (exit ${code}) — read its output above. `
                    + (run.before.head && run.before.head === run.after.head
                        ? `The pack is still at ${run.after.head}. ` : '')
                    + 'A diverged history is never merged here; that one is for a person to resolve.';
                return;
            }
            const reqAfter = readRequirements(dir);
            run.status = 'done';
            run.moved = run.before.head !== run.after.head;
            run.needsRestart = run.moved;
            run.requirements = reqAfter;
            run.requirementsChanged = reqBefore.lines.join('\n') !== reqAfter.lines.join('\n');
            run.verdict = run.moved
                ? `${folder} updated ${run.before.head} → ${run.after.head}. ComfyUI must be `
                    + 'restarted before it loads the new code.'
                    + (run.requirementsChanged
                        ? ' Its requirements.txt changed — read it before running pip.'
                        : '')
                : `${folder} did not move; it was already at ${run.after.head}.`;
            invalidateNodePacks();
            this._localCache = null;
        })().catch(e => { run.status = 'failed'; run.error = e.message; });

        return { ok: true };
    }

    // ---------------------------------------------------------------- plumbing

    _busy() {
        if (this._run && this._run.status === 'running') {
            return { ok: false, error: `${this._run.label} is already being updated` };
        }
        if (this._claim) {
            return { ok: false, error: `${this._claim} is being checked against its remote before it updates` };
        }
        // ⚠ An update changes what the next prompt runs and is not live until
        // ComfyUI restarts. Neither belongs in the middle of a class.
        if (this._mode() !== 'admin') {
            return {
                ok: false,
                error: 'This machine is serving students. An update changes what the next job runs and '
                    + 'needs a ComfyUI restart to take effect, so run it from admin mode — Stop serving '
                    + 'first.',
            };
        }
        return null;
    }

    _begin(key, label, step) {
        this._run = {
            key, label, step, status: 'running', stopping: false,
            startedAt: new Date().toISOString(),
            output: [], error: null, verdict: null,
            before: null, after: null, incoming: [], moved: false,
            needsRestart: false, requirements: null, requirementsChanged: false,
        };
        return this._run;
    }

    stop() {
        const run = this._run;
        if (!run || run.status !== 'running') return { ok: false, error: 'nothing is running' };
        try { this._child?.kill(); } catch { /* already gone */ }
        // ★ The status stays 'running' until the child has really exited: the
        // run's own block then reads where the install landed and sets
        // 'cancelled' together with that. Flipping it here made the panel stop
        // polling before the after-state existed, so a stop that had already
        // moved HEAD read as just "cancelled", with no restart warning.
        run.stopping = true;
        run.step = 'stopping — waiting for it to exit';
        return { ok: true };
    }

    forget() {
        if (this._run && this._run.status === 'running') return { ok: false, error: 'it is still running' };
        this._run = null;
        return { ok: true };
    }

    /**
     * A short git read. Returns trimmed stdout, or null when git says no.
     * `_gitRefusedDir` is set to `cwd` when this read was refused over folder
     * ownership, and cleared by any other outcome, so the caller can tell that
     * case from an ordinary null on the very next line.
     */
    _gitSync(cwd, args) {
        this._gitRefusedDir = null;
        try {
            return execFileSync('git', ['-C', cwd, ...args], {
                encoding: 'utf8', timeout: 20000, windowsHide: true,
                // GIT_OPTIONAL_LOCKS=0 so a read never takes a lock in a repo
                // ComfyUI-Manager might be touching at the same moment.
                env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' },
            }).trim() || null;
        } catch (e) {
            if (isOwnershipRefusal(e && e.stderr)) this._gitRefusedDir = cwd;
            return null;
        }
    }

    /**
     * Tracked edits (by name) and the number of untracked files.
     *
     * ★ NOT parsed from `git status --porcelain`. Its first two columns are
     * the status code and the common case has a LEADING SPACE (" M nodes.py"),
     * so trimming the output — which every other read here wants — silently
     * shifts the filename and " M seed.txt" comes back as "eed.txt". These two
     * commands emit bare paths, so there is no column to lose. Found by the
     * test, not by reading it.
     */
    _worktree(dir) {
        const changed = this._gitSync(dir, ['diff', '--name-only', 'HEAD']);
        const others = this._gitSync(dir, ['ls-files', '--others', '--exclude-standard']);
        const clean = (t) => (t || '').split('\n').map(l => l.trim()).filter(Boolean);
        return { dirty: clean(changed), untracked: clean(others).length };
    }

    /** A spawn whose output goes to a throwaway array rather than the run log. */
    _spawnQuiet(cmd, args, { cwd, timeout, log }) {
        return this._spawn(cmd, args, { cwd, timeout, run: { output: log }, keepChild: false });
    }

    _spawn(cmd, args, { cwd, timeout, run, keepChild = true }) {
        return new Promise((resolve) => {
            let child;
            try {
                child = spawn(cmd, args, {
                    cwd,
                    // utf-8 for the reason the maintenance runner needs it too:
                    // Windows drops to cp1252 the moment stdout is a pipe, and
                    // both git and these scripts print characters it cannot
                    // encode — so a captured run dies where the same command
                    // works by hand.
                    env: {
                        ...process.env,
                        PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1',
                        GIT_TERMINAL_PROMPT: '0',
                    },
                    windowsHide: true,
                });
            } catch (e) {
                run.output.push(`could not start ${cmd}: ${e.message}`);
                return resolve(1);
            }
            if (keepChild) this._child = child;
            const timer = setTimeout(() => {
                run.output.push(`timed out after ${Math.round(timeout / 60000)} min`);
                try { child.kill(); } catch { /* already gone */ }
            }, timeout);
            const feed = (buf) => {
                for (const line of buf.toString('utf8').split(/\r?\n/)) {
                    if (line.trim()) {
                        run.output.push(line);
                        if (run.output.length > 400) run.output.splice(0, run.output.length - 400);
                    }
                }
            };
            child.stdout.on('data', feed);
            child.stderr.on('data', feed);
            // Only clear the handle if it is still ours: a stopped child that
            // closes late must not orphan the next run's child from Stop.
            const release = () => { if (keepChild && this._child === child) this._child = null; };
            child.on('error', (e) => {
                clearTimeout(timer);
                run.output.push(`${cmd} failed to start: ${e.message}`);
                release();
                resolve(1);
            });
            child.on('close', (code) => {
                clearTimeout(timer);
                release();
                resolve(code == null ? 1 : code);
            });
        });
    }

    _upstream(dir) {
        const u = this._gitSync(dir, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']);
        if (u) return u;
        // A `--depth 1` clone whose default branch was never checked out by name
        // still has origin/HEAD to compare against.
        return this._gitSync(dir, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
    }
}

module.exports = { Updater, tagRank, newestTag, comfyVerdict, comfyStoppedVerdict };
