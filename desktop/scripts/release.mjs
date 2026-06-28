// Release helper for ComfyQ Discovery.
//
// `npm version <type> --no-git-tag-version` (in the release:* scripts) bumps
// package.json + package-lock.json WITHOUT touching git — npm's built-in git
// commit/tag step has proven unreliable here (it silently skipped committing).
// This script does the git half explicitly so it either works or fails loudly:
// commit the version bump, create an annotated tag, and push branch + tag.
// Pushing the tag is what triggers .github/workflows/release.yml, which builds
// installers for every OS and publishes them to a GitHub Release.
//
// Run from the desktop/ folder, on the branch you release from (main):
//   npm run release:patch   (or release:minor / release:major)

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const run = (cmd) => execSync(cmd, { stdio: 'inherit' });
const capture = (cmd) => execSync(cmd, { encoding: 'utf8' }).trim();

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
const tag = `v${version}`;

const branch = capture('git rev-parse --abbrev-ref HEAD');
if (branch !== 'main') {
    console.warn(`\n⚠  You are on "${branch}", not "main". Releases should be cut from main.`);
    console.warn('   Aborting — checkout main and re-run.\n');
    process.exit(1);
}

console.log(`\nReleasing ${tag} from ${branch}…`);
// Stage only the version files, so an unrelated dirty file (e.g. config.json)
// is left untouched and out of the release commit.
run('git add package.json package-lock.json');
run(`git commit -m "desktop: release ${tag}"`);
run(`git tag -a ${tag} -m "ComfyQ Discovery ${tag}"`);
run('git push origin HEAD --follow-tags');
console.log(`\n✓ Pushed ${tag}. CI is now building + publishing the installers.`);
