# g4_ltx — LTX-2 / 2.3 / 2.5 showcase proposals

Ten bundles. Everything below was read from the bundle files (meta, api.json literals and wiring, template
notes, `*.runtime.json`), from the 2026-11-03 suite outputs on disk (frames opened), from the assets
themselves (frames, sizes, fps, audio levels measured with ComfyUI's embedded PyAV), and from primary sources
(Lightricks docs/blog/model cards, ComfyUI docs, the fal 3DREAL repo including its official ComfyUI workflow).

## Read this first: what the runner actually sends

`BenchmarkService._buildCalibrationParams` sends only `warmupParams` + the suite's `params`. **Every
other field keeps the api.json literal, not the meta default.** Several of my bundles' literals disagree with
their meta defaults, so the suite must set those values explicitly. They are set in the JSON below:

| bundle | field | api literal | meta default | consequence today |
|---|---|---|---|---|
| `video_edit_ltx2_5_iclora_union_control` | working resolution `5548:5026` | **544** | 512 | calibrated a 1920×1024 job; a student's default job is ~1792×1024 or smaller |
| `utility_ltx2_5_video_deblur_upscale` | output size `5548:5026` | **544** | 576 | 864×480 input came out 960×512 instead of 1024×576 |
| all four `…5508` prompt cards (union/canny/pose/deblur) | prompt `5508.value` | **""** | text | a run without a prompt gets an empty prompt |
| `video_edit_ltx2_3_3dreal_vid2vid` | both prompt boxes | **""** | text | the 2026-11-03 run had **no prompt at all**, and no `3DREAL` trigger word |
| `video_ltx2_3_ia2v_iclora` | height `340:324` | 720 | 704 | harmless (output 1280×704 either way) |

## Teaching thread across the group

Three cards share one source clip on purpose — `asset:2795750-uhd_3840_2160_25fps_1_1.mp4`, a man dancing
full-body on a city rooftop (720×720, 25 fps, 8.7 s, has an audio track) — and the owner's own restyles of its
frame 0 (`Flux2-Klein_00001_` sunset cliff, `_00002_` watercolour, `_00003_` claymation, `_00004_` oil impasto;
I verified by image correlation that all four are frame 0, correlation 0.81 at frame 0, falling after it):

- **depth card**: the whole rooftop becomes clay (layout survives),
- **pose card**: a knight in a castle does the same dance (only the body survives),
- **first/last-frame card**: the real rooftop turns into the sunset cliff (both ends fixed).

The canny card and the 3DReal card share the other source, the assets' grey container-ship blockout
(`rough3Drender.mp4`): one turns it into a toy and the other into real footage.

---

## video_ltx2_5_t2v

**What the model is good at** (with sources): LTX-2.5 is Lightricks' open audio+video model. Its model card
and the template note list **native multishot** ("one generation yields multiple connected shots holding
character, environment, lighting, voice, and style across cuts"), a diffusion video decoder for "sharper faces,
legible text", a custom Gemma 4 12B text encoder for complex prompts, and synchronised audio with speech. The
official prompting guide (docs.ltx.io and the identical ltx.io blog) gives a multi-shot recipe: write one
chronological paragraph, **name each transition** ("A hard cut transitions to…"), re-establish each new shot,
state audio continuity at every cut, use 2–4 shots each with a clear job, and put dialogue in quotes. On text it
says "LTX-2.5 improves short-text accuracy… exact spelling… not guaranteed. Keep text short and prominent".
Bundle: distilled int8 transformer, 8+3 manual sigmas, cfg 1 (so the negative prompt is inert), 2-stage with a
2× latent upscaler; 0.9 MP 16:9 renders **1280×704** (the meta says "about 1280×736"); 51 s warm / 102 s cold.
In the assessment it was the larger, "cinematic" t2v card, but "the darkest" of the four.

**Showcase idea**: a **two-shot scene in one prompt** with a spoken line and one short neon word. This shows
three things the H3 t2v cards do not advertise, all at the default 5 s / 0.9 MP: a cut inside one generation
with the same character on both sides, lip-synced dialogue, and short legible text. It is lit by bright neon
on purpose, to avoid the "darkest of the four" result. Two shots, not three: the guide wants each shot to have
time to establish itself, and 5 s is the default cost. The guide's own example is a woman in a yellow raincoat;
this one uses a teal jacket and a food truck so it does not read as a copy, and so it does not repeat the
old suite's yellow-raincoat keeper.

**Inputs**: none.

**Expected result / how to judge it**: (1) a hard cut near the middle (about frame 55–70 of 121) from a wide
street shot to a medium close-up; (2) the same woman (short black bob, teal rain jacket, clear umbrella) on both
sides of the cut; (3) a red neon sign reading **TACOS**, legible in the wide shot; (4) her lips move on the
line and the soundtrack contains "Two, please — extra lime!", rain on the umbrella and an accordion tune that
carries across the cut; (5) 1280×704, 5.04 s, 24 fps.

**Risks**: the word may garble (the guide says spelling is not guaranteed; TACOS is short and prominent on
purpose). The cut may land late or turn into a camera move. ⚠ **This output has a cut, so do NOT use it as the
generic stage-4 restyle source** for other groups' video-to-video cards. Use a single-take clip instead (my
`video_ltx2_5_i2v` output, or the 2795750 dancer clip).

**Links to fix**: none (all reachable; HF resolve links answer 401 because LTX-2.5 is gated — normal). Minor
description fix: "0.9 is about 1280×736" → "0.9 gives 1280×704".

```json
{ "workflow": "video_ltx2_5_t2v",
  "title": "Film a multi-shot scene from text",
  "summary": "Write a short scene — what happens, where the camera is, the sounds and any spoken lines — and get a video of up to 10 seconds with matching sound, even with cuts between shots. Pick it for a bigger, more cinematic picture than the fast video cards.",
  "note": "One prompt, two shots: a wide shot of the food truck, then a hard cut to a close-up as she orders. Notice that the same woman and jacket carry across the cut, the neon word \"TACOS\", and her spoken line in the soundtrack.",
  "params": {
    "primitivestringmultiline_value_405_376": "A wide shot frames a narrow, rain-soaked street at night, cobblestones shining under the glow of a small food truck parked at the curb, a red neon sign on its roof spelling \"TACOS\" in bold capital letters, steam drifting from its lit service window. A young woman with a short black bob and a teal rain jacket hurries toward the truck under a clear umbrella, her boots splashing through puddles. Rain drums on the umbrella and a cheerful accordion tune plays from the truck's radio. A hard cut transitions to a medium close-up of the same woman at the counter, red neon light on her face and raindrops beading on the umbrella above her; the accordion tune continues across the cut, softer now. She lowers the umbrella, smiles at the cook and says, \"Two, please — extra lime!\" Steam rises between them as the rain keeps falling."
  },
  "inputs": {},
  "keepRuntime": false, "estSec": 51,
  "sources": ["https://docs.ltx.io/open-source-model/usage-guides/prompting-guide", "https://ltx.io/blog/ltx-2-5-prompt-guide", "https://huggingface.co/Lightricks/LTX-2.5", "https://docs.comfy.org/tutorials/video/ltx/ltx-2-5"] }
```

## video_ltx2_5_i2v

**What the model is good at** (with sources): the template note says it "continues the scene while holding
character, lighting, and style : with synchronized audio". The guide says that for image-to-video you should
describe what happens next rather than re-describe the picture, and "prefer a single continuous take unless you
intentionally describe a cut away from that opening image". LTX-2.3/2.5 list "Stylized aesthetics", "Emotive
human moments" and "Characters can talk and sing" as strengths (ltx.io LTX-2.3 guide). Bundle: the picture is
center-cropped to W×H (default 1280×704); 51 s warm. In the assessment it was "faithful, slow push-in".

**Showcase idea**: a **still claymation portrait wakes up and speaks**. The input is
`asset:01-portrait_remix.png`, a plasticine girl with her eyes closed against clay hills, 1536×1024. Opening
the eyes is an unmistakable change from frame 0. A generated spoken line shows that this card writes the voice
itself; the ia2v card takes a recording instead. Holding a non-photoreal style for 5 s is the "holds style" claim
made visible. The prompt stays a single continuous take, as the guide recommends for image input. The 3:2 →
16:9 crop removes about 7% of the height at the top and bottom; the eyebrows and chin stay inside the frame.

**Inputs**: `loadimage_image_395` — a characterful still in which a strong, visible action is waiting to
happen (here: closed eyes) — `asset:01-portrait_remix.png`.

**Expected result / how to judge it**: frame 0 = the portrait, eyes closed; by about 1.5 s the eyes are open and
blink; the lips move on "Is it morning already?" (a voice is audible); the clay texture and fingerprints
persist to the last frame, with no drift to photoreal skin; birdsong in the background; 1280×704, 5.04 s.

**Risks**: drift toward photoreal over the clip; the voice may not match a clay character's look; the top of
the hair is lightly cropped by the 16:9 framing. A 9:16 or square framing would need a W/H change (and
`keepRuntime`).

**Links to fix**: none.

```json
{ "workflow": "video_ltx2_5_i2v",
  "title": "Bring a picture to life",
  "summary": "Give it one picture and say what happens next; it turns the picture into a short video with movement, sound effects and even speech, keeping the picture's look. Pick it when you want a large, faithful result.",
  "note": "A still claymation portrait wakes up: she opens her eyes and speaks a line, and the clay look holds in every frame. Everything you hear — the voice, the birds, the breeze — was made from the prompt.",
  "params": {
    "primitivestringmultiline_value_398_376": "Use the provided start image as the first frame. One continuous close-up: the clay girl slowly opens her eyes, blinks twice and lifts her head toward the camera, her sculpted lips parting into a sleepy smile. She says softly, in a warm, sleepy voice, \"Is it morning already?\" A light breeze lifts a few strands of her orange and yellow clay hair, and the clay hills behind her stay softly out of focus. The camera pushes in very slowly on her face. The whole scene stays handmade plasticine stop-motion, with fingerprints in the clay and slightly jittery stop-motion movement. Sound: birdsong, a soft breeze and the faint squish of clay as she moves."
  },
  "inputs": {
    "loadimage_image_395": { "need": "a stylised still with an obvious action about to happen (closed eyes), landscape framing", "source": "asset:01-portrait_remix.png" }
  },
  "keepRuntime": false, "estSec": 51,
  "sources": ["https://docs.ltx.io/open-source-model/usage-guides/prompting-guide", "https://ltx.io/blog/ltx-2-3-prompt-guide", "https://docs.comfy.org/tutorials/video/ltx/ltx-2-5"] }
```

## video_ltx2_5_flf2v

**What the model is good at** (with sources): the template note says it generates "the connected shots in
between : holding character, environment, lighting, and style across the transition, with synchronized audio".
The ComfyUI LTX-2.5 tutorial says: "Describe the transition between frames, including camera movement. Use
frames with matching aspect ratios." Bundle: a single 8-step stage, both pictures resized and center-cropped to
W×H, 68 s warm. In the assessment it was "★ best value" of the first/last-frame engines.

**Showcase idea**: a **transformation that must land on an exact final picture**. The first frame is the real
rooftop photo (frame 0 of the dancer clip). The last frame is `Flux2-Klein_00001_.png`, the same man in the
same stance on a grassy sea cliff at sunset. The model has to invent the bridge between them: he keeps
dancing, a gust of dust sweeps across the frame, and the world has changed. Only a first/last-frame card can
promise the ending. Because the pair shares the exact framing (the Klein image is a restyle of frame 0), the
documented failure (mismatched framing) cannot occur. Both images are square, so W×H is set to **960×960**,
which has exactly the same pixel count as 1280×720. The cost is unchanged and nothing gets cropped (16:9 would
cut off his head and feet).

**Inputs**:
- `loadimage_image_31` — the real photo the clip starts on — **frame 0 of `asset:2795750-uhd_3840_2160_25fps_1_1.mp4`**.
  ⚠ NEW capability needed: the suite can derive from an earlier run, not from an asset (`parseMediaSpec` only
  takes a bundle id in `from`). Either allow `from: "asset:…"` with `derive`, or pre-extract the frame once into
  `J:\_assets` (e.g. `dancer_frame0.png`). Fallback: `asset:Flux2-Klein_00002_.png` (watercolour of the same frame).
  With the fallback the transition becomes "watercolour rooftop → real cliff", which still works.
- `loadimage_image_39` — the same framing, a different world — `asset:Flux2-Klein_00001_.png`.

**Expected result / how to judge it**: frame 0 = the grey rooftop photo; the last frame ≈ the sunset cliff
image; a visible wind/dust swirl around the middle instead of a flat crossfade; the same man and hoodie (red
sleeve band) throughout; audio: a beat, a gust at the transition, waves and gulls after; 960×960, 5.04 s.

**Risks**: the model may simply cross-dissolve, which is still a valid FLF result, only less spectacular. The
frame-0 still is a 720² video frame scaled up to 960, so the first second is softer than the end.

**Links to fix**: none. Minor: the default 1280×720 renders 1280×704.

```json
{ "workflow": "video_ltx2_5_flf2v",
  "title": "Make a video between two pictures",
  "summary": "Give a first and a last picture and describe what happens in between; it makes the video that travels from one to the other, with sound. Pick it when a shot must end exactly on a picture you chose.",
  "note": "Both ends are fixed pictures — the real rooftop photo and a sunset-cliff version of the very same frame — and the model invents the gust of wind that carries him from one to the other.",
  "params": {
    "primitivestringmultiline_value_251_252": "Use the provided start image as the first frame and the provided end image as the final frame anchor. The camera stays locked off on the man as he keeps dancing on the spot, swaying his shoulders and turning his hips to the beat. Halfway through, a sudden gust of wind sweeps a swirl of dust and dry grass across the frame; as it clears, the grey city rooftop has become a windswept grassy sea cliff at sunset, the ocean glowing orange behind him. He settles back into his wide dance stance facing the camera as the warm light falls on his face. Sound: a steady hip-hop beat, a rushing gust of wind at the transition, then waves breaking below the cliff and gulls calling.",
    "primitiveint_value_251_215": 960,
    "primitiveint_value_251_216": 960
  },
  "inputs": {
    "loadimage_image_31": { "need": "the real first frame of a clip, square", "source": "NEW derive-from-asset: { \"from\": \"asset:2795750-uhd_3840_2160_25fps_1_1.mp4\", \"kind\": \"video\", \"derive\": [{\"op\": \"frame\", \"index\": 0}], \"fallback\": \"asset:Flux2-Klein_00002_.png\" }" },
    "loadimage_image_39": { "need": "the same framing and pose in a different world", "source": "asset:Flux2-Klein_00001_.png" }
  },
  "keepRuntime": false, "estSec": 70,
  "sources": ["https://docs.comfy.org/tutorials/video/ltx/ltx-2-5", "https://docs.ltx.io/open-source-model/usage-guides/prompting-guide"] }
```

## video_edit_ltx2_5_iclora_canny_control

**What the model is good at** (with sources): it is Lightricks' Union Control IC-LoRA (one checkpoint for
depth, canny and pose; reference downscale factor 2 per the HF card and the file's own metadata) on LTX-2.5.
The official union-control page says canny is "Best for architecture, product shots, geometric scenes, and
mechanical objects. Less effective for soft organic subjects (clouds, fur, foliage) or heavy texture". It also
says to "Describe the visual content you want, not the structure". The card's own description adds "strong,
physical looks (claymation, toy figures) take hold best; soft painterly styles such as watercolor can stay
close to the photographic source." Bundle: Canny 92/200 at working resolution 512 → 2× → ~1792×1024. Output at
the source frame rate with a new soundtrack. 139 s warm on a 24 fps 16:9 clip.

**Showcase idea**: **the grey container-ship blockout becomes a plastic toy-brick ship**. A stack of
rectangular containers on a hull is the most "geometric/mechanical" subject on disk. Canny keeps every
container seam, so each container becomes a toy brick in exactly its place, and the bridge tower keeps its
stepped outline. A toy look is the strong physical style the card says works best, and it avoids the
watercolour failure. It pairs with the 3DReal card on the same render: same blockout, two looks.
No start image (no restyled frame 0 exists for this render); the prompt alone sets the look.

**Inputs**: `loadvideo_file_5001` — a clip with clean, strong edges and simple surfaces — `asset:rough3Drender.mp4`
(578×314, 30 fps, 10.3 s, silent. The first 5 s push in on the container wall, then cut back to a wide view at
about 3.5–4 s). `loadimage_image_2004` — none.

**Expected result / how to judge it**: containers become bright red/yellow/blue/green bricks with studs, each in
the same grid position as the render; hull and bridge outlines identical; the push-in and the cut happen at the
same moments as in the source; playroom light and shallow depth of field; a new soundtrack (humming, brick
clatter, a toot); ~1792×1024, 145 frames at 30 fps (4.8 s).

**Risks**: the grey render's soft shading gives few interior edges, so flat faces of the hull are free and may
sprout invented detail. A 30 fps source makes this run about 30% longer than the 24 fps calibration. That is the
safe direction for booking, so `keepRuntime` stays false.

**Links to fix**: none.

```json
{ "workflow": "video_edit_ltx2_5_iclora_canny_control",
  "title": "Restyle a video, keep its outlines",
  "summary": "Upload a video and describe a new look; it remakes the video so every shape and outline lines up with the original, with a new soundtrack. Pick it for objects, buildings and products that must stay recognisable.",
  "note": "The grey 3D render's outlines are traced and kept, so every container in the stack becomes a toy brick in exactly the same place, and the camera move is unchanged.",
  "params": {
    "primitiveboolean_value_5014_5506": false,
    "primitivestringmultiline_value_5508": "A glossy plastic toy cargo ship built from interlocking toy bricks: its stacked containers are bright red, yellow, blue and green bricks with little round studs on top, the hull is navy-blue plastic and the bridge tower is white plastic with tiny yellow windows. It sits on a smooth light-grey tabletop in a sunny kids' playroom, soft window light and a shallow macro-lens depth of field, like a toy photograph. Sound: a child humming nearby, the soft clatter of plastic bricks and a tiny toy ship horn that toots twice."
  },
  "inputs": {
    "loadvideo_file_5001": { "need": "geometric/mechanical subject with clean edges and a camera move", "source": "asset:rough3Drender.mp4" },
    "loadimage_image_2004": { "need": "none (prompt sets the look)", "source": "null" }
  },
  "keepRuntime": false, "estSec": 180,
  "sources": ["https://docs.ltx.io/open-source-model/feature-guides/structural-control/union-control", "https://huggingface.co/Lightricks/LTX-2.3-22b-IC-LoRA-Union-Control", "https://docs.ltx.io/open-source-model/usage-guides/ic-lo-ra"] }
```

## video_edit_ltx2_5_iclora_pose_control

**What the model is good at** (with sources): it is the same union IC-LoRA with DWPose (body, hands, face). The
official page says pose is "Best for dance, character animation, and movement. Less effective without people,
under heavy occlusion, or in close-ups where full-body keypoints aren't visible". Its one worked example is
style-only: "a knight in silver armor walking through a misty forest". The card's description: "Only the poses
carry over — not the background, clothes or camera look". Bundle: the TorchScript detector runs on the GPU
(5 s per 125 frames).

**Showcase idea**: **the rooftop dancer's exact moves, worn by a knight in a torch-lit castle hall**. The
rooftop, sky and hoodie must all disappear. That is what separates pose from depth, and the depth card's example
uses the same clip and keeps the rooftop. It follows the documented use (a full-body dancer) and the official
example's character. Prompt only, no start image, so nothing but the skeleton carries over. Armour plates give
the soundtrack something to sync with each step. Open-faced helmet: DWPose also tracks the face.

**Inputs**: `loadvideo_file_5001` — one person, full body in frame, clear energetic moves — `asset:2795750-uhd_3840_2160_25fps_1_1.mp4`
(the first 5 s include a wide arm swing at about 1.2 s, a deep squat with hands up at about 2.5 s, and a fist
punched up with a knee lift near 4.9 s). `loadimage_image_2004` — none.

**Expected result / how to judge it**: a knight in silver plate and a crimson cape doing the same squat at
about 2.5 s and the fist-and-knee move at the end; a stone hall with banners and torches, no rooftop, chimney or
sky; armour clanks in time with the steps over a medieval tune; 1024×1024, 121 frames at 25 fps.

**Risks**: armour may fuse with the cape during fast arm swings. A square 720² source runs ~35% cheaper than the
16:9 clip the current runtime was measured on, so `keepRuntime: true` keeps the longer, safer booking figure.
Optional upgrade: a start image of the knight in frame 0's pose, made by `image_edit_flux2_klein_ref_control_depth`
from frame 0 of the same clip (the assessment rates that card ★ for "a new picture in a photo's pose").

**Links to fix**: none.

```json
{ "workflow": "video_edit_ltx2_5_iclora_pose_control",
  "title": "Keep the moves, change everything else",
  "summary": "Upload a video of someone moving and describe a new character and place; only the body movements carry over, everything else is new, with a new soundtrack. Pick it for dance and character animation.",
  "note": "Only the dancer's skeleton is kept: a knight in a castle hall performs the same moves. Compare with the depth card's example on the same clip, where the rooftop survives.",
  "params": {
    "primitiveboolean_value_5014_5506": false,
    "primitivestringmultiline_value_5508": "A knight in polished silver plate armour with a flowing crimson cape and an open-faced helmet dances in a grand stone castle hall at night, tall red banners and flickering wall torches behind him, warm firelight glinting on the steel, cinematic lighting and a shallow depth of field. Sound: a lively medieval dance tune of drums and lute echoing through the hall, and the clank of armour plates with every step."
  },
  "inputs": {
    "loadvideo_file_5001": { "need": "one person, full body visible, energetic dance", "source": "asset:2795750-uhd_3840_2160_25fps_1_1.mp4" },
    "loadimage_image_2004": { "need": "none (prompt sets the look)", "source": "null" }
  },
  "keepRuntime": true, "estSec": 85,
  "sources": ["https://docs.ltx.io/open-source-model/feature-guides/structural-control/union-control", "https://huggingface.co/Lightricks/LTX-2.3-22b-IC-LoRA-Union-Control"] }
```

## video_edit_ltx2_5_iclora_union_control

**What the model is good at** (with sources): depth (Video Depth Anything) is "Best for landscapes, interiors,
and scenes with clear depth layers" (official union-control page). The card's description says "a restyled
still of your video's first frame works best" as the start image, and that depth "leaves the model more
freedom over surfaces and textures" than canny. In the assessment, depth on a claymation look was "★ best value".

**Showcase idea**: **the dancer clip plus one clay-restyled first frame turns the whole scene into claymation**.
The input is `Flux2-Klein_00003_.png`, which is exactly frame 0 of the clip, restyled. This is the card's
*default* path (start image on), which the old suite never exercised (it switched the image off). The
rooftop's depth layers (floor, parapet, town behind, sky) and the dancer's volume must all survive while every
surface turns to plasticine. Same clip as the pose card, so a student can see the difference: depth keeps the
place, pose throws it away.

**Inputs**:
- `loadvideo_file_5001` — a clip with clear depth layers and a moving subject — `asset:2795750-uhd_3840_2160_25fps_1_1.mp4`.
- `loadimage_image_2004` — frame 0 of that clip, already restyled — `asset:Flux2-Klein_00003_.png` (1024×1008; I checked that it matches frame 0).

**Expected result / how to judge it**: frame 0 = the clay still; every later frame stays clay (the hoodie's red
sleeve bands, a sage-green clay roof, puffy clay clouds, a miniature clay town on the right); the dance moves
in sync with the source (squat at about 2.5 s); the parapet and town stay where they are in the source; a new
music track; 1024×1024, 121 frames at 25 fps.

**Risks**: the clay look may soften back toward the photo late in the clip (the IC-LoRA follows the source
closely at strength 1.0; the guide suggests 0.5–0.8 for a looser guide, but the default is kept). ⚠ **Set the
working resolution explicitly to 512**: the api literal is 544 (see the table at the top). `keepRuntime: true`
for the same square-source reason as the pose card, and because the current runtime came from the 544 drift.

**Links to fix**: none. ⚠ api literal `5548:5026.resize_type.shorter_size` = 544 ≠ meta default 512, and
`5508.value` is empty.

```json
{ "workflow": "video_edit_ltx2_5_iclora_union_control",
  "title": "Restyle a video, keep its layout",
  "summary": "Upload a video and a restyled picture of its first frame (or just describe a look); it remakes the whole scene in that style while keeping where everything is and how it moves, with a new soundtrack. Pick it for landscapes, rooms and scenes with depth.",
  "note": "The dancer's video plus one clay-restyled first frame: the whole rooftop turns into claymation, keeping its depth, its positions and every move.",
  "params": {
    "primitiveboolean_value_5014_5506": true,
    "primitivestringmultiline_value_5508": "A hand-crafted claymation stop-motion film: a bearded clay man with sculpted brown hair, a black plasticine hoodie with red sleeve bands and black clay trousers dances on a sage-green clay rooftop. Behind him puffy white clay clouds hang over a miniature clay town with red roofs, round green clay trees, a clay chimney and sagging clay wires. Visible fingerprints and plasticine texture on every surface, soft warm studio lighting, slightly jittery stop-motion movement. Sound: a playful bass-and-drums dance groove and soft squishy clay footsteps.",
    "resizeimagemasknode_resize_type_shorter_size_5548_5026": 512
  },
  "inputs": {
    "loadvideo_file_5001": { "need": "clear depth layers + a moving subject", "source": "asset:2795750-uhd_3840_2160_25fps_1_1.mp4" },
    "loadimage_image_2004": { "need": "frame 0 of the source, restyled", "source": "asset:Flux2-Klein_00003_.png" }
  },
  "keepRuntime": true, "estSec": 80,
  "sources": ["https://docs.ltx.io/open-source-model/feature-guides/structural-control/union-control", "https://huggingface.co/Lightricks/LTX-2.3-22b-IC-LoRA-Union-Control", "https://huggingface.co/depth-anything/Video-Depth-Anything-Small"] }
```

## utility_ltx2_5_video_deblur_upscale

**What the model is good at** (with sources): ⚠ **The LoRA is not a deblur model.** `ltx-2.5-22b-ic-lora-pixel-spatial-upscaler-x2-1.0`
is Lightricks' **Pixel Spatial Upscaler**. Its model card calls it "a 2x generative video upscaler… It
creatively upscales a low-resolution video, synthesizing fine detail rather than simply interpolating". In
training, "the reference is a downscaled version of the target clip". It is "not a blind denoiser or a
compression-artefact remover", "use it as a creative step, not a pixel-accurate refiner", and it is meant for
"a clean, low-resolution video clip". The recommended workflow is to draft at about 280p and then upscale 2×.
The file's own metadata confirms `reference_downscale_factor: 2`. Bundle: the output is the "Output size"
short side, and the model reads the source at half of that. One 8-step pass; the source audio is frozen
through denoising and kept. 35 s warm at 544 → 960×512.

**Showcase idea**: **a real 480p draft from the library's fast video card, re-rendered at 960p**. Output size is
**960**, so the model reads the 864×480 clip at its native 480. Nothing is thrown away, and you get the true 2×
the card exists for (1728×960). That is the official "draft small, then upscale" workflow on a clean
generated clip, its intended input. A blurred or compressed input would be its documented out-of-scope case. The
previous run fed a clean 480p clip at the 544 literal and got a "modest enlargement" (960×512, i.e. 1.07×); this
fixes that. Cost is roughly 4–5× the default, hence `keepRuntime: true`.

**Inputs**: `loadvideo_file_5001` — a clean, small (480p) generated clip **with a sound track** (the card fails
on silent video) — `output:video_minimax_h3_t2v_turbo` (864×480 with audio; whatever its showcase prompt is),
falling back to `video_fastvideo_fasth3_t2v` (also 864×480 with audio), then `asset:d6.mp4` (480×480, 30 fps,
with audio, but real footage, which the card says is not its purpose). `loadimage_image_2004` — none.

**Expected result / how to judge it**: 1728×960 from 864×480 (or 960×960 from d6), 113 frames; at the same
display size the result has crisper edges, hair, fabric and surface texture than the input; composition and
motion unchanged; the soundtrack is identical to the source.

**Risks**: invented detail can change small faces or text (the card says it is not pixel-accurate); about 1.7 MP
of video frames in one pass could approach the 32 GB limit (the union card's stage 2 does 1920×1024, so it
should fit). A default-cost alternative needs a NEW video derivation: `scale_video {short_side: 288}` (lanczos,
keep fps and audio, high-quality encode, no blur or added compression), applied to any 704p clip with sound,
then the default output size 576.

**Links to fix**:
- meta `requirements.models` → `ltx-2.5-22b-ic-lora-pixel-spatial-upscaler-x2-1.0.safetensors` has
  `source: https://huggingface.co/Lightricks/LTX-2.3-22b-IC-LoRA-Pixel-Spatial-Upscaler`. That repo holds the
  **2.3** files (`ltx-2.3-…-x2-0.9`, `…-x4-0.9`). Replace it with **`https://huggingface.co/Lightricks/LTX-2.5-22b-IC-LoRA-Pixel-Spatial-Upscaler`**
  (200, the ComfyUI LTX-2.5 tutorial links it). Direct url (gated, so HEAD = 401, unverifiable):
  `https://huggingface.co/Lightricks/LTX-2.5-22b-IC-LoRA-Pixel-Spatial-Upscaler/resolve/main/ltx-2.5-22b-ic-lora-pixel-spatial-upscaler-x2-1.0.safetensors`.
- `_template.json` "Model Links" note: "IC-LoRA Deblur" links to `Lightricks/LTX-2.3-22b-IC-LoRA-Deblur` (wrong repo, wrong name).
- Description: drop "Deblur" and "Clean up a soft, blurry…". Say it re-renders a small clip at up to 2× with
  new detail and is not for heavy blur or compression. api literal output size 544 ≠ meta default 576.

```json
{ "workflow": "utility_ltx2_5_video_deblur_upscale",
  "title": "Enlarge a video 2×, adding detail",
  "summary": "Upload a small video that has sound; it redraws it at up to twice the size with new fine detail, keeping the original sound. Pick it to finish a quick draft — it invents detail, so it is not for exact restoration.",
  "note": "The 480p clip from the fast text-to-video card, redrawn at 960p: compare edges, faces and textures at the same size, and notice that the soundtrack is the original one.",
  "params": {
    "primitiveboolean_value_5014_5506": false,
    "primitivestringmultiline_value_5508": "Sharp, highly detailed footage with clean textures, natural colours and crisp edges.",
    "resizeimagemasknode_resize_type_shorter_size_5548_5026": 960
  },
  "inputs": {
    "loadvideo_file_5001": { "need": "clean 480p generated clip WITH an audio track", "source": "{ \"from\": [\"video_minimax_h3_t2v_turbo\", \"video_fastvideo_fasth3_t2v\"], \"fallback\": \"asset:d6.mp4\" }" },
    "loadimage_image_2004": { "need": "none", "source": "null" }
  },
  "keepRuntime": true, "estSec": 170,
  "sources": ["https://huggingface.co/Lightricks/LTX-2.5-22b-IC-LoRA-Pixel-Spatial-Upscaler", "https://huggingface.co/Lightricks/LTX-2.3-22b-IC-LoRA-Pixel-Spatial-Upscaler", "https://docs.ltx.io/open-source-model/usage-guides/ic-lo-ra", "https://docs.comfy.org/tutorials/video/ltx/ltx-2-5"] }
```

## video_edit_ltx2_3_3dreal_vid2vid

**What the model is good at** (with sources): `3DREAL-strong` is fal's (Lovis Odin) IC-LoRA for LTX-2.3. It
turns "a rough grey 3D viewport animation (a simple low-poly blockout)" into "photorealistic, film-quality video,
while keeping the exact composition, camera move and layout of the input". **Trigger word `3DREAL`, "always kept
at the start of the prompt"**, plus an optional photoreal keyframe for frame 1 (fal model card / README). The
example prompts follow the pattern `3DREAL. Make it photorealistic. <scene>.`, and the first one is "A cargo
ship stacked with shipping containers in a busy harbor at dawn". The repo's official ComfyUI workflow note
reads: "Prompt must start with the trigger 3DREAL and DESCRIBE THE ACTION (+ audio cues)", "Frame count must be
8k+1… 24 fps", and, ⚠ **"The guide feeds the raw render frames to the IC-LoRA (no canny/depth/pose
preprocessing — the render IS the control signal)."** In the assessment it was ★: "a convincing ship in a storm;
the container lettering is garbled in places".

**Showcase idea**: keep its intended pair (the grey container-ship blockout + `rough3Drender_reference.png`, a
storm photo of frame 0). This time **add the trigger word and a prompt that matches the keyframe**: the
2026-11-03 run sent no prompt at all, because both api literals are empty. The prompt describes the action and
the sound (the official note says to), including the cut back to the wide view that is in the render at about
3.5–4 s. Students see the before and after directly against the grey render.

**Inputs**:
- `loadvideo_file_199` — a rough grey 3D animation with a camera move — `asset:rough3Drender.mp4`.
- `loadimage_image_200` — a photoreal version of its first frame, same framing and aspect — `asset:rough3Drender_reference.png`.

**Expected result / how to judge it**: frame 0 = the storm keyframe; a real weathered ship with rusty containers
in a heaving sea, with the same push-in and the same cut as the render; spray and rain; wind, waves and a horn
on the soundtrack; 1280×704, 145 frames.

**Risks**: container lettering from the keyframe (MAERSK, CMA CGM: real brand names) garbles over the clip
(documented). If that matters, make a logo-free keyframe from frame 0 of the render with an image-edit card. ⚠
Two graph defects the showcase cannot fix (owner's call):
(1) **wrong guide**: the bundle feeds a **MoGe depth map** to the 3DREAL IC-LoRA (`697:25 → 129:115.image`),
while the LoRA's official workflow feeds the **raw render frames**. It has worked through the keyframe and the
depth layout, but it is not the conditioning the LoRA was trained with.
(2) **frame rate**: `129:114` fixes 25 fps for both conditioning and output, while the source is 30 fps. The
5 s slice (150 → 145 frames) plays back as 5.8 s at 0.83× speed. This is the same class as the SAM3 fps bug:
wire it from `GetVideoComponents` (the official workflow says 24 fps and 8k+1 frames).

**Links to fix**:
- model `3DREAL-strong.safetensors` has no url/source → `source: https://huggingface.co/fal/LTX-2.3-3DREAL-LoRA`,
  `url: https://huggingface.co/fal/LTX-2.3-3DREAL-LoRA/resolve/main/3DREAL-strong.safetensors` (302, OK). The
  repo now also has `3DREAL-strong-v2.safetensors` (multi-scene, audio, talking characters) and `3DREAL-light`.
- default prompts lack the `3DREAL` trigger; the description says depth is "used as an IC-LoRA control", which
  contradicts the LoRA's own workflow; the template's Model Links note lists the union-control LoRA, which this
  graph does not load. Suggest adding the fal model card as a promptGuide (trigger word).

```json
{ "workflow": "video_edit_ltx2_3_3dreal_vid2vid",
  "title": "Turn a rough 3D render photoreal",
  "summary": "Upload a rough grey 3D animation plus one finished-looking picture of its first frame; it turns the animation into realistic footage with the same camera move, and adds sound. Pick it to preview a 3D scene as if it had been filmed.",
  "note": "A grey blockout render and one photoreal still of its first frame become a ship ploughing through a storm, with the render's exact camera move and cut.",
  "params": {
    "comfyswitchnode_on_false_129_211": "3DREAL. Make it photorealistic. A weathered cargo ship stacked with rusty red, blue and grey shipping containers ploughs through a stormy grey sea under low, heavy clouds. The camera glides close along the wall of containers, then the view cuts back to a wide shot of the whole ship as cold spray bursts over the bow and rain streaks across the frame. Sound: howling wind, heavy waves slamming the steel hull, rain drumming on metal and the long low blast of the ship's horn."
  },
  "inputs": {
    "loadvideo_file_199": { "need": "grey 3D blockout animation with a camera move", "source": "asset:rough3Drender.mp4" },
    "loadimage_image_200": { "need": "photoreal version of the render's first frame, same framing", "source": "asset:rough3Drender_reference.png" }
  },
  "keepRuntime": false, "estSec": 135,
  "sources": ["https://huggingface.co/fal/LTX-2.3-3DREAL-LoRA", "https://huggingface.co/fal/LTX-2.3-3DREAL-LoRA/blob/main/workflows/3DREAL-strong-v2-comfyui-workflow.json", "https://comfyui-wiki.com/en/news/2026-06-29-ltx-2-3-3dreal-lora-render-to-real", "https://ltx.io/blog/ltx-2-3-prompt-guide"] }
```

## video_ltx2_3_ia2v_iclora

**What the model is good at** (with sources): this is ComfyUI's **"LTX-2.3: Image Audio to Video" (IA2V)**
template. It "takes a reference image of a speaking character and an audio track, then produces a video with
synchronized lip movements" (ComfyUI LTX-2.3 tutorial). In the graph, the audio is VAE-encoded and **frozen**
(`SetLatentNoiseMask` with a 0 mask), so the picture is generated to fit the given sound, trimmed to the
duration. The LTX-2.3 guide: "Audio-to-Video: Your audio input anchors the temporal structure. Use the prompt
to describe the visual interpretation of that audio"; "Characters can talk and sing". ⚠ **There is no IC-LoRA in
this graph** (dev fp8 + distilled LoRA at 0.5 + 2× upscaler), so the "IC-LoRA" in its name and description is
wrong. ⚠ The "Enhance prompt with AI" step (on by default) is **text-only: it does not see the picture**
(`340:346` has no image input). In the assessment it was "lip-synced, 9 s — but frame 0 is the input picture and
then it **cuts** to the setting the prompt describes" (the prompt had described a different room).

**Showcase idea**: **a recorded voice makes a stylised character talk**. The picture is the assets' steampunk
mechanic: an expressive face, colour, a busy workshop. The voice is `duflot-2.mp3`: 20 s of continuous speech,
female (median pitch ~207 Hz, so it suits her), steady level. The cut is avoided by writing the prompt to
describe **the picture's own setting**: workshop, pipes, gears. This matters doubly because the enhancer can't
see the picture. W×H is set to **960×960**: the picture is square and the 16:9 crop would cut off her goggles,
and 960² has exactly the pixel count of the 1280×720 literal, so the cost is unchanged.

**Inputs**:
- `loadimage_image_269` — a front-facing character, mouth visible, clear setting — `asset:woman_mechanic.png` (1024², steampunk workshop).
- `loadaudio_audio_276` — a clean voice recording at least as long as the duration (9 s) — `asset:duflot-2.mp3`.

**Expected result / how to judge it**: frame 0 = the picture; **no cut** — the workshop stays for all 9 s; lips,
jaw and eyebrows follow the speech rhythm (check a few syllable peaks); head tilts and a hand gesture; gears
turning behind; the soundtrack is the recording; 960×960, 217 frames at 24 fps.

**Risks**: `duflot-2` sounds like a recording of a real public figure (the filename suggests the French
politician Cécile Duflot). Putting a real person's words in a fictional character's mouth is the owner's call.
The alternative is a generated line: extract the audio track of my t2v output, which has a spoken line. That
needs a NEW derive op `audio_of {}` (video → .wav), which is shorter material. If the cut still appears, turn
"Enhance prompt with AI" off (`primitiveboolean_value_340_349: false`, `keepRuntime: true`, saves time).

**Links to fix**: none broken. Rename/describe without "IC-LoRA"; the description "uses the distilled model and
no identity LoRA" should read "the dev model with the distilled LoRA at half strength". Say the enhancer does not
see the picture, and mention that singing works too. Suggest adding `https://docs.comfy.org/tutorials/video/ltx/ltx-2-3`
(IA2V section) as a guide. Height literal 720 ≠ meta 704 (harmless).

```json
{ "workflow": "video_ltx2_3_ia2v_iclora",
  "title": "Make a picture speak a recording",
  "summary": "Give a picture of a character and a voice recording; the character speaks the recording with matching lips and expressions, in a short video. Pick it when the voice must be your own audio.",
  "note": "A recorded voice drives a steampunk character: her lips, eyebrows and head follow the speech for nine seconds, and the workshop behind her stays put because the prompt describes the picture's own setting.",
  "params": {
    "primitivestringmultiline_value_340_319": "The woman talks warmly to the camera in her steampunk workshop, her eyebrows rising and her smile widening between sentences, her head tilting as she makes a point and one hand rising into frame in a small gesture. The orange lenses of her round spectacles catch the light. Behind her the big brass gears turn slowly and a copper pipe lets out a thin wisp of steam. Static medium close-up, the camera fixed on her face.\n\nscene: a cluttered steampunk workshop of rusty copper pipes, riveted boilers and big brass gears, warm amber light\ncharacter: a cheerful woman in her sixties with wild blue and orange curls, brass goggles pushed up on her head, round orange-tinted spectacles, a leather vest over a blue shirt\naction: talking to the camera with clear lip movements and lively expressions\ncamera: static medium close-up, fixed on her face",
    "primitiveint_value_340_330": 960,
    "primitiveint_value_340_324": 960
  },
  "inputs": {
    "loadimage_image_269": { "need": "front-facing character, mouth visible, a clear setting", "source": "asset:woman_mechanic.png" },
    "loadaudio_audio_276": { "need": "clean speech ≥ 9 s", "source": "asset:duflot-2.mp3" }
  },
  "keepRuntime": false, "estSec": 135,
  "sources": ["https://docs.comfy.org/tutorials/video/ltx/ltx-2-3", "https://ltx.io/blog/ltx-2-3-prompt-guide", "https://docs.ltx.io/open-source-model/usage-guides/prompting-guide"] }
```

## video_ltx2_3_ic_lora_ingredients

**What the model is good at** (with sources): Lightricks' Ingredients IC-LoRA "conditions video generation on a
reference sheet — a single composite image inventorying the characters, props, and location of a scene — so
that generated videos keep those elements visually consistent" (model card, quoted in the template note).
Requirements: one clean panel per element (a face close-up and a body turnaround per character, a product-style
view per prop, one location panel), **on a black background with no text**. "Bigger panels carry over better".
Use a two-part prompt `Reference sheet: … / Generated video: …`. It was trained at 768×448 / 121 frames / 24 fps;
the card recommends strength 1.4. The file metadata confirms `reference_downscale_factor: 1`. The LTX-2.3 guide
lists "Text and logos — Readable text is not currently reliable". In the assessment, the previous run (the Krea
quadview on **white**, **3:2**, plus a **spoken line**) gave a consistent character, but **pillarboxed** (the 3:2
sheet padded to 16:9 with black, and the black bars reproduced) and with a **garbled subtitle burned in**. I
verified both on the frames.

**Showcase idea**: a purpose-built sheet with all three ingredient kinds: a character (an elderly clockmaker:
face close-up, front and back full-body), a prop (a brass pocket watch) and a location (his workshop of pendulum
clocks). It is made **16:9 on black, with no text**, so there are no pillarbox bars, it matches the model card's
format, and nothing invites lettering. The scene uses all three: he opens the watch at his bench. **No spoken
dialogue**, which avoids the documented subtitle burn-in; the soundtrack is ticking clocks, a click and chimes.

**Inputs**: `loadimage_image_724` — a 16:9 reference sheet on black, no text, five panels (described below) —
**NEW producer run** (see Upstream). It needs a layout-capable text-to-image card: `image_moss_image_t2i` with
the box layout below (MOSS's own strength), or `image_qwen_image_2_1_t2i` at 16:9 with the same caption.
Fallback if neither run can be given this job: `output:image_edit_krea2_quadview` with W×H 1152×768 (3:2,
no bars), which is character-only.

**Expected result / how to judge it**: no black side bars; no on-screen text or subtitles; the clockmaker's
bald head, white moustache, gold round spectacles and dark green apron match the sheet; the brass watch with the
engraved lid appears in his hand and opens; the wall of pendulum clocks and the green-shaded lamp match the
location panel; ticking, a click and three chimes on the soundtrack; 1280×704, 121 frames at 25 fps.

**Risks**: the panels of a generated sheet may not agree with each other (the face in panel 1 vs the body in
panels 3–4), and the LoRA then reproduces the inconsistency. MOSS renders text very readily, so check that the
sheet came out text-free before the video run. Strength stays at the 1.0 default (the card suggests up to 1.4).

**Links to fix**: template note: "Hugging Face (Ingredients IC-LoRA): [Lightricks/LTX-2.3-22b-IC-LoRA-Ingredients]"
points to the Comfy-Org file, not that repo; its "docs.ltx.video — IC-LoRA usage guide" link returns **403** →
`https://docs.ltx.io/open-source-model/usage-guides/ic-lo-ra`. Suggest adding the model card
`https://huggingface.co/Lightricks/LTX-2.3-22b-IC-LoRA-Ingredients` as a promptGuide (the two-part format).
Minor: the graph runs 25 fps (`716`), while the LoRA was trained at 24.

```json
{ "workflow": "video_ltx2_3_ic_lora_ingredients",
  "title": "Turn a reference sheet into video",
  "summary": "Upload one sheet showing your character, a prop and a place on a black background, then describe a scene; the video keeps all three looking just like the sheet, with sound. Pick it to keep a character consistent from shot to shot.",
  "note": "One sheet — the clockmaker, his watch and his workshop on black — and a scene description. Notice that his face, apron and spectacles, the watch and the wall of clocks all match the sheet.",
  "params": {
    "comfyswitchnode_on_false_129_211": "Reference sheet: Five panels on a black background. Top left, a close-up portrait of an elderly clockmaker — a man in his seventies with a bald head, a bushy white moustache and round gold-rimmed spectacles, in a white shirt with rolled sleeves and a dark green leather apron. Bottom left, a product view of an ornate brass pocket watch with an engraved lid and a plain white enamel dial. In the middle, the same clockmaker standing full-body seen from the front and from the back, in his white shirt, dark green leather apron, brown trousers and brown leather shoes. On the right, a wide shot of his clock-repair workshop: a wooden workbench under a green-shaded brass lamp and a wall covered with wooden pendulum clocks.\n\nGenerated video: A cinematic medium shot inside the clock-repair workshop. The clockmaker sits at the wooden workbench under the green-shaded lamp, the wall of pendulum clocks swinging behind him. He picks up the brass pocket watch, flips its engraved lid open with his thumb, raises it to his ear and listens, then breaks into a satisfied smile and gently snaps it shut. The camera slowly pushes in from the medium shot to a close-up of his face and the watch in his hand. Warm afternoon light falls through a dusty window. Sound: dozens of clocks ticking out of step, a soft click as the lid opens, and one wall clock striking three deep chimes."
  },
  "inputs": {
    "loadimage_image_724": { "need": "16:9 reference sheet on pure black, no text: face close-up, front and back full-body of one character, one prop, one location", "source": "NEW: output of image_moss_image_t2i (or image_qwen_image_2_1_t2i) run with the sheet prompt in 'Upstream inputs'; fallback output:image_edit_krea2_quadview (then set resizeandpadimage_target_width_722=1152, resizeandpadimage_target_height_722=768)" }
  },
  "keepRuntime": false, "estSec": 62,
  "sources": ["https://huggingface.co/Lightricks/LTX-2.3-22b-IC-LoRA-Ingredients", "https://ltx.io/blog/ltx-2-3-prompt-guide", "https://docs.ltx.io/open-source-model/usage-guides/ic-lo-ra"] }
```

---

## Upstream inputs this group needs

1. **Reference sheet for `video_ltx2_3_ic_lora_ingredients`** (NEW producer run, stage 1). Preferred card:
   `image_moss_image_t2i` (box layout is its showcase strength); alternative `image_qwen_image_2_1_t2i`.
   Settings: aspect `16:9 (Widescreen)`, 1 MP (→ about 1376×768), card defaults otherwise.
   - Caption (`prompt_117` / `textencodeqwenimage21_prompt_459_452`):
     *"Character design reference sheet on a pure black background, studio photography style, five clean
     separate panels with black gaps between them and absolutely no text, no labels, no numbers and no
     captions. Top-left panel: a head-and-shoulders close-up portrait of an elderly clockmaker, a man in his
     seventies with a bald head, a bushy white moustache and warm brown eyes behind round gold-rimmed
     spectacles, wearing a white shirt with rolled sleeves under a dark green leather apron, facing the camera
     in soft key light. Bottom-left panel: a catalogue product photograph of an ornate brass pocket watch with
     its engraved lid open, a plain white enamel dial with thin black hands and a short brass chain. Two tall
     middle panels: the same clockmaker standing full-body, seen from the front and from the back, in the same
     white shirt, dark green leather apron, brown trousers and brown leather shoes, arms relaxed at his sides.
     Right panel: a wide shot of his clock-repair workshop — a wooden workbench under a green-shaded brass lamp,
     a wall covered with dozens of wooden pendulum clocks, shelves of tools and brass gears, warm afternoon light
     through a dusty window."*
   - MOSS `layout_24` (bbox = [y0, x0, y1, x1] in 0–1000, the format the current suite's MOSS run uses):
     ```json
     [ {"type":"obj","bbox":[30,15,480,230],"desc":"close-up portrait of the elderly bald clockmaker with a white moustache and round gold spectacles, dark green apron"},
       {"type":"obj","bbox":[520,15,970,230],"desc":"product photo of an ornate brass pocket watch with an engraved open lid and a plain white dial"},
       {"type":"obj","bbox":[30,250,970,420],"desc":"the same clockmaker standing full-body, front view, white shirt, dark green leather apron, brown trousers"},
       {"type":"obj","bbox":[30,440,970,610],"desc":"the same clockmaker standing full-body, back view, dark green apron straps, brown trousers"},
       {"type":"obj","bbox":[250,630,750,985],"desc":"wide shot of a clock-repair workshop with a wooden workbench, a green-shaded lamp and a wall of pendulum clocks"} ]
     ```
     `character_boxes_27`: `"1, 3, 4"`. Check the result is text-free before the ingredients run uses it.
2. **NEW suite capability: derive from an asset** (used by `video_ltx2_5_flf2v`):
   `{ "from": "asset:2795750-uhd_3840_2160_25fps_1_1.mp4", "kind": "video", "derive": [{"op":"frame","index":0}] }`.
   `derive_input.py` already extracts frames. Only `parseMediaSpec`/the resolver must accept an `asset:` source.
   Simpler alternative: extract frame 0 once into `J:\_assets\dancer_frame0.png` and reference it as an asset.
3. **Wiring only — `utility_ltx2_5_video_deblur_upscale`** reads the 480p clip with sound that
   `video_minimax_h3_t2v_turbo` produces for its own showcase, whatever its prompt is (fallback
   `video_fastvideo_fasth3_t2v`, then `asset:d6.mp4`). If the H3 card's showcase is changed away from
   864×480, set the deblur output size to 2× its short side.
4. **Shared asset clips** (no new run): `2795750-uhd_3840_2160_25fps_1_1.mp4` feeds the union (depth), pose
   and first/last-frame cards; `rough3Drender.mp4` feeds the canny and 3DReal cards. If the integrator
   wants like-with-like comparisons, the same FLF pair fits `video_fastvideo_fasth3_i2v` and
   `video_pika_h3_flex_fl2va`, and the same dancer clip + knight prompt fits the H3 union / Wan SCAIL cards.
5. **Do not use `video_ltx2_5_t2v`'s output as the generic stage-4 restyle source**: it is deliberately
   multi-shot, so it contains a cut. Use a single-take clip (my `video_ltx2_5_i2v` output or the dancer asset).
6. Optional extras, not required by the plan above:
   - a logo-free keyframe for 3DReal: an image-edit card restyles frame 0 of `rough3Drender.mp4` into "a real
     weathered cargo ship in a storm, plain unbranded containers" (needs the derive-from-asset capability);
   - a pose start image: `image_edit_flux2_klein_ref_control_depth` with frame 0 of the dancer clip as structure
     and the prompt "a knight in polished silver plate armour with a crimson cape, in a torch-lit castle hall";
   - a generated voice for ia2v instead of a real person's recording: NEW derive `audio_of {}` (extract a
     video's audio track to .wav), applied to `video_ltx2_5_t2v`'s output.

### Defects found on the way (for the owner)

- **3DReal graph conditions the 3DREAL IC-LoRA on a MoGe depth map; its own ComfyUI workflow feeds the raw
  render frames** ("the render IS the control signal"). Output/conditioning fps are hard-coded to 25 (a
  30 fps source plays at 0.83×). The `3DREAL` trigger is missing from the defaults, and both prompt literals are
  empty. The model has no url/source.
- **Deblur card**: it is the Pixel Spatial Upscaler (a generative 2× upscaler, "not a blind denoiser"), not a
  deblur LoRA. The meta source points at the LTX-2.3 repo, the template link at the LTX-2.3 Deblur repo. The
  output-size literal (544) ≠ the meta default (576).
- **Union (depth) card**: working-resolution literal 544 ≠ meta default 512, so its calibration measured a
  heavier job than a student's default.
- **ia2v card**: there is no IC-LoRA in the graph, and the prompt enhancer (on by default) cannot see the picture.
- **Ingredients**: the white 3:2 quadview sheet caused the pillarbox, and the spoken line caused the subtitle.
  The template note has a 403 docs.ltx.video link and a mislabelled HF link.
- **IC trio**: "Clip length 5 s" at 24 fps gives 113 frames (4.7 s), because the frame count is floored to 8k+1
  (a 5.04 s source yields 120 sliced frames). Harmless, but the label promises 5 s.
