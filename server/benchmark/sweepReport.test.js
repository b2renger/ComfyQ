const assert = require('assert');
const { renderSweepReport } = require('./sweepReport');

// The report exists to be pasted into a chat by someone who then expects the
// reader to act without asking follow-up questions. So these checks are about
// SUFFICIENCY: is each thing a fix would need actually on the page, and does the
// page put the problems where they will be read.

let pass = 0;
const ok = (what, cond) => { assert.ok(cond, what); pass++; console.log(`  ok  ${what}`); };

const LONG_ERROR = 'Prompt rejected by ComfyUI:\n'
    + 'Traceback (most recent call last):\n'
    + '  File "nodes.py", line 1402, in load_checkpoint\n'
    + "    raise ValueError(f'unknown model type')\n"
    + 'x'.repeat(2000);

const REPORT = {
    startedAt: '2026-10-07T12:00:00.000Z',
    finishedAt: '2026-10-07T14:04:00.000Z',
    state: 'done',
    machine: {
        host: 'EDNA-5090', instance: 'studio-1', gpu: 'NVIDIA GeForce RTX 5090', vramTotalGb: 31.8,
        comfyui: '0.39.1', pytorch: '2.8.0+cu128', python: '3.12.10',
        argv: ['--listen', '--port', '--use-sage-attention', '--fast'],
        comfyRoot: 'J:\\ComfyUI_windows_portable_nvidia\\ComfyUI_windows_portable\\ComfyUI',
        assetsDir: 'J:\\_assets', scanDirs: ['J:/_demo_workflows'],
        comfyqCommit: 'ae65829', comfyqBranch: 'main',
    },
    summary: {
        ran: 4, succeeded: 3, failed: 1, withFlaggedOutput: 1, noOutput: 1,
        distinctModelsOpened: 37, recorderAvailable: true,
    },
    results: [
        {
            id: 'image_qwen_image_2_1_t2i', name: 'Qwen Image 2.1', ok: true, wallSec: 19, vramPeakGb: 14.44,
            steps: 25,
            outputs: [{ file: 'bench_a_00001_.png', width: 1328, height: 1328, mean: 118.4, std: 52.1, bytes: 2_200_000, flags: [] }],
            flagged: [], observedModels: ['qwen_image_2.1_int8_convrot.safetensors', 'qwen_image_2.1_vae_bf16.safetensors'],
            perf: { argv: ['--use-sage-attention', '--fast'], bundleDisables: [], notMasked: [] },
        },
        {
            id: 'image_edit_qwen_multiple_scene_angles', name: 'Qwen scene angles', ok: true, wallSec: 41, vramPeakGb: 20.1,
            outputs: [{ file: 'bench_b_00001_.png', width: 1024, height: 1024, mean: 0, std: 0, bytes: 40_000, flags: ['black', 'flat'] }],
            flagged: [{ file: 'bench_b_00001_.png', flags: ['black', 'flat'], error: null }],
            observedModels: ['qwen_image_edit_2509_fp8_e4m3fn.safetensors'],
            perf: { argv: ['--use-sage-attention', '--fast'], bundleDisables: ['use_sage_attention'], notMasked: ['use_sage_attention'] },
            cause: 'ComfyUI was running with use_sage_attention, which this bundle declares it cannot use — '
                + 'any black or empty output here is that, not the graph.',
        },
        {
            id: '3d_trellis2_image_to_textured_mesh', name: 'TRELLIS2', ok: true, wallSec: 2,
            outputs: [], flagged: [], observedModels: [],
        },
        {
            id: 'video_edit_wan_idv2v_restyle_hires', name: 'Wan ID-V2V hi-res', ok: false, wallSec: 7,
            experimental: true, error: LONG_ERROR, outputs: [], flagged: [], observedModels: [],
            perf: { argv: ['--fast'], bundleDisables: [], notMasked: [] },
        },
    ],
};

const UNUSED = [
    { name: 'qwen_image_edit_2509_fp8_e4m3fn.safetensors', gb: 20.4, confidence: 'medium' },
    { name: 'v2-1_768-ema-pruned.safetensors', gb: 4.86, confidence: 'high' },
];

console.log('\nthe report says what produced it');
const txt = renderSweepReport(REPORT, { unused: UNUSED });
ok('names the GPU and its VRAM', /RTX 5090/.test(txt) && /31\.8 GB/.test(txt));
ok('names the ComfyUI and torch versions', /0\.39\.1/.test(txt) && /2\.8\.0\+cu128/.test(txt));
ok('records the ComfyQ commit and branch', /ae65829/.test(txt) && /on main/.test(txt));
ok('records the install path and the scan dirs', /ComfyUI_windows_portable/.test(txt) && /_demo_workflows/.test(txt));
ok('says it is meant to be pasted back', /[Pp]aste this whole report/.test(txt));

console.log('\nthe problems come first, and carry their diagnosis');
const needs = txt.indexOf('NEEDS ATTENTION');
const cleanAt = txt.indexOf('RAN CLEAN');
ok('NEEDS ATTENTION is above RAN CLEAN', needs > 0 && cleanAt > needs);
const firstBad = txt.indexOf('[1]');
const secondBad = txt.indexOf('[2]');
const thirdBad = txt.indexOf('[3]');
ok('the FAILED bundle is listed first', txt.slice(firstBad, secondBad).includes('FAILED'));
ok('the BLACK OUTPUT bundle is next', txt.slice(secondBad, thirdBad).includes('BLACK OUTPUT'));
ok('the one that produced nothing is after those', txt.slice(thirdBad).includes('NO OUTPUT'));
ok('a clean bundle is not in the attention section',
    !txt.slice(needs, cleanAt).includes('image_qwen_image_2_1_t2i'));

console.log('\nwhat a fix would need');
ok('the error text is included, not just a count', /unknown model type/.test(txt));
ok('a long error is kept to a pasteable length but says so',
    /more characters/.test(txt) && txt.length < 20000);
ok('the output measurements that condemned it are shown',
    /1024x1024/.test(txt) && /luma mean 0/.test(txt) && /black, flat/.test(txt));
// ★ The line that most often explains a black render.
ok('the flags ComfyUI actually ran with are shown', /comfyui ran with: --use-sage-attention --fast/.test(txt));
ok('a flag the bundle disowns but which was passed is called out', /NOT MASKED/.test(txt));
ok('and the likely cause is stated in words', /LIKELY CAUSE: .*use_sage_attention/.test(txt));
ok('a correctly masked bundle is not accused', /correctly masked|^(?!.*NOT MASKED)/m.test(txt));
// ★ The evidence a keep decision rests on has to be IN the report. A clean row
// only carries a count, so every observed weight is listed once in its own
// section — and the single-user case, which decides what goes when a bundle goes,
// is named.
ok('every model the sweep was seen to open is listed by name',
    /MODELS OPENED DURING THE SWEEP/.test(txt) && /qwen_image_2\.1_vae_bf16/.test(txt));
// ⚠ FIRST SIGHTING, not exclusive use. ComfyUI keeps a model loaded between
// prompts, so the second bundle wanting the same weight records nothing — the
// earlier wording ("only <bundle>") read as a licence to delete a weight four
// other live bundles load.
ok('a model seen in one run is reported as a FIRST SIGHTING, not as exclusive',
    /qwen_image_edit_2509_fp8_e4m3fn\.safetensors\s+first seen in image_edit_qwen_multiple_scene_angles/.test(txt)
    && !/\bonly image_edit_qwen_multiple_scene_angles/.test(txt));
ok('...and the caching reason is spelled out where it would be misread',
    /FIRST SIGHTING, never as exclusive use/.test(txt)
    && /keeps a model loaded between prompts/.test(txt));
ok('and it is marked as observed rather than inferred', /Observed, not inferred/.test(txt));
ok('experimental bundles are marked', /\(experimental\)/.test(txt));

console.log('\nthe prune cross-reference');
ok('a file called UNUSED that was opened during the sweep is flagged loudly',
    /calls UNUSED were opened/.test(txt) && /do NOT delete these/.test(txt)
    && /qwen_image_edit_2509_fp8_e4m3fn/.test(txt));
ok('...with its size and confidence tier', /20\.4 GB/.test(txt) && /\[medium\]/.test(txt));
// ⚠ The asymmetry this whole mechanism rests on.
ok('and states plainly that "never opened" is not proof of unused',
    /NOT proof/.test(txt) && /leaves no trace/.test(txt));

console.log('\ndegrading honestly');
ok('no report at all produces a sentence, not a throw',
    renderSweepReport(null).includes('No sweep report'));
const noRec = renderSweepReport({ ...REPORT, summary: { ...REPORT.summary, recorderAvailable: false } });
ok('a sweep that was not recording says the opened counts are empty',
    /NOT recording/.test(noRec));
const noProblems = renderSweepReport({
    ...REPORT,
    summary: { ...REPORT.summary, failed: 0, withFlaggedOutput: 0, noOutput: 0 },
    results: [REPORT.results[0]],
});
ok('a clean sweep still refuses to call itself a quality judgement',
    /NEEDS ATTENTION — none/.test(noProblems) && /open a few outputs yourself/.test(noProblems));
ok('a report with no prune list simply omits that section',
    !renderSweepReport(REPORT).includes('CROSS-REFERENCE'));

console.log('\na text output is not a missing output');
{
    // Found on the first REAL sweep: both Gemma captioners were flagged NO OUTPUT for
    // behaving correctly — their result is a caption, not a file. A caption therefore
    // counts as output.
    const caption = renderSweepReport({
        machine: {}, summary: {},
        results: [{
            id: 'describe_gemma4_image_description', category: 'description',
            ok: true, wallSec: 35, flagged: [], observedModels: ['gemma4.safetensors'],
            outputs: [{ kind: 'text', file: 'node 4', text: 'a real caption, in prose', chars: 24, flags: [] }],
        }],
    });
    ok('a description bundle whose caption arrived is NOT flagged',
        /NEEDS ATTENTION — none/.test(caption) && !/NO OUTPUT/.test(caption));
    // ★★ This assertion used to read "a description bundle with no file is NOT flagged",
    // exempting the category outright — and that is what hid the real failure: a stamp
    // guard stopped collecting the captions, both captioners produced literally nothing,
    // and the report called them clean. An exemption must say "a caption counts", never
    // "never report this kind".
    const silent = renderSweepReport({
        machine: {}, summary: {},
        results: [{
            id: 'describe_gemma4_image_description', category: 'description',
            ok: true, wallSec: 35, outputs: [], flagged: [], observedModels: ['gemma4.safetensors'],
        }],
    });
    ok('...but a captioner that produced NO caption is flagged, category notwithstanding',
        /NO OUTPUT/.test(silent));
    const img = renderSweepReport({
        machine: {}, summary: {},
        results: [{ id: 'image_thing', category: 't2i', ok: true, wallSec: 9, outputs: [], flagged: [] }],
    });
    ok('...and an image bundle with no file still is', /NO OUTPUT/.test(img));
}

// ---- the clean table, which is where a working result must still be legible ----
console.log('\nthe clean rows');
{
    const CAPTION = 'This is a digital rendering of a vibrant red sports car parked on an '
        + 'asphalt road, photographed from a low three-quarter angle in bright daylight.';
    const t = renderSweepReport({
        machine: {}, summary: {},
        results: [
            {
                id: 'describe_gemma4_image_description', category: 'description', ok: true, wallSec: 44,
                vramPeakGb: 10.55, flagged: [], observedModels: ['gemma4.safetensors'],
                outputs: [{ kind: 'text', file: 'node 4', text: CAPTION, chars: CAPTION.length, flags: [] }],
            },
            {
                // A real id from this library, 49 characters — longer than the column.
                id: 'video_edit_bernini_r_video_editing_ref_autoprompt', category: 'video-edit',
                ok: true, wallSec: 1101, vramPeakGb: 19.12, flagged: [], observedModels: [],
                outputs: [
                    { file: 'bench_x_00001_.mp4', width: 832, height: 832, mean: 171.53, std: 40.2, flags: [] },
                    { kind: 'text', file: 'node 117:57:1', text: '8', chars: 1, flags: [], stray: true },
                ],
            },
        ],
    });
    // ★ A caption IS the result; measuring it is printing nothing.
    ok('a working captioner\'s answer is printed in full, not measured',
        t.includes('asphalt road') && /the result, \d+ characters/.test(t));
    // ★ The stray tile is a student-facing defect, so it is reported, not hidden.
    ok('a bare string published as a result tile is called out as a defect',
        /also published the bare string "8" as a result tile/.test(t));
    ok('...and a stray is not mistaken for the result',
        !/node 117:57:1 — the result/.test(t));
    // ⚠ Column collisions: three rows of the first real report ran their fields
    // together (`…_with_reference32s`, `luma 171.534 models`). Checked on the widest
    // row in the library — the longest id against the longest duration and luma.
    const row = t.split('\n').find(l => l.includes('video_edit_bernini_r_video_editing_ref'));
    ok('the longest id in the library is printed whole, not clipped',
        row.includes('video_edit_bernini_r_video_editing_ref_autoprompt'));
    ok('no two fields run together on the widest row',
        / 18m 21s +19\.12GB +1 out +832x832 +luma 171\.53 +—/.test(row));
    // A weight ComfyUI already had loaded resolves nothing, so zero is not "none used".
    ok('zero observed models renders as a dash, not as 0 models', /\s—\s*$/.test(row));
    ok('the row describes the FILE, not the caption, when a bundle has both',
        /832x832/.test(row) && /luma 171\.53/.test(row));
}

console.log(`\nsweepReport: all ${pass} checks passed`);
