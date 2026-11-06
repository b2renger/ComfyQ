// node client/src/utils/paramLabels.test.mjs
import assert from 'node:assert/strict';
import { liveParamMap, labelMapFromExposed } from './paramLabels.js';

let n = 0;
const check = (name, fn) => { fn(); n++; console.log(`  ok  ${name}`); };

const laneMap = { lora_name_15: { label: 'Style LoRA', options: ['a.safetensors'], optionLabels: ['a'] } };
const primaryMap = { cliptextencode_text_6: { label: 'Prompt' } };
const state = {
    workflow_info: { id: 'wf_primary' },
    workflow: { parameter_map: primaryMap },
    lanes: [
        { workflow_id: 'wf_primary', parameter_map: primaryMap },
        { workflow_id: 'wf_lane', parameter_map: laneMap },
    ],
};

check('a served lane gives its own parameter_map', () => {
    assert.equal(liveParamMap(state, 'wf_lane'), laneMap);
});

check('the primary is found without a lanes list (older server)', () => {
    const s = { workflow_info: { id: 'wf_primary' }, workflow: { parameter_map: primaryMap } };
    assert.equal(liveParamMap(s, 'wf_primary'), primaryMap);
});

check('a workflow not served here has no live map', () => {
    assert.equal(liveParamMap(state, 'wf_other'), null);
    assert.equal(liveParamMap(state, null), null);
    assert.equal(liveParamMap(null, 'wf_lane'), null);
});

check('an empty lane map falls through rather than hiding the fetch', () => {
    const s = { lanes: [{ workflow_id: 'wf_x', parameter_map: {} }] };
    assert.equal(liveParamMap(s, 'wf_x'), null);
});

check('exposed parameters become key -> label, options, option labels', () => {
    const m = labelMapFromExposed([
        { key: 'ksampler_steps_459_458', label: 'Steps', enabled: true },
        { key: 'resolutionselector_aspect_ratio_13', label: 'Aspect ratio', options: ['1:1', '16:9'], optionLabels: ['Square', 'Wide'] },
        { key: 'old_field', label: 'Old field', enabled: false },
        { label: 'no key' },
        null,
    ]);
    assert.deepEqual(Object.keys(m), ['ksampler_steps_459_458', 'resolutionselector_aspect_ratio_13', 'old_field']);
    assert.equal(m.ksampler_steps_459_458.label, 'Steps');
    assert.deepEqual(m.resolutionselector_aspect_ratio_13.optionLabels, ['Square', 'Wide']);
    assert.equal(m.old_field.label, 'Old field');
});

check('a missing or malformed list gives an empty map', () => {
    assert.deepEqual(labelMapFromExposed(undefined), {});
    assert.deepEqual(labelMapFromExposed({ parameters: [] }), {});
});

console.log(`paramLabels: ${n} checks passed`);
