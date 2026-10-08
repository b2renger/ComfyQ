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
// Enough frames to see where it broke and what called it, without pasting 120 lines.
const TRACEBACK_LINES = 18;

const pad = (s, n) => String(s ?? '').padEnd(n);
/**
 * A fixed-width column that cannot run into the next one.
 *
 * `padEnd` does nothing when the value is already wider than the column, which is
 * how a 49-character bundle id and an 11-character luma reading each welded
 * themselves to the following field in the first real report. Clipped, and always
 * at least one space.
 */
const col = (s, n) => {
    const v = String(s ?? '');
    return (v.length > n - 1 ? `${v.slice(0, n - 2)}…` : v).padEnd(n);
};
const secs = (s) => {
    if (s == null) return '—';
    if (s < 90) return `${s}s`;
    const m = Math.floor(s / 60);
    return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
};

// A workflow whose result is TEXT saves no file, so "no output" is not a fault for
// it — the two Gemma captioners answer through a PreviewAny node and were both
// flagged on the first real sweep, and a detector that cries wolf on correct
// behaviour is how people learn to ignore it.
//
// ★★ But the fix has to be "a caption COUNTS as output", not "this category never
// reports". Exempting by category hid the real failure: a stamp guard stopped
// collecting the captions, both captioners produced literally nothing, and the
// report still called them clean because it had been told to ignore them. The only
// honest test is whether this row actually carries text.

/**
 * Is this text output the bundle's answer, or a node's plumbing?
 *
 * ★ Decided here as well as at collection time, on purpose. The sweep tags a stray
 * when it records one, but a report read back from an older run carries no tag, and
 * a renderer that trusted the tag would print `"3"` under the heading "the result".
 * Same rule either way: prose is an answer; beside a real file, a whitespace-free
 * string is plumbing; and when text is all there is it is the answer regardless.
 */
const isStrayText = (o, row) => o.kind === 'text'
    && ((row.outputs || []).some(x => x.kind !== 'text'))
    && !/\s/.test(String(o.text || '').trim());
const emitsText = (r) => (r.outputs || []).some(o => o.kind === 'text');

/** Why this row needs attention, in the order a human should look at them. */
function triage(r) {
    if (!r.ok) return { rank: 0, tag: 'FAILED' };
    const flags = new Set((r.flagged || []).flatMap(f => f.flags || []));
    if (flags.has('black')) return { rank: 1, tag: 'BLACK OUTPUT' };
    if (flags.has('empty')) return { rank: 1, tag: 'EMPTY FILE' };
    if (!(r.outputs || []).length && !emitsText(r)) return { rank: 2, tag: 'NO OUTPUT' };
    if (flags.size) return { rank: 3, tag: `SUSPECT OUTPUT (${[...flags].join(', ')})` };
    return { rank: 9, tag: 'ok' };
}

/**
 * The ingredients of a run, as lines.
 *
 * ★ Included for the problems, not for the clean rows: a failure or a black frame
 * is unfixable without knowing the prompt and the input that produced it, and that
 * is the whole reason the owner asked for this. A prompt is wrapped rather than
 * truncated, because the interesting part of a prompt is often at the end.
 */
function ingredientLines(r) {
    const rows = r.ingredients || [];
    if (!rows.length) return [];
    const out = ['ingredients:'];
    for (const g of rows) {
        const v = g.value;
        if (g.sourcePath) {
            out.push(`  ${g.label} [${g.type}] <- ${g.sourcePath}`);
            if (g.staged) out.push(`      staged into ComfyUI/input as ${g.staged}`);
            continue;
        }
        if (v === null || v === undefined || v === '') {
            out.push(`  ${g.label} [${g.type}] = (empty, ${g.from})`);
            continue;
        }
        const text = String(v);
        if (text.length <= 64 && !text.includes('\n')) {
            out.push(`  ${g.label} = ${text}   (${g.from})`);
        } else {
            out.push(`  ${g.label} (${g.from}):`);
            for (const seg of wrap(text, 70)) out.push(`      ${seg}`);
            if (g.truncated) out.push(`      … (${g.truncated} characters in all)`);
        }
    }
    return out;
}

function wrap(text, n) {
    const lines = [];
    for (const para of String(text).split('\n')) {
        if (!para.length) { lines.push(''); continue; }
        let line = '';
        for (const word of para.split(/\s+/)) {
            if ((line + ' ' + word).trim().length > n) { lines.push(line.trim()); line = word; }
            else line += ' ' + word;
        }
        if (line.trim()) lines.push(line.trim());
    }
    return lines;
}

function describeOutput(o) {
    // ★ A caption is the whole result of a describe workflow. Printed in full rather
    // than measured: there is nothing to measure, and the text IS the thing to read.
    if (o.kind === 'text') {
        return `${o.file} · ${o.chars} characters of text`;
    }
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
            L.push(`    error:${r.failedNode ? `  (at node ${r.failedNode})` : ''}`);
            for (const line of e.slice(0, ERROR_CHARS).split('\n')) L.push(`      ${line}`);
            if (e.length > ERROR_CHARS) L.push(`      … (${e.length - ERROR_CHARS} more characters; full text in the .jsonl)`);
        }
        // ★ The traceback, tail first. "aimdo memory compile error" named a failure
        // the one-liner could not explain; the frames below it are what located the
        // fault in comfy_aimdo's malloc graph. The last ones are the ones that matter.
        if (r.traceback) {
            const frames = String(r.traceback).split('\n').filter(l => l.trim());
            const tail = frames.slice(-TRACEBACK_LINES);
            L.push(`    traceback (last ${tail.length} of ${frames.length} lines):`);
            for (const line of tail) L.push(`      ${line.replace(/\s+$/, '')}`);
        }
        for (const row of ingredientLines(r)) L.push(`    ${row}`);
        for (const o of r.outputs || []) {
            L.push(`    output: ${describeOutput(o)}`);
            // ★ A caption is printed, not summarised. For a describe workflow it is the
            // entire result, and a reader cannot judge "did this work" from a length.
            if (o.kind === 'text' && o.text) {
                for (const seg of wrap(o.text, 70).slice(0, 24)) L.push(`            ${seg}`);
                if (wrap(o.text, 70).length > 24) L.push('            … (truncated; full text in the .jsonl)');
            }
            if (o.path) L.push(`            ${o.path}`);
        }
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
        // ★ The first output file, not the first output: a bundle that saves a picture
        // AND emits a caption would otherwise be described by whichever came first.
        const o = (r.outputs || []).find(x => x.kind !== 'text') || (r.outputs || [])[0];
        const models = (r.observedModels || []).length;
        L.push('  '
            // ★ Padded columns alone collide — the longest id here is 49 characters
            // against a 44-wide column, and `luma 171.53` fills an 11-wide one, so
            // three rows of the first real report ran their fields together
            // (`…_with_reference32s`, `luma 171.534 models`). Every column is now
            // clipped to fit and carries its own trailing space.
            // Widths are taken from the real library: the longest id is 48 characters
            // (`video_edit_bernini_r_video_editing_ref_autoprompt`) and the longest
            // duration `18m 21s`. The table therefore runs wider than the 78-column
            // prose around it, which is the right trade — clipping a bundle id would
            // break the one field a reader copies in order to re-run the row.
            + col(r.id, 50)
            + col(secs(r.wallSec), 8)
            + col(r.vramPeakGb ? `${r.vramPeakGb}GB` : '—', 8)
            // Files, not outputs: a stray tile and a caption each get their own line
            // below, so counting them here read as `5 out` for a run that saved two.
            + col(`${(r.outputs || []).filter(x => x.kind !== 'text').length} out`, 6)
            + col(o ? (o.width ? `${o.width}x${o.height}` : (o.kind || '')) : '', 11)
            + col(o && o.mean != null ? `luma ${o.mean}` : '', 12)
            // ⚠ Not "N models used" — see the note under MODELS OPENED. A bundle that
            // reuses a weight ComfyUI already has loaded resolves nothing and records
            // zero, so a dash is the honest rendering of zero here.
            + (models ? `${models} model${models === 1 ? '' : 's'}` : '—'));
        // ★ A caption IS the result of a describe workflow, so printing only its
        // length is printing nothing. The first report measured a working captioner's
        // 1403-character answer as `text` and showed none of it, which is exactly the
        // row a reader most wants to judge.
        for (const t of (r.outputs || []).filter(x => x.kind === 'text' && x.text && !isStrayText(x, r))) {
            L.push(`      ${t.file} — the result, ${t.chars} characters:`);
            for (const seg of wrap(t.text, 68).slice(0, 12)) L.push(`        ${seg}`);
            if (wrap(t.text, 68).length > 12) L.push('        … (full text in the .jsonl)');
        }
        // ★ And a stray one is a defect, reported rather than hidden: these reach a
        // student's gallery as a result tile beside the picture.
        for (const t of (r.outputs || []).filter(x => isStrayText(x, r))) {
            L.push(`      ⚠ ${t.file} also published the bare string ${JSON.stringify(t.text)} as a result tile`);
        }
    }
    L.push('');

    // ---- every weight the library was SEEN to open ------------------------
    // ★ One line per model, not per bundle: this is the evidence a keep decision
    // rests on, and it has to be in the report rather than only in the database.
    //
    // ⚠⚠ But it records a FIRST SIGHTING, not exclusive use, and the first version
    // of this section said "only <bundle>" — which invites exactly the deletion this
    // whole tool exists to prevent. ComfyUI keeps a loaded model across prompts, so
    // the second bundle that wants the same weight never resolves a path and its
    // window records nothing: 20 of 61 rows in the first real sweep reported zero
    // models, every one of them running straight after a sibling with the same
    // weights. `flux-2-klein-base-9b-fp8` read as "only image_edit_flux2_klein_9b_
    // image_edit" while four other live bundles need it. Remove that one bundle on
    // the strength of that line and you take the weight four others load.
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
        L.push('  ⚠ Read the right-hand column as FIRST SIGHTING, never as exclusive use.');
        L.push('    ComfyUI keeps a model loaded between prompts, so a second bundle wanting the');
        L.push('    same weight resolves no path and leaves no trace — which is why bundles that');
        L.push('    ran straight after a sibling show "—" in the models column above. A weight');
        L.push('    listed against one bundle may be needed by several; to find out which,');
        L.push('    ask the usage scan, not this list.');
        L.push('');
        for (const [name, ids] of [...byModel.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
            L.push(`  ${col(name, 56)}${ids.length === 1 ? `first seen in ${ids[0]}` : `seen in ${ids.length} runs`}`);
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
