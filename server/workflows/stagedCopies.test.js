// stagedCopies — which "Open in ComfyUI" copies a workflow delete may remove.
// It deletes files the admin can see in ComfyUI, so every way of being wrong is
// pinned: an edited copy, an API-format file, a missing template, a lane folder.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { graphFingerprint, stagedCopiesOf, bundleTemplateFingerprint, removeStagedCopies } = require('./stagedCopies');

let pass = 0;
const ok = (what, cond) => { assert.ok(cond, what); pass++; };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'comfyq-staged-'));
const comfy = path.join(tmp, 'ComfyUI');
const lanes = path.join(tmp, '.comfyq-lanes');
const userWf = path.join(comfy, 'user', 'default', 'workflows');
const bundle = path.join(tmp, 'workflows', 'wf');
fs.mkdirSync(userWf, { recursive: true });
fs.mkdirSync(bundle, { recursive: true });

const template = {
    id: 'abc', nodes: [
        { id: 2, type: 'SaveImage', widgets_values: ['out'], mode: 0, pos: [10, 10] },
        { id: 1, type: 'LoadImage', widgets_values: ['a.png', 'image'], mode: 0, pos: [0, 0] },
    ],
    links: [[1, 1, 0, 2, 0, 'IMAGE']],
    extra: { ds: { scale: 1, offset: [0, 0] } },
};
fs.writeFileSync(path.join(bundle, 'wf_template.json'), JSON.stringify(template));
const tfp = bundleTemplateFingerprint(bundle);
ok('a bundle template has a fingerprint', typeof tfp === 'string');

// ComfyUI re-serialises what it opens: a new id, view offset, node order, positions.
const reserialised = JSON.parse(JSON.stringify(template));
reserialised.id = 'zzz';
reserialised.extra.ds = { scale: 2, offset: [40, 9] };
reserialised.nodes.reverse();
reserialised.nodes[0].pos = [99, 99];
ok('re-serialising does not change the fingerprint', graphFingerprint(reserialised) === tfp);

const edited = JSON.parse(JSON.stringify(template));
edited.nodes[1].widgets_values = ['b.png', 'image'];
ok('a changed widget value does', graphFingerprint(edited) !== tfp);
const bypassed = JSON.parse(JSON.stringify(template));
bypassed.nodes[0].mode = 4;
ok('bypassing a node does', graphFingerprint(bypassed) !== tfp);
const rewired = JSON.parse(JSON.stringify(template));
rewired.links = [];
ok('removing a link does', graphFingerprint(rewired) !== tfp);

ok('an API-format graph has no fingerprint', graphFingerprint({ 1: { class_type: 'LoadImage', inputs: {} } }) === null);
ok('an empty UI graph has no fingerprint', graphFingerprint({ nodes: [], links: [] }) === null);

// The real scan: one unchanged copy, one edited copy, one in a lane folder.
fs.writeFileSync(path.join(userWf, 'wf_template.json'), JSON.stringify(reserialised));
fs.writeFileSync(path.join(userWf, 'wf.json'), JSON.stringify(edited));
const laneWf = path.join(lanes, 'wf', 'user', 'default', 'workflows');
fs.mkdirSync(laneWf, { recursive: true });
fs.writeFileSync(path.join(laneWf, 'wf_template.json'), JSON.stringify(template));
// Somebody else's workflow that merely shares a prefix must never be considered.
fs.writeFileSync(path.join(userWf, 'wf_other.json'), JSON.stringify(template));

const found = stagedCopiesOf('wf', { comfyRoot: comfy, lanesRoot: lanes, templateFingerprint: tfp });
ok('finds the copies in the install and in a lane folder', found.length === 3);
ok('only the two exact staging names are considered', !found.some(c => /wf_other/.test(c.file)));
const { removed, kept } = removeStagedCopies(found);
ok('the unchanged copies are removed', removed.length === 2 && !fs.existsSync(path.join(userWf, 'wf_template.json'))
    && !fs.existsSync(path.join(laneWf, 'wf_template.json')));
ok('the edited copy is kept and named', kept.length === 1 && /wf\.json$/.test(kept[0]) && fs.existsSync(path.join(userWf, 'wf.json')));
ok('an unrelated workflow is untouched', fs.existsSync(path.join(userWf, 'wf_other.json')));

// No template in the bundle → nothing can be judged unchanged → nothing removed.
const bare = path.join(tmp, 'workflows', 'bare');
fs.mkdirSync(bare);
fs.writeFileSync(path.join(userWf, 'bare_template.json'), JSON.stringify(template));
const noTpl = stagedCopiesOf('bare', { comfyRoot: comfy, lanesRoot: lanes, templateFingerprint: bundleTemplateFingerprint(bare) });
ok('without a template, a staged copy is never judged unchanged', noTpl.length === 1 && noTpl[0].unchanged === false);
ok('...and so is kept', removeStagedCopies(noTpl).kept.length === 1 && fs.existsSync(path.join(userWf, 'bare_template.json')));

// An API-format bundle "template" and an API-format staged file must not match each other.
const api = path.join(tmp, 'workflows', 'api');
fs.mkdirSync(api);
fs.writeFileSync(path.join(api, 'api_template.json'), JSON.stringify({ 1: { class_type: 'A', inputs: {} } }));
fs.writeFileSync(path.join(userWf, 'api.json'), JSON.stringify({ 9: { class_type: 'Z', inputs: {} } }));
const apiFound = stagedCopiesOf('api', { comfyRoot: comfy, lanesRoot: lanes, templateFingerprint: bundleTemplateFingerprint(api) });
ok('two graphs with nothing to compare are not "unchanged"', apiFound.length === 1 && apiFound[0].unchanged === false);

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`stagedCopies: all ${pass} checks passed`);
