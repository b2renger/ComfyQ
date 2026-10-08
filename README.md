# ComfyQ

**ComfyQ** is a web-based job scheduler and workflow manager for [ComfyUI](https://github.com/comfyanonymous/ComfyUI) in multi-user environments (classrooms, labs, studios). It solves the problem of scheduling access to expensive GPU-bound generative-AI workflows when multiple students or researchers compete for a single GPU.


## What it does

- **Timeline-based booking:** Students see a shared schedule, pick an empty slot, submit parameters (text prompt, images, video clips, audio), and watch generation happen in real time with live progress bars and ETAs.
- **Zero-config workflows:** Drop any ComfyUI workflow in (API format), the system auto-detects inputs/outputs (images, video, audio, 3D models, text captions), exposes parameters to students, renders results in the right viewer (3D model rotator, Gaussian-splat viewer, audio player, multi-image gallery, inline text).
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
- ✅ **Target workflows** *(bundled in `workflows/`; TripoSplat verified on rig 2026-06-10, LivePortrait on 2026-06-15, SAM3 segmentation on 2026-06-16, FILM frame interpolation and SeedVR2 upscalers on 2026-06-17, the Gemma 4 captioners registered 2026-06-21, the rest registered through 2026-06-13 and pending rig smoke-test):*
  - TripoSplat (image → `.spz` + `.ply` + `.glb`) — **verified on rig**
  - Qwen-Edit multi-angle (1 image → 8 angle images, N-image gallery) *(moved to `_candidate_workflows/` staging in the cleanup; the N-image gallery infra remains)*
  - Stable Audio 3 (text → `.mp3`, in-graph magic-prompt LLM)
  - Ideogram 4.0 t2i (structured-JSON prompt)
  - Wan 2.1 360° rotate LoRA (image → video) *(removed in the cleanup; the i2v infra it reused remains)*
  - LTX 2.3 t2v (text → video; built-in Gemma auto-prompt enhancer; no input image) *(registered 2026-06-26, pending rig verification)*
  - LTX 2.3 i2v (image → video)
  - LTX 2.3 FLF2V (first + last frame → video with audio)
  - LTX 2.3 IC-LoRA vid2vid (video + reference image → depth-guided restyle + audio; first **video** input)
  - LTX 2.3 IC-LoRA image + audio → video (character image + audio → talking video; auto-prompt enhancer) *(registered 2026-06-26, pending rig verification)*
  - LivePortrait (portrait image + driving video → animated talking-head video; first **image + video** input) — **verified on rig**
  - SAM3 video segmentation (video + text prompt → black/white mask/matte video; first **preprocessor** workflow) — **verified on rig**
  - Frame interpolation (FILM) (video → smoother or slow-motion video; `preprocessor` utility) — **verified on rig**
  - SeedVR2 image upscale to 4K (diffusion super-resolution; first **i2i** workflow) — **verified on rig**
  - SeedVR2 video upscale to HD (diffusion super-resolution; keeps source fps + audio) — **verified on rig**
  - Gemma 4 image captioning (image → text description; first **text-output** workflow)
  - Gemma 4 video captioning (video → text description) — **verified on rig**
  - Bernini-R video editing (video + instruction → edited/restyled video; Wan 2.2, Turbo "fast mode" toggle, edit-type selector) — **verified on rig**
  - Bernini-R video editing with reference image (video + reference image + instruction → edited video; first image+video → video on a diffusion edit graph) — **verified on rig**
  - Bernini-R image editing (image + instruction → edited image; Wan 2.2, Turbo "fast mode" toggle, edit-type selector) — **verified on rig**
  - Bernini-R image editing with reference image (image + reference image + instruction → edited image) — **verified on rig**
  - Bernini-R video editing with reference image, **auto-prompt** (video + reference image → edited video; a Gemma-4 chain writes the edit instruction for you — no prompt to type) *(registered 2026-06-25, pending rig verification)*
  - Flux.2 Klein inpainting — **paint a mask** + prompt (paint the area to replace, in a fullscreen mask painter; first **paint-a-mask** input) *(re-added 2026-07-05, pending rig verification)*
  - Flux.2 Klein inpainting with reference image — paint a mask + prompt + a reference image to insert into the painted area *(re-added 2026-07-05, pending rig verification)*
- ✅ **Every bundle run and measured** *(2026-10-07)* — the whole library was swept twice end to end on an RTX 5090: **61 bundles, about 2½ hours per pass, 59 running clean and 2 failing.** Each bundle's output was measured rather than trusted, and every row's ingredients and result are inspectable in the admin panel. The two failures are one real defect, in `image_qwen_image_2_1_control_canny` / `…_control_depth`: a ComfyUI 0.37 → 0.39.1 change breaks the community ControlNet pack they share (`RuntimeError: aimdo memory compile error` during sampling). The "pending rig smoke-test" notes above predate this and are superseded — see **[Maintaining the install](#maintaining-the-install-admin--maintenance)** for the button that does it.
- ✅ **Maintaining the install** *(2026-10-06/07)* — a **Maintenance** tab: run the whole library and get a pasteable report, download the models a bundle declares (server-side, onto the right machine), install missing node packs, prune unused weights to a reversible quarantine, and run the model-audit scripts. Model readiness now shows on every workflow card. See [Maintaining the install](#maintaining-the-install-admin--maintenance).
- ✅ **Phase F — Multi-instance federation (fleet monitor)** *(first slice shipped 2026-06-28; now in user testing).* A **LAN status beacon** + a standalone **[ComfyQ Discovery desktop app](#comfyq-discovery-desktop-app)** (Electron — Windows / macOS / Linux) that lists every ComfyQ machine on the network — name, GPU/RAM, IP, status, active workflow, planned jobs — with a one-click "open this rig's booking page". The desktop app now ships as a **downloadable installer that auto-updates itself** from GitHub Releases (version number + "Check for updates" button in its settings). Remaining locked design (mDNS, cross-instance admin actions, in-browser panel, student station picker, orchestrator role) still deferred. See [implementation_plan.md](implementation_plan.md#phase-f--multi-instance-federation-final-phase--design-locked-2026-05-16-implementation-deferred).
- 🚧 **Next** — two planned features: **batch processing** (admin runs a workflow over a folder of inputs from a manifest) and **instance mode** (2–3 ComfyQ instances + backends on one machine). See [implementation_plan.md](implementation_plan.md) → Phase G / Phase H.

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

   **Cloned the drive to a different letter?** Two shortcuts: ComfyQ **auto-detects** ComfyUI on `npm run dev` (it scans local drives for the install whenever the configured root is missing/stale, so a cloned or fresh drive Just Works), and there's an **Auto-detect** button to re-run it on demand. If only the drive letter changed, use the **Drive letter** dropdown to swap it across *every* path at once instead of editing each field.

   The **ComfyUI backend** card below Settings can **Launch / Restart / Stop** ComfyUI on the network and holds the **Expose ComfyUI to the LAN** toggle (so anyone can open its native web UI on this GPU). If ComfyUI was started outside ComfyQ, **Restart** offers to *take it over* — it stops that instance and relaunches one ComfyQ manages, so Restart/Stop and "Open in ComfyUI" work afterward.

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
   - `workflows/image_flux2_klein_9b_t2i/` — text to image
   - `workflows/image_edit_flux2_klein_9b_image_edit/` — single image edit
   - `workflows/image_edit_flux2_klein_9b_image_edit_ref/` — image edit with reference image

   All three need: `flux-2-klein-base-9b-fp8.safetensors` (UNET), `flux2-vae.safetensors` (VAE), `qwen_3_8b_fp8mixed.safetensors` (CLIP) in the corresponding `<comfy_root>/models/` subfolders.

   It also bundles the **target workshop workflows** (TripoSplat, Stable Audio 3, Ideogram 4.0, the Flux.2 Klein family incl. inpainting, the Wan 2.2 Bernini editors, the SeedVR2 upscalers, the Gemma captioners, and the LTX 2.3 family — see [Status](#status) for the full list and per-workflow state). Each needs its own models in `<comfy_root>/models/`. ComfyQ does **not** verify models up front, so a workflow whose models are missing still appears in the library — its jobs fail at run time instead (the error names the missing file). (A bundle is only marked `unavailable` — and hidden from the library — when its own `meta.json`/`api.json` is missing or invalid, e.g. the "Missing workflow file" case in [Troubleshooting](#troubleshooting).) Raw, unedited API exports for every bundled workflow live in `workflows/exported_api_workflow_comfy/` for reference.
3. **Workflow library** — pick one → **Activate & start student mode**. The server restarts into student mode and launches (or attaches to) ComfyUI.
4. **Calibrate** (optional but recommended) — click the gauge icon on a workflow card (works in admin **or** student mode; in admin mode ComfyUI is started on demand). ComfyQ does **one real run** (a fresh seed avoids ComfyUI's result cache) and writes `<id>.runtime.json` with the first-run cost (incl. model load), the recurring generation cost (what the timeline uses), and the GPU. Inputs are supplied automatically from the assets directory (`config.json` → `assets.dir`, default `D:\_assets`) — no upload needed. Image inputs fall back to a built-in reference image if the assets dir has none.
5. **(Optional) Admin password** — required for any cross-user destructive action (deleting / cancelling another student's job, restarting, resetting, cleaning outputs). **Without a password set, cross-user deletes are refused entirely** — you can still manage your own jobs, but you can't interfere with anyone else's. Set one for classroom deployments.

### Operational controls (admin header)

- **Reset to admin** — flips back to admin mode without killing ComfyUI; useful when you want to swap workflows without disturbing the GPU process.
- **Stop & kill all** — emergency stop. Cancels every scheduled job, marks every in-flight job FAILED, REST-interrupts ComfyUI, kills the process if ComfyQ spawned it, and restarts in admin mode. Confirmation modal lists exactly what will happen.
- **Clean all outputs** (in the Admin page Cleanup card) — purges every output file on disk for terminal jobs and clears the `outputs` field in the DB. Job records are kept so prompt history survives. In-flight jobs are skipped so a running collector isn't disrupted.

## Maintaining the install (admin → Maintenance)

The admin panel is four tabs — **Workflows**, **Manage server**, **Manage ComfyUI**, **Maintenance**. The first three are covered above; this is what the fourth does. All of it is admin-only, and the destructive parts are behind the admin password (set one — see step 5 above).

**Is this workflow runnable here?** Every card in the workflow library carries a chip saying how many of its models are on disk, read from the **graph** (not the hand-written model list, which contains prose and repo ids no file check can satisfy). Expand it for the file list with sizes and on-disk paths, each with a download or source link. A model a node pack fetches for itself is listed as such rather than as a file you need to find.

**Run the whole library.** One button runs every bundle once with sample inputs — about **2½ hours for 61 bundles** on an RTX 5090 — and answers two questions nothing else can: does each bundle still work, and which model files the library actually opens. Every output is *measured* (size, luminance, spread, frame count) and anything black, flat, empty or single-framed is named for you to open, because this rig has twice shipped a bundle that reported success and saved black images. Each row opens to show the ingredients that went in (the prompt that really ran, the input files, the seed) and the result itself, rendered inline with its path on disk. **Copy report** gives you a plain-text report you can paste to someone — every failure carries its full error, its traceback, and the performance flags ComfyUI was actually running with. It refuses to start while the machine is serving students.

**Download models.** Paste nothing — the card lists what each bundle declares and fetches it **onto this machine** (not the laptop you have the panel open on). Resumes interrupted transfers, checks free space first, and renames the file into place only once the byte count matches, so a half-downloaded file is never mistaken for an installed one. Gated repositories (FLUX.2, LTX-2.5) need you to accept the licence on HuggingFace and paste an access token under **Manage ComfyUI**.

**Install node packs.** Lists the node classes your bundles need and which are missing, resolving who provides each from ComfyUI-Manager's own data read off disk, so it works with no internet. Installing is a shallow `git clone` into `custom_nodes` — ComfyUI's own code is never touched. ⚠ **Python dependencies are a separate, explicit step**, because one interpreter is shared by every workflow on the drive: the card shows you the requirements first and names the lines that would replace something shared.

**Prune unused models.** Finds weight files that nothing references, scored by confidence with its reasons in plain words. ⚠ Three things to know before using it:

- **A prune MOVES, it does not delete.** Files go to `_model_quarantine\<batch>\` on the same drive — instant, reversible, and it does **not** free space until you empty a batch from the **Quarantine** card. Emptying is the only irreversible step and says so.
- **A quarantine batch travels in a cloned drive image.** Empty it before imaging a master drive, or every rig made from it carries the files.
- **"Nothing references it" is weaker than it sounds.** Only the confident tier offers bulk selection; everything doubtful must be ticked one file at a time. And a model nobody *happened* to exercise — Fast mode left off, the second entry in a dropdown — leaves no trace either, so the library sweep's "never opened" is a reason to keep, never proof you can delete.

**Audit and repair the install.** The maintenance scripts (rebuild the model audit, verify it, repair the install, make paths portable) run from here, through ComfyUI's own interpreter. They live as ordinary Python in [tools/maintenance](tools/maintenance/) and resolve your install from `config.json`, so they work under any drive letter.

## Daily use (student mode)

1. Open `http://<host>:5173` (the Vite URL printed at boot — it proxies the API/websocket on :3000; don't open :3000 directly). You're routed to the timeline; the active workflow's name and description (admin-edited prompting tips) appear in the header.
2. Set your username (stored in `localStorage`).
3. The timeline auto-follows current time (10 min back / 50 min ahead). Click an empty slot or **Schedule a job**, fill in the exposed parameters, **Book Slot**. The booking dialog repeats the workflow description at the top so you can reference it while typing your prompt.
   - The seed field auto-randomizes each time the dialog opens; click the dice icon to re-roll, or type a specific value to pin it.
4. Watch progress in real time. Each card / sidebar entry / lightbox shows which workflow produced it.
5. Recent Generations defaults to **My Generations** (your own results only). Switch to **All Jobs** to see everyone's work; use the user dropdown to filter to one specific contributor. The sidebar always shows just your own jobs.
6. Click any completed card to open the lightbox. **Use these settings** re-opens the booking dialog pre-filled with that job's prompt, parameters, **and the media it used** — images preview and video/audio play right in the form (keep them or Replace). Text captions have a **Copy text** button that works over plain HTTP too.
7. Delete your own scheduled jobs (cancels the job) or completed images (also unlinks the file from disk) via the X on each card. The same X button on a **running** job interrupts ComfyUI and moves the job to `cancelled` (the record is kept; the X reappears so you can also delete it). A confirmation dialog appears for every destructive action.

Deleting / cancelling **another user's job** opens the same dialog with an admin-password field. The server refuses cross-user actions outright when no admin password is configured.

---

## ComfyQ Discovery (desktop app)

**ComfyQ – Discovery** is a standalone cross-platform desktop app (`desktop/`, Electron — Windows +
macOS) that shows **every ComfyQ machine on the LAN at a glance** — no configuration, no central
server. Open it on an instructor's laptop (or any machine on the same network) to see the whole room.
It matches the ComfyQ web UI's look (same grayscale palette, Inter font, lucide icons) and has its own
**light/dark toggle** (honors your OS preference, remembers your choice).

Each ComfyQ server **sends a small JSON status snapshot every ~5 s** over UDP — to the multicast
group `239.255.42.99:41999` **and** to the subnet broadcast address (belt-and-suspenders, since
consumer Wi-Fi/APs often drop multicast); the app listens and renders one card per machine.
Machines appear and disappear on their own — a card goes dim ~30 s after the last beacon and drops
after ~2 min. It works even for **idle rigs in admin mode with nothing launched**.

Per machine the card shows:
- **Name** and **IP address** (with a **copy button** that copies that rig's admin-panel link,
  `http://<ip>:5173/admin`), plus a **"This machine"** marker on the rig you're running the app from
- **When a workflow is being served**, a prominent banner right under the IP with a **category icon**
  (the same icon the ComfyQ admin library uses — image / video / audio / 3D / text / utility) so you
  can tell at a glance what kind of workflow it is, and the workflow's name
- **Hardware** — GPU model (+ VRAM) and system RAM
- **Plain-language state** (Running a workflow / Ready / On standby) and **usage** — how many users
  are connected and how long since the last activity (shown for every machine, including idle
  admin-mode rigs)
- **When a workflow is being served** — its name, a short **description of what it does** (pulled
  straight from the workflow's `meta.json`, so dropping a new workflow into `workflows/` surfaces its
  blurb automatically), the **queued/running jobs** with times, and a **"Schedule a job ↗"** button
  that opens that rig's booking page (`http://<ip>:5173`) in your default browser
- **Admin-mode machines** hide the workflow/schedule (nothing is being served) and instead show just
  the connected-users + last-activity info

Discovery controls (automatic search on/off, **Search range**, and **Add a machine**) live behind the
**⚙ Settings** button in the top-right to keep the main view uncluttered.

The app is **read-only** (it never commands a remote machine — the only actions are opening a browser
tab and copying a link).

> **Tip:** ComfyQ now starts its **ComfyUI backend by default** (admin mode included, when paths are
> configured and `comfy_ui.autoStart` is on), so a rig shows up "engine on" and ready without anyone
> having to launch it first. Set `comfy_ui.autoStart: false` to opt out.

### Install & auto-update (end users)

Grab the latest installer from the repo's **[Releases](https://github.com/b2renger/ComfyQ/releases)**
page and run it — Windows `.exe`, macOS `.dmg` (Apple Silicon **and** Intel), or Linux `.AppImage`.
Windows + Linux builds are **unsigned**; the macOS app is **ad-hoc code-signed** (so it launches with a
one-time bypass instead of a *"damaged"* dead end — but it is **not notarized**):

- **Windows:** on first run SmartScreen shows *"Windows protected your PC"* → click **More info → Run
  anyway** (one time). Updates afterwards install silently.
- **macOS (Apple Silicon):** Gatekeeper blocks the first launch → **right-click the app → Open → Open**
  (one time); on macOS Sequoia use **System Settings → Privacy & Security → Open Anyway**.
  `xattr -cr '/Applications/ComfyQ Discovery.app'` is the universal fallback.
- **macOS (Intel):** needs **macOS 12 (Monterey) or newer** — on macOS 11 Big Sur the app is flagged
  *"damaged"* and won't open even after the bypass.
- **Linux:** `chmod +x` the `.AppImage`, then run it. On **Linux Mint / Ubuntu** it needs the **FUSE 2**
  runtime — if it does nothing or reports a FUSE error, install it: `sudo apt install libfuse2`
  (Mint 21 / Ubuntu 22.04) or `libfuse2t64` (Mint 22 / Ubuntu 24.04). Still stuck? Run it FUSE-free with
  `./"ComfyQ Discovery-<ver>.AppImage" --appimage-extract-and-run`, or install **AppImageLauncher**
  (`sudo apt install appimagelauncher`) for a menu entry + automatic integration. A SUID-sandbox error on
  launch → add `--no-sandbox`.

**Auto-update is automatic.** On every launch the app checks GitHub for a newer release, downloads it
in the background, and shows *"Update ready — restart to apply"* (it also installs on next quit). The
⚙ **Settings** panel shows the **current version** and a **"Check for updates"** button for an
on-demand check. *(Windows + Linux auto-update end-to-end; macOS auto-update needs code signing — see
"Building & releasing" below — so for now Mac users re-download from Releases to update.)*

### Run from source (development)

```bash
npm run desktop:install   # once — installs Electron in desktop/ (not pulled by the root install)
npm run desktop           # launch the monitor
```

The beacon is **on by default** on every ComfyQ instance (admin and student mode). To opt a machine
out, flip the **Network presence** toggle in the admin panel (**Admin → Network presence** — takes
effect live, no restart) or set `federation.enabled: false` in its `config.json`; behavior is then
identical to a single-instance ComfyQ. The group/port and interval are configurable under `config.federation`
(match them with `COMFYQ_FED_GROUP` / `COMFYQ_FED_PORT` env vars for the app if you change them).
A `GET /federation/self` endpoint returns the same snapshot over HTTP for scripting/debugging.

> **Firewall:** the beacon is UDP. If machines don't appear, allow **Node.js** (and Electron, for
> the app) through Windows Firewall on **Private** networks. Multicast must be permitted on the LAN.

> **Managed / school Wi-Fi (broadcast & multicast blocked)?** Many managed networks enable *client
> isolation* for broadcast/multicast, so the UDP beacons never arrive even though the machines can
> reach each other directly over unicast. For that case the app also **auto-discovers** machines by
> sweeping the local subnet: it probes `http://<ip>:3000/federation/self` across your subnet (the
> same path students already use, so no extra firewall rule), and lists everything that answers. It's
> on by default — toggle **Find machines automatically** or hit **Refresh**. You can set the
> **Search range** (the address range to check, e.g. `10.10` · `16`–`17` · `1`–`254`) to widen or
> narrow the sweep; it defaults to your machine's own subnet. A ~510-address sweep takes ~15 s; found
> machines then refresh every 5 s. For a machine on a *different* network, use **Add a machine** (type
> its IP — it's polled directly and remembered between launches).
>
> **Servers on a different subnet than the clients?** The app scans **every** local subnet it's on, plus
> any seeded extra ranges, so clients can auto-find servers on another network. The "Search range" field
> adds one range in-app; for a fixed deployment set `COMFYQ_FED_SCAN` (comma-separated CIDRs, e.g.
> `10.10.16.0/23`) or a `scanRanges` array in `fleet-config.json`. **This only works if your network
> actually routes to that subnet** (e.g. a sub-router whose WAN is uplinked to the main LAN — verify with
> `curl http://<server-ip>:3000/federation/self`). If the two networks have no route between them, no
> discovery setting can bridge them — put the machines on one LAN instead.

> **"Electron failed to install correctly"?** Electron's binary-download step occasionally gets
> skipped during `npm install`. `npm run desktop:install` runs that step explicitly so this
> shouldn't happen; if it ever does, re-run `npm run desktop:install` (or, directly,
> `node desktop/node_modules/electron/install.js`).

### Building & releasing (maintainers)

The desktop app is packaged with **electron-builder** and updates via **electron-updater**, pulling
releases from this public GitHub repo (no token needed on the client). Cutting a release is one
command, run from `desktop/` on `main`:

```bash
cd desktop
npm run release:patch     # or release:minor / release:major
```

That bumps `desktop/package.json`, commits, tags `vX.Y.Z`, and pushes the tag. A GitHub Actions
workflow ([.github/workflows/release.yml](.github/workflows/release.yml)) then builds installers for
**Windows, macOS, and Linux** in parallel and publishes them — with the `latest*.yml` update
manifests — to a GitHub Release. Installed apps pick the update up on their next launch.

Notes:
- **`npm version`'s git step is unreliable here**, so `release:*` bumps with `--no-git-tag-version`
  and does the commit/tag/push explicitly via [desktop/scripts/release.mjs](desktop/scripts/release.mjs)
  (which also leaves a dirty `config.json` untouched).
- A local `npm run dist` (in `desktop/`) builds an unsigned installer for the host OS only — handy for
  a quick check, though on Windows it needs **Developer Mode** (or an elevated shell) so electron-builder
  can extract its code-signing tools; CI is unaffected.
- **Code signing.** Windows + Linux are **unsigned** (SmartScreen/Gatekeeper warn on first run). macOS is
  **ad-hoc code-signed** in CI ([desktop/scripts/afterPack.cjs](desktop/scripts/afterPack.cjs)) so the app
  launches with a one-time bypass instead of the dead-end *"damaged"* error — but it is **not notarized /
  not Developer-ID**, so **macOS auto-update still won't apply** (Squirrel.Mac needs a stable signature);
  Mac users re-download from Releases to update. Add a real Developer-ID cert + notarization as CI secrets
  to enable macOS auto-update. Windows + Linux auto-update fine.

---

## Workflow folder layout

```
workflows/
└── image_flux2_klein_9b_t2i/
    ├── image_flux2_klein_9b_t2i.api.json         the workflow (API format, REQUIRED)
    ├── image_flux2_klein_9b_t2i.meta.json        the metadata (REQUIRED for v2)
    ├── image_flux2_klein_9b_t2i.config.meta.json (optional, per-deployment overrides — gitignored)
    └── image_flux2_klein_9b_t2i.runtime.json     (optional, written by BenchmarkService — gitignored)
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
