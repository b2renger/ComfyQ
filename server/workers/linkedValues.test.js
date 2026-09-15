// Linked values — a param's choice also writes other node fields (a LoRA
// dropdown setting its trigger word).
//
// Run with:  node server/workers/linkedValues.test.js

const assert = require('assert');
const { LocalComfyUIWorker } = require('./localComfyUIWorker');

let fails = 0;
function test(name, fn) {
    try { fn(); console.log(`  ok   ${name}`); }
    catch (e) { console.error(`  FAIL ${name}\n       ${e.message}`); fails++; }
}

const materialize = (apiWorkflow, opts) =>
    LocalComfyUIWorker.prototype._materializeWorkflow.call({}, apiWorkflow, { inputs: [], filenamePrefix: 'x', ...opts });

const graph = () => ({
    lora: { class_type: 'LoraLoaderModelOnly', inputs: { lora_name: 'a.safetensors', strength_model: 1 } },
    trig: { class_type: 'StringConcatenate', inputs: { string_a: ['p', 0], string_b: 'OLD', delimiter: '' } },
});
const loraParam = {
    key: 'lora', nodeId: 'lora', field: 'lora_name', type: 'lora', default: 'a.safetensors',
    linkedValues: [
        { nodeId: 'trig', field: 'string_b', map: { 'a.safetensors': 'style a', 'b.safetensors': 'style b', 'plain.safetensors': '' }, fallback: '' },
        { nodeId: 'trig', field: 'delimiter', map: { 'a.safetensors': ', ', 'b.safetensors': ', ' }, fallback: '' },
    ],
};

test('the chosen value writes its mapped trigger and delimiter', () => {
    const wf = materialize(graph(), { exposedParameters: [loraParam], paramValues: { lora: 'b.safetensors' } });
    assert.strictEqual(wf.lora.inputs.lora_name, 'b.safetensors');
    assert.strictEqual(wf.trig.inputs.string_b, 'style b');
    assert.strictEqual(wf.trig.inputs.delimiter, ', ');
});

test('a value missing from the map writes the fallback', () => {
    const wf = materialize(graph(), { exposedParameters: [loraParam], paramValues: { lora: 'new.safetensors' } });
    assert.strictEqual(wf.trig.inputs.string_b, '');
    assert.strictEqual(wf.trig.inputs.delimiter, '');
});

test('an unsent value falls back to the param default', () => {
    const wf = materialize(graph(), { exposedParameters: [loraParam], paramValues: {} });
    assert.strictEqual(wf.trig.inputs.string_b, 'style a');
});

test('an exposed param on the same field overrides the linked value', () => {
    const own = { key: 'sep', nodeId: 'trig', field: 'delimiter', type: 'text' };
    const wf = materialize(graph(), { exposedParameters: [loraParam, own], paramValues: { lora: 'a.safetensors', sep: ' | ' } });
    assert.strictEqual(wf.trig.inputs.delimiter, ' | ');
});

test('no fallback leaves the graph literal alone', () => {
    const p = { ...loraParam, linkedValues: [{ nodeId: 'trig', field: 'string_b', map: { 'a.safetensors': 'style a' } }] };
    const wf = materialize(graph(), { exposedParameters: [p], paramValues: { lora: 'zzz.safetensors' } });
    assert.strictEqual(wf.trig.inputs.string_b, 'OLD');
});

test('the source graph is not mutated', () => {
    const g = graph();
    materialize(g, { exposedParameters: [loraParam], paramValues: { lora: 'b.safetensors' } });
    assert.strictEqual(g.trig.inputs.string_b, 'OLD');
});

if (fails) { console.error(`\n${fails} failing`); process.exit(1); }
console.log('\nall linked-values tests passed');
