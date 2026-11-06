# model-audit

**`model-audit.csv` is the only file that decides anything.** One row per model: what it is,
what needs it, whether a duplicate is already on disk, whether the backup has a copy. You put
`DELETE` in the `ACTION` column; `prune-models.ps1` acts on exactly that.

Everything else here either **produces** that file or **consumes** it.

> **Not the same tool as the admin panel's prune.** ComfyQ's Admin → Maintenance → *Prune
> unused models* runs its own live scan. It does **not** read `model-audit.csv`: a `DELETE`
> or `KEEP` you put in the `ACTION` column here only steers `prune-models.ps1`. The panel
> reads `decisions.json` (below) for context only — an old audit verdict shows there as a
> soft reason, never as a decision.
>
> **Both use the same folder and the same batches** (`<drive>\_model_quarantine\<stamp>\models\…`).
> What this script moves shows on the panel's *Quarantined models* card, and `-Restore` and
> `-Purge` act on what the panel moved. `-Purge` lists every batch before asking; add
> `-Batch <name>` to act on one.

## Do it

**1. Open the editor** — double-click **`AUDIT.bat`** (or `python audit_ui.py`).

It opens in your browser with three views of the same data:

| Tab | |
|---|---|
| **Models** | every model, what needs it, why. Mark rows `del` / `keep`, press **Save** |
| **Workflows** | every workflow and the models it loads, with a **Replace** button per model |
| **Leaderboard** | which models earn their space: how many workflows and nodes use each |

Search, filter and sort work in all three. **Save** writes `model-audit.csv` (keeping a
`.bak`). You can edit the CSV in Excel instead; the editor is just easier to read.

### Swapping a model inside a workflow

The Workflows tab lists, under each model, any interchangeable file already on the drive and
what switching would save. **Replace** edits the workflow file in place and keeps a `.bak`
next to it.

- only **loader** slots are touched. Note text and ComfyUI's `properties.models` download
  hints are left alone — rewriting those would change documentation, not what runs
- a ComfyQ bundle is edited as a unit, so `<id>.api.json` (what executes) and
  `<id>_template.json` (what opens in the editor) stay in agreement
- formatting is preserved: the edit is a text substitution, accepted only after re-parsing
  proves it produced exactly the intended document. A file that keeps arrays inline (which
  `json` cannot reproduce) is re-serialised instead, and the report says so

**A swap is offered only when the two files are genuinely interchangeable** — same weights at
a different precision (`BUILD`), or the same job and size from a different lineage
(`LINEAGE`, flagged risky: it runs, but the output changes). A different **generation** is
never offered, however similar the names look.

**2. Dry run.**

```powershell
.\prune-models.ps1
```

Lists what you marked, the total, and which have no backup copy. Nothing is touched.

**3. Quarantine.**

```powershell
.\prune-models.ps1 -Execute
```

Moves them to `<drive>\_model_quarantine` — a rename on the same volume, so it is instant and
reversible. **Space is not freed yet.**

**4. Check, then commit or undo.** Start ComfyUI, run the workflows you care about, then:

```powershell
.\prune-models.ps1 -Purge      # permanently deletes, frees the space
.\prune-models.ps1 -Restore    # puts everything back
```

Stop ComfyUI before `-Execute` / `-Restore` — it holds model files open.

This script and ComfyQ's panel share their batches: without `-Batch <name>`, `-Purge` and
`-Restore` act on all of them, the panel's included. `-Restore` never overwrites a file: it
leaves that one in quarantine and names it.

## What the columns mean

| Column | |
|---|---|
| `ACTION` | **yours.** `DELETE`, `KEEP`, or blank |
| `gb` / `name` / `category` | size, filename, which `models\` folder it lives in |
| `status` | why it is here — see below |
| `used_by` | **exactly which workflows load it**, plus any dropdown or custom node that needs it |
| `verdict` | the audit's recommendation. Advice, not an instruction. It comes from the hand-written `decisions.json` (from the 2026-09-11 audit, copied into the repo 2026-10-05); a model added since gets a placeholder — `KEEP` if it is loaded or pickable, otherwise `REVIEW` — with no reason |
| `duplicate` | `COPY`, `BUILD` or `LINEAGE` if another file on disk is a variant of this one |
| `duplicate_detail` | which files, their size, and how many workflows use each |
| `backup` | `yes` = a copy exists in the D:/E: ISO tree, so on the master machine a deletion is reversible by file-copy. On any other machine those disks are not there: the model has to be downloaded again |
| `reason` / `redownload` | why the audit judged it that way, and where to get it again |
| `relpath` | where it lives. **`prune-models.ps1` joins this against `<ComfyUI>\`** — do not strip the `models/` prefix |

### `status` — five ways a model earns its place

| | Meaning | Deleting it |
|---|---|---|
| `LOADED` | a workflow names it **in a loader widget** | breaks that workflow |
| `PICKABLE` | a ComfyQ dropdown offers it, built from disk at booking time | breaks a menu entry |
| `AUTO-DOWNLOAD` | custom-node source fetches it by name at runtime | it returns, or the node fails |
| `MENTIONED` | named only in note text or download metadata | nothing runs it |
| `UNUSED` | no claim of any kind | safe as far as this drive knows |

`prune-models.ps1` **refuses** to delete anything that is `LOADED`, `PICKABLE` or
`AUTO-DOWNLOAD` and tells you what needs it. Override with `-AllowInUse` only if you mean it.

Two traps behind those statuses, both of which produced wrong verdicts on an earlier pass:

- **`LOADED` vs `MENTIONED`.** ComfyUI's templates ship a MarkdownNote listing the whole model
  family plus a `properties.models` download hint, so a workflow "references" models it never
  loads. One MiniMax template *loads* the Singularity fine-tune while its note names the stock
  convrot build. Only a value inside a loader widget counts.
- **`PICKABLE` is the opposite.** ComfyQ's `lora` parameter builds its dropdown by scanning
  `models\<dir>\<prefix>*` when the booking form opens — so those files appear in **no**
  workflow and **no** source file and are still live student choices (all 14 `krea2_*` LoRAs,
  not just the default).
- **Renamed files.** A model renamed after download looks unused from both ends at once: the
  workflow's reference matches nothing, and the file matches no reference. `build_csv.py`
  reads the `__metadata__` header every `.safetensors` carries — trainers stamp the original
  `ss_output_name` in it, and that survives a rename — so the file is matched back to the
  workflow that wants it. Its `used_by` then starts with **`RENAMED:`** and says which name
  the workflow still asks for. Real case: `Image_QuadView_krea2_v1.json` loads
  `Downloads/krea2_4panel_hia_1536.safetensors`, which is not on disk;
  `loras/QuadView_krea2_v1.safetensors` carries `ss_output_name = krea2_4panel_hia_1536`. It
  is the same LoRA, renamed out of a `Downloads` folder — and the sheet had it as `UNUSED`.

### `duplicate` — three kinds, very different risk

| | Meaning | Safe to collapse? |
|---|---|---|
| `COPY` | byte-identical file in two folders | **yes** — delete either |
| `BUILD` | same weights, different precision (`bf16` vs `int8`) | **yes, with a quality call** — repoint the workflows |
| `LINEAGE` | same job and size, **different weights** (a fine-tune, a re-release) | **no** — swapping changes output |

Models that differ by a *role* token are never grouped: Wan 2.2 loads `high_noise` **and**
`low_noise` in one sampler, and canny/depth/pose controls do different jobs. Neither are
different **parameter counts** (19b vs 22b) or different **generations**.

### Can I just use the newest checkpoint everywhere?

Generally **no**, and the Workflows tab shows why per workflow: a *version lock* column
groups every model it loads by family and generation. An LTX 2.3 workflow does not load one
LTX 2.3 file, it loads four — the checkpoint, the distilled LoRA, the spatial upscaler and a
second LoRA — and the LTX 2.5 workflows load five, including **separate video and audio VAEs
that 2.3 keeps inside the checkpoint**. So moving one file to 2.5 leaves a mismatched graph;
the graph shape differs, not just the filenames. Build the newer workflow from its own
template instead. A workflow showing **mixed generations** in that column is worth a look —
it is usually a mistake.

## Rebuilding the sheet

After adding models or workflows. Deterministic, a couple of minutes, deletes nothing.

**The easy way:** in ComfyQ, Admin → Maintenance → Maintenance scripts → *Rebuild the model
audit*, then *Verify the model audit*. They run the same steps as below.

**By hand**, from this folder in PowerShell:

```powershell
$py = node ..\python-path.js   # ComfyUI's own python, from ComfyQ's config.json
# rescan_nodes.py reads ComfyUI's node list from a saved file, so save it first
# (ComfyUI must be running):
Invoke-WebRequest http://127.0.0.1:8188/object_info -OutFile object_info.json
& $py rescan.py         # what is on disk + which workflows load it
& $py rescan_nodes.py   # which pack provides each node (reads object_info.json)
& $py build_csv.py      # -> model-audit.csv
& $py verify_audit.py   # checks the sheet, and lists broken workflow dependencies
```

`verify_audit.py` also reports **models a workflow loads that are not on the drive** — those
workflows cannot run as they stand. Worth a look after any rescan.

`rescan_nodes.py` uses ComfyUI's own node list because several packs register nodes in ways
static parsing cannot see. Skip the download and it works from whatever `object_info.json` is
already here, which may be out of date. (`curl -s -o` does not work in Windows PowerShell 5.1 —
`curl` is an alias for `Invoke-WebRequest` there and those flags do not bind.)

**Rebuilding keeps your `ACTION` marks** — `build_csv.py` reads the existing sheet back in.
The one exception: a `DELETE` on a model whose status has changed to anything other than
`UNUSED` (it is in use now) is cleared, and listed when the rebuild finishes. So rescan
before you prune.

ComfyUI's location comes from ComfyQ's `config.json` (`comfy_ui.root_path`, set under Manage
ComfyUI → ComfyUI Settings), or from `COMFY_ROOT` if you set it — not from where this folder
sits — so all of it keeps working when the drive mounts under a different letter. See
[`../COMFYQ-NOTES.md`](../COMFYQ-NOTES.md).

### Workflow collections scanned

⚠ **A folder is scanned only while it is switched on** in ComfyQ: Admin → Maintenance →
Prune → *Folders scanned for workflows* (stored per machine in `config.json` as
`maintenance.scanDirsOff`, the same list the panel's own prune uses). The bundles folder is
always on. A switched-off folder's models are **not** protected: they read `UNUSED` here, and
`prune-models.ps1` will not refuse them. Check that card before you prune — the folders the
last rebuild really read are listed in `inventory.json` under `workflow_dirs` (`inventory.json`
is not in git; it exists only on a machine where the audit was rebuilt, or on a drive cloned
from one).

The collections it can read (file counts from 2026-09, with every folder switched on):

| | Files | |
|---|---:|---|
| `<drive>\ComfyQ\workflows` | 143 | production bundles served to students — always scanned |
| `<drive>\ComfyQ\workflows\_candidate_workflows` | 22 | **staged for testing** — not production; protected only while switched on |
| `ComfyUI\user\default\workflows` | 45 | ComfyUI's own Workflows sidebar |
| `<drive>\_demo_workflows` | 12 | demo / teaching |
| `<drive>\ComfyQ\.comfyq-lanes\<workflow>\user\<profile>\workflows` | — | graphs saved from a parallel lane's own ComfyUI; shown as `lane:` in `used_by` |

Any other folder added under *Folders scanned for workflows* appears in `used_by` under its own
folder name (for `D:\my_flows`, `my_flows:`).

`_candidate_workflows` holds workflows staged for later testing and possible promotion into
ComfyQ. With every folder switched on, **14 models / 63.5 GB were held by nothing else** —
filter the editor to `used_by` containing `candidate:` to see them. With the candidates
folder switched off, those models read `UNUSED`.

> The old `%USERPROFILE%\Downloads\workflows_a_tester` staging folder was retired 2026-09-11.
> It sat on `C:`, so the audit's answer changed depending on which machine the drive was
> plugged into. Nothing off this drive is scanned any more.

⚠ **One trap the raw scan does not avoid:** it greps all of `custom_nodes\`, so
`comfyui-manager\model-list.json` (a download *catalogue*, not evidence of use) and unused
packs' own `example_workflows\` both register as `AUTO-DOWNLOAD`. Between them they falsely
justified ~295 GB. Treat that status as "check the pack", not "required".

## The rest of this folder

| File | |
|---|---|
| `AUDIT.bat` / `audit_ui.py` | the editor for `model-audit.csv` |
| `prune-models.ps1` | acts on it: dry run → `-Execute` → `-Purge` / `-Restore` |
| `build_csv.py` | rebuilds `model-audit.csv` from the scan data |
| `scan_links.py` | the model <-> workflow graph, with the exact edit site of every name |
| `variants.py` | which models are interchangeable (shared by the sheet and the swaps) |
| `swap_model.py` | performs a replacement; also runnable from the command line |
| `rescan.py` / `rescan_nodes.py` | rebuild the scan data |
| `verify_audit.py` | checks the sheet agrees with the scan and with disk |
| `custom-nodes-audit.csv` | the same idea for the custom-node packs — a hand-made snapshot from the 2026-09-11 audit (43 packs). No script regenerates it, so packs added since are missing |
| `MODEL-AUDIT.md` | the original narrative report (2026-09-11): method, traps, the big numbers |
| `completeness-review.md` | what the model-by-model pass missed (backups, duplicates) — a report of 2026-09-11 |
| `inventory.json` | what is on disk and which workflows load it (`rescan.py`) — the CSV is built from it |
| `decisions.json` | the audit's written verdict and reason per model — hand-curated (from the 2026-09-11 audit, copied into the repo 2026-10-05), not regenerated; `build_csv.py` reads it for the `verdict`, `reason` and `redownload` columns |
| `nodes.json` | which pack provides each node — `rescan_nodes.py`'s report, not the CSV |
| `object_info.json` | ComfyUI's list of node classes. `rescan_nodes.py` reads it, and ComfyQ's missing-node-pack check uses it as its fallback when ComfyUI is down — ComfyQ rewrites it whenever ComfyUI answers. **Do not delete it** |
| `links.json` | the model ↔ workflow graph, dumped by `scan_links.py` (the editor rebuilds it live) |
| `prune-log.csv` | what was quarantined, when |
