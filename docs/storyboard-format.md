# Storyboard batches

> **Experimental.** This format is to be reworked as a batch feature with job
> dependencies. Today a batch runs one job at a time on the main lane, in order, so
> close any extra lanes first.

Upload one markdown document and ComfyQ queues **every generation it
describes**, in the order that makes them possible: all the **images** first,
then the **videos** (each one fed by an image the batch just produced), then
the **audio**.

Worked examples live in [batch-skill/examples](../batch-skill/examples/).

---

## The document

```markdown
# S0 | scene | A -> S1_A ; B -> S1_B      ← a section
## Reference image 1                       ← one generation
### image_edit_flux2_klein_9b_image_edit_ref (ref A2, A1) ← which workflow, what it reuses
An extreme wide shot at eye level of ...   ← the prompt, until the next heading
```

| Line | Meaning |
|---|---|
| `# ID \| kind \| transitions` | Starts a section. The queue uses `ID`, and `kind` in one case: a section of kind `notes` generates nothing, even if it contains `##` items. Otherwise `kind` and `transitions` are carried through untouched so an interactive-story tool can keep using them. |
| `## Title` | One generation. The title is free text; two spellings are special (below). |
| `### <workflow> \| <attr> \| <attr>` | The workflow to run, and its attributes (below). |
| everything after | The prompt, verbatim, until the next heading. |

A section with no `##` items produces nothing, and neither does a section of
kind `notes` (`# NOTES | notes | end`), whatever it contains.

### Two title conventions

* **`## Anchor image 3`** — makes this generation addressable as **`A3`**
  anywhere in the document. Anchors are the reusable **library**: a character
  sheet, an establishing plate. They are reached **only by name**, with
  `(ref A3)` — a video cut never picks one up just by following it. That is
  deliberate: in `Anchor image 1 · Reference image 1 · Video cut 1`, the cut
  must animate the *reference*, which is the shot the storyboard actually
  composed, not the raw plate it was built from.
* **`## Video cut 1`** — an item whose workflow produces a video takes its
  frame from the **ordinary** images generated before it in the same section.
  A cut whose title ends in a number N first takes the image whose title ends
  in the same N (`Video cut 2` ← `Reference image 2`), so
  `Reference image 2 · Reference image 1 · Video cut 1` animates Reference
  image 1. When no number matches, it consumes the section's images oldest
  first, so `Plate one · Plate two · Cut 1 · Cut 2` pairs up the way it reads,
  and a first/last-frame workflow with two plates available animates between
  them. A first/last-frame cut matched by number takes its second frame from
  the next unconsumed image in the section. Only one image available for
  several frame slots → it drives all of them. A cut can also name its source
  outright with `(ref A2)`, which always wins.
  Write `## Video cut 1 (loop)` to make every frame input the same key frame,
  even when other images are available (on a first/last-frame workflow, the
  clip then ends where it began).
  `loop` is read only from the `##` line; on the `###` line it is ignored with
  a warning.

Everything else (`## Choice image`, `## Music`, `## End image`) is ordinary —
the workflow's category decides its phase.

### `(ref A3)` — reusing an anchor

```markdown
### image_edit_flux2_klein_9b_image_edit_ref (ref A3)      one anchor drives every image input
### image_edit_flux2_klein_9b_image_edit_ref | ref A2, A1  source ← A2, reference ← A1
### ltx_2_5_i2v (ref A2)                        animate a library plate directly
```

Write two anchors as `| ref A2, A1` on the `###` line, or in the shot title
(`## Reference image 1 (ref A2, A1)`). `### … (ref A2, A1)` works too. Name the
refs in one place: if the `##` and `###` lines both name refs and they differ,
the storyboard is refused.

A workflow that **edits** an image normally names a `(ref Ax)`. An edit with
no ref is refused only when the document has no plain text-to-image anchors to
fall back on; otherwise it is generated on the anchors' workflow instead
(below).

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
workflow needing an input a storyboard cannot express: a painted **mask** (when
the shot names a ref, or there are no anchors to fall back on; with no ref it is
generated on the anchors' text-to-image workflow instead), or a source
**video**. Book those from the app instead.

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

Commas separate attributes as well as pipes, so they can also be written in a
parenthesis — `### ltx_2_5_i2v (ref A2, 8s)` — or on the `##` line —
`## Video cut 1 (ref A2, loop)`. A ref, a size and a duration (and `loop`, on
the `##` line) can be combined in either place. A bare anchor right after a ref
continues it (`ref A2, A1` is two anchors). A decimal comma stays part of its
duration: `2,5s` is reported as not a whole number of seconds, not read as `2`
and `5s`.

A parenthesised `(ref A3)` still works, and a `Resolution: 1344 x 768` /
`Size: 1280×720.` line of its own before the prompt is also read. Anything not
understood is reported as a warning ("… was not understood — ignored") and has
no effect on the shot.

**Duration is converted to whatever the workflow counts.** `stable_audio_3`,
`ltx_2_5_i2v` and `ltx_2_5_flf2v` take seconds directly (the LTX 2.5 workflows
take whole seconds and render `seconds × 24 + 1` frames, so `5s` is 5.04 s); a
workflow that counts *frames* instead gets `5 × its frame rate`, snapped to the
8n+1 grid LTX needs. The conversion is shown in the run-order table.

Sizes outside 64-8192 px are ignored, so `shot on 35mm film ... Kodak Portra
400` is never mistaken for one. A workflow with no width/height but an
aspect-ratio dropdown (the MOSS title cards) gets the closest aspect
option, so always give cards a size: MOSS's default is square. A
workflow with neither (an edit, which takes its size from its input image) is
reported once as a warning rather than silently ignored.

Durations are whole seconds. A fraction such as `6.5s` is not read as a
duration: written as `| 6.5s` the preview warns that it is not a whole number
of seconds and was ignored, and the shot runs at the workflow's default length. Refs are written `ref A2`,
not `ref: A2`.

### A leading `Name: Value.` directive

If a prompt opens with `Type:`, `Category:`, `Kind:`, or the name of one of the workflow's own dropdowns — and the value
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

Size and duration come from the `###` attributes and a dropdown from a leading
directive; steps, CFG and every other setting cannot be set from a storyboard.
A setting a storyboard does not send runs at the value written in the
workflow's graph (its `api.json`). A default changed in the workflow editor
reaches the student form only, never a storyboard.

### Where the results go

Every shot writes into one folder, under a name built from the document's own
headings — section (`#`), shot title (`##`) and workflow (`###`) — with the run
index in front so the folder sorts into run order:

```
<ComfyUI output>/The-Red-Thread/
    001_LIBRARY__Anchor-image-1__image_flux2_klein_9b_t2i_00001_.png
    005_IDLE__Reference-image-1__image_edit_flux2_klein_9b_image_edit_ref_00001_.png
    023_IDLE__Video-cut-1-loop__video_ltx2_5_flf2v_00001_.mp4
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
what is still to come. Each batch also has a **Stop & remove** button, and a
batch with failed shots shows **Retry failed (N)**, which runs those shots
again in place once whatever broke them is fixed: the shots that finished keep
their results, and nothing has to be uploaded again.

**You do not have to pick a workflow first.** The document names its own, so on
an idle machine queueing writes the batch to the queue and then starts the
machine serving the batch's *first* workflow, which takes a few seconds. If the
machine is already serving, nothing restarts.

**Only the shots whose workflow is being served actually run.** Each workflow
the machine serves has its own queue, so a batch that uses several workflows
runs the shots of the served one and leaves the others **pending** until their
workflow is served too. In the admin panel's workflow library, press **Serve
alongside** on its card (when it fits in memory beside what is running), or
select its card and press **Activate & start student mode** under the library
to replace the main workflow. Replacing it stops a shot that is generating on
the old workflow: that shot and the shots waiting on it show as failed, and
**Retry failed** on the batch queues them again. They run once their workflow
is served again. A shot waiting on a shot from another workflow runs once that
one has finished.

[storyboard-smoke.md](storyboard-smoke.md) is a 4-shot version (one plate, one
edit, one cut, one ambience — about two minutes of GPU time plus model loads) for
proving the chain works on a rig before committing to a full document. It uses
four workflows, so it only completes once all four have been served.

---

## Endpoints

Available in both modes. On an idle machine (admin mode) the batch is written
straight to the queue file, and `/queue` then switches the machine to student
mode serving the batch's first workflow, which starts the executor. Every
route, the read-only ones included, sits behind the **admin password** when one
is configured.

### `POST /storyboard/preview`

Parse and plan, create nothing. Send either a multipart `file` field or a JSON
body `{ markdown }`.

```bash
curl -F file=@batch-skill/examples/linear-the-lamplighter.md \
     -H "X-Admin-Password: $PW" \
     http://localhost:3000/storyboard/preview
```

Abridged — the response also carries `serving`, `outputFolder`, `outputDir`,
`states`, `workflowRuns`, `modelLoads`, `totalShots`, `blockedReasons` and
`summary`:

```jsonc
{
  "name": "linear-the-lamplighter.md",
  "phases": [ { "phase": 0, "label": "images", "count": 22 },
              { "phase": 1, "label": "videos", "count": 11 },
              { "phase": 2, "label": "audio",  "count": 9  } ],
  "totalJobs": 42,
  "totalEstimatedSec": 1316,
  "warnings": [ /* 11 × "\"Reference image 1\" (IDLE): A3 is used for BOTH \"Source image\" and \"Reference image\" …" */ ],
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

If any shot cannot be read or planned the whole batch is **refused** (HTTP 422,
nothing queued) with the list of reasons — a `##` with no `###` line counts as
much as a missing anchor. The report separates the shots that are *wrong* from the shots that
merely *wait on them* — for a document whose 17 edits name a missing `ref A9`,
that is a 17-line fix list rather than 34 near-identical sentences. Each broken shot
contributes exactly one reason — a 42-shot storyboard silently queued as 38 is worse than no queue at
all. `force: true` opts into the partial run, and it stays safe: an item that
could not be planned is dropped along with everything that depended on it,
transitively. Nothing is ever queued with an input missing.

### `GET /storyboard/batches` · `GET /storyboard/batches/:id`

List the batches in the queue (with a completed / running / failed / pending
tally), or one batch's jobs with their dependencies. Admin-gated like the write
routes — a batch listing exposes every prompt in the document.

### `POST /storyboard/batches/:id/retry`

Runs the batch's **failed** shots again, after whatever broke them has been
fixed (a missing model, a bad dropdown option, a performance flag). Add
`?includeCancelled=1` to re-run cancelled shots too. The shots are put back in
the queue in place, in one step: completed shots keep their outputs, and the
failed ones keep their place in the run order and their links to the shots
that feed them. This is the **Retry failed (N)** button on the card.

```jsonc
{ "ok": true, "retried": 3, "stillBlocked": [], "jobs": [ /* { id, label, workflowId } */ ] }
```

`stillBlocked` lists the retried shots whose source shot was **deleted** rather
than merely failed: they can never run, and will fail again.

### `DELETE /storyboard/batches/:id`

Cancels whatever is running or waiting and removes the batch. Completed jobs
and their outputs are kept unless you pass `?keepCompleted=0`.

---

## How it runs

### Run order: one model load per workflow

A storyboard names a handful of workflows and uses each many times. Taken in
document order those alternate shot by shot — `edit · title card · edit · title
card` — and **every switch is a cold model load**: roughly 5 to 55 s per
workflow on this rig (calibration of 2026-11-04, longer when the files are read
from disk for the first time), for a job that may itself take twenty seconds.

So within each phase the shots are ordered to keep one model resident for as
long as its dependencies allow: at each step the planner picks a shot whose
inputs are already scheduled, preferring one that runs the workflow that just
ran. The example document goes from ~20 model loads to **6**:

```
 4x image_flux2_klein_9b_t2i            (the anchor plates)
11x image_edit_flux2_klein_9b_image_edit_ref (every shot built from an anchor)
 7x image_moss_image_t2i          (the choice / end cards)
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
* **A batch still pays one cold model load per workflow** (roughly 5-55 s each
  on this rig, more on a first load from disk, on top of the sampling
  estimate). The card shows the count before
  you commit. That is the floor: the shots cannot be reordered further without
  breaking their dependencies.
* **A batch only runs on the workflows the machine is serving.** Queueing on an
  idle machine starts its *first* workflow; the shots on every other workflow
  stay pending until that workflow is served as well. In the admin panel's
  workflow library, press **Serve alongside** on its card (when it fits in
  memory beside what is running), or select its card and press **Activate &
  start student mode** under the library to replace the main workflow.
  Replacing it stops a shot that is generating on the old workflow: that shot
  and the shots waiting on it show as failed, and **Retry failed** on the batch
  queues them again. They run once their workflow is served again. Nothing
  switches workflows for you as the batch moves on.
* **Stopping a batch.** Use **Stop & remove** on the batch in the Storyboard
  batch card (or `DELETE /storyboard/batches/:id`). Its jobs belong to the
  `storyboard` user, so the ✕ on a single shot's card in the student page asks
  for the admin password, and is refused when none is set. Pass `user_id` when
  queueing to attribute the batch to a real student instead.
* **`(ref A2, A1)` maps onto image inputs in the workflow's parameter order**,
  which an admin can change in the workflow editor. Re-check a multi-ref
  storyboard after reordering a bundle's parameters.
* **Timeline slots use each workflow's *warm* estimate.** A batch that finishes
  faster than estimated leaves small idle gaps; on a dedicated machine, choose
  **Timeline → Back to back (dedicated machine)** on the card (`spacing:
  "asap"` on the API) to run back to back.
