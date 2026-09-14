---
name: comfyq-storyboard
description: Write a ComfyQ storyboard .md — the batch file that queues a whole film (images, then the videos made from them, then audio) in one upload. Use when asked to write, generate, fix or review a storyboard/batch markdown for ComfyQ, or to turn a story idea into shots ComfyQ can render.
---

# Writing a ComfyQ storyboard

You are writing **one markdown file**. ComfyQ parses it and queues every shot it
describes, in the order that makes them possible: **all the images first, then
the videos that consume those images as their frames, then the audio.**

Get the grammar exactly right and the whole film queues in one click. Get one
line wrong and ComfyQ **refuses the entire document** — by design, because a
shot with a missing input renders the workflow's leftover test picture and
reports success.

Read this file, then [reference/workflows.md](reference/workflows.md) for the
exact ids and limits, and [reference/checklist.md](reference/checklist.md)
before you emit. Two complete worked examples live in
[examples/](examples/).

---

## 1 · The grammar

Four line types. Nothing else is meaningful.

```markdown
# S0 | scene | A -> S1_A ; B -> S1_B      ← a state
## Reference image 1 (ref A2, A1)          ← one shot, and what it reuses
### image_edit_flux2_klein_9b_image_edit_ref | 1920x1088   ← workflow + attributes
One paragraph. The prompt. Nothing else.
```

### `#` — state

`# ID | role | routing`

| part | values |
|---|---|
| `ID` | `LIBRARY`, `IDLE`, `S0`, `S1_A`, `S2_AA`, `E01`… — an identifier, **no spaces** |
| `role` | `library` · `idle` · `scene` · `ending` · `notes` |
| `routing` | `A -> S1_A ; B -> S1_B` · `-> S0` · `end` · `-` |

Only `ID` and `role` change what ComfyQ does; `routing` is carried through
untouched for whatever plays the film. **`role: notes` generates nothing** —
put commentary there.

An ID containing a space is read as prose accidentally promoted to a heading,
and ComfyQ warns. Keep IDs identifier-shaped.

### `##` — shot

The title is free text. Two spellings are special:

- **`## Anchor image 3`** → addressable as **`A3`** anywhere in the document.
  Anchors are the reusable **library**: a character sheet, a location plate.
  They are reached **only by name** (`ref A3`). A video cut never picks one up
  just by following it — deliberately, so a cut animates the shot the
  storyboard composed, not the raw plate it was built from.
- **`## Video cut 2`** → binds **`## Reference image 2`** of the same state,
  by number. Numbering is what wires them, not adjacency.

An optional parenthetical carries the shot's argument:
`## Reference image 2 (ref A2, A1)` · `## Video cut 1 (loop)`.

### `###` — workflow and attributes

Workflow id first, then pipe-separated attributes in any order:

```markdown
### image_flux2_klein_9b_t2i | 1920x1088
### stable_audio_3 | 45s
### ltx_2_5_i2v | 1920x1088 | 5s
### image_edit_flux2_klein_9b_image_edit_ref | 1920x1088 | ref A2, A1
```

| attribute | meaning |
|---|---|
| `1920x1088` | pixel size (`×` and `*` also work) |
| `5s` | duration (`5 sec`, `5 seconds` too) |
| `ref A2, A1` | which anchors feed the image inputs, **in slot order** |

Sizes outside 64–8192 px are ignored, so `shot on 35mm film … Kodak Portra 400`
in a prompt is never mistaken for a resolution. Anything unrecognised becomes a
note rather than being dropped.

### The paragraph — the prompt

**One paragraph.** No lists, no `Prompt:` label, no negative prompt, no seed,
no steps. ComfyQ owns every parameter you do not set on the `###` line, and it
randomises seeds itself so a re-run never returns a cached result.

Two things are taken *out* of the paragraph: a leading `TrackType: …` directive
(§ audio), and a line of the shape `Resolution: 1344 x 768` / `Size:` /
`Dimensions:`, which becomes the shot's size and is **deleted from the prompt**.
Never open a sentence that way unless you mean it.

**A negative prompt cannot be set from a storyboard at all** — every shot runs
its bundle's shipped negative (the LTX 2.5 video workflows have none: they run
at CFG 1, so say what you want rather than what you don't). Prefer
`ltx_2_5_i2v` for anything that is not a deliberate loop — `ltx_2_5_flf2v`
costs roughly 1.5× as much per shot.

---

## 2 · Wiring — what feeds what

1. **`Video cut N` animates `Reference image N` of the same state.** If the
   numbers don't line up it falls back to consuming the state's images
   oldest-first, but rely on the numbering.
2. **Only the FIRST frame slot is wired by number.** `ltx_2_5_flf2v` has two,
   and the second is filled with the next unconsumed image in the state —
   *including a choice card*, silently, with no warning. Always write
   `## Video cut N (loop)` (both frames become the one key frame) or name both
   explicitly with `| ref A2, A3`. **Never put a `Choice image` before an
   `flf2v` cut in the same state.**
3. **A cut consumes its key frame.** Two cuts cannot both animate
   `Reference image 1`; the second falls back to oldest-first or errors. Give
   the second one `| ref …`.
4. **`ref A2, A1` fills image inputs in slot order:** **first = the shot being
   edited (Source), second = what to bring in (Reference).** For
   `image_edit_flux2_klein_9b_image_edit_ref` that is `ref <place anchor>, <subject
   anchor>`. Slot order follows the workflow's admin-editable parameter order,
   so re-check a multi-ref document after anyone reorders a bundle's params.
5. **Write refs as `## Shot (ref A2, A1)` or `### wf | ref A2, A1` — never as
   `### wf (ref A2, A1)`.** The parenthesised form *on the `###` line* is split
   on the comma and **silently keeps only the first anchor**, giving you the
   one-ref-two-slots case below. (`docs/storyboard-format.md` still shows the
   broken form; ignore it.)
6. **One ref, two slots is a warning.** `(ref A1)` alone puts A1 in *both*, so
   the model edits A1 itself rather than bringing A1 into another shot. Name
   both whenever they differ.
7. **A shot that names no anchor is rescued only if a `## Anchor image N`
   exists on a text-to-image workflow.** ComfyQ then re-runs that shot on the
   anchors' own t2i workflow — losing the anchor's consistency. With no such
   anchor, it is a **hard error and the whole document is refused**, taking
   every cut downstream with it. Always name the refs.
8. **A `ref` on a video cut is legal and always wins** — `## Video cut 3
   (ref A2)` animates a library plate directly.
9. **Anchors live in `LIBRARY`.** Ambience beds too — states never regenerate
   them.
10. **Write in generation order for a human reader; ComfyQ reorders.** It runs
    every image, then every video, then all audio, grouping by workflow inside
    each phase so each model loads once. Refs resolve document-wide, so a
    forward ref works — keep them backward anyway, for legibility.

---

## 3 · Consistency — the only thing holding the film together

**No model in the chain has memory between calls.** Every shot is a cold
request. Consistency comes from text you repeat *character for character*.

Lock these blocks before writing a single shot, then paste them verbatim:

- **`SUBJECT LONG`** — one sentence: wardrobe, silhouette, materials. Close and
  medium shots.
- **`SUBJECT SHORT`** — silhouette and dominant colours. Wide shots.
- **`PLACE`** — one sentence per location, each carrying two or three
  **singularities**: things that exist at no other location of the same type (a
  rope ladder with its fourth rung missing; one step mended with blue tile).
  Singularities are what make a place recognisable across twenty shots.
- **`STYLE SUFFIX`** — one string ending every photographic prompt. Film stock,
  lens, palette, light, depth of field, grain. **Never adapted, never
  shortened, never improved.**
- **`UI SUFFIX`** — a second frozen string for text cards only. Flat colours,
  typographic character, and an explicit *no photographic content, no
  illustration*. Never a film stock or lens — those belong to the film; the
  cards are design.

Plus a **sound bible**: one key, one BPM, one instrument palette for the whole
film. A player cuts between branches at runtime, so per-state tempos put an
audible seam at every choice.

**Prompt shape for a photographic shot:** framing sentence → `SUBJECT` block →
`PLACE` block → `STYLE SUFFIX`. On a shot with no subject, omit the subject
block rather than writing "no person is present".

**Video prompts are different — do NOT repeat any of that.** The start frame
already decided the set, the wardrobe and the grade; re-describing them is the
most reliable way to make the video model drift off the frame you approved. A
video prompt is four parts, in order:

1. camera move and speed
2. what changes across the clip, chronologically — *"Initially X, then Y"*
3. what stays fixed
4. `Audio:` the sounds, their distance, ending `no music, no speech`

Name the absence of music explicitly or the model scores it against your audio
track.

---

## 4 · Legibility — the floor every cut clears

- **One cut, one change.** Something is different at the end than at the start,
  and it is the thing the story is about. A cut where nothing changes is a
  still — put it in a card instead.
- **Establish before you detail.** A new location opens on a wide shot before
  any close-up of it.
- **Show a choice before you offer it.** The last cut of a branching state must
  contain both (or all three) options as visible things in frame, so the card
  that follows names what was already seen.
- If a beat needs a caption to read, it needs another cut, not a better prompt.

**Camera reliability over a short clip, descending:** `static, locked-off` (the
default) → `slow dolly in / out` → `pan`, `tilt` → orbit and crane, which you
do not use.

---

## 5 · Screens are layout, not imagery

Choice and end cards go to a text-rendering model. **No screen contains
imagery** — no photograph, no illustration, no depicted object, no person. A
flat card: colour field, type, at most a rule.

Four reasons, the first being the one that matters:

1. A background that model invents will never match the frame the viewer just
   watched. It has no reference to the film, so it breaks the exact consistency
   everything else exists to protect.
2. Short prompts render type far better; letters drop as the prompt grows.
3. Flat design is what a text-rendering model is best at.
4. It removes the content-filter surface completely.

Keep a card prompt under ~60 words. Option labels: **8 words maximum**. Put the
exact words in double quotes. Close with *No imagery of any kind. All text is
sharp and perfectly rendered. No other text anywhere in the image.* then the
`UI SUFFIX`.

If you want the scene behind the choice, that is a compositing decision for the
player — hold the last frame and cross-fade the card over it.

### The recap variant

A choice card may open with a **two-sentence recap** of what just happened,
set small above the rule, with the options large below it:

```markdown
### ideogram_4_t2i | 1280x704
A flat text card, warm off-white ground, deep navy type, nothing else in the frame. Two small lines across the upper third: "<sentence>. <sentence>." Below a thin horizontal rule, two large lines stacked: "<label A>" and "<label B>". No imagery of any kind. All text is sharp and perfectly rendered. No other text anywhere in the image. <UI SUFFIX>
```

It makes a branching film far easier to follow when the player is picking up a
run mid-way. It also costs: the card prompt lands near **100 words**, well over
the budget above, and letter dropout scales with prompt length. So **hold each
recap sentence to ~11 words**, keep the `UI SUFFIX` short, and if a rendered
card drops letters, cut the recap before you touch the labels. Recap the
*action*, never the imagery — the card must still contain no scene.

### People

Prefer a protagonist **never seen face-on**: from behind, in silhouette, at a
distance, or as hands and boots. Write the anchor as a wardrobe-and-silhouette
sheet, not a face sheet. A face is the first thing that drifts across twenty
frames, so this is a craft rule before it is a policy one. Describe a person by
wardrobe, silhouette and colour — never by age in years.

An object protagonist removes the problem entirely and is often the stronger
choice.

---

## 6 · Branching

- Every scene offers **two or three** options; every routing target must exist;
  every path must land on exactly one ending.
- **Never good vs bad.** Two goods, two curiosities, two kinds of care. If
  swapping the labels would not change what the film argues, the choice is
  decoration — rewrite the graph, not the prose.
- Endings may be **shared**: two paths converge because they converge *in
  meaning*, not to save shots. Say why in the `NOTES` block.
- An ending may route `-> S0` to loop the film.

**State id convention:** depth 1 = `S1_A`, `S1_B`, `S1_C`; depth 2 = `S2_AA`,
`S2_AB`…; endings `E01`…. The id encodes the path taken to reach it.

Count before writing: a depth-3 graph with 2 choices throughout is
1 + 2 + 4 + 8 = 15 states. Mixing in three-way choices grows it fast — budget
the shots, then write.

---

## 7 · Cost — say the number before you write 200 shots

Every shot is a real GPU job. Multiply before committing:

```
images  = anchors + key frames + cards
videos  = one per key frame that moves
audio   = ambience beds + one cue per state
```

ComfyQ groups shots so each model loads once, but a batch still pays one cold
load per workflow on top of the per-shot time — measured on this rig: 10 s
(edit_ref) to 52 s (the LTX video bundles). **Tell the user the shot count and
the estimate before emitting a large document.**

Hard ceiling: **500 shots** and a **2 MB** document per batch.

---

## 8 · Method

1. **Five rules of the world.** Material · light · scale · age and condition ·
   what does NOT exist. The last does the most work — a model adds by default
   whatever it has seen most.
2. **Graph before scenes.** Draw the states and routing. Check every path lands.
3. **Lock the five text blocks + the sound bible** (§3).
4. **Cuts.** One cut = one action, executable in the clip length in a single
   gesture, no internal ellipsis. If it needs twice the time, it is two cuts.
5. **Write in generation order:** `LIBRARY` → `IDLE` → `S0` → depth 1 → depth 2
   → … → endings → `NOTES`.
6. **Run the checklist** in [reference/checklist.md](reference/checklist.md).

---

## 9 · Skeleton

```markdown
# LIBRARY | library | -

## Anchor image 1
### image_flux2_klein_9b_t2i | 1920x1088
<subject sheet> <SUBJECT LONG> <STYLE SUFFIX>

## Anchor image 2
### image_flux2_klein_9b_t2i | 1920x1088
<empty establishing plate, nobody in it> <PLACE> <STYLE SUFFIX>

## Ambience 1
### stable_audio_3 | 45s
TrackType: Sound Effects. <room tone> Continuous, no musical content, no speech, no sudden events.

# S0 | scene | A -> S1_A ; B -> S1_B

## Reference image 1 (ref A2, A1)
### image_edit_flux2_klein_9b_image_edit_ref | 1920x1088
<framing> <SUBJECT SHORT> <PLACE> <STYLE SUFFIX>

## Video cut 1
### ltx_2_5_i2v | 1920x1088 | 5s
<camera>. Initially <X>, then <Y>. <what stays fixed>. Audio: <sounds>, no music, no speech.

## Choice image
### ideogram_4_t2i | 1920x1088
<flat two-panel card> the words: "<label A>" … the words: "<label B>". No imagery of any kind. All text is sharp and perfectly rendered. No other text anywhere in the image. <UI SUFFIX>

## Music
### stable_audio_3 | 24s
TrackType: Music. <cue from the sound bible> No vocals, no drums.

# NOTES | notes | end

<why the graph converges where it does; anything you could not resolve>
```

Emit the markdown document and nothing else — no preamble, no closing summary,
no code fence around the whole thing.
