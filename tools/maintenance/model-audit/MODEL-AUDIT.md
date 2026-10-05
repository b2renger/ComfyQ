# Model & custom-node audit — what can go, and what it buys

**Audited 2026-09-11. Nothing has been deleted.** This is a decision sheet plus the tooling
to act on it once you have reviewed it.

---

## The numbers

`J:` is **1874 GB used, 34 GB free**. The ComfyUI portable install is 1871 GB of that, and
**99% of it is `models\`** — 1853 GB across 388 model units. Everything else (custom nodes,
Python, outputs, caches, `.git`, `__pycache__`) adds up to under 19 GB, measured. There is no
hidden win outside `models\`.

Every model was cross-referenced against **all 222 workflows** in your four collections, and
against the custom-node source (which is how auto-downloaded models get referenced without
ever appearing in a workflow).

| Verdict | Units | Size | Restorable from the D: backup |
|---|---:|---:|---:|
| **DELETE** — nothing references it, safe | 54 | **309.9 GB** | 73.4 GB |
| **REVIEW** — your call, a real capability | 166 | 773.4 GB | 123.1 GB |
| **KEEP** — in use, or a dependency | 168 | 768.6 GB | 437.7 GB |

Acting on DELETE alone takes `J:` from **34 GB free to ~344 GB free**. The REVIEW pool is
where the rest of the space is, but each one costs you a capability.

Four more reclaims the model pass would have missed, all measured:

| | Size | Where |
|---|---:|---|
| `D:\comfyq_iso_build` — staging tree, redundant now the ISO exists on E: | **652 GB** | D: |
| Aborted Chrome download + its completed twin | **63.3 GB** | `C:\Users\ateliernum\Downloads` |
| Hash-verified duplicate weights (11 sets) | **15.2 GB** | J: `models\` |
| 12 unused custom-node packs | 0.03 GB | J: (but they *gate* 26.5 GB of models) |

---

## How to use this (and re-use it later)

Everything lives in `_maintenance\model-audit\`:

| File | What it is |
|---|---|
| **`model-audit.csv`** | The decision sheet — one row per model, semicolon-delimited, opens in Excel |
| `custom-nodes-audit.csv` | Same for the 43 custom-node packs |
| **`prune-models.ps1`** | Acts on the CSV. Dry-run by default; quarantine, then purge |
| `completeness-review.md` | What the model-by-model pass missed, with measured figures |
| `rescan.py` | Rebuilds the inventory from scratch — re-run it any time to refresh |

### The workflow

1. **Open `model-audit.csv`.** Sort by `gb` descending. The columns that matter:
   `verdict` (the audit's call), `reason` (why), `backup` (is it already on D:),
   `redownload` (where to get it again), `referenced_by` (which collections use it).
2. **Put `DELETE` in the `ACTION` column** for what you actually want gone. The `ACTION`
   column is yours — the audit never writes to it.
3. **Dry run**, which changes nothing:
   ```powershell
   cd <drive>:\ComfyUI_windows_portable_nvidia\_maintenance\model-audit
   .\prune-models.ps1                 # acts on your ACTION column
   .\prune-models.ps1 -UseVerdict     # or trust the audit's own DELETE verdicts
   ```
4. **Quarantine** — stop ComfyUI first, then `.\prune-models.ps1 -Execute`. This *moves* the
   files to `<drive>\_model_quarantine\`. On the same volume a move is a rename: instant even for
   300 GB, and fully reversible. **It does not free space yet.**
5. **Verify.** Start ComfyUI, run the workflows you care about.
6. **Then** `.\prune-models.ps1 -Purge` (frees the space, asks you to type PURGE) or
   `.\prune-models.ps1 -Restore` (puts everything back in seconds).

Quarantine-then-purge exists because a wrong call here costs a multi-GB re-download — and for
some of these files, one that is no longer possible.

---

## How it was measured

A model counts as **used** if its filename appears in any of the 222 workflow JSONs, **or** in
custom-node source code. That second rule matters: a node that auto-downloads a model names it
in Python and never in a workflow, so a filename-only scan would call it unused and you would
lose it on the next run.

Workflow collections, weighted differently:

| | Files | Weight |
|---|---:|---|
| `<drive>\ComfyQ\workflows` | 143 | **Production** — bundles served to students |
| `ComfyUI\user\default\workflows` | 45 | ComfyUI's own Workflows sidebar — staged test workflows |
| `<drive>\ComfyQ\workflows\_candidate_workflows` | 22 | **Staged for testing** — protected, see below |
| `<drive>\_demo_workflows` | 12 | Demo/teaching |

All 222 parsed cleanly; zero unreadable.

⚠ **The staging folder moved (2026-09-11).** The audit originally scanned
`%USERPROFILE%\Downloads\workflows_a_tester` — a folder on `C:`, which meant the audit's
answer depended on which machine the drive was plugged into. Those 22 workflows now live in
`ComfyQ\workflows\_candidate_workflows` and nothing off this drive is scanned. They are
**not** production, but they are deliberately kept for later testing and possible promotion
into ComfyQ, so **their models must not be pruned** — 14 models / 63.5 GB are held by nothing
else. In the editor, filter `used_by` on `candidate:` to see them; in the CSV they are the
rows whose `used_by` names only candidate workflows.

⚠ The **first pass missed ComfyUI's own staged workflows**, and that scored three models as
unused which a staged workflow actually loads (`da3_base`, `depth_anything_v2_vits_fp16`,
`rotate_20_epochs`). `rescan.py` now covers all four; those verdicts are corrected.

### Two measurement traps

Both would have corrupted the result, and both will bite anyone repeating this:

- **`comfyui-manager\model-list.json` is a download catalogue, not evidence of use.** It names
  thousands of downloadable models. Matching against it marked ~210 GB "in use" that nothing
  actually references.
- **Unused packs ship example workflows.** `ComfyUI-WanVideoWrapper`, `ComfyUI-OrbitSheets`,
  `WhatDreamsCost-ComfyUI` and others bundle their own `example_workflows\`, which were the
  *only* reference for another ~85 GB. Those examples are not your workflows.

Node attribution needed the same care: `comfyui-workflow-encrypt` re-registers the node table,
so ComfyUI's own `/object_info` blames it for 1010 nodes belonging to kjnodes, VHS and
Trellis2. Attribution here combines the server's view (reliable for core) with a reverse grep
of every pack (for everything the hijack stole).

A second trap, found later: **most ComfyQ templates are subgraph workflows**, and their real
nodes live under `definitions.subgraphs[].nodes[]`. Reading only the top-level `nodes` array
made whole packs look unused. Across all 222 workflows there are **378** node types in use;
after the fix, 4 remain unattributed (they are genuinely missing dependencies, listed below)
and 1 is ambiguous.

### Every deletion was adversarially verified

The first pass proposed **~730 GB** of deletions. A second agent then tried to *refute* each
one — grepping the collections, the node source, and ComfyQ's bundle metadata — and every
proposed deletion over 15 GB got a third, independent opinion that was not told why it had
been proposed.

**62 deletions were overturned, rescuing 420 GB from deletion.** The 309.9 GB that survived is
what every pass agreed on. Examples of what the challenge caught:

- `minimax_h3_fl2va_bf16` (61.7 GB) — looked like a redundant non-pruned copy. The RAVEN pack's
  loader **rejects** the pruned variant (no `time_embedder` for its 266-module adapter), so the
  19.5 GB copy on disk cannot substitute for it.
- `sd_xl_base_1.0`, `t5-base`, `sigclip_vision_patch14_384`, `openai-clip-vit-large-14` —
  companion encoders/VAEs that nothing references *directly* but that kept models need.
- `wan2.1_vace_14B_fp16` (32.3 GB) and the whole wan2.2 Fun family (100 GB) — demoted to
  REVIEW because they are capabilities with no substitute on the rig, not dead weight.

---

## Biggest confirmed deletions

| GB | Model | Why |
|---:|---|---|
| 30.5 | `wan2.1_14B_SCAIL_2_fp16` | superseded by the `int8_convrot` copy your workflow actually loads |
| 23.5 | `ltx-2.3-22b-distilled-1.1_transformer_only_fp8_scaled` | production LTX loads from `checkpoints\`; the 1.1 gain is already on disk as a LoRA |
| 22.7 | `gemma_3_12B_it` | superseded by the fp4/int8 encoders the LTX bundles use |
| 19.0 | `qwen_image_fp8_e4m3fn` | pre-2509 Qwen; production uses 2509 + 2511 |
| 19.0 | `qwen_image_edit_fp8_e4m3fn` | same |
| 17.1 | `Wan2_2-Animate-14B_fp8_e4m3fn_scaled_KJ` | WanVideoWrapper-only; no workflow of yours uses that pack |
| 15.8 | `Wan2_1-I2V-14B-480P_fp8_e4m3fn` | same |
| 15.4 | `qwen_2.5_vl_7b` | the `_fp8_scaled` copy is the one in use |
| 13.7 | `LTX-2.3-distilled-Q3_K_M.gguf` | GGUF quantisation, no GGUF workflow — and it is on the D: backup |
| 13.5 | `flux2_dev_Q3_K_M.gguf` | same |
| 24.2 | 3 × `sd3.5_large_controlnet_*` | no SD3.5 workflow at all; all three on the D: backup |

Full list in the CSV, with a re-download source for each.

## Biggest REVIEW decisions (yours to make)

| GB | Model | The trade |
|---:|---|---|
| 76.1 | `qwen_image_layered` + `_control` | layered/PSD-style image generation. Nothing uses it yet — a deliberate download you never built on |
| 100.4 | wan2.2 **Fun** family (8 files) | control + inpaint are covered by LTX IC-LoRA and the Bernini-R bundles; **camera-motion control has no substitute** (28.5 GB of the 100) |
| 83.3 | `ltx-2.3-22b-dev` (43.0) + `ltx-2-19b-distilled` (40.3) | older LTX generations; production runs 2.3-distilled and 2.5 |
| 42.6 | **ACE-Step, all of it** | see the warning below — one decision, not four |
| 32.3 | `wan2.1_vace_14B_fp16` | a generation behind; video editing runs on Wan 2.2 Bernini-R |
| 15.3 | `wan2.2_s2v_14B` | audio-driven talking avatar. Lost its only substitute when the LTX ID-LoRA bundle was deleted in June |

---

## ⚠ Four things to read before deleting anything

### 1. A verified 636 GB backup already exists — check it first
`D:\comfyq_iso_build\` (652 GB for the whole staging tree; its `...\ComfyUI\models` subtree is
636.42 GB / 549 files) and `E:\comfyq_iso\...iso` (647 GB, with a `.sha256`) were built
2026-07-10. Diffed file by file: **636.42 GB / 549 files are a
strict subset of J: with zero size mismatches.**

So before writing "unknown — check before deleting" on anything, look in `D:\comfyq_iso_build`.
The `backup` column in the CSV tells you per row.

⚠ **It is a curated subset, not a mirror.** The four big weight buckets were trimmed to
ComfyQ-referenced models only, so some things are **not** in it — verified absent:
`flux1-dev.safetensors` and `stable-audio-open-1.0.safetensors`, both licence-gated on
HuggingFace and therefore the *most* painful to re-obtain. Never assume; check the column.

**Caveat:** that curation was scoped to *ComfyQ production only*. Only the four big weight
buckets (checkpoints, diffusion_models, text_encoders, loras) were **trimmed** to referenced
models; every other `models\` subfolder was kept whole. Absence from the ISO is therefore
**not** evidence against a model — especially the **352.8 GB added after 2026-07-10** (MiniMax H3,
LTX 2.5, Wan-Animate 2, SCAIL-2), which is current work the ISO predates.

**Separate win:** with the ISO and its checksum on E:, the 652 GB staging tree on D: is
redundant. That is the single largest reclaim available, and it costs nothing.

### 2. ACE-Step: one decision worth 42.6 GB, not four
Three different analysis passes each justified deleting their copy *because one of the others
existed*: "delete the DiT, the all-in-one covers it" / "delete the all-in-one, the split parts
cover it". Acting on both silently destroys the capability while each note promises it
survives.

⚠ As the sheet stands the rows are **split** — 17.8 GB carries DELETE and 24.7 GB REVIEW — so
acting on the DELETE rows alone is exactly the mistake described here. Decide the whole set at
once. The full footprint is **42.55 GB across four folders** — `checkpoints\ace_step_1.5_turbo_aio`
9.34 + `ace_step_v1_3.5b` 7.17 + `qwen_4b_ace15` 7.80 + `qwen_0.6b_ace15` 1.11,
`text_encoders\qwen_4b_ace15` 7.80 + `qwen_1.7b_ace15` 3.45 + `qwen_0.6b_ace15` 1.11,
`diffusion_models\acestep_v1.5_turbo` 4.46, `vae\ace_1.5_vae` 0.31. Nothing references any of
it. Decide **all of it or none of it**.

### 3. You are downloading a MiniMax H3 variant right now
`C:\Users\ateliernum\Downloads` holds `Minimax-h3_Singularity_ref2va_v1.3_int8.safetensors`
(31.67 GB, dated today) **and** `Non confirmé 405339.crdownload` (31.67 GB, same date) — an
aborted Chrome duplicate of that same download. The `.crdownload` is a zero-risk delete.

The sheet already agrees the pruned sibling stays: `Minimax-h3_Singularity_ref2va_Pruned_v1.3_int8`
(19.5 GB) was proposed for deletion as an unreferenced third-party fine-tune and then overturned
— its row reads **KEEP**. Worth knowing the reasoning, since you are actively fetching the
non-pruned version of the same model.

### 4. Deleting a pack can orphan its models — and vice versa
The 12 pack deletions free **0.03 GB**. Their real value is that they gate **26.5 GB of
models** (`flashface` 9.8, `FlashVSR` 12.1, `moebius` 3.5, `RMBG` 0.8, `sam2` 0.3). Two
inconsistencies to resolve before acting:

- `ComfyUI_moebius_inpainting` is marked KEEP, but its weights are split three ways across the
  5 rows in `models/moebius/` (3.52 GB total): `ft_celebahq` 0.84 DELETE, `ft_ffhq` 0.84 KEEP,
  `ft_places2` 0.84 + `pretrained` 0.84 + `vae` 0.16 REVIEW. Only 0.84 GB is actually doomed,
  and the pack keeps working — but decide the pack and its weights together.
- Keep `comfyui-easy-use` and `comfyui-rmbg` (0.014 GB). Several "safe to delete, it
  re-downloads itself" calls depend on exactly those packs being present to re-fetch.

---

## Custom nodes

43 packs, 1.32 GB total — **not a space story**. 17 provide no node any of your 222 workflows
uses (81 MB between them); 10 are recommended for removal, 3 for review, 30 to keep.

Keep regardless of the "unused" flag, because they provide no nodes *by design*:
`comfyui-manager` (the pack manager), `comfyq_opener` (ComfyQ reinstalls it every launch),
`ComfyUI-CrossDriveViewFix` (the cross-drive preview fix this drive depends on).

The largest genuinely unused pack is `ComfyUI-WanVideoWrapper` (53.1 MB). Removing it is what
makes its 65 GB of Kijai-format Wan models safe to delete — **but** a rendered
`VID_WanMove_00001_.mp4` sits in `_demo_workflows`, so you did run WanMove from its example
once. If you want that back, keep the pack and that one model.

⚠ **`ComfyUI-LTXVideo` (71.8 MB) is NOT unused** — an earlier pass said it was. Its
`LTXVGemmaCLIPModelLoader` and 7 other nodes are used by production ComfyQ bundles, but only
from *inside subgraph definitions*, which the first scan did not descend into. `rescan_nodes.py`
now does. Keep it.

Details per pack in `custom-nodes-audit.csv`.

---

## Duplicates worth fixing (15.2 GB)

Hash-verified (head/mid/tail SHA-256), 11 true duplicate sets:

- `qwen_4b_ace15` and `qwen_0.6b_ace15` exist in **both** `checkpoints\` and `text_encoders\` —
  8.9 GB of exact duplication (and part of the ACE-Step decision above).
- Pixal3D / TRELLIS2 / TencentARC hardcode different paths to the **same** shape/texture decoder
  weights — 2.9 GB across three packs.
- `SEEDVR2\ema_vae_fp16` = `vae\seedvr2_ema_vae_fp16` (0.47 GB);
  `FlashVSR\Wan2.1_VAE` = `vae\wan_2.1_vae` (0.24 GB).

For the cross-pack ones, a hardlink is the right fix rather than deleting either copy — each
pack looks for it at its own path.

**Confirmed NOT duplicates** despite identical sizes, so do not "deduplicate" them:
`qwen_image_layered` vs `_control`, `qwen_image_fp8` vs `qwen_image_edit_fp8`,
`minimax_h3_fl2va` vs `ref2va_pruned`, `wan_animate_2` vs `_distill`,
`ltx-2.3-22b-distilled-lora-384` vs `-384-1.1`.

---

## Housekeeping with no retention policy

Not worth acting on now, but they grow without bound and nothing ever trims them:
`ComfyUI\input` holds 484 `comfyq_session__*` uploads (0.50 GB, oldest 2026-05-03) that
`sweepStale()` deliberately never touches, plus 1.03 GB of manual files back to 2025-06-05.
`comfyq_ingredients` is 512 job folders (0.74 GB) since 2026-07-02.
