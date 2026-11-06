# ID-V2V — ComfyQ-side notes

[ID-V2V](https://github.com/Eyeline-Labs/ID-V2V) (Eyeline Labs / Netflix, SIGGRAPH Asia 2026)
restyles a video from a **single stylized keyframe** while preserving the characters' identity,
expression and motion.

## ★ The blocker is gone: PR #15139 merged, and no patch is needed any more

**Verified 2026-10-07 on this rig.** ComfyUI merged
[PR #15139](https://github.com/comfyanonymous/ComfyUI/pull/15139) as commit **`5c4d2568`,
2026-09-27, "Support ID-V2V (#15139)"**, so the support is **upstream** from ComfyUI **v0.38.0**
onward — the first tagged release that contains the commit (v0.37.4 does not). On 2026-10-07 the
install here was a clean checkout at tag `v0.39.1`; it is now `v0.43.2` (re-checked 2026-11-05),
and `git status --porcelain` on all four formerly-patched files (`comfy/ldm/wan/model.py`,
`comfy/model_detection.py`, `comfy/supported_models.py`, `comfy_extras/nodes_wan.py`) is still
empty. `vace_image_input`, `context_vace` and `ref_pad_image` are all present in the committed
tree.

So **ID-V2V now runs on a stock ComfyUI**, and everything below that treats the patch as a
standing requirement is history. What changed in consequence:

- The two bundles — [video_edit_wan_idv2v_restyle_compare](../workflows/video_edit_wan_idv2v_restyle_compare/)
  and [video_edit_wan_idv2v_restyle_hires](../workflows/video_edit_wan_idv2v_restyle_hires/) —
  **exist and work.** The 2026-10-07 library sweep ran both clean: 81 frames at 24 fps,
  960×640 in 88 s and 960×960 in 188 s, which matches the estimates below almost exactly.
- The **`requires-idv2v-patch` tag has been removed from both metas.** Any rig on ComfyUI
  ≥ 0.38.0 can serve them with nothing applied to its install.
- **The ID-V2V step in `tools/maintenance/repair_all.py` is harmless on a ComfyUI that already
  contains the merge.** It checks before it edits: when `ref_pad_image` is in `WanImageToVideo`
  and `vace_image_input` is in the three model files, it reports `[ OK ]` and changes nothing,
  and every edit it could make is guarded by "only if not already there". Its upstream check
  then prints *"ID-V2V is in ComfyUI itself now -- PR #15139 merged upstream. You can delete
  the ID-V2V fix from this script."* (Since 2026-11-05 it finds ComfyUI through ComfyQ's
  config; `REPAIR.bat --check` on this rig reports the ID-V2V item [ OK ] and prints that note.)

★ **How this was found, and why it had gone unnoticed:** nobody re-read this doc after the
September ComfyUI upgrade. The library sweep ran both bundles, both passed, and asking *why*
they passed is what turned up the merge. A doc that states an external blocker needs a date and
a way to re-check it — this one had the re-check command (`gh api …/pulls/15139`) and nobody ran
it for ten days.

> **Operational notes:** [tools/maintenance/integrations/idv2v.md](../tools/maintenance/integrations/idv2v.md)
> (it used to be `<drive>\_maintenance\integrations\idv2v.md`, before that folder moved into this
> repo) records what is installed, the example workflows, measured timings and the
> resolution/aspect-ratio trap. Its patch section is now obsolete for the same reason.

---

## History — why it was not a ComfyQ bundle at first

ID-V2V is a **VACE control stack on a Wan 2.1 I2V base**, which ComfyUI could not load before
the merge — its VACE path assumed a T2V base. Until 2026-09-27 the fix was a local 4-file,
+17/−4 line patch on this rig, and **a ComfyQ bundle assumes a stock ComfyUI**: shipping one
would have meant every rig re-applying a patch after every ComfyUI update. That is why the
example workflows lived in ComfyUI's own Workflows sidebar
(`<comfy root>\user\default\workflows\idv2v_*.json`) rather than in the library. Both bundles
were promoted on 2026-09-14 while the patch was still local, tagged `requires-idv2v-patch`;
that tag is what the merge retired.

The blocker no longer stands — confirmed merged, see the top of this file:

```bash
gh api repos/comfyanonymous/ComfyUI/pulls/15139 --jq '{state,merged}'
```

## What the two bundles look like — as built, and as measured

- **Category `video-edit`** — it modifies a video the user supplies (the taxonomy rule: i2v is
  generation, this is an edit).
- **Two media inputs + a prompt**, mirroring
  [video_edit_bernini_r_video_editing_with_reference](../workflows/video_edit_bernini_r_video_editing_with_reference/):
  source video (`VHS_LoadVideo`) + stylized keyframe (`LoadImage`), which feeds `start_image`,
  `ref_pad_image` **and** `CLIPVisionEncode`.
- **`minVRAM` 24** — a 20 GB transformer plus the text encoder on a 32 GB card.
- **Calibration is cache-immune** — `SamplerCustom` carries a literal `noise_seed`, so
  calibration's fresh seed defeats ComfyUI's result cache.
- **Exposed params** are: source video, stylized keyframe, prompt, width, height, seed.
  Width/height are already real `PrimitiveInt` nodes (not the frontend-only `PrimitiveNode`),
  so the graph survives an API-format export and one param drives every consumer.
- **`estimatedDurationSec`** ≈ 90 at 640×640 / 81 frames, ≈ 190 at 960×960 (measured on a 5090).
- ⚠ **Aspect ratio.** The resize nodes crop, so a size that does not match the source's shape
  reframes the subject and weakens the style transfer. The bundles have no presets and do not
  derive the size from the source. Instead, the description and the Width label tell the student
  to match the video's shape, and the description lists the sizes (960×960 square, 1280×704
  landscape, 704×1280 portrait, or 640×640, 832×480, 480×832 for a faster test).

## The patch, as a version-controlled record

[comfyui-patches/comfyui-idv2v-pr15139.patch](comfyui-patches/comfyui-idv2v-pr15139.patch) is
kept as a record of what was carried locally between 2026-09-14 and the upstream merge. **It
must not be applied to ComfyUI >= 0.38.0, which already contains it.** It is **reference only** —
`tools/maintenance/repair_all.py` re-applies the fix as anchored text edits (verified byte-identical
to `git apply` of this patch) rather than by applying the file, so that a moved anchor fails
loudly instead of half-patching.

Re-cut it from the PR if ComfyUI ever drifts too far for the anchors:

```bash
gh api repos/comfyanonymous/ComfyUI/pulls/15139 -H "Accept: application/vnd.github.v3.diff" \
  > docs/comfyui-patches/comfyui-idv2v-pr15139.patch
```
