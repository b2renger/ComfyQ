# ComfyQ — project memory

Portable project knowledge for ComfyQ (multi-user ComfyUI workflow scheduler, v2 line on the `v2` branch). This file lives in the repo so it travels with the project across machines/drives — keep it here, not in any machine-local `~/.claude/` folder. Paths below are **relative to the repo root** (the drive letter changes between machines, so never hardcode `D:\`).

Detailed, evolving plans live in [implementation_plan.md](implementation_plan.md); user-facing overview in [README.md](README.md). This file is the durable, auto-loaded summary + the "why" behind decisions that aren't obvious from the code.

## Runtime / environment
- **Node: LTS only.** Currently **Node 24 "Krypton"**, pinned in [.nvmrc](.nvmrc) (`24`) with `engines.node` = `>=22.0.0 <25.0.0` in the root, [server](server/package.json), and [client](client/package.json) `package.json`. Odd-numbered "Current" releases (23, 25, …) are unsupported — the lab runs varied machines and needs an LTS line. When Node 26 becomes LTS (~Oct 2026), bump `.nvmrc` + the three `engines` ceilings.
- **Windows winget gotcha:** winget ships Node as two packages. `OpenJS.NodeJS` is the **wrong** (Current) one; use **`OpenJS.NodeJS.LTS`**. To swap: `winget uninstall --id OpenJS.NodeJS --exact` then `winget install --id OpenJS.NodeJS.LTS --exact` (needs admin; globals in `%AppData%\npm` survive).
- **`better-sqlite3` is the only native dep**, pinned to v12+ for N-API prebuilds (one binary across Node versions, no per-machine recompile). After any Node *major* change, wipe `node_modules` and `npm install` so the ABI matches.

## Serving model — plain HTTP (do NOT re-add HTTPS)
- The dev/workshop UI is served over **plain HTTP** (Vite on :5173, proxying the Express backend). The self-signed HTTPS layer (`@vitejs/plugin-basic-ssl`) was tried and **reverted 2026-05-19**: self-signed certs can't be trusted across BYOD Safari + Chrome + mobile without installing a CA on every device, and Safari refused to extend a click-through to the websocket and to media downloads.
- **Don't reintroduce `@vitejs/plugin-basic-ssl` or `https: true`** in [client/vite.config.js](client/vite.config.js). The only feature it enabled — in-browser webcam capture (`getUserMedia`, needs a secure context) — was removed; image/video inputs are uploaded as files (a phone's file picker still offers "Take Photo").

## Workflow roadmap (target-workflows queue, re-prioritized 2026-06-08)
Each row is a probe into "does ComfyQ stay zero-config when a new workflow lands?" — fixes land generally (registry / primitive-fallback parser / MediaStore classifier / viewers / multi-output UX), never per-workflow. Active order:
1. **TripoSplat** (image → Gaussian splat) — replaces the dropped Hunyuan3D row. Multi-output (`SaveVideo` + `SaveGLB`×2). Needs a **Gaussian-splat viewer** (new three.js splat renderer) alongside the **GLB mesh viewer already built** ([client/src/components/ui/ModelViewer.jsx](client/src/components/ui/ModelViewer.jsx)). Open: which splat format to save/serve (`.spz`/`.ply`/`.splat`).
2. **Qwen image-to-multiview** (N images) — needs the multi-output gallery.
3. **Audio (SD3 + ACE)** — needs the audio I/O subsystem (player + audio input type; output classification already exists).
4. **Ideogram + Kijai prompt builder** — parameter surfacing for the Kijai prompt-builder node.

Backlog/superseded: Hunyuan3D 2.1, LTX 2.3 i2v, LTX audio-driven, 360 LoRA. Full detail + the cross-cutting infra state (multi-output UX & audio I/O & GS viewer = MISSING; long-job robustness = READY) is in [implementation_plan.md](implementation_plan.md) under "Target workflows".

## Federation (Phase F — deferred, design locked)
The final v2 phase is multi-instance LAN federation (mDNS peers, fleet admin view, student station picker, orchestrator role). Design is locked, implementation deferred; full plan in [implementation_plan.md](implementation_plan.md) → "Phase F". **Implication for current work:** don't bake in single-instance assumptions — if a feature surfaces user-visible state that should be aggregable across peers later (e.g. job history), structure it so a future `/federation/*` endpoint can return it without a schema migration.

## Conventions
- **API-format workflows only** (no Litegraph auto-conversion). **Generic output detection** by file extension, not `class_type`.
- Commit/push only when the user explicitly asks.
