// node server/workers/promptFormat.test.js
const assert = require('assert');
const { formatPromptValue } = require('./promptFormat');
const { LocalComfyUIWorker } = require('./localComfyUIWorker');

const pretty = JSON.stringify({
    high_level_description: 'Un robot argenté — «calme»',
    style_description: { aesthetics: 'calm', lighting: 'soft', photo: '85mm', medium: 'photograph' },
    compositional_deconstruction: { background: 'A room.', elements: [{ type: 'obj', bbox: [1, 2, 3, 4], desc: 'A robot.' }] },
}, null, 4);

// Compacted, key order kept, non-ASCII written as-is.
const compact = formatPromptValue(pretty, 'ideogram4-caption');
assert.strictEqual(compact, JSON.stringify(JSON.parse(pretty)));
assert.ok(!compact.includes('\n') && !compact.includes('\\u'), 'no newlines, no \\u escapes');
assert.ok(compact.startsWith('{"high_level_description":'), 'key order kept');

// Left alone: other formats, plain text, broken JSON, arrays, non-strings.
assert.strictEqual(formatPromptValue(pretty, undefined), pretty);
assert.strictEqual(formatPromptValue('a cat on a sofa', 'ideogram4-caption'), 'a cat on a sofa');
assert.strictEqual(formatPromptValue('{ "a": 1, }', 'ideogram4-caption'), '{ "a": 1, }');
assert.strictEqual(formatPromptValue('[1, 2]', 'ideogram4-caption'), '[1, 2]');
assert.strictEqual(formatPromptValue(42, 'ideogram4-caption'), 42);

// Applied by the materializer to the param's node field.
const worker = Object.create(LocalComfyUIWorker.prototype);
const wf = worker._materializeWorkflow(
    { '98:24': { class_type: 'CLIPTextEncode', inputs: { text: 'x' } }, '1': { class_type: 'CLIPTextEncode', inputs: { text: 'y' } } },
    {
        paramValues: { cap: pretty, other: pretty },
        exposedParameters: [
            { key: 'cap', nodeId: '98:24', field: 'text', type: 'textarea', format: 'ideogram4-caption' },
            { key: 'other', nodeId: '1', field: 'text', type: 'textarea' },
        ],
        inputs: [],
        filenamePrefix: 'p',
    }
);
assert.strictEqual(wf['98:24'].inputs.text, compact);
assert.strictEqual(wf['1'].inputs.text, pretty, 'params without format are untouched');

console.log('promptFormat: all tests passed');
