// The launcher's dependency rules (node tools/deps-check.test.cjs).
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { decide, depsHash, supportedNode } = require('./deps-check.cjs');

const here = { hash: 'abc', abi: '137' };
assert.deepStrictEqual(decide(null, here), { install: true, rebuild: true }, 'no stamp: a first run');
assert.deepStrictEqual(decide({ hash: 'abc', abi: '137' }, here), { install: false, rebuild: false }, 'nothing changed: nothing runs');
assert.deepStrictEqual(decide({ hash: 'old', abi: '137' }, here), { install: true, rebuild: false }, 'a pull brought new dependencies');
assert.deepStrictEqual(decide({ hash: 'abc', abi: '147' }, here), { install: false, rebuild: true }, 'the drive moved to another Node');

for (const v of ['v22.0.0', 'v24.16.0', 'v26.13.0']) assert.ok(supportedNode(v), v);
for (const v of ['v20.19.0', 'v23.1.0', 'v25.0.0', 'v28.0.0']) assert.ok(!supportedNode(v), v);

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deps-check-'));
fs.mkdirSync(path.join(root, 'client'));
fs.mkdirSync(path.join(root, 'server'));
const write = (f, o) => fs.writeFileSync(path.join(root, f), JSON.stringify(o));
const base = { name: 'x', version: '1.0.0', scripts: { a: 'b' }, dependencies: { y: '^1.0.0' } };
for (const f of ['package.json', 'client/package.json', 'server/package.json']) write(f, base);
const first = depsHash(root);
write('package.json', { ...base, version: '2.0.0', scripts: { a: 'c' } });
assert.strictEqual(depsHash(root), first, 'a version or a script needs no install');
write('server/package.json', { ...base, dependencies: { y: '^2.0.0' } });
assert.notStrictEqual(depsHash(root), first, 'a dependency does');
fs.rmSync(root, { recursive: true, force: true });

console.log('deps-check: ok');
