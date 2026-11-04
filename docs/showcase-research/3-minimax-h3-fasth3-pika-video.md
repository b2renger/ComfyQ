# g3_h3_video — MiniMax H3 family (H3 turbo, FastH3, Pika H3 Flex, H3 Loop, H3 Fun ControlNet)

*Research for the showcase suite, 2026-11-04. Read-only: nothing in `J:\ComfyQ` was edited and no ComfyUI job was run. Every graph detail below was read from the bundle's api.json/meta.json/template, from ComfyUI 0.43.2's own source (`comfy_extras/nodes_minimax_h3.py`, `comfy/text_encoders/minimax.py`) or from the custom pack (`custom_nodes/ComfyUI-MiniMaxH3-Loop/__init__.py`); every model claim has a URL. Assets were opened and looked at (contact sheets of the stills, frames sampled from the clips) before being proposed.*

## What ties the group together (read once)

- **One model, three prompt dialects.** All 15 cards run MiniMax H3 (33B single-stream DiT, Qwen3-VL-32B encoder, separate video + 32 kHz stereo audio VAEs) or a distillation of it; picture and sound come out of the *same* sampling pass ([H3 card](https://huggingface.co/MiniMaxAI/MiniMax-H3), [blog](https://www.minimax.io/blog/minimax-h3)). Voices, effects and music are all generated; 11 languages are listed as stable, French among them ([H3 card](https://huggingface.co/MiniMaxAI/MiniMax-H3)). So every showcase below names its sounds and most carry a voice.
  - **Base modes (T2VA / I2VA / FL2VA / L2VA, the `fl2va` weights):** a fixed alignment line for pictures, then `integrated_multimodal_description: [Shot 1] …`, `overall_soundscape:`, `non_diegetic_music:` ([base guide](https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/docs/VIDEO_PROMPT_WRITING_GUIDE_base_en.md)).
  - **Full-reference mode (Ref2VA, the `ref2va` weights):** six sections `subject_definitions / summary / retention_analysis / detailed_description / overall_soundscape / non_diegetic_music`, a task prefix such as `[reference generation]` or `[video editing]`, and the labels `<Picture N>`, `<Video N>`, `<Audio N>`, `<Subject N>` ([ref guide](https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/docs/VIDEO_PROMPT_WRITING_GUIDE_ref_en.md)).
  - **Loops and ControlNet on the ref2va weights:** plain present-tense prose, then the two sound fields — the pack author's tested format ([PROMPTING.md](https://github.com/pxl-pshr/ComfyUI-MiniMaxH3-Loop/blob/main/PROMPTING.md)).
- **Exact label spelling matters.** ComfyUI splices `"<Picture i>: "` / `"<Video k>: "` literally in front of each reference's vision tokens (`comfy/text_encoders/minimax.py`), and ComfyUI's own R2V template note says ref2va "is very sensitive to prompt wording; matching the reference tags precisely … works best" ([template](https://github.com/Comfy-Org/workflow_templates/blob/main/templates/video_minimax_h3_r2v.json)).
- **Dialogue** goes in `<d>[Language] words.</d>` with a speaker id `(S1)` placed outside the tag; a narrator uses "says in an off-screen voiceover" ([base guide](https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/docs/VIDEO_PROMPT_WRITING_GUIDE_base_en.md) §4.4).
- **What does not work** (ComfyUI's H3 prompt guide): time *ranges* like `[0s-2s]` — use one timestamp per cut (`[Shot 2] At 00:02.000, …`) — and negative prompts / ban lists, because `BasicGuider` runs at cfg 1 with no negative branch ([Comfy prompt guide](https://docs.comfy.org/tutorials/video/minimax/minimax-h3-prompt-guide)). ⚠ The three Fun-ControlNet cards' default prompts use both (see their *Links to fix*).
- **Length:** 5 s → 124 frames = **5.17 s**; that is the number the last-frame alignment line must carry (`temporal_shape` in `nodes_minimax_h3.py`; Pika card: "a 5-second request produces 124 frames (about 5.17 seconds)").
- **Inputs are mostly assets on purpose.** Each example needs specific content (a face for lip-sync, a full-body dancer for pose transfer, a matched before/after pair); an earlier card's showcase output cannot be counted on to have it. Two inputs do come from elsewhere: the Ideogram 4 poster (FastH3 i2v) and a synthesized depth loop (loop restyle) — see the last section. **Two pairs share a source deliberately**, so students can compare cards: the rooftop dancer goes to *video reference* (keeps the rooftop, swaps the dancer) and to *pose* (keeps only the moves).

## video_minimax_h3_t2v_turbo

**What the model is good at** (with sources): MiniMax H3 base `fl2va` weights + lightx2v's **FL2VA Turbo 4-step v1.0 768p** LoRA ([lightx2v HF](https://huggingface.co/lightx2v/Minimax-h3-Turbo), [model table](https://github.com/ModelTC/Minimax-H3-Turbo)): text → 5 s of video **with a soundtrack generated in the same pass** — effects, music and voice are "jointly modeled" ([blog](https://www.minimax.io/blog/minimax-h3)). On this rig it is the cheapest H3 video (30 s warm) and the previous run judged it "the most dynamic" of the four text-to-video engines (`docs/workflow-assessment.md`). The distinctive thing to show is therefore **audio that is visibly caused by the picture**: percussion, where each sound must land on a visible hit, is the hardest sync test and the easiest for a student to check by ear.

**Showcase idea**: a subway busker drumming on upturned plastic buckets and a pot lid. Every boom, click and clang has to coincide with a stick strike on screen; the crowd, a coin and a passing train fill the ambience. One take, a slow push-in, T2VA format exactly as the base guide's Case 1. Avoids the documented weakness of the faster H3 paths ("slightly softer motion/audio", [Comfy native](https://docs.comfy.org/tutorials/video/minimax/minimax-h3-native)) by keeping one subject, one place and one rhythm.

**Inputs**: none (text only).

**Expected result / how to judge it**: ~864×480 (the previous run measured 864×480 from the 848 setting), 124 frames, audio present and not quiet (RMS clearly above the 0.008 FastH3 measured last time). Scrub to three strikes: a transient in the waveform at each. Three white buckets and a metal lid visible; tiled corridor; a coin drops into the case.

**Risks**: fast sticks blur at 480p; sync may be approximate rather than frame-exact; the coin moment may not happen.

**Links to fix**: none dead. ⚠ Worth an A/B: lightx2v's table lists this 768p 4-step LoRA as trained at **video shift 6 / audio shift 3**, and its ComfyUI guide says to set `lora_name`, `steps`, `shift_video` and `shift_audio` "together to match the model table" ([table](https://github.com/ModelTC/Minimax-H3-Turbo), [ComfyUI guide](https://github.com/ModelTC/Minimax-H3-Turbo/blob/main/COMFYUI_SETUP_AND_INFERENCE.md)); this graph has no `MiniMaxH3SigmaShift`, so it samples at the model default 12/3 (`supported_models.py`). Newer turbo LoRAs also exist (`minimax_h3_fl2v_turbo_4step_v1.3_768p`, listed in the lightx2v repo). Minor: the meta declares the UNET with `"type": "checkpoint"`.

```json
{
 "workflow": "video_minimax_h3_t2v_turbo",
 "title": "Make a quick video with sound",
 "summary": "Describe a scene and what it sounds like; in about half a minute you get a 5-second clip whose soundtrack is made together with the picture. The fastest way to try an idea.",
 "note": "One paragraph of text became both the picture and the drumming, at the same time. Listen with the sound on: every boom and clang should land on a stick hit you can see.",
 "params": {
  "minimaxh3imagetovideo_prompt_11": "integrated_multimodal_description: [Shot 1] Live-action, cinematic, a medium shot in a white-tiled subway corridor at rush hour. A young street drummer in a red beanie and a faded denim jacket sits on a low wooden crate behind three upturned white plastic buckets and a dented metal pot lid, a drumstick in each hand. He plays a fast, tight beat: the right stick strikes the big centre bucket on every beat with a deep hollow boom, the left stick snaps against the bucket rims with sharp plastic clicks and hits the pot lid with a bright metallic clang on the off-beat, his shoulders bouncing in time. At about two seconds he twirls the left stick between his fingers without missing a beat and then hits the pot lid twice, hard. Commuters in coats stream past behind him, slightly out of focus, and one of them tosses a coin into the open instrument case at his feet. The camera pushes in with small amplitude at slow speed from waist height, ending on his hands and the buckets.\n\noverall_soundscape: The drum hits echo off the tiled walls over a steady murmur of the crowd and hurried footsteps; a coin clinks into the case, and a train rumbles through the station in the distance.\n\nnon_diegetic_music: N/A"
 },
 "inputs": {},
 "keepRuntime": false,
 "estSec": 30,
 "sources": [
  "https://huggingface.co/MiniMaxAI/MiniMax-H3",
  "https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/docs/VIDEO_PROMPT_WRITING_GUIDE_base_en.md",
  "https://docs.comfy.org/tutorials/video/minimax/minimax-h3-prompt-guide",
  "https://docs.comfy.org/tutorials/video/minimax/minimax-h3-native",
  "https://github.com/ModelTC/Minimax-H3-Turbo",
  "https://huggingface.co/lightx2v/Minimax-h3-Turbo",
  "https://www.minimax.io/blog/minimax-h3"
 ]
}
```

## video_minimax_h3_i2v_4step

**What the model is good at** (with sources): the same H3 `fl2va` weights + 4-step turbo LoRA, with the picture as the first frame (I2VA). The base guide's own I2VA case makes the person in the picture **speak a line** (`(S1) says: <d>[English] …</d>`) while "character identity, clothing, colors, key objects, and spatial relationships should remain consistent" ([base guide](https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/docs/VIDEO_PROMPT_WRITING_GUIDE_base_en.md) §3.1, Case 2), and H3 lists French among its 11 stable dialogue languages ([H3 card](https://huggingface.co/MiniMaxAI/MiniMax-H3)). No other picture-to-video card in the library *invents* a voice and lip-syncs it from text alone (LivePortrait needs a driving video, LTX ia2v a voice recording).

**Showcase idea**: a 1950s black-and-white studio portrait notices the viewer and says, in French, *"Oh! Vous êtes enfin là. Je vous attendais."* — then laughs softly and settles back into the photo's smile. Shows identity kept from a still, invented voice, lip-sync, a second language, and room tone plus a faint period score. The previous run only animated a landscape; this plays to the I2VA feature the guide itself demonstrates.

**Inputs**: `loadimage_image_114` — one face filling most of the frame, front-on, mouth visible — `asset:Woman.png` (1024×1024, b/w portrait: short swept dark hair, pearl stud earring, houndstooth jacket, grey backdrop; opened and checked). The card keeps the picture's shape, so the video is 640×640.

**Expected result / how to judge it**: frame 0 ≈ the photo; the mouth opens and closes in step with the audible French line ("vous êtes enfin là" recognisable); earring, jacket pattern and hairstyle unchanged at the last frame; still black-and-white (no colourised frames); a soft laugh and faint piano under the voice.

**Risks**: 4-step turbo at 640×640 can soften mouth shapes; the model may colourise a b/w start (the prompt states black-and-white twice); French liaisons may come out slightly accented.

**Links to fix**: none dead. The same shift 6/3 remark as the t2v turbo card applies to its Fast mode.

```json
{
 "workflow": "video_minimax_h3_i2v_4step",
 "title": "Make a picture move and talk",
 "summary": "Upload a picture and write what happens and what is said; it becomes the first frame of a short video with matching sound, and people in it can speak your line, in your language.",
 "note": "A still photo from the 1950s turns to you and speaks French: the voice, the lip movements and the laugh were all made from one line of text. Notice that the earring, the jacket and the black-and-white look never change.",
 "params": {
  "loadimage_image_114": "asset:Woman.png",
  "minimaxh3imagetovideo_prompt_105_104": "For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.\n\nintegrated_multimodal_description: [Shot 1] Black-and-white 1950s studio portrait photography with fine film grain, the young woman shown in <Picture 1> keeps her short swept dark hair, pearl stud earring, houndstooth jacket, soft key light and plain grey backdrop. She holds her smile for a moment, then her eyes widen slightly as if she has just noticed the viewer, she tilts her head and leans a little toward the lens. The young woman with a warm, bright voice (S1) says: <d>[French] Oh! Vous êtes enfin là. Je vous attendais.</d> She lets out a short, soft laugh, glances to the side and back, and settles into her original smile. The camera pushes in with small amplitude at slow speed, ending on a close-up of her face. The image stays black-and-white throughout.\n\noverall_soundscape: Quiet studio room tone with the faint crackle of an old film soundtrack, the soft rustle of her jacket as she leans forward, and her short breathy laugh.\n\nnon_diegetic_music: A gentle 1950s jazz piano with brushed snare at a slow tempo, very quiet under her voice."
 },
 "inputs": {
  "loadimage_image_114": {
   "need": "a single face, front-on, filling most of the frame, mouth visible; any style",
   "source": "asset:Woman.png"
  }
 },
 "keepRuntime": false,
 "estSec": 35,
 "sources": [
  "https://huggingface.co/MiniMaxAI/MiniMax-H3",
  "https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/docs/VIDEO_PROMPT_WRITING_GUIDE_base_en.md",
  "https://docs.comfy.org/tutorials/video/minimax/minimax-h3-prompt-guide",
  "https://docs.comfy.org/tutorials/video/minimax/minimax-h3-native",
  "https://github.com/ModelTC/Minimax-H3-Turbo"
 ]
}
```

## video_fastvideo_fasth3_t2v

**What the model is good at** (with sources): FastVideo's **FastH3 8-Step V2**, a DMD2 distillation of H3 trained with VSA sparse attention at 80% sparsity; text-to-audio-video in eight forwards ([model card](https://huggingface.co/FastVideo/FastVideo-FastH3-8-Step-V2)). FastVideo's speedups *grow with clip length* (8× at 5 s → 14× at 15 s on one B200, [blog](https://haoailab.com/blogs/fasth3-preview/)), and ComfyUI's own note says that at 362 frames (15 s) "VSA sparse attention is about 2x faster than the int8 attention backend; at shorter, smaller clips it offers little speedup" (FastH3 OmniRef template note). Its known weak spots: "difficult motion, fine detail, and some audio may remain below the base" ([model card](https://huggingface.co/FastVideo/FastVideo-FastH3-8-Step-V2)), and ComfyUI calls it a drafts engine ([Comfy FastH3](https://docs.comfy.org/tutorials/video/minimax/minimax-h3-fastvideo)). On this rig at 5 s it was slower (54 s) and quieter than the turbo card (assessment). So the honest showcase plays to length and calm: a **longer, multi-shot, slow-moving piece with narration**.

**Showcase idea**: a 10-second, three-shot nature-documentary opening — misty valley, a fox on a log, sunrise over the river — with a narrator in off-screen voiceover, forest ambience and a slow orchestral score. Shows timed cuts (`[Shot 2] At 00:04.000 …`, one timestamp per cut as ComfyUI asks), an off-screen voice (no lip-sync to fail), and the length where this engine's design pays off. Slow camera moves avoid its fast-motion weakness; naming every sound answers the quiet-soundtrack finding.

**Inputs**: none (text only). Aspect set to 16:9 (the card's default is 1:1; same 0.4 MP, so no cost change).

**Expected result / how to judge it**: 243 frames (10.1 s) at 864×480; cuts near 4.0 s and 7.5 s; a fox in shot 2; both narrator lines intelligible ("Every morning, the valley wakes up slowly." / "And then, the light arrives."); music audible and rising in shot 3; soundtrack RMS comparable to the turbo card's.

**Risks**: cut timestamps can drift a few tenths of a second; the narrator might be voiced in shot 2 too or not at all; still the quietest engine — if audio is weak again, that is a finding about the checkpoint, not the prompt. Cost: **10 s instead of 5 s doubles the latent length** → `keepRuntime: true`, ~125 s warm estimated (54 s × ~2.3).

**Links to fix**: ⚠ **The description is wrong in two ways.** It says this checkpoint "was never trained for first/last-frame conditioning — for that use 'MiniMax H3 — first / last frame', which runs the undistilled model". (1) That bundle no longer exists (removed 2026-09-21); (2) the library's own `video_fastvideo_fasth3_i2v` runs **this same checkpoint** with first/last frames, ComfyUI documents it as "text-to-video and first/last-frame image-to-video" ([Comfy FastH3](https://docs.comfy.org/tutorials/video/minimax/minimax-h3-fastvideo)), and the previous run landed both ends. Note FastVideo's own card still says "FL2VA and Ref2VA were not distilled" ([model card](https://huggingface.co/FastVideo/FastVideo-FastH3-8-Step-V2)) — the honest wording is "works on this rig, not officially distilled". Replace the pointer with `video_fastvideo_fasth3_i2v`. Also: the card exposes **Steps 4–16**, while ComfyUI says "Steps are fixed at 8 … changing the step count … degrades quality" — consider hiding it.

```json
{
 "workflow": "video_fastvideo_fasth3_t2v",
 "title": "Draft a longer video with sound",
 "summary": "Another fast text-to-video engine, best for calm, cinematic scenes of up to 12 seconds with several shots, a narrator and music. For short, lively clips the quick video card is faster on this machine.",
 "note": "Ten seconds, three shots and a narrator, all from one prompt. Notice where the cuts fall (about 4 and 7.5 seconds, as written) and that the voice-over and the music were generated with the pictures.",
 "params": {
  "minimaxh3imagetovideo_prompt_105_104": "integrated_multimodal_description: [Shot 1] Live-action nature documentary, cinematic, soft blue dawn light. A wide aerial shot glides slowly forward over a misty pine forest in a deep valley; low clouds drift between the treetops and a silver river winds along the valley floor. The camera pushes in with small amplitude at slow speed. A calm, deep male narrator (S1) says in an off-screen voiceover: <d>[English] Every morning, the valley wakes up slowly.</d> [Shot 2] At 00:04.000, the camera cuts to a close-up of a red fox stepping out of the ferns onto a mossy fallen log, its breath steaming in the cold air; it stops and lifts its head toward the light. The camera holds a static shot. [Shot 3] At 00:07.500, the camera cuts to a low wide shot over the river, where mist rolls across the water and the first golden sunbeams break through the pines. The narrator (S1) continues in the same off-screen voiceover: <d>[English] And then, the light arrives.</d> The camera tilts up with small amplitude at slow speed toward the rising sun.\n\noverall_soundscape: Soft forest dawn ambience with distant birdsong, a light breeze in the pines, the crunch of moss and twigs under the fox's paws, and the gentle rush of the river.\n\nnon_diegetic_music: A slow, warm orchestral score with sustained strings and a soft French horn, swelling gently in the final shot.",
  "primitivefloat_value_105_111": 10,
  "resolutionselector_aspect_ratio_143": "16:9 (Widescreen)"
 },
 "inputs": {},
 "keepRuntime": true,
 "estSec": 125,
 "sources": [
  "https://huggingface.co/FastVideo/FastVideo-FastH3-8-Step-V2",
  "https://haoailab.com/blogs/fasth3-preview/",
  "https://docs.comfy.org/tutorials/video/minimax/minimax-h3-fastvideo",
  "https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/docs/VIDEO_PROMPT_WRITING_GUIDE_base_en.md",
  "https://docs.comfy.org/tutorials/video/minimax/minimax-h3-prompt-guide"
 ]
}
```

## video_fastvideo_fasth3_i2v

**What the model is good at** (with sources): the FastH3 8-step checkpoint driven through `MiniMaxH3ImageToVideo` with **optional** `first_frame` and `last_frame` ([Comfy FastH3](https://docs.comfy.org/tutorials/video/minimax/minimax-h3-fastvideo)). In the code the first frame is stretched onto the canvas and pinned at frame 0, the last frame is cover-cropped and pinned at `frame_count − 1`, and both are re-injected every step, never denoised (`nodes_minimax_h3.py`). It is the only card in the library that can take **a last frame alone** — the base guide's L2VA mode: "infer a plausible opening and land on the image at the end" ([base guide](https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/docs/VIDEO_PROMPT_WRITING_GUIDE_base_en.md) §3.3). Previous run: cheapest first+last card, both ends landed (assessment).

**Showcase idea**: *a video that ends exactly on your design.* Give only the **last** frame — a finished poster with a big legible title — and the clip starts on a blank sheet, paper shapes slide in, letters drop one by one, and it locks onto the poster, with paper whooshes and a beat. For a design student this is the animated poster reveal; it shows the mode nothing else in the library has, and the pinned last frame keeps the title text exactly as designed (in-between frames are free to be rough). The prompt is written so it fits any poster.

**Inputs**: `loadimage_image_300` (last frame) — a finished poster with a large title in clean type — proposed `output:image_ideogram4_t2i` (whatever the Ideogram showcase makes; its default aspect is 9:16). `loadimage_image_136` (first frame) — left empty (`null`, unlinked). `resolutionselector_aspect_ratio_143` must match the poster's shape (9:16 here); the last frame is cover-cropped, so a mismatched shape would cut the title.

**Expected result / how to judge it**: about 480×850, 5.17 s; frame 0 a near-blank sheet; the final frame ≈ the poster (title readable letter for letter); shapes/letters arrive progressively rather than a cross-fade; paper slaps and thumps on the landings, a beat that resolves on the last frame.

**Risks**: depends on another group's output (fallback below); the middle of the clip may cross-fade instead of assembling; FastVideo says FL2VA was not distilled ([model card](https://huggingface.co/FastVideo/FastVideo-FastH3-8-Step-V2)) — the rig showed both-ends works, last-only has not been run. **Fallback if no poster:** `asset:Screenshot 2025-03-06 105700.png` (the pink building under giant daisies) as the last frame with aspect `3:4 (Portrait Standard)` and a prompt where the empty roof sprouts the daisies — but that pair is proposed for Pika below, so prefer the poster.

**Links to fix**: the card exposes Steps 4–16 (ComfyUI: fixed at 8). Description accurate (stretch vs crop matches the code).

```json
{
 "workflow": "video_fastvideo_fasth3_i2v",
 "title": "Start or end on your picture",
 "summary": "Give a first picture, a last picture, or both, and describe what happens: the video starts there, lands there, or travels between them, with sound. Use it to make a clip finish exactly on a poster or a frame you designed.",
 "note": "Only the finished poster was given, as the LAST frame: the model invented the build-up and lands exactly on the design. Pause on the final frame — the title is the original, letter for letter.",
 "params": {
  "minimaxh3imagetovideo_prompt_105_104": "How the reference pictures align with the target video — <Picture 1> (from [Shot 1]) aligns with the 5.17-second mark of the target video.\n\nintegrated_multimodal_description: [Shot 1] Animated graphic-design reveal, one continuous shot, the camera remains fixed and frontal. The video opens on a blank sheet of off-white paper filling the frame. At about one second, large flat shapes of coloured paper slide in from the edges of the frame and snap into place one after another, each casting a small soft shadow, and the main picture of the poster assembles in the middle from cut and torn pieces. At about three seconds the title letters drop in from the top one by one, bouncing slightly as they land, and the smaller lines of text slide in underneath. In the last second every piece settles and the composition locks exactly into the finished poster of <Picture 1>, which holds still to the end.\n\noverall_soundscape: Crisp paper sounds throughout: a quick whoosh and a soft slap as each cut-paper shape lands, a light rustle of paper, and a small cardboard thump for every falling letter, in a quiet room.\n\nnon_diegetic_music: A punchy, minimal electronic beat at a moderate tempo whose kicks land on the falling letters, ending on a single held chord on the finished poster.",
  "loadimage_image_136": null,
  "loadimage_image_300": "output:image_ideogram4_t2i",
  "resolutionselector_aspect_ratio_143": "9:16 (Portrait Widescreen)"
 },
 "inputs": {
  "loadimage_image_300": {
   "need": "a finished poster with a large, legible title; set the aspect param to its shape",
   "source": "output:image_ideogram4_t2i (fallback asset:Screenshot 2025-03-06 105700.png with 3:4 and a daisy prompt)"
  },
  "loadimage_image_136": {
   "need": "left empty on purpose (last-frame-only mode)",
   "source": "null"
  }
 },
 "keepRuntime": false,
 "estSec": 59,
 "sources": [
  "https://docs.comfy.org/tutorials/video/minimax/minimax-h3-fastvideo",
  "https://huggingface.co/FastVideo/FastVideo-FastH3-8-Step-V2",
  "https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/docs/VIDEO_PROMPT_WRITING_GUIDE_base_en.md",
  "https://docs.comfy.org/tutorials/video/minimax/minimax-h3-prompt-guide"
 ]
}
```

## video_fastvideo_fasth3_omniref_r2v

**What the model is good at** (with sources): **FastH3 Omni** (FastVideo + Nuva Lab), the ref2va H3 transformer distilled to 8 steps: "generate video and synchronized audio from a prompt and ordered image, video and audio references", shift 12/3, guidance 1 ([model card](https://huggingface.co/FastVideo/FastH3-Omni-Comfy)). ComfyUI's template: "a character, a product or a location can be reused across shots while the model still generates the performance and the audio"; the prompt should "describe the shot, the motion and one line of dialogue" (template note). Previous run: "faithful to both references" at 64 s — the fastest way in the library to put several pictures into one film.

**Showcase idea**: two pictures that were never together — a steampunk inventor (character) and an art-nouveau jewelled dragonfly (object) — become one scene: she winds the dragonfly with a tiny key, it whirs to life, lifts off her palm and circles her head, and she laughs *"Ha! She flies!"* Clockwork clicks, wing buzz, steam and a light pizzicato. Shows identity of a person **and** of an object kept from separate references, an invented action, dialogue, and foley tied to visible events. Written in the six-section ref format.

**Inputs**: `ref_image_137` (Picture 1) — a character with distinctive, checkable features — `asset:woman_mechanic.png` (blue-and-orange curls, two pairs of brass goggles, leather waistcoat, copper-pipe workshop). `ref_image_300` (Picture 2) — a small, ornate object on a plain background — `asset:nv.1197-trat.-fundo-CAzev.jpg` (gold dragonfly brooch with pale-green veined wings, opal eyespots, long segmented tail). Slots 3–4 empty.

**Expected result / how to judge it**: 864×480, 5.17 s; her hair colours and both goggles recognisable; the dragonfly's green-gold wings and long tail recognisable as the brooch; it flies (leaves her hand, circles); the line audible after take-off; three clicks before take-off.

**Risks**: the brooch's sculpted figure at its head may become a tiny human face; a 700-px object reference at `match` size holds less detail (the `max` option is several times slower); the line may land before the take-off.

**Links to fix**: the meta's model `url`/`source` and the second prompt guide point at `FastVideo/FastH3-OmniRef-Comfy`, which now **307-redirects** to `FastVideo/FastH3-Omni-Comfy` (renamed; the loop card already uses the new name). Not broken, but update to https://huggingface.co/FastVideo/FastH3-Omni-Comfy.

```json
{
 "workflow": "video_fastvideo_fasth3_omniref_r2v",
 "title": "Put your pictures in a video",
 "summary": "Upload up to four pictures — a character, an object, a place — and write the scene; they appear together in a new 5-second film with voices and sound. The fast version.",
 "note": "The inventor and the jewelled dragonfly come from two separate pictures; the model kept both looks and invented the scene, the flight, her line and every sound. Compare her hair and goggles, and the dragonfly's wings, with the two pictures.",
 "params": {
  "ref_image_137": "asset:woman_mechanic.png",
  "ref_image_300": "asset:nv.1197-trat.-fundo-CAzev.jpg",
  "ref_image_301": null,
  "ref_image_302": null,
  "prompt_138": "subject_definitions:\n<Subject 1> is the inventor in <Picture 1>: an older woman with curly bright blue and orange hair, round orange-lensed brass goggles on her nose and a second pair of gear-rimmed goggles pushed up on her head, silver hoop earrings, a grey neck scarf, a blue shirt and a riveted brown leather waistcoat, in a workshop of copper pipes and brass gears.\n<Subject 2> is the jewelled dragonfly in <Picture 2>: a gold art-nouveau dragonfly with long pale-green enamelled wings veined in gold, blue-green opal eyespots ringed with tiny diamonds, and a long segmented gold-and-blue tail. The white background of <Picture 2> is not used.\n\nsummary:\n[reference generation] A five-second single shot in the workshop of <Subject 1>: she winds a tiny key on the back of <Subject 2>, the dragonfly comes to life, lifts off her palm and circles her head, and she laughs and speaks one line.\n\nretention_analysis:\n<Subject 1> (appears in [Shot 1]): fully_preserved - her blue and orange hair, both pairs of goggles, earrings, scarf, blue shirt and leather waistcoat, and the copper-pipe workshop are kept.\n<Subject 2> (appears in [Shot 1]): fully_preserved - the gold body, the pale-green veined wings, the opal eyespots and the long segmented tail are kept; it is now a small working machine about the size of her hand.\n\ndetailed_description:\nWarm, richly detailed steampunk film look, golden lamplight, drifting steam, normal real-time speed.\n[Shot 1] A medium close-up in front of copper pipes and slowly turning brass gears: <Subject 1> holds <Subject 2> flat on her open left palm at chest height and turns a tiny brass key on its back three times with her right fingers, each turn clicking. At about one and a half seconds the dragonfly's pale-green wings shiver, then beat into a shimmering blur, and it lifts off her palm. It rises past her goggles and circles once around her head, its long gold tail catching the light, while a puff of steam escapes from a valve behind her. <Subject 1> (S1) tips her head back, laughing, and says in a bright, raspy voice, <d>[English] Ha! She flies!</d> The camera tilts up with small amplitude at slow speed to follow the dragonfly, then settles on her delighted face.\n\noverall_soundscape:\nWorkshop ambience with the slow ticking of turning gears and a soft hiss of steam, three crisp clockwork clicks as the key turns, then the rising metallic buzz of wings as the dragonfly takes off and circles.\n\nnon_diegetic_music:\nA light, playful pizzicato and glockenspiel figure at a moderate tempo that lifts when the dragonfly takes off."
 },
 "inputs": {
  "ref_image_137": {
   "need": "one character with distinctive, checkable hair/outfit/props",
   "source": "asset:woman_mechanic.png"
  },
  "ref_image_300": {
   "need": "one ornate object on a plain background",
   "source": "asset:nv.1197-trat.-fundo-CAzev.jpg"
  }
 },
 "keepRuntime": false,
 "estSec": 66,
 "sources": [
  "https://huggingface.co/FastVideo/FastH3-Omni-Comfy",
  "https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/docs/VIDEO_PROMPT_WRITING_GUIDE_ref_en.md",
  "https://docs.comfy.org/tutorials/video/minimax/minimax-h3-prompt-guide",
  "https://docs.comfy.org/tutorials/video/minimax/minimax-h3-native",
  "https://github.com/Comfy-Org/workflow_templates/blob/main/templates/video_minimax_h3_r2v.json"
 ]
}
```

## video_pika_h3_flex_t2v

**What the model is good at** (with sources): **Pika H3 Flex**, H3 post-trained by Pika, distilled to six steps and refined with reward feedback; FL2VA adapter here ([Pika HF](https://huggingface.co/Pika-Labs/Pika-H3-Flex), [Comfy Pika](https://docs.comfy.org/tutorials/video/pika/pika-h3-flex)). Pika's own headline: "Ideal for multi-shot storytelling · Motion graphics · Product films · Reference-guided animation", with a sitcom showcase of hard cuts and two spoken lines ([Pika HF](https://huggingface.co/Pika-Labs/Pika-H3-Flex)). ComfyUI's tests: "Multi-shot direction: describe hard cuts, camera choreography, and dialogue inside one prompt"; "Rendered text holds. Short labels on props … stay legible"; framing should be described as content ([Comfy Pika](https://docs.comfy.org/tutorials/video/pika/pika-h3-flex)). Pika's guide asks for real-time speed if slow motion is unwanted ([Pika guide](https://github.com/Pika-Labs/Pika-H3-Flex/blob/main/docs/prompt-guidance.md)). Previous run: "the most polished frame, at the largest size" (1344×768, 140 s).

**Showcase idea**: a three-shot, two-character exchange in a tiny Paris bakery in 5 s — wide shot and the customer's line, cut to a macro of the tongs lifting the glossiest croissant, cut to the baker's wink and reply — with a chalkboard reading "CROISSANTS", shop-bell foley and an accordion waltz. Shows what the polished engine is for: cuts at chosen times, two distinct voices, a legible short label, and a score under the dialogue.

**Inputs**: none (text only).

**Expected result / how to judge it**: ~1344×768, 5.17 s; cuts near 2.0 s and 3.5 s (±0.3 s is normal per ComfyUI); two different voices, both lines intelligible; the chalkboard word readable in shot 1; accordion audible; motion at real-time speed.

**Risks**: three shots in five seconds is tight — a cut may be dropped or the second line clipped; a 5-second clip cannot hold a longer exchange (raising duration raises cost).

**Links to fix**: none.

```json
{
 "workflow": "video_pika_h3_flex_t2v",
 "title": "Make a polished multi-shot film",
 "summary": "Write a short scene shot by shot, with dialogue; you get a sharp, large 5- to 15-second film with cuts, voices and music. Slower (about 2½ minutes for 5 s) — pick it for the final version.",
 "note": "Three shots, two characters, two lines of dialogue and a little accordion tune, all from one prompt. Watch the cuts land where the prompt asked (about 2 and 3.5 seconds) and read the chalkboard.",
 "params": {
  "prompt_231": "integrated_multimodal_description: [Shot 1] Live-action, warm cinematic 35mm look with fine grain, normal real-time speed with no slow motion. A medium-wide shot inside a tiny Parisian bakery in the morning: a young baker with flour on her navy apron stands behind a wooden counter piled with golden croissants, a small chalkboard on the counter reading \"CROISSANTS\", and an elderly man in a tweed cap and a long grey coat stands in front of the counter holding a single coin. The elderly man with a slow, gravelly voice (S1) taps the coin on the counter and says: <d>[English] One croissant. The best one.</d> [Shot 2] At 00:02.000, the camera cuts to a close-up of the baker's hands lifting the largest, glossiest croissant with silver tongs; flakes of pastry fall onto the counter. [Shot 3] At 00:03.500, the camera cuts to a medium close-up of the baker, who winks as she slides it into a paper bag, and the young baker with a bright, cheerful voice (S2) says: <d>[English] They're all the best.</d> The camera remains fixed.\n\noverall_soundscape: Small bakery ambience: the shop-door bell, the clink of the coin on wood, the crackle of the paper bag, pastry flakes pattering on the counter and the low hum of the oven.\n\nnon_diegetic_music: A light accordion waltz at a moderate tempo, quiet under the dialogue, ending on a single bright note."
 },
 "inputs": {},
 "keepRuntime": false,
 "estSec": 140,
 "sources": [
  "https://huggingface.co/Pika-Labs/Pika-H3-Flex",
  "https://github.com/Pika-Labs/Pika-H3-Flex/blob/main/docs/prompt-guidance.md",
  "https://docs.comfy.org/tutorials/video/pika/pika-h3-flex",
  "https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/docs/VIDEO_PROMPT_WRITING_GUIDE_base_en.md",
  "https://docs.comfy.org/tutorials/video/minimax/minimax-h3-prompt-guide"
 ]
}
```

## video_pika_h3_flex_fl2va

**What the model is good at** (with sources): the Pika FL2VA adapter with a first frame and an optional last frame ([Pika guide](https://github.com/Pika-Labs/Pika-H3-Flex/blob/main/docs/prompt-guidance.md) §2: "Begin aligned with <Picture 1>. … End aligned with <Picture 2>"; "prefer one continuous shot between first and last frames"). The base guide: describe "the motion path that connects them", not two static images ([base guide](https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/docs/VIDEO_PROMPT_WRITING_GUIDE_base_en.md) §3.2). Previous run: "the smoothest" of the three first/last-frame cards, at 768p.

**Showcase idea**: a matched before/after pair already in the assets — a plain pink two-storey building with a heavy flat roof, and the *same* street with the roof replaced by a towering bouquet of giant puffy daisies. The video is the transformation: the roof trembles, splits, and soft white petals inflate out of it one by one while the yellow taxi and the street never move, with creaks, airy whooshes and a pizzicato that lands on the final frame. Shows the card's power — a believable, continuous path between two designed frames — on a surreal change no camera could film.

**Inputs**: `first_frame_148` — the "before" — `asset:Screenshot 2025-03-06 105726.png` (721×831). `last_frame_147` — the "after", same framing — `asset:Screenshot 2025-03-06 105700.png` (598×755). Both opened: same street corner, taxi and poles in the same places. The video takes the first picture's portrait shape (~0.87); the last is cover-cropped, which trims ~4% top and bottom — the daisies start ~8% below the top, so they survive.

**Expected result / how to judge it**: ~0.98 MP portrait, 5.17 s; frame 0 ≈ the plain building, last frame ≈ the daisy building; daisies appear progressively (not a cross-fade); the taxi stays put; whoosh/inflate sounds while the petals grow.

**Risks**: the model may dissolve between the frames instead of growing the flowers (the prompt describes each stage to prevent it); small framing differences between the two screenshots may cause a slight zoom; both pictures carry an alpha channel (RGBA PNG) — LoadImage uses the RGB.

**Links to fix**: none. (Its size field is an `ImageScaleToTotalPixels`, so 0.98 MP survives, unlike the `ResolutionSelector` case recorded in CLAUDE.md.)

```json
{
 "workflow": "video_pika_h3_flex_fl2va",
 "title": "Animate between two pictures, polished",
 "summary": "Give a first picture and, if you like, a last one, and describe what happens in between; you get a large, smooth video with sound that starts on the first and ends exactly on the second.",
 "note": "Two still pictures — before and after — and the model filmed the transformation in between: the roof bursts into giant daisies while the taxi and the street stay exactly where they were.",
 "params": {
  "first_frame_148": "asset:Screenshot 2025-03-06 105726.png",
  "last_frame_147": "asset:Screenshot 2025-03-06 105700.png",
  "prompt_231": "How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns with the 0.00-second mark of the target video; Picture 2 (from Shot 1) aligns with the 5.17-second mark of the target video.\n\nintegrated_multimodal_description: [Shot 1] Sunlit, softly faded 1970s film photography with gentle grain, one continuous shot, normal real-time speed, the camera remains fixed. Begin aligned with <Picture 1>: a two-storey pink stucco building with a heavy overhanging flat roof stands on a quiet street corner under a deep teal sky, a yellow taxi parked at the kerb in front of it, telephone poles on the left and a mountain on the right. At about one second the flat roof starts to tremble and bulge, its seams split, and soft white fabric balloons out of the cracks. At about two seconds huge rounded white petals push up and unfold one after another, inflating with a whoosh until each blossom shows a round knitted yellow centre. At about three and a half seconds the last daisies swell into a towering bouquet that completely replaces the roof, the petals bobbing gently and settling, while the taxi, the street and the poles never move. End aligned with <Picture 2>.\n\noverall_soundscape: Quiet sunny street ambience with a car passing far away, then a creak and a crack as the roof splits, a series of deep, soft airy whooshes and fabric rustles as each daisy inflates, and a gentle rubbery squeak as the petals settle; a single bird chirps at the end.\n\nnon_diegetic_music: A playful pizzicato string figure at a moderate tempo that climbs with the inflating flowers and lands on one bright chord on the final frame."
 },
 "inputs": {
  "first_frame_148": {
   "need": "the 'before' picture",
   "source": "asset:Screenshot 2025-03-06 105726.png"
  },
  "last_frame_147": {
   "need": "the 'after' picture, same framing",
   "source": "asset:Screenshot 2025-03-06 105700.png"
  }
 },
 "keepRuntime": false,
 "estSec": 160,
 "sources": [
  "https://github.com/Pika-Labs/Pika-H3-Flex/blob/main/docs/prompt-guidance.md",
  "https://huggingface.co/Pika-Labs/Pika-H3-Flex",
  "https://docs.comfy.org/tutorials/video/pika/pika-h3-flex",
  "https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/docs/VIDEO_PROMPT_WRITING_GUIDE_base_en.md"
 ]
}
```

## video_pika_h3_flex_ref2va

**What the model is good at** (with sources): the Pika Ref2VA adapter on H3's reference transformer, up to 12 references ([Pika HF](https://huggingface.co/Pika-Labs/Pika-H3-Flex)). Pika's showcase set includes a 15-second multi-cut **product film** built from one product picture ("Feel the bass") and its guide asks each reference to have one clear role ("Use Picture 1 only for composition and Picture 2 only for character appearance", [Pika guide](https://github.com/Pika-Labs/Pika-H3-Flex/blob/main/docs/prompt-guidance.md) §5). ComfyUI: "the references carry identity, costume, object shape, and environment, while the prompt carries the action and the shot" ([Comfy Pika](https://docs.comfy.org/tutorials/video/pika/pika-h3-flex)). Previous run: as faithful as OmniRef, "more detailed and larger".

**Showcase idea**: a design-magazine **product film of a chair, shot in the school's own atrium**: Picture 1 is a teak-and-cane office chair (Chandigarh style) on white, Picture 2 the atrium of the design school. Three hard cuts on the beat — the chair alone on the atrium floor in a shaft of daylight, a macro gliding across the cane weave, a low hero angle against the glass roof. Shows the polished engine at its documented job (product film), two references with separate roles (object vs place), consistency of a product across angles, and sound design synced to cuts. Students will recognise the building.

**Inputs**: `ref_image_149` (Picture 1) — one product on a plain background — `asset:6504516c0115ed9b83b2d82e1d94c4ec.webp` (1920×1920 still: teak frame, V-shaped legs, flat armrests, cane seat and back, finger joints). `ref_image_150` (Picture 2) — a place — `asset:agora_ecole_de_design1.jpg` (the school atrium: light-wood galleries, steel stairs, glass roof, concrete floor). Slots 3–4 empty.

**Expected result / how to judge it**: ~1376×768, 5.17 s; the same chair in all three shots (V legs, flat arms, cane panels); wooden galleries and glass roof recognisable; cuts near 2.0 s and 3.5 s; no people on the floor; kicks on the cuts.

**Risks**: the chair may be placed among the atrium's own furniture (the prompt clears the floor); cane mesh can moiré at 768p; cut times ±0.3 s.

**Links to fix**: none. Idea for later: Pika's Ref2VA also supports `[video editing]` with `<Video N>` ([Pika guide](https://github.com/Pika-Labs/Pika-H3-Flex/blob/main/docs/prompt-guidance.md) §3, Examples 4 and 8), but this card exposes picture slots only.

```json
{
 "workflow": "video_pika_h3_flex_ref2va",
 "title": "Make a polished film from pictures",
 "summary": "Upload up to four pictures — a product, a character, a place — and direct the shots; you get a large, detailed film with sound, ideal for product films. Slower than the quick version.",
 "note": "A product photo of a chair and a photo of the school atrium became a three-shot furniture commercial. Check that it is the same chair from every angle, and that the cuts fall on the beat.",
 "params": {
  "ref_image_149": "asset:6504516c0115ed9b83b2d82e1d94c4ec.webp",
  "ref_image_150": "asset:agora_ecole_de_design1.jpg",
  "ref_image_300": null,
  "ref_image_301": null,
  "prompt_138": "subject_definitions:\n<Subject 1> is the armchair in <Picture 1>. Reference role: product identity anchor. Features to follow exactly: a solid teak frame with square-section legs forming an inverted V on each side, wide flat armrests, finger-jointed corners, and a seat and backrest woven from pale natural cane in an open mesh. It is the only product in the film. The white studio background of <Picture 1> is not used.\n<Subject 2> is the atrium in <Picture 2>. Reference role: location anchor. Features to follow: a tall multi-storey hall lined with light-wood panelling and balconies with thin steel railings, steel staircases, a glass roof letting in daylight, and a pale concrete floor.\n\nsummary:\n[reference generation] A five-second premium furniture film with three hard cuts on the beat: <Subject 1> stands alone on the floor of <Subject 2> in morning sunlight, then the film cuts to a macro of its cane weave and to a low hero angle.\n\nretention_analysis:\n<Subject 1> (appears in [Shot 1], [Shot 2], [Shot 3]): fully_preserved - the teak frame, the V-shaped legs, the flat armrests, the finger joints and the cane mesh are kept exactly.\n<Subject 2> (appears in [Shot 1], [Shot 3]): partially_preserved - the wooden balconies, steel railings, glass roof and daylight are kept; the floor is cleared so the chair stands alone, with no people and no other furniture.\n\ndetailed_description:\nRefined design-magazine cinematography, soft natural daylight from the glass roof, warm teak tones against pale concrete, subtle 35mm grain, normal real-time speed.\n[Shot 1] A wide shot shows <Subject 1> standing alone in the middle of the empty concrete floor of <Subject 2>, small in the frame, the wooden balconies rising behind it and a shaft of sunlight falling across the cane seat. The camera pushes in with small amplitude at slow speed toward the chair and stops on a full view of it.\n[Shot 2] At 00:02.000, the shot cuts to an extreme close-up gliding slowly sideways across the cane mesh of the backrest, the light catching each woven strand and the edge of the teak frame.\n[Shot 3] At 00:03.500, the shot cuts to a low angle at floor level: <Subject 1> stands tall against the glass roof and the balconies of <Subject 2>; the camera remains fixed and holds this hero shot to the end.\n\noverall_soundscape:\nThe airy hush of a large hall with faint, distant footsteps, a soft creak of cane and wood, and a light tap of wood on concrete at each cut.\n\nnon_diegetic_music:\nA minimal, warm electronic track at a moderate tempo with a soft kick on each cut, ending on a held chord."
 },
 "inputs": {
  "ref_image_149": {
   "need": "one product on a plain background",
   "source": "asset:6504516c0115ed9b83b2d82e1d94c4ec.webp"
  },
  "ref_image_150": {
   "need": "a recognisable place",
   "source": "asset:agora_ecole_de_design1.jpg"
  }
 },
 "keepRuntime": false,
 "estSec": 161,
 "sources": [
  "https://huggingface.co/Pika-Labs/Pika-H3-Flex",
  "https://github.com/Pika-Labs/Pika-H3-Flex/blob/main/docs/prompt-guidance.md",
  "https://docs.comfy.org/tutorials/video/pika/pika-h3-flex",
  "https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/docs/VIDEO_PROMPT_WRITING_GUIDE_ref_en.md"
 ]
}
```

## video_minimax_h3_seamless_loop

**What the model is good at** (with sources): the [ComfyUI-MiniMaxH3-Loop](https://github.com/pxl-pshr/ComfyUI-MiniMaxH3-Loop) pack samples H3 with the end of the latent wrapped around to its start, decodes with wrapped context and interpolates across the joint, so the last frame flows into the first — "no first frame / last frame, no second pass, no crossfade"; `views 2` also samples a half-rotated view and takes the audio at the joint from it, "which keeps the sound clean there" ([README](https://github.com/pxl-pshr/ComfyUI-MiniMaxH3-Loop)). This card: ref2va weights + lightx2v ref2v turbo 8-step **v1.1** ("removed the v1.0 judder"). What loops: "one large, clear subject doing one continuous or cyclic thing", a locked-off camera, a steady soundscape; what doesn't: one-off events, speech, timelines ([PROMPTING.md](https://github.com/pxl-pshr/ComfyUI-MiniMaxH3-Loop/blob/main/PROMPTING.md)). The author lists a **sleeping cat** among his tested loops ([README](https://github.com/pxl-pshr/ComfyUI-MiniMaxH3-Loop)).

**Showcase idea**: text only — a ginger cat asleep in a sunbeam on a windowsill, flank rising and falling, whiskers trembling, a lace curtain swaying, dust drifting, and a **steady purr** as the soundtrack. A student can set it to repeat and look for the joint in both picture and sound. Fixes the previous prompt's two rule-breakers (rain = "fine turbulent texture" that pops at the joint, and a one-off foghorn), and leaves the reference-picture loop to the FastH3 card.

**Inputs**: `ref_image_7` — empty (`null`): this card's showcase is the text-only loop.

**Expected result / how to judge it**: 1024×576, 102 loop frames → 204 at 48 fps (4.25 s); the change from last frame to first is no larger than between neighbouring frames; the purr continues across the wrap with no level spike; the cat never wakes, blinks or moves its tail.

**Risks**: the seed "decides a lot" ([README](https://github.com/pxl-pshr/ComfyUI-MiniMaxH3-Loop)) and there is one run; the curtain is a soft secondary texture that could shift pattern at the joint.

**Links to fix**: none.

```json
{
 "workflow": "video_minimax_h3_seamless_loop",
 "title": "Make a video that loops forever",
 "summary": "Describe something that keeps going — breathing, swaying, spinning — and get a clip with sound whose end flows straight back into its start, so it can play endlessly. Takes about four minutes.",
 "note": "Set this clip to repeat and try to spot where it restarts: the breathing, the dust and the purr carry straight on. That is what this card is for — a loop with no visible seam, made from one paragraph of text.",
 "params": {
  "ref_image_7": null,
  "prompt_8": "Locked-off static camera, no pan, no zoom. A sunny windowsill in a quiet room in the late afternoon, warm golden light falling through a white lace curtain. A fluffy ginger cat lies curled up asleep on a folded wool blanket in the center of frame, its flank rising and falling in a slow, steady breathing rhythm and its whiskers trembling softly with each breath. The lace curtain sways very gently in a constant breeze, and specks of dust drift slowly through the sunbeam. Steady, unchanging light. Continuous, smooth, unbroken motion throughout.\n\noverall_soundscape: a soft, steady, continuous purr, quiet room tone, a faint constant breeze at the window.\n\nnon_diegetic_music: N/A"
 },
 "inputs": {
  "ref_image_7": {
   "need": "none — text-only loop",
   "source": "null"
  }
 },
 "keepRuntime": false,
 "estSec": 251,
 "sources": [
  "https://github.com/pxl-pshr/ComfyUI-MiniMaxH3-Loop",
  "https://github.com/pxl-pshr/ComfyUI-MiniMaxH3-Loop/blob/main/PROMPTING.md",
  "https://huggingface.co/lightx2v/Minimax-h3-Turbo"
 ]
}
```

## video_minimax_h3_seamless_loop_fasth3

**What the model is good at** (with sources): the same loop pack on **FastH3-Omni** (8 steps). The pack author: "close to the 25-step look **with a reference image**, a bit punchier; text-only prompts give a different shot. Slight judder on fast motion; slow flows stay smooth"; and "a reference image (`<Picture 1>`) holds the subject and look … prefer it for loops from an image" over first-frame anchors, which make the joint jump ([README](https://github.com/pxl-pshr/ComfyUI-MiniMaxH3-Loop)). Previous run: it held the reference's composition "a little closer" than the other loop card. So this card's showcase is **a picture turned into an endless loop** (the owner's own request, CLAUDE.md 2026-11-03).

**Showcase idea**: a dreamlike alien valley (mossy terraces, crystal spires, floating iridescent bubble-creatures) becomes a living, endlessly looping world: the creatures bob and pulse, high balloon-organisms circle the spires, glowing specks rise, over a steady airy drone. Every motion is cyclic and slow (FastH3's strong case), the subjects are large, and nothing one-way happens. The picture is described as `<Picture 1>`, never as a first frame, as the guide requires.

**Inputs**: `ref_image_7` — a picture with large, clearly separable subjects that can move in place — asset:a-landscape-of-a-futuristic-land-of-aerial-waves-with-living-organisms-floating-in-the-air-and-incr-159032455.png (1000×1000; opened: two big pink-silver bubble creatures in the foreground, balloon organisms and spires behind, violet mist).

**Expected result / how to judge it**: 1024×576, 4.25 s at 48 fps; colours, moss terraces, spires and bubble creatures recognisably from the picture; seamless joint (as above); steady drone with no spike at the wrap.

**Risks**: the square reference is recomposed into 16:9 (it is a reference, not a frame, so that is expected); tiny specks are "fine texture" and may change pattern at the joint; seed sensitivity.

**Links to fix**: none (already uses the renamed `FastH3-Omni-Comfy` repo).

```json
{
 "workflow": "video_minimax_h3_seamless_loop_fasth3",
 "title": "Loop a picture into endless motion",
 "summary": "Upload a picture and describe gentle, repeating motion; you get a seamless looping clip with sound that keeps the picture's world and look — like a living poster or a website background.",
 "note": "One still picture became a world that moves forever: the creatures bob and breathe, and the clip has no visible start or end. Compare it with the picture — the colours and shapes are the same.",
 "params": {
  "ref_image_7": "asset:a-landscape-of-a-futuristic-land-of-aerial-waves-with-living-organisms-floating-in-the-air-and-incr-159032455.png",
  "prompt_8": "Locked-off static camera, no pan, no zoom. The dreamlike alien valley of <Picture 1>: soft yellow-green moss terraces, tall blue crystal spires and a misty violet horizon under a pale turquoise sky. The large iridescent bubble creatures from <Picture 1> float above the moss, each one bobbing gently up and down in a slow, steady rhythm, their glassy pink-and-silver domes pulsing softly as if breathing and the thin tendrils below them swaying. High above, the tall balloon-like organisms drift in a slow, steady circle around the spires. Tiny glowing specks float slowly upward through soft shafts of light. Steady, unchanging light. Continuous, smooth, unbroken motion throughout.\n\noverall_soundscape: a soft, steady airy drone, a faint continuous shimmer like distant glass chimes, a gentle constant breeze over the moss.\n\nnon_diegetic_music: N/A"
 },
 "inputs": {
  "ref_image_7": {
   "need": "a picture with large subjects that can move in place (bob, sway, pulse)",
   "source": "asset:a-landscape-of-a-futuristic-land-of-aerial-waves-with-living-organisms-floating-in-the-air-and-incr-159032455.png"
  }
 },
 "keepRuntime": false,
 "estSec": 258,
 "sources": [
  "https://github.com/pxl-pshr/ComfyUI-MiniMaxH3-Loop",
  "https://github.com/pxl-pshr/ComfyUI-MiniMaxH3-Loop/blob/main/PROMPTING.md",
  "https://huggingface.co/FastVideo/FastH3-Omni-Comfy"
 ]
}
```

## video_edit_minimax_h3_loop_restyle

**What the model is good at** (with sources): the loop pack's **Control** workflow — ref2va + turbo 8-step v1.0 + the H3 **Fun ControlNet Union**. "If you already have a seamless loop (a Blender render, a depth or edge pass), H3 can restyle it while your loop fixes the geometry and timing. In our tests this gave the cleanest loop points, and it handles camera travel (tunnels, corridors) that text prompts struggle with"; "a depth pass works well for rendered 3D loops"; "a 34-frame cycle fits length 107 (3 cycles)" with no blending ([README](https://github.com/pxl-pshr/ComfyUI-MiniMaxH3-Loop), Control example note). `MiniMaxH3LoopControlVideo` takes "one or more whole cycles of a seamless loop (frame N+1 == frame 1, not included)" and resamples it to the loop (pack source). The Fun ControlNet is trained on Canny, Depth, HED, MLSD and Pose maps ([model card](https://huggingface.co/alibaba-pai/MiniMax-H3-Fun-Controlnet-Union)), not on RGB.

**Showcase idea**: feed it what it is designed for — a **depth-pass loop of camera travel** — and show the one thing a prompt alone cannot loop: flying forever down a corridor. The control is a synthetic grey depth render of a square corridor ribbed with identical square frames, the camera advancing exactly one rib per 34 frames (3 per loop). The prompt repaints it as a mossy stone temple corridor lit by torches. The previous run fed an RGB loop (out of the ControlNet's training distribution) and got a look that "reads more illustrated than impasto" — this avoids that.

**Inputs**: `control_video_34` — a seamless depth loop, 24 fps, whole cycles, no audio — **NEW**, synthesized (spec below; a working generator is at `(scratchpad)/research\g3_tunnel_depth_loop.py`, verified: 102 frames, 1024×576, 24 fps, frame-after-last identical to frame 0).

**Expected result / how to judge it**: 1024×576 → 48 fps, 4.25 s; the camera passes three arches per loop in step with the control; stone, moss, ferns and torches instead of grey; the loop point invisible in the picture.

**Risks**: clean-sound mode is off on this card ("cannot be combined with the ControlNet", meta), and the pack documents that with one view "H3's audio stream turns loud and garbled" around the wrap ([README](https://github.com/pxl-pshr/ComfyUI-MiniMaxH3-Loop)) — a steady cave drone hides it best, but listen at the joint. The generator is new code: its output is a plausible depth pass, not a real render. **Fallback:** `output:video_minimax_h3_seamless_loop` (the RGB cat loop, known to work on this card) with a matching prompt, e.g. "…the sleeping cat from the source, carved as a glazed ceramic figurine on a ceramic windowsill…".

**Links to fix**: none dead. The bundled Fun ControlNet is the **v1 "legacy"** checkpoint; alibaba-pai now recommends [2.0](https://huggingface.co/alibaba-pai/MiniMax-H3-Fun-Controlnet-Union-2.0) (10 control blocks, 8 conditions) — whether ComfyUI's patch loader supports it was not checked.

```json
{
 "workflow": "video_edit_minimax_h3_loop_restyle",
 "title": "Repaint a loop, keep it seamless",
 "summary": "Upload a video that already loops — a simple 3D or depth animation works best — and describe a new look; the motion is kept, everything is repainted with new sound, and it still loops.",
 "note": "The input was a plain grey depth animation of a corridor; the result is an endless flight through a torch-lit stone temple. Set it to repeat: you fly forward forever, because the motion came from a loop.",
 "params": {
  "control_video_34": "NEW:synth_tunnel_depth_loop.mp4",
  "prompt_8": "Smooth camera gliding forward at a slow, perfectly constant speed down an endless square corridor lined with identical square archways spaced at exactly even intervals, centered and level, the far end fading into darkness. Every archway is carved from ancient mossy stone, its edges overgrown with ferns and tiny glowing blue mushrooms, and a torch burns steadily on each side of every arch so that pools of warm firelight repeat in a steady rhythm along the stone walls. A thin mist hangs between the arches and catches the light. The camera stays centered and level: no turns, no change in speed. Nothing appears, opens or changes. Continuous, smooth, unbroken forward motion throughout.\n\noverall_soundscape: a deep steady cave ambience, a soft continuous crackle of torches, a constant low wind breathing through the arches, a faint steady trickle of water.\n\nnon_diegetic_music: N/A"
 },
 "inputs": {
  "control_video_34": {
   "need": "a seamless DEPTH loop (near white, far black) of forward camera travel through a repeating square corridor; 24 fps, whole cycles, no duplicated closing frame",
   "source": "NEW: synthesize with g3_tunnel_depth_loop.py (1024x576, 24 fps, 34-frame cycle x 3 = 102 frames, H.264, no audio); fallback output:video_minimax_h3_seamless_loop"
  }
 },
 "keepRuntime": false,
 "estSec": 170,
 "sources": [
  "https://github.com/pxl-pshr/ComfyUI-MiniMaxH3-Loop",
  "https://github.com/pxl-pshr/ComfyUI-MiniMaxH3-Loop/blob/main/PROMPTING.md",
  "https://huggingface.co/alibaba-pai/MiniMax-H3-Fun-Controlnet-Union",
  "https://huggingface.co/alibaba-pai/MiniMax-H3-Fun-Controlnet-Union-2.0",
  "https://docs.comfy.org/tutorials/video/minimax/minimax-h3-fun-controlnet"
 ]
}
```

## video_edit_minimax_h3_v2v_video_reference

**What the model is good at** (with sources): H3's `ref2va` weights with the source clip as `<Video 1>`. The reference guide reserves `<Video N>` for editing an original video, continuing from its end, or referencing its camera movement, cuts and rhythm, with the task prefix `[video editing]` and, for edits, a summary that begins "The target video is an edited version of <Video 1>." ([ref guide](https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/docs/VIDEO_PROMPT_WRITING_GUIDE_ref_en.md) §2.3, §3). The official examples of video editing are **targeted** edits: MiniMax's README Ref2VA case keeps <Video 1> `fully_preserved` and only makes the man speak a new line ([H3 card](https://huggingface.co/MiniMaxAI/MiniMax-H3), *Reproducible 768p cases*); Pika's guide shows removing one person (`removed`, `partially_preserved`) and **replacing an identity while preserving the action and scene** (Example 8) ([Pika guide](https://github.com/Pika-Labs/Pika-H3-Flex/blob/main/docs/prompt-guidance.md)). The MiniMax blog cites "V2V motion transfer" ([blog](https://www.minimax.io/blog/minimax-h3)).

### Why the last run returned its source unchanged

It was given the LTX keeper walk and asked for claymation. Four things in that request point the model toward reconstruction, each checked against the code or a primary source (none can be *proven* without a run, and the GPU is busy):

1. **The tag was not the tag.** ComfyUI writes the literal string `"<Video 1>: "` in front of the clip's vision tokens (`comfy/text_encoders/minimax.py`). The prompt said `Video 1` — no angle brackets — so the instruction never named the token the model sees. ComfyUI's own R2V note: "very sensitive to prompt wording; matching the reference tags precisely … works best" ([template](https://github.com/Comfy-Org/workflow_templates/blob/main/templates/video_minimax_h3_r2v.json)).
2. **Not the trained format.** It used `[subject_definitions]`-style bracket headers and an `[audio]` section; the trained form is `subject_definitions:` … `non_diegetic_music:` with a task prefix (`[video editing]`) and the opening sentence above ([ref guide](https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/docs/VIDEO_PROMPT_WRITING_GUIDE_ref_en.md), [H3 skill](https://github.com/MiniMax-AI/MiniMax-H3/blob/main/skills/h3-prompt-writing/SKILL.md)). The card's **default** prompt has the same problems, so the card teaches students the wrong form.
3. **The wrong kind of edit for this card.** A global restyle ("replace every surface with sculpted clay") while *retaining* walk, swing, camera and timing leaves nothing nameable to change; with a clean copy of the whole source re-injected at every step (`minimax_refs` in `nodes_minimax_h3.py`), copying it is the easy answer. Pika: the markers "express prompt intent, not deterministic editing". Whole-clip restyles are what the canny/depth cards do well (claymation succeeded there).
4. **Settings that favour holding the reference.** 20 steps on `simple`; ComfyUI's R2V note says `beta` or `normal` "tends to outperform `simple` for reference-heavy prompts" (not exposed on the card), and ComfyUI says the 4-step turbo gives "weaker reference/audio" ([Comfy native](https://docs.comfy.org/tutorials/video/minimax/minimax-h3-native)) — the one lever a student has if it still copies.

**Showcase idea**: the edit this card exists for, written exactly in the trained form: **the same rooftop clip, the same dance, the same handheld camera — but the dancer is now a knight in polished plate armour**, armour clanking on every move over a new hip-hop beat. Pika's Example 8 pattern: `<Subject 1>` marked `removed`, `<Subject 2>` `attribute_transfer`, `<Video 1>` `partially_preserved`. The rooftop, chimney and sky staying identical proves it is an *edit of this video*; the pose card gets the same clip and keeps only the moves, so students see the difference.

**Inputs**: `loadvideo_file_147` — one person dancing, full body, clear background, ≥ 6 s — asset:2795750-uhd_3840_2160_25fps_1_1.mp4 (720×720, 25 fps, 8.7 s; frames checked: bearded man in a black tracksuit with red sleeve stripes, flat rooftop, brick chimney, overcast skyline). Aspect set to `1:1 (Square)` to match the clip (0.4 MP either way).

**Expected result / how to judge it**: 640×640, 5.17 s. **Pass:** the rooftop, chimney and sky match the source frame-for-frame in layout; the figure is a steel knight with a red plume in every frame; poses at 1, 2, 3, 4 s match the dancer's. **Fail (the documented failure):** the output is the source again — mean difference to the source frames near zero, or a black tracksuit visible. Sound: metallic clanks on the moves, a beat.

**Risks**: it may still copy. Next steps in order: (a) Fast mode on (4 steps instead of 20: weaker hold and far cheaper); (b) recast as `[reference generation]` with `<Subject 2> is the dance performance from <Video 1>` → `attribute_transfer`, "keep the source dancer … out of the target" (Pika Example 3); (c) expose the scheduler and try `beta`. The source is 25 fps and H3 reads reference video as 24 fps ("convert other frame rates to 24fps", [Comfy native](https://docs.comfy.org/tutorials/video/minimax/minimax-h3-native)) — 4% slow-down, harmless. Cost: the 720² reference is lighter than last run's 1280×704, so expect well under the 600 s measured then (~420 s estimated); the runtime it records will be optimistic for HD sources.

**Links to fix**: rewrite the **default prompt** in the trained form (tags `<Video 1>`, `subject_definitions:` sections, `[video editing]`, the opening sentence, `overall_soundscape` / `non_diegetic_music`). The description's "replaces … style" oversells: say it is best for replacing a person/object/setting, and point whole-clip restyles to the canny/depth cards. Idea: wire the clip's soundtrack to `ref_video_audios.ref_video_audio_0` so `[video editing + audio reuse]` becomes possible (official README example).

```json
{
 "workflow": "video_edit_minimax_h3_v2v_video_reference",
 "title": "Change one thing in a video",
 "summary": "Upload a clip and say what to swap — the person, a costume, an object, the setting — and what to keep; you get the same shot, the same moves and timing, with your change and a new soundtrack. Slow (several minutes).",
 "note": "Same rooftop, same handheld camera, same dance — only the dancer changed, into a knight whose armour clanks on every move. Compare with the pose card's example from the same clip, which keeps only the moves.",
 "params": {
  "loadvideo_file_147": "asset:2795750-uhd_3840_2160_25fps_1_1.mp4",
  "resolutionselector_aspect_ratio_115": "1:1 (Square)",
  "primitivestringmultiline_value_138": "subject_definitions:\n<Video 1> is the source video for the edit: one continuous handheld shot of a man dancing on a flat grey rooftop under an overcast sky, with brick factory buildings, a tall brick chimney and a city skyline behind him.\n<Subject 1> is the dancer in <Video 1>: a bearded man in a black tracksuit with red stripes on the sleeves and black sneakers, selected for replacement.\n<Subject 2> is a knight in full polished steel plate armour with a closed visor helmet topped by a red plume and a red cloth tabard over the breastplate, replacing <Subject 1>.\n\nsummary:\n[video editing] The target video is an edited version of <Video 1>. <Subject 2> replaces <Subject 1> and performs exactly the same dance on the same rooftop, while the rooftop, the brick buildings, the chimney, the cloudy sky, the handheld camera and the timing of <Video 1> are kept.\n\nretention_analysis:\n<Video 1> (rooftop setting, camera movement and timing): partially_preserved - keep the rooftop, the background buildings, the chimney, the overcast light, the framing, the handheld camera movement and the exact timing of every move; change only the dancer.\n<Subject 1>: removed - the man in the black tracksuit does not appear in any frame of the target video.\n<Subject 2> (appears in [Shot 1]): attribute_transfer - the knight takes over every step, arm wave, body pop, squat and pose of the dance of <Subject 1>, in the same positions and at the same moments.\n\ndetailed_description:\nThe target video keeps the live-action, overcast, slightly desaturated look of <Video 1>.\n[Shot 1] Follow the framing, the handheld camera movement and the action timing of <Video 1>. On the grey rooftop, in front of the brick factory buildings and the tall chimney, <Subject 2> dances in place of <Subject 1>: the knight in polished steel plate armour, closed visor and red-plumed helmet sweeps his armoured arms out wide, pops his chest, raises one gauntlet high, drops into a wide squat and steps from side to side exactly as the original dancer does, the red tabard swinging with each move and the cloudy daylight sliding across the steel. Only the knight is visible, from the first frame to the last.\n\noverall_soundscape:\nMetal plates clank and scrape in time with every step and arm movement, steel boots ring on the rooftop, and a steady city wind blows over the roof with distant traffic far below.\n\nnon_diegetic_music:\nAn upbeat hip-hop drum beat at a moderate tempo with a deep kick and a crisp snare that hits on the sharpest moves."
 },
 "inputs": {
  "loadvideo_file_147": {
   "need": "one person dancing, full body visible, uncluttered background, at least 6 s",
   "source": "asset:2795750-uhd_3840_2160_25fps_1_1.mp4"
  }
 },
 "keepRuntime": false,
 "estSec": 420,
 "sources": [
  "https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/docs/VIDEO_PROMPT_WRITING_GUIDE_ref_en.md",
  "https://huggingface.co/MiniMaxAI/MiniMax-H3",
  "https://github.com/Pika-Labs/Pika-H3-Flex/blob/main/docs/prompt-guidance.md",
  "https://www.minimax.io/blog/minimax-h3",
  "https://docs.comfy.org/tutorials/video/minimax/minimax-h3-native",
  "https://docs.comfy.org/tutorials/video/minimax/minimax-h3-prompt-guide",
  "https://github.com/Comfy-Org/workflow_templates/blob/main/templates/video_minimax_h3_r2v.json",
  "https://github.com/MiniMax-AI/MiniMax-H3/blob/main/skills/h3-prompt-writing/SKILL.md"
 ]
}
```

## video_edit_minimax_h3_fun_controlnet_canny

**What the model is good at** (with sources): alibaba-pai's **MiniMax-H3 Fun ControlNet Union** — one branch conditioning H3 on Canny/Depth/HED/MLSD/Pose, guidance-distilled, **`control_apply_audio = false`** (the control never touches the soundtrack; audio comes from the prompt) ([model card](https://huggingface.co/alibaba-pai/MiniMax-H3-Fun-Controlnet-Union), [2.0 card](https://huggingface.co/alibaba-pai/MiniMax-H3-Fun-Controlnet-Union-2.0)). Canny keeps every outline, so silhouettes, clothing patterns and architectural lines land exactly where they were. "Detailed prompts give better stability; we recommend describing the scene, the subject and the camera in the prompt" ([model card](https://huggingface.co/alibaba-pai/MiniMax-H3-Fun-Controlnet-Union)); the training example prompt is plain descriptive prose ([VideoX-Fun](https://github.com/aigc-apps/VideoX-Fun/blob/main/examples/minimax_h3_fun/predict_v2v_control.py)). Previous run: canny gave "the most convincingly clay" result of all six restyles — **but near-silent audio**.

**Showcase idea**: a dancer in a bold checked dress and striped tights, in front of a brutalist wall pierced by rows of square skylights, becomes a **claymation** film where the checks, the stripes and the skylight squares are sculpted exactly where they were — the outline-faithfulness only canny gives — with squishy clay footsteps, claps and a marimba tune. Plays to the documented strength (clay) and fixes the documented weakness (silence) by writing the audio in the trained `overall_soundscape:` / `non_diegetic_music:` fields instead of an `Audio:` line.

**Inputs**: `loadvideo_file_174` — a clip at 24 fps with strong, clean outlines and patterns — `asset:3044160-uhd_3840_2160_24fps_5_1.mp4` (720×720, 24 fps, 17 s, no audio; frames checked). Aspect `1:1 (Square)`: the card centre-crops to the chosen shape, and 16:9 would cut her head and feet.

**Expected result / how to judge it**: 640×640, 5.17 s; plasticine surfaces with thumbprints; the check pattern and the tights' stripes in the same places as in the source at 1 s and 4 s; the skylight squares present; same dance timing; soundtrack clearly audible (RMS well above last run's near-silence).

**Risks**: dense plaid edges may make the clay busy or flicker (the thresholds stay at the card defaults 0.4/0.8 for calibration); if audio is still near-silent, the cause is not the prompt format.

**Links to fix**: ⚠ the **default prompt** (copied from ComfyUI's union template) uses time ranges `[0s-2s]` and a `Negative:` line — ComfyUI's own H3 prompt guide says to use a single timestamp, not a range, and that negatives "add unwanted concepts" because there is no negative branch ([Comfy prompt guide](https://docs.comfy.org/tutorials/video/minimax/minimax-h3-prompt-guide)). Rewrite in prose plus the two sound fields. The promptGuide points to the **ref** guide, whose six sections do not apply to a run with no references; add ComfyUI's Fun-ControlNet page (https://docs.comfy.org/tutorials/video/minimax/minimax-h3-fun-controlnet). v1 is "legacy" upstream ([2.0](https://huggingface.co/alibaba-pai/MiniMax-H3-Fun-Controlnet-Union-2.0)).

```json
{
 "workflow": "video_edit_minimax_h3_fun_controlnet_canny",
 "title": "Restyle a video, keep its outlines",
 "summary": "Upload a clip and describe a new look; every outline of the original — clothing patterns, buildings, edges — is followed exactly, while colours, materials and sound are all new.",
 "note": "Every check on her dress, every stripe on her tights and every square in the wall is still where it was in the real footage — now sculpted in clay. That precision comes from following the clip's outlines.",
 "params": {
  "loadvideo_file_174": "asset:3044160-uhd_3840_2160_24fps_5_1.mp4",
  "resolutionselector_aspect_ratio_115": "1:1 (Square)",
  "primitivestringmultiline_value_138": "A hand-crafted claymation stop-motion film: everything is sculpted from soft matte plasticine with visible thumbprints and tool marks, lit by warm soft studio lights. A clay woman with a bright orange head wrap, a shiny black clay jacket, a yellow-and-orange checked clay dress and orange-and-black striped clay tights dances on a plaza of grey clay tiles, in front of a huge slanted clay wall pierced by rows of small square windows, with puffy green clay trees on the right and a slope of rough clay pebbles on the left. She sways her hips, swings her arms, points and claps, and every check of her dress and every stripe of her tights stays sculpted exactly in place as she moves. The camera stays at a fixed medium-wide angle.\n\noverall_soundscape: Soft squishy clay footsteps on the clay tiles in time with her steps, the light pat of her clay hands clapping, and a quiet studio room tone.\n\nnon_diegetic_music: A cheerful marimba and ukulele tune at an upbeat tempo with a light hand-clap rhythm."
 },
 "inputs": {
  "loadvideo_file_174": {
   "need": "a 24 fps clip with clean, strong outlines and patterns, subject fully in a square frame",
   "source": "asset:3044160-uhd_3840_2160_24fps_5_1.mp4"
  }
 },
 "keepRuntime": false,
 "estSec": 155,
 "sources": [
  "https://huggingface.co/alibaba-pai/MiniMax-H3-Fun-Controlnet-Union",
  "https://huggingface.co/alibaba-pai/MiniMax-H3-Fun-Controlnet-Union-2.0",
  "https://github.com/aigc-apps/VideoX-Fun/blob/main/examples/minimax_h3_fun/predict_v2v_control.py",
  "https://docs.comfy.org/tutorials/video/minimax/minimax-h3-fun-controlnet",
  "https://docs.comfy.org/tutorials/video/minimax/minimax-h3-prompt-guide"
 ]
}
```

## video_edit_minimax_h3_fun_controlnet_depth

**What the model is good at** (with sources): the same Fun ControlNet fed a temporally stable **Video Depth Anything** map ([Video-Depth-Anything-Small](https://huggingface.co/depth-anything/Video-Depth-Anything-Small)). Depth fixes 3D layout, distances and camera move but leaves surfaces free — the card's own words: "fine textures and small details are free to change, which makes it the better choice for noisy or grainy footage" (meta). ComfyUI recommends depth for rendered 3D material ([loop pack](https://github.com/pxl-pshr/ComfyUI-MiniMaxH3-Loop): "a depth pass works well for rendered 3D loops"; [Comfy Fun ControlNet](https://docs.comfy.org/tutorials/video/minimax/minimax-h3-fun-controlnet)). Previous run: depth kept the figure but made "a more realistic sea" — i.e. it lets materials go where the prompt sends them.

**Showcase idea**: a **material swap on a 3D render**: the assets' rough grey container-ship render (the input the 3DReal card turns photoreal) becomes a **knitted-wool toy ship** on a sea of blue yarn — containers in striped cable-knit, a crocheted bridge tower with button windows, woolly foam — while the hull shape, the container stacks and the camera's push toward them stay exactly as rendered. Shows the depth idea (shapes kept, every surface new) where canny would also have kept the render's flat panel lines.

**Inputs**: `loadvideo_file_174` — a clip whose 3D shapes and camera move matter more than its surfaces — `asset:rough3Drender.mp4` (578×314 ≈ 16:9, 30 fps, 10.3 s, grey untextured; frames checked: side view, then a push in on the container stacks). Default 16:9. At 30 fps the frames play at 24 → 0.8× speed (a slower, calmer camera).

**Expected result / how to judge it**: 864×480, 5.17 s; ship silhouette, stacks and stern tower where they are in the render (compare 0 s and 3 s); knit/crochet texture on every surface; the camera push matches; soft woolly sea sounds, one horn, music-box tune.

**Risks**: depth of a flat grey render can lack fine depth on the container doors (stacks may merge into blocks); the sea surface in the render is flat, so "waves" may be weak.

**Links to fix**: same as canny (default prompt uses ranges and `Negative:`; promptGuide points to the ref guide; v1 "legacy"). The model entry for `video_depth_anything_vits.pth` has a `source` only (fine).

```json
{
 "workflow": "video_edit_minimax_h3_fun_controlnet_depth",
 "title": "Restyle a video, keep its shapes",
 "summary": "Upload a clip and describe a new world; the 3D shapes, distances and camera move are kept while every surface and material can change — good for 3D renders and noisy footage.",
 "note": "A grey, untextured 3D render of a cargo ship became a knitted toy ship on a sea of yarn. The shapes and the camera move are the render's; every surface, colour and sound is new.",
 "params": {
  "loadvideo_file_174": "asset:rough3Drender.mp4",
  "primitivestringmultiline_value_138": "A cosy handmade textile miniature: everything is knitted and crocheted from soft wool yarn, filmed like a macro stop-motion film with warm soft light and a shallow depth of field. A large cargo ship knitted from chunky red and navy wool sails through a sea of rippling blue yarn, its deck stacked high with rows of shipping containers knitted in mustard, teal, coral and cream stripes, each container showing little knitted ridges and cable stitches. The bridge tower at the stern is crocheted in white wool with tiny button windows. Gentle waves of loose blue yarn and fluffy white wool foam roll along the hull. The camera glides along the side of the ship and pushes in toward the stacked containers.\n\noverall_soundscape: A soft, muffled woolly sea: gentle fuzzy waves, a slow wooden creak of the hull, the faint clicking of knitting needles, and one deep, friendly ship's horn.\n\nnon_diegetic_music: A gentle music-box version of a sea shanty at a slow tempo."
 },
 "inputs": {
  "loadvideo_file_174": {
   "need": "a clip whose 3D shapes and camera move matter more than its surfaces (a 3D render is ideal)",
   "source": "asset:rough3Drender.mp4"
  }
 },
 "keepRuntime": false,
 "estSec": 175,
 "sources": [
  "https://huggingface.co/alibaba-pai/MiniMax-H3-Fun-Controlnet-Union",
  "https://huggingface.co/alibaba-pai/MiniMax-H3-Fun-Controlnet-Union-2.0",
  "https://docs.comfy.org/tutorials/video/minimax/minimax-h3-fun-controlnet",
  "https://github.com/pxl-pshr/ComfyUI-MiniMaxH3-Loop",
  "https://huggingface.co/depth-anything/Video-Depth-Anything-Small",
  "https://docs.comfy.org/tutorials/video/minimax/minimax-h3-prompt-guide"
 ]
}
```

## video_edit_minimax_h3_fun_controlnet_union

**What the model is good at** (with sources): the Fun ControlNet in **pose** mode: RT-DETR finds people and SDPose draws whole-body skeletons (body, hands, face, feet) as the control, exactly as ComfyUI's official template does ([Comfy Fun ControlNet](https://docs.comfy.org/tutorials/video/minimax/minimax-h3-fun-controlnet), template note); "the output reproduces the dancer's motion" while clothing, face, background and lighting come from the prompt. Previous run: a chrome robot walking the pier, good. A walk is the weakest demo of pose transfer; a **dance** with big arm and leg shapes is the strongest.

**Showcase idea**: the rooftop dancer's routine performed by an **astronaut on the Moon** — gold visor, bulky suit, Earth in the black sky, every step kicking up slow lunar dust — with helmet breathing, radio static and a filtered funk groove. Nothing of the source is kept except the moves, which is the point (the v2v card gets the same clip and keeps the rooftop).

**Inputs**: `loadvideo_file_174` — one person, full body, clearly visible, dancing — asset:2795750-uhd_3840_2160_25fps_1_1.mp4. Aspect `1:1 (Square)` so the centre-crop does not cut off his head and feet. Max people stays 2 (one dancer).

**Expected result / how to judge it**: 640×640, 5.17 s; arm raises, the wide squat and side steps at the same moments as the source; a spacesuit, lunar ground, Earth visible; dust puffs at footfalls; breathing + beat audible.

**Risks**: SDPose may lose hands in fast waves (the hand pose then drifts); a bulky suit fights thin-limb skeletons; 25 fps source read as 24 (4% slower).

**Links to fix**: same as canny (prompt ranges/`Negative:`, ref-guide link, v1 legacy). The `name` says "(pose)" but the id says `union` — fine, the name is right.

```json
{
 "workflow": "video_edit_minimax_h3_fun_controlnet_union",
 "title": "Copy someone's moves onto anyone",
 "summary": "Upload a video of a person moving and describe who should move like that, and where; you get a new character doing exactly the same moves, with new sound.",
 "note": "The moves are the rooftop dancer's — everything else is new: an astronaut dancing on the Moon. Compare with the 'change one thing' card, which kept his rooftop and swapped only the dancer.",
 "params": {
  "loadvideo_file_174": "asset:2795750-uhd_3840_2160_25fps_1_1.mp4",
  "resolutionselector_aspect_ratio_115": "1:1 (Square)",
  "primitivestringmultiline_value_138": "Live-action, cinematic science-fiction look, hard white sunlight and deep black shadows. On the grey, dusty surface of the Moon, with craters stretching to a black starry horizon and the blue Earth hanging low in the sky, an astronaut in a bulky white spacesuit with a gold mirrored visor and a small backpack dances with big, bouncy moves: he sweeps his arms out wide, pops his chest, raises one gloved hand high, drops into a wide squat and steps from side to side, and every footstep kicks up a slow puff of moon dust that hangs in the low gravity. His visor reflects the Earth as he turns. The camera follows him from a slightly low angle with a gentle handheld sway.\n\noverall_soundscape: The muffled sound of his own breathing inside the helmet, the soft hiss of the suit's air supply, dull crunchy footsteps in the dust, and short bursts of radio static.\n\nnon_diegetic_music: A funky electric-bass and drum-machine groove at a moderate tempo, slightly filtered as if heard through a helmet radio."
 },
 "inputs": {
  "loadvideo_file_174": {
   "need": "one person, whole body visible, dancing with big arm and leg shapes",
   "source": "asset:2795750-uhd_3840_2160_25fps_1_1.mp4"
  }
 },
 "keepRuntime": false,
 "estSec": 222,
 "sources": [
  "https://docs.comfy.org/tutorials/video/minimax/minimax-h3-fun-controlnet",
  "https://huggingface.co/alibaba-pai/MiniMax-H3-Fun-Controlnet-Union",
  "https://huggingface.co/Comfy-Org/SDPose",
  "https://docs.comfy.org/tutorials/video/minimax/minimax-h3-prompt-guide"
 ]
}
```

## Upstream inputs this group needs

Everything else is an asset in `J:\_assets` (all opened and checked). Only two inputs come from outside the group:

1. **`output:image_ideogram4_t2i`** → `video_fastvideo_fasth3_i2v.loadimage_image_300` (last frame). Needs: a finished poster with a large, legible title in clean type. Any Ideogram showcase poster works — the L2VA prompt is generic. **Wire its aspect into `resolutionselector_aspect_ratio_143`** (Ideogram's default is 9:16 → `9:16 (Portrait Widescreen)`). Fallback: `asset:Screenshot 2025-03-06 105700.png` with `3:4 (Portrait Standard)` and a daisy-growing prompt.
2. **NEW: a synthesized seamless depth loop** → `video_edit_minimax_h3_loop_restyle.control_video_34`. Not a derivation of an output; a generator (or commit the file once as a suite fixture). Working script: `(scratchpad)/research\g3_tunnel_depth_loop.py` (run with ComfyUI's python, `-I`; uses numpy + PyAV). What it does: renders a grayscale depth pass (near = white, fading to black with distance, `exp(-(z−0.55)/2.4)`) of a square corridor whose walls carry square ribs 22% deep, one rib spacing apart; the camera advances exactly one spacing every 34 frames; writes 3 whole cycles = **102 frames, 1024×576, 24 fps, H.264 yuv420p, no audio**, with no duplicated closing frame (the frame after the last equals frame 0 — the script prints the seam difference, 0). 34 × 3 = 102 = the loop of length 107, so `MiniMaxH3LoopControlVideo` (cycles 0) fits it with no frame blending (pack source).

Optional, not required: a `video_fps {24}` derive op (resample a clip to 24 fps). H3 reads reference video as 24 fps ([Comfy native](https://docs.comfy.org/tutorials/video/minimax/minimax-h3-native)); the rooftop dancer is 25 fps (4% slow-down, harmless) and `rough3Drender.mp4` is 30 fps (0.8× on the depth card, acceptable for a slow camera move).

## Cost of this group at these settings

Warm estimates from each `runtime.json`: 30 + 35 + **125** (FastH3 t2v at 10 s, `keepRuntime`) + 59 + 66 + 140 + 160 + 161 + 251 + 258 + 170 + **~420** (v2v; lighter reference than last time) + 155 + 175 + 222 ≈ **2,430 s ≈ 41 min**, plus model loads (~30–60 s per switch between `fl2va`, `ref2va`, FastH3, FastH3-Omni and the Pika adapters — order the runs by weights to save most of them). The previous run of the same 15 cards was ≈ 42 min warm.

## Title notes for the integrator

Titles were chosen to stay distinct inside this group; likely collisions elsewhere: LTX 2.5 t2v / i2v / flf2v (say "…in HD" or "…larger" there), LTX/Wan pose cards vs "Copy someone's moves onto anyone" (the H3 one makes new sound; the Wan SCAIL one replaces a person *in* the clip), LTX IC-LoRA canny/depth vs "Restyle a video, keep its outlines / shapes" (LTX = larger frame; H3 = new soundtrack).
