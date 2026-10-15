const fs = require('fs');
const path = require('path');

// Which folders of workflow JSON count as USING a model — the list the prune
// tool's verdict rests on, and the one an admin edits in Maintenance.
//
// One resolver, shared by the admin route and tools/model-provenance/exclusive.cjs
// (and mirrored by tools/maintenance/comfyq_paths.py for the model audit), so the
// panel and the command line cannot disagree about which folders are in play.
//
// config.maintenance:
//   workflowScanDirs  extra folders, absolute or relative to the ComfyUI root
//   scanDirsOff       what the admin switched OFF: a default's key below, or a
//                     custom entry exactly as written in workflowScanDirs
//
// ★ A switched-off folder is still READ. What it names no longer protects a
// model, but the model is reported with the folder as its reason and kept out
// of the confident tier — switching a folder off must never make something
// silently deletable.

const DEFAULTS = [
    {
        key: 'bundles', locked: true,
        label: 'ComfyQ workflows',
        detail: 'every bundle in workflows/ and its editable template — what students run, so it cannot be switched off',
    },
    {
        key: 'candidates',
        label: 'Candidate workflows',
        detail: 'workflows/_candidate_workflows — graphs staged for testing, not yet served',
    },
    {
        key: 'comfyui-user',
        label: "ComfyUI's own saved workflows",
        detail: 'user/default/workflows in the ComfyUI install — anything saved from ComfyUI, and "Open in ComfyUI" copies',
    },
    {
        key: 'lanes',
        label: "Parallel lanes' saved workflows",
        detail: '.comfyq-lanes/<workflow>/user/<profile>/workflows — what was saved from a lane\'s own ComfyUI',
    },
];
const DEFAULT_KEYS = new Set(DEFAULTS.map(d => d.key));

const resolveEntry = (entry, comfyRoot) =>
    (path.isAbsolute(entry) ? entry : (comfyRoot ? path.resolve(comfyRoot, entry) : entry));

/**
 * @param {object} config            the raw config (config.json as loaded)
 * @param {object} opts
 * @param {string} opts.repoRoot     ComfyQ's root (holds workflows/ and .comfyq-lanes)
 * @param {string} [opts.workflowsDir]
 * @returns {{
 *   folders: Array<{key, kind: 'default'|'custom', label, detail?, entry?, path, on, locked, exists}>,
 *   usageOpts: { extraDirs: string[], excludedDirs: string[], includeCandidates: boolean, includeLanes: boolean },
 *   configured: string[],           every custom entry, on or off — the admin DID configure them
 * }}
 */
function scanSetup(config, { repoRoot, workflowsDir } = {}) {
    const comfyRoot = config?.comfy_ui?.root_path || '';
    const custom = (config?.maintenance?.workflowScanDirs || []).map(String).map(s => s.trim()).filter(Boolean);
    const offList = new Set((config?.maintenance?.scanDirsOff || []).map(String));
    const wfDir = workflowsDir || (repoRoot ? path.join(repoRoot, 'workflows') : '');
    const userWf = comfyRoot ? path.join(comfyRoot, 'user', 'default', 'workflows') : '';

    const pathOf = {
        bundles: wfDir,
        candidates: wfDir ? path.join(wfDir, '_candidate_workflows') : '',
        'comfyui-user': userWf,
        lanes: repoRoot ? path.join(repoRoot, '.comfyq-lanes') : '',
    };
    const folders = DEFAULTS.map(d => ({
        ...d, kind: 'default',
        path: pathOf[d.key],
        on: d.locked ? true : !offList.has(d.key),
        exists: !!pathOf[d.key] && fs.existsSync(pathOf[d.key]),
    }));
    for (const entry of custom) {
        const abs = resolveEntry(entry, comfyRoot);
        folders.push({
            key: entry, kind: 'custom', entry, label: entry, path: abs,
            on: !offList.has(entry), locked: false, exists: fs.existsSync(abs),
        });
    }

    const on = (k) => folders.find(f => f.key === k)?.on !== false;
    const usageOpts = {
        extraDirs: [
            ...folders.filter(f => f.kind === 'custom' && f.on).map(f => f.entry),
            ...(on('comfyui-user') && userWf ? [userWf] : []),
        ],
        excludedDirs: [
            ...folders.filter(f => f.kind === 'custom' && !f.on).map(f => f.entry),
            ...(!on('comfyui-user') && userWf ? [userWf] : []),
        ],
        includeCandidates: on('candidates'),
        includeLanes: on('lanes'),
    };
    return { folders, usageOpts, configured: custom };
}

/**
 * Validate what the panel sends back. Only a default's key or one of the custom
 * entries may be switched off; the locked default never.
 */
function cleanOffList(off, customEntries) {
    const custom = new Set(customEntries);
    return [...new Set((off || []).map(String))]
        .filter(k => (DEFAULT_KEYS.has(k) && k !== 'bundles') || custom.has(k));
}

module.exports = { scanSetup, cleanOffList, DEFAULTS };
