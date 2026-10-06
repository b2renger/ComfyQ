r"""Restore the TRELLIS2 numeric-COMBO fixes in ComfyUI-Trellis2/nodes.py.

WHY: ComfyUI's frontend submits a numeric COMBO widget value as a STRING, but the
pack declares `resolution` / `to_resolution` dropdowns with INTEGER options, so every
run fails prompt-validation with e.g. "Value not in list: '1024' not in [512, 1024]".

FIX (what this script (re)applies, idempotently):
  * declare those dropdown options as STRINGS, and
  * cast the value back with int(...) inside the node, so downstream `== 512`
    comparisons and INT outputs keep working.

Covers ALL such combos:
  * `resolution`     -> 11 nodes (Shape / ReconstructMeshWithQuad / MeshTexturing +
                       the MultiView / TexSlat / Remesh / MeshRefiner / export siblings)
  * `to_resolution`  -> 2 nodes (ShapeCascadeGenerator, ShapeCascadeMultiViewGenerator)

WHEN TO RUN: after updating the ComfyUI-Trellis2 pack (an update overwrites nodes.py
and reverts these edits). It is idempotent, so re-running when nothing is broken is a
no-op. It does NOT touch the example-workflow .json files (see portablize_paths.py for
those) and it does NOT touch any model.

Then RESTART ComfyUI and hard-refresh the browser (INPUT_TYPES is read at startup and
the browser caches /object_info).

PORTABLE: the install is read from ComfyQ's own config (comfyq_paths.py), not from
this file's position on the disk, so it works under any drive letter and from
anywhere in the repo. It lives in ComfyQ\tools\maintenance\.
"""
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from comfyq_paths import comfy_root

NODES = os.path.join(comfy_root(), "custom_nodes", "ComfyUI-Trellis2", "nodes.py")

if not os.path.isfile(NODES):
    sys.exit(f"ERROR: nodes.py not found at:\n  {NODES}\n"
             f"Check the ComfyUI path under Manage ComfyUI, or set COMFY_ROOT.")

data = open(NODES, "rb").read()
had_crlf = b"\r\n" in data
text = data.decode("utf-8").replace("\r\n", "\n")
orig = text

# ---- 1) declarations: integer-list combos -> string-list --------------------
DECL_SUBS = [
    (r'\(\[512,\s*1024\],\s*\{"default":\s*1024\}\)',
     '(["512","1024"],{"default":"1024"})'),
    (r'\(\[128,\s*256,\s*512,\s*1024,\s*2048\],\s*\{"default":\s*512\}\)',
     '(["128","256","512","1024","2048"],{"default":"512"})'),
    (r'\(\[512,\s*1024,\s*1536\],\s*\{"default":\s*1024\}\)',
     '(["512","1024","1536"],{"default":"1024"})'),
    (r'\(\[1024,\s*1536\],\s*\{"default":\s*1024\}\)',            # to_resolution
     '(["1024","1536"],{"default":"1024"})'),
]
decl_total = 0
for pat, rep in DECL_SUBS:
    text, n = re.subn(pat, rep, text)
    decl_total += n

# ---- 2) cast each param to int at the top of every process() that takes it --
#         (standalone word only: skips *_resolution like sparse_structure_/from_)
CAST_PARAMS = ["resolution", "to_resolution"]
WORDRE = {p: re.compile(r'(?<![\w])' + re.escape(p) + r'(?![\w])') for p in CAST_PARAMS}
DEFRE = re.compile(r'^(\s*)def process\(self,')
SIGEND = re.compile(r'\):\s*(#.*)?$')

lines = text.split("\n")
out = []
i = 0
casts = 0
while i < len(lines):
    line = lines[i]
    m = DEFRE.match(line)
    if not m:
        out.append(line)
        i += 1
        continue
    sig = [line]
    j = i
    while not SIGEND.search(sig[-1]):
        j += 1
        if j >= len(lines):
            break
        sig.append(lines[j])
    out.extend(sig)
    sig_text = "\n".join(sig)
    body_indent = m.group(1) + "    "
    # look at the lines already following the signature for idempotency
    following = set(l.strip() for l in lines[j + 1:j + 1 + len(CAST_PARAMS)])
    for p in CAST_PARAMS:
        stmt = f"{p} = int({p})"
        if WORDRE[p].search(sig_text) and stmt not in following:
            out.append(body_indent + stmt)
            casts += 1
    i = j + 1
text = "\n".join(out)

print(f"declarations converted: {decl_total}")
print(f"int() casts inserted:   {casts}")
if text != orig:
    payload = text.replace("\n", "\r\n") if had_crlf else text
    open(NODES, "wb").write(payload.encode("utf-8"))
    print(f"written: {NODES}")
else:
    print("no change (already patched).")
