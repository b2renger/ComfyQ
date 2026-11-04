# g2_flux_krea_minimax_img — showcase proposals (15 workflows)

Research group: FLUX.2 Klein (×6), FLUX.3 Klein (×4), Krea 2 (×4), MiniMax H3 still (×1).
Written 2026-11-04 from the bundles on `main`, the 2026-11-03 assessment, and primary sources (BFL docs and repos,
model cards). Nothing in `J:\ComfyQ` was edited and no job was run.

## Read this first: three facts that shape every proposal

1. **FLUX.3 Klein is trained on captions written by its own prompt upsampler, and that upsampler fails on this
   ComfyUI build.** BFL: *"Always run a prompt upsampler. The model is trained on the captions it writes; a prompt
   sent as typed gives noticeably weaker results"* (docs.bfl.ai/flux_3/flux3_image_klein). On 0.43.2 the Qwen 3.5
   upsampler dies (`Unsupported Flash Attention tensor strides`, CLAUDE.md 2026-11-03), so `improve_prompt` stays
   **off** on all four FLUX.3 cards. To make up for it, every FLUX.3 prompt below is **hand-written in the upsampler's
   own output format**, taken from its published system prompts (`system_prompts.json` in
   `black-forest-labs/flux-3-image-klein-pup`, keys `t2i`, `t2i_bbox`, `i2i`, `i2i_bbox`) and from the exact
   prompts the model saw in BFL's examples (`examples/base/balloons.json`, `cactus.json`, `3_bandana.json` in
   `black-forest-labs/flux-3-image-klein`). The rules: medium first ("Overhead flat-lay photograph…", "Studio
   photograph…"), frame-relative positions, an observable profile for each person, quoted text, every box id cited
   once as `<id>`, and box `desc`s that start with what the thing is and leave out where it is.
2. **How ComfyUI's FLUX.3 layout differs from BFL's.** `Flux3LayoutPrompt` (comfy_extras/nodes_flux.py) renames
   every box `obj_1…obj_N` **in list order** and appends `[{"id","bbox","desc"}]` to the prompt. For a text box it
   appends `"text"` in quotes to the `desc`. Boxes are `[y_min, x_min, y_max, x_max]` on a 0–1000 grid. For edits,
   BFL's training format has `from / src_bbox / tgt_bbox` rows (keep, move, add, remove), but the ComfyUI node can only
   write plain `bbox` rows. **On an edit card a box can say "put this here", but it cannot mark something as "keep
   unchanged".** The keep clause has to go in the words. (The suite's coat edit of 2026-11-03 shows a bbox-only edit
   works.)
3. **The suite cannot derive from an asset yet.** `derive` only applies to `from:` outputs
   (`server/benchmark/suitePlan.js` → `{asset}` short-circuits). Five proposals here want a real photo with a
   transparent hole or a downscale. I ask for one small infra addition (`{"asset": …, "derive": […]}`, same
   `derive_input.py`). Each of those runs also has a fallback that needs no new code. Box conventions differ:
   **derive boxes are `[x0, y0, x1, y1]` fractions**, while **layout boxes are `[y, x, y, x]` on 0–1000**. Both
   are used below, so keep them apart.

Order inside the group: Stage 1 = 6 text-to-image runs (FLUX.2 t2i, FLUX.3 base t2i, FLUX.3 distilled t2i, Krea t2i,
Krea style-ref, MiniMax). Stage 2 = 8 edits. Stage 4 = FLUX.3 distilled edit (it needs the v2v source clip).
Warm cost of all 15 at defaults: **≈ 385 s**. With the cold loads it is about 10 minutes. No run changes a cost
setting, so `keepRuntime` is false everywhere. Aspect changes keep the same megapixels.

---

## image_flux2_klein_9b_t2i

**What the model is good at** (with sources): FLUX.2 [klein] 9B **Base** is BFL's undistilled 9B model,
*"undistilled, preserving complete training signal… higher output diversity than the distilled models"*
(HF card). The card runs it at 20 steps and CFG 5. Klein has **no prompt upsampling**, so prompts must be detailed
(docs.bfl.ai/flux_2). BFL's FLUX.2 guide covers what makes a photo look real: subject first; named lenses and film
stocks (*"shot on Kodak Portra 400"*); colours as hex codes **tied to one object** (*"Hex codes work best when
clearly associated with specific objects"*); no negative phrasing. Assessment: **"★ best fast photoreal"**. Its
portrait had freckles, blue eyes and natural skin in 12 s warm.

**Showcase idea**: a close-up portrait of an **older, weathered face**. Skin is where photoreal models usually go
waxy, so pores, wrinkles, freckles and fine facial hair are the test. One garment gets an exact hex colour, which
shows a FLUX.2 feature most students don't know. The portrait is frontal, the mouth is closed, the expression is
neutral and the background plain, so it can also stand in as the face input for the face cards in other groups.
No documented failure to avoid; it simply stops reusing the lighthouse keeper.

**Inputs**: none.

**Expected result / how to judge it**: visible pores, freckles across the nose, deep laugh lines and stray silver
hairs at 1:1. The sweater, sampled with an eyedropper, is close to `#1F5C4A` (a deep bottle green). Expect it to be
near the code, not exact. Small gold hoops. A plain warm-grey wall. Head and shoulders, eyes to the lens, mouth
closed.

**Risks**: at CFG 5 the base model can push saturation, so check the green is not neon. "Kodak Portra 400" adds
grain, which is wanted. The hex code steers the colour strongly but does not guarantee it.

**Links to fix**: the VAE `flux2-vae.safetensors` → `url` points at `VAST-AI/TripoSplat/…/vae/flux2-vae.safetensors`,
an unrelated 3D repo. It downloads the right bytes (336,213,556), but the canonical source is
`https://huggingface.co/Comfy-Org/flux2-dev/resolve/main/split_files/vae/flux2-vae.safetensors` (same size,
verified). **This applies to all 10 FLUX cards in this group.** The guide link (`prompting_guide_flux2`) is alive
but covers FLUX.2 [pro]/[max]. Klein's only specific advice is "no prompt upsampling — write it out"
(https://docs.bfl.ai/flux_2). Worth adding https://docs.bfl.ai/guides/usecases_t2i_hex_color_prompting.

```json
{ "workflow": "image_flux2_klein_9b_t2i",
  "title": "Make a true-to-life photo",
  "summary": "Describe a photo in full sentences and get a realistic picture in about 12 seconds. It is especially good at faces, skin and exact colours — you can even give a colour as a code like #1F5C4A. Pick it when the result must look like a real photograph.",
  "note": "A photo made from text alone. Look closely at the skin — pores, freckles, fine hairs — and at the sweater, whose colour was given as the code #1F5C4A.",
  "params": {
    "primitivestringmultiline_value_76": "Close-up portrait photograph of a woman in her sixties with a weathered, sun-tanned face, deep laugh lines, freckles across her nose and cheeks, short tousled silver hair and pale green eyes. She wears a chunky hand-knitted turtleneck sweater in color #1F5C4A and small gold hoop earrings, and looks straight into the lens with a calm, closed-mouth expression, head and shoulders in frame. Soft north-facing window light from frame-left, a plain warm-grey plaster wall behind her, shot on an 85mm lens at f/2 on Kodak Portra 400 film, natural skin texture with visible pores and fine facial hair, sharp focus on the eyes.",
    "cliptextencode_text_75_67": "",
    "flux2scheduler_steps_75_62": 20
  },
  "inputs": {},
  "keepRuntime": false, "estSec": 12,
  "sources": ["https://huggingface.co/black-forest-labs/FLUX.2-klein-base-9B", "https://docs.bfl.ai/flux_2", "https://docs.bfl.ai/guides/prompting_guide_flux2", "https://docs.bfl.ai/guides/usecases_t2i_hex_color_prompting"] }
```

---

## image_edit_flux2_klein_9b_image_edit

**What the model is good at** (with sources): the same Klein 9B base, given the source picture as a
`ReferenceLatent`. Output size follows the source, scaled to 1 MP. BFL documents "Drawing to Image (Rendering)" as
a FLUX.2 editing use case. Their own prompts: *"Turn the drawing into a realistic photograph"*, *"Transform the
architectural illustration from image 1 into a fully realistic house, natural lighting"*. They advise naming the
real materials and lighting. Assessment: **"★ structure-preserving restyle"**. Its day→storm edit kept the tower,
cottage and path exactly in place.

**Showcase idea**: **a photo of an architecture student's scale model turned into a photo of the real place.** The
asset `PXL_20240628_084847386.jpg` is a maquette: a felt lawn, about 25 painted figurines, a white stage with a
speaker figurine, wooden-block stools, a timber pavilion and a pine tree. Every figurine has a position and a
clothing colour you can check, so "keeps its layout" can be tested object by object. It is also the most
design-school use there is for this card. It plays to the card's documented strength (structure kept, materials
changed).

**Inputs**: `loadimage_image_76` — a photo whose layout must survive the edit, here a scale model. Source: the asset
`PXL_20240628_084847386.jpg` (4080×3072), **scaled 0.35 → 1428×1075** so it fits the 1920×1080 upload box (NEW:
asset derive). Fallback with no new code: the raw asset (the graph scales to 1 MP itself, but a student could not
upload a file that size). Alternative showcase on the same card, also BFL's own example: `asset:naive_drawing.png`
with "Turn the drawing into a realistic photograph…".

**Expected result / how to judge it**: overlay the result on the source. Every person is where a figurine stood,
in the same colours: the woman in pink, the woman in red with purple trousers, the man in a beige sweater, the woman
in a yellow dress at right, the seated man in navy on a crate. The speaker stands on the stage. The blocks are real
wooden stools. The felt is real grass. The pavilion is real timber. The camera angle and shallow depth of field are
unchanged.

**Risks**: about 25 small people at 1 MP, so expect soft faces and the odd hand. Some figures may keep a slightly
"plastic" look. The out-of-focus white studio wall may come back as a pale wall rather than buildings; the prompt
names what it should become. If the people come out stiff, the naive-drawing alternative is the safer
demonstration.

**Links to fix**: both guide URLs (`prompting_editing_single_reference`, `prompting_guide_flux2`) are alive, but
BFL has **turned the single-reference page into FLUX 3 Image documentation**. It is still useful, but no longer
about FLUX.2. Add the FLUX.2 use-case page https://docs.bfl.ai/guides/usecases_editing_drawing_rendering.
⚠ The **default prompt** ("Change the camera angle to a first-person driver's perspective… steering wheel…")
describes ComfyUI's `car_interior_white.jpeg` sample, which ComfyQ does not ship. Students see an instruction
about a car they don't have. Suggest a neutral default ("Turn this into the same scene at night in heavy rain;
keep every building and person where they are."). Shared VAE link: see the first entry.

**Downstream note**: this run used to make the stormy-night picture that was the last frame of the three FL2V cards
and the reference of both loop cards. A good replacement pair for the FL2V cards: first frame = the scaled maquette,
last frame = this render — "the scale model comes to life".

```json
{ "workflow": "image_edit_flux2_klein_9b_image_edit",
  "title": "Restyle a picture, keep its layout",
  "summary": "Upload a picture and say what should change — the style, the light, the materials — and what must stay. Everything keeps its place, so it is ideal for turning a sketch, a scale model or a daytime photo into something new. About 25 seconds.",
  "note": "A photo of a student's scale model became a photo of the real place. Compare the two: every figurine is now a real person standing in the same spot, in the same colours.",
  "params": {
    "cliptextencode_text_75_74": "Turn this photograph of an architectural scale model into a realistic photograph of the real place at the same moment, seen from the same low camera position. The felt lawn becomes a real grass lawn, the small painted figurines become real people in the same clothes, colours, poses and positions — the crowd standing in front of the white stage, the speaker on the stage, the people seated on the wooden crates — the wooden blocks become real wooden crate stools, the tuft of moss becomes a real shrub, the timber and steel model structures become a real timber pavilion and a real steel footbridge, and the blurred white background becomes real buildings and an overcast sky. Soft natural daylight, accurate shadows, real materials such as wood, concrete, steel and grass. Keep the composition, the camera angle, the shallow depth of field and every person and object exactly where they are.",
    "cliptextencode_text_75_67": "",
    "flux2scheduler_steps_75_62": 20
  },
  "inputs": {
    "loadimage_image_76": { "need": "a photo of an architectural scale model with figurines, whose layout must survive the edit", "source": "derive:{asset PXL_20240628_084847386.jpg, scale 0.35} — NEW asset-derive; fallback asset:PXL_20240628_084847386.jpg",
      "suite": { "asset": "PXL_20240628_084847386.jpg", "derive": [ { "op": "scale", "factor": 0.35 } ], "fallback": "asset:PXL_20240628_084847386.jpg" } }
  },
  "keepRuntime": false, "estSec": 25,
  "sources": ["https://docs.bfl.ai/guides/usecases_editing_drawing_rendering", "https://docs.bfl.ai/guides/prompting_editing_single_reference", "https://docs.bfl.ai/flux_2"] }
```

---

## image_edit_flux2_klein_9b_image_edit_ref

**What the model is good at** (with sources): two `ReferenceLatent` chains on Klein 9B base. Image 1 is the source
and sets the output size; image 2 is the reference. BFL's multi-reference guidance: *"Describe the role of each input
image"* (FLUX.2 guide). Best-supported uses include *"Logo and branding: placing a logo from one image onto an object
or scene in another"* and object insertion (docs.bfl.ai/guides/prompting_editing_multi_reference). ComfyUI's own
template for this card puts a logo onto a steering wheel. Assessment: the lantern reference came out **faithful**,
but **"her face drifted (older, orange cast) — identity is its weak point"**.

**Showcase idea**: **a painting from picture 2 becomes a mural on the building in picture 1.** The source is the
asset `Screenshot 2025-03-06 105726.png`: a pink two-storey building with a wide, blank overhanging band, a yellow
taxi and a clear sky. The reference is `bafybei…jpg`, a soft painting of a blue whale over a speckled sea. It shows
the card's real job, taking something *from* one picture and putting it *on* another. There is **no person in
either picture**, which sidesteps the documented face drift. It is also a recognisable design-school task (a mural
or branding mock-up).

**Inputs**:
- `loadimage_image_76` — a building or object with a large blank surface. Source: `asset:Screenshot 2025-03-06 105726.png` (721×831, fully opaque).
- `loadimage_image_81` — an artwork with an unmistakable subject and palette. Source: `asset:bafybeibniohzuqfm3c7fdrvmyrdowcqfctto6j6x2drrkqqf5qwkwztk7q.jpg` (4096², optional NEW derive `scale 0.25` → 1024² for upload-box parity; the graph scales it to 1 MP anyway).

**Expected result / how to judge it**: the whale, with its blue-grey back and pale belly over speckled blue water,
painted across the front of the pink overhang and following the wall's angle. The building's shape, its windows,
the yellow taxi, the poles and wires, the mountains and the clouds are where they were. The painting looks
*painted on the wall*, not stuck on as a flat rectangle.

**Risks**: FLUX.2 redraws the whole frame (no mask), so small drift is likely: the taxi's shape, the wires. The
model may frame the painting as a billboard (a collage) instead of a mural; the prompt asks for paint on render.
Compare the two inpaint cards, which guarantee unmasked pixels stay identical.

**Links to fix**: `prompting_editing_multi_reference` now documents **FLUX 3 Image** (BFL repurposed it). It is
still relevant, but suggest adding https://docs.bfl.ai/flux_2/flux2_image_editing. The default prompt ("Apply the
reference style/elements…") is fine; the template's sample images (`car_interior_white.jpeg`,
`comfy_logo_blue.png`) are not shipped.

```json
{ "workflow": "image_edit_flux2_klein_9b_image_edit_ref",
  "title": "Edit using a second picture",
  "summary": "Give it a picture to change and a second picture to take something from — an artwork, a logo, a pattern, an object — and say how to combine them. Works best on objects, walls and products; people's faces may drift. About 45 seconds.",
  "note": "The whale painting (picture 2) was painted as a mural onto the pink building (picture 1). Check that the building, its windows and the taxi stayed as they were.",
  "params": {
    "cliptextencode_text_92_113": "Paint the whale artwork from image 2 as a large hand-painted mural directly onto the wide blank pink band at the top of the building in image 1, running along the front of the overhang from its left end towards the corner and following the angle of the wall. The mural shows the blue-grey whale with its pale belly swimming over the speckled blue sea, with the soft painterly texture and colours of image 2, as flat paint on the rendered wall. Keep the building's shape, its windows, the yellow taxi, the street, the power lines, the mountains, the clouds and the blue sky of image 1 exactly as they are.",
    "cliptextencode_text_92_87": "",
    "flux2scheduler_steps_92_115": 20
  },
  "inputs": {
    "loadimage_image_76": { "need": "a building with a large blank wall band (the surface to paint)", "source": "asset:Screenshot 2025-03-06 105726.png", "suite": "asset:Screenshot 2025-03-06 105726.png" },
    "loadimage_image_81": { "need": "an artwork with an unmistakable subject and palette (the thing to transfer)", "source": "asset:bafybeibniohzuqfm3c7fdrvmyrdowcqfctto6j6x2drrkqqf5qwkwztk7q.jpg (optional NEW asset-derive scale 0.25)",
      "suite": { "asset": "bafybeibniohzuqfm3c7fdrvmyrdowcqfctto6j6x2drrkqqf5qwkwztk7q.jpg", "derive": [ { "op": "scale", "factor": 0.25 } ], "fallback": "asset:bafybeibniohzuqfm3c7fdrvmyrdowcqfctto6j6x2drrkqqf5qwkwztk7q.jpg" } }
  },
  "keepRuntime": false, "estSec": 44,
  "sources": ["https://docs.bfl.ai/guides/prompting_editing_multi_reference", "https://docs.bfl.ai/guides/prompting_guide_flux2", "https://docs.bfl.ai/flux_2/flux2_image_editing"] }
```

---

## image_edit_flux2_klein_inpaint_prompt

**What the model is good at** (with sources): FLUX.2 Klein 9B **distilled** (4 steps, CFG 1) plus lquesada's
Inpaint Crop & Stitch. The crop node cuts a 1024-px window around the mask, so the model works at native
resolution, and the stitch node pastes the result back. The README says it *"does not modify the unmasked part of the
image, not even passing it through VAE encode and decode"*. The `ReferenceLatent` of the cropped source is
*"what makes Klein blend the new content with the scene"* (bundle note). Assessment: **"★ a red fishing boat in the
hole cut in the sea, seamless — 3 s"**.

**Showcase idea**: **swap one piece of furniture in a real photo of the school's own atrium.** The source is
`agora_ecole_de_design1.jpg`. The grey sofa at the lower right gets a transparent hole, and the prompt asks for a
curved mustard-yellow velvet sofa. A real, busy photo makes the key point easy to see: only the painted area
changes, and you can prove it pixel for pixel. The previous suite used a generated seascape.

**Inputs**: `loadimage_image_1` — a real photo with one object to replace, with a transparent hole over it
(LoadImage reads 1−alpha as "paint here"). Source: the asset `agora_ecole_de_design1.jpg` (1170×878) with
`transparent rect [0.645, 0.865, 0.81, 1.0]` (x0,y0,x1,y1 — the sofa, cut by the bottom edge) — NEW asset-derive.
**Fallback with no new code**: a hole over the croissant plate of this group's FLUX.3 flat-lay
(`image_flux3_klein_t2i`, layout box `[700,50,980,240]` → derive `transparent ellipse [0.05, 0.70, 0.24, 0.98]`),
with the prompt "a slice of strawberry tart on a small white plate".

**Expected result / how to judge it**: a curved mustard velvet sofa sitting on the floor in the right perspective,
with a soft shadow and lit like the glass-roofed hall. **Diff against the source outside the hole: zero change.**
That is the checkable claim, and the one this card makes over the plain edit cards.

**Risks**: the hole touches the bottom edge, so the sofa is cut there too, as the original was. A sliver of the
white-topped crate behind the sofa falls inside the hole and will be redrawn. The model may make the sofa a little
smaller than the hole; the mask blend of 64 px hides the seam.

**Links to fix**: none in the meta (the UNET link is gated, as BFL's are). The template note calls the UNET
"black-forest-labs/FLUX.2-klein-**base**-9b-fp8", but the file is the distilled `FLUX.2-klein-9b-fp8`. That is a
note-only slip; the meta `url` is right.

```json
{ "workflow": "image_edit_flux2_klein_inpaint_prompt",
  "title": "Repaint a marked area from words",
  "summary": "Paint over the part of your picture you want replaced and describe what should be there. Only the painted area changes — the rest of the picture stays exactly as it was. Takes about 3 seconds.",
  "note": "The grey sofa in a photo of the school's atrium was painted over and described as a mustard velvet sofa. Everything outside the painted area is untouched, down to the pixel.",
  "params": {
    "cliptextencode_text_6": "a curved mid-century sofa upholstered in mustard-yellow velvet with three round seat cushions and thin dark wooden legs, standing on the pale grey concrete floor, seen from above at the same angle as the room, lit by soft daylight from the glass roof and casting a soft shadow on the floor",
    "cliptextencode_text_7": ""
  },
  "inputs": {
    "loadimage_image_1": { "need": "a real photo with one object to replace, a transparent hole over that object", "source": "derive:{asset agora_ecole_de_design1.jpg, transparent rect [0.645,0.865,0.81,1.0]} — NEW asset-derive; fallback: output:image_flux3_klein_t2i + transparent ellipse [0.05,0.70,0.24,0.98] with the strawberry-tart prompt",
      "suite": { "asset": "agora_ecole_de_design1.jpg", "derive": [ { "op": "transparent", "shape": "rect", "box": [0.645, 0.865, 0.81, 1.0] } ] } }
  },
  "keepRuntime": false, "estSec": 3,
  "sources": ["https://github.com/lquesada/ComfyUI-Inpaint-CropAndStitch", "https://docs.bfl.ai/guides/prompting_editing_single_reference"] }
```

---

## image_edit_flux2_klein_inpaint_reference

**What the model is good at** (with sources): the same crop-and-stitch inpaint as above, plus a **second
`ReferenceLatent`** carrying a picture of what to insert. The bundle note: *"replace with something FROM A PHOTO → this
graph"*. BFL lists object insertion and product placement among the best-supported multi-reference uses.
Assessment: **"★ the lantern, lit, standing on the rocks in its hole — 4 s"**.

**Showcase idea**: **jewellery try-on: a dragonfly brooch pinned onto a portrait's lapel.** The scene is
`0 (1).png`, a woman in a houndstooth tweed jacket and pearls. It is also ComfyUI's sample reference for the depth
card. The reference is `nv.1197-trat.-fundo-CAzev.jpg`, a gold and green-enamel dragonfly brooch on white. The
teaching point is the contrast with the reference-edit card: there the whole frame is redrawn and faces drift; here
**the face is outside the mask, so it cannot change**. A small hole also exercises the crop node's upscaling
(a small area rendered at 1024 px, then pasted back).

**Inputs**:
- `loadimage_image_1` — a portrait with a transparent hole on the lapel. Source: `0 (1).png` (746×959) with `transparent ellipse [0.03, 0.70, 0.24, 0.86]` — NEW asset-derive. (`transparent` rebuilds alpha, so the asset's semi-transparent last pixel column is cleared.) Fallback with no new code: a hole on the sweater of this group's FLUX.2 portrait (`output:image_flux2_klein_9b_t2i`, `transparent ellipse [0.12, 0.80, 0.34, 0.96]`). That position is less certain because it is a generated picture.
- `loadimage_image_22` — a clear photo of the object, on a plain background. Source: `asset:nv.1197-trat.-fundo-CAzev.jpg` (700×700).

**Expected result / how to judge it**: a gold dragonfly brooch with green enamel, gold-veined wings and blue-green
jewelled wing-tips, pinned on the left lapel (viewer's left), sized like real jewellery and lit by the same soft
studio light. **The face, hair, lips and pearls are pixel-identical to the source.**

**Risks**: fine detail on the brooch (the small female figure at its centre) will be simplified. At 4 steps the
model may render a real insect rather than a jewel; the prompt says gold and enamel, pinned. The hole's size sets the
brooch's size.

**Links to fix**: none.

```json
{ "workflow": "image_edit_flux2_klein_inpaint_reference",
  "title": "Insert an object from a photo",
  "summary": "Paint where something should go and upload a picture of that thing — a product, a piece of furniture, a jewel. It appears in the painted spot, matched to the light, and the rest of your picture is untouched. About 4 seconds.",
  "note": "A dragonfly brooch (the second picture) was pinned onto her lapel, only inside the painted spot. Her face and pearls are exactly the original pixels.",
  "params": {
    "cliptextencode_text_6": "Pin the jewelled dragonfly brooch from the reference image onto the lapel of her black-and-cream tweed jacket in the painted area: a gold body, green enamel wings with fine gold veins and blue-green jewels at the wing tips, sized like a real brooch, sitting flat on the fabric, lit by the same soft studio light with a small shadow on the tweed.",
    "cliptextencode_text_7": ""
  },
  "inputs": {
    "loadimage_image_1": { "need": "a portrait whose lapel has a transparent hole where the brooch goes", "source": "derive:{asset 0 (1).png, transparent ellipse [0.03,0.70,0.24,0.86]} — NEW asset-derive; fallback output:image_flux2_klein_9b_t2i + transparent ellipse [0.12,0.80,0.34,0.96]",
      "suite": { "asset": "0 (1).png", "derive": [ { "op": "transparent", "shape": "ellipse", "box": [0.03, 0.70, 0.24, 0.86] } ] } },
    "loadimage_image_22": { "need": "the object to insert, alone on a plain background", "source": "asset:nv.1197-trat.-fundo-CAzev.jpg", "suite": "asset:nv.1197-trat.-fundo-CAzev.jpg" }
  },
  "keepRuntime": false, "estSec": 4,
  "sources": ["https://github.com/lquesada/ComfyUI-Inpaint-CropAndStitch", "https://docs.bfl.ai/guides/prompting_editing_multi_reference"] }
```

---

## image_edit_flux2_klein_ref_control_depth

**What the model is good at** (with sources): thedeoxen's **RefControl FLUX.2 Klein 9B Reference-Depth LoRA**. It
*"fuses a reference image with a depth map… keeps identity and style from the reference and takes pose and structure
from the depth map. Mainly trained on humans but also works with objects and stylized characters."* The trigger word
is `refcontrol`; strength 0.8–1.0; the depth image comes first. The card warns that results are best *"when the
depth map has similar proportions and scale to the reference"* (HF card). The graph runs Depth Anything V3 on the
structure image, puts the depth latent before the reference latent, and applies the LoRA at 1.0. Assessment:
**"★ excellent and cheap — the keeper in the dancer's exact leap, face, coat and boots kept, 9 s"**.

**Showcase idea**: **this group's full-body character, put into a real dancer's pose.** The reference is the
FLUX.3-distilled character (a young woman in a mustard jumpsuit, teal tool belt, coral backpack and round glasses,
standing still). The structure is `controlNet_demo_image.jpg`, a real photo of a street dancer mid-move (arm
up, knees bent, heel lifted) on a plain grey studio floor. Both are full-body figures in 2:3, which meets the LoRA
card's "similar proportions and scale" rule. Distinctive clothes make it easy to see that identity came from one
picture and pose from the other.

**Inputs**:
- `loadimage_image_81` — a full-body character whose look must be kept. Source: `output:image_flux3_klein_distilled_t2i`.
- `loadimage_image_119` — a full-body photo of the pose to copy, similar framing. Source: `asset:controlNet_demo_image.jpg` (640×960, a real dancer on a plain studio background).

**Expected result / how to judge it**: her limbs match the dancer's. One arm is raised and bent at head height on
the left of the frame, the other hangs forward, both knees are bent and one heel is lifted. Glasses, copper-tipped
hair, jumpsuit, tool belt, coral backpack and red-laced high-tops are kept. The output takes the structure's shape
(≈832×1248).

**Risks**: the LoRA was trained for the **undistilled base** (~50 steps, CFG 4), but this card runs it on the
**distilled** 9B at 4 steps and CFG 1. That works on this rig according to the assessment, but it is outside the
author's setting. The backpack may be partly hidden by the pose. Hands.

**Links to fix**: `flux2_klein_9b_refcontrol_depth.safetensors` → `source` is `https://huggingface.co/Comfy-Org/flux2-klein-9B`,
which **does not contain it** (that repo holds only text encoders and the VAE). The real source, same 165,704,480
bytes as the rig's file: `https://huggingface.co/thedeoxen/refcontrol-FLUX.2-klein-9B-reference-depth-lora/resolve/main/flux2_klein_9b_refcontrol_depth.safetensors`.
The meta labels the prompt "optional", but its default `refcontrol` is the **trigger word**. The label should say
"keep the word refcontrol at the start". The description could add: "trained on the FLUX.2 Klein base model; this card runs
it on the fast build". `da3_large.safetensors` → `depth-anything/DA3-LARGE-1.1` is correct (the node pack fetches
it; it could be marked `auto`).

```json
{ "workflow": "image_edit_flux2_klein_ref_control_depth",
  "title": "Pose a character like a photo",
  "summary": "Upload your character and a photo of anyone in the pose you want. You get your character — same face, clothes and style — in exactly that pose, in about 10 seconds. Works best when both pictures show a whole body, framed the same way.",
  "note": "Same young woman, same outfit — but in the pose of a real dancer from a second photo. Compare her arms and legs with the dancer's.",
  "params": {
    "cliptextencode_text_113": "refcontrol, the young woman from the reference image dancing in exactly this pose, with her round tortoiseshell glasses, short copper-tipped coily hair, mustard-yellow utility jumpsuit, teal canvas tool belt, coral-red backpack and white high-top sneakers with red laces, on a plain light-grey studio floor with soft even light",
    "cliptextencode_text_114": ""
  },
  "inputs": {
    "loadimage_image_81": { "need": "a full-body character on a plain background whose look must be kept", "source": "output:image_flux3_klein_distilled_t2i", "suite": "output:image_flux3_klein_distilled_t2i" },
    "loadimage_image_119": { "need": "a full-body photo of a strong pose, framed like the reference", "source": "asset:controlNet_demo_image.jpg", "suite": "asset:controlNet_demo_image.jpg" }
  },
  "keepRuntime": false, "estSec": 9,
  "sources": ["https://huggingface.co/thedeoxen/refcontrol-FLUX.2-klein-9B-reference-depth-lora", "https://huggingface.co/depth-anything/DA3-LARGE-1.1"] }
```

---

## image_flux3_klein_t2i

**What the model is good at** (with sources): FLUX.3 Image Klein, 5.6B. *"Edit from an instruction, generate images
from text, combine up to 10 references, or guide layouts with bounding boxes"* (HF comfy card). This is the
**Base** build: 50 steps, CFG 3.5, *"the undistilled model for fine-tuning, LoRA training, and research"*
(docs.bfl.ai/flux_3/flux3_image_klein). Its layout prompts are a caption that cites each box as `<id>`, plus a table
of `bbox` + `desc`. BFL: *"Boxes guide placement and scale; they do not constrain pixels to a hard mask"*. A text block
gets *"its own row"*, with *"the exact words in desc"* (docs.bfl.ai/guides/prompting_layout). Assessment: the keeper
inside one layout box, "the layout box works", but the base costs 5× the distilled "for a small gain".

**Showcase idea**: **a top-down breakfast flat-lay laid out with nine boxes**: the tabletop, a folded newspaper, its
masthead text "LE MATIN", a vase of tulips, **three identical espresso cups in a row**, a croissant plate and a
teaspoon. Seen from directly above, boxes map onto objects without perspective, so a student can open the composer
on the example and check that every object sits in its box. The masthead box shows text placement. The three
identical cups set up the next card (FLUX.3 base edit), which changes only the boxed centre cup. The improver is off
(it fails on 0.43.2). The caption is hand-written in the `t2i_bbox` upsampler format, the way BFL's own
`balloons.json` prompt cites `<obj_1>`, `<sky_1>`… Boxes are sized for 3:2: a round saucer 240 units tall is 160
units wide, following the system prompt's *"x-span ≈ y-span × a × H/W"*.

**Inputs**: none.

**Expected result / how to judge it**: open the layout in the composer over the result. The newspaper is top-left
with **"LE MATIN" legible** across its top, the tulips top-right, three evenly spaced white cups across the middle,
the croissant bottom-left and the spoon bottom-right, each inside its box. The light comes from the left with short
shadows to the right.

**Risks**: boxes are hints, so a cup may drift by a few percent. The newspaper's body text is gibberish (expected at
that size). The HF card warns that rendered text "may be inaccurate", so check "LE MATIN" letter by letter.
37 s warm.

**Links to fix**: the meta has **no `promptGuides`**. Add https://docs.bfl.ai/guides/prompting_layout,
https://docs.bfl.ai/flux_3/flux3_image_bounding_boxes and https://docs.bfl.ai/guides/prompting_unified_basics.
**The description is wrong in two places.** It calls the base "the higher-quality one" (BFL positions it for
fine-tuning and research and recommends the distilled build for generation; the assessment measured "a small gain").
It also advertises the AI improver as working ("adds about 3 minutes"); only the checkbox label says it fails.
Replace with: "BFL train this model on long captions; the AI improver that writes them fails on this ComfyUI build,
so write a full caption yourself: medium first, then the scene, light, camera and each subject's position." Shared
VAE link: see the first entry.

```json
{ "workflow": "image_flux3_klein_t2i",
  "title": "Make a picture, slower but finer",
  "summary": "Write a detailed description — and, if you like, draw boxes where things go — and get a photo-quality picture in about 40 seconds. Its twin, \"Make a picture in seconds\", does the same in 7 seconds; pick this slower one for a little more detail and variety.",
  "note": "Every object was placed by a box you can see in the layout: open the example's layout over the picture. Notice the three identical cups in a row and the masthead \"LE MATIN\" exactly where its box was drawn.",
  "params": {
    "prompt": "Overhead flat-lay photograph of a breakfast table, shot straight down in soft morning window light from frame-left, with short soft shadows falling to the right of every object. A pale oak tabletop <obj_1> fills the whole frame. In the upper left lies a folded newspaper <obj_2> whose masthead <obj_3> runs across its top edge. In the upper right stands a small glass vase of yellow tulips <obj_4>. Across the middle of the table runs a straight, evenly spaced row of three identical white espresso cups on saucers: one on the left <obj_5>, one in the centre <obj_6> and one on the right <obj_7>. In the lower left sits a croissant on a small white plate <obj_8>, and in the lower right a brass teaspoon <obj_9> lies diagonally.",
    "layout": "[{\"type\":\"obj\",\"bbox\":[0,0,1000,1000],\"desc\":\"A pale, lightly oiled oak tabletop with fine straight grain running left to right, a few faint water rings and small knife marks.\"},{\"type\":\"obj\",\"bbox\":[40,40,420,400],\"desc\":\"A folded broadsheet newspaper of off-white newsprint, slightly creased, with columns of tiny grey body text and a small black-and-white photograph.\"},{\"type\":\"text\",\"bbox\":[70,60,150,380],\"text\":\"LE MATIN\",\"desc\":\"Bold black condensed serif newspaper masthead in capital letters, printed across the top of the front page, reading\"},{\"type\":\"obj\",\"bbox\":[50,750,390,970],\"desc\":\"A small round clear-glass vase holding seven yellow tulips with green leaves, the tulip heads seen from directly above.\"},{\"type\":\"obj\",\"bbox\":[440,220,680,380],\"desc\":\"A plain glossy white porcelain espresso cup on a matching white saucer, filled with dark coffee under a thin layer of tan crema, handle pointing right.\"},{\"type\":\"obj\",\"bbox\":[440,420,680,580],\"desc\":\"A plain glossy white porcelain espresso cup on a matching white saucer, filled with dark coffee under a thin layer of tan crema, handle pointing right.\"},{\"type\":\"obj\",\"bbox\":[440,620,680,780],\"desc\":\"A plain glossy white porcelain espresso cup on a matching white saucer, filled with dark coffee under a thin layer of tan crema, handle pointing right.\"},{\"type\":\"obj\",\"bbox\":[700,50,980,240],\"desc\":\"A small round white ceramic plate holding one golden, flaky butter croissant with a few crumbs beside it.\"},{\"type\":\"obj\",\"bbox\":[790,760,900,960],\"desc\":\"A small polished brass teaspoon lying diagonally, its bowl catching a bright highlight.\"}]",
    "improve_prompt": false,
    "aspect_ratio": "3:2 (Photo)",
    "megapixels": 1,
    "steps": 50,
    "cfg": 3.5
  },
  "inputs": {},
  "keepRuntime": false, "estSec": 37,
  "sources": ["https://huggingface.co/black-forest-labs/flux-3-image-klein-comfy", "https://docs.bfl.ai/flux_3/flux3_image_klein", "https://docs.bfl.ai/guides/prompting_layout", "https://docs.bfl.ai/flux_3/flux3_image_bounding_boxes", "https://github.com/black-forest-labs/flux-3-image-klein", "https://huggingface.co/black-forest-labs/flux-3-image-klein-pup"] }
```

---

## image_flux3_klein_distilled_t2i

**What the model is good at** (with sources): the **distilled** FLUX.3 Klein: 16 steps, no guidance, *"Fast editing
and generation, local deployment… the checkpoint behind the BFL API"* (docs.bfl.ai/flux_3/flux3_image_klein; HF comfy
card). BFL's README: *"about 6x faster"* than base. Assessment: **"★ fastest and lightest in the library — 7 s, 10 GB"**,
with a perfect product shot.

**Showcase idea**: **a full-body studio photo of an original character, in about 7 seconds**, written in the `t2i`
upsampler format. That format opens with "Studio photograph," and gives each person an observable profile
(ethnicity, age range, skin tone, hair, each garment), frame-relative placement and a plain background. The
character is designed to be reused. It carries plenty of signature details that a turnaround or sheet must keep:
round glasses, copper-tipped hair, a jumpsuit with snaps, a three-pouch tool belt, a coral backpack and red laces.
It stands in a relaxed near-A-pose, whole body in frame, on a featureless grey background. **That makes it this
group's character input** for QuadView, the character sheet and the depth-pose card, and a good input for other
groups' 3D, angle and character-replacement cards. It takes over the role FLUX.3 base played in the old suite.

**Inputs**: none.

**Expected result / how to judge it**: a ≈7 s warm run. The whole figure fits from head to sneakers with margin
above and below. Every listed item is present in the right colour. The background is even light grey. She faces the
camera with her arms away from her body.

**Risks**: a figure in 2:3 at 1 MP has a small face (about 120 px), which is fine for a sheet. The backpack straps
may hide the jumpsuit's chest pocket.

**Links to fix**: no `promptGuides`. Add https://docs.bfl.ai/guides/prompting_unified_basics and
https://docs.bfl.ai/guides/prompting_layout. The description advertises the AI improver as working ("adds about 3
minutes"); say it fails on this build and that the caption should be written in full. The template's own "try 4–16
steps" note is fine. Shared VAE link: see the first entry.

```json
{ "workflow": "image_flux3_klein_distilled_t2i",
  "title": "Make a picture in seconds",
  "summary": "Write a detailed description and get a high-quality picture in about 7 seconds — the fastest picture card, light enough to share the computer with another card. It can also place things where you draw boxes.",
  "note": "A full-body studio photo made in about 7 seconds from a detailed description: medium first, then the light, then the person head to toe. The same character is turned around and posed by other example cards.",
  "params": {
    "prompt": "Studio photograph, full-length shot at eye level against a seamless light-grey paper backdrop, under soft, even light from a large softbox at frame-left with a gentle fill from the right. A young West African woman in her twenties with dark brown skin and short natural coily black hair dyed copper at the tips stands upright in the centre of the frame, facing the camera, her arms relaxed slightly away from her body and her feet a little apart, the whole figure from head to sneakers in frame with space above and below. She wears round tortoiseshell glasses, a mustard-yellow cotton utility jumpsuit with rolled sleeves, a zipped chest pocket and a row of small brass snaps, a teal canvas tool belt with three pouches across her hips, and white high-top canvas sneakers with red laces. A small coral-red backpack with two padded straps sits on her shoulders. Her expression is calm, with a slight closed-mouth smile. A soft contact shadow pools on the grey floor around her feet, and the background is an even, featureless light grey.",
    "layout": "",
    "improve_prompt": false,
    "aspect_ratio": "2:3 (Portrait Photo)",
    "megapixels": 1,
    "steps": 16
  },
  "inputs": {},
  "keepRuntime": false, "estSec": 7,
  "sources": ["https://docs.bfl.ai/flux_3/flux3_image_klein", "https://huggingface.co/black-forest-labs/flux-3-image-klein-comfy", "https://github.com/black-forest-labs/flux-3-image-klein", "https://huggingface.co/black-forest-labs/flux-3-image-klein-pup"] }
```

---

## image_edit_flux3_klein_image_edit

**What the model is good at** (with sources): FLUX.3 Klein base editing with `ReferenceMultiLatent`. The picture is
`<ref_image_0>` and the output takes its shape. BFL single-reference editing: *"Name the target so only one thing
matches… Use box rows when several similar objects match, when you need exact position or size"*. Their FLUX 3
examples: *"change the large tiger <animal_1> and the small glowing butterfly <insect_1> to be pink. Keep … exactly
unchanged"*, and *"change the color of only one bird in the middle to #e01075"*
(docs.bfl.ai/guides/prompting_editing_single_reference). The `i2i_bbox` system prompt says an instruction *"closes
with one compact clause that everything else stays identical to the source"*. Assessment: **"★ the most precise edit
— one `<obj_1>` box over the coat; face, hair, expression, background untouched — 70 s"**.

**Showcase idea**: **three identical cups, and only the boxed one changes.** The input is the FLUX.3 base flat-lay.
One box over the centre cup, at the same coordinates as its box in the t2i layout, turns it glossy cobalt-blue with a
gold rim. The other two cups stay white. Of all BFL's stated reasons for boxes, this is the one a student understands
at a glance: the words alone could catch every cup; the box picks one. There is a nice chain too: the box the
student drew to *make* the picture is the box that *edits* it. The improver is off (it fails). The prompt follows the
`i2i_bbox` voice, citing `<ref_image_0>` and `<obj_1>` and ending with the keep clause.

**Inputs**: `image` — a picture with several identical objects. Source: `output:image_flux3_klein_t2i`. The
integrator should check the t2i result first: if the centre cup landed away from `[440,420,680,580]`, re-measure
the box on the real picture (y,x on 0–1000).

**Expected result / how to judge it**: side by side with the input, only the centre cup and saucer are cobalt-blue
with a gold rim and still full of coffee. The left and right cups are white. The newspaper, "LE MATIN", the tulips,
the croissant, the spoon and the shadows are unchanged. The output keeps the 3:2 shape.

**Risks**: the ComfyUI node writes only `bbox` rows, so the other cups cannot be marked "keep" and the words carry
that. If the model still tints its neighbours, add "the left and right cups stay plain white" (already in the prompt).
70 s warm, the slowest card in this group.

**Links to fix**: no `promptGuides`. Add https://docs.bfl.ai/guides/prompting_editing_single_reference (now FLUX 3)
and https://docs.bfl.ai/flux_3/flux3_image_bounding_boxes. **The description is stale**: it says *"Placing the change
with boxes (FLUX.3 layout prompts) is not offered on this card yet"*, but the `layout` field was added on
2026-11-03. Also, BFL's edit-box format has `from/src_bbox/tgt_bbox` and ComfyUI's node writes only `bbox`;
worth one line in the description: "a box says where; say in words what must stay". Shared VAE link: see the first
entry.

```json
{ "workflow": "image_edit_flux3_klein_image_edit",
  "title": "Edit a picture, slower but finer",
  "summary": "Describe a change and, if you like, draw a box around the exact thing to change; the rest of the picture stays the same. The most precise edit in the library, and the slowest (about 70 seconds) — its twin, \"Edit a picture in seconds\", does the same job in 12.",
  "note": "Three identical cups, but the box picked one: only the centre cup turned cobalt blue. The words could match every cup — the box says which.",
  "params": {
    "prompt": "In <ref_image_0>, change the centre espresso cup and its saucer <obj_1> into glossy cobalt-blue porcelain with a thin gold rim, still filled with dark coffee under a thin layer of crema. The left and right cups and saucers stay plain white, and everything else — the newspaper and its masthead, the tulips, the croissant, the teaspoon, the oak table, the light and the shadows — stays identical to the source.",
    "layout": "[{\"type\":\"obj\",\"bbox\":[440,420,680,580],\"desc\":\"A glossy cobalt-blue porcelain espresso cup with a thin gold rim on a matching cobalt-blue saucer, filled with dark coffee under a thin layer of tan crema.\"}]",
    "improve_prompt": false,
    "megapixels": 1,
    "steps": 50,
    "cfg": 3.5
  },
  "inputs": {
    "image": { "need": "a picture with several identical objects, one of which will be boxed", "source": "output:image_flux3_klein_t2i", "suite": "output:image_flux3_klein_t2i" }
  },
  "keepRuntime": false, "estSec": 70,
  "sources": ["https://docs.bfl.ai/guides/prompting_editing_single_reference", "https://docs.bfl.ai/flux_3/flux3_image_bounding_boxes", "https://huggingface.co/black-forest-labs/flux-3-image-klein-pup", "https://github.com/black-forest-labs/flux-3-image-klein"] }
```

---

## image_edit_flux3_klein_distilled_image_edit

**What the model is good at** (with sources): the distilled FLUX.3 Klein edit, 16 steps. BFL: Klein is *"designed
for image editing"* and the distilled build is for *"fast editing and generation"*
(docs.bfl.ai/flux_3/flux3_image_klein). The `i2i` upsampler voice for a whole-image change: *"a whole-image
transformation opens with its scope ('Convert the entire image into …')"*. BFL lists restyling into another medium
while keeping the composition as a documented editing use case (docs.bfl.ai/guides/usecases_editing_style_transfer).
Assessment: the watercolour repaint of the video's first frame worked in **12 s**, and the restyle-hires card it fed
"starts painted".

**Showcase idea**: **the whole picture turned into a watercolour in about 12 seconds, with every outline still in
place.** This keeps its current, load-bearing role: the result is the key frame of both ID-V2V restyle cards in
another group. The prompt is rewritten in the `i2i` "Convert the entire image into…" voice and is content-neutral,
so it stays valid whatever clip the integrator chooses as the shared video-to-video source.

**Inputs**: `image` — frame 0 of the clip that every video-to-video card restyles (owned by another group). Source:
`{ "from": "<shared v2v source workflow>", "kind": "video", "derive": [ { "op": "frame", "index": 0 } ] }` (the old
suite used `video_ltx2_5_t2v`).

**Expected result / how to judge it**: overlay on the source frame, and every outline, person and object lines up.
Soft transparent washes, pigment pooling at edges, visible paper grain, a few unpainted white highlights, and the
original colours kept as tints.

**Risks**: small faces in the frame may be simplified into blobs, which is fine for watercolour. If the source frame
is dark (night), the watercolour reads muddy; tell the integrator to prefer a lit first frame.

**Links to fix**: no `promptGuides`. Add https://docs.bfl.ai/guides/prompting_editing_single_reference and
https://docs.bfl.ai/guides/usecases_editing_style_transfer. Same stale line as the base edit ("boxes… not offered on
this card yet"). Shared VAE link: see the first entry.

```json
{ "workflow": "image_edit_flux3_klein_distilled_image_edit",
  "title": "Edit a picture in seconds",
  "summary": "Describe a change — a new style, colour, object or light — and get the edited picture in about 12 seconds. The result keeps your picture's shape and layout; a box can point at exactly what to change.",
  "note": "The first frame of a video, repainted as a watercolour in about 12 seconds. Every shape stayed where it was — which is why two video cards use it as their style guide.",
  "params": {
    "prompt": "Convert the entire image <ref_image_0> into a loose watercolour painting on textured cold-press paper: soft transparent washes, pigment pooling along the edges of shapes, visible paper grain and a few unpainted white highlights. Keep every person, object and building in exactly the same position, size and pose, keep the camera angle and the composition, and keep the original colours as watercolour tints.",
    "layout": "",
    "improve_prompt": false,
    "megapixels": 1,
    "steps": 16
  },
  "inputs": {
    "image": { "need": "the first frame of the shared video-to-video source clip", "source": "derive:{from <shared v2v source clip>, kind video, frame 0}",
      "suite": { "from": "video_ltx2_5_t2v", "kind": "video", "derive": [ { "op": "frame", "index": 0 } ] } }
  },
  "keepRuntime": false, "estSec": 12,
  "sources": ["https://docs.bfl.ai/flux_3/flux3_image_klein", "https://huggingface.co/black-forest-labs/flux-3-image-klein-pup", "https://docs.bfl.ai/guides/usecases_editing_style_transfer"] }
```

---

## image_krea2_turbo_t2i_lora

**What the model is good at** (with sources): Krea 2 Turbo (8 steps) has a very wide style range. Its official
examples are mostly *not* photos: a 3D designer toy, vintage collage, ligne-claire, anime, airbrush sci-fi
(github.com/krea-ai/krea-2 `docs/prompting.md`, "long detailed prompts yield best results"). Its distinguishing feature
on this card is the **style LoRA dropdown**, with trigger words added automatically through `linkedValues`. The
`krea2_embroidered-textile-diorama-comfy` LoRA (ilkerzgi): trigger `embroidered textile diorama style`, **strength
1.0–1.25**, base Krea-2-Turbo; the card's only example is "a lighthouse on a rocky cliff". Assessment: "good; the AI
prompt rewrite is most of the 35 s".

**Showcase idea**: **one plain description, one style picked from the list, and the whole scene comes out as an
embroidered fabric diorama**: satin-stitch snow, thread forests, a felt cable car. It is the most unmistakable look
among the LoRAs on disk, and the one a student can't get by typing a style word into any other card. The student types
**no trigger words**: the card adds them, and the AI rewrite (on, with Thinking on, both defaults) is told to leave style
words out, so the LoRA's look isn't mixed with another (system prompt `9920`). This avoids the documented failure of
2026-09-15, planning text leaking into the image, by keeping Thinking on as the card's default already does.

**Inputs**: none.

**Expected result / how to judge it**: every surface reads as textile. Snow is satin stitches, pines are thread or
French knots, the river is a blue ribbon, the cable is a thread, the cable car is felt. It has a tabletop-diorama
depth. A red cable car hangs mid-cable between two peaks, with lit chalets and a river below. No stray words.

**Risks**: the enhancer may still add a medium word; the regex cleanup handles labels, not that. The LoRA is a
community, fal-trained style with little documentation. 1.0 is inside the recommended 1.0–1.25 range.

**Links to fix**: `krea2_realism_lora.safetensors` → `source` is `https://huggingface.co/Comfy-Org/Krea-2`, which
**does not hold it** (its `loras/` has no realism file). The real source, same 469,288,512 bytes:
`https://huggingface.co/gokaygokay/Krea-2-Realism-LoRA/resolve/main/krea2_realism_lora.safetensors` (mirrored at
`bonticario/Krea-2-Realism-LoRA`). ⚠ The LoRA dropdown (`optionsFilter: "krea2_"`) also lists
**`krea2_style_reference.safetensors`**. That is the reference-image LoRA of the style-reference card and does
nothing useful in this text-only graph. It needs an exclude rule or a rename.

```json
{ "workflow": "image_krea2_turbo_t2i_lora",
  "title": "Pick a style, make a picture",
  "summary": "Pick a ready-made look from the list — embroidery, ink wash, retro anime, watercolour, tarot card… — and describe your scene; the card adds the words that switch the style on. About 35 seconds.",
  "note": "The prompt only describes a cable car over a valley; the \"embroidered textile diorama\" style was picked from the list, and the card added its words by itself. Look for stitches, felt and thread everywhere.",
  "params": {
    "primitivestringmultiline_value_30_19": "A small red cable car crossing a deep alpine valley on a single cable stretched between two snowy peaks. Far below, a village of chalets with glowing windows sits beside a winding blue river, pine forests climb the slopes, and a few soft clouds wrap the summits.",
    "primitiveboolean_value_30_24": true,
    "textgenerate_thinking_30_16": true,
    "resolutionselector_aspect_ratio_49": "3:2 (Photo)",
    "primitiveboolean_value_30_23": true,
    "loraloadermodelonly_lora_name_30_15": "krea2_embroidered-textile-diorama-comfy.safetensors",
    "loraloadermodelonly_strength_model_30_15": 1
  },
  "inputs": {},
  "keepRuntime": false, "estSec": 35,
  "sources": ["https://huggingface.co/ilkerzgi/krea-2-embroidered-textile-diorama-lora", "https://huggingface.co/Comfy-Org/Krea-2", "https://github.com/krea-ai/krea-2/blob/main/docs/prompting.md"] }
```

---

## image_krea2_turbo_style_reference

**What the model is good at** (with sources): ostris' **krea2_turbo_style_reference** LoRA *"applies the style of a
reference image to generated output… trained on thousands of hand curated style pairs"*, **for "1-2 reference
images"**, with no trigger word. Its examples describe only the subject (*"a white yeti with horns reading a book"*).
The bundle feeds the references through `TextEncodeQwenImageEditPlus` and describes the averaging behaviour. The card
supplies the style lock: *"Describe the SUBJECT in the prompt and leave the style to the references."* Assessment:
"good — a fox rowing at night, in the blended style of two of the suite's pictures".

**Showcase idea**: **one strongly styled reference applied to an unrelated subject**, so students see *style*
transfer, not *content* transfer. The reference is `QmaGtZfK…png`: a loose orange and peach wet-in-wet watercolour
bloom with drips on textured cream paper. Its subject, a leaf-shaped stain, is deliberately nothing like the prompt's
**grey heron taking off from a misty lake**. If the heron comes out as bleeding orange washes on visible paper grain,
with no leaf in sight, the card's job is proven. One reference, not three: the LoRA was trained on 1–2 and the card
itself warns that mixing pictures gives "a muddle". The AI enhancer is **off** (default). Its system prompt is the old
"Think step by step… consider two or three alternatives" text with thinking off, the very combination that leaked
planning notes into images on the Krea t2i card before its 2026-09-15 fix.

**Inputs**: `loadimage_image_69` — a picture with a strong, easy-to-name look (medium, palette, texture) and simple
content. Source: `asset:QmaGtZfK1wyXb4KXodUSF9uibqY9JwxnPQ6Tnt122ahVoN.png` (4096², optional NEW derive `scale 0.26` →
1065² so it fits the 1920×1080 upload box; the graph rescales anyway). `loadimage_image_77` / `loadimage_image_78`: `null`.

**Expected result / how to judge it**: a recognisable heron (long neck, legs trailing, wings spread) painted in loose
orange, peach and amber washes with soft bleeding edges, drips and blooms, on visible cream paper texture, with mist as
unpainted paper. **No leaf shape**, and nothing copied from the reference's composition.

**Risks**: the palette may turn the heron orange. That is the transfer working, and the caption should say so. The
model might echo the reference's single central blot, but a 3:2 frame and a wide wingspan work against it.

**Links to fix**: the card offers **three** reference slots, but the LoRA card says it was trained for **1–2**, so
the third slot's label should say so. Suggest updating the enhancer's system prompt `30:18` to the cleaned
"plan silently / output only the prompt" text the t2i card uses, or setting `thinking` on. Models: all `url`s
check out; `krea2_style_reference.safetensors` is in `Comfy-Org/Krea-2/loras` (457,111,760 bytes).

```json
{ "workflow": "image_krea2_turbo_style_reference",
  "title": "Copy the style of a picture",
  "summary": "Upload one or two pictures whose look you like and describe something new: you get your subject made in their style — colours, texture, brushwork — without copying what they show. About 30 seconds.",
  "note": "The reference was an orange watercolour stain on paper; the prompt asked for a heron. You get a heron, painted in that watercolour — the look moved over, the leaf shape didn't.",
  "params": {
    "primitivestringmultiline_value_30_19": "a grey heron taking off from a misty lake at dawn, wings spread wide, long legs trailing over the water, a few reeds in the foreground",
    "loraloadermodelonly_strength_model_30_15": 1,
    "primitiveboolean_value_30_24": false,
    "resolutionselector_aspect_ratio_71": "3:2 (Photo)",
    "resolutionselector_megapixels_71": 1,
    "basicscheduler_steps_30_60": 8
  },
  "inputs": {
    "loadimage_image_69": { "need": "one picture with a strong, nameable look and simple content unlike the prompt", "source": "asset:QmaGtZfK1wyXb4KXodUSF9uibqY9JwxnPQ6Tnt122ahVoN.png (optional NEW asset-derive scale 0.26)",
      "suite": { "asset": "QmaGtZfK1wyXb4KXodUSF9uibqY9JwxnPQ6Tnt122ahVoN.png", "derive": [ { "op": "scale", "factor": 0.26 } ], "fallback": "asset:QmaGtZfK1wyXb4KXodUSF9uibqY9JwxnPQ6Tnt122ahVoN.png" } },
    "loadimage_image_77": { "need": "left empty — one reference is the clearest demonstration", "source": "null", "suite": null },
    "loadimage_image_78": { "need": "left empty", "source": "null", "suite": null }
  },
  "keepRuntime": false, "estSec": 32,
  "sources": ["https://huggingface.co/ostris/krea2_turbo_style_reference", "https://huggingface.co/Comfy-Org/Krea-2"] }
```

---

## image_edit_krea2_dynamic_character_sheet

**What the model is good at** (with sources): **DynamicCharacterSheet_krea2_v1** from Alissonerdx' CharacterSheet
collection. It *"generates a full 'entity sheet' — hero pose, turnaround, action poses, silhouette study,
expression/state study, and detail crops — for humans, stylized characters, animals, creatures, robots, vehicles,
and objects"*. It was trained on top of the QuadView LoRA, about 300 character sheets, mainly human. It is
*"highly experimental, and the text generation on the sheet is still far from perfect… consistency between views is
not 100%"*. Best settings: LCM + simple, 10 steps, 1536×1024. A Qwen3-VL node writes the structured
`[TASK: ENTITY_SHEET_GENERATION]` prompt (HF README). The bundle matches all of this (lcm/simple, 10 steps,
1536×1024, VLM prompt). Assessment: "a consistent sheet — with garbled text, and it named her 'Lena'".

**Showcase idea**: **the same full-body character as the QuadView card**, so the two can be compared side by side,
following the suite's "same job, same inputs" rule: a four-view turnaround against a full design page. The
FLUX.3-distilled character was designed for this card's **detail-crop zone**: glasses, copper hair tips, brass
snaps, the tool-belt pouches, red laces and backpack straps are exactly the "identity locks" the VLM is told to list.
The caption is upfront about the documented weakness: the name and labels are invented and may be misspelled.
Defaults are kept (likeness 1, 10 steps, seed 43).

**Inputs**: `loadimage_image_72` — one character, whole body, plain background, with distinctive details. Source:
`output:image_flux3_klein_distilled_t2i` (the same input as QuadView).

**Expected result / how to judge it**: a 1536×1024 sheet with every zone filled: the name column, a big hero ¾ view,
a front/side/back row, three action poses, three black silhouettes, an expression row and six close-up crops. In
every view the jumpsuit is mustard, the belt teal, the backpack coral, and the glasses round. Text: a plausible name
and some misspellings, which are expected.

**Risks**: garbled labels (the author's own warning). The VLM invents a name. A view may drop the backpack. 61 s
warm, most of it the VLM writing the prompt.

**Links to fix**: `DynamicCharacterSheet_krea2_v1.safetensors` has **no source**; CLAUDE.md lists it as
"deliberately unsourced". **Found**:
`https://huggingface.co/Alissonerdx/CharacterSheet/resolve/main/DynamicCharacterSheet_krea2_v1.safetensors`. It is
914,160,184 bytes, identical to the rig's file (verified by HEAD). `Krea2_Turbo_convrot_int8mixed.safetensors` →
`source` `Comfy-Org/Krea-2` is **wrong**: no file of that name or size (12,907,738,804) is there. Real source:
`https://huggingface.co/Winnougan/Krea-2-Base-Turbo-NVFP4-FP8-INT8/resolve/main/Krea2_Turbo_convrot_int8mixed.safetensors`,
size verified. Alternatively, swap to Comfy-Org's `krea2_turbo_int8_convrot.safetensors`, already on disk and used by
the style-reference card; that would free 12.9 GB if the A/B is clean. Add `promptGuides`:
https://huggingface.co/Alissonerdx/CharacterSheet. Template note "Fidelity dial: 4.0 = recommended (pre-set)" comes
from the author's identity-edit workflow. The graph ships 1.0, so the bundle note is misleading; the README frames
4.0 as "much stronger likeness" rather than as the default.

```json
{ "workflow": "image_edit_krea2_dynamic_character_sheet",
  "title": "Make a full character design sheet",
  "summary": "Upload one picture of a character, creature or object and get a whole design page: big hero view, front/side/back, action poses, silhouettes, expressions and close-up details. Nothing to type; the name and labels are invented and may be misspelled.",
  "note": "One photo in, a full design page out: turnaround, action poses, silhouettes, expressions and close-ups of her glasses, tool belt and laces. The name and labels are made up by the model — expect misspellings.",
  "params": {
    "krea2editmodelpatch_ref_boost_120": 1,
    "ksampler_steps_53": 10,
    "ksampler_seed_53": 43
  },
  "inputs": {
    "loadimage_image_72": { "need": "one character, whole body, plain background, with distinctive small details", "source": "output:image_flux3_klein_distilled_t2i", "suite": "output:image_flux3_klein_distilled_t2i" }
  },
  "keepRuntime": false, "estSec": 61,
  "sources": ["https://huggingface.co/Alissonerdx/CharacterSheet", "https://huggingface.co/Winnougan/Krea-2-Base-Turbo-NVFP4-FP8-INT8"] }
```

---

## image_edit_krea2_quadview

**What the model is good at** (with sources): **QuadView_krea2_v1** from the same collection. It converts a character
image *"to a reference sheet with a face close-up plus front, side, and back full-body views… designed to preserve the
character's identity, clothing, proportions"*. Trigger caption (Krea 2): *"Convert the character in the image to a
Character Sheet showing a face close-up, front full body, side full body and back full body views"*. Settings: Krea 2
Turbo, 1536×1024, 10 steps, CFG 1, euler/simple, LoRA 1.0, which is exactly what the bundle runs. The author lists
"LTX identity-reference pipelines" and 3D reference as uses (HF README). Assessment: **"★ face, front, side and back,
consistent — and the input of the multi-view 3D card"**.

**Showcase idea**: **a turnaround of an original character, including the back you never saw.** The input is the
FLUX.3-distilled character, shared with the character-sheet card for comparison. The coral backpack and the tool belt
make the **back view** a real test: the model has to invent the back of the bag and the belt's rear consistently. The
trained sentence is used unchanged, as the card advises; defaults are kept.

**Inputs**: `loadimage_image_72` — one character, whole body, plain background. Source:
`output:image_flux3_klein_distilled_t2i`.

**Expected result / how to judge it**: four panels on 1536×1024. A face close-up with the round tortoiseshell glasses
and copper tips. Front, side and back at matching scale. The back shows the coral backpack and the belt's rear
pouches. Colours are identical across panels.

**Risks**: the side view may flatten the backpack. ⚠ For other groups: Pixal3D multi-view crops this sheet into four
inputs, and the old crop fractions (`[0.34,0,0.565,1]`, …) were measured on the previous character, so **re-measure
them on the new sheet**.

**Links to fix**: `QuadView_krea2_v1.safetensors` has **no source** (CLAUDE.md: "deliberately unsourced"). **Found**:
`https://huggingface.co/Alissonerdx/CharacterSheet/resolve/main/QuadView_krea2_v1.safetensors`, 914,160,176 bytes,
identical (verified). Same `Krea2_Turbo_convrot_int8mixed` fix as the character sheet. The guide link (Krea
prompting.md) is generic; add https://huggingface.co/Alissonerdx/CharacterSheet. The same misleading "4.0 =
recommended (pre-set)" template note applies.

```json
{ "workflow": "image_edit_krea2_quadview",
  "title": "Show a character from four sides",
  "summary": "Upload a picture of one character and get a single sheet with a face close-up and front, side and back views — a quick turnaround for concept art, comics or 3D modelling. About 20 seconds.",
  "note": "From one front photo, the character seen from the side and from behind — the model had to invent the back of her backpack and tool belt, and kept her colours in every panel.",
  "params": {
    "krea2editgroundedencode_prompt_119": "Convert the character in the image to a Character Sheet showing a face close-up, front full body, side full body and back full body views",
    "krea2editmodelpatch_ref_boost_120": 1,
    "ksampler_steps_53": 10,
    "ksampler_seed_53": 42
  },
  "inputs": {
    "loadimage_image_72": { "need": "one character, whole body, plain background", "source": "output:image_flux3_klein_distilled_t2i", "suite": "output:image_flux3_klein_distilled_t2i" }
  },
  "keepRuntime": false, "estSec": 22,
  "sources": ["https://huggingface.co/Alissonerdx/CharacterSheet"] }
```

---

## image_minimax_h3_t2i

**What the model is good at** (with sources): MiniMax H3 is *"a general-purpose, omni-modal generative system…
video with native stereo audio"*, 24 fps, 768p by default, released as CFG-distilled weights (HF README). This card
asks it for **one frame**. The bundle's premise is that a model trained on film is strong at cinematic framing, light
and atmosphere; that is the bundle's claim, not MiniMax's, since MiniMax documents no image mode. H3's prompt guide
opens each shot with a style label (*"Live-action, cinematic, a medium-wide shot frames…"*; also `vintage film`,
`claymation`, `watercolor`) and puts on-screen text in quotes (VIDEO_PROMPT_WRITING_GUIDE_base_en.md). Assessment:
"right composition, saturated, slightly painterly HDR… **works, but owns the card [29.3 GB] for no gain over Qwen or
FLUX**", on an ordinary landscape prompt.

**Showcase idea**: **ask for what only a film model gives**: a frame that looks *pulled from a movie in motion*. That
means motion blur on a passing tram, spray frozen mid-air from a bike wheel, rain streaks, an anamorphic lens flare,
film-stock grain and a teal-and-amber grade, framed **21:9 ultrawide**. This answers the assessment directly: on a
still landscape H3 adds nothing, so the example asks for motion and cinematography, which an image model rarely
renders convincingly. Fast mode stays on (default, 8 steps, 11 s warm). A side benefit: a frame with implied motion
is a natural **first frame for the H3 image-to-video card** (other group).

**Inputs**: none.

**Expected result / how to judge it**: a 21:9 frame (≈1536×656). The tram is a long horizontal streak of
motion-blurred warm windows, while the cyclist stays sharp. Water droplets are frozen in an arc off the front wheel.
Red and teal neon reflects in the wet cobbles. Rain falls as diagonal streaks in the streetlamp. There is a thin blue
horizontal flare. It should read as a film still rather than a photograph.

**Risks**: 29.3 GB, so it owns the GPU (expected; say so in the summary). The HDR-ish saturation the assessment saw.
Neon signs may form letters; no words are asked for, and the prompt says the signs carry only shapes. Cold 30 s
(20 s load).

**Links to fix**: the guide link works, but it is H3's **video** guide; that is fine for its style vocabulary.
Model links all on `Comfy-Org/MiniMax-H3`; not re-checked beyond the guide (reachable).

```json
{ "workflow": "image_minimax_h3_t2i",
  "title": "Make a cinematic film still",
  "summary": "Describe a shot like a film director — lens, light, movement, weather — and get a single frame from a model trained on films: strong at motion blur, rain, flares and mood. It needs the whole graphics card, so it is slow to start.",
  "note": "One frame from a video model: the tram is a streak of motion blur while the cyclist stays sharp, spray hangs in the air, and the widescreen flare and grain make it look like a scene from a film.",
  "params": {
    "prompt_112": "Live-action, cinematic film still in anamorphic widescreen. A low wide shot at night on a rain-soaked tram street in an old European city: in the foreground a cyclist courier in a bright yellow rain cape pedals hard through a deep puddle, an arc of water droplets frozen mid-air off her front wheel, while behind her a passing tram is a long horizontal streak of motion-blurred warm window light. Neon shop signs in red and teal, showing only shapes and no words, reflect in the wet cobblestones; fine rain falls in diagonal streaks lit by a streetlamp at frame-right. The camera sits at puddle level with a 40mm anamorphic lens, shallow depth of field softening the buildings, a thin blue horizontal lens flare across the frame, Kodak Vision3 500T film grain, teal-and-amber colour grade.",
    "fast_mode_200": true,
    "aspect_ratio_79": "21:9 (Ultrawide)",
    "megapixels_79": 1
  },
  "inputs": {},
  "keepRuntime": false, "estSec": 11,
  "sources": ["https://huggingface.co/MiniMaxAI/MiniMax-H3", "https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/docs/VIDEO_PROMPT_WRITING_GUIDE_base_en.md"] }
```

---

## Upstream inputs this group needs

**1. One small infra addition (NEW): `derive` on an asset source.**
`{"asset": "<file in J:\\_assets>", "derive": [ … ]}` should run `derive_input.py` exactly as `{from}` does. Today
`normalizeSpec` returns `{asset}` and never applies derive. It is wanted by:
| run | asset | derive |
|---|---|---|
| `image_edit_flux2_klein_inpaint_prompt` | `agora_ecole_de_design1.jpg` | `transparent rect [0.645,0.865,0.81,1.0]` (**required**; fallback hole on `image_flux3_klein_t2i`) |
| `image_edit_flux2_klein_inpaint_reference` | `0 (1).png` | `transparent ellipse [0.03,0.70,0.24,0.86]` (**required**; fallback hole on `image_flux2_klein_9b_t2i`) |
| `image_edit_flux2_klein_9b_image_edit` | `PXL_20240628_084847386.jpg` | `scale 0.35` (upload-box parity; the raw file still runs) |
| `image_edit_flux2_klein_9b_image_edit_ref` | `bafybei…jpg` | `scale 0.25` (optional) |
| `image_krea2_turbo_style_reference` | `QmaGtZfK…png` | `scale 0.26` (optional) |

**2. From another group (one input):** `image_edit_flux3_klein_distilled_image_edit` needs **frame 0 of whichever
clip the integrator chooses as the shared video-to-video source** (it was `video_ltx2_5_t2v`). The prompt is
content-neutral; a well-lit first frame works best.

**3. No new producer runs are needed.** Inside the group: `image_flux3_klein_distilled_t2i` → QuadView, character
sheet and depth-pose card; `image_flux3_klein_t2i` → FLUX.3 base edit (and the inpaint fallback).

### What this group's producers now output (changed roles — please re-wire other groups)

| producer | used to give | now gives | suggestion for the old consumers |
|---|---|---|---|
| `image_flux2_klein_9b_t2i` | Maren's portrait | a frontal head-and-shoulders portrait of a woman in her sixties (green sweater, mouth closed, plain wall) | still fits every face card (LivePortrait, ia2v talking head, unblur, SeedVR2 4K, Qwen edit) |
| `image_flux3_klein_t2i` | the full-body keeper on grey | a **3:2 overhead breakfast flat-lay** with "LE MATIN" text | a good **upscaler** input: crumbs, grain and small text to judge at 1:1 |
| `image_flux3_klein_distilled_t2i` | the brass lantern on white | **the full-body character on plain grey (2:3)** | the new character input for QuadView, sheet, Qwen angles, TripoSplat, Wan Animate, SCAIL, OmniRef/Pika ref. For the old **lantern** consumers (Pixal3D/TRELLIS 3D, Qwen relight, Qwen 2.1 edit, SeedVR2 7B, OmniRef/Pika prop) use a real product photo: `asset:6504516c0115ed9b83b2d82e1d94c4ec.webp` (a cane armchair on white, 1920² → scale 0.56) or `asset:2f42ec649db902ccf63918f16293bd963dc4d65b_original.jpg` (ski goggles on white) |
| `image_krea2_turbo_t2i_lora` | the ballet dancer (pose source) | an embroidered-textile diorama landscape | for pose/depth consumers (MOSS colour-depth, Qwen depth/canny, SCAIL) use `asset:controlNet_demo_image.jpg`, a real dancer on a plain grey studio floor (640×960) |
| `image_edit_flux2_klein_9b_image_edit` | the stormy-night scene (FL2V last frame, loop reference) | the scale model rendered as a real place | FL2V pair: first = maquette (scaled 0.35), last = this render ("the model comes to life"). The two loop cards need another reference. |
| `image_edit_flux3_klein_distilled_image_edit` | watercolour frame 0 for ID-V2V | **unchanged role** | — |
| `image_edit_krea2_quadview` | four views for Pixal3D multi-view | four views of the new character | **re-measure the crop fractions** on the new sheet |
| `image_minimax_h3_t2i` | the lighthouse scene | a 21:9 cinematic night still with implied motion | optional first frame for `video_minimax_h3_i2v_4step` (crop to 16:9) |

### Link fixes collected (for the meta owner)
- **All 10 FLUX cards**: `flux2-vae.safetensors` url → `https://huggingface.co/Comfy-Org/flux2-dev/resolve/main/split_files/vae/flux2-vae.safetensors` (same 336,213,556 bytes; the current url is a TripoSplat repo).
- `image_edit_flux2_klein_ref_control_depth`: LoRA source → `https://huggingface.co/thedeoxen/refcontrol-FLUX.2-klein-9B-reference-depth-lora/resolve/main/flux2_klein_9b_refcontrol_depth.safetensors` (verified size).
- `image_krea2_turbo_t2i_lora`: realism LoRA → `https://huggingface.co/gokaygokay/Krea-2-Realism-LoRA/resolve/main/krea2_realism_lora.safetensors` (verified size); dropdown lists the style-reference LoRA by mistake.
- `image_edit_krea2_quadview` / `image_edit_krea2_dynamic_character_sheet`: LoRAs → `https://huggingface.co/Alissonerdx/CharacterSheet/resolve/main/<file>` (both sizes verified, so the "deliberately unsourced" pair can leave the exception list in `bundleCompleteness.test.js`). UNET `Krea2_Turbo_convrot_int8mixed` → `https://huggingface.co/Winnougan/Krea-2-Base-Turbo-NVFP4-FP8-INT8/resolve/main/Krea2_Turbo_convrot_int8mixed.safetensors` (verified size).
- FLUX.2 edit guides: `docs.bfl.ai/guides/prompting_editing_single_reference` and `…_multi_reference` are alive but **now document FLUX 3 Image**. Add the FLUX.2 pages `https://docs.bfl.ai/flux_2/flux2_image_editing` and `https://docs.bfl.ai/guides/usecases_editing_drawing_rendering`.
- FLUX.3 cards: no `promptGuides` at all. Propose `https://docs.bfl.ai/guides/prompting_unified_basics`, `https://docs.bfl.ai/guides/prompting_layout`, `https://docs.bfl.ai/flux_3/flux3_image_bounding_boxes`, and for edits `https://docs.bfl.ai/guides/prompting_editing_single_reference`.
- Stale or wrong descriptions: both FLUX.3 edits ("boxes not offered yet", now false); both FLUX.3 t2i (improver described as working; base called "higher-quality", whereas BFL says research build); depth card (prompt "optional" but `refcontrol` is the trigger; LoRA trained on the base model); style reference (3 slots against "1–2" trained, and a stale enhancer system prompt); FLUX.2 edit default prompt (describes a car interior ComfyQ doesn't ship).
