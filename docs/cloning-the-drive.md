# Cloning the drive

The workshop drive is duplicated with a physical disk cloner, so **everything on
it travels** — including the things you would never deliberately copy to another
machine: a term's worth of student pictures, 2 000 per-job ingredient snapshots,
a quarantine batch full of models you meant to delete, and a marker that makes
the clone boot straight into serving a workflow nobody chose.

This is the checklist. It takes about three hours, nearly all of it the test
suite in step 1.

---

## 1. Verify the library still runs

**Admin → Maintenance → Run the whole library → Run the test suite**, in admin
mode (press *Stop serving* first if the machine is serving). About 2½–3 hours
for 80 bundles on an RTX 5090; the last two runs took 2 h 31 min and 2 h 46 min.
From a terminal, the same run is `node tools/test-suite/run-suite.cjs library`.

Press **Run the test suite**, not **Run every workflow**. Both run every bundle
once, so either one verifies the library. But only the test suite feeds each
workflow the prompts and inputs chosen to show what it is good at, and writes
the caption each example carries. Step 4 makes the examples from whatever this
step publishes: after *Run every workflow* they have no captions and show
generic sample inputs, and the wipe in step 3 then deletes the test suite's
earlier results, because the report no longer points at them.

This is the only step that cannot be hurried, and it is the one that earns the
clone: an image built on an unverified library propagates a broken bundle to
every machine it is written to. The last three sweeps each found something —
twice a bundle that had silently stopped working, once two captioners that had
stopped captioning while reporting success.

> ⚠ **Do not edit anything under `server/` while it runs.** nodemon restarts
> ComfyQ and the sweep dies with its in-memory state. This has happened twice.
> If it does, you do not have to start again. Take the newest
> `library-sweep-<stamp>.jsonl` in `server/data`, look at what it would publish,
> then publish it:
>
> ```
> node tools/maintenance/publish_partial_sweep.cjs server/data/library-sweep-<stamp>.jsonl --dry
> node tools/maintenance/publish_partial_sweep.cjs server/data/library-sweep-<stamp>.jsonl
> ```
>
> That publishes the rows that did finish and prints the bundles still to run.
> Sweep just those: press **Run the remaining N of the test suite** on the sweep
> card (it carries on with the test suite's prompts, inputs and captions), or
> from a terminal run `node tools/test-suite/run-suite.cjs library --only <the
> ids it printed, separated by commas>`. Either way the report merges the two
> halves into one complete run.
>
> If the continuation is interrupted too, rescue it the same way from its own
> `.jsonl`: a killed subset run keeps the rows already published and adds its
> own, so the two rescues add up.

Read the report before continuing. Its RESULT line must end in
`0 failed · 0 with suspect output · 0 produced nothing` (on the card, the
*failed* and *suspect output* tiles both at 0), and the line under the title
must carry nothing in square brackets after the finished date, such as
`[partial]` or `[stopped]` (on the card, no *Run the remaining N* button). A
run that was cut short ends in the same zeros while covering only part of the
library: run the remainder first (see the box above), or the whole test suite
again if the card offers no remainder. Only a complete run with those zeros is
worth imaging.

## 2. Empty the model quarantine

**Admin → Maintenance → Quarantined models.** A prune *moves* rather than
deletes, so a quarantine batch is still on the disk and still in the image — you
would clone the very files you decided you did not want, and every machine
written from the image would carry them.

Emptying it cannot be undone, and neither can the wipe in step 3. Do it with the
step-1 report in front of you, which is why it comes after step 1.

## 3. Clear the workshop's residue

```
node tools/maintenance/wipe_for_clone.cjs --dry     # always read this first
node tools/maintenance/wipe_for_clone.cjs
```

Roughly 5 GB on a drive that has run a few sessions. It clears:

| | why |
|---|---|
| the job history (`comfyq.sqlite`) | students' names, prompts and results |
| everything in `ComfyUI/output`… | past sessions, and the stale output of every earlier sweep |
| …**except** what the report points at | those become the step-4 examples |
| ComfyQ's uploads and storyboard frames in `ComfyUI/input` | `comfyq_session__*`, `comfyq__*` and `comfyq_chain__*` (a storyboard's chained frames, copied from students' results) |
| `clipspace/` | ComfyUI's mask-editor scratch |
| ComfyUI's `temp/` | preview scratch, which ComfyUI also empties at every start |
| `comfyq_ingredients/` | the per-job snapshots behind *Download ingredients* |
| `.comfyq-lanes/` | lane folders and logs of ComfyUIs that are not running. A running ComfyUI's entry in `processes.json`, its log files and its lane folder are kept, or the next ComfyQ would not recognise it as its own |
| superseded sweep run records | they describe libraries that no longer match |
| `.serving` / `.boot-student` | so the clone boots into **admin**, not into serving |

> ⚠ **This must run BEFORE the examples are seeded, not after.** It empties
> the whole job history and clears every input ComfyQ staged, so a wipe
> afterwards deletes the examples themselves, along with their input files
> (staged under the same `comfyq_session__` prefix as every upload). The script
> notices seeded examples and tells you to seed them again.

### What it deliberately leaves alone

- **Files in `ComfyUI/input` that ComfyQ did not put there.** On this drive
  that is ~500 files going back to June 2025 — reference images, test meshes,
  somebody's working material. Not residue, and not the script's to delete. It
  reports the count and size; remove them by hand if the image should not carry
  them.
- **`comfyq_model_access.jsonl`** — the record of which weights have actually
  been loaded here. It can only ever *protect* a model from being pruned, and a
  fresh clone starts with no history of its own, so it is worth carrying.
- **`pruned-models.jsonl`** — how to fetch a pruned model back. The difference
  between "deleted" and "lost".

## 4. Keep one example per workflow *(optional, recommended)*

```
node tools/maintenance/seed_examples.cjs --dry --replace      # look first
node tools/maintenance/seed_examples.cjs --replace
```

`--replace` first removes any earlier example of each workflow, so the step can
be repeated without leaving two examples per workflow. It removes only the
`examples` jobs, never anyone else's.

The test suite has just run every workflow once and kept what each produced,
but it runs through the calibrator rather than the queue, so none of it is a job
and none of it is visible in the interface. This writes one completed job per
workflow, under the user **`examples`**, pointing at the suite's own result, the
settings that produced it, and the suite's caption saying what it shows.

Students see them on the main page, which exists only while a workflow is
served: **All jobs** → pick `examples` in the user filter, and every workflow in
the library has a result you can click into — the picture or clip it made, the
prompt, the parameters, the input files and the caption. The card of the
workflow being served also has a **See an example** link. *Use these settings*
appears only on the example of the workflow the page books (the booking form
has to match it); every example offers *Download ingredients (.zip)*. It is the
fastest way for somebody new to the rig to see what it can actually do.

To check them before imaging, serve any workflow (**Activate & serve**), look,
then press **Reset to admin**: serving writes `server/data/.serving`, which
step 5 needs to be gone.

It re-stages each example's input files under the durable `comfyq_session__`
prefix, because the run's own staged copies carry the `comfyq__` prefix that
the uploader sweeps away after thirty minutes.

## 5. Last look before imaging

From the ComfyQ folder, in PowerShell or Git Bash:

```
curl.exe -s http://localhost:3000/admin/mode     # {"mode":"admin"}
ls server/data/.serving                          # must not exist
```

- **`config.json` must hold no secrets.** It is gitignored, so it travels.
  Check `auth.adminPasswordHash`, `auth.accessPasswordHash` and
  `comfy_ui.hf_token` are all empty — a token in there is handed to every
  machine written from the image. `wipe_for_clone.cjs` warns, naming the key,
  when one is still set. Any `config.json…bak` or `config.json.tmp` beside it
  (a kept copy of an earlier or unreadable config; the wipe names each one)
  carries the same secrets; delete it before imaging.
- **The drive letter looks after itself.** This drive mounts as `J:` on one
  machine and something else on the next, so nothing may depend on the letter.
  On boot ComfyQ notices the configured ComfyUI root has no `main.py`, finds the
  install on whatever letter it is now, and repoints the ComfyUI paths, the
  assets folder and the workflow scan folders. Nothing to do by hand.
- **Machine identity re-mints itself — except a typed name.** `config.instance`
  carries an ID, a name, the GPU and the VRAM. On first boot, if the recorded
  hostname is not this machine's, the ID is re-minted and the GPU and VRAM are
  detected again, so each clone gets its own card in ComfyQ Discovery. The name
  follows the computer's name, unless one was typed under **Manage server →
  Network presence → This machine is called**: a typed name is kept on every
  clone. Press **Use computer name** there before imaging.

**Then stop everything that runs from the drive, and only then take it out.**
**Manage ComfyUI → Stop ComfyUI** first: closing ComfyQ alone leaves ComfyUI
running, with its log files open on the drive (a ComfyUI started by hand: close
its own window). Then close ComfyQ's black window and eject the drive (*Safely
Remove Hardware*) before putting it in the cloner. If Windows says the drive is
still in use, close any terminal or Explorer window open on the drive first
(including the one you ran this checklist in). If that is not enough, a
`python.exe` from it is still running: end it in Task Manager. Its number is the
`pid` under `procs` in `.comfyq-lanes/processes.json`.

---

## After writing the image

Nothing to do on the drive itself: the first boot on the new machine repoints
its paths, re-mints its identity and starts in admin mode. Each machine the
drive goes into still needs a few things that cannot travel on it (they are
also in `Readme.txt` at the root of the drive):

1. **Windows 10 or 11 and a supported NVIDIA card** — see *Hardware floor* in
   [tools/maintenance/README.md](../tools/maintenance/README.md).
2. **Node.js 24 and Git for Windows installed.**
3. **`git config --global --add safe.directory "*"`**, run once before the
   first `git pull` or the admin panel's update check. It is a setting of the
   Windows user, not of the drive.
4. **An admin password**, on any machine that will be used in a room — the
   panel is reachable from the LAN by anyone who knows the URL, and it is the
   password, not the absence of a link, that is the boundary.
