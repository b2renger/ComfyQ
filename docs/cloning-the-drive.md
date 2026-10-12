# Cloning the drive

The workshop drive is duplicated with a physical disk cloner, so **everything on
it travels** — including the things you would never deliberately copy to another
machine: a term's worth of student pictures, 2 000 per-job ingredient snapshots,
a quarantine batch full of models you meant to delete, and a marker that makes
the clone boot straight into serving a workflow nobody chose.

This is the checklist. It takes about three hours, nearly all of it the sweep.

---

## 1. Verify the library still runs

**Admin → Maintenance → Run the whole library.** About 2½ hours for 61 bundles on
an RTX 5090.

This is the only step that cannot be hurried, and it is the one that earns the
clone: an image built on an unverified library propagates a broken bundle to
every machine it is written to. The last three sweeps each found something —
twice a bundle that had silently stopped working, once two captioners that had
stopped captioning while reporting success.

> ⚠ **Do not edit anything under `server/` while it runs.** nodemon restarts
> ComfyQ and the sweep dies with its in-memory state. This has happened twice.
> If it does, you do not have to start again:
>
> ```
> node tools/maintenance/publish_partial_sweep.cjs server/data/library-sweep-<stamp>.jsonl
> ```
>
> That publishes the rows that did finish and prints the bundles still to run —
> sweep just those, and the report merges the two halves into one complete run.

Read the report before continuing. `0 failed, 0 flagged, 0 produced nothing` is
the only result worth imaging.

## 2. Empty the model quarantine

**Admin → Maintenance → Quarantine.** A prune *moves* rather than deletes, so a
quarantine batch is still on the disk and still in the image — you would clone
the very files you decided you did not want, and every machine written from the
image would carry them.

Emptying it is the one irreversible step in the whole procedure. Do it with the
sweep's report in front of you, which is why it comes after step 1.

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
| ComfyQ's uploads in `ComfyUI/input` | `comfyq_session__*` and `comfyq__*` |
| `clipspace/` | ComfyUI's mask-editor scratch |
| `comfyq_ingredients/` | the per-job snapshots behind *Download ingredients* |
| `.comfyq-lanes/`, `logs/` | lane state and logs from this machine |
| superseded sweep run records | they describe libraries that no longer match |
| `.serving` / `.boot-student` | so the clone boots into **admin**, not into serving |

> ⚠ **This must run BEFORE the examples are seeded, not after.** It clears
> every input ComfyQ staged, and the examples' input files are staged under
> that same prefix — a wipe afterwards would leave each example pointing at a
> file that is no longer there. The script notices seeded examples and tells
> you to re-seed.

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
node tools/maintenance/seed_examples.cjs --dry      # look first
node tools/maintenance/seed_examples.cjs
```

The sweep has just run every workflow once and kept what each produced, but it
runs through the calibrator rather than the queue, so none of it is a job and
none of it is visible in the interface. This writes one completed job per
workflow, under the user **`examples`**, pointing at the sweep's own result and
the settings that produced it.

The effect is that a freshly cloned machine opens with a populated **All jobs**
tab: pick `examples` in the user filter and every workflow in the library has a
result you can click into — the picture or clip it made, the prompt, the
parameters, the input files, and *Use these settings* to run it again. It is the
fastest way for somebody new to the rig to see what it can actually do.

It re-stages each example's input files under the durable `comfyq_session__`
prefix, because the sweep's own staged copies carry the `comfyq__` prefix that
the uploader sweeps away after thirty minutes.

## 5. Last look before imaging

```
curl -s localhost:3000/admin/mode          # {"mode":"admin"}
ls server/data/.serving                    # must not exist
```

- **`config.json` must hold no secrets.** It is gitignored, so it travels.
  Check `auth.adminPasswordHash`, `auth.accessPasswordHash` and
  `comfy_ui.hf_token` are all empty — a token in there is handed to every
  machine written from the image.
- **The drive letter looks after itself.** This drive mounts as `J:` on one
  machine and something else on the next, so nothing may depend on the letter.
  On boot ComfyQ notices the configured ComfyUI root has no `main.py`, finds the
  install on whatever letter it is now, and repoints the ComfyUI paths, the
  assets folder and the workflow scan folders. Nothing to do by hand.
- **Machine identity re-mints itself.** `config.instance` carries a UUID, name,
  GPU and VRAM. On first boot, if the recorded hostname is not this machine's,
  all of it is detected again — so clones do not appear in ComfyQ Discovery as
  several copies of the machine they were imaged from.

---

## After writing the image

Nothing. The first boot on the new machine repoints its paths, re-mints its
identity and starts in admin mode. Set an admin password on any machine that
will be used in a room — the panel is reachable from the LAN by anyone who
knows the URL, and it is the password, not the absence of a link, that is the
boundary.
