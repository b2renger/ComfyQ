# Which workflows overlap — a pruning worksheet

63 bundles, surveyed 2026-09-23. This lists the places where two or more bundles do
**the same job for a student**, with what you'd gain and lose by cutting one. It is a
worksheet, not a plan: nothing here has been deleted or changed.

Two things to keep in mind while reading:

- **Most durations are measured, most VRAM figures are not.** Only 22 of 63 bundles have
  a measured VRAM peak, and the static estimate under-reports on half the library (see
  CLAUDE.md, 2026-09-22). Where a row below has no VRAM number, the comparison is on
  capability and speed only.
- **"Redundant" here means redundant *to a student*.** Two bundles that load different
  models but present the same form and produce the same kind of result are redundant in
  the classroom even though they differ technically.

---

## 1. SeedVR2 upscalers — 4 bundles doing 2 jobs

The clearest overlap in the library. Each job exists twice, once on the fp16 weights and
once on an int8 build.

| | image upscale | video upscale |
|---|---|---|
| fp16 | `utility_seedvr2_4k_upscale` — 63 s, 8.63 GB, 3 params | `utility_seedvr2_hd_upscale` — 117 s, 10.09 GB, 3 params |
| int8 | `utility_seedvr2_7b_int8_image_upscale` — 25 s, 4 params | `utility_seedvr2_3b_int8_video_upscale` — 62 s, 12.64 GB, 8 params |

**The int8 ones are both faster and more capable.** 2.5× and 1.9× faster respectively, and
they expose an upscale *factor* rather than a target resolution, plus colour correction,
and (video) clip trimming and chunked processing for long or OOM-prone clips.

- **Pro of keeping only int8:** two fewer bundles, faster, more control.
- **Con:** `utility_seedvr2_7b_int8_image_upscale` declares `fp16_accumulation`
  incompatible — that flag makes it save **black images**. Serving it forces ComfyUI to
  relaunch without the rig-wide speed-up, and it can't be calibrated while another
  workflow is being served. The fp16 image bundle has no such constraint.
- **Con:** the fp16 pair's "target resolution in pixels" is easier to explain to a
  beginner than "upscale factor".

**Suggestion:** keep the int8 pair, cut the fp16 pair — unless the perf-flag constraint
on the 7B int8 build proves annoying in practice, in which case keep
`utility_seedvr2_4k_upscale` as the safe image one.

---

## 2. Variant pairs that only exist because optional inputs didn't

These were built as separate bundles because a media input was either always-there or
absent. `whenEmpty: "unlink"` (2026-09-21) removed that constraint — an empty slot now
leaves the graph entirely. **Each pair below could become one bundle with an optional
input**, which is exactly what was just done to the FastVideo i2v.

| pair | difference | models |
|---|---|---|
| `image_edit_bernini_r_image_editing` / `…_with_reference` | a reference image | **identical set** |
| `video_edit_bernini_r_video_editing` / `…_with_reference` | a reference image | identical apart from the autoprompt's encoder |
| `image_edit_flux2_klein_inpaint_prompt` / `…_inpaint_reference` | a reference image | same Klein stack |
| `image_edit_flux2_klein_9b_image_edit` / `…_image_edit_ref` | a reference image | same three files |

- **Pro of merging:** halves four entries to two; a student sees one card and decides
  whether to add a reference, instead of guessing which of two cards they want.
- **Con:** merging means re-testing each graph in both states, and the reference path
  usually costs time (Bernini video: 294 s without, 834 s with) — one card would hide a
  3× cost difference behind an optional upload.
- **Con:** the task dropdowns differ. Bernini's `CustomCombo` offers a different subset of
  tasks with and without a reference, so a merged bundle needs its options gated.

**Suggestion:** worth doing for the two Klein pairs (cheap, fast, same options). Treat
Bernini as a second step — the cost asymmetry and the task list make it a real change,
not a rename.

---

## 3. Control-type trios — 6 bundles, 2 jobs

`video_edit_ltx2_5_iclora_{canny,pose,union}` (75/83/82 s) and
`video_edit_minimax_h3_fun_controlnet_{canny,depth,union}` (139/157/188 s).

Within each trio the graph is the same and only the **annotator** differs — 7 of 10 models
shared in the LTX trio, 6 of 9 in the MiniMax trio.

- **Pro of merging into one bundle with a "control type" dropdown:** four fewer cards.
  ComfyUI's switch inputs are lazy, so only the selected annotator's model loads — the
  VRAM cost would not go up.
- **Con:** this is real graph surgery on six bundles, and the annotators have genuinely
  different needs (the pose one needs the TorchScript detector, and its resolution trap is
  documented in CLAUDE.md). A dropdown that silently picks a slow path is worse than three
  honest cards.
- **Con:** the canny bundle's description carries a style warning (claymation works, a
  watercolour prompt stays photographic) that doesn't apply to the other two.

**Suggestion:** leave as-is unless the card count is the problem. The per-annotator
descriptions are doing useful teaching work.

---

## 4. Three engines for text-to-video-with-sound

`video_minimax_h3_t2v_turbo` (27 s, 29.01 GB) · `video_fastvideo_fasth3_t2v` (46 s,
27.02 GB) · `video_ltx2_5_t2v` (48 s).

All three take a prompt and return a clip with audio. No models shared between them.

- The two H3 ones differ only in **which distillation** runs: a 4-step turbo LoRA on the
  base checkpoint vs FastVideo's 8-step checkpoint. The turbo one is currently *faster*
  (27 s vs 46 s).
- LTX 2.5 is a different model family with a different look and its own prompt guide.

**Suggestion:** LTX stays — different family, different results. The two H3 t2v bundles
are the real duplicate; keep whichever produces better clips at your resolution, and note
that the comparison has never been made side by side. Same argument applies to
`video_minimax_h3_i2v_4step` vs `video_fastvideo_fasth3_i2v`.

**Also:** `video_fastvideo_fasth3_t2v` is now strictly contained by
`video_fastvideo_fasth3_i2v`, which does text-to-video when you give it no frames. It is
kept only because it shows a student no upload fields at all.

---

## 5. Camera-angle pairs

`image_edit_qwen_multiple_character_angles` (2511, 39 GB bf16 UNET, 10 s) and
`image_edit_qwen_multiple_scene_angles` (2509, 20 GB fp8, 4 s). Same job — re-photograph
the subject from a described angle — on two different model generations.

- **Pro of keeping both:** 2511 is the better model; 2509 is less than half the weights and
  runs on cards where 2511 streams from RAM.
- **Con:** two nearly identical cards whose names suggest a character/scene distinction
  that isn't real — *both* take any picture. The naming is misleading today.

**Suggestion:** keep both, but rename so the difference (model generation / size) is what
the names say. Or merge into one with a model dropdown.

---

## 6. Wan ID-V2V restyle — compare vs hires

`video_edit_wan_idv2v_restyle_compare` (85 s) and `…_hires` (175 s) —
**identical model set**, one produces a side-by-side comparison, one a higher-res result.

- **Pro of cutting `compare`:** the comparison view is a development aid, not a student
  deliverable.
- **Con:** both still need the unmerged ComfyUI PR #15139 patch (`requires-idv2v-patch`),
  so neither is usable on a stock rig — check whether either belongs in the library at all
  before deciding between them.

---

## 6b. Qwen 2.1 base vs Viggle Turbo — a speed/quality pair, not a duplicate

`image_qwen_image_2_1_t2i` (25 steps, 14 s) and `image_qwen_image_2_1_viggle_turbo`
(12 steps, 7 s) run the **same model and the same graph**; the turbo one adds a distilled
LoRA. Identical VRAM (14.44 GB).

- **Pro of keeping both:** the turbo is about 2x faster at a comparable result, and excellent
  on single subjects at 4-6 steps — but it GHOSTS (overlapping transparent copies) below
  ~12 steps on prompts with several objects, and Viggle's own notes call it a preview that falls short on multi-reference
  composition, face swaps and long rendered text. Iterate on the turbo, finish on the base.
- **Con:** two cards for one model is exactly the kind of choice a student shouldn't have
  to make. A single bundle with a "Fast / Quality" checkbox driving a `ComfySwitchNode`
  (model base↔LoRA, steps 25↔12) is the pattern the Flux.2 and MiniMax bundles already use.

**Suggestion:** merge them behind a Fast-mode toggle once the turbo has been eyeballed on
real classroom prompts. Until then keeping both is the honest arrangement.

## 7. Not redundant, despite looking it

Worth stating so they don't get cut by accident:

- **The six `t2i` generators** (Flux2 Dev, Flux2 Klein, Ideogram 4, Krea 2 + LoRA, Krea 2
  style reference, Qwen 2.1) are different *looks*, not different implementations of one
  look. Ideogram 4 is the only one that does reliable text-in-image; Krea 2 carries the
  style-LoRA library; Qwen 2.1 is the cheapest at 14.44 GB.
- **The two Gemma captioners** take different inputs (image vs video) — one graph can't do
  both, the video one feeds every decoded frame to the VLM.
- **The five 3D bundles** produce genuinely different artefacts (Gaussian splat vs mesh vs
  textured mesh vs multi-view sheet).
- **The three LTX 2.3 leftovers** (`ia2v_iclora`, `ic_lora_ingredients`, `3dreal_vid2vid`)
  have no LTX 2.5 equivalent — they are not the retired 2.3 generation bundles.

---

## Summary

| Action | Bundles | Confidence |
|---|---|---|
| Cut the fp16 SeedVR2 pair | 2 | high — same job, slower, fewer features |
| Merge the two Klein reference pairs | −2 | high — same models, same options |
| Decide between the two H3 t2v, and the two H3 i2v | −2 | medium — needs a side-by-side first |
| Merge the Bernini ± reference pairs | −2 | medium — cost asymmetry, task lists differ |
| Rename or merge the Qwen angle pair | 0 or −1 | medium — naming is the real problem |
| Drop `…restyle_compare` | −1 | low — both need an unmerged patch anyway |
| Collapse the two control trios | −4 | low — real surgery, descriptions are useful |

Cutting only the high-confidence rows takes **63 → 59**. Everything else is a judgement
call about how many cards a student should be choosing between.

## Before cutting anything

- **7 bundles have never produced a checked result** (the `experimental` flag):
  `video_fastvideo_fasth3_i2v`, `video_fastvideo_fasth3_t2v`, `image_qwen_image_2_1_t2i`,
  `image_qwen_image_2_1_image_edit`, `image_krea2_turbo_style_reference`,
  `utility_marigold_v2_depth`, `utility_marigold_v2_normals`. A bundle that has never been
  run is not evidence of anything — validate before comparing it with something.
- **41 have no measured VRAM.** If the reason for cutting is fitting two models on one
  card, measure first: the static estimate was wrong by more than 1 GB on half the
  bundles measured so far, usually in the optimistic direction.
