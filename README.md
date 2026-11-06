# ComfyQ

**ComfyQ turns one GPU into a room full of people making things.**

It is a web-based job scheduler and workflow manager for [ComfyUI](https://github.com/comfyanonymous/ComfyUI), built for classrooms, labs and studios where a dozen people want the same expensive graphics card at once. Students book a slot on a shared timeline, fill in a simple form, and watch their job run. Nobody installs anything; nobody touches ComfyUI.

It currently serves a library of **80 ready-made workflows** — image generation and editing, video generation and editing, 3D, audio, captioning and utilities — each one measured on the rig so the timeline knows how long it really takes.

---

## The two modes — the first thing to understand

A ComfyQ machine is always in exactly one of two modes, and the difference is the whole design.

| | **Admin mode** | **Student mode** |
|---|---|---|
| What it is | The machine is being *set up* | The machine is *serving a class* |
| Who uses it | You, at `/admin` | Everyone, at `/` |
| ComfyUI | Started at boot by default (`comfy_ui.autoStart`), and used for calibration and maintenance | Running, with one workflow's models resident |
| Jobs | Nothing is scheduled | Students book and run jobs |
| Workflow | You pick and prepare any of the 80 | Exactly **one** is served (or several, with lanes) |

You switch by pressing **Activate & serve** on a workflow card (→ student) or **Stop serving** / **Reset to admin** (→ admin).

- **A restart resumes serving.** When ComfyQ is started again after a crash, a Windows update or a power cut, it comes back serving the same workflow, because **Activate & serve** leaves a marker (`server/data/.serving`); so does queueing a storyboard batch while the machine is in admin mode. The deliberate stops (*Stop serving*, *Reset to admin*, *Stop & kill all*) clear it. ⚠ ComfyQ does not start itself: after a reboot or a crash, the machine serves nothing until someone starts ComfyQ again — close its window if it is still open (after a crash the web page can still be up, and a double-click would only open it), then double-click `Start-ComfyQ.bat`.
- **ComfyUI outlives ComfyQ.** ComfyQ starts ComfyUI as an independent process (its output goes to `.comfyq-lanes/logs/`), so restarting ComfyQ — a crash, a code reload, or **Activate & serve** from admin mode — does not cold-start ComfyUI: the next ComfyQ adopts the ComfyUI it started, and after a crash or a code reload the served model is still loaded. Stopping serving keeps ComfyUI up but unloads its models, so serving again skips the cold start but still loads the model. Switching workflow while already serving happens in place, without restarting ComfyQ; ComfyUI itself is relaunched only when the new workflow needs different flags, or a launch setting has changed since it started. The **Running** card says how many times ComfyUI started in the last 24 h, and why. Ctrl+C in ComfyQ's console does not stop ComfyUI. To stop it, do it before closing ComfyQ: **Reset to admin** (if the machine is serving), then **Manage ComfyUI → Stop ComfyUI**, then close the window. With `comfy_ui.autoStart` off, the card shows ComfyUI as stopped after *Reset to admin* even though it is still running: press **Launch ComfyUI on network** first (it reconnects to the running ComfyUI, and switches *Expose ComfyUI to the LAN* on), then **Stop ComfyUI**. Already closed the window? Double-click `Start-ComfyQ.bat` again: ComfyQ reconnects to the ComfyUI it started, and you can stop it the same way (*Reset to admin* first if it resumed serving). Task Manager is only the last resort (see `Readme.txt` at the root of the drive, *Something is badly stuck*).
- **`/admin` is always reachable**, even while serving, so you can fix something mid-class. It is deliberately *not* linked from the student page — but that is tidiness, not security. **The admin password is the boundary.**
- **Students can be locked out too.** An optional *student access password* reserves a machine for one group; without it, anyone who can reach the student page on the network can book. It covers ComfyQ — the student page, booking, uploads and the job list — but not ComfyUI itself: with *Expose ComfyUI to the LAN* on, ComfyUI's own page (port 8188, and 8189 and up for each extra lane) stays open to anyone on the network, so switch that off to keep the GPU for the group. The change takes effect the next time ComfyUI is started: in admin mode, press **Restart ComfyUI**; while serving, at the next switch to another workflow or the next restart of ComfyQ. Re-activating the workflow already being served does not apply it, and a ComfyUI started by hand is never rebound. ComfyQ Discovery also still shows each queued job's user name and the start of its prompt.

---

## For students (the default view)

Open `http://<machine-ip>:5173` and you get a timeline, a booking form, and a grid of results.

- **Book a slot** — pick a free time, or *as soon as possible* and it queues into the next gap.
- **Know what the card does** — every card leads with a plain title saying what it does ("Repaint a marked area from words", "Start or end on your picture"), a one- or two-sentence summary, and the technical name in small print; the technical details are folded under *How it works*. **See an example** opens the card's example result with a caption saying what to notice.
- **Several models at once** — when a machine serves several workflows (lanes), each has its own queue. A tab books one of them; the header shows every lane's queue (waiting jobs, ~time) with a link to the others, and the timeline can show all lanes, one row each. The header also names the machine, and the browser tab says which model on which machine.
- **Fill in the form** — the fields come from whichever workflow is being served. Prompts, dropdowns, sliders, file uploads, and for some workflows a mask painter or a visual prompt composer.
- **Watch it run** — live progress and an ETA from the workflow's measured timing, not a guess.
- **Collect the result** — images, video, audio, 3D models and Gaussian splats each render in their own viewer. Multi-output jobs get a gallery.
- **Re-run it** — *Use these settings* refills the form from a past job of the workflow this tab books (it is not shown on other jobs — use the .zip); **Download ingredients (.zip)** packages the inputs plus a `settings.json` so a generation can be rebuilt later, even on another machine.
- **See what the rig can do** — the **All jobs** tab, user `examples`, carries one finished example per workflow in the library: the result, the prompt, the parameters, the input files and a caption saying what it shows. Each was chosen from research into what that model is actually good at ([`docs/showcase-research/`](docs/showcase-research/README.md)). On the example of the workflow being served, *Use these settings* is the quickest way to start from something that already works; every example offers **Download ingredients (.zip)**, and the **model filter** narrows the grid to one card. The examples are on the student page, so they can be seen only while the machine is serving a workflow.
- **Links** — every link out of ComfyQ (prompt guides, model pages) has a small copy button beside it, for a browser or a school proxy that refuses to open it.

Idle tabs park themselves after five minutes to keep a room of thirty laptops from hammering the rig.

---

## For admins — the four tabs

### 1. Workflows
The library, and what is running.

- **Running** — one row per lane: the workflow, its port, whether it is busy, and its resident VRAM. While several lanes run, **any** of them can be closed on its own (the main one too — another becomes main); *Stop serving* appears on the last one. A lane on the install's own ComfyUI keeps that ComfyUI running, models unloaded, so the next workflow you serve starts warm. Closing a lane that is running a job stops that job; the student sees it failed with "Stopped: this workflow stopped being served on this machine while the job was running."
- **Workflow library** — all 80 bundles, searchable, filtered by type (Image generation · Image editing · Video generation · Video editing · 3D · Audio · Description · Utilities). Each card shows the measured duration, a **VRAM chip** judged against *this* machine's card, and whether its models are on disk. Per card: *Activate & serve*, *Open in ComfyUI*, *Calibrate*, *Edit*, *Validate*, *Delete*. The workflow served last stays the active one after **Reset to admin**, so its *Delete* stays greyed out until another workflow has been activated.
  While a workflow is being served, the other cards show **Serve alongside** instead of *Activate & serve*: it opens a parallel lane on its own ComfyUI, and is greyed out when its VRAM will not fit beside what is running. To *replace* the main workflow instead, select its card and press **Activate & start student mode** under the library — that switches in place, without a restart. The switch closes the old main lane: if it is running a job, that job stops and the student sees it failed with "Stopped: this workflow stopped being served on this machine while the job was running."
- **Storyboard batch** — submit a whole multi-shot document as one job set. Queueing one while the machine is in admin mode starts serving the batch's first workflow.
- **Add workflow** — drop in a new ComfyUI API-format export.

### 2. Manage server
- **Student access** — optional password reserving the machine for one group. It does not cover ComfyUI's own page (port 8188, and 8189 and up for each extra lane — see *The two modes* above).
- **Admin password** — gates every destructive action. ⚠ **Set one before any class** (and before a prune session); without it, anyone on the LAN who knows the URL can reach the admin routes.
- **Network presence** — whether this machine announces itself to ComfyQ Discovery.
- **Cleanup** and **Clear job history**.

### 3. Manage ComfyUI
- **ComfyUI settings** — install paths, Python, output dir, VRAM budget. The ComfyUI port is under **Startup options** on the backend card, beside the performance flags. A **drive-letter swap** repoints every absolute path at once, and **Auto-detect** finds a portable install by itself — both there because this drive is cloned between machines that mount it under different letters.
- **Performance flags** — Sage attention and fp16 accumulation, off by default. Individual workflows can opt out of a flag they produce black images under, and ComfyQ relaunches ComfyUI without it for that workflow. A change takes effect the next time ComfyUI is started: in admin mode, press **Restart ComfyUI**; while serving, at the next switch to another workflow or the next restart of ComfyQ (re-activating the workflow already being served does not apply it).
- **HuggingFace token** — needed only for gated repositories. Write-only; never sent back to the browser.
- **Node packs** — which node classes your bundles need, which are missing, and who provides them. Installing is a `git clone` into `custom_nodes`; ⚠ **pip is a separate, explicit step**, because one Python environment is shared by every workflow on the drive. ComfyQ sets ComfyUI-Manager to offline (`network_mode = offline` in `ComfyUI/user/__manager/config.ini`) each time it starts ComfyUI, so a ComfyUI you launch yourself has Manager offline too; Manager has no setting for it in its own menus, so to go online edit `network_mode` back to `public` in that file (with that ComfyUI closed), and ComfyQ resets it at its next start.

### 4. Maintenance
Everything that changes the install. See [Maintaining the install](#maintaining-the-install) below.

---

## Getting models onto the machine

This is the part that most often goes wrong on a fresh rig, so it has its own section.

Every workflow card says whether its models are present, read from **the graph** — what the workflow actually loads — rather than from a hand-written list. A missing model shows red.

Expand the chip and each missing file offers:

- **fetch to rig** — downloads it **onto this machine**, into the folder the workflow will look in, under the name the workflow expects. This is the one you want. It resumes interrupted transfers, checks free space first, and renames the file into place only once the byte count matches, so a half-downloaded file is never mistaken for an installed one. Progress appears under **Maintenance → Model downloads**.
- **to my computer** — a plain browser link to the source. It saves to *the machine you are reading this on*, under the repo's own filename. Useful for a gated repo you must fetch by hand; **not** how you install a model on the rig.

> ⚠ **Why the distinction matters:** the admin panel is routinely open on a laptop, not on the rig. A browser download lands on the laptop with the wrong filename in the wrong folder — which is exactly the failure the server-side downloader exists to prevent.

**Gated repositories** (some FLUX.2 and LTX-2.5 weights) answer 401 until you accept the licence on HuggingFace and paste a read token under *Manage ComfyUI*.

**One known gap:** a model reachable only through a dropdown (an alternative LoRA checkpoint, say) never reports as missing, because the readiness check reads the graph and a dropdown option appears in no graph. "0 models missing" does not promise every dropdown option is present.

---

## Maintaining the install

All of it is admin-only, and the destructive parts sit behind the admin password.

**Updates.** The installed ComfyUI version is always on screen. *Check for updates* reaches the remotes and says in a sentence whether a newer release exists; every node pack that is a real git clone gets its own **Update** button, lists the commits that would land *before* you take them, and is fast-forwarded only.
- A run that changes nothing says so. `--stable` lands on the newest *release*, which may well be the one you already have.
- A pack with uncommitted local changes is not offered — it is a working copy, and a pull must not decide that for you.
- Roughly half of installed packs are copies ComfyUI-Manager unpacked rather than clones, so they have no remote; the card says which.
- ⚠ On a cloned drive, until `git config --global --add safe.directory "*"` has been run on this machine, every node-pack row shows no commit and no behind count, because git refuses to read folders another Windows account set up. Run that command once per machine (see [Install & run](#install--run)).
- ⚠ ComfyUI's own `current_requirements.txt` is a separate, acknowledged step: it asks for bare `torch`, and an install can be deliberately pinned to a build some node packs need.
- ⚠ **After updating ComfyUI or a node pack** (here or in ComfyUI-Manager), open **Maintenance → Maintenance scripts**, press **Repair the ComfyUI install** and **Re-apply the custom-node fixes**, then restart ComfyUI. Updates silently revert the local fixes some packs need. A pack whose only local change is one of those fixes shows as having uncommitted changes: stash it, update, then re-apply.

**Run the whole library.** One button runs every bundle once with sample inputs — about **2½–3 hours for 80 bundles** on an RTX 5090 (the last full run of the library, the test suite below, took 2 h 31 min) — and answers the two questions nothing else can: does each bundle still work, and which model files the library actually opens. Every output is *measured* (size, luminance, spread, frame count) and anything black, flat, empty or single-framed is named for you to open, because a workflow can report success and save black images. **Copy report** gives a plain-text report you can paste to someone: every failure carries its full error, its traceback, and the performance flags ComfyUI was actually running with.

**Run the test suite.** The same run, but on purpose: [tools/test-suite/library.suite.json](tools/test-suite/README.md) gives every workflow one example of what it is uniquely good at, chosen from research into the model, with a note saying what to look at. Pictures made from words feed the edit cards, the character sheets, the captioner, LivePortrait and some video frames; real or deliberately damaged photos and footage go to the cards whose strength only shows on them (restorers, pose transfer, frame interpolation, the video restyles); and cards that do the same job get the same inputs (the two SeedVR2 image cards, the two video upscalers, SCAIL-2 and Wan Animate, LTX 2.5 depth vs pose on the same dancer clip), so they can be compared. 15 of the 80 runs cost more or less than the job a student books by default (a bigger picture, a longer or shorter clip, a lighter input); they are marked `keepRuntime`, so they leave the card's measured timing alone. About **2½–3 hours for 80 bundles** on an RTX 5090 (2 h 31 min on 2026-11-04). Afterwards `node tools/maintenance/seed_examples.cjs --replace` turns the results into the **examples** students browse. It runs from the sweep card (**Run the test suite**) or from a terminal: `node tools/test-suite/run-suite.cjs library`. What the last run found is in [docs/workflow-assessment.md](docs/workflow-assessment.md).

**Download models** — see [the section above](#getting-models-onto-the-machine).

**Prune unused models.** Finds weight files nothing references, scored by confidence with its reasons in plain words. ⚠ Three things to know:
- **A prune MOVES, it does not delete.** Files go to `_model_quarantine\<batch>\` on the same drive — instant and reversible. It does **not** free space until you empty a batch from the **Quarantined models** card.
- **A quarantine batch travels in a cloned drive image.** Empty it before imaging a master drive.
- **"Nothing references it" is weaker than it sounds.** A model nobody happened to exercise leaves no trace either, so read the reason on each row. Each list shows the 25 largest rows until you press *Show all*. In the **Confident** and **Freed by removed workflows** groups, one click selects the rows shown (suspicious rows left out). **Worth a look** has the same button, enabled only after ticking *I have read the reason on each row*. **Suspicious** rows are ticked one by one, and the server refuses them unless you also tick the extra acknowledgement.

**Re-apply the custom-node fixes.** A few node packs need a local fix to run on this ComfyUI. The patches live in the repo rather than only on the rig that was fixed, so a cloned machine can be brought up to them with one button. Safe to press twice, and it **refuses loudly** if a pack has changed under its patch instead of guessing.

**Audit and repair.** Rebuild the model audit, verify it, repair the install, and fix the TRELLIS2 pack's example-workflow paths (the pack author's own absolute paths; run it after updating that pack). These are ordinary Python in [tools/maintenance](tools/maintenance/), resolving the install from `config.json` so they work under any drive letter. None of them repairs a drive-letter change: for that, use the **Drive letter** swap under Manage ComfyUI.

**Preparing a drive to be cloned.** This drive is duplicated with a physical cloner, so whatever is on it travels — including a term of student pictures and a quarantine batch full of models you meant to delete. [docs/cloning-the-drive.md](docs/cloning-the-drive.md) is the checklist, in this order: verify the library, empty the quarantine, clear the residue, **then** keep one example per workflow. The order matters — the wipe deletes the jobs and input files the examples are made of, so seeding them first would lose them. Three scripts under [tools/maintenance](tools/maintenance/) do the mechanical parts — `wipe_for_clone.cjs`, `seed_examples.cjs` and `publish_partial_sweep.cjs` — and each has a `--dry` mode that shows you the damage before you accept it (`publish_partial_sweep.cjs` is only needed to recover an interrupted sweep).

---

## ComfyQ Discovery (desktop app)

A small cross-platform app that finds every ComfyQ machine on the network and shows what each is doing: whether it is serving or idle, which workflow, how many people are connected and how long since anything happened. Click a serving machine's card to book a job on it.

It discovers machines three ways at once — a UDP beacon, a unicast subnet sweep, and manually added IPs — because managed school networks routinely block broadcast.

Each machine's page opens in a tab inside the app. Links in those pages (prompt guides, model pages) open in the system browser, and a tab is renamed when its machine switches model (from v2.1.0 — earlier versions dropped those links silently).

Windows and Linux builds **auto-update**; macOS needs a manual re-download. Installers come from the repo's GitHub Releases. Full detail, including the platform matrix and how to cut a release, is in [the Discovery section below](#comfyq-discovery--details).

---

## Where to read more

| Document | What it covers |
|---|---|
| [CLAUDE.md](CLAUDE.md) | **The short project memory**: how the machine runs now, and the rules for working on it. Claude Code loads it automatically. |
| [PROJECT-HISTORY.md](PROJECT-HISTORY.md) | **The engineering log.** Every decision, every bug and why it was fixed that way. Long and dated: search it before changing anything. |
| [implementation_plan.md](implementation_plan.md) | The phased plan and what is deferred. |
| [docs/workflow-assessment.md](docs/workflow-assessment.md) | Which workflow to reach for, per job: speed, quality and accuracy. The per-card verdicts come from the 2026-11-03 test-suite run; the showcase findings come from the 2026-11-04 run. |
| [docs/workflow-redundancy.md](docs/workflow-redundancy.md) | Which bundles overlap, with the pros and cons of cutting each. |
| [tools/test-suite/](tools/test-suite/) | The library test suite: what every workflow is asked, and which result feeds which. |
| [docs/comfyui-idv2v.md](docs/comfyui-idv2v.md) | The ID-V2V feature and why no patch is needed any more. |
| [docs/storyboard-format.md](docs/storyboard-format.md) | The multi-shot storyboard document format. |
| [docs/cloning-the-drive.md](docs/cloning-the-drive.md) | Preparing this drive to be imaged onto another machine. |
| [tools/maintenance/](tools/maintenance/) | The audit and repair scripts, and the notes that go with them. |
| [tools/model-provenance/](tools/model-provenance/) | Where each model came from, and which are exclusive to a bundle. |
| [tools/card-links/check.cjs](tools/card-links/check.cjs) | Checks every link a workflow card shows (prompt guides, model pages, downloads) the way a browser sees it. `--mark-gated` flags the downloads that need a HuggingFace login, so the card says so. Usage is in the file's header. |
| [tools/api-to-ui/](tools/api-to-ui/) · [tools/ui-to-api/](tools/ui-to-api/) | Converting between ComfyUI's editable graph and the API format ComfyQ runs. |

---

## Prerequisites

- **Node.js 24 LTS ("Krypton")** — the supported version, pinned in [.nvmrc](.nvmrc). Node 22 LTS ("Jod") also works. ComfyQ deliberately tracks an **LTS** line for broad machine compatibility; the odd-numbered "Current" releases (23, 25, …) are not supported. npm's `engines` check (`^22.0.0 || ^24.0.0`) warns on any other version, so 23, 25 and 26 all warn. With [nvm](https://github.com/nvm-sh/nvm) or [fnm](https://github.com/Schniz/fnm), run `nvm use` / `fnm use` in the repo root to pick up `.nvmrc` automatically.
- **Git for Windows** — needed for `git pull`, the once-per-machine `safe.directory` command below, and the admin panel's update checks and node-pack installs (they run `git fetch`, `git pull --ff-only` and `git clone`). The drive does not carry git: `winget install --id Git.Git --exact`.
- ComfyUI installed and able to run on the same machine. The lab targets RTX 3090 / 4080 / 4090 / 5090 with portable ComfyUI installs.
- C++ build tools available to npm — only needed as a **fallback** for `better-sqlite3`. On Node 24/22 LTS `npm install` downloads a prebuilt binary for your Node version (no compile), so most machines need nothing extra. That binary only works with the Node major version that installed it: on a cloned drive, use the same Node as the master (24), or delete the three `node_modules` folders (repo root, `client`, `server`) and run `npm install` again after changing Node. If a prebuild isn't available for your platform, the install falls back to compiling from source: on Windows that needs Visual Studio Build Tools (C++ workload).

## Install & run

```bash
git clone <repo>           # the default `main` branch is the active line
cd ComfyQ
npm install        # postinstall also installs client + server deps
npm run dev        # concurrently starts server (port 3000) + client (vite :5173, HTTP)
```

**Once per machine, on a cloned drive or in a repo folder another Windows user created:** run `git config --global --add safe.directory "*"` before the first `git pull`. Windows records the folders as belonging to the account that set them up, and git refuses to work in them ("detected dubious ownership") until this is set. Git reads the setting only from your own user config, so it cannot travel on the drive.

On Windows you can instead **double-click `Start-ComfyQ.bat`** in the repo folder. It checks that Node is installed, runs `npm install` when a `node_modules` folder is missing (a fresh checkout; a cloned drive already carries them), starts `npm run dev`, and opens the page once it answers; double-clicking it again while ComfyQ is running just opens the page. Keep its window open — closing it (or Ctrl+C) stops ComfyQ, but not ComfyUI. To stop ComfyUI too, do it before closing the window: **Reset to admin** (if the machine is serving), then **Manage ComfyUI → Stop ComfyUI**. If the window is already closed, double-click `Start-ComfyQ.bat` again and stop ComfyUI the same way; with `comfy_ui.autoStart` off there is one extra step, described under *ComfyUI outlives ComfyQ* at the top.

Open **`http://localhost:5173`** (or one of the `http://<lan-ip>:5173` URLs printed at boot). Vite serves plain HTTP and proxies the backend, so the page, the API, and the websocket all share a single origin. No certificate, no warning — students just open the URL. On first boot the server starts in **admin mode** and redirects to `/admin`. Once the ComfyUI paths are set (on a standard portable install they are found automatically), it also starts ComfyUI in the background; set `comfy_ui.autoStart: false` in `config.json` to turn that off.

> Why plain HTTP? A self-signed HTTPS cert can't be trusted across Safari + Chrome + phones in a BYOD workshop without installing a CA root on every device — and Safari won't even extend a click-through to the websocket or to downloads. HTTP removes all of that. The only feature HTTPS would have enabled — in-browser webcam capture (`getUserMedia`) — has been removed; image/video inputs are uploaded as files instead (a phone's file picker still offers "Take Photo").

## First-run setup (admin)

1. **ComfyUI Settings** — set the ComfyUI root path, Python executable, output dir, and VRAM budget for your GPU.

   ComfyQ finds the install by itself at boot whenever the configured root has no `main.py` (the **Auto-detect** button runs the same search on demand), so on a cloned drive the paths are normally already right. **Reset to defaults** puts back the original workshop layout on `D:\ComfyUI_windows_portable_nvidia\…`, which only helps when the install really is on D:. Click **Check paths** to validate before saving — it verifies the root contains `main.py`, runs `python --version`, and confirms the output directory is writable, listing each result inline.

   **Cloned the drive to a different letter?** Two shortcuts: ComfyQ **auto-detects** ComfyUI on `npm run dev` (it scans local drives for the install whenever the configured root is missing/stale, so a cloned or fresh drive Just Works), and there's an **Auto-detect** button to re-run it on demand. If only the drive letter changed, use the **Drive letter** dropdown to swap it across *every* path at once instead of editing each field.

   The **ComfyUI backend** card below Settings can **Launch / Restart / Stop** ComfyUI on the network (these buttons appear in admin mode only; while serving, press **Reset to admin** first) and holds the **Expose ComfyUI to the LAN** toggle (so anyone can open its native web UI on this GPU). If ComfyUI was started outside ComfyQ, **Restart** offers to *take it over* — it stops that instance and relaunches one ComfyQ manages, so Restart/Stop and "Open in ComfyUI" work afterward.

   For a Windows portable ComfyUI install, the `root_path` must point at the directory containing `main.py`, **not** the wrapper folder. With a typical install that's `...\ComfyUI_windows_portable\ComfyUI` (and `python_executable: ../python_embeded/python.exe`, or absolute).
2. **Add Workflow** — drag-and-drop an API-format JSON into the upload box. To get one from ComfyUI:
   - Open your workflow.
   - Use **File → Export (API)**. (Older ComfyUI menus: enable **Settings → Dev mode Options**, then click **Save (API Format)**.)

   On upload the server runs the primitive-fallback parser and auto-creates `workflows/<id>/<id>.api.json` + `<id>.meta.json` exposing every detected widget. A modal editor opens immediately so you can:
   - Click **Hide infrastructure** to drop model-path / weight-dtype / device fields.
   - Tweak labels and defaults for the params students should see.
   - Pick a category (`t2i`, `image-edit`, …).

   You can re-open the editor any time via the pencil icon on the workflow card.

   ⚠ Upload does not create the bundle's editable graph, `<id>_template.json`, which every bundle needs: *Open in ComfyUI* hands it over, and `npm run test:storyboard` fails without it. Copy the workflow's ordinary ComfyUI save (the non-API one) into the folder as `workflows/<id>/<id>_template.json`, or generate one with `node tools/api-to-ui/convert.mjs <id>` (run `npm install` in `tools/api-to-ui` once; ComfyUI must be running).

   The repo bundles a **Flux2 Klein 9B starter set** (validated on RTX 5090):
   - `workflows/image_flux2_klein_9b_t2i/` — text to image
   - `workflows/image_edit_flux2_klein_9b_image_edit/` — single image edit
   - `workflows/image_edit_flux2_klein_9b_image_edit_ref/` — image edit with reference image

   All three need: `flux-2-klein-base-9b-fp8.safetensors` (UNET), `flux2-vae.safetensors` (VAE), `qwen_3_8b_fp8mixed.safetensors` (CLIP) in the corresponding `<comfy_root>/models/` subfolders.

   It also bundles the rest of the library — **80 workflows** across image generation and editing, video generation and editing, 3D, audio, captioning and utilities. Each needs its own models under `<comfy_root>/models/`. **ComfyQ checks this for you:** every card carries a chip saying how many of the models its graph loads are on disk, and a missing one can be fetched straight onto the machine — see [Getting models onto the machine](#getting-models-onto-the-machine). (A bundle is only marked `unavailable` — and hidden from the library — when its own `meta.json`/`api.json` is missing or invalid, e.g. the "Missing workflow file" case in [Troubleshooting](#troubleshooting).)
3. **Workflow library** — pick one → **Activate & start student mode**. The server restarts into student mode and launches (or attaches to) ComfyUI.
4. **Calibrate** (optional but recommended) — click the gauge icon on a workflow card (works in admin **or** student mode; in admin mode ComfyUI is started if it is not already running). ComfyQ does **one real run** (a fresh seed avoids ComfyUI's result cache) and writes `<id>.runtime.json` with the first-run cost (incl. model load), the recurring generation cost (what the timeline uses), and the GPU. Inputs are supplied automatically from the assets directory (`config.json` → `assets.dir`, default `D:\_assets`, or the `_assets` folder at the root of the drive ComfyUI was auto-detected on) — no upload needed. Image inputs fall back to a built-in reference image if the assets dir has none.
5. **Admin password** (needed before a class) — with one set, every admin action that changes something needs it: Activate & serve, the ComfyUI settings, Reset / Restart, Clean outputs, Clear history, storyboard batches, prune, downloads and updates. With none set, all of those are open to anyone on the LAN who can reach the page. The one exception is another student's job: cancelling or deleting it is refused outright until a password exists (you can always manage your own jobs). Note that your name is simply what you type in the welcome box and is not checked: anyone who types the same name can manage those jobs. The name `examples` is reserved for the library's showcase jobs. Set a password for classroom deployments.

   Forgot the admin password? Close ComfyQ's window, open `config.json` (in the repo folder) in a text editor, and under `auth` set `"adminPasswordHash": ""` (leave the comma after it). Save, start ComfyQ again and set a new one. An invalid file is set aside as `config.json.broken-<n>.bak` and ComfyQ starts on defaults, so check the edit. A forgotten student access password needs none of this: set a new one under **Manage server → Student access**.

### Operational controls (admin header)

- **Reset to admin** — stops serving and flips back to admin mode. A job that is generating is stopped; its student sees it failed with "Stopped: this workflow stopped being served on this machine while the job was running." The install's ComfyUI stays up with its models unloaded, so the next workflow starts warm; the ComfyUIs started for extra lanes are stopped. (To change workflow while serving you do not need this: *Activate & start student mode* switches in place.)
- **Stop & kill all** — emergency stop. Cancels every scheduled job, marks every in-flight job FAILED, REST-interrupts ComfyUI, kills the process if ComfyQ spawned it, and restarts in admin mode. Confirmation modal lists exactly what will happen. ComfyUI then starts again, empty, in admin mode (unless `comfy_ui.autoStart` is off), so this does not free the GPU: to keep ComfyUI stopped, use **Manage ComfyUI → Stop ComfyUI** afterwards.
- **Clean all outputs** (in the Admin page Cleanup card) — purges every output file on disk for terminal jobs and clears the `outputs` field in the DB. Job records are kept so prompt history survives. In-flight jobs are skipped so a running collector isn't disrupted.

---

## Workflow folder layout

```
workflows/
└── image_flux2_klein_9b_t2i/
    ├── image_flux2_klein_9b_t2i.api.json         the workflow ComfyQ runs (API format, REQUIRED)
    ├── image_flux2_klein_9b_t2i.meta.json        the metadata: card text, exposed fields (REQUIRED)
    ├── image_flux2_klein_9b_t2i_template.json    the editable ComfyUI graph (REQUIRED — Open in ComfyUI and the prune scan read it)
    ├── image_flux2_klein_9b_t2i.runtime.json     measured timing + VRAM, written by calibration (committed)
    └── image_flux2_klein_9b_t2i.config.meta.json (optional, per-deployment overrides — no bundle ships one)
```

All of these files are tracked by git, so they travel with the repo. The admin panel writes `meta.json` itself — **Edit metadata**, **Validate** (which clears the `experimental` flag) and **Add workflow** — and calibration rewrites `runtime.json`. Both are committed files, so a rig where someone edited or calibrated a workflow has local changes, and a later `git pull` may refuse to overwrite them until they are committed or discarded. `config.meta.json` is read if present, to override a field's label, default, order or visibility, or to hide the workflow, but nothing in the admin panel writes it.

See [implementation_plan.md](implementation_plan.md#schemas) for the full schema.

---

## Architecture (one-line tour)

```
HTTP/Socket.IO  →  routes + RealtimeBus  →  JobQueue (sqlite — every lane's jobs)
                                                 ▲
                                                 │  each lane's executor claims only its own workflow's jobs
LaneManager — one lane per served workflow       │
   └─ lane:  JobExecutor ────────────────────────┘
               │
               ▼
             LocalComfyUIWorker  →  ComfyUI (its own port; started detached by comfyLauncher,
               │                     so it outlives ComfyQ; logs + PIDs in .comfyq-lanes/)
               ▼
             ComfyRestClient + ComfyWsClient (auto-reconnect)

WorkflowRegistry  ──── reads ────▶  workflows/<id>/{api,meta,_template,runtime,config.meta}.json
```

One lane runs on the install's own ComfyUI (the configured port, the install's own folders); any other lane gets its own ComfyUI on the next free port, with its own user and temp folders under `.comfyq-lanes/`. The bus, the admin routes and calibration reach the *main* lane through live proxies, so nothing holds on to a lane that has been closed.

See [implementation_plan.md](implementation_plan.md#architecture) for module-by-module responsibilities and the job state machine.


---

---

## ComfyQ Discovery — details

**ComfyQ – Discovery** is a standalone cross-platform desktop app (`desktop/`, Electron — Windows,
macOS and Linux) that shows **every ComfyQ machine on the LAN at a glance** — no configuration, no central
server. Open it on an instructor's laptop (or any machine on the same network) to see the whole room.
It matches the ComfyQ web UI's look (same grayscale palette, Inter font, lucide icons) and has its own
**light/dark toggle** (honors your OS preference, remembers your choice).

Each ComfyQ server **sends a small JSON status snapshot every ~5 s** over UDP — to the multicast
group `239.255.42.99:41999` **and** to the subnet broadcast address (belt-and-suspenders, since
consumer Wi-Fi/APs often drop multicast); the app listens and renders one card per workflow a machine
serves — a machine serving several lanes gets several cards, and one serving nothing gets one card.
Machines appear and disappear on their own — a card goes dim ~30 s after the last beacon and drops
after ~2 min. It works even for **idle rigs in admin mode with nothing launched**.

Each card shows:
- **Name** and **IP address** (with a **copy button** that copies that rig's admin-panel link,
  `http://<ip>:5173/admin`), plus a **"This machine"** marker on the rig you're running the app from.
  When the machine's display name differs from its computer name, the computer name is shown under it.
  A **⚠ Shares its identity with another machine** warning means two rigs report the same ComfyQ
  instance id (`instance.id` in `config.json`). A cloned drive normally gets a new id on its first
  boot, because the computer name recorded in `config.json` differs; the id survives the copy only
  when both machines have the same Windows computer name, or when the config predates the recorded
  computer name. To fix it, on one of the two: close ComfyQ, delete the `"id"` entry under
  `"instance"` in `config.json` (in the ComfyQ folder) — or give the computer a different Windows
  name — and start ComfyQ again. Renaming the machine under *Network presence* does not change the id.
- **When a workflow is being served**, a prominent banner right under the IP with a **category icon**
  (the same groups the ComfyQ admin library uses — Image generation, Image editing, Video generation,
  Video editing, 3D, Audio, Description, Utilities, Other) so you can tell at a glance what kind of
  workflow it is, and the workflow's name
- **Hardware** — GPU model (+ VRAM) and system RAM, and a **🔒 Password required** chip when the
  machine is reserved with a student access password
- **Plain-language state** (Running a workflow / Ready / On standby) and **usage** — how many users
  are connected and how long since the last activity (shown for every machine, including idle
  admin-mode rigs)
- **When a workflow is being served** — a short **description of what it does** (pulled straight
  from the workflow's `meta.json`, so dropping a new workflow into `workflows/` surfaces its blurb
  automatically), the **queued/running jobs** with times, and *"Click this card to schedule a job ↗"*:
  clicking anywhere on the card opens that model's booking page (`http://<ip>:5173/user?workflow=<id>`)
  as a named tab **inside the app**, with a **Machines** chip to go back to the list. Links inside that
  page (prompt guides, model pages) open in your system browser.
- **Admin-mode machines** hide the workflow/schedule (nothing is being served) and instead show just
  the connected-users + last-activity info

Discovery controls (automatic search on/off, **Search range**, and **Add a machine**) live behind the
**⚙ Settings** button in the top-right to keep the main view uncluttered.

The app sends **no commands of its own** to a machine — its only actions are opening a machine's page
in an in-app tab and copying a link. That tab is the machine's normal ComfyQ page, so you can book
jobs in it like any student.

> **Tip:** ComfyQ starts its **ComfyUI backend by default** (admin mode included, when paths are
> configured and `comfy_ui.autoStart` is on), so a rig shows up "engine on" and ready without anyone
> having to launch it first. Set `comfy_ui.autoStart: false` to opt out.

### Install & auto-update (end users)

Grab the latest installer from the repo's **[Releases](https://github.com/b2renger/ComfyQ/releases)**
page and run it — Windows `.exe`, macOS `.dmg` (Apple Silicon: `ComfyQ-Discovery-<ver>-arm64.dmg`;
Intel: the one without `-arm64`), or Linux `.AppImage`.
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
  `./ComfyQ-Discovery-<ver>.AppImage --appimage-extract-and-run`, or install **AppImageLauncher**
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
out, flip the **Network presence** toggle in the admin panel (**Admin → Manage server → Network presence** — takes
effect live, no restart) or set `federation.enabled: false` in its `config.json`; behavior is then
identical to a single-instance ComfyQ. The group/port and interval are configurable under `config.federation`
(match them with `COMFYQ_FED_GROUP` / `COMFYQ_FED_PORT` env vars for the app if you change them).
A `GET /federation/self` endpoint returns the same snapshot over HTTP for scripting/debugging.

> **Firewall:** the beacon is UDP. If machines don't appear, allow **Node.js** (and Electron, for
> the app) through Windows Firewall on **Private** networks. Multicast must be permitted on the LAN.

> **Managed / school Wi-Fi (broadcast & multicast blocked)?** Many managed networks enable *client
> isolation* for broadcast/multicast, so the UDP beacons never arrive even though the machines can
> reach each other directly over unicast. For that case the app also **auto-discovers** machines by
> sweeping the network: it probes `http://<ip>:3000/federation/self` and lists everything that
> answers. ⚠ Port 3000 is ComfyQ's API port, which students never use (their browser only talks to
> 5173) — so if your firewall rule is per port rather than "allow Node.js", open **TCP 3000** on
> Private networks too. It's on by default — toggle **Find machines automatically** or hit **Refresh**.
>
> Every sweep covers, in this order, **the machine's own /24, the Search range, a built-in range
> `10.10.14.1`–`10.10.18.254`** (the teaching lab's server subnets — 1270 addresses, swept by every
> build of the app, on any network) **and the rest of each local subnet the machine is on**. The
> **Search range** field (e.g. `10.10` · `16`–`17` · `1`–`254`; it shows your own subnet until you
> change it) **adds** one more range — it cannot narrow the sweep. A sweep probes at most **4,096
> addresses**. Your own /24 is always probed; past the cap, what is skipped is the end of the list —
> the rest of a large local subnet (a /20 or wider), or, if the Search range alone is bigger than the
> cap, the end of that range and everything after it.
> On a typical home or classroom subnet that is about 1,500 addresses, which can take up to ~50 s;
> found machines then refresh every 5 s. For a machine on a *different* network, use **Add a machine**
> (type its IP — it's polled directly and remembered between launches).
>
> **Servers on a different subnet than the clients?** Because the app scans every local subnet plus
> the extra ranges, clients can auto-find servers on another network. For a fixed deployment add
> ranges with `COMFYQ_FED_SCAN` (comma-separated CIDRs, e.g. `10.10.16.0/23`) or a `scanRanges` array
> in `fleet-config.json`. Both **add** to the built-in range; neither removes it. `fleet-config.json`
> lives in the app's user-data folder: `%APPDATA%\comfyq-desktop` when run from source; for an
> installed app, look for a `ComfyQ Discovery` or `comfyq-desktop` folder under `%APPDATA%` (Windows),
> `~/Library/Application Support` (macOS) or `~/.config` (Linux). **This only works if your network
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

That bumps `desktop/package.json`, commits the version bump, tags `vX.Y.Z`, and pushes **`main`
together with the tag** (`git push origin HEAD --follow-tags`) — so every unpushed commit on `main`
goes to GitHub with it; push or set aside anything that is not ready first. It refuses to run on any
branch but `main`. A GitHub Actions
workflow ([.github/workflows/release.yml](.github/workflows/release.yml)) then builds installers for
**Windows, macOS, and Linux** in parallel and publishes them — with the `latest*.yml` update
manifests — to a GitHub Release. Installed apps pick the update up on their next launch.

Notes:
- `release:*` runs [desktop/scripts/release.mjs](desktop/scripts/release.mjs), which first checks you are
  on `main` and that the version files are clean (an abort changes nothing, so re-running after it does
  not skip a version), then bumps with `npm version --no-git-tag-version` and does the commit/tag/push
  itself (`npm version`'s own git step is unreliable here). The release commit holds only `package.json`
  and `package-lock.json`; any other change, staged or not, stays out of it.
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

---

## Troubleshooting

### `'better-sqlite3' build failed during install`
On Node 24/22 LTS, `better-sqlite3` (v12+) normally installs a prebuilt binary for the running Node version, with no compilation; loading it under a different Node major version (for example a drive cloned from a Node-24 machine) fails until you delete the `node_modules` folders and run `npm install` again. If you see this error you're either on an **unsupported Node version** (check `node --version` against [.nvmrc](.nvmrc) — run `nvm use`/`fnm use`) or on a platform with no prebuild, which falls back to a source build. For the source build, install the native toolchain: Visual Studio Build Tools with the C++ workload (Windows) or `build-essential` + `python3` (Linux), then `npm install` again.

### `npm WARN EBADENGINE Unsupported engine` (or wrong Node version)
ComfyQ targets an LTS Node line (24 "Krypton", or 22 "Jod"). npm prints this warning on any Node other than 22 or 24, which includes the odd-numbered "Current" releases (23, 25, …). Switch with `nvm use` / `fnm use` (reads [.nvmrc](.nvmrc)), or install Node 24 LTS from [nodejs.org](https://nodejs.org/).

### `Litegraph format detected. ComfyQ v2 requires API format.`
You uploaded a workflow saved with the standard "Save" button. v2 deliberately does not auto-convert. Re-export with **File → Export (API)** in ComfyUI (older ComfyUI menus: enable **Settings → Dev mode**, then **Save (API Format)**). (See [implementation_plan.md](implementation_plan.md#why-v2) for why.)

### `Workflow unavailable: Missing workflow file: <id>.api.json`
The folder `workflows/<id>/` has a `meta.json` but no API workflow. Drop your `<id>.api.json` next to the meta and click **Refresh** in the admin Workflow library.

### Server starts in admin mode unexpectedly
Admin mode is the normal boot. A machine starts serving only after **Activate & serve**, after a storyboard batch is queued while the machine is in admin mode (it then serves the batch's first workflow), or when it was serving when ComfyQ last stopped (the `server/data/.serving` marker — see *A restart resumes serving* at the top). **Stop serving**, **Reset to admin** and **Stop & kill all** clear that marker on purpose, and setting `"mode"` in `config.json` by hand does not change how the machine boots. If it should have resumed serving and did not:
- **ComfyUI failed to start.** The server console says `ComfyUI would not start after several attempts — reverting to admin mode`; the lines just before it say why.
- **The ComfyUI paths are empty and auto-detect found no install** (`ComfyUI paths are not configured`). Set them in **Manage ComfyUI → ComfyUI Settings**.

(Separately: v2 archives a v1 `config.json` to `config.json.v1.bak` on first boot.)

### `Python executable not found: ...\python_embeded\python.exe` (or similar)
The portable ComfyUI bundle nests `main.py` inside a `ComfyUI/` subdirectory. Set `root_path` to the inner folder (e.g. `F:\ComfyUI_windows_portable_nvidia\ComfyUI_windows_portable\ComfyUI`), **not** the wrapper. With that root, `python_executable: ../python_embeded/python.exe` resolves correctly.

### Activating a workflow does nothing / server stuck after "Exiting for restart"
Make sure you're running with `npm run dev` (which uses nodemon). v2's `exitForRestart()` bumps the mtime of `server/index.js` so nodemon's watcher picks it up; if you've replaced nodemon with a different supervisor, point it at `server/` and trigger restart on file change.

### Job stuck in `processing` forever
v2 reconciles in-flight jobs to `failed: server-restart` on every server boot, and cancels what they left running in ComfyUI, so a restart loses the job but does not leave the GPU busy with it. If a job is genuinely stuck during a run, click **Stop & kill all** in admin (cancels every job, kills ComfyUI if ComfyQ started it — one started by hand is left running — and restarts in admin mode; ComfyUI then starts again, empty, unless `comfy_ui.autoStart` is off — to keep it stopped, use **Manage ComfyUI → Stop ComfyUI** afterwards), or kill ComfyUI manually — the worker emits a failure event and the job moves to `failed: comfyui-process-exited`.

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
ComfyUI couldn't find that filename in its `input/` directory. Two common causes: (1) the workflow's hardcoded default doesn't exist on this rig — re-upload an image in the booking form before submitting, or (2) the input file was removed from `ComfyUI/input` (the clone wipe, or the folder cleared by hand) — re-upload it. Student uploads (`comfyq_session__…`) are never swept on a timer; only the copies calibration stages (`comfyq__…`, 30 min) and storyboard chain frames (24 h) are.

### Calibration uses sample media from an assets directory
Calibration runs the workflow for real, so workflows with image, video, audio or 3D inputs need a sample file. ComfyQ picks one automatically from the **assets directory** (`assets.dir` in `config.json`, default `D:\_assets`, or the `_assets` folder at the root of the drive ComfyUI was auto-detected on): a typical-sized image or mesh (the median file) and the smallest video or audio clip. That is enough when only the type of input matters. When the content matters (a face to animate, a person to track, a 1 MP picture whose size sets the output size), name the file in the workflow's meta: set `meta.warmupParams.<key>` to `"asset:<file name in the assets dir>"` (29 of the 80 bundles do). If a video, audio or 3D input can't be satisfied you'll see `Cannot calibrate: no <type> asset available …`: drop a file of that type into the assets dir or set `meta.warmupParams` for that key. Image inputs fall back to a built-in reference PNG when the assets dir has no image.

### Calibration can be run from the admin panel
The per-workflow **gauge** button works in admin mode too: it uses the ComfyUI that admin mode starts at boot (or starts one if none is running, e.g. with `comfy_ui.autoStart: false`), and that instance is reused for later calibrations and left running so activating a workflow afterwards attaches instantly. It does **one real run** (with all model VRAM freed first) and splits it at the first sampler step into **model-load** time and **generation** time — reporting a first-run figure (incl. load) and the recurring generation figure the timeline uses. The run gets a fresh random seed so it never returns ComfyUI's cached result (an identical re-submission would finish in ~1s and report a bogus duration). If the ComfyUI paths aren't set yet, you'll get `Configure the ComfyUI paths … before calibrating`. *(In student mode the calibration runs on the served workflow's own ComfyUI (the main lane's, for a workflow that is not being served): jobs that come due while it runs wait for it to finish instead of failing. It is refused while a job is already running there. It is also refused when the ComfyUI it would run on was started with a performance flag the workflow lists in `disabledPerfFlags` — for example the SeedVR2 7B int8 upscaler while fp16 accumulation is on. Calibrate that workflow from admin mode, which relaunches ComfyUI without the flag, or open a lane for it with **Serve alongside**.)*

---

## Configuration

`config.json` (v2) is generated automatically and updated through the admin UI. Schema in [implementation_plan.md](implementation_plan.md#v2-configjson). It is per-deployment and not committed (see `.gitignore`).

A previous v1 config is automatically renamed to `config.json.v1.bak` on first boot.

## Development

```
npm run dev              # full stack (server with nodemon + client with vite)
npm run server           # server only
npm run client           # client only
npm run test:storyboard  # every unit test (server + client utils); no ComfyUI or GPU needed
```

Despite its name, `test:storyboard` is the whole unit-test suite, and there is no `npm test`. Two heavier checks are run by hand and need the ComfyUI install: `node server/lanes/lanes.integration.js` boots real CPU-only ComfyUIs on ports 8199 and up to test parallel lanes (run it after touching the lane manager or how ComfyUI is started), and the library test suite ([tools/test-suite](tools/test-suite/README.md), see *Run the test suite* above) holds the GPU for hours.

Server logs appear in your terminal. ComfyUI stdout/stderr is forwarded with `[ComfyUI]` / `[ComfyUI!]` prefixes when ComfyQ launches it; if you have an external ComfyUI already running on the configured port, ComfyQ attaches to it without spawning its own.

## Acknowledgments

- [ComfyUI](https://github.com/comfyanonymous/ComfyUI)
- [vis-timeline](https://visjs.github.io/vis-timeline/docs/timeline/)
- [Lucide React](https://lucide.dev/)
