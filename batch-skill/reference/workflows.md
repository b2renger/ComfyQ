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
| `image_flux2_klein_9b_t2i` | `image_flux2_klein_9b_t2i` | image from text | ~16 s |
| `image_edit_flux2_klein_9b_image_edit_ref` | same | image from **2 images** + text | ~44 s |
| `image_moss_image_t2i` | same | flat text card, from plain prose | ~23 s |
| `ltx_2_5_i2v` | `video_ltx2_5_i2v` | video from **1 image** | ~50 s |
| `ltx_2_5_flf2v` | `video_ltx2_5_flf2v` | video from **first + last frame** | ~67 s |
| `stable_audio_3` | `audio_stable_audio_3_medium` | music or SFX | ~6 s |

Short names resolve to the real bundle id. A name matching **more than one**
installed workflow is refused with the candidates listed — never guessed.

Estimates are **warm sampling time at the bundle's calibrated resolution**, as
calibrated on 2026-11-04. They change whenever a bundle is recalibrated: the
source of truth is `workflows/<id>/<id>.runtime.json` → `estimatedDurationSec`,
and the planner adds them up for the whole document as `totalEstimatedSec`
(printed by the check in [checklist.md](checklist.md)). 1920×1080 is well
above the calibrated resolution, so expect meaningfully longer — see below.

---

## Resolution — read this before writing `1920x1080`

Each workflow snaps width/height to its own grid **at submit time**. The
document says what you asked for; the job runs what the grid allows.

| workflow | real grid | `1920x1080` renders |
|---|---|---|
| `image_flux2_klein_9b_t2i` | multiples of **16**, rounded **down** | **1920×1072** ⚠ |
| `image_edit_flux2_klein_9b_image_edit_ref` | *no size control* — the graph hard-codes **1 megapixel** | source's aspect at ~1 MP (a 1920×1088 or 1920×1080 source → ≈**1360×768**) |
| `image_moss_image_t2i` | *no width/height* — an aspect dropdown, plus a Megapixels setting that stays at 1 for a storyboard | mapped to **`16:9 (Widescreen)`** |
| `ltx_2_5_i2v` | min 512, max 1920, multiples of **64** | **1920×1088** ⚠ |
| `ltx_2_5_flf2v` | min 256, max 1920, multiples of **64** | **1920×1088** ⚠ |

### ⚠ `1920x1080` does not render as 1920×1080

Two different grids disagree with 1080 in **opposite directions**:

- `image_flux2_klein_9b_t2i` rounds **down to a multiple of 16** → **1072**. (Its
  `meta.json` claims `step: 8`. That is wrong — measured output at a 1080
  request is 1072, and 1080 *is* a multiple of 8. Trust the measurement.)
- `ltx_2_5_i2v` snaps to a multiple of **64** → **1088**.
- `ltx_2_5_flf2v` snaps to a multiple of **64** → **1088** too, and its two
  guide frames are resized to that same size.

So asking for 1920×1080 gives you stills at 1072 and video at 1088 — a **16 px
mismatch between a key frame and the clip made from it**, which the video model
then has to stretch.

**Use `1920x1088` for a full-HD 16:9-ish film.** It is a multiple of 16, 32 and
64, so *every* stage renders it exactly and the stills match the clips pixel for
pixel. It is 1.765:1 rather than a true 1.778:1 — an 8 px difference at that
width, invisible in play. **This is what the two full-HD examples use** (The
Red Thread uses 1280×704).

**Rule of thumb: make every video dimension a multiple of 64** — both
`ltx_2_5_i2v` and `ltx_2_5_flf2v` snap to that grid. Both render 1920×1088
exactly (measured). Safe pairs: **1920×1088**, 1280×704, 1024×576.

### What 1920×1088 does *not* buy you

Only shots on `image_flux2_klein_9b_t2i` (the anchors) and the video output actually
render at it. **Key frames on `image_edit_flux2_klein_9b_image_edit_ref` are ~1 MP** —
about 1360×768 from a 1920×1088 source (≈1376×752 from a 1280×704 one, as in
The Red Thread) — because the graph hard-codes `megapixels: 1` with no exposed
control, and **cards on `image_moss_image_t2i` are ~1 MP too** (≈1376×768): the card
has a Megapixels setting, but a storyboard never sends it, so the graph's own
value (1) is used. Raising its default in the workflow editor changes only the
student form. The video shots then upsample from those. The film's *output* is
full HD; two of its intermediate stages are not, and no storyboard attribute
can change that today.

If you need a mathematically exact 16:9 at every stage, the only value that
survives all three grids is **1024×576** (`h = w·9/16` must also be a multiple
of 64, so `w` must be a multiple of 1024; 2048 exceeds the i2v max). That is a
large drop in resolution — take it only when exactness matters more.

Verify any resolution before committing a batch:

```bash
node -e "const {clampParamValue}=require('./server/workers/localComfyUIWorker');
const m=require('./workflows/video_ltx2_5_i2v/video_ltx2_5_i2v.meta.json');
const h=m.exposedParameters.find(p=>/^Height/.test(p.label));
console.log('i2v height 1080 ->', clampParamValue(1080,h))"
```

…and check a rendered file, because a meta's declared `step` can be wrong:

```bash
node -e "const s=require('./server/node_modules/image-size'),fs=require('fs');
console.log(s(fs.readFileSync('<a rendered png>')))"
```

`image_moss_image_t2i` has no width/height at all — only an aspect dropdown that
**defaults to square**. Always give its cards a size so ComfyQ maps it to the
closest shape.

Cards use MOSS rather than Ideogram 4 because Ideogram wants a JSON caption: plain
prose usually comes back as a gray "blocked" picture, and the planner warns if it
sees that. MOSS spelled its title exactly in the 2026-11-04 run, in two languages,
from plain prose, at 11 GB against Ideogram's 25.7 GB.

### Cost of full HD

The per-shot estimates are calibrated by the test suite: `ltx_2_5_i2v` at its
default 1280×704, `ltx_2_5_flf2v` at 960×960 (about the same pixel count).
Measured on the 5090 at 1920×1088
and 5 s: **127 s** for `ltx_2_5_i2v` and **202 s** for `ltx_2_5_flf2v` — so
budget **about 3× the per-shot estimate**. If a
long batch matters more than maximum resolution, 1280×704 is on both grids and
runs far faster.

---

## Duration

| workflow | attribute | unit | bounds | rounding |
|---|---|---|---|---|
| `ltx_2_5_i2v` | `5s` | whole seconds | **1–10** | whole seconds only (a fraction is ignored) |
| `ltx_2_5_flf2v` | `5s` | whole seconds | **1–10** | whole seconds only (a fraction is ignored) |
| `stable_audio_3` | `45s` | seconds | **1–300** | — |

Both LTX 2.5 video workflows take **whole seconds at 24 fps** and render
`seconds × 24 + 1` frames — the extra frame LTX needs — so every clip runs
**1/24 s longer** than asked. Measured on the rig:

| you write | frames | real length |
|---|---|---|
| `2s` | 49 | 2.04 s |
| `3s` | 73 | 3.04 s |
| `4s` | 97 | 4.04 s |
| `5s` | 121 | 5.04 s |
| `6s` | 145 | 6.04 s |
| `8s` | 193 | 8.04 s |
| `10s` | 241 | 10.04 s |

**Write whole seconds.** A fraction such as `6.5s` is not read as a duration.
Written as `| 6.5s` or `(6.5s)`, the preview warns that it is not a whole
number of seconds and was ignored. Either way the shot runs at the workflow's
default length (5 s for the LTX 2.5 bundles). Both cap at **10 s**; ask for
more and it clamps silently.

**Vary clip length deliberately** — 3 s for a beat, 8 s for a held reveal. A
film of identical 5 s cuts reads as a slideshow.

---

## Media inputs, in slot order

What `ref` fills, and in what order:

| workflow | slot 1 | slot 2 |
|---|---|---|
| `image_edit_flux2_klein_9b_image_edit_ref` | **Source image** — the shot being edited | **Reference image** — what to bring in |
| `ltx_2_5_flf2v` | **First frame** | **Last frame** |
| `ltx_2_5_i2v` | the image to animate | — |
| `image_flux2_klein_9b_t2i`, `image_moss_image_t2i`, `stable_audio_3` | none | — |

A **mandatory** media slot left unbound is **not** empty: ComfyUI keeps whatever filename the
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

**`stable_audio_3` ships "Enhance prompt with AI" OFF** (its Qwen 3.5 rewrite
fails on this ComfyUI build), and a storyboard cannot turn it on, so the
description reaches the model **verbatim**. Write it in full: genre,
instruments, mood, production, tempo (BPM) — or a plain description of one
sound effect. The track-type dropdown only steers that AI rewrite, so while it
is off the directive is still stripped from the prompt but does not change the
sound: the words of the description do all the work.

---

## Workflows a storyboard cannot use

- Anything needing a **painted mask** (`flux2_klein_inpaint_*`) — nothing in
  the format can paint one, and a generated PNG has no alpha, so the "inpaint"
  would return its input untouched.
- Anything needing a **source video** — a storyboard produces images and audio,
  never a video another shot can consume.
- Anything producing **3D or text** (`3d_*`, `describe_gemma4_*`) — the three
  phases are images, videos, audio.

3D, text and video-input workflows are **always** refused with a reason naming
the shot. A **mask** workflow is refused only when it names a ref; with no ref
it is swapped (reported once as a plan warning and marked on the shot in the
run-order table) for the anchors' t2i workflow and runs as a plain generation
(see wiring rule 7).
