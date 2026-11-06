r"""Portablize the absolute mesh paths baked into TRELLIS2 example workflows.

WHY: the pack author saved the example workflows with their own machine's absolute
paths, e.g.  "C:/Git/ComfyUI/output/Pistol_00101_.glb". On any other machine (and on
this portable NVMe, which mounts under a different drive letter per machine) those
crash: `Trellis2LoadMesh` -> "string is not a file", and ComfyUI's /view route ->
"Paths don't have the same drive" (unguarded os.path.commonpath across drives).

FIX: rewrite every such value to the ComfyUI-relative tail (strip everything up to and
including `output/` or `output\`, normalise `\`->`/`). ComfyUI's folder_paths then
resolves it against the install on whatever drive letter it's mounted as. So
    C:/Git/ComfyUI/output/Pistol_00101_.glb          -> Pistol_00101_.glb
    C:\Git\ComfyUI\output\3D\Tower\Tower_..._.glb     -> 3D/Tower/Tower_..._.glb

Only strings that contain an `/output/` (or `\output\`) segment AND end in a 3D-mesh
extension are touched, so URLs, the Blender-exe path, and already-relative values are
left alone. Idempotent. Preserves file formatting (edits only the path substrings).

The Blender-projection workflow's "C:\Program Files\...\blender.exe" is intentionally
NOT rewritten -- it's a real machine-specific install path that can't be portablized.

WHEN TO RUN: after updating the ComfyUI-Trellis2 pack (an update restores the author's
absolute paths in example_workflows/). Idempotent -> safe to re-run any time.

PORTABLE: the install is read from ComfyQ's own config (comfyq_paths.py: COMFY_ROOT,
then comfy_ui.root_path in config.json), not from this file's position on the disk, so
it works under any drive letter and from anywhere in the repo. It lives in
ComfyQ\tools\maintenance\.
"""
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from comfyq_paths import comfy_root  # noqa: E402

EW = os.path.join(comfy_root(), "custom_nodes", "ComfyUI-Trellis2", "example_workflows")

if not os.path.isdir(EW):
    sys.exit(f"ERROR: example_workflows not found at:\n  {EW}\n"
             f"Check the ComfyUI path under Manage ComfyUI, or set COMFY_ROOT.")

# a JSON string value that has an /output/ (or \output\) segment and ends in a mesh ext.
# separators inside a JSON string are either '/' or an escaped backslash '\\' (two chars).
MESH_EXT = r'(?:glb|gltf|obj|ply|stl|fbx)'
PAT = re.compile(
    r'"([^"\n]*(?:/|\\\\)output(?:/|\\\\)[^"\n]*\.' + MESH_EXT + r')"')


def repl(m):
    real = m.group(1).replace('\\\\', '\\')          # JSON \\  -> real backslash
    tail = re.sub(r'^.*[/\\]output[/\\]', '', real)   # strip up to & incl. output/
    return '"' + tail.replace('\\', '/') + '"'        # forward slashes; no re-escaping


changed = 0
for name in sorted(os.listdir(EW)):
    if not name.endswith(".json"):
        continue
    p = os.path.join(EW, name)
    raw = open(p, "rb").read()
    had_crlf = b"\r\n" in raw
    text = raw.decode("utf-8").replace("\r\n", "\n")
    new = PAT.sub(repl, text)
    if new != text:
        payload = new.replace("\n", "\r\n") if had_crlf else new
        open(p, "wb").write(payload.encode("utf-8"))
        changed += 1
        print(f"  rewrote paths in {name}")

print(f"\nfiles changed: {changed}")
if changed == 0:
    print("no change (already portable).")
