// storyboardPlanner — turns parsed storyboard items into concrete job specs
// against the LIVE workflow registry: which bundle runs, which of its exposed
// parameters gets the prompt, which media inputs are filled from another job's
// output, and in what order the whole thing runs.
//
// The ordering contract (the reason this feature exists):
//
//   phase 1  every image        — nothing depends on anything outside the batch
//   phase 2  every video        — each one consumes an image produced in phase 1
//   phase 3  every audio        — independent, cheapest to run last
//
// Within a phase, items keep their document order except where a dependency
// forces otherwise (an "Anchor image" must finish before the edit that
// references it), which a stable topological sort resolves.
//
// The guiding rule throughout: **a storyboard that cannot be queued correctly
// must fail to queue, not queue wrongly.** A media input with nothing bound to
// it does not run "empty" — ComfyUI falls back to whatever filename the
// bundle's api.json shipped with, and the batch quietly renders a stranger's
// test picture. So every such case is an `error`, and the route refuses the
// whole document.
//
// Nothing here touches the queue or the filesystem: given a registry it is a
// pure function, so the whole plan can be previewed before a single job is
// created — and unit-tested with no ComfyUI on the machine.

const { resolveWorkflowAlias, buildIndex } = require('./workflowResolver');

const MEDIA_TYPES = new Set(['image', 'mask', 'video', 'audio']);
const IMAGE_TYPES = new Set(['image', 'mask']);

// What a bundle PRODUCES, predicted before it runs.
//
// ComfyQ's runtime output detection is extension-based on purpose (see
// CLAUDE.md), but a plan has to be built before anything has executed and
// there is no file yet — so the prediction reads the graph's save nodes.
// Ordered most- to least-specific because a graph often carries several: an
// image-to-video bundle still contains a SaveImage for a preview frame.
const SAVE_NODE_KINDS = [
    [/videocombine|savevideo|savewebm|saveanimated/i, 'video'],
    [/saveaudio/i, 'audio'],
    [/saveglb|savegltf|savemesh|saveply|savespz/i, 'model3d'],
    [/saveimage/i, 'image'],
    [/previewany|showtext|savetext/i, 'text']
];

// Fallback when the graph uses a save node we do not recognise: the bundle's
// own category. Only categories that unambiguously name a medium are mapped;
// anything else stays null and the item is refused rather than mis-phased.
const CATEGORY_KINDS = {
    't2i': 'image', 'image-edit': 'image', 'i2i': 'image',
    'i2v': 'video', 'video-edit': 'video',
    'audio': 'audio',
    '3d': 'model3d', 'description': 'text'
};

function predictOutputKind(entry) {
    const nodes = Object.values(entry.apiWorkflow || {});
    const classes = nodes.map(n => String(n?.class_type || ''));
    for (const [rx, kind] of SAVE_NODE_KINDS) {
        if (classes.some(c => rx.test(c))) return kind;
    }
    return CATEGORY_KINDS[entry.summary?.category || entry.meta?.category] || null;
}

// Which run phase a produced medium belongs to.
const PHASE_FOR_KIND = { image: 0, video: 1, audio: 2 };
const PHASE_LABELS = ['images', 'videos', 'audio'];

// A leading "Name: Value." directive, e.g. "TrackType: Sound Effects. <prompt>".
//
// The name must be one this format knows (or an exact parameter name), NOT
// merely any word followed by a value that happens to match a dropdown option.
// That distinction is the whole safety of the feature: "Ambience: music." and
// "Backing: One-shot." are ordinary opening sentences, and a value-first match
// would delete them from the prompt and silently set the wrong dropdown.
const LEADING_DIRECTIVE = /^([A-Za-z][A-Za-z0-9 _-]{0,30}):[ \t]*([^\n.]{1,60})\.[ \t]*/;

// Directive names the format defines, each meaning "set the dropdown that
// picks what KIND of thing this is". Kept tiny and explicit; anything else is
// matched against the workflow's own parameter names instead.
const DIRECTIVE_NAMES = new Set(['tracktype', 'track type', 'type', 'category', 'kind']);

// Human synonyms for select-option values. Storyboards are written in prose
// ("Sound Effects"), workflows label their combos tersely ("SFX").
const OPTION_SYNONYMS = {
    'sound effects': 'sfx',
    'sound effect': 'sfx',
    'soundfx': 'sfx',
    'song': 'music',
    'one shot': 'one-shot'
};

function normLoose(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }

function matchesOption(value, option) {
    const v = String(value || '').trim().toLowerCase();
    const syn = OPTION_SYNONYMS[v] || v;
    return normLoose(option) === normLoose(v) || normLoose(option) === normLoose(syn);
}

// Resolve a leading directive against this workflow's select parameters.
// Returns { param, value } on a hit, the string 'unmatched-value' when the
// NAME was a directive but no option matched (worth telling the author about),
// or null when the line was just a sentence.
function resolveDirective(name, value, params) {
    const selects = params.filter(p => p.type === 'select' && Array.isArray(p.options) && p.options.length);
    if (selects.length === 0) return null;
    const n = String(name || '').trim().toLowerCase();
    const known = DIRECTIVE_NAMES.has(n);
    const named = selects.filter(p => normLoose(p.key).includes(normLoose(n)) || normLoose(p.label).includes(normLoose(n)));
    if (!known && named.length === 0) return null;      // an ordinary sentence
    for (const p of (named.length ? named : selects)) {
        const hit = p.options.find(o => matchesOption(value, o));
        if (hit) return { param: p, value: hit };
    }
    return 'unmatched-value';
}

// The width/height parameters of a workflow, when it exposes a settable pair.
// Matched on the admin-facing label first (that is what a human named them) and
// on the key as a fallback. A workflow that derives its size from an input
// image has neither, and a shot's resolution simply does not apply to it.
function sizeParams(params) {
    const find = (rx) => params.find(p => p.type === 'number' && (rx.test(p.label || '') || rx.test(p.key)));
    const width = find(/(^|[^a-z])width([^a-z]|$)/i);
    const height = find(/(^|[^a-z])height([^a-z]|$)/i);
    return (width && height) ? { width, height } : null;
}

// The parameter that sets how long a shot runs, and what unit it counts in.
// Bundles differ: stable-audio and the LTX 2.5 video bundles expose "Duration
// (seconds)", while a bundle may instead expose "Duration (frames)" alongside a
// "Frame rate" (the retired LTX 2.3 i2v did) — so a "5s" in the document has to
// be converted before it means anything there.
function durationParam(params) {
    const p = params.find(x => x.type === 'number'
        && /duration|length/i.test(`${x.label || ''} ${x.key}`)
        && !/clip length|source/i.test(x.label || ''));
    if (!p) return null;
    const inFrames = /frame/i.test(`${p.label || ''} ${p.key}`);
    const fps = inFrames
        ? params.find(x => x.type === 'number' && /frame\s*rate|fps/i.test(`${x.label || ''} ${x.key}`))
        : null;
    return { param: p, inFrames, fps };
}

// Frame counts for latent-video models are not free: LTX wants 8n+1 frames, and
// a bundle that ships a default of 121 (= 8*15+1) is telling us so. Rather than
// hard-coding a model's rule, infer it from the bundle's own default — if the
// default satisfies 8n+1, snap to the nearest value that also does, preferring
// the shorter one so a shot never runs longer than the document asked for.
function snapFrames(frames, defaultFrames) {
    if (!Number.isFinite(defaultFrames) || defaultFrames % 8 !== 1) return frames;
    const lower = Math.floor((frames - 1) / 8) * 8 + 1;
    const upper = lower + 8;
    const pick = (frames - lower) <= (upper - frames) ? lower : upper;
    return Math.max(9, pick);
}

// Some workflows have no width/height at all but do expose an aspect-ratio
// dropdown ("16:9 (Landscape Widescreen)"). Ideogram is one, and its default is
// PORTRAIT — so a 16:9 storyboard whose title cards silently came out 9:16 is a
// real and very visible defect. Map the requested size onto the closest option
// rather than discarding it.
function aspectParam(params) {
    return params.find(p => p.type === 'select'
        && Array.isArray(p.options)
        && /aspect|ratio/i.test(`${p.label || ''} ${p.key}`)
        && p.options.some(o => /\d+\s*:\s*\d+/.test(o)));
}

// The option closest to width/height, compared in log space so 16:9 and 9:16
// are equally far from 1:1 and a portrait request can never snap to a landscape
// option just because the arithmetic difference is smaller.
function closestAspect(param, width, height) {
    const target = Math.log(width / height);
    let best = null;
    for (const option of param.options) {
        const m = /(\d+)\s*:\s*(\d+)/.exec(option);
        if (!m) continue;
        const d = Math.abs(Math.log(Number(m[1]) / Number(m[2])) - target);
        if (!best || d < best.d) best = { option, d };
    }
    return best ? best.option : null;
}

function isNegative(p) {
    return /negative/i.test(p.key) || /negative/i.test(p.label || '');
}
function isSeed(p) {
    return p.type === 'number' && (/seed/i.test(p.key) || /seed/i.test(p.field));
}

// Is this parameter greyed out by the workflow's own either/or gating?
//
// `disabledWhen: { param, equals }` means "disabled while <param> equals
// <equals>". Feeding the prompt to the disabled half of an either/or pair is
// the classic silent failure: the job runs the bundle's shipped default prompt
// and reports success. A meta can ship a disabledWhen naming a key that is not
// exposed (the retired `video_edit_ltx2_3_ic_lora_vid2vid` did), so the
// reference is also resolved by node-id suffix before giving up.
function isDisabled(p, params, values) {
    const dw = p.disabledWhen;
    if (!dw || !dw.param) return false;
    let ref = params.find(q => q.key === dw.param);
    if (!ref) {
        const suffix = String(dw.param).split('_').slice(-2).join('_');
        const near = params.filter(q => q.key.endsWith(suffix));
        if (near.length === 1) ref = near[0];
    }
    if (!ref) return false;                       // unresolvable → assume live
    const current = Object.prototype.hasOwnProperty.call(values, ref.key) ? values[ref.key] : ref.default;
    return current === dw.equals;
}

// How prompt-like a text field is. Guards against writing the storyboard's
// prompt over a field that is really internal plumbing — the autoprompt
// Bernini bundles expose a `StringConcatenate` input holding the LLM's system
// instruction, and overwriting it destroys the chain while still "succeeding".
function promptScore(p) {
    const hay = `${p.key} ${p.label || ''}`.toLowerCase();
    if (/concatenate|string_[a-z](_|\b)|system|delimiter|trigger/.test(hay)) return -10;
    let s = 0;
    if (/prompt/.test(hay)) s += 3;
    if (/description|instruction|caption/.test(hay)) s += 2;
    if (p.type === 'textarea') s += 1;
    return s;
}

// A fresh seed per job. Two runs of the same storyboard must not collide with
// ComfyUI's result cache (an identical graph returns the previous output in
// ~1s), and two prompts that happen to match should still differ visually.
function randomSeed(p) {
    const max = Number.isFinite(p?.max) ? Math.min(p.max, 4294967295) : 4294967295;
    const min = Number.isFinite(p?.min) ? Math.max(p.min, 0) : 0;
    return min + Math.floor(Math.random() * Math.max(1, max - min));
}

// A path segment safe on Windows and POSIX: no separators, no reserved
// characters, no trailing dots or spaces, never empty.
function slug(s, max = 48) {
    const out = String(s || '')
        .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')   // strip accents
        .replace(/[^A-Za-z0-9._-]+/g, '-')                    // everything else -> dash
        .replace(/-{2,}/g, '-')
        .replace(/^[-._]+|[-._]+$/g, '')
        .slice(0, max)
        .replace(/[-._]+$/g, '');
    return out || 'untitled';
}

// What a shot's results are called on disk. ComfyUI reads a "/" in
// filename_prefix as a subfolder, so this is both the folder and the name:
//
//   the-red-thread/03_S0__Reference-image-1__image_edit_flux2_klein_9b_image_edit_ref
//
// The three parts are exactly the document's own headings — section (#), shot
// title (##) and workflow (###) — so a finished batch can be read off the
// filesystem without opening ComfyQ. The leading index keeps run order visible
// when the folder is sorted by name.
function outputPrefixFor({ folder, order, stateId, title, workflowId }) {
    const n = String(order + 1).padStart(3, '0');
    const name = `${n}_${slug(stateId, 24)}__${slug(title, 40)}__${slug(workflowId, 40)}`;
    return folder ? `${slug(folder, 60)}/${name}` : name;
}

function enabledParams(entry) {
    return (entry.effective?.exposedParameters || []).filter(p => p.enabled !== false);
}

// Sort by the admin-facing display order, falling back to declaration order so
// two params sharing an `order` stay stable.
function byOrder(params) {
    return params.map((p, i) => ({ p, i }))
        .sort((a, b) => (a.p.order ?? 0) - (b.p.order ?? 0) || a.i - b.i)
        .map(x => x.p);
}

// Build the plan. `items`/`states` come from storyboardParser.
//
// options:
//   userId      who the jobs belong to (default 'storyboard')
//   startAt     epoch ms for the first job (default now)
//   spacing     'estimated' → each job gets its workflow's estimated duration
//               as a timeline slot; 'asap' → 1s apart so the queue runs them
//               back to back with no idle gap on a dedicated machine.
//   defaults    { [workflowId]: { paramKey: value } } extra params per workflow
//
// Returns { jobs, phases, warnings, errors, totalEstimatedSec }.
// `errors` is non-empty when something cannot be queued correctly; the caller
// refuses the batch (or opts into a partial run).
function planStoryboard({ items, states = [] }, registry, options = {}) {
    const {
        userId = 'storyboard',
        startAt = Date.now(),
        spacing = 'estimated',
        outputFolder = '',
        defaults = {}
    } = options;

    const index = buildIndex(registry);

    // Which workflow do this document's LIBRARY anchors use? The grammar builds
    // anchors with the plain text-to-image workflow, so this identifies it
    // without the document having to declare it.
    //
    // It matters because of the grammar's own wiring rule: a key frame on the
    // image-EDIT workflow takes the anchor named in "(ref AN)" — and "with no
    // parenthetical, use the text-to-image workflow and no input". Generators
    // routinely emit the edit workflow and forget the parenthetical, which
    // leaves a shot that cannot run. Rule 2 says exactly what that means, so it
    // is applied rather than refused.
    let anchorWorkflowId = null;
    for (const item of items) {
        if (!item.anchorKey) continue;
        try { anchorWorkflowId = resolveWorkflowAlias(item.workflowAlias, registry, index).id; }
        catch { /* reported when the item itself is planned */ }
        break;
    }
    const anchorEntry = anchorWorkflowId ? registry.get(anchorWorkflowId) : null;
    const anchorTakesNoInput = anchorEntry && !anchorEntry.unavailable
        && !enabledParams(anchorEntry).some(p => MEDIA_TYPES.has(p.type));
    const substituted = [];
    const warnings = [];
    const errors = [];
    // Workflows that have no dial for something the document asked for. A
    // storyboard applies its size/duration uniformly, so reporting per shot
    // would bury the warnings that actually matter under twenty copies.
    const unsizable = new Set();
    const untimeable = new Set();
    // Kept apart from `errors` so the report leads with the shots that are
    // actually wrong, not the far larger list of shots waiting on them.
    const blockedReasons = [];
    const planned = [];              // one entry per queueable item

    // ---- pass 1: resolve workflows and classify -------------------------
    for (const item of items) {
        const where = `"${item.title}" (${item.stateId})`;
        let entry;
        try {
            const { id } = resolveWorkflowAlias(item.workflowAlias, registry, index);
            entry = registry.get(id);
            if (!entry || entry.unavailable) {
                errors.push(`${where}: workflow ${id} is unavailable — ${entry?.reason || 'unknown reason'}.`);
                continue;
            }
        } catch (e) {
            errors.push(`${where}: ${e.message}`);
            continue;
        }

        // What it makes decides its phase — and whether it belongs here at all.
        let substitutedFrom = null;
        const produces = predictOutputKind(entry);
        const phase = PHASE_FOR_KIND[produces];
        if (phase === undefined) {
            errors.push(`${where}: ${entry.id} produces ${produces || 'something'} rather than an image, ` +
                'a video or audio, so a storyboard cannot sequence it.');
            continue;
        }

        let ordered = byOrder(enabledParams(entry));
        let mediaParams = ordered.filter(p => MEDIA_TYPES.has(p.type));

        // Wiring rule 2: an image shot that needs an image in, but names no
        // anchor to use, is a plain generation. Swap in the anchors' own
        // text-to-image workflow — the prompt already carries the full subject
        // and place description, which is why the rule exists.
        if (phase === 0 && mediaParams.length > 0 && item.refs.length === 0
            && anchorTakesNoInput && anchorEntry.id !== entry.id) {
            substituted.push({ where, from: entry.id, to: anchorEntry.id });
            substitutedFrom = entry.id;
            entry = anchorEntry;
            ordered = byOrder(enabledParams(entry));
            mediaParams = ordered.filter(p => MEDIA_TYPES.has(p.type));
        }

        // Nothing in the document can paint a mask, and a generated PNG has no
        // alpha — LoadImage would derive an all-zero mask and the "inpaint"
        // would return its input untouched, reported as a success.
        const mask = mediaParams.find(p => p.type === 'mask');
        if (mask) {
            errors.push(`${where}: ${entry.id} needs a painted mask ("${mask.label}"), which a storyboard cannot supply. ` +
                'Book that one from the app instead.');
            continue;
        }

        planned.push({
            item,
            entry,
            substitutedFrom,
            produces,
            category: entry.summary?.category || entry.meta?.category || 'other',
            phase,
            params: ordered,
            mediaParams,
            imageParams: ordered.filter(p => IMAGE_TYPES.has(p.type)),
            paramValues: {},
            deps: [],
            notes: []
        });
    }

    // ---- pass 2: parameter values ---------------------------------------
    for (const spec of planned) {
        const { item, entry, params } = spec;
        const where = `"${item.title}" (${item.stateId})`;
        let prompt = item.prompt;

        // A leading "TrackType: Sound Effects." directive maps onto a dropdown.
        // Only stripped from the prompt if it actually landed.
        const dm = LEADING_DIRECTIVE.exec(prompt);
        if (dm) {
            const hit = resolveDirective(dm[1], dm[2], params);
            if (hit === 'unmatched-value') {
                warnings.push(`${where}: "${dm[1]}: ${dm[2]}" matches no option on ${entry.id}, ` +
                    'so it was left in the prompt and the workflow default is used.');
            } else if (hit) {
                spec.paramValues[hit.param.key] = hit.value;
                spec.notes.push(`${hit.param.label} = ${hit.value}`);
                prompt = prompt.slice(dm[0].length).trim();
            }
        }

        // The prompt goes to the best text field that is actually live: never a
        // negative one, never one the workflow's own gating has switched off,
        // never internal plumbing.
        const candidates = params
            .filter(p => (p.type === 'textarea' || p.type === 'text') && !isNegative(p))
            .filter(p => !isDisabled(p, params, spec.paramValues))
            .map(p => ({ p, score: promptScore(p) }))
            .filter(c => c.score > -5)
            .sort((a, b) => b.score - a.score);

        if (candidates.length === 0) {
            errors.push(`${where}: ${entry.id} exposes no prompt field this storyboard can write to, ` +
                'so its prompt would be ignored.');
            continue;
        }
        if (candidates.length > 1 && candidates[0].score === candidates[1].score) {
            warnings.push(`${where}: ${entry.id} has more than one equally likely prompt field; ` +
                `used "${candidates[0].p.label}".`);
        }
        spec.promptParamKey = candidates[0].p.key;
        spec.paramValues[spec.promptParamKey] = prompt;
        spec.prompt = prompt;

        // A resolution written in the document overrides the workflow default.
        // Applied before the seed loop so clampParamValue still sees it as a
        // normal number param (min/max/step from the meta still bound it).
        if (item.size) {
            const size = sizeParams(params);
            if (size) {
                spec.paramValues[size.width.key] = item.size.width;
                spec.paramValues[size.height.key] = item.size.height;
                spec.notes.push(`${item.size.width}×${item.size.height}`);
            } else {
                const aspect = aspectParam(params);
                const option = aspect && closestAspect(aspect, item.size.width, item.size.height);
                if (option) {
                    spec.paramValues[aspect.key] = option;
                    spec.notes.push(`${item.size.width}×${item.size.height} → ${option}`);
                } else {
                    // Not an error: a workflow that takes its size from its input
                    // image simply has no dial to turn. Collected and reported
                    // once for the document instead of once per shot.
                    unsizable.add(entry.id);
                }
            }
        }

        // "| 5s" -> however this workflow counts time.
        if (item.durationSec != null) {
            const dur = durationParam(params);
            if (!dur) {
                untimeable.add(entry.id);
            } else if (dur.inFrames) {
                const fps = (dur.fps && spec.paramValues[dur.fps.key]) || dur.fps?.default || 25;
                const frames = snapFrames(Math.round(item.durationSec * fps), dur.param.default);
                spec.paramValues[dur.param.key] = frames;
                spec.notes.push(`${item.durationSec}s = ${frames} frames @ ${fps}fps`);
            } else {
                spec.paramValues[dur.param.key] = item.durationSec;
                spec.notes.push(`${item.durationSec}s`);
            }
        }

        for (const p of params) if (isSeed(p)) spec.paramValues[p.key] = randomSeed(p);

        const extra = defaults[entry.id] || {};
        for (const [k, v] of Object.entries(extra)) spec.paramValues[k] = v;
    }

    // Items that failed pass 2 are dropped from the run.
    const runnable = planned.filter(s => s.promptParamKey);

    if (substituted.length) {
        warnings.push(`${substituted.length} shot(s) asked for ${substituted[0].from}, which edits an ` +
            `existing image, but named no anchor — so they were generated with ${substituted[0].to} ` +
            'instead (the format\'s rule: no "(ref Ax)" means a plain generation). ' +
            'Add "(ref A2, A1)" to a shot to edit an anchor instead.');
    }
    if (unsizable.size) {
        warnings.push(`A resolution was given for ${[...unsizable].join(', ')}, which has no width/height ` +
            'to set — those shots take their size from their input image.');
    }
    if (untimeable.size) {
        warnings.push(`A duration was given for ${[...untimeable].join(', ')}, which has no duration ` +
            'to set — that shot runs for however long its workflow is configured to.');
    }

    // ---- pass 3: dependencies -------------------------------------------
    // Anchors are addressable batch-wide ("ref A3"); a video consumes the
    // images produced earlier in its own section, oldest first.
    const anchors = new Map();       // "A3" → spec
    for (const spec of runnable) {
        const key = spec.item.anchorKey;
        if (!key) continue;
        if (anchors.has(key)) {
            warnings.push(`"${spec.item.title}" (${spec.item.stateId}): ${key} is already defined by ` +
                `"${anchors.get(key).item.title}" — later "(ref ${key})" uses this one.`);
        }
        anchors.set(key, spec);
    }

    let sectionId = null;
    let available = [];              // images produced in this section, unconsumed
    let refusedInSection = 0;        // image shots this section could not queue

    for (const spec of runnable) {
        const { item } = spec;
        const where = `"${item.title}" (${item.stateId})`;
        if (item.stateId !== sectionId) { sectionId = item.stateId; available = []; refusedInSection = 0; }

        if (spec.imageParams.length > 0) {
            const wanted = spec.imageParams.length;
            let sources;
            if (item.refs.length > 0) {
                // An explicit "(ref Ax)" always wins, for an edit AND for a cut.
                sources = item.refs.map(key => {
                    const src = anchors.get(key);
                    if (!src) fail(spec, `${where}: no "## Anchor image ${key.slice(1)}" defines ${key}.`);
                    return src;
                }).filter(Boolean);
            } else if (spec.phase === 0) {
                // An image workflow that takes images in — an edit — with no ref
                // to work from. Which anchor it edits changes the shot
                // completely, and nothing in the document says, so this is
                // refused rather than guessed.
                const slots = spec.imageParams.map(p => `"${p.label}"`).join(' + ');
                fail(spec, `${where}: ${spec.entry.id} edits an existing image (${slots}), but the shot ` +
                    `names no anchor. Add one to the "###" line: ` +
                    `"### ${spec.item.workflowAlias} | ref A2${spec.imageParams.length > 1 ? ', A1' : ''}".`);
                sources = [];
            } else {
                // "Video cut N" is wired to "Reference image N" of the same
                // state — by NUMBER, which is what the grammar promises and what
                // survives a shot being inserted or reordered. Only when the
                // numbering does not line up does it fall back to consuming the
                // section's images oldest-first. ANCHORS are never in that pool:
                // they are the reusable library, addressed by name, and letting a
                // cut swallow one positionally makes it animate the wrong shot.
                const byNumber = item.slotNumber != null
                    ? available.findIndex(s => s.item.slotNumber === item.slotNumber)
                    : -1;
                sources = byNumber >= 0
                    ? available.splice(byNumber, 1)
                    : available.splice(0, wanted);
                if (byNumber >= 0 && wanted > sources.length && !spec.item.loop) {
                    // A first/last-frame cut numbered to one key frame still needs
                    // its second slot; take the next image in the section.
                    sources.push(...available.splice(0, wanted - sources.length));
                }
                if (sources.length === 0 && refusedInSection > 0) {
                    // The shots that would have fed it were themselves refused.
                    // Reporting this as its own fault would triple the length of
                    // the report and point at the wrong line of the document.
                    block(spec, `${where}: waits on the shots before it in section ${item.stateId}, ` +
                        'which could not be queued.');
                } else if (sources.length === 0) {
                    fail(spec, `${where}: no image is produced before it in section ${item.stateId}, ` +
                        'so it has no frame to animate. Add a shot before it, or point this one at a ' +
                        'library plate with "| ref A1".');
                }
            }
            if (item.loop && sources.length > 0) {
                // "## Video cut 1 (loop)" — first and last frame are the same
                // key frame, stated rather than inferred from a shortfall.
                sources = new Array(wanted).fill(sources[0]);
            }
            if (sources.length > 0 && sources.length < wanted) {
                // Fewer sources than slots — one image driving a first/last frame
                // pair, which is exactly what a "(loop)" cut asks for, or one
                // anchor driving an edit's source + reference.
                const last = sources[sources.length - 1];
                while (sources.length < wanted) sources.push(last);
                if (spec.phase === 1) {
                    spec.notes.push('loop — the same frame drives every frame input');
                } else {
                    // The slots mean different things ("Source image" vs
                    // "Reference image"), and one anchor is now in both: the
                    // model edits the anchor itself rather than bringing it INTO
                    // another shot. That is often not what was meant, and it is
                    // invisible once the job has run — so say it now.
                    const slots = spec.imageParams.map(p => p.label).join('" and "');
                    spec.notes.push(`${item.refs[0]} drives all ${wanted} image inputs`);
                    warnings.push(`${where}: ${item.refs[0]} is used for BOTH "${slots}", so ` +
                        `${spec.entry.id} edits ${item.refs[0]} itself. To edit one shot while ` +
                        `referencing another, name both: "(ref <shot to edit>, ${item.refs[0]})".`);
                }
            }
            bindMedia(spec, spec.imageParams, sources);
        }

        // Every media slot must end up bound. An unbound one is not "empty":
        // the graph keeps the filename its api.json shipped with and renders it.
        // Skipped when the shot has already been refused above, so one broken
        // shot produces one reason instead of one per slot.
        if (!spec.failed && !spec.blocked) {
            for (const p of spec.mediaParams) {
                if (spec.deps.some(d => d.paramKey === p.key)) continue;
                fail(spec, `${where}: ${spec.entry.id} needs "${p.label}" (${p.type}), and nothing in the ` +
                    'storyboard supplies it. Add an anchor to the "###" line, e.g. "| ref A1".');
            }
        }

        // An ordinary image becomes available to the cuts after it. An ANCHOR
        // does not: it is the named library, reached with "| ref Ax". Nor does a
        // shot that failed above, since it will never run.
        if (spec.phase === 0 && (spec.failed || spec.blocked) && !item.anchorKey) refusedInSection++;
        if (spec.phase === 0 && !spec.failed && !spec.blocked && !item.anchorKey) available.push(spec);
    }

    // Drop everything that could not be queued correctly, then everything that
    // depended on it, transitively. This is what makes `force: true` safe: the
    // jobs it queues are exactly the ones with no unmet input, never a job
    // silently stripped of its dependency.
    const dropped = new Set(runnable.filter(s => s.failed || s.blocked).map(s => s.item.index));
    const refused = runnable.filter(s => s.failed).length;   // broken in their own right
    let blocked = runnable.filter(s => s.blocked).length;    // only fail because those did
    for (let pass = 0; pass < runnable.length; pass++) {
        let grew = false;
        for (const spec of runnable) {
            if (dropped.has(spec.item.index)) continue;
            const dead = spec.deps.find(d => dropped.has(d.sourceItemIndex));
            if (!dead) continue;
            blockedReasons.push(`"${spec.item.title}" (${spec.item.stateId}): waits on ${dead.sourceTitle}, ` +
                'which cannot be queued.');
            dropped.add(spec.item.index);
            blocked++;
            grew = true;
        }
        if (!grew) break;
    }
    const queueable = runnable.filter(s => !dropped.has(s.item.index));

    function fail(spec, message) {
        spec.failed = true;
        errors.push(message);
    }

    // Not wrong in itself — it just cannot run because something it needs was
    // refused. Kept separate so the report leads with the lines to actually fix.
    function block(spec, message) {
        spec.blocked = true;
        blockedReasons.push(message);
    }

    function bindMedia(spec, targets, sources) {
        for (let i = 0; i < targets.length; i++) {
            const src = sources[i];
            if (!src) continue;
            spec.deps.push({
                paramKey: targets[i].key,
                paramLabel: targets[i].label,
                sourceItemIndex: src.item.index,
                sourceTitle: `${src.item.stateId} · ${src.item.title}`,
                outputIndex: 0,
                kind: targets[i].type === 'mask' ? 'image' : targets[i].type
            });
        }
    }

    // ---- pass 4: order --------------------------------------------------
    // Phase first (images → videos → audio), then within a phase: keep running
    // the SAME workflow for as long as its dependencies allow.
    //
    // This is the difference between a batch that works and one that crawls. A
    // storyboard names a handful of workflows and uses each many times; taking
    // them in document order alternates between them shot by shot, and every
    // switch is a cold model load (30-150s on this rig) for a job that may only
    // take 16s. Grouping turns ~20 loads into one per workflow.
    const ordered = [];
    let lastWorkflowId = null;
    for (let phase = 0; phase < 3; phase++) {
        const group = queueable.filter(s => s.phase === phase);
        const { sorted, unresolved, endedOn } = orderByWorkflow(group, lastWorkflowId);
        lastWorkflowId = endedOn;
        for (const spec of unresolved) {
            errors.push(`"${spec.item.title}" (${spec.item.stateId}): its inputs form a loop with another ` +
                'item, so neither could ever run.');
        }
        ordered.push(...sorted, ...unresolved);
    }

    // ---- pass 5: timeline slots ----------------------------------------
    let t = startAt;
    let totalEstimatedSec = 0;
    const jobs = ordered.map((spec, i) => {
        const durSec = spec.entry.summary?.estimatedDurationSec || spec.entry.meta?.estimatedDurationSec || 60;
        totalEstimatedSec += durSec;
        const scheduledAt = t;
        t += spacing === 'asap' ? 1000 : durSec * 1000;
        return {
            order: i,
            phase: spec.phase,
            phaseLabel: PHASE_LABELS[spec.phase],
            itemIndex: spec.item.index,
            stateId: spec.item.stateId,
            stateKind: spec.item.stateKind,
            title: spec.item.title,
            workflowId: spec.entry.id,
            workflowName: spec.entry.summary?.name || spec.entry.id,
            substitutedFrom: spec.substitutedFrom || null,
            workflowVersion: spec.entry.meta?.version || null,
            category: spec.category,
            produces: spec.produces,
            estimatedDurationSec: durSec,
            scheduledAt,
            userId,
            outputPrefix: outputPrefixFor({
                folder: outputFolder, order: i,
                stateId: spec.item.stateId, title: spec.item.title, workflowId: spec.entry.id
            }),
            prompt: spec.prompt || '',
            promptParamKey: spec.promptParamKey || null,
            paramValues: spec.paramValues,
            deps: spec.deps,
            notes: spec.notes
        };
    });

    const phases = PHASE_LABELS.map((label, i) => ({
        phase: i,
        label,
        count: jobs.filter(j => j.phase === i).length
    }));

    // How many times ComfyUI will have to load a model. Surfaced because it is
    // the batch's dominant hidden cost and the thing the grouping above exists
    // to minimise — an admin should be able to see it before committing.
    const workflowRuns = summariseRuns(jobs);

    // A one-line account of why a document was refused, so the card can lead
    // with it instead of a wall of near-identical sentences.
    const summary = errors.length
        ? `${refused} shot${refused === 1 ? '' : 's'} cannot be queued` +
          (blocked ? `, and ${blocked} more depend${blocked === 1 ? 's' : ''} on ${refused === 1 ? 'it' : 'them'}` : '') +
          ` — ${items.length - refused - blocked} of ${items.length} would run.`
        : null;

    return { jobs, phases, workflowRuns, modelLoads: workflowRuns.length,
             warnings, errors, blockedReasons, refusedCount: refused, blockedCount: blocked,
             summary, totalEstimatedSec, states };
}

// Topological sort that sticks to one workflow for as long as it can.
//
// At each step it looks at every shot whose inputs are already scheduled, and
// prefers one running the workflow that just ran — so a model stays loaded
// across every shot that uses it. Correctness is unchanged: only ready shots
// are ever chosen, so a dependency is never scheduled after its consumer.
// Ties fall back to document order, which keeps the result deterministic and
// keeps the storyboard's own sequence where the grouping does not care.
//
// A cycle cannot arise through the storyboard grammar (a ref always points at
// an earlier anchor), but a hand-edited document could produce one — those
// shots would sit SCHEDULED forever waiting on each other, so they come back
// separately for the caller to report as an error.
function orderByWorkflow(group, startWorkflowId = null) {
    const inGroup = new Set(group.map(s => s.item.index));
    const placed = new Set();
    const sorted = [];
    let current = startWorkflowId;
    while (sorted.length < group.length) {
        const ready = group.filter(s => !placed.has(s.item.index)
            && !s.deps.some(d => inGroup.has(d.sourceItemIndex) && !placed.has(d.sourceItemIndex)));
        if (ready.length === 0) break;                  // cycle
        const next = ready.find(s => s.entry.id === current) || ready[0];
        sorted.push(next);
        placed.add(next.item.index);
        current = next.entry.id;
    }
    return { sorted, unresolved: group.filter(s => !placed.has(s.item.index)), endedOn: current };
}

// The consecutive runs of one workflow, in run order — what the batch will
// actually ask ComfyUI to load, and how many shots each load pays for.
function summariseRuns(jobs) {
    const runs = [];
    for (const j of jobs) {
        const last = runs[runs.length - 1];
        if (last && last.workflowId === j.workflowId) { last.count++; continue; }
        runs.push({ workflowId: j.workflowId, workflowName: j.workflowName, count: 1 });
    }
    return runs;
}

module.exports = { planStoryboard, predictOutputKind, orderByWorkflow, PHASE_LABELS };
