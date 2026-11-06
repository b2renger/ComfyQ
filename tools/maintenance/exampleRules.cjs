/**
 * The two judgements seed_examples.cjs makes about a published sweep row,
 * kept apart so they can be tested without a database.
 *
 *  - sameRun: is this row the run the suite FILE's entry describes now? Only
 *    then may the file's (possibly corrected) caption be put on its result.
 *  - showableOutputs: which of the row's outputs a student should see.
 */
const path = require('path');
const { parseMediaSpec } = require(path.join(__dirname, '..', '..', 'server', 'benchmark', 'suitePlan'));
const { isSeedParam } = require(path.join(__dirname, '..', '..', 'server', 'benchmark', 'benchmarkService'));

const normPath = (p) => String(p || '').replace(/\\/g, '/').toLowerCase();
// What a sweep row says it consumed: `from` (a bundle id or "asset:<file>").
const rowFrom = (inp) => !inp || inp.empty ? null : (inp.from || (inp.asset ? 'asset:' + inp.asset : null));

/**
 * A seed parameter. Calibration replaces every exposed seed with a fresh
 * number so the run cannot be a cache hit -- `sampling_mode.seed` and a
 * primitive keyed `seed_<n>` included -- so the suite's seed would not match.
 * A row recorded before calibration caught those two may still carry the
 * suite's value; either way a seed is not what a caption describes, so it is
 * not compared. The rule is calibration's own (benchmarkService.isSeedParam),
 * never a mere substring: `seedvr2postprocessing_color_correction_method` is a
 * setting. An ingredient's `node` is `<nodeId>.<field>`, and a field may
 * itself hold a dot (`sampling_mode.seed`).
 */
function isSeedIngredient(ing) {
    const node = String(ing.node || '');
    const dot = node.indexOf('.');
    return isSeedParam({ key: ing.key, field: dot >= 0 ? node.slice(dot + 1) : '' });
}

/**
 * Does the row's recorded input match the file's media spec?
 * ★ The whole spec, not only where it came from: a changed derive op (a crop,
 * a noise level, a JPEG quality) or a different `pick` is a different input,
 * and the caption written for one would land on the result of the other.
 */
function sameMedia(spec, inp) {
    const m = parseMediaSpec(spec);
    if (!m || !inp) return false;
    if (m.empty) return !!inp.empty;
    if (inp.empty) return false;
    if (m.asset) return !inp.fallbackFor && rowFrom(inp) === m.asset;
    // A run that fell back to its fallback asset consumed something other than
    // what the entry's caption is written about. Never "the same run".
    if (inp.fallbackFor || !inp.from) return false;
    if (!m.from.includes(inp.from)) return false;      // an array `from` takes the first that exists
    if (JSON.stringify(m.derive || []) !== JSON.stringify(inp.derive || [])) return false;
    // Rows record `pick` only once the sweep writes it; until then a non-zero
    // pick in the file cannot be confirmed, so it does not match.
    return (inp.pick ?? 0) === (m.pick || 0);
}

/**
 * ★ An input taken from another bundle's result is only "the same" if that
 * bundle's published row is itself the run its file entry describes AND is the
 * very file this run consumed — a caption naming the upstream picture's content
 * is otherwise about a different picture.
 *
 * @param fileRun  the suite file's entry for this workflow
 * @param r        the published row
 * @param ctx      { rows, fileRuns } to follow inputs upstream
 */
function sameRun(fileRun, r, ctx, seen = new Set()) {
    if (!fileRun || seen.has(r.id)) return false;      // `seen` is this path only: it guards a cycle
    const path_ = new Set([...seen, r.id]);
    const inputs = r.suite?.inputs || {};
    for (const [k, v] of Object.entries(fileRun.params || {})) {
        if (k in inputs) {
            if (!sameMedia(v, inputs[k])) return false;
            const up = ctx && rowFrom(inputs[k]);
            if (up && !/^(asset|file):/.test(up)) {
                const upRow = ctx.rows.find(x => x.id === up);
                if (!upRow || !(upRow.outputs || []).some(o => normPath(o.path) === normPath(inputs[k].source))) return false;
                if (!sameRun(ctx.fileRuns.get(up), upRow, ctx, path_)) return false;
            }
            continue;
        }
        const ing = (r.ingredients || []).find(i => i.key === k);
        if (!ing) return false;
        if (ing.from === 'calibration' || isSeedIngredient(ing)) continue;
        const a = String(ing.value), b = String(v);
        if (ing.truncated ? !b.startsWith(a) : a !== b) return false;
    }
    return true;
}

/**
 * The outputs worth showing a student, in the row's own order.
 *  - a text output the sweep tagged `stray` is plumbing (a combo's line index,
 *    a tensor shape) printed by an in-path preview node beside a real file;
 *  - VideoHelperSuite writes a first-frame PNG beside every video it saves
 *    (`<prefix>_00001.png` next to `<prefix>_00001.mp4`). A real job never shows
 *    it -- the collector takes only VHS's `gifs` record -- but the sweep finds it
 *    on disk. Core save nodes name files `..._00001_.ext` (trailing underscore),
 *    so an image and a video they both wrote are not caught by this.
 */
function showableOutputs(outputs) {
    const list = outputs || [];
    const stem = (f) => path.basename(String(f || '')).replace(/\.[^.]+$/, '').toLowerCase();
    const videos = new Set(list.filter(o => o.kind === 'video' && o.file).map(o => stem(o.file)));
    return list.filter(o => {
        if (o.kind === 'text') return !o.stray;
        if (o.kind === 'image' && o.file && /_\d{5}$/.test(stem(o.file)) && videos.has(stem(o.file))) return false;
        return true;
    });
}

module.exports = { sameRun, sameMedia, isSeedIngredient, showableOutputs, rowFrom };
