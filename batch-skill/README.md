# batch-skill — writing ComfyQ storyboards

A skill that teaches an LLM to author the markdown files ComfyQ's **batch
feature** consumes: one document describing a whole film, which ComfyQ queues
as images → the videos made from those images → audio.

```
batch-skill/
  SKILL.md                  the skill itself — grammar, wiring, craft rules
  reference/
    workflows.md            ids, sizes, durations, media slots — the hard numbers
    checklist.md            27 checks to run before emitting, + offline validation
  examples/
    linear-the-lamplighter.md    a straight-through film, 43 shots
    branching-the-tide-clock.md  depth-3 branching, 2- and 3-way choices, 83 shots
    branching-the-red-thread.md  depth-3 branching at 720p, recap choice cards, 81 shots
```

## Using it

**As a Claude Code skill** — copy or symlink the folder into a skills
directory, then invoke it by name:

```powershell
Copy-Item -Recurse batch-skill "$env:USERPROFILE\.claude\skills\comfyq-storyboard"
```

**As a prompt** — paste `SKILL.md` and the two `reference/` files as context,
then ask for the story. That is how the two examples here were written.

## Verifying a storyboard before spending GPU time

Every document should be planned offline first. This needs no ComfyUI:

```bash
node -e "
const {WorkflowRegistry}=require('./server/workflows/workflowRegistry');
const {parseStoryboard}=require('./server/storyboard/storyboardParser');
const {planStoryboard}=require('./server/storyboard/storyboardPlanner');
const r=new WorkflowRegistry(require('path').resolve('workflows')); r.discover();
const p=planStoryboard(parseStoryboard(require('fs').readFileSync(process.argv[1],'utf8')),r,{});
console.log('shots',p.jobs.length,'| errors',p.errors.length);
for(const e of p.errors) console.log('ERR ',e);
" batch-skill/examples/linear-the-lamplighter.md
```

`errors` must be **0**. Then queue it from **/admin → Storyboard batch**, or:

```bash
curl -F file=@batch-skill/examples/linear-the-lamplighter.md \
     -F folder=the-lamplighter \
     -H "X-Admin-Password: $PW" \
     http://localhost:3000/storyboard/queue
```

## The two examples

Both render **1920×1080**, vary their clip lengths, and were validated with the
command above.

| | states | shots | images | videos | audio | model loads | warm est |
|---|---|---|---|---|---|---|---|
| **The Lamplighter** — linear | 8 | 43 | 20 | 14 | 9 | 6 | ~17 min |
| **The Tide Clock** — branching, depth 3 | 16 | 83 | 42 | 24 | 17 | 6 | ~35 min |
| **The Red Thread** — branching, depth 3, 720p | 15 | 81 | 42 | 23 | 16 | 6 | ~25 min |

Measured with the command above, not estimated.

**The Lamplighter** is linear — `LIBRARY → IDLE → S0 → S1 → S2 → S3 → E01` — and
its protagonist is an **object** (a brass lantern), which removes face drift
across nineteen cuts entirely.

**The Red Thread** is the 720p example: eight paths, five endings (three of
them shared), one ending looping back to `S0`, and **text-only choice cards
that open with a two-sentence recap** of the action — the pattern documented in
SKILL.md § 5. It renders at **1280×704**, the 720p-class size that is exact on
all three grids.

**The Tide Clock** is three choices deep with a **human** protagonist written
the safe way (never seen face-on): `S0` offers two options, `S1_A` offers
**three** and `S1_B` two, and all five depth-2 states offer two — twelve paths
across five endings, several deliberately shared, one (`E05`) looping back to
`S0`. Between them the two examples cover both protagonist strategies.

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
true 1.778:1. The only value exact on all three grids is 1024×576, at a large
cost in resolution. Both are laid out in
[reference/workflows.md](reference/workflows.md).

## Where the format itself is documented

This skill is about *authoring*. For the feature's own reference — the API
routes, the run-order grouping, chained inputs, retrying a failed shot — see
[../docs/storyboard-format.md](../docs/storyboard-format.md).
