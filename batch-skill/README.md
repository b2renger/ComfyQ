# batch-skill — writing ComfyQ batches

A skill that teaches an LLM to author what ComfyQ's **batch feature** consumes:
a **batch table** (`.csv`, one job per row, on any card of the library), or a
**storyboard** (`.md`, one document describing a whole film, which ComfyQ
queues as images → the videos made from those images → audio).

```
batch-skill/
  SKILL.md                  the skill itself: Part 1 the table, Part 2 the storyboard
  reference/
    cards.md                every card: id, title, model, what it does, columns (generated)
    workflows.md            the storyboard's six cards: sizes, durations, media slots
    checklist.md            27 storyboard checks to run before emitting, + offline validation
  tools/
    cards.cjs               writes cards.md from the cards; --check says if it is out of date
  examples/
    linear-the-lamplighter.md    a straight-through film, 43 shots
    branching-the-tide-clock.md  depth-3 branching, 2- and 3-way choices, 83 shots
    branching-the-red-thread.md  depth-3 branching at 720p, recap choice cards, 81 shots
```

## Using it

**As a Claude Code skill** — copy or symlink the folder into a skills
directory, then invoke it by name:

```powershell
Copy-Item -Recurse batch-skill "$env:USERPROFILE\.claude\skills\comfyq-batch"
```

(It was `comfyq-storyboard` before 2026-11-10, when it covered storyboards only.
A copy installed under the old name does not follow the repo: copy it again.)

**As a prompt** — paste `SKILL.md` and `reference/cards.md` for a table, or
`SKILL.md`, `reference/workflows.md` and `reference/checklist.md` for a
storyboard, then ask. That is how the storyboard examples here were written.

## The card list

`reference/cards.md` is generated from the cards' own metadata (title, model
name, summary, description, prompt guides) and from the columns the batch
planner gives each card: the same data the Batches tab shows. After a card is
added, removed or edited, write it again:

```bash
node batch-skill/tools/cards.cjs
```

`npm run test:storyboard` runs it with `--check` and fails when the file is out
of date, so a stale list is caught before a commit.

## Verifying a storyboard before spending GPU time

Every document should be planned offline first. This needs no ComfyUI:

```bash
node -e "
const {WorkflowRegistry}=require('./server/workflows/workflowRegistry');
const {parseStoryboard}=require('./server/storyboard/storyboardParser');
const {planStoryboard}=require('./server/storyboard/storyboardPlanner');
const r=new WorkflowRegistry(require('path').resolve('workflows')); r.discover();
const parsed=parseStoryboard(require('fs').readFileSync(process.argv[1],'utf8'));
const p=planStoryboard(parsed,r,{});
console.log('shots',p.jobs.length,'| PARSE errors',parsed.errors.length,'| PLAN errors',p.errors.length,'| blocked',p.blockedReasons.length,'| states',parsed.states.length);
console.log('phases',p.phases.map(x=>x.count+' '+x.label).join(', '));
console.log('model loads',p.modelLoads,'| est',Math.round(p.totalEstimatedSec/60),'min warm, plus one load per workflow');
for(const e of parsed.errors) console.log('PARSE',e);
for(const e of p.errors)      console.log('PLAN ',e);
for(const w of parsed.warnings.concat(p.warnings)) console.log('WARN ',w);
" batch-skill/examples/linear-the-lamplighter.md
```

Both **PARSE** and **PLAN** errors must be **0** — they are different lists,
and a parse error can drop a shot, or keep it in a form you did not write,
without failing the plan (see
[reference/checklist.md](reference/checklist.md)). Then queue it from
the admin panel's **Batches** tab, or:

```bash
curl -F file=@batch-skill/examples/linear-the-lamplighter.md \
     -F folder=the-lamplighter \
     -H "X-Admin-Password: $PW" \
     http://localhost:3000/storyboard/queue
```

Queueing on an idle machine starts it serving the batch's first workflow. A
batch does not use lanes: the main lane takes every one of its shots, whatever
workflow each names, one at a time, and loads each workflow's models in turn
(`LaneManager._prepareRun`), so nothing else has to be served. Close any extra
lane first: ComfyQ refuses a batch beside one. A shot that fails shows on the
batch, and **Retry failed** queues it again.

## The three examples

The Lamplighter and The Tide Clock render **1920×1088**, and The Red Thread
renders **1280×704**; all three vary their clip lengths and were validated with
the command above.

| | states | shots | images | videos | audio | model loads | warm est |
|---|---|---|---|---|---|---|---|
| **The Lamplighter** — linear | 8 | 43 | 20 | 14 | 9 | 6 | ~25 min |
| **The Tide Clock** — branching, depth 3 | 16 | 83 | 42 | 24 | 17 | 6 | ~46 min |
| **The Red Thread** — branching, depth 3, 720p | 15 | 81 | 42 | 23 | 16 | 6 | ~44 min |

Printed by the command above (`states` counts every `#` section, `NOTES`
included). The warm estimate is the planner's `totalEstimatedSec`, from the
bundles' calibration of 2026-11-04; it moves whenever a bundle is recalibrated,
so re-run the command for a current figure.

**The Lamplighter** is linear — `LIBRARY → IDLE → S0 → S1 → S2 → S3 → E01` — and
its protagonist is an **object** (a brass lantern), which removes face drift
across fourteen cuts entirely.

**The Red Thread** is the 720p example: eight paths, five endings (three of
them shared), one ending looping back to `S0`, and **text-only choice cards
that open with a two-sentence recap** of the action — the pattern documented in
SKILL.md § 5. It renders at **1280×704**, the 720p-class size that is exact on
all three grids.

**The Tide Clock** is three choices deep with a **human** protagonist written
the safe way (never seen face-on): `S0` offers two options, `S1_A` offers
**three** and `S1_B` two, and all five depth-2 states offer two — ten paths
across five endings, several deliberately shared, one (`E05`) looping back to
`S0`. Between them the three examples cover both protagonist strategies.

**Warm estimates assume the bundles' calibrated resolution.** At 1920×1080 the
video shots cost meaningfully more; budget about 3× and add one cold model load
per workflow.

## Known constraint — why the examples say 1920×1088, not 1920×1080

Asking for `1920x1080` does not render 1920×1080. Two grids disagree with it in
opposite directions: `image_flux2_klein_9b_t2i` rounds **down to a multiple of 16**
(→ 1072, measured — its meta's declared `step: 8` is wrong) and `ltx_2_5_i2v`
snaps to a multiple of **64** (→ 1088). You would get stills at 1072 and clips
at 1088, a 16 px mismatch the video model then has to stretch.

**1920×1088 is a multiple of both**, so every stage renders it exactly and the
stills match the clips pixel for pixel — full-HD width at 1.765:1 instead of a
true 1.778:1. The only size that is exactly 16:9 and still exact on all three
grids is 1024×576, at a large cost in resolution. Both are laid out in
[reference/workflows.md](reference/workflows.md).

## Where the format itself is documented

This skill is about *authoring*. For the feature's own reference — the API
routes, the run-order grouping, chained inputs, retrying a failed shot — see
[../docs/storyboard-format.md](../docs/storyboard-format.md).
