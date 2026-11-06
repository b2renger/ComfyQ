# Batch feature plan

A draft for the owner to correct before the work starts. It replaces the experimental
storyboard planner. Written 2026-11-06, to be started after the sweep.

## What the owner asked for

- Run any kind of batched generation, not only films.
- Jobs can depend on earlier jobs, because some workflows need assets generated
  beforehand. It runs in order, one job at a time.
- Maybe a CSV rather than a markdown file.
- A better way to reference an asset from a previous generation.
- Still a skill that writes batch instructions.

## What already exists and stays

The queue already holds most of this, and none of it is storyboard-specific:
`batch_id`, `batch_label` and `output_prefix` on a job, the `job_deps` table that says
which output of which job feeds which parameter, and a job that waits until its
sources are done or fails if they fail. Since 2026-11-06 the main lane runs a batch
in order, whatever workflow each job names, and sets up ComfyUI between workflows.

So the work is the front end of a batch, not the execution.

## The proposal: a table of jobs

One row per job, in a file you can write in a spreadsheet, or have the skill write.

| column | meaning |
|---|---|
| `id` | a short name for this row, such as `hero` |
| `workflow` | a card, by the same short names as today |
| `prompt` | the prompt |
| `<param key>` or a short alias | any other setting of that card |
| `image`, `video`, `audio` | an input: see below |
| `repeat` | run this row N times, with different seeds |
| `seed` | fixed, or empty for a fresh one that is recorded |

An input cell says where a file comes from:

| cell | means |
|---|---|
| `hero` | the first output of the row named `hero` |
| `hero#2` | its second output |
| `file:Woman.png` | a file in the assets folder |
| `job:<id>` | an output of a job that already ran |
| `folder:portraits/` | one job per file in that folder |

The last one is what makes this more than a storyboard: one row, a folder of pictures,
and a job for each.

The dependencies come from those cells, so nobody writes them by hand. A cycle or a
reference to a row that does not exist is refused before anything runs.

## How it runs

1. Upload the file. **Preview** shows every job, its order, the time it should take,
   and every problem, before anything is queued.
2. **Run** queues it as one batch. Close the extra lanes first: a batch uses the whole
   machine.
3. The batch page shows each job and its result. A failed job stops what depends on
   it, and the rest carry on.
4. **Retry failed** runs what failed and what was stopped because of it. This settles
   question 38.
5. A finished batch gives one folder of outputs, with a copy of the file and a report
   saying which seed and which inputs made each result, so a batch can be repeated
   exactly, the same way examples can.

## The skill

`batch-skill` becomes a skill that turns a request ("twelve product shots from this
folder, then a short video of the best three") into that table. The film recipes in
it now become examples of what a table can do. It should check its table with the
same validator the upload uses.

## Storyboards

Markdown documents stop being a format of their own. A converter turns one into a
table, so the three examples keep working, and the planner's film logic (key frames,
loops, cards) becomes the skill's job rather than the server's. The planner is removed
when the converter passes its tests on the three examples.

## Stages

1. The file format, its parser and validator, with tests. About a day.
2. Preview and queue, replacing the storyboard routes. About a day.
3. The batch page: progress, results, Retry failed. About a day.
4. The report and exact repeat. About half a day.
5. `folder:` and `repeat`. About half a day.
6. The skill and the converter. About a day.

Each stage is tested with stand-ins, then with one small real batch on the rig.

## Questions for the owner

1. **CSV or something else?** CSV opens in a spreadsheet but makes long prompts with
   line breaks awkward. I recommend CSV, with long prompts allowed to come from a
   text file beside it (`text:scene-3.txt`).
2. **Who can run a batch?** Today, an admin. Should students ever be able to?
3. **Does a batch wait for students' jobs,** or take the machine? I recommend
   waiting behind what is already booked, as today.
4. **Should the batch page live in the admin panel,** or on its own page?
