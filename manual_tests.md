# ComfyQ v2 — Manual Test Log

Living checklist of manual validations that can't be automated (require a real ComfyUI on a real GPU). Each milestone gates the next: **don't start M1 work until M0 fully passes.** When a test passes, fill in date + rig and tick the box. If it fails, capture the artifacts listed and open an issue / note in the **Notes** field.

Status legend: `[ ]` not started · `[~]` in progress · `[x]` passed · `[!]` failed (see notes)

---

## How to set up a rig before testing

```
git clone <repo>
cd ComfyQ
git checkout v2
npm install
npm run dev
```

Open `http://<host>:3000/admin`. You should land on the admin page (the v1 `config.json` was auto-archived to `.v1.bak` on first boot).

If you have an existing ComfyUI process listening on the port, ComfyQ attaches to it. Otherwise it spawns its own using your configured Python + root path.

---

## M0 — v2 skeleton runs end-to-end (✅ VERIFIED — RTX 5090)

End-to-end on rig: passed against the three Flux2 Klein 9B starters (text-to-image, image edit, image edit with reference). Flux1 dev was the original smoke fixture during early M0 development and has been retired in favour of the Flux2 set.

Goal: end-to-end "book a t2i job in the timeline → watch progress → image renders → restart safely."

Required on the rig:
- Working ComfyUI install
- Models for the three Flux2 starters: `flux-2-klein-base-9b-fp8.safetensors` (UNET), `flux2-vae.safetensors` (VAE), `qwen_3_8b_fp8mixed.safetensors` (CLIP)
- C++ build tools available to npm (for `better-sqlite3`)

### M0-1 — First-run admin mode
**Status:** [x] · **Date:** 2026-05-03 · **Rig:** RTX 5090

**Steps:**
1. Fresh clone, `npm install`, `npm run dev`.
2. Browser → `http://<host>:3000`.

**Expected:**
- Auto-redirect to `/admin`.
- "Server is in **admin** mode" badge.
- Workflow library shows `flux2_klein_9b_t2i` as available. Broken bundles (e.g. `flux2_klein_9b_t2i` without an `.api.json`) are filtered out by default — pass `?includeUnavailable=1` on the `/workflows` route to see them.
- Server log shows `[Config] Detected v1 config.json (or unversioned). Archiving to config.json.v1.bak and starting fresh.` (only on the first run after a v1 install).

**If failed — capture:**
- Browser console errors
- `server/index.js` stdout (from terminal)
- The contents of `config.json` (whatever it ended up as)

**Notes:** _(date / failure mode / what you tried)_

---

### M0-2 — Configure ComfyUI paths
**Status:** [x] · **Date:** 2026-05-03 · **Rig:** RTX 5090

**Steps:**
1. On a fresh clone with no `config.json` present, the **ComfyUI Settings** card should already show the workshop-default paths pre-filled (`D:\ComfyUI_windows_portable_nvidia\ComfyUI_windows_portable\ComfyUI` etc.). If your rig differs, edit the fields or click **Reset to defaults** to repopulate.
2. Click **Check paths**. Verify the inline panel shows green checks for: `ComfyUI root path`, `ComfyUI main.py`, `Python executable` (with a `Python 3.x.y` version string), and `Output directory (writable)`.
3. Click **Save settings**. Toast should confirm.
4. Refresh the page; values should persist and the **Configured** badge appears in the header.
5. Inspect `config.json` at the project root: `comfy_ui.root_path` and `comfy_ui.python_executable` should be present.

**Expected:** All paths persisted; values reload on refresh; Check paths returns `ok: true` for every row.

**If failed — capture:**
- The `POST /admin/check-paths` response (per-row `ok`/`detail`)
- The `PUT /admin/comfy` response in browser devtools network tab
- The current `config.json`

**Notes:**

---

### M0-3 — Activate flux2_klein_9b_t2i → student mode
**Status:** [x] · **Date:** 2026-05-03 · **Rig:** RTX 5090

**Steps:**
1. In **Workflow library**, click `flux2_klein_9b_t2i`. Card highlights as selected.
2. Click **Activate & start student mode**. Toast: "Activating workflow…".
3. Server exits and restarts (nodemon picks up). Browser auto-redirects to `/user`.

**Expected:**
- Server log: `[ComfyQ] mode=student`, then `[ComfyQ] active workflow: flux2_klein_9b_t2i`.
- ComfyUI either spawns (you'll see `[ComfyUI] ...` lines) or attaches to an existing instance (`External ComfyUI already responding; using it.`).
- After ComfyUI finishes loading: `[Worker] WS connected`, status pill turns to `ready`.

**If failed — capture:**
- Server stdout from boot to failure
- Whether ComfyUI is reachable directly at `http://127.0.0.1:8188`

**Notes:**

---

### M0-4 — Book a flux2_klein_9b_t2i job
**Status:** [x] · **Date:** 2026-05-03 · **Rig:** RTX 5090

**Steps:**
1. Set username (e.g. `alice`) in the modal.
2. Click **Schedule a job**. BookingDialog opens.
3. Fill prompt: `a vibrant city skyline at golden hour, ultra detailed`. Leave defaults (steps=20, guidance=3.5, 1024×1024, seed=0).
4. Set time to "now + 10 sec". Confirm "Slot is available". Click **Book Slot**.
5. In the recent generations grid: card appears with status `scheduled`.
6. Within 10 s: status → `processing`, progress bar advances, current node updates.
7. After ~30–60 s on a 4090 / longer on a 3090: status → `completed`, image renders in the card.
8. Click the card → lightbox opens showing the full image. Download button works.

**Expected:**
- Output filename starts with `alice_<YYYYMMDD>_<HHMMSS>_<jobId8>.png`
- File is in `<ComfyUI>/output/`
- `GET /media/image/<filename>` returns the image with `Content-Type: image/png`
- Backward-compat URL `GET /images/<filename>` also works

**If failed — capture:**
- Server log around the job submission
- ComfyUI log around the same time
- The job's `phase` field from `/jobs/<id>` (executor REST)
- Whether the file landed in `<ComfyUI>/output/`

**Notes:**

---

### M0-5 — Server restart reconciliation
**Status:** [x] · **Date:** 2026-05-03 · **Rig:** RTX 5090

**Steps:**
1. Book a fresh job at `now + 5 sec`.
2. While its status is `processing`, hit `Ctrl+C` in the terminal running ComfyQ. Then `npm run dev` again.
3. Open the timeline.

**Expected:**
- The job that was `processing` now shows as `failed`.
- `GET /jobs/<id>` returns `error_reason: "server-restart"` and `error_phase` ∈ `{submitted, executing, collecting-outputs}` depending on where it was.
- Server log on boot: `[Queue] Reconciled 1 in-flight job(s) → failed: server-restart`.
- Booking a new job after restart works normally.

**If failed — capture:**
- Server log from boot
- `/jobs/<id>` JSON

**Notes:**

---

### M0-6 — ComfyUI process crash mid-job
**Status:** [x] · **Date:** 2026-05-03 · **Rig:** RTX 5090

**Steps:**
1. Book a job at `now + 5 sec`.
2. While it's `processing`, kill ComfyUI from Task Manager (don't touch ComfyQ).
3. Wait ~5 seconds.

**Expected:**
- Job moves to `failed` with `error_reason: "comfyui-process-exited"`, `error_phase: "executing"`.
- ComfyQ keeps running.
- If `autoStart: true`, ComfyQ does NOT auto-respawn ComfyUI in M0 (that's M1+ scope). You'll need to restart it manually or hit **Reset to admin** + **Activate** again.

**Notes:** This test exposes whether the WS auto-reconnect logic interacts cleanly with the executor's failure path.

---

### M0-7 — Litegraph rejection
**Status:** [x] · **Date:** 2026-05-03 · **Rig:** RTX 5090

**Steps:**
1. In ComfyUI, build any tiny workflow. Save it via the standard menu (NOT API format).
2. Open ComfyQ admin → **Add Workflow** → upload that file.

**Expected:**
- 400 response with the exact message: `Litegraph format detected. ComfyQ v2 requires API format. In ComfyUI: enable Settings → Dev mode Options, then click "Save (API Format)".`
- Toast in admin UI shows the error.
- No new folder created under `workflows/`.

**Notes:**

---

### M0-8 — Reset to admin
**Status:** [x] · **Date:** 2026-05-03 · **Rig:** RTX 5090

**Steps:**
1. From the timeline page, click **Reset to admin** (top right).
2. Server exits and restarts. Browser reloads.

**Expected:**
- Mode badge: `admin`.
- Active workflow ID is cleared.
- Booking is no longer possible (you're on the admin page).

**Notes:**

---

### M0-9 — Admin password gate
**Status:** [x] · **Date:** 2026-05-03 · **Rig:** RTX 5090

**Steps:**
1. Admin → **Admin password** → set a password.
2. Two browser windows: A (logged in as `alice`), B (as `bob`). A books a job.
3. From B, try to delete A's job (X button on A's card).

**Expected:**
- B receives an `error` event: `foreign job — admin password required`. The job stays.
- (M2 will add a password prompt UI; for M0 the failure is server-side only.)

**If failed — capture:**
- Network frame for the socket `delete_job` event
- `auth.adminPasswordHash` is non-empty in `/admin/config`

**Notes:**

---

### M0-10 — Output classification (sanity check before M3)
**Status:** [x] · **Date:** 2026-05-03 · **Rig:** RTX 5090

**Steps:**
1. Run a successful t2i job (M0-4).
2. `curl http://<host>:3000/jobs/<jobId>` and inspect `outputs[]`.

**Expected:**
- At least one entry with `kind: "image"`, `mime: "image/png"`, `nodeId: "9"` (the SaveImage node), and a non-null `sizeBytes`.
- The collector did not need a `class_type` whitelist — the classification came from the `.png` extension alone.

**Notes:** If the SaveImage node id changes (different workflow), the classification still works because it's extension-driven.

---

### M0-11 — Cancel a running job
**Status:** [x] · **Date:** 2026-05-04 · **Rig:** RTX 5090

**Steps:**
1. Book a long-running job (LTX i2v or any workflow with `maxRuntimeSec` ≥ 300).
2. Once the card status flips to `processing`, click the X icon on the card.
3. Confirm "Stop this running job? ComfyUI will be interrupted." in the prompt.

**Expected:**
- Server log: `[ComfyUI!] Global interrupt (no prompt_id specified)` then `[Executor] job <id8> FAILED after Xs — executing: cancelled` then `[ComfyUI!] Processing interrupted`.
- Card status flips to `cancelled` (NOT deleted — the record is preserved for review).
- ComfyUI process is left alive; the next booking proceeds normally without a respawn.
- Cancel button is hidden on a job belonging to another user.

**If failed — capture:**
- Server log around the cancel
- Whether `worker.cancel()` returned (look for `[Worker]` logs)
- Network frame for the `cancel_job` socket event

**Notes:** Verifies the cancel-only flow (`cancel_job` socket event → `executor.cancelJob` → `rest.interrupt`). Distinct from `delete_job` which would cancel + delete.

---

### M0-12 — Conda-env scrub on spawn
**Status:** [x] · **Date:** 2026-05-04 · **Rig:** RTX 5090 (with active `(base)` conda)

**Steps:**
1. From a shell where `conda activate base` has run (verify with `echo $env:CONDA_PREFIX`), launch ComfyQ via `npm run dev`.
2. Activate any workflow so ComfyQ spawns ComfyUI itself.
3. Watch the server log near the spawn line.

**Expected:**
- A line like: `[ComfyProcess] Stripped env vars: CONDA_PREFIX=… CONDA_DEFAULT_ENV=… …`.
- A line like: `[ComfyProcess] Removed N env-prefix entries from PATH`.
- The spawn command line itself includes `-s` (Python flag) and `--windows-standalone-build --disable-auto-launch` (when `installation_type === 'portable'`).
- Sampling proceeds at the same s/iter as standalone ComfyUI (no CPU-mode fallback).

**If failed — capture:**
- The `[ComfyProcess] Spawning:` line in full
- The output of `python_embeded\python.exe -s -c "import torch; print(torch.cuda.is_available(), torch.version.cuda)"` from PowerShell
- The contents of `$env:PATH` before and after `conda activate`

**Notes:** Without the scrub, an active conda env's `site-packages` can shadow the portable's CUDA torch and force CPU-only sampling (800+ s/iter symptoms). This test is only meaningful on a rig where conda auto-activates; skip otherwise.

---

### M0 acceptance summary

When all of M0-1 through M0-12 are `[x]`, M0 is shipped. Update [implementation_plan.md](implementation_plan.md) to mark M0 as **VERIFIED ON RIG** with the date.

Outstanding gaps surfaced during M0 acceptance go into **M1 prerequisites** below.

---

## M1 — Real BenchmarkService + Flux2 image-edit (✅ MOSTLY VERIFIED)

### M1-1 — Calibrate flux2_klein_9b_t2i, generation-only timing
**Status:** [x] · **Date:** 2026-05-03 · **Rig:** RTX 5090

**Steps:**
1. Admin → hover the `flux2_klein_9b_t2i` card → click the gauge icon.
2. Wait for the toast `Calibrated "flux2_klein_9b_t2i": ~Xs generation (+Ys first-load)`.
3. Inspect `workflows/flux2_klein_9b_t2i/flux2_klein_9b_t2i.runtime.json`.

**Expected:**
- `estimatedDurationSec` reflects sampling + decode + save only (anchored on the first sampler progress event), NOT total wall-time.
- `coldDurationSec` and `modelLoadSec` are also written.
- `samplesPerSec` is a positive number (steps − 1) / sample-phase duration.
- The card now shows `~Xs calibrated` instead of `~45s uncalibrated`.

---

### M1-2 — Calibrate Flux2 image-edit (built-in reference image)
**Status:** [x] · **Date:** 2026-05-03 · **Rig:** RTX 5090

**Steps:**
1. Admin → hover any image-edit workflow card → click the gauge icon.
2. Watch the server log: `[Worker] using external ComfyUI` then sampler progress events.

**Expected:**
- No "Invalid image file" error — the calibration auto-substitutes `__comfyq_calibration.png` into every image-typed exposed parameter.
- The PNG is created on first call at `<comfy_root>/input/__comfyq_calibration.png` (512×512 grey RGB).
- `runtime.json` written with realistic timing.

---

### M1-3 — Flux2 Klein 9B text-to-image
**Status:** [x] · **Date:** 2026-05-03 · **Rig:** RTX 5090

**Steps:**
1. Activate the Flux2 t2i workflow.
2. Schedule a job with a fresh prompt; leave seed on auto-randomize.
3. Wait for completion.

**Expected:**
- Job lands `completed`, image renders in the Recent Generations card.
- The card's WorkflowChip shows the Flux2 t2i name.
- Re-opening the dialog re-rolls the seed automatically; the dice icon also re-rolls on demand.

---

### M1-4 — Flux2 Klein 9B image-edit (1 input image)
**Status:** [x] · **Date:** 2026-05-03 · **Rig:** RTX 5090

**Steps:**
1. Activate the Flux2 image-edit workflow.
2. Schedule a job; drag-and-drop a source image into the upload field.
3. Submit and wait.

**Expected:**
- The source uploads to `<comfy_root>/input/comfyq_session__<ts>__<rand>__<orig>` and that filename is injected into the LoadImage node's `image` field.
- Generation completes; output renders.
- Worker log: `[Executor] picking up job <id8> user=<name> workflow=<id>`.

---

### M1-5 — Flux2 Klein 9B image-edit with reference image (2 input images)
**Status:** [x] · **Date:** 2026-05-03 · **Rig:** RTX 5090

**Steps:**
1. Activate the 2-image Flux2 image-edit workflow.
2. Schedule a job; upload both required images.
3. Submit.

**Expected:**
- Both `LoadImage` nodes receive their respective uploaded filenames.
- Generation completes; output renders.

---

### M1-6 — Live-time timeline
**Status:** [x] · **Date:** 2026-05-03 · **Rig:** RTX 5090

**Steps:**
1. Open the timeline. Note the visible window: 10 min back / 50 min ahead of "now".
2. Wait at least 30 seconds without panning.
3. Pan the timeline manually.

**Expected:**
- The window auto-slides to keep "now" in view (every 10 s).
- The "Following" button is highlighted (primary variant).
- Manual pan disables auto-follow; the button becomes "Now" (secondary). Click it to re-engage.

---

### M1-7 — Workflow upload + auto-scaffold + editor
**Status:** [x] · **Date:** 2026-05-03 · **Rig:** RTX 5090

**Steps:**
1. Admin → "Add Workflow" → drag in a fresh API JSON saved from ComfyUI's Dev mode.
2. Toast confirms registration with the parameter count.
3. The metadata editor opens automatically.
4. Click **Hide infrastructure** (drops `unet_name` / `vae_name` / `clip_name*` / `weight_dtype` / `device` / `type` / `upscale_method` / `resolution_steps` / `megapixels` / `batch_size`).
5. Tweak labels and defaults for the params students should see, then **Save metadata**.

**Expected:**
- `workflows/<id>/<id>.api.json` and `<id>.meta.json` created.
- Re-opening the editor (pencil icon on the card) shows the saved subset enabled and the rest as toggleable-off rows.
- Filter selector (`Show all` / `Only enabled` / `Only disabled`) works.

---

### M1-8 — Per-card actions: edit, calibrate, delete
**Status:** [x] · **Date:** 2026-05-03 · **Rig:** RTX 5090

**Steps:**
1. Admin → hover a workflow card. Three icons appear top-right.
2. Pencil → editor opens.
3. Gauge → calibration runs (spinner on the icon while in flight).
4. Trash → confirmation modal lists what will be deleted; cancel and try again with confirm.

**Expected:**
- Delete is disabled on the active workflow with a tooltip explaining why.
- Confirmation modal shows the workflow id and a summary of consequences.
- After confirm: folder removed, library refreshes automatically, picked-workflow state clears if it was the deleted one.

---

### M1-9 — Emergency stop
**Status:** [x] · **Date:** 2026-05-03 · **Rig:** RTX 5090

**Steps:**
1. From a busy student session, navigate to admin (`/admin`).
2. Click **Stop & kill all** (red button, top-right).
3. Confirm in the modal.

**Expected:**
- Toast: `Emergency stop: N scheduled cancelled, M in-flight failed, ComfyUI killed — restarting in admin mode…`.
- Server log shows the cancellation counts followed by `[ComfyProcess] Spawning…` or "killed" depending on whether ComfyQ launched ComfyUI.
- After ~2.5s the page reloads in admin mode. Active workflow is unset.

---

### M1-10 — Per-job workflow chip
**Status:** [x] · **Date:** 2026-05-03 · **Rig:** RTX 5090

**Steps:**
1. Run jobs across two different workflows.
2. View Recent Generations cards, the MyJobs sidebar, and the lightbox.

**Expected:**
- Every entry shows a small workflow chip with the resolved name.
- Hovering shows the full name. If a workflow has been deleted from the library, the chip falls back to the raw id and the lightbox annotates "No longer in library".

---

### Outstanding M1 work (deferred)

- **M1-D1** Depth preprocessor fixture + `MediaStore` reads from `<comfy_root>/temp/`. Deferred to M3.
- **M1-D2** Input cleanup TTL: book 5 quick jobs, wait `inputRetentionMinutes` + 1, confirm namespaced files swept.

## M2 — Phase 2 (job mgmt) + Phase 3 (real-time progress)

- M2-1 User color coding (deterministic per username) on timeline + cards.
- M2-2 MyJobs search by prompt substring.
- M2-3 MyJobs date filter.
- M2-4 CSV export covers `id, user, workflow, scheduled_at, finished_at, status, prompt, error_reason`.
- M2-5 Real-time `ProgressViz`: live current node + step %.
- M2-6 ETA badge counts down; matches actual finish time within 15%.

## M3 — LTX 2.3 video-from-reference + long-job support

- M3-1 LTX video job (~5 min) completes; output is mp4 with correct MIME.
- M3-2 Mid-job ComfyUI kill → `failed: errorPhase=executing` with descriptive reason.
- M3-3 Back-to-back Flux2 9B → LTX: server log shows `[Worker] /free invoked: budget-exceeded`. nvidia-smi confirms VRAM drops between jobs.
- M3-4 History polling deadline honored: an LTX job exceeding `maxRuntimeSec` fails with `runtime-budget-exceeded` (artificial test: set `maxRuntimeSec` to 60 in meta, run a long job).

## M4 — Phase 4 (webcam / mobile capture) + 360 video LoRA

- **M4-1** File-picker capture path: on a Flux2 image-edit slot, click **Upload image**, pick a 12 MP phone photo. Browser console shows `[imageResize] resized <orig>×<orig> → <≤maxEdge>×… (<orig>kB → <new>kB)`. Job submits and the result is generated from the downscaled image, not the raw 12 MP. Also: open the workflow in the admin editor, set `maxInputEdge: 768` on the image param, re-upload — console reflects the new max edge.
- **M4-2** ✅ **VERIFIED 2026-05-15** — Live webcam capture (desktop): open `https://localhost:5173` (or `https://<lan-ip>:5173` after accepting the self-signed cert). On a Flux2 image-edit slot, click **Use camera** → live preview opens in modal → browser prompts for camera permission → grant → live video shows. Click **Capture** → snapshot freezes → **Use this shot** → modal closes, preview thumbnail appears in BookingDialog, submit. Verify `[imageResize]` log fires on the canvas-derived File. Also exercise **Retake** and **Switch** (if multiple cameras). **Regression caught during M4-2:** initial constraint must be `{ video: true }`, not `{ video: { facingMode: 'user' } }` — desktop Chrome on Windows throws `NotFoundError` on the latter when the connected device doesn't report facing metadata.
- **M4-2-fallback** On `http://<lan-ip>:5173` (no HTTPS): **Use camera** falls back to the file picker without prompting for permission. No console errors. This is the documented behavior — `canUseLiveCamera()` short-circuits when `window.isSecureContext` is false.
- **M4-3** Mobile video capture: from a phone on the LAN, hit `https://<lan-ip>:5173`, accept cert, book a video workflow, click **Use camera** → OS camera app opens in video mode → record → return → file appears as preview. Submit, verify the server gets a native MP4.
- **M4-4** Desktop MediaRecorder video (best-effort): record → preview → submit; document codec on the workflow's output card.
- **M4-5** 360 video LoRA: LoRA strength sliders surface in BookingDialog without code changes (proves no whitelist regression). Output mp4 plays.
- **M4-iOS** iOS Safari `getUserMedia`: capture re-encoded as PNG/JPEG via canvas before upload (open risk #3 in plan).

## M5 — Audio I/O + LTX audio-driven

- M5-1 In-browser audio recorder produces a wav file.
- M5-2 LTX audio-driven completes; `MyJobs` shows BOTH audio and video outputs; both play.
- M5-3 Re-book by uploading a wav from disk; succeeds.
- M5-4 Output classifier returns the right MIME for `.wav`, `.mp4`, `.png` based purely on extension.

---

## Test rig log

Use this section to track which physical machines have been validated against which milestone. Helpful when machines diverge (e.g. a 3090 fails OOM where a 4090 doesn't).

| Rig | GPU | OS | ComfyUI version | M0 | M1 | M2 | M3 | M4 | M5 |
|-----|-----|-----|-----------------|----|----|----|----|----|----|
|     |     |     |                 |    |    |    |    |    |    |
|     |     |     |                 |    |    |    |    |    |    |
