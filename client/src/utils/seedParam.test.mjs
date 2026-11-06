// node client/src/utils/seedParam.test.mjs
// The client's seed rule against the list the server's rule is tested against
// (server/benchmark/vramWatch.test.js), so the two cannot drift apart.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { isSeedParam, randomSeed } from './seedParam.js';

const fixture = JSON.parse(fs.readFileSync(
    new URL('../../../server/benchmark/seedParam.fixture.json', import.meta.url), 'utf8'));

let n = 0;
const check = (name, fn) => { fn(); n++; console.log(`  ok  ${name}`); };
const asGiven = (p) => (p.keyOnly ? {} : { field: p.field });
const label = (p) => `${p.key} / ${p.keyOnly ? '(key only)' : p.field}`;

check('every fixture seed is a seed', () => {
    assert.ok(fixture.seeds.length > 0, 'the fixture lists seeds');
    for (const p of fixture.seeds) assert.equal(isSeedParam(p.key, asGiven(p)), true, label(p));
});

check('nothing in notSeeds is a seed (SeedVR2 colour correction included)', () => {
    assert.ok(fixture.notSeeds.length > 0, 'the fixture lists non-seeds');
    for (const p of fixture.notSeeds) assert.equal(isSeedParam(p.key, asGiven(p)), false, label(p));
});

check('no key, no config: not a seed', () => {
    assert.equal(isSeedParam(undefined, undefined), false);
    assert.equal(isSeedParam('', null), false);
});

// The server runs any seed above a param's max AT max, so a roll above it is a
// seed that never ran. Two bundles declare max 2147483647.
const roll = (config, times = 4000) => Array.from({ length: times }, () => randomSeed(config));

check('a fresh seed stays inside a declared max (2147483647)', () => {
    const seeds = roll({ min: 0, max: 2147483647, step: 1 });
    for (const s of seeds) {
        assert.ok(Number.isInteger(s), `integer: ${s}`);
        assert.ok(s >= 0 && s <= 2147483647, `in range: ${s}`);
    }
    // Spread over the range, not stuck at one value.
    assert.ok(new Set(seeds).size > 3900, 'seeds differ');
});

check('a fresh seed respects a declared min and a tiny range', () => {
    for (const s of roll({ min: 10, max: 12 }, 300)) assert.ok(s >= 10 && s <= 12, `in range: ${s}`);
    const seen = new Set(roll({ min: 10, max: 12 }, 300));
    assert.deepEqual([...seen].sort(), [10, 11, 12]);
    assert.equal(randomSeed({ min: 5, max: 5 }), 5);
});

check('no bounds: the 32-bit range the form always used', () => {
    for (const s of [...roll(undefined, 2000), ...roll({}, 2000)]) {
        assert.ok(Number.isInteger(s) && s >= 0 && s <= 4294967294, `in range: ${s}`);
    }
    // A max above 32 bits (4294967295 on SeedVR2) keeps the same ceiling.
    for (const s of roll({ min: 0, max: 4294967295 }, 2000)) assert.ok(s <= 4294967294);
});

console.log(`seedParam: ${n} checks passed`);
