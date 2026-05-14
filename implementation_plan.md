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

### M1 — Real BenchmarkService + Flux2 image-edit (✅ COMPLETE)

- [x] `BenchmarkService` runs a real warmup and writes `<id>.runtime.json` with `estimatedDurationSec`, `samplesPerSec`, `coldDurationSec`, and `modelLoadSec`.
- [x] `estimatedDurationSec` measures **generation only** — anchored on the first sampler progress event so model/VAE/CLIP load time is excluded. The recurring per-job cost (sampling + decode + save) is what the timeline shows.
- [x] Calibration ships a built-in 512×512 reference PNG (`__comfyq_calibration.png`) so workflows with image inputs can be calibrated without admin-uploaded sample media. Video/audio inputs throw a clear error pointing the admin at `meta.warmupParams`.
- [x] Scheduler timeline uses per-workflow estimate (no global 60 s).
- [x] Flux2 image-edit (1-image and 2-image variants) registered and validated on rig.
- [x] `BookingDialog` image upload: media-typed exposed parameters render as drag-and-drop upload widgets; uploaded files land in `<comfy_root>/input/` with a `comfyq_session__` prefix and TTL sweep.
- [x] Worker `_materializeWorkflow` injects `paramValues` for image/video/audio fields into their nodes (was previously skipped, breaking image-edit submissions).
- [ ] Depth preprocessor fixture + `MediaStore` validation against `temp/`. (Deferred to M3.)

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

### M2 — Phase 2 (job mgmt) + Phase 3 (real-time progress)

- [ ] `MyJobs.jsx`: deterministic user colors, prompt search, date filter, CSV export from `/jobs?since=…&until=…`.
- [ ] `ProgressViz`, `ETABadge` driven by `samplesPerSec` × steps remaining.
- [ ] AuthGate enforced on cross-user `delete_job` / `cancel_job`.

### M3 — LTX 2.3 video-from-reference + long-job support

- [ ] Per-workflow `maxRuntimeSec` honored; adaptive history polling (1 s × 60 s, then 5 s up to budget).
- [ ] WS `executed` short-circuits polling.
- [ ] `MediaStore` proven with `video/mp4`; client `MediaPlayer` selects `<video controls>` by kind.
- [ ] `ModelLifecycle` calls ComfyUI `/free` on workflow switch when VRAM budget would be exceeded.

### M4 — Phase 4 (webcam / mobile capture) + 360 video LoRA

- [ ] `WebcamCapture.jsx`: getUserMedia, mobile-friendly (rear camera default).
- [ ] 360 video LoRA workflow registered. Verify primitive-fallback parser surfaces `LoraLoader` `lora_name` / `strength_model` / `strength_clip` without a whitelist.

### M5 — Audio I/O + LTX audio-driven

- [ ] `inputUploader` extended for audio kinds.
- [ ] `AudioRecorder.jsx`: in-browser recording with WebAudio → wav re-encode.
- [ ] LTX audio-driven workflow registered; output verified as both audio and video on different nodes.
- [ ] `MediaPlayer` audio branch.

---

## Open risks / decisions still to nail down

1. **ComfyUI `/free` semantics** on the lab build — if it forces a model reload even back-to-back same-workflow, ModelLifecycle should only free on workflow-switch (current default). Validate at M3 with a back-to-back same-workflow timing comparison.
2. **`temp/` directory cleanup** — ComfyUI may not clean its own temp. Recommended: copy temp outputs to a ComfyQ-managed output folder at completion. Confirm at M1.
3. **Webcam blob format on iOS Safari** — getUserMedia may yield webm but workflows expect png/jpg. Need client-side canvas re-encode in `WebcamCapture.jsx`. Validate at M4.
4. **MediaRecorder audio format Firefox vs Chrome** — encodings differ; LTX audio model may want wav. Decision: WebAudio decode → wav re-encode (`audiobuffer-to-wav`). Validate at M5.
5. **Job replay across workflow versions** — we don't replay; jobs are immutable history. Store `workflowVersion` on the job and badge in MyJobs.
6. **AuthGate scope** — currently gates `delete_job(other_user)`, `reset-to-admin`, `restart-server`, `cancel_job(other_user)`, `restart`, `upload-workflow`, `:id/calibrate`, `:id/config-meta`. Re-review during M2.
7. **WS reconnection while a job is executing** — REST `/history` is the source of truth; WS gap should not interrupt polling. Confirm at M3.
8. **Timeline collision with variable durations** — collision check uses each job's own workflow `estimatedDurationSec`. When unbenched, falls back to `meta.json.estimatedDurationSec` seed; never to a hard-coded 60 s.
9. **Multi-output download UX** — LTX-audio job has both video + audio outputs. MyJobs lists all; timeline cell shows aggregated count + first thumbnail. Verify visually at M5.
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
