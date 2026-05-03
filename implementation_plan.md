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
│   ├── WorkflowSelector.jsx             ported from poc2, rewired to /workflows/*
│   ├── BookingDialog.jsx                unchanged for M0
│   ├── MyJobsPanel.jsx                  unchanged for M0
│   ├── UsernameModal.jsx                unchanged for M0
│   ├── ImageLightbox.jsx                unchanged
│   └── admin/                           legacy v1 components, no longer imported
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

Currently shipping:
- `workflows/flux1_dev_t2i/` — ready-to-run smoke fixture
- `workflows/flux2_klein_9b_t2i/` — meta.json + README placeholder; drop in your saved API workflow

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

### M0 — v2 skeleton runs Flux1 dev t2i (✅ COMPLETE)

Smallest functional v2 covering only t2i, on the new architecture.

- [x] Branch `v2` cut from `main`. Old v1 modules deleted.
- [x] New deps installed: `better-sqlite3`, `zod`, `mime-types`, `bcryptjs`, `multer`, `form-data`.
- [x] Implemented: `configManager`, `schemas`, `workflowRegistry`, `workflowParser` (primitive-fallback), `workflowValidator`, `jobQueue` (sqlite), `jobStateMachine`, `jobExecutor`, `outputCollector` (generic), `workerInterface`, `localComfyUIWorker` + helpers, `comfyWsClient` (reconnection), `mediaStore`, `realtimeBus`, `authGate`, `benchmarkService`.
- [x] Routes: `admin`, `workflows`, `jobs`, `uploads`.
- [x] Test fixtures: `workflows/flux1_dev_t2i/` + `workflows/flux2_klein_9b_t2i/` (placeholder).
- [x] Client: `WorkflowSelector` ported, `AdminConfig` rewired. `BookingDialog`, `Scheduler`, `Dashboard` kept wire-compatible.
- [x] Jobs persist across server restart; queue reconciles in-flight jobs to `failed: server-restart` (smoke-test passing).

**Verified locally (no ComfyUI):**
- All 26 server modules pass `node --check`.
- Server boots in admin mode, archives any v1 `config.json` to `.v1.bak`.
- `GET /admin/mode`, `/admin/config`, `/workflows`, `/workflows/:id`, `/workflows/:id/parameters`, `/workflows/:id/presets/:name` respond correctly.
- Unavailable workflow (missing `.api.json`) returns 409 with the reason.
- `PUT /admin/comfy` persists ComfyUI paths to `config.json`.
- Sqlite reconciliation: `executing` job → `failed: server-restart` after a simulated restart.

**Pending on RTX rig (M0 acceptance criteria):** Tracked in [manual_tests.md](manual_tests.md) — tests M0-1 through M0-10. Don't start M1 implementation until they all pass.

### M1 — Real BenchmarkService + Flux2 image-edit + Depth preprocessor

- [ ] `BenchmarkService` runs real warmup; writes `<id>.runtime.json` with `estimatedDurationSec` + `samplesPerSec`.
- [ ] Scheduler timeline uses per-workflow estimate (no global 60 s).
- [ ] Add `flux2_klein_image_edit/` and `depth_preprocessor/` fixtures.
- [ ] `inputUploader` namespaces inputs to `comfyq__<jobId>__<original>`; rewrites LoadImage nodes; cleanup keyed on `jobId` + 30-min TTL.
- [ ] `BookingDialog` gains image upload field.
- [ ] `MediaStore` reads from `output/` AND `temp/` (depth preprocessors).

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
