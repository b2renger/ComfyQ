# Storyboard batches

Upload one markdown document and ComfyQ queues **every generation it
describes**, in the order that makes them possible: all the **images** first,
then the **videos** (each one fed by an image the batch just produced), then
the **audio**.

A worked example lives in [storyboard-example.md](storyboard-example.md) — 42
generations across 8 scenes, which is what the endpoints below were built
against.

---

## The document

```markdown
# S0 | scene | A -> S1_A ; B -> S1_B      ← a section
## Reference image 1                       ← one generation
### image_edit_flux2_klein_9b_image_edit_ref (ref A2) ← which workflow, what it reuses
An extreme wide shot at eye level of ...   ← the prompt, until the next heading
```

| Line | Meaning |
|---|---|
| `# ID \| kind \| transitions` | Starts a section. Only `ID` is used by the queue; `kind` and `transitions` are carried through untouched so an interactive-story tool can keep using them. |
| `## Title` | One generation. The title is free text; two spellings are special (below). |
| `### <workflow> \| <attr> \| <attr>` | The workflow to run, and its attributes (below). |
| everything after | The prompt, verbatim, until the next heading. |

A section with no `##` items (a `# NOTES` block, say) produces nothing.

### Two title conventions

* **`## Anchor image 3`** — makes this generation addressable as **`A3`**
  anywhere in the document. Anchors are the reusable **library**: a character
  sheet, an establishing plate. They are reached **only by name**, with
  `(ref A3)` — a video cut never picks one up just by following it. That is
  deliberate: in `Anchor image 1 · Reference image 1 · Video cut 1`, the cut
  must animate the *reference*, which is the shot the storyboard actually
  composed, not the raw plate it was built from.
* **`## Video cut 1`** — an item whose workflow produces a video consumes the
  **ordinary** images generated before it in the same section, oldest first. So
  `Plate one · Plate two · Cut 1 · Cut 2` pairs up the way it reads, and a
  first/last-frame workflow with two plates available animates between them.
  Only one image available for several frame slots → it drives all of them,
  which is what a `(loop)` cut wants. A cut can also name its source outright
  with `(ref A2)`, which always wins.

Everything else (`## Choice image`, `## Music`, `## End image`) is ordinary —
the workflow's category decides its phase.

### `(ref A3)` — reusing an anchor

```markdown
### image_edit_flux2_klein_9b_image_edit_ref (ref A3)      one anchor drives every image input
### image_edit_flux2_klein_9b_image_edit_ref (ref A2, A1)  source ← A2, reference ← A1
### ltx_2_5_i2v (ref A2)                        animate a library plate directly
```

A workflow that **edits** an image must name a `(ref Ax)` — there is nothing
sensible to guess, so an edit without one is refused.

**A shot that names no anchor is a plain generation.** This is the format's own
wiring rule: a key frame on the image-*edit* workflow takes the anchor named in
`(ref AN)`, and *with no parenthetical, use the text-to-image workflow and no
input*. Generators routinely emit the edit workflow and forget the
parenthetical, so ComfyQ applies the rule: the shot runs on whichever workflow
the `LIBRARY` anchors use, and the substitution is reported once in the preview
and marked on the shot in the run-order table.

Add `| ref A2, A1` (or `## Reference image 1 (ref A2, A1)`) to a shot that
really should edit an anchor — source first, reference second.

If the document has **no anchors at all**, there is no rule to apply and the
shot is refused rather than guessed.

**One ref, two slots.** `image_edit_flux2_klein_9b_image_edit_ref` has a *Source image*
(the shot being edited) and a *Reference image* (what to bring into it). A
single `(ref A1)` fills both, which means the model edits A1 itself rather than
bringing A1 into another shot — usually not what a storyboard means, and
invisible once the job has run. The preview **warns** on this and the run-order
table shows which anchor feeds which slot, so name both when they differ:
`(ref A2, A1)` → edit A2, referencing A1.

Anchors are batch-wide, so a section can reference a plate defined in the
`LIBRARY` at the top.

**Every media input a workflow declares must end up bound**, or the item is an
error and the batch is refused. There is no "leave it empty" — ComfyUI would
fall back to whatever filename the bundle's `api.json` shipped with (a leftover
test picture), and the shot would render wrong while reporting success. The
same applies to a `(ref A9)` naming an anchor that does not exist, and to a
workflow needing an input a storyboard cannot express: a painted **mask**, or a
source **video**. Book those from the app instead.

Two anchors with the same number is a warning; the second one wins.

### Workflow names

You do not have to write the exact bundle folder name. `ltx_2_5_i2v` finds
`video_ltx2_5_i2v`, `stable_audio_3` finds `audio_stable_audio_3_medium`.
A name matching **more than one** installed workflow is refused with the list
of candidates — it is never guessed.

### The `###` line

The workflow name, then any number of pipe-separated attributes in any order:

```markdown
### image_flux2_klein_9b_t2i | 1280x720
### stable_audio_3 | 45s
### ltx_2_5_i2v | 1280x720 | 5s
### image_edit_flux2_klein_9b_image_edit_ref | 1280x720 | ref A2, A1
```

| Attribute | Means |
|---|---|
| `1280x720` | pixel size (`×` and `*` also accepted) |
| `5s` | duration (`5 sec`, `5 seconds` too) |
| `ref A2, A1` | which anchors feed this shot's image inputs, in slot order |

A parenthesised `(ref A3)` still works, and a `Resolution: 1344 x 768` /
`Size: 1280×720.` line of its own before the prompt is also read. Anything
unrecognised is kept as a note rather than dropped.

**Duration is converted to whatever the workflow counts.** `stable_audio_3`,
`ltx_2_5_i2v` and `ltx_2_5_flf2v` take seconds directly (the LTX 2.5 workflows
take whole seconds and render `seconds × 24 + 1` frames, so `5s` is 5.04 s); a
workflow that counts *frames* instead gets `5 × its frame rate`, snapped to the
8n+1 grid LTX needs. The conversion is shown in the run-order table.

Sizes outside 64-8192 px are ignored, so `shot on 35mm film ... Kodak Portra
400` is never mistaken for one. A workflow with no width/height (an edit, a
title card) is reported once as a warning rather than silently ignored.

### A leading `Name: Value.` directive

If a prompt opens with `TrackType: Sound Effects.` — or `Type:`, `Category:`,
`Kind:`, or the name of one of the workflow's own dropdowns — and the value
names one of that dropdown's options (`SFX`), the dropdown is set and the
directive is stripped from the prompt.

The **name** must be one of those; a value match alone is not enough. That is
what keeps an ordinary opening sentence intact: `Ambience: music.` and
`Backing: One-shot.` both name real dropdown options, and a value-first rule
would delete them from the prompt and quietly set the wrong track type. A
sentence like `Audio: gulls calling ...` mid-prompt is never even considered.

### What the queue fills in for you

* the prompt → the workflow's best live text field: never a negative prompt,
  never one the workflow's own either/or gating has switched off, and never
  internal plumbing (a workflow whose only text field is an LLM system
  instruction is refused rather than corrupted)
* every seed → a fresh random value, so re-running a storyboard never returns
  ComfyUI's cached result
* every media input → the image the batch produced for it

Everything else keeps the workflow's own defaults. Nothing in the document can
change resolution, steps or CFG — set those in the workflow's meta.

### Where the results go

Every shot writes into one folder, under a name built from the document's own
headings — section (`#`), shot title (`##`) and workflow (`###`) — with the run
index in front so the folder sorts into run order:

```
<ComfyUI output>/The-Red-Thread/
    001_LIBRARY__Anchor-image-1__flux2_klein_9b_t2i_00001_.png
    005_IDLE__Reference-image-1__flux2_klein_9b_image_edit_ref_00001_.png
    023_IDLE__Video-cut-1--loop___video_ltx2_5_flf2v_00001_.mp4
```

The folder defaults to the uploaded filename and is editable in the card
(`folder` on the API). A finished batch is then readable straight off the
filesystem, without opening ComfyQ.

---

## Using it

**In the app:** open **/admin** → the **Storyboard batch** card. Drop the `.md`,
read the plan it shows you (shot count, the three phases, how many model loads
it will cost, estimated GPU time, and any warnings or errors), then click
**Queue**.

Once it is running, the live batch expands on its own and shows every shot as
**generated / generating N% / pending / failed**, naming the one in flight and
printing any failure reason inline, so it is always clear what has been made and
what is still to come. Each batch also has a **Stop & remove** button.

**You do not have to pick a workflow first.** The document names its own, so on
an idle machine queueing writes the batch to the queue and then starts the
machine serving the batch's *first* workflow — the one it is about to load
anyway. That restart takes a few seconds, after which the executor drains the
batch. If the machine is already serving, the running executor just picks the
batch up on its next tick and nothing restarts.

[storyboard-smoke.md](storyboard-smoke.md) is a 4-shot version (one plate, one
edit, one cut, one ambience — about a minute of GPU time plus model loads) for
proving the chain works on a rig before committing to a full document.

---

## Endpoints

Student mode only (that is where the queue and executor live). The mutating
routes sit behind the **admin password**, when one is configured.

### `POST /storyboard/preview`

Parse and plan, create nothing. Send either a multipart `file` field or a JSON
body `{ markdown }`.

```bash
curl -F file=@docs/storyboard-example.md \
     -H "X-Admin-Password: $PW" \
     http://localhost:3000/storyboard/preview
```

```jsonc
{
  "name": "storyboard-example.md",
  "phases": [ { "phase": 0, "label": "images", "count": 22 },
              { "phase": 1, "label": "videos", "count": 11 },
              { "phase": 2, "label": "audio",  "count": 9  } ],
  "totalJobs": 42,
  "totalEstimatedSec": 1032,
  "warnings": [],
  "errors": [],
  "jobs": [ /* every job, in run order, with its resolved params and deps */ ]
}
```

### `POST /storyboard/queue`

Same parse and plan, then creates the jobs. On an idle machine it also sets
`activeWorkflowId` to the batch's first workflow and restarts into student mode
(the response carries `restarting: true` and `startingWorkflowId`), because
nothing drains the queue in admin mode. Extra body fields:

| field | default | meaning |
|---|---|---|
| `label` | the filename | shown against the batch |
| `folder` | the filename | output folder under ComfyUI's output dir |
| `user_id` | `storyboard` | the jobs' owner |
| `spacing` | `estimated` | `estimated` gives each job its workflow's estimated duration on the timeline; `asap` packs them 1 s apart so a dedicated machine runs them back to back |
| `force` | `false` | queue the items that *did* plan even though others failed |

If any shot cannot be planned the whole batch is **refused** with the list of
reasons. The report separates the shots that are *wrong* from the shots that
merely *wait on them* — for a document whose 17 edits name no anchor, that is a
17-line fix list rather than 34 near-identical sentences. Each broken shot
contributes exactly one reason — a 42-shot storyboard silently queued as 38 is worse than no queue at
all. `force: true` opts into the partial run, and it stays safe: an item that
could not be planned is dropped along with everything that depended on it,
transitively. Nothing is ever queued with an input missing.

### `GET /storyboard/batches` · `GET /storyboard/batches/:id`

List the batches in the queue (with a completed / running / failed / pending
tally), or one batch's jobs with their dependencies. Admin-gated like the write
routes — a batch listing exposes every prompt in the document.

### `DELETE /storyboard/batches/:id`

Cancels whatever is running or waiting and removes the batch. Completed jobs
and their outputs are kept unless you pass `?keepCompleted=0`.

---

## How it runs

### Run order: one model load per workflow

A storyboard names a handful of workflows and uses each many times. Taken in
document order those alternate shot by shot — `edit · title card · edit · title
card` — and **every switch is a cold model load**, a minute or two on this rig
for a job that may take sixteen seconds.

So within each phase the shots are ordered to keep one model resident for as
long as its dependencies allow: at each step the planner picks a shot whose
inputs are already scheduled, preferring one that runs the workflow that just
ran. The example document goes from ~20 model loads to **6**:

```
 4x image_flux2_klein_9b_t2i            (the anchor plates)
11x image_edit_flux2_klein_9b_image_edit_ref (every shot built from an anchor)
 7x image_ideogram4_t2i           (the choice / end cards)
 1x video_ltx2_5_flf2v            (the loop)
10x video_ltx2_5_i2v              (every other cut)
 9x audio_stable_audio_3_medium
```

Correctness is untouched: only shots whose inputs are already scheduled are
ever chosen, so grouping can never move a shot ahead of one it depends on — it
yields to the dependency and takes the switch instead. Ties fall back to
document order, so the result is deterministic.

### Chained inputs

Each generation is an ordinary ComfyQ job — same queue, same executor, same
gallery, same "Download ingredients". The one addition is a **`job_deps`**
row per chained input:

* `findReady` will not offer a job whose sources are not `completed`, so a
  waiting video never blocks the images queued behind it;
* just before submit, the executor copies the source job's output into
  `ComfyUI/input` as `comfyq_chain__…` and writes that filename into the
  parameter, exactly as an upload would have. (That prefix is deliberately not
  the `comfyq__` one the 30-minute input sweep deletes — a frame may be
  consumed hours after it was produced.);
* if a source fails, is cancelled or is deleted, everything waiting on it fails
  with `dependency-failed`, transitively, instead of sitting scheduled forever.

Two protections exist because a batch's *completed* images are still live
inputs for its pending videos:

* the admin "Clear history" sweep skips a completed job that an unfinished job
  still depends on — otherwise tidying the gallery mid-run would destroy the
  rest of the batch;
* deleting such a job from the app is refused with a message naming how many
  jobs still need it.

The staged `comfyq_chain__` copies are swept after 24 h, and removed outright
when their batch is deleted, along with the jobs' outputs and ingredients.

Jobs booked normally have no dependency rows, so none of this is reachable
unless a storyboard is queued.

Run the checks with `npm run test:storyboard` (no ComfyUI needed).

---

## Known limits

* **Sage attention turns itself off** if a model in the batch cannot run with
  it (`headdim should be in [64, 96, 128]`). That flag is a global opt-in
  speed-up, so one incompatible model would otherwise kill every remaining shot
  that uses it. The first such failure disables the flag for good, restarts
  ComfyUI without it, and **retries the shot** — the batch continues, and the
  shots waiting on it are never collapsed. Re-enable it under
  **Admin → ComfyUI backend → Performance** if you want it back. ComfyQ cannot
  do this for an *external* ComfyUI it did not launch; there it just reports the
  cause.
* **A batch still pays one cold model load per workflow** (~1-3 min each on
  this rig, on top of the sampling estimate). The card shows the count before
  you commit. That is the floor: the shots cannot be reordered further without
  breaking their dependencies.
* **The machine shows one "Now serving" workflow** to students and to ComfyQ
  Discovery, while a batch runs several — it names whichever one the batch
  started with. The jobs execute correctly; the banner just does not describe
  them.
* **Cancelling a batch needs `DELETE /storyboard/batches/:id`.** Its jobs are
  owned by the `storyboard` user, and ComfyQ refuses cross-user cancels unless
  an admin password is set — so there is no per-job stop button for them in the
  student UI. Pass `user_id` when queueing to attribute the batch to a real
  student instead.
* **`(ref A2, A1)` maps onto image inputs in the workflow's parameter order**,
  which an admin can change in the workflow editor. Re-check a multi-ref
  storyboard after reordering a bundle's parameters.
* **Timeline slots use each workflow's *warm* estimate.** A batch that finishes
  faster than estimated leaves small idle gaps; pass `spacing: "asap"` on a
  dedicated machine to run back to back.
