---
name: model-audit-usage-classes
description: "What keeps a model alive on the ComfyUI drive — nine protection classes a filename grep misses, why an observed load cannot prove the opposite, and where the audit now lives"
metadata: 
  node_type: memory
  type: project
  originSessionId: 13051bf0-abea-4789-bb00-c7227de330c1
  modified: 2026-11-05T20:38:09.756Z
---

**Moved 2026-10-06: the audit is now `ComfyQ\tools\maintenance\model-audit\`, not
`<nvme>\_maintenance\`** (the original is deleted). Every script resolves the install through
`tools/maintenance/comfyq_paths.py` — `COMFY_ROOT` env → `comfy_ui.root_path` from
`config.json` → legacy sibling layout — so none of them cares about the drive letter
(see [[portable-no-drive-letters]]). Its scripts run from two of the panel's five
Maintenance-tab tasks: Rebuild the audit (rescan.py, rescan_nodes.py, scan_links.py,
build_csv.py) and Verify it (verify_audit.py). The whitelist is in
server/maintenance/scriptRunner.js: audit-rebuild, audit-verify, custom-node-fixes,
install-repair, portablize-paths.
ComfyQ's own prune card shares one engine with the CLI: `server/workflows/modelUsage.js`.

Nine ways a model is in use that a plain filename grep gets wrong. Each one caused a wrong
DELETE verdict on a real pass:

1. **LOADED vs MENTIONED.** ComfyUI templates ship a MarkdownNote naming the whole model
   family plus a `properties.models` download hint, so a workflow "references" models it
   never loads. Only a value on a non-Note node counts.
2. **Subgraphs.** Most ComfyQ templates keep their real nodes under
   `definitions.subgraphs[].nodes[]`. ★ This one bit TWICE — the second time it deleted
   `full_encoder_small_decoder.safetensors`, loaded by a `VAELoader` inside a subgraph of
   three Klein templates. Walk nested nodes AND subgraph definitions.
3. **ComfyQ `lora` dropdowns** scan `models\<dir>\<prefix>*` at booking time, so every
   matching file is student-selectable while appearing in no workflow and no source file.
4. **`_candidate_workflows`** and the external/demo/ComfyUI-user/lane folders protect their
   models **only while switched on** under Maintenance → Prune → *Folders scanned for
   workflows* (`maintenance.scanDirsOff`, resolved by `server/workflows/scanFolders.js`; the
   bundles folder is locked on). A switched-off folder is still READ, but its models get
   `excludedBy` and an `excluded-folder` reason that caps them at "worth a look" — never
   the confident tier. ⚠ **On this rig every switchable folder is off** (candidates,
   comfyui-user, lanes, `J:/_demo_workflows` — checked 2026-11-05), so they protect nothing
   here.
5. **Files under `custom_nodes/`** belong to their pack, not to nobody.
6. **Weights named only in a pack's Python** are auto-downloaded at runtime and never appear
   in a graph (7 LivePortrait files; one scored *high* before this class existed).
7. **Staged HuggingFace repo folders** — a node that names a repo rather than a file
   (16.65 GB scored high).
8. **Reference shapes beyond `inputs`:** `widgets_values` as an array *or an object*,
   `widgets_values_named`, `properties.models[].name`, and `extra.prompt`. Fold names to
   lower case — Windows is case-insensitive and a `24K`/`24k` mismatch reads as unused.
9. **An OBSERVED load** (added 2026-10-07, the strongest class because it is the only
   observation among eight inferences). ComfyQ's own custom node
   (`server/comfyui/opener/__init__.py`) wraps `folder_paths.get_full_path` +
   `comfy.utils.load_torch_file` and appends to `comfy_root\comfyq_model_access.jsonl`.
   Running the whole library turns "nothing references this" into "we ran every workflow
   and ComfyUI never opened it."
   ⚠ **The log is NOT "every weight ComfyUI opens", and its old records are mostly noise.**
   ComfyUI 0.40's asset scanner calls `get_full_path` for EVERY model file at each start, so
   the earlier recorder logged the whole disk as loads (13,061 of 14,092 records were scanner
   noise when measured 2026-10-16). Since opener v9/v10 the recorder logs a lookup only while
   a prompt is executing, skips any caller whose stack passes through `app.assets` (the
   scanner), and tags records `ctx:"prompt"`. Records that land in a burst of ≥ 20 distinct
   models within 3 s are scans — legacy untagged records and prompt-tagged ones alike, each
   judged only against its own kind — and `modelAccessLog.genuineRows()` discounts them.
   **Always read the log through `server/workflows/modelAccessLog.js` (or the usage
   engine), never raw.**

⚠⚠ **But an observed load can ONLY protect, never condemn — and the trap is specific enough
to be worth memorising: ComfyUI keeps a model loaded between prompts**, so the second
workflow that wants the same weight resolves no path and leaves NO trace. On the first full
sweep, 20 of 61 bundles recorded zero models — every one of them having run straight after a
sibling with the same weights — and `flux-2-klein-base-9b-fp8` read as used by *one* bundle
while four live ones load it. So the log records a **first sighting, never exclusive use**;
attribute by time window (not by diffing the log's name set, which only ever reports weights
never seen on this machine before) and never write "only X uses this" from it. Absence of a
record is also not disuse: the log starts when the recorder is installed, and a setting nobody
exercised (Fast mode off, the second entry in a dropdown) leaves no trace either.

**And it must be releasable (2026-10-15).** In a REMOVAL the observation inverts: the loads
were usually the deleted workflow's own, so without a release every model a deleted workflow
ever ran stayed protected for ever. Deleting a workflow from the admin library now writes the
model names it carried to `comfy_root\comfyq_removed_workflows.jsonl`; a file held ONLY by an
observed load is released when a removed workflow named it and its *latest* sighting predates
that removal. Workflows deleted before this have no record — their weights still need a human
reading of `observedAt`. A staged "Open in ComfyUI" copy in ComfyUI's user-workflows folder is
a tenth thing that can hold a deleted workflow's models; the delete removes it only if its
graph is unchanged.

**Also true of the audit's own disk scan:** a model counts as present if it is under `models/`
**or** `custom_nodes/`. Packs download detectors into their own folder
(`comfyui_controlnet_aux/ckpts/…`), and reading only `models/` reported 3 present files as
absent dependencies.

**Why:** classes 1 and 3 pull in opposite directions, so neither "grep the filename" nor
"trust the workflow list" is safe. And a guard can be present but decorative — there were two
generic-name lists, so widening one left the other behind and a file flagged generic still
scored confident.

**How to apply:** the panel's Maintenance tab (prune card + the audit buttons), or
`tools/model-provenance/exclusive.cjs` for the same answer on the CLI. Pruning **moves** to
`<drive>\_model_quarantine\<batch>\` rather than deleting. Bulk select (in
`client/src/components/admin/ModelPrune.jsx`) is offered on **Confident** (`high`) and
**Freed by removed workflows** (never their suspicious rows), and on **Worth a look**
(`medium`) only after the "I have read the reason on each row" tick. **Suspicious** (`low`)
has no select-all: tick one file at a time, and the server refuses a low row without
`allowLow`. The `audit-keep` verdict is a soft reason now (caps at "worth a look"), not a
veto. Figures move with every bundle and folder switch — read them live from
`GET /admin/models/usage` rather than trusting a number here. As of 2026-11-05 on this rig:
confident 0, worth a look 46 / 212 GB, suspicious 26 / 262 GB, unused 72 / 475 GB.
