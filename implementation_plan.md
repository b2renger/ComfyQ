# ComfyQ v2 — Implementation Plan & Progress

This document tracks the v2 rebuild: the architecture, the milestone sequence, what's done, and what's still ahead. The plan was reached after auditing `main` / `poc1` / `poc2` and confirming six foundational decisions with the project owner.

---

## Why v2

The v1 architecture (still on `main`) cannot serve the target workflow set:

- **Single-worker scheduler** with a fixed-duration boot benchmark
- **Hard-coded save node whitelist** (`SaveImage`, `SaveVideo`, `VHS_VideoCombine`) — fatal for LTX video / depth preprocessors / audio outputs
- **Fragile Litegraph→API auto-conversion** (poc2) that fails on Group Nodes
- **Editable-field whitelist** in `workflowParser` that won't survive new node types
- **No audio I/O** anywhere in parser / scheduler / BookingDialog
- **No reconnection logic** on the ComfyUI WebSocket; jobs hang in `processing` if ComfyUI restarts

`main` and `poc1` are byte-identical. Only `poc2` diverged, adding the workflow registry concept and `.config.meta.json` separation. v2 ports those ideas and rebuilds the rest.

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
- **BenchmarkService** — runs each workflow's `warmupParams` for real wall-time + samples/sec, writes sidecar `<id>.runtime.json`.

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
  estimatedDurationSec, maxRuntimeSec,
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
              api_host, api_port, autoStart, vramBudgetGb },
  auth: { adminPasswordHash },
  queue: { dbPath, inputRetentionMinutes, outputRetentionDays },
  workflows: { dir, activeWorkflowId }
}
```

No workflow-specific fields in `config.json`; that lives in the registry now.

---

## Milestones

### M0 — v2 skeleton runs Flux1 dev t2i (✅ COMPLETE — VERIFIED ON RIG)

Smallest functional v2 covering only t2i, on the new architecture.

- [x] Branch `v2` cut from `main`. Old v1 modules deleted.
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
- [x] Calibration ships a built-in 512×512 reference PNG (`__comfyq_calibration.png`) so workflows with image inputs can be calibrated without admin-uploaded sample media. Video/audio inputs throw a clear error pointing the admin at `meta.warmupParams`.
- [x] Scheduler timeline uses per-workflow estimate (no global 60 s).
- [x] Flux2 image-edit (1-image and 2-image variants) registered and validated on rig.
- [x] `BookingDialog` image upload: media-typed exposed parameters render as drag-and-drop upload widgets; uploaded files land in `<comfy_root>/input/` with a `comfyq_session__` prefix and TTL sweep.
- [x] Worker `_materializeWorkflow` injects `paramValues` for image/video/audio fields into their nodes (was previously skipped, breaking image-edit submissions).


### M1+ — Admin UX & operations (delivered alongside M1)

Beyond the original M0/M1 scope, the following has been built so a teacher / lab admin can onboard a new workflow in under a minute:

- [x] **Workflow upload** (drag-and-drop API JSON) auto-scaffolds the meta.json by running the primitive-fallback parser and surfacing every detected widget.
- [x] **Workflow metadata editor** (`WorkflowMetaEditor` modal) — opens automatically after upload, also reachable from a per-card pencil button.
  - Edit name, description, category, author, version, estimatedDurationSec, maxRuntimeSec.
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
- [x] **Reorder + display-name editor for parameters** — [client/src/components/admin/WorkflowMetaEditor.jsx](client/src/components/admin/WorkflowMetaEditor.jsx) gains per-row ▲/▼ buttons to reorder parameters within the *visible* filter (so reordering inside "Only enabled" stays predictable). The persisted `order: i` from save logic now follows admin intent. The "Label" column is relabelled "Display name (shown to students)" for clarity; functionally unchanged. Each row gets an ordinal `#N` chip so the current position is obvious.
- [x] **nodemon restart fix** — `exitForRestart()` bumps the mtime of `server/index.js` so nodemon's chokidar watcher triggers a restart instead of parking in "clean exit — waiting for changes" forever.

### M1+ — Student UX (delivered alongside M1)

- [x] **Random seed by default.** Any exposed parameter named `seed` (or whose `field` is `seed`) gets a fresh random value each time the BookingDialog opens. Re-roll button (`Dices`) lets the user reroll without retyping; manual entry still works.
- [x] **Live-time timeline** — vis-timeline window is centered around `now()` with a sliding 10-min-before / 50-min-after window. "Following" toggle re-centers every 10 s. Auto-disables when the user pans manually; clicking "Now" re-engages.
- [x] **Active-workflow indicator** in the Scheduler header (uses `state.workflow_info` already on the wire).
- [x] **"Use these settings"** in the `ImageLightbox` — re-opens a fresh `BookingDialog` pre-filled with the job's prompt and parameters. Image/video/audio params are NOT recalled (the session-scoped filenames may have been swept by the input retention TTL); the user re-uploads.
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

- [x] **TripoSplat (image → Gaussian splat)** — *supersedes the dropped Hunyuan3D row.* **DONE — verified on rig 2026-06-10.** Registered as a workflow bundle at [workflows/3d_triposplat_image_to_gaussian_splat/](workflows/3d_triposplat_image_to_gaussian_splat/) (raw export kept at [workflows/exported_api_workflow_comfy/3d_triposplat_image_to_gaussian_splat_api.json](workflows/exported_api_workflow_comfy/3d_triposplat_image_to_gaussian_splat_api.json)). The bundle's api.json **drops the video chain** (`CreateVideo`/`SaveVideo`/`RenderSplat`/`CreateCameraInfo` removed — orbit video not wanted) and **adds a second `SplatToFile3D` in `.ply`** alongside the exported `.spz`, so the three exports are `.spz` + `.ply` + `.glb` (mesh). The earlier `SaveGLB`-collapses-formats worry was **checked on the rig: distinct `.spz`/`.ply`/`.glb` land correctly**, no save-node swap needed. Delivered: the **Gaussian-splat viewer** (`SplatViewer.jsx`, Spark — see infra above), the `ImageLightbox` **3D gallery** (Splat⇄Mesh toggle + three export buttons), the `splat` media kind, the GLB-preferred thumbnail, and a user-facing **"Auto-remove background" checkbox** (node `88:35.switch`) — which added the first `checkbox`-type param renderer to [BookingDialog.jsx](client/src/components/BookingDialog.jsx). Calibration uses the built-in reference PNG (image input). **SplatViewer controls note:** it runs a continuous `setAnimationLoop` (not render-on-demand) — Spark sorts splats asynchronously, so an on-demand redraw left wheel-zoom and right-click-pan looking frozen; a steady loop is Spark's documented pattern and cheap since the viewer only mounts in the lightbox.
- [ ] **Qwen image-to-multiview** — single reference image → N consistent viewpoint images. Stresses: workflows that emit **N images** (not 1) → the **multi-output gallery** (shared with TripoSplat), thumbnail grid layout in `MyJobs`, batch-size as an exposed parameter.
- [ ] **Audio (SD3 + ACE)** — text/audio prompt → audio. Stresses the **audio I/O subsystem**: `inputUploader` for audio kinds + an `audio` input type in `MediaCaptureField` (today image/video only), an **audio player** (no `<audio>` branch in `MediaPreview` yet — `.mp3` would render as a broken `<img>`), optional `AudioRecorder` (WebAudio → wav). Output classification for `.wav`/`.mp3`/`.flac` already exists in [server/media/mediaTypes.js](server/media/mediaTypes.js). Lifts what was previously planned as M5.
- [~] **Ideogram 4.0 t2i + prompt builder** — **registered 2026-06-10; pending rig smoke-test.** Bundle at [workflows/image_ideogram4_t2i/](workflows/image_ideogram4_t2i/) (raw export: [workflows/exported_api_workflow_comfy/image_ideogram4_t2i.json](workflows/exported_api_workflow_comfy/image_ideogram4_t2i.json)). The exported graph had **two disconnected islands**: the generator (driven by a hardcoded structured-JSON "caption" in `CLIPTextEncode` 98:24) and a *separate* magic-prompt builder (`134:*` system-prompt + natural-language idea → `PreviewAny`) that doesn't touch the image — it's a manual two-step (run → copy assembled prompt to an external LLM → paste JSON back → run). Per the owner's call we ship the **single-run structured-JSON path**: the `134:*`/`PreviewAny` helper island is **pruned** (39→29 nodes), and node 98:24's structured JSON is exposed as the editable prompt (default = the COMFY skateboarder example). Also exposed: aspect ratio (`ResolutionSelector` 37), megapixels, quality preset (`CustomCombo` 98:156 = Turbo/Default/Quality), CFG, seed. **Zero new code** — standard t2i (SaveImage → image output) the existing infra already renders. **Rig check:** the `aspect_ratio` combo options are best-guess (the exact `ResolutionSelector` label set couldn't be confirmed off-rig); the default `"9:16 (Portrait Widescreen)"` is known-good, but verify/adjust the other option strings against the node's dropdown in the WorkflowMetaEditor — a wrong label fails only that pick, not the default.

- [x] **Wan 2.1 360° rotate LoRA (image → video)** — *this is the "360 video LoRA" item from the original target list.* Registered at [workflows/video_wan_rotate_lora/](workflows/video_wan_rotate_lora/) (raw export: [workflows/exported_api_workflow_comfy/VID_Wan_rotate_lora.json](workflows/exported_api_workflow_comfy/VID_Wan_rotate_lora.json)). **Zero-code** — the image→video infra built for LTX i2v (image input, `VHS_VideoCombine` `.mp4` output + video player, calibration via the built-in reference PNG) covered it with no new components or server changes; only the exported `VHS_VideoCombine` `filename_prefix` was tidied (`AnimateDiff` → `video/Wan_rotate`). Exposes image / prompt / negative / seed / steps / length(frames) / playback-fps; width/height/LoRA-strength left hidden (fixed 512², avoids student OOM). **LoRA-trigger gotcha (documented in the workflow description):** the positive prompt must keep `r0t4tion` + "360 degrees rotation" — the odd spelling is the trained trigger token. Per the owner's call the prompt is exposed **as-is** (building-example default) so students fully edit it; the description warns to keep the trigger.

**Backlog / superseded (previously queued, not in the current active set — revisit when prioritized):** Hunyuan3D 2.1 (replaced by TripoSplat for the 3D row), LTX 2.3 video-from-reference, LTX audio-driven. The institutional notes for these (long-job polling, `ModelLifecycle /free`, audio+video multi-output, `LoraLoader` param surfacing) remain valid and several overlap with the active rows above (multi-output, audio I/O).

**What we're really testing.** Each row is a probe into "does ComfyQ stay zero-config when a new workflow lands?" — that's the actual product promise. The headline failures we expect are around (a) output kinds the `MediaStore` classifier doesn't know yet (e.g. Gaussian-splat formats), (b) workflows that produce N>1 primary outputs (TripoSplat video+GLB, multiview, audio+video), and (c) media kinds with no client renderer yet (audio, splats). Each fix lands generally, not per-workflow.

**Cross-cutting infra these rows depend on (state as of 2026-06-10):**
- **Multi-output UX — PARTIAL (3D done).** The wire sends the full `outputs[]` array ([server/realtime/realtimeBus.js](server/realtime/realtimeBus.js) `_toWireJob`). The Scheduler grid / `MyJobsPanel` thumbnails still render a single `result_filename` (now extension-prefers a GLB over a splat `.ply` so the thumbnail is always renderable). The **`ImageLightbox` now has a 3D gallery**: for any job with a splat and/or mesh output it shows a Splat⇄Mesh viewer toggle plus per-format export buttons (.spz / .ply / .glb), and ignores video outputs. Still MISSING: an N-image gallery for Qwen multiview (homogeneous N>1 image grid).
- **Audio I/O — MISSING.** Classification exists server-side; the client has no audio player and no audio input type. Needed by the SD3/ACE row.
- **Gaussian-splat viewer — BUILT (2026-06-10).** [client/src/components/ui/SplatViewer.jsx](client/src/components/ui/SplatViewer.jsx) renders `.spz`/`.splat`/`.ksplat` via **Spark** (`@sparkjsdev/spark`, three.js-native, from the .spz authors). Same render-on-demand discipline as `ModelViewer` (draw only on load / OrbitControls `change` / Spark `onDirty` re-sort / resize — no permanent rAF loop). `.glb/.gltf` still → `ModelViewer`. New server kind `splat` in [server/media/mediaTypes.js](server/media/mediaTypes.js).
- **Long-job robustness — READY.** Adaptive history polling (1 s → 5 s), `maxRuntimeSec` deadline enforcement, and WS auto-reconnect already exist in [server/executor/jobExecutor.js](server/executor/jobExecutor.js) + [server/workers/comfyWsClient.js](server/workers/comfyWsClient.js). Not a blocker for the long-running 3D/video rows.

### Phase F — Multi-instance federation *(final phase — design locked 2026-05-16, implementation deferred)*

Final milestone of ComfyQ v2: let several ComfyQ instances on the same LAN auto-discover each other, expose a fleet-wide admin view (GPU / RAM / active workflow / queue per peer), and let students pick which rig to book against. Different machines run *different* workflows in parallel; students manually choose their station — there is no cross-instance job routing. Full plan lives at `~/.claude/plans/iridescent-wondering-lagoon.md`; key decisions captured below so the project's design intent travels with the repo.

**Architectural decisions (locked):**

- **Discovery: mDNS primary, static-peer list fallback.** Each instance publishes itself via [`bonjour-service`](https://www.npmjs.com/package/bonjour-service) on `_comfyq._tcp.local` and subscribes to the same service type. mDNS works out of the box on Win10+/macOS/Linux; Windows Firewall on UDP/5353 is the same friction as today's LAN access. A `federation.staticPeers: []` array in config covers (a) multicast-blocked workshop networks and (b) cross-subnet deployments. Peer records age out after `last_seen_at + 30s`.
- **Topology: peer-to-peer, no leader.** Every instance maintains its own peer map. No election, no SPOF, no quorum logic. Cheap on a workshop LAN (≤20 peers).
- **Cross-instance API: server-side aggregation, browser stays single-origin.** Each ComfyQ has new `/federation/*` routes that proxy / aggregate from peers. The browser never `fetch()`s a peer's HTTPS URL directly (each peer has a different self-signed cert; cross-peer browser calls would each need a separate cert click-through — bad UX). Node-to-Node peer traffic goes over HTTP to the bare Express port (3000) with `rejectUnauthorized: false` and an optional shared secret. When a student clicks "use Station B", a *new tab* opens to B's Vite URL — that tab gets its own one-time cert prompt.
- **Trust: optional cluster secret, defaults off.** Mirrors the existing admin-password pattern in [server/auth/authGate.js](server/auth/authGate.js). `federation.clusterSecret` unset → implicit LAN trust (acceptable for closed workshop networks). Set → every inter-instance HTTP call signs with `X-ComfyQ-Cluster-Secret`; receiving instance refuses mutating calls without it. mDNS broadcast itself stays unauthenticated — the secret only gates *commanding* peers, not *seeing* them.
- **Identity: persistent instance UUID + hostname + GPU + RAM.** New `instance.{id, hostname, gpu, vramGb, ramGb, cudaVersion}` block in config, generated on first boot. GPU / VRAM captured from ComfyUI's `/system_stats` at first `[Worker] WS connected` event (today they only land in `runtime.json` post-calibration, which is too late and too coupled). RAM from `os.totalmem()`.
- **New role: orchestrator** (in addition to today's runner). Orthogonal to the existing `mode: admin|student`. Set via `role: 'runner' | 'orchestrator'` in config. Orchestrator boots Express + Vite *without* a `LocalComfyUIWorker`, skips queue/executor/registry — pure control-plane node for an instructor laptop with no GPU. Two launchers: today's [start-comfyq.bat](start-comfyq.bat) (runner) and a new `start-comfyq-admin.bat` (orchestrator, sets `COMFYQ_ROLE=orchestrator` env var).
- **Backwards compat: federation entirely opt-in.** `federation.enabled: false` (default) → no mDNS publish, no subscribe, `/federation/*` returns `{ enabled: false }`. Today's single-instance behavior is unchanged at every phase.

**Phased delivery** (each phase shippable on its own; previous behavior preserved throughout):

- [ ] **F1 — Instance identity + system-info capture.** UUID + hostname + GPU + RAM + CUDA driver version persisted to config on first boot. `GET /admin/system-info` endpoint. "This machine" card in AdminConfig. No federation behavior yet — just the metadata that F2 will broadcast.
- [ ] **F2 — mDNS discovery + read-only `/federation/*` API.** Add `bonjour-service`. New `server/federation/federationService.js` owns the publish/subscribe loop, peer map, static-peer poller. Routes: `GET /federation/self`, `GET /federation/peers`, `POST /federation/peers/refresh`. Socket.IO `federation_update` event on peer-map changes.
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
git checkout v2
npm install
npm run dev
```

Then open `http://<host>:3000/admin`:

1. **ComfyUI Settings** — root path, python executable, output dir, VRAM budget, port.
2. **Add Workflow** (optional) — upload an API-format JSON. Or drop your saved API JSON directly into `workflows/<id>/<id>.api.json` next to the meta.
3. **Workflow library** — pick one → **Activate & start student mode**. Server restarts into student mode.
4. **Timeline** — book a job in the Scheduler. Watch progress; download the result.

Smoke checks per milestone are listed in each section above. Full end-to-end validation requires the user's lab box.
