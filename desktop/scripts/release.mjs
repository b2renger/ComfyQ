// Release helper for ComfyQ Discovery.
//
// Usage (from the desktop/ folder, on main):
//   npm run release:patch   (or release:minor / release:major)
// which runs `node scripts/release.mjs <patch|minor|major>`.
//
// Order matters: every check runs BEFORE the version is bumped, so an abort
// leaves nothing behind — following "checkout main and re-run" no longer bumps
// twice and skips a version.
//
// The bump uses `npm version <type> --no-git-tag-version` (package.json +
// package-lock.json, no git) — npm's built-in git commit/tag step has proven
// unreliable here (it silently skipped committing). This script does the git
// half explicitly so it either works or fails loudly: commit the version bump,
// create an annotated tag, and push branch + tag. Pushing the tag is what
// triggers .github/workflows/release.yml, which builds installers for every OS
// and publishes them to a GitHub Release.

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const run = (cmd) => execSync(cmd, { stdio: 'inherit' });
const capture = (cmd) => execSync(cmd, { encoding: 'utf8' }).trim();
const succeeds = (cmd) => { try { execSync(cmd, { stdio: 'ignore' }); return true; } catch { return false; } };
const fail = (...lines) => { console.error(''); for (const l of lines) console.error(l); console.error(''); process.exit(1); };

const VERSION_FILES = 'package.json package-lock.json';
const type = process.argv[2];
if (!['patch', 'minor', 'major'].includes(type)) {
    fail('Usage: node scripts/release.mjs <patch|minor|major>  (or: npm run release:patch)');
}

const branch = capture('git rev-parse --abbrev-ref HEAD');
if (branch !== 'main') {
    fail(`⚠  You are on "${branch}", not "main". Releases should be cut from main.`,
        '   Aborting — nothing was changed. Checkout main and re-run.');
}
// The release commit must hold the version bump and nothing else: refuse if the
// version files already carry uncommitted edits (they would ride along).
if (!succeeds(`git diff --quiet HEAD -- ${VERSION_FILES}`)) {
    fail(`⚠  ${VERSION_FILES} have uncommitted changes.`,
        '   Aborting — nothing was changed. Commit or discard them, then re-run.');
}

run(`npm version ${type} --no-git-tag-version`);
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
const tag = `v${version}`;

console.log(`\nReleasing ${tag} from ${branch}…`);
// Commit ONLY the version files (a pathspec commit): anything else — a dirty
// config.json, or a file already staged for some other commit — stays out.
run(`git commit -m "desktop: release ${tag}" -- ${VERSION_FILES}`);
run(`git tag -a ${tag} -m "ComfyQ Discovery ${tag}"`);
run('git push origin HEAD --follow-tags');
console.log(`\n✓ Pushed ${tag}. CI is now building + publishing the installers.`);
