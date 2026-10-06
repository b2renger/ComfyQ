// How sure are we that a model is safe to delete — and does the score say why?
// (node server/workflows/modelConfidence.test.js)
//
// Every signal here exists because a real near-miss on this project needed it.
// The scoring must never be a bare number: a verdict you cannot interrogate
// turns doubt into a comforting badge, which is worse than no badge at all.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { scoreDeletable, familyKey } = require('./modelConfidence');

const ok = [];
const check = (label, cond) => { assert.ok(cond, label); ok.push(label); };

const NOW = 1767225600000;   // fixed, so the test does not depend on the clock
const DAY = 86400000;

// A fake ComfyUI install with somewhere to put reference templates.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'comfyq-conf-'));
const comfy = path.join(root, 'ComfyUI');
fs.mkdirSync(path.join(comfy, 'blueprints'), { recursive: true });
fs.writeFileSync(path.join(comfy, 'blueprints', 'builtin.json'), JSON.stringify({
    nodes: [{ type: 'CheckpointLoaderSimple', widgets_values: ['shipped_with_comfy.safetensors'] }],
}));

// A model row as buildModelUsage emits one.
const row = (name, extra = {}) => ({
    name, rel: `models/x/${name}`, gb: 1, kind: 'diffusion',
    usedBy: [], templateOnly: [], dropdowns: [], external: [],
    nodeTypes: [], textOnly: false, unused: true, mtimeMs: NOW - 400 * DAY,
    ...extra,
});

const makeReport = (models, { missing = [], configured = [{ entry: 'x', resolved: 'x', found: true }], missingDirs = [] } = {}) => ({
    models,
    missing,
    scanned: { bundles: 1, files: 1, dirs: [], configured, missingDirs },
    totals: { all: models.length, allGb: models.length, unused: models.filter(m => m.unused).length, unusedGb: 0 },
});
const score = (report) => scoreDeletable(report, { comfyRoot: comfy, repoRoot: root, now: NOW });
const find = (r, n) => r.models.find(m => m.name === n);

// 1. ★★ The family key is what spots a lookalike. This exact pair — the 8-step
//    build unreferenced while the 4-step build was in use — is what nearly cost
//    1.82 GB, and it is the single most valuable signal here.
check('two builds of one model share a family key',
    familyKey('minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors')
    === familyKey('minimax_h3_fl2v_turbo_4step_v1.0_768p_comfyui_bf16.safetensors'));
check('genuinely different models do NOT share one',
    familyKey('qwen_image_2.1_int8_convrot.safetensors')
    !== familyKey('flux2_dev_fp8mixed.safetensors'));
check('precision and quantisation tokens are what get stripped',
    familyKey('a_model_fp8_scaled.safetensors') === familyKey('a_model_bf16.safetensors'));
// Checked against the audit's own BUILD clustering, which reads safetensors
// metadata rather than names: it found 27 same-model pairs on this rig and this
// was one of the 3 the name-based key used to miss — the SAME model written two
// ways, so neither copy warned about the other.
check('a version digit glued to a word does not split a family',
    familyKey('wan_2.1_vae.safetensors') === familyKey('Wan2.1_VAE.safetensors'));
check('and one model in two formats stays one family',
    familyKey('landmark_model.pth') === familyKey('landmark.onnx'));
// ⚠ The strip must not run before the variant filter: `bf16` would become `bf`,
// which is not a variant token, and would then split families that do group.
check('stripping a glued digit does not resurrect a precision token',
    familyKey('thing_bf16.safetensors') === familyKey('thing_fp8.safetensors'));

// 2. A lookalike of something IN USE is the strongest doubt there is.
{
    const r = score(makeReport([
        row('thing_4step_bf16.safetensors', { unused: false, usedBy: ['some_bundle'] }),
        row('thing_8step_bf16.safetensors'),
    ]));
    const sus = find(r, 'thing_8step_bf16.safetensors');
    check('a lookalike of a used model is low confidence', sus.confidence === 'low');
    check('...and says which file it resembles',
        sus.confidenceReasons.some(x => x.code === 'variant-sibling'
            && x.detail.includes('thing_4step_bf16.safetensors')));
    check('the used model itself gets no score at all',
        find(r, 'thing_4step_bf16.safetensors').confidence === null);
}

// 3. A name too generic to match on cannot be trusted in either direction.
{
    const r = score(makeReport([row('model.safetensors')]));
    check('a generic filename is low confidence', find(r, 'model.safetensors').confidence === 'low');
    check('...for the stated reason',
        find(r, 'model.safetensors').confidenceReasons.some(x => x.code === 'generic-name'));

    // ★ The scan decides what is generic (modelUsage.isGenericBasename); this
    // must READ that rather than keep a list of its own. It did keep one, and
    // the two drifted: `model.fp16.safetensors` was flagged generic by the scan
    // and still scored CONFIDENT here, so the force-low guard did nothing for
    // the very names it exists for.
    const flagged = score(makeReport([{ ...row('something_odd.safetensors'), genericName: true }]));
    check('a row the scan flagged as generic is low here too',
        find(flagged, 'something_odd.safetensors').confidence === 'low');
    check('...even though this module has never heard of that name',
        find(flagged, 'something_odd.safetensors').confidenceReasons
            .some(x => x.code === 'generic-name'));
}

// 4. ★ A loader asking for a near-identical name suggests this IS that file
//    under a different spelling — exactly the 24K-vs-24k shape.
{
    const r = score(makeReport([row('vocoder_24k_bf16.safetensors')], {
        missing: [{ name: 'vocoder_24K.safetensors', nodeTypes: [], usedBy: ['b'], templateOnly: [], external: [] }],
    }));
    const m = find(r, 'vocoder_24k_bf16.safetensors');
    check('a near-match to something a loader cannot find is low confidence', m.confidence === 'low');
    check('...and names what is being looked for',
        m.confidenceReasons.some(x => x.code === 'near-missing' && x.detail.includes('vocoder_24K')));
}

// 5. ★ Material that SHIPS with ComfyUI explains why a file is on the disk
//    without making it used. 60 of this rig's 145 unused files (408 GB) are in
//    this class, so folding them into "used" would gut the tool — but deleting
//    40 GB without being told deserves a warning.
{
    const r = score(makeReport([row('shipped_with_comfy.safetensors')]));
    const m = find(r, 'shipped_with_comfy.safetensors');
    check('a model named by a built-in blueprint is medium, not low or high',
        m.confidence === 'medium');
    check('...and the reason explains why it is on the disk',
        m.confidenceReasons.some(x => x.code === 'reference-template'));
    check('it is still offered for deletion', m.unused === true);
}

// 6. Someone may be in the middle of using a model they just fetched.
{
    const r = score(makeReport([row('fresh.safetensors', { mtimeMs: NOW - 3 * DAY })]));
    check('a file added days ago is medium', find(r, 'fresh.safetensors').confidence === 'medium');
    check('...with the age in the reason',
        find(r, 'fresh.safetensors').confidenceReasons.some(x => x.code === 'recently-added'
            && /3 day/.test(x.detail)));
}

// 7. ★★ A scan that could not read a folder it was told about is wrong about
//    EVERY row, so nothing in that report may go without the same deliberate
//    acknowledgement a suspicious row needs. This used to resolve to
//    "medium" — which was UNGATED, so a blind scan still deleted.
{
    const r = score(makeReport([row('lonely.safetensors')], { missingDirs: ['D:\\gone'] }));
    check('an unreadable scan folder forces every verdict to low, which is gated',
        find(r, 'lonely.safetensors').confidence === 'low');
    check('...for the stated reason',
        find(r, 'lonely.safetensors').confidenceReasons.some(x => x.code === 'scan-incomplete'));
}
{
    const r = score(makeReport([row('lonely2.safetensors')], { configured: [] }));
    check('no configured folders at all does the same',
        find(r, 'lonely2.safetensors').confidence === 'low');
}

// 8. Nothing at all against it: confident, and it says so rather than going
//    silent (an empty explanation is what makes a score untrustworthy).
{
    const r = score(makeReport([row('nobody_wants_this.safetensors')]));
    const m = find(r, 'nobody_wants_this.safetensors');
    check('a file with nothing against it is confident', m.confidence === 'high');
    check('...and still carries a reason', m.confidenceReasons.some(x => x.code === 'no-trace'));
}

// 9. The model audit's own written verdict, now that it lives in the repo.
fs.mkdirSync(path.join(root, 'tools', 'maintenance', 'model-audit'), { recursive: true });
fs.writeFileSync(path.join(root, 'tools', 'maintenance', 'model-audit', 'decisions.json'),
    JSON.stringify({
        models: [
            { name: 'audit_keep.safetensors', classify: 'REVIEW', reason: 'needs a human' },
            { name: 'audit_delete.safetensors', classify: 'DELETE', reason: 'a false positive' },
            { name: 'audit_delete_but_lookalike.safetensors', classify: 'DELETE', reason: 'probably fine' },
            // The audit challenges its own first pass and records the settled
            // verdict in `final`. On this disk 62 rows disagree with their
            // `classify`, and every one of the 17 that are currently unused was
            // overturned from DELETE toward KEEP or REVIEW.
            { name: 'audit_overturned.safetensors', classify: 'DELETE', final: 'KEEP', reason: 'challenged: a pack loads it' },
        ],
    }));
{
    const r = score(makeReport([
        row('audit_keep.safetensors'),
        row('audit_delete.safetensors'),
        row('lookalike_bf16.safetensors', { unused: false, usedBy: ['b'] }),
        row('lookalike_fp8.safetensors'),
    ]));
    check('a model the audit says to KEEP is low confidence',
        find(r, 'audit_keep.safetensors').confidence === 'low');
    check('a model the audit says to DELETE is confident',
        find(r, 'audit_delete.safetensors').confidence === 'high');
    check('...carrying the audit\'s own reason',
        find(r, 'audit_delete.safetensors').confidenceReasons
            .some(x => x.code === 'audit-delete' && x.detail.includes('false positive')));
    // ★ "raises" must not overrule doubt about WHICH file this is.
    const r2 = score(makeReport([
        row('audit_delete_but_lookalike_bf16.safetensors', { unused: false, usedBy: ['b'] }),
        row('audit_delete_but_lookalike.safetensors'),
    ]));
    check('an audit DELETE does not rescue a row that resembles a used file',
        find(r2, 'audit_delete_but_lookalike.safetensors').confidence === 'low');

    // ★ The audit's SETTLED verdict beats its first pass. Reading `classify`
    // alone quoted an opinion the audit had already withdrawn, and did it in the
    // RAISING direction — 12 of the 17 affected rows sat at `medium`, the tier
    // the prune route does not gate.
    const r3 = score(makeReport([row('audit_overturned.safetensors')]));
    const over = find(r3, 'audit_overturned.safetensors');
    check('a verdict the audit overturned to KEEP is low, not confident',
        over.confidence === 'low');
    check('...and it reads as audit-keep rather than audit-delete',
        over.confidenceReasons.some(x => x.code === 'audit-keep')
        && !over.confidenceReasons.some(x => x.code === 'audit-delete'));
}

// 9b. ★★ Two copies of one basename on disk. Usage is matched by basename, so
//     a reference could have meant either, and the report only describes one.
//     Deleting the described copy leaves the SAME high-confidence row pointing
//     at the copy that IS in use — a two-step path to breaking a workflow, and
//     exactly the shape of the liveportrait animal/ vs human/ sets.
{
    const r = score(makeReport([
        row('twice.safetensors', { otherCopies: ['models/elsewhere/twice.safetensors'] }),
    ]));
    const m = find(r, 'twice.safetensors');
    check('a duplicated basename is low confidence', m.confidence === 'low');
    check('...and names the other copy',
        m.confidenceReasons.some(x => x.code === 'duplicate-basename'
            && x.detail.includes('models/elsewhere/twice.safetensors')));
}

// 10. The tallies the card's chips are drawn from.
{
    const r = score(makeReport([
        row('a_used_bf16.safetensors', { unused: false, usedBy: ['b'] }),
        row('a_used_fp8.safetensors'),                                  // low, lookalike
        row('shipped_with_comfy.safetensors'),                          // medium
        row('clean_one.safetensors'),                                   // high
        row('clean_two.safetensors', { gb: 2 }),                        // high
    ]));
    check('the tallies count each level', r.totals.confident === 2
        && r.totals.unsure === 1 && r.totals.suspicious === 1);
    check('and sum their sizes', r.totals.confidentGb === 3);
}

fs.rmSync(root, { recursive: true, force: true });
console.log(`modelConfidence: all ${ok.length} checks passed`);
