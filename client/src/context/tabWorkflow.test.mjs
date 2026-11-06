// Which workflow a student tab follows (run: node client/src/context/tabWorkflow.test.mjs)
import assert from 'node:assert';
import { followTabWorkflow } from './tabWorkflow.js';

const lane = (id, primary = false) => ({ workflow_id: id, name: id.toUpperCase(), primary });
const info = (id) => (id ? { id, name: id.toUpperCase() } : { id: null, name: 'No workflow configured' });

// Run a tab through a series of broadcasts and report the switches its
// SocketContext would announce (the same rule as the effect there: a defined
// id that differs from the last defined one).
function switches(scopedWorkflowId, broadcasts) {
    const memory = { seen: false, wasPrimary: false };
    let last;
    const seen = [];
    for (const b of broadcasts) {
        const { id } = followTabWorkflow({ scopedWorkflowId, lanes: b.lanes, workflowInfo: b.workflow_info }, memory);
        if (id === undefined) continue;
        if (last !== undefined && last !== id) seen.push(`${last}->${id}`);
        last = id;
    }
    return seen;
}

let n = 0;
const check = (name, fn) => { fn(); n++; console.log(`ok ${n} - ${name}`); };

check('a tab Discovery opened on a single-lane rig follows a live switch of the main lane', () => {
    assert.deepStrictEqual(switches('a', [
        { lanes: [lane('a', true)], workflow_info: info('a') },
        { lanes: [lane('b', true)], workflow_info: info('b') },
    ]), ['a->b']);
});

check('… also when the switch passes through a moment with nothing served (as an unscoped tab would)', () => {
    assert.deepStrictEqual(switches('a', [
        { lanes: [lane('a', true)], workflow_info: info('a') },
        { lanes: [], workflow_info: info(null) },
        { lanes: [lane('b', true)], workflow_info: info('b') },
    ]), ['a->null', 'null->b']);
});

check('a tab on an EXTRA lane waits while a restart has reopened only the main lane', () => {
    assert.deepStrictEqual(switches('b', [
        { lanes: [lane('a', true), lane('b')], workflow_info: info('a') },
        { lanes: [lane('a', true)], workflow_info: info('a') },
        { lanes: [lane('a', true), lane('b')], workflow_info: info('a') },
    ]), []);
});

check('a tab on an extra lane is not told about a switch of the main lane', () => {
    assert.deepStrictEqual(switches('b', [
        { lanes: [lane('a', true), lane('b')], workflow_info: info('a') },
        { lanes: [lane('c', true), lane('b')], workflow_info: info('c') },
    ]), []);
});

check('an extra lane promoted to main, then replaced, takes the tab along', () => {
    assert.deepStrictEqual(switches('b', [
        { lanes: [lane('a', true), lane('b')], workflow_info: info('a') },
        { lanes: [lane('b', true)], workflow_info: info('b') },      // main lane closed, b is main now
        { lanes: [lane('c', true)], workflow_info: info('c') },      // live switch away from b
    ]), ['b->c']);
});

check('after the reload, a URL naming a lane that is gone follows the main lane quietly', () => {
    assert.deepStrictEqual(switches('a', [
        { lanes: [lane('b', true)], workflow_info: info('b') },
        { lanes: [lane('b', true)], workflow_info: info('b') },
    ]), []);
});

check('an unscoped tab follows the main lane', () => {
    assert.deepStrictEqual(switches(null, [
        { lanes: [lane('a', true)], workflow_info: info('a') },
        { lanes: [lane('b', true)], workflow_info: info('b') },
    ]), ['a->b']);
});

check('no state yet means no answer', () => {
    const r = followTabWorkflow({ scopedWorkflowId: 'a', lanes: undefined, workflowInfo: undefined }, { seen: false, wasPrimary: false });
    assert.strictEqual(r.id, undefined);
});

console.log(`tabWorkflow: ${n} checks passed`);
