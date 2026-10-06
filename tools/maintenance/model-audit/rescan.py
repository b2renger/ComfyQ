r"""Inventory every model on the drive and cross-reference it against every
workflow we have, plus the custom-node source (which is how auto-downloaded
models get referenced without ever appearing in a workflow).

Writes a machine-readable inventory.json that later passes can re-use.
Reads nothing destructively; deletes nothing.
"""
import json, os, re, sys, io
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
import sys as _sys, os as _os
_sys.path.insert(0, _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
from comfyq_paths import comfy_root, labelled_workflow_dirs, repo_root
# Where ComfyUI is comes from ComfyQ's config (Manage ComfyUI -> ComfyUI
# Settings), not from this file's position on the disk. See comfyq_paths.py.
COMFY = comfy_root()
MODELS = os.path.join(COMFY, "models")
CUSTOM = os.path.join(COMFY, "custom_nodes")
OUT = os.path.join(HERE, "inventory.json")

# Workflow collections, all derived so the drive can mount under any letter.
#   DRIVE       the letter this drive is currently mounted as
#   ComfyUI's own user workflows are included on purpose: workflows staged into
#   the Workflows sidebar are real usage, and leaving them out scored three
#   models as unused that a staged workflow actually loads.
#   Everything scanned now lives ON THIS DRIVE -- the old
#   %USERPROFILE%\Downloads\workflows_a_tester staging folder was retired
#   2026-09-11 and its workflows moved into ComfyQ\workflows\_candidate_workflows.
# One list, shared with server/workflows/modelUsage.js through config.json:
# ComfyQ's own workflows, anything in maintenance.workflowScanDirs, and
# ComfyUI's own user workflows. A folder in one tool and not the other
# means they disagree about whether a model is in use.
WORKFLOW_DIRS = [d for d, _label in labelled_workflow_dirs()]

# Workflows the owner has staged for future testing + possible promotion into
# ComfyQ. They are NOT production, but their models must never be pruned --
# they are the reason the model is on the drive at all.
CANDIDATE_DIR = "_candidate_workflows"

# Model dirs where a single FILE is the unit you'd delete.
FLAT_DIRS = {
    "checkpoints", "loras", "vae", "unet", "diffusion_models", "text_encoders",
    "clip_vision", "clip", "controlnet", "upscale_models", "embeddings",
    "style_models", "gligen", "hypernetworks", "photomaker", "audio_encoders",
    "model_patches", "latent_upscale_models", "vae_approx", "configs",
    "frame_interpolation", "face_detection", "detection", "rembg",
    "background_removal", "optical_flow", "ultralytics", "yolo", "LLM",
    "diffusers", "llama_cpp",
}
WEIGHT_EXT = {".safetensors", ".ckpt", ".pt", ".pth", ".bin", ".gguf", ".onnx",
              ".sft", ".npz", ".msgpack", ".engine", ".trt", ".h5", ".pkl"}


def walk_size(path):
    total, n = 0, 0
    for root, _dirs, files in os.walk(path):
        for f in files:
            try:
                total += os.path.getsize(os.path.join(root, f))
                n += 1
            except OSError:
                pass
    return total, n


def build_units():
    """A 'unit' is the thing you would actually delete: one weight file in a flat
    model dir, or one repo-style folder (diffusers layout, many files)."""
    units = []
    for entry in sorted(os.listdir(MODELS)):
        top = os.path.join(MODELS, entry)
        if os.path.isfile(top):
            continue
        if entry in FLAT_DIRS:
            # every file (recursively -- some dirs have subfolders like loras\Flux)
            for root, _dirs, files in os.walk(top):
                for f in files:
                    p = os.path.join(root, f)
                    ext = os.path.splitext(f)[1].lower()
                    if ext not in WEIGHT_EXT and not f.endswith(".safetensors"):
                        continue
                    try:
                        sz = os.path.getsize(p)
                    except OSError:
                        continue
                    units.append({
                        "kind": "file",
                        "category": entry,
                        "name": f,
                        "relpath": os.path.relpath(p, MODELS).replace("\\", "/"),
                        "bytes": sz,
                    })
        else:
            # repo-style: each immediate subdir is a unit; loose files are units too
            children = sorted(os.listdir(top))
            subdirs = [c for c in children if os.path.isdir(os.path.join(top, c))]
            if subdirs:
                for c in subdirs:
                    p = os.path.join(top, c)
                    sz, n = walk_size(p)
                    units.append({
                        "kind": "folder", "category": entry, "name": c,
                        "relpath": os.path.relpath(p, MODELS).replace("\\", "/"),
                        "bytes": sz, "files": n,
                    })
            loose = [c for c in children if os.path.isfile(os.path.join(top, c))]
            for c in loose:
                p = os.path.join(top, c)
                try:
                    sz = os.path.getsize(p)
                except OSError:
                    continue
                if sz < 1024 * 1024:      # ignore tiny config/readme leftovers
                    continue
                units.append({
                    "kind": "file", "category": entry, "name": c,
                    "relpath": os.path.relpath(p, MODELS).replace("\\", "/"),
                    "bytes": sz,
                })
    return units



def ORIGIN_OF(base, relpath=""):
    """Short label for a workflow collection, used in the reference lists.

    `relpath` matters: the candidate workflows live *inside* the ComfyQ
    collection but are a different kind of claim on a model (not yet in
    production, but staged deliberately), so they get their own origin.
    """
    b = base.lower()
    if CANDIDATE_DIR.lower() in relpath.lower().replace("\\", "/"):
        return "candidate"
    if "comfyq" in b:
        return "comfyq"
    if "_demo_workflows" in b:
        return "demo"
    if "user" in b and "workflows" in b:
        return "comfyui_staged"
    return os.path.basename(base) or "other"


def iter_workflow_files():
    for d in WORKFLOW_DIRS:
        if not os.path.isdir(d):
            continue
        for root, _dirs, files in os.walk(d):
            for f in files:
                if f.lower().endswith(".json"):
                    yield d, os.path.join(root, f)


def strings_in(obj, out):
    """Every string anywhere in a JSON document (widgets_values, inputs, …)."""
    if isinstance(obj, str):
        out.append(obj)
    elif isinstance(obj, dict):
        for v in obj.values():
            strings_in(v, out)
    elif isinstance(obj, list):
        for v in obj:
            strings_in(v, out)


# Node classes that are pure documentation. A model named in one of these is
# being *talked about*, not loaded.
NOTE_TYPES = {"Note", "MarkdownNote", "Note Plus (mtb)"}

# Where inside a node a value has to sit to actually reach a loader.
#   widgets_values        litegraph UI export (positional)
#   widgets_values_named  newer UI export (by widget name)
#   inputs                API-format export
LOADER_KEYS = ("widgets_values", "widgets_values_named", "inputs")


def _tokens_from(text, sink, label):
    """Record every model-ish token in one string into `sink`."""
    if not isinstance(text, str) or not text or len(text) > 400:
        return
    for token in re.split(r"[\r\n,;\"']+", text):
        token = token.strip()
        if not token:
            continue
        if os.path.splitext(token)[1].lower() in WEIGHT_EXT:
            sink[os.path.basename(token.replace("\\", "/")).lower()].add(label)
    t = text.strip().replace("\\", "/")
    if t and "/" not in t and 2 < len(t) < 120 and not os.path.splitext(t)[1]:
        sink["@" + t.lower()].add(label)


def _scan_loader_node(node, sink, label):
    """Only the widget/input values of a non-Note node count as a real load."""
    if not isinstance(node, dict):
        return
    if (node.get("type") or node.get("class_type")) in NOTE_TYPES:
        return
    for key in LOADER_KEYS:
        val = node.get(key)
        if val is None:
            continue
        buf = []
        strings_in(val, buf)
        for text in buf:
            _tokens_from(text, sink, label)


def _walk_for_loaders(obj, sink, label):
    """Find every node at any depth -- including inside subgraph definitions,
    where most ComfyQ templates keep their real nodes."""
    if isinstance(obj, dict):
        if "widgets_values" in obj or ("class_type" in obj and "inputs" in obj):
            _scan_loader_node(obj, sink, label)
        for k, v in obj.items():
            if k == "nodes" and isinstance(v, list):
                for n in v:
                    _scan_loader_node(n, sink, label)
                    _walk_for_loaders(n, sink, label)
            else:
                _walk_for_loaders(v, sink, label)
    elif isinstance(obj, list):
        for v in obj:
            _walk_for_loaders(v, sink, label)


def collect_workflow_refs():
    """Two indexes, basename(lower) -> set of workflow labels.

    loads    the name sits in a loader widget/input -> the workflow runs it
    anywhere the name appears somewhere in the document at all

    The gap between them is real and was silently inflating usage: ComfyUI's
    own templates carry a MarkdownNote listing every model of the family plus a
    `properties.models` download hint, so a workflow "references" models it
    never loads. One MiniMax template loads the Singularity fine-tune while its
    note text names the stock convrot build -- counting that as usage would
    protect 19.5 GB nothing runs.
    """
    loads = defaultdict(set)
    anywhere = defaultdict(set)
    counted = 0
    bad = []
    for base, path in iter_workflow_files():
        try:
            doc = json.load(io.open(path, encoding="utf-8"))
        except Exception as exc:
            bad.append((path, str(exc)[:80]))
            continue
        counted += 1
        label = os.path.relpath(path, base).replace("\\", "/")
        full = f"{ORIGIN_OF(base, label)}:{label}"

        # API-format export: a flat {id: {class_type, inputs}} map, no "nodes".
        if isinstance(doc, dict) and not doc.get("nodes"):
            for v in doc.values():
                if isinstance(v, dict) and "class_type" in v:
                    _scan_loader_node(v, loads, full)
        _walk_for_loaders(doc, loads, full)

        buf = []
        strings_in(doc, buf)
        for text in buf:
            _tokens_from(text, anywhere, full)
    return loads, anywhere, counted, bad


def custom_node_weights():
    """Weight basenames that live INSIDE custom_nodes.

    Not inventory units -- a pack owns these and the sheet should not offer
    them for pruning -- but they are present, which is all the missing-
    dependency check needs to know.
    """
    names = set()
    exts = {'.safetensors','.ckpt','.pt','.pth','.bin','.gguf','.onnx','.sft'}
    for root, dirs, files in os.walk(CUSTOM):
        dirs[:] = [d for d in dirs if d not in ("__pycache__", ".git", "node_modules")]
        for f in files:
            if os.path.splitext(f)[1].lower() in exts:
                names.add(f.lower())
    return names


def collect_code_refs():
    """Model names hardcoded in custom-node source = auto-downloaded at runtime.
    These never appear in a workflow but are absolutely in use."""
    refs = defaultdict(set)
    exts = {".py", ".json", ".yaml", ".yml", ".toml", ".txt", ".md", ".js"}
    for root, dirs, files in os.walk(CUSTOM):
        dirs[:] = [d for d in dirs if d not in ("__pycache__", ".git", "node_modules")]
        for f in files:
            if os.path.splitext(f)[1].lower() not in exts:
                continue
            p = os.path.join(root, f)
            try:
                if os.path.getsize(p) > 3_000_000:
                    continue
                text = io.open(p, encoding="utf-8", errors="ignore").read()
            except OSError:
                continue
            pack = os.path.relpath(p, CUSTOM).split(os.sep)[0]
            for m in re.finditer(r"[\w./\\-]+\.(?:safetensors|ckpt|pt|pth|bin|gguf|onnx|sft)\b", text):
                bn = os.path.basename(m.group(0).replace("\\", "/")).lower()
                refs[bn].add(pack)
            for m in re.finditer(r"['\"]([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)['\"]", text):
                repo = m.group(1)
                if "/" in repo and not repo.endswith((".py", ".js", ".json")):
                    refs["@" + repo.split("/")[-1].lower()].add(pack)
    return refs


def main():
    print("scanning models ...", flush=True)
    units = build_units()
    print(f"  {len(units)} model units, {sum(u['bytes'] for u in units)/2**30:.1f} GB")

    print("scanning workflows ...", flush=True)
    wloads, wany, nwf, bad = collect_workflow_refs()
    print(f"  {nwf} workflows parsed, {len(bad)} unreadable, "
          f"{len(wloads)} loaded / {len(wany)} named")

    print("scanning custom-node source ...", flush=True)
    crefs = collect_code_refs()
    print(f"  {len(crefs)} distinct refs in code")

    for u in units:
        bn = u["name"].lower()
        key_folder = "@" + u["name"].lower()
        loaded = sorted(wloads.get(bn, set()) | wloads.get(key_folder, set()))
        named = sorted(wany.get(bn, set()) | wany.get(key_folder, set()))
        code = sorted(crefs.get(bn, set()) | crefs.get(key_folder, set()))
        if u["kind"] == "folder" and not loaded and not code:
            # a repo folder can also be referenced by one of its own files
            try:
                for root, _d, files in os.walk(os.path.join(MODELS, u["relpath"].replace("/", os.sep))):
                    for f in files:
                        k = f.lower()
                        if k in wloads:
                            loaded = sorted(wloads[k])
                        if k in wany:
                            named = sorted(set(named) | wany[k])
                        if k in crefs:
                            code = sorted(crefs[k])
                    if loaded or code:
                        break
            except OSError:
                pass
        u["wf_loads"] = loaded
        u["wf_mentions"] = sorted(set(named) - set(loaded))
        # kept for compatibility with anything reading the old field
        u["workflow_refs"] = sorted(set(named) | set(loaded))
        u["code_refs"] = code
        u["used"] = bool(loaded or code)
        u["mention_only"] = bool(not loaded and not code and u["wf_mentions"])

    # Names a workflow loads that match nothing on disk. Two causes, and the
    # sheet has to tell them apart: a genuinely absent dependency, or a file
    # that IS here under a different name (build_csv.py resolves those from
    # the safetensors metadata, which survives a rename).
    on_disk = {u["name"].lower() for u in units}
    # A weight under custom_nodes counts as on disk. Node packs download their
    # own detectors into their folder rather than into models/ -- controlnet_aux
    # puts yolox_l.torchscript.pt and dw-ll_ucoco_384_bs5.torchscript.pt in
    # ckpts/hr16/ -- and reading only models/ reported three files as absent
    # dependencies that have been sitting on this drive for weeks, which would
    # send someone re-downloading what they already have. ComfyQ's own index
    # (server/workflows/vramEstimate.js) was widened for the same reason; this
    # keeps the two scanners agreeing about what "present" means.
    on_disk |= custom_node_weights()
    missing = {}
    for name, wfs in wloads.items():
        if name.startswith("@") or name in on_disk:
            continue
        missing[name] = sorted(wfs)

    out = {
        "models_root": MODELS,
        "workflow_dirs": WORKFLOW_DIRS,
        "workflows_parsed": nwf,
        "workflows_unreadable": bad,
        "missing_refs": missing,
        "units": units,
    }
    io.open(OUT, "w", encoding="utf-8").write(json.dumps(out, indent=1))
    if missing:
        print()
        print(f"  {len(missing)} model name(s) loaded by a workflow are NOT on disk")
        for name in sorted(missing)[:12]:
            print(f"      {name}")

    used = [u for u in units if u["used"]]
    unused = [u for u in units if not u["used"]]
    print()
    print(f"  referenced : {len(used):>4} units  {sum(u['bytes'] for u in used)/2**30:>8.1f} GB")
    print(f"  unreferenced:{len(unused):>4} units  {sum(u['bytes'] for u in unused)/2**30:>8.1f} GB")
    print(f"\nwrote {OUT}")


main()
