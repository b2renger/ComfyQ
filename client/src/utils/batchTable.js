// batchTable — the batch editor's model of a table, and the CSV it reads and
// writes (docs/batch-format.md).
//
// The server is the authority on what a table means: the editor sends the CSV
// to /storyboard/preview and shows what comes back. This module only has to
// read a file into rows and write rows back out without losing anything, so a
// table made here, in a spreadsheet or by the batch skill is the same file.

const SEPARATORS = [',', ';', '\t'];

// The separator that splits the header into the most cells, outside quotes.
function guessSeparator(text) {
    let line = '';
    let quoted = false;
    for (const ch of text) {
        if (ch === '"') quoted = !quoted;
        else if (!quoted && (ch === '\n' || ch === '\r')) break;
        else if (!quoted) line += ch;
    }
    let best = ',';
    let bestCount = 0;
    for (const sep of SEPARATORS) {
        const n = line.split(sep).length - 1;
        if (n > bestCount) { best = sep; bestCount = n; }
    }
    return best;
}

// RFC 4180, as spreadsheets save it. → string[][] (records), or throws on an
// unclosed quote, which would otherwise swallow the rest of the file.
export function parseCsv(input) {
    let text = String(input ?? '');
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    const sep = guessSeparator(text);
    const records = [];
    let cells = [];
    let cell = '';
    let quoted = false;
    let started = false;
    let row = 1;
    let openedAt = 0;
    const endCell = () => { cells.push(cell); cell = ''; started = false; };
    const endRecord = () => { endCell(); records.push(cells); cells = []; row++; };
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (quoted) {
            if (ch === '"') {
                if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
            } else cell += ch;
            continue;
        }
        if (ch === '"' && !started) { quoted = true; started = true; openedAt = row; continue; }
        if (ch === sep) { endCell(); continue; }
        if (ch === '\r' || ch === '\n') { if (ch === '\r' && text[i + 1] === '\n') i++; endRecord(); continue; }
        cell += ch;
        started = true;
    }
    if (quoted) throw new Error(`Row ${openedAt}: a quote (") opens a cell and is never closed.`);
    if (cell !== '' || cells.length) endRecord();
    return records;
}

function quote(value) {
    const s = String(value ?? '');
    return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header, records) {
    return [header, ...records].map(r => r.map(quote).join(',')).join('\r\n') + '\r\n';
}

// Columns that come first and last, whatever the cards: the rest sit between.
// stage, caption and keepRuntime are the test suite's (tools/test-suite).
const LEAD = ['id', 'workflow', 'stage', 'caption', 'keepRuntime', 'prompt', 'negative'];
const TAIL = ['repeat', 'seed', 'notes'];
// A header as typed → the name the editor keeps it under.
const CANONICAL = new Map([...LEAD, ...TAIL].map(c => [c.toLowerCase(), c]));
const MEDIA_RX = /^(image|mask|video|audio|model3d)(\d*)$/;
const MEDIA_ORDER = ['image', 'mask', 'video', 'audio', 'model3d'];

let uidCounter = 0;
export const newUid = () => `r${Date.now().toString(36)}${(uidCounter++).toString(36)}`;

// A file → { rows: [{ uid, cells }], skipped } where cells is { column: text }.
// Comment rows (first cell "#…") and empty rows are not rows of the batch;
// `skipped` counts the comments so the editor can say they were dropped.
export function tableFromCsv(text) {
    const records = parseCsv(text).filter(r => r.some(c => String(c).trim() !== ''));
    if (!records.length) return { rows: [], skipped: 0 };
    const header = records[0].map(h => String(h).trim());
    let skipped = 0;
    const rows = [];
    for (const rec of records.slice(1)) {
        if (String(rec[0] ?? '').trim().startsWith('#')) { skipped++; continue; }
        const cells = {};
        header.forEach((h, i) => {
            if (!h) return;
            const v = String(rec[i] ?? '');
            const low = h.toLowerCase();
            const key = CANONICAL.get(low) || (MEDIA_RX.test(low) ? low : h);
            if (v.trim() !== '') cells[key] = v;
        });
        rows.push({ uid: newUid(), cells });
    }
    return { rows, skipped };
}

// The header a set of rows needs: every column some row fills, in a stable
// order (lead, media inputs, settings in first-seen order, tail).
export function columnsFor(rows) {
    const used = new Set();
    const settings = [];
    for (const r of rows) {
        for (const [k, v] of Object.entries(r.cells)) {
            if (String(v ?? '').trim() === '') continue;
            if (!used.has(k)) { used.add(k); if (!LEAD.includes(k) && !TAIL.includes(k) && !MEDIA_RX.test(k)) settings.push(k); }
        }
    }
    const media = [...used].filter(k => MEDIA_RX.test(k)).sort((a, b) => {
        const [, ta, na] = MEDIA_RX.exec(a);
        const [, tb, nb] = MEDIA_RX.exec(b);
        return MEDIA_ORDER.indexOf(ta) - MEDIA_ORDER.indexOf(tb) || (Number(na || 1) - Number(nb || 1));
    });
    return [
        ...LEAD.filter(k => k === 'id' || k === 'workflow' || used.has(k)),
        // (settings are pushed in first-seen order above; the LEAD and TAIL
        // columns never land there, whatever case a file wrote them in)
        ...media,
        ...settings,
        ...TAIL.filter(k => used.has(k)),
    ];
}

export function csvFromRows(rows) {
    const header = columnsFor(rows);
    return toCsv(header, rows.map(r => header.map(h => r.cells[h] ?? '')));
}

// An input cell, read into its parts, and written back. Anything this does not
// recognise comes back as { raw } so it is kept as typed, and the server says
// what is wrong with it.
//   ''              → { type: 'none' }
//   empty           → { type: 'empty' }        left empty on purpose
//   hero#2, hero.3  → { type: 'row', row, copy, output }
//   file:a.png      → { type: 'file', path, steps }
//   folder:dir/     → { type: 'folder', path, steps }
//   job:<id>#2      → { type: 'job', job, output }
// `steps` is what follows the file, as written: "scale(0.3) | jpeg(40)".
export function parseRef(value) {
    const [head, ...rest] = String(value ?? '').split('|');
    const v = head.trim();
    const steps = rest.map(s => s.trim()).filter(Boolean).join(' | ');
    let m;
    if (!v && !steps) return { type: 'none' };
    if (/^empty$/i.test(v) && !steps) return { type: 'empty' };
    // An empty name is a picker just switched to "a file" or "a job", still to fill.
    if ((m = /^file:(.*)$/i.exec(v))) return { type: 'file', path: m[1].trim(), steps };
    if ((m = /^folder:(.*)$/i.exec(v))) return { type: 'folder', path: m[1].trim().replace(/[\\/]+$/, ''), steps };
    if (steps) return { type: 'raw', raw: String(value).trim() };
    if ((m = /^job:([0-9a-f-]*)(?:#(\d+))?$/i.exec(v))) return { type: 'job', job: m[1], output: m[2] ? Number(m[2]) : 1 };
    if ((m = /^([A-Za-z0-9][A-Za-z0-9_@-]*)(?:\.(\d+))?(?:#(\d+))?$/.exec(v))) {
        return { type: 'row', row: m[1], copy: m[2] ? Number(m[2]) : null, output: m[3] ? Number(m[3]) : 1 };
    }
    return { type: 'raw', raw: v };
}

const withSteps = (base, steps) => (steps ? `${base} | ${steps}` : base);

export function formatRef(ref) {
    switch (ref?.type) {
        case 'empty': return 'empty';
        case 'file': return ref.path ? withSteps(`file:${ref.path}`, ref.steps) : '';
        case 'folder': return withSteps(`folder:${ref.path ? `${ref.path}/` : ''}`, ref.steps);
        case 'job': return ref.job ? `job:${ref.job}${ref.output > 1 ? `#${ref.output}` : ''}` : '';
        case 'row': return ref.row ? `${ref.row}${ref.copy ? `.${ref.copy}` : ''}${ref.output > 1 ? `#${ref.output}` : ''}` : '';
        case 'raw': return ref.raw;
        default: return '';
    }
}

// The rows a cell can take its file from: any other row whose card makes
// that kind, above or below (the batch runs a source first either way).
export function sourceRows(rows, cards, selfUid, kind) {
    const byId = new Map(cards.map(c => [c.id, c]));
    return rows.filter(r => r.uid !== selfUid && r.cells.id && byId.get(r.cells.workflow)?.produces === kind);
}

// A free id for a new row: hero, hero2, … or row1, row2, …
export function freeId(rows, base = 'row') {
    const taken = new Set(rows.map(r => r.cells.id).filter(Boolean));
    const stem = String(base).replace(/[^A-Za-z0-9_-]/g, '').replace(/^[^A-Za-z]+/, '') || 'row';
    for (let i = 1; ; i++) {
        const id = i === 1 && stem !== 'row' ? stem : `${stem}${i}`;
        if (!taken.has(id)) return id;
    }
}
