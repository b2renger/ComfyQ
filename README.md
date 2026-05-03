# ComfyQ

**ComfyQ** is a web-based middleware for scheduling and managing ComfyUI workflow jobs in a multi-user (classroom / lab) environment. Users see a shared timeline, book generation slots, and watch their jobs run on a single ComfyUI instance with collision detection, real-time progress, and per-workflow configuration.

This is the **v2 rebuild**. v1 lives on the `main` branch; v2 lives on the `v2` branch and is the active line of development. See [implementation_plan.md](implementation_plan.md) for the full architecture, milestone breakdown, and progress.

---

## Highlights (v2)

- **Multi-workflow library** with folder-bundled workflows (`<id>/<id>.api.json` + `<id>.meta.json`)
- **API-format only.** No fragile Litegraph auto-conversion. The admin UI rejects non-API JSON with a clear "Save (API Format)" message
- **Generic output detection** — classifies by file extension (image / video / audio / model3d / json), not by `class_type`. Works with any save node, including LTX video, depth preprocessor temp outputs, and audio-driven workflows
- **Persistent job queue** (sqlite) — survives server restarts; in-flight jobs reconcile to `failed: server-restart` rather than hanging
- **Auto-reconnecting ComfyUI WebSocket** — jobs no longer get stuck in `processing` if ComfyUI restarts mid-run
- **Per-workflow timing** — BenchmarkService runs each workflow's warmup once and stores `estimatedDurationSec` for the timeline
- **Generic parameter detection** — surfaces every primitive widget on every node (no class_type whitelist), so new node types (Flux2, LTX, depth, custom LoRAs) can be exposed without code changes
- **Wire-compatible client** — `Scheduler`, `Dashboard`, `BookingDialog`, `MyJobsPanel` from v1 work against v2 unchanged

## Status

- ✅ **M0** — v2 skeleton runs Flux1 dev t2i. All architecture in place (queue, executor, worker abstraction, registry, media store, realtime bus, auth gate). End-to-end ComfyUI verification pending on the lab rig.
- ⏳ **M1** — real benchmark, image-edit, depth preprocessor.
- ⏳ **M2–M5** — see [implementation_plan.md](implementation_plan.md).

---

## Prerequisites

- Node.js v16+
- ComfyUI installed and able to run on the same machine. The lab targets RTX 3090 / 4080 / 4090 / 5090 with portable ComfyUI installs.
- C++ build tools available to npm (needed by `better-sqlite3`). On Windows: Visual Studio Build Tools or `windows-build-tools`.

## Install & run

```bash
git clone <repo>
cd ComfyQ
git checkout v2
npm install        # installs root + client + server deps
npm run dev        # concurrently starts server (port 3000) + client (vite)
```

Open `http://<host>:3000`. On first boot the server starts in **admin mode** (no ComfyUI launched) and redirects to `/admin`.

## First-run setup (admin)

1. **ComfyUI Settings** — set the ComfyUI root path, Python executable, output dir, ComfyUI API port, and VRAM budget for your GPU.
2. **Add Workflow** — upload an API-format JSON. To get one:
   - Open your workflow in ComfyUI.
   - Enable **Settings → Dev mode Options**.
   - Click **Save (API Format)**.
   - Drop the file into the upload box, or place it manually as `workflows/<id>/<id>.api.json`.

   v2 ships with two starter folders:
   - `workflows/flux1_dev_t2i/` — ready to run if you have `flux1-dev-fp8.safetensors`, `t5xxl_fp8_e4m3fn.safetensors`, `clip_l.safetensors`, `ae.safetensors`.
   - `workflows/flux2_klein_9b_t2i/` — placeholder slot; drop your saved Flux2 Klein 9B API workflow into it.
3. **Workflow library** — pick one → **Activate & start student mode**. The server restarts into student mode and launches (or attaches to) ComfyUI.
4. **(Optional) Admin password** — gate destructive cross-user actions (deleting / cancelling other users' jobs, restarting, resetting). Without one, anyone can do anything; fine for solo dev / trusted LAN, not for shared deployments.

## Daily use (student mode)

1. Open `http://<host>:3000` — you're routed to the timeline.
2. Set your username (stored in `localStorage`).
3. Click an empty timeline slot or **Schedule a job**, fill in the exposed parameters, **Book Slot**.
4. Watch progress in real time. Download the result from the recent generations grid or the timeline cell.

You can only move / cancel your own scheduled jobs. Cross-user actions require the admin password.

---

## Workflow folder layout

```
workflows/
└── flux1_dev_t2i/
    ├── flux1_dev_t2i.api.json         the workflow (API format, REQUIRED)
    ├── flux1_dev_t2i.meta.json        the metadata (REQUIRED for v2)
    ├── flux1_dev_t2i.config.meta.json (optional, per-deployment overrides — gitignored)
    └── flux1_dev_t2i.runtime.json     (optional, written by BenchmarkService — gitignored)
```

The `meta.json` is treated as read-only by the server. The admin UI never writes it; it only writes `config.meta.json` (overrides) and `runtime.json` (calibration). This keeps the original workflow export distinct from class-deployment tweaks.

See [implementation_plan.md](implementation_plan.md#schemas) for the full schema.

---

## Architecture (one-line tour)

```
HTTP/Socket.IO  →  RealtimeBus  →  JobExecutor  →  LocalComfyUIWorker  →  ComfyUI
                       │                                  │
                       ▼                                  ▼
                  JobQueue (sqlite)              ComfyRestClient + ComfyWsClient (auto-reconnect)
                       │
                       ▼
                  WorkflowRegistry  ──── reads ────▶  workflows/<id>/{api,meta,config-meta,runtime}.json
```

See [implementation_plan.md](implementation_plan.md#architecture) for module-by-module responsibilities and the job state machine.

---

## Troubleshooting

### `'better-sqlite3' build failed during install`
Native build tools missing. Install Visual Studio Build Tools (Windows) or `build-essential` + `python3` (Linux), then `npm install` again.

### `Litegraph format detected. ComfyQ v2 requires API format.`
You uploaded a workflow saved with the standard "Save" button. v2 deliberately does not auto-convert. Re-export with **Settings → Dev mode → Save (API Format)** in ComfyUI. (See [implementation_plan.md](implementation_plan.md#why-v2) for why.)

### `Workflow unavailable: Missing workflow file: <id>.api.json`
The folder `workflows/<id>/` has a `meta.json` but no API workflow. Drop your `<id>.api.json` next to the meta and click **Refresh** in the admin Workflow library.

### Server starts in admin mode unexpectedly
v2 archives v1 `config.json` files to `config.json.v1.bak` on first boot. If `comfy_ui.root_path` or `comfy_ui.python_executable` is empty, v2 won't start ComfyUI and falls back to admin mode. Set them in **Admin → ComfyUI Settings**.

### Job stuck in `processing` forever
v2 reconciles in-flight jobs to `failed: server-restart` on every server boot. If a job is genuinely stuck during a run, kill ComfyUI; the worker emits a failure event and the job moves to `failed: comfyui-process-exited`.

---

## Configuration

`config.json` (v2) is generated automatically and updated through the admin UI. Schema in [implementation_plan.md](implementation_plan.md#v2-configjson). It is per-deployment and not committed (see `.gitignore`).

A previous v1 config is automatically renamed to `config.json.v1.bak` on first boot.

## Development

```
npm run dev          # full stack (server with nodemon + client with vite)
npm run server       # server only
npm run client       # client only
```

Server logs appear in your terminal. ComfyUI stdout/stderr is forwarded with `[ComfyUI]` / `[ComfyUI!]` prefixes when ComfyQ launches it; if you have an external ComfyUI already running on the configured port, ComfyQ attaches to it without spawning its own.

## Acknowledgments

- [ComfyUI](https://github.com/comfyanonymous/ComfyUI)
- [vis-timeline](https://visjs.github.io/vis-timeline/docs/timeline/)
- [Lucide React](https://lucide.dev/)
