# Showcase research — what each workflow is good at, and why its example looks the way it does

Written 2026-11-04 for the rework of [`tools/test-suite/library.suite.json`](../../tools/test-suite/library.suite.json):
one report per model family, each produced from the models' own sources — model cards, papers, official
prompting guides, release posts, and the notes inside each bundle's ComfyUI template — plus this rig's
earlier results ([`docs/workflow-assessment.md`](../workflow-assessment.md)).

For every workflow a report gives: **what the model is good at** (with sources), **the showcase idea** and
which known failure it avoids, **the inputs** it needs and where they come from, **how to judge the result**,
the risks, the links that needed fixing, and a JSON block the suite was built from (prompt, settings,
student caption, plain title and summary).

| report | workflows |
|---|---|
| [1 — Qwen, Ideogram, MOSS, Bernini (pictures)](1-qwen-ideogram-moss-bernini-images.md) | Qwen 2.1 t2i / fix / canny / depth / edit / relight, Qwen 2512 panorama, Qwen 2511 angles, Ideogram 4, MOSS ×3, Bernini image ×2 |
| [2 — FLUX, Krea, MiniMax (pictures)](2-flux-krea-minimax-images.md) | FLUX.2 Klein ×6, FLUX.3 Klein ×4, Krea 2 ×4, MiniMax H3 t2i |
| [3 — MiniMax H3, FastH3, Pika (video)](3-minimax-h3-fasth3-pika-video.md) | H3 turbo / i2v / loops / ControlNets / v2v, FastH3 ×3, Pika H3 Flex ×3 |
| [4 — LTX (video)](4-ltx-video.md) | LTX 2.5 t2v / i2v / FLF / IC-LoRA ×3 / upscaler, LTX 2.3 3DReal / ia2v / ingredients |
| [5 — Wan, Bernini, LivePortrait (video)](5-wan-bernini-liveportrait-video.md) | Wan 2.2 key frames, Bernini video ×3, SCAIL-2, Wan Animate 2, ID-V2V ×2, LivePortrait |
| [6 — utilities, 3D, sound, captions](6-utilities-3d-sound-captions.md) | SeedVR2 ×4, PiD, Qwen unblur, FILM, SAM3, 3D ×5, Stable Audio, YuE2, Gemma ×2 |

The integrated suite departs from a report where wiring needed it (an input moved to another card's
output, one card's run repurposed — the MOSS base card draws the reference sheet the ingredients card
uses); those choices are in `tools/test-suite/library.suite.json` itself, each run's `note`.
The reports are the reasoning, kept as written; they were not re-edited after the run.
