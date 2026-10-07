// Render a library sweep as plain text, meant to be pasted back into a chat.
//
// ★ The design rule: the reader has no access to this machine. Everything needed
// to act on a line must be IN the line. A report that says "3 bundles failed" has
// moved the work rather than done it — so each problem carries its untruncated
// error, the output measurements that condemned it, the perf flags ComfyUI was
// actually running with against the flags that bundle disowns (the known cause of
// a silently black render), and the weights it was seen to open.
//
// ★ And it is ordered by what needs a decision, not alphabetically: failures,
// then suspect output, then ran-but-produced-nothing, then one line each for
// everything that was fine. A report whose first screen is green is a report
// nobody reads to the end.
//
// Plain text rather than JSON on purpose: the JSONL beside it is the machine
// record, this is the one a person reads and forwards.

const WIDTH = 78;
const RULE = '='.repeat(WIDTH);
const THIN = '-'.repeat(WIDTH);
// Long enough for a real ComfyUI traceback, short enough to paste a whole sweep.
const ERROR_CHARS = 1200;

const pad = (s, n) => String(s ?? '').padEnd(n);
const secs = (s) => {
    if (s == null) return '—';
    if (s < 90) return `${s}s`;
    const m = Math.floor(s / 60);
    return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
};

/** Why this row needs attention, in the order a human should look at them. */
function triage(r) {
    if (!r.ok) return { rank: 0, tag: 'FAILED' };
    const flags = new Set((r.flagged || []).flatMap(f => f.flags || []));
    if (flags.has('black')) return { rank: 1, tag: 'BLACK OUTPUT' };
    if (flags.has('empty')) return { rank: 1, tag: 'EMPTY FILE' };
    if (!(r.outputs || []).length) return { rank: 2, tag: 'NO OUTPUT' };
    if (flags.size) return { rank: 3, tag: `SUSPECT OUTPUT (${[...flags].join(', ')})` };
    return { rank: 9, tag: 'ok' };
}

function describeOutput(o) {
    const bits = [o.file];
    if (o.width) bits.push(`${o.width}x${o.height}`);
    if (o.frames != null) bits.push(`${o.frames} frames${o.fps ? ` @ ${o.fps}fps` : ''}`);
    if (o.seconds != null) bits.push(`${o.seconds}s`);
    if (o.mean != null) bits.push(`luma mean ${o.mean} std ${o.std}`);
    if (o.peak != null) bits.push(`peak ${o.peak}`);
    if (o.format) bits.push(o.format);
    if (o.bytes != null) bits.push(`${(o.bytes / 1024 ** 2).toFixed(2)} MB`);
    if ((o.flags || []).length) bits.push(`-> ${o.flags.join(', ')}`);
    if (o.error) bits.push(`-> ${o.error}`);
    return bits.join('  ');
}

/**
 * @param {object} report      the sweep's summary record (machine, summary, results)
 * @param {object} [opts]
 * @param {Array}  [opts.unused]   the prune list, to cross-reference what was opened
 * @returns {string}
 */
function renderSweepReport(report, opts = {}) {
    if (!report || !Array.isArray(report.results)) return 'No sweep report available.\n';
    const m = report.machine || {};
    const s = report.summary || {};
    const L = [];

    L.push(RULE);
    L.push('ComfyQ — library sweep report');
    L.push(`finished ${report.finishedAt || '(unfinished)'}${report.state && report.state !== 'done' ? `  [${report.state}]` : ''}`);
    L.push('');
    L.push('Paste this whole report back to Claude to act on it. Everything needed to');
    L.push('diagnose a line is on the line; nothing here requires access to the machine.');
    L.push(RULE);
    L.push('');

    L.push('MACHINE');
    const mrow = (k, v) => { if (v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && !v.length)) L.push(`  ${pad(k, 16)}${Array.isArray(v) ? v.join(' ') : v}`); };
    mrow('host', m.host);
    mrow('instance', m.instance);
    mrow('gpu', m.gpu && `${m.gpu}${m.vramTotalGb ? ` · ${m.vramTotalGb} GB` : ''}`);
    mrow('comfyui', m.comfyui && `${m.comfyui}  (torch ${m.pytorch || '?'}, python ${m.python || '?'})`);
    mrow('comfyui argv', m.argv);
    mrow('comfyq', m.comfyqCommit && `${m.comfyqCommit}${m.comfyqBranch ? ` on ${m.comfyqBranch}` : ''}`);
    mrow('install', m.comfyRoot);
    mrow('assets', m.assetsDir);
    mrow('scan dirs', m.scanDirs?.length ? m.scanDirs : '(none configured)');
    L.push('');

    L.push('RESULT');
    L.push(`  ${s.ran ?? report.results.length} bundle(s) run · ${s.succeeded ?? '?'} clean · ${s.failed ?? '?'} failed`
        + ` · ${s.withFlaggedOutput ?? 0} with suspect output · ${s.noOutput ?? 0} produced nothing`);
    const wall = report.results.reduce((n, r) => n + (r.wallSec || 0), 0);
    L.push(`  wall time ${secs(wall)} · ${s.distinctModelsOpened ?? 0} distinct model file(s) opened`);
    if (s.recorderAvailable === false) {
        L.push('  ⚠ ComfyUI was NOT recording which models it opened, so every "opened" count');
        L.push('    below is empty and pruning cannot lean on observation from this run.');
    }
    L.push('');

    const rows = report.results.map(r => ({ r, t: triage(r) }))
        .sort((a, b) => a.t.rank - b.t.rank || a.r.id.localeCompare(b.r.id));
    const problems = rows.filter(x => x.t.rank < 9);
    const clean = rows.filter(x => x.t.rank === 9);

    // ---- the part that needs a decision ----------------------------------
    L.push(THIN);
    L.push(problems.length ? `NEEDS ATTENTION (${problems.length})` : 'NEEDS ATTENTION — none');
    L.push(THIN);
    if (!problems.length) {
        L.push('');
        L.push('  Every bundle ran and produced output that is not black, flat or empty.');
        L.push('  That is not a quality judgement — open a few outputs yourself.');
    }
    problems.forEach(({ r, t }, i) => {
        L.push('');
        L.push(`[${i + 1}] ${t.tag}  ${r.id}${r.experimental ? '  (experimental)' : ''}`);
        if (r.name && r.name !== r.id) L.push(`    ${r.name}`);
        L.push(`    ${secs(r.wallSec)}${r.vramPeakGb ? ` · ${r.vramPeakGb} GB peak` : ''}`
            + `${r.steps ? ` · ${r.steps} steps` : ''} · ${(r.outputs || []).length} output file(s)`);
        if (r.error) {
            const e = String(r.error);
            L.push('    error:');
            for (const line of e.slice(0, ERROR_CHARS).split('\n')) L.push(`      ${line}`);
            if (e.length > ERROR_CHARS) L.push(`      … (${e.length - ERROR_CHARS} more characters; full text in the .jsonl)`);
        }
        for (const o of r.outputs || []) L.push(`    output: ${describeOutput(o)}`);
        // ★ The line that most often explains a bad render.
        if (r.perf) {
            L.push(`    comfyui ran with: ${(r.perf.argv || []).join(' ') || '(no flags)'}`);
            if ((r.perf.bundleDisables || []).length) {
                L.push(`    bundle cannot use: ${r.perf.bundleDisables.join(', ')}`
                    + ((r.perf.notMasked || []).length ? '   <-- NOT MASKED' : '   (correctly masked)'));
            }
        }
        if (r.cause) L.push(`    LIKELY CAUSE: ${r.cause}`);
        const om = r.observedModels || [];
        L.push(`    opened ${om.length} model file(s)${om.length ? `: ${om.slice(0, 6).join(', ')}${om.length > 6 ? ` +${om.length - 6} more` : ''}` : ''}`);
    });
    L.push('');

    // ---- everything that was fine, one line each -------------------------
    L.push(THIN);
    L.push(`RAN CLEAN (${clean.length})`);
    L.push(THIN);
    for (const { r } of clean) {
        const o = (r.outputs || [])[0];
        L.push(`  ${pad(r.id, 44)}${pad(secs(r.wallSec), 7)}${pad(r.vramPeakGb ? `${r.vramPeakGb}GB` : '—', 8)}`
            + `${pad(`${(r.outputs || []).length} out`, 7)}`
            + `${o ? pad(o.width ? `${o.width}x${o.height}` : (o.kind || ''), 12) : pad('', 12)}`
            + `${o && o.mean != null ? pad(`luma ${o.mean}`, 11) : pad('', 11)}`
            + `${(r.observedModels || []).length} model${(r.observedModels || []).length === 1 ? '' : 's'}`);
    }
    L.push('');

    // ---- every weight the library was SEEN to open ------------------------
    // ★ One line per model, not per bundle: this is the evidence a keep decision
    // rests on, and it has to be in the report rather than only in the database.
    // The single-user case is the interesting one — a weight only one bundle
    // opens is the weight that goes when that bundle goes.
    const byModel = new Map();
    for (const r of report.results) {
        for (const n of (r.observedModels || [])) {
            if (!byModel.has(n)) byModel.set(n, []);
            byModel.get(n).push(r.id);
        }
    }
    if (byModel.size) {
        L.push(THIN);
        L.push(`MODELS OPENED DURING THE SWEEP (${byModel.size})`);
        L.push(THIN);
        L.push('');
        L.push('  Observed, not inferred — ComfyUI was seen resolving or loading each of these.');
        L.push('');
        for (const [name, ids] of [...byModel.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
            L.push(`  ${pad(name, 54)}${ids.length === 1 ? `only ${ids[0]}` : `${ids.length} bundles`}`);
        }
        L.push('');
    }

    // ---- the prune cross-reference ---------------------------------------
    if (Array.isArray(opts.unused) && opts.unused.length) {
        const opened = new Set();
        for (const r of report.results) for (const n of (r.observedModels || [])) opened.add(String(n).toLowerCase());
        const neverOpened = opts.unused.filter(u => !opened.has(String(u.name).toLowerCase()));
        const openedButUnused = opts.unused.filter(u => opened.has(String(u.name).toLowerCase()));
        L.push(THIN);
        L.push('CROSS-REFERENCE WITH THE PRUNE LIST');
        L.push(THIN);
        L.push('');
        if (openedButUnused.length) {
            L.push(`  ⚠ ${openedButUnused.length} file(s) the prune tool calls UNUSED were opened by a workflow`);
            L.push('    during this sweep. Observation beats inference: do NOT delete these, and the');
            L.push('    scan that missed them is a bug worth reporting with this report attached.');
            for (const u of openedButUnused) L.push(`      ${pad(`${u.gb} GB`, 10)}${u.name}   [${u.confidence || '?'}]`);
            L.push('');
        }
        L.push(`  ${neverOpened.length} of ${opts.unused.length} unused file(s) were not opened by any workflow here.`);
        L.push('    ⚠ That is NOT proof they are unneeded — a setting nobody exercised (Fast mode');
        L.push('    off, the second entry in a dropdown) leaves no trace either. It only means the');
        L.push('    sweep found no reason to keep them.');
        L.push('');
    }

    L.push(RULE);
    L.push('end of report');
    L.push(RULE);
    return L.join('\n') + '\n';
}

module.exports = { renderSweepReport };
