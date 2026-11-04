# Which workflows are best — an assessment of the whole library

*Measured 2026-11-03 on AN-5090-2 (RTX 5090, 32 GB), ComfyUI 0.43.2, one run of the
[library test suite](../tools/test-suite/README.md) — 80 bundles — then again on 2026-11-04
with the suite rebuilt as a showcase (one example per card that shows what it is best at;
see [the showcase run](#the-showcase-run-2026-11-04)). Where the second run overturned a
verdict of the first, the table below says so. Companion to
[workflow-redundancy.md](workflow-redundancy.md), which asks which bundles overlap; this
one asks which of them to reach for.*

## How it was judged

- **Speed** — *warm* is the generation time with the models already loaded (what the second
  student in a queue waits); *cold* is the first job after a model change, load included.
  Both come from the suite's own calibration of each bundle at its **default settings**:
  the suite changes prompts and inputs, never steps, sizes or durations.
- **VRAM** — the measured peak. On this 32 GB card, anything above ~27 GB owns the GPU: no
  second lane fits beside it.
- **Quality and accuracy** — every output was opened: pictures as they are and, for the
  upscalers, at 1:1 against the source; videos as frames across the clip plus a check of
  the soundtrack (present, length, level); meshes as point renders from three sides.
  *Accuracy* means the checkable details of the prompt: the three seagulls, the red door,
  the exact title text, a box that must stay where it was drawn, a face that must not change.
- **Like with like.** Cards that do the same job were given **the same prompt and the same
  input pictures** — the four text-to-video engines, the three first/last-frame engines,
  the two reference-to-video engines, Qwen plain vs "fix", MOSS SFT vs base, canny vs
  depth, every video restyle on one source clip. Each verdict below rests on one seed:
  strong enough to spot a failure or a consistent gap, not to rank two good cards that are
  close.

## The short answer

| job | reach for | when speed matters | avoid |
|---|---|---|---|
| photoreal picture from text | **FLUX.2 Klein 9B** — 12 s, 18 GB | **FLUX.3 Klein distilled** — 7 s, 10 GB | Qwen 2.1 *fix* (slower, less accurate than plain) |
| a picture that follows a precise composition | **Qwen-Image 2.1** — 15 s | — | — |
| text, titles, posters | **Ideogram 4** — 20 s | — | — |
| a layout of boxes (where things go) | **MOSS-Image SFT** — 23 s, 11 GB | — | — |
| edit one thing, keep everything else | **FLUX.3 Klein base + a box** — 70 s, 11 GB | **FLUX.2 Klein edit** — 25 s | — (Bernini *with reference* made collages until its Edit-type fix of 2026-11-04; it now swaps the reference in) |
| put something into a picture | **FLUX.2 Klein inpaint** — 3–4 s | — | Qwen 2.1 relight (scale is unreliable) |
| a new picture in a photo's pose | **FLUX.2 Klein ref + depth** — 9 s | — | — |
| a character from other angles | **Qwen 2511 angles** — 6 s | **Krea 2 quadview** — 22 s for four views | — |
| enlarge a picture | **SeedVR2 4K** (detail) / **PiD** (faithful 4×) | **SeedVR2 7B int8** — 20 s | — |
| a 3D model of an object | **Pixal3D/TRELLIS.2** — 116 s | TripoSplat — 36 s (splat) | — |
| video with sound from text | **MiniMax H3 turbo** — 30 s, livelier than FastH3 on the same prompt | — | FastH3 t2v (slower and quieter than turbo) |
| the best-looking video | **Pika H3 Flex** — 768p, 140–160 s | — | — |
| a picture to video | **LTX 2.5** — 51 s, 1280×704 | MiniMax H3 4-step — 35 s | — |
| between a first and a last picture | **LTX 2.5 FLF** — 68 s | FastH3 i2v — 59 s, 480p | — |
| a cast of reference pictures | **FastH3 OmniRef** — 64 s | — | — |
| a face that talks or emotes | **LivePortrait** — 11 s | — | — |
| a seamless loop | either loop card — ~255 s; the FastH3 one holds a reference closer | — | — |
| restyle a video | **LTX 2.5 IC-LoRA** — 130–140 s at up to 1920×1024; depth keeps the whole scene, pose only the moves | — | the H3 Fun-ControlNet cards with a 30 fps clip (they write 24 fps: 25% slower) |
| change one thing in a video | **H3 video reference** (a person) with the trained prompt — ~400 s; **Bernini** (a garment, or an outfit from a photo) — ~380 s, 16 fps | — | — (both returned the source on 2026-11-03; both fixed 2026-11-04) |
| put a new character on a video | **Wan SCAIL-2** — keeps the clip's place, 215 s | LTX 2.5 pose — 123 s | Wan Animate if the place should change: it keeps the PICTURE's background |
| music from a description | **Stable Audio 3** — 6 s for 150 s of music | — | its AI prompt improver, until ComfyUI is fixed |
| describe a picture or a clip | **Gemma 4** — 21–25 s; reads text exactly | — | — |

---

## The showcase run (2026-11-04)

The suite was rebuilt from [research into each model](showcase-research/README.md): instead
of one shared story, every card got the example that shows what it is uniquely good at, with
a caption saying what to look at. Those results are the examples students open from each
card (**See an example**). 80 runs in five stages, **80 of 80 clean, 0 suspect, 2 h 31 min**,
then two re-runs after fixing the suite's own settings.

**How it was checked.** Every picture was opened; every video was compared **frame by
frame with its source at the same instants** (six per clip), its cuts measured against the
times the prompt asked for, its frame rate against the source's, its loop seam against its
own frame steps, and its soundtrack measured (level; for a card that keeps the uploaded
sound, the loudness envelope correlated with the input). **Ten captions said more than the
result shows and were rewritten** before the examples were seeded — a caption is a claim
about the result, not about the model.

**What it proved** (each measured, not just looked at):

| card | what it was shown doing | the evidence |
|---|---|---|
| `video_fastvideo_fasth3_t2v` | a ten-second, three-shot nature film with a narrator | cuts at **4.04 s and 7.46 s**, asked for 4.0 and 7.5 |
| `video_pika_h3_flex_t2v` | a bakery scene, two speakers, a chalkboard | cuts at **2.00 / 3.46 s** (asked 2.0 / 3.5); "CROISSANTS" legible |
| `video_ltx2_3_ia2v_iclora` | a recorded voice driving a portrait | the output's sound IS the upload: envelope correlation **0.91** |
| `video_edit_ltx2_3_3dreal_vid2vid` | a grey blockout render → a ship in a storm | the render's cut at **3.77 s lands at 3.77 s**, at its own 30 fps |
| `video_edit_minimax_h3_loop_restyle` | a depth tunnel → a torch-lit corridor | the loop seam (7.0) is an ordinary frame step (median 6.8) |
| `video_edit_ltx2_5_iclora_union_control` + `…_pose_control` | the same rooftop dance, depth vs pose | depth keeps the whole scene in clay; pose keeps only the moves — the clearest lesson in the library on what each control keeps |
| `video_edit_wan21_scail2_character_replacement` | another dancer on the same rooftop | every move at the same instant, the place untouched |
| `image_edit_flux2_klein_9b_image_edit` | a daytime atrium photo at night | every table, bench and staircase where it was; people removed |
| `utility_ltx2_5_video_deblur_upscale` | the 480p H3 clip → 960p | sharper at the same size, original soundtrack (correlation 0.86) |

**What it overturned from the run before:**

- **The H3 video-reference card works** — it replaced the rooftop dancer with a knight, same rooftop, same camera, same moves — once the prompt was in the form the model was trained on: `<Video 1>` *with* the angle brackets (ComfyUI writes `"<Video 1>: "` before the clip's tokens), `[video editing]`, "The target video is an edited version of <Video 1>.", and `removed` / `partially_preserved` / `attribute_transfer`. On 2026-11-03 it returned its source unchanged. That prompt is now the card's default.
- **Both Bernini *with reference* cards make their edit**: the taxi became the reference's car; the dancer wears the reference photo's jacket and plaid shirt in every frame. Most likely the Edit-type fix (`CustomCombo` returns the index it is given, so the dropdown did nothing before) — the prompts changed too, so one run cannot prove it alone.
- **Frame rates follow the source**: 3DReal (30 fps), LivePortrait (the driving clip's 30 fps, not a fixed 16), Wan key frames (16 fps), SAM3 (24 fps).

**What is still weak or wrong:**

- `video_ltx2_3_ic_lora_ingredients` **reproduced the reference sheet** — panels on black, invented text — instead of the scene. Its LoRA was trained on the full LTX 2.3 model at strength 1.4, 30 steps, cfg 4; the card runs the fast distilled one at 8 steps, cfg 1, and was set to strength 1.0. Measured on one sheet: **1.0** → the sheet; **1.4** → one seed gave the scene (character, watch and workshop all matching the sheet) with a column of the sheet pinned at the edge, another seed mostly the sheet again; **1.4 at the trained 768×448** and **1.8** → worse. The default is now 1.4 and the card says it is seed-dependent. The full model is already on the rig (`ltx-2.3-22b-dev-fp8.safetensors`, 29 GB), so a variant of this card on it — 30 steps, cfg 4, strength 1.4, as the model card says — is the obvious next test.
- The plain loop (`video_minimax_h3_seamless_loop`): its seam is close but not invisible (2.1 against steps of 0.4–1.7), and the purr it was asked for is almost silent.
- `video_edit_wan_animate2` keeps the **picture's** background (the prompt's beach shows only as palm trees), against ComfyUI's own description; the card says so now.
- The H3 Fun-ControlNet cards write 24 fps whatever the clip — a 30 fps clip plays 25% slower.
- Restorers restore: SeedVR2 removed every compression block from a damaged clip but did not invent back the knit the copy had lost; SAM3's matte misses sleeves and breaks up on a turn. Both are now what the captions say.
- Two soundtracks peak just above full scale (Pika H3 Flex t2v 1.03, LTX 2.5 FLF 1.06) — worth a listen for clipping. None of the sound was listened to; levels were measured.

The verdict for every card — what it was given, what came out, what was measured — is in
[showcase-research/run-2026-11-04.md](showcase-research/run-2026-11-04.md); the inputs and
captions are [library.suite.json](../tools/test-suite/library.suite.json).

---

## Text to image

Two prompts were shared: **the scene** (a striped lighthouse in the right third, open sea on
the left, a cottage with a red door at its foot, a gravel path, three seagulls, golden
hour) on Qwen 2.1, Qwen 2.1 *fix* and MiniMax H3; and **the book cover** (a three-box
layout, a title, a character box) on MOSS SFT and base. The others each got the picture
the rest of the suite needed from them.

| card | warm / cold | VRAM | what came out | verdict |
|---|---|---|---|---|
| `image_qwen_image_2_1_t2i` | 15 s / 18 s | 15.3 GB | the scene with **every** checkable detail right | ★ the most accurate composer |
| `image_qwen_image_2_1_t2i_fix` | 46 s / 52 s | 15.4 GB | more dramatic, textured photo — but the cottage drifted away from the tower and the tower shrank | ✗ slower **and** less accurate on the same prompt |
| `image_minimax_h3_t2i` *(new)* | 11 s / 30 s | **29.3 GB** | right composition, saturated, slightly painterly HDR; two big gulls and a tiny third | works, but owns the card for no gain over Qwen or FLUX |
| `image_flux2_klein_9b_t2i` | **12 s** / 29 s | 18.2 GB | the keeper's portrait: freckles, blue eyes, yellow raincoat over a navy knit, natural skin | ★ best fast photoreal |
| `image_flux3_klein_distilled_t2i` | **7 s** / 13 s | **10.1 GB** | a brass lantern on white: a perfect product shot | ★ fastest and lightest in the library |
| `image_flux3_klein_t2i` | 37 s / 48 s | 10.1 GB | the keeper head to boots on grey, exactly as asked, **inside the one layout box it was given** | the base is 5× the distilled for a small gain; the layout box works |
| `image_krea2_turbo_t2i_lora` | 35 s / 41 s | 17.3 GB | a grand jeté with correct anatomy, realistic | good; the AI prompt rewrite is most of the 35 s |
| `image_ideogram4_t2i` | 20 s / 50 s | 25.7 GB | "PHARE DU CAP" and "FESTIVAL DES LUMIÈRES" **spelled exactly**, boxes followed | ★ the safest with words (MOSS also spelled its one title right) |
| `image_moss_image_t2i` (SFT) | 23 s / 36 s | 11.0 GB | the cover: title exact, character and lighthouse in their boxes, rich gouache | ★ layout by boxes |
| `image_moss_image_base_t2i` | 23 s / 32 s | 11.0 GB | the same layout, followed as well, a little flatter | SFT ≥ base; keep base only for variety |
| `image_qwen_image_2512_360_panorama` | 26 s / 63 s | 26.9 GB | a coherent 2:1 headland that wraps; checked in the 360° viewer | unique, works |

**Picture-guided generation** (structure from one picture, content from the prompt):

| card | warm | VRAM | result | verdict |
|---|---|---|---|---|
| `image_edit_flux2_klein_ref_control_depth` | **9 s** | 17.9 GB | the keeper in the dancer's exact leap — face, coat and boots kept | ★ excellent and cheap |
| `image_moss_image_color_depth_control` *(new)* | 40 s | 16.5 GB | the dancer's leap as a bronze statue on a plinth by the sea | ★ excellent |
| `image_qwen_image_2_1_control_depth` | 28 s | 24.2 GB | the scene in glacier ice: tower, cottage and cliff all where they were | good |
| `image_qwen_image_2_1_control_canny` | 17 s | 23.4 GB | the same prompt: lost the cottage, looser | depth > canny on a photo like this |
| `image_krea2_turbo_style_reference` | 32 s | 20.2 GB | a fox rowing at night, in the blended style of two of the suite's pictures | good |

## Editing a picture

| card | warm | VRAM | result | verdict |
|---|---|---|---|---|
| `image_edit_flux3_klein_image_edit` | 70 s | 11.4 GB | **raincoat → navy peacoat with brass buttons**, one `<obj_1>` box over the coat; face, hair, expression, background untouched | ★ the most precise edit — slow |
| `image_edit_flux2_klein_9b_image_edit` | 25 s | 19.4 GB | the scene at night in a storm: tower, cottage and path exactly in place, beam, rain, surf | ★ structure-preserving restyle |
| `image_edit_flux2_klein_9b_image_edit_ref` | 44 s | 20.6 GB | portrait + lantern: the lantern is faithful and in her hand, but **her face drifted** (older, orange cast) | identity is its weak point |
| `image_qwen_image_2_1_image_edit` | **18 s** | 21.1 GB | the same task: **face and colour kept**, lantern right, but the framing zoomed out | ★ better than FLUX.2 for keeping a person |
| `image_edit_bernini_r_image_editing` | 24 s | 27.1 GB | the scene in winter, slightly recomposed | fine; ⚠ still publishes a stray "3" text tile |
| `image_edit_bernini_r_image_editing_with_reference` | 10 s | 27.9 GB | asked to restyle from the poster, it **pasted the poster's lighthouse and title in as a collage** | ✗ does not restyle |
| `image_edit_flux2_klein_inpaint_prompt` | **3 s** | 17.9 GB | a red fishing boat in the hole cut in the sea, seamless | ★ |
| `image_edit_flux2_klein_inpaint_reference` | 4 s | 18.1 GB | the lantern, lit, standing on the rocks in its hole | ★ |
| `image_edit_qwen_2_1_relight_composite` | 18 s | 21.1 GB | lantern lit and blended into the scene — **but as tall as the cottage** | lighting good, scale unreliable |
| `image_edit_qwen_2511_multiple_angles` | **6 s** | 27.3 GB | the keeper from her side, clean | ★ |
| `image_edit_krea2_quadview` | 22 s | 19.3 GB | face, front, side and back, consistent | ★ (and the input of the multi-view 3D card) |
| `image_edit_krea2_dynamic_character_sheet` | 61 s | 19.4 GB | a consistent sheet — with garbled text, and it named her "Lena" | useful for views, not for its captions |

## Enlarging a picture

| card | warm | VRAM | 1:1 result | verdict |
|---|---|---|---|---|
| `utility_seedvr2_4k_upscale` (7B fp16) | 45 s | 5.6 GB | 1024 → 4096: real iris and skin texture | ★ most detail, lightest |
| `utility_seedvr2_7b_int8_image_upscale` | **20 s** | 9.7 GB | 1024 → 4096: clean | ★ 2.3× faster than fp16 — ⚠ needs fp16 accumulation OFF, so ComfyQ restarts ComfyUI around it |
| `utility_pid_image_upscale` | 18 s (hand-measured; its progress bar counts tiles) | 13.3 GB | 1376×768 → 5504×3072: faithful, believable foliage, sharp wires | ★ the faithful 4× |
| `utility_qwen_2511_unblur_upscale` | **4 s** | 29.1 GB | a portrait shrunk to 0.4× and blurred, restored plausibly | for faces, at about 1 MP |

## 3D

| card | wall | result | verdict |
|---|---|---|---|
| `3d_pixal3d_trellis2_image_to_model` | 116 s | the lantern as a faithful textured mesh, 699k faces | ★ |
| `3d_pixal3d_multi_views` | 104 s | the keeper from four views cropped out of the quadview: good, a few dark specks baked on the coat | good — needs four real views |
| `3d_triposplat_image_to_gaussian_splat` | 36 s | the keeper as a splat — the grey studio wall came along as a curved backdrop | fast; give it a cut-out subject |
| `3d_mesh_remesh_decimate` | 11 s | the lantern rebuilt as a closed 2,000-face shell, target hit exactly | ★ |
| `3d_mesh_uv_unwrap` | 56 s | the 700k-face keeper unwrapped with AO | works |

## Text to video (with sound)

One prompt on all four: *the keeper walks a wet pier toward the camera at dusk, lantern lit,
the striped lighthouse behind her, waves breaking — and the sound of it*. All four followed
it, all four returned a 5-second clip with a matching soundtrack, all four own the card.

| card | warm / cold | size | result | verdict |
|---|---|---|---|---|
| `video_minimax_h3_t2v_turbo` | **30 s** / 60 s | 864×480 | the most dynamic: the beam sweeps, spray bursts over the pier | ★ best value |
| `video_ltx2_5_t2v` | 51 s / 102 s | **1280×704** | cinematic and larger, but the darkest; the lighthouse barely reads as striped | ★ when size matters |
| `video_fastvideo_fasth3_t2v` | 54 s / 96 s | 864×480 | correct and clean; the quietest soundtrack (RMS 0.008 against 0.03–0.04) | no reason to pick it over the turbo card |
| `video_pika_h3_flex_t2v` *(new)* | 140 s / 168 s | **1344×768** | the most polished frame, at the largest size | the quality pick — 4.7× the turbo card's time |

**This settles the question the redundancy worksheet left open** (*"the two H3 t2v bundles …
the comparison has never been made side by side"*): on the same prompt the 4-step turbo card
is both faster (30 s vs 54 s) and livelier than FastVideo's 8-step checkpoint.

## A picture to video

Same start picture (the scene) and the same action on both:

| card | warm | size | result |
|---|---|---|---|
| `video_ltx2_5_i2v` | 51 s | 1280×704 | faithful, slow push-in, a wave strike that fills the frame |
| `video_minimax_h3_i2v_4step` | **35 s** | 864×480 | faithful, the gulls fly through, surf |

Both are good; LTX gives the larger frame for 16 s more.

**First and last frame** — the same pair on all three (the scene → the FLUX.2 Klein stormy-night
edit of it). All three land both ends and pass believably through a sunset into the storm,
the beam switching on:

| card | warm / cold | size | verdict |
|---|---|---|---|
| `video_ltx2_5_flf2v` | 68 s / 118 s | 1280×704 | ★ best value |
| `video_fastvideo_fasth3_i2v` | 59 s / 88 s | 864×480 | ★ cheapest |
| `video_pika_h3_flex_fl2va` *(new)* | 158 s / 208 s | 1344×768 | the smoothest; 2.3× LTX's time |
| `video_wan22_4_key_frames` | 61 s / 88 s | 960×544 | **four** key frames (day → winter → storm → poster), 3.2 s, silent — the only card for more than two frames |

**Reference pictures to video** — the keeper and her lantern as references, the same prompt
(she climbs the lighthouse's spiral stair with it at night):

| card | warm / cold | size | verdict |
|---|---|---|---|
| `video_fastvideo_fasth3_omniref_r2v` | **64 s** / 105 s | 864×480 | ★ faithful to both references, storm at the window |
| `video_pika_h3_flex_ref2va` *(new)* | 161 s / 200 s | 1376×768 | as faithful, more detailed and larger — 2.5× the time |
| `video_ltx2_3_ic_lora_ingredients` | 62 s / 119 s | 1280×704 | consistent keeper from the quadview sheet — but pillarboxed, and it **burned a garbled subtitle** into the clip because the prompt has a spoken line |

**Faces**

| card | warm | result | verdict |
|---|---|---|---|
| `video_liveportrait_image2video` | **11 s**, 0.64 GB | the keeper's portrait takes the driving clip's expressions, identity intact | ★ the cheapest video card by far (⚠ still emits three stray tensor-shape text tiles) |
| `video_ltx2_3_ia2v_iclora` | 135 s | the portrait speaks the recorded voice, lip-synced, 9 s — but frame 0 is the input picture and then it **cuts** to the setting the prompt describes | describe the picture's own setting to avoid the cut |

**Seamless loops** — the stormy-night picture as the reference on both, the same prompt:

| card | warm / cold | result |
|---|---|---|
| `video_minimax_h3_seamless_loop` | 251 s / 310 s | the beam sweeps a full circle, first frame = last frame |
| `video_minimax_h3_seamless_loop_fasth3` (**FastH3-Omni with a reference picture**) | 258 s / 300 s | the same, holding the reference's composition a little closer |

Both are 1024×576, 4.25 s at 48 fps after interpolation, with sound. On this rig they cost the
same — the earlier measurement that put the FastH3 card 10% ahead did not repeat.

## Editing a video

Every card below was given **the same source clip** — the LTX 2.5 text-to-video result, the
keeper walking the pier (5 s, 1280×704, with sound).

**Restyle to claymation** (same look asked of all six):

| card | warm / cold | size | result | verdict |
|---|---|---|---|---|
| `video_edit_ltx2_5_iclora_union_control` (depth) | 130 s / 137 s | **1920×1024** | clay pier, clay rocks, clay figure, the walk kept | ★ best value |
| `video_edit_ltx2_5_iclora_canny_control` | 139 s / 143 s | 1792×1024 | the same, from edges | ★ |
| `video_edit_minimax_h3_fun_controlnet_canny` | 155 s / 215 s | 864×480 | the **most convincingly clay**: a doll-like figure, sculpted waves — but near-silent audio | ★ the look |
| `video_edit_minimax_h3_fun_controlnet_depth` | 182 s / 194 s | 864×480 | clay figure, a more realistic sea | good |
| `video_edit_bernini_r_video_editing` | 231 s / 284 s | 480×832 | clay-ish — and it came out **portrait** from a landscape source | ⚠ check its size settings |
| `video_edit_minimax_h3_v2v_video_reference` | **600 s** / 669 s | 864×480 | **returned the source clip unchanged** — no clay at all | ✗ the slowest and the only one that did not edit |

**A new character on the same motion:**

| card | warm | result | verdict |
|---|---|---|---|
| `video_edit_wan21_scail2_character_replacement` | 215 s | the keeper replaced by the suite's ballet dancer — walking the pier, even carrying the lantern | ★ excellent |
| `video_edit_ltx2_5_iclora_pose_control` | 123 s | a chrome robot (in bits of raincoat) walking the pier, 1792×1024 | ★ |
| `video_edit_minimax_h3_fun_controlnet_union` | 222 s | a chrome robot in a yellow raincoat, the beam sweeping | ★ |
| `video_edit_wan_animate2` | 142 s | the keeper made to dance by the assets' dancer clip — but its **portrait default crops a landscape clip**: she leaves the frame, the background stays studio-white, and the soundtrack is silent | give it a portrait driving clip |

**Restyle from a picture:**

| card | warm | result | verdict |
|---|---|---|---|
| `video_edit_wan_idv2v_restyle_hires` | 175 s | from the first frame repainted as watercolour (FLUX.3 distilled edit, 12 s): starts painted, drifts back toward photographic over 3.4 s; 1280×720 | ★ of the two |
| `video_edit_wan_idv2v_restyle_compare` | 85 s | the same, as a side-by-side with the source | for showing the difference |
| `video_edit_bernini_r_video_editing_ref_autoprompt` | **822 s** | moved the walk into the ice-lighthouse picture convincingly (Gemma writes the instruction) | good, but 14 minutes |
| `video_edit_bernini_r_video_editing_with_reference` | 626 s | asked for the poster's style, it restyled only the **sky** (with garbled lettering) | ✗ poor value |

**Video utilities**

| card | warm | result | verdict |
|---|---|---|---|
| `video_edit_ltx2_3_3dreal_vid2vid` | 135 s | its intended input (the assets' rough container-ship render) became a convincing ship in a storm; the container lettering is garbled in places | ★ |
| `video_edit_minimax_h3_loop_restyle` | 170 s | the stormy loop repainted — it still loops | works; reads more illustrated than impasto |
| `utility_video_segment_sam3` | 19 s, 2.6 GB | a clean matte of the keeper | ★ (frame-rate bug fixed — see below) |
| `utility_video_frame_interpolation` | **9 s** | 124 → 247 frames at 48 fps | ★ |
| `utility_seedvr2_hd_upscale` (3B fp16) | 195 s, 11.7 GB | 864×480 → 1944×1080 | good |
| `utility_seedvr2_3b_int8_video_upscale` | 197 s, 8.3 GB | 864×480 → 1728×960, clean | the same time as the fp16 card here — the worksheet's "1.9× faster" did not repeat on 0.43 |
| `utility_ltx2_5_video_deblur_upscale` | 35 s | the 864×480 FastH3 clip cleaned up to 960×512, sound kept | works; a modest enlargement at its default size |

## Describing a picture or a video

| card | warm | what it said | verdict |
|---|---|---|---|
| `describe_gemma4_image_description` | 21 s, 10.7 GB | the Ideogram poster: a correct description, and **both lines of text quoted exactly** ("PHARE DU CAP", "FESTIVAL DES LUMIÈRES") — though it announces three text locations and lists two | ★ reads text reliably |
| `describe_gemma4_video_description` | 25 s, 10.7 GB | the Pika clip: the keeper, the raincoat, the lantern, the spray and the camera all right — but it invents a face mask and gets her direction of travel wrong | good for a first draft, check the details |

## Sound

| card | warm / cold | VRAM | result | verdict |
|---|---|---|---|---|
| `audio_stable_audio_3_medium` | **6 s** / 14 s | 6.1 GB | a 150-second sea-shanty-style folk tune from the description | ★ — with its AI prompt improver **off** (see below); ⚠ still emits a stray "150" text tile |
| `audio_yue2_music_cover` | 153 s / 157 s | 6.5 GB | a 150-second sung cover of that tune, lyrics and style from the suite | works; not listened to — check the vocals by ear |


## What the run found that needed fixing

- **Every AI prompt improver built on Qwen 3.5 fails on this ComfyUI (0.43.2)** — Stable Audio's (it was on by default, so the card failed outright), the four FLUX.3 cards' and both MOSS cards': `Unsupported Flash Attention tensor strides` in the comfy-kitchen decode kernel. Stable Audio's improver now defaults off, and all seven checkboxes say so. The cards work; the improvers come back when ComfyUI or comfy-kitchen is fixed — not attempted here, because it means changing the environment of a drive that is cloned to other rigs. See CLAUDE.md, 2026-11-03.
- **Both Gemma captioners' answers were thrown away by the sweep** when their input came from another workflow — fixed in the sweep; the captioners themselves were fine.
- **SAM3 wrote its mask video at 30 fps whatever the source** — a 24 fps clip gave a 4.03 s matte for 5.04 s of footage, which no editor would line up. Fixed: the frame rate now comes from the source.
- **Four calibrations had been measuring a cheaper job than the default** (FLUX.2 Klein ×3 at 8 of 20 steps, Ideogram at Turbo): the timeline was booking FLUX.2 Klein a third of its real time. Now measured at the defaults.

## Worth deciding

- **Retire or rework:** `image_qwen_image_2_1_t2i_fix` (slower and less accurate than the plain card on the same prompt); `video_ltx2_3_ic_lora_ingredients` (on 2026-11-04 it reproduced the reference sheet instead of the scene — see the showcase run). ~~Both Bernini *with reference* cards and the H3 video-reference card~~ were on this list after 2026-11-03 and are **not** any more: on 2026-11-04 all three made the edit they exist for (the Edit-type fix for Bernini, the trained prompt form for H3).
- **Keep but explain:** the Pika H3 Flex cards are the best-looking H3 video at 2.5–5× the time — a choice to offer when quality matters, not the default; the MiniMax H3 still costs 29 GB for a picture Qwen 2.1 makes at 15 GB.
- **Still emitting stray text tiles** (a node's plumbing shown as a result): both Bernini image cards and all three Bernini video cards (now the Edit-type index: "6", "8"), and LivePortrait (three tensor shapes plus VHS's first-frame PNG).
- **The three H3 Fun-ControlNet cards write a fixed 24 fps** and read the control clip frame for frame, so a 30 fps clip — what phones record — comes out 25% slower (measured on a 30 fps render: its cut at frame 113 lands at frame 114 of 24). The cards say so now; the fix is VHS_LoadVideo with `force_rate: 24`, which changes the cards' input key and their examples.
- **Suite seeds are not used**: calibration replaces every seed with a fresh one so a re-run cannot be a cache hit, whatever the suite asks for. The examples record the seed that actually ran.
- **Speed since ComfyUI 0.39** (same steps, different inputs, so a lead rather than a verdict): the H3 video-reference card runs at half its October speed per step, TripoSplat at 0.6×, the LTX IC-LoRA trio at 0.6–0.8×; LTX 2.5 t2v / i2v / FLF, FastH3, Qwen 2.1 and SeedVR2 are unchanged.

## Seeing the results

Every result above is an example on the machine: **All jobs → user `examples`** in the student
view, one per workflow, with its prompt, its parameters and its input files — so "Use these
settings" starts from exactly what was judged here. The raw measurements are the published
sweep report (Maintenance → *Library sweep*, **Copy report**), and the configuration that
produced them is [tools/test-suite/library.suite.json](../tools/test-suite/library.suite.json).
