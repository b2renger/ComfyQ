---
name: comfyq-batch
description: Write a ComfyQ batch — a batch table (.csv, one job per row, any of the library's cards) or a storyboard (.md, a whole film of images, then the videos made from them, then audio) — that queues many jobs in one upload. Use when asked to write, generate, fix or review a batch table, a storyboard or batch markdown for ComfyQ, to choose which cards (models) a batch should use, or to turn an idea into jobs ComfyQ can render.
---

# Writing a ComfyQ batch

A batch queues many jobs at once. ComfyQ reads two formats:

| | **batch table** (`.csv`) | **storyboard** (`.md`) |
|---|---|---|
| what | one row per job, on any of the library's cards | a whole film: images → videos made from them → audio |
| cards | all of them: [reference/cards.md](reference/cards.md) | six: [reference/workflows.md](reference/workflows.md) |
| order | the fewest model loads the inputs allow | images, then videos, then audio |
| status | the batch feature's format | experimental, to be reworked as a batch table |

**Write a table** unless the user asks for a storyboard or a branching film.
Part 1 is the table; Part 2 the storyboard.

Either way ComfyQ **refuses the whole batch** if one row or shot is wrong, by
design: a job with a missing input renders the card's leftover test picture and
reports success. Run the offline check before you hand anything over.

---

# Part 1 — The batch table

The full reference is [docs/batch-format.md](../docs/batch-format.md). What
follows is what you need to write one that queues.

## T1 · Choosing the cards

Every card is in [reference/cards.md](reference/cards.md), grouped by what it
does. Each entry gives:

- the **id**, which is what goes in the `workflow` cell. Copy it; never guess one.
  A part of an id that names one card only also works (`moss_image_t2i`), but
  write the full id;
- the **title** students see, the **model** it runs, and what it makes
  (image, video, audio, model3d, text);
- **what it does**, in plain words, then the **technical description**. Read
  the description before you use a card: it says what the card is good and bad
  at, the sizes it works at, and options to leave alone (several cards have an
  "improve the prompt with AI" switch that fails on this ComfyUI build);
- its **prompting guides** and a one-line tip: write the prompt the way the
  model's own guide says;
- its **columns**: the prompt, the negative, the seed and the media inputs, and
  its **settings** with their keys, ranges, choices and defaults.

Several cards often do the same job with different models (a fast and a fine
edit, three text-to-video models). Use the title and the model to pick. Say
which you chose and why when the choice is not obvious.

**Experimental** cards serve normally; the label means the owner has not signed
them off yet. Prefer a validated card when two do the same job.

On the machine itself, refresh the list first, since the library changes:
`node batch-skill/tools/cards.cjs` (the Batches tab reads the same data).

## T2 · The file

```csv
id,workflow,prompt,image,repeat,seed,notes
hero,image_moss_image_t2i,"Studio portrait of a ceramicist, soft window light",,,1234,the picture everything uses
look,image_edit_flux3_klein_image_edit,"Same person, the apron is now orange",hero,3,,three tries
move,video_ltx2_5_i2v,"She turns the bowl slowly and smiles",look,,,one film per look
keys,utility_seedvr2_4k_upscale,,folder:Keyframes,,,
```

That is 11 jobs: one portrait, three edits of it, a film of each edit, and an
upscale of each of the four pictures in `Keyframes`.

- The first row names the columns; one must be `workflow`. Commas, semicolons
  or tabs separate cells (read from the first row).
- A cell with a comma, a quote or a line break goes in double quotes; a quote
  inside is doubled (`""`).
- A row whose first cell starts with `#` is a comment. Empty rows are skipped.

| column | meaning |
|---|---|
| `id` | a name, so other rows can use the result: a letter or digit, then letters, digits, `-`, `_`, `@` |
| `workflow` | the card's id ([reference/cards.md](reference/cards.md)) |
| `prompt`, `negative` | the card's prompt and negative prompt, when it has them |
| `image`, `image2`, …, `video`, `audio`, `mask`, `model3d` | its media inputs, in the order cards.md lists them |
| `repeat` | run the row this many times (1–100) |
| `seed` | a fixed seed; empty draws a fresh one, which the job records |
| `notes` | for people; ignored |
| a setting key | that setting (`steps`, `megapixels`, `primitiveint_value_2`…), as cards.md names it |

A table can mix cards. A column a card lacks must be **empty** on that card's
rows. An empty setting keeps the card's default. Numbers must sit in the
card's range (`1,5` reads as 1.5); yes/no takes `yes`, `no`, `true`, `false`,
`1`, `0`, `x`. `text:scene-3.txt` reads a long prompt from the assets folder,
and `empty` sets a text field to nothing.

## T3 · Inputs

| cell | means |
|---|---|
| `hero` | the first output of the row `hero` |
| `hero#2` | its second output |
| `hero.3` | the third job of a row that made several |
| `file:Woman.png` | a file in the assets folder (`file:portraits/a.png`) |
| `folder:portraits/` | one job per file of the right kind in that folder, in name order |
| `job:<id>` | an output of a job that already exists |
| `empty` | an optional input left empty on purpose |

After `file:` or `folder:`, steps separated by `|` prepare the file first
(`file:clip.mp4 | frame(0)` makes a picture of the first frame;
`file:Woman.png | scale(0.3) | blur(1.2) | jpeg(40)` a damaged photo for a
restorer). The list is in [docs/batch-format.md](../docs/batch-format.md).

- **A required input must be filled.** cards.md marks each one required or optional.
- **The kinds must match:** a video into a picture input is refused. A
  generated picture has no transparency, so a `mask` from another row masks nothing.
- **One job or several:** a row makes one job per file of a `folder:`, and one
  per job of a row it uses that made several, paired in order (`move` above
  films `look.1`, `look.2`, `look.3`). Name one (`look.2`) to use only that.
  Two inputs that would make different numbers of jobs are an error. `repeat`
  multiplies what is left.
- **Seeds** step by one per repeat. The jobs of one folder share a seed, and
  so share a look.

## T4 · The run order

Write the rows in the order a person reads them. A row may use a row written
below it. ComfyQ runs every job after the jobs whose results it uses, and
within that, in the order that **loads models the fewest times**. Every change
of card unloads every model and loads the next card's (1 to 135 s on the 5090,
12 s typically). A card that runs with other speed-up flags also restarts
ComfyUI, counted as about a minute. Seeds are drawn before the order is chosen,
so the order never changes a result. The admin can keep the table's order
instead (**Keep the table's order**).

So you do not need to group rows by card yourself. Do count the cards, though:
**each distinct card costs at least one model load.** Six cards where three
would do costs minutes.

## T5 · What is refused

Nothing is queued while the table has an error, and each error names its row
and column:

- no `workflow` column; a card that is not installed, or a name that matches two;
- a setting the card does not have, a value out of range, a choice it does not offer;
- an input that names nothing, a missing file, a path outside the assets folder,
  an input of the wrong kind, a required input left empty;
- a row that uses its own result, rows that wait on each other in a loop,
  inputs that cannot be paired, `hero.4` when `hero` made three;
- a `seed` on a card that has none;
- more than **500 jobs**, or a file over **2 MB**.

A row that only waits on a broken row is listed as blocked. Warnings (a setting
the card's own switch turns off, a mask from a generated picture) do not stop it.

## T6 · Check it offline, then hand it over

On the machine, run this from the ComfyQ folder. It is the same planner the
Batches tab uses, with the same assets folder, and needs no ComfyUI:

```bash
node -e "
const fs=require('fs'),path=require('path');
const {WorkflowRegistry}=require('./server/workflows/workflowRegistry');
const {planBatch}=require('./server/batch/batchPlan');
const {assetEnv}=require('./server/batch/assetEnv');
const configManager=require('./server/config/configManager');
const cfg=configManager.resolvePaths(configManager.load().config);
const r=new WorkflowRegistry(path.resolve('workflows')); r.discover();
const p=planBatch(fs.readFileSync(process.argv[1],'utf8'), r, {...assetEnv(cfg.assets?.dir||null), order:'fewest-loads', comfyFlags:cfg.comfy_ui});
console.log(p.summary);
for (const e of p.errors) console.log('ERROR   row', e.row, e.column||'', e.message);
for (const w of p.warnings) console.log('WARNING row', w.row, w.column||'', w.message);
for (const b of p.blocked) console.log('BLOCKED', JSON.stringify(b));
for (const j of p.jobs) console.log(String(j.order+1).padStart(3), j.key, j.workflowId, j.setup||'');
" my-batch.csv
```

The first line says how many jobs and model loads, or how many problems. Fix
every `ERROR` and re-run until there are none. Not on the machine? Say the table
is unchecked.

The admin then opens it in the **Batch editor** of the admin panel's
**Batches** tab (or drops it on the upload card there), reads the preview, and
queues it. The editor shows each card's model and description, as cards.md
does. A batch waits behind jobs students have already booked, then runs one
job at a time on the main lane, whatever card each names; extra lanes must be
closed first.

**Emit the CSV and nothing else** unless asked: no preamble, no code fence
around it. Before a large batch, tell the user the job count and the cards
first.

---

# Part 2 — The storyboard

You are writing **one markdown file**. ComfyQ parses it and queues every shot it
describes, in the order that makes them possible: **all the images first, then
the videos that consume those images as their frames, then the audio.**

Get the grammar exactly right and the whole film queues in one click. Get one
line wrong and ComfyQ **refuses the entire document**.

Read this part, then [reference/workflows.md](reference/workflows.md) for the
exact ids and limits, and [reference/checklist.md](reference/checklist.md)
before you emit. Three complete worked examples live in
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
Commas separate attributes there as `|` does on the `###` line, so a ref, a
size, a duration and `loop` can be combined: `## Video cut 1 (ref A2, loop)`,
`### ltx_2_5_i2v (ref A2, 8s)`. A decimal comma (`2,5s`) is reported as not
whole seconds.

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
in a prompt is never mistaken for a resolution. Anything not understood is
reported as a warning and ignored. Write durations as whole seconds (`5s`, not
`5.5s`) and refs as `ref A2`, not `ref: A2`.

### The paragraph — the prompt

**One paragraph.** No lists, no `Prompt:` label, no negative prompt, no seed,
no steps. ComfyQ owns every parameter you do not set on the `###` line, and it
randomises seeds itself so a re-run never returns a cached result.

One thing is taken *out* of the paragraph: a line of the shape
`Resolution: 1344 x 768` / `Size:` / `Dimensions:`, which becomes the shot's size
and is **deleted from the prompt**.
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
5. **Write refs in one place.** `## Shot (ref A2, A1)`, `### wf | ref A2, A1`
   and `### wf (ref A2, A1)` all read both anchors. Writing them on both the
   `##` and `###` line adds nothing when they agree, and refuses the storyboard
   when they differ.
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
### image_moss_image_t2i | 1280x704
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
load per workflow on top of the per-shot time — measured on this rig (the
bundles' calibration of 2026-11-04): 6 s (edit_ref) to 52 s (the LTX video
bundles), longer when the files are read from disk for the first time. The
offline check in [reference/checklist.md](reference/checklist.md) prints the
document's total warm estimate. **Tell the user the shot count and the
estimate before emitting a large document.**

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
Sound effects. <room tone> Continuous, no musical content, no speech, no sudden events.

# S0 | scene | A -> S1_A ; B -> S1_B

## Reference image 1 (ref A2, A1)
### image_edit_flux2_klein_9b_image_edit_ref | 1920x1088
<framing> <SUBJECT SHORT> <PLACE> <STYLE SUFFIX>

## Video cut 1
### ltx_2_5_i2v | 1920x1088 | 5s
<camera>. Initially <X>, then <Y>. <what stays fixed>. Audio: <sounds>, no music, no speech.

## Choice image
### image_moss_image_t2i | 1920x1088
<flat two-panel card> the words: "<label A>" … the words: "<label B>". No imagery of any kind. All text is sharp and perfectly rendered. No other text anywhere in the image. <UI SUFFIX>

## Music
### stable_audio_3 | 24s
Music. <cue from the sound bible> No vocals, no drums.

# NOTES | notes | end

<why the graph converges where it does; anything you could not resolve>
```

Emit the markdown document and nothing else — no preamble, no closing summary,
no code fence around the whole thing.
