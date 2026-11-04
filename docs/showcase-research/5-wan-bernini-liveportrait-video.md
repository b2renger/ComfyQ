# g5_wan_liveportrait — showcase test cases

Group: `video_wan22_4_key_frames`, the three Bernini-R video cards, `video_edit_wan21_scail2_character_replacement`,
`video_edit_wan_animate2`, the two ID-V2V cards, `video_liveportrait_image2video`.

Everything below was checked against the bundles as they are on `main` at `9c2c816` (2026-11-04, the
card-links commit landed while this was being written; its renamed-repo URLs are already in the metas).
Asset contents were checked by decoding them (contact sheets, frame counts, fps, audio level), not by
filename. Nothing in `J:\ComfyQ` was edited and no ComfyUI job was run.

## Read this first — five findings that change how these runs must be written

1. ★★★ **The Bernini "Edit type" dropdown is inert in ComfyQ (all five Bernini cards, video and image).**
   The system-prompt line is chosen by `CustomCombo`'s **INDEX** output (`76:54.1` → `76:57:56` →
   `RegexExtract`). ComfyUI's backend `CustomComboNode.execute(choice, index)` simply returns the
   `index` **input** (comfy_extras/nodes_logic.py:238) — in the ComfyUI editor the frontend updates that
   widget when you pick a choice, but ComfyQ only writes `choice`. So whatever a student picks, the plain
   card always sends the "Style / Motion" line (index literal 11) and the reference cards always send the
   "with reference" line (literal 8). The STRING output (the choice) is consumed by nothing.
   **Fix (meta only, existing mechanism):** add `linkedValues` to each `customcombo_choice_*` param:
   `{nodeId:"76:54", field:"index", map:{"Default":0,"Text to Image":1,"Text to Video":2,"Image Editing":3,
   "Subject to Image":4,"Image to Video":5,"Video Editing":6,"Video Editing (Content Propagation)":7,
   "Video Editing with Reference":8,"Ads / Content Insertion":9,"Video Editing (Action / Position)":10,
   "Video Editing (Style / Motion)":11}}` (index = option number − 1; node `117:54` on the autoprompt card).
   The showcases below were chosen so they still work if the fix is not in yet.
2. ★★ **API literals that drift from the meta default** — the suite (and every calibration) runs the
   literal for any key it does not send, so these must be sent explicitly or fixed:
   `video_wan22_4_key_frames` prompts (`140:6` literal `"cat turn around"`, `228:225`/`245:242` empty —
   the meta's capoeira prompts never ran in a calibration); `video_edit_bernini_r_video_editing`
   width/height literal **480×832** vs meta 832×480 (this is why the 11-03 run "came out portrait from a
   landscape source"); `video_edit_wan21_scail2_character_replacement` SAM3 target literal
   `"girl, handkerchief"` vs meta `"person"`; both ID-V2V prompts literal `"two people dancing"`.
   Every run below sends every non-media key it relies on.
3. ★★ **Every one of these graphs centre-CROPS its video to width × height** (`BerniniConditioning` uses
   `common_upscale(..., "center")`, SCAIL/Animate `ResizeImageMaskNode crop:center`, ID-V2V
   `ImageResizeKJv2 keep_proportion:crop`, Wan FLF2V `"center"`). The assets' dancer clips are **720×720
   squares** despite their `uhd_3840_2160` filenames. A landscape/portrait default on a square clip cuts
   heads, feet and arms — the 11-03 Wan Animate failure ("she leaves the frame") and the Bernini-with-
   reference failure (a 1280×704 clip squeezed through 832×832) were both this. Sizes below always
   match the source's shape.
4. ★ **Two frame-rate bugs** (graph edits, flagged, not used as parameters):
   `video_wan22_4_key_frames` saves at **24 fps** (`145 CreateVideo`) while Wan 2.2 A14B generates at
   **16 fps** (`sample_fps = 16`, Wan2.2 `shared_config.py`; the per-segment `CreateVideo` nodes inside
   the same graph also say 16) → the animation plays 1.5× too fast. `video_liveportrait_image2video`
   reads the driving clip at its native rate (`force_rate 0`, d6.mp4 = 30 fps) but writes **16 fps**
   (`168 VHS_VideoCombine`) → the result plays at 0.53× speed (128 frames = 4.3 s of driving become 8 s).
   Fix: `frame_rate` 16 on the Wan save, and on LivePortrait either `force_rate: 16` on the loader or
   `frame_rate` = source fps on the combine.
5. ★ **`2795750-uhd_3840_2160_25fps_1_1.mp4` (the rooftop dancer) has an AAC track that is digital
   silence** (peak 0.0003). The 11-03 note "Wan Animate … the soundtrack is silent" was the input, not the
   card. Cards that copy source audio (Bernini, SCAIL, Animate) will be silent on it — expected.

### The cast used across this group (so the examples teach by contrast)

- **Dancer A** — `asset:2795750-uhd_3840_2160_25fps_1_1.mp4`: a bearded man in a black hoodie with red
  sleeve bands dancing hard (squats, hands up, fist pump) on a grey rooftop, brick chimney, handheld
  orbiting camera. 720×720, 25 fps, 8.7 s, silent audio.
- **Dancer B** — `asset:3044160-uhd_3840_2160_24fps_5_1.mp4`: a young Black woman, red headwrap, black
  leather biker jacket, yellow plaid shirt-dress, orange tiger-striped leggings, dancing gently in a
  brutalist concrete plaza. 720×720, 24 fps, 17 s, no audio. **Its frame 0 is byte-for-byte the
  rig's verified ID-V2V demo frame** (`ComfyUI/input/idv2v_demo_frame0.png`, mean diff 1.0/255).
- **Wheat-field clip** — `asset:original.mp4`: a long-haired person in a cream cropped knit sweater over a
  dark floral shirt, swaying in tall grass under a grey sky, low angle. 720×720, **16 fps (Bernini's own
  training rate)**, 8.75 s, no audio.
- **Face clip** — `asset:d6.mp4`: a woman pulling big faces (eye darts, crossed eyes, grimaces, teeth,
  "O" mouth), neutral frontal first frame, plain wall. 480×480, 30 fps, 33.6 s, real audio.

What each video-edit card is then shown doing, with the same people:
**ID-V2V** keeps Dancer B and her moves, changes the *look of the whole clip*; **SCAIL-2** keeps Dancer
A's *scene and moves* and swaps *him* for Dancer B; **Wan Animate** keeps only Dancer A's *moves* — Dancer
B performs them in a *new place written in text*; **Bernini** changes *one garment* in the wheat-field clip
— by words (plain card) or from a photo (reference card); **Bernini autoprompt** moves Dancer B's dance
*into a picture's world*.

---

## video_wan22_4_key_frames

**What the model is good at** (with sources): Wan 2.2 A14B image-to-video run as first/last-frame
(`WanFirstLastFrameToVideo`) three times — key 1→2, 2→3, 3→4 — on the 4-step lightx2v LoRAs, then
stitched. A14B is a two-expert MoE: the high-noise expert lays out the motion, the low-noise expert
refines detail ([Wan2.2 README](https://github.com/Wan-Video/Wan2.2)); native 81 frames at 16 fps
([shared_config.py](https://github.com/Wan-Video/Wan2.2/blob/main/wan/configs/shared_config.py)). ComfyUI
ships this as "Multi-Keyframe Video Stitching — auto fills in the motion between frames" (template
`templates-6-key-frames`, whose demo is a cat-in-a-suit turning into Magritte's *Son of Man* through six
stills). What no other card in the library does: **steer a trajectory through more than two poses**, with
a separate motion description per gap. The card's own description: "If you are targetting an animation
you need to provide a detailled prompt, with context (see the default prompts)."

**Showcase idea**: *Classical key-frame animation from a student's own sketches.* The assets folder holds
the four sketches the card's default prompts were written for — `J:\_assets\Keyframes\` — red-marker
drawings of a capoeira *meia lua de compasso* on paper: (1) leaning stance, (2) bent forward, hands to the
floor, (3) leg sweeping out, (4) standing in *ginga*, seen from behind. Feed them with the card's own
three motion prompts and the in-betweens appear — the thing an animator would otherwise draw by hand.
This is a better showcase than the 11-03 "day → winter → storm → poster" morph, which any first/last-frame
card can half-do; here the *motion between poses* is the content, and four keys are needed to get it.
The sketches are photographed on paper (9:16, 2304×4096) with a circled number at the top and a dark
band of table at the top of two of them — cropped away (verified render: `crop [0,0.16,1,0.91]` →
2304×3072, exactly 3:4, no numbers, no dark band, all four figures whole) and generated at **624×832**
(3:4, multiples of 16, 519 k px ≈ the default 720×720's 518 k px → same cost). A square 720×720 would
centre-crop the 3:4 page and cut figure 4's feet.

**Inputs**:
- `loadimage_image_62` — sketch ① (leaning stance) — `Keyframes/IMG_2026-06-23-11-34-04-060.jpg`, crop
  `[0,0.16,1,0.91]`, scale 0.34 (→ 783×1044)
- `loadimage_image_122` — sketch ② — `Keyframes/IMG_2026-06-23-11-34-08-465.jpg`, same derive
- `loadimage_image_124` — sketch ③ — `Keyframes/IMG_2026-06-23-11-34-13-198.jpg`, same derive
- `loadimage_image_126` — sketch ④ — `Keyframes/IMG_2026-06-23-11-34-16-318.jpg`, same derive
  ⚠ Needs two NEW suite capabilities (see the last section): `asset:` cannot reach a sub-folder today
  (`_namedAsset` requires `dirname === assetsDir`), and `derive` only applies to workflow outputs.

**Expected result / how to judge it**: 76 frames (3 × 25 + 1), 624×832. Frame 0 = sketch ①, ~frame 25 =
②, ~50 = ③, last = ④. Between ② and ③ the leg visibly sweeps out in an arc (not a cross-fade); between ③
and ④ the figure rises and turns its back. The figure stays a red-line drawing on paper throughout — no
shading, no photoreal body, no dissolving lines. Silent. At the current 24 fps it lasts 3.2 s (4.75 s once
the fps fix is applied).

**Risks**: line art can shimmer or "boil" between keys; the prompts say "plain white background" while
the paper is beige-grey, so the middle of a segment may brighten slightly (kept: they are the card's
tested defaults). Duplicate frames at each join (each segment re-includes its start key, and node 135
appends key ④ after segment 3 already ends on it) give a one-frame hold at each key. Fallback if the
sketch run disappoints: the official template's idea — four stills of one transforming subject made by
an image-edit card applied repeatedly.

**Links to fix**: none dead. Suggest `promptGuides`: ComfyUI's Wan 2.2 FLF2V page
https://docs.comfy.org/tutorials/video/wan/wan2_2. Graph: final `CreateVideo` fps 24 → 16 (finding 4).

```json
{ "workflow": "video_wan22_4_key_frames",
  "title": "Animate through four key frames",
  "summary": "Give it four pictures in order and a sentence on how to move from each one to the next; it draws the motion in between and returns one smooth silent clip. Pick it when two pictures (a start and an end) are not enough.",
  "note": "Four quick marker sketches of a capoeira kick, photographed on paper, became the key frames; the card drew every pose in between. Watch the leg sweep out between drawings 2 and 3 — that motion was never drawn, only described.",
  "params": {
    "loadimage_image_62": "<sketch 1 — see inputs>",
    "loadimage_image_122": "<sketch 2>",
    "loadimage_image_124": "<sketch 3>",
    "loadimage_image_126": "<sketch 4>",
    "cliptextencode_text_140_6": "Red minimalist line art animation of a man performing a capoeira meia lua de compasso. From a standing leaning stance, the man smoothly bends forward at the waist. His torso rotates downward toward the floor as his hands reach down to plant firmly onto the ground for support. His back begins to arch, and his weight shifts entirely onto his hands and pivoting front foot, preparing to unleash the spinning kick. Fluid transition, clean red lines on a plain white background.",
    "cliptextencode_text_228_225": "Red minimalist line art animation of a capoeira spinning kick. With both hands firmly planted on the ground, the man whips his trailing leg upward and outward in a powerful, sweeping horizontal arc. The kicking leg extends fully, cutting through the air in a wide, circular crescent motion. His head looks backward under his arm to track the target. Dynamic motion blur on the sweeping leg, clean red lines on a solid white background.",
    "cliptextencode_text_245_242": "Red minimalist line art animation completing a capoeira movement. The sweeping leg completes its wide circular trajectory, slowing down as it approaches the ground. The man pushes off the floor with his hands, lifting his torso and rotating his upper body back upright. He fluidly transitions out of the inverted position, bringing his feet back underneath him to stand firmly in a defensive capoeira ginga stance from behind. Clean red ink style, seamless transition on a plain white background.",
    "primitiveint_value_283": 624,
    "primitiveint_value_284": 832
  },
  "inputs": {
    "loadimage_image_62":  { "need": "key pose 1 of 4, one figure, same drawing style and framing as the others, 3:4 portrait", "source": "NEW:derive-on-asset {asset:'Keyframes/IMG_2026-06-23-11-34-04-060.jpg', derive:[{op:'crop',box:[0,0.16,1,0.91]},{op:'scale',factor:0.34}]}" },
    "loadimage_image_122": { "need": "key pose 2", "source": "NEW:derive-on-asset {asset:'Keyframes/IMG_2026-06-23-11-34-08-465.jpg', same derive}" },
    "loadimage_image_124": { "need": "key pose 3", "source": "NEW:derive-on-asset {asset:'Keyframes/IMG_2026-06-23-11-34-13-198.jpg', same derive}" },
    "loadimage_image_126": { "need": "key pose 4", "source": "NEW:derive-on-asset {asset:'Keyframes/IMG_2026-06-23-11-34-16-318.jpg', same derive}" }
  },
  "keepRuntime": false, "estSec": 61,
  "sources": ["https://github.com/Wan-Video/Wan2.2", "https://github.com/Wan-Video/Wan2.2/blob/main/wan/configs/shared_config.py", "https://docs.comfy.org/tutorials/video/wan/wan2_2"] }
```

---

## video_edit_bernini_r_video_editing

**What the model is good at** (with sources): Bernini-R is ByteDance's renderer-only Bernini, a Wan 2.2
A14B fine-tune with in-context conditioning: the source video's VAE latents ride along as context, so it
edits *what you name* and keeps the rest pixel-faithful ([bytedance/Bernini](https://github.com/bytedance/Bernini);
paper [arXiv 2605.22344](https://arxiv.org/abs/2605.22344): "the renderer also receives … source VAE
features for detail preservation"). Its docs recommend it "where output consistency matters more than
complex instruction following" ([docs/bernini_r.md](https://github.com/bytedance/Bernini/blob/main/docs/bernini_r.md)).
The official v2v test cases are **local edits**: *add* a snowman beside a dog on a snowy road; *replace* a
white humanoid robot with a robot dog "preserving the dark studio background, lighting, reflections";
*change the motion* of a person to a crouch ([assets/testcases/v2v](https://github.com/bytedance/Bernini/tree/main/assets/testcases)).
Its own prompt-enhancer template lists replacement, addition, removal, colourisation, stylisation, camera
moves, and fixes the prompt form: **"Modifications … Preservations: explicitly describe the key visual
elements … that MUST remain unchanged"** ([prompt_enhancer.py](https://github.com/bytedance/Bernini/blob/main/bernini/prompt_enhancer.py)).
Training defaults: 848×480, 81 frames at 16 fps ([gradio_demo.py](https://github.com/bytedance/Bernini/blob/main/gradio_demo.py)).
The prompt is `system line + your text` with no separator — the official `prompt = system_prompt +
_prompt_clean(prompt)`, so the graph's empty `StringConcatenate` delimiter is correct.

**Showcase idea**: *One garment recoloured in a moving clip, everything else untouched* — a "colourway"
test, the most design-student use of the card, and the thing the library's restyle cards (LTX IC-LoRA,
MiniMax ControlNets) cannot do, because they regenerate the whole frame. The 11-03 suite asked it for a
global claymation restyle — the job those cards do better — and gave it a 1280×704 clip at the 480×832
literal, so it came back portrait and only "clay-ish". This run instead: the **wheat-field clip** (16 fps
— Bernini's training rate, so 5 s = 80 frames ≈ the trained 81), **832×832** (square source → square
canvas; 832 is the square size the autoprompt card's description says Bernini was trained on), prompt in
the official "Replace … Keep … unchanged" form. A recolour works under either system line (finding 1:
until the fix, the literal "style, lighting, colors, textures" line is sent, which suits it).

**Inputs**: `loadvideo_file_47` — one clearly visible person in a moving shot, a large single-colour
garment, a calm background — `asset:original.mp4`.

**Expected result / how to judge it**: 832×832, ~77 frames at 16 fps (≈ 4.8 s). The cropped knit
sweater is **bright red in every frame**, still chunky cable-knit with the same folds and frayed edges,
moving with the arms. Unchanged against the source: the face, long dark hair, dark floral shirt and black
sleeves, necklaces, grass, grey sky, low camera angle. No flicker; red does not bleed onto the floral
shirt or the grass. The output is square (not portrait).

**Risks**: Turbo (6 steps) is "fast preview" per the template note — texture may soften; red could spill
onto the floral shirt's red flowers; hair crossing the sweater may tint.

**Links to fix**: none dead. **Meta bugs**: width/height literal 480×832 ≠ meta default 832×480
(finding 2) — set the literal to 832×480; give both params `min 256, max 1280, step 16` (the node's step
is 16); the width label has a trailing space. Description: add "the video is centre-cropped to width ×
height — match your clip's shape (square → 832×832)"; and note the Edit-type dropdown only works once the
`linkedValues` fix lands. Suggest `promptGuides`: https://github.com/bytedance/Bernini/tree/main/assets/testcases
(official example prompts).

```json
{ "workflow": "video_edit_bernini_r_video_editing",
  "title": "Change one thing in a video",
  "summary": "Upload a short clip and say in words what to change — a colour, an object, the sky — and the clip comes back with only that changed, the people, their moves and the scene left as they were. Keep clips to a few seconds; it takes several minutes.",
  "note": "One sentence turned the cream sweater bright red. Compare with the original: the face, the hair, the grass, the sky and every movement are the same — only the sweater changed.",
  "params": {
    "loadvideo_file_47": "asset:original.mp4",
    "customcombo_choice_76_54": "Video Editing",
    "primitiveboolean_value_76_70": true,
    "primitivestringmultiline_value_76_114": "Replace the person's cream cable-knit cropped sweater with a bright red knit sweater of the same chunky texture, cut and loose fit, its sleeves, folds and frayed edges moving exactly as the original does while the person sways and stretches their arms in the wind. A person with long dark wavy hair stands in tall dry grass under an overcast grey sky, seen from a low angle, wearing the bright red knit sweater over a dark floral shirt with black sleeves and a few thin necklaces. Keep the person's face, long hair, the floral shirt, the necklaces, the grass, the sky, the lighting, the camera framing and all motion exactly unchanged.",
    "video_slice_duration_109": 5,
    "berniniconditioning_width_76_50": 832,
    "berniniconditioning_height_76_50": 832
  },
  "inputs": {
    "loadvideo_file_47": { "need": "a 5 s clip of one person moving, a large single-colour garment, square to match 832x832", "source": "asset:original.mp4" }
  },
  "keepRuntime": true, "estSec": 290,
  "sources": ["https://github.com/bytedance/Bernini", "https://github.com/bytedance/Bernini/blob/main/docs/bernini_r.md", "https://github.com/bytedance/Bernini/tree/main/assets/testcases", "https://github.com/bytedance/Bernini/blob/main/bernini/prompt_enhancer.py", "https://github.com/bytedance/Bernini/blob/main/gradio_demo.py", "https://arxiv.org/abs/2605.22344"] }
```
`keepRuntime: true` — 832×832 is not the card's 832×480 default, and a 16 fps clip has fewer frames than
a typical phone clip, so this timing must not replace the 11-03 calibration (231 s at 121 frames).

---

## video_edit_bernini_r_video_editing_with_reference

**What the model is good at** (with sources): the same renderer in its **rv2v** task — source video +
reference image(s) as separate in-context streams at their own aspect (`BerniniConditioning`, long edge
capped at 848). ComfyUI's template note names the job outright: **"Video Editing with Reference (rv2v) —
outfit / look swap"**, with the tip "flat-lay outfit refs are harder than on-person reference photos" and
the example "Replace the person's clothing with the full outfit from the reference image … Keep pose,
framing, lighting, background, and motion unchanged." The official rv2v case is exactly that: a shirt
on a hanger becomes the shirt a young man wears while he moves
([rv2v_case1.json](https://github.com/bytedance/Bernini/tree/main/assets/testcases/rv2v); output checked:
480×848, 81 frames, 16 fps). The enhancer's rv2v rules: "Faithful reference appearance … Preserve
unchanged elements explicitly" ([prompt_enhancer.py](https://github.com/bytedance/Bernini/blob/main/bernini/prompt_enhancer.py)).
Ads/Content Insertion (`ads2v`) officially takes a reference **video** ("Add the video on the computer");
this card only has an image input, so that option is the rv2v conditioning with a different first line.

**Showcase idea**: *Try an outfit from a photo on someone in a moving clip.* The 11-03 run asked for "the
look of the poster" (a style match, not what rv2v was trained for) on a landscape clip squeezed through the
832×832 square, and it changed only the sky. Here: the **same wheat-field clip as the plain card** (so a
student can compare "described in words" vs "shown in a photo"), the card's default **832×832** (square
source ✓), and an **on-person** garment reference: Dancer B's black leather biker jacket over the yellow
plaid shirt, cropped to the torso so her face and headwrap cannot be copied. Instruction written in the
official rv2v form (edit + description of the result + explicit preservation).

**Inputs**:
- `loadvideo_file_47` — same clip as the plain card — `asset:original.mp4`
- `loadimage_image_104` — a photo of a garment worn by a person, strong colour/pattern, no face in frame —
  Dancer B's frame 0 cropped to `[0.12,0.25,0.80,0.62]` (verified crop: jacket + plaid, chin just out;
  ~490×300 px, below the 848 cap so it is used as is)

**Expected result / how to judge it**: 832×832, ~77 frames at 16 fps. In every frame the long-haired
person wears an **open black leather biker jacket over a yellow-and-black plaid shirt** in place of the
cream knit sweater; leather creases follow the arm stretches. Face and long hair unchanged — **no red
headwrap, no change of identity**; grass, sky, low angle unchanged. Fail = the reference pasted in as a
flat patch or collage (the documented failure of the *image* sibling), or the whole scene restyled.

**Risks**: Turbo is below the official 40-step quality for outfit swaps (template note: "turn Turbo OFF
for … outfit swap" — not affordable here, ~13× the time); the plaid scale may drift; a cropped reference
loses the sleeve ends.

**Links to fix**: none dead. Meta: same `linkedValues` fix (index literal 8); description should say the
video is centre-cropped to 832×832 by default (match your clip's shape: 832×480 / 480×832), that the card
is for outfit/look swaps (not style matching), and that "Ads / Content Insertion" with a still picture is
not Bernini's ads task (that takes a second video). Suggest `promptGuides`: the rv2v test case
https://github.com/bytedance/Bernini/tree/main/assets/testcases.

```json
{ "workflow": "video_edit_bernini_r_video_editing_with_reference",
  "title": "Copy an outfit onto a video",
  "summary": "Give it a clip of a person and a photo of clothes — worn by someone or on a hanger — and the person in the clip comes back wearing them, with the same face, moves and scene. Takes several minutes; keep clips short.",
  "note": "Same clip as the 'change one thing' card, but this time the new clothes come from a photo: the jacket and plaid shirt of another dancer. The face, hair, grass and sky stay the same — only the outfit is swapped.",
  "params": {
    "loadvideo_file_47": "asset:original.mp4",
    "loadimage_image_104": "<derived — see inputs>",
    "primitiveboolean_value_76_70": true,
    "customcombo_choice_76_54": "Video Editing with Reference",
    "primitivestringmultiline_value_76_114": "Replace the person's cream knit sweater and dark floral shirt with the outfit from the reference image: a black leather biker jacket worn open over a yellow-and-black plaid shirt, appearing naturally worn on the body with realistic leather creases and fabric drape that follow every arm movement. A person with long dark wavy hair sways and stretches their arms in tall dry grass under an overcast grey sky, seen from a low angle, now wearing the black leather biker jacket with silver zips over the yellow plaid shirt. Keep the person's face, long hair, the grass, the sky, the lighting, the camera framing and all motion exactly unchanged.",
    "video_slice_duration_109": 5,
    "berniniconditioning_width_76_50": 832,
    "berniniconditioning_height_76_50": 832
  },
  "inputs": {
    "loadvideo_file_47": { "need": "same 5 s single-person clip as the plain Bernini card", "source": "asset:original.mp4" },
    "loadimage_image_104": { "need": "an on-person photo of a distinctive garment, torso only, no face", "source": "NEW:derive-on-asset {asset:'3044160-uhd_3840_2160_24fps_5_1.mp4', kind:'video', derive:[{op:'frame',index:0},{op:'crop',box:[0.12,0.25,0.80,0.62]}]}" }
  },
  "keepRuntime": true, "estSec": 330,
  "sources": ["https://github.com/bytedance/Bernini/tree/main/assets/testcases", "https://github.com/bytedance/Bernini/blob/main/bernini/prompt_enhancer.py", "https://github.com/bytedance/Bernini/blob/main/gradio_demo.py", "https://huggingface.co/Comfy-Org/Bernini-R"] }
```
`keepRuntime: true` — 80 frames (16 fps source) instead of the 121 the 11-03 calibration (626 s) timed;
a cheaper input must not replace it.

---

## video_edit_bernini_r_video_editing_ref_autoprompt

**What the model is good at** (with sources): Bernini-R rv2v again, with the instruction written by
Gemma 4: node 131 describes the video, 129 the reference, and 133 combines them under the card's own brief
(`stringconcatenate_string_a_135`): *"The final video should keep the movement of the video and import the
character and the setting of the reference image."* That is the official Bernini recommendation for
quality — Bernini-R has no planner, "for official-quality long prompts, see `--use_pe`" (the template
note; [bytedance/Bernini](https://github.com/bytedance/Bernini) README recommends the prompt enhancer).
The 11-03 run proved the mode: "moved the walk into the ice-lighthouse picture convincingly" — at 822 s,
the slowest run in the library (Gemma reads every one of 121 frames).

**Showcase idea**: *Replay a real dance inside a picture.* Source = **Dancer B** (gentle, readable
moves); reference = `input.jpg`, a woman in a flowing white dress reaching up in a misty field of
translucent glass flowers — one picture that carries **both a character and a setting**, which is what
this card imports (the plain reference card imports clothes; Wan Animate takes its setting from text).
Square source + square reference → the default 832×832 crops nothing. **Clip length 3 s** (72 frames at
24 fps, close to Bernini's trained 81) instead of 5: it halves the cost of the library's most expensive run
and stays inside the model's training length.

**Inputs**:
- `loadvideo_file_115` — one person dancing, clear full-body moves, square — `asset:3044160-uhd_3840_2160_24fps_5_1.mp4`
- `loadimage_image_123` — a single picture showing a character in a distinctive setting — `asset:input.jpg`

**Expected result / how to judge it**: 832×832, ~69 frames (~2.9 s at 24 fps). A dancer in a **flowing
white dress among glass flowers under a misty sky** performs Dancer B's sway and arm-waves in time (the
arm sweep near 1 s). No concrete wall, no plaid, no tiger leggings. The written instruction can be read in
the job's parameters. Fail = the original plaza with a white tint, or a still picture that barely moves.

**Risks**: Gemma may over- or under-describe (its instruction is not shown to the student before the
run); a gender-matched swap was chosen to keep the replacement simple; the first frame may stay closer to
the source than later frames.

**Links to fix**: none dead. Meta: `linkedValues` fix (node `117:54`, literal 8); the exposed
"String A (Concatenate Text)" label should say what it is ("Instruction for the AI that writes the edit");
its default has typos ("descritption", "seperated", "refence"). Suggest `promptGuides`:
https://github.com/bytedance/Bernini/blob/main/bernini/prompt_enhancer.py (the rv2v instruction template
Bernini's own enhancer uses).

```json
{ "workflow": "video_edit_bernini_r_video_editing_ref_autoprompt",
  "title": "Move a video into a picture",
  "summary": "Give it a clip of someone moving and a picture of a character in a place; an assistant writes the instructions for you and the clip's movement is replayed by that character, in that place. No prompt to write — but one of the slowest cards.",
  "note": "The dance comes from the video, the dancer and the glass-flower field come from one picture, and nobody typed a prompt: an assistant looked at both and wrote the instruction (you can read it in the parameters).",
  "params": {
    "loadvideo_file_115": "asset:3044160-uhd_3840_2160_24fps_5_1.mp4",
    "loadimage_image_123": "asset:input.jpg",
    "primitiveboolean_value_117_70": true,
    "customcombo_choice_117_54": "Video Editing with Reference",
    "video_slice_duration_124": 3,
    "berniniconditioning_width_117_50": 832,
    "berniniconditioning_height_117_50": 832
  },
  "inputs": {
    "loadvideo_file_115": { "need": "one person dancing, full body, square clip, at least 3 s", "source": "asset:3044160-uhd_3840_2160_24fps_5_1.mp4" },
    "loadimage_image_123": { "need": "one picture with a clear character AND a distinctive setting, square", "source": "asset:input.jpg" }
  },
  "keepRuntime": true, "estSec": 420,
  "sources": ["https://github.com/bytedance/Bernini", "https://github.com/bytedance/Bernini/blob/main/bernini/prompt_enhancer.py", "https://github.com/bytedance/Bernini/blob/main/gradio_demo.py"] }
```

---

## video_edit_wan21_scail2_character_replacement

**What the model is good at** (with sources): SCAIL-2 (Zhipu / zai-org, Wan 2.1 14B, MIT) drives a
reference character from a driving video **end to end, without skeleton maps or inpainting masks** — which
the authors say are ambiguous under complex motion; cross-identity replacement and animal driving are
listed as emergent abilities ([zai-org/SCAIL-2](https://github.com/zai-org/SCAIL-2),
[model card](https://huggingface.co/zai-org/SCAIL-2)). Replacement mode keeps the driving video's scene
(white mask background) and swaps the tracked person. Resolutions: 512p and 704p, **"Pose-driven performs
better under 704p"**, H and W divisible by 32. Prompt semantics (README): **describe the video after the
replacement, not an instruction**; "describe the replacement character's visible clothing and appearance,
and include objects the character interacts with"; "SCAIL-2 is trained with long, detailed prompts."
11-03 verdict: ★ excellent (the keeper replaced by a ballet dancer, even carrying the lantern).

**Showcase idea**: *Same scene, same moves, a completely different person.* Driving = **Dancer A** (hard,
fast moves, a camera that circles — the "complex motion" SCAIL claims); character = **Dancer B's frame 0**
(full body, head to feet, framed like the driver) — a different gender, body and an outfit so distinctive
(red headwrap, plaid, tiger leggings) that identity is trivial to check in every frame. **704×704**: the
README's better replacement size, square to match the square clip (the 896×512 default would crop a
full-body dancer's head and feet off a square source). This pairs with Wan Animate below, given the same
two inputs.

**Inputs**:
- `loadimage_image_30` — one character, full body head to feet, standing, facing camera, framed like the
  driving video — Dancer B frame 0
- `loadvideo_file_155` — one clearly visible person doing big full-body moves — `asset:2795750-uhd_3840_2160_25fps_1_1.mp4`

**Expected result / how to judge it**: 704×704, 157 frames (two chunks of 81 overlapping by 5) ≈ 6.3 s at
25 fps. The rooftop, brick chimney, parapet, skyline and cloudy sky are unchanged and keep the original
camera move; the dancer is now the woman with the **red headwrap, black leather jacket, yellow plaid and
orange tiger-striped leggings**, doing his squats, hands-up pose (~2.5 s) and arm swings in sync. No man's
beard, no black hoodie left; no seam or colour jump at the chunk join (~3 s). Silent (the source is).

**Risks**: body-type change (narrow → broader) can leave halos of the original silhouette; hands during
fast swings (the DPO LoRA targets hand distortion per the README); the reference's SAM3 prompt is the
fixed literal `"human"` (node 213:212, not exposed) — fine for a person.

**Links to fix**: none dead. Meta: SAM3 target literal `"girl, handkerchief"` ≠ meta `"person"` (finding
2) — set the literal to `person`; description: add "square clip → 704×704 or 672×672; the README says
replacement looks better at 704p". Suggest `promptGuides`: https://github.com/zai-org/SCAIL-2 (Prompt
Semantics section).

```json
{ "workflow": "video_edit_wan21_scail2_character_replacement",
  "title": "Replace a person in a video",
  "summary": "Upload a full-body picture of a character and a video of someone moving; the person in the video becomes your character, doing exactly the same moves in the same place. Pick it when the video's background must stay.",
  "note": "The rooftop, the chimney, the sky and every dance move come from the video; the dancer now is the woman from the picture. Compare with the 'give a character a video's moves' card, which got the same two inputs but invents a new place.",
  "params": {
    "loadimage_image_30": "<derived — see inputs>",
    "loadvideo_file_155": "asset:2795750-uhd_3840_2160_25fps_1_1.mp4",
    "cliptextencode_text_213_3": "A young Black woman with a red-and-orange patterned headwrap, a black leather biker jacket worn open over a long yellow-and-black plaid shirt dress, orange-and-black tiger-striped leggings and black-and-white sneakers dances energetically on a flat grey concrete rooftop: she sways, squats with bent knees, throws both hands up, swings her arms and kicks. Behind her are old red-brick industrial buildings, a tall brick chimney, a low parapet wall and a distant city skyline under a heavy overcast sky; soft diffuse daylight, a handheld camera slowly circling around her.",
    "cliptextencode_text_213_191": "person",
    "primitiveboolean_value_213_203": true,
    "primitiveboolean_value_213_172": true,
    "primitiveint_value_213_178": 704,
    "primitiveint_value_213_179": 704
  },
  "inputs": {
    "loadimage_image_30": { "need": "one character, full body head to feet, standing, framed like the driving video, very different from the driver", "source": "NEW:derive-on-asset {asset:'3044160-uhd_3840_2160_24fps_5_1.mp4', kind:'video', derive:[{op:'frame',index:0}]} (or copy ComfyUI/input/idv2v_demo_frame0.png, which is the same frame, into J:/_assets)" },
    "loadvideo_file_155": { "need": "one clearly visible person, full body, big fast moves, at least 6.3 s, square", "source": "asset:2795750-uhd_3840_2160_25fps_1_1.mp4" }
  },
  "keepRuntime": true, "estSec": 235,
  "sources": ["https://github.com/zai-org/SCAIL-2", "https://huggingface.co/zai-org/SCAIL-2", "https://huggingface.co/Comfy-Org/SCAIL-2"] }
```
`keepRuntime: true` — 704×704 is 8% more pixels than the 896×512 default.

---

## video_edit_wan_animate2

**What the model is good at** (with sources): Wan Animate 2 (Wan team) animates a still character with a
driving video **"without pose extraction or skeleton preprocessing"**, keeps the character's identity, and
**generates a fresh background and camera from the text prompt, decoupled from both the reference image
and the driving video** ([ComfyUI tutorial](https://docs.comfy.org/tutorials/video/wan/wan-animate-2);
the bundle's template note: "the output background is generated from the prompt, fully decoupled …",
"Framing mismatch (close-up vs full-body) is the #1 cause of bad results"). The bundle runs the
**distilled** int8 checkpoint at 10 lcm steps. Official demo: a pink-haired character with mech arms doing
a street dance. Prompt form (template): `Character appearance description: … Background description: …`
— looks only, no motion words — plus a separate motion prompt.

**Showcase idea**: *Only the motion survives.* **The same two inputs as SCAIL-2** — Dancer B's picture,
Dancer A's dance — so the pair of examples shows the difference between the cards in one glance: SCAIL
keeps the rooftop; Animate puts her on **a beach at golden hour** that exists in neither input. Both inputs
are full-body squares, so the size is **640×640** — the same pixel count as the 480×848 default (cost
unchanged) but no crop. The 11-03 run fed a square clip through the portrait default and the dancer left
the frame.

**Inputs**:
- `loadimage_image_189` — same character picture as the SCAIL-2 run — Dancer B frame 0
- `loadvideo_file_240` — same driving video as SCAIL-2 — `asset:2795750-uhd_3840_2160_25fps_1_1.mp4`

**Expected result / how to judge it**: 640×640, 81 frames ≈ 3.2 s at 25 fps. The woman (headwrap,
leather jacket, plaid, tiger leggings) dances Dancer A's moves (squats, hands up near 2.5 s) **on sand,
with turquoise waves and palm trees, in low warm light** — no rooftop, no chimney, no concrete plaza.
Identity held from first to last frame; whole body in frame. Silent (the source is).

**Risks**: the background prompt may be under-followed (a generic outdoor scene); fast arm swings can
smear at 10 steps; the reference's arm-out pose may make the first frames start from her pose rather than
his.

**Links to fix**: model `wan_animate_2_distill_int8_convrot.safetensors` has only a `source` — direct
file (checked 200): https://huggingface.co/Comfy-Org/Wan-Animate-2/resolve/main/diffusion_models/wan_animate_2_distill_int8_convrot.safetensors.
Description: "portrait 480×848 by default — swap the numbers for a landscape clip" → add "use 640×640 for
a square clip". Suggest `promptGuides`: https://docs.comfy.org/tutorials/video/wan/wan-animate-2.

```json
{ "workflow": "video_edit_wan_animate2",
  "title": "Give a character a video's moves",
  "summary": "Upload a full-body picture of a character and a video of someone moving, then describe a place in words; your character performs the same moves there. Pick it when you want a new background — and use full-body pictures for both.",
  "note": "Same picture and same dance as the 'replace a person' card — but here only the moves are kept: the dancer from the picture performs them on a beach that exists in neither input, written in the prompt.",
  "params": {
    "loadimage_image_189": "<derived — see inputs>",
    "loadvideo_file_240": "asset:2795750-uhd_3840_2160_25fps_1_1.mp4",
    "primitivestringmultiline_value_605": "Character appearance description: a young Black woman with a red-and-orange patterned headwrap, a black leather biker jacket worn open over a long yellow-and-black plaid shirt dress, orange-and-black tiger-striped leggings and black-and-white sneakers, full body from head to toe.\nBackground description: a wide sandy beach at golden hour, turquoise waves breaking behind her, tall palm trees on the left, warm low sunlight and long soft shadows on the sand, cinematic travel photography.",
    "primitivestringmultiline_value_604": "A person doing an energetic street dance: swaying, squatting with bent knees, throwing both hands up and swinging the arms.",
    "resizeimagemasknode_resize_type_width_261_243": 640,
    "resizeimagemasknode_resize_type_height_261_243": 640,
    "wananimate2tovideo_length_261_247": 81
  },
  "inputs": {
    "loadimage_image_189": { "need": "same full-body character picture as the SCAIL-2 run", "source": "NEW:derive-on-asset {asset:'3044160-uhd_3840_2160_24fps_5_1.mp4', kind:'video', derive:[{op:'frame',index:0}]} (shared with SCAIL-2)" },
    "loadvideo_file_240": { "need": "same driving video as SCAIL-2 (full body, big moves, square)", "source": "asset:2795750-uhd_3840_2160_25fps_1_1.mp4" }
  },
  "keepRuntime": false, "estSec": 142,
  "sources": ["https://docs.comfy.org/tutorials/video/wan/wan-animate-2", "https://huggingface.co/Comfy-Org/Wan-Animate-2"] }
```
`keepRuntime: false` — 640×640 = 409.6 k px vs the default 480×848 = 407 k px.

---

## video_edit_wan_idv2v_restyle_compare

**What the model is good at** (with sources): ID-V2V (Eyeline Labs / Netflix, SIGGRAPH Asia 2026) —
source video + **one stylized keyframe** → the clip takes the keyframe's scene, lighting and style **while
keeping the people's identity and performance, "including subtle expressions, eye gaze, and body
movement"**; "shoot first, restyle later"; "from the second frame onward the model re-aligns to the
source", so a keyframe need not match pixel for pixel; generated in 81-frame clips at 720p
([Eyeline-Labs/ID-V2V](https://github.com/Eyeline-Labs/ID-V2V)). On this rig (ComfyQ's
`tools/maintenance/integrations/idv2v.md`, 2026-09-11): 640×640 → "style transferred, identity + motion
preserved"; **1280×704 on a square source "came back nearly photo-real with the dancer's head cut off"**,
960×960 — same pixel count, right aspect — "restyled perfectly". This card adds a strip: keyframe above
the source on the left, result on the right.

**Showcase idea**: *Paint one frame, get the whole clip in that style — with the dancer still herself.*
Use the **pair that was verified on this rig**: Dancer B + `idv2v_demo_style.png`, a warm gouache
illustration of exactly her frame 0 (same pose, headwrap, plaid, tiger legs; the plaza turned into ochre
painted shapes). Square clip, square keyframe, the card's **square default 640×640** — no crop. The 11-03
run (a watercolour of the LTX pier clip) "drifted back toward photographic over 3.4 s"; a strong,
verified keyframe at the matching aspect is the documented cure.

**Inputs**:
- `vhs_loadvideo_video_33` — a person moving, ≥ 3.4 s, square — `asset:3044160-uhd_3840_2160_24fps_5_1.mp4`
- `loadimage_image_189` — the clip's first frame repainted in a strong style, same framing —
  `ComfyUI/input/idv2v_demo_style.png` (1024×1024, made 2026-09-11 from this clip's frame 0) copied into
  `J:\_assets` (NEW asset, no GPU needed)

**Expected result / how to judge it**: 81 frames ≈ 3.4 s at 24 fps, a comparison canvas (keyframe over
source, narrow, on the left; 640×640 result on the right). The result stays **gouache — flat ochre wall,
painted trees, brush texture — to the last frame**, while the woman keeps her face, headwrap and every
step and arm sweep of the source. Fail = drifting back to photographic after ~1 s, or her face changing.
Silent (documented: "The result has no sound").

**Risks**: painted background vs the raw-RGB VACE control (the ComfyUI graph does not mask the person as
the paper does — idv2v.md "Known differences") can pull the wall back toward concrete late in the clip.

**Links to fix**: `wan_2.1_idv2v_int8_convrot.safetensors` has **no url/source** (it is in
`bundleCompleteness`'s deliberately-unsourced list, yet its origin is recorded in
`tools/maintenance/integrations/idv2v.md`): url
https://huggingface.co/Kijai/Wan_ID_V2V_comfy/resolve/main/wan_2.1_idv2v_int8_convrot.safetensors (checked
200), source https://huggingface.co/Kijai/Wan_ID_V2V_comfy — same fix on the hi-res card. Prompt literal
`"two people dancing"` vs meta default "" (finding 2). Suggest `promptGuides`: https://github.com/Eyeline-Labs/ID-V2V.

```json
{ "workflow": "video_edit_wan_idv2v_restyle_compare",
  "title": "Test a restyle side by side",
  "summary": "Repaint the first frame of your clip in any style (with an image-editing card), upload both, and the whole clip is redrawn in that style while faces and movements stay. This version shows your painted frame and the original beside the result — the quick way to try a look.",
  "note": "Only the first frame was painted (top left); the card painted the other 80 the same way. Check the right side: the gouache look holds to the end while she keeps her face and every dance step from the original (bottom left).",
  "params": {
    "vhs_loadvideo_video_33": "asset:3044160-uhd_3840_2160_24fps_5_1.mp4",
    "loadimage_image_189": "asset:idv2v_demo_style.png",
    "cliptextencode_text_3": "A gouache illustration of a young woman in a red patterned headwrap, a black leather jacket, a yellow plaid shirt dress and orange tiger-striped leggings, dancing happily on a sunlit plaza in front of a tall painted concrete wall with rows of square light openings, trees on the right, warm ochre afternoon light, flat painted shapes and visible brush texture.",
    "primitiveint_value_245": 640,
    "primitiveint_value_246": 640
  },
  "inputs": {
    "vhs_loadvideo_video_33": { "need": "a person moving, at least 81 frames, square", "source": "asset:3044160-uhd_3840_2160_24fps_5_1.mp4" },
    "loadimage_image_189": { "need": "this clip's frame 0 repainted in a strong style, same framing and size ratio", "source": "NEW:copy ComfyUI/input/idv2v_demo_style.png into J:/_assets (or: an image-edit card's run on frame 0 of the clip, prompt 'Repaint this photo as a warm gouache illustration, flat ochre and orange shapes, visible brush texture; keep the woman, her pose, outfit and the framing exactly')" }
  },
  "keepRuntime": false, "estSec": 85,
  "sources": ["https://github.com/Eyeline-Labs/ID-V2V", "https://huggingface.co/Kijai/Wan_ID_V2V_comfy"] }
```

---

## video_edit_wan_idv2v_restyle_hires

**What the model is good at** (with sources): the same ID-V2V graph without the comparison strip, at the
card's 960×960 default — "same, visibly cleaner" than 640×640 on this rig (idv2v.md); the paper's own
runs are 720p ([Eyeline-Labs/ID-V2V](https://github.com/Eyeline-Labs/ID-V2V)).

**Showcase idea**: the **same inputs as the comparison card** (the owner's like-with-like rule), so the
two examples differ only in what each card is for: a check strip vs a clean, larger final video. Default
960×960 — square source, no crop.

**Inputs**: identical to `video_edit_wan_idv2v_restyle_compare`.

**Expected result / how to judge it**: a clean 960×960, 81-frame (≈ 3.4 s) gouache video; visibly
sharper than the comparison card's result panel (brush texture on the wall, the plaid pattern, the
headwrap); identity and moves as above. Silent.

**Risks**: as the comparison card.

**Links to fix**: same missing model url as the comparison card; same prompt literal. Description says
"about 3 minutes at 960×960" — the 11-03 calibration measured 175 s, consistent.

```json
{ "workflow": "video_edit_wan_idv2v_restyle_hires",
  "title": "Restyle a video from one frame",
  "summary": "Repaint the first frame of your clip in any style, upload both, and get the whole clip back in that style at a larger size, with the same faces and movements. Use it for the final version once the side-by-side card has shown the look works.",
  "note": "The same clip and the same painted frame as the side-by-side card, rendered clean and larger: look at the brush texture on the wall and on her plaid — that is what the extra size buys.",
  "params": {
    "vhs_loadvideo_video_33": "asset:3044160-uhd_3840_2160_24fps_5_1.mp4",
    "loadimage_image_189": "asset:idv2v_demo_style.png",
    "cliptextencode_text_3": "A gouache illustration of a young woman in a red patterned headwrap, a black leather jacket, a yellow plaid shirt dress and orange tiger-striped leggings, dancing happily on a sunlit plaza in front of a tall painted concrete wall with rows of square light openings, trees on the right, warm ochre afternoon light, flat painted shapes and visible brush texture.",
    "primitiveint_value_245": 960,
    "primitiveint_value_246": 960
  },
  "inputs": {
    "vhs_loadvideo_video_33": { "need": "same as the comparison card", "source": "asset:3044160-uhd_3840_2160_24fps_5_1.mp4" },
    "loadimage_image_189": { "need": "same as the comparison card", "source": "NEW:copy ComfyUI/input/idv2v_demo_style.png into J:/_assets (shared with the comparison card)" }
  },
  "keepRuntime": false, "estSec": 175,
  "sources": ["https://github.com/Eyeline-Labs/ID-V2V", "https://huggingface.co/Kijai/Wan_ID_V2V_comfy"] }
```

---

## video_liveportrait_image2video

**What the model is good at** (with sources): LivePortrait (Kuaishou) — an implicit-keypoint animator,
not a diffusion model: "12.8 ms on an RTX 4090", trained on ~69 M frames, with stitching and eye/lip
retargeting modules ([arXiv 2407.03168](https://arxiv.org/abs/2407.03168)). The project page shows it
driving still portraits of **"realistic, oil painting, sculpture, 3d rendering"** styles
([liveportrait.github.io](https://liveportrait.github.io/)). Driving-video advice (README): 1:1 crop,
head-focused, **"Make sure the first frame is a frontal face with a neutral expression"**
([KwaiVGI/LivePortrait](https://github.com/KwaiVGI/LivePortrait)) — this graph uses
`relative_motion_mode: relative`, so motion is measured from the driving clip's first frame. On this rig:
11 s, 0.64 GB — the cheapest video card by far.

**Showcase idea**: *A painting pulls faces.* `d6.mp4` is close to an ideal driving clip: 1:1
head-and-shoulders, plain wall, **frame 0 frontal and neutral**, and in its first 128 frames (the card's
default) a fast run of very legible expressions — eye darts, raised brows, crossed eyes, a toothy
grimace, an "O" mouth. Drive a **classical oil-painted portrait** with it, which demonstrates the
style-generalisation claim (paintings, not just photos) and makes every expression unmistakable because a
painting "should not" move. The portrait must be frontal, neutral, mouth closed, eyes open looking at the
viewer (a smiling or eyes-closed source leaves less to transfer — why the bundle's api literal
`01-portrait_remix.png`, eyes closed, is a poor default). Fallback with no upstream run:
`asset:0 (1).png`, a frontal, neutral, eyes-open editorial portrait (dark bob, pearls) that meets every
rule.

**Inputs**:
- `loadimage_image_196` — one face, frontal, neutral, eyes open, mouth closed, head-and-shoulders,
  painted — NEW t2i run (see the last section); fallback `asset:0 (1).png`
- `vhs_loadvideo_video_8` — a face making big expressions, starting neutral and frontal — `asset:d6.mp4`

**Expected result / how to judge it**: ~512 px video, 128 frames. The painted woman keeps her painted
face, costume, brush texture and background, and copies the driving face beat by beat: eyes darting
(~0.5 s of driving), crossed eyes (~1 s), a teeth-baring grimace (~2.3 s), an "O" mouth (~3.5 s). No
melting of the face edge (stitching on), no frame jitter. Silent. ⚠ At the current 16 fps write it plays
at about half speed (8 s for 4.3 s of driving) until the fps fix (finding 4).

**Risks**: painted faces with weak features can confuse the MediaPipe cropper ("No face detected" — the
card has a friendly message for it); tongue-out frames in d6 cannot be reproduced (LivePortrait has no
tongue) and look smeared; the three stray tensor-shape text tiles are still emitted.

**Links to fix**: none (models are `auto`). Graph: output fps (finding 4); the api literal portrait
`01-portrait_remix.png` has closed eyes — change the literal to a frontal eyes-open picture (e.g.
`0 (1).png`). Description: add "the driving clip's first frame should be a neutral, front-facing face".
Suggest `promptGuides`/help link: https://github.com/KwaiVGI/LivePortrait (driving-video tips).

```json
{ "workflow": "video_liveportrait_image2video",
  "title": "Copy facial expressions onto a portrait",
  "summary": "Give it a front-facing portrait — a photo, a painting or a 3D render — and a video of a face moving; the portrait copies the head turns, eye and mouth movements. Very fast; no sound.",
  "note": "An oil painting, driven by a video of someone pulling faces: every eye dart, frown and grimace is copied, while the face, the brushwork and the background stay the painting's own.",
  "params": {
    "loadimage_image_196": "<painted portrait — see inputs>",
    "vhs_loadvideo_video_8": "asset:d6.mp4",
    "vhs_loadvideo_frame_load_cap_8": 128
  },
  "inputs": {
    "loadimage_image_196": { "need": "one painted face, frontal, neutral, eyes open looking at the viewer, mouth closed, head and shoulders, square", "source": "NEW:t2i oil-painting portrait (prompt in the last section) — fallback asset:0 (1).png" },
    "vhs_loadvideo_video_8": { "need": "a face making big expressions, first frame neutral and frontal, square", "source": "asset:d6.mp4" }
  },
  "keepRuntime": false, "estSec": 11,
  "sources": ["https://arxiv.org/abs/2407.03168", "https://liveportrait.github.io/", "https://github.com/KwaiVGI/LivePortrait", "https://github.com/kijai/ComfyUI-LivePortraitKJ"] }
```

---

## Cost of this group

61 + 290 + 330 + 420 + 235 + 142 + 85 + 175 + 11 ≈ **1 750 s ≈ 29 min** warm (cold adds ~27–135 s per
model change), against **≈ 40 min** for the same nine on 11-03 — mostly the autoprompt Bernini at 3 s and
the two Bernini cards on a 16 fps clip. Turbo stays on everywhere (Turbo off would be ~13× on Bernini).

## Upstream inputs this group needs

No run in this group depends on another workflow's output; everything comes from `J:\_assets` plus one
optional t2i run. What the integrator has to provide:

1. **NEW suite capability — `derive` on an asset** (used 7 times here). Today `derive` needs `from: <workflow>`
   and `asset:` is a plain string. Wanted: `{ "from": "asset:<file>", "kind": "video"|"image", "derive": [...] }`
   resolved exactly like an output (the asset path handed to `derive_input.py`). Uses:
   - Dancer B **frame 0, full** — `{from:"asset:3044160-uhd_3840_2160_24fps_5_1.mp4", kind:"video", derive:[{op:"frame",index:0}]}`
     → SCAIL-2 `loadimage_image_30` and Wan Animate `loadimage_image_189` (same file for both).
     *Shortcut with no code:* copy `ComfyUI/input/idv2v_demo_frame0.png` (640×640, the same frame) into
     `J:\_assets` as e.g. `dancer_b_frame0.png`.
   - Dancer B **torso crop** — `{…same…, derive:[{op:"frame",index:0},{op:"crop",box:[0.12,0.25,0.80,0.62]}]}`
     → Bernini with-reference `loadimage_image_104`.
   - The four **capoeira sketches** cropped and scaled —
     `{from:"asset:Keyframes/IMG_2026-06-23-11-34-04-060.jpg", derive:[{op:"crop",box:[0,0.16,1,0.91]},{op:"scale",factor:0.34}]}`
     and the same for `-08-465`, `-13-198`, `-16-318` → Wan key frames 62/122/124/126.
2. **NEW suite capability — `asset:` into a sub-folder of the assets dir** (`asset:Keyframes/<file>`):
   `_namedAsset` currently requires `dirname(full) === assetsDir`; relax it to "inside assetsDir"
   (the `file:` branch already does). Or move the four sketches into the assets root.
3. **NEW asset (a copy, no GPU):** `ComfyUI/input/idv2v_demo_style.png` (1024×1024 gouache restyle of Dancer
   B's frame 0, 2026-09-11, verified working) → `J:\_assets\idv2v_demo_style.png`, for both ID-V2V runs.
   (Alternative if an image-edit card's showcase is "restyle a photo, keep the framing": run it on Dancer B
   frame 0 with "Repaint this photo as a warm gouache illustration, flat ochre and orange shapes, visible
   brush texture; keep the woman, her pose, outfit and the framing exactly", output square.)
4. **NEW producer (optional, preferred) — a painted portrait for LivePortrait**, from any text-to-image card
   whose own showcase can be a painting (Qwen-Image 2.1 or FLUX.2 Klein 9B suit; 1:1, ~1 MP):
   *"A classical oil painting portrait in the manner of a 17th-century Dutch master: head and shoulders
   of a young woman facing the viewer straight on, calm neutral expression, lips closed, eyes open and
   looking directly at the viewer, a white linen cap and a dark brown dress with a plain white collar,
   soft window light from the left, plain dark olive-brown background, visible brushstrokes and fine
   craquelure in the varnish."* Wire as `{from:"<that card>", fallback:"asset:0 (1).png"}`.
5. **Prerequisite meta fix (not an input):** the Bernini `customcombo_choice_*` → `index` `linkedValues`
   (finding 1), on all three Bernini video cards and both Bernini image cards — otherwise the "Edit type"
   chosen in these runs is ignored.
