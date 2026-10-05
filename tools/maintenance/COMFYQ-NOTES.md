# tools/maintenance — in the repo, so it travels

These scripts used to live at `<nvme>\ComfyUI_windows_portable_nvidia\_maintenance\`,
beside the ComfyUI install. That meant the one body of knowledge about how this
fleet's disk is put together reached a new rig **only by cloning the drive** —
which is exactly the distribution problem they exist to help with. They are now
versioned here.

`README.md`, `notice.md`, `backup-and-move.md`, `model-audit/README.md` and
`model-audit/MODEL-AUDIT.md` are the originals and still describe how to use
them. This file covers only what the move changed.

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
`scan_links.py` → `build_csv.py`.

## The one real change: nothing guesses where ComfyUI is

The scripts made **eight** separate assumptions about the layout of a disk —
`rescan.py` and `rescan_nodes.py` walked two levels up to find
`ComfyUI_windows_portable\ComfyUI`; `build_csv.py`, `verify_audit.py` and
`scan_links.py` took the drive letter off their own path and assumed
`<drive>\ComfyQ\workflows` and `<drive>\_demo_workflows`; `prune-models.ps1` and
`AUDIT.bat` named `ComfyUI_windows_portable_nvidia` outright. Moving the folder
broke every one.

They now ask **ComfyQ** instead, through [comfyq_paths.py](comfyq_paths.py):

```python
from comfyq_paths import comfy_root, models_root, labelled_workflow_dirs, repo_root
```

Resolution order: `COMFY_ROOT` in the environment → `comfy_ui.root_path` from
ComfyQ's `config.json` (what an admin sets under **Manage ComfyUI → ComfyUI
Settings**) → the historical sibling layout, so a copy left beside the portable
install still works. `prune-models.ps1` reads the same config in PowerShell, and
`AUDIT.bat` gets the interpreter from [python-path.js](python-path.js) because a
`.bat` cannot read JSON.

Stdlib only — these run under ComfyUI's bundled `python_embeded`.

★ **`labelled_workflow_dirs()` must stay in step with
[server/workflows/modelUsage.js](../../server/workflows/modelUsage.js)**, which
is what the admin panel's prune button stands on. A folder counted by one and
not the other means the two disagree about whether a model is in use, and one of
them is then offering a model in use for deletion. Both read
`maintenance.workflowScanDirs` from the same config; relative entries resolve
against the ComfyUI root.

## Verified after the move

Every script compiles under `python_embeded`, and `rescan.py` was run end to end
from its new home: it found the install through the config, parsed 321 workflows
across ComfyQ's bundles, the demo folder and ComfyUI's own user folder, and wrote
`inventory.json`.

## The original is still in place

`<nvme>\ComfyUI_windows_portable_nvidia\_maintenance\` was **copied**, not moved,
so the generated scans and this rig's history are undisturbed. Delete it once you
are satisfied with the copy here — note that the gitignored scan files only exist
there, and are rebuilt by running the four scripts above.
