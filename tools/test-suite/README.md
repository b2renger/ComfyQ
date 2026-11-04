# test-suite — the library, run on purpose

A **suite** is the library sweep run in a deliberate order with chosen inputs.
The plain sweep feeds every workflow whatever the assets folder holds (the median
photo, the smallest video) and its own literal prompt: that answers *does it
run*, and nothing else. A suite says, for every workflow, **what to ask it and
which earlier result to feed it**:

- a text-to-image result becomes the picture an edit card edits,
- that edit becomes a video's last frame,
- one text-to-video result becomes what every video-to-video card restyles,
- and cards that do the same job get the **same inputs**, so they can be compared.

The results are published as the sweep report the admin panel's *Library sweep*
card shows, and [`seed_examples.cjs`](../maintenance/seed_examples.cjs) turns
them into the `examples` jobs students can browse in **All jobs**.

| file | what it is |
|---|---|
| [`library.suite.json`](library.suite.json) | every workflow in the library, in four stages, on one story (Maren the lighthouse keeper) |
| [`run-suite.cjs`](run-suite.cjs) | runs a suite from the command line |
| [`derive_input.py`](derive_input.py) | makes an input from an output: a frame, a crop, a mirror, a blur, a transparent hole |

## Running it

```bash
node tools/test-suite/run-suite.cjs library --check          # validate against the library
node tools/test-suite/run-suite.cjs library --dry            # print every run and where each input comes from
node tools/test-suite/run-suite.cjs library                  # everything (about 3½ h on a 5090)
node tools/test-suite/run-suite.cjs library --only a,b       # just these, in suite order
node tools/test-suite/run-suite.cjs library --from <id>      # resume from one bundle
node tools/maintenance/seed_examples.cjs --replace           # then: the results become the examples
```

The machine must be in **admin mode** (not serving) — the same rule as the
panel's sweep, because a suite holds the GPU for hours and restarts ComfyUI
between workflows that need different performance flags. From the panel, the
same suite runs with `POST /admin/library-sweep/run {"suite": "library"}`
(admin password).

It runs through `AdminCalibrator`, one workflow at a time, so each workflow's
`disabledPerfFlags` are masked and each run **is** a calibration: `runtime.json`
gets the measured times and VRAM. Suite settings are each card's defaults except
prompts and inputs, so those times describe the job a student books. A run that
changes a cost setting (a shorter clip, a smaller size) sets `"keepRuntime": true`.

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
        "<image key>": null                                   // leave an optional input empty
      } } ] } ] }
```

- **Each bundle appears once** — the report is keyed by bundle id.
- **Order matters.** An `output:` reference is resolved when the run starts, from
  this run's results (or, with `--only`, the last published report). A run whose
  input cannot be found is **skipped with the reason** — never fed a random asset
  instead, which would make an example that pretends to follow from a result it
  never saw.
- `derive` ops (`derive_input.py`): `frame {index}`, `crop {box: [x0,y0,x1,y1]}`
  (fractions), `flip`, `scale {factor}`, `blur {radius}`,
  `transparent {shape: ellipse|rect, box}` — the last is how ComfyQ's mask painter
  marks *inpaint here* (`LoadImage`'s MASK is 1 − alpha). Derived files go to
  `server/data/suite-inputs/<run>/`.
- A mesh input takes a `.glb`/`.gltf`/`.obj` before a `.ply`: TripoSplat writes a
  splat `.ply` beside its mesh.
- `--check` refuses an unknown bundle or parameter key, a duplicate, a select value
  outside its options, and a reference to a bundle that runs later.

`validateSuite` and the resolver are pinned by
[`server/benchmark/suitePlan.test.js`](../../server/benchmark/suitePlan.test.js).
