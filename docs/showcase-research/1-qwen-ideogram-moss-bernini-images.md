# g1 — Qwen-Image, Ideogram 4, MOSS-Image, Bernini-R (image cards)

Research and showcase proposals for 14 bundles. I read every bundle's meta, api.json key nodes and template notes, plus the 2026-11-03 assessment, and checked the model claims against primary sources (URLs in each block). All 14 proposals are machine-checked against the metas: every param key exists, every select value is one of its options, numbers are in range, and every required image input is filled (script: `(scratchpad)/g1tools\proposals.js`, output `(scratchpad)/g1tools\blocks.json`).

**What shapes the whole group:**
- **No upstream producer runs needed.** Every input is an asset I opened and looked at (`J:\_assets`), used as-is or derived from it, so each prompt names what is really in its picture and each box or circle coordinate was checked against the actual pixels. This group can therefore run first and in any order. The trade-off is that it does not continue the lighthouse story. If the integrator wants the story kept, the inputs are described abstractly, so story pictures can be swapped in.
- **Three derive capabilities are needed** (they are listed at the end): deriving from an `asset:` rather than only from a bundle output, an outline `circle` op, and a `composite` (paste a cut-out) op. The circle and composite ops have a working prototype in `(scratchpad)/g1tools\proto_ops.py`. I opened its previews, `(scratchpad)/g1tools\qwen_edit_circles.png` and `(scratchpad)/g1tools\relight_composite.png`, to check that the placement is right.
- **Defaults are kept everywhere except one run.** `image_qwen_image_2_1_t2i` runs at native 2K (4 MP), because its showcase is dense small text. That is the model's documented native size, and the run is marked `keepRuntime`.
- **Estimated group cost:** about 400 s warm plus model loads, so roughly 10 minutes.

---

## image_qwen_image_2_1_t2i
**What the model is good at** (with sources):
- A 7B-parameter text-to-image and editing model.
- The model card lists "Improved typography, portrait lighting, and fine details", native RGBA ("Generate regular or transparent (RGBA) images from text") and 2K output, with examples at 2048×2048 and ratios up to 2752×1536 [HF card].
- ComfyUI's tutorial says "dense small text and complex layouts hold up, for infographics, slides, UI mockups, posters, and packaging designs" and "Qwen-Image-2.1 generates natively at 2K, so set the target to about 4.0 MP". It warns that targets well above 2K lose adherence [docs.comfy.org].
- Alibaba's post: "text rendering considers not only the content itself, but also type styles, layout, and their relationship to the overall composition" [Alibaba Cloud blog].
- On this rig (2026-11-03) it drew the shared scene "with every checkable detail right", which made it the library's most accurate composer.
- ⚠ **Chinese:** the 2.1 card and ComfyUI's page never mention it. Chinese rendering is documented for the earlier Qwen-Image (Aug 2025, arXiv 2508.02324, with top scores on ChineseWord and LongText-Bench), not for 2.1. I therefore kept the showcase in English and French and gave Chinese to MOSS, whose card does show it.

**Showcase idea:** a flat lay of a design student's desk, shot from directly above, with eight objects. Each object's position is stated in a sentence, and six pieces of text sit on them: a printed cover, a printed sleeve, a handwritten note, a label, a sticky note and a ruler's numbers. It is rendered at native 2K (4:3, 4 MP → 2368×1776).
- It shows both documented strengths at once, dense composition and small text, at the size the model was trained for.
- It plays to the measured strength (accurate placement). It avoids poster lettering, which Ideogram and MOSS cover.

**Inputs:** none.

**Expected result / how to judge it:**
- "SKETCHBOOK 2026" is on the black sketchbook at top left.
- "AGORA CAFÉ" (with the accent) is on the cup sleeve at top right.
- The handwritten "chair v3 - lower the back 2 cm" is under a pencil chair sketch in the centre.
- "HB 2B 4B 6B" is on the tin at the left edge.
- "crit at 10:30" is on the red sticky note at bottom right.
- The ruler along the bottom edge is numbered 0–15 in order.
- It is a true top-down view.
- Output is 2368×1776.

**Risks:**
- The ruler numbers are the hardest element; a skipped or repeated digit is the likeliest flaw.
- Cost at 4 MP is unmeasured. I estimate about 100 s: 1 MP takes 15 s (1.71 it/s), and 4× the tokens costs roughly 7× once attention is counted.
- If cost must stay at the default, run 1 MP. The texts are short enough to stay legible, but the "native 2K" point is lost.

**Links to fix:**
- **Chinese claim:** the meta's "in Latin and Chinese alike" is inherited from Qwen-Image 1.0. Say it is unverified for 2.1.
- **RGBA wording:** the meta says it is "the phrasing Qwen documents", but it is ComfyUI's template wording ("an RGBA format image … an alpha channel and a transparent background"). The official card's wording is: "This is an RGBA image with transparency. <subject>. The image has alpha channel and the background is transparent." Either quote the card or credit ComfyUI.
- Links: none dead.

```json
{
  "workflow": "image_qwen_image_2_1_t2i",
  "title": "Draw busy scenes exactly as described",
  "summary": "Describe a scene in full sentences - where each thing sits and what every label or sign says - and it draws all of it, up to large 2K prints. Pick it when a picture has many parts or small writing; it can also make cut-outs with a see-through background.",
  "note": "One sentence per object and every word in quotes: all six labels on this desk are written exactly, and each object sits where the prompt put it. It was drawn at the model's native 2K size, so zoom in on the small print.",
  "params": {
    "textencodeqwenimage21_prompt_459_452": "Overhead flat-lay photograph, shot from directly above, of a tidy design student's desk: a pale birch-plywood tabletop in soft north-window daylight. In the top left corner, a closed black hardback sketchbook whose cover reads \"SKETCHBOOK 2026\" in white sans-serif capitals. In the top right corner, a white ceramic coffee cup on a saucer, wrapped in a kraft-paper sleeve printed \"AGORA CAFÉ\". In the centre, an open A5 notebook showing a pencil sketch of a wooden chair, with the handwritten note \"chair v3 - lower the back 2 cm\" under the drawing. On the left edge, a round metal tin of pencils with a label reading \"HB 2B 4B 6B\". In the bottom right corner, a square red sticky note with the handwritten words \"crit at 10:30\". Along the bottom edge, a steel ruler with centimetre marks numbered 0 to 15. A yellow pencil and two black binder clips lie between the objects. Crisp detail, natural colours, soft gentle shadows, realistic photograph.",
    "resolutionselector_aspect_ratio_13": "4:3 (Standard)",
    "resolutionselector_megapixels_13": 4
  },
  "inputs": {},
  "keepRuntime": true,
  "estSec": 100,
  "sources": [
    "https://huggingface.co/Qwen/Qwen-Image-2.1",
    "https://docs.comfy.org/tutorials/image/qwen/qwen-image-2-1",
    "https://alibabacloud.com/blog/qwen-image-2-1-compact-efficient-and-unified-image-creation_603586",
    "https://arxiv.org/abs/2508.02324"
  ]
}
```

## image_qwen_image_2_1_t2i_fix
**What the model is good at** (with sources):
- The README says only that it is "A lora that, when used with the proper settings, fixes most of the image generation issues with Qwen Image 2.1". The settings (20 steps, cfg 3, seeds_2/sgm_uniform, APG + FreSca) are inside its workflow zip [HF card]. No licence or trigger word is given.
- The A/B on this rig (PROJECT-HISTORY.md, 2026-09-30) found:
  - The plain model garbled watch-dial numerals and hands.
  - The fix gave the glossiest micro-detail.
  - At "Fix strength 0", with the settings alone, it had the cleanest hands.
  - The fix also changes composition: it turned a close-up into a full figure and ignored "seen from above".
- In the 2026-11-03 suite it was ✗ on a wide composition: "the cottage drifted away from the tower".

**Showcase idea:** a tight macro of a watchmaker's hands on an open pocket watch.
- This is exactly where the fix measurably helps: fingers, dial numerals and fine print.
- It avoids the documented failure. With a single close subject there is no wide layout to drift, and the prompt fixes the framing.
- The caption sends students to the card's own A/B (Fix strength 0).

**Inputs:** none.

**Expected result / how to judge it:**
- Two hands with five fingers each, holding the watch and the tweezers plausibly.
- The dial reads I to XII in order with "GENÈVE" under XII.
- A brass loupe and two screws are visible.
- It stays a macro close-up, not a wider shot.

**Risks:**
- "Ten past ten" hand positions may be off; this is cosmetic.
- At cfg 3 a negative prompt is active; keep the default one, which lists hand faults.

**Links to fix:** none dead. Optionally add a measured line to the meta: "less accurate than the plain card on wide multi-object scenes (suite 2026-11-03)".

```json
{
  "workflow": "image_qwen_image_2_1_t2i_fix",
  "title": "Crisper close-ups from words, slower",
  "summary": "The same picture-from-words model with an add-on that sharpens small things - fingers, watch faces, fine print - in close-up shots. It takes about three times longer and can rearrange wide scenes, so use it for one subject seen up close.",
  "note": "A close-up is where this card earns its extra time: count the fingers, read the numerals I to XII and the word GENÈVE on the dial. Re-run it with Fix strength at 0 (same seed) to see what the add-on itself changes.",
  "params": {
    "textencodeqwenimage21_prompt_459_452": "Macro photograph of a watchmaker's hands repairing an open gold pocket watch on a dark green leather work mat. The left hand steadies the watch case between thumb and index finger; the right hand holds fine steel tweezers lifting a tiny brass gear out of the movement. The white enamel dial shows black Roman numerals from I to XII and the word \"GENÈVE\" in small capitals under the XII, with blued steel hands at ten past ten. A brass loupe and two tiny screws lie beside the watch. Warm desk-lamp light from the upper left, shallow depth of field, crisp detail, natural skin texture with fine creases on the knuckles."
  },
  "inputs": {},
  "keepRuntime": false,
  "estSec": 46,
  "sources": [
    "https://huggingface.co/e-n-v-y/Qwen-Image-2.1-Fix",
    "https://huggingface.co/Qwen/Qwen-Image-2.1"
  ]
}
```

## image_qwen_image_2_1_control_canny
**What the model is good at** (with sources):
- Alibaba PAI's Qwen-Image-2.1 Fun ControlNet Union covers "8 structural control conditions" (Canny, Depth, Grayscale, HED, Lineart, MLSD, Pose, Scribble) plus inpainting [HF card].
- Card advice:
  - `control_context_scale = 1.0` "is the value the adapter expects".
  - "write a prompt that describes the whole target image"; "Detailed prompts give better stability".
  - Samples use 40 steps.
- The bundle meta says canny is at its best on clear lines.
- On this rig, on a soft golden-hour photo, canny "lost the cottage" where depth kept it. Soft photos are canny's weakness.

**Showcase idea:** a child's flat-colour drawing (`naive_drawing.png`: a girl with huge blonde pigtails, a pink dress, arms out, a green hill and two clouds) becomes a photograph of a handmade felt doll.
- A flat-colour drawing is pure, crisp boundaries, which is canny's ideal input. This is the opposite of the soft photo that failed.
- A felt doll keeps a child's proportions believable, where a "real girl" with those proportions would look uncanny.

**Inputs:** see block.

**Expected result / how to judge it:**
- Lay the result over the drawing: the outline of the two pigtail "wings", the arms straight out, the dress shape, the hill line and both clouds coincide.
- Materials read as felt and yarn, with button eyes and a stitched smile.
- Output is 1024×1024.

**Risks:**
- The 512² drawing is upscaled to 1024 before canny, so edges soften slightly. The defaults (0.4/0.8) should still find all the colour boundaries.
- If the faint inner hair highlight lines are traced as extra strands, that is acceptable; raise "edge strength" to drop them.

**Links to fix:**
- The steps label "(25 is quick, 40–50 is Qwen's own setting)" does not match the field: the default is 20 and the max 40, so "50" is unreachable. Same on the depth card.
- Links: none dead.

```json
{
  "workflow": "image_qwen_image_2_1_control_canny",
  "title": "Turn a drawing into a photo",
  "summary": "Give it a drawing, a line sketch or a photo with clear outlines and describe what it should become; every line stays exactly where it was drawn and everything else comes from your words. Best for drawings, buildings and objects with crisp edges.",
  "note": "A child's flat colour drawing went in; out came a photographed felt doll with the same huge pigtails, outstretched arms, hill and two clouds, line for line. Compare the outline of the hair with the drawing.",
  "params": {
    "textencodeqwenimage21_prompt_459_452": "Photograph of a handmade felt doll of a little girl standing on a rolling hill of bright green felt under a sky-blue felt backdrop with two white cotton-wool clouds. She has two enormous puffy pigtails of golden yarn sticking out sideways like wings, round blue button eyes, a small stitched black smile, a pink cotton dress, and her arms stretched straight out to the sides. Soft natural daylight, visible felt fibres and neat stitching, shallow depth of field, craft photography.",
    "resolutionselector_aspect_ratio_13": "1:1 (Square)"
  },
  "inputs": {
    "loadimage_image_900": {
      "need": "a picture made of clear outlines with nothing soft or textured - a flat-colour drawing is ideal, because canny reads colour boundaries as lines",
      "source": "asset:naive_drawing.png"
    }
  },
  "keepRuntime": false,
  "estSec": 17,
  "sources": [
    "https://huggingface.co/alibaba-pai/Qwen-Image-2.1-Fun-Controlnet-Union",
    "https://huggingface.co/Qwen/Qwen-Image-2.1"
  ]
}
```

## image_qwen_image_2_1_control_depth
**What the model is good at** (with sources):
- It uses the same Union control model [HF card] with a Depth Anything V3 map.
- The meta: depth "holds on to volume and composition rather than outlines … the better choice for landscapes … and anything where the silhouette matters". It "copes with soft or busy photographs".
- On this rig it kept "tower, cottage and cliff all where they were" in an ice re-imagining.

**Showcase idea:** a phone photo of a real student maquette (`PXL_20240628_084847386.jpg`): a park model with flock grass, ~20 painted figurines watching a performer on a little white stage, wooden cube seats and a pine tree. It becomes a photograph of the real open-air concert.
- This is the depth card's distinctive job: holding the volumes and layout of a busy, tilt-shift-blurred photo, where edges would fail.
- It is also a direct design-school use case: preview your model as the built place.

**Inputs:** see block. The asset is 4080×3072, so it is scaled ×0.35 to fit the upload box. The ImageScale node crops 4:3 to 4:3, so nothing is lost.

**Expected result / how to judge it:**
- The crowd is in the same clusters, seen from behind.
- The stage is at left with the singer where the figurine stands.
- The cube seats are in the same spots, with two seated people.
- The pine is at the right edge and the shrub in the foreground.
- It reads as a real photograph, not a model.

**Risks:**
- The figurines are small, so faces will be invented. That is fine; they are seen from behind.
- Depth could make the "people" look stiff; raise steps only if a re-run is wanted.

**Links to fix:** the same steps-label mismatch as canny. Links: none dead.

```json
{
  "workflow": "image_qwen_image_2_1_control_depth",
  "title": "Re-imagine a photo, keeping its space",
  "summary": "Upload a photo - of a scale model, a room, a landscape - and describe a new picture; what is near and far and the shape of everything stays, while your words decide what it all is. Better than the outline version for soft photos and real places.",
  "note": "A phone photo of a student's park maquette (cardboard, figurines, flock grass) became a real open-air concert: the crowd, the little stage, the cube seats and the pine tree are where the model put them. This is how a maquette can be previewed as the real place.",
  "params": {
    "textencodeqwenimage21_prompt_459_452": "Photograph of an open-air summer concert in a city park in warm late-afternoon sun. A crowd of about twenty people stands on a green lawn with their backs to the camera, watching a singer with a guitar on a small raised white concrete stage on the left. Low wooden cube seats are scattered across the grass, and a woman in a red dress and a man in a navy jacket sit on two of them. A tall dark-green pine tree stands at the right edge, a low shrub sits in the foreground, and behind the lawn rises a steel-and-timber pavilion with balconies in front of a pale industrial hall. Realistic photograph, natural colours, crisp detail.",
    "resolutionselector_aspect_ratio_13": "4:3 (Standard)"
  },
  "inputs": {
    "loadimage_image_900": {
      "need": "a photo with strong, readable depth - a scale model (maquette) with figurines, near objects and a clear background - in landscape 4:3, scaled to fit the 1920x1080 box",
      "source": "derive:{from: asset:PXL_20240628_084847386.jpg, ops: [scale 0.35]}  (4080x3072 -> 1428x1075; needs the NEW 'derive from an asset' capability, or a pre-scaled copy in J:/_assets)"
    }
  },
  "keepRuntime": false,
  "estSec": 28,
  "sources": [
    "https://huggingface.co/alibaba-pai/Qwen-Image-2.1-Fun-Controlnet-Union",
    "https://huggingface.co/Qwen/Qwen-Image-2.1"
  ]
}
```

## image_qwen_image_2_1_image_edit
**What the model is good at** (with sources):
- The model card: "Support up to **10 reference images**, specify local edits via circles, painted annotations, or separate masks, … and preserve identity for people and products" [HF card].
- Alibaba's post gives the circle method with its own prompt: "Remove the metal watch in the blue circle, change the hair in the red circle to black, and replace the area in the green circle with gray short-sleeved linen pajamas" [Alibaba Cloud blog].
- ComfyUI: "Naming the mark's color in the prompt points the edit at that region". The encoder takes 16 slots and its templates wire 10 [docs.comfy.org].
- On this rig: "face and colour kept" (better than FLUX.2 Klein for keeping a person), but "the framing zoomed out".

**Showcase idea:** combine the card's two unique powers in one run. Three coloured circles on the photo say WHERE; two reference pictures say WHAT.
- On the steampunk mechanic portrait:
  - red circle → swap her orange glasses for the ski goggles in picture 2;
  - blue circle → pin the Art-Nouveau dragonfly brooch from picture 3 on her vest;
  - green circle → turn a background gear into a porthole, from words alone.
- No other card in the library does several placed edits from several references.
- Pinning each change to a circle also counters the documented zoom-out. The prompt says "keep … the framing", and the output size follows Image 1.

**Inputs:** see block. I drew the circles on a test copy and checked them. The red circle wraps the glasses, the blue circle sits on the vest's right lapel, and the green circle sits on the big gear at the right edge.

**Expected result / how to judge it:**
- Black-framed rainbow-mirror ski goggles cover her eyes.
- An enamel dragonfly with eye-spotted wings is on the right lapel.
- A round brass porthole replaces the gear.
- No circle outlines remain.
- Face, smile, blue/orange hair, the brass goggles on her head, the hoop earrings and the scarf are unchanged.
- Output is 1024×1024 with the same framing.

**Risks:**
- Outlines may survive faintly. The prompt says to remove them; the official example implies the marks are consumed.
- The brooch could be enlarged.
- If one of the three edits is missed, drop the green (text-only) edit.

**Links to fix:** the promptGuide tip says "Up to 10 reference images are supported", while the description says "up to 16". Reconcile them: Qwen documents 10; the node accepts 16 (ComfyUI wires 10). Also add the coloured-circle method to the description. It is documented and it is the best way to say *where*.

```json
{
  "workflow": "image_qwen_image_2_1_image_edit",
  "title": "Edit a photo using reference pictures",
  "summary": "Upload the photo to change plus up to nine pictures of things to bring in (an object, a garment, a face), and write what goes where; you can even draw coloured circles on the photo and name them in the prompt. Whatever you don't mention stays as it was.",
  "note": "Coloured circles say WHERE, the extra pictures say WHAT: the ski goggles from picture 2 replaced the glasses in the red circle, the dragonfly brooch from picture 3 is pinned in the blue one, and the green one was changed from words alone. Her face, hair and the background are untouched.",
  "params": {
    "textencodeqwenimage21_prompt_459_474": "In <image1>, replace the round orange glasses inside the red circle with the ski goggles from <image2>, worn over her eyes; pin the dragonfly brooch from <image3> on her leather vest inside the blue circle; and replace the copper gear inside the green circle with a round brass ship's porthole. Remove the red, blue and green circle outlines. Keep her face, smile, blue-and-orange hair, the brass goggles on top of her head, her earrings, her clothes, the framing and the rest of the background exactly as they are."
  },
  "inputs": {
    "loadimage_image_470": {
      "need": "a busy, detailed portrait with several distinct objects to target, marked with three coloured ellipse OUTLINES (no fill): red round the glasses, blue on the vest's right lapel, green round the gear at the right edge",
      "source": "derive:{from: asset:woman_mechanic.png, ops: [circle box [0.25,0.25,0.69,0.48] #FF0000 width 8px; circle box [0.60,0.72,0.78,0.90] #0057FF width 8px; circle box [0.81,0.37,0.995,0.60] #00C000 width 8px]}  (NEW op 'circle'; positions checked on the 1024x1024 asset)"
    },
    "loadimage_image_475": {
      "need": "a product shot of the object that replaces the glasses, on a plain background",
      "source": "asset:2f42ec649db902ccf63918f16293bd963dc4d65b_original.jpg (rainbow-mirror ski goggles on white, 746x746)"
    },
    "loadimage_image_476": {
      "need": "a product shot of a small, detailed accessory",
      "source": "asset:nv.1197-trat.-fundo-CAzev.jpg (Art Nouveau enamel dragonfly brooch on white, 700x700)"
    }
  },
  "keepRuntime": false,
  "estSec": 22,
  "sources": [
    "https://huggingface.co/Qwen/Qwen-Image-2.1",
    "https://alibabacloud.com/blog/qwen-image-2-1-compact-efficient-and-unified-image-creation_603586",
    "https://docs.comfy.org/tutorials/image/qwen/qwen-image-2-1"
  ]
}
```

## image_edit_qwen_2_1_relight_composite
**What the model is good at** (with sources):
- RunningHub's "Qwen-image-2.1光影溶图" ("light-and-shadow blending") LoRA [HF card].
- The trigger "pengyu" goes at the start. The example prompt is "Apply consistent lighting to the product or object, enhance specular highlights…", continuing with spatial relationship, contact shadow and blending into the background.
- The card states no training resolution and no input format.
- Bundle measurements:
  - One flat composite is the trained use.
  - With the adapter, a pasted figure's "white cut-out fringe at its feet disappears".
- The documented failure: in the 2026-11-03 two-picture run the lantern came out "as tall as the cottage" (scale unreliable).

**Showcase idea:** one picture only, as the adapter is used.
- A studio product photo of a cane-and-teak chair is cut out crudely (near-white keyed away) and pasted under a sunlit oak (`Tree.png`), with its studio light and the white shadow blobs still at its feet.
- The result should put it in the oak's backlit shade with real contact shadows.
- Because the paste fixes the chair's size and place, the model never has to choose the scale, which is the failure mode.

**Inputs:** see block. The preview of the derived composite was checked: the chair stands in the left foreground with white blobs under the legs.

**Expected result / how to judge it:**
- The chair's wood takes the scene's backlit, darker key, with a warm rim from behind.
- The white blobs are gone, replaced by soft contact shadows on the grass.
- The chair keeps its V-legs and cane back and seat.
- The oak, sky and meadow are unchanged. Output is 1024×1024.

**Risks:**
- "It re-renders rather than compositing pixel-for-pixel" (meta), so the cane weave may simplify.
- If the light direction comes out wrong, the added sentence about the sun behind the tree is the lever.

**Links to fix:** the meta's "Trained at about 1 megapixel" and "rank 32" are not on the HF card. They come from the file's own metadata (PROJECT-HISTORY.md, 2026-10-08), so say so. Links: none dead.

```json
{
  "workflow": "image_edit_qwen_2_1_relight_composite",
  "title": "Relight a pasted object to fit",
  "summary": "Paste an object onto a background - roughly, white edges and all - and it re-lights the object to match the scene: shade, highlights and a shadow on the ground, so it stops looking stuck on. Use one picture at about 1 megapixel.",
  "note": "The input was a studio photo of a chair crudely pasted under an oak, white blobs at its feet; the result puts it in the tree's backlit shade with a real shadow on the grass. Compare the chair's lighting and its feet before and after.",
  "params": {
    "textencodeqwenimage21_prompt_474": "pengyu Apply consistent lighting to the product or object, enhance specular highlights，front-back spatial relationship，add natural contact shadow, and blend it seamlessly into the background。 The chair stands on the grass in the shade of the oak, lit from behind by the sun beyond the tree.",
    "loadimage_image_475": null,
    "loadimage_image_476": null
  },
  "inputs": {
    "loadimage_image_470": {
      "need": "ONE flat composite: a studio-lit object pasted onto a scene whose light is clearly different, still showing its cut-out edges - the case the adapter was trained for (one picture, ~1 MP); placing it by hand also fixes its scale, which avoids the measured two-picture scale failure",
      "source": "derive:{from: asset:Tree.png, ops: [composite overlay asset:6504516c0115ed9b83b2d82e1d94c4ec.webp, key near-white (min channel >= 242), trim to content, fit box [0.07,0.64,0.33,0.97] bottom-centred, flatten to RGB]}  (NEW op 'composite'; prototype (scratchpad)/g1tools/proto_ops.py, preview (scratchpad)/g1tools/relight_composite.png)"
    }
  },
  "keepRuntime": false,
  "estSec": 18,
  "sources": [
    "https://huggingface.co/RunningHubAI/rh-qwen-image-2.1-lora-2104918997757157378",
    "https://huggingface.co/Qwen/Qwen-Image-2.1"
  ]
}
```

## image_qwen_image_2512_360_panorama
**What the model is good at** (with sources):
- ProGamerGov's qwen-360-diffusion LoRA. The trigger is one of "equirectangular" / "360 panorama" / "360 degree panorama with equirectangular projection", which the bundle adds.
- "For best results use the 2:1 resolution of 2048×1024", which the bundle uses.
- The dataset was "landscapes, interiors, humans, animals, and objects"; v2 continued from Qwen-Image-2512 on 35k equirectangular images. People "can come out incomplete or distorted". Licence MIT [HF card].
- Qwen-Image-2512 itself brings "more detailed rendering of landscapes, animal fur, and other natural elements" [HF card].
- On this rig: "a coherent 2:1 headland that wraps".

**Showcase idea:** standing in the middle of a blooming Provençal lavender field at golden hour (summer, a few clouds, eye level), with a different landmark in each direction: a farmhouse, a cypress row, an olive tree with a bench, and hills.
- Turning round in the viewer pays off at every angle.
- Foliage and landscape play to 2512's documented natural detail.
- There are no people (the bundle's fixed text forbids them, and the card warns about them).
- The four selectors are set off their defaults, so the example teaches them.

**Inputs:** none.

**Expected result / how to judge it:**
- A 4096×2048 PNG plus an EXR.
- In the 360° viewer: lavender rows all around; one farmhouse with blue shutters and a terracotta roof; cypresses; the olive tree and bench; hills on the horizon.
- One consistent low golden sun.
- No visible left/right seam; the horizon is level at mid-height.

**Risks:**
- The poles (straight up and down) may be soft (meta).
- Straight rows in equirectangular become curves. That is correct projection; mention it.

**Links to fix:** none dead. The meta's "Outdoor scenes work best" is a property of this graph's fixed instructions ("Full spherical outdoor view…"), not of the LoRA, which was trained on interiors too. Reword as "this card is set up for outdoor places". Optionally link the author's HTML viewer (https://progamergov.github.io/html-360-viewer/).

```json
{
  "workflow": "image_qwen_image_2512_360_panorama",
  "title": "Make a 360° look-around panorama",
  "summary": "Describe a place and pick the time of day, season, sky and camera height; you get a full 360° picture to look around in the viewer, or to use as the sky and lighting of a 3D scene in Blender, Unity or Unreal.",
  "note": "Press View in 360° and turn around: the farmhouse, the cypresses, the olive tree and the hills are all around you, lit by the same low golden sun, and the left and right edges join without a seam.",
  "params": {
    "place_2": "the middle of a blooming lavender field in Provence: long straight rows of purple lavender run away from the camera on every side, a stone farmhouse with pale blue shutters and a terracotta roof stands on one side, a line of tall dark cypress trees rises behind it, an old olive tree with a weathered wooden bench beneath it grows nearby, and the soft blue Luberon hills circle the horizon, shot on a full-frame mirrorless camera, sharp realistic photograph",
    "time_of_day_3": "6",
    "season_4": "1",
    "clouds_5": "1",
    "camera_height_6": "0"
  },
  "inputs": {},
  "keepRuntime": false,
  "estSec": 26,
  "sources": [
    "https://huggingface.co/ProGamerGov/qwen-360-diffusion",
    "https://huggingface.co/Qwen/Qwen-Image-2512"
  ]
}
```

## image_edit_qwen_2511_multiple_angles
**What the model is good at** (with sources):
- fal's LoRA was "Trained on 3000+ Gaussian Splatting renders", "96 unique positions (4×8×3)", with "Proper low-angle (-30°) camera control". It uses the template "<sks> [azimuth] [elevation] [distance]". Strength 0.8–1.0 ("Start with 0.9"). "Clear subjects with good lighting work best". Apache-2.0 [HF card].
- Qwen-Image-Edit-2511 improves "character consistency" and does "Industrial design" product work [HF card].
- On this rig it gave a clean profile, a real back and a 3/4 of a photo and of a 3D-render figure, at 6 s.

**Showcase idea:** the brief's own example, the same subject seen from behind.
- The subject is a real clay figurine photographed only from the front (an elf: tunic, belt, cuffed boots, and a sword hilt over the shoulder). Seen from the back, the scabbard and strap must appear.
- It is an object of the kind the adapter was trained on: a sculpted 3D figure on a grey seamless background.
- The camera is the card's default position (back view, eye level, medium shot), so this is also a clean calibration.
- Bonus: the front asset plus this back view make a ready first/last-frame pair for a turntable video (see the end).

**Inputs:** see block. 1200×1800 is scaled ×0.9 to fit the upload box.

**Expected result / how to judge it:**
- The figure is seen from directly behind: back of the head and pointed ears, the back of the tunic with the belt continuing round, and the boot heels.
- A sword or scabbard runs diagonally across the back, matching the hilt in the photo.
- Same terracotta clay texture and grey seamless background. About 1 MP.

**Risks:**
- The back is invented, per the meta ("a plausible back rather than the truth"). The scabbard might be omitted.
- About 27 GB VRAM, and Sage is masked (`disabledPerfFlags`), so ComfyUI restarts around it.

**Links to fix:**
- fal's card calls the `<sks>` trigger "essential". ComfyUI's CameraAngle node, like the bundle and ComfyUI's own template, sends the phrase without it. It worked 5/5 here anyway, but an A/B with a `"<sks> "` prefix (a StringConcatenate before the encoder) is worth one run.
- The text-encoder URL points at Comfy-Org/HunyuanVideo_1.5_repackaged. It resolves and it is what ComfyUI's template lists, but the canonical home is https://huggingface.co/Comfy-Org/Qwen-Image_ComfyUI/resolve/main/split_files/text_encoders/qwen_2.5_vl_7b_fp8_scaled.safetensors (also resolves).

```json
{
  "workflow": "image_edit_qwen_2511_multiple_angles",
  "title": "See your subject from another angle",
  "summary": "Upload one photo of an object or character and place the camera around it - behind, above, closer - and you get the same subject seen from there in a few seconds. The hidden side is invented, so keep the seed fixed to build a matching set.",
  "note": "Only the front of this clay figurine was photographed; the camera was moved behind it. Notice the back of the tunic and belt, the heels of the boots and the sword strapped across his back - none of it was in the photo, all of it matches the clay.",
  "params": {
    "cameraangle_221": "{\"horizontal\": 180, \"vertical\": 0, \"zoom\": 5}"
  },
  "inputs": {
    "loadimage_image_1": {
      "need": "one clear photo of a single object or character, front view, plain background, good light (the adapter was trained on 3D renders); something with a distinctive back makes the result checkable",
      "source": "derive:{from: asset:e0c02414604575.563121c5934f5.JPG, ops: [scale 0.9]}  (clay elf figurine on grey seamless, 1200x1800 -> 1080x1620 to fit the upload box; a sword hilt over his shoulder implies a scabbard on his back)"
    }
  },
  "keepRuntime": false,
  "estSec": 6,
  "sources": [
    "https://huggingface.co/fal/Qwen-Image-Edit-2511-Multiple-Angles-LoRA",
    "https://huggingface.co/Qwen/Qwen-Image-Edit-2511"
  ]
}
```

## image_ideogram4_t2i
**What the model is good at** (with sources):
- The README claims "best-in-class multilingual text rendering" and "explicit bounding-box layout and color-palette controls", and says it "sits at the frontier of design". Native 256–2048. Weights under the "Ideogram 4 Non-Commercial" licence [GitHub README].
- The prompting doc:
  - strict key order;
  - `style_description` holds exactly one of `photo`/`art_style`;
  - bbox is `[y_min, x_min, y_max, x_max]` in 0–1000;
  - palettes ≤16 global / ≤5 per element;
  - "False positive rates for safety is high for non-json prompts"
  
  [GitHub docs/prompting.md].
- Ideogram's own guide: "Each piece of text is its own element with its own position and style"; "list the most important elements first"; colour-palette control is a "distinctive feature".
- Rig measurements in the meta:
  - With no box the image was blocked 5/5; with boxes, 0/5.
  - Boxes far apart in empty corners split the frame into panels.
  - A tall narrow text box makes the text vertical.
  - On 2026-11-03 it spelled "PHARE DU CAP" and "FESTIVAL DES LUMIÈRES" exactly.

**Showcase idea:** a Swiss-style graduation-show poster.
- Four text elements at four sizes, including French accents: DESIGN / EXPOSITION DES DIPLÔMES / 12–21 JUIN 2026 / ENTRÉE LIBRE.
- One illustration: an abstract chair made of geometric shapes.
- A strict five-colour palette.
- Every element boxed, the boxes stacked and adjacent (no empty corners), each text box wider than tall.
- It shows exact multi-block typography plus palette control, Ideogram's two documented signatures. The layout rules measured here (boxes, adjacency, box shape) are all applied.

**Inputs:** none.

**Expected result / how to judge it:**
- All four strings are spelled exactly, with Ô and É.
- Each string sits in its box: the title across the top, the chair in the middle, the info lines at the bottom (date left, "ENTRÉE LIBRE" right in red).
- No colours outside off-white, red, black, blue and yellow.
- No grey "blocked" image. Output is 848×1264.

**Risks:**
- In tall formats elements "drift a little towards the middle" (meta).
- The en dash may render as a hyphen; that is acceptable.
- ⚠ The old suite's caption lacked `art_style`/`photo`, which `checkCaption` flags; this one is schema-clean.

**Links to fix:**
- The VAE `url` points at `VAST-AI/TripoSplat/…/flux2-vae.safetensors`. It resolves, but it is a third-party repo. Use the template's own link: https://huggingface.co/Comfy-Org/flux2-dev/resolve/main/split_files/vae/flux2-vae.safetensors (resolves).
- The guide URL still works, but Ideogram now serves it at https://docs.ideogram.ai/prompting/json-prompting.
- The meta has no licence note. Add "weights: Ideogram 4 Non-Commercial".

```json
{
  "workflow": "image_ideogram4_t2i",
  "title": "Design a poster with exact words",
  "summary": "Lay out a poster or graphic in the visual composer: draw a box for each piece of text and each picture, choose your colours, and the words come out spelled exactly. Give every element a box - it also keeps away the false 'blocked' picture.",
  "note": "Five boxes, five colours: every word, accents included (DIPLÔMES, ENTRÉE), is spelled exactly and sits in its box, and only the chosen colours appear. Open the prompt in Compose visually to see the layout that made it.",
  "params": {
    "prompt_json_98_24": "{\n  \"high_level_description\": \"A bold Swiss-style typographic poster for a design school's graduation exhibition: the word DESIGN in enormous red capitals across the top, an abstract chair built from flat geometric shapes in the middle, and crisp black and red information lines in a strict grid along the bottom, on warm off-white paper.\",\n  \"style_description\": {\n    \"aesthetics\": \"International Typographic Style poster: strict grid, generous white space, flat solid colours, razor-sharp edges, subtle offset-print paper grain.\",\n    \"lighting\": \"Flat, even graphic lighting with no shadows.\",\n    \"medium\": \"graphic_design\",\n    \"art_style\": \"Swiss modernist graphic design with heavy grotesque sans-serif typography and flat vector shapes\",\n    \"color_palette\": [\n      \"#F2EEE3\",\n      \"#E63323\",\n      \"#1A1A1A\",\n      \"#2F5DA8\",\n      \"#F2C230\"\n    ]\n  },\n  \"compositional_deconstruction\": {\n    \"background\": \"Plain warm off-white paper with a faint print grain, no pattern.\",\n    \"elements\": [\n      {\n        \"type\": \"text\",\n        \"bbox\": [\n          40,\n          60,\n          250,\n          940\n        ],\n        \"text\": \"DESIGN\",\n        \"desc\": \"Enormous heavy red grotesque sans-serif capitals spanning the full width at the top\",\n        \"color_palette\": [\n          \"#E63323\"\n        ]\n      },\n      {\n        \"type\": \"obj\",\n        \"bbox\": [\n          270,\n          250,\n          690,\n          750\n        ],\n        \"desc\": \"An abstract chair made of flat geometric shapes: a blue rectangle seat, a yellow circle backrest and four thin black straight legs\",\n        \"color_palette\": [\n          \"#2F5DA8\",\n          \"#F2C230\",\n          \"#1A1A1A\"\n        ]\n      },\n      {\n        \"type\": \"text\",\n        \"bbox\": [\n          710,\n          60,\n          800,\n          940\n        ],\n        \"text\": \"EXPOSITION DES DIPLÔMES\",\n        \"desc\": \"Bold black condensed sans-serif capitals on one line\",\n        \"color_palette\": [\n          \"#1A1A1A\"\n        ]\n      },\n      {\n        \"type\": \"text\",\n        \"bbox\": [\n          820,\n          60,\n          900,\n          520\n        ],\n        \"text\": \"12–21 JUIN 2026\",\n        \"desc\": \"Medium-weight black sans-serif, left aligned\",\n        \"color_palette\": [\n          \"#1A1A1A\"\n        ]\n      },\n      {\n        \"type\": \"text\",\n        \"bbox\": [\n          820,\n          560,\n          900,\n          940\n        ],\n        \"text\": \"ENTRÉE LIBRE\",\n        \"desc\": \"Medium-weight red sans-serif capitals, right aligned\",\n        \"color_palette\": [\n          \"#E63323\"\n        ]\n      }\n    ]\n  }\n}",
    "aspect_ratio_37": "2:3 (Portrait Photo)",
    "quality_98_156": "Default"
  },
  "inputs": {},
  "keepRuntime": false,
  "estSec": 20,
  "sources": [
    "https://github.com/ideogram-oss/ideogram4/blob/main/docs/prompting.md",
    "https://github.com/ideogram-oss/ideogram4",
    "https://docs.ideogram.ai/using-ideogram/getting-started/prompting-guide/4.-json-prompting-ideogram-4.0"
  ]
}
```

## image_moss_image_t2i
**What the model is good at** (with sources):
- The USERGUIDE highlights text rendering, "natively" supported layout control, arbitrary aspect ratios, and "English … Chinese and other languages are also supported". For precise breaks it says to insert `\n` or real line breaks. Best results come at ≥50 steps and CFG 3–6 [GitHub USERGUIDE].
- The Base card's SFT comparison: "SFT produces clearer text grouping and a more organized whiteboard layout". It shows a Chinese handwritten-note example. Apache-2.0 [HF Base card].
- The official layout reference's example is a product campaign: an ivory ceramic cup plus two Chinese text items [layout.md].
- On this rig: "title exact, character and lighthouse in their boxes".

**Showcase idea:** the official example's genre, a bilingual tea campaign.
- A Chinese brush-style title "一盏清茶" ("a cup of clear tea").
- A two-line English tagline whose break is typed in the box ("SLOW TEA" / "brewed by hand since 1926").
- A celadon cup in its own box on the right, on a 3:2 canvas.
- It shows what separates MOSS from Ideogram: Chinese text, exact line breaks and grouped copy, the SFT's documented "clearer text grouping".

**Inputs:** none. The layout is the JSON string in the block (composer format, 0–1000 `[y_min, x_min, y_max, x_max]`).

**Expected result / how to judge it:**
- The four characters 一盏清茶 are legible and correct, upper left.
- The tagline is on two lines, breaking after "SLOW TEA", below the title.
- The cup is in the right half with steam and leaves.
- Calm grey negative space on the left. Output is 1248×832.

**Risks:**
- A brush-style Chinese font may be stylised into near-illegibility; "elegant" in the description is the hedge.
- Keep "Improve my prompt with AI" off: it fails on ComfyUI 0.43.2, and the default is off.

**Links to fix:** none dead. The meta's "Add the background first and the foreground last" is not in MOSS's layout reference, which only says items may share or overlap boxes. Mark it as house advice.

```json
{
  "workflow": "image_moss_image_t2i",
  "title": "Place text and objects with boxes",
  "summary": "Write a long description and draw boxes for where each object, character and line of text goes - in English or Chinese - and it follows the layout. Best for ads, covers and pages where the words must sit neatly in groups.",
  "note": "Three boxes on a 3:2 canvas: the Chinese title, a two-line English tagline that breaks exactly where the line break was typed, and the cup on the right. Read both languages, then check each lands in its box.",
  "params": {
    "prompt_117": "Minimalist product campaign photograph for a tea brand. On the right half, a hand-thrown ivory ceramic tea cup with a faint celadon glaze stands on a pale oak board, a wisp of steam rising from it and a few dry tea leaves scattered beside it, soft window light from the left casting a long gentle shadow. The left half is calm warm-grey negative space holding the copy: at the top a large elegant Chinese title \"一盏清茶\" in ink-black brush-style characters, and beneath it two lines of small dark-grey English text in a thin modern serif, \"SLOW TEA\" on the first line and \"brewed by hand since 1926\" on the second. Quiet, premium, wabi-sabi mood, muted earthy colours, fine detail, 50 mm lens.",
    "layout_24": "[\n  {\n    \"type\": \"text\",\n    \"bbox\": [\n      200,\n      70,\n      420,\n      470\n    ],\n    \"text\": \"一盏清茶\",\n    \"desc\": \"a large elegant Chinese title in ink-black brush-style characters\"\n  },\n  {\n    \"type\": \"text\",\n    \"bbox\": [\n      470,\n      70,\n      600,\n      470\n    ],\n    \"text\": \"SLOW TEA\\nbrewed by hand since 1926\",\n    \"desc\": \"two lines of small dark-grey English text in a thin modern serif\"\n  },\n  {\n    \"type\": \"obj\",\n    \"bbox\": [\n      180,\n      540,\n      880,\n      940\n    ],\n    \"desc\": \"a hand-thrown ivory ceramic tea cup with a faint celadon glaze on a pale oak board, a wisp of steam rising, a few dry tea leaves beside it\"\n  }\n]",
    "character_boxes_27": "",
    "aspect_ratio_19": "3:2 (Photo)"
  },
  "inputs": {},
  "keepRuntime": false,
  "estSec": 23,
  "sources": [
    "https://github.com/OpenMOSS/MOSS-Image/blob/main/USERGUIDE.md",
    "https://github.com/OpenMOSS/MOSS-Image/blob/main/skills/moss-image-prompt-enhancer/references/layout.md",
    "https://huggingface.co/OpenMOSS-Team/MOSS-Image-Base",
    "https://huggingface.co/OpenMOSS-Team/MOSS-Image-SFT"
  ]
}
```

## image_moss_image_base_t2i
**What the model is good at** (with sources):
- The same model, without post-training. The Base card's only stated difference is that SFT gives "clearer text grouping and a more organized whiteboard layout" [HF Base card].
- Secondary coverage recommends Base for LoRA training or fine-tuning and says it "needs more tuning to deliver stable results" [pasqualepillitteri.it].
- The layout format has three labels: `object`, `character` and `text` [layout.md].
- On this rig: "the same layout, followed as well, a little flatter. SFT ≥ base".

**Showcase idea:** since SFT is the text card, give Base the other half of the layout feature, **character boxes**.
- A warm street photo of a bakery:
  - an elderly baker in a character box on the left handing a baguette;
  - a girl in a yellow raincoat in a character box on the right reaching for it;
  - two short text boxes, the "BOULANGERIE" fascia and a two-line chalkboard.
- It shows two people placed exactly and interacting, which SFT's example does not demonstrate.
- The text is kept short, because Base groups text less neatly.

**Inputs:** none. `character_boxes` = "2, 3", the 1-based numbers of the two character boxes.

**Expected result / how to judge it:**
- The baker is on the left behind a counter and the girl on the right on the pavement, each inside their box.
- The baguette passes between them.
- "BOULANGERIE" is on the green fascia.
- The chalkboard reads "PAIN CHAUD" with "7H – 19H" on a second line.
- Output is 1360×768.

**Risks:**
- Hands on the baguette.
- The chalkboard text is small (box about 228 px wide); a garbled second line is the likeliest flaw.
- SLG is on by default here (off on SFT), which is fine for photoreal.

**Links to fix:** the description's "it follows your words more literally" is not supported by any source I found. The card frames Base as un-post-trained and meant for LoRA training. Reword as "untuned, for LoRA training; SFT groups text more neatly".

```json
{
  "workflow": "image_moss_image_base_t2i",
  "title": "Place characters with boxes (basic version)",
  "summary": "The same box-layout picture maker in its raw, untuned form: draw where each character, object and caption goes and describe the whole picture. For neater text pick the other box-layout card; this one is the version style add-ons are made for.",
  "note": "Two boxes were marked as characters - the baker on the left, the girl on the right - and the shop sign and chalkboard are text boxes. Check that each person stands in their own box and that both signs read exactly as typed.",
  "params": {
    "prompt_117": "Warm documentary street photograph of a small French bakery on a rainy morning. On the left, an elderly baker with a white moustache, a white apron and a flour-dusted cap leans out over the wooden counter of the open shop window, holding out a long golden baguette. On the right, a small girl in a bright yellow raincoat and red rubber boots stands on the wet pavement and reaches up for it with both hands. Above them the dark green wooden shopfront carries the word \"BOULANGERIE\" in gold serif capitals, and at the far right a small black A-frame chalkboard on the pavement reads \"PAIN CHAUD\" with \"7H – 19H\" on the line below, in white chalk handwriting. Shelves of bread glow behind the counter, soft overcast light, wet cobbles reflecting the warm shop light, 35 mm lens, natural colours, fine detail.",
    "layout_24": "[\n  {\n    \"type\": \"text\",\n    \"bbox\": [\n      50,\n      260,\n      160,\n      740\n    ],\n    \"text\": \"BOULANGERIE\",\n    \"desc\": \"gold serif capitals painted on the dark green wooden shopfront fascia\"\n  },\n  {\n    \"type\": \"obj\",\n    \"bbox\": [\n      230,\n      40,\n      990,\n      470\n    ],\n    \"desc\": \"an elderly baker with a white moustache, white apron and flour-dusted cap leaning out over the wooden counter, holding out a long golden baguette\"\n  },\n  {\n    \"type\": \"obj\",\n    \"bbox\": [\n      470,\n      560,\n      990,\n      800\n    ],\n    \"desc\": \"a small girl in a bright yellow raincoat and red rubber boots reaching up for the baguette with both hands\"\n  },\n  {\n    \"type\": \"text\",\n    \"bbox\": [\n      540,\n      820,\n      860,\n      990\n    ],\n    \"text\": \"PAIN CHAUD\\n7H – 19H\",\n    \"desc\": \"white chalk handwriting on a small black A-frame chalkboard standing on the pavement\"\n  }\n]",
    "character_boxes_27": "2, 3",
    "aspect_ratio_19": "16:9 (Widescreen)"
  },
  "inputs": {},
  "keepRuntime": false,
  "estSec": 23,
  "sources": [
    "https://huggingface.co/OpenMOSS-Team/MOSS-Image-Base",
    "https://github.com/OpenMOSS/MOSS-Image/blob/main/USERGUIDE.md",
    "https://github.com/OpenMOSS/MOSS-Image/blob/main/skills/moss-image-prompt-enhancer/references/layout.md"
  ]
}
```

## image_moss_image_color_depth_control
**What the model is good at** (with sources):
- darask0's adapter makes MOSS-Image "follow a color region map … and a depth map". "Control inputs act as conditions, not image content". The listed use is "Posing scenes with 3D mannequins".
- Its warnings: "With only a scene prompt, a mannequin-shaped map is drawn as a mannequin" (so describe the subject), and "The style prior is photographic". Apache-2.0 [HF card].
- The bundle takes depth from MoGe 3. "Nothing else of the photo is kept — identity, clothes, material, light and style all come from the text" (meta).
- On this rig: "the dancer's leap as a bronze statue — excellent".

**Showcase idea:** keep ONLY the pose.
- A young man dancing in a grey studio (`controlNet_demo_image.jpg`) becomes a white-bearded gentleman in a tweed suit dancing on a wet Paris street at night.
- Everything that is not the pose changes: age, clothes, setting, light. That makes the "only the shape is kept" rule obvious.
- The subject is described fully, and with a slim figure, per the card's mannequin warning. The silhouette is compatible (no hat added to a bare head, so nothing has to fight the depth).

**Inputs:** see block.

**Expected result / how to judge it:**
- Same pose and framing as the photo: right fist raised by his head, left arm down and out, knees bent on his toes, head tipped down.
- The man is clearly old and bearded, in a three-piece suit.
- A night street with lit shopfronts and puddles.
- About 1 MP at 2:3.

**Risks:**
- The studio floor and wall depth must become a street. End-at-0.6 (the default) frees the last steps for that.
- The face is generated ("Fingers and face details are generated by the model").

**Links to fix:** the card recommends control end 1.0 "for maps from real images" (0.5 for mannequin or synthetic maps). The bundle defaults to 0.6 (ComfyUI's template value, chosen for a mask map). It is worth an A/B, but it is not changed here so the run stays a default calibration. Links: none dead.

```json
{
  "workflow": "image_moss_image_color_depth_control",
  "title": "Reinvent a photo, keep its pose",
  "summary": "Upload a photo of someone (or something) and describe a completely new picture; only the pose and framing come from the photo - the person, clothes, place and style all come from your words.",
  "note": "A young dancer in a grey studio became an old gentleman dancing in a Paris street at night - the raised fist, the arm swinging down and the bent knees are exactly the photo's. Everything else came from the prompt.",
  "params": {
    "prompt_5": "Cinematic night street photograph of a cheerful old man in his seventies with short white hair and a neat white beard, wearing a charcoal tweed three-piece suit and polished brown brogues, dancing alone on a wet cobbled street: his right fist raised beside his head, his left arm swinging down and out, knees bent, up on the balls of his feet, head tipped down with a grin. Behind him a row of closed Parisian shopfronts with warm lit windows and a glowing streetlamp, puddles reflecting the lights, light drizzle, shallow depth of field, 35 mm film grain, the whole figure in frame."
  },
  "inputs": {
    "photo_55": {
      "need": "a full-body photo of one person in a clear, unusual pose against a plain background, so the pose is the only thing carried over",
      "source": "asset:controlNet_demo_image.jpg (a man dancing in a grey studio, 640x960)"
    }
  },
  "keepRuntime": false,
  "estSec": 40,
  "sources": [
    "https://huggingface.co/darask0/MOSS-Image-color-depth-control",
    "https://github.com/OpenMOSS/MOSS-Image/blob/main/USERGUIDE.md"
  ]
}
```

## image_edit_bernini_r_image_editing
**What the model is good at** (with sources):
- ByteDance's Bernini-R is "Renderer-only model fine-tuned from the Wan diffusion renderer". Its tasks are t2i, i2i, t2v, v2v, rv2v and r2v. The README warns that "Bernini-R 1.3B is lagging behind on more complex tasks such as human generation" [GitHub README]; that applies to the small variant, while this bundle runs the 14B Wan 2.2 high/low-noise pair. A scene edit with no people is the safer showcase either way.
- Its official i2i test case is an **object removal** with a long instruction: "Delete the bicycle parked in front of the window. Fill in the area behind it … matching the existing perspective, lighting direction, and shadow softness … all other objects in the scene remain completely unchanged." [assets/testcases/i2i/i2i.json].
- ComfyUI's template note: "say both **what changes** and **what must stay**" [bundle template].
- On this rig: "the scene in winter, slightly recomposed — fine".

**Showcase idea:** removal, the case Bernini's own authors chose and the one thing no other card in this group shows.
- From `Screenshot 2025-03-06 105700.png` (a pink building wearing a giant bouquet of puffy daisies), delete the bouquet and rebuild roof and sky.
- The instruction copies the official three-part form: delete X, fill with Y matching perspective and light, Z unchanged.
- ★ The asset folder holds the same street without flowers (`Screenshot 2025-03-06 105726.png`), so the result can be checked against a near ground truth.

**Inputs:** see block.

**Expected result / how to judge it:**
- No daisy remains.
- A plausible flat roof and parapet over the windows, with blue sky above.
- The windows, door, the yellow car, the poles and wires, the mountains and the right-hand cloud are in place.
- Compare with 105726. The real building has a cantilevered top floor; a plausible flat roof counts as a pass.

**Risks:**
- This is a large fill at 6 turbo steps. Petal remnants are the likeliest flaw; turn Fast mode off for 40 steps if they appear.
- The resize to a 1280 long edge with non-16 multiples can slightly crop or recompose (as measured).
- The stray "3" text tile still appears (known).

**Links to fix:**
- The meta has no `promptGuides`. Add https://github.com/bytedance/Bernini and the i2i case above.
- Check `StringConcatenate 76:59`: its delimiter is "", so the task line and the instruction are glued with no space ("…specialized in image editing.Delete the…"). A "\n" delimiter looks intended; verify against ComfyUI's Bernini template.
- The default "make it night" is far terser than the official instruction style.

```json
{
  "workflow": "image_edit_bernini_r_image_editing",
  "title": "Change or remove things by asking",
  "summary": "Upload a picture and type an instruction - remove this, add that, make it winter - and it repaints the picture following it while keeping the rest. Say what must stay the same as well as what to change.",
  "note": "One instruction removed a giant bouquet of daisies from a roof and rebuilt the sky and roofline behind it; the building, the taxi and the street did not move. Write it like this: what to delete, what to fill the gap with, and what must not change.",
  "params": {
    "edit_instruction_76_120": "Delete the giant cluster of puffy white daisies sitting on top of the pink building. Fill in the area with the continuation of the building's flat pink roof and parapet and the clear blue sky behind it, matching the existing perspective, the hard sunlight and the shadow softness so the removal is seamless. The pink building, its windows and door, the yellow car, the street, the telegraph poles and wires, the mountains and the clouds remain completely unchanged.",
    "task_type_76_54": "Image Editing"
  },
  "inputs": {
    "source_image_114": {
      "need": "a photo with one large, obviously removable object and a simple background behind it (sky, wall), so the removal is unmistakable",
      "source": "asset:Screenshot 2025-03-06 105700.png (pink building with a giant daisy bouquet on its roof, 598x755)"
    }
  },
  "keepRuntime": false,
  "estSec": 24,
  "sources": [
    "https://github.com/bytedance/Bernini",
    "https://raw.githubusercontent.com/bytedance/Bernini/main/assets/testcases/i2i/i2i.json",
    "https://huggingface.co/Comfy-Org/Bernini-R"
  ]
}
```

## image_edit_bernini_r_image_editing_with_reference
**What the model is good at** (with sources):
- Bernini's own reference-editing case (rv2v) is an **object swap**: "Replace the person's outer shirt with the shirt from the reference image while keeping … camera framing, lighting, background … exactly as they are", followed by a detailed description of the new garment [assets/testcases/rv2v/rv2v_case1.json].
- ComfyUI's template: references are "a separate in-context stream" for subjects, items and scenes. There is no style-transfer task.
- The documented failure on this rig: asked to restyle from a poster, it "pasted the poster's lighthouse and title in as a collage". A style request is not what the reference stream does.

**Showcase idea:** use it the way its authors do. Replace one anchored object with the referenced one.
- In `Screenshot 2025-03-06 105726.png`, swap the parked yellow car for the red sports coupé from `sports_car.png`.
- Same spot, size and direction; the building and street are unchanged.
- The prompt follows the rv2v form: replace … keep exact list … then describe the new object.
- The existing car anchors position and scale, which removes the free-placement freedom that produced the collage.

**Inputs:** see block.

**Expected result / how to judge it:**
- The yellow car is gone.
- A low red two-door coupé with slim LED headlights and black wheels (recognisably the reference design) sits at the kerb in the same spot and at about the same size, with a shadow under it.
- The building, windows, poles and wires, road markings, mountains and sky are unchanged.

**Risks:**
- The reference is a three-quarter front view at dusk. It must be re-posed side-on in daylight, so lighting or pose mismatch is the likeliest flaw.
- The 6-step turbo run is quick (10 s). Turn Fast mode off if the car looks pasted.

**Links to fix:**
- No `promptGuides`. Add the Bernini repo and the rv2v case above.
- The default instruction "Restyle the image to match the reference image." is exactly the measured failure. Change it to a "Replace the … with the … from the reference image, keeping …" example.
- The meta's "'Subject to Image' brings the reference subject into the scene" contradicts ComfyUI's own task table. There, Subject to Image (r2i) composes a NEW image from references only, without a source.
- The same StringConcatenate delimiter note as the plain card.

```json
{
  "workflow": "image_edit_bernini_r_image_editing_with_reference",
  "title": "Replace an object using a reference",
  "summary": "Upload a picture and a second picture of an object (a car, a shirt, a lamp), then say what it replaces; the new object takes the old one's place and the rest stays untouched. It swaps things - it does not copy a style.",
  "note": "The yellow taxi was swapped for the red sports car from the reference picture, parked in the same spot under the same sun; the pink building and the street are unchanged. Ask it to replace something - asked to copy a style, this card makes collages.",
  "params": {
    "edit_instruction_76_120": "Replace the small yellow car parked in front of the pink building with the red sports car from the reference image, parked in exactly the same spot, at the same size and facing the same direction along the kerb, with a soft shadow on the asphalt beneath it, while keeping the pink building, its windows and doors, the telegraph poles and wires, the road markings, the mountains, the clouds and the blue sky exactly as they are. The car is now a low glossy red two-door sports coupé with slim LED headlights, black alloy wheels and a dark tinted windscreen, lit by the same hard sunlight as the building, and all other scene elements remain unchanged.",
    "task_type_76_54": "Image Editing"
  },
  "inputs": {
    "source_image_114": {
      "need": "a scene containing one object that can be swapped, at a clear size and position",
      "source": "asset:Screenshot 2025-03-06 105726.png (pink building with a yellow car in front, 721x831)"
    },
    "reference_image_104": {
      "need": "a clear picture of the replacement object",
      "source": "asset:sports_car.png (red sports coupé, 512x512)"
    }
  },
  "keepRuntime": false,
  "estSec": 10,
  "sources": [
    "https://raw.githubusercontent.com/bytedance/Bernini/main/assets/testcases/rv2v/rv2v_case1.json",
    "https://github.com/bytedance/Bernini"
  ]
}
```

---

## Upstream inputs this group needs

**NEW producer runs: none.** Every input is an asset in `J:\_assets`, used as-is or through a derive step:

| run | input | source |
|---|---|---|
| canny | `loadimage_image_900` | `asset:naive_drawing.png` |
| depth | `loadimage_image_900` | `asset:PXL_20240628_084847386.jpg` → scale 0.35 |
| Qwen edit | `loadimage_image_470` | `asset:woman_mechanic.png` → 3 × circle |
| Qwen edit | `loadimage_image_475`, `_476` | `asset:2f42ec649db902ccf63918f16293bd963dc4d65b_original.jpg`, `asset:nv.1197-trat.-fundo-CAzev.jpg` |
| relight | `loadimage_image_470` | `asset:Tree.png` + composite of `asset:6504516c0115ed9b83b2d82e1d94c4ec.webp` |
| 2511 angles | `loadimage_image_1` | `asset:e0c02414604575.563121c5934f5.JPG` → scale 0.9 |
| MOSS depth | `photo_55` | `asset:controlNet_demo_image.jpg` |
| Bernini | `source_image_114` | `asset:Screenshot 2025-03-06 105700.png` |
| Bernini ref | `source_image_114`, `reference_image_104` | `asset:Screenshot 2025-03-06 105726.png`, `asset:sports_car.png` |

**NEW derive capabilities the integrator must add** (derive_input.py + suitePlan.js `DERIVE_OPS` and `parseMediaSpec`):

1. **Derive from an asset.** Allow `{"from": "asset:<file>", "derive": [...]}`. Today `from` must be a library bundle, and `--check` rejects anything else. The alternative is to pre-make three files in `J:\_assets`: the scaled maquette, the scaled elf, and the circled mechanic (plus the composite).
2. **`circle {box:[x0,y0,x1,y1], color:"#RRGGBB", width_px:8}`** draws an ellipse OUTLINE (no fill) inside the box (fractions) on an RGB copy. It can be chained. This is Qwen-Image-2.1's documented "local edits via circles".
3. **`composite {overlay:"asset:<file>"|"output:<id>", box:[x0,y0,x1,y1], key:"white", threshold:242, feather:1}`**, in this order:
   - key out near-white overlay pixels (min channel ≥ threshold → transparent, with a slight blur);
   - trim the overlay to its content;
   - scale it to fit inside the box, keeping aspect ratio;
   - place it bottom-centred;
   - flatten to RGB.

   Deliberately crude: the leftover white fringe is what the relight adapter is meant to remove.

Prototypes of 2 and 3 (about 40 lines of PIL): `(scratchpad)/g1tools\proto_ops.py`. Previews: `(scratchpad)/g1tools\qwen_edit_circles.png` and `(scratchpad)/g1tools\relight_composite.png`.

**Outputs this group produces that other groups could reuse:**
- `image_edit_qwen_2511_multiple_angles` → the elf **from behind**. Paired with `asset:e0c02414604575.563121c5934f5.JPG` (front, scaled ×0.9) it is a natural **first frame → last frame turntable** for LTX 2.5 FLF / FastH3 i2v / Pika FL2VA ("the camera orbits the clay figurine from front to back"). Both are on the same grey seamless background, at 2:3.
- `image_ideogram4_t2i` → a flat five-colour Swiss poster. It is a clean style reference for `image_krea2_turbo_style_reference`, and a text-reading test for `describe_gemma4_image_description` (accents Ô and É).
- `image_moss_image_t2i` → a bilingual image. It is a good test for the Gemma captioner ("quote the Chinese and English text exactly").
- `image_qwen_image_2_1_t2i` → a 2K flat lay with six text items. It is a hard OCR test for the Gemma captioner and a 2K source for `utility_pid_image_upscale` / SeedVR2.
- `image_qwen_image_2512_360_panorama` → an equirectangular panorama. No current card consumes one.
