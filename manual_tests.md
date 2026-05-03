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

## M0 — v2 skeleton runs Flux1 dev t2i

Goal: end-to-end "book a t2i job in the timeline → watch progress → image renders → restart safely."

Required on the rig:
- Working ComfyUI install
- Models for `flux1_dev_t2i`: `flux1-dev-fp8.safetensors`, `t5xxl_fp8_e4m3fn.safetensors`, `clip_l.safetensors`, `ae.safetensors`
- C++ build tools available to npm (for `better-sqlite3`)

### M0-1 — First-run admin mode
**Status:** [ ] · **Date:** · **Rig:**

**Steps:**
1. Fresh clone, `npm install`, `npm run dev`.
2. Browser → `http://<host>:3000`.

**Expected:**
- Auto-redirect to `/admin`.
- "Server is in **admin** mode" badge.
- Workflow library shows `flux1_dev_t2i` as available and `flux2_klein_9b_t2i` listed under "Broken workflows" with reason `Missing workflow file: flux2_klein_9b_t2i.api.json`.
- Server log shows `[Config] Detected v1 config.json (or unversioned). Archiving to config.json.v1.bak and starting fresh.` (only on the first run after a v1 install).

**If failed — capture:**
- Browser console errors
- `server/index.js` stdout (from terminal)
- The contents of `config.json` (whatever it ended up as)

**Notes:** _(date / failure mode / what you tried)_

---

### M0-2 — Configure ComfyUI paths
**Status:** [ ] · **Date:** · **Rig:**

**Steps:**
1. In **ComfyUI Settings**: enter `root_path`, `python_executable` (e.g. `../python_embeded/python.exe`), leave `output_dir` as `output`, set VRAM budget to your card's GB (24 for 3090/4090, 32 for 5090, 16 for 4080).
2. Click **Save settings**. Toast should confirm.
3. Refresh the page; values should persist.
4. Inspect `config.json` at the project root: `comfy_ui.root_path` and `comfy_ui.python_executable` should be present.

**Expected:** All paths persisted; values reload on refresh.

**If failed — capture:**
- The `PUT /admin/comfy` response in browser devtools network tab
- The current `config.json`

**Notes:**

---

### M0-3 — Activate Flux1 dev workflow → student mode
**Status:** [ ] · **Date:** · **Rig:**

**Steps:**
1. In **Workflow library**, click `flux1_dev_t2i`. Card highlights as selected.
2. Click **Activate & start student mode**. Toast: "Activating workflow…".
3. Server exits and restarts (nodemon picks up). Browser auto-redirects to `/user`.

**Expected:**
- Server log: `[ComfyQ] mode=student`, then `[ComfyQ] active workflow: flux1_dev_t2i`.
- ComfyUI either spawns (you'll see `[ComfyUI] ...` lines) or attaches to an existing instance (`External ComfyUI already responding; using it.`).
- After ComfyUI finishes loading: `[Worker] WS connected`, status pill turns to `ready`.

**If failed — capture:**
- Server stdout from boot to failure
- Whether ComfyUI is reachable directly at `http://127.0.0.1:8188`

**Notes:**

---

### M0-4 — Book a Flux1 dev t2i job
**Status:** [ ] · **Date:** · **Rig:**

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
**Status:** [ ] · **Date:** · **Rig:**

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
**Status:** [ ] · **Date:** · **Rig:**

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
**Status:** [ ] · **Date:** · **Rig:**

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
**Status:** [ ] · **Date:** · **Rig:**

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
**Status:** [ ] · **Date:** · **Rig:**

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
**Status:** [ ] · **Date:** · **Rig:**

**Steps:**
1. Run a successful t2i job (M0-4).
2. `curl http://<host>:3000/jobs/<jobId>` and inspect `outputs[]`.

**Expected:**
- At least one entry with `kind: "image"`, `mime: "image/png"`, `nodeId: "9"` (the SaveImage node), and a non-null `sizeBytes`.
- The collector did not need a `class_type` whitelist — the classification came from the `.png` extension alone.

**Notes:** If the SaveImage node id changes (different workflow), the classification still works because it's extension-driven.

---

### M0 acceptance summary

When all of M0-1 through M0-10 are `[x]`, M0 is shipped. Update [implementation_plan.md](implementation_plan.md) to mark M0 as **VERIFIED ON RIG** with the date.

Outstanding gaps surfaced during M0 acceptance go into **M1 prerequisites** below.

---

## M1 — Real BenchmarkService + Flux2 image-edit + Depth preprocessor

Don't start M1 implementation until M0 fully passes. M1 manual tests will be added here when M1 implementation lands. Sketched scope:

- M1-1 Calibrate `flux1_dev_t2i` → `runtime.json` written with realistic `estimatedDurationSec` and `samplesPerSec`. Timeline cell length matches actual run time.
- M1-2 Add Flux2 Klein 9B image-edit. Two LoadImage nodes; both inputs upload + namespace cleanly; output renders.
- M1-3 Add depth preprocessor. Output may be in `temp/`; verify `/media/image/<file>` resolves from temp.
- M1-4 Input cleanup: book 5 quick jobs, wait `inputRetentionMinutes` + 1, confirm namespaced files are gone from `<ComfyUI>/input/`.

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

- M4-1 Phone webcam capture submits a Flux2 image-edit job successfully.
- M4-2 360 video LoRA: LoRA strength sliders surface in BookingDialog without code changes (proves no whitelist regression). Output mp4 plays.
- M4-3 iOS Safari getUserMedia: capture re-encoded as PNG/JPEG via canvas before upload (open risk #3 in plan).

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
