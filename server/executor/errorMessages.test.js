// node server/executor/errorMessages.test.js
// The cases humanizeFailure rewrites, and the neighbours it must leave alone.
const assert = require('assert');
const { humanizeFailure } = require('./errorMessages');

let passed = 0;
const check = (name, fn) => { fn(); passed++; console.log('  ok  ' + name); };
const RAW_VSR = 'The size of tensor a (2312) must match the size of tensor b (1156) at non-singleton dimension 2';

console.log('errorMessages');
check('a square video in RelayVSR\'s decoder says what to do', () => {
    const m = humanizeFailure(RAW_VSR, 'VSRDecode');
    assert.ok(/square video/.test(m) && /non-square/.test(m), m);
});
check('the same tensor error on another node passes through verbatim', () => {
    assert.strictEqual(humanizeFailure(RAW_VSR, 'KSampler'), RAW_VSR);
});
check('another error in the decoder passes through verbatim', () => {
    const raw = 'CUDA out of memory. Tried to allocate 2.00 GiB';
    assert.strictEqual(humanizeFailure(raw, 'VSRDecode'), raw);
});
check('an unknown error is never swallowed', () => {
    assert.strictEqual(humanizeFailure('something new', 'SaveVideo'), 'something new');
});
console.log(`${passed} passed`);
