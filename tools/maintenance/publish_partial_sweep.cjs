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
 * puts the two halves back together as one 61-row report from today.
 *
 * The summary is computed by LibrarySweep.summarize -- the same code the card
 * and the report use -- rather than counted here, so the published figures
 * cannot disagree with the UI's.
 */
const fs = require('fs');
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
const { LibrarySweep } = require(path.join(REPO, 'server', 'benchmark', 'librarySweep'));

const jsonl = process.argv[2];
if (!jsonl || !fs.existsSync(jsonl)) { console.error('usage: publish_partial.cjs <run.jsonl>'); process.exit(1); }

const lines = fs.readFileSync(jsonl, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const head = lines.find(l => l.type === 'start') || {};
const results = lines.filter(l => l.type === 'bundle').map(({ type, ...row }) => row)
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
if (!results.length) { console.error('no bundle rows in that file'); process.exit(1); }

const recorder = results.some(r => r.recorderAvailable);
const summary = LibrarySweep.summarize(results, recorder);
const report = {
    type: 'report',
    state: 'partial',
    startedAt: head.at || results[0].startedAt,
    finishedAt: results[results.length - 1].finishedAt,
    machine: head.machine || null,
    summary,
    results,
    recoveredFrom: path.basename(jsonl),
};

const out = path.join(REPO, 'server', 'data', 'library-sweep-latest.json');
fs.writeFileSync(out, JSON.stringify(report, null, 2));
console.log('published %d rows to %s', results.length, path.basename(out));
console.log('summary   %s', JSON.stringify(summary));

// What a continuation run still has to cover.
const have = new Set(results.map(r => r.id));
const all = fs.readdirSync(path.join(REPO, 'workflows'))
    .filter(d => !d.startsWith('_') && fs.existsSync(path.join(REPO, 'workflows', d, `${d}.meta.json`)));
const missing = all.filter(id => !have.has(id));
console.log('library   %d bundles; %d done, %d still to run', all.length, all.length - missing.length, missing.length);
console.log(JSON.stringify(missing));
