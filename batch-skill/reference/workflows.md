# Workflows, sizes and durations

Everything on this page was read from the installed bundles and the live
ComfyUI node schemas. Numbers here are enforced — a value outside them is
snapped or refused, not honoured.

Re-check with:

```bash
node -e "const m=require('./workflows/<id>/<id>.meta.json');
  for (const p of m.exposedParameters) console.log(p.key, p.type, p.label, p.min, p.max, p.step)"
```

---

## The six workflows a storyboard uses

| write on the `###` line | resolves to | makes | est/shot |
|---|---|---|---|
| `image_flux2_klein_9b_t2i` | `image_flux2_klein_9b_t2i` | image from text | ~6 s |
| `image_edit_flux2_klein_9b_image_edit_ref` | same | image from **2 images** + text | ~16 s |
| `ideogram_4_t2i` | `image_ideogram4_t2i` | flat text card | ~33 s |
| `ltx_2_3_i2v` | `video_ltx2_3_i2v` | video from **1 image** | ~39 s |
| `ltx_2_3_flf2v` | `video_ltx2_3_flf2v` | video from **first + last frame** | ~33 s |
| `stable_audio_3` | `audio_stable_audio_3_medium` | music or SFX | ~16 s |

Short names resolve to the real bundle id. A name matching **more than one**
installed workflow is refused with the candidates listed — never guessed.

Estimates are **warm sampling time at the bundle's calibrated resolution**.
1920×1080 is well above that, so expect meaningfully longer — see below.

---

## Resolution — read this before writing `1920x1080`

Each workflow snaps width/height to its own grid **at submit time**. The
document says what you asked for; the job runs what the grid allows.

| workflow | real grid | `1920x1080` renders |
|---|---|---|
| `image_flux2_klein_9b_t2i` | multiples of **16**, rounded **down** | **1920×1072** ⚠ |
| `image_edit_flux2_klein_9b_image_edit_ref` | *no size control* — the graph hard-codes **1 megapixel** | source's aspect at ~1 MP (a 16:9 source → ≈**1328×753**) |
| `ideogram_4_t2i` | *no size control* — an aspect dropdown | mapped to **`16:9 (Widescreen)`** |
| `ltx_2_3_i2v` | min 512, max 1920, multiples of **64** | **1920×1088** ⚠ |
| `ltx_2_3_flf2v` | ComfyQ applies no clamp, but the model floors to **32** | **1920×1056** ⚠ |

### ⚠ `1920x1080` does not render as 1920×1080

Two different grids disagree with 1080 in **opposite directions**:

- `image_flux2_klein_9b_t2i` rounds **down to a multiple of 16** → **1072**. (Its
  `meta.json` claims `step: 8`. That is wrong — measured output at a 1080
  request is 1072, and 1080 *is* a multiple of 8. Trust the measurement.)
- `ltx_2_3_i2v` snaps to a multiple of **64** → **1088**.
- `ltx_2_3_flf2v` gets **no clamp from ComfyQ at all**, but its latent floors
  both dimensions to a multiple of **32** → **1056**, while its two guide frames
  are still resized to 1080. Three different heights from one number.

So asking for 1920×1080 gives you stills at 1072 and video at 1088 — a **16 px
mismatch between a key frame and the clip made from it**, which the video model
then has to stretch.

**Use `1920x1088` for a full-HD 16:9-ish film.** It is a multiple of 16, 32 and
64, so *every* stage renders it exactly and the stills match the clips pixel for
pixel. It is 1.765:1 rather than a true 1.778:1 — an 8 px difference at that
width, invisible in play. **This is what both examples use.**

**Rule of thumb: every video dimension must be a multiple of 32, and a multiple
of 64 on `ltx_2_3_i2v`.** Safe pairs: **1920×1088**, 1280×704, 1024×576.

### What 1920×1088 does *not* buy you

Only shots on `image_flux2_klein_9b_t2i` (the anchors) and the video output actually
render at it. **Key frames on `image_edit_flux2_klein_9b_image_edit_ref` are ~1 MP** —
about 1328×753 — because the graph hard-codes `megapixels: 1` with no exposed
control, and **cards on `ideogram_4_t2i` are ~1 MP too** (≈1344×768) for the
same reason. The video shots then upsample from those. The film's *output* is
full HD; two of its intermediate stages are not, and no storyboard attribute
can change that today.

If you need a mathematically exact 16:9 at every stage, the only value that
survives all three grids is **1024×576** (`h = w·9/16` must also be a multiple
of 64, so `w` must be a multiple of 1024; 2048 exceeds the i2v max). That is a
large drop in resolution — take it only when exactness matters more.

Verify any resolution before committing a batch:

```bash
node -e "const {clampParamValue}=require('./server/workers/localComfyUIWorker');
const m=require('./workflows/video_ltx2_3_i2v/video_ltx2_3_i2v.meta.json');
const h=m.exposedParameters.find(p=>p.label==='Height');
console.log('i2v height 1080 ->', clampParamValue(1080,h))"
```

…and check a rendered file, because a meta's declared `step` can be wrong:

```bash
node -e "const s=require('image-size'),fs=require('fs');
console.log(s(fs.readFileSync('<a rendered png>')))"
```

`ideogram_4_t2i` has no width/height at all — only an aspect dropdown that
**defaults to portrait**. Always give its cards a size so ComfyQ maps it to
`16:9 (Widescreen)`; omit it and every card comes out 9:16.

### Cost of full HD

The video bundles are calibrated near 1280×704. 1920×1088 is ~2.3× the pixels,
so budget **2–3× the per-shot estimate** and watch VRAM on a 32 GB card. If a
long batch matters more than maximum resolution, 1280×704 is on both grids and
runs far faster.

---

## Duration

| workflow | attribute | unit | bounds | rounding |
|---|---|---|---|---|
| `ltx_2_3_i2v` | `5s` | **frames** (converted) | 25 fps, 8n+1 | to the **nearest** |
| `ltx_2_3_flf2v` | `5s` | seconds | **1–10** | **down**, in the model |
| `stable_audio_3` | `45s` | seconds | **1–300** | — |

The two video workflows round in **different directions**, so the same `6s` is
**6.12 s** on `i2v` and **5.80 s** on `flf2v`.

`ltx_2_3_i2v` counts frames, not seconds. `5s` → 5 × 25 fps = 125 → snapped to
the **8n+1** grid LTX needs → **121 frames (4.84 s)**. The conversion is shown
in ComfyQ's run-order table. Useful values:

| you write | frames | real length |
|---|---|---|
| `2s` | 49 | 1.96 s |
| `3s` | 73 | 2.92 s |
| `4s` | 97 | 3.88 s |
| `5s` | 121 | 4.84 s |
| `6s` | 153 | 6.12 s |
| `7s` | 177 | 7.08 s |
| `8s` | 201 | 8.04 s |
| `10s` | 249 | 9.96 s |

Measured, not derived — the snap rounds to the nearer 8n+1 and ties go to the
shorter clip, so the drift is not monotonic (`5s` loses 0.16 s, `6s` gains
0.12 s).

**Vary clip length deliberately** — 3 s for a beat, 8 s for a held reveal. A
film of identical 5 s cuts reads as a slideshow.

`ltx_2_3_flf2v` caps at **10 s**; ask for more and it clamps silently.

---

## Media inputs, in slot order

What `ref` fills, and in what order:

| workflow | slot 1 | slot 2 |
|---|---|---|
| `image_edit_flux2_klein_9b_image_edit_ref` | **Source image** — the shot being edited | **Reference image** — what to bring in |
| `ltx_2_3_flf2v` | **First frame** | **Last frame** |
| `ltx_2_3_i2v` | the image to animate | — |
| `image_flux2_klein_9b_t2i`, `ideogram_4_t2i`, `stable_audio_3` | none | — |

A media slot left unbound is **not** empty: ComfyUI keeps whatever filename the
bundle shipped with and renders a stranger's test picture while reporting
success. ComfyQ refuses the document rather than let that happen.

---

## Audio directives

Open a `stable_audio_3` prompt with a track type. ComfyQ maps it to the
workflow's dropdown and strips it from the prompt:

```
TrackType: Music. <…> No vocals, no drums.
TrackType: Sound Effects. <…> Continuous, no musical content, no speech, no sudden events.
```

Recognised directive names: `TrackType`, `Type`, `Category`, `Kind` — **plus**
the name of any dropdown the workflow has. The *name* must be one of those; a
value match alone is not enough. That is what keeps an ordinary opening
sentence such as `Ambience: music.` from being eaten and silently setting the
wrong track type.

The four options are `Music`, `Instrument`, `SFX` and `One-shot`.
`Sound Effects` maps to `SFX`; `Music` maps to `Music`; `One shot` to `One-shot`.

**`stable_audio_3` ships "Enhance prompt with AI" ON**, and a storyboard cannot
turn it off — an in-graph LLM rewrites every audio prompt before it reaches the
model. Write the sound bible carefully anyway (it is the LLM's input), but do
not expect the wording to survive verbatim.

---

## Workflows a storyboard cannot use

- Anything needing a **painted mask** (`flux2_klein_inpaint_*`) — nothing in
  the format can paint one, and a generated PNG has no alpha, so the "inpaint"
  would return its input untouched.
- Anything needing a **source video** — a storyboard produces images and audio,
  never a video another shot can consume.
- Anything producing **3D or text** (`3d_*`, `llm_gemma4_*`) — the three phases
  are images, videos, audio.

3D, text and video-input workflows are **always** refused with a reason naming
the shot. A **mask** workflow is refused only when it names a ref; with no ref
it is silently swapped for the anchors' t2i workflow and runs as a plain
generation (see wiring rule 7).
