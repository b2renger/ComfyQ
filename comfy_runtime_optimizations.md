# ComfyUI runtime optimizations for the workshop rig (RTX 5090)

> Operator advice for the portable ComfyUI install at
> `D:\ComfyUI_windows_portable_nvidia\ComfyUI_windows_portable\`.
> **No ComfyQ code changes.** Execution is `python_embeded/python.exe -m pip install …`
> commands run against the embedded interpreter. Each item below lists install
> command + benefit + risk, in priority order.

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

## Tier 1 — high value, low risk (do these first)

### A. SageAttention (probably the single biggest win)

**What it is.** A drop-in replacement for attention kernels, built on quantized math (INT8 / FP8 per-head). On Hopper/Blackwell it's **typically 2–3× faster than Flash Attention 2** for the same quality target. Multiple custom nodes on this rig explicitly want it (FlashVSR, SeedVR2). It's actively maintained — version 2.x added sm_120 (Blackwell) support.

**Install** (from a normal cmd — NOT the conda/venv-active shell, to keep the env clean):

```cmd
cd /d D:\ComfyUI_windows_portable_nvidia\ComfyUI_windows_portable
python_embeded\python.exe -m pip install sageattention
```

If pip can't find a Blackwell-compatible wheel it'll try to build from source (needs Visual Studio Build Tools, CUDA toolkit, and `TORCH_CUDA_ARCH_LIST="8.9;9.0;12.0"`). That's a 5-minute build; the build chain is already set up from the Hunyuan3D session.

**Verify after restart.** The log should now read `[FlashVSR] ✓ SageAttention loaded` instead of the ○. SeedVR2 should report `SageAttention ✓`. Workflows that opt-in to it (LTX video, FlashVSR, SeedVR2) become noticeably faster — measure with a calibration run on `video_ltx2_3_i2v` before and after.

**Risk.** Low. SageAttention loads at runtime; if the wheel is broken, nodes simply fall back to PyTorch attention with no crashes.

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

## Tier 2 — medium risk, big payoff (do when you have a maintenance window)

### C. PyTorch cu130 upgrade

**What.** Move from torch 2.9.1+cu128 to torch 2.9.x+cu130 (or whatever the current latest cu130 build is in May 2026). The log explicitly says: `You need pytorch with cu130 or higher to use optimized CUDA operations.`

**Why.** This is what un-disables the `comfy_kitchen` CUDA backend, which carries native FP8 / NVFP4 / MXFP8 quantization kernels for Blackwell. On 5090, these are the kernels NVIDIA designed the new tensor cores around. Workflows that use FP8 weights (Flux2 Klein 9B fp8, Qwen 3 8B fp8mixed — already in your workflow library) become materially faster.

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

1. **Now / cheap**: Tier 1A SageAttention (single pip command, ~2 min). Restart ComfyQ. Verify log lines flipped. Recalibrate LTX video and one Flux2 workflow — note the new `estimatedDurationSec` in `runtime.json`.
2. **Now / cheap**: Tier 1B Triton-windows (single pip command, ~1 min). Restart. Confirm SAM3 node loads + Triton-backend flips.
3. **Schedule for a maintenance hour**: Tier 2 cu130 upgrade. Backup the portable folder. Reinstall the four compiled deps. Re-run the M0 smoke matrix.

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
| `comfy_kitchen backend cuda ... disabled:True` | disabled | disabled | disabled | **enabled** |
| `WARNING: You need pytorch with cu130` | ⚠️ | ⚠️ | ⚠️ | **gone** |
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
