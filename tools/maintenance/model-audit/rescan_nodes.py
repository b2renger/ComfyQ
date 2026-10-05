r"""Which custom-node packs do our workflows actually need?

Attribution method: REVERSE LOOKUP. For every node type a workflow uses, search
every pack's source for that literal node name.

Why not /object_info's `python_module`: `comfyui-workflow-encrypt` re-registers
the node table, so ComfyUI attributes 1010 nodes to it -- kjnodes, VHS, Trellis2
and friends all show up as belonging to that pack. Core attribution IS still
trustworthy there (core nodes report `nodes` / `comfy_extras.*`), so that half is
taken from the live server and only the custom half is resolved by grep.
"""
import json, io, os, re
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
OI_PATH = os.path.join(HERE, "object_info.json")
import sys as _sys, os as _os
_sys.path.insert(0, _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
from comfyq_paths import comfy_root, labelled_workflow_dirs, repo_root
# From ComfyQ's config rather than this file's position. See comfyq_paths.py.
CUSTOM = os.path.join(comfy_root(), "custom_nodes")
OUT = os.path.join(HERE, "nodes.json")
COMFY = os.path.normpath(os.path.join(CUSTOM, ".."))
# The same collections as rescan.py, from the one shared list. The old
# Downloads\workflows_a_tester staging folder was retired 2026-09-11; its
# workflows now live in ComfyQ\workflows\_candidate_workflows and are
# labelled "candidate" (see CANDIDATE_DIR below).
WF = {d: label for d, label in labelled_workflow_dirs()}
CANDIDATE_DIR = "_candidate_workflows"
VIRTUAL = {"Note", "MarkdownNote", "Reroute", "PrimitiveNode", "Anything Everywhere"}
UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")


def collect_types(doc):
    """Every node class a workflow uses, at any nesting depth.

    Walking only doc["nodes"] is not enough: a SUBGRAPH workflow keeps its real
    nodes under definitions.subgraphs[].nodes[], and most ComfyQ templates are
    subgraph workflows. Missing that made whole packs look unused -- e.g.
    ComfyUI-LTXVideo, whose LTXVGemmaCLIPModelLoader appears only inside
    subgraph definitions, in 7 workflows.

    Only arrays literally named "nodes" are read. A slot object also carries a
    "type", so a looser walk harvests IMAGE / BOOLEAN / CLIP as if they were
    node classes.
    """
    out = set()

    def walk(o):
        if isinstance(o, dict):
            ct = o.get("class_type")          # API format, at any depth
            if isinstance(ct, str):
                out.add(ct)
            for k, v in o.items():
                if k == "nodes" and isinstance(v, list):
                    for n in v:
                        if isinstance(n, dict) and isinstance(n.get("type"), str):
                            out.add(n["type"])
                walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)

    walk(doc)
    return out


OI = json.load(io.open(OI_PATH, encoding="utf-8"))
core = {n for n, s in OI.items() if not s.get("python_module", "").startswith("custom_nodes.")}
registered = set(OI)

# ---- 1. what the workflows use -------------------------------------------
used_types = defaultdict(set)
nwf = 0
for base, origin in WF.items():
    if not os.path.isdir(base):
        continue
    for root, _d, files in os.walk(base):
        for f in files:
            if not f.lower().endswith(".json"):
                continue
            p = os.path.join(root, f)
            try:
                doc = json.load(io.open(p, encoding="utf-8"))
            except Exception:
                continue
            nwf += 1
            rel = os.path.relpath(p, base).replace(os.sep, "/")
            # candidates sit inside the ComfyQ tree but are a separate claim
            tag = "candidate" if CANDIDATE_DIR in rel else origin
            label = tag + ":" + rel
            types = collect_types(doc)
            for t in types:
                used_types[t].add(label)

# ---- 2. index every pack's source text ------------------------------------
packs = {}
text_of = {}
for e in sorted(os.listdir(CUSTOM)):
    p = os.path.join(CUSTOM, e)
    if not os.path.isdir(p) or e in ("__pycache__", ".disabled"):
        continue
    tot, blob = 0, []
    for r, dirs, fs in os.walk(p):
        dirs[:] = [d for d in dirs if d not in ("__pycache__", ".git", "node_modules")]
        for f in fs:
            fp = os.path.join(r, f)
            try:
                tot += os.path.getsize(fp)
            except OSError:
                pass
            if os.path.splitext(f)[1].lower() in (".py", ".js", ".json"):
                try:
                    if os.path.getsize(fp) < 4_000_000:
                        blob.append(io.open(fp, encoding="utf-8", errors="ignore").read())
                except OSError:
                    pass
    # .git counted separately so "reclaimable" is honest
    git = 0
    gp = os.path.join(p, ".git")
    if os.path.isdir(gp):
        for r, _d, fs in os.walk(gp):
            for f in fs:
                try:
                    git += os.path.getsize(os.path.join(r, f))
                except OSError:
                    pass
    packs[e] = {"bytes": tot, "git_bytes": git, "used_by": set(), "provides": set()}
    text_of[e] = "\n".join(blob)

# ---- 3. reverse lookup ----------------------------------------------------
HIJACKER = "comfyui-workflow-encrypt"   # re-registers the table, see docstring

unresolved, ambiguous = defaultdict(set), {}
for t, wfs in used_types.items():
    if t in core or t in VIRTUAL or UUID.match(t):
        continue
    # Signal 1: the live server's attribution, trusted unless it is the hijacker.
    mod = OI.get(t, {}).get("python_module", "")
    owners = []
    if mod.startswith("custom_nodes."):
        pack = mod.split(".")[1]
        if pack != HIJACKER and pack in packs:
            owners = [pack]
    # Signal 2: grep the pack sources. Needed for everything the hijacker stole,
    # and it is the only signal for a pack that failed to load.
    if not owners:
        owners = [e for e, blob in text_of.items()
                  if ('"%s"' % t) in blob or ("'%s'" % t) in blob]
    if not owners:
        unresolved[t] = sorted(wfs)
        continue
    if len(owners) > 1:
        # prefer a pack that declares it in a mappings/registration context
        strong = [e for e in owners
                  if re.search(r"(NODE_CLASS_MAPPINGS|node_id\s*=|register)\D{0,80}" + re.escape(t), text_of[e])
                  or re.search(re.escape(t) + r"['\"]\s*:", text_of[e])]
        if len(strong) == 1:
            owners = strong
        else:
            ambiguous[t] = owners
            owners = strong or owners
    for e in owners:
        packs[e]["used_by"] |= wfs
        packs[e]["provides"].add(t)

for e, v in packs.items():
    v["used_by"] = sorted(v["used_by"])
    v["provides"] = sorted(v["provides"])
    v["used"] = bool(v["used_by"])
    v["origins"] = sorted({w.split(":")[0] for w in v["used_by"]})

io.open(OUT, "w", encoding="utf-8").write(json.dumps(
    {"packs": packs, "unresolved": {k: v for k, v in unresolved.items()},
     "ambiguous": ambiguous, "workflows": nwf}, indent=1))

print(f"workflows {nwf} | node types {len(used_types)} | packs {len(packs)}")
print(f"unresolved {len(unresolved)} | ambiguous {len(ambiguous)}\n")
print(f"{'pack':<40}{'MB':>8}{'gitMB':>7}  provides  used by")
for k, v in sorted(packs.items(), key=lambda kv: (kv[1]["used"], -kv[1]["bytes"])):
    tag = ",".join(v["origins"]) if v["origins"] else "-- NOT USED --"
    print(f"{k:<40}{v['bytes']/2**20:>8.1f}{v['git_bytes']/2**20:>7.1f}{len(v['provides']):>10}  {tag}")
nu = [v for v in packs.values() if not v["used"]]
print(f"\nnot used by any workflow: {len(nu)} packs, {sum(v['bytes'] for v in nu)/2**20:.0f} MB")
if unresolved:
    print("\nMISSING DEPENDENCY (workflow uses a node nothing installed provides):")
    for k, v in sorted(unresolved.items()):
        print(f"   {k:<44}{v[0]}")
if ambiguous:
    print("\nambiguous attribution (name appears in >1 pack):")
    for k, v in sorted(ambiguous.items())[:15]:
        print(f"   {k:<44}{','.join(v)}")
