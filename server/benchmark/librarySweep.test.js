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

    // Nothing to tidy in server/data: this test writes only under its own temp dir.
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log(`\nlibrarySweep: all ${pass} checks passed`);
})();
