/**
 * Publish a sweep that was killed mid-run, from the per-run .jsonl it left.
 *
 * The sweep keeps its rows in memory and appends each one to a .jsonl as it
 * goes, publishing `library-sweep-latest.json` only at the end. So a restart
 * loses the in-memory rows -- and with them the merge base, because the next
 * run merges over the PUBLISHED report, not over the .jsonl. Without this the
 * only options are re-running everything or publishing a partial report that
 * reads like a verdict on the whole library.
 *
 * Writing the finished rows out as the published report makes the next run a
 * genuine continuation: it sweeps the bundles that are missing, and the merge
 * puts the two halves back together as one complete report from today.
 *
 * ★ A killed run that was itself a SUBSET (pressing "Run the remaining N" after
 * a first rescue, or re-running a few bundles) must not replace the report with
 * only its own rows: that would throw away the rows the first rescue published,
 * the card would offer to re-run them, and the wipe would delete their outputs.
 * The server merges a subset run over the published report for the same reason
 * (LibrarySweep._merged), so this does too:
 *   - the .jsonl names the bundles it planned (`ids` on its start line): rows of
 *     the published report that this run did NOT plan are kept; the ones it
 *     planned but never reached stay missing, so they are offered again;
 *   - an older .jsonl records only how many it planned: when that is fewer than
 *     the library holds, the run was a subset, and every published row it did
 *     not redo is kept;
 *   - a full run replaces the report, as it always has.
 *
 * The summary is computed by LibrarySweep.summarize -- the same code the card
 * and the report use -- rather than counted here, so the published figures
 * cannot disagree with the UI's.
 *
 * The report is written into the folder the .jsonl is in, which is the folder
 * the run wrote to: `server/data` for an ordinary sweep, the experiment's own
 * folder for a `--data-dir` run. Rescuing an experiment must not replace the
 * published report that the examples and the clone wipe read.
 *
 * Usage: node publish_partial_sweep.cjs <run.jsonl> [--dry]
 *   --dry  print what would be published and what is still to run; write nothing.
 */
const fs = require('fs');
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');

/**
 * The report to publish, from the .jsonl's parsed lines and the report already
 * published (or null). Pure: reads and writes nothing.
 *
 * @returns {{ report, carried: number, rule: string }}
 */
function buildReport({ lines, prev, libraryIds, jsonlName, summarize }) {
    const head = lines.find(l => l.type === 'start') || {};
    const fresh = lines.filter(l => l.type === 'bundle').map(({ type, ...row }) => row);
    if (!fresh.length) throw new Error('no bundle rows in that file');

    const freshIds = new Set(fresh.map(r => r.id));
    const library = new Set(libraryIds);
    const prevRows = (prev && Array.isArray(prev.results)) ? prev.results : [];
    let keep = () => false;
    let rule = 'full run: replaces the published report';
    if (Array.isArray(head.ids) && head.ids.length) {
        const planned = new Set(head.ids);
        keep = (r) => !planned.has(r.id);
        rule = `this run planned ${planned.size} bundle(s): published rows it did not plan are kept`;
    } else if (Number.isInteger(head.bundles) && head.bundles < library.size) {
        keep = () => true;
        rule = `this run planned ${head.bundles} of ${library.size} bundles (a subset): `
            + 'every published row it did not redo is kept';
    }
    // A workflow deleted since has no row worth carrying (same rule as the server).
    const carriedRows = prevRows.filter(r => !freshIds.has(r.id) && library.has(r.id) && keep(r));
    const results = [...carriedRows, ...fresh].sort((a, b) => String(a.id).localeCompare(String(b.id)));

    const times = (k) => results.map(r => Date.parse(r[k] || '')).filter(Number.isFinite);
    const startedAt = [head.at, carriedRows.length ? prev.startedAt : null]
        .map(t => Date.parse(t || '')).filter(Number.isFinite).concat(times('startedAt'));
    const finishedAt = times('finishedAt');
    const recorder = results.some(r => r.recorderAvailable);
    const report = {
        type: 'report',
        state: 'partial',
        startedAt: startedAt.length ? new Date(Math.min(...startedAt)).toISOString() : (head.at || null),
        finishedAt: finishedAt.length ? new Date(Math.max(...finishedAt)).toISOString() : null,
        machine: head.machine || (prev && prev.machine) || null,
        // The card's "Run the remaining N" continues a suite only from this field;
        // without it a rescued suite run's remainder would run as a plain sweep.
        suite: head.suite || null,
        summary: summarize(results, recorder),
        results,
        recoveredFrom: carriedRows.length && prev && prev.recoveredFrom
            ? `${prev.recoveredFrom} + ${jsonlName}` : jsonlName,
    };
    return { report, carried: carriedRows.length, rule };
}

/**
 * Where a killed run stopped, from the runs it planned (`ids` on its start line,
 * variants as `<card>@<variant>`). `from` is the earliest planned run after which
 * nothing ran clean: `run-suite.cjs --from <from>` redoes that tail and nothing
 * else. A failure before it is listed apart, to re-run with `--only`.
 *
 * ★ Counting missing CARDS (the library list below, "Run the remaining N") cannot
 * see a variant run that was never reached, nor a card whose row is a failure:
 * on 2026-11-10 that dropped the crashed card and 24 of 25 variant runs. Pure.
 *
 * @returns {null | { from: string|null, notReached: string[], failedBefore: string[] }}
 */
function resumePoint(lines) {
    const head = lines.find(l => l.type === 'start') || {};
    if (!Array.isArray(head.ids) || !head.ids.length) return null;
    const rows = new Map(lines.filter(l => l.type === 'bundle').map(l => [l.id, l]));
    const clean = (id) => !!rows.get(id)?.ok;
    let i = head.ids.length;
    while (i > 0 && !clean(head.ids[i - 1])) i--;
    return {
        from: i < head.ids.length ? head.ids[i] : null,
        notReached: head.ids.filter(id => !rows.has(id)),
        failedBefore: head.ids.slice(0, i).filter(id => !clean(id)),
    };
}

/** The published report that goes with a run's .jsonl: the folder it is in. */
function reportPathFor(jsonl) {
    return path.join(path.dirname(path.resolve(jsonl)), 'library-sweep-latest.json');
}

function main(argv) {
    const DRY = argv.includes('--dry');
    const jsonl = argv.find(a => !a.startsWith('--'));
    if (!jsonl || !fs.existsSync(jsonl)) {
        console.error('usage: node publish_partial_sweep.cjs <run.jsonl> [--dry]');
        process.exit(1);
    }
    const { LibrarySweep } = require(path.join(REPO, 'server', 'benchmark', 'librarySweep'));

    const lines = fs.readFileSync(jsonl, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    const out = reportPathFor(jsonl);
    let prev = null;
    try { prev = JSON.parse(fs.readFileSync(out, 'utf8')); } catch { /* nothing published yet */ }
    const libraryIds = fs.readdirSync(path.join(REPO, 'workflows'))
        .filter(d => !d.startsWith('_') && fs.existsSync(path.join(REPO, 'workflows', d, `${d}.meta.json`)));

    let built;
    try {
        built = buildReport({
            lines, prev, libraryIds, jsonlName: path.basename(jsonl),
            summarize: (rows, rec) => LibrarySweep.summarize(rows, rec),
        });
    } catch (e) { console.error(e.message); process.exit(1); }
    const { report, carried, rule } = built;

    if (!DRY) fs.writeFileSync(out, JSON.stringify(report, null, 2));
    console.log('%s %d rows to %s', DRY ? 'would publish' : 'published', report.results.length, out);
    console.log('rule      %s', rule);
    if (carried) console.log('kept      %d row(s) from the report that was already published', carried);
    console.log('summary   %s', JSON.stringify(report.summary));

    // What a continuation run still has to cover.
    const have = new Set(report.results.map(r => r.id));
    const missing = libraryIds.filter(id => !have.has(id));
    console.log('library   %d bundles; %d done, %d still to run', libraryIds.length, libraryIds.length - missing.length, missing.length);
    console.log(JSON.stringify(missing));
    const resume = resumePoint(lines);
    const suiteName = lines.find(l => l.type === 'start')?.suite?.name;
    if (resume && suiteName) {
        console.log('runs      %d not reached', resume.notReached.length);
        if (resume.from) console.log('resume    node tools/test-suite/run-suite.cjs %s --from %s', suiteName, resume.from);
        if (resume.failedBefore.length) {
            console.log('failed    before that: node tools/test-suite/run-suite.cjs %s --only %s', suiteName, resume.failedBefore.join(','));
        }
    }
    if (DRY) console.log('\n(dry run - nothing was written)');
}

module.exports = { buildReport, reportPathFor, resumePoint };

if (require.main === module) main(process.argv.slice(2));
