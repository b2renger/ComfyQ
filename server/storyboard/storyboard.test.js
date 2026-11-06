// Storyboard batch — end-to-end test with no ComfyUI and no HTTP server.
//
// Run with:  node server/storyboard/storyboard.test.js
//
// Covers the whole chain the feature rests on: parse → plan → queue (with
// job_deps) → dependency-aware findReady → chained-input staging into
// ComfyUI/input → cascade failure. Deliberately dependency-free (no test
// runner) so it works on a workshop rig with nothing installed.

const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const { parseStoryboard } = require('./storyboardParser');
const { planStoryboard, predictOutputKind, isSeed } = require('./storyboardPlanner');
const { resolveWorkflowAlias, buildIndex } = require('./workflowResolver');
const { WorkflowRegistry } = require('../workflows/workflowRegistry');
const { JobQueue } = require('../queue/jobQueue');
const { resolveChainedInputs, pickOutput } = require('../executor/chainedInputs');
const sm = require('../queue/jobStateMachine');

const REPO = path.resolve(__dirname, '..', '..');
const EXAMPLE = path.join(REPO, 'server', 'storyboard', 'fixtures', 'example.md');

let passed = 0;
function test(name, fn) {
    try { fn(); console.log(`  ok   ${name}`); passed++; }
    catch (e) { console.error(`  FAIL ${name}\n       ${e.message}`); process.exitCode = 1; }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'comfyq-storyboard-'));
const comfyConfig = {
    root_path: path.join(tmp, 'comfy'),
    output_dir: path.join(tmp, 'comfy', 'output')
};
fs.mkdirSync(path.join(comfyConfig.root_path, 'input'), { recursive: true });
fs.mkdirSync(comfyConfig.output_dir, { recursive: true });

const registry = new WorkflowRegistry(path.join(REPO, 'workflows'));
registry.discover();

// ---------------------------------------------------------------- parsing
console.log('\nparser');
const md = fs.readFileSync(EXAMPLE, 'utf8');
const parsed = parseStoryboard(md);

test('reads every section and item', () => {
    assert.strictEqual(parsed.items.length, 42);
    assert.deepStrictEqual(parsed.states.map(s => s.id),
        ['LIBRARY', 'IDLE', 'S0', 'S1_A', 'S1_B', 'E01', 'E02', 'E03', 'NOTES']);
    assert.deepStrictEqual(parsed.warnings, []);
    assert.deepStrictEqual(parsed.errors, []);
});

test('a prose-only section contributes no generations', () => {
    assert.strictEqual(parsed.items.filter(i => i.stateId === 'NOTES').length, 0);
});

test('anchors are addressable and refs are read', () => {
    assert.strictEqual(parsed.items[2].anchorKey, 'A3');
    assert.deepStrictEqual(parsed.items[6].refs, ['A3']);
});

test('every line ending parses identically', () => {
    const lf = md.replace(/\r\n/g, '\n');
    for (const [name, doc] of [['CRLF', lf.replace(/\n/g, '\r\n')],
                               ['lone CR', lf.replace(/\n/g, '\r')],
                               ['LF', lf]]) {
        const r = parseStoryboard(doc);
        assert.strictEqual(r.items.length, parsed.items.length, name);
        assert.strictEqual(r.items[6].prompt, parsed.items[6].prompt, name);
        assert.deepStrictEqual(r.errors, [], name);
    }
});

test('a fenced code block never reshapes the batch', () => {
    const doc = '# S | scene | -\n\n## Plate\n### image_flux2_klein_9b_t2i\nA plate.\n\n' +
        '```bash\n# not a heading\n## also not\n```\n\nmore prompt';
    const r = parseStoryboard(doc);
    assert.deepStrictEqual(r.states.map(s => s.id), ['S']);
    assert.strictEqual(r.items.length, 1);
    assert.match(r.items[0].prompt, /# not a heading/);
});

test('a prose line read as a section heading is flagged', () => {
    const doc = '# S | scene | -\n\n## Plate\n### image_flux2_klein_9b_t2i\nA plate.\n# 35mm lens, overcast\n';
    assert.match(parseStoryboard(doc).warnings.join(' '), /was read as a new section/);
});

test('trailing text after the workflow line does not delete the generation', () => {
    for (const h3 of ['### image_flux2_klein_9b_t2i ###', '### image_flux2_klein_9b_t2i (ref A1) - hero shot']) {
        const r = parseStoryboard('# S | scene | -\n\n## Plate\n' + h3 + '\nA plate.');
        assert.strictEqual(r.items.length, 1, h3);
        assert.strictEqual(r.items[0].workflowAlias, 'image_flux2_klein_9b_t2i', h3);
    }
});

test('an indented heading is still a heading, and #### is not swallowed', () => {
    const r = parseStoryboard('  # S | scene | -\n\n  ## Plate\n  ### image_flux2_klein_9b_t2i\nA plate.\n#### Notes\nignored');
    assert.strictEqual(r.items.length, 1);
    assert.match(r.warnings.join(' '), /deeper than the format uses/);
    assert.ok(!/Notes/.test(r.items[0].prompt));
});

test('a decorated anchor title keeps its anchor', () => {
    const r = parseStoryboard('# S | scene | -\n\n## \u{1F3AC} Anchor image 2\n### image_flux2_klein_9b_t2i\nplate');
    assert.strictEqual(r.items[0].anchorKey, 'A2');
});

test('an unnamed optional slot stays empty, as in the booking form', () => {
    const doc = '# S | scene | -\n\n' +
        '## Reference image 1\n### image_flux2_klein_9b_t2i | 1280x704\nfirst\n\n' +
        '## Reference image 2\n### image_flux2_klein_9b_t2i | 1280x704\nsecond\n\n' +
        '## Video cut 1\n### video_fastvideo_fasth3_i2v\nmoves\n\n' +
        '## Video cut 2\n### video_fastvideo_fasth3_i2v\nmoves on\n';
    const p = planStoryboard(parseStoryboard(doc), registry, { userId: 't', startAt: 1, spacing: 'asap', outputFolder: 'x' });
    assert.deepStrictEqual(p.errors, []);
    const cut1 = p.jobs.find(j => j.title === 'Video cut 1');
    const cut2 = p.jobs.find(j => j.title === 'Video cut 2');
    assert.strictEqual(cut1.deps.length, 1, 'a cut takes its own key frame, not the next one as a last frame');
    assert.match(cut1.deps[0].sourceTitle, /Reference image 1/);
    assert.match(cut2.deps[0].sourceTitle, /Reference image 2/);
    assert.strictEqual(cut2.deps.length, 1);
});

test('a loop still drives every frame input, optional or not', () => {
    const doc = '# S | scene | -\n\n' +
        '## Reference image 1\n### image_flux2_klein_9b_t2i | 1280x704\nfirst\n\n' +
        '## Video cut 1 (loop)\n### video_fastvideo_fasth3_i2v\nmoves\n';
    const p = planStoryboard(parseStoryboard(doc), registry, { userId: 't', startAt: 1, spacing: 'asap', outputFolder: 'x' });
    assert.strictEqual(p.jobs.find(j => /Video cut 1/.test(j.title)).deps.length, 2);
});

test('one anchor fills one slot of a card whose others are optional', () => {
    const doc = '# LIBRARY | library | -\n\n## Anchor image 1\n### image_flux2_klein_9b_t2i | 1024x1024\na plate\n\n' +
        '# S | scene | -\n\n## Reference image 1\n### image_krea2_turbo_style_reference | ref A1\na lighthouse\n';
    const p = planStoryboard(parseStoryboard(doc), registry, { userId: 't', startAt: 1, spacing: 'asap', outputFolder: 'x' });
    assert.deepStrictEqual(p.errors, []);
    assert.strictEqual(p.jobs.find(j => j.title === 'Reference image 1').deps.length, 1, 'Krea takes style refs 2 and 3 only when they are named');
});

test('prose sent to an Ideogram caption field is warned about', () => {
    const doc = '# S | scene | -\n\n## Reference image 1\n### image_ideogram4_t2i | 1280x704\nTHE END, in white letters\n';
    const p = planStoryboard(parseStoryboard(doc), registry, { userId: 't', startAt: 1, spacing: 'asap', outputFolder: 'x' });
    assert.ok(p.warnings.some(w => /plain prose/.test(w)), JSON.stringify(p.warnings));
});

test('a second ### under one ## is an error, not a silent overwrite', () => {
    const r = parseStoryboard('# S | scene | -\n\n## Plate\n### image_flux2_klein_9b_t2i\none\n### ltx_2_5_i2v\ntwo');
    assert.strictEqual(r.items[0].workflowAlias, 'image_flux2_klein_9b_t2i');
    assert.match(r.errors.join(' '), /already names workflow/);
});

test('an item with no workflow line is an error, not a dropped shot', () => {
    const r = parseStoryboard('# S | scene | -\n\n## Good\n### image_flux2_klein_9b_t2i\nyes\n\n## Orphan\njust prose');
    assert.strictEqual(r.items.length, 1);
    assert.match(r.errors.join(' '), /no "### <workflow>" line/);
});

test('an empty document is refused, not silently queued', () => {
    assert.throws(() => parseStoryboard('   '), /empty/i);
    assert.throws(() => parseStoryboard('# ONLY | scene | -\n\nprose'), /No generations/i);
});

// -------------------------------------------------------------- resolving
console.log('\nworkflow alias resolution');
const index = buildIndex(registry);
test('short names resolve to real bundle ids', () => {
    assert.strictEqual(resolveWorkflowAlias('ltx_2_5_i2v', registry, index).id, 'video_ltx2_5_i2v');
    assert.strictEqual(resolveWorkflowAlias('stable_audio_3', registry, index).id, 'audio_stable_audio_3_medium');
    assert.strictEqual(resolveWorkflowAlias('ideogram_4_t2i', registry, index).id, 'image_ideogram4_t2i');
});
test('an ambiguous name is refused, never guessed', () => {
    // Count-agnostic: the library grows (a new LTX 2.5 bundle must not break this).
    assert.throws(() => resolveWorkflowAlias('ltx2_5', registry, index), /matches \d+ workflows/);
});
test('an unknown name names the problem', () => {
    assert.throws(() => resolveWorkflowAlias('does_not_exist', registry, index), /no workflow named/);
});

// --------------------------------------------------------------- planning
console.log('\nplanner');
const plan = planStoryboard(parsed, registry, { startAt: 1_700_000_000_000 });

test('plans every item with no errors', () => {
    assert.deepStrictEqual(plan.errors, []);
    assert.strictEqual(plan.jobs.length, 42);
});

test('a single ref filling two differently-named slots is flagged', () => {
    // image_edit_flux2_klein_9b_image_edit_ref has a "Source image" AND a "Reference
    // image"; "(ref A3)" puts the same anchor in both, so the model edits the
    // anchor instead of bringing it into another shot. Silent before, and the
    // exact thing that reads as "my anchors were not passed as references".
    const edits = plan.jobs.filter(j => j.workflowId === 'image_edit_flux2_klein_9b_image_edit_ref');
    assert.strictEqual(edits.length, 11);
    const flagged = plan.warnings.filter(w => /used for BOTH/.test(w));
    assert.strictEqual(flagged.length, edits.length, plan.warnings.join(' | '));
    assert.match(flagged[0], /Source image.*Reference image/);
    assert.match(flagged[0], /ref <shot to edit>/);
    // ...and nothing else warns on this document.
    assert.strictEqual(plan.warnings.length, flagged.length, plan.warnings.join(' | '));
});

test('each shot is named from its own headings, under one folder', () => {
    const p = planStoryboard(parsed, registry, { outputFolder: 'The Red Thread' });
    assert.strictEqual(p.jobs[0].outputPrefix,
        'The-Red-Thread/001_LIBRARY__Anchor-image-1__image_flux2_klein_9b_t2i');
    // Unique, sortable, and safe as a path on Windows.
    const prefixes = p.jobs.map(j => j.outputPrefix);
    assert.strictEqual(new Set(prefixes).size, prefixes.length);
    for (const pre of prefixes) {
        assert.ok(!/[<>:"\|?*]/.test(pre), pre);
        assert.ok(!/(^|\/)[.\s]|[.\s](\/|$)/.test(pre), pre);
        assert.strictEqual(pre.split('/').length, 2, pre);
    }
    // No folder given -> a bare name, no leading slash.
    const flat = planStoryboard(parsed, registry, {});
    assert.ok(!flat.jobs[0].outputPrefix.includes('/'), flat.jobs[0].outputPrefix);
});

test('phases run images, then videos, then audio', () => {
    assert.deepStrictEqual(plan.phases.map(p => [p.label, p.count]),
        [['images', 22], ['videos', 11], ['audio', 9]]);
    const phases = plan.jobs.map(j => j.phase);
    assert.deepStrictEqual(phases, [...phases].sort((a, b) => a - b), 'phases are not contiguous');
});

test('every video consumes an image planned before it', () => {
    const pos = new Map(plan.jobs.map((j, i) => [j.itemIndex, i]));
    const videos = plan.jobs.filter(j => j.phase === 1);
    assert.ok(videos.length > 0);
    for (const v of videos) {
        assert.ok(v.deps.length > 0, `${v.title} has no frame input`);
        for (const d of v.deps) {
            assert.ok(pos.get(d.sourceItemIndex) < pos.get(v.itemIndex),
                `${v.title} runs before the image it needs`);
        }
    }
});

test('an anchor is always planned before the edit that references it', () => {
    const pos = new Map(plan.jobs.map((j, i) => [j.itemIndex, i]));
    for (const j of plan.jobs) {
        for (const d of j.deps) assert.ok(pos.get(d.sourceItemIndex) < pos.get(j.itemIndex));
    }
});

test('every media input a workflow declares is actually bound', () => {
    for (const j of plan.jobs) {
        const entry = registry.get(j.workflowId);
        const media = entry.effective.exposedParameters
            .filter(p => p.enabled !== false && ['image', 'mask', 'video', 'audio'].includes(p.type));
        // The only unbound media inputs allowed are ones the planner warned about.
        const bound = new Set(j.deps.map(d => d.paramKey));
        for (const p of media) {
            assert.ok(bound.has(p.key), `${j.stateId}/${j.title}: "${p.label}" left unbound`);
        }
    }
});

test('the loop cut drives both frame slots from one image', () => {
    const loop = plan.jobs.find(j => j.title.includes('loop'));
    assert.strictEqual(loop.workflowId, 'video_ltx2_5_flf2v');
    assert.strictEqual(loop.deps.length, 2);
    assert.strictEqual(loop.deps[0].sourceItemIndex, loop.deps[1].sourceItemIndex);
});

test('the prompt lands on the workflow\'s own text field', () => {
    const t2i = plan.jobs.find(j => j.workflowId === 'image_flux2_klein_9b_t2i');
    assert.strictEqual(t2i.promptParamKey, 'primitivestringmultiline_value_76');
    assert.ok(t2i.paramValues[t2i.promptParamKey].startsWith('A three-panel character sheet'));
    // ...and never on the negative one.
    assert.ok(!('cliptextencode_text_75_67' in t2i.paramValues));
});

test('every job gets its own seed so nothing hits ComfyUI\'s result cache', () => {
    const seeds = plan.jobs
        .map(j => Object.entries(j.paramValues).find(([k]) => /seed/i.test(k))?.[1])
        .filter(v => v != null);
    assert.strictEqual(seeds.length, plan.jobs.length);
    assert.ok(new Set(seeds).size > plan.jobs.length * 0.9, 'seeds are not distinct');
});

test('a leading TrackType directive sets the audio category and leaves the prompt clean', () => {
    const sfx = plan.jobs.find(j => j.title === 'Ambience 1');
    const music = plan.jobs.find(j => j.stateId === 'IDLE' && j.title === 'Music');
    assert.strictEqual(sfx.paramValues.category_52_43, 'SFX');
    assert.ok(!/TrackType/.test(sfx.prompt));
    assert.strictEqual(music.paramValues.category_52_43, 'Music');
});

test('a sentence that merely looks like a directive is left in the prompt', () => {
    // Every LTX video prompt contains "Audio: ..." mid-sentence; none of it
    // may be eaten, and no video job may gain a stray select value.
    for (const j of plan.jobs.filter(v => v.phase === 1)) {
        assert.ok(/Audio:/.test(j.prompt), `${j.title}: the Audio sentence was stripped`);
    }
});

test('an unknown workflow is reported as an error, not queued', () => {
    const bad = parseStoryboard('# S | scene | -\n\n## Shot\n### not_a_real_workflow\nsomething');
    const p = planStoryboard(bad, registry, {});
    assert.strictEqual(p.jobs.length, 0);
    assert.match(p.errors[0], /no workflow named/);
});

test('a ref naming no anchor is an ERROR - an unbound input renders the graph literal', () => {
    const doc = '# S | scene | -\n\n## Ref\n### image_edit_flux2_klein_9b_image_edit_ref (ref A9)\na prompt';
    const p = planStoryboard(parseStoryboard(doc), registry, {});
    assert.match(p.errors.join(' '), /defines A9/);
    // One reason per shot: naming a missing anchor is the fault, so the
    // per-slot "nothing supplies this" lines are not repeated on top of it.
    assert.strictEqual(p.errors.length, 1, p.errors.join(' | '));
    assert.strictEqual(p.jobs.length, 0);
});

// ---- regressions found by review -------------------------------------

test('a vid2vid shot is refused for its source video, and told to book it from the app', () => {
    // video_edit_ltx2_3_3dreal_vid2vid needs a source video, which nothing in a
    // storyboard can produce. The ref fills its image slot only, so the message
    // must not send the author round in a circle with "add | ref A1".
    const doc = '# S | scene | -\n\n## Anchor image 1\n### image_flux2_klein_9b_t2i\nplate\n\n' +
        '## Restyle\n### video_edit_ltx2_3_3dreal_vid2vid (ref A1)\nMAKE IT SNOW';
    const p = planStoryboard(parseStoryboard(doc), registry, {});
    assert.ok(!p.jobs.some(j => j.title === 'Restyle'));
    const err = p.errors.find(e => /Restyle/.test(e));
    assert.match(err, /Source video/);
    assert.match(err, /Book that one from the app/);
    assert.ok(!/ref A1/.test(err), err);
});

test('a workflow whose only text field is plumbing is refused, not corrupted', () => {
    // The autoprompt Bernini bundle deliberately has NO instruction field; its
    // one textarea holds the LLM system instruction.
    const doc = '# S | scene | -\n\n## Auto\n### video_edit_bernini_r_video_editing_ref_autoprompt\nmake it snow';
    const p = planStoryboard(parseStoryboard(doc), registry, {});
    assert.strictEqual(p.jobs.length, 0);
    assert.ok(p.errors.some(e => /no prompt field|Source video/.test(e)), p.errors.join(' | '));
});

test('a video-producing "preprocessor" is classified as video', () => {
    // utility_seedvr2_hd_upscale is category "preprocessor"; only its SaveVideo
    // node says what it makes. (It is refused in a storyboard anyway - no prompt
    // field - so the planning half of this is covered by the stub tests below.)
    assert.strictEqual(predictOutputKind(registry.get('utility_seedvr2_hd_upscale')), 'video');
});

test('a mask input is refused - a storyboard cannot paint one', () => {
    const doc = '# S | scene | -\n\n## Anchor image 1\n### image_flux2_klein_9b_t2i\nplate\n\n' +
        '## Fix\n### image_edit_flux2_klein_inpaint_prompt (ref A1)\nremove the car';
    const p = planStoryboard(parseStoryboard(doc), registry, {});
    assert.ok(!p.jobs.some(j => j.title === 'Fix'));
    assert.match(p.errors.join(' '), /painted mask/);
});

test('cuts consume plates oldest-first instead of all taking the last one', () => {
    const doc = '# S | scene | -\n\n## Plate one\n### image_flux2_klein_9b_t2i\nfirst\n\n' +
        '## Plate two\n### image_flux2_klein_9b_t2i\nsecond\n\n' +
        '## Cut 1\n### ltx_2_5_i2v\nmoves\n\n## Cut 2\n### ltx_2_5_i2v\nmoves too';
    const p = planStoryboard(parseStoryboard(doc), registry, {});
    assert.deepStrictEqual(p.errors, []);
    assert.match(p.jobs.find(j => j.title === 'Cut 1').deps[0].sourceTitle, /Plate one/);
    assert.match(p.jobs.find(j => j.title === 'Cut 2').deps[0].sourceTitle, /Plate two/);
});

test('a cut animates the shot before it, not the library plate it was built from', () => {
    // Anchors are the named library, reached with "(ref Ax)". If a cut could
    // swallow one positionally it would animate the wrong shot - here the whole
    // lemon instead of the cut-open one.
    const doc = '# S | scene | -\n\n## Anchor image 1\n### image_flux2_klein_9b_t2i\na whole lemon\n\n' +
        '## Reference image 1\n### image_edit_flux2_klein_9b_image_edit_ref (ref A1)\nthe lemon cut in half\n\n' +
        '## Video cut 1\n### ltx_2_5_i2v\nthe shadow creeps';
    const p = planStoryboard(parseStoryboard(doc), registry, {});
    assert.deepStrictEqual(p.errors, []);
    const cut = p.jobs.find(j => j.title === 'Video cut 1');
    assert.match(cut.deps[0].sourceTitle, /Reference image 1/,
        `the cut animates ${cut.deps[0].sourceTitle}`);
});

test('a cut can name a library plate explicitly', () => {
    const doc = '# S | scene | -\n\n## Anchor image 2\n### image_flux2_klein_9b_t2i\na quay\n\n' +
        '## Video cut 1\n### ltx_2_5_i2v (ref A2)\nthe tide moves';
    const p = planStoryboard(parseStoryboard(doc), registry, {});
    assert.deepStrictEqual(p.errors, []);
    assert.match(p.jobs.find(j => j.title === 'Video cut 1').deps[0].sourceTitle, /Anchor image 2/);
});

test('an edit with no ref is refused rather than fed a guess', () => {
    const doc = '# S | scene | -\n\n## Plate\n### image_flux2_klein_9b_t2i\na plate\n\n' +
        '## Edit\n### image_edit_flux2_klein_9b_image_edit_ref\nmake it snow';
    const p = planStoryboard(parseStoryboard(doc), registry, {});
    assert.ok(!p.jobs.some(j => j.title === 'Edit'));
    assert.match(p.errors.join(' '), /names no anchor/);
});

test('a text-to-video cut does not consume the plate meant for the next cut', () => {
    const doc = '# S | scene | -\n\n## Plate\n### image_flux2_klein_9b_t2i\nplate\n\n' +
        '## Title card\n### video_ltx2_5_t2v\ntitle\n\n## Cut\n### ltx_2_5_i2v\nmoves';
    const p = planStoryboard(parseStoryboard(doc), registry, {});
    assert.deepStrictEqual(p.errors, []);
    assert.match(p.jobs.find(j => j.title === 'Cut').deps[0].sourceTitle, /Plate/);
});

test('an opening sentence is not mistaken for a dropdown directive', () => {
    // "music" and "One-shot" ARE options on the audio workflow's Category
    // dropdown; only a directive NAME the format knows may consume a sentence.
    for (const open of ['Ambience: music.', 'Backing: One-shot.']) {
        const doc = '# S | scene | -\n\n## Bed\n### stable_audio_3\n' + open + ' A long tail over stone.';
        const p = planStoryboard(parseStoryboard(doc), registry, {});
        assert.ok(p.jobs[0].prompt.startsWith(open), '"' + open + '" was eaten');
        assert.ok(!('category_52_43' in p.jobs[0].paramValues), '"' + open + '" set a dropdown');
    }
});

test('duplicate anchor numbers are reported', () => {
    const doc = '# S | scene | -\n\n## Anchor image 1\n### image_flux2_klein_9b_t2i\none\n\n' +
        '## Anchor image 1\n### image_flux2_klein_9b_t2i\ntwo';
    const p = planStoryboard(parseStoryboard(doc), registry, {});
    assert.match(p.warnings.join(' '), /A1 is already defined/);
});

test('shots are grouped so each model is loaded once, not once per shot', () => {
    // Taking the document in its own order alternates between the workflows a
    // storyboard reuses, and every switch is a cold model load - minutes, for a
    // job that may take seconds. Each workflow must appear as ONE run.
    const ids = plan.workflowRuns.map(r => r.workflowId);
    assert.strictEqual(new Set(ids).size, ids.length, `a workflow is loaded twice: ${ids.join(' -> ')}`);
    assert.strictEqual(plan.modelLoads, 6, ids.join(' -> '));
    assert.strictEqual(plan.workflowRuns.reduce((a, r) => a + r.count, 0), plan.jobs.length);
    // ...and the runs describe the actual job order.
    let i = 0;
    for (const run of plan.workflowRuns) {
        for (let n = 0; n < run.count; n++, i++) {
            assert.strictEqual(plan.jobs[i].workflowId, run.workflowId, `job ${i}`);
        }
    }
});

test('grouping never reorders a shot before the one it depends on', () => {
    const pos = new Map(plan.jobs.map((j, i) => [j.itemIndex, i]));
    for (const j of plan.jobs) {
        for (const d of j.deps) {
            assert.ok(pos.get(d.sourceItemIndex) < pos.get(j.itemIndex),
                `${j.title} runs before ${d.sourceTitle}`);
        }
    }
});

test('grouping yields to a dependency rather than breaking the order', () => {
    // A chain that forces alternation: wf-A -> wf-B -> wf-A. Correctness wins;
    // the second A cannot be pulled forward next to the first.
    const doc = '# S | scene | -\n\n## Anchor image 1\n### image_flux2_klein_9b_t2i\nplate\n\n' +
        '## Edit\n### image_edit_flux2_klein_9b_image_edit_ref (ref A1)\nedit it\n\n' +
        '## Cut\n### ltx_2_5_i2v\nit moves\n\n' +
        '## Late plate\n### image_flux2_klein_9b_t2i\nanother plate';
    const p = planStoryboard(parseStoryboard(doc), registry, {});
    assert.deepStrictEqual(p.errors, []);
    const order = p.jobs.map(j => j.title);
    assert.ok(order.indexOf('Anchor image 1') < order.indexOf('Edit'), order.join(' -> '));
    assert.ok(order.indexOf('Edit') < order.indexOf('Cut'), order.join(' -> '));
    // Both t2i shots have no dependants blocking them, so they group together.
    assert.ok(Math.abs(order.indexOf('Anchor image 1') - order.indexOf('Late plate')) === 1,
        `t2i shots were not grouped: ${order.join(' -> ')}`);
});

test('a resolution written in the document drives width and height', () => {
    // Four spellings, because the document is written by hand (or by another
    // tool) and all of these read naturally.
    const cases = [
        ['### image_flux2_klein_9b_t2i (1024x1536)\na lemon', 1024, 1536, 'a lemon'],
        ['### image_flux2_klein_9b_t2i\nResolution: 1344 x 768\na lemon', 1344, 768, 'a lemon'],
        ['### image_flux2_klein_9b_t2i\nSize: 1280×720.\na lemon', 1280, 720, 'a lemon'],
        ['### image_flux2_klein_9b_t2i\nDimensions: 832*1216\na lemon', 832, 1216, 'a lemon']
    ];
    for (const [tail, w, h, prompt] of cases) {
        const p = planStoryboard(parseStoryboard(`# S | scene | -\n\n## Plate\n${tail}`), registry, {});
        assert.deepStrictEqual(p.errors, [], tail);
        const j = p.jobs[0];
        assert.strictEqual(j.paramValues.primitiveint_value_75_68, w, tail);
        assert.strictEqual(j.paramValues.primitiveint_value_75_69, h, tail);
        // ...and the size never leaks into the text the model is given.
        assert.strictEqual(j.prompt, prompt, tail);
    }
});

test('a resolution can sit alongside a ref, and applies to a video cut too', () => {
    const doc = '# S | scene | -\n\n## Anchor image 1\n### image_flux2_klein_9b_t2i (832x1216)\nplate\n\n' +
        '## Cut\n### ltx_2_5_i2v (ref A1, 1280x720)\nit moves';
    const p = planStoryboard(parseStoryboard(doc), registry, {});
    assert.deepStrictEqual(p.errors, []);
    const cut = p.jobs.find(j => j.title === 'Cut');
    assert.strictEqual(cut.paramValues.primitiveint_value_410, 1280);
    assert.strictEqual(cut.paramValues.primitiveint_value_411, 704 + 16);
    assert.strictEqual(cut.deps.length, 1);
});

test('prose that merely contains numbers is not read as a resolution', () => {
    // Every shot in the real document ends with "shot on 35mm film with a 40mm
    // lens, Kodak Portra 400 ..." - none of that may become a size.
    for (const j of plan.jobs) {
        assert.ok(!j.notes.some(n => /×/.test(n)), `${j.title}: ${j.notes.join(';')}`);
    }
    const doc = '# S | scene | -\n\n## Plate\n### image_flux2_klein_9b_t2i\n' +
        'shot on 35mm film with a 40mm lens, Kodak Portra 400 palette, f2 8 at 1 250';
    const p = planStoryboard(parseStoryboard(doc), registry, {});
    assert.ok(!('primitiveint_value_75_68' in p.jobs[0].paramValues), JSON.stringify(p.jobs[0].paramValues));
});

test('a resolution on a workflow that has none is reported, not swallowed', () => {
    const doc = '# S | scene | -\n\n## Anchor image 1\n### image_flux2_klein_9b_t2i\nplate\n\n' +
        '## Edit\n### image_edit_flux2_klein_9b_image_edit_ref (ref A1, 900x900)\nedit it';
    const p = planStoryboard(parseStoryboard(doc), registry, {});
    assert.deepStrictEqual(p.errors, []);
    assert.match(p.warnings.join(' '), /has no width\/height to set/);
});

test('an implausible size is ignored rather than clamped into the graph', () => {
    for (const bad of ['12x9', '99999x1024']) {
        const p = planStoryboard(parseStoryboard(
            `# S | scene | -\n\n## Plate\n### image_flux2_klein_9b_t2i (${bad})\na lemon`), registry, {});
        assert.ok(!('primitiveint_value_75_68' in p.jobs[0].paramValues), bad);
    }
});

test('the real generator format parses: workflow | size | duration', () => {
    const real = fs.readFileSync(path.join(REPO, 'server', 'storyboard', 'fixtures', 'the-red-thread.md'), 'utf8');
    const r = parseStoryboard(real);
    assert.strictEqual(r.items.length, 54);
    assert.deepStrictEqual(r.errors, []);
    assert.deepStrictEqual(r.warnings, []);
    assert.strictEqual(r.items.filter(i => i.size).length, 45);
    assert.strictEqual(r.items.filter(i => i.durationSec != null).length, 26);
    // "### ltx_2_5_i2v | 1280x720 | 5s"
    const cut = r.items.find(i => i.workflowAlias === 'ltx_2_5_i2v');
    assert.deepStrictEqual(cut.size, { width: 1280, height: 720 });
    assert.strictEqual(cut.durationSec, 5);
    // "### stable_audio_3 | 45s" — a duration with no size
    const amb = r.items.find(i => i.title === 'Ambience 1');
    assert.strictEqual(amb.durationSec, 45);
    assert.strictEqual(amb.size, null);
    // None of it leaks into the prompt.
    assert.ok(!/1280x720|\| 5s/.test(cut.prompt));
});

test('an edit shot that names no anchor becomes a plain generation', () => {
    // The format's own wiring rule: "Reference image N on WF_IMAGE_REF takes the
    // anchor named in (ref AN). With no parenthetical, use WF_IMAGE and no
    // input." Generators emit the edit workflow and forget the parenthetical, so
    // the rule is applied rather than the whole document refused.
    const real = fs.readFileSync(path.join(REPO, 'server', 'storyboard', 'fixtures', 'the-red-thread.md'), 'utf8');
    const p = planStoryboard(parseStoryboard(real), registry, {});
    assert.deepStrictEqual(p.errors, []);
    assert.strictEqual(p.blockedReasons.length, 0);
    assert.strictEqual(p.jobs.length, 54);

    // Every one of them ran on the workflow the LIBRARY's anchors use.
    const swapped = p.jobs.filter(j => j.substitutedFrom);
    assert.strictEqual(swapped.length, 17);
    for (const j of swapped) {
        assert.strictEqual(j.substitutedFrom, 'image_edit_flux2_klein_9b_image_edit_ref');
        assert.strictEqual(j.workflowId, 'image_flux2_klein_9b_t2i');
        assert.strictEqual(j.deps.length, 0, 'a plain generation must need no input');
    }
    // ...and it is said out loud, once.
    const said = p.warnings.filter(w => /named no anchor/.test(w));
    assert.strictEqual(said.length, 1, p.warnings.join(' | '));
    assert.match(said[0], /17 shot\(s\)/);

    // The key frames still come before the cuts that animate them.
    const pos = new Map(p.jobs.map((j, i) => [j.itemIndex, i]));
    for (const j of p.jobs) for (const d of j.deps) {
        assert.ok(pos.get(d.sourceItemIndex) < pos.get(j.itemIndex));
    }
});

test('naming the anchor still uses the edit workflow', () => {
    const real = fs.readFileSync(path.join(REPO, 'server', 'storyboard', 'fixtures', 'the-red-thread.md'), 'utf8');
    const withRefs = real.replace(/^## Reference image (\d+)$/gm, '## Reference image $1 (ref A2, A1)');
    const p = planStoryboard(parseStoryboard(withRefs), registry, {});
    assert.deepStrictEqual(p.errors, []);
    assert.strictEqual(p.jobs.filter(j => j.substitutedFrom).length, 0);
    const edit = p.jobs.find(j => j.workflowId === 'image_edit_flux2_klein_9b_image_edit_ref');
    assert.strictEqual(edit.deps.length, 2);
    assert.match(edit.deps[0].sourceTitle, /Anchor image 2/);
    assert.match(edit.deps[1].sourceTitle, /Anchor image 1/);
});

test('with no anchors to fall back on, an edit with no ref is still refused', () => {
    // Nothing in the document identifies a no-input image workflow, so there is
    // no rule to apply and guessing is not an option.
    const doc = '# S | scene | -\n\n## Plate\n### image_flux2_klein_9b_t2i\na plate\n\n' +
        '## Edit\n### image_edit_flux2_klein_9b_image_edit_ref\nmake it snow';
    const p = planStoryboard(parseStoryboard(doc), registry, {});
    assert.ok(!p.jobs.some(j => j.title === 'Edit'));
    assert.match(p.errors.join(' '), /names no anchor/);
});

test('adding the anchor to the ### line is all it takes', () => {
    const real = fs.readFileSync(path.join(REPO, 'server', 'storyboard', 'fixtures', 'the-red-thread.md'), 'utf8');
    // Exactly the edit the generator would make.
    const fixed = real.replace(/^### image_edit_flux2_klein_9b_image_edit_ref \| 1280x720$/gm,
        '### image_edit_flux2_klein_9b_image_edit_ref | 1280x720 | ref A2, A1');
    const p = planStoryboard(parseStoryboard(fixed), registry, {});
    assert.deepStrictEqual(p.errors, []);
    assert.strictEqual(p.blockedReasons.length, 0);
    assert.strictEqual(p.jobs.length, 54);
    // ...and the whole film still groups into one load per workflow.
    assert.strictEqual(p.modelLoads, 6, p.workflowRuns.map(x => x.workflowId).join(' -> '));
});

test("the slot's argument is read from the ## line, as the grammar specifies", () => {
    const doc = '# S | scene | -\n\n## Anchor image 1\n### image_flux2_klein_9b_t2i | 1280x720\nplate\n\n' +
        '## Anchor image 2\n### image_flux2_klein_9b_t2i | 1280x720\nquay\n\n' +
        '## Reference image 1 (ref A2, A1)\n### image_edit_flux2_klein_9b_image_edit_ref | 1280x720\nedit\n\n' +
        '## Video cut 1\n### ltx_2_5_i2v | 1280x720 | 5s\nit moves';
    const p = planStoryboard(parseStoryboard(doc), registry, {});
    assert.deepStrictEqual(p.errors, []);
    const edit = p.jobs.find(j => j.workflowId === 'image_edit_flux2_klein_9b_image_edit_ref');
    // Two anchors, in slot order: source first, reference second.
    assert.strictEqual(edit.deps.length, 2);
    assert.match(edit.deps[0].paramLabel, /Source/);
    assert.match(edit.deps[0].sourceTitle, /Anchor image 2/);
    assert.match(edit.deps[1].paramLabel, /Reference/);
    assert.match(edit.deps[1].sourceTitle, /Anchor image 1/);
    // ...and naming two distinct anchors is NOT the "one ref, two slots" case.
    assert.ok(!p.warnings.some(w => /used for BOTH/.test(w)), p.warnings.join(' | '));
});

test('"(loop)" on the ## line drives both frames from one key frame', () => {
    const doc = '# S | scene | -\n\n## Reference image 1\n### image_flux2_klein_9b_t2i | 1280x720\ntwine\n\n' +
        '## Reference image 2\n### image_flux2_klein_9b_t2i | 1280x720\nanother\n\n' +
        '## Video cut 1 (loop)\n### ltx_2_5_flf2v | 1280x720 | 5s\nit loops';
    const p = planStoryboard(parseStoryboard(doc), registry, {});
    assert.deepStrictEqual(p.errors, []);
    const loop = p.jobs.find(j => j.title.includes('loop'));
    assert.strictEqual(loop.deps.length, 2);
    // Both frames are key frame 1 — NOT frame 1 and the unrelated frame 2.
    assert.strictEqual(loop.deps[0].sourceItemIndex, loop.deps[1].sourceItemIndex);
    assert.match(loop.deps[0].sourceTitle, /Reference image 1/);
});

test('an unnumbered "(loop)" cut uses up one image, not two', () => {
    // It took two for a first/last-frame workflow and threw the second away,
    // so the next cut had no frame left.
    const doc = '# S | scene | -\n\n## Plate one\n### image_flux2_klein_9b_t2i | 1280x720\none\n\n' +
        '## Plate two\n### image_flux2_klein_9b_t2i | 1280x720\ntwo\n\n' +
        '## Cut (loop)\n### ltx_2_5_flf2v | 1280x720 | 5s\nit loops\n\n' +
        '## Cut two\n### ltx_2_5_i2v | 1280x720 | 5s\nit moves';
    const p = planStoryboard(parseStoryboard(doc), registry, {});
    assert.deepStrictEqual(p.errors, []);
    const loop = p.jobs.find(j => j.title === 'Cut (loop)');
    assert.strictEqual(loop.deps.length, 2);
    for (const d of loop.deps) assert.match(d.sourceTitle, /Plate one/);
    const next = p.jobs.find(j => j.title === 'Cut two');
    assert.match(next.deps[0].sourceTitle, /Plate two/);
});

test('"Video cut N" is wired to "Reference image N", by number', () => {
    // Numbered out of document order on purpose: the grammar promises the cut
    // takes the key frame of the SAME number, not simply the previous image.
    const doc = '# S | scene | -\n\n## Reference image 1\n### image_flux2_klein_9b_t2i | 1280x720\nfirst\n\n' +
        '## Reference image 2\n### image_flux2_klein_9b_t2i | 1280x720\nsecond\n\n' +
        '## Video cut 2\n### ltx_2_5_i2v | 1280x720 | 5s\nsecond moves\n\n' +
        '## Video cut 1\n### ltx_2_5_i2v | 1280x720 | 5s\nfirst moves';
    const p = planStoryboard(parseStoryboard(doc), registry, {});
    assert.deepStrictEqual(p.errors, []);
    const cut = (n) => p.jobs.find(j => j.title === `Video cut ${n}`);
    assert.match(cut(1).deps[0].sourceTitle, /Reference image 1/, 'cut 1 took the wrong key frame');
    assert.match(cut(2).deps[0].sourceTitle, /Reference image 2/, 'cut 2 took the wrong key frame');
});

test('a 16:9 size reaches a workflow that only has an aspect-ratio dropdown', () => {
    // Ideogram has no width/height and DEFAULTS TO PORTRAIT, so a 16:9 film
    // whose title cards were left alone would render every card 9:16.
    const doc = '# S | scene | -\n\n## Choice image\n### ideogram_4_t2i | 1280x720\na title card';
    const p = planStoryboard(parseStoryboard(doc), registry, {});
    assert.strictEqual(p.jobs[0].paramValues.aspect_ratio_37, '16:9 (Widescreen)');
    // A portrait request must not snap to the landscape option.
    const portrait = planStoryboard(parseStoryboard(
        '# S | scene | -\n\n## Choice image\n### ideogram_4_t2i | 720x1280\na card'), registry, {});
    assert.strictEqual(portrait.jobs[0].paramValues.aspect_ratio_37, '9:16 (Portrait Widescreen)');
    const square = planStoryboard(parseStoryboard(
        '# S | scene | -\n\n## Choice image\n### ideogram_4_t2i | 1024x1024\na card'), registry, {});
    assert.strictEqual(square.jobs[0].paramValues.aspect_ratio_37, '1:1 (Square)');
});

test('the ideogram bundle only declares aspect options the node really has', () => {
    // The 55-shot batch lost 7 title cards because 5 of this list's 7 strings
    // did not exist on the installed ResolutionSelector. The live list is
    // pinned here so drifting away from it fails a test, not a GPU run.
    const meta = JSON.parse(fs.readFileSync(
        path.join(REPO, 'workflows', 'image_ideogram4_t2i', 'image_ideogram4_t2i.meta.json'), 'utf8'));
    const p = meta.exposedParameters.find(x => x.key === 'aspect_ratio_37');
    assert.deepStrictEqual(p.options, [
        '1:1 (Square)', '2:3 (Portrait Photo)', '3:2 (Photo)', '3:4 (Portrait Standard)',
        '4:3 (Standard)', '9:16 (Portrait Widescreen)', '16:9 (Widescreen)', '21:9 (Ultrawide)'
    ]);
    // The default must be selectable, and every option a parseable ratio.
    assert.ok(p.options.includes(p.default), p.default);
    for (const o of p.options) assert.match(o, /^\d+:\d+ \(/, o);
    // The api.json literal must be selectable too, or a hand-booked job dies.
    const api = JSON.parse(fs.readFileSync(
        path.join(REPO, 'workflows', 'image_ideogram4_t2i', 'image_ideogram4_t2i.api.json'), 'utf8'));
    assert.ok(p.options.includes(api['37'].inputs.aspect_ratio), api['37'].inputs.aspect_ratio);
});

test('the notes role generates nothing, even if it looks like a shot', () => {
    const doc = '# S | scene | -\n\n## Plate\n### image_flux2_klein_9b_t2i | 1280x720\na plate\n\n' +
        '# NOTES | notes | end\n\n## Anchor image 9\n### image_flux2_klein_9b_t2i | 1280x720\nnot a shot';
    const r = parseStoryboard(doc);
    assert.strictEqual(r.items.length, 1);
    assert.deepStrictEqual(r.errors, []);
});

test('spacing=asap packs the timeline, estimated spreads it', () => {
    const asap = planStoryboard(parsed, registry, { startAt: 0, spacing: 'asap' });
    assert.strictEqual(asap.jobs[1].scheduledAt - asap.jobs[0].scheduledAt, 1000);
    assert.strictEqual(plan.jobs[1].scheduledAt - plan.jobs[0].scheduledAt,
        plan.jobs[0].estimatedDurationSec * 1000);
});

// ---- regressions found by the 2026-11-05 review ------------------------

const LIB2 = '# S | scene | -\n\n## Anchor image 1\n### image_flux2_klein_9b_t2i\na\n\n' +
    '## Anchor image 2\n### image_flux2_klein_9b_t2i\nb\n\n';

test('"### wf (ref A2, A1)" keeps both anchors, in slot order', () => {
    // The format doc's own two-anchor example. The parenthesis is split on its
    // comma, and the bare "A1" used to become a note: both slots got A2.
    const r = parseStoryboard(LIB2 + '## Reference image 1\n### image_edit_flux2_klein_9b_image_edit_ref (ref A2, A1)\nedit');
    assert.deepStrictEqual(r.items[2].refs, ['A2', 'A1']);
    assert.deepStrictEqual(r.warnings, []);
    const p = planStoryboard(r, registry, {});
    assert.deepStrictEqual(p.errors, []);
    const edit = p.jobs.find(j => j.title === 'Reference image 1');
    assert.match(edit.deps[0].paramLabel, /Source/);
    assert.match(edit.deps[0].sourceTitle, /Anchor image 2/);
    assert.match(edit.deps[1].paramLabel, /Reference/);
    assert.match(edit.deps[1].sourceTitle, /Anchor image 1/);
    assert.ok(!p.warnings.some(w => /used for BOTH/.test(w)), p.warnings.join(' | '));
    // A size after a ref is still a size, not a third anchor.
    const sized = parseStoryboard('# S | scene | -\n\n## Edit\n### image_edit_flux2_klein_9b_image_edit_ref (ref A1, 900x900)\nedit');
    assert.deepStrictEqual(sized.items[0].refs, ['A1']);
    assert.deepStrictEqual(sized.items[0].size, { width: 900, height: 900 });
});

test('refs written on both the ## and ### line are not added up', () => {
    // The same list twice is one list: doubling a single ref filled the second
    // image slot and hid the one-ref-in-two-slots warning.
    const same = parseStoryboard('# S | scene | -\n\n## Anchor image 2\n### image_flux2_klein_9b_t2i\nb\n\n' +
        '## Reference image 1 (ref A2)\n### image_edit_flux2_klein_9b_image_edit_ref | ref A2\nedit');
    assert.deepStrictEqual(same.items[1].refs, ['A2']);
    assert.deepStrictEqual(same.errors, []);
    const p = planStoryboard(same, registry, {});
    assert.ok(p.warnings.some(w => /used for BOTH/.test(w)), p.warnings.join(' | '));
    // Two lists that disagree cannot both be right: an error naming both lines.
    const clash = parseStoryboard('# S | scene | -\n\n## Reference image 1 (ref A2, A1)\n' +
        '### image_edit_flux2_klein_9b_image_edit_ref | ref A3, A1\nedit');
    assert.strictEqual(clash.errors.length, 1, clash.errors.join(' | '));
    assert.match(clash.errors[0], /Line 4: .*ref A3, A1.*\(line 3\) names ref A2, A1/);
});

test('"| 5s" on a workflow that counts frames converts at its own frame rate', () => {
    // video_minimax_h3_t2v_turbo's only rate is in its length label ("124 is
    // about 5 s at 24 fps"); the length itself used to be read as the rate,
    // turning 5 s into 620 frames - about 15 s once the worker clamped it.
    const p = planStoryboard(parseStoryboard(
        '# S | scene | -\n\n## Cut\n### video_minimax_h3_t2v_turbo | 1280x720 | 5s\nwaves'), registry, {});
    assert.deepStrictEqual(p.errors, []);
    const frames = p.jobs[0].paramValues.minimaxh3imagetovideo_length_11;
    assert.ok(frames >= 100 && frames <= 130, `5s became ${frames} frames`);
    assert.ok(p.jobs[0].notes.some(n => /@ 24fps/.test(n)), p.jobs[0].notes.join(' ; '));
});

test('a cut whose own key frame was refused waits instead of taking another shot\'s', () => {
    // Refused early (unknown workflow) or late (an edit naming a missing anchor):
    // either way "Video cut 1" must not animate "Reference image 2".
    for (const first of ['### not_a_real_workflow | 1280x720', '### image_edit_flux2_klein_9b_image_edit_ref | ref A9']) {
        const doc = `# S | scene | -\n\n## Reference image 1\n${first}\nfirst\n\n` +
            '## Reference image 2\n### image_flux2_klein_9b_t2i | 1280x720\nsecond\n\n' +
            '## Video cut 1\n### ltx_2_5_i2v | 1280x720 | 5s\nfirst moves\n\n' +
            '## Video cut 2\n### ltx_2_5_i2v | 1280x720 | 5s\nsecond moves';
        const p = planStoryboard(parseStoryboard(doc), registry, {});
        assert.ok(!p.jobs.some(j => j.title === 'Video cut 1'), `${first}: cut 1 was queued`);
        assert.match(p.blockedReasons.join(' '), /"Video cut 1".*key frame numbered 1/, first);
        assert.match(p.jobs.find(j => j.title === 'Video cut 2').deps[0].sourceTitle, /Reference image 2/, first);
        assert.strictEqual(p.errors.length, 1, p.errors.join(' | '));
        assert.strictEqual(p.summary, '1 shot cannot be queued, and 1 more depends on it — 2 of 4 would run.', first);
    }
});

test('an attribute the ### line does not understand is reported, not dropped', () => {
    const r = parseStoryboard('# S | scene | -\n\n## Anchor image 1\n### image_flux2_klein_9b_t2i\nplate\n\n' +
        '## Video cut 3\n### ltx_2_5_i2v | 1280x720 | 5.5s | ref: A1\nmoves');
    assert.strictEqual(r.warnings.length, 2, r.warnings.join(' | '));
    assert.match(r.warnings[0], /"5\.5s" on "### ltx_2_5_i2v/);
    assert.match(r.warnings[1], /"ref: A1" on.*not understood/);
});

test('a fractional duration says it was not whole seconds, in every place it can be written', () => {
    // The shot runs at the workflow default either way; the warning has to say
    // why, or "6.5s" reads as accepted.
    for (const [h2, h3] of [['## Video cut 1', '### ltx_2_5_i2v | 1280x720 | 6.5s'],
                            ['## Video cut 1', '### ltx_2_5_i2v (6.5s)'],
                            ['## Video cut 1', '### ltx_2_5_i2v | 2,5 sec'],
                            // A decimal comma inside the parenthesis, which is
                            // split on commas: "(2,5s)" ran as 5 s, blaming "2".
                            ['## Video cut 1', '### ltx_2_5_i2v (2,5s)'],
                            ['## Video cut 1', '### ltx_2_5_i2v (ref A1, 2,5s)'],
                            ['## Video cut 1', '### ltx_2_5_i2v (ref A1 2,5s)'],
                            ['## Video cut 1 (2,5s)', '### ltx_2_5_i2v'],
                            ['## Video cut 1 (6.5s)', '### ltx_2_5_i2v']]) {
        const r = parseStoryboard(`# S | scene | -\n\n${h2}\n${h3}\nmoves`);
        assert.strictEqual(r.items[0].durationSec, null, h3);
        assert.strictEqual(r.warnings.length, 1, r.warnings.join(' | '));
        assert.match(r.warnings[0], /is not a whole number of seconds.*Write whole seconds/, `${h2} / ${h3}`);
    }
    // After a ref and a space, the "2" of "2,5s" is not a second anchor.
    const ref = parseStoryboard('# S | scene | -\n\n## Video cut 1\n### ltx_2_5_i2v (ref A1 2,5s)\nmoves');
    assert.deepStrictEqual(ref.items[0].refs, ['A1']);
    // A whole number is still read, with no warning.
    const ok = parseStoryboard('# S | scene | -\n\n## Video cut 1\n### ltx_2_5_i2v | 6s\nmoves');
    assert.strictEqual(ok.items[0].durationSec, 6);
    assert.deepStrictEqual(ok.warnings, []);
    // A comma between a size and a whole duration still separates them.
    const both = parseStoryboard('# S | scene | -\n\n## Video cut 1\n### ltx_2_5_i2v (1280x720,5s)\nmoves');
    assert.deepStrictEqual(both.items[0].size, { width: 1280, height: 720 });
    assert.strictEqual(both.items[0].durationSec, 5);
    assert.deepStrictEqual(both.warnings, []);
});

test('a size, a duration or a loop written after a ref is read, wherever the ref is', () => {
    // A ref list used to swallow everything after it on the "##" line and in a
    // "|" note: "(ref A2, 8s)" queued at the default length with no warning.
    const read = (h2, h3) => parseStoryboard(`# S | scene | -\n\n${h2}\n${h3}\nmoves`);
    for (const [h2, h3] of [['## Video cut 1 (ref A2, 8s)', '### ltx_2_5_i2v'],
                            ['## Video cut 1', '### ltx_2_5_i2v | ref A2, 8s'],
                            ['## Video cut 1', '### ltx_2_5_i2v | ref A2 8s'],
                            ['## Video cut 1', '### ltx_2_5_i2v (ref A2, 8s)']]) {
        const r = read(h2, h3);
        assert.deepStrictEqual(r.items[0].refs, ['A2'], `${h2} / ${h3}`);
        assert.strictEqual(r.items[0].durationSec, 8, `${h2} / ${h3}`);
        assert.deepStrictEqual(r.warnings, [], `${h2} / ${h3}`);
    }
    const sized = read('## Reference image 1 (ref A1, 900x900)', '### image_edit_flux2_klein_9b_image_edit_ref');
    assert.deepStrictEqual(sized.items[0].refs, ['A1']);
    assert.deepStrictEqual(sized.items[0].size, { width: 900, height: 900 });
    assert.deepStrictEqual(sized.warnings, []);
    const looped = read('## Video cut 1 (ref A2, loop)', '### ltx_2_5_flf2v');
    assert.deepStrictEqual(looped.items[0].refs, ['A2']);
    assert.strictEqual(looped.items[0].loop, true);
    const two = read('## Reference image 1 (ref A2, A1)', '### image_edit_flux2_klein_9b_image_edit_ref');
    assert.deepStrictEqual(two.items[0].refs, ['A2', 'A1']);
    // Anything else after the ref is reported, on either line.
    for (const [h2, h3] of [['## Video cut 1 (ref A2, hero)', '### ltx_2_5_i2v'],
                            ['## Video cut 1', '### ltx_2_5_i2v | ref A2, hero']]) {
        const r = read(h2, h3);
        assert.deepStrictEqual(r.items[0].refs, ['A2'], `${h2} / ${h3}`);
        assert.strictEqual(r.warnings.length, 1, r.warnings.join(' | '));
        assert.match(r.warnings[0], /"hero" on .*not understood/, `${h2} / ${h3}`);
    }
});

test('the planner rolls a seed only for what the shared seed rule calls a seed', () => {
    // The planner overwrites every seed with a random number. Its own bare
    // /seed/ called SeedVR2's colour-correction method and "seed_mode" seeds;
    // it now follows the list the server and the booking form are tested on.
    const fixture = JSON.parse(fs.readFileSync(
        path.join(REPO, 'server', 'benchmark', 'seedParam.fixture.json'), 'utf8'));
    const asNumber = (p) => (p.keyOnly ? { key: p.key, type: 'number' } : { key: p.key, field: p.field, type: 'number' });
    for (const p of fixture.seeds) assert.ok(isSeed(asNumber(p)), `${p.key} / ${p.field || '(key only)'} is a seed`);
    for (const p of fixture.notSeeds) assert.ok(!isSeed(asNumber(p)), `${p.key} / ${p.field || '(key only)'} is not a seed`);
    // Only a number is rolled: a seed-named text field is left alone.
    assert.ok(!isSeed({ key: 'seed', field: 'value', type: 'text' }));
});

test('the summary counts shots refused before they were wired', () => {
    const p = planStoryboard(parseStoryboard('# S | scene | -\n\n## Plate\n### not_a_real_workflow\nx\n\n' +
        '## Bed\n### stable_audio_3\nTrackType: Music. a bed'), registry, {});
    assert.strictEqual(p.jobs.length, 1);
    assert.strictEqual(p.refusedCount, 1);
    assert.strictEqual(p.summary, '1 shot cannot be queued — 1 of 2 would run.');
});

test('a shot whose inputs loop back to itself is refused, never queued', () => {
    // Refs resolve document-wide, so an anchor can name itself. Queued, it
    // would wait on its own result for ever, and hold its batch open.
    const self = planStoryboard(parseStoryboard('# S | scene | -\n\n## Anchor image 1\n### image_flux2_klein_9b_t2i\nplate\n\n' +
        '## Anchor image 2\n### image_edit_flux2_klein_9b_image_edit_ref | ref A2, A1\nself\n\n' +
        '## Video cut 1\n### ltx_2_5_i2v | ref A2\nmoves'), registry, {});
    assert.deepStrictEqual(self.jobs.map(j => j.title), ['Anchor image 1']);
    assert.match(self.errors.join(' '), /"Anchor image 2".*its own result/);
    assert.match(self.blockedReasons.join(' '), /"Video cut 1".*waits on S · Anchor image 2/);
    assert.strictEqual(self.refusedCount, 1);
    assert.strictEqual(self.blockedCount, 1);
    // ...and two anchors naming each other.
    const mutual = planStoryboard(parseStoryboard('# S | scene | -\n\n## Anchor image 1\n### image_flux2_klein_9b_t2i\nplate\n\n' +
        '## Anchor image 2\n### image_edit_flux2_klein_9b_image_edit_ref | ref A3, A1\ntwo\n\n' +
        '## Anchor image 3\n### image_edit_flux2_klein_9b_image_edit_ref | ref A2, A1\nthree'), registry, {});
    assert.deepStrictEqual(mutual.jobs.map(j => j.title), ['Anchor image 1']);
    assert.strictEqual(mutual.errors.filter(e => /form a loop/.test(e)).length, 2, mutual.errors.join(' | '));
    assert.strictEqual(mutual.refusedCount, 2);
});

test('an unclosed code fence is an error naming the line it opened on', () => {
    // Everything after it was swallowed into one prompt, so the later shots
    // would silently never be generated.
    const r = parseStoryboard('# S | scene | -\n\n## Plate 1\n### image_flux2_klein_9b_t2i\na plate\n~~~\n\n' +
        '## Plate 2\n### image_flux2_klein_9b_t2i\nsecond');
    assert.strictEqual(r.items.length, 1);
    assert.strictEqual(r.errors.length, 1, r.errors.join(' | '));
    assert.match(r.errors[0], /^Line 6: a code fence.*"## Plate 2" \(line 8\)/);
    // A shot heading swallowed after a notes section ends counts as lost too.
    const afterNotes = parseStoryboard('# S | scene | -\n\n## Plate 1\n### image_flux2_klein_9b_t2i\na plate\n\n' +
        '# NOTES | notes | -\n\n```\n## Idea\n# S2 | scene | -\n## Plate 2\n### image_flux2_klein_9b_t2i\nsecond');
    assert.strictEqual(afterNotes.errors.length, 1, afterNotes.errors.join(' | '));
    assert.match(afterNotes.errors[0], /"## Plate 2" \(line 12\)/);
});

test('an unclosed code fence that swallowed no shot is a warning, not a refused batch', () => {
    // In the last shot's prompt: only that prompt's text follows.
    const last = parseStoryboard('# S | scene | -\n\n## Plate 1\n### image_flux2_klein_9b_t2i\na plate\n```\nmore text');
    assert.deepStrictEqual(last.errors, []);
    assert.match(last.warnings.join(' '), /Line 6: .*never closed.*prompt of "Plate 1"/);
    // In a notes section: nothing after it was ever a prompt.
    const notes = parseStoryboard('# S | scene | -\n\n## Plate 1\n### image_flux2_klein_9b_t2i\na plate\n\n' +
        '# NOTES | notes | -\n\n```\n## Idea\nprose');
    assert.deepStrictEqual(notes.errors, []);
    assert.match(notes.warnings.join(' '), /Line 9: .*never closed.*in a notes section/);
    assert.ok(!/prompt text/.test(notes.warnings.join(' ')), notes.warnings.join(' | '));
});

test('a cut whose key frame the PARSER dropped waits too, and the summary counts it', () => {
    // "Reference image 1" never reaches the planner's items: no "###" line, or
    // no prompt. "Video cut 1" used to take "Reference image 2" instead, and
    // force queued it.
    for (const [form, first] of [['no ### line', '## Reference image 1\n\n'],
                                 ['no prompt', '## Reference image 1\n### image_flux2_klein_9b_t2i\n\n']]) {
        const doc = `# S | scene | -\n\n${first}` +
            '## Reference image 2\n### image_flux2_klein_9b_t2i\nsecond\n\n' +
            '## Video cut 1\n### ltx_2_5_i2v\nfirst moves\n\n' +
            '## Video cut 2\n### ltx_2_5_i2v\nsecond moves';
        const r = parseStoryboard(doc);
        assert.strictEqual(r.errors.length, 1, `${form}: ${r.errors.join(' | ')}`);
        assert.deepStrictEqual(r.dropped.map(d => d.title), ['Reference image 1'], form);
        const p = planStoryboard(r, registry, {});
        assert.ok(!p.jobs.some(j => j.title === 'Video cut 1'), `${form}: cut 1 was queued`);
        assert.match(p.blockedReasons.join(' '), /"Video cut 1".*key frame numbered 1/, form);
        assert.match(p.jobs.find(j => j.title === 'Video cut 2').deps[0].sourceTitle, /Reference image 2/, form);
        assert.deepStrictEqual(p.errors, [], form);
        assert.strictEqual(p.totalShots, 4, form);
        assert.strictEqual(p.summary, '1 shot cannot be queued, and 1 more depends on it — 2 of 4 would run.', form);
    }
    // The same with a library anchor feeding "Reference image 2".
    const lib = parseStoryboard('# LIBRARY | library | -\n\n## Anchor image 1\n### image_flux2_klein_9b_t2i\nplate\n\n' +
        '# S0 | scene | -\n\n## Reference image 1\n\n' +
        '## Reference image 2\n### image_edit_flux2_klein_9b_image_edit_ref | ref A1\nedit\n\n' +
        '## Video cut 1\n### ltx_2_5_i2v\nmoves');
    const lp = planStoryboard(lib, registry, {});
    assert.deepStrictEqual(lp.jobs.map(j => j.title), ['Anchor image 1', 'Reference image 2']);
    assert.match(lp.blockedReasons.join(' '), /"Video cut 1" \(S0\).*key frame numbered 1/);
    // A dropped VIDEO shot is not a missing key frame.
    const vid = planStoryboard(parseStoryboard('# S | scene | -\n\n## Reference image 1\n### image_flux2_klein_9b_t2i\nfirst\n\n' +
        '## Video cut 1\n### ltx_2_5_i2v\n\n## Video cut 2\n### ltx_2_5_i2v\nmoves'), registry, {});
    assert.deepStrictEqual(vid.blockedReasons, []);
    assert.match(vid.jobs.find(j => j.title === 'Video cut 2').deps[0].sourceTitle, /Reference image 1/);
});

// A registry stub: planStoryboard only reaches the registry through
// summaries() and get(), so these cases do not depend on what is installed.
function stubRegistry(entries) {
    const byId = new Map(entries.map(e => [e.id, e]));
    return {
        summaries: () => entries.map(e => ({ id: e.id })),
        get: (id) => byId.get(id)
    };
}
function stubEntry(id, category, saveNode, params) {
    return {
        id,
        apiWorkflow: { 1: { class_type: saveNode, inputs: {} } },
        summary: { id, category, estimatedDurationSec: 10 },
        meta: { category },
        effective: { exposedParameters: params }
    };
}

test('the prompt never lands on a field the workflow has gated off', () => {
    // Two prompt boxes, the higher-scoring one disabled at the default of the
    // toggle - by exact key, and by the node-id suffix a meta may use instead.
    const gated = (id, toggleKey, dwParam) => stubEntry(id, 't2i', 'SaveImage', [
        { key: toggleKey, type: 'checkbox', label: 'Enhance prompt with AI', default: false, field: 'value' },
        { key: `enhanced_prompt_description_${id}`, type: 'textarea', label: 'AI-enhanced prompt description',
          field: 'text', disabledWhen: { param: dwParam, equals: false } },
        { key: `raw_prompt_${id}`, type: 'textarea', label: 'Prompt (used as-is)', field: 'text',
          disabledWhen: { param: dwParam, equals: true } }
    ]);
    const reg = stubRegistry([
        gated('gated_exact', 'enhance_1', 'enhance_1'),
        gated('gated_suffix', 'primitiveboolean_value_9_12', 'enhance_prompt_9_12')
    ]);
    for (const id of ['gated_exact', 'gated_suffix']) {
        const p = planStoryboard(parseStoryboard(`# S | scene | -\n\n## Shot\n### ${id}\nMAKE IT SNOW`), reg, {});
        assert.deepStrictEqual(p.errors, [], id);
        assert.strictEqual(p.jobs[0].promptParamKey, `raw_prompt_${id}`, id);
    }
});

test('a video-producing "preprocessor" runs with the videos and is not a cut\'s frame', () => {
    const prompt = (k) => ({ key: k, type: 'textarea', label: 'Prompt', field: 'text' });
    const reg = stubRegistry([
        stubEntry('stub_plate', 't2i', 'SaveImage', [prompt('p_plate')]),
        stubEntry('stub_upscale', 'preprocessor', 'SaveVideo', [prompt('p_up')]),
        stubEntry('stub_cut', 'i2v', 'SaveVideo', [
            { key: 'start_image', type: 'image', label: 'Start image', field: 'image' }, prompt('p_cut')])
    ]);
    assert.strictEqual(predictOutputKind(reg.get('stub_upscale')), 'video');
    const p = planStoryboard(parseStoryboard('# S | scene | -\n\n## Plate\n### stub_plate\nplate\n\n' +
        '## Upscale\n### stub_upscale\nbigger\n\n## Cut\n### stub_cut\nit moves'), reg, {});
    assert.deepStrictEqual(p.errors, []);
    assert.strictEqual(p.jobs.find(j => j.title === 'Upscale').phaseLabel, 'videos');
    assert.match(p.jobs.find(j => j.title === 'Cut').deps[0].sourceTitle, /Plate/);
});

// ------------------------------------------------- the batch-skill examples
// batch-skill/README.md says these were validated and prints their counts in a
// table. A bundle rename, a param reorder (which changes ref slot order) or a
// removed alias would break them silently, so plan each one here.
console.log('\nbatch-skill examples');
const EXAMPLES_DIR = path.join(REPO, 'batch-skill', 'examples');
// Each example file and the title of its row in the README table. A new
// example needs a row there and an entry here.
const EXAMPLE_TITLES = {
    'linear-the-lamplighter.md':   'The Lamplighter',
    'branching-the-tide-clock.md': 'The Tide Clock',
    'branching-the-red-thread.md': 'The Red Thread'
};
// The README table itself: | **Title** — kind | states | shots | images |
// videos | audio | model loads | warm est |. Read from the file, so the test
// fails when the table and the examples drift apart.
const README_ROWS = new Map();
for (const m of fs.readFileSync(path.join(REPO, 'batch-skill', 'README.md'), 'utf8')
    .matchAll(/^\| \*\*(The [^*]+)\*\*[^|]*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|/gm)) {
    const [states, shots, images, videos, audio, modelLoads] = m.slice(2, 8).map(Number);
    README_ROWS.set(m[1].trim(), { states, shots, images, videos, audio, modelLoads });
}

test('every example has a row in the README table', () => {
    const files = fs.readdirSync(EXAMPLES_DIR).filter(f => f.endsWith('.md')).sort();
    assert.deepStrictEqual(files, Object.keys(EXAMPLE_TITLES).sort(),
        'batch-skill/examples changed: update the README table and EXAMPLE_TITLES');
    assert.deepStrictEqual([...README_ROWS.keys()].sort(), Object.values(EXAMPLE_TITLES).sort(),
        'the README table names a different set of examples');
});

for (const [file, title] of Object.entries(EXAMPLE_TITLES)) {
    test(`${file} plans with no error and matches its README row`, () => {
        const parsedEx = parseStoryboard(fs.readFileSync(path.join(EXAMPLES_DIR, file), 'utf8'));
        const p = planStoryboard(parsedEx, registry, {});
        assert.deepStrictEqual(parsedEx.errors, [], 'PARSE errors');
        assert.deepStrictEqual(p.errors, [], 'PLAN errors');
        assert.deepStrictEqual(p.blockedReasons, [], 'blocked');
        const want = README_ROWS.get(title);
        assert.ok(want, `no "${title}" row in batch-skill/README.md`);
        const phase = (label) => (p.phases.find(x => x.label === label) || { count: 0 }).count;
        assert.deepStrictEqual(
            { states: parsedEx.states.length, shots: p.jobs.length, images: phase('images'),
                videos: phase('videos'), audio: phase('audio'), modelLoads: p.modelLoads },
            want, `the README table and the file disagree (runs: ${p.workflowRuns.map(x => x.workflowId).join(' -> ')})`);
    });
}

// ------------------------------------------------------------ queue + deps
console.log('\nqueue, dependencies and chained inputs');
const queue = new JobQueue(path.join(tmp, 'queue.db'));

const idByItem = new Map(plan.jobs.map(j => [j.itemIndex, require('uuid').v4()]));
for (const j of plan.jobs) {
    queue.insert({
        id: idByItem.get(j.itemIndex),
        userId: 'storyboard', workflowId: j.workflowId, workflowVersion: j.workflowVersion,
        scheduledAt: 1, prompt: j.prompt, paramValues: j.paramValues,
        createdBy: 'storyboard', batchId: 'BATCH1', batchLabel: 'the red thread',
        deps: j.deps.map(d => ({
            paramKey: d.paramKey, sourceJobId: idByItem.get(d.sourceItemIndex),
            outputIndex: d.outputIndex, kind: d.kind
        }))
    });
}

test('all jobs are stored under one batch', () => {
    assert.strictEqual(queue.listBatch('BATCH1').length, 42);
    const [b] = queue.listBatches();
    assert.strictEqual(b.batchId, 'BATCH1');
    assert.strictEqual(b.total, 42);
    assert.strictEqual(b.pending, 42);
});

test('findReady returns an unblocked job, never a waiting one', () => {
    const ready = queue.findReady(Date.now());
    assert.ok(ready);
    assert.strictEqual(queue.depsFor(ready.id).length, 0, 'a job with unmet deps was offered');
});

const firstAnchorId = idByItem.get(plan.jobs[0].itemIndex);
const dependentJob = plan.jobs.find(j => j.deps.some(d => d.sourceItemIndex === plan.jobs[0].itemIndex));

test('a job whose source is unfinished is not ready', () => {
    assert.ok(dependentJob, 'expected some job to consume anchor 1');
    const id = idByItem.get(dependentJob.itemIndex);
    // Push every other schedulable job far into the future so only this one
    // could possibly be returned — it must still be withheld.
    for (const j of queue.listBatch('BATCH1')) if (j.id !== id) queue.reorder(j.id, Date.now() + 3600_000);
    assert.strictEqual(queue.findReady(Date.now()), null);
});

// Complete the anchor with a real file on disk, as the executor would.
const producedName = 'anchor1_00001_.png';
fs.writeFileSync(path.join(comfyConfig.output_dir, producedName), Buffer.from('89504e470d0a1a0a', 'hex'));
queue.transitionStatus(firstAnchorId, sm.STATES.UPLOADING_INPUTS);
queue.transitionStatus(firstAnchorId, sm.STATES.SUBMITTED);
queue.transitionStatus(firstAnchorId, sm.STATES.EXECUTING);
queue.transitionStatus(firstAnchorId, sm.STATES.COLLECTING_OUTPUTS);
queue.setOutputs(firstAnchorId, [{ kind: 'image', filename: producedName, subfolder: '', type: 'output' }]);
queue.transitionStatus(firstAnchorId, sm.STATES.COMPLETED);

test('completing the source makes the dependent runnable', () => {
    const ready = queue.findReady(Date.now());
    assert.ok(ready, 'the dependent stayed blocked after its source completed');
    assert.strictEqual(ready.id, idByItem.get(dependentJob.itemIndex));
});

test('the produced image is staged into ComfyUI/input and injected by name', () => {
    const job = queue.get(idByItem.get(dependentJob.itemIndex));
    const deps = queue.depsFor(job.id);
    const r = resolveChainedInputs({ job, deps, queue, comfyConfig });
    assert.deepStrictEqual(r.errors, []);
    assert.ok(r.resolved.length > 0);
    for (const res of r.resolved) {
        const staged = path.join(comfyConfig.root_path, 'input', res.comfyFilename);
        assert.ok(fs.existsSync(staged), `${res.comfyFilename} was not staged`);
        assert.strictEqual(r.paramValues[res.paramKey], res.comfyFilename);
        // Must survive the input sweep, which only deletes the `comfyq__` prefix.
        assert.ok(res.comfyFilename.startsWith('comfyq_'), 'not servable by /input-media');
        assert.ok(!res.comfyFilename.startsWith('comfyq__'), 'would be swept away mid-batch');
    }
});

test('a missing output is an error, not a silent unbound parameter', () => {
    fs.unlinkSync(path.join(comfyConfig.output_dir, producedName));
    const job = queue.get(idByItem.get(dependentJob.itemIndex));
    const r = resolveChainedInputs({ job, deps: queue.depsFor(job.id), queue, comfyConfig });
    assert.ok(r.errors.length > 0);
    assert.match(r.errors[0], /no longer on disk/);
});

test('a failed source collapses everything waiting on it', () => {
    const anchor3 = plan.jobs.find(j => j.title === 'Anchor image 3');
    const anchorId = idByItem.get(anchor3.itemIndex);
    const waiting = plan.jobs
        .filter(j => j.deps.some(d => d.sourceItemIndex === anchor3.itemIndex))
        .map(j => idByItem.get(j.itemIndex));
    assert.ok(waiting.length > 0);

    queue.transitionStatus(anchorId, sm.STATES.FAILED, { payload: { errorReason: 'boom' } });
    const failed = queue.failBlockedJobs();
    for (const id of waiting) {
        assert.ok(failed.includes(id), 'a job waiting on the failed anchor stayed scheduled');
        assert.strictEqual(queue.get(id).errorReason, 'dependency-failed');
    }
});

test('the collapse is transitive — a video waiting on that edit fails too', () => {
    // The edits that failed above feed video cuts; one sweep must take them all.
    for (const j of queue.listBatch('BATCH1')) {
        const deps = queue.depsFor(j.id);
        if (j.status !== sm.STATES.SCHEDULED) continue;
        for (const d of deps) {
            const src = queue.get(d.sourceJobId);
            assert.notStrictEqual(src?.status, sm.STATES.FAILED,
                `${j.id} still scheduled behind a failed source`);
        }
    }
});

test('deleting a batch job cleans up its dependency rows', () => {
    const victim = queue.listBatch('BATCH1').find(j => queue.depsFor(j.id).length > 0);
    queue.delete(victim.id);
    assert.strictEqual(queue.depsFor(victim.id).length, 0);
});

test('clearing the gallery keeps a frame a pending job still needs', () => {
    // The single worst way to lose a batch: an admin tidies the gallery
    // mid-run, the completed images vanish, and every pending video collapses.
    const src = queue.insert({ userId: 'sb', workflowId: 'w', scheduledAt: 1, batchId: 'B2' });
    const dep = queue.insert({
        userId: 'sb', workflowId: 'w', scheduledAt: 2, batchId: 'B2',
        deps: [{ paramKey: 'img', sourceJobId: src.id, outputIndex: 0, kind: 'image' }]
    });
    for (const st of [sm.STATES.UPLOADING_INPUTS, sm.STATES.SUBMITTED, sm.STATES.EXECUTING,
                      sm.STATES.COLLECTING_OUTPUTS, sm.STATES.COMPLETED]) {
        queue.transitionStatus(src.id, st);
    }
    const cleared = queue.clearHistory().map(j => j.id);
    assert.ok(!cleared.includes(src.id), 'the frame a pending job needs was deleted');
    assert.strictEqual(queue.get(src.id).status, sm.STATES.COMPLETED);
    assert.strictEqual(queue.get(dep.id).status, sm.STATES.SCHEDULED);
    assert.ok(!queue.failBlockedJobs().includes(dep.id), 'the dependent was collapsed anyway');
    // Once the dependent is done with it, it clears normally.
    queue.transitionStatus(dep.id, sm.STATES.CANCELLED);
    assert.ok(queue.clearHistory().map(j => j.id).includes(src.id));
});

test('a job with two dead inputs fails once, not twice', () => {
    const a = queue.insert({ userId: 'sb', workflowId: 'w', scheduledAt: 1 });
    const b = queue.insert({ userId: 'sb', workflowId: 'w', scheduledAt: 1 });
    const both = queue.insert({
        userId: 'sb', workflowId: 'w', scheduledAt: 2,
        deps: [{ paramKey: 'first', sourceJobId: a.id, outputIndex: 0, kind: 'image' },
               { paramKey: 'last', sourceJobId: b.id, outputIndex: 0, kind: 'image' }]
    });
    queue.transitionStatus(a.id, sm.STATES.CANCELLED);
    queue.transitionStatus(b.id, sm.STATES.CANCELLED);
    const failed = queue.failBlockedJobs().filter(id => id === both.id);
    assert.strictEqual(failed.length, 1, 'reported the same job twice');
    const events = queue.eventsFor(both.id).filter(e => e.to_status === sm.STATES.FAILED);
    assert.strictEqual(events.length, 1, 'wrote a duplicate transition to the event log');
});

test('an out-of-range outputIndex is an error, not the wrong file', () => {
    const two = {
        id: 'x', status: 'completed',
        outputs: [{ kind: 'image', filename: 'one.png' }, { kind: 'image', filename: 'two.png' }]
    };
    assert.strictEqual(pickOutput(two, 'image', 0).filename, 'one.png');
    assert.strictEqual(pickOutput(two, 'image', 1).filename, 'two.png');
    assert.strictEqual(pickOutput(two, 'image', 5), null, 'clamped to the last file');
});

test('one batch is one row, and running jobs are counted', () => {
    // Two labels under one batch id must NOT split into two rows reporting a
    // total smaller than the batch really is.
    queue.insert({ userId: 'sb', workflowId: 'w', scheduledAt: 1, batchId: 'B3', batchLabel: 'film' });
    const mid = queue.insert({ userId: 'sb', workflowId: 'w', scheduledAt: 1, batchId: 'B3', batchLabel: 'film' });
    queue.insert({ userId: 'sb', workflowId: 'w', scheduledAt: 1, batchId: 'B3', batchLabel: 'film-renamed' });
    queue.transitionStatus(mid.id, sm.STATES.UPLOADING_INPUTS);

    const rows = queue.listBatches().filter(x => x.batchId === 'B3');
    assert.strictEqual(rows.length, 1, 'one batch produced more than one row');
    const b = rows[0];
    assert.strictEqual(b.total, 3);
    assert.strictEqual(b.running, 1, 'an in-flight job is counted nowhere');
    assert.strictEqual(b.completed + b.failed + b.pending + b.running, b.total);
});

test('force cannot queue a job whose input was dropped', () => {
    // The anchor names an unknown workflow, so it cannot be planned. The edit
    // that references it, and the cut that consumes the edit, must go too —
    // queueing them without a source is the silent-wrong-picture bug.
    const doc = '# S | scene | -\n\n## Anchor image 1\n### does_not_exist_wf\nplate\n\n' +
        '## Ref\n### image_edit_flux2_klein_9b_image_edit_ref (ref A1)\nan edit\n\n' +
        '## Cut\n### ltx_2_5_i2v\nit moves\n\n' +
        '## Bed\n### stable_audio_3\nTrackType: Music. a bed';
    const p = planStoryboard(parseStoryboard(doc), registry, {});
    assert.deepStrictEqual(p.jobs.map(j => j.title), ['Bed'], 'a job with a dropped source survived');
    for (const j of p.jobs) {
        for (const d of j.deps) {
            assert.ok(p.jobs.some(o => o.itemIndex === d.sourceItemIndex),
                `${j.title} kept a dep on an item that is not queued`);
        }
    }
    assert.ok(p.errors.length >= 2, p.errors.join(' | '));
});

test('a normally-booked job is completely unaffected', () => {
    const plain = queue.insert({
        userId: 'student', workflowId: 'image_flux2_klein_9b_t2i', scheduledAt: 1,
        prompt: 'a cat', paramValues: { primitivestringmultiline_value_76: 'a cat' }
    });
    assert.strictEqual(plain.batchId, null);
    assert.deepStrictEqual(queue.depsFor(plain.id), []);
    const r = resolveChainedInputs({ job: plain, deps: [], queue, comfyConfig });
    assert.deepStrictEqual(r.errors, []);
    assert.deepStrictEqual(r.paramValues, plain.paramValues);
});

queue.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} check(s) passed${process.exitCode ? ' — with failures above' : ''}\n`);
