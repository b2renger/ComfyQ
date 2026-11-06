# tools/maintenance — in the repo, so it travels

These scripts used to live at `<nvme>\ComfyUI_windows_portable_nvidia\_maintenance\`,
beside the ComfyUI install. That meant the one body of knowledge about how this
fleet's disk is put together reached a new rig **only by cloning the drive** —
which is exactly the distribution problem they exist to help with. They are now
versioned here.

`README.md`, `notice.md`, `backup-and-move.md`, `model-audit/README.md` and
`model-audit/MODEL-AUDIT.md` came over with them. `README.md`, `notice.md` and
`model-audit/README.md` have been updated for the new location (2026-11-05);
`MODEL-AUDIT.md` and `model-audit/completeness-review.md` are dated reports of
2026-09-11, and `backup-and-move.md` describes the ISO as it was built, with
the old `_maintenance\` folder in it.
This file covers only what the move changed.

## What is versioned, and what is not

**Versioned — the source and the judgement:**

- the scripts (`repair_all.py`, `portablize_paths.py`, `fix_resolution_combos.py`,
  `model-audit/*.py`, `prune-models.ps1`, the `.bat` entry points)
- the docs, and `integrations/` with the ComfyUI PR patch
- `model-audit/model-audit.csv` and `decisions.json` — **curated snapshots from
  this rig.** They took real work: `decisions.json` holds a written verdict and
  reason per model, and the CSV's `redownload` column is hand-researched
  provenance. [tools/model-provenance](../model-provenance/README.md) harvests
  from that column, so it is a dependency, not just a record.
- `model-audit/custom-nodes-audit.csv` and `prune-log.csv` — the node-pack
  inventory and the history of what has already been deleted.

**Gitignored — the scans:**

`object_info.json` (4.4 MB), `inventory.json`, `links.json`, `nodes.json`,
`*.bak` and the dated `*.decisions-*.csv` copies. These describe **one
particular disk at one moment**. Committing them would commit a lie about every
other rig, and they are cheap to rebuild: `rescan.py` → `rescan_nodes.py` →
`scan_links.py` → `build_csv.py`. `object_info.json` is also ComfyQ's own:
the panel's missing-node-pack check falls back on it when ComfyUI is down, and
rewrites it from the live ComfyUI whenever ComfyUI answers.

## The one real change: nothing guesses where ComfyUI is

The scripts made **eight** separate assumptions about the layout of a disk —
`rescan.py` and `rescan_nodes.py` walked two levels up to find
`ComfyUI_windows_portable\ComfyUI`; `build_csv.py`, `verify_audit.py` and
`scan_links.py` took the drive letter off their own path and assumed
`<drive>\ComfyQ\workflows` and `<drive>\_demo_workflows`; `prune-models.ps1` and
`AUDIT.bat` named `ComfyUI_windows_portable_nvidia` outright. Moving the folder
broke every one.

⚠ Three more were missed at the move and stayed broken until 2026-11-05:
`repair_all.py` and `portablize_paths.py` still looked for
`..\ComfyUI_windows_portable`, and `REPAIR.bat` for the Python beside it, so
REPAIR and the panel's *Repair the ComfyUI install* / *Make install paths
portable* (now *Fix TRELLIS2 example-workflow paths*) buttons failed with
"ComfyUI not found". They now use the same lookup
as everything else.

They now ask **ComfyQ** instead, through [comfyq_paths.py](comfyq_paths.py):

```python
from comfyq_paths import comfy_root, models_root, labelled_workflow_dirs, repo_root
```

Resolution order: `COMFY_ROOT` in the environment → `comfy_ui.root_path` from
ComfyQ's `config.json` (what an admin sets under **Manage ComfyUI → ComfyUI
Settings**), when that folder holds a `main.py` → an install beside the ComfyQ
checkout, in the two layouts ComfyQ's own boot looks for first:
`ComfyUI_windows_portable_nvidia\ComfyUI_windows_portable\ComfyUI` (the drive)
and `ComfyUI_windows_portable\ComfyUI` (a restored ISO). `config.json` is only
rewritten when ComfyQ starts, so that last step is what lets these scripts find
the install on a clone mounted under a new letter, or an ISO just restored,
before ComfyQ has run there. `prune-models.ps1` reads the same config in
PowerShell, and `AUDIT.bat` and `REPAIR.bat` get the interpreter from
[python-path.js](python-path.js), which tries the same places, because a `.bat`
cannot read JSON.

★ ComfyUI's embedded Python ignores the script's own folder (`python312._pth`
pins `sys.path`), so every script that imports a sibling puts its own folder on
`sys.path` first. The admin panel's runner adds it too, but a script run by hand
or from a `.bat` only has what it adds itself.

Stdlib only — these run under ComfyUI's bundled `python_embeded`.

★ **`labelled_workflow_dirs()` must stay in step with
[server/workflows/scanFolders.js](../../server/workflows/scanFolders.js)**, which
decides the folders the admin panel's prune button stands on. A folder counted by
one and not the other means the two disagree about whether a model is in use, and
one of them is then offering a model in use for deletion. Both read
`maintenance.workflowScanDirs` (extra folders; relative entries resolve against
the ComfyUI root) and `maintenance.scanDirsOff` (what the admin switched off in
Maintenance → Folders scanned: `candidates`, `comfyui-user`, `lanes`, or a custom
entry as written). The audit simply skips a switched-off folder — every walker
goes through `walk_workflows()`, which also prunes `_candidate_workflows` out of
`workflows/` when candidates are off. The panel still reads switched-off folders,
to say why a model they name is no longer protected.

## Verified after the move

Every script compiles under `python_embeded`, and `rescan.py` was run end to end
from its new home: it found the install through the config, parsed 321 workflows
across ComfyQ's bundles, the demo folder and ComfyUI's own user folder, and wrote
`inventory.json`.

## The original is gone

`<nvme>\ComfyUI_windows_portable_nvidia\_maintenance\` was copied here first and
then **deleted** — this folder is the only copy now. The gitignored scans
(`object_info.json` 4.5 MB, `inventory.json`, `links.json`, `nodes.json`) were
rebuilt here by running the scripts from their new home, so they are present but
describe **this** disk at one moment. They are not committed, for that reason —
but being gitignored is also why they travel in a cloned drive image. Harmless
(rebuilding the audit overwrites them), just not evidence about the machine you
are reading them on. `object_info.json` is the exception: ComfyQ refreshes it
from the live ComfyUI and uses it as its list of node classes when ComfyUI is
down, so it is current on any machine where ComfyQ has talked to ComfyUI. Do
not delete it.

## Preparing the drive to be cloned

Three scripts for the operation in [docs/cloning-the-drive.md](../../docs/cloning-the-drive.md),
which is where the order and the reasons are. Each takes `--dry`.

| | |
|---|---|
| `wipe_for_clone.cjs` | clear a workshop's residue, sparing exactly the files the published sweep report points at. Refuses to touch anything in `ComfyUI/input` that ComfyQ did not put there. |
| `seed_examples.cjs` | turn the sweep's results into one browsable example job per workflow, under the user `examples`. Run **after** the wipe. |
| `publish_partial_sweep.cjs` | rescue a sweep that was killed mid-run, from the per-run `.jsonl` it left. Prints the bundles still to sweep, so the merge produces one complete report. A killed *subset* run (say the "Run the remaining N" after a first rescue) keeps the rows already published instead of replacing them. It writes `library-sweep-latest.json` beside the `.jsonl`: `server/data` for an ordinary sweep, the experiment's own folder for a `--data-dir` run, so rescuing an experiment leaves the published report alone. |

★ `recover_sweep.cjs` answers a different question and is not a substitute: it
rebuilds a report from a run's *side effects* (rewritten `runtime.json` files,
`bench_*` outputs, the access log) for when the run records are gone.
`publish_partial_sweep.cjs` is for when the rows survive and only the published
report is missing — which keeps the ingredients, tracebacks and perf diagnostics
those rows carry.
