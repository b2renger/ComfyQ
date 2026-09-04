// workflowResolver — maps the short workflow names people write in a
// storyboard ("ltx_2_3_i2v", "stable_audio_3") onto the registry's real
// bundle ids ("video_ltx2_3_i2v", "audio_stable_audio_3_medium").
//
// Storyboards are written by hand, often before the bundle exists or on a
// different machine, so demanding the exact folder name would make the format
// brittle for no benefit. Matching is deterministic and refuses to guess: an
// alias that matches more than one bundle is an error naming the candidates,
// never a coin flip.

// Lowercase, drop everything that isn't a letter or digit. "ltx_2_3_i2v" and
// "video_ltx2_3_i2v" both collapse toward "ltx23i2v" / "videoltx23i2v", so a
// substring test lines them up without a hand-written alias table.
function normalize(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Build the lookup once per resolve() call so registry edits (a bundle added
// while the server runs) are always reflected.
// Two lists: the bundles that can actually run (what a match must come from)
// and every bundle on disk (only used to explain a miss). Matching against the
// full set would let one broken bundle turn a previously-fine alias into a
// false "ambiguous" error.
function buildIndex(registry) {
    const usable = registry.summaries({ includeUnavailable: false, includeHidden: false }).map(s => s.id);
    const all = registry.summaries({ includeUnavailable: true, includeHidden: true }).map(s => s.id);
    const entries = usable.map(id => ({ id, norm: normalize(id) }));
    entries.all = all.map(id => ({ id, norm: normalize(id) }));
    return entries;
}

// Resolve one alias. Returns { id } or throws with a message naming what went
// wrong and what is available.
//
// Match order (first tier that produces exactly one candidate wins):
//   1. exact bundle id
//   2. exact normalized id            ("ltx2_3_i2v" vs "ltx2-3-i2v")
//   3. bundle id CONTAINS the alias   ("ltx23i2v" ⊂ "videoltx23i2v")
//   4. alias CONTAINS the bundle id   (a storyboard that over-qualifies)
function resolveWorkflowAlias(alias, registry, index = null) {
    const idx = index || buildIndex(registry);
    const raw = String(alias || '').trim();
    if (!raw) throw new Error('empty workflow name');
    const norm = normalize(raw);

    const tiers = [
        idx.filter(e => e.id === raw),
        idx.filter(e => e.norm === norm),
        idx.filter(e => e.norm.includes(norm)),
        idx.filter(e => norm.includes(e.norm))
    ];
    for (const hits of tiers) {
        if (hits.length === 1) return { id: hits[0].id };
        if (hits.length > 1) {
            throw new Error(
                `"${raw}" matches ${hits.length} workflows (${hits.map(h => h.id).join(', ')}) — ` +
                'use the full bundle id.'
            );
        }
    }
    // Nothing usable matched. If a BROKEN bundle would have, say so — that is
    // a far more useful message than "not installed".
    const broken = (idx.all || []).filter(e => e.norm.includes(norm) || norm.includes(e.norm))
        .filter(e => !idx.some(u => u.id === e.id));
    if (broken.length) {
        throw new Error(`workflow "${raw}" matches ${broken.map(b => b.id).join(', ')}, which ` +
            `${broken.length === 1 ? 'is' : 'are'} installed but unavailable — fix the bundle first.`);
    }
    throw new Error(`no workflow named "${raw}" is installed on this machine.`);
}

module.exports = { resolveWorkflowAlias, normalize, buildIndex };
