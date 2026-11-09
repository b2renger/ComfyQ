# Showcase feedback, 2026-11-09

One section per result, in suite order. Write after each `=>`. Leave a line empty if
you have nothing to say. For the verdict: **ok**, **redo**, or **remove**.

Results are on the scheduling page under **See an example**, and all of them under
**Admin → Maintenance → Run the whole library**.

## Sound to check first

Nobody has listened to these. Their captions say what to listen for.

- Stable Audio 3 Medium — text to audio
- YuE2 music cover - re-sing a song in a new style
- MiniMax H3 — text to video + audio (4-step turbo)
- FastVideo FastH3 — text to video with sound (8 steps)
- LTX 2.5 — text to video + audio
- Pika H3 Flex — text to video with sound (6 steps)
- MiniMax H3 — image to video + audio (4-step turbo)
- LTX 2.5 — image to video + audio
- MiniMax H3 — transform a video by reference + audio

## 1 — Pictures from words

### 1. Qwen Image 2.1 — text to image

`image_qwen_image_2_1_t2i`

Output: `bench_image_qwen_image_2_1_t2i_1794209918662_00001.png`

Look for: One sentence per object and every word in quotes: all six labels on this desk are written exactly, and each object sits where the prompt put it. It was drawn at the model's native 2K size, so zoom in on the small print.

Verdict =>

Comments =>

### 2. Qwen Image 2.1 - with the community "Fix" LoRA

`image_qwen_image_2_1_t2i_fix`

Output: `bench_image_qwen_image_2_1_t2i_fix_1794210018001_00001.png`

Look for: A close-up is where this card earns its extra time: count the fingers, read the numerals I to XII and the word GENÈVE on the dial. Re-run it with Fix strength at 0 (same seed) to see what the add-on itself changes.

Verdict =>

Comments =>

### 3. Flux2 Klein 9B — text to image

`image_flux2_klein_9b_t2i`

Output: `bench_image_flux2_klein_9b_t2i_1794210079973_00001_.png`

Look for: A photo made from text alone. Look closely at the skin — pores, freckles, fine hairs — and at the sweater, whose colour was given as the code #1F5C4A.

Verdict =>

Comments =>

### 4. FLUX.3 Klein — text to image

`image_flux3_klein_t2i`

Output: `bench_image_flux3_klein_t2i_1794210106330_00001_.png`

Look for: Every object was placed by a box you can see in the layout: open the example's layout over the picture. Notice the three identical cups in a row and the masthead "LE MATIN" exactly where its box was drawn.

Verdict =>

Comments =>

### 5. FLUX.3 Klein distilled — fast text to image

`image_flux3_klein_distilled_t2i`

Output: `bench_image_flux3_klein_distilled_t2i_1794210166906_00001_.png`

Look for: A full-body studio photo made in about 7 seconds from a detailed description: medium first, then the light, then the person head to toe. The same character is turned around and posed by other example cards.

Verdict =>

Comments =>

### 6. Krea-2 Turbo — text to image (+ style LoRA)

`image_krea2_turbo_t2i_lora`

Output: `bench_image_krea2_turbo_t2i_lora_1794210189619_00001_.png`

Look for: The prompt only describes a cable car over a valley; the "embroidered textile diorama" style was picked from the list, and the card added its words by itself. Look for stitches, felt and thread everywhere.

Verdict =>

Comments =>

### 7. MiniMax H3 — text to image

`image_minimax_h3_t2i`

Output: `bench_image_minimax_h3_t2i_1794210242447_00001_.png`

Look for: One frame from a video model: the tram is a streak of motion blur while the cyclist stays sharp, spray hangs in the air, and the widescreen flare and grain make it look like a scene from a film.

Verdict =>

Comments =>

### 8. MOSS-Image SFT — text to image, with an optional box layout

`image_moss_image_t2i`

Output: `bench_image_moss_image_t2i_1794210307884_00001_.png`

Look for: Three boxes on a 3:2 canvas: the Chinese title, a two-line English tagline that breaks exactly where the line break was typed, and the cup on the right. Read both languages, then check each lands in its box.

Verdict =>

Comments =>

### 9. MOSS-Image Base — text to image, with an optional box layout

`image_moss_image_base_t2i`

Output: `bench_image_moss_image_base_t2i_1794210355835_00001_.png`

Look for: Five panels placed with boxes — a face, a pocket watch, the same man from the front and from behind, his workshop — tiled edge to edge with no words, the way ComfyUI's own example sheet is laid out: a character reference sheet, ready for the card that turns a sheet into a video.

Verdict =>

Comments =>

### 10. Qwen-Image 2512 — 360° panorama / HDRI from a description

`image_qwen_image_2512_360_panorama`

Output: `bench_image_qwen_image_2512_360_panorama_1794210398472_00001.exr`, `bench_image_qwen_image_2512_360_panorama_1794210398472_00002.png`

Look for: Press View in 360° and turn around: the farmhouse, the cypresses, the olive tree and the hills are all around you, lit by the same low golden sun, and the left and right edges join without a seam.

Verdict =>

Comments =>

### 11. Qwen Image 2.1 - draw from edges (ControlNet canny)

`image_qwen_image_2_1_control_canny`

Output: `bench_image_qwen_image_2_1_control_canny_1794210478695_00001.png`

Look for: A child's flat colour drawing went in; out came a photographed felt doll with the same huge pigtails, outstretched arms, hill and two clouds, line for line. Compare the outline of the hair with the drawing.

Verdict =>

Comments =>

### 12. Qwen Image 2.1 - draw from depth (ControlNet depth)

`image_qwen_image_2_1_control_depth`

Output: `bench_image_qwen_image_2_1_control_depth_1794210535654_00001.png`

Look for: A phone photo of a student's park maquette (cardboard, figurines, flock grass) became a real open-air concert: the crowd, the little stage, the cube seats and the pine tree are where the model put them. This is how a maquette can be previewed as the real place.

Verdict =>

Comments =>

### 13. MOSS-Image — new picture from a photo's pose and depth

`image_moss_image_color_depth_control`

Output: `bench_image_moss_image_color_depth_control_1794210574092_00001_.png`

Look for: A young dancer in a grey studio became an old gentleman dancing in a Paris street at night - the raised fist, the arm swinging down and the bent knees are exactly the photo's. Everything else came from the prompt.

Verdict =>

Comments =>

### 14. Krea 2 Turbo — generate in the style of 1–2 pictures

`image_krea2_turbo_style_reference`

Output: `bench_image_krea2_turbo_style_reference_1794210629745_00001_.png`

Look for: The reference was an orange watercolour stain on paper; the prompt asked for a heron. You get a heron, painted in that watercolour — the look moved over, the leaf shape didn't.

Verdict =>

Comments =>

### 15. Ideogram 4.0 — text to image

`image_ideogram4_t2i`

Output: `bench_image_ideogram4_t2i_1794210678280_00001_.png`

Look for: Five boxes, five colours: every word, accents included (DIPLÔMES, ENTRÉE), is spelled exactly and sits in its box, and only the chosen colours appear. Open the prompt in Compose visually to see the layout that made it.

Verdict =>

Comments =>

## 2 — Editing a picture

### 16. FLUX.3 Klein — edit a picture

`image_edit_flux3_klein_image_edit`

Output: `bench_image_edit_flux3_klein_image_edit_1794210738914_00001_.png`

Look for: Three identical cups, but the box picked one: only the centre cup turned cobalt blue. The words could match every cup — the box says which.

Verdict =>

Comments =>

### 17. FLUX.3 Klein distilled — fast picture edit

`image_edit_flux3_klein_distilled_image_edit`

Output: `bench_image_edit_flux3_klein_distilled_image_edit_1794210830907_00001_.png`

Look for: The first frame of a video, repainted as a watercolour in about 12 seconds: the wall, the gravel and the trees are painted, but the dancer stayed photographic. The side-by-side ID-V2V card uses this frame as its style guide, flaw included.

Verdict =>

Comments =>

### 18. Flux2 Klein 9B — image edit

`image_edit_flux2_klein_9b_image_edit`

Output: `bench_image_edit_flux2_klein_9b_image_edit_1794210860421_00001_.png`

Look for: A daytime photo of the school's atrium, turned into the same room at night with string lights. Compare the two: every staircase, balcony, table and chair is exactly where it was — the light, the time of day and the mood are new.

Verdict =>

Comments =>

### 19. Flux2 Klein 9B — image edit (with reference)

`image_edit_flux2_klein_9b_image_edit_ref`

Output: `bench_image_edit_flux2_klein_9b_image_edit_ref_1794210917985_00001_.png`

Look for: The whale painting (picture 2) was painted as a mural onto the pink building (picture 1). Check that the building, its windows and the taxi stayed as they were.

Verdict =>

Comments =>

### 20. Flux2 Klein 9B — inpaint (paint & prompt)

`image_edit_flux2_klein_inpaint_prompt`

Output: `bench_image_edit_flux2_klein_inpaint_prompt_1794210976744_00001_.png`

Look for: The grey sofa in a photo of the school's atrium was painted over and described as a mustard velvet sofa. Beyond a thin blended edge around the painted area, the picture is untouched.

Verdict =>

Comments =>

### 21. Flux2 Klein 9B — inpaint with reference (paint & insert)

`image_edit_flux2_klein_inpaint_reference`

Output: `bench_image_edit_flux2_klein_inpaint_reference_1794211003071_00001_.png`

Look for: A dragonfly brooch (the second picture) was pinned onto her lapel, only inside the painted spot. Her face and pearls are exactly the original pixels.

Verdict =>

Comments =>

### 22. Flux2 Klein 9B — reference + depth control (pose transfer)

`image_edit_flux2_klein_ref_control_depth`

Output: `bench_image_edit_flux2_klein_ref_control_depth_1794211021357_00001_.png`

Look for: Same young woman, same outfit — but in the pose of a real dancer from a second photo. Compare her arms and legs with the dancer's.

Verdict =>

Comments =>

### 23. Krea 2 Turbo — dynamic character sheet (auto-prompt)

`image_edit_krea2_dynamic_character_sheet`

Output: `bench_image_edit_krea2_dynamic_character_sheet_1794211041865_00001_.png`

Look for: One photo in, a full design page out: turnaround, action poses, silhouettes, expressions and close-ups of her glasses, tool belt and laces. The name and labels are made up by the model — expect misspellings.

Verdict =>

Comments =>

### 24. Krea 2 Turbo — QuadView character turnaround (4 panels)

`image_edit_krea2_quadview`

Output: `bench_image_edit_krea2_quadview_1794211123072_00001_.png`

Look for: From one front photo, the character seen from the side and from behind — the model had to invent the back of her backpack and tool belt, and kept her colours in every panel.

Verdict =>

Comments =>

### 25. Qwen Image 2.1 — image edit with references

`image_qwen_image_2_1_image_edit`

Output: `bench_image_qwen_image_2_1_image_edit_1794211160864_00001.png`

Look for: Coloured circles say WHERE, the extra pictures say WHAT: the ski goggles from picture 2 replaced the glasses in the red circle, the dragonfly brooch from picture 3 is pinned in the blue one, and the green one was changed from words alone. Her face, hair and the background are untouched.

Verdict =>

Comments =>

### 26. Qwen Image 2.1 — relight a composite (blend an object into a background)

`image_edit_qwen_2_1_relight_composite`

Output: `bench_image_edit_qwen_2_1_relight_composite_1794211210157_00001.png`

Look for: The input was a studio photo of a chair crudely pasted under an oak, white blobs at its feet; the result puts it in the tree's backlit shade with a real shadow on the grass. Compare the chair's lighting and its feet before and after.

Verdict =>

Comments =>

### 27. Wan 2.2 Bernini-R — AI image editing

`image_edit_bernini_r_image_editing`

Output: `bench_image_edit_bernini_r_image_editing_1794211241858_00001_.png`, `node 76:57:1`

Look for: One instruction removed a giant bouquet of daisies from a roof and rebuilt the sky and roofline behind it; the building, the taxi and the street did not move. Write it like this: what to delete, what to fill the gap with, and what must not change.

Verdict =>

Comments =>

### 28. Wan 2.2 Bernini-R — image editing with a reference image

`image_edit_bernini_r_image_editing_with_reference`

Output: `bench_image_edit_bernini_r_image_editing_with_reference_1794211306026_00001_.png`, `node 76:57:1`

Look for: The yellow taxi was swapped for the red sports car from the reference picture, parked in the same spot under the same sun; the pink building and the street are unchanged. Ask it to replace something - asked to copy a style, this card makes collages.

Verdict =>

Comments =>

### 29. Qwen Image-Edit 2511 - reshoot from another angle (place the camera)

`image_edit_qwen_2511_multiple_angles`

Output: `bench_image_edit_qwen_2511_multiple_angles_1794211334386_00001_.png`

Look for: Only the front of this clay figurine was photographed; the camera was moved behind it. Notice the back of the tunic and belt, the heels of the boots and the sword strapped across his back - none of it was in the photo, all of it matches the clay.

Verdict =>

Comments =>

## 3 — Enlarging, 3D, sound and captions

### 30. Unblur & upscale a photo (Qwen Image Edit 2511)

`utility_qwen_2511_unblur_upscale`

Output: `bench_utility_qwen_2511_unblur_upscale_1794211388306_00001_.png`

Look for: A small, soft scan of an old black-and-white portrait comes back crisp. Compare the face with the original picture (Woman.png): it should still be the same person, because that is what this card is trained to keep.

Verdict =>

Comments =>

### 31. PiD — image upscale ×4 (up to 33 MP)

`utility_pid_image_upscale`

Output: `bench_utility_pid_image_upscale_1794211451934_00001_.png`

Look for: A clean 1184×888 picture (the Qwen text-to-image card's flat lay, halved) made 4 times wider and taller without changing it. Zoom to 100% on small details and edges: they stay faithful instead of being re-invented.

Verdict =>

Comments =>

### 32. SeedVR2 — image upscale to 4K

`utility_seedvr2_4k_upscale`

Output: `bench_utility_seedvr2_4k_upscale_1794211482147_00001_.png`

Look for: A noisy, blocky 1024-pixel phone photo of a cat rebuilt at 4096 pixels. Zoom into the fur, the whiskers and the eyes and compare with the input; the faster SeedVR2 card got exactly the same picture.

Verdict =>

Comments =>

### 33. SeedVR2 7B (int8) — image upscale & restore (up to 4K)

`utility_seedvr2_7b_int8_image_upscale`

Output: `bench_utility_seedvr2_7b_int8_image_upscale_1794211588752_00001_.png`

Look for: The same damaged cat photo as the 4K card, rebuilt 4 times bigger in about half the time. Compare the fur and whiskers of both results with the input to see what the speed costs.

Verdict =>

Comments =>

### 34. Pixal3D / TRELLIS.2 (built-in nodes) — image to PBR-textured 3D model

`3d_pixal3d_trellis2_image_to_model`

Output: `bench_3d_pixal3d_trellis2_image_to_model_1794211648786_00001.glb`

Look for: One product photo of a design-classic cane chair turned into a textured 3D model. Spin it and check the four legs, the A-shaped side frames and the woven cane on the seat and back.

Verdict =>

Comments =>

### 35. Remesh & decimate - 3D model to clean low-poly

`3d_mesh_remesh_decimate`

Output: `bench_3d_mesh_remesh_decimate_1794211795355_00001_.glb`, `node 8`, `node 15`

Look for: The 700,000-triangle chair from the picture-to-3D card rebuilt as a clean, closed 10,000-triangle model. Read the BEFORE and AFTER panels, then spin it to see what the reduction kept.

Verdict =>

Comments =>

### 36. UV unwrap & bake AO - prepare a model for texturing

`3d_mesh_uv_unwrap`

Output: `bench_3d_mesh_uv_unwrap_1794211805633_00001_.glb`, `bench_3d_mesh_uv_unwrap_1794211805633_00002_.png`, `bench_3d_mesh_uv_unwrap_1794211805633_00003_.png`

Look for: The low-poly chair unwrapped. The colourful image shows how its surface was cut into flat pieces; the grey map shows the soft shadows baked into its joints, ready for texturing.

Verdict =>

Comments =>

### 37. TripoSplat — image to 3D

`3d_triposplat_image_to_gaussian_splat`

Output: `bench_3d_triposplat_image_to_gaussian_splat_1794211853152_00001_.ply`, `bench_3d_triposplat_image_to_gaussian_splat_1794211853152_00002_.glb`, `bench_3d_triposplat_image_to_gaussian_splat_1794211853152_00003_.spz`

Look for: A paper-craft tree turned into a 3D 'splat' in seconds: as you spin it, the soft see-through paper leaves keep their colours. Switch to the mesh to see what a solid surface loses.

Verdict =>

Comments =>

### 38. Pixal3D Multi-View — 4 views to PBR-textured 3D model

`3d_pixal3d_multi_views`

Output: `bench_3d_pixal3d_multi_views_1794211884645_00001.glb`

Look for: Four views of one character (front, two sides, back), made by the quadview card from a single picture, built into one textured 3D model. Spin it round: the back matches the back view it was given.

Verdict =>

Comments =>

### 39. Stable Audio 3 Medium — text to audio

`audio_stable_audio_3_medium`

Output: `bench_audio_stable_audio_3_medium_1794211969608_00001.mp3`, `node 52:42`

⚠ The automatic check flagged it: clipping

Look for: A full 2½-minute gypsy-jazz instrumental from one written description. Listen for the instruments the prompt asks for: the soloing guitar, the chugging rhythm guitar, the violin and the double bass.

Verdict =>

Comments =>

### 40. YuE2 music cover - re-sing a song in a new style

`audio_yue2_music_cover`

Output: `bench_audio_yue2_music_cover_1794211994315_00001.flac`

Look for: ComfyUI's own example song (upbeat indie pop, female voice) sung again as bluegrass by a male voice, Listen for the same words and the same tune: play both one after the other and hum along.

Verdict =>

Comments =>

### 41. Gemma 4 — describe an image (caption)

`describe_gemma4_image_description`

Output: `node 4`

Look for: Gemma reads the poster made by the Ideogram card. It copies every line of text exactly, translates it, describes the design and writes a prompt to recreate it. Check its spelling against the poster.

Verdict =>

Comments =>

## 4 — Making a video

### 42. MiniMax H3 — text to video + audio (4-step turbo)

`video_minimax_h3_t2v_turbo`

Output: `bench_video_minimax_h3_t2v_turbo_1794212158551_00001_.mp4`

Look for: One paragraph of text became both the picture and the drumming, at the same time. Listen with the sound on, for each boom and clang landing on a stick hit you can see.

Verdict =>

Comments =>

### 43. FastVideo FastH3 — text to video with sound (8 steps)

`video_fastvideo_fasth3_t2v`

Output: `bench_video_fastvideo_fasth3_t2v_1794212247106_00001_.mp4`

Look for: Ten seconds, three shots and a narrator, all from one prompt. Notice where the cuts fall (about 4 and 7.5 seconds, as written) and listen for the voice-over and the music, generated with the pictures.

Verdict =>

Comments =>

### 44. LTX 2.5 — text to video + audio

`video_ltx2_5_t2v`

Output: `bench_video_ltx2_5_t2v_1794212387691_00001_.mp4`

Look for: One prompt, two shots: a wide shot of the food truck, then a hard cut to a close-up as she orders. Notice that the same woman and jacket carry across the cut, and the neon word "TACOS". Listen for her spoken line.

Verdict =>

Comments =>

### 45. Pika H3 Flex — text to video with sound (6 steps)

`video_pika_h3_flex_t2v`

Output: `bench_video_pika_h3_flex_t2v_1794212498621_00001_.mp4`

Look for: Three shots and two characters, all from one prompt. Watch the cuts land where the prompt asked (about 2 and 3.5 seconds), read the chalkboard, and listen for the two lines of dialogue and the little accordion tune.

Verdict =>

Comments =>

### 46. MiniMax H3 — image to video + audio (4-step turbo)

`video_minimax_h3_i2v_4step`

Output: `bench_video_minimax_h3_i2v_4step_1794212693811_00001_.mp4`

Look for: A still photo from the 1950s turns to you and speaks. Listen for the French line and the laugh, both made from one line of text, against the lips. Notice that the earring, the jacket and the black-and-white look never change.

Verdict =>

Comments =>

### 47. LTX 2.5 — image to video + audio

`video_ltx2_5_i2v`

Output: `bench_video_ltx2_5_i2v_1794212754075_00001_.mp4`

Look for: A still claymation portrait wakes up: she opens her eyes and speaks a line, and the clay look holds in every frame. Listen for the voice, the birds and the breeze, all made from the prompt.

Verdict =>

Comments =>

### 48. FastVideo FastH3 — video with sound, from a first and/or last frame (8 steps)

`video_fastvideo_fasth3_i2v`

Output: `bench_video_fastvideo_fasth3_i2v_1794212865097_00001_.mp4`

Look for: Only the finished poster was given, as the LAST frame: the model invented the build-up and lands exactly on the design. Pause on the final frame — the title is the original, letter for letter.

Verdict =>

Comments =>

### 49. LTX 2.5 — first & last frame to video + audio

`video_ltx2_5_flf2v`

Output: `bench_video_ltx2_5_flf2v_1794212973982_00001_.mp4`

Look for: Both ends are fixed pictures — the real rooftop photo and a sunset-cliff version of the very same frame — and the model invents the gust of wind that carries him from one to the other.

Verdict =>

Comments =>

### 50. Pika H3 Flex — first / last frame to video with sound (6 steps)

`video_pika_h3_flex_fl2va`

Output: `bench_video_pika_h3_flex_fl2va_1794213117034_00001_.mp4`

Look for: Two still pictures — before and after — and the model filmed the transformation in between: the roof bursts into giant daisies while the taxi and the street stay exactly where they were.

Verdict =>

Comments =>

### 51. FastVideo FastH3 OmniRef — video with sound from reference pictures (8 steps)

`video_fastvideo_fasth3_omniref_r2v`

Output: `bench_video_fastvideo_fasth3_omniref_r2v_1794213343093_00001_.mp4`

Look for: The inventor and the jewelled dragonfly come from two separate pictures; the model kept both looks and invented the scene, the flight, her line and every sound. Compare her hair and goggles, and the dragonfly's wings, with the two pictures.

Verdict =>

Comments =>

### 52. Pika H3 Flex — reference pictures to video with sound (6 steps)

`video_pika_h3_flex_ref2va`

Output: `bench_video_pika_h3_flex_ref2va_1794213444801_00001_.mp4`

Look for: A product photo of a chair and a photo of the school atrium became a three-shot furniture commercial. Check that it is the same chair from every angle, and that the cuts fall on the beat.

Verdict =>

Comments =>

### 53. MiniMax H3 — seamless looping video with sound

`video_minimax_h3_seamless_loop`

Output: `bench_video_minimax_h3_seamless_loop_1794213657932_00001_.mp4`

Look for: Set this clip to repeat and try to spot where it restarts: the breathing and the drifting dust carry straight on. That is what this card is for — a loop whose restart is close to seamless, made from one paragraph of text; look closely and a small jump can be spotted. (The purr the prompt asks for came out very faint — turn the sound up.)

Verdict =>

Comments =>

### 54. FastH3-Omni — seamless looping video with sound (8 steps)

`video_minimax_h3_seamless_loop_fasth3`

Output: `bench_video_minimax_h3_seamless_loop_fasth3_1794213941006_00001_.mp4`

Look for: One still picture became a world that moves forever: the creatures bob and breathe, and it repeats, with a small jump you can see at the join. Compare it with the picture: the moss terraces, the pink bubble creatures and the balloon-like organisms all come from it; the tall blue crystals are the prompt's addition.

Verdict =>

Comments =>

### 55. Wan 2.2 — key-frame animation (4 frames to video)

`video_wan22_4_key_frames`

Output: `bench_video_wan22_4_key_frames_1794214246584_00001_.mp4`

Look for: Four quick marker sketches of a capoeira kick, photographed on paper, became the key frames; the card drew every pose in between. Watch the leg sweep out between drawings 2 and 3 — that motion was never drawn, only described.

Verdict =>

Comments =>

### 56. LTX 2.3 — image + audio to video (auto-prompt)

`video_ltx2_3_ia2v_iclora`

Output: `bench_video_ltx2_3_ia2v_iclora_1794214338449_00001_.mp4`

Look for: A recorded voice drives a steampunk character: her lips, eyebrows and head follow the speech for nine seconds, and the workshop behind her stays put because the prompt describes the picture's own setting.

Verdict =>

Comments =>

### 57. LTX 2.3 IC-LoRA — reference sheet to video (ingredients + audio)

`video_ltx2_3_ic_lora_ingredients`

Output: `bench_video_ltx2_3_ic_lora_ingredients_1794214533883_00001_.mp4`

Look for: One sheet — the clockmaker, his watch and his workshop, tiled edge to edge — and a scene description: he opens the watch at his bench under the green lamp, lifts it and smiles, and his face, spectacles and apron, the watch and the wall of clocks all match the sheet. Look past his shoulder: a small copy of the full-body panel stands in the room — the sheet still shows through. (A first sheet with panels floating on black came back as itself; the layout is what made the difference.)

Verdict =>

Comments =>

### 58. LivePortrait — animate a portrait from a driving video

`video_liveportrait_image2video`

Output: `bench_video_liveportrait_image2video_1794214654625_00001.mp4`, `bench_video_liveportrait_image2video_1794214654625_00001.png`, `node 78`, `node 181`, and 1 more

Look for: A painted portrait driven by a video of someone pulling faces: every eye dart, frown and grimace is copied onto the painting, while its brushwork, its cracks and its dark background stay as they were.

Verdict =>

Comments =>

## 5 — Editing a video

### 59. MiniMax H3 ControlNet (canny) — restyle a video from its outlines + audio

`video_edit_minimax_h3_fun_controlnet_canny`

Output: `bench_video_edit_minimax_h3_fun_controlnet_canny_1794214676140_00001_.mp4`

Look for: Every check on her dress, every stripe on her tights and every square in the wall is still where it was in the real footage — now sculpted in clay. That precision comes from following the clip's outlines.

Verdict =>

Comments =>

### 60. MiniMax H3 ControlNet (depth) — restyle a video from its 3D layout + audio

`video_edit_minimax_h3_fun_controlnet_depth`

Output: `bench_video_edit_minimax_h3_fun_controlnet_depth_1794214892833_00001_.mp4`

Look for: A grey, untextured 3D render of a cargo ship became a knitted toy ship on a sea of yarn. The shapes and the camera move are the render's; every surface, colour and sound is new.

Verdict =>

Comments =>

### 61. MiniMax H3 ControlNet (pose) — transfer a person's movement + audio

`video_edit_minimax_h3_fun_controlnet_union`

Output: `bench_video_edit_minimax_h3_fun_controlnet_union_1794215091335_00001_.mp4`

Look for: The moves are the rooftop dancer's — everything else is new: an astronaut dancing on the Moon. Compare with the 'edit a video, sound and all' card, which kept his rooftop and swapped only the dancer.

Verdict =>

Comments =>

### 62. MiniMax H3 — restyle a seamless loop (ControlNet) with sound

`video_edit_minimax_h3_loop_restyle`

Output: `bench_video_edit_minimax_h3_loop_restyle_1794215318470_00001_.mp4`

Look for: The input was a plain grey depth animation of a corridor; the result is an endless flight through a torch-lit stone temple. Set it to repeat: you fly forward forever, because the motion came from a loop.

Verdict =>

Comments =>

### 63. MiniMax H3 — transform a video by reference + audio

`video_edit_minimax_h3_v2v_video_reference`

Output: `bench_video_edit_minimax_h3_v2v_video_reference_1794215531550_00001_.mp4`

Look for: Same rooftop, same handheld camera, same dance — only the dancer changed, into a knight. Listen for his armour clanking on each move. Compare with the pose card's example from the same clip, which keeps only the moves.

Verdict =>

Comments =>

### 64. LTX 2.5 IC-LoRA — video to video (canny edges + audio)

`video_edit_ltx2_5_iclora_canny_control`

Output: `bench_video_edit_ltx2_5_iclora_canny_control_1794215989456_00001_.mp4`

Look for: The grey 3D render's outlines are traced and kept, so every container in the stack becomes a toy brick in exactly the same place, and the camera move is unchanged.

Verdict =>

Comments =>

### 65. LTX 2.5 IC-LoRA — video to video (pose control + audio)

`video_edit_ltx2_5_iclora_pose_control`

Output: `bench_video_edit_ltx2_5_iclora_pose_control_1794216191007_00001_.mp4`

Look for: Only the dancer's skeleton is kept: a knight in a castle hall performs the same moves. Compare with the depth card's example on the same clip, where the rooftop survives.

Verdict =>

Comments =>

### 66. LTX 2.5 IC-LoRA — video to video (depth control + audio)

`video_edit_ltx2_5_iclora_union_control`

Output: `bench_video_edit_ltx2_5_iclora_union_control_1794216289776_00001_.mp4`

Look for: The dancer's video plus one clay-restyled first frame: the whole rooftop turns into claymation, keeping its depth, its positions and every move.

Verdict =>

Comments =>

### 67. LTX 2.3 3DReal — rough 3D render to photoreal (render-guided + audio)

`video_edit_ltx2_3_3dreal_vid2vid`

Output: `bench_video_edit_ltx2_3_3dreal_vid2vid_1794216379477_00001_.mp4`

Look for: A grey blockout render and one photoreal still of its first frame become a ship ploughing through a storm, with the render's exact camera move and cut.

Verdict =>

Comments =>

### 68. Wan 2.2 Bernini-R — AI video editing

`video_edit_bernini_r_video_editing`

Output: `bench_video_edit_bernini_r_video_editing_1794216523814_00001_.mp4`, `node 76:57:1`

Look for: One sentence turned the cream sweater bright red. Compare with the original: the face, the hair, the grass, the sky and every movement are the same, and only the sweater changed — almost: on the raised arm the black under-sleeve turned red with it, which is where an edit like this tends to bleed.

Verdict =>

Comments =>

### 69. Wan 2.2 Bernini-R — video editing with a reference image

`video_edit_bernini_r_video_editing_with_reference`

Output: `bench_video_edit_bernini_r_video_editing_with_reference_1794216899288_00001_.mp4`, `node 76:57:1`

Look for: Same clip as the 'change one thing' card, but this time the new clothes come from a photo: the jacket and plaid shirt of another dancer. The face, hair, grass and sky stay the same — only the outfit is swapped.

Verdict =>

Comments =>

### 70. Wan 2.2 Bernini-R — video editing with reference (auto-prompt)

`video_edit_bernini_r_video_editing_ref_autoprompt`

Output: `bench_video_edit_bernini_r_video_editing_ref_autoprompt_1794217272851_00001_.mp4`, `node 117:57:1`

Look for: The dance comes from the video, the dancer and the glass-flower field come from one picture, and nobody typed a prompt: an assistant looked at both and wrote the instruction itself. The moves are followed loosely — the arm sweeps, not the exact steps — because a reference picture pulls harder than the video.

Verdict =>

Comments =>

### 71. SCAIL-2 (Wan 2.1) — character replacement in video

`video_edit_wan21_scail2_character_replacement`

Output: `bench_video_edit_wan21_scail2_character_replacement_1794217675025_00001_.mp4`

Look for: The rooftop, the chimney, the sky and every dance move come from the video; the dancer now is the woman from the picture. Compare with the 'give a character a video's moves' card: it got the same two inputs and carried the moves into the picture's own setting instead.

Verdict =>

Comments =>

### 72. Wan Animate 2 — make a character perform a video's motion

`video_edit_wan_animate2`

Output: `bench_video_edit_wan_animate2_1794218008588_00001_.mp4`

Look for: Same picture and same dance as the 'replace a person' card — but here the moves are carried into the PICTURE: she dances the rooftop dancer's moves in front of her own concrete wall, and the beach asked for in the prompt only shows as palm trees on the right. A full-frame picture brings its background with it.

Verdict =>

Comments =>

### 73. Wan 2.1 ID-V2V — restyle a video from one keyframe (comparison view)

`video_edit_wan_idv2v_restyle_compare`

Output: `bench_video_edit_wan_idv2v_restyle_compare_1794218197847_00001.mp4`, `bench_video_edit_wan_idv2v_restyle_compare_1794218197847_00001.png`

Look for: The first frame was repainted as watercolour by the "Edit a picture in seconds" card; this card carries that look through the whole dance and shows the result beside the original. It copies the frame faithfully, flaw included: the edit painted the wall but left the dancer photographic, and so does every frame. A better first frame is the lever.

Verdict =>

Comments =>

### 74. Wan 2.1 ID-V2V — restyle a video from one keyframe

`video_edit_wan_idv2v_restyle_hires`

Output: `bench_video_edit_wan_idv2v_restyle_hires_1794218284004_00001.mp4`, `bench_video_edit_wan_idv2v_restyle_hires_1794218284004_00001.png`

Look for: The same clip as the side-by-side card, but a different painted first frame — a gouache painting in which the dancer is painted too — rendered clean and larger. Here she stays painted in every frame, and the brush texture on the wall and on her plaid is what the extra size buys. Put the two examples side by side: the first frame decides the look.

Verdict =>

Comments =>

### 75. LTX 2.5 — 2× generative video upscale (keeps original audio)

`utility_ltx2_5_video_deblur_upscale`

Output: `bench_utility_ltx2_5_video_deblur_upscale_1794218467625_00001_.mp4`

Look for: The 480p clip from the fast text-to-video card, redrawn at 960p: compare edges, faces and textures at the same size, and notice that the soundtrack is the original one.

Verdict =>

Comments =>

### 76. SeedVR2 — video upscale to HD (1080p)

`utility_seedvr2_hd_upscale`

Output: `bench_utility_seedvr2_hd_upscale_1794218673568_00001_.mp4`

Look for: A soft, blocky 540p clip of a dancer in tall grass rebuilt at 1080p: the compression blocks are gone and the frayed threads, the hair and the grass stalks are crisp again. What the copy had lost completely — the ribbing of the sweater — is not invented back. The ×2 video card got exactly the same clip.

Verdict =>

Comments =>

### 77. SeedVR2 3B (int8) — video upscale & restore

`utility_seedvr2_3b_int8_video_upscale`

Output: `bench_utility_seedvr2_3b_int8_video_upscale_1794218761915_00001_.mp4`

Look for: The same damaged 540p clip as the 1080p card, enlarged twice with colour matching on. Compare the two results side by side: same job, two builds of the same model.

Verdict =>

Comments =>

### 78. Frame interpolation (FILM) — smoother or slow-motion video

`utility_video_frame_interpolation`

Output: `bench_utility_video_frame_interpolation_1794218849229_00001_.mp4`

Look for: Two seconds of a fast rooftop dance turned into eight seconds of smooth slow motion. The card invents three new frames between every pair, so the arm swings glide instead of jumping.

Verdict =>

Comments =>

### 79. SAM3 — text-prompted video segmentation

`utility_video_segment_sam3`

Output: `bench_utility_video_segment_sam3_1794218866809_00001_.mp4`

Look for: Typing only 'black leather jacket' cuts that one garment out of five seconds of dancing. The jacket is white; everything else (her face, the plaid shirt under it, the striped leggings, the building) is black. Look closely: the sleeves are mostly missed and the matte breaks up in the last second, as the jacket turns — a text-prompted matte is a fast starting point, not a finished rotoscope.

Verdict =>

Comments =>

### 80. Gemma 4 — describe a video (caption)

`describe_gemma4_video_description`

Output: `node 4`

Look for: Gemma looks at one frame in every 24 of the key-frame video (this clip is 16 fps, so about one every 1.5 s) and writes a timed log; its times count those frames, so they are real seconds only for a 24 fps clip. Compare its timeline with the four pictures the video was made from.

Verdict =>

Comments =>

## 6 — Comparisons: one input, several cards

### 81. Qwen Image 2.1 — text to image (compare)

`image_qwen_image_2_1_t2i@compare`

Output: `bench_image_qwen_image_2_1_t2i_1794218938895_00001.png`

Look for: Same prompt, size and card family as the Fix run: the owner plans to keep one of the two.

Verdict =>

Comments =>

### 82. Qwen Image 2.1 - with the community "Fix" LoRA (compare)

`image_qwen_image_2_1_t2i_fix@compare`

Output: `bench_image_qwen_image_2_1_t2i_fix_1794218981366_00001.png`

Look for: Same prompt, size and card family as the plain run.

Verdict =>

Comments =>

### 83. LTX 2.5 — text to video + audio (compare)

`video_ltx2_5_t2v@compare`

Output: `bench_video_ltx2_5_t2v_1794219043373_00001_.mp4`

Look for: The lighthouse keeper, on the four text-to-video cards.

Verdict =>

Comments =>

### 84. FastVideo FastH3 — text to video with sound (8 steps) (compare)

`video_fastvideo_fasth3_t2v@compare`

Output: `bench_video_fastvideo_fasth3_t2v_1794219141854_00001_.mp4`

Look for: The lighthouse keeper, on the four text-to-video cards.

Verdict =>

Comments =>

### 85. MiniMax H3 — text to video + audio (4-step turbo) (compare)

`video_minimax_h3_t2v_turbo@compare`

Output: `bench_video_minimax_h3_t2v_turbo_1794219246845_00001_.mp4`

Look for: The lighthouse keeper, on the four text-to-video cards.

Verdict =>

Comments =>

### 86. Pika H3 Flex — text to video with sound (6 steps) (compare)

`video_pika_h3_flex_t2v@compare`

Output: `bench_video_pika_h3_flex_t2v_1794219316330_00001_.mp4`

Look for: The lighthouse keeper, on the four text-to-video cards.

Verdict =>

Comments =>

### 87. LTX 2.5 — first & last frame to video + audio (compare)

`video_ltx2_5_flf2v@compare`

Output: `bench_video_ltx2_5_flf2v_1794219495724_00001_.mp4`

Look for: One picture pair, on the three first-and-last-frame cards.

Verdict =>

Comments =>

### 88. Pika H3 Flex — first / last frame to video with sound (6 steps) (compare)

`video_pika_h3_flex_fl2va@compare`

Output: `bench_video_pika_h3_flex_fl2va_1794219624652_00001_.mp4`

Look for: One picture pair, on the three first-and-last-frame cards. The same run as the card's example, kept here so the three sit together.

Verdict =>

Comments =>

### 89. FastVideo FastH3 — video with sound, from a first and/or last frame (8 steps) (compare)

`video_fastvideo_fasth3_i2v@compare`

Output: `bench_video_fastvideo_fasth3_i2v_1794219848177_00001_.mp4`

Look for: One picture pair, on the three first-and-last-frame cards.

Verdict =>

Comments =>

## 7 — Options: what a default run never reaches

### 90. Wan 2.2 Bernini-R — AI video editing (fast-off)

`video_edit_bernini_r_video_editing@fast-off`

⚠ Failed: Interrupted by hand at step 2 of 20: with fast mode off the card filled its 32 GB and spilled into system memory (385, then 917 s per step; the 2-hour limit would have hit first). The sweep recorded it as ok because an interrupt ends like a finished run; corrected by hand on 2026-11-09.

Look for: Fast mode off, against the same edit with it on.

Verdict =>

Comments =>

### 91. Wan 2.2 Bernini-R — AI video editing (style)

`video_edit_bernini_r_video_editing@style`

Output: `bench_video_edit_bernini_r_video_editing_1794221283800_00001_.mp4`, `node 76:57:1`

Look for: The style edit type: the dropdown must reach the graph as its index.

Verdict =>

Comments =>

### 92. Wan 2.2 Bernini-R — AI video editing (action)

`video_edit_bernini_r_video_editing@action`

Output: `bench_video_edit_bernini_r_video_editing_1794221653541_00001_.mp4`, `node 76:57:1`

Look for: The action edit type.

Verdict =>

Comments =>

### 93. Wan 2.2 Bernini-R — AI video editing (propagation)

`video_edit_bernini_r_video_editing@propagation`

Output: `bench_video_edit_bernini_r_video_editing_1794222021737_00001_.mp4`, `node 76:57:1`

Look for: The content propagation edit type.

Verdict =>

Comments =>

### 94. Wan 2.2 Bernini-R — video editing with a reference image (ads)

`video_edit_bernini_r_video_editing_with_reference@ads`

Output: `bench_video_edit_bernini_r_video_editing_with_reference_1794222391240_00001_.mp4`, `node 76:57:1`

Look for: The second edit type of the reference card.

Verdict =>

Comments =>

### 95. Wan 2.2 Bernini-R — video editing with reference (auto-prompt) (ads)

`video_edit_bernini_r_video_editing_ref_autoprompt@ads`

Output: `bench_video_edit_bernini_r_video_editing_ref_autoprompt_1794222765347_00001_.mp4`, `node 117:57:1`

Look for: The second edit type of the auto-prompt card.

Verdict =>

Comments =>

### 96. Wan 2.2 Bernini-R — AI image editing (fast-off)

`image_edit_bernini_r_image_editing@fast-off`

Output: `bench_image_edit_bernini_r_image_editing_1794223173163_00001_.png`, `node 76:57:1`

Look for: Fast mode off, against the same edit with it on.

Verdict =>

Comments =>

### 97. Wan 2.2 Bernini-R — image editing with a reference image (subject)

`image_edit_bernini_r_image_editing_with_reference@subject`

Output: `bench_image_edit_bernini_r_image_editing_with_reference_1794223305362_00001_.png`, `node 76:57:1`

Look for: The second task type of the reference card.

Verdict =>

Comments =>

### 98. MiniMax H3 — text to image (fast-off)

`image_minimax_h3_t2i@fast-off`

Output: `bench_image_minimax_h3_t2i_1794223332462_00001_.png`

Look for: Fast mode off, against the same picture with it on.

Verdict =>

Comments =>

### 99. Krea-2 Turbo — text to image (+ style LoRA) (style)

`image_krea2_turbo_t2i_lora@style`

Output: `bench_image_krea2_turbo_t2i_lora_1794223404157_00001_.png`

Look for: Another LoRA from the dropdown, with its linked trigger word.

Verdict =>

Comments =>

### 100. YuE2 music cover - re-sing a song in a new style (full)

`audio_yue2_music_cover@full`

Output: `bench_audio_yue2_music_cover_1794223455905_00001.flac`

Look for: The second transcription mode.

Verdict =>

Comments =>

### 101. Qwen Image 2.1 — image edit with references (no-pictures)

`image_qwen_image_2_1_image_edit@no-pictures`

Output: `bench_image_qwen_image_2_1_image_edit_1794223579790_00001.png`

Look for: Every picture left empty: the aspect ratio must still hold, through whenEmptySet.

Verdict =>

Comments =>

### 102. LTX 2.5 IC-LoRA — video to video (canny edges + audio) (start-image)

`video_edit_ltx2_5_iclora_canny_control@start-image`

Output: `bench_video_edit_ltx2_5_iclora_canny_control_1794223621307_00001_.mp4`

Look for: With a start image: the branch whenEmptySet switches off.

Verdict =>

Comments =>

### 103. LTX 2.5 IC-LoRA — video to video (pose control + audio) (start-image)

`video_edit_ltx2_5_iclora_pose_control@start-image`

Output: `bench_video_edit_ltx2_5_iclora_pose_control_1794223824647_00001_.mp4`

Look for: With a start image: the branch whenEmptySet switches off.

Verdict =>

Comments =>

### 104. LTX 2.5 IC-LoRA — video to video (depth control + audio) (no-start-image)

`video_edit_ltx2_5_iclora_union_control@no-start-image`

Output: `bench_video_edit_ltx2_5_iclora_union_control_1794223917191_00001_.mp4`

Look for: With no start image: whenEmptySet switches the branch off.

Verdict =>

Comments =>

### 105. LTX 2.5 — 2× generative video upscale (keeps original audio) (start-image)

`utility_ltx2_5_video_deblur_upscale@start-image`

Output: `bench_utility_ltx2_5_video_deblur_upscale_1794224007837_00001_.mp4`

Look for: With a start image: the branch whenEmptySet switches off.

Verdict =>

Comments =>
