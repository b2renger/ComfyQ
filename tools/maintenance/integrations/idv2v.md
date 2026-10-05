# ID-V2V — identity-preserving video restylization

**Status: installed, working, verified on this rig (2026-09-11).**

[ID-V2V](https://github.com/Eyeline-Labs/ID-V2V) (Eyeline Labs / Netflix, SIGGRAPH Asia 2026)
takes a **source video + one stylized keyframe** and re-renders the clip in that keyframe's
style and lighting **while the people keep their identity, expression, gaze and motion**.
Shoot first, restyle later.

This is the only integration on the drive that required **patching ComfyUI core**, which makes
it the most fragile thing here after the PyTorch pin. `REPAIR.bat` re-applies it automatically;
this document explains what it is and why.

---

## What is installed

| Piece | Where | Notes |
|---|---|---|
| Model `wan_2.1_idv2v_int8_convrot.safetensors` (20.2 GB) | `ComfyUI\models\diffusion_models\` | from [Kijai/Wan_ID_V2V_comfy](https://huggingface.co/Kijai/Wan_ID_V2V_comfy) — same int8-convrot quantisation the rig already uses for Wan-Animate |
| Core patch — 4 files, +17/−4 lines | ComfyUI working tree | automated by `REPAIR.bat`; reference diff in [`patches\comfyui-idv2v-pr15139.patch`](patches/comfyui-idv2v-pr15139.patch) |
| 3 example workflows | `ComfyUI\user\default\workflows\idv2v_*.json` | open from ComfyUI's **Workflows** sidebar |
| Demo assets | `ComfyUI\input\idv2v_demo_*` | 3 files: `_source.mp4` (100 frames, 720×720), `_frame0.png` (640×640, the raw first frame) and `_style.png` (1024×1024, its gouache restyle) |

**No custom-node pack was needed.** Everything else was already here: VideoHelperSuite
(`VHS_LoadVideo` / `VHS_VideoCombine`), KJNodes (`ImageResizeKJv2`, `ImageConcatMulti`,
`PathchSageAttentionKJ`), core Wan nodes, and all four supporting models —
`Wan2_1_VAE_bf16`, `umt5_xxl_fp8_e4m3fn_scaled`, `clip_vision_h`, and the
`lightx2v_I2V_14B_480p_cfg_step_distill_rank64_bf16` 4-step LoRA.

---

## ⚠ The core patch

ID-V2V is a **VACE control stack on a Wan 2.1 I2V base** — a combination stock ComfyUI cannot
load, because its VACE path assumes a T2V base. Support comes from
[ComfyUI PR #15139](https://github.com/comfyanonymous/ComfyUI/pull/15139) (Kijai), which is
**open, not merged** at the time of writing.

What it changes:

- `comfy\model_detection.py` — a VACE checkpoint that also carries `img_emb.proj.0.bias` is
  flagged `vace_image_input`. That is how an ID-V2V file is recognised.
- `comfy\supported_models.py` — such a model is built as image-to-video instead of T2V.
- `comfy\ldm\wan\model.py` — VACE blocks are T2V-pretrained, so they must attend over the
  **text tokens only**; the image tokens are sliced off before they reach them.
- `comfy_extras\nodes_wan.py` — `WanImageToVideo` gains the optional **`ref_pad_image`** input:
  the conditioning's padding frames are filled with the stylized keyframe instead of flat gray,
  which is what anchors identity without pinning frames.

### The ComfyUI updater silently removes it

`update\update_comfyui_stable.bat` → `update.py` calls `repo.stash()` **before** it checks out
the new version. Verified by replaying that exact pygit2 sequence: the update **succeeds**, no
error, no conflict, no prompt — and the patch is simply gone. ID-V2V then stops working with
nothing to tell you why (`ref_pad_image` vanishes from `WanImageToVideo`, and the model can no
longer be built as I2V+VACE).

Nothing is lost — the change survives in `git stash list` and the updater leaves a
`backup_branch_<timestamp>`. **But do not recover with `git stash pop`:** if upstream touched
nearby lines it writes `<<<<<<<` conflict markers *into the .py files*, which is a Python
syntax error and ComfyUI then won't start at all. Tested.

**Just run `REPAIR.bat`.** It re-applies the fix as anchored text edits scoped to the exact
class — verified byte-identical to `git apply` of the patch — and if upstream has moved an
anchor it reports `[FAIL]` and writes nothing, leaving a working install.

Check by hand:

```powershell
# grep is not on PATH on Windows - use findstr
findstr /C:"ref_pad_image" "<comfy root>\comfy_extras\nodes_wan.py"
# no output = the patch is missing, run REPAIR.bat
```

**When PR #15139 merges upstream**, `REPAIR.bat` prints a `[NOTE]` saying so. At that point
delete the `IdV2V` class from `repair_all.py`, this file, and the patch.

---

## The workflows

Open from ComfyUI's **Workflows** sidebar. They are pre-wired to the bundled demo assets, so
they run as soon as they open.

| | |
|---|---|
| `idv2v_00_grab_first_frame` | **Step 1** — exports frame 1 of a video at your target resolution, so you can restyle it |
| `idv2v_01_restyle_compare` | **Step 2** — the one to test with. Output is a 960×640 comparison: the result at full size on the right, with the keyframe above the source in a half-width column on the left |
| `idv2v_02_restyle_hires_clean` | **Step 3** — same graph at ~0.9 MP, comparison strip removed, saved to `output\ID-V2V\` |

The loop: grab frame 1 → restyle that PNG in any image workflow on the rig (Qwen Image-Edit,
Flux Klein edit, …) → drop it in `ComfyUI\input` → load it as the keyframe.

### Measured on this rig (RTX 5090, 81 frames, 4 steps)

| Resolution | Time | Result |
|---|---:|---|
| 640×640 | **79 s** | style transferred, identity + motion preserved |
| 960×960 | **177 s** | same, visibly cleaner |
| 1280×704 *(on a square source)* | 173 s | ⚠ subject cropped, style barely applied |

Those are ComfyUI's own `Prompt executed in` figures from `comfyui_8188.log` — sampling plus
encode/decode, on a warm model. Add ~8 s of wall clock for queueing, and roughly a minute more
on the very first run after a ComfyUI start, which pays the 20 GB model load.

Cost tracks pixel count almost linearly.

### ⚠ Resolution must match the source video's aspect ratio

This is the one setting that quietly ruins a run. The resize nodes use `keep_proportion: crop`,
so a mismatched aspect crops both the control video **and** the stylized keyframe. That doesn't
just reframe the shot — it measurably **weakens the style transfer**: 1280×704 on a square
source came back nearly photo-real with the dancer's head cut off, while 960×960 — *the same
pixel count*, correct aspect — restyled perfectly.

| | fast | quality |
|---|---|---|
| square | 640×640 | 960×960 |
| landscape | 832×480 | 1280×704 |
| portrait | 480×832 | 704×1280 |

Set it once in the `width` / `height` primitives; every downstream node reads them. Multiples
of 16.

### Other knobs

- **Length** — 81 frames per clip is what the model was trained on. If you change it, change it
  on **both** `WanImageToVideo` and `WanVaceToVideo`.
- **Steps** — 4 steps / cfg 1 via the lightx2v distill LoRA. For more quality, bypass the LoRA
  (Ctrl+B), raise `BasicScheduler` steps to ~20 and `SamplerCustom` cfg to ~5.
- **Longer than 81 frames** — the paper generates clip-by-clip with overlap. Not implemented
  here; restyle a clip at a time.

---

## Known differences from the paper

1. **No segmentation on the control signal.** The reference implementation masks the source to
   *foreground-on-gray* with SAM3 before feeding VACE; these workflows feed the raw source
   video, which is what Kijai's reference workflow does. Simpler, and it keeps background
   motion. If identity drifts or the background fights the style, adding that masking step is
   the first thing to try — the rig already has SAM3.
2. **The normals+depth variant is not installed.**
   `wan_2.1_idv2v_with_normal_depth_int8_convrot.safetensors` is another 20.2 GB in the same HF
   repo and needs DAViD (normals) + DepthAnything-V2 preprocessing. Given the drive is at
   ~34 GB free, that is a deliberate no.
3. **Single-clip only** — no overlap-based long-video continuation.

---

## If it ever becomes a ComfyQ bundle

- The graph exports cleanly to API format — the width/height sources were deliberately built as
  real `PrimitiveInt` nodes rather than the frontend-only `PrimitiveNode`.
- Category would be **`video-edit`**; two media inputs (video + image) plus a prompt, mirroring
  `video_bernini_r_video_editing_with_reference`. `minVRAM` 24.
- Calibration is cache-immune (`SamplerCustom` carries a literal `noise_seed`).
- **Blocker:** a ComfyQ bundle assumes a stock ComfyUI. Shipping this means every rig needs the
  core patch — so it should wait for PR #15139 to merge upstream.

Fuller ComfyQ-side notes: `J:\ComfyQ\docs\comfyui-idv2v.md`.
