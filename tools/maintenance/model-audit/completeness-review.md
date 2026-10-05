# Completeness review

Produced by the audit's final critic pass: what the model-by-model analysis missed.
Every figure here was measured on disk, not estimated.

## ALSO CONSIDER — verified gaps in the storage audit

### 1. A complete, verified 636 GB backup of these models already exists on two other drives — the audit never looked

- `D:\comfyq_iso_build\ComfyUI_windows_portable` — **652.3 GB**, 99,988 files (staging tree)
- `E:\comfyq_iso\ComfyQ_ComfyUI_portable.iso` — **647.0 GB** single file, with `.sha256` beside it
- Built **2026-07-10**, per `E:\comfyq_iso\BUILD-INFO.txt`: *"the 4 large weight buckets (checkpoints, diffusion_models, text_encoders, loras) were trimmed to only ComfyQ-referenced models (~900 GB of unused weights dropped); every other models subfolder kept whole"*, verified by a 4-agent audit + RTX 5090 boot smoke-test + UDF mount check.

I diffed its `models\` tree against J: file-by-file:

| | GB | files |
|---|---|---|
| J: models | 1852.98 | 754 |
| ISO-build models | 636.42 | 549 |
| **In both** (identical sizes, 0 mismatches) | **636.42** | 549 |
| Only on J: | 1216.56 | 205 |
| Only in ISO | 0.00 | 0 |

**It is a strict subset with zero size mismatches.** Two consequences the audit's risk language doesn't reflect:

- **636.42 GB of J: is already backed up twice.** Every DELETE inside that set is restorable by file-copy from `D:\comfyq_iso_build`, no re-download, no HuggingFace licence gate. That directly defuses the audit's stated worries about `flux1-dev` (gated), `stable-audio-open-1.0` (gated), and the un-sourceable `int8_convrot` line — **check `D:\comfyq_iso_build\...\models\` before writing "unknown — check before deleting".**
- **An independent prior curation already answered this question.** Splitting only-on-J by mtime against the build date:
  - **863.79 GB / 145 files** pre-date 2026-07-10 and were **actively dropped** by that curation → strong second opinion corroborating the audit's DELETE calls.
  - **352.77 GB / 60 files** were added *after* the build → **absence from the ISO proves nothing** about them. This covers the entire MiniMax H3 family (`minimax_h3_fl2va_bf16` 61.73 GB, 2026-09-08), `ltx-2.5-*`, `wan_animate_2*`, `SCAIL_2 int8`, `Krea2_Turbo_convrot`, the `pixal3d/trellis_2 int8` pair.

Two scope caveats before treating "dropped by curation" as a delete order: it was scoped to **ComfyQ production only** (so `demo`- and `a_tester`-justified models were dropped *by design* — this is why `flux1-dev` 22.17 GB was dropped despite the audit's correct KEEP for the ASASR demo), and only those **4 buckets** were curated (`vae/`, `clip_vision/`, `controlnet/`, `audio_encoders/` were kept whole, so ISO membership is *not* evidence for the 15.72 GB of vae_clip_controlnet "refuted" items).

**Independent validation the audit earned:** checkpoints — audit KEEP **64.9 GB** vs curation KEEP **64.86 GB** (`ltx-2.3-22b-distilled-fp8`, `ltx-2.3-22b-dev-fp8`, `stable_audio_3_medium`, `sam3.1_multiplex_fp16`). Exact agreement, arrived at independently. Also corroborated: `ltx-2.3-22b-dev.safetensors` (42.98 GB) and every diffusion_models/text_encoders/loras/checkpoints item on the refuted lists was dropped by the curation too.

**Separate reclaim:** `D:\comfyq_iso_build` (652.3 GB) is the staging tree the ISO was *built from*. With the ISO and its SHA256 on E:, that staging copy is redundant — **~652 GB free on D:** (currently 863.6 used / 2862.4 free).

### 2. There is nothing to reclaim outside `models\` — measured, definitively

The audit didn't check; I did, and the answer is a clean negative worth recording so nobody re-opens it:

| Path | GB |
|---|---|
| `ComfyUI\models` | 1852.98 |
| `python_embeded` | 14.25 |
| `ComfyUI\input` | 1.53 |
| `ComfyUI\custom_nodes` (all 46 packs) | 1.32 |
| `ComfyUI\comfyq_ingredients` (512 job folders) | 0.74 |
| `__pycache__` (5,296 dirs, 37,131 files, whole tree) | 0.56 |
| `ComfyUI\output` (67 files) | 0.23 |
| all `.git` in tree | 0.10 |
| `ComfyUI\user` / `ComfyUI\temp` | 0.03 / 0.00 |

J: is 1873.5 GB used / **34.2 GB free**; the portable install is 1871.21 GB of it. **99.0% of the drive is `models\`.** No `output_backup` exists. HuggingFace cache is `C:\Users\ateliernum\.cache\huggingface` = **0.00 GB** (13 files) and `HF_HOME`/`HUGGINGFACE_HUB_CACHE`/`TORCH_HOME` are all unset — no hidden cache on J:. pip cache is 2.40 GB on C:.

Coverage cross-check: I diffed all 754 files on disk against the 388 inventory units — **everything is grouped** except 1.13 GB of `.crdownload` junk (already flagged) and zero-byte `put_X_here` placeholders. No ungrouped model category exists. Inventory has no stale entries (0 units missing from disk).

### 3. Hash-verified duplicates — 15.20 GB, of which ~3.6 GB is new

I size-grouped every file >20 MB and head/mid/tail-SHA256'd each candidate. **11 true duplicate sets, 15.196 GB redundant.** New ones the audit missed:

- `Pixal3D/TencentARC_Pixal3D/ckpts/shape_dec_next_dc_f16c32_fp16.safetensors` = `TencentARC/Pixal3D-T/ckpts/…` = `microsoft/TRELLIS.2-4B/ckpts/…` — **1.767 GB redundant** (3 copies)
- `Pixal3D/…/tex_dec_next_dc_f16c32_fp16.safetensors` = `microsoft/TRELLIS.2-4B/ckpts/…` — **0.883 GB**
- `Pixal3D/…/ss_dec_conv3d_16l8_fp16.safetensors` ×3 incl. `microsoft/TRELLIS-image-large/` — **0.275 GB**
- `SEEDVR2/ema_vae_fp16.safetensors` = `vae/seedvr2_ema_vae_fp16.safetensors` — **0.467 GB**
- `FlashVSR/Wan2.1_VAE.safetensors` = `vae/wan_2.1_vae.safetensors` — **0.236 GB** (the `vae/` copy is production; the FlashVSR copy dies with that pack anyway)

The Trellis2/Pixal3D cross-pack set generalises the audit's dinov3 finding: **2.93 GB across three packs that hardcode different paths to the same weights** — same hardlink/junction remedy, same "do not plain-delete either" caveat.

Confirmed-negative (same size, **different** content — do not treat as dupes): `qwen_image_layered` vs `_control` (38.06 each), `qwen_image_fp8` vs `qwen_image_edit_fp8` (19.03), `minimax_h3_fl2va` vs `ref2va_pruned` (19.53), `wan_animate_2` vs `_distill` (15.51), `flux-2-klein-4b` vs `base-4b` (7.22), **`ltx-2.3-22b-distilled-lora-384` vs `-384-1.1` (7.08 — identical size, different content, so the loras group's "redundant" call rests on the rank-111 argument, not on duplication)**, and all three LivePortrait human-vs-`animal/` pairs.

### 4. ACE-Step: three auditors each justified deletion by the existence of the others' copy

Nothing anywhere references any of it, but the rationales are circular — diffusion_models says delete `acestep_v1.5_turbo` *because `ace_step_1.5_turbo_aio` exists*; checkpoints says delete the aio *because the split parts exist*. Acting on both silently destroys the capability while each note promises it survives. **Full footprint, measured: 42.55 GB across four groups** — `checkpoints/ace_step_1.5_turbo_aio` 9.34 + `checkpoints/ace_step_v1_3.5b` 7.17 + `checkpoints/qwen_4b_ace15` 7.80 + `checkpoints/qwen_0.6b_ace15` 1.11 + `text_encoders/qwen_4b_ace15` 7.80 + `text_encoders/qwen_1.7b_ace15` 3.45 + `text_encoders/qwen_0.6b_ace15` 1.11 + `diffusion_models/acestep_v1.5_turbo` 4.46 + `vae/ace_1.5_vae` 0.31. Make it **one decision worth 42.55 GB**, not four.

### 5. The 12 DELETE pack verdicts free 0.032 GB — they are gates, not space

All 46 packs total 1.32 GB. The twelve DELETE verdicts sum to **0.032 GB**. Their value is entirely that they gate **26.53 GB of models**: `flashface/` 9.83, `FlashVSR/` 12.05, `moebius/` 3.53, `RMBG/` 0.82, `sam2/` 0.30. Two problems:

- **`ComfyUI_moebius_inpainting` is verdict KEEP but `used_by: []`, while repo_folders recommends deleting its 3.53 GB of models.** Keeping the pack with its weights gone leaves a broken node; the two verdicts must agree.
- Deleting `comfyui-easy-use` and `comfyui-rmbg` removes the **auto-refetch** safety net the loras and small_misc groups relied on when calling ip-adapter-faceid LoRAs and `u2net.onnx` "free to delete, comes back by itself". For 0.014 GB, keep those two packs and delete only their weights.
- `comfyui-florence2` DELETE orphans nothing — I confirmed **zero Florence models exist** anywhere under `models\` (`microsoft\` holds only TRELLIS.2-4B 16.50 GB + TRELLIS-image-large 0.14 GB).

### 6. 63.34 GB sitting in `C:\Users\ateliernum\Downloads`, half of it an aborted duplicate

- `Minimax-h3_Singularity_ref2va_v1.3_int8.safetensors` — **31.67 GB**, dated **2026-09-11 (today)**
- `Non confirmé 405339.crdownload` — **31.67 GB**, same date — an **aborted Chrome duplicate of that same download**. Zero-risk delete.

Worth surfacing to the owner: the diffusion_models group recommends deleting `Minimax-h3_Singularity_ref2va_Pruned_v1.3_int8.safetensors` (19.53 GB, also dated 2026-09-11) as an unreferenced third-party fine-tune, while the **non-pruned 31.67 GB sibling of that same model is being downloaded right now**. That is an active intent signal contradicting the DELETE, and it should be confirmed before either file is touched. (The audit's `.crdownload` sweep advice was right but scoped to `models\controlnet` — extend it to `Downloads`, where it is worth 27× more.)

### 7. Reconciliation, so the owner can size the outcome

Audit confident-DELETE across all 7 groups ≈ **716.7 GB** → J: goes from 34.2 GB free to **~751 GB free**. The July curation says the true ComfyQ-production floor is **636.42 GB of models**; J: currently holds 1852.98 GB. The gap between the audit's answer and the curation's is almost entirely the 352.77 GB added since 2026-07-10 — which is real, current work (MiniMax H3, LTX 2.5, Wan-Animate 2, SCAIL-2) and should **not** be judged by the ISO.

**Operational note, not a reclaim:** `ComfyUI\input` holds 484 `comfyq_session__*` files (0.50 GB, oldest 2026-05-03) which `sweepStale()` never deletes by design, plus 1.03 GB of manual files back to 2025-06-05; `comfyq_ingredients` is 512 job folders / 0.74 GB since 2026-07-02. Both grow without bound. At 2.27 GB combined they are not worth acting on now, but they have no retention policy at all.
