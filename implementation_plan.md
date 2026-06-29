# ComfyQ v2 — Implementation Plan & Progress

This document tracks the v2 rebuild: the architecture, the milestone sequence, what's done, and what's still ahead. The plan was reached after auditing `main` / `poc1` / `poc2` and confirming six foundational decisions with the project owner.

---

## Why v2

> **Branch note (2026-06-13):** the v2 rebuild described here is now the active code on the default **`main`** branch. The original v1 (the monolithic `server/scheduler.js`) is preserved on the **`poc1` / `poc2`** branches; the standalone `v2` branch is a stale snapshot, behind `main`. Historical "`main` = v1" phrasing below is kept as the rationale that drove the rewrite.

The v1 architecture (preserved on `poc1` / `poc2`) cannot serve the target workflow set:

- **Single-worker scheduler** with a fixed-duration boot benchmark
- **Hard-coded save node whitelist** (`SaveImage`, `SaveVideo`, `VHS_VideoCombine`) — fatal for LTX video / depth preprocessors / audio outputs
- **Fragile Litegraph→API auto-conversion** (poc2) that fails on Group Nodes
- **Editable-field whitelist** in `workflowParser` that won't survive new node types
- **No audio I/O** anywhere in parser / scheduler / BookingDialog
- **No reconnection logic** on the ComfyUI WebSocket; jobs hang in `processing` if ComfyUI restarts

At the time of the rewrite, `main` and `poc1` were byte-identical (the v1 baseline); only `poc2` had diverged, adding the workflow registry concept and `.config.meta.json` separation. v2 ported those ideas and rebuilt the rest — and v2 is now what lives on `main` (the original v1 baseline remains on `poc1`).

## Target compatibility

End-to-end on lab GPU boxes (RTX 3090 / 4080 / 4090 / 5090, ComfyUI per machine):

1. Flux2 Klein 9B text-to-image
2. Flux2 Klein 9B image-edit
3. LTX 2.3 video-from-reference-image
4. Depth preprocessor workflow
5. 360 video LoRA workflow
6. LTX audio-driven generation

## Confirmed decisions

| Area | Decision |
|------|----------|
| Starting point | Fresh rewrite from `main`, port good ideas from `poc2` |
| Runtime model | Single ComfyUI instance now, scheduler designed around an abstract `Worker` interface so multi-node is a later swap |
| Workflow input format | **API format only.** No Litegraph auto-conversion. Admin UI rejects non-API with a clear "Save (API Format)" message |
| Custom ComfyUI node | **None.** ComfyQ stays a pure HTTP/WS client. Output detection is generic by file extension / MIME |
| Auth | Classroom trust — username + a single admin password gate for destructive cross-user actions |
| In-scope features | All of TODO Phase 2 (job mgmt: colors, search, CSV export), Phase 3 (real-time progress / ETA / node-state viz), Phase 4 (webcam / mobile capture), and audio I/O |
| Skills repo (`jtydhr88/comfyui-custom-node-skills`) | Out of scope for v2; revisit only if a future Phase 6 ships a `ComfyQ_Save` helper node |

---

## Architecture

```
            server/index.js  (Express + Socket.IO bootstrap)
                  │
   ┌──────────────┼─────────────────────────┐
   ▼              ▼                         ▼
AuthGate    WorkflowRegistry          WorkerPool (1 LocalWorker today)
                  │                         │
                  ▼                         ▼
          BenchmarkService          Worker (interface)
                                    submit / cancel / status / on(event)
                                          │  implements
                                          ▼
                                    LocalComfyUIWorker
                                      ├ ComfyProcess (spawn / external)
                                      ├ ComfyRestClient
                                      ├ ComfyWsClient (auto-reconnect)
                                      ├ InputUploader (+ TTL cleanup)
                                      ├ OutputCollector (extension-based)
                                      └ ModelLifecycle (ComfyUI /free)

   JobQueue (sqlite, persistent) → JobExecutor (state machine) → Worker
                                          │ events
                                          ▼
                                    RealtimeBus (socket.io fan-out)

   MediaStore  →  GET /media/:kind/:filename  (image/video/audio/3d/json)
```

### Module responsibilities

- **JobQueue** — sqlite (`better-sqlite3`) at `server/data/comfyq.sqlite`. Survives restart; in-flight jobs reconcile to `failed: server-restart` on boot.
- **Worker (interface)** — `submit(jobId, apiWorkflow, opts)`, `cancel(jobId)`, `getStatus()`, `on(event, cb)`. Events: `submitted`, `progress`, `node-executing`, `output-ready`, `completed`, `failed`. No locality assumption.
- **LocalComfyUIWorker** — owns one ComfyUI subprocess (or attaches to an external one) + REST + WS. Knows nothing about the queue.
- **WorkflowRegistry** — folder scan, zod schema validation, mtime-based cache invalidation. Rejects non-API workflows.
- **JobExecutor** — drives the state machine, persists transitions, emits to RealtimeBus. Adaptive history polling fallback when WS drops.
- **OutputCollector** — walks `history[promptId].outputs`, classifies by file extension. No `class_type` whitelist.
- **MediaStore** — `/media/:kind/:filename` with correct MIME (image/video/audio/3d/json/binary). Reads from both `output/` and `temp/`.
- **AuthGate** — Express middleware; admin-password header check (bcryptjs) on destructive routes.
- **RealtimeBus** — Socket.IO fan-out of executor events; handles `register_user`, `book_job`, `cancel_job`, `delete_job`, `reorder_job`. Wire-compatible with the v1 client.
- **BenchmarkService** — runs a workflow for real as a **cold run + warm run** and writes sidecar `<id>.runtime.json` (first-time cost incl. model load, recurring warm cost = what the timeline uses, samples/sec, GPU). Auto-supplies `image`/`video`/`audio` inputs from `config.assets.dir` (no upload). **AdminCalibrator** wraps it so calibration works in admin mode by spawning/attaching ComfyUI on demand.

### Job state machine

```
scheduled → uploading-inputs → submitted → executing → collecting-outputs → completed
                                                                          ↘ failed (errorPhase tracked)
                                                                          ↘ cancelled (admin pwd if foreign user)
```

---

## File layout

### `server/`

```
server/
├── index.js                           thin bootstrap
├── config/
│   ├── configManager.js               v1→v2 auto-migration, archives v1 to .v1.bak
│   └── schemas.js                     zod: AppConfig, WorkflowMeta, WorkflowConfigMeta
├── auth/
│   └── authGate.js                    admin-password middleware (bcryptjs)
├── workflows/
│   ├── workflowRegistry.js            folder bundles + mtime cache + zod
│   ├── workflowParser.js              primitive-fallback (no whitelist)
│   └── workflowValidator.js           "is API format?" check
├── queue/
│   ├── jobQueue.js                    sqlite, reconcileOnBoot()
│   └── jobStateMachine.js             transitions, isTerminal, toWireStatus
├── executor/
│   ├── jobExecutor.js                 drives queue + worker
│   └── outputCollector.js             generic media classification
├── workers/
│   ├── workerInterface.js             abstract base + EventEmitter
│   ├── localComfyUIWorker.js          composes everything below
│   ├── comfyProcess.js                spawn / attach to external ComfyUI
│   ├── comfyRestClient.js             /prompt /history /interrupt /free /upload/image
│   ├── comfyWsClient.js               auto-reconnect with backoff
│   ├── inputUploader.js               namespaced copies into ComfyUI/input + TTL sweep
│   └── modelLifecycle.js              calls /free on workflow switch
├── benchmark/
│   └── benchmarkService.js            real warmup
├── media/
│   ├── mediaStore.js                  /media/:kind/:filename + /images/* /download/* aliases
│   └── mediaTypes.js                  ext → kind/MIME table
├── realtime/
│   └── realtimeBus.js                 socket.io fan-out (wire-compatible with v1 client)
└── routes/
    ├── admin.js                       config, paths, password, activate-workflow, upload-workflow
    ├── workflows.js                   /workflows, /:id, /:id/parameters, /:id/presets/:name, /:id/calibrate
    ├── jobs.js                        REST list / detail / events (Phase 2 CSV will read these)
    └── uploads.js                     /upload, /upload-image (compat)
```

### `client/`

```
client/src/
├── App.jsx                              unchanged
├── context/SocketContext.jsx            unchanged (wire-compatible)
├── pages/
│   ├── AdminConfig.jsx                  rewritten for v2 endpoints
│   ├── Scheduler.jsx                    unchanged for M0; ETA/ProgressViz added in M2
│   └── Dashboard.jsx                    unchanged for M0
├── components/
│   ├── WorkflowSelector.jsx             ported from poc2, rewired to /workflows/*; per-card edit/calibrate/delete actions
│   ├── BookingDialog.jsx                random-seed default + dice re-roll, image upload, recall of saved param sets
│   ├── MyJobsPanel.jsx                  per-job WorkflowChip
│   ├── UsernameModal.jsx                unchanged
│   ├── ImageLightbox.jsx                "Use these settings" recall, workflow info panel
│   ├── ui/WorkflowChip.jsx              renders workflow_id → display name in cards / lightbox
│   └── admin/
│       └── WorkflowMetaEditor.jsx       modal: edit metadata + parameter exposure for any workflow
└── utils/api.js                         unchanged
```

### `workflows/`

Each workflow is a folder bundle:

```
workflows/<id>/
├── <id>.api.json              ComfyUI API-format workflow (REQUIRED)
├── <id>.meta.json             WorkflowMeta (REQUIRED for v2)
├── <id>.config.meta.json      Per-deployment overrides (OPTIONAL, written by admin UI; gitignored)
└── <id>.runtime.json          BenchmarkService output (OPTIONAL, gitignored)
```

Currently shipping (validated on RTX 5090, 2026-05-03):
- `workflows/flux2_klein_9b_t2i/` — text to image
- `workflows/flux2_klein_9b_image_edit/` — single image edit
- `workflows/flux2_klein_9b_image_edit_ref/` — image edit with a reference image

All three reuse the same model set: `flux-2-klein-base-9b-fp8.safetensors` (UNET), `flux2-vae.safetensors` (VAE), `qwen_3_8b_fp8mixed.safetensors` (CLIP). Per-deployment runtime sidecars (`<id>.runtime.json`) and overrides (`<id>.config.meta.json`) are gitignored.

---

## Schemas

### `<id>.meta.json`

```
{
  schemaVersion: 1,
  id, name, description,
  category: 't2i' | 'image-edit' | 'i2v' | 'i2i' | 'audio' | '3d' | 'preprocessor' | 'other',
  tags: string[],
  thumbnail, author, version,
  workflowFile,                            // "<id>.api.json"
  apiFormat: true,                         // literal — non-API rejected
  requirements: { minVRAM, models: [{ type, file }] },
  estimatedDurationSec,                    // (no `maxRuntimeSec` — jobs have no time budget; removed 2026-06-26)
  exposedParameters: [
    { key, nodeId, field, type, label, default, options?, min?, max?, step?, required, order }
  ],
  warmupParams: { [key]: any },            // for BenchmarkService
  presets: { [name]: { label?, description?, values: { [paramKey]: any } } }
}
```

### `<id>.config.meta.json`

Per-deployment overrides; admin UI writes this. Server treats `meta.json` as read-only.

```
{
  schemaVersion: 1,
  id,
  parameterOverrides: { [paramKey]: { label?, default?, enabled?, order? } },
  warmupPromptOverride?,
  hidden?: boolean
}
```

### Job record (sqlite `jobs`)

```
{ id, userId, workflowId, workflowVersion,
  status: 'scheduled' | 'uploading-inputs' | 'submitted' | 'executing'
        | 'collecting-outputs' | 'completed' | 'failed' | 'cancelled',
  scheduledAt, startedAt, finishedAt,
  promptId, prompt, paramValues, inputFiles, outputs,
  progress: { stepsDone, stepsTotal, currentNodeId },
  errorReason, errorPhase, createdBy }
```

Companion `job_events` table: append-only `{ jobId, ts, fromStatus, toStatus, payload }`.

### v2 `config.json`

```
{
  schemaVersion: 2,
  mode: 'admin' | 'student',
  server: { port, host },
  comfy_ui: { installation_type, root_path, python_executable, output_dir,
              api_host, api_port, lan_access, autoStart, vramBudgetGb },
  auth: { adminPasswordHash },
  queue: { dbPath, inputRetentionMinutes, outputRetentionDays },
  workflows: { dir, activeWorkflowId },
  assets: { dir }                          // sample media for auto-calibration
}
```

No workflow-specific fields in `config.json`; that lives in the registry now.

---

## Milestones

### M0 — v2 skeleton runs Flux1 dev t2i (✅ COMPLETE — VERIFIED ON RIG)

Smallest functional v2 covering only t2i, on the new architecture.

- [x] Branch `v2` cut from `main`. Old v1 modules deleted. *(v2 has since been promoted to `main`; the standalone `v2` branch is now a stale snapshot.)*
- [x] New deps installed: `better-sqlite3`, `zod`, `mime-types`, `bcryptjs`, `multer`, `form-data`.
- [x] Implemented: `configManager`, `schemas`, `workflowRegistry`, `workflowParser` (primitive-fallback), `workflowValidator`, `jobQueue` (sqlite), `jobStateMachine`, `jobExecutor`, `outputCollector` (generic), `workerInterface`, `localComfyUIWorker` + helpers, `comfyWsClient` (reconnection), `mediaStore`, `realtimeBus`, `authGate`, `benchmarkService`.
- [x] Routes: `admin`, `workflows`, `jobs`, `uploads`.
- [x] Starter fixtures: three Flux2 Klein 9B workflows (`flux2_klein_9b_t2i`, `flux2_klein_9b_image_edit`, `flux2_klein_9b_image_edit_ref`) — replaced earlier `flux1_dev_t2i` smoke fixture once the Flux2 set was validated on rig.
- [x] Client: `WorkflowSelector` ported, `AdminConfig` rewired. `BookingDialog`, `Scheduler`, `Dashboard` kept wire-compatible.
- [x] Jobs persist across server restart; queue reconciles in-flight jobs to `failed: server-restart` (smoke-test passing).
- [x] **Rig acceptance (RTX 5090):** Flux2 Klein 9B text-to-image, image-edit, and image-edit with reference image all run end-to-end (booking → generation → output → download).

**Runtime / ops (updated 2026-06-08).** ComfyQ targets an **LTS Node line** for broad lab-machine compatibility — currently **Node 24 "Krypton"**, pinned in [.nvmrc](.nvmrc) (`24`) with `engines.node` = `>=22.0.0 <25.0.0` in the root, [server](server/package.json), and [client](client/package.json) `package.json` (advisory: warns on the odd-numbered "Current" line, e.g. 25). The sole native dependency, `better-sqlite3`, was bumped **11 → 12** so it ships an N-API prebuilt binary covering Node 24 (one binary, no per-machine recompile). On Windows, winget installs Node from two packages — `OpenJS.NodeJS` is the wrong (Current) one; use `OpenJS.NodeJS.LTS`. After any Node major change, wipe `node_modules` and `npm install` so the native ABI matches. See also the **plain-HTTP** decision (2026-05-19) in the M4 section.

### M1 — Real BenchmarkService + Flux2 image-edit (✅ COMPLETE)

- [x] `BenchmarkService` runs a real warmup and writes `<id>.runtime.json` with `estimatedDurationSec`, `samplesPerSec`, `coldDurationSec`, and `modelLoadSec`.
- [x] `estimatedDurationSec` measures **generation only** — anchored on the first sampler progress event so model/VAE/CLIP load time is excluded. The recurring per-job cost (sampling + decode + save) is what the timeline shows.
- [x] Calibration auto-supplies inputs from an **assets directory** (`config.assets.dir`, default `D:\_assets`): the `BenchmarkService` picks a file matching each `image`/`video`/`audio` input type (median-sized image, smallest video, an audio clip) and stages it via the worker's `InputUploader` — no admin upload, no per-workflow `warmupParams`. Image inputs fall back to a built-in 512×512 reference PNG (`__comfyq_calibration.png`) when the assets dir has none; `video`/`audio` with no asset and no `warmupParams` give a clear `no <type> asset available` error. (Original behavior was image-PNG-only; video/audio used to hard-throw.) **Updated 2026-06-13** to a single timed run split into load+generation — see the admin-calibration item below.
- [x] Scheduler timeline uses per-workflow estimate (no global 60 s).
- [x] Flux2 image-edit (1-image and 2-image variants) registered and validated on rig.
- [x] `BookingDialog` image upload: media-typed exposed parameters render as drag-and-drop upload widgets; uploaded files land in `<comfy_root>/input/` with a `comfyq_session__` prefix and TTL sweep.
- [x] Worker `_materializeWorkflow` injects `paramValues` for image/video/audio fields into their nodes (was previously skipped, breaking image-edit submissions).


### M1+ — Admin UX & operations (delivered alongside M1)

Beyond the original M0/M1 scope, the following has been built so a teacher / lab admin can onboard a new workflow in under a minute:

- [x] **Workflow upload** (drag-and-drop API JSON) auto-scaffolds the meta.json by running the primitive-fallback parser and surfacing every detected widget.
- [x] **Workflow metadata editor** (`WorkflowMetaEditor` modal) — opens automatically after upload, also reachable from a per-card pencil button.
  - Edit name, description, category, author, version, estimatedDurationSec.
  - Per-parameter: toggle exposed, edit label, change type (text / textarea / number / select / checkbox / image / video / audio), edit default. Selects show a comma-separated options editor; numbers show min/max/step.
  - Bulk shortcuts: "Hide infrastructure" (auto-disables `unet_name`, `vae_name`, `clip_name*`, `weight_dtype`, `device`, `type`, `upscale_method`, `resolution_steps`, `megapixels`, `batch_size`), "Enable all", "Disable all", filter selector.
  - `PUT /admin/workflows/:id/meta` endpoint validates with the existing `WorkflowMeta` zod schema and forces `id` / `apiFormat` / `workflowFile` to canonical values.
  - `GET /admin/workflows/:id/edit-data` re-parses the api.json on read so the editor sees every primitive (including ones previously hidden) with their current enabled/label/default state merged in.
- [x] **Per-workflow card actions** in `WorkflowSelector`: hover-revealed Calibrate (gauge), Edit (pencil), Delete (trash). Delete is disabled on the active workflow.
- [x] **Delete workflow** (`DELETE /admin/workflows/:id`, gated, with confirmation modal). Refuses to delete the active workflow; rejects bad ids and path traversal.
- [x] **Emergency stop** (`POST /admin/emergency-stop`, gated). Cancels every scheduled job, marks every in-flight job FAILED with reason `emergency-stop`, REST-interrupts ComfyUI, kills the process if ComfyQ spawned it (external attached ComfyUI is left alone), flips to admin mode and restarts.
- [x] **Broken-workflow clutter hidden** — `GET /workflows` defaults to `includeUnavailable: false`; admin UI no longer renders a "Broken workflows" panel. Pass `?includeUnavailable=1` for diagnostics.
- [x] **Verbose terminal logging** during student-mode bootstrap and workflow activation (`[Admin] activate-workflow: A → B`, ComfyUI attach vs. spawn, WS connect, executor pickup, etc.).
- [x] **Verbose generation logging** — at job pickup the executor logs the resolved workflow name, exposed-parameter values (long strings truncated to 60 chars), and input filenames. During execution, throttled per-step progress lines (`step N/M, P% t=Xs node=…`, max once per 2s but always first/last) plus node transitions, and at completion: duration + per-output filenames and sizes. Failures log the truncated reason + phase + duration. Lives in [server/executor/jobExecutor.js](server/executor/jobExecutor.js).
- [x] **Validate ComfyUI paths in-place** — `POST /admin/check-paths` runs filesystem checks on a draft set of paths before the admin commits them: root_path is a directory containing `main.py`, `python_executable` exists and `--version` returns 0 within 5s (relative paths fall back to resolution against root_path), and `output_dir` exists & is writable. The admin UI shows per-row green/red rows with detail strings (e.g. the captured `Python 3.x.y` line, or `not found at <path> — is this really a ComfyUI directory?`).
- [x] **Workshop-rig defaults + Reset to defaults** — `defaultConfig()` ships with the canonical portable-ComfyUI paths (`D:\ComfyUI_windows_portable_nvidia\ComfyUI_windows_portable\…`) so a fresh clone on a classroom-cloned drive pre-fills the form. `GET /admin/default-paths` exposes the same constants so the admin UI can repopulate the form without reaching into config.
- [x] **Cancel running jobs** — the X button on a `processing` card emits `cancel_job` (distinct from `delete_job`), which routes through `executor.cancelJob` → `worker.cancel` → `rest.interrupt()`. The job lands in `cancelled` state; the record is preserved (not deleted). Backend handler in [server/realtime/realtimeBus.js](server/realtime/realtimeBus.js); UI hookup in [client/src/pages/Scheduler.jsx](client/src/pages/Scheduler.jsx) and [client/src/context/SocketContext.jsx](client/src/context/SocketContext.jsx).
- [x] **Hardened ComfyUI spawn** — [server/workers/comfyProcess.js](server/workers/comfyProcess.js) now matches the portable launcher exactly when `installation_type === 'portable'`: `python.exe -s main.py --windows-standalone-build --listen … --port … --disable-auto-launch`. Before spawn, the inherited env is sanitized: `PYTHONPATH`, `PYTHONHOME`, `PYTHONSTARTUP`, `VIRTUAL_ENV`, `CONDA_PREFIX`, `CONDA_DEFAULT_ENV`, `CONDA_PROMPT_MODIFIER`, `CONDA_SHLVL`, `CONDA_PYTHON_EXE` are deleted, and any `PATH` entry under the just-removed conda/venv prefix is dropped. Solves the "ComfyQ-spawned ComfyUI is 700× slower than standalone" class of bug where an active conda base shadowed the portable's CUDA torch with a CPU-only build. `--disable-auto-launch` suppresses ComfyUI's standalone-build browser pop-up. `--highvram` was deliberately removed: on a 24 GB card running a 23.8 GB diffusion model it forced full-load and thrashed against the text encoder.
- [x] **LAN-friendly boot log** — at server start, [server/index.js](server/index.js) enumerates `os.networkInterfaces()` IPv4 addresses and prints copy-paste-ready `http://<ip>:5173` URLs the admin can hand to students. Includes a one-liner reminding to allow Node through Windows Firewall on Private networks if a student gets a connection error. Also: fixed a hardcoded `http://localhost:3000` fallback in [client/src/components/admin/WorkflowUpload.jsx](client/src/components/admin/WorkflowUpload.jsx) that broke admin workflow uploads from remote machines.
- [x] **Cross-user delete/cancel gating** — [server/auth/authGate.js](server/auth/authGate.js) `isAuthorizedForJob` now refuses foreign actions outright when no admin password is configured (no silent "everyone is admin" mode), and requires a correct password when one is set. Wrong / missing password is rejected via `socket.emit('error', ...)`, which the client surfaces as a red toast.
- [x] **Clean all outputs** — `POST /admin/cleanup-outputs` ([server/routes/admin.js](server/routes/admin.js)), `adminGate`-gated. Walks every terminal job's `outputs[]`, deletes the underlying files via `resolveOutputPath`, then clears `outputs` in the DB. Skips in-flight jobs so a running output collector isn't yanked from under. Works in admin mode (opens the configured sqlite ad-hoc) and student mode (uses `runtime.queue`). Admin button + confirmation modal in [client/src/pages/AdminConfig.jsx](client/src/pages/AdminConfig.jsx).
- [x] **Calibration captures GPU** — `BenchmarkService.calibrate()` ([server/benchmark/benchmarkService.js](server/benchmark/benchmarkService.js)) now calls `/system_stats` after the run, normalizes the CUDA device name (`"cuda:0 NVIDIA GeForce RTX 5090"` → `"NVIDIA GeForce RTX 5090"`), and persists it as `runtime.gpu` in `<id>.runtime.json`. The registry exposes it through `summary.calibration = { durationSec, coldDurationSec, modelLoadSec, gpu, calibratedAt }`. The admin workflow card renders the GPU as a green chip next to the calibrated duration, with a tooltip explaining that moving to a different GPU should trigger re-calibration.
- [x] **Admin-panel auto-calibration, single timed run (2026-06-13)** — the per-workflow **gauge** button now works in **admin mode**, not just student mode. Admin mode previously wired the calibrate route to a stub (`Calibrate from student mode`); it now uses **`AdminCalibrator`** ([server/benchmark/adminCalibrator.js](server/benchmark/adminCalibrator.js)), which lazily spawns/attaches a `LocalComfyUIWorker` on the first calibrate, reuses it across calibrations, idle-frees VRAM after 10 min, and on SIGINT closes the WS while **leaving ComfyUI running** so a later activate attaches instantly. `BenchmarkService.calibrate()` does **one real run** (explicit `/free` first so models load) and splits it at the first sampler `progress` event: start→first-step = `modelLoadSec`, first-step→end = `estimatedDurationSec`/`warmDurationSec` (recurring cost → timeline), full wall time = `coldDurationSec` (first-run incl. load). **Cache-bust:** a naive second "warm" submission is NOT done — ComfyUI caches identical graphs and returns the cached result in ~1s (this was a real regression: TripoSplat reported 1s for a ~25s job). Instead `_randomizeSeeds()` bumps every literal `*seed` node field and `_buildCalibrationParams` randomizes every exposed seed param, so the single run always actually executes, even on re-calibration. Inputs auto-resolve from `config.assets.dir` (median image / smallest video / audio clip), staged + cleaned via the worker's `InputUploader`. **No UI, no uploads.** New config: `assets.dir` (schema + `defaultConfig` + `config.json`); preserved across admin Settings saves (the save route mutates only `comfy_ui.*`). **Student-mode caveat:** calibrate while the queue is idle — the live executor and calibration share the one worker (admin mode has no executor, so it's unaffected).
- [x] **Reorder + display-name editor for parameters** — [client/src/components/admin/WorkflowMetaEditor.jsx](client/src/components/admin/WorkflowMetaEditor.jsx) gains per-row ▲/▼ buttons to reorder parameters within the *visible* filter (so reordering inside "Only enabled" stays predictable). The persisted `order: i` from save logic now follows admin intent. The "Label" column is relabelled "Display name (shown to students)" for clarity; functionally unchanged. Each row gets an ordinal `#N` chip so the current position is obvious.
- [x] **nodemon restart fix** — `exitForRestart()` bumps the mtime of `server/index.js` so nodemon's chokidar watcher triggers a restart instead of parking in "clean exit — waiting for changes" forever.
- [x] **"Launch ComfyUI on the network" honors the saved path (2026-06-21)** — the admin *ComfyUI backend* card's launch button used the **boot-time** config snapshot (often the hardcoded `defaultConfig()` portable path), so a root/python path edited + saved in Settings just before was ignored. [AdminCalibrator](server/benchmark/adminCalibrator.js) — which owns that button via `runtime.comfyBackend` — was constructed once at boot with `comfyConfig: config.comfy_ui` and never refreshed. Fix: it now reads `comfy_ui`/`queue`/`assets` **fresh from `configManager`** on every use (getters instead of a snapshot — config.json is the single source of truth), **restarts a ComfyUI it owns when the saved paths change** (tracked via a `root|python|port` spawn signature; an externally-attached instance is left alone), and logs the path it boots with. [server/index.js](server/index.js) passes `configManager` instead of config slices; the client ([AdminConfig.jsx](client/src/pages/AdminConfig.jsx) `launchComfy`) also **PUTs the path form before launching** so unsaved form edits are honored too.
- [x] **Filter the workflow library by type (2026-06-21)** — the admin [WorkflowSelector.jsx](client/src/components/WorkflowSelector.jsx) replaced its raw-category dropdown with **filter chips over a user-facing group taxonomy**: **3D / Audio / Description / Image generation / Video generation / Utilities** (+ Other). A `CATEGORY_GROUP` map collapses the fine-grained meta categories into these buckets (`t2i`/`image-edit`→image, `i2v`→video, `i2i`+`preprocessor`→utilities — upscalers/segmentation/frame-interpolation/depth, `3d`/`audio`/`description` pass through); chips only render for groups that have a usable workflow, with counts. Added a new **`description`** category to the enum ([schemas.js](server/config/schemas.js)) + the meta editor `CATEGORIES` + the server `/workflows` label map, and **reclassified the two Gemma captioners `preprocessor`→`description`** so the "describe-it" tools group separately from utilities.
- [x] **Keyword search in the workflow library (2026-06-25)** — [WorkflowSelector.jsx](client/src/components/WorkflowSelector.jsx) gained a search box above the type chips. Multi-term **AND** match over name / description / tags / category / id; it runs **before** the group filter, so the chip counts (and the "All" count) reflect the current query and groups with no match drop out. A "no matches" empty state offers **Clear filters** (resets the query + group). `tags` is in the `/workflows` summary, so tag search works.
- [x] **Workflow-editor: parameter search + Open-in-ComfyUI + auto-start (2026-06-26)** — [WorkflowMetaEditor.jsx](client/src/components/admin/WorkflowMetaEditor.jsx): (1) a **parameter search** (multi-term AND over display name / key / field / node id / node title / class type / type) — vital on big graphs (the Bernini autoprompt surfaces 106 detected widgets); each row also shows the node's `_meta.title` (e.g. `node 117:54 · Custom Combo · choice`). The parser now emits `nodeTitle`/`classType` per detected param ([workflowParser.js](server/workflows/workflowParser.js)) — display/search only, stripped by zod on save. (2) **Open in ComfyUI** — auto-starts ComfyUI if down (POST `/admin/comfyui/launch`, which blocks until reachable) and opens its editor tab, + **Download JSON** (`edit-data` now returns `apiWorkflow`); tab+download fire synchronously in the click so they aren't popup-blocked, the tab is steered after launch. **ComfyUI only auto-imports API format via drag-drop** (`loadApiJson`) — the `?workflow=`/sidebar load paths feed litegraph `configure()` (UI format) and yield an empty graph for our API JSON — so it's a one-drag flow (true zero-drag needs a server-side API→UI converter via `/object_info`, deferred as version-fragile).
- [x] **Live student-form preview in the editor (2026-06-26)** — a **"Student preview"** toggle in [WorkflowMetaEditor.jsx](client/src/components/admin/WorkflowMetaEditor.jsx) renders the real booking form side-by-side, updating live as the admin edits labels/types/defaults/options/order/enable (modal widens to `max-w-7xl`). Powered by extracting the student field-rendering out of [BookingDialog.jsx](client/src/components/BookingDialog.jsx) into a shared [DynamicParamFields.jsx](client/src/components/DynamicParamFields.jsx) used by both — so the preview can't drift. The preview builds a `parameter_map` from the editor's unsaved params and uses throwaway local state (re-seeds only on structural/default changes, seeds preserved, media previews via `FileReader`). Also fixed `disabledWhen` preservation across edit/save (see the IC-LoRA row). Verified by an adversarial multi-agent pass (render fidelity / preview wiring / disabledWhen round-trip) — zero divergence.
- [x] **Friendlier ComfyUI failure messages (2026-06-26)** — [errorMessages.js](server/executor/errorMessages.js) `humanizeFailure(message, nodeType)` rewrites known failure signatures into actionable text (first case: a no-face failure on a face-cropper node → "upload a clear photo with a single, fully visible face"), applied at both error sites ([localComfyUIWorker.js](server/workers/localComfyUIWorker.js) WS `execution_error`, [jobExecutor.js](server/executor/jobExecutor.js) history fallback). Unmatched errors pass through verbatim; an OOM on a face node is *not* mislabeled as no-face. Add new mappings centrally.
- [x] **Drive-letter swap + ComfyUI path auto-detect (2026-06-24)** — workshop machines clone one drive image to different letters, so the ComfyUI paths constantly need re-pointing. Two ergonomics fixes: **(1) Drive letter** dropdown in ComfyUI Settings ([AdminConfig.jsx](client/src/pages/AdminConfig.jsx)) rewrites the drive on *every* absolute path at once (root / python / output / assets — `^[A-Za-z]:` swap; relative paths untouched), populated from mounted drives via `GET /admin/drives`. **(2) Auto-detect** — `configManager.detectComfyPaths()` ([configManager.js](server/config/configManager.js)) scans local drives for the portable layout (a dir with `main.py` + sibling `python_embeded\python.exe`; checks the standard candidates + a shallow `ComfyUI*` drive-root scan). It runs **on boot** ([index.js](server/index.js)) whenever the configured root has no `main.py` and adopts the found install (so `npm run dev` self-heals on a cloned/fresh drive — never overrides a *valid* config), and is also a manual **Auto-detect** button (`POST /admin/autodetect-paths`). Bounded, Windows-only.

### M1+ — Student UX (delivered alongside M1)

- [x] **Random seed by default.** Any exposed parameter named `seed` (or whose `field` is `seed`) gets a fresh random value each time the BookingDialog opens. Re-roll button (`Dices`) lets the user reroll without retyping; manual entry still works.
- [x] **Live-time timeline** — vis-timeline window is centered around `now()` with a sliding 10-min-before / 50-min-after window. "Following" toggle re-centers every 10 s. Auto-disables when the user pans manually; clicking "Now" re-engages.
- [x] **Active-workflow indicator** in the Scheduler header (uses `state.workflow_info` already on the wire).
- [x] **"Use these settings"** in the `ImageLightbox` — re-opens a fresh `BookingDialog` pre-filled with the job's prompt and parameters. **Updated 2026-06-24:** it now **reuses the media too**. The original uploads are still on disk (the periodic `sweepStale` only deletes the `comfyq__` execution-time prefix, not the `comfyq_session__` upload prefix), so the dialog re-binds the recalled filename directly (no re-upload — the materializer injects it) and **previews/plays it** via a new `GET /input-media/:filename` route ([uploads.js](server/routes/uploads.js), locked to the `comfyq_` prefix + pinned inside the input dir). The reused field shows a "↻ Reused" badge with Replace/Remove; a fresh upload overrides it.
- [x] **ASAP booking (2026-06-24)** — booking with **no slot picked** (the "Schedule a job" / "Use these settings" / "Book your first slot" entry points pass `scheduledTime: null`) now queues into the **earliest free slot** instead of being rejected on a collision. `realtimeBus.book_job` treats null-or-past time as ASAP → `jobQueue.nextFreeSlot(now, durationMs)` (greedy walk over active jobs); an explicit future time keeps the `findCollisions` guard. `findReady` gained a `created_at ASC` FIFO tiebreaker. The BookingDialog's "When to run" section is a visible **As soon as possible / Pick a time** segmented toggle (drives `scheduledTime` null ↔ timestamp).
- [x] **Copy-text on plain HTTP (2026-06-24)** — the caption-job "Copy text" button silently no-op'd on `http://<lan-ip>` (`navigator.clipboard` is undefined off a secure context). New [client/src/utils/clipboard.js](client/src/utils/clipboard.js) `copyToClipboard()` tries the async API, then falls back to a hidden-`<textarea>` + `execCommand('copy')`; the button shows a transient "Copied!".
- [x] **Light-theme contrast fixes (2026-06-24)** — the `--color-white → --text` compat remap (lets ~150 `text-white` usages survive light mode) renders `text-white`/`bg-white` on a **solid accent fill** dark-on-dark. Added a `--color-on-primary` token (light in both modes) applied to primary buttons, active tabs, the toggle knob, the lightbox splat/mesh toggle, and admin buttons; the text-caption lightbox panel now uses `bg-background`/`text-foreground` instead of a hardcoded black box.
- [x] **Per-job workflow chip** — every recent-generations card, MyJobs row, and lightbox now shows which workflow produced the image. Resolves `workflow_id → name` via a fetch-once map in `SocketContext`. Deleted workflows surface as "no longer in library".
- [x] **Delete completed images** — the delete button now also appears on completed/failed cards owned by the user. The server unlinks the actual output files on disk via `resolveOutputPath` before removing the DB row.
- [x] **Path-fix robustness** — config.json `root_path` validation now requires `<root>/main.py`. The portable-ComfyUI gotcha (`...\ComfyUI_windows_portable` vs. `...\ComfyUI_windows_portable\ComfyUI`) is documented in the troubleshooting section.
- [x] **My / All Jobs tabs** — `Recent Generations` in [client/src/pages/Scheduler.jsx](client/src/pages/Scheduler.jsx) gains a two-tab selector. Defaults to **My Generations** (filters to `state.jobs` where `user_id === username`). **All Jobs** unhides everyone, with a user-filter `<select>` showing each contributor + their job count. Timeline still shows every booked slot for collision avoidance. Sidebar `MyJobsPanel` is filtered to the current user only and retitled "My Generations".
- [x] **Cross-user delete with admin password** — the X button on a foreign job opens [client/src/components/ui/ConfirmDialog.jsx](client/src/components/ui/ConfirmDialog.jsx) with an admin-password input. Own jobs go through the same dialog without the password field. The `deleteJob` / `cancelJob` callbacks in `SocketContext` accept an optional password and emit it on the socket; rejected actions surface as red toasts via the new variant-aware [client/src/components/ui/Toast.jsx](client/src/components/ui/Toast.jsx).
- [x] **Notification system removed** — Browser Notifications API permission request + completed-job pop-ups removed from [client/src/context/SocketContext.jsx](client/src/context/SocketContext.jsx); the in-app "Job Completed! 🎨" toast is also gone. Toast infrastructure kept for the error-feedback path. Real-time job state updates still drive the cards.
- [x] **Active-workflow description on user UI** — the Scheduler header's "Active workflow" pill grew into a card containing the workflow description (whitespace-preserving), and the same block is mirrored at the top of `BookingDialog`. Description text comes from `state.workflow_info.description`, already on the wire — no schema change. Admins write prompting tips in the workflow editor's Description field and they appear immediately for students.
- [x] **Compact Live Schedule** — timeline container shrunk from `h-[300px]/h-[400px]` to `h-[180px]/h-[220px]` (mobile/desktop) and the block wrapper got `px-4 sm:px-12 lg:px-20` so the timeline sits inset from the page edges without bleeding into the rest of the layout.

### M2 — Phase 2 (job mgmt) + Phase 3 (real-time progress)  *(✅ COMPLETE — 2026-05-16)*

- [x] `MyJobs.jsx`: ~~deterministic user colors~~ ✅, ~~prompt search~~ ✅ (2026-05-15), ~~date filter~~ ✅ (2026-05-16), ~~CSV export from `/jobs?since=…&until=…`~~ ✅ (2026-05-16).
  - Colors: [client/src/utils/userColor.js](client/src/utils/userColor.js) — FNV-1a hash → 12-color palette. Applied to MyJobsPanel header, Scheduler grid user-chip, vis-timeline left-stripe + prefix label.
  - Prompt search: case-insensitive substring on `prompt` + `user_id` in the Scheduler grid (toolbar input, persists across My/All tab switch); prompt-only in MyJobsPanel sidebar. Timeline view is intentionally untouched — it's a schedule, not a results filter.
  - Date filter + CSV export: landed on the **Dashboard** (Session Dashboard is the natural home for historical queries), not the MyJobsPanel sidebar. Presets `All / Today / 24h / 7d / Custom`; custom uses two `<input type="date">` with local-tz day boundaries (`until` rolled to 23:59:59.999 so the picked date is inclusive). Filter narrows the visible table; the "Total Jobs" stat card relabels itself to "Jobs in [range]". CSV export hits `GET /jobs?since=&until=` directly so it returns the full DB (not the 500-job broadcast cap), applies the user filter client-side, then serializes RFC 4180-compliant CSV (`csvCell` quotes anything containing `,`, `"`, `\n`, or leading/trailing whitespace) and triggers a Blob download named `comfyq-jobs-<isoTimestamp>.csv`. Implementation in [client/src/pages/Dashboard.jsx](client/src/pages/Dashboard.jsx).
- [x] **Theme system — light + dark mode with grayscale palette** (2026-05-15). [client/src/context/ThemeContext.jsx](client/src/context/ThemeContext.jsx) drives the `.dark` / `.light` class on `<html>`; [client/src/components/ui/ThemeToggle.jsx](client/src/components/ui/ThemeToggle.jsx) is the sun/moon button mounted in StudentLayout nav + AdminConfig header. Persists to `localStorage.comfyq_theme`; first visit honors `prefers-color-scheme`. Indigo + purple chrome dropped in favor of sober zinc-grey neutrals; the per-user accent palette ([userColor.js](client/src/utils/userColor.js)) is kept since users need to be visually distinguishable. **Known v0 limitation:** ~150 hardcoded `text-white` / `text-slate-*` / `bg-white/N` references across components are pragma-overridden in [index.css](client/src/index.css) rather than refactored. Light mode may show contrast oddities on coloured buttons; full migration to `text-foreground` is follow-up.
- [x] **`ProgressViz` + `ETABadge` driven by `samplesPerSec` × steps remaining** (2026-05-16). Server side: [server/realtime/realtimeBus.js](server/realtime/realtimeBus.js) `workflow_info` broadcast extended with `samplesPerSec` and `estimatedDurationSec` (already on each registry summary, just wasn't on the wire); the wire-format comment block was updated to match reality — the stale `s_it` field was never set, so removed from both the comment and the two dead client references in MyJobsPanel + Scheduler. Sampler-progress wire data (`progress: {value, max}` + `current_node`) was already there. Client side: new [client/src/utils/jobEta.js](client/src/utils/jobEta.js) `computeEtaSeconds(job, workflowsById, activeWorkflowInfo)` helper prefers the live `workflow_info` (freshest after recalibration) and falls back to the mount-time `workflowsById` map for foreign-workflow jobs. New [client/src/components/ui/ETABadge.jsx](client/src/components/ui/ETABadge.jsx) renders `~Xs left` / `~Xm Ys left` / `finishing…` and returns null when no estimate is computable (uncalibrated workflow, non-processing job). New [client/src/components/ui/ProgressViz.jsx](client/src/components/ui/ProgressViz.jsx) is the unified progress block with `size='md' | 'sm'`, used by both [MyJobsPanel.jsx](client/src/components/MyJobsPanel.jsx) (sidebar) and [Scheduler.jsx](client/src/pages/Scheduler.jsx) (Recent Generations grid). Fallback chain when calibration is missing: full `estimatedDurationSec` interpolated by progress ratio. Uncalibrated workflows render no ETA — better silent than wrong.
- [x] AuthGate enforced on cross-user `delete_job` / `cancel_job` — landed alongside the admin-password gating UX. See `isAuthorizedForJob` in [server/auth/authGate.js](server/auth/authGate.js).
- [x] **Branding refresh — favicon + tab title + nav mark** (2026-05-15). Browser tab now reads `ComfyQ` ([client/index.html](client/index.html)). New SVG favicon ([client/public/favicon.svg](client/public/favicon.svg)) — ring on top, bold tilde-wave bar underneath as the Q's bar, on a sober zinc-800 rounded square. The inline mark in the StudentLayout nav uses the same geometry with `currentColor` strokes so it adapts to the active theme. Iterated through three designs: single diagonal tail (looked like a magnifier), doubled diagonal tail, asymmetric doubled tail, and finally the bold tilde wave that reads as "queue / flow / motion".
- [x] **"Session Dashboard" rename + nav admin link** (2026-05-15). The nav tab next to Timeline is now "Session Dashboard" (was "All Jobs"); the Dashboard page heading matches. A small Settings-icon button in the nav links to `/admin` — previously the only path was typing the URL ([App.jsx](client/src/App.jsx)).
- [x] **Prompt-display fix for non-`prompt`-keyed workflows** (2026-05-15). Workflows like LTX 2.3 i2v expose the user-visible text under keys like `positive_prompt` or `text`, not literally `prompt`. The old client only forwarded `finalParams.prompt`, so `job.prompt` was stored empty. Fixed both ways: (a) `pickHeadlinePrompt(finalParams, parameterMap)` in [BookingDialog.jsx](client/src/components/BookingDialog.jsx) chooses the right textarea field at submit time (skipping anything `negative*`); (b) `getDisplayPrompt(job)` in [client/src/utils/jobDisplay.js](client/src/utils/jobDisplay.js) mines `job.params` at render time so historical records display correctly without a DB backfill. Threaded through ImageLightbox, MyJobsPanel, Scheduler (grid + timeline + search), and Dashboard. **Bonus:** while in the timeline code, HTML-escaped the previously-unescaped `${job.prompt}` and `${shortId}` interpolations in vis-timeline `content` strings (XSS hole — any classmate's username/prompt containing HTML would have rendered on everyone's view).

### M4 — Phase 4 (media capture) (file upload + drag-and-drop ✅ · webcam REMOVED 2026-05-19)

> **2026-05-19 — webcam capture removed.** M4 originally aimed at in-browser webcam / `getUserMedia` capture. After the HTTPS revert (see below), the webcam path could no longer be given a secure context off-`localhost`, and the workshop didn't need it: image/video inputs are uploaded as files. The **Use camera** button, `CameraCaptureModal.jsx`, and the `getUserMedia` / `enumerateDevices` / `MediaRecorder` code were deleted. What remains and ships: `MediaCaptureField.jsx` — a file-upload widget (click-to-browse + drag-and-drop, with MIME filtering and a highlight-on-hover drop zone) plus client-side `maxInputEdge` resize. A phone's OS file picker still exposes "Take Photo", so camera input is available without any in-app webcam code. The historical design notes below are kept for context but no longer describe shipping behavior.

- [x] **File upload for image and video inputs** (the shipping M4 scope). `MediaCaptureField.jsx` renders the widget; click or drag-and-drop a file; images are downscaled to `maxInputEdge` before upload via `resizeImageFile()`. Routes through the existing `POST /upload` endpoint. The struck-through items below are the original webcam plan, kept as a record.
- [x] **Paint-a-mask input (`mask` param type, 2026-06-25)** — for inpainting workflows the user paints a mask in-browser instead of uploading one. New component [MaskDrawField.jsx](client/src/components/capture/MaskDrawField.jsx) (a sibling of `MediaCaptureField`, not a fork): upload a base image → brush over the region to replace (brush size / eraser / undo / clear / 5 colour swatches + a custom `<input type=color>`) → it composites `drawImage(base)` + `destination-out` mask strokes into an RGBA PNG where the painted area is **transparent**, then hands that File to the same `handleMediaChange`→`/upload` path. ComfyUI's `LoadImage` reads `MASK = 1 − alpha`, so one file feeds both the picture and the mask. New `mask` param type added to the zod `ParamType` enum + the duplicated `PARAM_TYPES` array in the meta editor (they aren't shared); treated as `image` for the required-media guard, `inferType`, `maxInputEdge`, and calibration (stages a plain image → empty mask → valid timing). Alpha is preserved end-to-end (no server re-encode; client `resizeImageFile` keeps PNG→PNG). Colour is cosmetic (export reads alpha only; recolour via `source-in`). Drove the two Flux.2 inpainting bundles below.
- [x] **Oversized-image guard (2026-06-10)** — a full-resolution phone photo was reaching ComfyUI and OOM-crashing the rig because the client `resizeImageFile()` *silently uploaded the original* whenever it couldn't process the file (HEIC/HEIF, decode/encode failure). Fixed as a layered guard: (a) `resizeImageFile()` now **throws `ImageProcessError`** (HEIC / decode / encode) instead of falling back to the raw original; (b) [MediaCaptureField.jsx](client/src/components/capture/MediaCaptureField.jsx) catches it and shows an inline error; (c) [BookingDialog.jsx](client/src/components/BookingDialog.jsx) checks `response.ok` on the submit-time upload and surfaces the server's rejection (it previously read `data.filename` off a failed response, submitting a job with a missing input); (d) **server backstop** in [server/routes/uploads.js](server/routes/uploads.js) — `inspectUpload()` rejects HEIC (extension **and** `ftyp` magic-byte sniff), images that don't fit a **1920×1080 box in either orientation** (long edge ≤ 1920 **and** short edge ≤ 1080) or are over **30 MB**, with a clear message, and the multer ceiling dropped 200 MB → **150 MB**. The client `resizeImageFile()` downscales to the same box (`DEFAULT_IMAGE_MAX_LONG`/`SHORT` in [MediaCaptureField.jsx](client/src/components/capture/MediaCaptureField.jsx)); a per-parameter `maxInputEdge` overrides it with a single square long-edge cap. Dimension detection uses **`image-size`** (pure-JS, no native dep — keeps `better-sqlite3` the only native dep). Per the owner's call oversized/HEIC are **rejected with a message**, not auto-downscaled server-side (sharp was declined — native dep, and it can't reliably decode HEIC anyway).
- [ ] ~~**In-browser camera capture for image and video inputs.**~~ **REMOVED 2026-05-19.** See [M4 design notes](#m4-design-notes--in-browser-camera-capture) below for the original strategy. Historical checklist:
  - [x] New `MediaCaptureField.jsx` augments `BookingDialog`'s existing image/video upload widgets without replacing them — drag-and-drop, file picker, and camera capture all coexist; the user picks per-field. No server-side changes; everything routes through the existing `POST /upload` endpoint.
  - [x] **Image capture path:** `getUserMedia({ video: true })` → live preview → snapshot to `<canvas>` → resize to per-workflow `maxInputEdge` (default 1024) → `canvas.toBlob('image/jpeg', 0.92)` → upload. Same upload contract as a drag-and-drop file; LoadImage node receives a familiar filename. (Initial constraint is the permissive `{ video: true }` — `facingMode` is only applied on explicit **Switch** because Chrome desktop throws `NotFoundError` for devices that don't advertise facing metadata.)
  - [ ] **Video capture path:** primary route on mobile is `<input type="file" accept="video/*" capture="environment">` which delegates to the OS camera app (returns native MP4 — no codec headaches). Desktop fallback uses `MediaRecorder` with WebM and is documented as best-effort. Server-side MP4 re-encode is deferred until ffmpeg becomes a dependency in M5.
  - [x] **Resolution policy:** added optional `maxInputEdge: number` to `ExposedParameter` (zod schema in [server/config/schemas.js](server/config/schemas.js)). Client downscales the longer edge to `maxInputEdge` before upload (preserving aspect ratio, never upscaling). Defaults: image 1024, video 1280; admin override per parameter in [WorkflowMetaEditor.jsx](client/src/components/admin/WorkflowMetaEditor.jsx).
  - [x] ~~**HTTPS in dev:**~~ **REVERTED 2026-05-19 — see below.** Originally Vite was served over HTTPS via `@vitejs/plugin-basic-ssl` so `getUserMedia` had a secure context on the LAN. A multi-student workshop test exposed the self-signed cert as unworkable: Safari and Chrome both balk, Safari refuses to extend a click-through to the websocket and to media downloads, and the ephemeral cert regenerates every boot. **The HTTPS layer was removed; ComfyQ now serves plain HTTP.** `@vitejs/plugin-basic-ssl` uninstalled, `https: true` dropped from [client/vite.config.js](client/vite.config.js). The Vite proxy stays (single-origin). The only feature lost is live in-browser webcam preview off-`localhost` — `canUseLiveCamera()` already detects the non-secure context and the **Use camera** button falls back to the native-camera file picker, which is the better mobile path anyway. See "Plain HTTP (workshop decision)" note under the M4 design notes.
  - [x] **Device picker:** when multiple cameras are present, **Switch** button in the modal cycles through `enumerateDevices()` video inputs; single-camera devices toggle `facingMode` between `user` and `environment` instead.


#### M4 design notes — in-browser camera capture

Working through the constraints carefully because the wrong API call here silently breaks a quarter of the classroom (iOS Safari, http LAN, multiple cameras, MediaRecorder codec drift). What follows is the strategy we're locking in before any code lands.

**Existing pipeline — must remain undisturbed.**
- `BookingDialog` already renders drag-and-drop / file-picker widgets for `image|video|audio` typed parameters, uploading via `POST /upload` (multer + namespacing → `<comfy_root>/input/comfyq_session__<ts>__<rand>__<orig>`), and injects the resulting filename into LoadImage / VHS_LoadVideo / LoadAudio nodes. M4 must **add** a capture entry-point next to the existing widgets; not replace anything. A user with a drag-and-drop habit keeps it.
- TTL sweep, retention, MediaStore extension classification — all unchanged. The captured frame becomes a `Blob` with a synthetic filename (`camera-<ts>.jpg` / `camera-<ts>.mp4`) and travels the same path.

**Image capture — universal path.**
```
getUserMedia({ video: { facingMode, width, height } })
  → stream into <video autoPlay playsInline muted>
  → user clicks "Capture"
  → drawImage(video, canvas) at native resolution
  → downscale canvas if maxEdge > maxInputEdge
  → canvas.toBlob('image/jpeg', 0.92)
  → reuse the existing upload code path
  → stop tracks (release the camera) immediately
```
Why JPEG: works on every browser, ~10× smaller than PNG, ComfyUI's LoadImage handles it fine for non-mask inputs. PNG is offered as a checkbox for users who need exact pixels (alpha, lossless edits — rare in a classroom).

**iOS Safari quirks to design around.**
- `getUserMedia` must be called inside a synchronous user-gesture handler (the "Open camera" button's onClick). Not in `useEffect` on mount.
- `<video>` element needs `playsInline` (without it, the live preview goes fullscreen and breaks the layout).
- `MediaRecorder` is supported in iOS 14.5+ but produces a `video/mp4;codecs=avc1` blob on most devices; older devices return `video/quicktime` or refuse. We never bet on this — phone video flows through `<input type="file" capture>` instead, which returns a native MP4 the OS already encoded.
- Secure context: iOS Safari **will not** prompt for camera on `http://192.168.x.x:5173`. The file-picker capture (`<input type="file" accept="image/*" capture="environment">`) is the universal fallback — it doesn't need permissions OR HTTPS, opens the OS camera, returns the photo as a normal File object. We treat it as the default mobile path and getUserMedia as a desktop-first feature with mobile-best-effort.

**Video capture — pragmatic split.**
- **Mobile (phone / tablet):** `<input type="file" accept="video/*" capture="environment">` always. The OS records, returns MP4/H.264, no encoding decisions to make. Drawback: no in-app preview, no re-record loop. Acceptable in v1.
- **Desktop:** `MediaRecorder` with `mimeType: 'video/webm;codecs=vp9'` (Chrome/Firefox/Edge desktop all handle this). User records for ≤ N seconds (configurable per workflow), then the resulting blob uploads as WebM. Some video workflows are happy with WebM (VHS_LoadVideo) — for workflows that strictly need MP4, document the limitation and route to file-picker.
- **Deferred to M5:** server-side ffmpeg re-encode from any browser-produced format to MP4. Means M4 doesn't need ffmpeg on the workshop rig (Python ComfyUI portable doesn't ship it).

**Resolution / resize policy.**
- New optional field in `ExposedParameter`: `maxInputEdge?: number`. When set, the client downscales the longer edge of the capture (or any upload, optionally) to that value before sending. Default falls back to a hard-coded 1024 for images / 1280 for video if unset.
- Always preserve aspect ratio. Never upscale (small phone photos pass through untouched).
- Resize happens on `<canvas>` with `imageSmoothingQuality: 'high'`. For video, we don't transcode — we let the user know the source resolution and warn if it's larger than the workflow expects.
- **Why client-side, not server-side**: LAN bandwidth (5G phone photos are 5-15 MB raw, 0.5-1 MB downscaled — 10× faster upload on a shared WiFi); and ComfyUI VRAM/time scales with input pixel count.

**Permissions UX.**
- "Open camera" button → calls `navigator.mediaDevices.getUserMedia(...)` inside that handler.
- On `NotAllowedError` / `SecurityError` → show a "couldn't access the camera — try the file picker instead" message with the `<input type="file" capture>` element ready to click.
- On `NotFoundError` (no camera at all) → hide the camera button, fall back to file picker silently.
- After capture/cancel: `stream.getTracks().forEach(t => t.stop())` so the camera indicator light goes off and battery / VRAM doesn't drain.

**Component layout.**
```
client/src/components/
└── capture/
    ├── MediaCaptureField.jsx    ← orchestrator; renders existing upload widget + camera button
    ├── CameraCapture.jsx        ← getUserMedia + canvas snapshot for images
    ├── VideoCapture.jsx         ← MediaRecorder for desktop video
    └── useCameraDevices.js      ← hook over enumerateDevices() for device picker
```
`MediaCaptureField` accepts the same props the current image/video inputs do (paramKey, accept, value, onChange) so it's a drop-in upgrade inside BookingDialog — the BookingDialog code only changes at the import site.

**Schema migration.**
- `maxInputEdge` is an optional field on `ExposedParameter`. Workflows without it default to the hard-coded fallback. **No breaking change.** Zod schema bumps from "no extra fields" to "ignore unknown" or explicitly accepts `maxInputEdge`. Existing `meta.json` files stay valid.
- Admin metadata editor adds a single number field next to the type dropdown when type is `image | video`. No editor for it on text/number/checkbox params.

**Backwards-compatibility checklist (must hold).**
- [ ] Existing drag-and-drop on desktop continues to work exactly as before.
- [ ] Existing file-picker continues to work.
- [ ] Existing recall-of-params from a completed job still re-uploads (camera shots aren't auto-recalled — same TTL story as today).
- [ ] Workflows with no `maxInputEdge` set in their meta use the same upload path; the hard-coded default is conservative enough that nothing currently working gets squeezed.
- [ ] Server side: no schema bump, no new endpoints, no new dependencies. The upload route remains the only entry point.

**Testing matrix.**
| Surface | Image capture | Video capture | Notes |
|---|---|---|---|
| Desktop Chrome / Edge | `getUserMedia` + canvas | `MediaRecorder` WebM | Primary dev surface |
| Desktop Firefox | `getUserMedia` + canvas | `MediaRecorder` WebM | VP9 supported |
| Desktop Safari | `getUserMedia` + canvas | `MediaRecorder` MP4 (best-effort) | Rare in classroom |
| Android Chrome | `getUserMedia` + canvas (if HTTPS) or file-picker | file-picker → native MP4 | Permission prompt OK |
| iOS Safari | file-picker (http blocks getUserMedia) | file-picker → native MP4 | The hardest case; works |

**Risks (additions to the list below).**
- Workshop rigs serve over http on LAN → mobile `getUserMedia` blocked → file-picker is the actual mobile path. Document prominently; consider `vite --https` with a self-signed cert as a later opt-in.
- Different MediaRecorder codecs across desktop browsers may produce blobs that some workflows reject. Mitigation: surface the source MIME type on the upload, warn the user if the workflow's known-accepted set doesn't include it.
- Aspect-ratio mismatch between captured frame and what the workflow's empty-latent expects can produce stretched outputs. Mitigation: when the workflow's exposed parameters include `width` / `height` widgets, auto-set them to the resized capture's dimensions on `onChange`.

**Phased delivery (under M4 milestone).**
1. **M4-1** ✅ — File-picker capture for image (with `accept="image/*" capture="environment"`) + canvas resize + `maxInputEdge` schema field. Ships value on every device immediately. **No `getUserMedia` yet.**
2. **M4-2** ✅ **VERIFIED 2026-05-15 — but LAN HTTPS REVERTED 2026-05-19.** `getUserMedia` image capture with live-preview snapshot UX (retake / device-switch) still ships and works on `localhost`. The HTTPS dev server that made it work *off*-`localhost` was removed after the workshop test — see "Plain HTTP (workshop decision)" below. Off-`localhost`, the camera button now uses the native-camera file picker. **Lesson learned (still valid):** initial `getUserMedia` constraint must be the permissive `{ video: true }`; passing `facingMode: 'user'` on first request causes Chrome on desktop Windows to throw `NotFoundError` when the connected camera doesn't report facing metadata. `facingMode` is only applied when the user explicitly clicks **Switch**.
3. **M4-3** — *Deferred.* File-picker capture for video on mobile (`accept="video/*" capture="environment"`). Already wired in `MediaCaptureField` for the video param type; deferred because (a) no urgent workshop need and (b) verification requires a phone test session. Pick up when a target workflow actually needs phone-recorded video input.
4. **M4-4** — `MediaRecorder` video capture for desktop. Best-effort. Documented limitation list.

**HTTPS in dev (added with M4-2, REVERTED 2026-05-19).** M4-2 served Vite over HTTPS via `@vitejs/plugin-basic-ssl` so `getUserMedia` had a secure context on the LAN. This was reverted after a real multi-student workshop test — see "Plain HTTP (workshop decision, 2026-05-19)" below.

**Plain HTTP (workshop decision, 2026-05-19).** The first large-class test exposed the self-signed cert as a hard blocker, not a one-time annoyance:
- Safari and Chrome both warn; **Safari** in particular won't extend a click-through to sub-resources — the `wss://` websocket and media **downloads** silently fail even after the page "loads".
- `@vitejs/plugin-basic-ssl` regenerates an ephemeral cert every boot, so a device that accepted it once is back to a warning next session.
- Self-signed certs fundamentally cannot be trusted across BYOD Safari + Chrome + mobile without installing a CA root on every device — not feasible for a workshop.

**Resolution: drop HTTPS, serve plain HTTP.** `@vitejs/plugin-basic-ssl` uninstalled; `https: true` removed from [client/vite.config.js](client/vite.config.js). The Vite proxy stays — every backend route (`/admin`, `/workflows`, `/jobs`, `/upload`, `/media`, `/images`, `/download`, `/socket.io`) still proxies to Express on `http://localhost:3000`, so the page remains single-origin. Downloads, uploads, the websocket, and the timeline now behave identically on Safari, Chrome, and phones with zero cert friction. `SERVER_URL` is still empty → relative URLs → proxy handles it.

**Cost of the revert:** live in-browser webcam preview (`getUserMedia`) needs a secure context, which plain HTTP only provides on `localhost`. Off-`localhost` the **Use camera** button falls back to the native-camera file picker (`<input type="file" capture="environment">`) — which on phones opens the OS camera and is the better mobile UX regardless. `canUseLiveCamera()` in [MediaCaptureField.jsx](client/src/components/capture/MediaCaptureField.jsx) detects `window.isSecureContext` and picks the path automatically; no hard error. Net effect: the admin on the rig (`localhost`) keeps live preview; students on the LAN get the native camera app. If true cross-device live webcam is ever needed, the realistic paths are mkcert (install a CA on each device) or a cloud tunnel with a valid cert — both were considered and rejected for workshop ergonomics.

**Admin-route proxy bypass (regression fix, 2026-05-15).** The `/admin` prefix is overloaded — the React SPA owns the bare path (`http://localhost:5173/admin`), the Express backend owns every sub-path (`/admin/mode`, `/admin/config`, `/admin/cleanup-outputs`, …). Without a bypass, Vite proxied the bare path to Express, which has no handler for it → 404 and a blank page. Fix in [client/vite.config.js](client/vite.config.js): a `bypass(req)` hook on the `/admin` proxy entry that returns `/index.html` when `req.url` is exactly `/admin` (or `/admin?…` / `/admin#…`), letting the SPA take over. Every `/admin/<sub>` still proxies normally. If you add a new top-level path that's shared between SPA and API, replicate the same bypass pattern.

This split keeps each step shippable and reversible — if `MediaRecorder` codec issues prove hairy on the workshop hardware, M4-4 can defer indefinitely without blocking the mobile camera flow that actually serves students.

### Target workflows — primitive-fallback parser exercised against real workshop workflows

Catch-all for **workflow registrations and the infra each one stresses**. Each target workflow gets a row; the work is "upload, calibrate, smoke-test, fix anything the registry/parser/MediaStore can't handle without per-workflow code." If the primitive-fallback parser is doing its job, most rows should be zero-code.

Active queue (re-prioritized 2026-06-08, in rough priority order):

- [x] **TripoSplat (image → Gaussian splat)** — *supersedes the dropped Hunyuan3D row.* **DONE — verified on rig 2026-06-10.** Registered as a workflow bundle at [workflows/3d_triposplat_image_to_gaussian_splat/](workflows/3d_triposplat_image_to_gaussian_splat/) (raw export kept at [workflows/exported_api_workflow_comfy/3d_triposplat_image_to_gaussian_splat_api.json](workflows/exported_api_workflow_comfy/3d_triposplat_image_to_gaussian_splat_api.json)). The bundle's api.json **drops the video chain** (`CreateVideo`/`SaveVideo`/`RenderSplat`/`CreateCameraInfo` removed — orbit video not wanted) and **adds a second `SplatToFile3D` in `.ply`** alongside the exported `.spz`, so the three exports are `.spz` + `.ply` + `.glb` (mesh). The earlier `SaveGLB`-collapses-formats worry was **checked on the rig: distinct `.spz`/`.ply`/`.glb` land correctly**, no save-node swap needed. Delivered: the **Gaussian-splat viewer** (`SplatViewer.jsx`, Spark — see infra above), the `ImageLightbox` **3D gallery** (Splat⇄Mesh toggle + three export buttons), the `splat` media kind, the GLB-preferred thumbnail, and a user-facing **"Auto-remove background" checkbox** (node `88:35.switch`) — which added the first `checkbox`-type param renderer to [BookingDialog.jsx](client/src/components/BookingDialog.jsx). Calibration uses the built-in reference PNG (image input). **SplatViewer controls note:** it runs a continuous `setAnimationLoop` (not render-on-demand) — Spark sorts splats asynchronously, so an on-demand redraw left wheel-zoom and right-click-pan looking frozen; a steady loop is Spark's documented pattern and cheap since the viewer only mounts in the lightbox. **Pointer-events fix (2026-06-17):** that same canvas wrapper (in **both** SplatViewer and ModelViewer) was `stopPropagation`-ing every pointer/wheel event to keep a tap from bubbling to the parent card's open-lightbox `onClick` — which also swallowed the `pointerup` OrbitControls binds on the canvas's `ownerDocument` (React delegates events at the root container, above the wrapper, so the native `pointerup` never reached `document`). The drag therefore never released — `state` stuck off-`NONE` — so rotate/pan got stuck *and* wheel-zoom stopped working (`onMouseWheel` early-returns while `state !== NONE`). Fixed by stopping **only** `onClick`; a real drag emits no click, so the parent handler still never fires on a drag.
- [~] **Qwen image-to-multiview (multiple scene angles)** — **registered 2026-06-11; pending rig smoke-test.** Bundle at [workflows/image_qwen_multiple_angles/](workflows/image_qwen_multiple_angles/) (raw export: [workflows/exported_api_workflow_comfy/templates-1_click_multiple_scene_angles-v1.0_api.json](workflows/exported_api_workflow_comfy/templates-1_click_multiple_scene_angles-v1.0_api.json)). One scene image → **8 `SaveImage` outputs** (close-up / wide / 45° & 90° L+R / aerial / low-angle), each a separate Qwen-Image-Edit 2509 branch (multiple-angles + Lightning-4step LoRAs) with a fixed camera-angle prompt. Truly **1-click**: the only exposed param is the scene image (the 8 angle prompts stay fixed; seeds hardcoded → deterministic per image). **Pruned the 8 `PreviewImage` nodes** (temp duplicates that would have doubled the gallery to 16). Built the **N-image gallery**: [client/src/components/ui/ImageGallery.jsx](client/src/components/ui/ImageGallery.jsx) — main image + prev/next + `k/N` counter + per-view label (derived from the `ComfyUI-<angle>` filename prefix) + thumbnail strip + per-image and "Download all" buttons; wired into [ImageLightbox.jsx](client/src/components/ImageLightbox.jsx) for any job with >1 image output, plus a "{N} views" badge on the Scheduler grid card.
- [~] **Audio — Stable Audio 3 Medium (text → audio)** — **registered 2026-06-11; pending rig smoke-test.** Bundle at [workflows/audio_stable_audio_3_medium/](workflows/audio_stable_audio_3_medium/) (raw export: [workflows/exported_api_workflow_comfy/audio_stable_audio_3_medium_api.json](workflows/exported_api_workflow_comfy/audio_stable_audio_3_medium_api.json)). Output `.mp3` via `SaveAudioMP3`. Unlike Ideogram, the magic-prompt LLM (`TextGenerate` node, local qwen3.5) is **in-graph and automated** — a `ComfySwitchNode` (52:34/52:35) toggles between the user's raw text and the LLM-expanded prompt for the chosen category (Music/Instrument/SFX/One-shot system prompts baked into the graph). **Zero pruning** — every node is load-bearing. Exposed: Description (textarea), Category (select), **Enhance prompt with AI** (checkbox → the reprompt switch), Duration (s), Steps, Seed. Built the missing **audio player**: [client/src/components/ui/AudioPlayer.jsx](client/src/components/ui/AudioPlayer.jsx) (styled `<audio controls>` + Music icon, compact for cards), wired into `MediaPreview` (grid/sidebar) and the `ImageLightbox` gallery; `isAudio` added to [client/src/utils/api.js](client/src/utils/api.js). **Subfolder-serving fix** (general): `SaveAudioMP3` writes to an `audio/` subfolder, which previously wouldn't serve (the media route resolves by basename from the output root) — [server/executor/jobExecutor.js](server/executor/jobExecutor.js) now folds the ComfyUI subfolder into the wire `filename` (output-root-relative, e.g. `audio/track.mp3`) and empties `subfolder` so `resolveOutputPath` doesn't double-join; non-subfolder outputs are byte-identical. **Audio INPUT still missing** (no `inputUploader` audio kind / `MediaCaptureField` audio type) — not needed by this text→audio workflow; revisit if an audio-conditioned workflow (ACE) lands.
- [~] **Ideogram 4.0 t2i + prompt builder** — **registered 2026-06-10; pending rig smoke-test.** Bundle at [workflows/image_ideogram4_t2i/](workflows/image_ideogram4_t2i/) (raw export: [workflows/exported_api_workflow_comfy/image_ideogram4_t2i.json](workflows/exported_api_workflow_comfy/image_ideogram4_t2i.json)). The exported graph had **two disconnected islands**: the generator (driven by a hardcoded structured-JSON "caption" in `CLIPTextEncode` 98:24) and a *separate* magic-prompt builder (`134:*` system-prompt + natural-language idea → `PreviewAny`) that doesn't touch the image — it's a manual two-step (run → copy assembled prompt to an external LLM → paste JSON back → run). Per the owner's call we ship the **single-run structured-JSON path**: the `134:*`/`PreviewAny` helper island is **pruned** (39→29 nodes), and node 98:24's structured JSON is exposed as the editable prompt (default = the COMFY skateboarder example). Also exposed: aspect ratio (`ResolutionSelector` 37), megapixels, quality preset (`CustomCombo` 98:156 = Turbo/Default/Quality), CFG, seed. **Zero new code** — standard t2i (SaveImage → image output) the existing infra already renders. **Rig check:** the `aspect_ratio` combo options are best-guess (the exact `ResolutionSelector` label set couldn't be confirmed off-rig); the default `"9:16 (Portrait Widescreen)"` is known-good, but verify/adjust the other option strings against the node's dropdown in the WorkflowMetaEditor — a wrong label fails only that pick, not the default.

- [x] **Wan 2.1 360° rotate LoRA (image → video)** — *this is the "360 video LoRA" item from the original target list.* Registered at [workflows/video_wan_rotate_lora/](workflows/video_wan_rotate_lora/) (raw export: [workflows/exported_api_workflow_comfy/VID_Wan_rotate_lora.json](workflows/exported_api_workflow_comfy/VID_Wan_rotate_lora.json)). **Zero-code** — the image→video infra built for LTX i2v (image input, `VHS_VideoCombine` `.mp4` output + video player, calibration via the built-in reference PNG) covered it with no new components or server changes; only the exported `VHS_VideoCombine` `filename_prefix` was tidied (`AnimateDiff` → `video/Wan_rotate`). Exposes image / prompt / negative / seed / steps / length(frames) / playback-fps; width/height/LoRA-strength left hidden (fixed 512², avoids student OOM). **LoRA-trigger gotcha (documented in the workflow description):** the positive prompt must keep `r0t4tion` + "360 degrees rotation" — the odd spelling is the trained trigger token. Per the owner's call the prompt is exposed **as-is** (building-example default) so students fully edit it; the description warns to keep the trigger.

- [x] **LTX 2.3 first-&-last-frame → video with audio (FLF2V)** — *covers the "LTX 2.3 video-from-reference" + "LTX audio-driven" backlog items in one.* Registered at [workflows/video_ltx2_3_flf2v/](workflows/video_ltx2_3_flf2v/) (raw export: [workflows/exported_api_workflow_comfy/video_ltx2_3_flf2v_api.json](workflows/exported_api_workflow_comfy/video_ltx2_3_flf2v_api.json)). **Zero-code** — two image inputs (first frame + last frame), a single `.mp4` with an embedded audio track (`SaveVideo` → `video/` subfolder; the `<video>` element plays the audio natively, the subfolder-serving fix already covers it). Exposed: First frame / Last frame / Prompt (motion + music — LTX 2.3 generates video *and* audio from the prompt) / Negative / Duration / Frame rate / Seed; width/height left fixed at 1280×720 (both frames are auto-resized). Calibration uses the built-in reference PNG for both image inputs. **Note:** this is the first multi-image-INPUT workflow to register — confirm on the rig that calibration injects the reference PNG for *both* image params.

- [x] **LTX 2.3 IC-LoRA video-to-video (depth + audio)** — *covers the "depth preprocessor" target + a video-to-video case in one.* Registered at [workflows/video_ltx2_3_ic_lora_vid2vid/](workflows/video_ltx2_3_ic_lora_vid2vid/) (raw export: [workflows/exported_api_workflow_comfy/video_ltx2_3_ic_lora_api_vid2vid.json](workflows/exported_api_workflow_comfy/video_ltx2_3_ic_lora_api_vid2vid.json)). Source video → MoGe depth → IC-LoRA control → LTX 2.3 restyle + audio, guided by a reference image. **First video-INPUT workflow** (`LoadVideo` → `MediaCaptureField` video upload, materializer injects `199.file`); confirms the video-upload path end-to-end. Exposed: source video / reference image / enhance toggle / two prompt boxes / clip length / seed. **New generic feature: `disabledWhen`** — an optional `{ param, equals }` on an `ExposedParameter` ([schemas.js](server/config/schemas.js)) that renders a field **greyed-out** in [BookingDialog.jsx](client/src/components/BookingDialog.jsx) while another param holds a value. Used here for the two either/or prompt boxes gated by the "Enhance prompt with AI" toggle (the export's raw and LLM-input prompts live in *separate* fields, so a single box couldn't drive both — per the owner's call we expose both and grey the inactive one). Flows through `_buildParameterMap` + `toParameterMap`. **Caveats:** (a) ~~the video input has no calibration auto-sample~~ — **resolved 2026-06-13**: the video (and the reference image) now auto-resolve from `config.assets.dir`, so this calibrates one-click from the admin panel; (b) ~~an admin re-save of this workflow would drop `disabledWhen`~~ — **resolved 2026-06-26**: `edit-data` returns `disabledWhen` and the editor's save payload re-sends it, so a re-save preserves the gating (there's still no UI to *edit* `disabledWhen`, but it round-trips untouched and the editor's Student preview honors it).

- [x] **LTX 2.3 ID-LoRA image + audio → talking video (lip-sync)** — *was at `workflows/video_ltx2_3_id_lora_img_audio2vid/` (raw export still at [video_ltx2_3_id_lora_api_img+audio2vid.json](workflows/exported_api_workflow_comfy/video_ltx2_3_id_lora_api_img+audio2vid.json)).* **Removed 2026-06-26 at the owner's request** (its IC-LoRA / non-identity sibling [video_ltx2_3_ia2v_iclora](workflows/video_ltx2_3_ia2v_iclora/) covers the image+audio→talking-video case). Kept here as a record: it was the **first audio-INPUT workflow** — it drove the `MediaCaptureField` `audio` type (client-only; the server already supported it), which all later audio workflows reuse. Character image + reference audio (`LoadAudio`) → lip-synced talking video with identity preserved (ID-LoRA talkvid); tagged prompt ([VISUAL]/[SPEECH]/[SOUNDS]); audio input auto-resolved from `config.assets.dir` for calibration.

- [x] **LivePortrait — portrait image + driving video → animated talking-head video** — *off-queue addition (a face-reenactment workflow the owner dropped in).* **DONE — verified on rig 2026-06-15.** Registered at [workflows/video_liveportrait_image2video/](workflows/video_liveportrait_image2video/) (raw export: [workflows/exported_api_workflow_comfy/VID_liveportrait_image_example_01_api.json](workflows/exported_api_workflow_comfy/VID_liveportrait_image_example_01_api.json)). A still portrait + a driving face video → an animated (silent) video that copies the driving head pose and eye/lip motion (LivePortraitKJ). **Zero new code** on two fronts: (1) **first image-INPUT + video-INPUT combo** — the generic materializer injects both `196.image` (`LoadImage`) and `8.video` (`VHS_LoadVideo`) with no special handling; (2) **first `VHS_VideoCombine` output node** (the LTX rows all use core `SaveVideo`) — the generic output collector already walks VHS's `gifs` array and `filename_prefix` auto-injection namespaces the file, so the only behavioural change was flipping the export's `save_output: false → true` so the mp4 lands in the durable output dir instead of ComfyUI `temp/` (cleared on restart). **Graph cleanup:** the raw export shipped with a dead branch; the registered bundle is pruned to the 14-node live execution path — removed `MaskPreview+` (an OUTPUT_NODE that would have dropped a stray mask image into the job gallery), a disconnected `LivePortraitRetargeting` + duplicate driving-video `LivePortraitCropper` pair, the unused InsightFace cropper loader (only the MediaPipe cropper `198` is actually wired), and a dead `GetImageSizeAndCount` tap. (ComfyUI prunes unreachable non-output nodes at runtime anyway, so this is tidiness + avoiding one unused model download.) Exposed: portrait image / driving video / **max driving frames** (`8.frame_load_cap`, default 128 — caps runtime and output length). **Calibration caveat:** unlike the diffusion rows, LivePortrait is *deterministic* (no sampler seed), so the auto-gauge's seed-randomization can't defeat ComfyUI's result cache on re-calibration (reports ~1s); and both inputs must contain a **face** or the cropper errors, which the generic asset auto-resolver (median image / smallest video) can't guarantee — so calibrate via a real booked run, not the admin gauge. **No-face error (2026-06-26):** a faceless image used to fail with a raw `LivePortraitCropper` exception; `humanizeFailure` (see the Admin-UX error-message item) now turns that into "No face was detected — upload a clear photo with a single, fully visible face."

- [x] **SAM3 — text-prompted video segmentation (utility / matte)** — *off-queue addition.* **DONE — verified on rig 2026-06-16.** Registered at [workflows/utility_video_segment_sam3/](workflows/utility_video_segment_sam3/) (raw export: [workflows/exported_api_workflow_comfy/utility_video_segment_sam3_api.json](workflows/exported_api_workflow_comfy/utility_video_segment_sam3_api.json)). Source video + a concept name (`SAM3_Detect`, open-vocabulary Segment Anything 3) → a black-and-white **mask video** (`MaskToImage`→`CreateVideo`→`SaveVideo`), frames 1:1 with the source, usable as a luma matte. **First `preprocessor`-category workflow** — confirmed the client renders it (WorkflowSelector maps `preprocessor`→`Box` icon, the MetaEditor dropdown has the "Preprocessor" label, and unknown categories already fall back to `LayoutGrid`), so no client change was needed. **Zero new code** — reuses the core `LoadVideo`.`file` video-input path (same materializer route as the IC-LoRA `199.file`) and the `SaveVideo`→`video/` subfolder-serving output. **Graph cleanup:** pruned the one dead node, a `MaskPreview` (OUTPUT_NODE → would have added a stray mask image to the gallery), leaving an 8-node graph all reachable from `SaveVideo`. Exposed: source video / what-to-segment (text, default "person") / detection threshold (0.1–0.9, default 0.5). **Calibration caveat:** deterministic (no sampler seed) so the auto-gauge can't beat ComfyUI's result cache on re-calibration (~1s) — calibrate via a real run; if the named concept isn't in the clip the mask is simply empty (black), not an error.

- [x] **Video frame interpolation (FILM) — utility (smoother / slow-motion)** — *off-queue addition.* **DONE — verified on rig 2026-06-17.** Registered at [workflows/utility_video_frame_interpolation/](workflows/utility_video_frame_interpolation/) (raw export: [workflows/exported_api_workflow_comfy/utility_video_frame_interpolation_api.json](workflows/exported_api_workflow_comfy/utility_video_frame_interpolation_api.json)). Source video → `FrameInterpolate` (FILM `film_net_fp16`) inserts in-between frames, multiplying the frame count by N (`PrimitiveInt`, default 2) → `CreateVideo`→`SaveVideo`. A `ComfySwitchNode` + `ComfyMathExpression` (`min(abs(mult),16)*src_fps`) sets the output fps: **on** → fps is multiplied (same playback speed, smoother), **off** → fps stays at source (the extra frames stretch the clip into **slow motion**). Second `preprocessor`-category utility (after SAM3). **Zero new code and zero graph edits** — the export was already clean (10 nodes, all reachable from `SaveVideo`, no preview/dead nodes), so the registered api.json is verbatim; reuses the core `LoadVideo`.`file` input, the `SaveVideo`→`video/` subfolder-serving output, and the existing `checkbox` param type (first added for TripoSplat) — here it drives a `PrimitiveBoolean` rather than a node-internal `switch`. Exposed: source video / frame multiplier (number 2–8, default 2) / "keep real-time speed" (checkbox, default on). Source audio is carried through `CreateVideo` (`16:3` audio slot) — in sync in real-time mode, ends early in slow-mo (documented in the description). **Calibration:** robust — any video calibrates end-to-end (no face/concept requirement, unlike LivePortrait/SAM3) — but deterministic (no sampler seed), so re-calibration is cache-prone; calibrate via a real run, and note runtime scales with clip length × multiplier (multiplier capped at 8 to bound it).

- [x] **SeedVR2 super-resolution — image→4K and video→HD upscalers** — *off-queue pair.* **DONE — both verified on rig 2026-06-17.** Registered at [workflows/image_seedvr2_4k_upscale/](workflows/image_seedvr2_4k_upscale/) (`i2i`, 7B DiT; raw export: [SeedVR2_4K_image_upscale_api.json](workflows/exported_api_workflow_comfy/SeedVR2_4K_image_upscale_api.json)) and [workflows/video_seedvr2_hd_upscale/](workflows/video_seedvr2_hd_upscale/) (`preprocessor`, 3B DiT; raw export: [SeedVR2_HD_video_upscale_api.json](workflows/exported_api_workflow_comfy/SeedVR2_HD_video_upscale_api.json)). Diffusion-based super-resolution (`SeedVR2VideoUpscaler`) that rebuilds detail rather than sharpening; the video bundle re-assembles frames with the source fps + audio (`GetVideoComponents`→`CreateVideo`). **First `i2i`-category workflow** — client already supported it (the MetaEditor `CATEGORIES` has "Image to Image"; WorkflowSelector maps `i2i`→`Image` icon). **Zero new code and verbatim graphs** — both exports were already clean (6 and 7 nodes, all reachable from the save node, no preview/dead nodes); reuse the existing `LoadImage`/`LoadVideo`.`file` inputs and `SaveImage`/`SaveVideo` outputs. The single `SeedVR2VideoUpscaler` node serves both image and video — an image is just a 1-frame batch. Exposed per bundle: input / target resolution (`10.resolution`, default 4096 image / 1080 video) / seed (`10.seed`). **Calibration:** unlike SAM3/FILM these carry a real diffusion seed, so the gauge's seed-randomization defeats ComfyUI's cache → they calibrate cleanly even on re-calibration (image input auto-resolves from assets, video picks the smallest asset). Both are heavy/slow — `maxRuntimeSec` set high (image 1200s, video 3600s) so a long upscale isn't killed mid-run; calibration replaces the rough duration estimates. Models: `seedvr2_ema_7b_sharp_fp16` (image) / `seedvr2_ema_3b_fp16` (video) + shared `ema_vae_fp16`.

- [x] **Gemma 4 "describe it" — image→text and video→text captioners (LLM / vision-language)** — *off-queue pair; the first **text-output** workflows.* Registered at [workflows/llm_gemma4_image_description/](workflows/llm_gemma4_image_description/) (image → caption; raw export: [llm_gemma4_image_description_api.json](workflows/exported_api_workflow_comfy/llm_gemma4_image_description_api.json)) and [workflows/llm_gemma4_video_description/](workflows/llm_gemma4_video_description/) (video → caption; raw export: [llm_gemma4_text_gen_video_description_api.json](workflows/exported_api_workflow_comfy/llm_gemma4_text_gen_video_description_api.json)). Gemma 4 (`gemma4_e4b_it_fp8_scaled.safetensors` loaded via `CLIPLoader`, run by `TextGenerate`) reads the input and writes a description; a `PreviewAny` "Preview as Text" node surfaces it. **The result is text, not a file** — the image variant drove the generic **text-output path**: [outputCollector.js](server/executor/outputCollector.js) `_collectText` collects a node's `text`/`string` UI array as a `kind:'text'` output carried **inline on the wire** (no file), [jobExecutor.js](server/executor/jobExecutor.js) forwards `o.text`, and [ImageLightbox.jsx](client/src/components/ImageLightbox.jsx) + [MediaPreview.jsx](client/src/components/ui/MediaPreview.jsx) render the caption (commit "support text-output jobs"). Categorised under the **`description`** type — a category added this session (enum + meta editor + server label map); these were briefly `preprocessor` before the "describe-it" bucket existed (see the "Filter the workflow library by type" admin item above). **Video variant verified on rig (2026-06-21).** The **image** variant is a 4-node verbatim graph (`LoadImage`→`TextGenerate`→`PreviewAny`, + `CLIPLoader`). The **video** variant (zero-code) is the first `LoadVideo`→`GetVideoComponents`→`TextGenerate` chain — the VLM is fed the decoded frames; its export shipped two **disconnected** loaders (`LoadImage` "thmupnail2.jpg" + `LoadAudio` "voice_demo.mp3") which were **pruned**, else the parser would surface phantom image+audio upload widgets and the calibrator's asset resolver would demand an image *and* audio the graph never uses — the pruned bundle is the 5-node live path, all reachable from `PreviewAny`. Each exposes source (image/video) / instruction (textarea, default "Describe the image,"/"Describe the video") / seed. **Calibration:** unlike SAM3/FILM these carry a real LLM sampler seed (`sampling_mode.seed` — a dotted *flat* input key the materializer injects literally, `node.inputs["sampling_mode.seed"] = v`), so the gauge's seed-randomization defeats ComfyUI's result cache → both calibrate cleanly even on re-calibration (image input auto-resolves from assets; video picks the smallest asset). **Video caveat:** `GetVideoComponents` feeds *every* frame to Gemma, so long/high-res clips are slow and memory-heavy (the example export is a UHD source) — `maxRuntimeSec` set to 600 and the description tells students to keep clips short; if it's too heavy on the rig the fix is a frame-sample/resize node in the ComfyUI graph (a graph edit), not server code.

- [x] **Wan 2.2 Bernini-R video editing — text-only + reference-image (vid2vid)** — *off-queue pair.* **Both verified on rig (2026-06-21).** Registered at [workflows/video_bernini_r_video_editing/](workflows/video_bernini_r_video_editing/) (no reference; raw export: [video_bernini_r_video_editing_api.json](workflows/exported_api_workflow_comfy/video_bernini_r_video_editing_api.json)) and [workflows/video_bernini_r_video_editing_with_reference/](workflows/video_bernini_r_video_editing_with_reference/) (reference image; raw export: [Video_Bernini_video_edit_with_image_reference_api.json](workflows/exported_api_workflow_comfy/Video_Bernini_video_edit_with_image_reference_api.json)). **One unified Bernini-R graph in two configs** — the only structural difference is whether the `104 LoadImage`→`100 BatchImagesNode`→`76:50 BerniniConditioning.reference_images.reference_image_0` path is wired (ref) or disconnected (no-ref). Source video → `Video Slice` (first N s) → `GetVideoComponents` → `BerniniConditioning` → Wan 2.2 **dual high/low-noise** two-stage sampling (`SamplerCustom`×2, `SplitSigmas`, `BasicScheduler`) → `VAEDecode` → `CreateVideo` (source fps + audio) → `SaveVideo`. A **Turbo-LoRA "Fast mode"** `PrimitiveBoolean` (`76:70`) gates four `ComfySwitchNode`s (model / steps 6↔40 / CFG 1↔5 / split-steps). **Task dropdown** = `CustomCombo` whose *index* output (the choice string is unwired) drives a `RegexExtract` line-picker over a 12-line system-prompt block concatenated onto the user instruction → fed to the positive `CLIPTextEncode`; the graph is wired **video→video only**, so only the source-video tasks are functional — exposed as a **subset `select`** (no-ref: Video Editing / Content Propagation / Action-Position / Style-Motion; ref: with Reference / Ads-Content Insertion). **Zero server code / first image+video→video on a Wan edit graph** (ref variant injects `47.file` video + `104.image` reference generically). **Pruning:** dropped the dead `LoadImage`+`BatchImages` island (no-ref) + empty `BatchImages` (`77`) + the diagnostic frame-count `PreviewAny` (`112`); **kept** the in-path line-index `PreviewAny` (`76:57:1`, int→string for `StringReplace`) — it may emit a stray index caption (rig-watch; suppress later if intrusive). Exposed: source video / (ref: reference image) / edit instruction / edit type / Fast mode / clip length / seed. Heavy (dual 14B fp8) → `maxRuntimeSec 1800`, `i2v`→Video group; real `noise_seed` → cache-immune calibration.

- [x] **Wan 2.2 Bernini-R image editing — text-only + reference-image** — *off-queue pair; the single-image counterparts of the video Bernini pair.* **Both verified on rig (2026-06-21).** At [workflows/bernini_r_image_editing/](workflows/bernini_r_image_editing/) (no reference; raw export: [bernini_r_image_editing_api.json](workflows/exported_api_workflow_comfy/bernini_r_image_editing_api.json)) and [workflows/bernini_r_image_editing_with_reference/](workflows/bernini_r_image_editing_with_reference/) (reference image; raw export: [bernini_r_image_editing_with_reference_api.json](workflows/exported_api_workflow_comfy/bernini_r_image_editing_with_reference_api.json)). Same unified Bernini-R graph as the video pair but **image→image**: `114 LoadImage` → `116 ResizeImageMaskNode` (1280 long edge) → `76:50 BerniniConditioning` (the image is the `source_video`, `length:1`, output dims from `117 GetImageSize`) → dual high/low-noise `SamplerCustom`×2 → `VAEDecode` → `115 SaveImage`. The reference variant wires `104 LoadImage`→`100 BatchImagesNode`→`76:50.reference_images.reference_image_0`. **Pruning:** the dead `LoadImage`+`BatchImages` island (no-ref only) + the diagnostic **`118 ImageCompare`** before/after slider (an `OUTPUT_NODE` that would have added the original + result to the job gallery). The `CustomCombo` here exposes only **5** tasks (Default / Text-to-Image / Text-to-Video / Image Editing / Subject-to-Image); the subset select offers the image-relevant ones (no-ref: Image Editing / Default; ref: Image Editing / Subject to Image), with the literal choice+index aligned to "Image Editing"/3 so the dropdown degrades gracefully. Exposed: image to edit / (ref: reference image) / edit instruction / edit type / Fast mode / seed. `image-edit`→Image group, `maxRuntimeSec 1200`, cache-immune (`noise_seed`). Same in-path line-index `PreviewAny` (`76:57:1`) stray-caption rig-watch as the video pair.

- [~] **Flux.2 Klein inpainting — paint a mask, text-only + reference-image** — *off-queue pair; drove the new **`mask` param type** + the in-browser mask painter (see M4 above).* **Registered 2026-06-25; pending rig verification.** At [workflows/image_flux2_inpaint/](workflows/image_flux2_inpaint/) (mask + prompt; raw export: [flux2_edit_inpainting_mask_api.json](workflows/exported_api_workflow_comfy/flux2_edit_inpainting_mask_api.json)) and [workflows/image_flux2_inpaint_with_reference/](workflows/image_flux2_inpaint_with_reference/) (+ reference image; raw export: [flux2_inpainting_plus_masking_reference_api.json](workflows/exported_api_workflow_comfy/flux2_inpainting_plus_masking_reference_api.json)). The user **paints** the region to replace; the painter composites it into an RGBA PNG with the painted area transparent, and the graph's `76 LoadImage` derives both the base (IMAGE out 0) and the mask (MASK out 1 = `1−alpha`) from that one file — `InpaintCropImproved`→`InpaintModelConditioning`→Flux.2 Klein 4-step sampler→`InpaintStitchImproved`→`SaveImage`. The reference variant adds `105 LoadImage`→`ImageScaleToTotalPixels`→`ReferenceLatent` (the look/object to bring in). **Zero server code beyond the `mask` type wiring** (schemas enum, parser, meta editor, BookingDialog branch, calibration-stages-an-image). **Pruning:** the rgthree `Image Comparer` (`100`, OUTPUT_NODE) in both; the `MaskPreview+` (`142`, OUTPUT_NODE) in the reference variant. Exposed: paint-a-mask image (`mask`) / (ref: reference image) / prompt / seed. Models flux-2-klein-9b-fp8 / qwen_3_8b_fp8mixed / flux2-vae; `image-edit`→Image group; cache-immune (`noise_seed`). **★ Rig-watch: mask polarity** — confirm only the painted region regenerates (standard ComfyUI white=inpaint; graph's `mask_invert:false` agrees); if inverted, flip in `MaskDrawField.commit()`.

- [~] **Wan 2.2 Bernini-R video editing with reference — auto-prompt** — *off-queue; the auto-prompting sibling of the Bernini reference video editor.* **Registered 2026-06-25; pending rig verification.** At [workflows/video_bernini_r_video_editing_ref_autoprompt/](workflows/video_bernini_r_video_editing_ref_autoprompt/) (raw export: [berninir_video_edit_ref_image_autoprompt_api.json](workflows/exported_api_workflow_comfy/berninir_video_edit_ref_image_autoprompt_api.json)). Same Bernini dual-noise graph as `..._with_reference`, but the edit instruction is **written by a Gemma-4 chain** instead of typed: `TextGenerate` describes the source video (`131`) and the reference image (`129`); two `StringConcatenate`s fold them with a system instruction (`134`/`135`); a third `TextGenerate` (`133`) composes the final Bernini prompt → `PrimitiveStringMultiline 117:114` → the positive conditioning. So the user supplies only **video + reference image** (+ task / fast-mode / clip-length / seed; no instruction field). **6 models** (adds the `gemma4_e4b_it_fp8_scaled` CLIP). **Pruning:** the frame-count `PreviewAny` sink (`127`) plus the two description `PreviewAny`s (`130`/`132`) — those are *in-path passthroughs* into `134`, so `134` was rewired straight to `129`/`131` and they were dropped (else two long auto-descriptions land in the gallery); the line-index `PreviewAny` (`117:57:1`) is kept as in the other Bernini bundles. 48 nodes, all reachable from `SaveVideo`. `i2v`→Video group, `maxRuntimeSec 1800`; cache-immune (literal `noise_seed` + every `sampling_mode.seed`). **Rig-watch:** confirm the autoprompt still assembles after the `130`/`132` bypass, and the `117:57:1` stray-caption.

- [~] **LTX 2.3 IC-LoRA image + audio → video (auto-prompt)** — *off-queue; the IC-LoRA counterpart of the ID-LoRA talking-head.* **Registered 2026-06-26; pending rig verification.** At [workflows/video_ltx2_3_ia2v_iclora/](workflows/video_ltx2_3_ia2v_iclora/) (raw export: [video_ltx2_3_ia2v_iclora_api.json](workflows/exported_api_workflow_comfy/video_ltx2_3_ia2v_iclora_api.json)). Character image (`269`) + reference audio (`276`) → talking video (LTX 2.3 22B, two-stage `SamplerCustomAdvanced` + spatial upscaler + audio VAE). Uses the **distilled** LoRA + a Gemma **prompt-enhancer** (`TextGenerateLTX2Prompt` `340:346`, toggled by `340:349`) rather than an identity LoRA — the creative/non-identity sibling of the now-removed ID-LoRA talking-head (`video_ltx2_3_id_lora_img_audio2vid`, which used `ltx-2.3-id-lora-talkvid-3k` to preserve a real person's identity). **Zero new code** — reuses the image-input + audio-input materializer path + `SaveVideo` subfolder serving. Pruned the prompt-preview `PreviewAny` sink (`340:347`; it mirrors the switch output `340:348` already feeding the real `340:306` CLIPTextEncode → would dump the final prompt into the gallery). Exposed: image / audio / prompt / **Enhance prompt with AI** / negative / duration / seed. 54 nodes, all reachable from `SaveVideo`; 5 models; `i2v`→Video group; cache-immune. **Naming note (owner-confirmed):** unrelated to [video_ltx2_3_ic_lora_vid2vid](workflows/video_ltx2_3_ic_lora_vid2vid/) (a *third* workflow — IC-LoRA **depth video→video** restyle); no rename was done.

- [~] **LTX 2.3 text → video (auto-prompt)** — *off-queue; the pure text-to-video member of the LTX 2.3 family.* **Registered 2026-06-26; pending rig verification.** At [workflows/video_ltx2_3_t2v/](workflows/video_ltx2_3_t2v/) (raw export: [video_ltx2_3_t2v_api.json](workflows/exported_api_workflow_comfy/video_ltx2_3_t2v_api.json)). Prompt → short video, **no input** — a built-in `EmptyImage` (`267:325`) stands in for the i2v image path and the graph's `267:201` "Switch to Text to Video?" boolean is pinned true. Same template/node-ids as [video_ltx2_3_i2v](workflows/video_ltx2_3_i2v/) (shared `267:*` ids: `267:266` prompt, `267:247` negative, `267:257/258` width/height, `267:260` fps, `267:225` duration, `267:237` seed) plus the Gemma **prompt-enhancer** chain from the IC-LoRA sibling (`PrimitiveStringMultiline 267:266` → `TextGenerateLTX2Prompt 267:327` → `ComfySwitchNode 267:329`, gated by the `267:330` Enhance toggle → the real `267:240 CLIPTextEncode`). LTX 2.3 22B two-stage `SamplerCustomAdvanced` + spatial upscaler + audio VAE. **Zero server code.** **Pruning:** the prompt-preview `PreviewAny` (`267:328`) — it mirrors the switch output `267:329` that already feeds `267:240`, a pure OUTPUT_NODE that would dump the final/enhanced prompt into the job gallery. 50 nodes, all reachable from `SaveVideo`; 5 models (same set as the IC-LoRA sibling). Exposed: prompt / **Enhance prompt with AI** / negative / **duration (seconds)** / **width** / **height** / **fps** / seed — width+height exposed (unlike the image-input siblings) because t2v has no input image to set the aspect ratio. `i2v`→Video group; cache-immune calibration (two real `noise_seed`s `267:216`/`267:237` + the `267:327` `sampling_mode.seed` all randomized). **Rig-watch:** confirm the prompt-enhance toggle round-trips (raw vs Gemma-rewritten) and that no stray prompt text lands in the gallery after the `267:328` prune.

**Backlog / superseded (previously queued, not in the current active set — revisit when prioritized):** Hunyuan3D 2.1 (replaced by TripoSplat for the 3D row). The institutional notes (long-job polling, `ModelLifecycle /free`, `LoraLoader` param surfacing) remain valid and overlap with the rows above.

**What we're really testing.** Each row is a probe into "does ComfyQ stay zero-config when a new workflow lands?" — that's the actual product promise. The headline failures we expect are around (a) output kinds the `MediaStore` classifier doesn't know yet (e.g. Gaussian-splat formats), (b) workflows that produce N>1 primary outputs (TripoSplat video+GLB, multiview, audio+video), and (c) media kinds with no client renderer yet (audio, splats). Each fix lands generally, not per-workflow.

**Cross-cutting infra these rows depend on (state as of 2026-06-13 — all target workflows registered):**
- **Multi-output UX — DONE.** The wire sends the full `outputs[]` array ([server/realtime/realtimeBus.js](server/realtime/realtimeBus.js) `_toWireJob`). The Scheduler grid / `MyJobsPanel` thumbnails render a single `result_filename` (extension-prefers a GLB over a splat `.ply` so the thumbnail is always renderable) with a "{N} views" badge when a job has >1 image output. The **`ImageLightbox` has two galleries**: (a) a **3D gallery** — Splat⇄Mesh viewer toggle + per-format export buttons (.spz/.ply/.glb), video ignored; (b) an **N-image gallery** ([ImageGallery.jsx](client/src/components/ui/ImageGallery.jsx)) — main image + prev/next + counter + per-view labels + thumbnail strip + per-image/"Download all" (Qwen multi-angle). Audio jobs render the AudioPlayer.
- **Audio I/O — DONE.** Output: server classifies `.mp3`/`.wav`/etc. and the client has [AudioPlayer.jsx](client/src/components/ui/AudioPlayer.jsx) (`isAudio` → styled `<audio>` in cards + lightbox), built 2026-06-11 for Stable Audio 3. Input: [MediaCaptureField.jsx](client/src/components/capture/MediaCaptureField.jsx) gained an **`audio` type** (2026-06-11, for the LTX ID-LoRA talking-video workflow) — `audio/*` file picker + drag-drop + inline `<audio>` preview, no resize; `BookingDialog` routes `audio` params to it and enforces required ones. Server needed **zero changes** — `/upload` stores any file in ComfyUI/input, `inspectUpload` only dimension-checks images, and the materializer injects the filename into the `LoadAudio` node generically.
- **Gaussian-splat viewer — BUILT (2026-06-10).** [client/src/components/ui/SplatViewer.jsx](client/src/components/ui/SplatViewer.jsx) renders `.spz`/`.splat`/`.ksplat` via **Spark** (`@sparkjsdev/spark`, three.js-native, from the .spz authors). Same render-on-demand discipline as `ModelViewer` (draw only on load / OrbitControls `change` / Spark `onDirty` re-sort / resize — no permanent rAF loop). `.glb/.gltf` still → `ModelViewer`. New server kind `splat` in [server/media/mediaTypes.js](server/media/mediaTypes.js).
- **Long-job robustness — READY.** Adaptive history polling (1 s → 5 s) and WS auto-reconnect exist in [server/executor/jobExecutor.js](server/executor/jobExecutor.js) + [server/workers/comfyWsClient.js](server/workers/comfyWsClient.js). **No per-job time budget (2026-06-26):** the old `maxRuntimeSec` deadline that auto-killed a job was removed — a job runs until ComfyUI finishes or a user/admin cancels it; only calibration keeps a fixed 2 h safety cap so the admin gauge can't hang. Not a blocker for the long-running 3D/video rows.
- **Text outputs — DONE (2026-06-21).** Workflows whose result is text rather than media (LLM captioners — the Gemma describe-it pair). [outputCollector.js](server/executor/outputCollector.js) `_collectText` collects a node's `text`/`string` UI array (`PreviewAny` "Preview as Text", `ShowText`, …) as `kind:'text'` carried **inline on the wire** (no file to serve); [jobExecutor.js](server/executor/jobExecutor.js) forwards `o.text`; `ImageLightbox`/`MediaPreview` render the caption. No `class_type` coupling — any text-emitting node Just Works, so image/video→text workflows land zero-code.

### Phase F — Multi-instance federation *(final phase — design locked 2026-05-16; first slice F1+F2 SHIPPED 2026-06-28, in user testing)*

Final milestone of ComfyQ v2: let several ComfyQ instances on the same LAN auto-discover each other, expose a fleet-wide admin view (GPU / RAM / active workflow / queue per peer), and let students pick which rig to book against. Different machines run *different* workflows in parallel; students manually choose their station — there is no cross-instance job routing. Full plan lives at `~/.claude/plans/iridescent-wondering-lagoon.md`; key decisions captured below so the project's design intent travels with the repo.

> **✅ Shipped 2026-06-28 — packaged, self-updating desktop app.** The fleet monitor (`desktop/`) is now distributed as a **downloadable installer that auto-updates from GitHub Releases** (electron-builder + electron-updater; public repo → no client token). One-command release: `cd desktop && npm run release:patch` bumps + tags + pushes → [.github/workflows/release.yml](.github/workflows/release.yml) builds Win/Mac/Linux and publishes installers + `latest*.yml`. The app's ⚙ settings show the version + a "Check for updates" button; updates download in the background and prompt "Restart to update". Validated end-to-end on a real Windows machine (an installed v2.0.1 self-updated to v2.0.2). **Caveats (as of v2.0.8):** Windows is unsigned (SmartScreen "Run anyway" on first download) and **Windows + macOS-arm64 are confirmed working**. **macOS now builds arm64 + x64** and the `.app` is **ad-hoc code-signed** ([desktop/scripts/afterPack.cjs](desktop/scripts/afterPack.cjs), `codesign --sign -`) so it **launches with a one-time GUI bypass** (right-click → Open / Open Anyway / `xattr -cr` fallback) instead of the unsigned "damaged" dead end — it is *not* notarized. **Intel x64 needs macOS ≥ 12** (Big Sur 11 is known-broken even ad-hoc-signed). **Windows + Linux (AppImage) auto-update; macOS still does NOT** until a Developer-ID/notarized signature lands — ad-hoc fixed *launch*, not *update*, so on macOS updating = install + manual re-download. See CLAUDE.md "Desktop app — installers + GitHub auto-update" for the full build/release detail (platform matrix, why ad-hoc) and the `npm version` git-step workaround ([desktop/scripts/release.mjs](desktop/scripts/release.mjs)).

> **★ Implementation path chosen (2026-06-27) — beacon + standalone monitor app.** The first federation work being built realizes F1+F2 via a **UDP multicast status beacon** consumed by a **standalone cross-platform Electron "fleet monitor" app** (`desktop/`), *not* via the originally-locked mDNS + in-browser-panel approach. Rationale (owner decision): the goal is a single pane of glass an instructor opens to see the whole room — including **idle admin-mode rigs with nothing launched** — so each server simply **multicasts a JSON status snapshot every ~5 s** (`239.255.42.99:41999`, built-in `dgram`, zero new transport dep) and the desktop app **listens** (no per-peer polling; peers appear/expire automatically). It is **on by default** (`federation.enabled: true`, both admin and student mode) so machines "just appear" with no per-rig setup, and **read-only** — the only action is a "Schedule a job" button that opens `http://<rig-ip>:5173` in the default browser. A `GET /federation/self` REST endpoint serves the same snapshot for on-demand detail / a future web panel. Identity (UUID + name + GPU + VRAM + RAM) is detected at boot via `systeminformation` (cross-platform; `/system_stats` can't report GPU on an idle rig) and persisted to `config.instance`. **Still deferred / unchanged below:** mDNS discovery, cluster-secret auth, cross-instance admin actions (F4), the in-AdminConfig panel (F3), the student peer-picker page (F5), and the orchestrator role (F6). See the dedicated plan file for file-by-file detail.

**Architectural decisions (locked):**

- **Discovery: mDNS primary, static-peer list fallback.** Each instance publishes itself via [`bonjour-service`](https://www.npmjs.com/package/bonjour-service) on `_comfyq._tcp.local` and subscribes to the same service type. mDNS works out of the box on Win10+/macOS/Linux; Windows Firewall on UDP/5353 is the same friction as today's LAN access. A `federation.staticPeers: []` array in config covers (a) multicast-blocked workshop networks and (b) cross-subnet deployments. Peer records age out after `last_seen_at + 30s`.
- **Topology: peer-to-peer, no leader.** Every instance maintains its own peer map. No election, no SPOF, no quorum logic. Cheap on a workshop LAN (≤20 peers).
- **Cross-instance API: server-side aggregation, browser stays single-origin.** Each ComfyQ has new `/federation/*` routes that proxy / aggregate from peers. The browser never `fetch()`s a peer's HTTPS URL directly (each peer has a different self-signed cert; cross-peer browser calls would each need a separate cert click-through — bad UX). Node-to-Node peer traffic goes over HTTP to the bare Express port (3000) with `rejectUnauthorized: false` and an optional shared secret. When a student clicks "use Station B", a *new tab* opens to B's Vite URL — that tab gets its own one-time cert prompt.
- **Trust: optional cluster secret, defaults off.** Mirrors the existing admin-password pattern in [server/auth/authGate.js](server/auth/authGate.js). `federation.clusterSecret` unset → implicit LAN trust (acceptable for closed workshop networks). Set → every inter-instance HTTP call signs with `X-ComfyQ-Cluster-Secret`; receiving instance refuses mutating calls without it. mDNS broadcast itself stays unauthenticated — the secret only gates *commanding* peers, not *seeing* them.
- **Identity: persistent instance UUID + hostname + GPU + RAM.** New `instance.{id, hostname, gpu, vramGb, ramGb, cudaVersion}` block in config, generated on first boot. GPU / VRAM captured from ComfyUI's `/system_stats` at first `[Worker] WS connected` event (today they only land in `runtime.json` post-calibration, which is too late and too coupled). RAM from `os.totalmem()`.
- **New role: orchestrator** (in addition to today's runner). Orthogonal to the existing `mode: admin|student`. Set via `role: 'runner' | 'orchestrator'` in config. Orchestrator boots Express + Vite *without* a `LocalComfyUIWorker`, skips queue/executor/registry — pure control-plane node for an instructor laptop with no GPU. Two launchers: today's [start-comfyq.bat](start-comfyq.bat) (runner) and a new `start-comfyq-admin.bat` (orchestrator, sets `COMFYQ_ROLE=orchestrator` env var).
- **Backwards compat: federation entirely opt-in.** `federation.enabled: false` (default) → no mDNS publish, no subscribe, `/federation/*` returns `{ enabled: false }`. Today's single-instance behavior is unchanged at every phase.

**Phased delivery** (each phase shippable on its own; previous behavior preserved throughout):

- [x] **F1 — Instance identity + system-info capture.** *(Delivered 2026-06-27 via the beacon path; shipping to users 2026-06-28.)* UUID + name + GPU + VRAM + RAM detected at boot (`server/federation/systemInfo.js`, `systeminformation` + nvidia-smi fallback) and persisted to `config.instance`. Exposed via `GET /federation/self` rather than `GET /admin/system-info`; CUDA version + the AdminConfig "this machine" card remain unbuilt.
- [x] **F2 — discovery + read-only `/federation/*` API.** *(Delivered 2026-06-27 as a UDP multicast beacon, not mDNS; the desktop monitor is now a packaged, auto-updating installer as of 2026-06-28.)* `server/federation/beacon.js` multicasts `buildSnapshot()` every ~5 s; `GET /federation/self` returns the same snapshot. Consumed by the standalone `desktop/` Electron monitor (peer map + expiry live in the app, not the server). `bonjour-service` mDNS, `GET /federation/peers`, `POST /federation/peers/refresh`, and the Socket.IO `federation_update` event remain deferred.
- [ ] **F3 — Admin federation panel (read-only).** New "Federation" section in AdminConfig: enable toggle, static-peer textarea, cluster-secret input, peer table (hostname / IP / role / GPU / VRAM / RAM / active workflow / queue summary / last-seen / "ping"). Vite proxy entry for `/federation` added.
- [ ] **F4 — Cross-instance admin actions.** `POST /federation/peers/:id/activate-workflow` proxies the call to the named peer's `POST /admin/activate-workflow` (with cluster-secret header). Extend `/federation/self` to advertise `availableWorkflowIds`. Admin UI grows "Launch workflow on peer" dropdown per peer row. Handle the disconnect window during peer restart gracefully ("Peer restarting…" until it reappears in mDNS).
- [ ] **F5 — Student peer picker.** New `/user/workshop` page lists all `role=runner` peers + their active workflow + ETA-till-free. "Use this station" opens the peer's Vite URL in a new tab (one-time cert prompt per device, documented).
- [ ] **F6 — Orchestrator role + second launcher.** Boot-path branching in [server/index.js](server/index.js) for `role=orchestrator` (skip worker / queue / executor / registry). New [start-comfyq-admin.bat](start-comfyq-admin.bat). AdminConfig hides the ComfyUI/workflow-library sections in orchestrator mode.

**Out of scope** (each warrants its own milestone if needed later):
- Cross-instance job routing / load balancing (students manually pick a station).
- Shared job history across instances (each runner keeps its own sqlite).
- Shared workflow library (admins upload to each peer).
- Authenticated mDNS or encrypted peer traffic (LAN-trust threat model; cluster secret only gates *commands*).
- Replacing admin-password with cluster-secret (the two coexist — different scopes).

**Verification matrix** (when phase work begins): each phase must keep `federation.enabled: false` behavior identical to today's single-instance ComfyQ. Two-instance dev validation can run both instances on a single host with different ports (3000 + 3001 bound to `0.0.0.0`); mDNS works on a single host fine.

---

## Planned features (post-federation)

Two features scoped 2026-06-28. Both are **additive** — they reuse the existing job pipeline and must not change single-instance behavior when unused. Designs below are the starting point; ★ marks open decisions to confirm before building.

### Phase G — Batch processing *(admin-only; planned)*

**Goal:** an admin points ComfyQ at a **folder of input files + a manifest of prompts/parameters**, picks a workflow, and ComfyQ enqueues **one job per item** — running the workflow across the whole set unattended. Pure reuse of the single-job pipeline; no new execution path.

**Why it's mostly reuse (verified against the code):** a booked job is just `queue.insert({ workflowId, paramValues, prompt, scheduledAt, … })` → the executor materializes the graph (`localComfyUIWorker._materializeWorkflow` injects `paramValues[key]` into `node.inputs[field]` per `meta.exposedParameters`, and input-file refs into `LoadImage/LoadVideo/LoadAudio` nodes) → `outputCollector` gathers results. A batch is **N of those inserts** with per-item params + staged files. No change to the state machine, executor, upload validation, or output collection.

**The structure (prompts / files / parameters) — the core deliverable.** A batch is a folder:

```
my_batch/
├── batch.json            the manifest (or batch.csv — see below)
└── inputs/               the input files the manifest references
    ├── photo01.jpg
    └── photo02.jpg
```

`batch.json` (recommended — power form):
```jsonc
{
  "workflowId": "bernini_r_image_editing",   // or omit → active workflow
  "label": "studio_portraits_june",
  "defaults": {                               // applied to every item
    "prompt": "make it a watercolor painting",
    "params": { "edit_type": "Image Editing", "seed": 0 }
  },
  "items": [
    { "file": "photo01.jpg" },                                  // uses all defaults
    { "file": "photo02.jpg", "prompt": "charcoal sketch" },     // overrides the prompt
    { "file": "photo03.jpg", "params": { "seed": 42 } }         // overrides one param
  ]
}
```
- `defaults` + per-item overrides keeps the common case (same prompt, many files) a one-liner per item while still allowing per-file prompts/params.
- `file` maps to the workflow's single media param; multi-input workflows use `"files": { "<paramKey>": "name.ext" }`.
- `prompt` is folded into the workflow's headline text param (same `pickHeadlinePrompt` logic as booking); `params` keys are `exposedParameters[].key`.

`batch.csv` (for non-technical admins — one row per job, header = `file` + param keys/labels):
```
file,prompt,seed
photo01.jpg,make it a watercolor painting,0
photo02.jpg,charcoal sketch,1
```

**Server work:**
- `server/batch/batchImporter.js` — parse JSON/CSV, **validate every item against the workflow's `effective.exposedParameters`** (unknown key / missing required / bad type → reject before enqueuing, with the row number), stage each item's files into `<comfy>/input` via a new `comfyq_batch__` prefix (reuse `InputUploader`), then `queue.insert(...)` per item with `scheduledAt = queue.nextFreeSlot(...)` (back-to-back) and `createdBy: 'batch'`.
- Tag jobs with a `batch_id` (lightweight: add a nullable `batch_id` column to `jobs`; optionally a `batches` table for label/counts) so a batch's progress is queryable.
- Routes (admin-gated via `authGate`): `POST /admin/batch` (multipart: manifest + files, **or** a server-side folder path the admin's machine can see), `GET /admin/batches`, `GET /admin/batches/:id`.
- Output grouping: set `filename_prefix` to `batch_<label>_<itemId>` so a batch's outputs are recognizable.

**Client work:** an admin **Batch** card — pick workflow → upload folder (or manifest + files) → for CSV, map columns → params → **preview the N jobs** (reuse `DynamicParamFields` to show the first item's resolved form) → **Enqueue batch** → a progress row (n queued / done / failed) reading job events.

**★ Open decisions:** (1) CSV vs JSON as the *primary* admin path (lean: support both, JSON canonical); (2) browser folder-upload vs ingesting a server-side folder path (admin rigs already have the files locally → a path is simpler and avoids re-uploading GBs); (3) scheduling — all ASAP back-to-back (recommended) vs a fixed cadence; (4) input retention — batch inputs likely should survive the 30-min TTL until the batch completes (use a non-swept prefix or pin until done).

**Non-goals:** cross-instance batch distribution (that's Phase H territory), per-item retries UI (a failed item is just a failed job — re-enqueue from the manifest).

### Phase H — Instance mode *(planned)*

**Goal:** run **2–3 independent ComfyQ instances on one machine, each driving its own ComfyUI backend** (typically one per GPU). Each instance is independently bookable and shows up as its own machine in the [ComfyQ Discovery](#) fleet monitor; together they let one box serve several workflows/GPUs at once. Federation (Phase F) already renders multiple peers — instance mode is mostly making every **singular/hardcoded port, path, and identity per-instance**.

**Audit (what's already per-instance vs what must change) — verified in code:**

| Concern | Today | For instance mode |
|---|---|---|
| API/Socket.IO port | `config.server.port` (3000) ✅ configurable | per-instance (3000/3001/3002) |
| ComfyUI API host/port | `config.comfy_ui.api_host/api_port` (127.0.0.1:8188) ✅ | per-instance (8188/8189/8190) |
| Federation group/port, instance id/name | `config.federation.*`, `config.instance.*` ✅ | shared group/port is fine; **id/name must differ** |
| **Config file path** | hardcoded `./config.json` ❌ | load from `COMFYQ_CONFIG` env / CLI |
| **SQLite db** | relative `./server/data/comfyq.sqlite` ❌ collides | per-instance path (in the per-instance config) |
| **Boot flag** | hardcoded `server/data/.boot-student` ❌ collides | per-instance path |
| **Vite backend target** | hardcoded `localhost:3000` in `vite.config.js` ❌ | from env, or serve the built client from Express |
| **UI port in beacon snapshot** | hardcoded `5173` in `statusSnapshot.js` ❌ | new `config.server.uiPort`, reported per-instance |
| **GPU selection** | none | new `config.comfy_ui.gpuIndex` → `CUDA_VISIBLE_DEVICES` on spawn |

**Phased delivery:**
- **H1 — per-instance config + state.** `configManager` reads `CONFIG_PATH` from `COMFYQ_CONFIG` (default `./config.json`). Make `queue.dbPath` and the boot-flag path derive from the loaded config (each instance config points at its own `server/data/<name>/`). Single-instance behavior unchanged when the env var is unset.
- **H2 — per-instance UI port + GPU.** Add `server.uiPort` (default 5173) and `comfy_ui.gpuIndex` to the schema; replace the hardcoded `5173` in `statusSnapshot.js` with `config.server.uiPort` (so the fleet monitor's "Schedule a job" opens the right UI), and set `CUDA_VISIBLE_DEVICES=<gpuIndex>` in `ComfyProcess` spawn env so each instance pins its own GPU.
- **H3 — client knows its backend.** Parameterize Vite's `BACKEND`/port via env for dev (`VITE_BACKEND`, `--port`), **or** (cleaner for multi-instance) have Express serve the built `client/dist` so no per-instance Vite is needed and the UI is same-origin on `server.port`. ★ Decide dev-Vite-per-instance vs serve-static.
- **H4 — launcher + docs.** `start-instance` script (sets `COMFYQ_CONFIG` + ports + GPU) and/or an `instances.json` that spawns N; document GPU/port/VRAM-budget assignment. Verify 2–3 instances + backends boot, each books independently, and the fleet monitor lists them as distinct machines.

**★ Open decisions:** (1) **separate ComfyUI install per instance vs one shared install** — sharing requires per-instance `input/`/`output/` dirs (they collide otherwise); separate roots are simplest and what the config already assumes; (2) GPU assignment via config field vs launcher env; (3) `vramBudgetGb` must be split across co-resident instances so they don't oversubscribe one GPU's VRAM; (4) whether to also support the Phase-F **orchestrator** role (a GPU-less control node) alongside instance mode.

**Relationship to federation:** instance mode and Phase F compose — each instance beacons separately, so the existing Discovery app shows them with no app change (once `uiPort` is per-instance). This also revives the deferred two-instance validation (the verification matrix below already anticipates "two instances on one host, different ports").

---

## Open risks / decisions still to nail down

1. **ComfyUI `/free` semantics** on the lab build — if it forces a model reload even back-to-back same-workflow, ModelLifecycle should only free on workflow-switch (current default). Validate during the LTX 2.3 row of **Target workflows** with a back-to-back same-workflow timing comparison.
2. **`temp/` directory cleanup** — ComfyUI may not clean its own temp. Recommended: copy temp outputs to a ComfyQ-managed output folder at completion. Confirm at M1.
3. **Webcam blob format on iOS Safari** — getUserMedia may yield webm but workflows expect png/jpg. **Resolved in M4 design:** universal image path is always `getUserMedia → canvas → toBlob('image/jpeg', 0.92)`, never trusting MediaRecorder for stills. For mobile video, use `<input type="file" accept="video/*" capture="environment">` which delegates to the OS camera and returns native MP4; the desktop MediaRecorder path stays best-effort.
3a. **`getUserMedia` requires a secure context (HTTPS or localhost).** **M4-2 resolved this with self-signed HTTPS; that was REVERTED 2026-05-19** after a workshop test proved the cert unworkable across Safari + Chrome + mobile (warnings, broken downloads, broken websocket on Safari). ComfyQ now serves plain HTTP. Net effect on this risk: live in-browser webcam preview only works on `localhost`; off-`localhost` the **Use camera** button uses the native-camera file picker (`<input type="file" capture="environment">`), which needs neither HTTPS nor permissions and opens the OS camera on phones. See "Plain HTTP (workshop decision, 2026-05-19)" in the M4 section.
4. **MediaRecorder audio format Firefox vs Chrome** — encodings differ; ACE / LTX audio model may want wav. Decision: WebAudio decode → wav re-encode (`audiobuffer-to-wav`). Validate during the music-workflow row of **Target workflows**.
5. **Job replay across workflow versions** — we don't replay; jobs are immutable history. Store `workflowVersion` on the job and badge in MyJobs.
6. **AuthGate scope** — gates `delete_job(other_user)`, `reset-to-admin`, `restart-server`, `cancel_job(other_user)`, `restart`, `upload-workflow`, `:id/calibrate`, `:id/config-meta`, `cleanup-outputs`. Cross-user delete/cancel routes through the admin-password modal; without a password configured, cross-user actions are refused entirely. Re-review if M2 surfaces new mutation surfaces (CSV export of others' jobs, etc).
7. **WS reconnection while a job is executing** — REST `/history` is the source of truth; WS gap should not interrupt polling. Confirm during the LTX 2.3 row of **Target workflows**.
8. **Timeline collision with variable durations** — collision check uses each job's own workflow `estimatedDurationSec`. When unbenched, falls back to `meta.json.estimatedDurationSec` seed; never to a hard-coded 60 s.
9. **Multi-output download UX** — applies to LTX-audio (video + audio) and Qwen multiview (N images) target workflows. MyJobs lists all; timeline cell shows aggregated count + first thumbnail. Verify during the relevant **Target workflows** rows.
10. **Skills repo** — out of scope. Revisit only if a future Phase 6 ships a `ComfyQ_Save` helper node for tighter progress / structured save metadata.

---

## How to run / verify on a real ComfyUI rig

```
git clone <repo>   # default `main` branch is the active line — no checkout needed
npm install
npm run dev
```

Then open `http://<host>:5173/admin` (the Vite dev server — it serves the admin SPA and proxies the API on :3000; opening :3000 directly won't serve the UI):

1. **ComfyUI Settings** — root path, python executable, output dir, VRAM budget, port.
2. **Add Workflow** (optional) — upload an API-format JSON. Or drop your saved API JSON directly into `workflows/<id>/<id>.api.json` next to the meta.
3. **Workflow library** — pick one → **Activate & start student mode**. Server restarts into student mode.
4. **Timeline** — book a job in the Scheduler. Watch progress; download the result.

Smoke checks per milestone are listed in each section above. Full end-to-end validation requires the user's lab box.
