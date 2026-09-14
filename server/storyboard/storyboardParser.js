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
//   ### ltx_2_3_i2v | 1280x720 | 5s
//   ### stable_audio_3 | 45s
//   ### image_edit_flux2_klein_9b_image_edit_ref | 1280x720 | ref A3
//
// A parenthesised "(ref A3)" is still accepted, and trailing prose after the
// name is kept as a note rather than voiding the whole shot.
const H3_PARTS = /^(\S+)(?:[ \t]*\(([^)]*)\))?[ \t]*(.*)$/;

// "45s" / "5 sec" / "12 seconds" -> seconds. Bounded so a stray number in a
// note can never be read as a duration.
const DURATION_ATTR = /^(\d{1,4})[ \t]*(?:s|sec|secs|seconds?)$/i;

// "ref A3" / "refs A2, A1" / "ref A2 + A1" → ['A2','A1'] (order preserved).
const REF_ANNOTATION = /^refs?[ \t]+(.+)$/i;

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

// Split the part of the "###" line after the workflow name into attributes.
// Both "| a | b" and a bare "(a, b)" annotation end up as the same list.
function splitAttrs(text) {
    return String(text || '')
        .split('|')
        .map(t => t.trim())
        .filter(Boolean);
}

// Read one attribute. Returns what it was, so anything unrecognised can be
// preserved as a note instead of being silently dropped.
function classifyAttr(attr) {
    const size = parseSize(attr);
    if (size && /^\s*\d+\s*[x\u00d7*]\s*\d+\s*$/i.test(attr)) return { kind: 'size', size };
    const dur = DURATION_ATTR.exec(attr);
    if (dur) return { kind: 'duration', durationSec: Number(dur[1]) };
    const refs = parseRefs(attr);
    if (refs.length) return { kind: 'refs', refs };
    return { kind: 'note', text: attr };
}

function parseRefs(annotation) {
    if (!annotation) return [];
    const m = REF_ANNOTATION.exec(annotation.trim());
    if (!m) return [];
    return m[1]
        .split(/[,+&]|\s+/)
        .map(s => s.trim())
        .filter(Boolean)
        .map(tok => {
            const n = /^a?(\d+)$/i.exec(tok);
            return n ? `A${n[1]}` : null;
        })
        .filter(Boolean);
}

// Parse a storyboard markdown document.
//
// Returns { states, items, warnings, errors }:
//   states: [{ id, kind, transitions, line }]
//   items:  [{ index, stateId, stateKind, title, workflowAlias, annotation,
//              refs, anchorKey, prompt, note, line }]
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
    const warnings = [];
    const errors = [];

    let state = null;      // current section
    let item = null;       // current item awaiting its ### / prompt body
    let body = [];         // prompt lines for `item`
    let fence = null;      // open code-fence marker, or null

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
        item = null;
        body = [];
    };

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineNo = i + 1;

        // Code fences win over everything: their contents are prompt text.
        const f = FENCE.exec(line);
        if (f) {
            if (!fence) fence = f[1][0].repeat(Math.max(3, f[1].length));
            else if (f[1][0] === fence[0] && f[1].length >= fence.length) fence = null;
            if (item) body.push(line);
            continue;
        }
        if (fence) { if (item) body.push(line); continue; }

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
            // Apply the "## Slot (argument)" parenthetical.
            if (arg) {
                // NOT split on commas: the grammar gives the slot ONE argument,
                // and "ref A2, A1" is one argument naming two anchors in slot
                // order. Splitting here dropped the second one.
                for (const a of splitAttrs(arg[1])) {
                    if (/^loop$/i.test(a)) { item.loop = true; continue; }
                    const c = classifyAttr(a);
                    if (c.kind === 'refs') item.refs.push(...c.refs);
                    else if (c.kind === 'size') item.size = item.size || c.size;
                    else if (c.kind === 'duration') item.durationSec = item.durationSec ?? c.durationSec;
                    else warnings.push(`Line ${lineNo}: "(${a})" on "${text}" was not understood — ignored.`);
                }
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

            // Attributes may arrive parenthesised or pipe-separated (or both).
            const attrs = [
                ...splitAttrs(item.annotation ? item.annotation.replace(/,/g, '|') : ''),
                ...splitAttrs(item.note)
            ];
            const leftovers = [];
            for (const attr of attrs) {
                const a = classifyAttr(attr);
                if (a.kind === 'size') item.size = item.size || a.size;
                else if (a.kind === 'duration') item.durationSec = item.durationSec ?? a.durationSec;
                else if (a.kind === 'refs') item.refs.push(...a.refs);
                else leftovers.push(a.text);
            }
            item.note = leftovers.join(' | ');
            if (item.annotation && item.refs.length === 0 && !item.size && item.durationSec == null
                && !/^refs?\b/i.test(item.annotation)) {
                warnings.push(`Line ${lineNo}: "(${item.annotation})" was not understood — ignored.`);
            }
            continue;
        }

        // level >= 4 — not part of the format. Say so rather than swallowing
        // the heading and its body into whatever prompt is open.
        warnings.push(`Line ${lineNo}: "${'#'.repeat(level)} ${text}" is deeper than the format uses ` +
            '(# section, ## item, ### workflow) — ignored.');
    }
    flushItem();

    if (fence) warnings.push('A code fence was opened and never closed; everything after it was read as prompt text.');

    if (items.length === 0) {
        throw new Error(
            'No generations found. Each one needs a "## Title" line followed by a ' +
            '"### <workflow-id>" line and a prompt.' +
            (errors.length ? `\n${errors.join('\n')}` : '')
        );
    }
    return { states, items, warnings, errors };
}

module.exports = { parseStoryboard, parseRefs, parseSize };
