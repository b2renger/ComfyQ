#!/usr/bin/env node
/**
 * Keeps node_modules in step with the code, run by Start-ComfyQ.bat before every
 * start. A `git pull` can bring new dependencies, and the drive can move to a
 * machine on another Node: both used to end in a crash at boot.
 *
 * A stamp in node_modules/.comfyq-deps holds a hash of the dependency lists of the
 * three package.json files, and the Node ABI the native module was built for.
 *   - same stamp: nothing to do, and no cost beyond reading three small files;
 *   - lists changed: npm install;
 *   - ABI changed: better-sqlite3 is fetched again for this Node.
 * An install that fails (an offline rig) warns and starts anyway, as long as the
 * database module still loads. If it does not, ComfyQ cannot start, so this stops
 * with what to do. Exit code: 0 start, 1 do not start.
 *
 * The rules live here rather than in the .bat so they can be tested.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const SUPPORTED_MAJORS = [22, 24, 26];
const PACKAGES = ['package.json', 'client/package.json', 'server/package.json'];

/** The dependency lists only: a version bump or a script edit needs no install. */
function depsHash(root) {
    const lists = PACKAGES.map((f) => {
        const p = JSON.parse(fs.readFileSync(path.join(root, f), 'utf8'));
        return { f, deps: p.dependencies || {}, dev: p.devDependencies || {} };
    });
    return crypto.createHash('sha1').update(JSON.stringify(lists)).digest('hex').slice(0, 16);
}

function readStamp(root) {
    try { return JSON.parse(fs.readFileSync(path.join(root, 'node_modules', '.comfyq-deps'), 'utf8')); }
    catch { return null; }
}

function writeStamp(root, stamp) {
    fs.writeFileSync(path.join(root, 'node_modules', '.comfyq-deps'), JSON.stringify(stamp));
}

/** What has to happen, from the stamp and this machine. Pure, for the test. */
function decide(stamp, { hash, abi }) {
    return {
        install: !stamp || stamp.hash !== hash,
        rebuild: !stamp || stamp.abi !== abi,
    };
}

function supportedNode(version) {
    return SUPPORTED_MAJORS.includes(Number(String(version).replace(/^v/, '').split('.')[0]));
}

// In a child process: a binary built for another ABI throws at require, and in this
// process that require would be cached.
function databaseLoads(root) {
    const r = spawnSync(process.execPath, ['-e',
        `const D=require(${JSON.stringify(path.join(root, 'server', 'node_modules', 'better-sqlite3'))});new D(':memory:').close()`],
    { encoding: 'utf8' });
    return r.status === 0;
}

function npm(args, cwd) {
    console.log(`  npm ${args.join(' ')}`);
    const r = spawnSync('npm', args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
    return r.status === 0;
}

function main(root) {
    if (!supportedNode(process.version)) {
        console.error(`\n  ComfyQ supports Node ${SUPPORTED_MAJORS.join(', ')}, and this machine has ${process.version}.`);
        console.error('  Install the LTS build, which is a different winget package from plain OpenJS.NodeJS:\n');
        console.error('      winget install --id OpenJS.NodeJS.LTS --exact\n');
        return 1;
    }
    const here = { hash: depsHash(root), abi: process.versions.modules };
    const todo = decide(readStamp(root), here);
    if (!todo.install && !todo.rebuild) return 0;

    let ok = true;
    if (todo.install) {
        console.log('\n  Dependencies changed: installing.');
        ok = npm(['install', '--no-audit', '--no-fund'], root);
    }
    // npm install leaves a binary in place when the version did not change, so a
    // new Node needs this as well.
    if (todo.rebuild && !databaseLoads(root)) {
        console.log(`\n  The database module was built for another Node: fetching it for ${process.version}.`);
        ok = npm(['rebuild', 'better-sqlite3'], path.join(root, 'server')) && ok;
    }
    if (!databaseLoads(root)) {
        console.error('\n  The database module cannot load on this Node, so ComfyQ cannot start.');
        console.error('  Connect to the network and start again, or delete server/node_modules and run npm install.\n');
        return 1;
    }
    if (ok) writeStamp(root, here);
    else console.warn('\n  The install did not finish. Starting anyway with what is here: it runs again next time.\n');
    return 0;
}

if (require.main === module) process.exit(main(path.resolve(__dirname, '..')));
module.exports = { decide, depsHash, supportedNode };
