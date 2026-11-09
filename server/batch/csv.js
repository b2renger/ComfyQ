// csv — reads the table a batch is written in.
//
// A batch is usually typed in a spreadsheet, so this reads what spreadsheets
// save: RFC 4180 quoting (a cell may hold commas, quotes doubled as "", and
// line breaks, which is how a long prompt survives), a UTF-8 byte-order mark,
// CRLF or LF. The separator is guessed from the header line, because a French
// Excel saves with ";" and a tab-separated paste is common too.
//
// Each record keeps its spreadsheet row number (the header is row 1), so an
// error can point at the row the person sees, even when a cell above it spans
// several lines of the file.

const SEPARATORS = [',', ';', '\t'];

// The separator that splits the header into the most cells, counted outside
// quotes. A header with one column has no separator to find: "," then.
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
        const count = line.split(sep).length - 1;
        if (count > bestCount) { best = sep; bestCount = count; }
    }
    return best;
}

// → { separator, records: [{ row, cells: string[] }], error? }
// A quote left open runs to the end of the file and swallows every row after
// it, so it is an error naming the row where it opened, not a silent merge.
function parseCsv(input) {
    let text = String(input ?? '');
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    const separator = guessSeparator(text);

    const records = [];
    let cells = [];
    let cell = '';
    let quoted = false;
    let row = 1;                 // spreadsheet row of the record being read
    let quoteOpenedAt = 0;
    let cellStarted = false;     // a quote counts as opening only at a cell's start

    const endCell = () => { cells.push(cell); cell = ''; cellStarted = false; };
    const endRecord = () => {
        endCell();
        records.push({ row, cells });
        cells = [];
        row++;
    };

    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (quoted) {
            if (ch === '"') {
                if (text[i + 1] === '"') { cell += '"'; i++; }
                else quoted = false;
            } else {
                cell += ch;
            }
            continue;
        }
        if (ch === '"' && !cellStarted) { quoted = true; quoteOpenedAt = row; cellStarted = true; continue; }
        if (ch === separator) { endCell(); continue; }
        if (ch === '\r' || ch === '\n') {
            if (ch === '\r' && text[i + 1] === '\n') i++;
            endRecord();
            continue;
        }
        cell += ch;
        cellStarted = true;
    }
    if (quoted) {
        return { separator, records, error: `Row ${quoteOpenedAt}: a quote (") opens a cell and is never closed, so every row after it would be read as part of that cell.` };
    }
    if (cell !== '' || cells.length) endRecord();
    return { separator, records };
}

module.exports = { parseCsv, guessSeparator };
