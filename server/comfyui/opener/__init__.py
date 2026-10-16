# ComfyQ's ComfyUI-side extension.
#
# Two jobs, both bolted on from OUTSIDE — nothing in ComfyUI is patched. This
# folder is installed into <comfy_root>/custom_nodes, which is the supported
# extension point every other pack uses.
#
# 1. The opener (WEB_DIRECTORY / ./js). ComfyQ stages a workflow into
#    user/default/workflows and opens ComfyUI with `?comfyq_open=<name>`; the
#    bundled JS reads that param and loads the graph onto the canvas, so
#    "Open in ComfyUI" lands the admin directly on the editable graph.
#
# 2. ★ The model-access recorder. ComfyUI logs the CLASS it loads ("Requested to
#    load QwenImage21") but never the file, so there was no way to know which
#    weights a run actually opened — every answer about "is this model used" had
#    to be inferred from graphs and pack source, and each inference has been
#    wrong at least once. This records the truth: every model file ComfyUI
#    resolves or loads, appended to comfyq_model_access.jsonl at the ComfyUI
#    root, which ComfyQ reads back.
#
#    Two hooks, because one is not enough:
#      folder_paths.get_full_path(...)  the chokepoint every CORE loader uses to
#                                      turn a dropdown value into a path
#      comfy.utils.load_torch_file(...) catches a pack that builds its own path
#                                      and never asks folder_paths — which is
#                                      exactly what comfyui-liveportraitkj does
#
#    ⚠ Absence of a record is NOT proof a model is unused: it only covers runs
#    made since the hook was installed, and a pack could read a file by some
#    other route. It is corroboration, never a licence to delete.
#
# This file runs inside ComfyUI, so every line here is defensive: a failure in
# the recorder must never stop a student's job. Every hook is wrapped, always
# calls through, and swallows its own errors.
import json
import os
import sys
import threading
import time

WEB_DIRECTORY = "./js"
NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}

_LOG_NAME = "comfyq_model_access.jsonl"
_WEIGHT_EXT = (".safetensors", ".sft", ".ckpt", ".pt", ".pth", ".gguf", ".onnx", ".bin")

_lock = threading.Lock()
_seen = set()
_log_path = None
# ★ How many prompts are executing right now. A lookup only counts as a LOAD
# while a workflow runs: ComfyUI 0.40's asset scanner (app/assets/scanner.py)
# calls folder_paths.get_full_path for EVERY model file at startup, and recording
# those marked the whole disk as "observed loading" on each ComfyUI start — which
# protected every model from pruning. A process-wide counter rather than a
# thread-local, so a node that loads from a worker thread still counts.
_executing = 0


def _resolve_log_path():
    """<comfy_root>/comfyq_model_access.jsonl — i.e. dirname(models_dir).

    Derived from folder_paths.models_dir so it follows the install rather than
    this file's position; a lane's own user dir would give one log per lane,
    and one shared log is what ComfyQ wants to read.
    """
    try:
        import folder_paths
        return os.path.join(os.path.dirname(os.path.abspath(folder_paths.models_dir)), _LOG_NAME)
    except Exception:
        return None


def _from_asset_scanner():
    """True when this lookup comes from ComfyUI's asset scanner (app.assets).

    ★ The prompt counter alone is not enough: the scanner runs on its own thread
    and the counter is process-wide, so a scan that overlaps a prompt — any job
    booked within seconds of a ComfyUI starting, routine with parallel lanes —
    logged the whole disk as loads (218 models in one second on 2026-10-16).
    The call stack says who is asking, whatever the timing.
    """
    f = sys._getframe(2)
    while f is not None:
        name = f.f_globals.get("__name__", "") or ""
        if name == "app.assets" or name.startswith("app.assets."):
            return True
        f = f.f_back
    return False


def _record(path, how):
    """Append one access, once per path per process. Never raises."""
    try:
        if not path or _executing <= 0:
            return
        if _from_asset_scanner():
            return
        p = str(path)
        if not p.lower().endswith(_WEIGHT_EXT):
            return
        with _lock:
            if p in _seen:
                return
            _seen.add(p)
            target = _log_path
        if not target:
            return
        # `ctx` marks a record made inside a running prompt. Records without it
        # predate this rule and are judged by ComfyQ with that in mind.
        line = json.dumps({"at": int(time.time()), "path": p, "how": how, "ctx": "prompt"}, ensure_ascii=False)
        # Append-only: a torn write costs one line, and concurrent lanes
        # interleave whole lines rather than corrupting the file.
        with open(target, "a", encoding="utf-8") as fh:
            fh.write(line + "\n")
    except Exception:
        pass


def _executor_wrapper(orig, is_async):
    """Count a prompt as running for exactly as long as `orig` runs."""
    def enter():
        global _executing
        with _lock:
            _executing += 1

    def leave():
        global _executing
        with _lock:
            _executing -= 1

    if is_async:
        async def wrapper(self, *args, **kwargs):
            enter()
            try:
                return await orig(self, *args, **kwargs)
            finally:
                leave()
    else:
        def wrapper(self, *args, **kwargs):
            enter()
            try:
                return orig(self, *args, **kwargs)
            finally:
                leave()
    wrapper._comfyq_wrapped = True
    wrapper.__name__ = getattr(orig, "__name__", "execute")
    return wrapper


def _load_wrapper(orig):
    def wrapper(ckpt, *args, **kwargs):
        _record(ckpt, "load_torch_file")
        return orig(ckpt, *args, **kwargs)
    wrapper._comfyq_wrapped = True
    wrapper.__name__ = "load_torch_file"
    return wrapper


def _install_hooks():
    installed = []

    # 1. folder_paths.get_full_path — what every core loader calls.
    try:
        import folder_paths

        for name in ("get_full_path", "get_full_path_or_raise"):
            original = getattr(folder_paths, name, None)
            if original is None or getattr(original, "_comfyq_wrapped", False):
                continue

            def make(orig):
                def wrapper(*args, **kwargs):
                    out = orig(*args, **kwargs)
                    _record(out, "folder_paths")
                    return out
                wrapper._comfyq_wrapped = True
                wrapper.__name__ = getattr(orig, "__name__", "get_full_path")
                return wrapper

            setattr(folder_paths, name, make(original))
            installed.append("folder_paths." + name)
    except Exception:
        pass

    # 0. Know when a prompt is executing — the only time a lookup is a load.
    #    ★ The wrapper comes from a FACTORY, so it captures this function and no
    #    other. Written inline, it closed over a local named `original` that the
    #    load_torch_file hook below then rebound — Python binds closures late — so
    #    every prompt called load_torch_file(self, ...) and failed with a TypeError.
    try:
        import execution
        cls = getattr(execution, "PromptExecutor", None)
        target = "execute_async" if hasattr(cls, "execute_async") else "execute"
        orig_run = getattr(cls, target, None) if cls else None
        if orig_run is not None and not getattr(orig_run, "_comfyq_wrapped", False):
            setattr(cls, target, _executor_wrapper(orig_run, target == "execute_async"))
            installed.append("PromptExecutor." + target + " (records only while a prompt runs)")
    except Exception:
        pass

    # 2. comfy.utils.load_torch_file — catches a pack that builds its own path.
    try:
        import comfy.utils

        orig_load = getattr(comfy.utils, "load_torch_file", None)
        if orig_load is not None and not getattr(orig_load, "_comfyq_wrapped", False):
            comfy.utils.load_torch_file = _load_wrapper(orig_load)
            installed.append("comfy.utils.load_torch_file")
    except Exception:
        pass

    return installed


try:
    _log_path = _resolve_log_path()
    _hooks = _install_hooks()
    if _hooks and _log_path:
        print("[ComfyQ] model-access recorder on (%s) -> %s"
              % (", ".join(_hooks), os.path.basename(_log_path)))
except Exception:
    pass

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
