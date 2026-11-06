---
name: comfyq-text-path-output-and-pixal3d
description: ComfyQ serves a node's saved file when it is surfaced only as an on-disk PATH string (any output key) — a generic pass in outputCollector.js; the two custom-pack 3D bundles it was first built for were removed 2026-10-05
metadata:
  node_type: memory
  type: project
  originSessionId: bbc22e8d-d98e-4751-acad-5516d1066956
  modified: 2026-11-05T20:38:07.802Z
---

**The generic fix (still live, checked 2026-11-05).** Some nodes save a file into ComfyUI's output dir but never emit a `{filename,subfolder,type}` media record — they surface the file only as an **absolute-path string**, and in different output keys per node. No graph-only fix exists (no comfy-core node turns a STRING path into a `SaveGLB`/File3D record), so the fix is in **[outputCollector.js](server/executor/outputCollector.js)**: `collectFromHistory(historyEntry, comfyConfig)` (sole non-test caller: [jobExecutor.js](server/executor/jobExecutor.js)) runs 3 passes —
1. `_walk` for real `{filename}` records (SaveImage/SaveGLB/SaveVideo…; `type:'input'` records are skipped). A record that also carries an absolute `fullpath` (VHS_VideoCombine) has that path added to the seen set, so pass 2 does not collect it twice.
2. **`_collectMediaPaths`** recursively scans **every string** in a node's output (any key: `text`, `result`, nested) and, for each that is a single-line **absolute path to an existing media file under `output_dir` or the temp dir** (`tempDirOf(comfyConfig)`, which honours a lane's own `temp_dir`), emits a media record (`_mediaRecordFromPath`, deduped by resolved absolute path). Tight guards — absolute + on disk + a media extension via `classify` + inside a served root — so captions and non-media strings are never touched.
3. `_collectText` for genuine captions, **skipping** any string already taken as a media path; the result then goes through `_keepResultText` (stray whitespace-free text beside a real file is dropped from the job's outputs; the library sweep keeps it and tags it `stray: true` in its report, librarySweep.js; see CLAUDE.md 2026-10-07).

**So: any node that surfaces its saved file only as an on-disk path — in ANY output key — just works in ComfyQ**, with no dependency and no `class_type` coupling. No client change is needed (a lone `model3d`/`.glb` renders in `ModelViewer`; the splat/mesh toggle appears only when a job has both).

**Why it reads every key — the two cases that forced it** (history, not current bundles): Pixal3D's `Pixal3DExportGLB` returns `{"ui":{"text":["<abs>.glb"]}}`; TRELLIS2's `Trellis2ExportMesh` returns a plain tuple with **no `ui`** (it reports nothing to history), and the path reaches history only through a downstream `Preview3D`'s `{"result":["<abs>.glb", …]}`. A text-key-only reclassifier handled the first and missed the second, which is why the pass scans every string.

**Bundle history:** it was built for `3d_pixal3d_image_to_mesh` and `3d_trellis2_image_to_textured_mesh` (2026-07-08), the custom-pack (Saganaki22/Pixal3D-ComfyUI, visualbruno/ComfyUI-Trellis2) versions. **Both were removed 2026-10-05** (commit 6231b1e, owner's request) once ComfyUI shipped core Pixal3D/TRELLIS2 nodes; the remaining `3d_pixal3d_multi_views` and `3d_pixal3d_trellis2_image_to_model` run on the core nodes and emit ordinary save records. Their workflow folders no longer exist — do not link to them. The two packs are still installed (see [[pixal-trellis-portable-install]]).
