---
name: iso-build-curated-comfyui
description: "How the shareable curated ComfyUI ISO is built (652 GB from the 1.57 TB NVMe) — folder-level curation rules, the robocopy /XD depth trap, oscdimg UDF flags, verification gates"
metadata: 
  node_type: memory
  type: project
  originSessionId: 00257d39-145b-4f75-b452-47247dfe9230
---

Built 2026-07-09/10: a curated, shareable image of the portable NVMe ComfyUI (`<nvme>\ComfyUI_windows_portable_nvidia`, 1.57 TB) → **652 GB staged tree** at `D:\comfyq_iso_build\` → UDF ISO at `E:\comfyq_iso\ComfyQ_ComfyUI_portable.iso` (oscdimg). Source drive never written. Stage layout: `ComfyUI_windows_portable\` + `_maintenance\` + `README-FIRST.txt`.

**Curation rule (the key design):** only the 4 giant flat-weight buckets — `checkpoints` / `diffusion_models` / `text_encoders` / `loras` — are filtered to workflow-referenced files (regex over all non-`_candidate` `workflows/**/*.json` in ComfyQ, basename match, 61 names); **every other `models/` subfolder is copied whole**. Why: repo-style directory-models (`microsoft/TRELLIS.2-4B`, `Pixal3D/*`, `visualbruno/`, `facebook/`, `liveportrait/`, `sam3d/`…) are loaded by folder path, invisible to a filename scan — a file-level allow-list would silently delete the 3D packs. ~900 GB of unreferenced weights dropped; every ComfyQ workflow keeps its models.

**★ robocopy `/XD` depth trap (real bug hit):** bare names in `/XD checkpoints ...` exclude at EVERY depth — it silently skipped `models\sam3d\hf\checkpoints\` (12 GB) inside a whole-copied folder. Fix: after staging, size-compare every whole-copied folder staged-vs-source (byte match) and re-copy any short one without the bucket excludes. Only sam3d was hit.

**Benign reference misses:** `ltx-av-step-1751000_vocoder_24K.safetensors` (only in non-executing `*_template.json`; absent from source too) and `model.safetensors` (placeholder). `models\TencentARC\Pixal3D-T\` is an aborted duplicate download — its 4 GB `.cache\huggingface\download\*.incomplete` blobs are junk (deleted from stage; kept the 2 finished decoders); production Pixal3D lives at `models\Pixal3D\TencentARC_Pixal3D`.

**Pre-master scrub (staged tree only):** ComfyUI `user\comfyui*.{log,db,bkp,lock}` (recreated on boot; carry machine paths), `user\__manager\cache\` (Manager re-downloads it on ANY boot — scrub AFTER the smoke test), Manager `snapshots\*autosave*` (CI-machine wheel paths), top-level `temp.glb`/`mr_combined.png`, staging log. KEPT deliberately: `.git` dirs (~1 GB — Manager updates depend on them), `user\default\workflows` (admin's saved workflows), Manager `security_level=weak` (lab default — reconsider for stranger distribution).

**Verification gates that passed:** 4-agent audit (model completeness byte-exact incl. directory-models; robocopy /L framework diff = 0 divergence; hand-patch hashes — Trellis2 nodes.py combos, RMBG birefnet.py, `_maintenance`, CrossDriveViewFix, DepthAnythingV3 de-isolation; portability scan). Then a boot smoke test FROM the staged tree (proves drive-relocation): `python_embeded\python.exe -s ComfyUI\main.py --windows-standalone-build --port 8288 --disable-auto-launch`, poll `/system_stats`, check per-class `/object_info/<Class>` (the full `/object_info` is ~50 MB — PS 5.1 JSON parsing silently mangles it; per-class endpoints are the reliable check), grep boot log for `IMPORT FAILED` (zero across all 35 packs, SageAttention + flash_attn active).

**ISO tech:** plain ISO-9660 impossible (30+ files >4 GB; largest 43 GB) → **UDF via oscdimg** (`winget install Microsoft.WindowsADK --override "/features OptionId.DeploymentTools /quiet /norestart"`): `oscdimg -u2 -o -m -h -l<label> <stageDir> <out.iso>` (`-o` dedupes duplicate files by hash — the tree has byte-dup models like dinov3 ×2). oscdimg **preallocates the output at final size immediately** — file size is not progress. ISO is read-only transport: recipients must copy the two top-level folders off to a writable disk to run (README-FIRST.txt in the image explains, incl. sm_89+ GPU floor — Ampere excluded by the prebuilt kernels — and the per-machine `git config --global --add safe.directory "*"`).

Related: [[portable-no-drive-letters]] (why nothing may bake a drive letter), [[pixal-trellis-portable-install]] (the packs/patches that must survive the copy).
