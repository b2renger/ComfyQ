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
- **Real per-workflow timing** — `BenchmarkService` runs each workflow's warmup and stores `estimatedDurationSec` measured from the *first sampler step* (model/VAE load excluded), so the timeline reflects the recurring per-job cost. Built-in reference image lets image-edit workflows calibrate without prep
- **Calibration captures the GPU** — `runtime.json` records which CUDA device achieved the measured time. The admin workflow card shows it (e.g. `NVIDIA GeForce RTX 5090`) so you know whether to re-calibrate after moving to a different rig
- **Reorder parameters in the workflow editor** — per-row ▲/▼ buttons in the metadata editor reorder exposed parameters. Position chips (`#1, #2 …`) reflect the live order; the saved `order` field follows admin intent, so students see fields in exactly the order set in admin
- **Generic parameter detection** — surfaces every primitive widget on every node (no class_type whitelist), so new node types (Flux2, LTX, depth, custom LoRAs) can be exposed without code changes
- **Workflow description visible to students** — the admin's Description field renders on the main Scheduler header AND at the top of the booking dialog, so prompting tips show up exactly when students need them
- **Admin workflow editor** — drag-and-drop API JSON → auto-scaffold meta → modal editor lets you toggle parameter exposure, rename labels, set defaults, change types (with bulk "Hide infrastructure" / "Enable all" / "Disable all"). Onboard a workflow in under a minute
- **Per-workflow card actions** — Calibrate / Edit / Delete on each workflow in the admin library. Confirmation modal on delete; active workflow can't be deleted accidentally
- **My / All Jobs tabs** — Recent Generations defaults to the current user; an "All Jobs" tab plus per-user filter dropdown exposes everyone's results for the admin / room view. Sidebar shows only your own jobs
- **Confirmation dialogs with admin-password gating** — deletes / cancels go through a proper modal. Own jobs: simple confirm. Foreign jobs: admin-password field required, with red toasts surfacing wrong-password / "password not set" rejections from the server. Cross-user actions are disabled outright when no admin password is configured
- **Cancel running jobs** — X button on your own in-flight job card REST-interrupts ComfyUI cleanly; the job lands in `cancelled` state (preserved as a record, not deleted)
- **Clean all outputs** — admin button purges every output file on disk for terminal jobs and clears the `outputs` field, keeping job history. Skips in-flight jobs
- **Emergency stop** — one button cancels every job, kills ComfyUI (only what we spawned), and restarts in admin mode
- **File uploads for image/video inputs** — any `image`- or `video`-typed workflow parameter renders an upload widget: click to browse or drag-and-drop a file. The drop zone highlights while a file hovers and rejects mismatched MIME types. On a phone the OS file picker itself offers "Take Photo", so camera input still works without any in-app webcam code
- **Resize-before-upload** — every uploaded image is downscaled to `maxInputEdge` (default 1024 px, overridable per parameter in the admin workflow editor) before it leaves the browser. No more 12 MP phone photos crawling through the diffusion pipeline
- **Plain-HTTP dev server** — Vite serves HTTP and proxies the backend, so the page, REST, and websocket all share one origin with zero certificate friction — identical on Safari, Chrome, and phones. (A self-signed HTTPS cert can't be trusted across a BYOD workshop without installing a CA on every device)
- **Light + dark mode** — sober grayscale palette, sun/moon toggle in the nav. First visit honors `prefers-color-scheme`; selection persists to `localStorage`. Dark mode is the polished default; light mode is functional v0 (some hardcoded utility classes still need migration to semantic `text-foreground`)
- **Per-user colors** — every student is mapped via FNV-1a hash to one of 12 curated hues, surfaced on the timeline stripe, grid cards, and sidebar so the same user is visually grouped at a glance
- **Prompt search** — case-insensitive substring across `prompt` + `user_id` on the main grid; prompt-only on the MyJobs sidebar
- **Headline-prompt resilience** — workflows that expose their text input under a non-`prompt` key (LTX i2v `positive_prompt`, primitive-fallback `text`, …) still display the user-typed text on cards / lightbox / search. Fix is two-sided: client picks the right key at submit time; render-time fallback mines `job.params` for historical rows
- **Branded mark** — favicon and inline header glyph are a sober "Q" (ring + bold tilde wave bar). Distinct from a magnifier icon and reads as "queue / flow"
- **Workshop-rig defaults** — `defaultConfig()` ships with the standard portable-ComfyUI paths pre-filled, so a freshly cloned classroom machine lands with all three paths populated; **Check paths** validates them in-place (root, main.py, python `--version`, output writability) and **Reset to defaults** repopulates the form one-click
- **Hardened ComfyUI spawn** — matches `run_nvidia_gpu.bat`: `python.exe -s main.py --windows-standalone-build --disable-auto-launch …`. The Node parent's Python/conda env vars (`PYTHONPATH`, `PYTHONHOME`, `VIRTUAL_ENV`, `CONDA_PREFIX`, etc.) are stripped and conda-prefix directories are scrubbed from `PATH` before spawn, so an active `(base)` shell can no longer drag a CPU-only torch into the portable runtime
- **Verbose generation logs** — every job pickup logs workflow + params + inputs; sampler progress is throttled to 2s + first/last step; node transitions, completion duration, output filenames, and failure phase/reason all surface on the server console
- **Live-time timeline** — auto-follows current time with a sliding window; auto-disables when you pan
- **Random seed by default** — every BookingDialog re-rolls the seed automatically; dice icon re-rolls; manual entry still works
- **Recall settings** — "Use these settings" on any completed job re-opens a fresh dialog pre-filled with the job's prompt and parameters
- **Per-job workflow chip** — every recent-generations card, sidebar row, and lightbox shows which workflow produced the image
- **Wire-compatible client** — `Scheduler`, `Dashboard`, `BookingDialog`, `MyJobsPanel` from v1 work against v2 unchanged

## Status

- ✅ **M0 (verified on rig — RTX 5090)** — Flux1 dev t2i smoke fixture, plus Flux2 Klein 9B t2i, image-edit, and image-edit-with-reference all run end-to-end.
- ✅ **M1 (mostly complete)** — real benchmark (with cold/warm split), Flux2 image-edit (1- and 2-image variants), image upload pipeline, admin workflow editor, calibrate/delete/edit per-card actions, emergency stop. Depth preprocessor + temp/ media routing deferred to M3.
- 🚧 **M2 (active)** — Phase 2 (job mgmt: colors, prompt search, CSV export) + Phase 3 (real-time progress visualization, ETA badge).
- 🟡 **M4** — Media capture. File upload (click + drag-and-drop) with client-side resize is the supported path. The webcam / `getUserMedia` capture path (M4-2) was **removed 2026-05-19** — it needed an HTTPS secure context the workshop's plain-HTTP setup can't provide; phones still get camera input via the OS file picker's "Take Photo".
- ⏳ **Target workflows** — exercise the primitive-fallback parser against real workshop workflows: Hunyuan3D 2.1, Qwen image-to-multiview, music (ACE), LTX 2.3 video-from-reference, LTX audio-driven, 360 video LoRA. Each row is a probe into "does ComfyQ stay zero-config when a new workflow lands?" — fixes land generally, not per-workflow.
- ⏳ **Phase F — Multi-instance federation** *(final phase, design locked, implementation deferred)* — auto-discover peers on the LAN via mDNS, fleet-wide admin view (GPU / RAM / active workflow / queue per peer), student picker to pick a workshop station, optional orchestrator role for an instructor laptop with no GPU. Six sub-phases F1–F6, each shippable on its own; full design in [implementation_plan.md](implementation_plan.md#phase-f--multi-instance-federation-final-phase--design-locked-2026-05-16-implementation-deferred).

---

## Prerequisites

- **Node.js 24 LTS ("Krypton")** — the supported version, pinned in [.nvmrc](.nvmrc). Node 22 LTS ("Jod") also works. ComfyQ deliberately tracks an **LTS** line for broad machine compatibility; the odd-numbered "Current" releases (23, 25, …) are not supported and `engines` will warn on them. With [nvm](https://github.com/nvm-sh/nvm) or [fnm](https://github.com/Schniz/fnm), run `nvm use` / `fnm use` in the repo root to pick up `.nvmrc` automatically.
- ComfyUI installed and able to run on the same machine. The lab targets RTX 3090 / 4080 / 4090 / 5090 with portable ComfyUI installs.
- C++ build tools available to npm — only needed as a **fallback** for `better-sqlite3`. On Node 24/22 LTS it ships an N-API prebuilt binary (no compile), so most machines need nothing extra. If a prebuild isn't available for your platform, the install falls back to compiling from source: on Windows that needs Visual Studio Build Tools (C++ workload).

## Install & run

```bash
git clone <repo>
cd ComfyQ
git checkout v2
npm install        # installs root + client + server deps
npm run dev        # concurrently starts server (port 3000) + client (vite, HTTP)
```

Open **`http://localhost:5173`** (or one of the `http://<lan-ip>:5173` URLs printed at boot). Vite serves plain HTTP and proxies the backend, so the page, the API, and the websocket all share a single origin. No certificate, no warning — students just open the URL. On first boot the server starts in **admin mode** (no ComfyUI launched) and redirects to `/admin`.

> Why plain HTTP? A self-signed HTTPS cert can't be trusted across Safari + Chrome + phones in a BYOD workshop without installing a CA root on every device — and Safari won't even extend a click-through to the websocket or to downloads. HTTP removes all of that. The only feature HTTPS would have enabled — in-browser webcam capture (`getUserMedia`) — has been removed; image/video inputs are uploaded as files instead (a phone's file picker still offers "Take Photo").

## First-run setup (admin)

1. **ComfyUI Settings** — set the ComfyUI root path, Python executable, output dir, ComfyUI API port, and VRAM budget for your GPU.

   On a freshly cloned workshop rig, all three paths are **pre-filled** to the standard portable-ComfyUI layout (`D:\ComfyUI_windows_portable_nvidia\ComfyUI_windows_portable\…`). If they don't match your install, edit them or click **Reset to defaults** to repopulate. Click **Check paths** to validate before saving — it verifies the root contains `main.py`, runs `python --version`, and confirms the output directory is writable, listing each result inline.

   For a Windows portable ComfyUI install, the `root_path` must point at the directory containing `main.py`, **not** the wrapper folder. With a typical install that's `...\ComfyUI_windows_portable\ComfyUI` (and `python_executable: ../python_embeded/python.exe`, or absolute).
2. **Add Workflow** — drag-and-drop an API-format JSON into the upload box. To get one from ComfyUI:
   - Open your workflow.
   - Enable **Settings → Dev mode Options**.
   - Click **Save (API Format)**.

   On upload the server runs the primitive-fallback parser and auto-creates `workflows/<id>/<id>.api.json` + `<id>.meta.json` exposing every detected widget. A modal editor opens immediately so you can:
   - Click **Hide infrastructure** to drop model-path / weight-dtype / device fields.
   - Tweak labels and defaults for the params students should see.
   - Pick a category (`t2i`, `image-edit`, …).

   You can re-open the editor any time via the pencil icon on the workflow card.

   v2 ships with three Flux2 Klein 9B starter workflows (validated on RTX 5090):
   - `workflows/flux2_klein_9b_t2i/` — text to image
   - `workflows/flux2_klein_9b_image_edit/` — single image edit
   - `workflows/flux2_klein_9b_image_edit_ref/` — image edit with reference image

   All three need: `flux-2-klein-base-9b-fp8.safetensors` (UNET), `flux2-vae.safetensors` (VAE), `qwen_3_8b_fp8mixed.safetensors` (CLIP) in the corresponding `<comfy_root>/models/` subfolders.
3. **Workflow library** — pick one → **Activate & start student mode**. The server restarts into student mode and launches (or attaches to) ComfyUI.
4. **Calibrate** (optional but recommended) — click the gauge icon on a workflow card. ComfyQ runs one warmup, measures generation time *excluding* model loading, and writes `<id>.runtime.json`. The timeline cell length will then reflect actual run time. For workflows with image inputs, ComfyQ supplies a built-in reference image — no setup needed.
5. **(Optional) Admin password** — required for any cross-user destructive action (deleting / cancelling another student's job, restarting, resetting, cleaning outputs). **Without a password set, cross-user deletes are refused entirely** — you can still manage your own jobs, but you can't interfere with anyone else's. Set one for classroom deployments.

### Operational controls (admin header)

- **Reset to admin** — flips back to admin mode without killing ComfyUI; useful when you want to swap workflows without disturbing the GPU process.
- **Stop & kill all** — emergency stop. Cancels every scheduled job, marks every in-flight job FAILED, REST-interrupts ComfyUI, kills the process if ComfyQ spawned it, and restarts in admin mode. Confirmation modal lists exactly what will happen.
- **Clean all outputs** (in the Admin page Cleanup card) — purges every output file on disk for terminal jobs and clears the `outputs` field in the DB. Job records are kept so prompt history survives. In-flight jobs are skipped so a running collector isn't disrupted.

## Daily use (student mode)

1. Open `http://<host>:3000` — you're routed to the timeline. The active workflow's name and description (admin-edited prompting tips) appear in the header.
2. Set your username (stored in `localStorage`).
3. The timeline auto-follows current time (10 min back / 50 min ahead). Click an empty slot or **Schedule a job**, fill in the exposed parameters, **Book Slot**. The booking dialog repeats the workflow description at the top so you can reference it while typing your prompt.
   - The seed field auto-randomizes each time the dialog opens; click the dice icon to re-roll, or type a specific value to pin it.
4. Watch progress in real time. Each card / sidebar entry / lightbox shows which workflow produced it.
5. Recent Generations defaults to **My Generations** (your own results only). Switch to **All Jobs** to see everyone's work; use the user dropdown to filter to one specific contributor. The sidebar always shows just your own jobs.
6. Click any completed card to open the lightbox. **Use these settings** re-opens the booking dialog pre-filled with that job's prompt and parameters (image inputs must be re-uploaded — session uploads are TTL-cleaned).
7. Delete your own scheduled jobs (cancels the job) or completed images (also unlinks the file from disk) via the X on each card. The same X button on a **running** job interrupts ComfyUI and moves the job to `cancelled` (the record is kept; the X reappears so you can also delete it). A confirmation dialog appears for every destructive action.

Deleting / cancelling **another user's job** opens the same dialog with an admin-password field. The server refuses cross-user actions outright when no admin password is configured.

---

## Workflow folder layout

```
workflows/
└── flux2_klein_9b_t2i/
    ├── flux2_klein_9b_t2i.api.json         the workflow (API format, REQUIRED)
    ├── flux2_klein_9b_t2i.meta.json        the metadata (REQUIRED for v2)
    ├── flux2_klein_9b_t2i.config.meta.json (optional, per-deployment overrides — gitignored)
    └── flux2_klein_9b_t2i.runtime.json     (optional, written by BenchmarkService — gitignored)
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
On Node 24/22 LTS, `better-sqlite3` (v12+) normally installs a prebuilt N-API binary with no compilation. If you see this error you're either on an **unsupported Node version** (check `node --version` against [.nvmrc](.nvmrc) — run `nvm use`/`fnm use`) or on a platform with no prebuild, which falls back to a source build. For the source build, install the native toolchain: Visual Studio Build Tools with the C++ workload (Windows) or `build-essential` + `python3` (Linux), then `npm install` again.

### `npm WARN EBADENGINE Unsupported engine` (or wrong Node version)
ComfyQ targets an LTS Node line (24 "Krypton", or 22 "Jod"). If you're on an odd-numbered "Current" release like 23 or 25, npm warns and behavior is unsupported. Switch with `nvm use` / `fnm use` (reads [.nvmrc](.nvmrc)), or install Node 24 LTS from [nodejs.org](https://nodejs.org/).

### `Litegraph format detected. ComfyQ v2 requires API format.`
You uploaded a workflow saved with the standard "Save" button. v2 deliberately does not auto-convert. Re-export with **Settings → Dev mode → Save (API Format)** in ComfyUI. (See [implementation_plan.md](implementation_plan.md#why-v2) for why.)

### `Workflow unavailable: Missing workflow file: <id>.api.json`
The folder `workflows/<id>/` has a `meta.json` but no API workflow. Drop your `<id>.api.json` next to the meta and click **Refresh** in the admin Workflow library.

### Server starts in admin mode unexpectedly
v2 archives v1 `config.json` files to `config.json.v1.bak` on first boot. If `comfy_ui.root_path` or `comfy_ui.python_executable` is empty, v2 won't start ComfyUI and falls back to admin mode. Set them in **Admin → ComfyUI Settings**.

### `Python executable not found: ...\python_embeded\python.exe` (or similar)
The portable ComfyUI bundle nests `main.py` inside a `ComfyUI/` subdirectory. Set `root_path` to the inner folder (e.g. `F:\ComfyUI_windows_portable_nvidia\ComfyUI_windows_portable\ComfyUI`), **not** the wrapper. With that root, `python_executable: ../python_embeded/python.exe` resolves correctly.

### Activating a workflow does nothing / server stuck after "Exiting for restart"
Make sure you're running with `npm run dev` (which uses nodemon). v2's `exitForRestart()` bumps the mtime of `server/index.js` so nodemon's watcher picks it up; if you've replaced nodemon with a different supervisor, point it at `server/` and trigger restart on file change.

### Job stuck in `processing` forever
v2 reconciles in-flight jobs to `failed: server-restart` on every server boot. If a job is genuinely stuck during a run, click **Stop & kill all** in admin (cancels every job + kills ComfyUI + restarts in admin mode), or kill ComfyUI manually — the worker emits a failure event and the job moves to `failed: comfyui-process-exited`.

### Sampling is hundreds of times slower when ComfyQ spawns ComfyUI than when you launch it standalone
Symptom: 800+ s/iter on a high-end GPU; nvidia-smi shows the model loaded but no GPU activity. Almost always a Python environment leak: the Node/nodemon parent inherits a conda or venv activation, and the activated env's `site-packages` shadows the portable's torch with a CPU-only or wrong-CUDA build. ComfyQ now strips `PYTHONPATH`, `PYTHONHOME`, `PYTHONSTARTUP`, `VIRTUAL_ENV`, `CONDA_PREFIX`, `CONDA_DEFAULT_ENV`, `CONDA_PROMPT_MODIFIER`, `CONDA_SHLVL`, `CONDA_PYTHON_EXE` before spawn and scrubs any conda-prefix directories from `PATH`. Watch for `[ComfyProcess] Stripped env vars: …` and `[ComfyProcess] Removed N env-prefix entries from PATH` near the spawn line — if anything is listed, that was the culprit. Cleanest long-term fix: launch ComfyQ from a shell with no conda/venv active.

### Sampling stalls / no step progress on a near-VRAM-budget model (LTX-AV, Flux2 9B at high res)
ComfyQ does **not** pass `--highvram` to ComfyUI. On a 24 GB card running a 23.8 GB model, `--highvram` forces full-load mode, which then thrashes against the text encoder (~11 GB) on every step. The default dynamic-VRAM loader (what `run_nvidia_gpu.bat` uses) handles near-budget models far better. If your rig has 48+ GB of VRAM and you specifically want the perf bump from highvram, edit [server/workers/comfyProcess.js](server/workers/comfyProcess.js) and add `'--highvram'` back to `comfyArgs`.

### A ComfyUI browser tab pops open every time the server spawns ComfyUI
ComfyQ passes `--disable-auto-launch`. If you still see the tab, you're either attached to an external ComfyUI instance (start ComfyQ first, then it spawns its own) or your ComfyUI build ignores the flag — verify with the spawn line in the server log.

### How do students get a photo into an image-input workflow?
Image and video parameters render a file-upload widget — click to browse or drag-and-drop. There's no in-app webcam capture (removed 2026-05-19; it needed an HTTPS secure context the plain-HTTP workshop setup can't provide). On a phone the OS file picker offers **Take Photo** directly, so camera input still works; on desktop, drag in any image file.

### `/admin` shows a blank page or 404
The `/admin` path is overloaded — the SPA owns the bare path, the Express API owns every sub-path (`/admin/mode`, `/admin/config`, …). Vite's proxy needs a `bypass` hook to let the bare path fall through to the SPA; we ship one in [client/vite.config.js](client/vite.config.js). If you ever see a 404 here, check that vite.config.js still has the `bypass(req)` handler on the `/admin` proxy entry. The fix only takes effect after a dev-server restart (`Ctrl+C`, then `npm run dev` — HMR doesn't pick up vite.config.js changes).

### Workflow validation: `Invalid image file: <filename>`
ComfyUI couldn't find that filename in its `input/` directory. Two common causes: (1) the workflow's hardcoded default doesn't exist on this rig — re-upload an image via the BookingDialog before submitting, or (2) the file was swept by the input-retention TTL (default 30 min). Re-upload to refresh.

### Calibration: `Cannot calibrate: video|audio input "<key>" has no warmupParams entry`
Calibration auto-substitutes a built-in reference PNG for image inputs but can't ship sample video/audio. Add a representative filename to `meta.warmupParams` for that key (the file must exist in `<comfy_root>/input/`).

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
