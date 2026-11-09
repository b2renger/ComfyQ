# Roadmap

What is planned next. The owner decides the order. Written 2026-11-06, after the
project review. The history up to July is in
[implementation_plan.md](../implementation_plan.md), which is frozen.

## Next

**Batch feature (Phase G).** The storyboard planner is experimental and gets
reworked into a batch feature with job dependencies. Plan:
[batch-feature-plan.md](batch-feature-plan.md). Stages 1, 2 and a first table editor
are in (2026-11-09), and the test suite is a batch table.

**RelayVSR card (waiting for ComfyUI, since 2026-11-09).** ComfyUI added RelayVSR to
its built-in nodes on 2026-11-05 (commit `2f8943324`), after its last stable
release; the install runs 0.44.2, which does not have it. The owner chose to wait
for the next stable rather than run the community pack `filliptm/ComfyUI-FL-RelayVSR`
(×4 only, its own 10 GB weights). **What says when:** Maintenance → Install updates →
Check. It fetches ComfyUI's releases and, for every entry of
[tools/maintenance/comfyui-waiting.json](../tools/maintenance/comfyui-waiting.json),
names the first release that holds it. By hand:
`git -C <ComfyUI> fetch --tags origin` then
`git -C <ComfyUI> tag --contains 2f8943324e1eae89a5ee6c7db93602299246b5f1`. Then:
update ComfyUI (the owner's rule: always to the newest stable), build the card from
`Comfy-Org/RelayVSR` (×2 and ×4, int8, 5.2 GB each), remove the entry.

**Test on an RTX 3090.** The README says tested on 4090 and 5090. Run one full
sweep on a 3090 before promising more. The 3D packs need a newer card, and they
hold the torch pin, so they stay installed.

**Node 26.** Most lab machines will move to the new LTS for other reasons. See
[the Node note in CLAUDE.md](../CLAUDE.md).

**Discovery release.** After the review and the tests of the current changes. It
carries the scan order, the rename message and the Mac update link.

## Later

**Phase H: parallel workflows on one GPU.** This is what lanes already do: several
workflows, each on its own ComfyUI, on one card. The idea of several ComfyQ
instances on one machine is retired. What is left is narrower, such as pinning a
lane to a GPU on a machine that has two.

**One of Qwen plain and Qwen fix goes.** The owner finds the fix has no real value
and prefers the originals. The comparison stage of the test suite shows the two
side by side first.

**Federation, F3 to F6.** Deferred. Cluster secret, cross-instance admin actions, a
panel in the admin page, a station picker for students. The design decisions are in
the Phase F section of implementation_plan.md. The original plan file is gone.

## Open questions

Question 38 of [the review](review-2026-11-05.md) waits for the batch rework: what
"Retry failed" should do about cancelled shots.
