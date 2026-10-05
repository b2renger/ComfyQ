#!/usr/bin/env node
// Fill in requirements.models[].url / .source across every bundle, from the
// download links the workflows already carry.
//
// ★ The links are mostly already in the repo. ComfyUI's own templates document
// their models in Note / MarkdownNote nodes, and 53 of 68 bundle templates
// carried HuggingFace URLs — many of them /resolve/main/<subfolder>/<file>,
// i.e. a direct download WITH its destination folder.
//
// ★ The index is POOLED ACROSS ALL BUNDLES, keyed by filename. Per bundle the
// notes cover about 68% of declared models; pooled it is about 84%, because a
// shared weight like flux-2-klein-9b-fp8 only needs ONE bundle to document it.
// Harvest globally or leave a sixth of the library unsourced for no reason.
//
// Two fields, because the difference decides whether a Download button can work:
//   url    — a direct, fetchable file URL (HF /resolve/<rev>/<path>)
//   source — a page for a human, when only the repo is known
// Never invent a url: a wrong direct link downloads the wrong weights silently.
//
// Dry run by default. Pass --write to rewrite the metas.
//   MODEL_AUDIT_CSV=<path to model-audit.csv>  adds the audit's redownload column
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const WF = path.join(ROOT, 'workflows');
const WEIGHT_RX = /\.(safetensors|sft|ckpt|pt|pth|gguf|onnx|bin)$/i;
const URL_RX = /https?:\/\/[^\s"'<>)\]]+/g;
const WRITE = process.argv.includes('--write');

const read = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const basename = (v) => v.split('\\').join('/').split('/').pop();

// ---------------------------------------------------------------- note mining
// Note text is the only place these links live. A Note node's widget values are
// a positional array; some packs put the text on `inputs` instead.
function noteText(graph) {
    const nodes = Array.isArray(graph.nodes) ? graph.nodes : Object.values(graph);
    let t = '';
    for (const n of nodes) {
        if (!n || typeof n !== 'object') continue;
        if (!/note/i.test(n.type || n.class_type || '')) continue;
        const wv = n.widgets_values;
        if (Array.isArray(wv)) t += ' ' + wv.filter(x => typeof x === 'string').join(' ');
        else if (typeof wv === 'string') t += ' ' + wv;
        if (n.inputs) t += ' ' + Object.values(n.inputs).filter(x => typeof x === 'string').join(' ');
    }
    return t;
}

// Normalised so the same file quoted in two notes agrees: /blob/ is the HTML
// page for a file, /resolve/ is the bytes.
function normalise(raw) {
    let u = raw.replace(/[),.;]+$/, '');
    try { u = decodeURIComponent(u); } catch { /* leave as-is */ }
    u = u.split('?')[0].split('#')[0];
    if (/huggingface\.co\/.+\/blob\//.test(u)) u = u.replace('/blob/', '/resolve/');
    return u;
}
const isDirect = (u) => /huggingface\.co\/.+\/resolve\/[^/]+\/.+/.test(u) && WEIGHT_RX.test(u);
const repoPage = (u) => {
    const m = u.match(/^https?:\/\/huggingface\.co\/([^/]+\/[^/]+)/);
    return m ? `https://huggingface.co/${m[1]}` : null;
};

function buildIndex() {
    const files = [];
    for (const d of fs.readdirSync(WF)) {
        const p = path.join(WF, d);
        if (!fs.statSync(p).isDirectory()) continue;
        if (d.startsWith('_')) {
            // Candidates are not bundles, but they document real models.
            for (const e of fs.readdirSync(p)) if (e.endsWith('.json')) files.push(path.join(p, e));
            continue;
        }
        for (const suf of ['_template.json', '.api.json']) {
            const q = path.join(p, d + suf);
            if (fs.existsSync(q)) files.push(q);
        }
    }
    const direct = new Map(), source = new Map();
    for (const f of files) {
        const g = read(f);
        if (!g) continue;
        for (const raw of (noteText(g).match(URL_RX) || [])) {
            const u = normalise(raw);
            if (!isDirect(u)) continue;
            const b = basename(u);
            if (!direct.has(b)) direct.set(b, u);
            const page = repoPage(u);
            if (page && !source.has(b)) source.set(b, page);
        }
    }
    return { direct, source, scanned: files.length };
}

// ------------------------------------------- the audit's redownload column
// Hand-curated provenance for the whole disk, living outside git in
// _maintenance/model-audit. Forms seen: "Owner/Repo (sub/dir/file.safetensors)",
// a bare URL, "Owner/Repo" alone, and prose — only the first three are usable.
function auditIndex(csvPath) {
    const direct = new Map(), source = new Map();
    if (!csvPath || !fs.existsSync(csvPath)) return { direct, source, rows: 0 };
    const text = fs.readFileSync(csvPath, 'utf8').replace(/^\uFEFF/, '');
    const lines = text.split(/\r?\n/);
    const hdr = lines[0].split(';');
    const iName = hdr.indexOf('name'), iRe = hdr.indexOf('redownload');
    let rows = 0;
    for (const line of lines.slice(1)) {
        if (!line.trim()) continue;
        const cells = [];
        let cur = '', quoted = false;
        for (const ch of line) {
            if (ch === '"') quoted = !quoted;
            else if (ch === ';' && !quoted) { cells.push(cur); cur = ''; }
            else cur += ch;
        }
        cells.push(cur);
        const name = (cells[iName] || '').trim();
        const re = (cells[iRe] || '').trim();
        if (!name || !re || /^unknown/i.test(re)) continue;
        rows++;
        const found = (re.match(URL_RX) || [])[0];
        if (found) {
            const u = normalise(found);
            if (isDirect(u)) direct.set(name, u);
            const p = repoPage(u);
            if (p && !source.has(name)) source.set(name, p);
            continue;
        }
        const withPath = re.match(/^([\w.-]+\/[\w.-]+)\s*\(([^)]+)\)/);
        if (withPath && WEIGHT_RX.test(withPath[2])) {
            direct.set(name, `https://huggingface.co/${withPath[1]}/resolve/main/${withPath[2].trim()}`);
            source.set(name, `https://huggingface.co/${withPath[1]}`);
            continue;
        }
        const repoOnly = re.match(/^([\w.-]+\/[\w.-]+)\s*$/);
        if (repoOnly) source.set(name, `https://huggingface.co/${repoOnly[1]}`);
    }
    return { direct, source, rows };
}

// ------------------------------------------------------------------------ main
const notes = buildIndex();
const audit = auditIndex(process.env.MODEL_AUDIT_CSV);
const HAND = read(path.join(__dirname, 'known-sources.json')) || {};
// ★ Links verify.cjs has proved dead. Without this the two tools fight: verify
// drops a 404 from the metas and the next harvest puts it straight back from
// the same note it came from.
const DEAD = new Set((read(path.join(__dirname, 'dead-links.json')) || {}).dead || []);
// _-prefixed keys are documentation for whoever edits that file, not models.
for (const k of Object.keys(HAND)) if (k.startsWith('_')) delete HAND[k];

console.log(`notes: scanned ${notes.scanned} workflow files -> ${notes.direct.size} direct file URLs`);
console.log(`audit: ${audit.rows} usable rows -> ${audit.direct.size} direct, ${audit.source.size} repo-only`);
console.log(`hand:  ${Object.keys(HAND).length} curated entries\n`);

const bundles = fs.readdirSync(WF)
    .filter(d => !d.startsWith('_') && fs.statSync(path.join(WF, d)).isDirectory());
const stat = { total: 0, note: 0, auditD: 0, repo: 0, hand: 0, auto: 0, kept: 0, none: 0 };
const unsourced = [];
let changed = 0;

for (const id of bundles) {
    const mp = path.join(WF, id, `${id}.meta.json`);
    const meta = read(mp);
    if (!meta) continue;
    let touched = false;

    for (const m of (meta.requirements?.models || [])) {
        stat.total++;
        const b = basename(m.file || '');
        // Looked up by the raw declared value first: a HuggingFace repo id
        // ("microsoft/TRELLIS.2-4B") would otherwise be reduced to its last
        // path segment and never match.
        const hand = HAND[m.file] || HAND[b];
        const next = { ...m };

        // Not a single downloadable file: a node pack fetches it, or a pipeline
        // stages through a HuggingFace repo. Declared and excused, so it can
        // never read as "missing".
        if (hand && hand.auto) {
            next.auto = true;
            if (hand.note) next.note = hand.note;
            if (hand.source) next.source = hand.source;
            stat.auto++;
        } else if (!WEIGHT_RX.test(b)) {
            stat.none++;
            unsourced.push(`${id}: ${m.file} (not a weight filename)`);
            continue;
        } else {
            let url = notes.direct.get(b);
            let src = notes.source.get(b);
            let from = url ? 'note' : null;
            if (!url && audit.direct.has(b)) { url = audit.direct.get(b); from = 'audit'; }
            if (!src) src = audit.source.get(b);
            if (!url && hand && hand.url) { url = hand.url; from = from || 'hand'; }
            if (!src && hand && hand.source) { src = hand.source; from = from || 'hand'; }

            // ★ An override has to run LAST, after every fallback. A note can be
            // WRONG -- the LTX deblur template points its pixel-spatial-upscaler
            // adapter at the IC-LoRA-Deblur repo, which does not hold it, and
            // because that repo is gated the bad link answers 401 and reads as
            // healthy. Putting this check first was not enough: the audit's own
            // copy of the same wrong link refilled it on the very next line.
            if (hand && hand.override) {
                url = hand.url || undefined;
                src = hand.source || undefined;
                from = 'hand';
                // An override with no url exists precisely to REMOVE a wrong one.
                if (!url) delete next.url;
                if (!src) delete next.source;
            }
            if (url && DEAD.has(url)) { delete next.url; url = undefined; }
            if (src && DEAD.has(src)) { delete next.source; src = undefined; }

            if (url) next.url = url;
            if (src) next.source = src;
            if (hand && hand.note) next.note = hand.note;

            if (from === 'note') stat.note++;
            else if (from === 'audit') stat.auditD++;
            else if (from === 'hand') stat.hand++;
            else if (src) stat.repo++;
            // ★ "Found nothing" is not the same as "has nothing". The audit CSV
            // is an optional input (MODEL_AUDIT_CSV), so a run without it finds
            // no source for entries a previous run already wrote one into —
            // reporting those as unsourced sends you hunting for a link that is
            // sitting in the file.
            else if (next.url || next.source) stat.kept++;
            else { stat.none++; unsourced.push(`${id}: ${b}`); continue; }
        }

        // ★ Object.assign MERGES — it cannot remove a key, so a url this run
        // decided against would survive from the previous run's write and the
        // override would silently do nothing. Clear the fields this tool owns
        // before merging; everything else in the entry is left alone.
        for (const k of ['url', 'source', 'auto', 'note']) {
            if (!(k in next) && (k in m)) { delete m[k]; touched = true; }
        }
        if (JSON.stringify(next) !== JSON.stringify(m)) { Object.assign(m, next); touched = true; }
    }

    if (touched) {
        changed++;
        if (WRITE) fs.writeFileSync(mp, JSON.stringify(meta, null, 2) + '\n');
    }
}

const pct = (n) => `${String(n).padStart(3)} (${String(Math.round(100 * n / stat.total)).padStart(2)}%)`;
console.log(`${stat.total} model entries across ${bundles.length} bundles`);
console.log(`  direct URL from template notes : ${pct(stat.note)}`);
console.log(`  direct URL from the audit CSV  : ${pct(stat.auditD)}`);
console.log(`  direct URL, hand-curated       : ${pct(stat.hand)}`);
console.log(`  repo page only                 : ${pct(stat.repo)}`);
console.log(`  declared auto-downloaded       : ${pct(stat.auto)}`);
console.log(`  already in the meta            : ${pct(stat.kept)}`);
console.log(`  STILL UNSOURCED                : ${pct(stat.none)}`);

if (unsourced.length) {
    console.log('\nneeding a source (add to known-sources.json):');
    const seen = new Set();
    for (const u of unsourced) {
        const k = u.slice(u.indexOf(': ') + 2);
        if (seen.has(k)) continue;
        seen.add(k);
        console.log('   ' + k);
    }
}
console.log(`\n${changed} meta file(s) ${WRITE ? 'rewritten' : 'would change'}${WRITE ? '' : ' — dry run, pass --write'}`);
