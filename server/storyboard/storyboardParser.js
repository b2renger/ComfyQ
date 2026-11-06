// storyboardParser — turns a "storyboard" markdown document into a flat,
// ordered list of generation items.
//
// The document shape (see docs/storyboard-format.md) is:
//
//   # STATE_ID | kind | transitions        ← a section
//   ## Item title                          ← one asset to generate
//   ### <workflow-alias> (ref A3)          ← which workflow, and what it reuses
//   <the prompt, free text until the next heading>
//
// The parser is deliberately dumb about *meaning*: it does not resolve
// workflow aliases, look at the registry, or decide job order. It only
// produces structure + the small amount of convention the titles carry
// (anchor numbering, "ref Ax" back-references), so the planner can do the
// rest against the live registry. That split keeps the parser unit-testable
// with no ComfyUI/registry present.
//
// Anything that would silently change WHAT gets generated — an item whose
// workflow line is unreadable, a second `###` under one `##` — goes into
// `errors`, not `warnings`. A 42-shot storyboard that quietly queues as 41 is
// worse than one that refuses to queue at all.

// One classifier for every ATX heading, so `#`/`##`/`###`/`####` can never be
// confused with each other or with prompt text. CommonMark allows up to three
// leading spaces, requires whitespace after the hashes (so "#hashtag" is not a
// heading), and permits an optional closing run of hashes.
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/;
const CLOSING_HASHES = /[ \t]+#+$/;

// Fenced code blocks. Everything inside one is prompt text, never a heading —
// otherwise a prompt that quotes a shell snippet reshapes the whole batch.
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

// The workflow line carries the workflow name and then any number of
// pipe-separated attributes:
//
//   ### ltx_2_5_i2v | 1280x720 | 5s
//   ### stable_audio_3 | 45s
//   ### image_edit_flux2_klein_9b_image_edit_ref | 1280x720 | ref A3
//
// A parenthesised "(ref A3)" is still accepted. Trailing prose after the name
// does not void the whole shot; it is reported as a warning and ignored.
const H3_PARTS = /^(\S+)(?:[ \t]*\(([^)]*)\))?[ \t]*(.*)$/;

// "45s" / "5 sec" / "12 seconds" -> seconds. Bounded so a stray number in a
// note can never be read as a duration.
const DURATION_ATTR = /^(\d{1,4})[ \t]*(?:s|sec|secs|seconds?)$/i;

// "6.5s" / "2,5 sec" — a duration in fractional seconds. Not accepted (the
// planner sets whole seconds), but recognised so the warning can say why it
// was ignored instead of only that it was.
const FRACTIONAL_DURATION_ATTR = /^\d+[.,]\d+[ \t]*(?:s|sec|secs|seconds?)$/i;

// A decimal comma inside a duration ("2,5s") is one attribute, not a "2" and
// a "5s". The comma split in splitAttrs must not cut it in two, or "(2,5s)"
// would run as 5 s and the warning would blame the "2". Matched only as a
// whole word, so "(1280x720,5s)" still comes apart into a size and a duration,
// while "(ref A2 2,5s)" keeps it after the space.
const DECIMAL_COMMA_DURATION = /(^|,|[ \t])([ \t]*\d+),(\d+[ \t]*(?:s|sec|secs|seconds?)[ \t]*)(?=,|$)/gi;
const KEPT_COMMA = '\u0000';

// The warning for an attribute that changed nothing. A fractional duration
// gets its own wording: the shot silently runs at the workflow's default
// length, which is easy to miss when the number looks right.
function unreadAttrWarning(lineNo, attr, where) {
    if (FRACTIONAL_DURATION_ATTR.test(attr)) {
        return `Line ${lineNo}: "${attr}" on ${where} is not a whole number of seconds, so it was ignored ` +
            'and the shot runs at the workflow default. Write whole seconds.';
    }
    return `Line ${lineNo}: "${attr}" on ${where} was not understood — ignored.`;
}

// "ref A3" / "refs A2, A1" / "ref A2 + A1" → ['A2','A1'] (order preserved).
const REF_ANNOTATION = /^refs?[ \t]+(.+)$/i;

// A bare "A1" (or "1"). On its own it means nothing, but straight after a ref
// it is that ref's next anchor: "(ref A2, A1)" is split on its comma into
// "ref A2" and "A1", and the second anchor must not be lost.
const BARE_ANCHOR = /^a?(\d+)$/i;

// A pixel size written anywhere it is convenient — in the "### workflow (...)"
// annotation, or as a "Resolution:" / "Size:" line of its own before the
// prompt. Accepts 1280x720, 1280 x 720, 1280*720, 1280×720.
const SIZE_TOKEN = /(?:^|[^0-9])(\d{2,5})[ \t]*[x×*][ \t]*(\d{2,5})(?![0-9])/i;
const SIZE_LINE = /^[ \t]*(?:resolution|size|dimensions)[ \t]*[:=][ \t]*(.+?)[ \t]*\.?[ \t]*$/i;

// Read a size out of arbitrary text. Returns { width, height } or null.
// Bounded so a stray "35mm 400" or a year can never be read as a resolution.
function parseSize(text) {
    const m = SIZE_TOKEN.exec(String(text || ''));
    if (!m) return null;
    const width = Number(m[1]);
    const height = Number(m[2]);
    if (!Number.isInteger(width) || !Number.isInteger(height)) return null;
    if (width < 64 || height < 64 || width > 8192 || height > 8192) return null;
    return { width, height };
}

// "## Reference image 2 (ref A1)" / "## Video cut 1 (loop)" — the slot's one
// argument. The generator grammar puts it here; an older one put it on the
// "###" line beside the size. Both are read, so a document written to either
// spec queues the same way.
const H2_ARGUMENT = /\(([^)]*)\)\s*$/;

// "Video cut 3" → 3. A cut is wired to the "Reference image" of the SAME number
// in the same state, which is what the grammar promises; falling back to
// document order only when the numbering does not line up.
const SLOT_NUMBER = /(\d+)\s*(?:\([^)]*\))?\s*$/;

// "Anchor image 2" → 2. Any item titled this way becomes addressable as "A2".
// Not anchored at the start, so a decorated title ("🎬 Anchor image 2") keeps
// its anchor instead of silently losing it and dangling every later "(ref A2)".
const ANCHOR_TITLE = /anchor\s+image\s*(\d+)/i;

function splitHeaderCells(text) {
    return String(text).split('|').map(s => s.trim());
}

// Split a run of attributes into a list. Pipes and commas both separate, so
// "| ref A2, 8s", "(ref A2, 8s)" and "## Video cut 1 (ref A2, 8s)" all come
// apart the same way, and a size or a duration written after a ref is read
// instead of vanishing into the ref list. A decimal comma in a duration is
// kept (DECIMAL_COMMA_DURATION).
function splitAttrs(text) {
    return String(text || '')
        .split('|')
        .flatMap(seg => seg.replace(DECIMAL_COMMA_DURATION, `$1$2${KEPT_COMMA}$3`).split(','))
        .map(t => t.split(KEPT_COMMA).join(',').trim())
        .filter(Boolean);
}

// Read one attribute. Returns what it was, so anything unrecognised can be
// reported instead of being silently dropped.
function classifyAttr(attr) {
    const size = parseSize(attr);
    if (size && /^\s*\d+\s*[x\u00d7*]\s*\d+\s*$/i.test(attr)) return { kind: 'size', size };
    const dur = DURATION_ATTR.exec(attr);
    if (dur) return { kind: 'duration', durationSec: Number(dur[1]) };
    const refs = readRefList(attr);
    if (refs) return { kind: 'refs', refs: refs.refs, rest: refs.rest };
    return { kind: 'note', text: attr };
}

// "ref A2 + A1" → { refs: ['A2','A1'], rest: '' }, or null when it is not a
// ref list. Tokens that are not anchors come back in `rest` instead of
// vanishing: "ref A2 8s" is a ref and a duration.
function readRefList(annotation) {
    if (!annotation) return null;
    const m = REF_ANNOTATION.exec(annotation.trim());
    if (!m) return null;
    const refs = [];
    const rest = [];
    // A decimal comma stays inside its duration here too: "ref A2 2,5s" is not
    // the anchors A2 and 2 plus a 5 s duration.
    const list = m[1].replace(DECIMAL_COMMA_DURATION, `$1$2${KEPT_COMMA}$3`);
    for (const raw of list.split(/[,+&]|\s+/).map(t => t.trim()).filter(Boolean)) {
        const tok = raw.split(KEPT_COMMA).join(',');
        const n = BARE_ANCHOR.exec(tok);
        if (n) refs.push(`A${n[1]}`);
        else rest.push(tok);
    }
    return refs.length ? { refs, rest: rest.join(' ') } : null;
}

function parseRefs(annotation) {
    const r = readRefList(annotation);
    return r ? r.refs : [];
}

// Read a run of attributes onto a shot: the "## Slot (…)" argument, or what
// follows the workflow name on the "###" line. One reader for both, so
// "ref A2, 8s" means the same wherever it is written. A bare anchor straight
// after a ref continues that ref's list ("ref A2, A1" names two anchors, while
// "ref A1, 900x900" is an anchor and a size). `loop` is read only where the
// caller allows it. Whatever is not understood comes back in `leftovers` for
// the caller to report: it changed nothing.
function readAttrs(attrs, { allowLoop = false } = {}) {
    const out = { refs: [], size: null, durationSec: null, loop: false, leftovers: [] };
    const apply = (attr) => {
        if (allowLoop && /^loop$/i.test(attr)) { out.loop = true; return 'loop'; }
        const a = classifyAttr(attr);
        if (a.kind === 'size') out.size = out.size || a.size;
        else if (a.kind === 'duration') out.durationSec = out.durationSec ?? a.durationSec;
        else if (a.kind === 'refs') {
            out.refs.push(...a.refs);
            if (a.rest) apply(a.rest);
        } else out.leftovers.push(a.text);
        return a.kind;
    };
    let afterRefs = false;
    for (const attr of attrs) {
        const bare = afterRefs ? BARE_ANCHOR.exec(attr) : null;
        if (bare) { out.refs.push(`A${bare[1]}`); continue; }
        afterRefs = apply(attr) === 'refs';
    }
    return out;
}

// Parse a storyboard markdown document.
//
// Returns { states, items, dropped, warnings, errors }:
//   states:  [{ id, kind, transitions, line }]
//   items:   [{ index, stateId, stateKind, title, workflowAlias, annotation,
//               refs, anchorKey, prompt, note, line }]
//   dropped: [{ stateId, stateKind, title, workflowAlias, slotNumber,
//               anchorKey, line }] — the "##" shots refused here (no "###"
//               line, or no prompt), each already reported in `errors`. The
//               planner needs them: a "Video cut 1" whose "Reference image 1"
//               was dropped must wait, not take the next shot's picture.
// Anything fatal for the document as a whole throws.
function parseStoryboard(markdown) {
    if (typeof markdown !== 'string' || markdown.trim() === '') {
        throw new Error('The storyboard file is empty.');
    }
    // Split on any line terminator - CRLF, LF, or the lone CR an old editor
    // can emit - so a heading is never missed because of a trailing \r the
    // heading regex would refuse to match.
    const lines = markdown.split(/\r\n|\n|\r/).map(l => l.replace(/\r/g, ''));
    const states = [];
    const items = [];
    const dropped = [];
    const warnings = [];
    const errors = [];

    let state = null;      // current section
    let item = null;       // current item awaiting its ### / prompt body
    let body = [];         // prompt lines for `item`
    let fence = null;      // open code-fence marker, or null
    let fenceLine = 0;     // where the open fence started
    let fenceIn = null;    // the shot whose prompt it opened in, or null
    let fenceInNotes = false;
    // While a fence is open: whether the text it is swallowing sits in a notes
    // section (a "# X | notes" line inside it counts), and the first "## "
    // heading it swallowed outside one — the shot that will not be generated.
    let swallowNotes = false;
    let swallowed = null;

    const flushItem = () => {
        if (!item) return;
        item.prompt = body.join('\n').trim();
        const where = `Line ${item.line}, "${item.title}"`;
        if (!item.workflowAlias) {
            errors.push(`${where}: no "### <workflow>" line, so there is nothing to run.`);
        } else if (!item.prompt) {
            errors.push(`${where}: no prompt text under "### ${item.workflowAlias}".`);
        } else {
            item.index = items.length;
            items.push(item);
        }
        if (item.index < 0) {
            dropped.push({
                stateId: item.stateId, stateKind: item.stateKind, title: item.title,
                workflowAlias: item.workflowAlias, slotNumber: item.slotNumber,
                anchorKey: item.anchorKey, line: item.line
            });
        }
        item = null;
        body = [];
    };

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineNo = i + 1;

        // Code fences win over everything: their contents are prompt text.
        const f = FENCE.exec(line);
        if (f) {
            if (!fence) {
                fence = f[1][0].repeat(Math.max(3, f[1].length));
                fenceLine = lineNo;
                fenceIn = item ? item.title : null;
                fenceInNotes = swallowNotes = !!(state && state.kind === 'notes');
                swallowed = null;
            } else if (f[1][0] === fence[0] && f[1].length >= fence.length) fence = null;
            if (item) body.push(line);
            continue;
        }
        if (fence) {
            // Only matters if the fence is never closed: then this heading was
            // never read as one. Tracked so the report can name the first shot
            // lost, and stay a warning when none was.
            const sh = !swallowed && HEADING.exec(line);
            if (sh && sh[1].length === 1) {
                swallowNotes = (splitHeaderCells(sh[2] || '')[1] || '').toLowerCase() === 'notes';
            } else if (sh && sh[1].length === 2 && !swallowNotes) {
                swallowed = { line: lineNo, text: (sh[2] || '').replace(CLOSING_HASHES, '').trim() };
            }
            if (item) body.push(line);
            continue;
        }

        const h = HEADING.exec(line);
        if (!h) {
            if (item) {
                // A "Resolution: 1280x720" line of its own belongs to the shot,
                // not to the prompt — pull it out so it never reaches the text
                // encoder as if it were part of the description.
                const sizeLine = SIZE_LINE.exec(line);
                const fromLine = sizeLine && parseSize(sizeLine[1]);
                if (fromLine) { item.size = item.size || fromLine; continue; }
                body.push(line);
            }
            continue;
        }

        const level = h[1].length;
        const text = (h[2] || '').replace(CLOSING_HASHES, '').trim();

        if (level === 1) {
            flushItem();
            const cells = splitHeaderCells(text);
            const id = cells[0] || `SECTION_${states.length + 1}`;
            // A prose line that happens to start with "# " is a heading as far
            // as markdown is concerned, and would silently split the document.
            // Section ids are identifiers, so flag anything that isn't one.
            if (/\s/.test(id)) {
                warnings.push(`Line ${lineNo}: "# ${text}" was read as a new section named "${id}". ` +
                    'If that was meant as prompt text, indent it or remove the leading "#".');
            }
            state = { id, kind: (cells[1] || 'scene').toLowerCase(), transitions: cells.slice(2).join(' | ') || '', line: lineNo };
            states.push(state);
            continue;
        }

        if (level === 2) {
            flushItem();
            if (!state) {
                // Items before any "# STATE" heading still generate fine; give
                // them a synthetic section so downstream grouping never sees null.
                state = { id: 'UNSECTIONED', kind: 'scene', transitions: '', line: lineNo };
                states.push(state);
            }
            // The grammar reserves the `notes` role for prose meant for a
            // human. Nothing under it is a shot, even if it looks like one.
            if (state.kind === 'notes') { item = null; body = []; continue; }
            const anchor = ANCHOR_TITLE.exec(text);
            const arg = H2_ARGUMENT.exec(text);
            const slotNo = SLOT_NUMBER.exec(text);
            item = {
                index: -1,
                stateId: state.id,
                stateKind: state.kind,
                title: text || `Item ${items.length + 1}`,
                workflowAlias: null,
                annotation: null,
                refs: [],
                size: null,
                durationSec: null,
                loop: false,
                slotNumber: slotNo ? Number(slotNo[1]) : null,
                anchorKey: anchor ? `A${anchor[1]}` : null,
                prompt: '',
                note: '',
                line: lineNo
            };
            // Apply the "## Slot (argument)" parenthetical, read by the same
            // rules as the "###" line: "(ref A2, A1)" is two anchors in slot
            // order, "(ref A1, 900x900)" an anchor and a size, "(ref A2, loop)"
            // an anchor and a loop.
            if (arg) {
                const r = readAttrs(splitAttrs(arg[1]), { allowLoop: true });
                item.refs = r.refs;
                item.size = r.size;
                item.durationSec = r.durationSec;
                item.loop = r.loop;
                for (const left of r.leftovers) warnings.push(unreadAttrWarning(lineNo, left, `"${text}"`));
            }
            body = [];
            continue;
        }

        if (level === 3) {
            // Everything under a `notes` state is prose for a human.
            if (state && state.kind === 'notes') continue;
            if (!item) {
                errors.push(`Line ${lineNo}: "### ${text}" has no "## <title>" above it, so it cannot be queued.`);
                continue;
            }
            if (item.workflowAlias) {
                errors.push(`Line ${lineNo}: "${item.title}" already names workflow "${item.workflowAlias}"; ` +
                    `a second "### ${text}" would silently replace it. Split it into two "## " items.`);
                continue;
            }
            const parts = H3_PARTS.exec(text);
            if (!parts || !parts[1]) {
                errors.push(`Line ${lineNo}: could not read the workflow name from "### ${text}".`);
                continue;
            }
            item.workflowAlias = parts[1];
            item.annotation = parts[2] ? parts[2].trim() : null;
            item.note = (parts[3] || '').trim();

            // Attributes may arrive parenthesised or pipe-separated (or both),
            // read by the same rules as the "##" argument. `loop` is not read
            // here: it belongs on the "##" line, and is reported if written here.
            const r = readAttrs([...splitAttrs(item.annotation), ...splitAttrs(item.note)]);
            item.size = item.size || r.size;
            item.durationSec = item.durationSec ?? r.durationSec;
            const h3Refs = r.refs;
            const leftovers = r.leftovers;
            // The refs may be written on the "##" line or here, not added up
            // from both: the same list twice is kept once (doubling it would
            // fill a second image slot and hide the one-ref warning), and two
            // lists that disagree cannot both be right.
            if (h3Refs.length) {
                if (item.refs.length === 0) {
                    item.refs = h3Refs;
                } else if (item.refs.join(',') !== h3Refs.join(',')) {
                    errors.push(`Line ${lineNo}: "### ${text}" names ref ${h3Refs.join(', ')}, but ` +
                        `"## ${item.title}" (line ${item.line}) names ref ${item.refs.join(', ')}. ` +
                        'Write the refs in one place.');
                }
            }
            item.note = leftovers.join(' | ');
            // Anything left over changed nothing — a "5.5s" (durations are
            // whole seconds) or a "ref: A2" (no colon) would otherwise be
            // dropped while the shot quietly ran on defaults or another frame.
            for (const left of leftovers) {
                warnings.push(unreadAttrWarning(lineNo, left, `"### ${text}"`));
            }
            continue;
        }

        // level >= 4 — not part of the format. Say so rather than swallowing
        // the heading and its body into whatever prompt is open.
        warnings.push(`Line ${lineNo}: "${'#'.repeat(level)} ${text}" is deeper than the format uses ` +
            '(# section, ## item, ### workflow) — ignored.');
    }
    flushItem();

    // An unclosed fence swallows the rest of the document. That is an error
    // only when a "## " shot heading was in what it swallowed — those shots
    // would silently not be generated. Otherwise nothing was lost, and a
    // warning that says where the text went is enough.
    if (fence && swallowed) {
        errors.push(`Line ${fenceLine}: a code fence opened here was never closed, so "## ${swallowed.text}" ` +
            `(line ${swallowed.line}) and everything after it was taken as the fence's content, not as shots. ` +
            'Close the fence with a matching line, or remove it.');
    } else if (fence && fenceIn) {
        warnings.push(`Line ${fenceLine}: a code fence opened here was never closed, so everything after it ` +
            `was read as part of the prompt of "${fenceIn}". Check that the prompt ends where you meant, ` +
            'and close the fence with a matching line.');
    } else if (fence) {
        warnings.push(`Line ${fenceLine}: a code fence opened here was never closed. It is ` +
            (fenceInNotes ? 'in a notes section' : 'not inside any shot') +
            ', so the text after it was skipped; no shot heading was in it. Close it with a matching line, or remove it.');
    }

    if (items.length === 0) {
        throw new Error(
            'No generations found. Each one needs a "## Title" line followed by a ' +
            '"### <workflow-id>" line and a prompt.' +
            (errors.length ? `\n${errors.join('\n')}` : '')
        );
    }
    return { states, items, dropped, warnings, errors };
}

module.exports = { parseStoryboard, parseRefs, parseSize };
