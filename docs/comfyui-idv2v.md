# ID-V2V — ComfyQ-side notes

[ID-V2V](https://github.com/Eyeline-Labs/ID-V2V) (Eyeline Labs / Netflix, SIGGRAPH Asia 2026)
restyles a video from a **single stylized keyframe** while preserving the characters' identity,
expression and motion.

## ★ The blocker is gone: PR #15139 merged, and no patch is needed any more

**Verified 2026-10-07 on this rig.** ComfyUI merged
[PR #15139](https://github.com/comfyanonymous/ComfyUI/pull/15139) as commit **`5c4d2568`,
2026-09-27, "Support ID-V2V (#15139)"**, so the support is **upstream** from ComfyUI **v0.39.x**
onward. The install here is a clean checkout at tag `v0.39.1` — `git status --porcelain` on all
four formerly-patched files is empty — and `vace_image_input`, `context_vace` and
`ref_pad_image` are all present in the committed tree.

So **ID-V2V now runs on a stock ComfyUI**, and everything below that treats the patch as a
standing requirement is history. What changed in consequence:

- The two bundles — [video_edit_wan_idv2v_restyle_compare](../workflows/video_edit_wan_idv2v_restyle_compare/)
  and [video_edit_wan_idv2v_restyle_hires](../workflows/video_edit_wan_idv2v_restyle_hires/) —
  **exist and work.** The 2026-10-07 library sweep ran both clean: 81 frames at 24 fps,
  960×640 in 88 s and 960×960 in 188 s, which matches the estimates below almost exactly.
- The **`requires-idv2v-patch` tag has been removed from both metas.** Any rig on ComfyUI
  ≥ 0.39.x can serve them with nothing applied to its install.
- ⚠ **`_maintenance`'s ID-V2V repair step is now aimed at code that already contains the fix.**
  It re-applies the change as anchored text edits, so an anchor that now matches upstream code
  could double-apply or fail — the design is "fail loudly rather than half-patch", which is the
  behaviour to confirm before trusting it. (It is inert on this rig for an unrelated reason: it
  still resolves its paths from the `_maintenance` folder that moved into this repo.)

★ **How this was found, and why it had gone unnoticed:** nobody re-read this doc after the
September ComfyUI upgrade. The library sweep ran both bundles, both passed, and asking *why*
they passed is what turned up the merge. A doc that states an external blocker needs a date and
a way to re-check it — this one had the re-check command (`gh api …/pulls/15139`) and nobody ran
it for ten days.

> **Operational notes still live with the rig:** `<drive>\_maintenance\integrations\idv2v.md`
> records what is installed, the example workflows, measured timings and the
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
kept as a record of what was carried locally between 2026-09-14 and the upstream merge. **It
must not be applied to ComfyUI >= 0.39.x, which already contains it.** It is **reference only** —
`_maintenance\repair_all.py` re-applies the fix as anchored text edits (verified byte-identical
to `git apply` of this patch) rather than by applying the file, so that a moved anchor fails
loudly instead of half-patching.

Re-cut it from the PR if ComfyUI ever drifts too far for the anchors:

```bash
gh api repos/comfyanonymous/ComfyUI/pulls/15139 -H "Accept: application/vnd.github.v3.diff" \
  > docs/comfyui-patches/comfyui-idv2v-pr15139.patch
```
