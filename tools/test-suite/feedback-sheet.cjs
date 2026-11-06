#!/usr/bin/env node
/**
 * Makes the sheet the owner fills in after a test-suite run: every result, in suite
 * order, with what to look or listen for and a place for a verdict.
 *
 *   node tools/test-suite/feedback-sheet.cjs          writes docs/showcase-feedback-<date>.md
 *   node tools/test-suite/feedback-sheet.cjs --print  prints it instead
 *
 * Reads the published report and the suite. It writes one new file and nothing else,
 * and refuses to overwrite a sheet that exists: it may hold the owner's comments.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..');
const { loadSuite } = require(path.join(REPO, 'server', 'benchmark', 'suitePlan'));

const known = new Set(['--print']);
const asked = process.argv.slice(2);
if (asked.some(a => !known.has(a))) {
    console.error('Usage: node tools/test-suite/feedback-sheet.cjs [--print]');
    process.exit(1);
}

function sheet(suite, report) {
    const rows = new Map((report.results || []).map(r => [r.id, r]));
    const date = String(report.finishedAt || report.startedAt || new Date().toISOString()).slice(0, 10);
    const L = [
        `# Showcase feedback, ${date}`,
        '',
        'One section per result, in suite order. Write after each `=>`. Leave a line empty if',
        'you have nothing to say. For the verdict: **ok**, **redo**, or **remove**.',
        '',
        'Results are on the scheduling page under **See an example**, and all of them under',
        '**Admin → Maintenance → Run the whole library**.',
        '',
    ];
    const listen = suite.runs.filter(r => !r.variant && /\blisten\b/i.test(r.note || ''));
    L.push('## Sound to check first', '', 'Nobody has listened to these. Their captions say what to listen for.', '');
    for (const r of listen) L.push(`- ${rows.get(r.id)?.name || r.id}`);
    L.push('');

    let stage = null;
    let n = 0;
    for (const run of suite.runs) {
        if (run.stage !== stage) { stage = run.stage; L.push(`## ${stage}`, ''); }
        n++;
        const row = rows.get(run.id);
        L.push(`### ${n}. ${row?.name || run.workflow}${run.variant ? ` (${run.variant})` : ''}`, '');
        L.push(`\`${run.id}\``, '');
        if (!row) L.push('⚠ No result: this run is not in the report.', '');
        else if (!row.ok) L.push(`⚠ ${row.skipped ? 'Skipped' : 'Failed'}: ${String(row.error || 'no reason recorded').slice(0, 300)}`, '');
        else {
            const files = (row.outputs || []).map(o => o.file).filter(Boolean);
            if (files.length) L.push(`Output: ${files.slice(0, 4).map(f => `\`${f}\``).join(', ')}${files.length > 4 ? `, and ${files.length - 4} more` : ''}`, '');
            const flags = (row.flagged || []).flatMap(f => f.flags || []);
            if (flags.length) L.push(`⚠ The automatic check flagged it: ${[...new Set(flags)].join(', ')}`, '');
        }
        if (run.note) L.push(`Look for: ${run.note}`, '');
        L.push('Verdict =>', '', 'Comments =>', '');
    }
    return { text: L.join('\n'), date, runs: n, listen: listen.length };
}

function main() {
    const report = JSON.parse(fs.readFileSync(path.join(REPO, 'server', 'data', 'library-sweep-latest.json'), 'utf8'));
    const { text, date, runs, listen } = sheet(loadSuite('library'), report);
    if (asked.includes('--print')) { console.log(text); return; }
    const out = path.join(REPO, 'docs', `showcase-feedback-${date}.md`);
    if (fs.existsSync(out)) {
        console.error(`${path.relative(REPO, out)} exists and may hold comments. Nothing was changed.`);
        process.exit(1);
    }
    fs.writeFileSync(out, text);
    console.log(`${path.relative(REPO, out)}: ${runs} results, ${listen} with sound to check`);
}

if (require.main === module) main();
module.exports = { sheet };
