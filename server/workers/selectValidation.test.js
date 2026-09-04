// Dropdown validation — checks a job's `select` values against the installed
// node before submit.
//
// Run with:  node server/workers/selectValidation.test.js
//
// No ComfyUI needed: the schema fetch is stubbed, which is the point — the rule
// has to behave the same whether ComfyUI answers, refuses, or is not there.

const assert = require('assert');
const { validateSelects, resolveValue, ratioKey } = require('./selectValidation');
const nodeSchema = require('./nodeSchema');
const { humanizeSubmitRejection } = require('../executor/errorMessages');

let fails = 0;
function test(name, fn) {
    try { fn(); console.log(`  ok   ${name}`); }
    catch (e) { console.error(`  FAIL ${name}\n       ${e.message}`); fails++; }
}
async function atest(name, fn) {
    try { await fn(); console.log(`  ok   ${name}`); }
    catch (e) { console.error(`  FAIL ${name}\n       ${e.message}`); fails++; }
}

// The real ResolutionSelector list, read from the rig.
const LIVE_ASPECT = [
    '1:1 (Square)', '2:3 (Portrait Photo)', '3:2 (Photo)', '3:4 (Portrait Standard)',
    '4:3 (Standard)', '9:16 (Portrait Widescreen)', '16:9 (Widescreen)', '21:9 (Ultrawide)'
];

// A stub ComfyUI. `schemas` maps class_type → the /object_info payload.
function stubRest(schemas, { throwOn = null } = {}) {
    return {
        calls: 0,
        async getObjectInfo(classType) {
            this.calls++;
            if (throwOn && throwOn === classType) throw new Error('ECONNREFUSED');
            if (!(classType in schemas)) throw new Error('404');
            return { [classType]: schemas[classType] };
        }
    };
}
const comboSchema = (field, options) => ({ input: { required: { [field]: ['COMBO', { options }] } } });
// The older declaration shape, still in the wild.
const legacyComboSchema = (field, options) => ({ input: { required: { [field]: [options, {}] } } });

console.log('\nthe snap-or-refuse rule');

test('a value the node offers is left alone', () => {
    assert.deepStrictEqual(resolveValue('16:9 (Widescreen)', LIVE_ASPECT), { action: 'keep' });
});

test('the same ratio under a different label is snapped', () => {
    // The exact bug: the bundle said "Landscape Widescreen", the node says
    // "Widescreen". Same choice, different name.
    const v = resolveValue('16:9 (Landscape Widescreen)', LIVE_ASPECT);
    assert.strictEqual(v.action, 'snap');
    assert.strictEqual(v.to, '16:9 (Widescreen)');
    assert.strictEqual(v.why, 'same ratio');
});

test('an older label for the same ratio is snapped too', () => {
    assert.strictEqual(resolveValue('4:3 (Landscape)', LIVE_ASPECT).to, '4:3 (Standard)');
    assert.strictEqual(resolveValue('3:4 (Portrait)', LIVE_ASPECT).to, '3:4 (Portrait Standard)');
});

test('a difference of case or punctuation is snapped', () => {
    assert.strictEqual(resolveValue('1:1 (SQUARE)', LIVE_ASPECT).to, '1:1 (Square)');
    assert.strictEqual(resolveValue('21:9  Ultrawide', LIVE_ASPECT).to, '21:9 (Ultrawide)');
});

test('a value with no counterpart FAILS rather than picking something near it', () => {
    // 5:4 is closest to 1:1, but rendering a square when a 5:4 was asked for is
    // exactly the silent-wrong-output this whole guard exists to prevent.
    for (const bad of ['banana', '5:4 (Unusual)']) {
        const v = resolveValue(bad, LIVE_ASPECT);
        assert.strictEqual(v.action, 'fail', bad);
        assert.deepStrictEqual(v.options, LIVE_ASPECT);
    }
});

test('an ambiguous ratio is refused, not guessed', () => {
    const two = ['16:9 (TV)', '16:9 (Cinema)'];
    assert.strictEqual(resolveValue('16:9 (Widescreen)', two).action, 'fail');
});

test('a node that publishes no list is never second-guessed', () => {
    // CustomCombo keeps its choices in the workflow's widget values, so an
    // empty list means "cannot check", NOT "nothing is valid".
    for (const empty of [[], null, undefined]) {
        assert.deepStrictEqual(resolveValue('Music', empty), { action: 'keep' });
    }
});

test('ratioKey reads a leading ratio and nothing else', () => {
    assert.strictEqual(ratioKey('16:9 (Widescreen)'), '16:9');
    assert.strictEqual(ratioKey('  4 : 3 (Standard)'), '4:3');
    assert.strictEqual(ratioKey('Turbo'), null);
    assert.strictEqual(ratioKey('shot on 35mm'), null);
});

console.log('\nvalidating a whole job');

const IDEOGRAM_WF = {
    37: { class_type: 'ResolutionSelector', inputs: { aspect_ratio: '9:16 (Portrait Widescreen)' } },
    99: { class_type: 'CustomCombo', inputs: { choice: 'Default' } }
};
const IDEOGRAM_PARAMS = [
    { key: 'aspect', nodeId: '37', field: 'aspect_ratio', type: 'select', label: 'Aspect ratio', options: [] },
    { key: 'quality', nodeId: '99', field: 'choice', type: 'select', label: 'Quality preset', options: [] },
    { key: 'prompt', nodeId: '37', field: 'text', type: 'textarea', label: 'Prompt' }
];

(async () => {
    await atest('the stale value is corrected and the dynamic combo untouched', async () => {
        nodeSchema.clearCache();
        const rest = stubRest({
            ResolutionSelector: comboSchema('aspect_ratio', LIVE_ASPECT),
            CustomCombo: { input: { required: { choice: ['COMBO', {}] } } }   // publishes nothing
        });
        const r = await validateSelects({
            apiWorkflow: IDEOGRAM_WF, exposedParameters: IDEOGRAM_PARAMS,
            paramValues: { aspect: '16:9 (Landscape Widescreen)', quality: 'Turbo', prompt: 'a card' },
            rest
        });
        assert.deepStrictEqual(r.errors, []);
        assert.strictEqual(r.paramValues.aspect, '16:9 (Widescreen)');
        assert.strictEqual(r.paramValues.quality, 'Turbo', 'a CustomCombo value was altered');
        assert.strictEqual(r.paramValues.prompt, 'a card');
        assert.strictEqual(r.adjustments.length, 1);
        assert.strictEqual(r.adjustments[0].key, 'aspect');
    });

    await atest('the original values object is not mutated', async () => {
        nodeSchema.clearCache();
        const rest = stubRest({ ResolutionSelector: comboSchema('aspect_ratio', LIVE_ASPECT) });
        const original = { aspect: '16:9 (Landscape Widescreen)' };
        const r = await validateSelects({
            apiWorkflow: IDEOGRAM_WF, exposedParameters: IDEOGRAM_PARAMS, paramValues: original, rest
        });
        assert.strictEqual(original.aspect, '16:9 (Landscape Widescreen)');
        assert.notStrictEqual(r.paramValues, original);
    });

    await atest('an unusable value produces an error naming the valid ones', async () => {
        nodeSchema.clearCache();
        const rest = stubRest({ ResolutionSelector: comboSchema('aspect_ratio', LIVE_ASPECT) });
        const r = await validateSelects({
            apiWorkflow: IDEOGRAM_WF, exposedParameters: IDEOGRAM_PARAMS,
            paramValues: { aspect: '5:4 (Nope)' }, rest
        });
        assert.strictEqual(r.errors.length, 1);
        assert.match(r.errors[0], /Aspect ratio/);
        assert.match(r.errors[0], /16:9 \(Widescreen\)/);
        assert.match(r.errors[0], /meta\.json/);
    });

    await atest('ComfyUI being unreachable never blocks a job', async () => {
        nodeSchema.clearCache();
        const rest = stubRest({}, { throwOn: 'ResolutionSelector' });
        const r = await validateSelects({
            apiWorkflow: IDEOGRAM_WF, exposedParameters: IDEOGRAM_PARAMS,
            paramValues: { aspect: 'anything at all' }, rest
        });
        assert.deepStrictEqual(r.errors, []);
        assert.strictEqual(r.paramValues.aspect, 'anything at all');
    });

    await atest('no rest client at all is a no-op', async () => {
        const values = { aspect: '16:9 (Landscape Widescreen)' };
        const r = await validateSelects({
            apiWorkflow: IDEOGRAM_WF, exposedParameters: IDEOGRAM_PARAMS, paramValues: values, rest: null
        });
        assert.deepStrictEqual(r.errors, []);
        assert.strictEqual(r.paramValues.aspect, '16:9 (Landscape Widescreen)');
    });

    await atest('the legacy [[options], {}] declaration shape is understood', async () => {
        nodeSchema.clearCache();
        const rest = stubRest({ ResolutionSelector: legacyComboSchema('aspect_ratio', LIVE_ASPECT) });
        const r = await validateSelects({
            apiWorkflow: IDEOGRAM_WF, exposedParameters: IDEOGRAM_PARAMS,
            paramValues: { aspect: '16:9 (Landscape Widescreen)' }, rest
        });
        assert.strictEqual(r.paramValues.aspect, '16:9 (Widescreen)');
    });

    await atest('the schema is fetched once per node type, not once per job', async () => {
        nodeSchema.clearCache();
        const rest = stubRest({ ResolutionSelector: comboSchema('aspect_ratio', LIVE_ASPECT) });
        for (let i = 0; i < 5; i++) {
            await validateSelects({
                apiWorkflow: IDEOGRAM_WF, exposedParameters: IDEOGRAM_PARAMS,
                paramValues: { aspect: '16:9 (Widescreen)' }, rest
            });
        }
        // ResolutionSelector once, plus CustomCombo's 404 retried on the short
        // miss TTL — what must NOT happen is one fetch per job per parameter.
        assert.ok(rest.calls <= 6, `fetched ${rest.calls} times`);
    });

    await atest('a failed lookup is retried soon, not cached for the full TTL', async () => {
        assert.ok(nodeSchema.MISS_TTL_MS < nodeSchema.TTL_MS / 10,
            'a miss must expire far sooner than a hit');
        nodeSchema.clearCache();
        let up = false;
        const flaky = {
            async getObjectInfo(cls) {
                if (!up) throw new Error('busy loading a model');
                return { [cls]: comboSchema('aspect_ratio', LIVE_ASPECT) };
            }
        };
        const args = {
            apiWorkflow: IDEOGRAM_WF, exposedParameters: IDEOGRAM_PARAMS,
            paramValues: { aspect: '16:9 (Landscape Widescreen)' }, rest: flaky
        };
        let r = await validateSelects(args);
        assert.strictEqual(r.paramValues.aspect, '16:9 (Landscape Widescreen)', 'should pass through while down');
        up = true;
        nodeSchema.clearCache();           // stands in for the miss TTL elapsing
        r = await validateSelects(args);
        assert.strictEqual(r.paramValues.aspect, '16:9 (Widescreen)', 'should correct once ComfyUI answers');
    });

    console.log('\nthe rejection message');

    test('a value_not_in_list rejection reads as a sentence, not JSON', () => {
        const payload = {
            error: { type: 'prompt_outputs_failed_validation', message: 'Prompt outputs failed validation' },
            node_errors: {
                37: {
                    class_type: 'ResolutionSelector',
                    errors: [{
                        type: 'value_not_in_list', message: 'Value not in list',
                        details: "aspect_ratio: '16:9 (Landscape Widescreen)' not in [...]",
                        extra_info: {
                            input_name: 'aspect_ratio',
                            received_value: '16:9 (Landscape Widescreen)',
                            input_config: ['COMBO', { options: LIVE_ASPECT }]
                        }
                    }]
                }
            }
        };
        const msg = humanizeSubmitRejection(payload);
        assert.match(msg, /ResolutionSelector/);
        assert.match(msg, /node 37/);
        assert.match(msg, /aspect_ratio/);
        assert.match(msg, /16:9 \(Landscape Widescreen\)/);
        assert.match(msg, /16:9 \(Widescreen\)/);
        assert.match(msg, /out of date/);
        assert.ok(!msg.includes('{'), 'still leaking raw JSON');
    });

    test('an unrecognised rejection is passed through, never swallowed', () => {
        assert.match(humanizeSubmitRejection({ error: { message: 'something odd' } }), /something odd/);
        const weird = humanizeSubmitRejection({ mystery: 1 });
        assert.match(weird, /prompt rejected/);
        assert.match(weird, /mystery/);
    });

    test('a non-combo node error still names its node', () => {
        const msg = humanizeSubmitRejection({
            node_errors: { 12: { class_type: 'KSampler', errors: [{ type: 'required_input_missing', details: 'model' }] } }
        });
        assert.match(msg, /KSampler/);
        assert.match(msg, /node 12/);
        assert.match(msg, /model/);
    });

    console.log(fails ? `\n${fails} FAILURE(S)\n` : '\nall dropdown-validation checks passed\n');
    process.exitCode = fails ? 1 : 0;
})();
