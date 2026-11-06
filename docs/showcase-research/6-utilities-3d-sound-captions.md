# g6 — utilities, 3D, audio, describe (17 workflows)

Research for the showcase test suite. Every claim below is tied to a URL (listed per card) or to something
read in the bundle or in ComfyUI's own source on this rig (`J:\ComfyUI_windows_portable_nvidia\ComfyUI_windows_portable\ComfyUI`).
Nothing in `J:\ComfyQ` was edited and no job was run.

**Conventions used in the JSON blocks**
- `asset:<file>` = a file in `J:\_assets` (all listed ones were checked on disk and looked at).
- `output:<id>` = that run's first output of the right kind.
- A derived input is written as an object `{"derive": {"from": …, "kind": …, "ops": [ … ]}}`. ⚠ Two things it needs
  that the suite does not do yet (see "New derive features" at the end): deriving **from an asset** (today
  `librarySweep._resolveSuiteParams` derives only from a workflow's output), and **video** ops (today every op
  outputs a PNG).
- Inputs fed by the suite bypass the booking form, so a card's `maxInputEdge` (client-side resize) is NOT applied.
  Every input below is sized deliberately.

**Three findings that change how these cards should be shown (all verified in code on this rig)**
1. ★★ **SAM3 keeps ONE detection per prompt unless you write `:N`.** `comfy/text_encoders/sam3_clip.py:_parse_prompts`
   defaults `max_detections` to 1 and `SAM3_Detect` keeps `argsort(...)[:max_det]` per frame
   (`comfy_extras/nodes_sam3.py`). So `person` in a crowd masks one person per frame (and the top-scoring one can
   switch between frames); `person:6` masks six. The card's description promises "finds that object in every frame"
   and never mentions `:N`. Detection is per frame (no tracking).
2. ★★ **Gemma 4's video input is sampled at 1 frame per second, assuming 24 fps.** `TextGenerate`'s `video` tooltip:
   "Assumed to be 24 FPS; subsampled to 1 FPS internally" (`comfy_extras/nodes_textgen.py`); frames are labelled
   00:00, 00:01… (ComfyUI PR #13376). A 5 s clip is 5–6 pictures. And the graph wires only the frames, so the
   captioner never hears the sound track.
3. ★ **Pixal3D multi-view "left" = the profile in which the subject faces the RIGHT of the picture.** In ComfyUI's
   own template, the sheet's second panel (warrior facing image-right) goes to `left` and the fourth (facing
   image-left) to `right` (template JSON links 1435/1436, checked by downloading the template and its sheet). The
   node tooltip says "the object's left side", which reads the other way round. The previous suite's crop
   assignment (quadview side panel → left, mirrored → right) is therefore correct.

---

## utility_seedvr2_4k_upscale

**What the model is good at** (with sources): SeedVR2 is ByteDance's one-step diffusion restorer (adversarial
post-training on SeedVR). It is trained on ~10M synthetic image pairs + 5M video pairs and evaluated on ×4
synthetic benchmarks, real-world VideoLQ and AI-generated video (arXiv 2506.05301). It rebuilds texture rather
than sharpening. This card runs the **7B "sharp" fp16** checkpoint (`seedvr2_ema_7b_sharp_fp16`), which the numz
pack describes as "sharp variants for enhanced detail"; ByteDance does not document it. The official limitations
(SeedVR README / HF cards): "not robust to heavy degradations and very large motions", and it "tends to overly
generate details on inputs with very light degradations" (oversharpening). Pack semantics (numz README):
`resolution` = target for the **shortest** edge, aspect kept; `max_resolution` = cap on any edge. On this rig:
1024 → 4096, "real iris and skin texture", 45 s, 5.6 GB (assessment).

**Showcase idea**: a real phone photo that is *visibly* damaged in the way SeedVR2 was trained to undo: noise,
softness and JPEG blocking at 1024 px, then ×4 to 4096. That keeps the job in its trained regime (a ×4 restore),
not a ×16 hallucination. I degrade by noise + blur + compression rather than a deep downscale, because the
official notice says heavy degradation fails and very light degradation oversharpens. Long fur is the ideal
subject: it cannot be "sharpened back", only rebuilt, and whiskers and eyes give hard checks. It is not a face,
because faces are the Qwen unblur card's speciality. Both SeedVR2 7B image cards get **the same input and the
same 4096² output**, so speed and quality can be compared like for like (the suite's same-job rule).

**Inputs**: `source_image_16` — a 1024×1024 real photo with fine organic detail, degraded (noise σ≈8, blur 1 px,
JPEG q30) — derived from `asset:Mariette1.jpg` (3456² phone photo of a long-haired grey cat on white tiles with a
plant: fur, whiskers, green eyes, tile grout, leaves).

**Expected result / how to judge it**: a 4096×4096 PNG. At 1:1 the fur shows individual strands with no JPEG
8×8 blocks and no colour noise. Whiskers come back as continuous thin lines. The eyes have a clean iris and
catchlight. The tile grout lines are straight. Colours match the input (`color_correction` is "lab" in the graph).

**Risks**: the "sharp" model can over-crisp flat areas such as the tiles and wall (official oversharpening note).
Invented whisker positions are plausible but not real; that is expected of a generative restorer. If the
degradation is pushed harder (e.g. a 256-px source), expect the documented failure mode ("unpleasing details").

**Links to fix**: the label "Detail level - target size of the SHORTEST edge" is correct. Sources (numz/SeedVR2_comfyUI) resolve. None.

```json
{ "workflow": "utility_seedvr2_4k_upscale",
  "title": "Rebuild a photo's detail at 4K",
  "summary": "Give it a photo, even a noisy or slightly blurry one, and get it back up to 4K with real detail rebuilt: fur, skin, fabric, foliage. The most detailed of the photo enlargers.",
  "note": "A noisy, blocky 1024-pixel phone photo of a cat rebuilt at 4096 pixels. Zoom into the fur, the whiskers and the eyes and compare with the input; the faster SeedVR2 card got exactly the same picture.",
  "params": { "resolution_10": 4096, "max_resolution_10": 4096, "seed_10": 42 },
  "inputs": { "source_image_16": { "need": "1024x1024 real photo with fine organic texture, visibly degraded by noise, softness and JPEG blocking (a x4 restore, not heavier)",
      "source": { "derive": { "from": "asset:Mariette1.jpg", "kind": "image", "ops": [
        { "op": "scale", "factor": 0.296296 }, { "op": "blur", "radius": 1.0 },
        { "op": "noise", "sigma": 8, "seed": 1 }, { "op": "jpeg", "quality": 30 } ] } } } },
  "keepRuntime": false, "estSec": 50,
  "sources": ["https://arxiv.org/abs/2506.05301", "https://iceclear.github.io/projects/seedvr2/", "https://github.com/ByteDance-Seed/SeedVR", "https://huggingface.co/ByteDance-Seed/SeedVR2-7B", "https://github.com/numz/ComfyUI-SeedVR2_VideoUpscaler", "https://huggingface.co/numz/SeedVR2_comfyUI"] }
```

## utility_seedvr2_7b_int8_image_upscale

**What the model is good at** (with sources): it is the same SeedVR2 7B, but the normal (not "sharp") EMA
weights in Comfy-Org's int8-convrot repack, running on ComfyUI's native nodes (Comfy-Org/SeedVR2 README; the
template note cites ComfyUI PR #14424). The output is input × factor (≤4). A colour-match post-process offers
lab / wavelet / adain; numz describes lab as "full perceptual color matching… recommended for highest fidelity".
On this rig: 20 s warm, 2.3× faster than the fp16 card. It needs `fp16_accumulation` off, or it saves black images
(PROJECT-HISTORY.md), so ComfyQ restarts ComfyUI around it.

**Showcase idea**: exactly the 4K card's input, so a student sees the speed/quality trade on one picture: normal
7B int8 against 7B "sharp" fp16, both 1024 → 4096. I set colour correction to **lab**, matching the 4K card's graph
literal, so the comparison is fair and the card's own advice ("lab is the most faithful") is demonstrated. The
post-process costs nothing measurable.

**Inputs**: `loadimage_image_1` — the same degraded 1024² cat photo as `utility_seedvr2_4k_upscale`. Exactly
1024 px, because the graph multiplies the raw input by 4 (the 1024-px shrink happens only in the booking form) —
the same derive.

**Expected result / how to judge it**: a 4096×4096 PNG. Put it beside the 4K card's result at 1:1: this one should
be slightly softer and less "crisp" on fur tips (normal vs sharp weights), and free of blocks and noise. Colours
should match the input (lab). Time ≈ half of the 4K card's.

**Risks**: the ComfyUI restart for the flag mask adds about 30–60 s of wall time. Put it next to other
fp16-accumulation-off bundles. It will have the same plausible-but-invented whiskers as the other card.

**Links to fix**: none. The model urls resolve. ⚠ Description: "Your image is first shrunk so its longest side is
at most 1024 px" is true only for uploads through the form. Worth saying "the upload form shrinks…", since
"Use these settings" re-runs bypass it.

```json
{ "workflow": "utility_seedvr2_7b_int8_image_upscale",
  "title": "Rebuild a photo's detail, fast",
  "summary": "Give it a photo and get it back up to 4 times bigger with lost detail rebuilt. About twice as fast as the 4K version, and it can match the original colours.",
  "note": "The same damaged cat photo as the 4K card, rebuilt 4 times bigger in about half the time. Compare the fur and whiskers of both results with the input to see what the speed costs.",
  "params": { "resizeimagemasknode_resize_type_multiplier_66_57": 4, "seedvr2postprocessing_color_correction_method_66_59": "lab", "ksampler_seed_66_54": 42 },
  "inputs": { "loadimage_image_1": { "need": "the same 1024x1024 degraded photo as utility_seedvr2_4k_upscale (exactly 1024 px: x4 = 4096)",
      "source": { "derive": { "from": "asset:Mariette1.jpg", "kind": "image", "ops": [
        { "op": "scale", "factor": 0.296296 }, { "op": "blur", "radius": 1.0 },
        { "op": "noise", "sigma": 8, "seed": 1 }, { "op": "jpeg", "quality": 30 } ] } } } },
  "keepRuntime": false, "estSec": 30,
  "sources": ["https://huggingface.co/Comfy-Org/SeedVR2", "https://github.com/numz/ComfyUI-SeedVR2_VideoUpscaler", "https://arxiv.org/abs/2506.05301", "https://github.com/ByteDance-Seed/SeedVR"] }
```

## utility_pid_image_upscale

**What the model is good at** (with sources): NVIDIA's PiD (Pixel Diffusion Decoder) replaces the latent→pixel
decoder with a 4-step pixel-space diffusion that decodes and upsamples ×4 in one pass (arXiv 2605.23902; NVIDIA
project page). v1.5 brought "better colour fidelity" and removed corner-grid artefacts (nvidia/PiD card). It is a
**decoder, not a restorer**: its job is a faithful exact ×4 of a clean latent. This card VAE-encodes the upload with
the **Qwen-Image VAE** and decodes it through PiD's **Qwen-Image lane** in 1024-latent tiles. The pack says
tiles under 1024 "go mushy" and `degrade_sigma` 0 is for clean latents (pack README; ComfyUI docs). Its own
description warns tiny, blurry or compressed inputs come back with invented texture. On this rig: 1376×768 →
5504×3072, "faithful, believable foliage, sharp wires" (assessment).

**Showcase idea**: the opposite of the SeedVR2 cards. A **clean** picture made poster-sized without changing it,
which shows what PiD is uniquely for. A picture made by **Qwen-Image** is the matched case: PiD's Qwen lane was
trained to decode Qwen-Image latents, and the card encodes with the same Qwen VAE. So the example is "a Qwen 2.1
picture, ×4". It avoids PiD's documented weakness (damaged inputs), which the SeedVR2 cards cover.

**Inputs**: `loadimage_image_1` — a clean, detailed ~1 MP picture, ideally 16:9 with fine structure (foliage,
rigging, small lettering) — `output:image_qwen_image_2_1_t2i` (whatever its showcase is; 1376×768 last time).

**Expected result / how to judge it**: a PNG exactly 4× each side (5504×3072 for a 1376×768 input). It should
have the same composition and colours as the input (no colour drift) and no visible tile seams on a 2×2 grid. At
1:1, edges and any lettering stay clean and legible rather than re-invented.

**Risks**: if the Qwen showcase has large flat areas, PiD may add faint texture there. The output is tens of MB,
slow to open. `runtime.json` is `source: "manual"` (18 s hand-measured; the sweep's guard keeps it).

**Links to fix**:
- `requirements.models` for `pid_1.5_qwenimage_1024_to_4096_4step_bf16.safetensors` and
  `gemma_2_2b_it_elm_bf16.safetensors` point at the node-pack repo, but the files live in
  **https://huggingface.co/Comfy-Org/PixelDiT** (`diffusion_models/…` and `text_encoders/…`, verified in the HF API
  file list). Set `source` there and let `harvest.cjs`/`verify.cjs` fill the direct url.
- The VAE `Comfy-Org/Qwen-Image_ComfyUI` link 307-redirects to `Comfy-Org/Qwen-Image`; this is already being
  changed in the working tree.
- ⚠ Licence missing from the description: PiD weights are NVIDIA NSCLv1, **non-commercial research/evaluation only**
  (nvidia/PiD card; PixelDiT LICENSE).

```json
{ "workflow": "utility_pid_image_upscale",
  "title": "Make a picture poster-sized, exactly 4×",
  "summary": "Give it a clean, sharp picture and get it back exactly 4 times wider and taller (up to 33 megapixels) with the same colours and content. Pick it for printing or zooming in, not for damaged photos.",
  "note": "A clean 1376×768 picture from the Qwen text-to-image card made 4 times wider and taller without changing it. Zoom to 100% on small details and edges: they stay faithful instead of being re-invented.",
  "params": { "latenttiledpiddecode_seed_7": 42 },
  "inputs": { "loadimage_image_1": { "need": "a clean, detailed ~1 MP picture (16:9 ideal) made by Qwen-Image, the latent family PiD's Qwen lane decodes", "source": "output:image_qwen_image_2_1_t2i" } },
  "keepRuntime": true, "estSec": 20,
  "sources": ["https://arxiv.org/abs/2605.23902", "https://research.nvidia.com/labs/sil/projects/pid/", "https://github.com/nv-tlabs/PiD", "https://huggingface.co/nvidia/PiD", "https://docs.comfy.org/tutorials/image/nvidia/pid-latent-upscale", "https://github.com/BennyDaBall930/ComfyUI-Latent-Tiled-PiD", "https://huggingface.co/Comfy-Org/PixelDiT"] }
```
(`keepRuntime: true` only to protect the hand-measured 18 s; the sweep's `source: "manual"` guard already does.)

## utility_qwen_2511_unblur_upscale

**What the model is good at** (with sources): a rank-16 LoRA on Qwen-Image-Edit-2511 whose author says it was
"trained to recover facial patterns from partially blurred images. The base model produces better overall
quality, but it does not preserve those patterns". The trigger is literally `unblur and upscale` and checkpoints
_20/_15 are recommended (prithivMLmods model card). The training data is not documented ("trained on
ModelScope.cn"). The graph re-renders at ~1 MP (`FluxKontextImageScale`), 4-step Lightning by default. On this rig:
"a portrait shrunk to 0.4× and blurred, restored plausibly", 4 s warm, 29 GB (assessment). Needs Sage attention
off (black images otherwise).

**Showcase idea**: "rescue an old family photo". A small, soft, compressed scan of a black-and-white portrait comes
back crisp **with the same face**, which is exactly what the adapter is for (identity kept), and is the job the other
three enlargers are not specialised in. Using an asset whose clean original is also on disk lets a student check
identity directly. It plays to the documented strength (faces) and avoids the documented weakness (it is not an
enlarger: the output stays ~1 MP; small print can turn to nonsense, and there is none here).

**Inputs**: `loadimage_image_25` — a head-and-shoulders portrait, small and soft like an old print scan (≈307 px,
blur, JPEG) — derived from `asset:Woman.png` (1024² 1950s-style B&W portrait; the clean original stays in the
assets for comparison).

**Expected result / how to judge it**: a ~1024×1024 image. Eyes, eyelashes, teeth, hair waves and the houndstooth
collar come back sharp. Laid next to `asset:Woman.png` it is recognisably the same woman: face shape, smile,
eyebrow arch and hairline. It stays black and white. JPEG blocks are gone.

**Risks**: the re-render can subtly change the face. That is the documented trade, and why the original is offered
for comparison. It could add slight colour to a B&W input (the prompt is only the trigger; keeping it equal to the
default keeps the calibration valid). The cold start is about 50 s (a 38 GB model) plus a ComfyUI restart for the
Sage mask.

**Links to fix**:
- The source of `Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors` is given as
  `lightx2v/Qwen-Image-Lightning`, which holds only the Qwen-Image / Edit / Edit-2509 Lightning files. The file is in
  **https://huggingface.co/lightx2v/Qwen-Image-Edit-2511-Lightning** (verified in the HF API file list).
- `Comfy-Org/Qwen-Image-Edit_ComfyUI` 307-redirects to `Comfy-Org/Qwen-Image-Edit`.
- ⚠ Description error: "The Qwen Image Edit base model it runs on is still Qwen Research License". HF metadata for
  `Qwen/Qwen-Image-Edit-2511` says **apache-2.0** (checked through the HF API).

```json
{ "workflow": "utility_qwen_2511_unblur_upscale",
  "title": "Sharpen a blurry portrait",
  "summary": "Give it a small or blurry photo of a person and get a sharper version (about 1 megapixel) that keeps the same face. Pick it for portraits; use the other enlargers for everything else.",
  "note": "A small, soft scan of an old black-and-white portrait comes back crisp. Compare the face with the original picture (Woman.png): it should still be the same person, because that is what this card is trained to keep.",
  "params": { "textencodeqwenimageeditplus_prompt_427_221_151": "unblur and upscale", "loraloadermodelonly_lora_name_427_221_220": "Qwen-Image-Edit-Unblur-Upscale_20.safetensors", "loraloadermodelonly_strength_model_427_221_220": 1, "primitiveboolean_value_427_221_168": true, "ksampler_seed_427_221_169": 345666571704709 },
  "inputs": { "loadimage_image_25": { "need": "a head-and-shoulders portrait degraded like an old small print scan (about 300 px, soft, light JPEG); its clean original must exist for the identity check",
      "source": { "derive": { "from": "asset:Woman.png", "kind": "image", "ops": [
        { "op": "scale", "factor": 0.3 }, { "op": "blur", "radius": 1.2 }, { "op": "jpeg", "quality": 40 } ] } } } },
  "keepRuntime": false, "estSec": 60,
  "sources": ["https://huggingface.co/prithivMLmods/Qwen-Image-Edit-2511-Unblur-Upscale", "https://huggingface.co/lightx2v/Qwen-Image-Edit-2511-Lightning", "https://huggingface.co/Qwen/Qwen-Image-Edit-2511"] }
```

## utility_seedvr2_hd_upscale

**What the model is good at** (with sources): SeedVR2 3B (fp16, numz pack) restores video with temporal
consistency. Training goes "from images to video clips" (arXiv 2506.05301). The pack wants `batch_size` 4n+1
(this graph uses 33) with `temporal_overlap` to blend batches, and keeps aspect with `resolution` = **shortest
edge** (numz README). The graph keeps fps and audio (`GetVideoComponents → CreateVideo`). On this rig: 864×480 →
1944×1080 in 195 s, 11.7 GB (assessment). Official limitations: weak on heavy degradation and very large motion;
oversharpens very lightly degraded input such as 480p AIGC (SeedVR README). That is exactly why the old example
(a clean generated clip) showed little.

**Showcase idea**: a real fashion-film clip with the textures video restorers are judged on (knitted sweater,
embroidered floral vest, long wavy hair, grass stalks against the sky). It is degraded the way video actually gets
damaged: downscaled to 270p, blown back up to 540p and re-encoded at a low bitrate (soft and blocky). The 1080p card
then rebuilds it. Same clip as the ×2 card, same 1080×1080 output, so the two video restorers can be compared.
Only 4 s of 16-fps footage, so it is cheap. Moderate degradation with slow-to-moderate motion keeps it inside
SeedVR2's documented comfort zone.

**Inputs**: `source_video_21` — 4 s, 540×540, visibly soft and compression-blocky, with fine textures and moderate
motion — derived from `asset:original.mp4` (720×720, 16 fps, no audio; a long-haired dancer in a knit sweater in
tall grass). New video ops are needed.

**Expected result / how to judge it**: a 1080×1080, 16 fps, 4 s video. In matching frames against the input:
sweater rib-knit lines and vest embroidery reappear, hair strands separate, grass stalks are thin and continuous,
the sky has no block banding, and nothing flickers frame to frame (check the grass).

**Risks**: invented texture on the sweater may "swim" slightly between batches (33-frame batches, overlap 3). Hands
in fast motion may stay soft (the documented large-motion limit).

**Links to fix**:
- ⚠ The label "Target resolution (px, longest edge)" is wrong: the numz node's `resolution` is the **shortest**
  edge (numz README). The last run confirms it: 864×480 → 1944×1080.
- `max_resolution` is 0 (no cap), so a portrait clip at 1080 shortest edge becomes 1920 tall or more. Worth saying
  in the label.
- Sources resolve.

```json
{ "workflow": "utility_seedvr2_hd_upscale",
  "title": "Restore a video to 1080p",
  "summary": "Give it a short, soft or low-quality video and get it back at 1080p with real detail rebuilt; the sound and frame rate are kept.",
  "note": "A soft, blocky 540p clip of a dancer in tall grass rebuilt at 1080p. Watch the knit of the sweater, the hair and the grass stalks; the ×2 video card got exactly the same clip.",
  "params": { "resolution_10": 1080, "seed_10": 42 },
  "inputs": { "source_video_21": { "need": "a short (4 s) real clip with fine textures and moderate motion, degraded to a soft, blocky 540p",
      "source": { "derive": { "from": "asset:original.mp4", "kind": "video", "ops": [
        { "op": "trim", "start": 0, "duration": 4 }, { "op": "vscale", "factor": 0.375 },
        { "op": "vscale", "factor": 2.0 }, { "op": "encode", "crf": 35 } ] } } } },
  "keepRuntime": true, "estSec": 75,
  "sources": ["https://arxiv.org/abs/2506.05301", "https://github.com/ByteDance-Seed/SeedVR", "https://huggingface.co/ByteDance-Seed/SeedVR2-3B", "https://github.com/numz/ComfyUI-SeedVR2_VideoUpscaler", "https://huggingface.co/numz/SeedVR2_comfyUI"] }
```
(`keepRuntime: true`: 64 frames at 1080² is about a third of a typical 5 s 480p→1080p job; calibrating on it would under-book students' jobs.)

## utility_seedvr2_3b_int8_video_upscale

**What the model is good at** (with sources): the same SeedVR2 3B as Comfy-Org's int8-convrot repack on native
nodes, at 1 step. It offers ×1–2 multiplier, optional trim, temporal chunking for long clips, and lab / wavelet /
adain colour match (Comfy-Org/SeedVR2; template note: "One-step video restoration / upscale (ICLR 2026)", PR
#14424). On this rig: 864×480 → 1728×960 in 197 s, 8.3 GB (assessment); the same speed as the fp16 card on 0.43,
with less VRAM.

**Showcase idea**: the HD card's exact input, at the default ×2 (540 → 1080, matching the card's own "540p becomes
1080p" line), so both video restorers land on the same 1080×1080 output. Colour correction is set to **lab** to
match the HD card's graph literal, which also demonstrates the card's colour-match option.

**Inputs**: `loadvideo_file_73` — the same degraded 4 s 540×540 clip as `utility_seedvr2_hd_upscale` (already
trimmed, so the card's Trim stays off).

**Expected result / how to judge it**: a 1080×1080 16 fps 4 s video. The same checks as the HD card (knit, hair,
grass, no block banding, no flicker), with colours matching the input. Compare the two results side by side; the
difference is the int8 repack and the native graph.

**Risks**: the same as the HD card. "Process in chunks" stays off: 64 frames is short.

**Links to fix**: ⚠ the description says "The time estimate shown is for a 3-second clip", but `runtime.json`
was last calibrated by the suite on a 5 s 864×480 clip, so that sentence is stale. URLs resolve.

```json
{ "workflow": "utility_seedvr2_3b_int8_video_upscale",
  "title": "Restore and enlarge a video ×2",
  "summary": "Give it a short video and get it back up to twice as wide and tall with lost detail rebuilt. It can trim the clip first and match the original colours.",
  "note": "The same damaged 540p clip as the 1080p card, enlarged twice with colour matching on. Compare the two results side by side: same job, two builds of the same model.",
  "params": { "resizeimagemasknode_resize_type_multiplier_66_57": 2, "comfyswitchnode_switch_66_81": false, "primitiveboolean_value_66_105": false, "seedvr2postprocessing_color_correction_method_66_59": "lab", "ksampler_seed_66_54": 42 },
  "inputs": { "loadvideo_file_73": { "need": "the same degraded 4 s 540x540 clip as utility_seedvr2_hd_upscale",
      "source": { "derive": { "from": "asset:original.mp4", "kind": "video", "ops": [
        { "op": "trim", "start": 0, "duration": 4 }, { "op": "vscale", "factor": 0.375 },
        { "op": "vscale", "factor": 2.0 }, { "op": "encode", "crf": 35 } ] } } } },
  "keepRuntime": true, "estSec": 90,
  "sources": ["https://huggingface.co/Comfy-Org/SeedVR2", "https://arxiv.org/abs/2506.05301", "https://github.com/ByteDance-Seed/SeedVR", "https://github.com/numz/ComfyUI-SeedVR2_VideoUpscaler"] }
```

## utility_video_frame_interpolation

**What the model is good at** (with sources): FILM, "Frame Interpolation for Large Motion" (Google, ECCV 2022), is
a single network trained on frame triplets, state of the art on the Xiph large-motion benchmark. Its README says it
"transforms near-duplicate photos into a slow motion footage" (arXiv 2202.04901; google-research/frame-interpolation).
Its stated limitation is "un-natural deformations when the in-between motion is extreme". ComfyUI's native
`FrameInterpolate` came with PR #13258 (kijai). The card's switch either multiplies the fps (smoother) or keeps the
source fps (slow motion). On this rig: 124 → 247 frames in 9 s (assessment).

**Showcase idea**: fast human motion turned into **4× slow motion**, which is what FILM is for (large motion between
frames, where naive frame-blending ghosts). The most energetic 2 s of a real rooftop dance (arm swings, a hop,
visible motion blur: measured as the peak of mean frame difference over the clip) become ~8 s of gliding
slow-motion. The source is muted because, in slow-motion mode, the original audio would end after a quarter of the
clip (the card's own warning).

**Inputs**: `source_video_4` — 2 s of fast, large motion, 25 fps, no audio — derived from
`asset:2795750-uhd_3840_2160_25fps_1_1.mp4` (720×720 25 fps; a man in a black hoodie with red sleeves dancing on
a rooftop over brick factory buildings), seconds 3.0–5.0 (motion energy 10.9–11.5 vs 4–6 elsewhere).

**Expected result / how to judge it**: a 720×720 video of ~197 frames at 25 fps (≈7.9 s), 4× slower than the
source. Step frame by frame through an arm swing: there should be three new intermediate arm positions between each
original pair, not a cross-fade double image. Background buildings stay rigid.

**Risks**: fingers and fast hands may warp or smear (FILM's documented "extreme motion" failure). Motion blur in
the source is interpolated too, so it looks smooth rather than crisp. This is a different setting from default
(×4, slow-mo): cost is still ~10 s.

**Links to fix**: `Comfy-Org/frame_interpolation` → `Comfy-Org/Frame-Interpolation` (307 redirect); already being
changed in the working tree. Otherwise none.

```json
{ "workflow": "utility_video_frame_interpolation",
  "title": "Make a video smoother or slow-motion",
  "summary": "Give it a video and get it back with new in-between frames: smoother at the same speed, or turned into slow motion. Works best on fast movement.",
  "note": "Two seconds of a fast rooftop dance turned into eight seconds of smooth slow motion. The card invents three new frames between every pair, so the arm swings glide instead of jumping.",
  "params": { "multiplier_16_9": 4, "keep_realtime_speed_16_13": false },
  "inputs": { "source_video_4": { "need": "about 2 s of fast, large human motion, 24-30 fps, no sound track",
      "source": { "derive": { "from": "asset:2795750-uhd_3840_2160_25fps_1_1.mp4", "kind": "video", "ops": [
        { "op": "trim", "start": 3.0, "duration": 2.0 }, { "op": "mute" }, { "op": "encode", "crf": 16 } ] } } } },
  "keepRuntime": true, "estSec": 12,
  "sources": ["https://arxiv.org/abs/2202.04901", "https://github.com/google-research/frame-interpolation", "https://github.com/Comfy-Org/ComfyUI/pull/13258", "https://huggingface.co/Comfy-Org/Frame-Interpolation"] }
```

## utility_video_segment_sam3

**What the model is good at** (with sources): SAM 3 does "promptable concept segmentation". A short noun phrase
(noun + one or two modifiers: "red apple", "striped cat") returns a mask for every matching instance. It reaches
54.1 cgF1 on SA-Co/Gold against 24.6 for OWLv2 and 13.0 for Gemini 2.5 (arXiv 2511.16719; Meta blog). Known limits:
no long referring expressions, at most one or two attributes, ambiguity in crowds (paper Appendix B). SAM 3.1
multiplex speeds up tracking (RELEASE_SAM3p1.md). **In this graph** (`SAM3_Detect`, per-frame, no tracker), a bare
prompt keeps **one** detection per frame (`sam3_clip.py`); `name:N` keeps N. The text encoder takes 32 tokens. Open
ComfyUI bug #17105: the presence score is ignored, so a prompt for an **absent** object can mask something else. On
this rig: "a clean matte of the keeper", 19 s (assessment).

**Showcase idea**: show the *concept* power, not the easy case ("person"). One named **garment** is isolated from a
patterned, moving outfit: `black leather jacket` on a dancer who also wears a yellow plaid shirt, tiger-striped
leggings and a red headscarf, in front of a brutalist overpass with a grid of skylights and trees. The matte must
follow the jacket's two open front panels and sleeves through 5 s of dance, keeping the plaid shirt between the
panels black. Why this fits the code: the jacket is visible in every frame, so the max-1 rule is harmless and the
absent-object bug cannot fire. It is a one-attribute noun phrase, the documented sweet spot. A real 24 fps clip
lines up 1:1 with the matte.

**Inputs**: `source_video_115` — 5 s of a person in a busy patterned outfit with one distinctive garment visible
throughout — derived from `asset:3044160-uhd_3840_2160_24fps_5_1.mp4` (720×720 24 fps, no audio), seconds
7.0–12.0 (the livelier part).

**Expected result / how to judge it**: a 720×720 24 fps 5 s black-and-white video. White = the leather jacket only
(both front panels, sleeves, collar). Black = face, hands, the plaid shirt visible between the panels, leggings,
headscarf and background. Frame count = source (120). Step through frames where her arms move: the sleeves stay
white with no frame-to-frame flicker or jumps.

**Risks**:
- Per-frame detection can flicker at the sleeve edges.
- The open front may be partly filled across the shirt.
- If SAM3 reads "jacket" as the whole upper body, the matte will be too big. A raised threshold (0.6) is the knob
  to note in the caption; the default is kept.

Alternative if the integrator prefers a crowd: a stage-3 clip of a busy street market with one dog and the prompt
`dog`, plus a second example caption showing `person:6`.

**Links to fix**: description correction. "SAM3 finds that object in every frame" should add that it keeps the
single best match per prompt and that you write `person:5` for up to five (the template note documents `:N`). Also
"if the named object isn't in the clip the mask is simply empty" is not guaranteed (#17105). URLs resolve.

```json
{ "workflow": "utility_video_segment_sam3",
  "title": "Isolate a named object in video",
  "summary": "Give it a video and type the name of something in it; you get a black-and-white video where only that thing is white, ready for cutting out in editing. Write 'person:5' to catch up to five of them.",
  "note": "Typing only 'black leather jacket' cuts that one garment out of five seconds of dancing. The jacket is white; everything else (her face, the plaid shirt under it, the striped leggings, the building) is black.",
  "params": { "segment_text_114_100": "black leather jacket", "threshold_114_101": 0.5 },
  "inputs": { "source_video_115": { "need": "5 s, 24 fps, a moving person in a busy patterned outfit with one distinctive garment visible in every frame",
      "source": { "derive": { "from": "asset:3044160-uhd_3840_2160_24fps_5_1.mp4", "kind": "video", "ops": [
        { "op": "trim", "start": 7.0, "duration": 5.0 }, { "op": "encode", "crf": 16 } ] } } } },
  "keepRuntime": false, "estSec": 25,
  "sources": ["https://arxiv.org/abs/2511.16719", "https://github.com/facebookresearch/sam3", "https://github.com/facebookresearch/sam3/blob/main/RELEASE_SAM3p1.md", "https://ai.meta.com/blog/segment-anything-model-3/", "https://docs.comfy.org/built-in-nodes/SAM3_Detect.md", "https://github.com/Comfy-Org/ComfyUI/pull/13408", "https://github.com/Comfy-Org/ComfyUI/issues/17105"] }
```

## 3d_pixal3d_trellis2_image_to_model

**What the model is good at** (with sources): Pixal3D (TencentARC, SIGGRAPH 2026) "explicitly lifts pixel features
into 3D through back-projection", so the shape follows the picture closely. Its biggest gains are on fine
high-frequency detail ("keyboard layouts, eyes and petal counts"). It beats Hunyuan3D-2.1 on Toys4K (IoU 93.6 vs
83.3) (arXiv 2605.10922; GitHub TencentARC/Pixal3D). It keeps the input camera's pose (kijai, HF discussion). The
graph feeds a MoGe-estimated FOV, as ComfyUI's template does. TRELLIS.2, the alternative toggle, brings O-Voxel
arbitrary topology and PBR including opacity (arXiv 2512.14692). The card bakes a full PBR set (colour,
metallic, roughness, normal, AO). On this rig: the lantern as "a faithful textured mesh, 699k faces", 116 s
(assessment).

**Showcase idea**: a design classic, Pierre Jeanneret's cane office chair (Chandigarh), from one 3/4 studio photo.
It tests exactly Pixal3D's claim to fame: fidelity to fine structure in the picture (A-shaped side frames, dovetail
joints, the woven cane seat and back) plus PBR materials (wood vs cane). A 3/4 view gives the model two sides to
read. It also gives the remesh and UV cards a hard-surface object to process (chain below).

**Inputs**: `loadimage_image_122` — one clean studio photo of an object with fine structure, whole object in frame,
plain background — `asset:6504516c0115ed9b83b2d82e1d94c4ec.webp` (1920² cane chair, 3/4 view on white).

**Expected result / how to judge it**: a GLB (~700k faces, 4096 PBR maps). Spin it: four separate legs and two
A-shaped side frames; armrests; a backrest panel. The cane weave appears in the base-colour texture on the seat and
back. The wood is a warm teak/brown, darker than the cane. No blobs between the legs. The chair may be tilted to
match the photo's camera; that is Pixal3D's documented behaviour, not a fault.

**Risks**: the woven cane is geometrically a thin panel; it may come out as a solid slab with a weave texture (fine)
or with holes. The far legs, hidden in the photo, are inferred. Paper failure note: "sensitivity to imperfect
segmentation boundaries", and BiRefNet on a white background should be clean.

**Links to fix**: description is stale. "(The separate 'Pixal3D — image to 3D mesh' workflow uses the Pixal3D
custom-node pack instead and only bakes a colour texture.)" refers to a bundle removed on 2026-10-05; delete the
sentence. URLs resolve.

```json
{ "workflow": "3d_pixal3d_trellis2_image_to_model",
  "title": "Turn a picture into textured 3D",
  "summary": "Give it one clear picture of an object or character and get a detailed 3D model with colour and material maps that you can spin, download and use.",
  "note": "One product photo of a design-classic cane chair turned into a textured 3D model. Spin it and check the four legs, the A-shaped side frames and the woven cane on the seat and back.",
  "params": { "primitiveboolean_value_316": false, "comfyswitchnode_switch_248": true, "trellis2upsamplestage_target_resolution_94": 1536, "decimatemesh_target_face_count_186": 700000, "primitiveint_value_288": 4096, "ksampler_seed_3": 56 },
  "inputs": { "loadimage_image_122": { "need": "one clean studio photo of an object with fine structure, whole object visible, plain background", "source": "asset:6504516c0115ed9b83b2d82e1d94c4ec.webp" } },
  "keepRuntime": false, "estSec": 110,
  "sources": ["https://arxiv.org/abs/2605.10922", "https://github.com/TencentARC/Pixal3D", "https://huggingface.co/TencentARC/Pixal3D", "https://ldyang694.github.io/projects/pixal3d/", "https://huggingface.co/Comfy-Org/Pixal3D/discussions/2", "https://arxiv.org/abs/2512.14692", "https://huggingface.co/microsoft/TRELLIS.2-4B"] }
```

## 3d_triposplat_image_to_gaussian_splat

**What the model is good at** (with sources): TripoSplat (VAST, SIGGRAPH '26) generates 3D Gaussian splats with
learned density control, up to 262,144 Gaussians (more only oversamples), decoding in 0.1 s (arXiv 2605.16355;
GitHub). Splats hold soft, layered, semi-transparent appearance that a mesh cannot. Comfy's blog says it is
"especially good at stylized subjects such as characters, props, and creative designs"; that is Comfy's claim, not
VAST's. Documented weaknesses: back-facing regions are lower quality, and a **person** is the paper's own failure
example (dark back). `TripoSplatPreprocessImage` crops to the alpha bounding box, so a cut-out subject matters. On
this rig: 36 s; the keeper's grey studio wall "came along as a curved backdrop" (assessment).

**Showcase idea**: the thing splats are for and meshes are bad at. A paper-craft tree whose canopy is hundreds of
overlapping, translucent, multicoloured paper leaves, standing on a round wooden base against a white wall. It is
a stylised creative object (Comfy's sweet spot), not a person (the paper's failure case), on a clean white
background so BiRefNet cuts it cleanly (avoiding the "backdrop came along" failure). The card's mesh export of
the same splat is the built-in contrast.

**Inputs**: `loadimage_image_99` — one centred stylised object with soft or fluffy, layered detail on a plain
background — `asset:ComfyUI_00013_.png` (512² paper-craft rainbow tree on a wooden base, white wall).

**Expected result / how to judge it**: a `.spz` + `.ply` splat and a `.glb`. In the splat viewer the canopy reads as
many separate coloured leaves (rainbow gradient kept), the trunk's strip texture and the round base are visible, and
there is no wall or shelf behind it. The mesh toggle shows a smoother blob canopy, which is the point: the splat
keeps what the mesh loses.

**Risks**: 512 px is half TripoSplat's 1024 training size, so leaves may be softer. The back of the canopy is
invented. If BiRefNet keeps the shelf edge, the fallback is a transparent PNG with background removal off.

**Links to fix**: none (all VAST/Comfy-Org links resolve). The description could add "best on stylised objects;
people's backs come out dark".

```json
{ "workflow": "3d_triposplat_image_to_gaussian_splat",
  "title": "Turn a picture into 3D, fast",
  "summary": "Give it one picture of an object and get a soft 3D 'splat' in seconds, plus a rough mesh. Great for fluffy, leafy or stylised things; less good for people.",
  "note": "A paper-craft tree turned into a 3D 'splat' in seconds: as you spin it, the soft see-through paper leaves keep their colours. Switch to the mesh to see what a solid surface loses.",
  "params": { "switch_mask_source_88_35": true, "ksampler_steps_88_6": 20, "ksampler_seed_88_6": 0, "vaedecodetriposplat_num_gaussians_88_55": 1048576 },
  "inputs": { "loadimage_image_99": { "need": "one centred, stylised object with soft or layered detail, whole object visible, plain light background", "source": "asset:ComfyUI_00013_.png" } },
  "keepRuntime": false, "estSec": 30,
  "sources": ["https://arxiv.org/abs/2605.16355", "https://github.com/VAST-AI-Research/TripoSplat", "https://huggingface.co/VAST-AI/TripoSplat", "https://docs.comfy.org/tutorials/3d/triposplat", "https://blog.comfy.org/p/bringing-native-support-for-3d-gaussian"] }
```

## 3d_pixal3d_multi_views

**What the model is good at** (with sources): `Pixal3DMultiViewConditioning` takes optional front / left / back /
right views on a fixed 90° orbit with one FOV (20° for "rig renders and most multi-view generators"). Each view
should be square with alpha or on black and at the same scale (node tooltip, `comfy_extras/nodes_trellis2.py`). The
paper trains on 2–6 views with known poses (arXiv 2605.10922). The point of the card: the back and sides are
**seen**, not guessed. The graph removes the background and frames each view itself (`RemoveBackground →
ImageCropToMask 1024², pad 1.1`, like ComfyUI's template). On this rig: the keeper from quadview crops was "good, a
few dark specks", 104 s (assessment).

**Showcase idea**: one picture → four views (Krea quadview) → one 3D model. It teaches students how to get a
turnaround when they only have one image, and the result proves the back is faithful. The character fed to the
quadview card should be **bilaterally symmetric** (so mirroring the one side panel to get the other is valid) but
with a back that is clearly different from the front (hood, back seams, a backpack, a long braid). Then "spin it
round" shows multi-view's advantage. Crops follow ComfyUI's convention (side panel facing image-right → `left`).

**Inputs** (quadview layout measured on the last run: face | front | side | back):
- `loadimage_image_364` (front) — the quadview's front panel.
- `loadimage_image_378` (left) — its side panel (subject facing picture-right, matching ComfyUI's template).
- `loadimage_image_380` (back) — its back panel.
- `loadimage_image_379` (right) — the side panel mirrored.
- All from `output:image_edit_krea2_quadview`.

Alternative if a flawless 4-view input is preferred: ComfyUI's own `character_turnaround_4view_sheet.png`
(6336×2688, four real views on black, downloadable from workflow_templates), cropped at its template's boxes:
- front [0, 0, 0.2634, 1]
- left [0.2607, 0, 0.4962, 1]
- back [0.5022, 0, 0.7355, 1]
- right [0.7462, 0, 1, 1]

**Expected result / how to judge it**: a PBR GLB. Spin it: the back of the model matches the quadview's back panel
(hood shape, seams, hair at the back), the side silhouette matches the side panel, and the proportions are
consistent. Compare with the single-picture card's result: its hidden sides are guesses.

**Risks**:
- The crop boxes assume the quadview layout. Re-measure if that card's showcase changes. The face panel must not
  leak into the front crop.
- Mirroring breaks any asymmetric detail (a pocket on one side).
- Krea invents the back, so "faithful" means faithful to that invented back.
- The dark-speck artefacts seen last time may recur on the coat.

**Links to fix**:
- The labels "Left side view" / "Right side view" are ambiguous. Suggest "Side view (facing right)" / "Other side
  (facing left)", per ComfyUI's template sheet.
- The description's "as flat and orthographic as possible" is close but the rig is a narrow-FOV (20°) perspective
  orbit.
- URLs resolve.

```json
{ "workflow": "3d_pixal3d_multi_views",
  "title": "Turn four views into 3D",
  "summary": "Give it four pictures of the same thing (front, both sides and back) and get one 3D model with materials. Pick it when the back and sides must be right, not guessed.",
  "note": "Four views of one character (front, two sides, back), made by the quadview card from a single picture, built into one textured 3D model. Spin it round: the back matches the back view it was given.",
  "params": { "trellis2upsamplestage_target_resolution_94": 1536, "decimatemesh_target_face_count_186": 700000, "primitiveint_value_288": 4096, "ksampler_seed_3": 56 },
  "inputs": {
    "loadimage_image_364": { "need": "front view, whole body", "source": { "derive": { "from": "image_edit_krea2_quadview", "kind": "image", "ops": [ { "op": "crop", "box": [0.34, 0.0, 0.565, 1.0] } ] } } },
    "loadimage_image_378": { "need": "side view with the subject facing the RIGHT of the picture (ComfyUI's 'left' convention)", "source": { "derive": { "from": "image_edit_krea2_quadview", "kind": "image", "ops": [ { "op": "crop", "box": [0.57, 0.0, 0.755, 1.0] } ] } } },
    "loadimage_image_380": { "need": "back view, whole body", "source": { "derive": { "from": "image_edit_krea2_quadview", "kind": "image", "ops": [ { "op": "crop", "box": [0.76, 0.0, 1.0, 1.0] } ] } } },
    "loadimage_image_379": { "need": "other side view (subject facing LEFT); the side panel mirrored, valid for a symmetric character", "source": { "derive": { "from": "image_edit_krea2_quadview", "kind": "image", "ops": [ { "op": "crop", "box": [0.57, 0.0, 0.755, 1.0] }, { "op": "flip" } ] } } } },
  "keepRuntime": false, "estSec": 100,
  "sources": ["https://arxiv.org/abs/2605.10922", "https://github.com/TencentARC/Pixal3D", "https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/3d_pixal3d_multi_views.json", "https://raw.githubusercontent.com/Comfy-Org/workflow_templates/refs/heads/main/input/character_turnaround_4view_sheet.png", "https://comfyui-wiki.com/en/news/2026-09-09-pixal3d-multiview"] }
```

## 3d_mesh_remesh_decimate

**What the model is good at** (with sources): ComfyUI's native post-processing nodes came in PR #14718
("complete DC remesh - QEM decimate - UV unwrap - texture bake", re-implemented after CuMesh/xatlas) and were
refactored in PR #16805. `RemeshMesh` rebuilds messy or non-manifold topology as one closed narrow-band
dual-contouring surface and drops UVs (ComfyUI docs). `DecimateMesh` `midpoint` is the "cumesh-faithful preset
(best quality, preserves thin features)". ★ The empty-output problem is explained in code: remesh works in a
**fixed [-0.5, 0.5] cube** and the mesh is not normalised first (`comfy_extras/mesh3d/postprocess/remesh.py`), so
unit-cube outputs (Pixal3D/TRELLIS) work and millimetre-scale models come back empty. The graph derives remesh
resolution from the target (`max(64, min(1024, round(sqrt(target*2.7)/32)*32))`). The template note says "web
5–20k, game 20–80k" and "30–60° = hard-surface". On this rig: the lantern → a closed 2,000-face shell, target hit
exactly (assessment).

**Showcase idea**: the game-ready step, done on the chair the picture-to-3D card just made (unit-cube scale, so it
cannot hit the empty-mesh trap). 700,000 → 10,000 triangles: a 70× cut into the template's "web" range. At the
default 2,000 the formula gives a 64³ grid, too coarse for the chair's thin legs (about 1.5 voxels thick). 10,000
gives 160³. The sharp-edge angle is 45°, the template's hard-surface advice for a chair made of planks. The
BEFORE/AFTER stat panels the card prints make the reduction concrete.

**Inputs**: `load3dadvanced_model_file_6` — a dense, unit-cube-scaled generated mesh of a hard-surface object —
`output:3d_pixal3d_trellis2_image_to_model` (the chair GLB).

**Expected result / how to judge it**: a GLB plus two text panels. BEFORE ≈ 700,000 faces; AFTER ≈ 10,000 faces
(within a few %). It is one closed shell: four legs present and separate, flat seat and back panels, crisp plank
edges. There are no textures (remesh drops UVs; that is what the next card fixes). If AFTER reads "Faces: 0", the
scale trap fired.

**Risks**: the thin chair legs at 160³ may still get slightly thickened or rounded. The cane back is a thin panel and
may close up or vanish. Both settings are non-default (cost still a few seconds).

**Links to fix**: none (no models). Description precision: "roughly a few units across" should be "the model must
fit inside a 1-unit cube centred on the origin (as Pixal3D/TRELLIS outputs do); anything outside is cut away or
comes back empty", per the code.

```json
{ "workflow": "3d_mesh_remesh_decimate",
  "title": "Turn a 3D model low-poly",
  "summary": "Give it a heavy 3D model and get back a clean, closed, lightweight version at the triangle count you choose, ready for games, the web or 3D printing.",
  "note": "The 700,000-triangle chair from the picture-to-3D card rebuilt as a clean, closed 10,000-triangle model. Read the BEFORE and AFTER panels, then spin it to see what the reduction kept.",
  "params": { "primitiveint_value_2": 10000, "primitiveboolean_value_3": true, "primitiveint_value_4": 2, "primitivefloat_value_5": 45 },
  "inputs": { "load3dadvanced_model_file_6": { "need": "a dense generated mesh at unit-cube scale (Pixal3D/TRELLIS output) of a hard-surface object", "source": "output:3d_pixal3d_trellis2_image_to_model" } },
  "keepRuntime": true, "estSec": 8,
  "sources": ["https://github.com/Comfy-Org/ComfyUI/pull/14718", "https://github.com/Comfy-Org/ComfyUI/pull/16805", "https://docs.comfy.org/built-in-nodes/RemeshMesh.md", "https://raw.githubusercontent.com/Comfy-Org/ComfyUI/master/comfy_extras/mesh3d/postprocess/remesh.py"] }
```

## 3d_mesh_uv_unwrap

**What the model is good at** (with sources): the same native mesh nodes (PR #14718). `UnwrapMesh` "pec" is
parallel-edge-collapse charting on the GPU; "adaptive" is a CPU cost-grow segmentation
(`comfy_extras/mesh3d/uv_unwrap/segment.py`). `RenderUVAtlas` draws each island in its own colour.
`BakeAmbientOcclusion` bakes contact shadows into the UVs and never unwraps itself (ComfyUI docs). The bundle
template's own advice: padding ~4 px at 2048, AO rays "64 = fast, 128–256 = clean". On this rig: the 700k-face
keeper unwrapped with AO in 56 s (assessment). The time tracks triangle count.

**Showcase idea**: finish the pipeline: generate (Pixal3D) → low-poly (remesh) → **UVs + AO**. A game artist unwraps
the 10k low-poly, not the 700k raw mesh, so the UV layout image is legible (fewer, larger islands) and the AO map
shows the chair's joints and the shadow under the seat. Padding 4 px and 128 AO rays follow the template author's
own recommendations for a 2048 atlas. They stay cheap because the input is light.

**Inputs**: `load3dadvanced_model_file_6` — a clean low-poly closed mesh with crevices (joints, overhangs) —
`output:3d_mesh_remesh_decimate` (the 10k-face chair).

**Expected result / how to judge it**: a GLB with UVs, a 2048² UV layout PNG and a 2048² AO PNG. The layout shows
distinct coloured islands, packed with gaps, not one island per triangle. The AO is mostly light with soft dark
gradients where legs meet the seat, under the armrests and in plank joints. Load the GLB: it now carries UVs (the
remesh had dropped them).

**Risks**: if remesh fails (empty), this run is skipped by the suite (input missing), not fed a random mesh.
Algorithmic seams are not artist-placed (template note).

**Links to fix**: none. The description could say what "pec" means (parallel edge collapse, GPU) versus "adaptive"
(slower, CPU).

```json
{ "workflow": "3d_mesh_uv_unwrap",
  "title": "Prepare a 3D model for texturing",
  "summary": "Give it a 3D model and get the same model back ready for painting or texturing, with an image of how its surface was flattened and a map of its soft shadows.",
  "note": "The low-poly chair unwrapped. The colourful image shows how its surface was cut into flat pieces; the grey map shows the soft shadows baked into its joints, ready for texturing.",
  "params": { "primitiveint_value_2": 2048, "unwrapmesh_segmenter_8": "pec", "primitiveint_value_3": 4, "primitiveint_value_4": 128, "primitivefloat_value_5": 1 },
  "inputs": { "load3dadvanced_model_file_6": { "need": "a clean low-poly closed mesh with joints/overhangs for AO to show", "source": "output:3d_mesh_remesh_decimate" } },
  "keepRuntime": true, "estSec": 20,
  "sources": ["https://github.com/Comfy-Org/ComfyUI/pull/14718", "https://docs.comfy.org/built-in-nodes/BakeAmbientOcclusion.md", "https://raw.githubusercontent.com/Comfy-Org/ComfyUI/master/comfy_extras/mesh3d/uv_unwrap/segment.py"] }
```
(`keepRuntime: true`: a 10k-face input runs ~15 s against the 46 s of the 700k-face calibration.)

## audio_stable_audio_3_medium

**What the model is good at** (with sources): Stable Audio 3 Medium (1.4B) makes music, stems/solo instruments and
SFX, 44.1 kHz stereo, up to ~380 s (README; prompting.md). It is post-trained (adversarial) so that "8 steps, CFG
1.0" is the default and higher does not necessarily help (inference.md). It was trained on 1.28M licensed
recordings (AudioSparx + Freesound). Its limits: "not intended to generate intelligible vocals", English
descriptions only (Stability guide; model-overview). The official prompt structure: "start with the genre, name the
main instruments and rhythmic elements, then describe the mood", then arrangement and production. Tempo is written
like "130 BPM" and optional `TrackType: Music, VocalType: Instrumental` tags give "higher coherence"
(stability.ai guide; docs/guides/prompting.md). On this rig: 150 s of music in 6 s (assessment). ★ With the
enhancer **off** (it fails on 0.43.2), the **Category select does nothing**: it only picks the enhancer's system
prompt (`JsonExtractString` → `TextGenerate`).

**Showcase idea**: the card no longer has to feed YuE2 (see below), so it can show what it is uniquely for: a full,
instrumental genre piece written exactly in Stability's documented order. The genre has unmistakable, checkable
instruments: gypsy jazz (jazz manouche, a French tradition the students will recognise). That means a lead acoustic
guitar with fast runs, the percussive "la pompe" rhythm guitar, a violin and an upright bass. Default length and
steps keep the calibration valid. Contrast for students: this card plays instruments; the YuE2 card sings.

**Inputs**: none.

**Expected result / how to judge it**: a 150 s stereo MP3. You can hear two acoustic guitars (one soloing, one
chugging on every beat), a violin answering the guitar, and a plucked double bass, at a fast swing tempo (~180–200
BPM). It has no vocals and no electronic beat. It holds its style for the whole length.

**Risks**: a niche genre may drift toward generic swing jazz or add a drum kit. BPM conditioning is approximate. The
stray "150" text tile (PreviewAny 52:42) still appears next to the result.

**Links to fix**:
- ⚠ The description is stale: "Leave 'Enhance prompt with AI' on…" contradicts the default (off) and the label
  (fails on 0.43.2).
- The category select should say it only matters with the enhancer on.
- `promptGuides` is null. Add https://stability.ai/guides/stable-audio-3-prompt-guide (tip: "genre → main
  instruments and rhythm → mood → production → BPM") and
  https://github.com/Stability-AI/stable-audio-3/blob/main/docs/guides/prompting.md (both 200).
- Licence: Stability AI Community License (free under US$1M revenue).

```json
{ "workflow": "audio_stable_audio_3_medium",
  "title": "Make music or sound effects",
  "summary": "Describe the music, loop or sound effect you want and get it in seconds, up to five minutes long. Instrumental only: it does not sing.",
  "note": "A full 2½-minute gypsy-jazz instrumental from one written description. Listen for the instruments the prompt asks for: the soloing guitar, the chugging rhythm guitar, the violin and the double bass.",
  "params": {
    "description_52_31": "TrackType: Music, VocalType: Instrumental. Gypsy jazz instrumental in the spirit of a 1930s Paris hot-club band, with a virtuosic lead acoustic guitar playing fast swinging runs, a second acoustic guitar keeping the percussive la pompe rhythm on every beat, a violin trading melodies with the guitar and a walking upright bass, joyful, lively and warm, recorded close-up in a small wooden room with a natural acoustic sound, 200 BPM",
    "category_52_43": "Music", "enhance_prompt_52_35": false, "duration_seconds_52_36": 150, "steps_52_3": 8, "seed_52_3": 0 },
  "inputs": {},
  "keepRuntime": false, "estSec": 15,
  "sources": ["https://github.com/Stability-AI/stable-audio-3", "https://github.com/Stability-AI/stable-audio-3/blob/main/docs/guides/prompting.md", "https://huggingface.co/stabilityai/stable-audio-3-medium", "https://stability.ai/guides/stable-audio-3-prompt-guide", "https://docs.comfy.org/tutorials/audio/stable-audio/stable-audio-3.md", "https://blog.comfy.org/p/stable-audio-3-day-0-support"] }
```

## audio_yue2_music_cover

**What the model is good at** (with sources): YuE2 (M-A-P) sings full songs with vocals and accompaniment at 48 kHz.
For covers, SheetSage2 transcribes the recording into an ABC score and YuE2 re-performs it in a new style and with
new lyrics. `melody` mode is "recommended for covers" because it "gives the accompaniment more freedom" (covers.md;
SKILL.md). Benchmarks show that with a score the tune's identity survives and without one it is lost (CLEWS mAP
0.598 vs 0.006, benchmarks.md). Style is natural language: language, genre, vocal, instruments, mood. Lyrics use
`[Verse]`/`[Chorus]` tags and should keep the original syllable counts (covers.md; ComfyUI template note: "For a
simple style-transfer test, keep the original lyrics and only change the Style"). "Transcription errors can carry
into the cover", so a clear sung lead melody is the ideal reference. On this rig: a 150 s sung cover of the Stable
Audio tune in 153 s, "not listened to" (assessment).

**Showcase idea**: cover a **real song with a sung melody and known words**: ComfyUI's own template reference,
`yue2_reference_song.flac`. It is a 99.9 s YuE2 indie-pop song with a warm female vocal; its embedded metadata
carries the exact style and lyrics it was made from. The cover keeps **the same lyrics** (perfect syllable match,
the template's recommended style-transfer test) and moves to a far-away genre and voice: male bluegrass with banjo,
fiddle and mandolin. A student plays both and hears the same tune and words in a different world. That is the
card's whole point, and nothing else in the library does it. It avoids the old example's weak point (an
instrumental Stable Audio track with no clear lead line for SheetSage to transcribe). No BPM is stated, because the
docs say the style's tempo must agree with the transcribed score.

**Inputs**: `loadaudio_audio_45` — a song with one clear sung lead melody, steady meter, 30 s–6 min, whose lyrics we
know — ComfyUI's template input `yue2_reference_song.flac`. It is on disk in `ComfyUI/input`, not in the assets
folder; copy it to `J:\_assets` (or download
https://raw.githubusercontent.com/Comfy-Org/workflow_templates/refs/heads/main/input/yue2_reference_song.flac).
Then `asset:yue2_reference_song.flac`.

**Expected result / how to judge it**: one FLAC of about 90–120 s. A male lead sings "Morning light across the
window…" to the same melody as the reference, and "Run with me into the sunlight" lands on the chorus at the same
place. The arrangement is clearly bluegrass (banjo rolls, fiddle fills, upright bass), with no electric guitars or
synth. All four sections are sung, and the song does not stop abruptly.

**Risks**: YuE2 may truncate before the end token ("status complete does not imply an untruncated song"). It may
skip or repeat a lyric line. The bluegrass tempo may fight an indie-pop score. Listen to the whole file before
publishing. Licence: weights CC BY-NC 4.0 (with a creator permission).

**Links to fix**: none. Both promptGuides and the model urls resolve. Could add the ComfyUI tutorial
https://docs.comfy.org/tutorials/audio/yue2/yue2.md.

```json
{ "workflow": "audio_yue2_music_cover",
  "title": "Cover a song in another style",
  "summary": "Give it a song plus new words or a new style, and it sings the same tune again as a completely different performance.",
  "note": "ComfyUI's own example song (upbeat indie pop, female voice) sung again as bluegrass by a male voice, with the same words and the same tune. Play both one after the other and hum along.",
  "params": {
    "yue2generatemusic_style_33_25": "English, bluegrass, warm male lead vocal with close two-part harmony on the chorus, fast banjo rolls, fiddle, mandolin, upright bass, acoustic guitar, lively front-porch atmosphere, live acoustic recording",
    "yue2generatemusic_lyrics_33_25": "[Verse]\nMorning light across the window\nCity waking down below\nI can hear the streets are calling\nFeels like somewhere we should go\n\n[Chorus]\nRun with me into the sunlight\nLeave the shadows far behind\nWe don't need to know tomorrow\nTonight the whole world feels alive\n\n[Verse]\nRadio playing through the open door\nLaughing like we did before\nEvery mile becomes a memory\nAnd I just want a little more\n\n[Chorus]\nRun with me into the sunlight\nLeave the shadows far behind\nWe don't need to know tomorrow\nTonight the whole world feels alive",
    "sheetsage2audiotoabc_mode_33_41": "melody", "yue2generatemusic_max_duration_33_25": 360, "yue2generatemusic_temperature_33_25": 1, "seednode_seed_33_34": 0 },
  "inputs": { "loadaudio_audio_45": { "need": "a song with one clear sung lead melody and steady meter, with known lyrics (so the cover can keep them)", "source": "asset:yue2_reference_song.flac (copy from ComfyUI/input or workflow_templates; fallback output:audio_stable_audio_3_medium only if it has a clear melodic lead)" } },
  "keepRuntime": false, "estSec": 130,
  "sources": ["https://github.com/multimodal-art-projection/YuE", "https://github.com/multimodal-art-projection/YuE/blob/main/docs/covers.md", "https://github.com/multimodal-art-projection/YuE/blob/main/skills/yue2-music/SKILL.md", "https://github.com/multimodal-art-projection/YuE/blob/main/skills/yue2-music/references/generation-and-covers.md", "https://huggingface.co/m-a-p/YuE2-3B", "https://huggingface.co/Comfy-Org/YuE2", "https://docs.comfy.org/tutorials/audio/yue2/yue2.md", "https://raw.githubusercontent.com/Comfy-Org/workflow_templates/refs/heads/main/input/yue2_reference_song.flac"] }
```

## describe_gemma4_image_description

**What the model is good at** (with sources):
- **Model.** Gemma 4 E4B (4.5B effective) reads images at variable resolution. Google lists object detection,
  document/PDF parsing, chart comprehension, "OCR (including multilingual)", handwriting and pointing. It handles
  35+ languages out of the box (HF card; ai.google.dev vision docs). Google advises a specific request over
  "describe this image".
- **Limits.** Counting dense or tiny objects is approximate.
- **In ComfyUI.** The image budget is fixed at 280 visual tokens (PR #13376 code), so large text is read reliably
  and tiny text less so.
- **On this rig.** It quoted both poster lines exactly ("PHARE DU CAP", "FESTIVAL DES LUMIÈRES") but announced three
  text locations and listed two (assessment).

**Showcase idea**: the round trip that only this card closes: the text-to-image card **writes** words into a
poster, Gemma **reads them back**. The instruction is structured the way Google recommends (specific asks, not
"describe"):
1. A one-line identification.
2. Every piece of text copied exactly, one per line with its position, which fixes last time's "announced three,
   listed two".
3. An English translation of any non-English text (multilingual OCR).
4. Design notes a student can learn from.
5. A reusable prompt (image → prompt).

Large poster lettering suits the 280-token budget.

**Inputs**: `source_image_2` — a poster or cover with several lines of large, legible text (ideally some
non-English) and a clear design — `output:image_ideogram4_t2i`. Fallback if that showcase has no text:
`asset:agora_ecole_de_design1.jpg` (the school's busy atrium; then sections 2–3 should say "no text").

**Expected result / how to judge it**: a text answer with 5 numbered sections. Section 2 lists exactly the strings on
the poster (check spelling, capitals and accents letter by letter against the Ideogram prompt). Section 3 translates
correctly. Section 4 names the real palette and type style. Section 5 is a usable prompt. There is no invented text.

**Risks**: very small text may be skipped or misread (280-token budget). It may still miscount text blocks. As a
generative captioner it can embellish; the instruction asks it not to.

**Links to fix**: `promptGuides` is null. Add https://ai.google.dev/gemma/docs/capabilities/vision (200; tip: "ask
for specific things, e.g. 'copy all text exactly'"). The template note links the E2B card while the bundle runs
**E4B**: https://huggingface.co/google/gemma-4-E4B-it.

```json
{ "workflow": "describe_gemma4_image_description",
  "title": "Describe a picture in words",
  "summary": "Give it a picture and it writes about it: a description, the exact text it can read, or a prompt to make a similar picture.",
  "note": "Gemma reads the poster made by the Ideogram card. It copies every line of text exactly, translates it, describes the design and writes a prompt to recreate it. Check its spelling against the poster.",
  "params": { "instruction_1": "Look carefully at this image and answer in five numbered sections.\n1. What it is, in one sentence.\n2. Text: copy every piece of text you can see exactly as written (same spelling, capitals and accents), one item per line, each followed by where it is (top, centre, bottom, left, right). If there is no text, say so.\n3. Translation: translate any text that is not in English into English.\n4. Design: three or four short bullet points on the layout, the colour palette, the typography and the illustration style.\n5. Prompt: one paragraph that could be given to an image generator to recreate this image.\nDescribe only what you can see; do not invent details.", "seed_1": 0 },
  "inputs": { "source_image_2": { "need": "a poster/cover with several lines of large legible text (ideally some non-English) and a clear graphic design", "source": "output:image_ideogram4_t2i (fallback asset:agora_ecole_de_design1.jpg)" } },
  "keepRuntime": false, "estSec": 25,
  "sources": ["https://huggingface.co/google/gemma-4-E4B-it", "https://ai.google.dev/gemma/docs/capabilities/vision", "https://ai.google.dev/gemma/docs/core", "https://blog.google/innovation-and-ai/technology/developers-tools/gemma-4/", "https://github.com/Comfy-Org/ComfyUI/pull/13376"] }
```

## describe_gemma4_video_description

**What the model is good at** (with sources): Gemma 4 understands video "by processing sequences of frames" (HF card;
ai.google.dev video docs: max ~60 s at one frame per second). ★ In ComfyUI, `TextGenerate` subsamples to **1 fps
assuming 24 fps** and labels frames 00:00, 00:01… (`nodes_textgen.py` tooltip; PR #13376 code). A 25/30 fps clip
therefore drifts, and there is no frame cap. This graph does not connect the clip's audio, although E4B has audio
input. On this rig: on the Pika clip it got the keeper, raincoat, lantern, spray and camera right, but "invents a
face mask and gets her direction of travel wrong" (assessment).

**Showcase idea**: ask for what the model actually sees, a **second-by-second log**, on a clip whose content changes
in clear, checkable stages and that is 24 fps so the timestamps are true. The Wan 4-key-frames video is ideal: 76
frames at 24 fps → Gemma samples frames 0/24/48/72, which are almost exactly the card's four key frames (0/25/50/75).
So its timeline can be checked against four pictures a student can see in that example's inputs. The instruction
fights both documented failures: "describe only what you can see, say 'unclear'" (the invented mask), and "say the
direction relative to the camera" (the wrong direction).

**Inputs**: `source_video_6` — a 3–6 s, 24 fps clip whose content passes through 3–4 distinct, visible stages —
`output:video_wan22_4_key_frames`. Fallback: `output:video_ltx2_5_t2v` (any 24 fps clip with a multi-beat action).

**Expected result / how to judge it**: a text answer with a timeline of 4 lines (00:00–00:03 for the Wan clip). Each
line matches the corresponding key frame (e.g. day → winter → stormy night → poster style in last suite's design)
and names what changed. Then a 2-sentence summary. Nothing is described that is not in the frames, and there is no
mention of sound.

**Risks**: with only ~4 sampled frames, short events between samples are invisible to it. It may still embellish
style words. If the Wan showcase is changed to something without clear stages, use the fallback.

**Links to fix**: `promptGuides` is null. Add https://ai.google.dev/gemma/docs/capabilities/vision/video (200). The
description should state "it looks at about one frame per second and does not hear the sound" (both verified in
code). Link the E4B card as above.

```json
{ "workflow": "describe_gemma4_video_description",
  "title": "Describe a video in words",
  "summary": "Give it a short video and it writes what happens, second by second. It looks at about one frame per second and does not hear the sound.",
  "note": "Gemma watches the key-frame video one frame per second and writes a second-by-second log. Compare its timeline with the four pictures the video was made from.",
  "params": { "instruction_1": "Watch this video from start to end.\n1. Timeline: write one line per second, starting with the time (00:00, 00:01, ...), saying what you can see at that moment and what has changed since the previous second: the subject, any action and its direction relative to the camera, the camera, the light, the weather and the style of the picture.\n2. Summary: describe the whole clip in two sentences.\nDescribe only what is visible in the frames. If something is unclear, write 'unclear' instead of guessing. Do not describe sound.", "seed_1": 0 },
  "inputs": { "source_video_6": { "need": "a 3-6 s, 24 fps clip that passes through 3-4 distinct, checkable visual stages", "source": "output:video_wan22_4_key_frames (fallback output:video_ltx2_5_t2v)" } },
  "keepRuntime": false, "estSec": 30,
  "sources": ["https://huggingface.co/google/gemma-4-E4B-it", "https://ai.google.dev/gemma/docs/capabilities/vision/video", "https://github.com/Comfy-Org/ComfyUI/pull/13376"] }
```

---

## New derive features this group needs (for the integrator)

1. **Derive from an asset**: `{"from": "asset:<file>", "kind": "image"|"video", "ops": […]}`. Today
   `_resolveSuiteParams` treats `asset:` as a direct file and derives only from a workflow output. Used by the 4
   image restorers and the 4 video utilities.
2. **Image ops** (`derive_input.py`, output stays PNG):
   - `jpeg {quality}`: encode the current image as JPEG in memory with PIL (default 4:2:0 subsampling) at that
     quality, decode it back and continue, so block artefacts are baked into the PNG.
   - `noise {sigma, seed}`: add Gaussian noise of σ (0–255 scale) per RGB channel using
     `numpy.random.default_rng(seed)`, then clip to 0–255. The seed makes the input reproducible across suite runs.
3. **Video ops** (video in → `.mp4` out, PyAV, which ComfyUI's python already has; a chain must start from a video):
   - `trim {start, duration}`: keep [start, start+duration) seconds, and the audio for the same span.
   - `vscale {factor}`: resize every frame by factor with Lanczos, rounding to even width and height (H.264 needs
     even dimensions).
   - `mute {}`: drop the audio stream.
   - `encode {crf}`: final write as H.264 yuv420p at that CRF, same fps as the source. Use crf 16 for a "clean"
     re-encode and 34–36 for visible compression blocking. If a chain has no `encode`, write at crf 16.
   - `--check` should accept these op names, and `kind` must say the source is a video.
4. **A file outside the assets folder**: copy `ComfyUI/input/yue2_reference_song.flac` (ComfyUI's template input) into
   `J:\_assets`. It is not a ComfyQ file, so the clone wipe leaves `ComfyUI/input` alone, but the suite reads assets.
5. **Restarts**: `utility_seedvr2_7b_int8_image_upscale` masks `fp16_accumulation`; `utility_qwen_2511_unblur_upscale`
   masks Sage. Sequence them next to other bundles with the same mask to save ComfyUI restarts.

## Upstream inputs this group needs

| needed by | producer (card) | what it must contain | notes |
|---|---|---|---|
| `utility_pid_image_upscale` | `image_qwen_image_2_1_t2i` (another group) | its showcase picture as is: clean, ~1 MP, ideally 16:9 with fine structure or small lettering | Qwen-Image is PiD's matched latent family. Any Qwen 2.1 showcase works. |
| `describe_gemma4_image_description` | `image_ideogram4_t2i` (another group) | a poster/cover with several lines of **large** legible text, ideally some non-English (French) | Its own showcase (text rendering) should already satisfy this. If it has no text, use the fallback asset. |
| `3d_pixal3d_multi_views` | `image_edit_krea2_quadview` (another group) | the quadview sheet in its usual layout (face \| front \| side \| back). The **input character** given to the quadview should be full-body, bilaterally symmetric, with a back clearly different from the front (hood, seams, backpack or braid) | Re-measure the four crop boxes if the layout changes. |
| `describe_gemma4_video_description` | `video_wan22_4_key_frames` (another group); fallback `video_ltx2_5_t2v` | a 24 fps clip with 3–4 distinct visible stages (the 4 key frames) | 24 fps makes Gemma's 1-fps samples land on the key frames. |
| `3d_mesh_remesh_decimate` | `3d_pixal3d_trellis2_image_to_model` (this group) | the chair GLB (unit-cube scale) | Chain inside g6. |
| `3d_mesh_uv_unwrap` | `3d_mesh_remesh_decimate` (this group) | the 10k-face chair GLB | Chain inside g6. If remesh fails, this run is skipped (correct). |

**Decoupled on purpose:** `audio_yue2_music_cover` no longer reads `audio_stable_audio_3_medium`. An instrumental
Stable Audio piece has no clear sung lead for SheetSage to transcribe. ComfyUI's own sung reference song (known
lyrics) makes a far clearer cover, and Stable Audio is free to show off a genre piece. If the integrator wants to
keep the chain, the fallback is noted on the YuE2 input. Its gypsy-jazz violin/guitar lead is melodic, but fast
swing runs will transcribe worse.

**All other inputs are assets already on disk** (checked and viewed):
- `Mariette1.jpg`
- `Woman.png`
- `original.mp4`
- `2795750-uhd_3840_2160_25fps_1_1.mp4`
- `3044160-uhd_3840_2160_24fps_5_1.mp4`
- `6504516c0115ed9b83b2d82e1d94c4ec.webp`
- `ComfyUI_00013_.png`
- `agora_ecole_de_design1.jpg` (fallback only)

Estimated GPU time for the 17 runs is about 14 minutes, plus two ComfyUI restarts for the flag masks.
