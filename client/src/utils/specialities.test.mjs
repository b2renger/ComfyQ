// node client/src/utils/specialities.test.mjs
import assert from 'node:assert/strict';
import { SPECIALITIES, specialityLabel, orderSpecialityExamples } from './specialities.js';

let n = 0;
const check = (name, fn) => { fn(); n++; console.log(`  ok  ${name}`); };

check('six fields, each with a key and a label', () => {
    assert.equal(SPECIALITIES.length, 6);
    assert.ok(SPECIALITIES.every(s => /^[a-z][a-z-]*$/.test(s.key) && s.label));
});
check('an unknown key is shown as it is, not hidden', () => {
    assert.equal(specialityLabel('uxui'), 'UX/UI design');
    assert.equal(specialityLabel('ceramics'), 'ceramics');
});
const jobs = [
    { id: 'a', speciality: 'industrial', time_slot: 2 },
    { id: 'b', speciality: 'scenography', time_slot: 1 },
    { id: 'c', speciality: 'industrial', time_slot: 1 },
    { id: 'd', speciality: 'uxui', time_slot: 1 },
];
check('the order of the list, two of one field numbered', () => {
    const o = orderSpecialityExamples(jobs);
    assert.deepEqual(o.map(x => x.job.id), ['b', 'c', 'a', 'd']);
    assert.deepEqual(o.map(x => x.label), ['Scenography', 'Industrial design 1', 'Industrial design 2', 'UX/UI design']);
});
check("the student's own field comes first and is marked", () => {
    const o = orderSpecialityExamples(jobs, 'uxui');
    assert.equal(o[0].job.id, 'd');
    assert.equal(o[0].mine, true);
    assert.ok(o.slice(1).every(x => !x.mine));
});

console.log(`specialities: ${n} checks passed`);
