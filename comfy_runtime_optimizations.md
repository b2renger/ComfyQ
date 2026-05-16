# ComfyUI runtime optimizations for the workshop rigs (RTX 40xx + 50xx)

> Operator advice for the portable ComfyUI install at
> `D:\ComfyUI_windows_portable_nvidia\ComfyUI_windows_portable\`.
> **No ComfyQ code changes.** Execution is `python_embeded/python.exe -m pip install …`
> commands run against the embedded interpreter. Each item below lists install
> command + benefit + risk, in priority order.
>
> **GPU compatibility scope.** Tier 1 (SageAttention + Triton) is safe on both
> Ada Lovelace (RTX 4070/4080/4090, sm_89) and Blackwell (RTX 5090, sm_120).
> Tier 2 (cu130 upgrade) is **Blackwell-only**: the kernels it unlocks target
> sm_120; Ada gains nothing and the ABI-churn risk is the same. On a 40xx rig,
> stop after Tier 1.

## Status (as of 2026-05-16)

**Tier 1 executed on the 5090 workshop rig.** Installed: `sageattention 1.0.6` (PyPI wrapper, Triton-backed) + `triton-windows 3.7.0.post26` (cp312 binary wheel, no compilation). Boot log confirms every Tier 1 verification matrix prediction held:

- `[FlashVSR] ✓ SageAttention detected (~20-30% speedup enabled)` — was ○
- `⚡ SeedVR2 optimizations check: SageAttention ✅ | … | Triton ✅` — both were ❌
- `Found comfy_kitchen backend triton: {'available': True, 'disabled': True, …}` — was ImportError; `disabled: True` is gated by cu130 (expected, we're staying on cu128)
- `AILab_SAM3Segment.py` no longer raises `No module named 'triton'` — node loads
- `Warning: Could not load sageattention` — gone

**Tier 2 (cu130 upgrade): not done, intentionally.** Skipping to preserve cross-rig compatibility with 40xx hardware. The cu130 warning and `comfy_kitchen backend cuda: 'disabled': True` continue to print at boot — benign; eager backend handles those code paths.

**Post-install recalibration: done.** Registered workflows were recalibrated through the admin UI after Tier 1 landed; updated `estimatedDurationSec` values in each `<id>.runtime.json` are now feeding the Scheduler's timeline collision detection. The actual before/after numbers per workflow live in those sidecar files — they're per-deployment and gitignored, so they don't surface in the repo.

**Tier 1B cosmetic note.** PowerShell's default codepage mangles one emoji in SeedVR2's check line: `Flash Attention �`. The `�` is whatever it would print for ❌ — `flash-attn` is in Tier 3 (skip) since SDPA already gives FA2 on Blackwell + Ada, so no action.

## Context

This document was produced after scanning a ComfyQ boot log on a workshop machine — specifically the line `[ComfyUI!] xFormers not available` (printed twice) triggered the question: **what is xFormers, how do we use it, what would be the benefit** — and more broadly, are there improvements we can make to the ComfyUI setup based on what the startup output is telling us.

### Rig snapshot (from log)

- **GPU**: NVIDIA GeForce RTX 5090 — Blackwell, **sm_120 compute capability**, 32 GB VRAM
- **CPU/RAM**: 128 GB total system RAM
- **Python**: 3.12.10 (portable)
- **PyTorch**: 2.9.1+cu128
- **ComfyUI**: 0.18.1
- **OS**: Windows

### What the log told us

Direct quotes from the boot output that translate to actionable items:

| Log line | What it means |
|---|---|
| `WARNING: You need pytorch with cu130 or higher to use optimized CUDA operations.` | Currently on cu128; some kernels in the new `comfy_kitchen` backend can't run. |
| `Found comfy_kitchen backend cuda: ... 'disabled': True` | The FP8 / NVFP4 / MXFP8 quantization kernels (5090-class native) are present but disabled. Tied to the cu130 warning above. |
| `Found comfy_kitchen backend triton: ... ImportError: No module named 'triton'` | Triton compiler missing → Triton-backed kernels fall back to eager Python. |
| `Found comfy_kitchen backend eager: 'available': True, 'disabled': False` | Currently using eager mode (Python loops, slowest path). |
| `Using pytorch attention` | Attention runs through PyTorch's built-in `scaled_dot_product_attention` (SDPA). This is **already the FlashAttention-2 fast path** on Blackwell. |
| `xFormers not available` (×2) | Meta's xFormers library not installed. **See "About xFormers" below — almost certainly NOT worth installing.** |
| `[FlashVSR] ○ SageAttention not installed (optional speedup available)` | FlashVSR custom node wants SageAttention. |
| `[SeedVR2] SageAttention ❌ \| Flash Attention ❌ \| Triton ❌` | SeedVR2 video upscaler explicitly lists three missing acceleration libs. |
| `Warning: Could not load sageattention: No module named 'sageattention'` | Confirmed sageattention isn't installed. |
| `Error loading ... AILab_SAM3Segment.py: No module named 'triton'` | A SAM3 segmentation node is **crashing on import** because Triton is missing. |
| `🔧 Conv3d workaround active: PyTorch 2.9.1, cuDNN 91002 (fixing VAE 3x memory bug)` | Automatic workaround for a known cuDNN bug. Already handled, no action needed. |
| Vite proxy `ECONNREFUSED /admin/mode` (×8 at boot) | Cosmetic: Vite came up before Express. Self-resolves in 2–3 s when Express binds. No action. |

---

## About xFormers (the direct question)

**What it is.** [xFormers](https://github.com/facebookresearch/xformers) is a library from Meta AI that ships memory-efficient transformer building blocks — most importantly a CUDA-kernel implementation of attention. From ~2022 through ~2024 it was the de-facto way to make diffusion models go fast: SD 1.5 / SDXL workflows installed xFormers and got 30–50% speedups.

**Why everybody talks about it.** Two reasons. Before PyTorch 2.0, vanilla PyTorch attention was a slow, memory-hungry matrix multiply; xFormers gave you Flash Attention years before it was native. And custom nodes from that era unconditionally try to import it, so the `xFormers not available` warning printed by ComfyUI is **inherited by anything checking for it**, even when the underlying compute is fine.

**Why "not available" is no longer a problem in 2026.** PyTorch 2.x's built-in `scaled_dot_product_attention` (SDPA) automatically picks the best kernel — typically Flash Attention 2, sometimes FA3 on newer hardware. On a 5090 + PyTorch 2.9.1+cu128, the SDPA fast path IS Flash Attention. The log line `Using pytorch attention` confirms this. xFormers would, at best, match it; at worst, lose because it doesn't have Blackwell-tuned kernels.

**Why we explicitly should NOT install xFormers on this rig.**

1. **No prebuilt wheel for Blackwell + cu128 + Python 3.12.** This codebase already went through ABI-mismatch hell building `custom_rasterizer` from source against torch 2.9.1+cu128 for Hunyuan3D. xFormers would be the same story or worse — its build process bakes the torch ABI into compiled .pyd files, and a single torch upgrade later would crash imports.
2. **No speed benefit on RTX 5090.** PyTorch SDPA on Blackwell already dispatches to Flash Attention 2. xFormers wraps the same kernels.
3. **Real risk of breaking other custom nodes.** xFormers monkey-patches attention; on certain workflows this changes numerical behavior subtly.

**Bottom line on xFormers.** Ignore the warning. Suppress it from your mental model. There is nothing to install for it; ComfyUI is already on the fast attention path. If a custom node in the future *requires* xFormers (not just checks for it), revisit then.

The libraries that ARE worth installing on this rig live under "Tier 1 — high value" below.

---

## Tier 1 — high value, low risk (do these first; safe on RTX 40xx + 50xx)

### A. SageAttention (probably the single biggest win)

**What it is.** A drop-in replacement for attention kernels, built on quantized math (INT8 / FP8 per-head). On Ada Lovelace it's typically 1.5–2× faster than Flash Attention 2; on Hopper/Blackwell it's **typically 2–3× faster**. Multiple custom nodes on this rig explicitly want it (FlashVSR, SeedVR2). It's actively maintained — version 2.x added sm_120 (Blackwell) support and continues to support sm_89 (Ada).

**Install** (from a normal cmd — NOT the conda/venv-active shell, to keep the env clean):

```cmd
cd /d D:\ComfyUI_windows_portable_nvidia\ComfyUI_windows_portable
python_embeded\python.exe -m pip install sageattention
```

> ⚠️ **What pip actually installs.** PyPI ships **sageattention 1.0.6** — a
> ~20 kB Triton-backed implementation, not the 2.x series with native CUDA
> kernels. v1.x **requires Triton** (Tier 1B below) to do anything at all, so
> install both. v1.x is close to optimal on Ada / RTX 40xx, and is fully
> functional on Blackwell (verified: sageattn ran end-to-end on RTX 5090
> sm_120 and was ~6× faster than torch SDPA on a 2×16×1024×64 fp16 attention
> micro-benchmark). The 2.x series with Blackwell-tuned CUDA kernels is
> **GitHub source only** — see "Optional follow-up: SageAttention 2.x" below.

**Verify after restart.** The log should now read `[FlashVSR] ✓ SageAttention loaded` instead of the ○. SeedVR2 should report `SageAttention ✓`. Workflows that opt-in to it (LTX video, FlashVSR, SeedVR2) become noticeably faster — measure with a calibration run on `video_ltx2_3_i2v` before and after.

**Risk.** Low. SageAttention loads at runtime; if the import is broken, nodes simply fall back to PyTorch attention with no crashes. v1.x has the additional Triton dependency — if Triton is missing, the SageAttention import itself fails.

**Optional follow-up: SageAttention 2.x (Blackwell-only further win).** v2.x adds hand-tuned CUDA kernels for sm_120, typically 2–3× faster than v1.x on Blackwell. Not on PyPI; build from source:

```cmd
git clone https://github.com/thu-ml/SageAttention
cd SageAttention
set TORCH_CUDA_ARCH_LIST=8.9;9.0;12.0
D:\ComfyUI_windows_portable_nvidia\ComfyUI_windows_portable\python_embeded\python.exe -m pip install .
```

Requires VS Build Tools + CUDA toolkit (already configured from the Hunyuan3D session). ~5 minute build. On 40xx, v1.x is good enough and the v2.x build is not worth the toolchain risk.

### B. Triton (unlocks a crashing node + future optimizations)

**What it is.** OpenAI's JIT compiler for CUDA kernels. Modern custom nodes increasingly use Triton for hand-tuned ops (FlashAttention 3 is implemented in Triton). On Windows the official `triton` package doesn't have wheels; use the community-maintained `triton-windows`.

**Install**:

```cmd
python_embeded\python.exe -m pip install triton-windows
```

`triton-windows` provides binary wheels matched to recent PyTorch versions. On Python 3.12 + PyTorch 2.9 you should get a wheel without compilation.

**Verify after restart.** Watch for these log lines to flip:
- `Found comfy_kitchen backend triton: 'available': True` (currently `False`)
- The `Error loading ... AILab_SAM3Segment.py: No module named 'triton'` line should disappear — SAM3 segment node will load.
- `[SeedVR2] ... Triton ✓` (currently ❌).

**Risk.** Low–medium. If the wheel doesn't match your torch ABI you'll get an import error at boot which gracefully degrades (the affected nodes just don't load, like today). Easy rollback: `pip uninstall triton-windows`.

---

## Tier 2 — medium risk, big payoff (Blackwell / RTX 5090 only — SKIP on RTX 40xx)

> ⚠️ **40xx rigs stop here.** The payoff is Blackwell-specific tensor-core kernels
> (NVFP4, MXFP8) that Ada hardware cannot run. cu130 still supports sm_89 so it
> wouldn't *break* a 4090/4080/4070, but the ABI-churn cost is identical to a
> 5090 and the speed benefit is ~zero. On a 40xx rig, the Tier 1 installs are
> the whole plan.

### C. PyTorch cu130 upgrade (Blackwell-only)

**What.** Move from torch 2.9.1+cu128 to torch 2.9.x+cu130 (or whatever the current latest cu130 build is in May 2026). The log explicitly says: `You need pytorch with cu130 or higher to use optimized CUDA operations.`

**Why.** This is what un-disables the `comfy_kitchen` CUDA backend, which carries native FP8 / NVFP4 / MXFP8 quantization kernels for Blackwell. On 5090, these are the kernels NVIDIA designed the new tensor cores around. Workflows that use FP8 weights (Flux2 Klein 9B fp8, Qwen 3 8B fp8mixed — already in your workflow library) become materially faster. On Ada (4090/4080/4070), FP8 is already reachable via the existing cu128 path and NVFP4/MXFP8 don't exist in hardware — no win.

**Install** (workshop-level commit, not for the middle of a class):

1. Back up the portable folder first — copy `D:\ComfyUI_windows_portable_nvidia` to `…_backup_pre_cu130`. Cheap insurance.
2. `python_embeded\python.exe -m pip install --upgrade --force-reinstall torch==<latest> torchvision torchaudio --index-url https://download.pytorch.org/whl/cu130`
3. Reinstall every custom-built wheel you have: `custom_rasterizer`, `mesh_inpaint_processor`, and SageAttention (Tier 1) if you installed it before this. Their compiled .pyd files are pinned to the torch ABI.

**Risk.** HIGH. This codebase already wrestled with torch+CUDA wheel ABI mismatches in the Hunyuan3D session. Plan it as a separate ~1-hour task with the backup ready. Run the full smoke fixture (M0 manual_tests) afterward to confirm Flux2 / LTX / Hunyuan3D all still work.

**Sequencing note.** If you do Tier 1 (SageAttention) first, you'll need to reinstall it after the cu130 upgrade because the cu128 wheel won't load against cu130 torch. Either: (a) do cu130 first, then SageAttention, OR (b) accept the double install of SageAttention. (a) is cleaner.

---

## Tier 3 — skip these (low value or high cost for this rig)

- **xFormers** — see long section above. Don't install.
- **flash-attn (standalone)** — Windows wheels are spotty; PyTorch SDPA already gives you FA2 on Blackwell. The benefit over `pip install sageattention` is nil for this rig.
- **Disabling the Conv3d workaround** — the cuDNN bug it works around is real; let it stay until cuDNN ships the fix and PyTorch picks it up.

---

## Recommended order of operations

If you tackle this:

1. **Now / cheap (both rig classes)**: Tier 1A SageAttention (single pip command, ~2 min). Restart ComfyQ. Verify log lines flipped. Recalibrate LTX video and one Flux2 workflow — note the new `estimatedDurationSec` in `runtime.json`.
2. **Now / cheap (both rig classes)**: Tier 1B Triton-windows (single pip command, ~1 min). Restart. Confirm SAM3 node loads + Triton-backend flips.
3. **Blackwell-only, schedule for a maintenance hour**: Tier 2 cu130 upgrade. Backup the portable folder. Reinstall the four compiled deps. Re-run the M0 smoke matrix. **Skip this entirely on a 40xx rig.**

After step 1 + step 2 the startup log should look noticeably cleaner: `xFormers not available` will still print (we're ignoring it) but every other ❌ should be a ✓.

---

## Verification matrix

After each tier, restart ComfyQ (`Ctrl+C`, then `npm run dev` — or use [start-comfyq.bat](start-comfyq.bat)) and check the boot log:

| Line | Before | After Tier 1A (SageAttention) | After Tier 1B (Triton) | After Tier 2 (cu130) |
|---|---|---|---|---|
| `Using pytorch attention` | ✓ | ✓ (unchanged — pytorch SDPA stays the default; some nodes opt-in to Sage) | ✓ | ✓ |
| `xFormers not available` | ⚠️ shown | ⚠️ still shown (we don't fix this) | ⚠️ still | ⚠️ still |
| `SageAttention not installed` / `SageAttention ❌` | ❌ | ✓ | ✓ | ✓ |
| `[SeedVR2] Triton ❌` | ❌ | ❌ | ✓ | ✓ |
| `comfy_kitchen backend triton ... ImportError` | ❌ | ❌ | available:true | available:true |
| `comfy_kitchen backend cuda ... disabled:True` | disabled | disabled | disabled | **enabled** (5090 only — on 40xx the disabled flag is benign, those kernels aren't for Ada) |
| `WARNING: You need pytorch with cu130` | ⚠️ | ⚠️ | ⚠️ | **gone** (5090 only — on 40xx the warning persists harmlessly) |
| `AILab_SAM3Segment.py: No module named 'triton'` | error | error | **loads** | loads |

Calibration timing (LTX i2v workflow) is the real signal for "did it get faster": run `Calibrate` on the workflow card in admin mode before and after each tier; `runtime.json` records the new `estimatedDurationSec`. Tier 1A typically halves attention-bound time; Tier 2 unlocks FP8 throughput. Tier 1B is correctness, not speed.

---

## What NOT to do based on this log

- Don't install xFormers. ComfyUI already on the fast attention path.
- Don't worry about the eight `ECONNREFUSED /admin/mode` errors at boot — it's Vite proxying to Express before Express binds. Self-resolves; harmless cosmetic noise.
- Don't disable the Conv3d workaround. It's protecting against a real cuDNN memory leak in VAE decode.
- Don't switch to Python 3.13 yet. Several custom-built deps (the Hunyuan3D wheels compiled in earlier work, possibly SageAttention) are pinned to cp312.

---

## File touch surface

- **Zero ComfyQ files modified.** All changes happen in the portable ComfyUI Python env at `D:\ComfyUI_windows_portable_nvidia\ComfyUI_windows_portable\python_embeded\Lib\site-packages\`.
- ComfyQ picks up the new state automatically on next worker spawn — no code changes needed on the middleware side.
- After Tier 1, consider re-running calibration via the admin UI for every workflow; the updated `runtime.json` numbers feed the timeline's collision detection.

This is operator/setup advice, not a coding milestone — nothing here lands in the ComfyQ commit history other than this document itself.
