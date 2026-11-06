/**
 * Which files from the assets folder a suite names, and which of them are not there.
 *
 * A missing asset does not stop a suite: the sweep skips the run that needs it,
 * with the reason. But a suite takes hours, so `run-suite.cjs --check` and `--dry`
 * list the missing ones first, while fixing the folder still costs nothing.
 *
 * Every place a suite can name an asset is read: a plain `asset:<file>`, a `from`
 * that starts with `asset:`, a `fallback`, and a `composite` derive's `overlay`.
 * A file is found the way the sweep finds a plain asset, a `from` or a `fallback`:
 * inside the assets folder, sub-folders allowed, never outside it. `assetFile` is
 * server/benchmark/suitePlan.js's, the same lookup the sweep calls. An overlay gets
 * the same check here, although the sweep itself resolves overlays in
 * derive_input.py's resolve().
 *
 * `required` is false when something else can stand in for the asset — it is a
 * `fallback`, or one of several sources in `from` — so a missing one of those
 * skips the run only when the other sources are missing too.
 */
const path = require('path');

const { parseMediaSpec, MEDIA_TYPES, assetFile } = require(path.join(__dirname, '..', '..', 'server', 'benchmark', 'suitePlan'));

/**
 * Every asset a suite names, one entry per use:
 *   { workflow, key, name, how, required, found }
 * `exposedOf(workflowId)` returns that workflow's exposed parameters (only media
 * parameters can take an asset; a string on another parameter is a literal).
 */
function suiteAssets(suite, exposedOf, assetsDir) {
    const out = [];
    for (const run of suite.runs || []) {
        const exposed = new Map((exposedOf(run.workflow) || []).map(p => [p.key, p]));
        for (const [key, spec] of Object.entries(run.params || {})) {
            if (!MEDIA_TYPES.includes(exposed.get(key)?.type)) continue;
            const m = parseMediaSpec(spec);
            if (!m || m.empty) continue;
            const add = (name, how, required) => out.push({
                workflow: run.workflow, key, name: String(name).replace(/^asset:/, ''), how, required,
                found: !!assetFile(assetsDir, name),
            });
            if (m.asset) { add(m.asset, 'asset', true); continue; }
            // `from` is tried in order and the first source found is used, so an
            // asset there is indispensable only when it is the one source given.
            const alone = (m.from || []).length === 1 && !m.fallback;
            for (const id of m.from || []) {
                if (id.startsWith('asset:')) add(id, 'from', alone);
            }
            if (m.fallback) add(m.fallback, 'fallback', false);
            for (const op of m.derive || []) {
                if (op && typeof op.overlay === 'string' && op.overlay.startsWith('asset:')) add(op.overlay, 'overlay', true);
            }
        }
    }
    return out;
}

/** The missing ones, as lines to print. */
function missingAssetLines(list, assetsDir) {
    return list.filter(a => !a.found).map(a => `${a.required ? 'MISSING ' : 'missing '} ${a.workflow} "${a.key}": `
        + `${a.how === 'fallback' ? 'its fallback ' : a.how === 'overlay' ? 'its overlay ' : ''}${a.name} is not in the assets folder`
        + `${assetsDir ? '' : ' (none is set)'}${a.required ? ' — this run will be skipped' : ' — the run is skipped only if its other sources are missing too'}`);
}

module.exports = { assetFile, suiteAssets, missingAssetLines };
