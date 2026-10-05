#!/usr/bin/env node
// HEAD-check every requirements.models[].url / .source in the library.
//
// Worth doing rather than trusting the harvest: the links come from notes
// written when a template was published, and a repo can be renamed, a file
// re-pathed, or a model gated after the fact. A committed link that 404s is
// worse than no link, because the download button it feeds looks usable.
//
// Classification matters as much as the check:
//   ok      2xx/3xx -- the file is there
//   gated   401/403 -- the REPO exists and is gated: an accepted licence plus
//                      a token are needed. ★ It does NOT prove this particular
//                      path is right, because HuggingFace answers 401 for any
//                      path inside a gated repo -- a wrong filename in a gated
//                      repo looks identical to a correct one. Never demoted,
//                      but never taken as confirmation either.
//   missing 404     -- wrong. With --fix, a url is dropped (its source is kept)
//                      and a bad source is dropped and reported loudly.
//   error   network/timeout -- concludes nothing, so nothing is changed.
//
// Usage: node verify.cjs [--fix] [--only <substring>]
const fs = require('fs');
const path = require('path');

const WF = path.resolve(__dirname, '..', '..', 'workflows');
const FIX = process.argv.includes('--fix');
const onlyAt = process.argv.indexOf('--only');
const ONLY = onlyAt > -1 ? process.argv[onlyAt + 1] : null;
const CONCURRENCY = 8;
const TIMEOUT_MS = 20000;
// HuggingFace starts answering 429 well before 140 HEADs are done.
const RETRY_WAIT_MS = 30000;

const read = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };

// url -> [{ bundle, file, field }]
const uses = new Map();
const metas = [];
for (const id of fs.readdirSync(WF)) {
    const dir = path.join(WF, id);
    if (id.startsWith('_') || !fs.statSync(dir).isDirectory()) continue;
    const mp = path.join(dir, `${id}.meta.json`);
    const meta = read(mp);
    if (!meta) continue;
    metas.push({ id, mp, meta });
    for (const m of (meta.requirements?.models || [])) {
        for (const field of ['url', 'source']) {
            const u = m[field];
            if (!u) continue;
            if (ONLY && !u.includes(ONLY)) continue;
            if (!uses.has(u)) uses.set(u, []);
            uses.get(u).push({ bundle: id, file: m.file, field });
        }
    }
}

const targets = [...uses.keys()];
console.log(`${targets.length} distinct links across ${metas.length} bundles — checking…\n`);

async function check(url) {
    try {
        // HEAD is enough and downloads nothing; HuggingFace answers /resolve
        // with a redirect to its CDN, which fetch follows.
        const res = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS) });
        const size = res.headers.get('content-length');
        if (res.status === 401 || res.status === 403) return { kind: 'gated', status: res.status };
        if (res.status === 404) return { kind: 'missing', status: 404 };
        if (res.status === 429) return { kind: 'limited', status: 429 };
        if (res.ok) return { kind: 'ok', status: res.status, gb: size ? +(size / 1024 ** 3).toFixed(2) : null };
        return { kind: 'error', status: res.status };
    } catch (e) {
        return { kind: 'error', status: e.name === 'TimeoutError' ? 'timeout' : (e.message || '').slice(0, 60) };
    }
}

async function sweep(urls, results) {
    let i = 0;
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, urls.length) }, async () => {
        while (i < urls.length) {
            const url = urls[i++];
            results.set(url, await check(url));
        }
    }));
}

(async () => {
    const results = new Map();
    await sweep(targets, results);

    // ★ Checking the whole library is ~140 requests, which HuggingFace
    // rate-limits partway through. A 429 concludes nothing, so back off once
    // and ask again rather than reporting a healthy link as broken.
    const limited = [...results].filter(([, r]) => r.kind === 'limited').map(([u]) => u);
    if (limited.length) {
        console.log(`rate-limited on ${limited.length} link(s) — backing off ${RETRY_WAIT_MS / 1000}s and retrying those…\n`);
        await new Promise(r => setTimeout(r, RETRY_WAIT_MS));
        await sweep(limited, results);
    }

    const by = { ok: [], gated: [], missing: [], limited: [], error: [] };
    for (const [url, r] of results) by[r.kind].push([url, r]);

    console.log(`ok        ${by.ok.length}`);
    console.log(`gated     ${by.gated.length}   (gated repo: needs a licence + token; the path is NOT confirmed)`);
    console.log(`missing   ${by.missing.length}`);
    console.log(`limited   ${by.limited.length}   (429 even after a retry — re-run later)`);
    console.log(`error     ${by.error.length}   (inconclusive, nothing changed)`);

    for (const label of ['gated', 'missing', 'limited', 'error']) {
        if (!by[label].length) continue;
        console.log(`\n${label.toUpperCase()}:`);
        for (const [url, r] of by[label]) {
            const u = uses.get(url);
            console.log(`   [${r.status}] ${url}`);
            console.log(`        used by ${u.length} entr${u.length > 1 ? 'ies' : 'y'}, e.g. ${u[0].bundle} / ${u[0].file} (${u[0].field})`);
        }
    }

    if (!FIX) {
        const bad = by.missing.length;
        console.log(`\n${bad ? `pass --fix to drop the ${bad} dead link(s)` : 'nothing to fix'} — read-only run`);
        process.exit(0);
    }

    let dropped = 0, files = 0;
    const deadSet = new Set(by.missing.map(([u]) => u));
    for (const { mp, meta } of metas) {
        let touched = false;
        for (const m of (meta.requirements?.models || [])) {
            for (const field of ['url', 'source']) {
                if (m[field] && deadSet.has(m[field])) {
                    delete m[field];
                    dropped++;
                    touched = true;
                }
            }
        }
        if (touched) { files++; fs.writeFileSync(mp, JSON.stringify(meta, null, 2) + '\n'); }
    }
    // ★ Remember them, or the next harvest re-adds each one from the very note
    // that was wrong in the first place — the two tools would fight for ever.
    if (deadSet.size) {
        const dp = path.join(__dirname, 'dead-links.json');
        const prev = (read(dp) || {}).dead || [];
        const merged = [...new Set([...prev, ...deadSet])].sort();
        fs.writeFileSync(dp, JSON.stringify({
            _README: 'Links proved dead (404) by verify.cjs. harvest.cjs will not re-add these, however they appear in a workflow note. Delete an entry to let it be tried again.',
            dead: merged,
        }, null, 2) + '\n');
        console.log(`recorded ${deadSet.size} dead link(s) in dead-links.json (${merged.length} total)`);
    }
    console.log(`\ndropped ${dropped} dead link(s) from ${files} meta file(s)`);
})();
