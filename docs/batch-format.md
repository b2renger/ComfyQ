# The batch table

A batch is a table with one row per job, saved as CSV from any spreadsheet. It replaces
the storyboard markdown (see [batch-feature-plan.md](batch-feature-plan.md)). This page
says what a table may say, what is refused, and how it runs.

An example: [server/batch/fixtures/example.csv](../server/batch/fixtures/example.csv).

```csv
id,workflow,prompt,image,repeat,seed,notes
hero,image_moss_image_t2i,"Studio portrait of a ceramicist, soft window light",,,1234,the picture everything uses
look,image_edit_flux3_klein_image_edit,"Same person, the apron is now orange",hero,3,,three tries
move,video_ltx2_5_i2v,"She turns the bowl slowly and smiles",look,,,one film per look
keys,utility_seedvr2_4k_upscale,,folder:Keyframes,,,
```

That is 11 jobs: one portrait, three edits of it, a film of each edit, and an upscale of
each of the four pictures in `Keyframes`.

## The file

- The first row names the columns. One of them must be `workflow`.
- Commas, semicolons (a French Excel) or tabs all work: the separator is read from the
  first row.
- A cell with a comma, a quote or a line break in it goes in double quotes, and a quote
  inside is doubled (`""`). Spreadsheets do this when they save.
- A row whose first cell starts with `#` is a comment. Empty rows are skipped.
- Errors give the row number the spreadsheet shows (the header is row 1) and the column.

## Columns

| column | meaning |
|---|---|
| `id` | a name for the row, so other rows can use its result. A letter or digit first, then letters, digits, `-`, `_` or `@`. Optional: a row with no id is `row<N>` |
| `workflow` | the card. The full bundle id, or any part of it that names one card only (`moss_image_t2i`) |
| `prompt` | the card's prompt |
| `negative` | its negative prompt |
| `image`, `image2`, … | its picture inputs, in the order the student form shows them. Same for `video`, `audio`, `mask`, `model3d` |
| `repeat` | run the row this many times (1 to 100) |
| `seed` | a fixed seed. Empty: a fresh one, which is recorded with the job |
| `notes` | for people; ignored |
| any setting key | that setting of the card, by its key as the metadata editor shows it (`steps_107`) |

A table can mix cards. A column that a card lacks is fine when its cell is empty on that
card's rows, and an error when it is filled. Settings the row leaves empty take the
card's default, as on the booking form, and the job records the value it ran with.

**Values.** Numbers must sit inside the card's range, and `1,5` reads as 1.5. Yes or no:
`yes`, `no`, `true`, `false`, `1`, `0`, `oui`, `non`, `x`. A choice can be written
without its exact case or punctuation (`1:1 (square)`). A camera setting is JSON.

**A long prompt** can come from a text file in the assets folder: `text:scene-3.txt`.

**A text field set to nothing:** `empty` (an empty cell keeps the card's default).

## Inputs

| cell | means |
|---|---|
| `hero` | the first output of the row `hero` |
| `hero#2` | its second output |
| `hero.3` | the third job of a row that made several |
| `file:Woman.png` | a file in the assets folder (`file:portraits/a.png` for a subfolder) |
| `folder:portraits/` | one job per file of the right kind in that folder, in name order |
| `job:<id>` | an output of a job that already exists, by its id or its first 8 characters (`job:3f2a9c1e#2`) |
| `empty` | leave an optional input empty on purpose (an empty cell does the same in a batch; the test suite tells them apart) |

**A prepared file.** After a `file:` or `folder:` cell, steps separated by `|` prepare it
before it is used, the way the test suite makes a damaged photo for a restorer or the first
frame of a clip:

```
file:Woman.png | scale(0.3) | blur(1.2) | jpeg(40)
file:clip.mp4 | frame(0) | crop(0, 0.16, 1, 0.91)
file:original.mp4 | trim(3, 2) | vscale(0.375) | encode(35)
```

On a picture: `scale(f)`, `crop(x0, y0, x1, y1)` (fractions of the picture), `flip`,
`blur(r)`, `jpeg(quality)`, `noise(sigma, seed)`, `transparent(rect|ellipse, x0, y0, x1, y1)`
(a hole, for a mask), `circle(x0, y0, x1, y1, #colour, width)`,
`composite(file:overlay, x0, y0, x1, y1)`. On a video: `frame(i)` first, which makes a picture,
or `trim(start, duration)`, `vscale(f)`, `vblur(r)`, `mute`, `encode(crf)`. What the steps make
must be what the input takes. The work is done by
[tools/test-suite/derive_input.py](../tools/test-suite/derive_input.py), with ComfyUI's python, when
the batch is queued; a prepared picture then goes through the upload check. Steps cannot yet
prepare another row's result.

A row may use a row written below it. Rows run in the order written, except that a row
moves down far enough to come after the rows it uses.

**One job, or several.** A row makes one job per file of a `folder:`, and one job per
job of a row it uses that made several (with `repeat` or a folder). Those are paired in
order: `move` above makes a film of `look.1`, one of `look.2`, one of `look.3`. Name a
single one (`look.2`) to use only that. Two inputs that would make a different number
of jobs cannot be paired, and that is an error. `repeat` multiplies what is left: each
file, that many times.

**Seeds** step by one per repeat (`seed` 10 and `repeat` 3 give 10, 11, 12). The jobs of
one folder share the seed, so they share a look.

## What is refused

Nothing is queued while the table has an error. Each error names its row and column:

- no `workflow` column, or a card that is not installed, or a name that matches two
- a setting the card does not have, a value out of its range, a choice it does not offer
- an input that names nothing, a missing file, a path outside the assets folder
- an input of the wrong kind (a video into a picture input), when the card that makes it
  is known
- a required input left empty
- a row that uses its own result, or rows that wait on each other in a loop
- inputs that cannot be paired, or `hero.4` when `hero` made three
- a `seed` on a card that has none to set, or a seed set through its own column

A row that only waits on a broken row is listed as blocked, with the row it waits on.

Warnings do not stop a batch: a setting the card's own switch turns off, a mask taken
from a generated picture (it has no transparency, so nothing would be masked), a card
whose output kind cannot be told in advance.

## The test suite is a table

[tools/test-suite/library.suite.csv](../tools/test-suite/library.suite.csv) is written in this
format (since 2026-11-09; the JSON it replaced read back run for run the same, checked by
[to_table.cjs](../tools/test-suite/to_table.cjs)). In the Batches tab, **Open the test suite**
loads it into the editor, **Save to the test suite** writes it back after checking it, and
**Run the test suite** starts it, with no file to load. What makes it a suite:

- one row is one run; its `id` is its card, or `card@variant` for a second run of the card (a
  comparison, an option), which keeps the card's timings and is never made an example;
- `stage` names the group a row starts (it carries down to the rows below), `caption` is what
  the example says about its result, `keepRuntime` (yes) leaves the card's timings alone;
- an input the row does not name gets an asset picked by the calibrator; `empty` leaves it empty.

A suite runs through the library sweep (every card timed, its result made an example), not
through the queue, so the editor offers Run instead of Queue for it. A batch reads past the
suite's columns.

## Running one

An admin runs a batch from the **Batches** tab of the admin panel: write it in the
**Batch editor** there (or open a `.csv` in it), or drop a `.csv` on the upload card; read
the preview, queue. The editor writes the same file: **Export** gives back the `.csv`. It waits behind jobs students have already booked, then runs one
job at a time on the main lane. Close any extra lane first.

A picture from the assets folder goes through the same check as an upload (no HEIC, at
most 2048×2048 and 30 MB), at preview, so a table that names a phone photo straight from
the camera is refused there. Resize it first; resizing on the way in is not built.

Files from the assets folder are copied into ComfyUI's input folder once each, under a
name that is never swept, so a finished batch can be queued again exactly.
