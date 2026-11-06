# test-suite — the library, run on purpose

A **suite** is the library sweep run in a deliberate order with chosen inputs —
and, for `library`, the library's **showcase**: each run is an example of what
its card is uniquely good at, chosen from research into the model (model card,
paper, official prompting guide, ComfyUI template notes), with a `note` saying
what to look at. `seed_examples.cjs` turns the runs into the `examples` jobs, the
note becomes the example's caption ("What this example shows"), and each card on
the scheduling page offers **See an example**.

The plain sweep feeds every workflow whatever the assets folder holds (the median
photo, the smallest video) and its own literal prompt: that answers *does it
run*, and nothing else. A suite says, for every workflow, **what to ask it and
which earlier result to feed it**:

- a picture made from words becomes what an edit card edits, what a character
  sheet is drawn from, what the captioner reads, the face LivePortrait animates
  and the frame a video ends on — the pipeline a student would build;
- where a card's power only shows on a real or a damaged input — a restorer, a
  pose transfer, frame interpolation — it gets one: a real photo made noisy, a
  dancer's clip, two fast seconds of motion (`derive` from an asset);
- cards that do the same job get the **same inputs** (the two SeedVR2 image
  cards, the two video upscalers, SCAIL-2 and Wan Animate, LTX 2.5 depth and
  pose on the same dancer clip), so they compare;
- every prompt is written the way that model's makers document (Ideogram's JSON
  with a box per element, FLUX.3's long captions, H3's shot lists with sound,
  trigger words where an adapter needs one).

The results are published as the sweep report the admin panel's *Run the whole
library* card (Maintenance) shows, and [`seed_examples.cjs`](../maintenance/seed_examples.cjs) turns
them into the `examples` jobs students can browse in **All jobs**.

| file | what it is |
|---|---|
| [`library.suite.json`](library.suite.json) | every workflow in the library, in five stages, each with a showcase example (rebuilt 2026-11-04 from per-family research; the previous one-story version is in git history) |
| [`run-suite.cjs`](run-suite.cjs) | runs a suite from the command line |
| [`suiteAssets.cjs`](suiteAssets.cjs) | lists every assets-folder file a suite names and which are missing, so `--check` and `--dry` can show them before the GPU is booked (tested by `suiteAssets.test.cjs`) |
| [`derive_input.py`](derive_input.py) | makes an input from an output or an asset: a frame, a crop, a hole, a circle, a paste-in, damage (blur, noise, JPEG), a trimmed / shrunk / muted clip |
| [`assets/tunnel_depth_loop.py`](assets/tunnel_depth_loop.py) | makes the perfectly seamless depth-pass loop the loop-restyle card reads as `asset:tunnel_depth_loop.mp4`. Run it with ComfyUI's python (it needs numpy and PyAV) and give it the output path: `<python> -I tools/test-suite/assets/tunnel_depth_loop.py <assets folder>/tunnel_depth_loop.mp4`, where `<python>` is `comfy_ui.python_executable` and the assets folder is `assets.dir` in config.json |

## Running it

```bash
node tools/test-suite/run-suite.cjs library --check          # validate against the library
node tools/test-suite/run-suite.cjs library --dry            # print every run and where each input comes from
node tools/test-suite/run-suite.cjs library                  # everything (about 2½–3 h on a 5090; 2 h 31 min on 2026-11-04)
node tools/test-suite/run-suite.cjs library --only a,b       # just these, in suite order
node tools/test-suite/run-suite.cjs library --from <id>      # resume from one bundle
node tools/test-suite/run-suite.cjs library --data-dir <dir> # an experiment: the report goes to <dir>
node tools/maintenance/seed_examples.cjs --replace           # then: the results become the examples
```

`--data-dir <dir>` writes the report (`library-sweep-latest.json` and the run's
`.jsonl`) into `<dir>` instead of `server/data`, so the published report — and
the examples `seed_examples.cjs` makes from it — stay as they were. It combines
with `--only` and `--from`. Inputs a run takes from an earlier result then come
from **`<dir>`'s own** last report, not the published one: in an empty folder a
run whose input comes from a bundle outside this run is skipped (or given its
`fallback`). Derived inputs go to `<dir>/suite-inputs/<sweep start time>/`,
beside the report.

It still calibrates: the `runtime.json` (timings and VRAM peak) of every bundle
it runs is rewritten, except runs marked `keepRuntime`. To leave no trace, discard those
changes afterwards (`git checkout -- "workflows/*/*.runtime.json"`, which also
discards any other uncommitted `runtime.json` change) or mark the suite's runs
`keepRuntime`.

Since 2026-11-04 ComfyUI outlives the process that started it, so the ComfyUI
a suite starts is left running at the end and the next ComfyQ adopts it. A suite
groups the cards that need a speed-up switched off (only SeedVR2 7B int8 on this
rig) so ComfyUI restarts as rarely as possible.

The machine must be in **admin mode** (not serving) — the same rule as the
panel's sweep, because a suite holds the GPU for hours and restarts ComfyUI
between workflows that need different performance flags. From the panel: Admin →
Maintenance → *Run the whole library* → **Run the test suite**, then **Start the
test suite** (it sends `POST /admin/library-sweep/run {"suite": "library"}`,
which needs the admin password if one is set).

It runs through `AdminCalibrator`, one workflow at a time, so each workflow's
`disabledPerfFlags` are masked and each run **is** a calibration: `runtime.json`
gets the measured times and VRAM. Suite settings are each card's defaults except
prompts, inputs, and choices that leave the job's cost about the same: an aspect
ratio, a width/height at about the same pixel count, a LoRA, colour-correction or
time-of-day choice, an optional input switched off. So those times describe the
job a student books. A run that changes the cost (a longer or shorter clip, more
or fewer pixels or steps, a lighter input than a student's) sets
`"keepRuntime": true`.

**Seeds: an example can be repeated exactly.** A seed set in this file is the seed
that runs. An exposed seed it does not set gets a fresh value, and the sweep report
and the example record it (the report marks it "calibration"). Seeds hidden in the
graph stay as they are, which is what a booking gets, so "Use these settings" on an
example gives back the same result. ComfyUI's cache cannot answer a repeat: every
run starts with a `/free`, which empties it. A plain sweep, with no suite, still
randomises every seed.

## The file

```jsonc
{ "name": "library", "description": "…",
  "stages": [ { "name": "1 — Text to image", "runs": [
    { "workflow": "<bundle id>", "note": "why these inputs",
      "params": {
        "<param key>": "a literal",
        "<image key>": "asset:Woman.png",                     // a file in the assets dir
        "<image key>": "output:image_qwen_image_2_1_t2i",     // that run's first output of this kind
        "<image key>": "output:image_qwen_image_2_1_t2i#2",   // its second one
        "<image key>": { "from": "video_ltx2_5_t2v", "kind": "video",
                         "derive": [ { "op": "frame", "index": 0 } ] },
        "<video key>": { "from": "video_ltx2_5_t2v", "fallback": "asset:dancer.mp4" },
        "<image key>": { "from": "asset:Mariette1.jpg", "derive": [ { "op": "noise", "sigma": 8 }, { "op": "jpeg", "quality": 30 } ] },
        "<video key>": { "from": "asset:dancer.mp4", "derive": [ { "op": "trim", "start": 3, "duration": 2 }, { "op": "mute" } ] },
        "<image key>": null                                   // leave an optional input empty
      } } ] } ] }
```

- **Each bundle appears once** — the report is keyed by bundle id.
- **Order matters.** An `output:` reference is resolved when the run starts, from
  this run's results. When this run has no row for that bundle — it is not in
  this run (`--only`, `--from`) — the input comes from the last published report
  instead (with `--data-dir`, the last report in that folder). A bundle that
  failed or was skipped in this run supplies nothing, so a run downstream of it
  is skipped with the reason, not fed an older result. A run whose input cannot
  be found at all is **skipped with the reason** — never fed a random asset
  instead, which would make an example that pretends to follow from a result it
  never saw. The same goes for a file from the assets folder: a plain `asset:`
  that is not there skips the run, and so does a `fallback` that is not there
  when it is needed. `--check` (and `--dry`) list every asset the suite names
  that is missing, before the GPU is booked.
- `from` can name a bundle (its output) or `asset:<file>` (a file in the assets
  folder, sub-folders allowed); `ops` is accepted for `derive`.
- **Image** `derive` ops (`derive_input.py`, the result is a PNG): `frame {index}`,
  `crop {box: [x0,y0,x1,y1]}` (fractions), `flip`, `scale {factor}`,
  `blur {radius}`, `transparent {shape: ellipse|rect, box}` (how ComfyQ's mask
  painter marks *inpaint here* — `LoadImage`'s MASK is 1 − alpha),
  `circle {box, color, width}` (an outline, how Qwen-Image-Edit is shown *this
  thing*), `composite {overlay, box, key}` (paste a cut-out, its white background
  keyed out), `jpeg {quality}`, `noise {sigma, seed}`.
- **Video** `derive` ops (the result is an `.mp4`, audio trimmed with it):
  `trim {start, duration}`, `vscale {factor}` (applied in order, so a down-scale
  then an up-scale softens), `vblur {radius}`, `mute`, `encode {crf}` (16 clean,
  34–36 blocky). `--check` refuses a video derive into a picture input.
- Derived files go to `suite-inputs/<sweep start time>/<bundle>__<param>.png`
  (or `.mp4`) in the data dir, `server/data` or the `--data-dir` folder: for
  example `suite-inputs/2026-11-04T18-16-50-602Z/image_edit_flux2_klein_9b_image_edit__loadimage_image_76.png`.
- A mesh input takes a `.glb`/`.gltf`/`.obj` before a `.ply`: TripoSplat writes a
  splat `.ply` beside its mesh.
- `--check` refuses an unknown bundle or parameter key, a duplicate, a select value
  outside its options, and a reference to a bundle that runs later.

`validateSuite` and the resolver are pinned by
[`server/benchmark/suitePlan.test.js`](../../server/benchmark/suitePlan.test.js).
