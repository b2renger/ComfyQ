# ⚠️ NOTICE — read before updating anything

> ## ▶ After ANY update: double-click **`REPAIR.bat`**
>
> Updating ComfyUI, updating a custom-node pack, or clicking "update all" in
> ComfyUI-Manager **silently reverts** the hand-fixes this install depends on.
> Nothing warns you — you find out when a workflow fails.
>
> `REPAIR.bat` re-applies every fix listed in this file, then health-checks the
> pinned PyTorch/CUDA stack. It is **idempotent** (safe to run any time; when
> nothing is broken it changes nothing) and it **never guesses** — a fix whose
> anchor has moved is reported as FAIL with nothing written, rather than
> half-applied.
>
> Run `REPAIR.bat --check` to see what *would* be repaired without writing.
>
> **Then restart ComfyUI and hard-refresh the browser (Ctrl+Shift+R).**

This portable ComfyUI has been **hand-tuned** to run two image-to-3D model packs —
**Pixal3D** ([Saganaki22/Pixal3D-ComfyUI](https://github.com/Saganaki22/Pixal3D-ComfyUI))
and **TRELLIS2** ([visualbruno/ComfyUI-Trellis2](https://github.com/visualbruno/ComfyUI-Trellis2)) —
on this exact drive, plus ID-V2V video restylization on patched ComfyUI core. That tuning
is **fragile in three specific ways**. If you forget them, things stop working and it is not
obvious why.

> **Where things live.** This notice and the re-apply scripts sit together in the drive's
> `_maintenance\` folder (a sibling of `ComfyUI_windows_portable\`). Unless noted otherwise,
> **all paths below are relative to the portable root `ComfyUI_windows_portable\`** (the folder
> that holds `python_embeded\`, `ComfyUI\`, and the `run_nvidia_gpu*.bat` launchers).

---

## 🚫 The three things that will break it

### 1. Do NOT run the ComfyUI dependency updater
**File:** `ComfyUI_windows_portable\update\update_comfyui_and_python_dependencies.bat`

It runs `pip install --upgrade torch torchvision torchaudio`, which pulls **PyTorch off
2.8.0 up to the latest version**. The moment that happens, every compiled CUDA kernel that
Pixal3D and TRELLIS2 depend on (`flex_gemm`, `cumesh`, `o_voxel`, `nvdiffrast`,
`nvdiffrec_render`, `drtk`, `flash_attn`, `custom_rasterizer`) **stops loading** with
`DLL load failed` / `undefined symbol` errors, because each of those is a prebuilt binary
locked to **exactly PyTorch 2.8**. Updating ComfyUI *core* is fine; updating the *Python
dependencies* is what breaks things.

If you ever do run it by accident, put the stack back with (from `ComfyUI_windows_portable\`):
```
python_embeded\python.exe -m pip install torch==2.8.0+cu128 torchvision==0.23.0+cu128 torchaudio==2.8.0+cu128 --index-url https://download.pytorch.org/whl/cu128
python_embeded\python.exe -m pip install "triton-windows>=3.4,<3.5"
```

### 1b. The ComfyUI core updater SILENTLY drops core patches
**Files:** `ComfyUI_windows_portable\update\update_comfyui_stable.bat` **and**
`ComfyUI_windows_portable\update\update_comfyui.bat` — they differ
only by the `--stable` flag and both run the same `update.py`, so both behave this way.

This one is **safe to run** — but know what it does. `update.py` calls
`repo.stash()` *before* it checks out the new version, so any edit to a ComfyUI
core file is stashed away without a word: **no error, no conflict, no prompt.**
The update succeeds and the fix is simply gone. (Verified by replaying that exact
pygit2 sequence.) Today that means **ID-V2V stops working** — see the checklist.

Nothing is lost: the edit survives in `git stash list`, and the updater also
leaves a `backup_branch_<timestamp>`. But **do not recover with `git stash pop`**
— if upstream touched nearby lines it writes `<<<<<<<` conflict markers *into the
.py files*, which is a syntax error, and ComfyUI then won't start at all. Just run
**`REPAIR.bat`**, which re-applies the edit cleanly or refuses without touching
anything.

> **Observed in the field, 2026-09-13.** An update from 0.34.6 to 0.35.0 did exactly this:
> `REPAIR.bat --check` reported `[MISS] ID-V2V support`, a fresh
> `stash@{0}: WIP on (no branch): ... ComfyUI v0.34.6` had appeared, and running `REPAIR.bat`
> restored all 17 lines across the 4 core files. Total damage if you had skipped it: ID-V2V
> silently stops loading, with no error until a workflow fails.
>
> Those stashes accumulate -- there are five now, one per update. They are harmless and cost
> nothing, and they are **not** how you recover. Leave them alone; `REPAIR.bat` is the route
> back. Never `git stash pop`.

### 2. Updating the TRELLIS2 pack REVERTS hand-edits
TRELLIS2's bugs were patched **by editing files inside the pack** (`nodes.py` + 19 example
workflows). Pixal3D's pack files are *not* edited — its one fix lives in a **model** file
(`models\Pixal3D\briaai_RMBG-2.0\birefnet.py`), which reverts if that model is re-downloaded
rather than when the pack updates. Updating a
pack (via ComfyUI-Manager or `git pull`) overwrites those files and re-introduces the bugs.
After any such update, **re-apply the edits** — most of them are automated by the scripts in
`_maintenance\` (see the checklist at the bottom of this file).

---

## 💡 Why it is built this way

**The 3D packs are not normal custom nodes.** They rely on large, **pre-compiled CUDA
extensions** (kernels written in C++/CUDA, shipped as `.whl` binaries). Unlike pure-Python
nodes, a compiled wheel only works against **one exact combination** of:

- Operating system (Windows)
- Python version / ABI (**3.12 / cp312** here)
- **PyTorch version (2.8)** and CUDA build (**cu128**)
- GPU architecture

There is **no compiler on this drive** (and we deliberately keep it that way for
portability), so we can only use **prebuilt** wheels. **PyTorch 2.8.0 + cu128** is the one
version for which complete, matching Windows/cp312 wheels exist for *both* packs at once —
that is why the whole install is pinned to it, and why bumping PyTorch is fatal. `cu128`
also natively supports the Blackwell GPUs (RTX 5090 / RTX PRO 6000) this drive is used with,
alongside the Ada cards (4080/4090).

**The install must stay fully portable.** This drive is an external NVMe that gets plugged
into different machines, where it mounts under **different drive letters** (`J:`, `K:`, …).
So nothing may hard-code a drive letter or live on a machine's `C:` drive — everything (the
embedded Python, all wheels, all models, all caches we control, **and the `_maintenance\`
scripts**, which locate their targets relative to their own folder) stays on the drive. Some
of the fixes below exist purely to honour that (relative paths instead of the pack authors'
`C:\...` paths; running DepthAnythingV3 in-process instead of in an isolated `C:` env; the
cross-drive `/view` fix).

**The hand-edits fix genuine bugs in the packs**, not preferences:
- TRELLIS2 declared numeric dropdowns with *integer* options, but ComfyUI's UI sends the
  value as a *string* → "value not in list" on every run.
- Pixal3D's bundled background-removal model (BiRefNet) was written for an older
  `transformers`; the version we run (4.57) calls a method it doesn't have → crash.
- Both packs shipped example workflows with the author's own absolute paths baked in →
  crashes on any other machine/drive. TRELLIS2's are `C:\Git\ComfyUI\...`; Pixal3D's are
  `C:\Users\drbaph\Documents\ComfyUI\...` (only TRELLIS2's are rewritten by the script —
  Pixal3D's examples are left alone).
- DepthAnythingV3 built an isolated `pixi` environment on `C:` (not portable) — but all its
  dependencies are already present here, so isolation was pure overhead.

---

## 🧰 The `_maintenance\` folder

```
_maintenance\
  REPAIR.bat                 <-- double-click this after any update
  repair_all.py              the orchestrator: checks + re-applies every fix, then
                             health-checks the pinned stack
  notice.md                  this file
  README.md                  the folder's index -- start there
  backup-and-move.md         the backup: how to find it, restore from it, remake it
  fix_resolution_combos.py   TRELLIS2 dropdowns   (called by repair_all)
  portablize_paths.py        TRELLIS2 workflow paths (called by repair_all)
  integrations\             ID-V2V: the one ComfyUI core patch, and why
  model-audit\               disk-space audit: what is here, what uses it, what can go
```

**`model-audit\` is not part of the repair story** — it is a disk-space audit, not something to
run after an update. The drive is 99% models; that folder holds the decision sheet
(`model-audit.csv`), the report (`MODEL-AUDIT.md`) and `prune-models.ps1`, which is dry-run by
default and quarantines before it purges. It deletes nothing on its own. Start at
`model-audit\README.md`.

**You only ever need `REPAIR.bat`.** The two older scripts still work standalone and are
unchanged; `repair_all.py` simply calls them, so there is one thing to remember instead of
five. Everything **locates its own targets relative to this folder**, so no drive letter is
baked in anywhere and the drive can mount as `J:`, `K:`, whatever.

What `REPAIR.bat` does, in order:

1. **Fixes** — for each item in the checklist below: report `[ OK ]` if still applied,
   re-apply it and report `[FIXED]` if an update reverted it, or `[SKIP]` if that pack isn't
   installed here.
2. **Health checks** — PyTorch is still exactly `2.8.0+cu128`; `triton` / `sageattention` /
   `flash_attn` / `nvdiffrast` still import (they don't if PyTorch drifted); CrossDriveViewFix
   is present.
3. **Summary** — `N already fine / M repaired / K need attention`, and a reminder to restart.

Safety properties worth knowing, because they decide what happens on the day upstream moves
something:

- **Idempotent** — running it when nothing is broken writes nothing.
- **It refuses rather than guesses.** Each edit is anchored on a unique piece of text, scoped
  to the class it belongs to. If upstream renamed or moved that anchor — or if the anchor
  became ambiguous — the fix reports `[FAIL]`, names the file and the class, and **writes
  nothing**. (Several of these anchors are lines that repeat across sibling node classes, so
  "replace the first match" would silently patch the *wrong* class.)
- **All-or-nothing.** The ID-V2V fix spans four core files; all four edits are prepared in
  memory and only written once every one has resolved, so a failure leaves the install
  untouched rather than half-patched.
- **Syntax-checked.** Every edited `.py` is byte-compiled; an edit that would leave a syntax
  error is rolled back automatically.

Preview without writing anything:

```
REPAIR.bat --check
```

**After it repairs something: restart ComfyUI and hard-refresh the browser** (`INPUT_TYPES`
is read at startup, and the browser caches the node list from `/object_info`).

---

## 🧩 What was changed (full checklist)

Each heading says **what reverts it**. Everything marked *automated* is re-applied by
`REPAIR.bat`.

### ComfyUI core (`ComfyUI\comfy\`, `ComfyUI\comfy_extras\`) — automated
**ID-V2V support — 4 files, ~17 lines.** Reverted by `update_comfyui*.bat` (see §1b).

[ID-V2V](https://github.com/Eyeline-Labs/ID-V2V) restyles a video from a single stylized
keyframe while preserving the characters' identity and motion. It is a **VACE control stack
on a Wan 2.1 I2V base**, and stock ComfyUI cannot load that combination — its VACE path
assumes a T2V base. This is a backport of
[PR #15139](https://github.com/comfyanonymous/ComfyUI/pull/15139) (Kijai), which is **open,
not merged** at the time of writing.

- `comfy\model_detection.py` — a VACE checkpoint that also carries `img_emb.proj.0.bias` is
  flagged `vace_image_input` (that is how an ID-V2V file is recognised).
- `comfy\supported_models.py` — such a model is built as image-to-video instead of T2V.
- `comfy\ldm\wan\model.py` — VACE blocks are T2V-pretrained, so they must attend over the
  **text tokens only**; the image tokens are sliced off before reaching them.
- `comfy_extras\nodes_wan.py` — `WanImageToVideo` gains the optional **`ref_pad_image`**
  input: the conditioning's padding frames are filled with the stylized keyframe instead of
  flat gray, which is what anchors identity without pinning frames.

> **When PR #15139 merges upstream**, `REPAIR.bat` says so in a `[NOTE]` line — at that point
> delete the `IdV2V` class from `repair_all.py` and this section.
>
> Model: `models\diffusion_models\wan_2.1_idv2v_int8_convrot.safetensors` (20.2 GB, from
> [Kijai/Wan_ID_V2V_comfy](https://huggingface.co/Kijai/Wan_ID_V2V_comfy)). Example workflows
> live in ComfyUI's own **Workflows** sidebar (`ComfyUI\user\default\workflows\idv2v_*.json`)
> — rig test workflows, not ComfyQ candidates.
> Full notes: `docs\comfyui-idv2v.md` in the ComfyQ repo.

### ComfyUI-HR-Endless-Sampler (`custom_nodes\ComfyUI-HR-Endless-Sampler\`) — automated
**`gemma4.py` — three real bugs.** Reverted by a pack update.

- **Sibling import** — the module is loaded without package context (the folder name
  `ComfyUI-HR-Endless-Sampler` is not a valid Python identifier), so neither the original
  bare `from gemma4_mtp import ...` nor a relative import resolves. Fix: put the pack's own
  directory on `sys.path` first.
- **Worker encoding** — the parent decodes the worker subprocess's stdout as UTF-8, but on a
  non-UTF-8 Windows locale the child writes its JSON in the console codepage (cp1252 here),
  so **a single smart quote aborts the whole render** with `UnicodeDecodeError`. Fix:
  `PYTHONIOENCODING=utf-8` + `PYTHONUTF8=1` in the worker environment.
- **Decode tolerance** — `errors="replace"` on the three `subprocess.Popen` readers, so a
  stray byte degrades one character instead of losing the render.

### ComfyUI-Trellis2 (`custom_nodes\ComfyUI-Trellis2\`) — automated
Reverted by a pack update.
- **`nodes.py`** — two families of the same bug (ComfyUI's frontend submits a numeric COMBO
  value as a **string**, so an integer-typed dropdown fails validation with *"Value not in
  list: '1024' not in [512, 1024, …]"*). Fix = declare the options as **strings** and cast
  back with `int(...)` inside the node:
  - **`to_resolution`** — 2 nodes (`Trellis2ShapeCascadeGenerator`,
    `Trellis2ShapeCascadeMultiViewGenerator`): `([1024,1536],{"default":1024})` →
    `(["1024","1536"],…)`, cast at the top of each `process()`.
  - **`resolution`** — 11 nodes (incl. `Trellis2ShapeGenerator`,
    `Trellis2ReconstructMeshWithQuad`, `Trellis2MeshTexturing`, the MultiView / TexSlat /
    MeshRefiner / export siblings — there is no Remesh node among them): the three integer lists `([512,1024],…)`,
    `([128,256,512,1024,2048],…)`, `([512,1024,1536],…)` → their string equivalents, with a
    `resolution = int(resolution)` as the first line of each `process()` (needed because the
    value is compared with `== 512`/`== 1024` and returned as an `INT` output).
  - → `_maintenance\fix_resolution_combos.py`.
  - ⚠ The example-workflow `.json`s are deliberately **not** edited for this — the stored int
    values submit as strings and validate against the fixed nodes, and a by-value JSON edit
    would corrupt neighbours (a `MeshTexturing` node keeps `texture_size=2048` right beside
    `resolution=1024`). The node-side fix also covers workflows you build yourself.
- **`example_workflows\*.json`** — the pack author's absolute `C:\Git\ComfyUI\output\...` mesh
  paths were rewritten to drive-relative tails (bare filename or `subfolder/name.glb`), which
  ComfyUI resolves against the install on any drive letter.
  - → `_maintenance\portablize_paths.py`.
  - The Blender-projection workflow's `C:\Program Files\...\blender.exe` is left as-is — a real
    machine-specific install path that can't be made portable.

### Pixal3D (`custom_nodes\Pixal3D-ComfyUI\`) + its RMBG model — automated
Reverted if the RMBG **model** is re-downloaded (it is a model file, not a pack file).
- **`ComfyUI\models\Pixal3D\briaai_RMBG-2.0\birefnet.py`** — added to `class Config` (the
  module-level one at line 7; there is no nested Config in the file):
  `tie_word_embeddings = False` and `def get_text_config(self, decoder=False): return self`.
  ⚠ This is a **model file**: it also reverts if the RMBG model is re-downloaded. The model
  itself came from the **ungated** mirror `1038lab/RMBG-2.0` (no HuggingFace token needed).

### ComfyUI-DepthAnythingV3 (`custom_nodes\ComfyUI-DepthAnythingV3\`) — automated
Reverted by a pack update.
- **`comfy-env-root.toml`** — two edits: added `[settings]` with `isolate = false` and
  `install_isolated = false` (runs in-process on this drive instead of an isolated `C:` env),
  **and removed the `ComfyUI-GeometryPack = "PozzettiAndrea/ComfyUI-GeometryPack"` line from
  `[node_reqs]`** so the pack is not pulled back in. `REPAIR.bat` restores the `[settings]`
  block but **not** that deletion — if the pack reappears after an update, remove the line
  again by hand.
- **`nodes\comfy-env.toml`** — renamed to `nodes\comfy-env.toml.disabled`.
- `ComfyUI-GeometryPack` was **deleted** and is no longer anywhere on this drive: it needs
  conda-only libraries (`cgal`, `igl`, Blender's `bpy`) that can't live here, and no workflow
  used it. There is no local copy to restore — re-install from ComfyUI-Manager if ever needed.
  (`custom_nodes\.disabled\` exists but is empty; nothing was parked there.)

### The launchers (`run_*.bat`) — customised, but safe
All three launchers carry **`--listen 0.0.0.0`** so the web UI is reachable from other
machines on the LAN (`run_nvidia_gpu_fast_fp16_accumulation.bat` adds
`--fast fp16_accumulation`). These files live *outside* the `ComfyUI\` git repo, so neither a
core update nor a pack update touches them — only a fresh portable re-extract would.
`REPAIR.bat` does not manage them.

### Things you may notice that are NOT hacks
- **`custom_nodes\comfyq_opener\`** — a small frontend extension **ComfyQ installs and
  version-checks on every ComfyUI launch**, so it heals itself. It reads a `?comfyq_open=<id>`
  URL parameter and loads the named workflow onto the canvas ("Open in ComfyUI" in the ComfyQ
  admin panel). Nothing to re-apply.
- **`*.orig-backup` / `*.orig-bak` files** next to a patched file, and
  `ComfyUI-Trellis2\example_workflows_orig_backup\` — snapshots taken before a hand-edit.
  Harmless; ComfyUI ignores them.
- **`custom_nodes\.disabled\`** — empty; ComfyUI-Manager parks disabled packs there.

### The cross-drive `/view` fix (does NOT revert on ComfyUI update)
- `custom_nodes\ComfyUI-CrossDriveViewFix\` — a small custom node that stops ComfyUI's
  `/view` route from crashing when a preview path is on a different drive (which happens
  when this drive mounts under a new letter). Published at
  **https://github.com/b2renger/ComfyUI-CrossDriveViewFix**. This one lives in
  `custom_nodes/`, so a ComfyUI *core* update won't touch it.

---

## 📦 Where the 3D models live (all on this drive)

| Pack | Location |
|---|---|
| Pixal3D weights (~24 GB) | `ComfyUI\models\Pixal3D\TencentARC_Pixal3D\` |
| Pixal3D DINOv3 helper | `ComfyUI\models\Pixal3D\camenduru_dinov3-vitl16-pretrain-lvd1689m\` |
| Pixal3D background removal | `ComfyUI\models\Pixal3D\briaai_RMBG-2.0\` (from `1038lab/RMBG-2.0`, ungated) |
| MoGe (shared depth) | `ComfyUI\models\geometry_estimation\` |
| TRELLIS.2-4B (~17.7 GB) | `ComfyUI\models\microsoft\TRELLIS.2-4B\` |
| TRELLIS2 DINOv3 | `ComfyUI\models\facebook\dinov3-vitl16-pretrain-lvd1689m\` |

**Pixal3D's** loader auto-downloads only when its `download_if_missing` toggle is ON (it
defaults OFF — `Pixal3D-ComfyUI\nodes.py`). Leave it OFF: turning it on with a missing folder
re-fetches the weights and, for RMBG, overwrites the `birefnet.py` fix above.

⚠ **TRELLIS2 has no such toggle.** `ComfyUI-Trellis2\nodes.py` re-downloads any missing model
folder **unconditionally** (`snapshot_download` / `hf_hub_download`). So do not delete or rename
`models\microsoft\TRELLIS.2-4B\`, `models\microsoft\TRELLIS-image-large\` or
`models\facebook\dinov3-vitl16-pretrain-lvd1689m\` — they will silently come back on the next
run, over a slow link, and you will not be told.

---

## 🖥️ First time on a new machine — the "isn't git repo" warning

The first time you plug this drive into a **different machine**, ComfyUI-Manager will
likely say:

> **Your ComfyUI isn't git repo.**

**This is a false alarm — nothing is broken.** The `ComfyUI` folder *is* a valid git
checkout. The real cause is git's **"dubious ownership"** safety guard: the folder on this
NTFS drive still carries the Windows owner account (SID) of the machine that first set it up,
and every other machine logs in as a *different* account. Git sees a mismatch, refuses to
touch the repo, and Manager mis-reads that refusal as "no repo." It has **no effect on running
ComfyUI or any workflow** — it only stops Manager from version-tracking / updating ComfyUI core.

**Fix (run once per machine, in any terminal):**
```
git config --global --add safe.directory "*"
```
Then restart ComfyUI (or reload the Manager) and the warning is gone.

**Why you have to do it on each machine (and can't bake it into the drive):** git deliberately
reads this "trusted directory" setting **only from your per-user config on `C:`**, never from the
repo on the drive itself (so a repo can't declare itself trusted). So it's a genuine one-time
step per machine/user — the portable drive can't carry it. The `"*"` wildcard is used on purpose:
this drive mounts under different letters (`J:`, `K:`, …) and has many repos under
`custom_nodes\`, so a single path-specific exception wouldn't survive a letter change or cover
the node packs.

> This re-enables Manager's **"Update ComfyUI"** button, which is a core-only `git pull` and is
> **safe** for the pinned stack (ComfyUI's `requirements.txt` asks for a bare `torch`, so pip
> won't upgrade your 2.8.0). It does **not** change the rule at the top of this file: never run
> `update_comfyui_and_python_dependencies.bat`.

---

## ✅ Quick health check

Run `REPAIR.bat --check` — everything should read `[ OK ]`.

Then booting `run_nvidia_gpu.bat` should show, with no errors:
- `pytorch version: 2.8.0+cu128`
- `[CrossDriveViewFix] os.path.commonpath patched ...`
- Pixal3D / TRELLIS2 nodes present in the menu

Harmless log lines you can ignore: `mmgp not installed` (a Desktop-only helper the packs
handle gracefully) and `xFormers not available`.
