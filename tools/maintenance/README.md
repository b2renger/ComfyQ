# `ComfyQ\tools\maintenance\` — everything you need to know about this drive

This is an **external NVMe that carries a complete, hand-tuned ComfyUI**. It gets plugged into
different machines and mounts under different letters (`J:`, `K:`, …), so nothing here ever
hardcodes a drive letter — every script finds the ComfyUI install through
[`comfyq_paths.py`](comfyq_paths.py): first `COMFY_ROOT` if you set it, then the path saved in
ComfyQ under **Manage ComfyUI → ComfyUI Settings** (`comfy_ui.root_path` in ComfyQ's
`config.json`).

These files used to live in `ComfyUI_windows_portable_nvidia\_maintenance\`, beside the
install. That folder is gone: they now live in the ComfyQ repo, so they travel with it.
[`COMFYQ-NOTES.md`](COMFYQ-NOTES.md) says what the move changed.

## Start here

| If you… | Read / run |
|---|---|
| **just updated anything** (ComfyUI, a pack, Manager "update all") | **double-click [`REPAIR.bat`](REPAIR.bat)** (or Admin → Maintenance → Maintenance scripts → *Repair the ComfyUI install*) — re-applies the hand-fixes updates silently revert. Then [`fix_custom_node_patches.py`](fix_custom_node_patches.py) (*Re-apply the custom-node fixes* on the same card) for the Qwen-Image 2.1 ControlNet pack, then restart ComfyUI (Admin → Manage ComfyUI → *Restart ComfyUI*, after *Reset to admin* if the machine is serving; or close and relaunch a ComfyUI you started by hand), then hard-refresh the browser (Ctrl+Shift+R) |
| want to know *why* this install is fragile, and what was changed | **[`notice.md`](notice.md)** — the full background + checklist |
| need disk space | Admin → Maintenance → *Prune unused models* (it moves files to `_model_quarantine\`; empty a batch from the *Quarantined models* card to free the space). For the per-model decision sheet see [`model-audit\`](model-audit/README.md); don't use `prune-models.ps1 -Purge` on a drive the panel has quarantined to |
| plugged this drive into a new machine | the [*Hardware floor*](#-hardware-floor--check-this-before-plugging-the-drive-into-a-new-machine) section below, then [`notice.md`](notice.md) → *"First time on a new machine"*; `Readme.txt` at the root of the drive for Node 24 and `safe.directory` |
| **can't get ComfyUI to start** | [*If it won't start*](#if-it-wont-start) below |
| need the backup, or want to make one | [`backup-and-move.md`](backup-and-move.md) |
| are wondering about ID-V2V / the ComfyUI core patch | [`integrations\idv2v.md`](integrations/idv2v.md) |

Two rules that matter more than anything else in this folder:

1. **Never run `update\update_comfyui_and_python_dependencies.bat`.** It upgrades PyTorch off
   2.8.0 and every compiled CUDA kernel the 3D packs depend on stops loading. Updating ComfyUI
   *core* is fine; updating the *Python dependencies* is what breaks things.
2. **After any update, run `REPAIR.bat`** (and `fix_custom_node_patches.py` after updating the
   Qwen-Image 2.1 ControlNet pack), then restart ComfyUI (Admin → Manage ComfyUI → *Restart
   ComfyUI*, after *Reset to admin* if the machine is serving; with `comfy_ui.autoStart` off the
   card then shows it stopped, so press *Launch ComfyUI on network* first, which only
   reconnects, then *Restart ComfyUI*; or close and relaunch a ComfyUI you started by hand),
   then hard-refresh the browser (Ctrl+Shift+R). Updates don't error —
   they silently revert the hand-fixes and you find out when a workflow fails.

## What is in this folder

```
tools\maintenance\
  README.md                  this file
  COMFYQ-NOTES.md            what changed when this folder moved into the ComfyQ repo
  notice.md                  the fragility notes + full checklist of every hand-fix
  backup-and-move.md         the backup: how to find it, restore from it, remake it
  REPAIR.bat                 <-- double-click after any update
  repair_all.py              the orchestrator behind REPAIR.bat
  fix_resolution_combos.py   TRELLIS2 dropdown fix      (called by repair_all)
  portablize_paths.py        TRELLIS2 workflow paths    (called by repair_all)
  fix_custom_node_patches.py Qwen-Image 2.1 ControlNet pack fix (NOT called by repair_all)
  comfyq_paths.py            where ComfyUI is, read from ComfyQ's config.json
  python-path.js             the same answer for the .bat files, which cannot read JSON
  wipe_for_clone.cjs / seed_examples.cjs / publish_partial_sweep.cjs / recover_sweep.cjs
                             preparing the drive to be cloned, and rescuing a killed library
                             sweep (see COMFYQ-NOTES.md → Preparing the drive to be cloned,
                             and docs/cloning-the-drive.md)
  laneResidue.cjs / exampleRules.cjs
                             the tested rules behind wipe_for_clone.cjs and
                             seed_examples.cjs (each with a *.test.cjs)
  output_stats.py            measures each library-sweep output (black / flat / tiny /
                             empty); ComfyQ's library sweep runs it
  integrations\
    idv2v.md                 ID-V2V video restylization: what it is, how it is wired
  model-audit\
    README.md                how to use and refresh the audit
    model-audit.csv          <-- THE decision sheet: every model, what needs it,
                                 duplicates, backup status. Fill the ACTION column.
    AUDIT.bat                <-- double-click: a small editor for that CSV
    prune-models.ps1         acts on the CSV: dry run -> quarantine -> purge/restore
    MODEL-AUDIT.md           the narrative report: method, traps, the big numbers
    custom-nodes-audit.csv   the same idea for the custom-node packs: a hand-made
                                 snapshot from the 2026-09-11 audit (43 packs), not regenerated
    completeness-review.md   what the model pass missed (backups, duplicates), 2026-09-11
    build_csv.py             rebuilds model-audit.csv from the scan data
    rescan.py / rescan_nodes.py / verify_audit.py   rebuild + check the scan data
    …and the editor's helpers, decisions.json and prune-log.csv: see
                                 model-audit/README.md → The rest of this folder
```

For the install itself you only ever *run* four things: `REPAIR.bat` (safe always),
`fix_custom_node_patches.py` (after an update of the Qwen-Image 2.1 ControlNet pack — REPAIR
does not cover it; the panel's
*Re-apply the custom-node fixes* button runs it), `model-audit\AUDIT.bat` (opens the decision
sheet in a browser; *Save* writes only that CSV, but the Workflows tab's *Replace* edits the
chosen workflow file in place and keeps a `.bak` — for a served bundle, both its `.api.json`
and its `_template.json`), and `model-audit\prune-models.ps1` (deletes nothing
on its own — dry-run by default, quarantines before it purges, and refuses models it can see
are still in use).

The clone and sweep-rescue scripts (`wipe_for_clone.cjs`, `seed_examples.cjs`,
`publish_partial_sweep.cjs`, `recover_sweep.cjs`) are run as described in
[docs/cloning-the-drive.md](../../docs/cloning-the-drive.md); `recover_sweep.cjs`, which that
page does not use, is explained in [`COMFYQ-NOTES.md`](COMFYQ-NOTES.md).

## The install, in one table

Figures as of 2026-11-05; the version and the counts move with every update.

| | |
|---|---|
| ComfyUI | `ComfyUI_windows_portable\ComfyUI` — **0.43.2**, a git checkout (detached HEAD on the version tag). The current version is in `ComfyUI\comfyui_version.py` |
| Python | `ComfyUI_windows_portable\python_embeded` — **3.12.10**, **torch 2.8.0+cu128** (pinned, see notice.md §1) |
| Models | `ComfyUI\models` — **~1.3 TB** (1282 GB in `model-audit.csv`), most of what is used on the drive |
| Custom nodes | `ComfyUI\custom_nodes` — 45 folders (44 packs + ComfyQ's own `comfyq_opener`), 1.8 GB |
| Launchers | `run_nvidia_gpu.bat` (+ `_fast_fp16_accumulation`, `run_cpu`) — all carry `--listen 0.0.0.0` |

### ⚠ Hardware floor — check this before plugging the drive into a new machine

| | |
|---|---|
| **GPU** | **sm_89 or newer** — Ada (40xx), Blackwell (50xx), RTX PRO. **Ampere (RTX 3090 / A6000) will NOT work.** |
| VRAM | 16–24 GB for most workflows; **24 GB+** for the 3D packs and bf16 models |
| Driver | NVIDIA, CUDA 12.8 class or newer |
| OS | Windows 10 / 11 |

The 3D packs run on **prebuilt** CUDA kernels compiled for sm_89+, and there is no compiler on
this drive to rebuild them. On an Ampere card they fail with a pile of `DLL load failed` /
`undefined symbol` at startup — **which is exactly what PyTorch drift looks like too**
(notice.md §1). Don't go re-pinning a stack that was never wrong: run `REPAIR.bat --check`
first. If it reports torch 2.8.0+cu128 and the compiled extensions importing, the stack is
fine and the GPU is the problem.

## If it won't start

When ComfyQ started ComfyUI there is no console window, so look in the log files.

**First: ComfyQ's own copy of ComfyUI's console**, in `ComfyQ\.comfyq-lanes\logs\`:

```
comfyui-<port>.err.log   everything ComfyUI printed to its error stream -- including
                         errors from before ComfyUI's own log file is set up. ComfyQ's
                         terminal echoes it with a [ComfyUI!] prefix.
comfyui-<port>.out.log   the rest of its console output
```

**Then ComfyUI's own rotating logs**, named after the `--port` it was started with. **Which
file you want depends on who started ComfyUI, not on the name**:

```
ComfyUI_windows_portable\ComfyUI\user\
  comfyui_8188.log  (+ .prev, .prev2)   the main ComfyUI ComfyQ starts, on the port set under
                                        Manage ComfyUI (8188 by default)
  comfyui.log       (+ .prev, .prev2)   boots you started by double-clicking run_*.bat (no --port)

ComfyQ\.comfyq-lanes\<workflow>\user\
  comfyui_8189.log  (and up)            an extra lane serving a second workflow in parallel:
                                        its own port and its own user folder
```

So with ComfyQ running the install (`autoStart: true`), `comfyui.log` can be days stale while
`comfyui_8188.log` is the live one. **Sort by timestamp, don't trust the name.**

Search for `IMPORT FAILED` and `Traceback` first — a healthy boot has **zero** of both. A good
boot also shows `** Python version: 3.12.10`, the torch version, total VRAM, and per-pack
import times. Note only the *first* line of each record carries a `[timestamp]`; stack-trace
bodies continue underneath untimestamped, so read around a hit rather than filtering on the
timestamp prefix.

| Symptom in the log | What it means | Fix |
|---|---|---|
| `DLL load failed` / `undefined symbol` on the 3D packs | PyTorch drifted **or** the GPU is Ampere | `REPAIR.bat --check` tells you which — see the hardware floor above and notice.md §1 |
| `<<<<<<<` in a `.py`, or a `SyntaxError` in `comfy\` | someone ran `git stash pop` after an update | notice.md §1b — restore the file with git and run `REPAIR.bat` |
| port 8188 already in use | **ComfyQ's ComfyUI already holds that port** (`autoStart: true`). It keeps running when ComfyQ is closed, so closing ComfyQ does not free the port | use the ComfyUI that is running (http://localhost:8188), or stop it from ComfyQ: Admin → *Reset to admin* (if it is serving) → Manage ComfyUI → *Stop ComfyUI*. With `comfy_ui.autoStart` off, the card shows ComfyUI as stopped after *Reset to admin* even though it is still running: press *Launch ComfyUI on network* first (it reconnects to the running ComfyUI), then *Stop ComfyUI*. Don't double-launch |
| `IMPORT FAILED` on one pack only | that pack's deps, not the install | read its traceback; the rest of ComfyUI is fine |
| nodes missing from the menu after an update | a hand-fix was reverted | `REPAIR.bat` (and `fix_custom_node_patches.py` for the Qwen-Image 2.1 ControlNet pack), then restart ComfyUI (Admin → Manage ComfyUI → *Restart ComfyUI*, after *Reset to admin* if the machine is serving; or close and relaunch a ComfyUI you started by hand), then hard-refresh the browser (Ctrl+Shift+R) |

### Where the workflows live

| | |
|---|---|
| `ComfyQ\workflows` | **production** ComfyQ bundles served to students (`<id>.api.json`, `<id>.meta.json` and `<id>_template.json`) |
| `ComfyQ\workflows\_candidate_workflows` | **staged for later testing**, possibly promoted into ComfyQ — tested workflows only, nothing else |
| `_demo_workflows` | demo / teaching workflows |
| `ComfyUI\user\default\workflows` | ComfyUI's own **Workflows sidebar** — where rig test workflows are staged |

Everything the model audit reads lives **on this drive**. ⚠ **The audit and ComfyQ's prune
tool count a folder only while it is switched on** in ComfyQ under Admin → Maintenance →
*Prune unused models* → *Folders scanned for workflows* (stored per machine in `config.json`
as `maintenance.scanDirsOff`). The bundles folder (`ComfyQ\workflows`) is always on. The
candidates folder, ComfyUI's saved workflows, the parallel lanes' saved workflows and any
folder you added there (such as `_demo_workflows`) protect their models **only while switched
on** — on this machine all of them are switched off, and already were when the shipped
`model-audit.csv` was built (2026-10-16), so its `UNUSED` rows ignore those folders. A
switched-off folder:

- in the **prune tool**, is still read: a model only it uses is listed under *Worth a look*,
  with that folder named, and never in the confident group;
- in the **model audit**, is not read at all: its models read `UNUSED` in `model-audit.csv`,
  and `prune-models.ps1` will not refuse them (it refuses only rows marked `LOADED`,
  `PICKABLE` or `AUTO-DOWNLOAD`).

Check that card before you prune.

The old `Downloads\workflows_a_tester` staging folder sat on `C:`, so the audit's answer
changed depending on which machine the drive was plugged into; it was retired 2026-09-11 and
its workflows moved into `_candidate_workflows`.

`_candidate_workflows` is not production. With its folder switched on, **its models are
protected**; with it switched off, they are not.

### Backups (on the master machine only — not on this drive)

- `E:\comfyq_iso\ComfyQ_ComfyUI_portable.iso` — **647 GB**, built 2026-07-10, with a `.sha256`
  and a `BUILD-INFO.txt`. A curated subset: the four big weight buckets trimmed to
  ComfyQ-referenced models only, every other `models\` subfolder kept whole.
- `D:\comfyq_iso_build\` — **652 GB**, the staging tree the ISO was built from. **Redundant**
  now the ISO exists, and the single largest reclaim available on this machine.

When the ISO was compared with this drive (2026-09-11), 636 GB of the models here were a
strict, size-verified subset of it — so for those files a deletion is restorable by
file-copy, no re-download, no licence gate — **on the master machine**. On any other machine
these disks are not there, so a deleted model has to be downloaded again. The `backup` column in `model-audit.csv` says
which files have a copy (123 rows / 424.8 GB in the sheet of 2026-10-16). **Caveat:** the ISO
is a snapshot of 2026-07-10, so it says nothing about what was added since — ~353 GB by the
time this folder moved into the repo (2026-10-05: MiniMax H3, LTX 2.5, Wan-Animate 2,
SCAIL-2), and more after. It is also *curated*, not a mirror: the four big weight buckets were
trimmed to ComfyQ-referenced models only, so a few things you might expect — `flux1-dev`,
`stable-audio-open-1.0` — are **not** in it despite being licence-gated and awkward to refetch.

## How ComfyQ relates to this install

[ComfyQ](../../README.md) (`<drive>\ComfyQ`, the repo this folder lives in) is the multi-user
scheduler that drives this ComfyUI. It does **not** contain a ComfyUI — it points at this one:

- `<drive>\ComfyQ\config.json` (ComfyQ's `config.json`, at the repo root) →
  `comfy_ui.root_path` / `python_executable` point into
  `ComfyUI_windows_portable\`. ComfyQ self-heals this path when the drive letter changes
  (it scans for the portable layout on boot).
- ComfyQ launches and manages the ComfyUI process (start / restart / take over an externally
  started one). That ComfyUI **keeps running when ComfyQ is closed**, so before maintenance
  that touches model files, stop ComfyUI itself: Admin → *Reset to admin* (if it is serving)
  → Manage ComfyUI → *Stop ComfyUI*. Closing ComfyQ alone leaves ComfyUI running. With
  `comfy_ui.autoStart` off, the card shows ComfyUI as stopped after *Reset to admin* even
  though it is still running: press *Launch ComfyUI on network* first (it reconnects to the
  running ComfyUI), then *Stop ComfyUI*.
- ComfyQ installs `custom_nodes\comfyq_opener\` on every launch and version-checks it — it is
  how "Open in ComfyUI" hands a bundle over to the editor. Deleting it is pointless; it comes
  back.
- Uploaded job media lands in `ComfyUI\input\comfyq_session__*` and job "ingredients" in
  `ComfyUI\comfyq_ingredients\`. Neither has a retention policy; both grow slowly. The rest
  of `input\` is mostly hand-placed test assets.

**Adding a workflow or a model?** The bundle layout (`<id>.api.json`, `<id>.meta.json` and
`<id>_template.json`) and the
add-a-workflow walkthrough are in [ComfyQ's README](../../README.md). For a model, `model-audit.csv`'s
`relpath` column shows where each kind belongs.

Knowledge split, so nothing drifts: **this folder is the operational home** (what you run,
what you read when something breaks). It is part of the ComfyQ repo, so it is versioned with
ComfyQ and travels with it — on a clone of the drive or a fresh checkout alike. The rest of the
repo holds anything ComfyQ-specific; where both mention a topic, the pointer runs from the
rest of the repo to here.
