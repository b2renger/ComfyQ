# model-provenance — where every model comes from

Fills `requirements.models[].url` / `.source` across every bundle, so a rig that
is missing a weight can be told **where to get it** rather than just that it is
missing.

```bash
# see what would change
node tools/model-provenance/harvest.cjs
# write it
node tools/model-provenance/harvest.cjs --write
# with the model audit's hand-curated column as an extra source
MODEL_AUDIT_CSV=<...>/_maintenance/model-audit/model-audit.csv \
  node tools/model-provenance/harvest.cjs --write

# check every link still resolves, and drop the dead ones
node tools/model-provenance/verify.cjs
node tools/model-provenance/verify.cjs --fix
```

Run `harvest.cjs` after adding a bundle. `test:storyboard` fails when a bundle
declares a model with no `url`, `source` or `auto`, so this is not optional.

## Where the links come from

**The workflows already carried them.** ComfyUI's own templates document their
models in `Note` / `MarkdownNote` nodes, and most of those links are
`/resolve/main/<subfolder>/<file>` — a direct download *with* its destination
folder.

★ **The index is pooled across all bundles, keyed by filename.** Per bundle the
notes cover about 68% of declared models; pooled it is **86%**, because a shared
weight like `flux-2-klein-9b-fp8` only needs *one* bundle to document it.
Harvesting per bundle leaves a sixth of the library unsourced for no reason.

Order of preference: a note's link → the audit CSV's `redownload` column →
`known-sources.json` → an `override` in that file, which wins over everything.

## The two fields, and why they are not one

| field | meaning |
|---|---|
| `url` | a **direct, fetchable file**. A download can be offered. |
| `source` | a **page for a human**, when only the repo is known. |
| `auto` | a node pack or pipeline fetches this itself. Never report it missing; never offer to download it. |
| `note` | why it is like that, in a sentence someone can act on. |

**Never invent a `url`.** A wrong direct link downloads the wrong weights
silently. One constructed-by-analogy link in the first pass 404'd and was caught
only by `verify.cjs`; it is now `source`-only with a note saying so.

## What verification can and cannot tell you

`verify.cjs` HEAD-checks every link. The classification is the useful part:

- **ok** — the file is there.
- **gated (401/403)** — the *repo* exists and needs an accepted licence plus a
  token. ★ It does **not** confirm the path: HuggingFace answers 401 for *any*
  path inside a gated repo, so a wrong filename there looks exactly like a right
  one. 8 links are in this state (black-forest-labs FLUX.2, Lightricks LTX-2.5).
- **missing (404)** — wrong. `--fix` drops it and records it in
  `dead-links.json`, which `harvest.cjs` then refuses to re-add — otherwise the
  two tools fight, verify dropping a link and harvest restoring it from the same
  bad note.
- **limited (429)** — HuggingFace rate-limits partway through ~140 requests. The
  run backs off 30 s and retries those; still-limited links change nothing.
- **error** — concludes nothing, so nothing is changed.

★ **A note can be wrong, and a gated repo hides it.** The LTX deblur template
points its pixel-spatial-upscaler adapter at `LTX-2.3-22b-IC-LoRA-Deblur`, which
does not hold it — and because that repo is gated the bad link answers 401 and
reads as healthy. That is what `override` in `known-sources.json` is for;
verification alone cannot catch it.

## known-sources.json

Hand-curated gap-filling, read after the notes and the audit. `_`-prefixed keys
are documentation. Files whose origin genuinely is not recorded are **left out
on purpose** so the harvest keeps reporting them, and they are named in
`bundleCompleteness.test.js` so the gap is visible rather than forgotten.
