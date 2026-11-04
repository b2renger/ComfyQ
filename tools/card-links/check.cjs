#!/usr/bin/env node
// Check every link a workflow card shows: its prompt guides and its models'
// `url` / `source`. tools/model-provenance/verify.cjs HEAD-checks model files
// only; this reads every URL anywhere in a meta.json and checks it the way a
// browser would see it, because a dead link on a card is something a student
// clicks.
//
//   ok        the page or file answers, and lands where the link says
//   moved     it answers, but only after a redirect to a different page —
//             usually fine, worth updating so the card does not depend on a
//             redirect a site can drop
//   gated     401/403 from huggingface.co: the repo exists and needs a licence
//             accepted. ★ Not proof that the path is right — HF answers 401 for
//             ANY path inside a gated repo.
//   blocked   403/429 from a site that refuses scripted clients. Concludes
//             nothing about whether a person can open it.
//   missing   404/410, or a 200 page whose title says "not found" (a soft 404)
//   anchor    the page is there but the #fragment the link points at is not
//   error     network / timeout — concludes nothing
//
// Usage: node tools/card-links/check.cjs [--json <out.json>] [--only <substring>] [--templates] [--mark-gated]
//   --mark-gated write `gated: true` on each model entry whose link answered as
//                gated (and drop it where it no longer does), so the admin card
//                labels the download instead of opening a login wall
//   --templates  also read the notes inside each <id>_template.json (what an
//                admin sees after "Open in ComfyUI")
// Exit code 1 when anything is missing or has a dead anchor.
'use strict';
const fs = require('fs');
const path = require('path');

const WF = path.resolve(__dirname, '..', '..', 'workflows');
const argv = process.argv.slice(2);
const opt = (name) => { const i = argv.indexOf(name); return i > -1 ? argv[i + 1] : null; };
const JSON_OUT = opt('--json');
const ONLY = opt('--only');
const TEMPLATES = argv.includes('--templates');
const MARK_GATED = argv.includes('--mark-gated');
const { execFileSync } = require('child_process');
const CONCURRENCY = 6;
const TIMEOUT_MS = 25000;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const URL_RX = /https?:\/\/[^\s"'<>)\]]+/g;

/** url -> [{ bundle, where }] — every place a link appears in a meta. */
function collect() {
    const uses = new Map();
    const walk = (v, where, bundle) => {
        if (typeof v === 'string') {
            for (const raw of v.match(URL_RX) || []) {
                const u = raw.replace(/[.,;:]+$/, '');
                if (ONLY && !u.includes(ONLY)) continue;
                if (!uses.has(u)) uses.set(u, []);
                uses.get(u).push({ bundle, where });
            }
        } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${where}[${i}]`, bundle));
        else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, where ? `${where}.${k}` : k, bundle);
    };
    for (const id of fs.readdirSync(WF).sort()) {
        if (id.startsWith('_')) continue;
        const p = path.join(WF, id, `${id}.meta.json`);
        if (!fs.existsSync(p)) continue;
        walk(JSON.parse(fs.readFileSync(p, 'utf8')), '', id);
        if (!TEMPLATES) continue;
        const t = path.join(WF, id, `${id}_template.json`);
        if (!fs.existsSync(t)) continue;
        const g = JSON.parse(fs.readFileSync(t, 'utf8'));
        const notes = [...(g.nodes || []), ...((g.definitions?.subgraphs || []).flatMap(sg => sg.nodes || []))]
            .filter(n => /note/i.test(n.type || ''));
        notes.forEach((n, i) => walk(n.widgets_values, `template note ${n.id}`, id));
    }
    return uses;
}

const isHfFile = (u) => /^https:\/\/huggingface\.co\/.+\/(resolve|blob)\//.test(u);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/** Read at most `limit` bytes of a response body (pages can be large). */
async function readSome(res, limit = 600000) {
    if (!res.body) return '';
    const reader = res.body.getReader();
    const chunks = []; let n = 0;
    try {
        while (n < limit) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value); n += value.length;
        }
    } finally { try { await reader.cancel(); } catch { /* ignore */ } }
    return Buffer.concat(chunks.map(c => Buffer.from(c))).toString('utf8');
}

const SOFT_404 = /<title[^>]*>[^<]*(404|not found|page not found|doesn.t exist|does not exist)[^<]*<\/title>/i;

function anchorPresent(html, frag) {
    if (!frag) return true;
    const f = decodeURIComponent(frag).toLowerCase();
    const esc = f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // id/name attributes, GitHub's rendered-markdown prefix, and the heading
    // text itself (sites that build anchors in JavaScript).
    if (new RegExp(`(id|name)=["'](user-content-)?${esc}["']`, 'i').test(html)) return true;
    const words = f.replace(/[-_]+/g, ' ').trim();
    return words.length > 3 && html.toLowerCase().replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').includes(words);
}

async function check(url) {
    const [base, frag] = url.split('#');
    const head = isHfFile(base);
    for (let attempt = 0; attempt < 3; attempt++) {
        let res;
        try {
            res = await fetch(base, {
                method: head ? 'HEAD' : 'GET', redirect: 'follow',
                headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml,*/*' },
                signal: AbortSignal.timeout(TIMEOUT_MS),
            });
        } catch (e) {
            // Some sites (ltx.io) send more header bytes than Node's HTTP parser
            // accepts. That is the client's limit, not a dead page: ask curl,
            // which ships with Windows 10+, macOS and every Linux.
            if (String(e.cause?.code) === 'UND_ERR_HEADERS_OVERFLOW') return curlCheck(base);
            if (attempt < 2) { await sleep(3000); continue; }
            return { kind: 'error', status: e.name === 'TimeoutError' ? 'timeout' : String(e.cause?.code || e.message).slice(0, 60) };
        }
        const finalUrl = res.url;
        const hf = /huggingface\.co/.test(base);
        if (res.status === 429) { if (attempt < 2) { await sleep(20000); continue; } return { kind: 'blocked', status: 429 }; }
        if (res.status === 401 || (res.status === 403 && hf)) return { kind: 'gated', status: res.status };
        if (res.status === 403) return { kind: 'blocked', status: 403 };
        if (res.status === 404 || res.status === 410) return { kind: 'missing', status: res.status };
        if (!res.ok) return { kind: 'error', status: res.status };
        let body = '';
        if (!head && /html/.test(res.headers.get('content-type') || '')) body = await readSome(res);
        else { try { await res.body?.cancel(); } catch { /* ignore */ } }
        if (body && SOFT_404.test(body)) return { kind: 'missing', status: `${res.status} (page says not found)`, finalUrl };
        if (frag && body && !anchorPresent(body, frag)) return { kind: 'anchor', status: res.status, finalUrl, frag };
        const norm = (u) => u.replace(/\/+$/, '').replace(/^http:/, 'https:');
        // HF file links redirect to the CDN by design; that is not a move.
        if (!head && norm(finalUrl) !== norm(base)) return { kind: 'moved', status: res.status, finalUrl };
        return { kind: 'ok', status: res.status };
    }
    return { kind: 'error', status: 'retries' };
}

function curlCheck(url) {
    try {
        const out = execFileSync('curl', ['-s', '-L', '-o', process.platform === 'win32' ? 'NUL' : '/dev/null',
            '-w', '%{http_code} %{url_effective}', '-A', UA, '--max-time', String(TIMEOUT_MS / 1000), url], { encoding: 'utf8' });
        const [code, finalUrl] = out.trim().split(' ');
        const status = Number(code);
        if (status === 404 || status === 410) return { kind: 'missing', status };
        if (status >= 200 && status < 300) return finalUrl && finalUrl.replace(/\/+$/, '') !== url.replace(/\/+$/, '')
            ? { kind: 'moved', status, finalUrl } : { kind: 'ok', status, via: 'curl' };
        return { kind: 'error', status };
    } catch (e) {
        return { kind: 'error', status: `curl: ${String(e.message).slice(0, 50)}` };
    }
}

/** Write gated: true / drop it on every model entry whose url or source was checked. */
function markGated(results) {
    let changed = 0;
    for (const id of fs.readdirSync(WF).sort()) {
        if (id.startsWith('_')) continue;
        const p = path.join(WF, id, `${id}.meta.json`);
        if (!fs.existsSync(p)) continue;
        const raw = fs.readFileSync(p, 'utf8');
        const meta = JSON.parse(raw);
        let touched = false;
        for (const m of meta.requirements?.models || []) {
            const r = results.get(m.url) || results.get(m.source);
            if (!r || r.kind === 'error' || r.kind === 'blocked') continue;   // concludes nothing
            const gated = results.get(m.url)?.kind === 'gated';
            if (gated && m.gated !== true) { m.gated = true; touched = true; }
            if (!gated && 'gated' in m) { delete m.gated; touched = true; }
        }
        if (touched) {
            // Keep the file's own line endings and trailing newline.
            const eol = raw.includes('\r\n') ? '\r\n' : '\n';
            const tail = /\r?\n$/.test(raw) ? eol : '';
            fs.writeFileSync(p, JSON.stringify(meta, null, 2).replace(/\n/g, eol) + tail);
            changed++;
        }
    }
    console.log(`--mark-gated: ${changed} meta file(s) updated`);
}

async function main() {
    const uses = collect();
    const urls = [...uses.keys()];
    console.log(`${urls.length} distinct links in the cards — checking…`);
    const results = new Map();
    let i = 0;
    await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
        while (i < urls.length) {
            const u = urls[i++];
            results.set(u, await check(u));
        }
    }));
    const order = ['missing', 'anchor', 'error', 'blocked', 'moved', 'gated', 'ok'];
    const rows = urls.map(u => ({ url: u, ...results.get(u), uses: uses.get(u) }))
        .sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || a.url.localeCompare(b.url));
    const count = {};
    for (const r of rows) count[r.kind] = (count[r.kind] || 0) + 1;
    for (const r of rows) {
        if (r.kind === 'ok' || r.kind === 'gated') continue;
        const where = [...new Set(r.uses.map(x => `${x.bundle} ${x.where.replace(/\[\d+\]/g, '')}`))];
        console.log(`\n${r.kind.toUpperCase()} ${r.status}  ${r.url}`);
        if (r.finalUrl && r.finalUrl !== r.url) console.log(`  → ${r.finalUrl}`);
        if (r.frag) console.log(`  #${r.frag} is not on the page`);
        for (const w of where.slice(0, 6)) console.log(`  in ${w}`);
        if (where.length > 6) console.log(`  … and ${where.length - 6} more`);
    }
    console.log(`\n${Object.entries(count).map(([k, n]) => `${n} ${k}`).join(' · ')}`);
    if (MARK_GATED) markGated(results);
    if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify({ checkedAt: new Date().toISOString(), count, rows }, null, 1));
    process.exit((count.missing || 0) + (count.anchor || 0) > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(2); });
