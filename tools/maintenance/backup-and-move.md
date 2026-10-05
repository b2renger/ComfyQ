# Backup, restore, and moving this install

The backup is **not** on this drive. If you only know it as "D:" and "E:" you will lose it the
moment this drive is plugged into another machine — so this page describes how to *identify* it,
how to restore from it, and how to make a new one.

---

## What the backup is

A **curated distribution image** of this whole install, built **2026-07-10**:

| | |
|---|---|
| Identify it by | filename `ComfyQ_ComfyUI_portable.iso`, UDF volume label **`ComfyQ_ComfyUI`**, 647.0 GB (694,734,387,200 bytes) |
| Beside it | `ComfyQ_ComfyUI_portable.iso.sha256`, `BUILD-INFO.txt`, `HOW-TO-USE.md` (13 KB, the full recipient guide) |
| On this machine, today | `E:\comfyq_iso\` |
| Staging tree it was built from | `D:\comfyq_iso_build\` — 652 GB, **redundant** now the ISO exists |

Verify integrity before trusting it:

```powershell
Get-FileHash ComfyQ_ComfyUI_portable.iso -Algorithm SHA256
# compare with the contents of ComfyQ_ComfyUI_portable.iso.sha256
```

### ⚠ It is curated, not a mirror — three things follow

1. **Only the four big weight buckets were trimmed** (`checkpoints`, `diffusion_models`,
   `text_encoders`, `loras`) to models a ComfyQ workflow referenced; ~900 GB of unreferenced
   weights were dropped. **Every other `models\` subfolder was copied whole.**
2. **It is a snapshot of 2026-07-10.** It contains nothing added since — currently ~353 GB
   (MiniMax H3, LTX 2.5, Wan-Animate 2, SCAIL-2, ID-V2V). Absence from the ISO is *not*
   evidence a model is unwanted.
3. Some things you would most want backed up are **not in it** — verified absent:
   `flux1-dev.safetensors` and `stable-audio-open-1.0.safetensors`, both licence-gated on
   HuggingFace and therefore the most painful to re-obtain.

`model-audit\model-audit.csv`'s `backup` column tells you, per model, whether a copy exists in
the D: staging tree.

---

## Restoring / installing on a new machine

The ISO is **read-only transport**. ComfyUI cannot run from it — it writes to `user\`, `temp\`,
`output\` and needs its `.git` dirs.

1. Mount the ISO (double-click in Windows 10/11).
2. Copy **both** top-level folders — `ComfyUI_windows_portable\` and `_maintenance\` — to a
   writable disk. Use a **short path** (`D:\ComfyQ\`): the deepest path in the image is 191
   characters below its root, so keep the destination prefix under ~65 characters to stay
   clear of Windows' 260-char limit. (The D: *staging tree* still contains 259-char JupyterLab
   paths — those are the ones oscdimg dropped, and ComfyUI never uses them.)
3. Per machine, once: `git config --global --add safe.directory "*"` — see `notice.md`
   ("First time on a new machine") for why this cannot be baked into the drive.
4. Run `_maintenance\REPAIR.bat --check`. Everything should read `[ OK ]`.
5. Launch `run_nvidia_gpu.bat`.

`HOW-TO-USE.md` next to the ISO is the longer version of this, written for someone who has
never seen the install.

### Hardware floor — check this before anything else

**GPU must be sm_89 or newer (Ada 40xx / Blackwell 50xx / RTX PRO).** **Ampere (RTX 3090,
A6000) will NOT work** — the prebuilt CUDA kernels the 3D packs depend on are compiled for
sm_89+, and there is no compiler on the drive to rebuild them.

The failure looks like a pile of `DLL load failed` / `undefined symbol` at startup — which is
*also* what PyTorch drift looks like (`notice.md` §1). On a new machine, suspect the GPU first;
`REPAIR.bat` will confirm torch is still 2.8.0+cu128 and that the kernels import, which
separates the two.

Also needed: Windows 10/11, an NVIDIA driver of the CUDA 12.8 class or newer, 16–24 GB VRAM for
most workflows and 24 GB+ for the 3D packs and bf16 models.

---

## Making a new image

There is **no build script** — this is the recipe. Budget a working day; the source drive is
never written to.

**1. Stage.** Copy to a scratch disk with room for ~650 GB. Apply the curation rule: filter
only `checkpoints`, `diffusion_models`, `text_encoders`, `loras` to the set of filenames
referenced by `J:\ComfyQ\workflows\**\*.json` (basename match; skip `_candidate*`), and copy
**every other `models\` subfolder whole**.

> **Why whole:** repo-style directory-models (`microsoft\TRELLIS.2-4B`, `Pixal3D\*`,
> `visualbruno\`, `facebook\`, `liveportrait\`, `sam3d\`) are loaded by *folder path* and are
> invisible to a filename scan. A file-level allow-list silently destroys the 3D packs.

> **★ The `/XD` depth trap — this bit us for real.** Bare folder names in
> `robocopy /XD checkpoints ...` exclude at **every depth**, so it silently skipped
> `models\sam3d\hf\checkpoints\` (12 GB) *inside* a folder that was supposed to be copied
> whole. After staging, size-compare every whole-copied folder against the source and re-copy
> any short one **without** the bucket excludes.

**2. Scrub the staged tree only** (never the source): ComfyUI `user\comfyui*.{log,db,bkp,lock}`
(recreated on boot, and they carry machine paths), `user\__manager\cache\` (Manager refetches it
on any boot — scrub *after* the smoke test), Manager `snapshots\*autosave*` (CI-machine wheel
paths), stray `temp.glb` / `mr_combined.png`. **Keep** the `.git` dirs (~1 GB — Manager's update
path needs them) and `user\default\workflows\`.

**3. Verify before mastering.** Byte-exact model comparison including directory-models;
`robocopy /L` framework diff = zero divergence; hashes of every hand-patch (`notice.md`'s
checklist); a portability scan for leaked absolute paths. Then **boot from the staged tree** —
that is what proves relocation works:

```powershell
python_embeded\python.exe -s ComfyUI\main.py --windows-standalone-build --port 8288 --disable-auto-launch
```

Poll `/system_stats`, check a few `/object_info/<Class>` endpoints (the full `/object_info` is
~50 MB and PowerShell 5.1 silently mangles JSON that large), and grep the boot log for
`IMPORT FAILED` — it must be zero across all packs.

**4. Master.** Plain ISO-9660 is impossible — 45 files exceed its 4 GiB per-file ceiling, the
largest being `qwen_image_edit_2511_bf16.safetensors` at 38 GiB (40,861,031,560 bytes) — so use
**UDF via oscdimg**:

```powershell
winget install Microsoft.WindowsADK --override "/features OptionId.DeploymentTools /quiet /norestart"
oscdimg -u2 -o -m -h -lComfyQ_ComfyUI <stageDir> <out.iso>
```

`-o` dedupes identical files by hash (the tree has byte-identical duplicates, e.g. dinov3 twice).
**oscdimg preallocates the output at its final size immediately — the file size is not
progress.** Expect paths over ~235 chars to be dropped: the 2026-07 build lost 25 JupyterLab
web assets that way, with no functional impact.

**5. Finish.** Write the `.sha256`, a `BUILD-INFO.txt` recording what was curated and what was
verified, and mount the ISO to confirm paths are present and a large file reads intact.
