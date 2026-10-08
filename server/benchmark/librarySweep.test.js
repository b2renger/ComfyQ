const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// The sweep's own logic, without a GPU: what it refuses, how it finds the outputs
// of the run it just did, what it preserves, and how it attributes the models
// ComfyUI opened. The actual rendering is a two-hour run on real hardware and is
// not something a test can stand in for — so these pin the parts that decide
// whether that run's REPORT is trustworthy.

const { LibrarySweep } = require('./librarySweep');

let pass = 0;
const ok = (what, cond) => { assert.ok(cond, what); pass++; console.log(`  ok  ${what}`); };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'comfyq-sweep-'));
const root = path.join(tmp, 'ComfyUI');
const outDir = path.join(root, 'output');
fs.mkdirSync(path.join(outDir, 'audio'), { recursive: true });
// ★ Never server/data. A sweep writes a `…-latest.json` that the report route
// serves, so a test writing there publishes a fixture as this machine's last
// real sweep — which is exactly what happened before dataDir was injectable.
const dataDir = path.join(tmp, 'data');

const entry = (id, extra = {}) => ({
    id, apiWorkflow: { 1: { class_type: 'KSampler' } },
    summary: { name: id, category: 't2i' }, meta: {}, effective: { exposedParameters: [] },
    ...extra,
});

function make({ mode = 'admin', calibrator = {}, entries = [entry('a'), entry('b')] } = {}) {
    const written = [];
    const registry = {
        list: () => entries,
        get: (id) => entries.find(e => e.id === id),
        writeRuntime: (id, rt) => written.push({ id, rt }),
    };
    const sweep = new LibrarySweep({
        registry,
        calibrator: () => calibrator,
        config: () => ({ comfy_ui: { root_path: root, output_dir: outDir } }),
        mode: () => mode,
        dataDir,
    });
    return { sweep, written, registry };
}

(async () => {
    console.log('\nwhat it refuses');
    {
        // ★ The refusal that matters: a sweep holds the GPU for ~2 h and restarts
        // ComfyUI whenever the next bundle needs a different perf flag. Either
        // would break a class mid-booking.
        const { sweep } = make({ mode: 'student' });
        const r = await sweep.start();
        ok('refuses while the rig is serving students', r.ok === false && /serving students/.test(r.error));
        ok('...and says what to do about it', /admin mode/.test(r.error));
    }
    {
        const { sweep } = make({ calibrator: null });
        const r = await sweep.start();
        ok('refuses with no ComfyUI backend', r.ok === false);
    }
    {
        const { sweep } = make({ entries: [] });
        const r = await sweep.start();
        ok('refuses when there is nothing to run', r.ok === false && /no workflows/.test(r.error));
    }
    {
        const { sweep } = make({ entries: [entry('x'), { id: 'y', summary: {} }] });
        const r = await sweep.start({ ids: ['y'] });
        ok('a bundle with no api.json is not runnable, so a sweep of only that is refused',
            r.ok === false);
        sweep.stop();
    }

    console.log('\nfinding the outputs of the run it just did');
    {
        const { sweep } = make();
        const since = Date.now();
        // What the benchmark stamps on every save node, including subfolders.
        fs.writeFileSync(path.join(outDir, 'bench_a_123_00001_.png'), Buffer.alloc(40));
        fs.writeFileSync(path.join(outDir, 'audio', 'bench_a_123_00001_.flac'), Buffer.alloc(40));
        // Another bundle's file, and one from an earlier sweep.
        fs.writeFileSync(path.join(outDir, 'bench_b_999_00001_.png'), Buffer.alloc(40));
        const old = path.join(outDir, 'bench_a_000_00001_.png');
        fs.writeFileSync(old, Buffer.alloc(40));
        fs.utimesSync(old, new Date(since - 600000), new Date(since - 600000));

        const found = await sweep._describeOutputs('a', since);
        const names = found.map(f => f.file).sort();
        ok('finds this bundle\'s outputs, including in a subfolder',
            names.includes('bench_a_123_00001_.png') && names.includes('audio/bench_a_123_00001_.flac'));
        ok('does not credit another bundle\'s output to it',
            !names.some(n => n.includes('bench_b_')));
        // ★ Without the mtime guard a previous sweep's files would be reported as
        // this run's, so a bundle that produced nothing would look fine.
        ok('does not credit an earlier run\'s file to this one',
            !names.some(n => n.includes('bench_a_000')));
        ok('reports a path relative to the output dir, with forward slashes',
            names.every(n => !n.includes('\\') && !path.isAbsolute(n)));
    }
    {
        const { sweep } = make();
        const found = await sweep._describeOutputs('nothing_ran', Date.now());
        ok('a bundle that produced nothing returns an empty list, not a throw', found.length === 0);
    }
    {
        // ★ Found in the first real sweep's files: several bundle ids are prefixes
        // of others, so a bare startsWith gave the shorter bundle the longer one's
        // picture — the plain Bernini editing row was shown holding the reference
        // row's output. The match is anchored on the timestamp that follows the id.
        const { sweep } = make();
        const since = Date.now();
        fs.writeFileSync(path.join(outDir, 'bench_edit_1700000000001_00001_.png'), Buffer.alloc(40));
        fs.writeFileSync(path.join(outDir, 'bench_edit_with_reference_1700000000002_00001_.png'), Buffer.alloc(40));
        const shortId = (await sweep._describeOutputs('edit', since)).map(f => f.file);
        const longId = (await sweep._describeOutputs('edit_with_reference', since)).map(f => f.file);
        ok('a bundle whose id prefixes another does not claim its output',
            shortId.length === 1 && shortId[0].includes('bench_edit_1700000000001'));
        ok('...and the longer id still finds its own',
            longId.length === 1 && longId[0].includes('with_reference'));
    }

    console.log('\nwhat a sweep must not quietly overwrite');
    {
        // PiD's progress bar counts tiles, so its automatic split under-reports the
        // warm time — its runtime.json says source:'manual' for that reason.
        const manual = { estimatedDurationSec: 18, source: 'manual' };
        const entries = [entry('pid', { runtime: manual }), entry('normal', { runtime: { source: 'benchmark' } })];
        const calibrated = [];
        const calibrator = {
            calibrate: async (id) => {
                calibrated.push(id);
                return { estimatedDurationSec: 8, coldDurationSec: 9, source: 'benchmark' };
            },
        };
        const { sweep, written } = make({ entries, calibrator });
        const r = await sweep.start();
        ok('starts when admin and runnable', r.ok === true && r.total === 2);
        // wait for the (fast, stubbed) run to finish
        for (let i = 0; i < 100 && sweep.status().state === 'running'; i++) {
            await new Promise(res => setTimeout(res, 20));
        }
        const st = sweep.status();
        ok('ran every bundle', calibrated.length === 2);
        ok('finished', st.state === 'done');
        const restored = written.filter(w => w.id === 'pid' && w.rt.source === 'manual');
        ok('a hand-measured runtime is put back after the sweep recalibrates over it',
            restored.length === 1 && restored[0].rt.estimatedDurationSec === 18);
        ok('...and says so in the row',
            st.results.find(x => x.id === 'pid').runtimeKept);
        ok('a benchmark runtime is left as the sweep measured it',
            !written.some(w => w.id === 'normal'));
        ok('the summary counts what ran', st.summary.ran === 2 && st.summary.succeeded === 2);
        // Written as the sweep goes, not once at the end: a two-hour run that is
        // interrupted must still leave behind what it learned.
        const written2 = fs.readdirSync(dataDir).filter(n => n.startsWith('library-sweep-'));
        ok('a report file was written, and a latest pointer beside it',
            written2.some(n => n.endsWith('.jsonl')) && written2.includes('library-sweep-latest.json'));
        const lines = fs.readFileSync(path.join(dataDir, written2.find(n => n.endsWith('.jsonl'))), 'utf8')
            .trim().split('\n').map(JSON.parse);
        ok('...with one line per bundle plus a start and a summary',
            lines[0].type === 'start' && lines.filter(l => l.type === 'bundle').length === 2
            && lines[lines.length - 1].type === 'summary');
        ok('and the machine context is recorded up front, not only at the end',
            Object.prototype.hasOwnProperty.call(lines[0], 'machine'));
    }

    console.log('\na failing bundle does not stop the sweep');
    {
        const entries = [entry('boom'), entry('fine')];
        const calibrator = {
            calibrate: async (id) => {
                if (id === 'boom') throw new Error('Prompt rejected: missing node');
                return { estimatedDurationSec: 5 };
            },
        };
        const { sweep } = make({ entries, calibrator });
        await sweep.start();
        for (let i = 0; i < 100 && sweep.status().state === 'running'; i++) {
            await new Promise(res => setTimeout(res, 20));
        }
        const st = sweep.status();
        ok('both bundles are reported', st.results.length === 2);
        ok('the failure is recorded with its reason',
            st.results.find(x => x.id === 'boom').ok === false
            && /missing node/.test(st.results.find(x => x.id === 'boom').error));
        ok('the one after it still ran', st.results.find(x => x.id === 'fine').ok === true);
        ok('the summary separates the two', st.summary.failed === 1 && st.summary.succeeded === 1);
        // ★ A bundle that "succeeded" with no output is its own failure class: the
        // rig has shipped bundles that reported success and saved nothing usable.
        // Only the one that SUCCEEDED counts here: a failure is already its own
        // category, and double-counting it would inflate the suspect-output tile.
        ok('a success with no output file is counted as such, and a failure is not double-counted',
            st.summary.noOutput === 1);
    }

    console.log('\nattributing opened weights to the bundle that opened them');
{
    // ★★ The bug the first re-run exposed within one bundle. The access log is
    // append-only and its name index keeps each weight's EARLIEST sighting, so
    // "names after minus names before" reports only weights never loaded on this
    // machine before — nearly nothing on a second sweep. A bundle the previous
    // sweep credited with 5 models reported 0. Worse, that reads downstream as
    // "the sweep found no reason to keep this", which is the dangerous direction.
    const { namesOpenedBetween, invalidateAccessLog, readAccessLog } = require('../workflows/modelAccessLog');
    const logRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'comfyq-acc-'));
    const now = Math.floor(Date.now() / 1000);
    fs.writeFileSync(path.join(logRoot, 'comfyq_model_access.jsonl'), [
        { path: 'C:/m/untouched.safetensors', at: now - 10000, how: 'load' },
        { path: 'C:/m/shared_vae.safetensors', at: now - 10000, how: 'load' },  // seen long ago
        { path: 'C:/m/shared_vae.safetensors', at: now - 30, how: 'load' },     // AND in this run
        { path: 'C:/m/fresh_unet.safetensors', at: now - 20, how: 'load' },
        'not json at all',                                                      // a torn tail
    ].map(o => (typeof o === 'string' ? o : JSON.stringify(o))).join('\n') + '\n');
    invalidateAccessLog();

    const win = namesOpenedBetween(logRoot, (now - 60) * 1000, (now + 5) * 1000);
    ok('a weight loaded again in this window IS credited to it',
        win.includes('shared_vae.safetensors'));
    ok('a weight loaded for the first time is credited too',
        win.includes('fresh_unet.safetensors'));
    ok('a weight nobody touched in the window is NOT credited',
        !win.includes('untouched.safetensors'));
    // the approach this replaced, kept as the contrast that justifies it
    const diff = [...readAccessLog(logRoot).byName.keys()]
        .filter(n => !new Set(['untouched.safetensors', 'shared_vae.safetensors']).has(n));
    ok('...where a set difference would have missed the re-loaded one entirely',
        !diff.includes('shared_vae.safetensors'));
    ok('a torn line costs one entry, not the whole log', win.length === 2);
    ok('no log at all gives an empty list rather than a throw',
        namesOpenedBetween(path.join(tmp, 'nowhere'), 0, Date.now()).length === 0);
    fs.rmSync(logRoot, { recursive: true, force: true });
}

console.log('\nthe perf diagnostic has to work for the bundles that need it');
{
    // ★★ This branch is only REACHABLE when a bundle declares a flag, because
    // Array.prototype.filter never invokes its callback on an empty array. The
    // original code called `flagsFromArgv(argv).includes(k)` — flagsFromArgv returns
    // an OBJECT — so it raised a TypeError and the whole perf record was abandoned,
    // silently, for exactly the five bundles whose documented failure mode is a black
    // image. 56 bundles recorded it fine, which is why it looked healthy.
    const calibrator = { calibrate: async () => ({ estimatedDurationSec: 5 }) };
    const declaring = [entry('masked', { meta: { requirements: { disabledPerfFlags: ['use_sage_attention'] } } })];

    const unmasked = make({ entries: declaring, calibrator });
    unmasked.sweep._systemInfo = async () => ({ argv: ['--listen', '--use-sage-attention', '--fast'] });
    await unmasked.sweep.start();
    for (let i = 0; i < 100 && unmasked.sweep.status().state === 'running'; i++) {
        await new Promise(res => setTimeout(res, 20));
    }
    const bad = unmasked.sweep.status().results[0];
    ok('a bundle that declares a flag still records a perf block', !!bad.perf);
    ok('...naming what it disowns', (bad.perf.bundleDisables || []).join() === 'use_sage_attention');
    ok('...and catching the flag that was NOT masked', (bad.perf.notMasked || []).join() === 'use_sage_attention');
    ok('...with the cause stated in words', /use_sage_attention/.test(bad.cause || ''));

    const fine = make({ entries: declaring, calibrator });
    fine.sweep._systemInfo = async () => ({ argv: ['--listen', '--fast'] });
    await fine.sweep.start();
    for (let i = 0; i < 100 && fine.sweep.status().state === 'running'; i++) {
        await new Promise(res => setTimeout(res, 20));
    }
    const good = fine.sweep.status().results[0];
    ok('a correctly masked flag is not reported as unmasked', (good.perf.notMasked || []).length === 0);
    ok('...and no cause is invented', !good.cause);
}

console.log('\na failure must still say what it was fed, and why it broke');
{
    // Found on the first real sweep: the two bundles that failed carried no prompt,
    // no params and no input paths, because ingredients were captured only in the
    // success branch — backwards, since a failure is when you need them most.
    const err = Object.assign(new Error('aimdo memory compile error'), {
        traceback: 'Traceback (most recent call last):\n  File "nodes.py", line 1596\n  RuntimeError: aimdo memory compile error',
        exceptionType: 'RuntimeError',
        failedNode: '42 (KSampler)',
    });
    const calibrator = {
        calibrate: async () => { throw err; },
        lastRunDetails: () => ({
            workflowId: 'boom',
            paramValues: { seed: 7 },
            media: { image: { source: 'J:/_assets/Woman.png', staged: 'comfyq_x.png', how: 'resolved from the assets dir' } },
        }),
    };
    const entries = [entry('boom', {
        effective: { exposedParameters: [
            { key: 'image', label: 'Source image', type: 'image', nodeId: '1', field: 'image' },
            { key: 'seed', label: 'Seed', type: 'number', nodeId: '2', field: 'seed' },
        ] },
        apiWorkflow: { 1: { class_type: 'LoadImage', inputs: {} }, 2: { class_type: 'KSampler', inputs: { seed: 1 } } },
    })];
    const { sweep } = make({ entries, calibrator });
    await sweep.start();
    for (let i = 0; i < 100 && sweep.status().state === 'running'; i++) {
        await new Promise(res => setTimeout(res, 20));
    }
    const r = sweep.status().results[0];
    ok('a failed bundle records its ingredients', (r.ingredients || []).length === 2);
    ok('...including the asset path it was actually fed',
        r.ingredients.find(g => g.key === 'image')?.sourcePath === 'J:/_assets/Woman.png');
    ok('the traceback is kept, not just the one-line message', /malloc|nodes\.py/.test(r.traceback || ''));
    ok('...with the failing node and exception type', r.failedNode === '42 (KSampler)' && r.exceptionType === 'RuntimeError');
}

console.log('\nclearing the results, because a half report is worse than none');
{
    const calibrator = { calibrate: async () => ({ estimatedDurationSec: 5 }) };
    const { sweep } = make({ entries: [entry('one')], calibrator });
    await sweep.start();
    for (let i = 0; i < 100 && sweep.status().state === 'running'; i++) {
        await new Promise(res => setTimeout(res, 20));
    }
    ok('a finished sweep leaves a report on disk',
        fs.readdirSync(dataDir).some(n => n.startsWith('library-sweep-')));
    const out = sweep.clear();
    ok('clear removes the report files', out.ok && out.removed >= 1);
    ok('...and forgets the in-memory run', sweep.status() === null);
    ok('...and leaves nothing behind in the data dir',
        !fs.readdirSync(dataDir).some(n => n.startsWith('library-sweep-')));
    ok('clearing again is harmless', sweep.clear().ok === true);
}

console.log('\nthe recorder\'s absence must be visible, not read as "nothing was opened"');
    {
        // ★ With no log on disk, "0 models opened" and "we were not recording" look
        // identical in the numbers — and only one of them is a reason to doubt the
        // sweep. The report carries the distinction so the card can say so.
        const calibrator = { calibrate: async () => ({ estimatedDurationSec: 5 }) };
        const { sweep } = make({ entries: [entry('solo')], calibrator });
        await sweep.start();
        for (let i = 0; i < 100 && sweep.status().state === 'running'; i++) {
            await new Promise(res => setTimeout(res, 20));
        }
        const st = sweep.status();
        ok('the summary states whether the recorder was available at all',
            st.summary.recorderAvailable === false);
        ok('...and reports no observed models rather than inventing some',
            st.results[0].observedModels.length === 0);
        ok('a run with no models opened is still counted as having run',
            st.summary.ran === 1 && st.summary.succeeded === 1);
    }

    console.log('\nthe report has to say which machine produced it');
    {
        // ★ A complete 61-bundle report went out with NO machine block — no host, no
        // GPU, no ComfyUI version, no commit — because status() omitted the field
        // while the route copied `machine: run.machine` from it, a line that reads as
        // if it handled the case. Both files on disk held all of it.
        const calibrator = { calibrate: async () => ({ estimatedDurationSec: 5 }) };
        const { sweep } = make({ entries: [entry('solo')], calibrator });
        await sweep.start();
        const live = sweep.status();
        ok('the live status carries the machine block the report prints',
            !!live.machine && typeof live.machine.host === 'string' && live.machine.host.length > 0);
        ok('...including where the install is, which a reader cannot guess',
            live.machine.comfyRoot === root);
        for (let i = 0; i < 100 && sweep.status().state === 'running'; i++) {
            await new Promise(res => setTimeout(res, 20));
        }
        ok('and the finished report keeps it', !!sweep.lastReport().machine.host);
        sweep.clear();
    }

    console.log('\nre-running one bundle must not erase the other sixty');
    {
        // ★ A subset run wrote a `…-latest.json` containing only its own rows, and the
        // report route served that as the machine's verdict on its library — so
        // checking one fix destroyed a two-hour record. Also the shape of the
        // "Run the remaining N" button after a stop.
        const calibrator = { calibrate: async () => ({ estimatedDurationSec: 5 }) };
        const all = [entry('one'), entry('two'), entry('three')];
        const { sweep } = make({ entries: all, calibrator });
        const settle = async () => {
            for (let i = 0; i < 200 && sweep.status()?.state === 'running'; i++) {
                await new Promise(res => setTimeout(res, 20));
            }
        };
        await sweep.start();
        await settle();
        ok('a full sweep records every bundle', sweep.lastReport().results.length === 3);
        await sweep.start({ ids: ['two'] });
        await settle();
        const after = sweep.lastReport();
        ok('re-running one bundle leaves all three in the published report',
            after.results.length === 3 && after.results.map(r => r.id).join(',') === 'one,three,two');
        ok('...the summary counts the merged set, not just the re-run',
            after.summary.ran === 3);
        ok('...and the per-run .jsonl still records only what that run did',
            fs.readdirSync(dataDir).filter(n => /^library-sweep-.*\.jsonl$/.test(n)).length === 2);
        sweep.clear();
    }

    console.log('\na caption must not be credited to the wrong bundle');
    {
        // ⚠ "The newest history entry" is only this bundle's run if a run reached
        // ComfyUI at all. A bundle that fails before queueing leaves the PREVIOUS
        // bundle's entry newest — so the prompt itself has to prove ownership.
        const { sweep } = make();
        const hist = (prefix) => ({
            k: { prompt: [0, 'id', { 9: { inputs: { filename_prefix: prefix } } }],
                outputs: { 4: { text: ['a real caption with spaces'] } } },
        });
        const realFetch = global.fetch;
        // ★ A REAL stamp, 13 digits, because that is what Date.now() produces. The
        // original fixtures used `_1759` and `_17`, and a short number is exactly what
        // let a lazy regex look correct: with 4 digits nothing was recognised as a stamp
        // at all, so both the "mine" and the "theirs" case passed for the wrong reason.
        global.fetch = async () => ({ ok: true, json: async () => hist('bench_image_edit_bernini_r_image_editing_with_reference_1791399205943') });
        try {
            const mine = await sweep._collectTextOutputs('image_edit_bernini_r_image_editing_with_reference', false);
            ok('a caption from this bundle\'s own run is taken', mine.length === 1);
            // The exact collision that already mis-credited a picture: one id is a
            // prefix of the other, so only the digit after it separates them.
            const theirs = await sweep._collectTextOutputs('image_edit_bernini_r_image_editing', false);
            ok('a caption from a longer-named sibling\'s run is refused', theirs.length === 0);
            // ★★ THE REGRESSION this guard caused. A `description` bundle writes no file,
            // so its prompt carries no filename_prefix and therefore no stamp — demanding
            // one threw away the caption of every captioner, which is the only thing this
            // function exists to collect. An entry with NO stamp is ours; only an entry
            // carrying somebody else's is refused.
            global.fetch = async () => ({ ok: true, json: async () => ({
                k: { prompt: [0, 'id', { 4: { class_type: 'PreviewAny', inputs: { source: ['3', 0] } } }],
                    outputs: { 4: { text: ['This is a photograph of a red sports car on asphalt.'] } } },
            }) });
            const stampless = await sweep._collectTextOutputs('describe_gemma4_image_description', false);
            ok('a captioner with no save node — so no stamp at all — keeps its caption',
                stampless.length === 1 && /red sports car/.test(stampless[0].text));
            // And an id whose own name contains digits and underscores must not be
            // mis-parsed: a lazy match read `bench_video_ltx2_5_i2v_…` as `bench_video_ltx2_5`.
            global.fetch = async () => ({ ok: true, json: async () => ({
                k: { prompt: [0, 'id', { 9: { inputs: { filename_prefix: 'bench_video_ltx2_5_i2v_1791399205943' } } }],
                    outputs: { 4: { text: ['prose from the ltx run'] } } },
            }) });
            ok('an id containing digits and underscores still matches its own stamp',
                (await sweep._collectTextOutputs('video_ltx2_5_i2v', false)).length === 1);
            ok('...and does not match a different bundle',
                (await sweep._collectTextOutputs('video_ltx2_5_t2v', false)).length === 0);

            global.fetch = async () => ({ ok: true, json: async () => ({
                k: { prompt: [0, 'id', { 9: { inputs: { filename_prefix: 'bench_solo_1791399205943' } } }],
                    outputs: { 4: { text: ['the answer, in prose'] }, 7: { text: ['3'] } } },
            }) });
            const withFiles = await sweep._collectTextOutputs('solo', true);
            ok('beside a real file, a bare string is tagged as a stray rather than dropped',
                withFiles.length === 2 && withFiles.find(o => o.text === '3').stray === true
                && !withFiles.find(o => o.text === 'the answer, in prose').stray);
            const noFiles = await sweep._collectTextOutputs('solo', false);
            ok('...and nothing is a stray when text is all the run produced',
                noFiles.every(o => !o.stray));
        } finally { global.fetch = realFetch; }
    }

    console.log('\nthe exemption that stops a false alarm must not silence the true one');
    {
        // ★★ A `description` bundle was exempted from the no-output counter BY CATEGORY,
        // so that a caption would not read as "produced nothing". Then the captions
        // stopped being collected and the counter said nothing, because it had been told
        // never to speak about that category. The honest form is to count a caption AS an
        // output — so a captioner that produced nothing is reported like anything else.
        const row = (extra) => ({ id: 'describe_gemma4_image_description', category: 'description', ok: true, outputs: [], flagged: [], observedModels: [], ...extra });
        const withCaption = LibrarySweep.summarize([row({
            outputs: [{ kind: 'text', file: 'node 4', text: 'a real caption, in prose', chars: 24, flags: [] }],
        })], true);
        ok('a captioner WITH its caption is not reported as producing nothing',
            withCaption.noOutput === 0);
        const without = LibrarySweep.summarize([row({})], true);
        ok('a captioner with NO caption IS reported, category notwithstanding',
            without.noOutput === 1);
        // The original false alarm must still not fire for an image bundle that saved a file.
        const img = LibrarySweep.summarize([{ id: 'i', category: 't2i', ok: true, flagged: [], observedModels: [], outputs: [{ file: 'a.png', width: 8, height: 8 }] }], true);
        ok('a bundle that saved a file is never reported as producing nothing', img.noOutput === 0);
    }

    // Nothing to tidy in server/data: this test writes only under its own temp dir.
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log(`\nlibrarySweep: all ${pass} checks passed`);
})();
