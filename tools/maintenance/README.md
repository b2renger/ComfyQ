# `_maintenance\` — everything you need to know about this drive

This is an **external NVMe that carries a complete, hand-tuned ComfyUI**. It gets plugged into
different machines and mounts under different letters (`J:`, `K:`, …), so nothing here ever
hardcodes a drive letter — every script finds its targets relative to this folder.

## Start here

| If you… | Read / run |
|---|---|
| **just updated anything** (ComfyUI, a pack, Manager "update all") | **double-click [`REPAIR.bat`](REPAIR.bat)** — re-applies the hand-fixes updates silently revert |
| want to know *why* this install is fragile, and what was changed | **[`notice.md`](notice.md)** — the full background + checklist |
| need disk space | **[`model-audit\`](model-audit/README.md)** — double-click `AUDIT.bat`, mark what goes, run the pruner |
| are setting up on a new machine | [`backup-and-move.md`](backup-and-move.md), then [`notice.md`](notice.md) → *"First time on a new machine"* |
| **can't get ComfyUI to start** | [*If it won't start*](#if-it-wont-start) below |
| need the backup, or want to make one | [`backup-and-move.md`](backup-and-move.md) |
| are wondering about ID-V2V / the ComfyUI core patch | [`integrations\idv2v.md`](integrations/idv2v.md) |

Two rules that matter more than anything else in this folder:

1. **Never run `update\update_comfyui_and_python_dependencies.bat`.** It upgrades PyTorch off
   2.8.0 and every compiled CUDA kernel the 3D packs depend on stops loading. Updating ComfyUI
   *core* is fine; updating the *Python dependencies* is what breaks things.
2. **After any update, run `REPAIR.bat`.** Updates don't error — they silently revert the
   hand-fixes and you find out when a workflow fails.

## What is in this folder

```
_maintenance\
  README.md                  this file
  notice.md                  the fragility notes + full checklist of every hand-fix
  backup-and-move.md         the backup: how to find it, restore from it, remake it
  REPAIR.bat                 <-- double-click after any update
  repair_all.py              the orchestrator behind REPAIR.bat
  fix_resolution_combos.py   TRELLIS2 dropdown fix      (called by repair_all)
  portablize_paths.py        TRELLIS2 workflow paths    (called by repair_all)
  integrations\
    idv2v.md                 ID-V2V video restylization: what it is, how it is wired
    patches\                 the upstream diff the ID-V2V fix is derived from
  model-audit\
    README.md                how to use and refresh the audit
    model-audit.csv          <-- THE decision sheet: every model, what needs it,
                                 duplicates, backup status. Fill the ACTION column.
    AUDIT.bat                <-- double-click: a small editor for that CSV
    prune-models.ps1         acts on the CSV: dry run -> quarantine -> purge/restore
    MODEL-AUDIT.md           the narrative report: method, traps, the big numbers
    custom-nodes-audit.csv   the same idea, for the 43 custom-node packs
    completeness-review.md   what the model pass missed (backups, duplicates)
    build_csv.py             rebuilds model-audit.csv from the scan data
    rescan.py / rescan_nodes.py / verify_audit.py   rebuild + check the scan data
```

You ever *run* three things: `REPAIR.bat` (safe always), `model-audit\AUDIT.bat` (opens the
decision sheet in a browser; writes only that CSV), and `model-audit\prune-models.ps1` (deletes
nothing on its own — dry-run by default, quarantines before it purges, and refuses models it
can see are still in use).

## The install, in one table

| | |
|---|---|
| ComfyUI | `ComfyUI_windows_portable\ComfyUI` — **0.35.0**, a git checkout (detached HEAD on the version tag) |
| Python | `ComfyUI_windows_portable\python_embeded` — **3.12.10**, **torch 2.8.0+cu128** (pinned, see notice.md §1) |
| Models | `ComfyUI\models` — **~1853 GB**, 99% of the drive |
| Custom nodes | `ComfyUI\custom_nodes` — 43 packs, 1.3 GB |
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

ComfyUI writes its whole boot to rotating logs — and when ComfyQ launched the process there is
no console window, so **this is the only record**:

All under `ComfyUI_windows_portable\ComfyUI\user\`. **Which file you want depends on who
started ComfyUI, not on the name** — the log is named after the `--port` argument:

```
comfyui_8188.log  (+ .prev, .prev2)   boots ComfyQ started -- it always passes --port 8188
comfyui.log       (+ .prev, .prev2)   boots you started by double-clicking run_*.bat (no --port)
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
| port 8188 already in use | **ComfyQ owns that port** (`autoStart: true`) and is already running one | stop ComfyQ, or use its own restart button — don't double-launch |
| `IMPORT FAILED` on one pack only | that pack's deps, not the install | read its traceback; the rest of ComfyUI is fine |
| nodes missing from the menu after an update | a hand-fix was reverted | `REPAIR.bat`, then hard-refresh the browser |

### Where the workflows live

| | |
|---|---|
| `ComfyQ\workflows` | **production** ComfyQ bundles served to students (`<id>.api.json` + `<id>_template.json`) |
| `ComfyQ\workflows\_candidate_workflows` | **staged for later testing**, possibly promoted into ComfyQ — tested workflows only, nothing else |
| `_demo_workflows` | demo / teaching workflows |
| `ComfyUI\user\default\workflows` | ComfyUI's own **Workflows sidebar** — where rig test workflows are staged |

The model audit cross-references **all four**, and everything it reads now lives **on this
drive**. The old `Downloads\workflows_a_tester` staging folder sat on `C:`, so the audit's
answer changed depending on which machine the drive was plugged into; it was retired
2026-09-11 and its workflows moved into `_candidate_workflows`.

⚠ `_candidate_workflows` is not production, but **its models are protected** — 14 models /
63.5 GB are held by nothing else on the drive. `prune-models.ps1` refuses to touch them.

### Backups that already exist

- `E:\comfyq_iso\ComfyQ_ComfyUI_portable.iso` — **647 GB**, built 2026-07-10, with a `.sha256`
  and a `BUILD-INFO.txt`. A curated subset: the four big weight buckets trimmed to
  ComfyQ-referenced models only, every other `models\` subfolder kept whole.
- `D:\comfyq_iso_build\` — **652 GB**, the staging tree the ISO was built from. **Redundant**
  now the ISO exists, and the single largest reclaim available on this machine.

636 GB of what is on `J:` right now is a strict, size-verified subset of that ISO — so for
those files a deletion is restorable by file-copy, no re-download, no licence gate. The
`backup` column in `model-audit.csv` tells you which. **Caveat:** the ISO is a snapshot of
2026-07-10, so it says nothing about the ~353 GB added since (MiniMax H3, LTX 2.5,
Wan-Animate 2, SCAIL-2). It is also *curated*, not a mirror: the four big weight buckets were
trimmed to ComfyQ-referenced models only, so a few things you might expect — `flux1-dev`,
`stable-audio-open-1.0` — are **not** in it despite being licence-gated and awkward to refetch.

## How ComfyQ relates to this install

[ComfyQ](../../ComfyQ) (`J:\ComfyQ`) is the multi-user scheduler that drives this ComfyUI. It
does **not** contain a ComfyUI — it points at this one:

- `J:\ComfyQ\config.json` → `comfy_ui.root_path` / `python_executable` point into
  `ComfyUI_windows_portable\`. ComfyQ self-heals this path when the drive letter changes
  (it scans for the portable layout on boot).
- ComfyQ launches and manages the ComfyUI process (start / restart / take over an externally
  started one), so **stop ComfyQ before doing maintenance** that touches model files.
- ComfyQ installs `custom_nodes\comfyq_opener\` on every launch and version-checks it — it is
  how "Open in ComfyUI" hands a bundle over to the editor. Deleting it is pointless; it comes
  back.
- Uploaded job media lands in `ComfyUI\input\comfyq_session__*` and job "ingredients" in
  `ComfyUI\comfyq_ingredients\`. Neither has a retention policy — 1.2 GB combined today
  (0.5 GB of uploads across 484 files, 0.7 GB of ingredients across 512 jobs; the whole
  `input\` folder is 1.5 GB, most of it hand-placed test assets), growing slowly.

**Adding a workflow or a model?** The bundle layout (`<id>.api.json` + `<id>.meta.json`) and the
add-a-workflow walkthrough are in `J:\ComfyQ\README.md`. For a model, `model-audit.csv`'s
`relpath` column shows where each kind belongs.

Knowledge split, so nothing drifts: **this folder is the operational home** (what you run,
what you read when something breaks, and it lives with the drive). The ComfyQ repo holds the
version-controlled record and anything ComfyQ-specific. Where both mention a topic, the
pointer runs from the repo to here.
