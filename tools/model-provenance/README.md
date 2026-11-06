# model-provenance — where every model comes from

Fills `requirements.models[].url` / `.source` across every bundle, so a rig that
is missing a weight can be told **where to get it** rather than just that it is
missing.

```bash
# see what would change: it lists every field it would rewrite, card by card
node tools/model-provenance/harvest.cjs
# write it
node tools/model-provenance/harvest.cjs --write
# exit 1 if anything would change (nothing is written)
node tools/model-provenance/harvest.cjs --check
# with the model audit's hand-curated column as an extra source
MODEL_AUDIT_CSV=tools/maintenance/model-audit/model-audit.csv \
  node tools/model-provenance/harvest.cjs --write

# check every link still resolves, and drop the dead ones
node tools/model-provenance/verify.cjs
node tools/model-provenance/verify.cjs --fix

# check every card link the way a browser sees it; mark login-walled downloads gated
node tools/card-links/check.cjs --mark-gated
```

Run `harvest.cjs` after adding a bundle. `test:storyboard` fails when a bundle
declares a model with no `url`, `source` or `auto`, so this is not optional.
It also runs `harvest.cjs --check`, so a link fixed by hand in a meta without an
`override` in `known-sources.json` fails the tests. The test does not set
`MODEL_AUDIT_CSV`, so run that variant yourself (see below).

★ **Read the dry run's list before passing `--write`.** A link fixed by hand in a
meta is put back to the note's link by the next `--write` unless
`known-sources.json` carries the fix as an `override`. This has happened: the
2026-11-04 link corrections (the FLUX VAE, the PiD weights, the LTX 2.5 upscaler,
the refcontrol LoRA) were made in the metas only, and a `--write` would have
undone all of them on 17 cards. So when you correct a link in a meta, copy it into
`known-sources.json` with `"override": true`, then check that the dry run lists
nothing (`--check` exits 0). Run that check with `MODEL_AUDIT_CSV` set as well:
the audit's `redownload` column fills in a `source` the notes do not give, so it
can put an old repo back over one corrected by hand in a meta.

## Where the links come from

**The workflows already carried them.** ComfyUI's own templates document their
models in `Note` / `MarkdownNote` nodes, and most of those links are
`/resolve/main/<subfolder>/<file>` — a direct download *with* its destination
folder.

★ **The index is pooled across all bundles, keyed by filename.** Per bundle the
notes cover about 68% of declared models; pooled it is about **84%** (289 of 343
entries on 2026-11-05; the harvest prints the current figure), because a shared
weight like `flux-2-klein-9b-fp8` only needs *one* bundle to document it.
Harvesting per bundle leaves a sixth of the library unsourced for no reason.

Order of preference: a note's link → the audit CSV's `redownload` column →
`known-sources.json` → an `override` in that file, which wins over everything.

⚠ The pooled index keeps the **first** link it finds for a filename, in folder
order. A note in one bundle therefore speaks for every bundle that uses the same
file: the TripoSplat template links its own copy of `flux2-vae.safetensors`, and
its folder sorts first, so without an override every FLUX.2 / FLUX.3 / Ideogram
card would be sent to the TripoSplat repo.

## The two fields, and why they are not one

| field | meaning |
|---|---|
| `url` | a **direct, fetchable file**. A download can be offered. |
| `source` | a **page for a human**, when only the repo is known. |
| `auto` | a node pack or pipeline fetches this itself. Never report it missing; never offer to download it. |
| `note` | why it is like that, in a sentence someone can act on. |
| `gated` | the direct link answered 401/403 from HuggingFace: a licence must be accepted and a token set. Set and cleared by `node tools/card-links/check.cjs --mark-gated`; `harvest.cjs` and `verify.cjs` leave it alone. The card labels that download "(login)". |

**Never invent a `url`.** A wrong direct link downloads the wrong weights
silently. One constructed-by-analogy link in the first pass 404'd and was caught
only by `verify.cjs`; it is now `source`-only with a note saying so.

## What verification can and cannot tell you

`verify.cjs` HEAD-checks every link. The classification is the useful part:

- **ok** — the file is there.
- **gated (401/403)** — the *repo* exists and needs an accepted licence plus a
  token. ★ It does **not** confirm the path: HuggingFace answers 401 for *any*
  path inside a gated repo, so a wrong filename there looks exactly like a right
  one. 12 links were in this state on 2026-11-05 (black-forest-labs FLUX.2 Klein
  and FLUX.3 Klein, Lightricks LTX-2.5); the metas mark them `"gated": true`.
- **missing (404)** — wrong. `--fix` drops it and records it in
  `dead-links.json`, which `harvest.cjs` then refuses to re-add — otherwise the
  two tools fight, verify dropping a link and harvest restoring it from the same
  bad note.
- **limited (429)** — HuggingFace rate-limits partway through a full run (about
  180 links on 2026-11-05). The run backs off 30 s and retries those;
  still-limited links change nothing.
- **error** — concludes nothing, so nothing is changed.

★ **A note can be wrong, and a gated repo hides it.** The LTX deblur template
points its pixel-spatial-upscaler adapter at `LTX-2.3-22b-IC-LoRA-Deblur`, which
does not hold it — and because that repo is gated the bad link answers 401 and
reads as healthy. That is what `override` in `known-sources.json` is for;
verification alone cannot catch it.

## known-sources.json

Hand-curated gap-filling, read after the notes and the audit, plus the
`override` entries that correct a wrong note or keep a link fixed by hand.
`_`-prefixed keys (and `_why` inside an entry) are documentation. Files whose
origin genuinely is not recorded are **left out on purpose** so the harvest keeps
reporting them, and they are named in `bundleCompleteness.test.js` so the gap is
visible rather than forgotten. On 2026-11-05 none is left out: the harvest
reports 0 unsourced.

## exclusive.cjs — what can be deleted

Two questions, one engine (`server/workflows/modelUsage.js`, shared with the
admin panel's **Maintenance → Prune unused models** card, so the command line and
the UI can never disagree about what is unused):

```bash
# what would deleting these bundles release, and what is shared with ones that stay?
node tools/model-provenance/exclusive.cjs <bundle-id> [<bundle-id>…]

# what does nothing on this disk reference at all?
node tools/model-provenance/exclusive.cjs --unused
```

★ **Never read a bundle's `requirements.models` as "its own" models.** Marigold
declared the 19 GB Qwen-Image-Edit UNET because it is *built on* it, and that file
serves a production bundle. Taken literally, "remove the models for Marigold and
Viggle" would have deleted 35 GB that four live bundles need.

A file counts as **used** when any of these holds, and each class has caught a
real near-miss:

| class | why it protects |
|---|---|
| a bundle's `api.json` | the obvious case |
| a bundle's `_template.json` | "Open in ComfyUI" hands the **template** to an admin, so a weight only it loads is still in use — this is what protects a 42.98 GB checkpoint here |
| a weight a bundle declares in `requirements.models` | declared means used, even when the graph resolves it internally (being declared does not make it that bundle's own: see the ★ above) |
| a `lora` dropdown | it offers every file in its folder that matches its `optionsFilter` prefix, or the whole folder when it has no filter, so those appear in no graph at all (14 `krea2_*` LoRAs) |
| a select option or a default in a bundle's form, or a default in its `config.meta.json` override | the booking form can send it, so no graph needs to name it |
| a candidate / demo / ComfyUI-user workflow | not something ComfyQ serves, but somebody's work — only while its folder is switched on (Maintenance → Prune unused models → Folders scanned for workflows) |
| the code of an installed node pack | the pack builds the path itself or names the file in its Python, so no graph mentions it (LivePortrait's weights); a file inside `custom_nodes/` belongs to its pack |
| a file inside a HuggingFace repo folder a bundle stages | the bundle declares the repo (`microsoft/TRELLIS.2-4B`), not the files, so every file under that folder counts as used by it |
| an observed load by ComfyUI | ComfyQ's access log saw ComfyUI open it. Released only when a removed workflow named the file and nothing has opened it since that removal |

★ **A filename-shaped string is not a load.** The LTX 2.5 templates mention
`ltx-2.3-22b-dev.safetensors` eighteen times, every one of them a cloud-API model
name typed into a `GemmaAPITextEncode` widget. Such a file is **kept** — the safe
direction — but reported separately as *worth a look*. The classifier uses a
**named list** of such node classes, not a heuristic: guessing "a loader has
Loader in its name" wrongly flagged `DWPreprocessor`, `RIFE VFI` and
`ASASRApplyConditioning`, all of which really do take a model through a dropdown.

**Scanning less makes models look deletable.** Besides the bundles, the folders
scanned are three built-in ones — the candidate workflows, ComfyUI's own saved
workflows and the parallel lanes' saved workflows — plus any listed in
`maintenance.workflowScanDirs` in `config.json`. Every folder except the bundles
can be switched off (`maintenance.scanDirsOff`). A switched-off folder is still
read, but what it names protects nothing: such a model carries an
`excluded-folder` reason and is capped at *worth a look*, never the confident
tier. The prune card names every folder it checked and warns about any it could
not read. Pruning runs through
`POST /admin/models/prune`, which re-derives usage server-side and refuses
anything it does not independently judge unused — a page left open while a
workflow was added cannot talk it into removing something now needed. It also
refuses low-confidence rows, and everything when a scanned folder could not be
read, unless that risk is acknowledged on purpose.

A prune **moves** each file into a dated batch under the quarantine folder
(`_model_quarantine` at the root of the install's drive, unless
`maintenance.quarantineDir` names another folder); the **Quarantined models**
card moves it back until the batch is emptied. What moves is logged, one line
per file, to `server/data/pruned-models.jsonl`.
