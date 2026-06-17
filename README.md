# ComfyQ

**ComfyQ** is a web-based job scheduler and workflow manager for [ComfyUI](https://github.com/comfyanonymous/ComfyUI) in multi-user environments (classrooms, labs, studios). It solves the problem of scheduling access to expensive GPU-bound generative-AI workflows when multiple students or researchers compete for a single GPU.

> **Branch:** the active code is the **v2** rebuild, which now lives on the default **`main`** branch — just clone and go, no branch switch needed. (The original v1 monolith is preserved on the `poc1` / `poc2` branches; the old `v2` development branch is now behind `main` and no longer maintained.)

## What it does

- **Timeline-based booking:** Students see a shared schedule, pick an empty slot, submit parameters (text prompt, images, video clips, audio), and watch generation happen in real time with live progress bars and ETAs.
- **Zero-config workflows:** Drop any ComfyUI workflow in (API format), the system auto-detects inputs/outputs (images, video, audio, 3D models), exposes parameters to students, renders results in the right viewer (3D model rotator, Gaussian-splat viewer, audio player, multi-image gallery).
- **Admin controls:** Configure ComfyUI paths, calibrate per-workflow timing, upload new workflows, reorder exposed parameters, set an admin password for destructive actions.
- **Persistent job queue:** Jobs survive server restarts; in-flight work reconciles safely. Full history is kept for reference and re-running past parameters.
- **Multi-output UX:** Workflows that produce many files (3D generation, multi-angle scenes, audio+video) get dedicated galleries — students navigate and download each output separately.
- **Collision avoidance:** Jobs queue safely; no overlapping work. Emergency stop cancels all jobs and restarts ComfyUI if something goes wrong.

## Quick start

**Prerequisites:**
- **Node.js 24 LTS** (or 22 LTS) — see [Prerequisites](#prerequisites) below for the full rationale
- **ComfyUI** installed and able to run on the same machine
- C++ build tools (only needed as a fallback for `better-sqlite3`; prebuilds ship for Node 24/22 LTS)

**Installation & boot:**

```bash
git clone <repo>
cd ComfyQ
npm install        # also installs client + server deps (via postinstall)
npm run dev        # Express API (:3000) + Vite client (:5173), both plain HTTP
```

Open **`http://localhost:5173`** in a browser. On first boot, the server starts in **admin mode** (`/admin`) — configure your ComfyUI paths there, add/activate a workflow, then flip to student mode. Students book jobs via the Timeline; jobs run on ComfyUI and results appear in the grid.

See **[First-run setup (admin)](#first-run-setup-admin)** below for detailed steps including path validation and workflow onboarding.

---

## Status

- ✅ **M0** *(verified on rig — RTX 5090)* — Flux2 Klein 9B t2i, image-edit, and image-edit-with-reference all run end-to-end.
- ✅ **M1** — Real benchmark (cold/warm split), image upload pipeline, admin workflow editor, calibrate/delete/edit per-card actions, emergency stop.
- ✅ **M2** *(complete 2026-05-16)* — Job management (user colors, prompt search, CSV export) + real-time progress visualization (ETA badge, sampler progress).
- ✅ **M4** — File upload (click + drag-and-drop) with client-side image resize. Webcam capture removed 2026-05-19 (plain HTTP, no secure context); phones use OS file picker.
- ✅ **Audio I/O** — Output: audio player in cards + lightbox. Input: audio upload widget (`audio/*` file picker + drag-drop).
- ✅ **3D viewers** — GLB model viewer (three.js) + Gaussian-splat viewer (Spark), both in lightbox + cards with export buttons.
- ✅ **Target workflows** *(bundled in `workflows/`; TripoSplat verified on rig 2026-06-10, LivePortrait on 2026-06-15, SAM3 segmentation on 2026-06-16 FILM frame interpolation and SeedVR2 upscalers on 2026-06-17, the rest registered through 2026-06-13 and pending rig smoke-test):*
  - TripoSplat (image → `.spz` + `.ply` + `.glb`) — **verified on rig**
  - Qwen-Edit multi-angle (1 image → 8 angle images, N-image gallery)
  - Stable Audio 3 (text → `.mp3`, in-graph magic-prompt LLM)
  - Ideogram 4.0 t2i (structured-JSON prompt)
  - Wan 2.1 360° rotate LoRA (image → video)
  - LTX 2.3 i2v (image → video)
  - LTX 2.3 FLF2V (first + last frame → video with audio)
  - LTX 2.3 IC-LoRA vid2vid (video + reference image → depth-guided restyle + audio; first **video** input)
  - LTX 2.3 ID-LoRA (character image + reference audio → lip-synced talking video; first **audio** input)
  - LivePortrait (portrait image + driving video → animated talking-head video; first **image + video** input) — **verified on rig**
  - SAM3 video segmentation (video + text prompt → black/white mask/matte video; first **preprocessor** workflow) — **verified on rig**
  - Frame interpolation (FILM) (video → smoother or slow-motion video; `preprocessor` utility) — **verified on rig**
  - SeedVR2 image upscale to 4K (diffusion super-resolution; first **i2i** workflow) — **verified on rig**
  - SeedVR2 video upscale to HD (diffusion super-resolution; keeps source fps + audio) — **verified on rig**
- ⏳ **Phase F** — Multi-instance federation *(final phase, design locked, implementation deferred).* Auto-discover peers on LAN via mDNS, fleet-wide admin view, student station picker. See [implementation_plan.md](implementation_plan.md#phase-f--multi-instance-federation-final-phase--design-locked-2026-05-16-implementation-deferred).

---

## Prerequisites

- **Node.js 24 LTS ("Krypton")** — the supported version, pinned in [.nvmrc](.nvmrc). Node 22 LTS ("Jod") also works. ComfyQ deliberately tracks an **LTS** line for broad machine compatibility; the odd-numbered "Current" releases (23, 25, …) are not supported and `engines` will warn on them. With [nvm](https://github.com/nvm-sh/nvm) or [fnm](https://github.com/Schniz/fnm), run `nvm use` / `fnm use` in the repo root to pick up `.nvmrc` automatically.
- ComfyUI installed and able to run on the same machine. The lab targets RTX 3090 / 4080 / 4090 / 5090 with portable ComfyUI installs.
- C++ build tools available to npm — only needed as a **fallback** for `better-sqlite3`. On Node 24/22 LTS it ships an N-API prebuilt binary (no compile), so most machines need nothing extra. If a prebuild isn't available for your platform, the install falls back to compiling from source: on Windows that needs Visual Studio Build Tools (C++ workload).

## Install & run

```bash
git clone <repo>           # the default `main` branch is the active line
cd ComfyQ
npm install        # postinstall also installs client + server deps
npm run dev        # concurrently starts server (port 3000) + client (vite :5173, HTTP)
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

   The repo bundles a **Flux2 Klein 9B starter set** (validated on RTX 5090):
   - `workflows/flux2_klein_9b_t2i/` — text to image
   - `workflows/flux2_klein_9b_image_edit/` — single image edit
   - `workflows/flux2_klein_9b_image_edit_ref/` — image edit with reference image

   All three need: `flux-2-klein-base-9b-fp8.safetensors` (UNET), `flux2-vae.safetensors` (VAE), `qwen_3_8b_fp8mixed.safetensors` (CLIP) in the corresponding `<comfy_root>/models/` subfolders.

   It also bundles the **target workshop workflows** (TripoSplat, Qwen multi-angle, Stable Audio 3, Ideogram 4.0, Wan 360°, and the LTX 2.3 family — see [Status](#status)). Each needs its own models in `<comfy_root>/models/`; the workflow card shows `Unavailable` until they're present. Raw, unedited API exports for every bundled workflow live in `workflows/exported_api_workflow_comfy/` for reference.
3. **Workflow library** — pick one → **Activate & start student mode**. The server restarts into student mode and launches (or attaches to) ComfyUI.
4. **Calibrate** (optional but recommended) — click the gauge icon on a workflow card (works in admin **or** student mode; in admin mode ComfyUI is started on demand). ComfyQ does **one real run** (a fresh seed avoids ComfyUI's result cache) and writes `<id>.runtime.json` with the first-run cost (incl. model load), the recurring generation cost (what the timeline uses), and the GPU. Inputs are supplied automatically from the assets directory (`config.json` → `assets.dir`, default `D:\_assets`) — no upload needed. Image inputs fall back to a built-in reference image if the assets dir has none.
5. **(Optional) Admin password** — required for any cross-user destructive action (deleting / cancelling another student's job, restarting, resetting, cleaning outputs). **Without a password set, cross-user deletes are refused entirely** — you can still manage your own jobs, but you can't interfere with anyone else's. Set one for classroom deployments.

### Operational controls (admin header)

- **Reset to admin** — flips back to admin mode without killing ComfyUI; useful when you want to swap workflows without disturbing the GPU process.
- **Stop & kill all** — emergency stop. Cancels every scheduled job, marks every in-flight job FAILED, REST-interrupts ComfyUI, kills the process if ComfyQ spawned it, and restarts in admin mode. Confirmation modal lists exactly what will happen.
- **Clean all outputs** (in the Admin page Cleanup card) — purges every output file on disk for terminal jobs and clears the `outputs` field in the DB. Job records are kept so prompt history survives. In-flight jobs are skipped so a running collector isn't disrupted.

## Daily use (student mode)

1. Open `http://<host>:5173` (the Vite URL printed at boot — it proxies the API/websocket on :3000; don't open :3000 directly). You're routed to the timeline; the active workflow's name and description (admin-edited prompting tips) appear in the header.
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

## Highlights (v2)

- **Multi-workflow library** with folder-bundled workflows (`<id>/<id>.api.json` + `<id>.meta.json`)
- **API-format only.** No fragile Litegraph auto-conversion. The admin UI rejects non-API JSON with a clear "Save (API Format)" message
- **Generic output detection** — classifies by file extension (image / video / audio / model3d / json), not by `class_type`. Works with any save node, including LTX video, depth preprocessor temp outputs, and audio-driven workflows
- **3D viewers (mesh + Gaussian splat)** — `.glb`/`.gltf` meshes render in an inline three.js viewer; Gaussian splats (`.spz`/`.ply`/`.splat`) render in a [Spark](https://github.com/sparkjsdev/spark) viewer. Both support drag-to-rotate / scroll-to-zoom / right-click-pan in the lightbox. A job that produces both (e.g. TripoSplat) gets a **Splat⇄Mesh toggle** plus one download button per format (`.spz` / `.ply` / `.glb`)
- **Multi-output galleries** — the wire carries *every* collected output, not just the first. A job that emits N images (e.g. Qwen multi-angle → 8 views) opens an **N-image gallery** (main image + thumbnail strip + prev/next + per-image and "Download all"); audio outputs get an inline player; the Scheduler card shows a "{N} views" badge
- **Persistent job queue** (sqlite) — survives server restarts; in-flight jobs reconcile to `failed: server-restart` rather than hanging
- **Auto-reconnecting ComfyUI WebSocket** — jobs no longer get stuck in `processing` if ComfyUI restarts mid-run
- **Real per-workflow timing** — `BenchmarkService` runs each workflow's warmup and stores `estimatedDurationSec` measured from the *first sampler step* (model/VAE load excluded), so the timeline reflects the recurring per-job cost. Built-in reference image lets image-edit workflows calibrate without prep
- **Calibration captures the GPU** — `runtime.json` records which CUDA device achieved the measured time. The admin workflow card shows it (e.g. `NVIDIA GeForce RTX 5090`) so you know whether to re-calibrate after moving to a different rig
- **Reorder parameters in the workflow editor** — per-row ▲/▼ buttons in the metadata editor reorder exposed parameters. Position chips (`#1, #2 …`) reflect the live order; the saved `order` field follows admin intent, so students see fields in exactly the order set in admin
- **Generic parameter detection** — surfaces every primitive widget on every node (no class_type whitelist), so new node types (Flux2, LTX, depth, custom LoRAs) can be exposed without code changes
- **Conditional fields (`disabledWhen`)** — a parameter can declare `disabledWhen: { param, equals }` to grey itself out while another field holds a value, e.g. a raw-prompt box vs. an AI-enhanced one gated by an "Enhance with AI" toggle (the disabled box still submits; the workflow's switch node ignores the unused branch)
- **Workflow description visible to students** — the admin's Description field renders on the main Scheduler header AND at the top of the booking dialog, so prompting tips show up exactly when students need them
- **Admin workflow editor** — drag-and-drop API JSON → auto-scaffold meta → modal editor lets you toggle parameter exposure, rename labels, set defaults, change types (with bulk "Hide infrastructure" / "Enable all" / "Disable all"). Onboard a workflow in under a minute
- **Per-workflow card actions** — Calibrate / Edit / Delete on each workflow in the admin library. Confirmation modal on delete; active workflow can't be deleted accidentally
- **My / All Jobs tabs** — Recent Generations defaults to the current user; an "All Jobs" tab plus per-user filter dropdown exposes everyone's results for the admin / room view. Sidebar shows only your own jobs
- **Confirmation dialogs with admin-password gating** — deletes / cancels go through a proper modal. Own jobs: simple confirm. Foreign jobs: admin-password field required, with red toasts surfacing wrong-password / "password not set" rejections from the server. Cross-user actions are disabled outright when no admin password is configured. In the admin panel, the "Admin password is set" card turns green ("verified") the moment the correct password is entered, so you get live confirmation before attempting a gated action
- **Cancel running jobs** — X button on your own in-flight job card REST-interrupts ComfyUI cleanly; the job lands in `cancelled` state (preserved as a record, not deleted)
- **Clean all outputs** — admin button purges every output file on disk for terminal jobs and clears the `outputs` field, keeping job history. Skips in-flight jobs
- **Emergency stop** — one button cancels every job, kills ComfyUI (only what we spawned), and restarts in admin mode
- **File uploads for image / video / audio inputs** — any `image`-, `video`-, or `audio`-typed parameter renders an upload widget: click to browse or drag-and-drop, with MIME filtering, a hover highlight, and an inline preview (image thumbnail / `<video>` / `<audio>`). On a phone the OS file picker itself offers "Take Photo", so camera input still works without any in-app webcam code
- **Oversized-image guard** — uploaded images are downscaled in the browser to a **1920×1080 box** (either orientation; or a per-parameter `maxInputEdge` long-edge cap set in the workflow editor) before they leave the device. HEIC and over-budget files are rejected by a three-layer guard (client throw → inline error → server backstop with magic-byte sniff), so a raw 12 MP phone photo can no longer OOM the rig
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
- **Per-job generation time** — every completed card (grid + sidebar) shows the actual wall-clock time it took (pickup → done), and the lightbox adds it as a stat. Works for any workflow type (image / video / audio / 3D) since it's derived from the job's `started_at`/`finished_at`, not the calibration estimate
- **Wire-compatible client** — `Scheduler`, `Dashboard`, `BookingDialog`, `MyJobsPanel` from v1 work against v2 unchanged

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

### Calibration uses sample media from an assets directory
Calibration runs the workflow for real, so workflows with image/video/audio inputs need a sample file. ComfyQ resolves one automatically from the **assets directory** (`assets.dir` in `config.json`, default `D:\_assets`) — it picks a file matching each input's type (a typical-sized image, the smallest video, an audio clip), so **no upload and no per-workflow setup is needed**. If a `video`/`audio` input can't be satisfied you'll see `Cannot calibrate: no <type> asset available …` — drop a file of that type into the assets dir (or set `meta.warmupParams` for that key). Image inputs fall back to a built-in reference PNG when the assets dir has no image.

### Calibration can be run from the admin panel (ComfyUI is started on demand)
The per-workflow **gauge** button works in admin mode too: the first calibrate lazily spawns (or attaches to) ComfyUI, and that instance is reused for subsequent calibrations and left running so activating a workflow afterwards attaches instantly. It does **one real run** (with all model VRAM freed first) and splits it at the first sampler step into **model-load** time and **generation** time — reporting a first-run figure (incl. load) and the recurring generation figure the timeline uses. The run gets a fresh random seed so it never returns ComfyUI's cached result (an identical re-submission would finish in ~1s and report a bogus duration). If the ComfyUI paths aren't set yet, you'll get `Configure the ComfyUI paths … before calibrating`. *(In student mode, calibrate while the queue is idle — the live executor and calibration share the one worker.)*

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
