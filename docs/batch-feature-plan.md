# Batch feature plan

A draft for the owner to correct. It replaces the experimental storyboard planner.
Written 2026-11-06.

**Status (2026-11-09):** stages 1 and 2 are written and tested with stand-ins, not yet
on a real batch. The format is in [batch-format.md](batch-format.md), the code in
[server/batch/](../server/batch/). A `.csv` dropped on the storyboard card is read as a
table, previewed and queued by the same routes; `folder:` and `repeat` (stage 5) came
with stage 1. The card has its own **Batches** tab in the admin panel. The owner
answered the four questions on 2026-11-09 (at the end of this page); the table editor
they asked for is stage 7.

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
7. A table editor in the Batches tab: open a `.csv` or start a new one, edit it as a
   grid, and check it with the same validator as an upload before queueing. About two
   days. See below.

Each stage is tested with stand-ins, then with one small real batch on the rig.

## The table editor (stage 7)

Asked for by the owner on 2026-11-09: a built-in way to see and edit a batch, with
import and a new batch from scratch. **A first version is built** (2026-11-09,
[BatchEditor.jsx](../client/src/components/admin/BatchEditor.jsx), top of the Batches tab),
following the sketch below. Its parts render with every card (checked server-side). It has
not been clicked through in a browser yet, because the admin password guards it. One
difference from the sketch: rows are a list you open one at a time, not a spreadsheet grid,
because each card has its own inputs and settings. The sketch:

- **Import** a `.csv` (the upload today), or **New batch** for an empty table with the
  `id`, `workflow`, `prompt` and `image` columns.
- A grid, one row per job, edited in place. The `workflow` cell is a dropdown of the
  cards (owner, 2026-11-09). Once a row has a card, its settings are offered as columns,
  picked by label rather than typed by key, and a setting with choices is a dropdown too.
- **An input cell is a picker with two kinds of source** (owner, 2026-11-09):
  - a file that exists: one from the assets folder, or a whole folder;
  - **a file that does not exist yet**: the output of another row, which has not run.
    Only rows whose card makes that kind are offered (picture-making rows for a picture
    input), and picking one is what makes this row wait for it.
- **The run order is shown**, with what each row waits on, so "the videos run after the
  images they use" is visible before anything is queued.
- Each change is checked by the planner as it is, so a bad cell is marked in place, with
  the same message the upload would give.
- **Export** gives back the `.csv`, so a batch made here can still be kept, versioned,
  or written by the skill and opened here.
- **Queue** runs the same preview and queue routes as an upload.

The table stays the format: the editor reads and writes it and nothing else, so the
skill, a spreadsheet and the editor are interchangeable.

## Dependencies: what is guaranteed

The owner asked (2026-11-09) how a batch makes sure, for example, that the pictures a
t2i row makes exist before the i2v row that uses them runs. What holds today:

- **A cell that names a row is a dependency.** The job waits in the queue
  (`job_deps`) until its source is **completed**; rows run in dependency order even
  when the source is written below.
- **The output is checked when the job starts** (`server/executor/chainedInputs.js`): it
  takes the source's actual output of the right kind. A source that completed without
  one, or whose file was deleted, fails the job with that reason; it never runs on the
  card's default input.
- **A failure stops only what depends on it** (`dependency-failed`); the rest carry on,
  and Retry failed reruns both.
- **Refused before anything runs:** a reference to nothing, a loop, an input of the wrong
  kind (a picture-making row into a video input).

**Not guaranteed:** a source that completes with a black or empty picture counts as
done, and its dependants use it. The test suite's black-output check could run on a
chained input before it is used, failing the dependant with "the picture from hero is
black". Recommended, not built.

## The owner's answers (2026-11-09)

1. **CSV or something else?** CSV, with long prompts from a text file
   (`text:scene-3.txt`). The owner adds: a built-in tool to view and edit the table,
   with import and a new batch (stage 7).
2. **Who can run a batch?** An admin.
3. **Does a batch wait for students' jobs?** Yes, it waits behind what is booked.
4. **Where does the batch page live?** The admin panel, in its own tab.
