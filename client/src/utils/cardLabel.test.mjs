// node client/src/utils/cardLabel.test.mjs
import assert from 'node:assert/strict';
import { cardLabel } from './cardLabel.js';

let n = 0;
const check = (name, fn) => { fn(); n++; console.log(`  ok  ${name}`); };

check('title and model, joined', () => {
    assert.equal(cardLabel({ title: 'Draft a longer video with sound', name: 'FastVideo FastH3 (8 steps)' }),
        'Draft a longer video with sound · FastVideo FastH3 (8 steps)');
});
check('a model alone (no title written yet)', () => {
    assert.equal(cardLabel({ name: 'Krea 2 Turbo' }), 'Krea 2 Turbo');
});
check('a title alone', () => {
    assert.equal(cardLabel({ title: 'Cover a song' }), 'Cover a song');
});
check('the same text twice is said once', () => {
    assert.equal(cardLabel({ title: 'SAM3', name: 'SAM3' }), 'SAM3');
});
check('nothing known: the fallback, then the ids', () => {
    assert.equal(cardLabel(null, 'video_x'), 'video_x');
    assert.equal(cardLabel({ workflow_id: 'lane_wf' }), 'lane_wf');
    assert.equal(cardLabel({ id: 'card_id' }), 'card_id');
    assert.equal(cardLabel(undefined), '');
});
check('blank fields count as missing', () => {
    assert.equal(cardLabel({ title: '  ', name: 'Model' }), 'Model');
});

console.log(`cardLabel: ${n} checks passed`);
