# ID-V2V — ComfyQ-side notes

[ID-V2V](https://github.com/Eyeline-Labs/ID-V2V) (Eyeline Labs / Netflix, SIGGRAPH Asia 2026)
restyles a video from a **single stylized keyframe** while preserving the characters' identity,
expression and motion. It is installed and verified on the workshop rig.

> ## The operational documentation lives with the rig
>
> **`<drive>\_maintenance\integrations\idv2v.md`** — what is installed, the ComfyUI core patch
> and how to re-apply it after an update, the example workflows, measured timings, and the
> resolution/aspect-ratio trap.
>
> That is the authoritative copy: the patch applies to the ComfyUI install on that drive, and
> `_maintenance\REPAIR.bat` is what re-applies it. This file only keeps the parts that are
> about **ComfyQ** rather than about the rig, so the two cannot drift.

---

## Why it is not a ComfyQ bundle

ID-V2V is a **VACE control stack on a Wan 2.1 I2V base**, which stock ComfyUI cannot load — its
VACE path assumes a T2V base. Support comes from
[ComfyUI PR #15139](https://github.com/comfyanonymous/ComfyUI/pull/15139) (Kijai), which is
**open, not merged**. On the workshop rig it is applied as a local 4-file, +17/−4 line patch.

**A ComfyQ bundle assumes a stock ComfyUI.** Shipping one would mean every rig that serves it
needs that patch applied and re-applied after every ComfyUI update — so this waits for the PR
to merge upstream. Until then the example workflows live in ComfyUI's own Workflows sidebar
(`<comfy root>\user\default\workflows\idv2v_*.json`), not in `workflows/_candidate_workflows/`.

Check whether the blocker still stands:

```bash
gh api repos/comfyanonymous/ComfyUI/pulls/15139 --jq '{state,merged}'
```

## What the bundle would look like, when that day comes

- **Category `video-edit`** — it modifies a video the user supplies (the taxonomy rule: i2v is
  generation, this is an edit).
- **Two media inputs + a prompt**, mirroring
  [video_edit_bernini_r_video_editing_with_reference](../workflows/video_edit_bernini_r_video_editing_with_reference/):
  source video (`VHS_LoadVideo`) + stylized keyframe (`LoadImage`), which feeds `start_image`,
  `ref_pad_image` **and** `CLIPVisionEncode`.
- **`minVRAM` 24** — a 20 GB transformer plus the text encoder on a 32 GB card.
- **Calibration is cache-immune** — `SamplerCustom` carries a literal `noise_seed`, so
  `_randomizeSeeds` defeats ComfyUI's result cache.
- **Exposed params** would be: source video, stylized keyframe, prompt, width, height, seed.
  Width/height are already real `PrimitiveInt` nodes (not the frontend-only `PrimitiveNode`),
  so the graph survives an API-format export and one param drives every consumer.
- **`estimatedDurationSec`** ≈ 90 at 640×640 / 81 frames, ≈ 190 at 960×960 (measured on a 5090).
- ⚠ **The meta must warn about aspect ratio.** The resize nodes crop, so a resolution that does
  not match the source video's aspect both reframes the subject and measurably weakens the
  style transfer. A bundle would need width/height presets, or to derive them from the source.

## The patch, as a version-controlled record

[comfyui-patches/comfyui-idv2v-pr15139.patch](comfyui-patches/comfyui-idv2v-pr15139.patch) is
kept here because this repo is backed up by git and the drive is not. It is **reference only** —
`_maintenance\repair_all.py` re-applies the fix as anchored text edits (verified byte-identical
to `git apply` of this patch) rather than by applying the file, so that a moved anchor fails
loudly instead of half-patching.

Re-cut it from the PR if ComfyUI ever drifts too far for the anchors:

```bash
gh api repos/comfyanonymous/ComfyUI/pulls/15139 -H "Accept: application/vnd.github.v3.diff" \
  > docs/comfyui-patches/comfyui-idv2v-pr15139.patch
```
