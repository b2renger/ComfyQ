r"""Re-apply every hand-fix this portable ComfyUI depends on, and health-check the
pinned stack.  Run it after ANY update (ComfyUI core, a custom-node pack, or
ComfyUI-Manager's "update all") -- double-click _maintenance\REPAIR.bat.

WHY THIS EXISTS
  This install carries a number of edits to files that belong to ComfyUI or to
  custom-node packs.  Every one of them is silently reverted when the thing it
  edits is updated:
    * ComfyUI's own updater calls git stash before it checks out the new
      version, so core patches vanish without a word.
    * A pack update (git pull / Manager) overwrites the pack's own files.
    * Re-downloading a model overwrites model-side fixes.
  Nothing warns you.  You find out when a workflow fails.  This script checks
  each fix, re-applies the ones that are missing, and tells you what it did.

DESIGN
  * Idempotent -- running it when everything is fine changes nothing.
  * Portable -- every path is derived from this file's location, so the drive
    can mount as J:, K:, whatever.  No drive letter anywhere.
  * No git required -- fixes are applied as targeted text edits, not patches,
    so they still work if the surrounding code moved.  A fix whose anchor has
    disappeared reports FAIL and changes nothing rather than corrupting a file.
  * Every edited .py is byte-compiled afterwards; a fix that would leave a
    syntax error is rolled back.

See notice.md for the full background on each item.
"""

import io
import os
import re
import sys
import py_compile
import subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
PORTABLE = os.path.normpath(os.path.join(HERE, "..", "ComfyUI_windows_portable"))
COMFY = os.path.join(PORTABLE, "ComfyUI")
NODES = os.path.join(COMFY, "custom_nodes")
MODELS = os.path.join(COMFY, "models")
PYEXE = os.path.join(PORTABLE, "python_embeded", "python.exe")

OK, FIXED, FAIL, WARN, SKIP = "OK", "FIXED", "FAIL", "WARN", "SKIP"


# --------------------------------------------------------------------------
# text helpers -- all of them preserve the file's original line endings
# --------------------------------------------------------------------------
def read(path):
    data = open(path, "rb").read()
    return data.decode("utf-8"), (b"\r\n" in data)


def write(path, text, crlf):
    payload = text.replace("\r\n", "\n")
    if crlf:
        payload = payload.replace("\n", "\r\n")
    open(path, "wb").write(payload.encode("utf-8"))


def norm(text):
    return text.replace("\r\n", "\n")


def compiles(path):
    try:
        py_compile.compile(path, doraise=True, quiet=2)
        return True
    except Exception:
        return False


class Edit:
    """A batch of text edits against one file, applied all-or-nothing.

    Every anchor must match EXACTLY ONCE (within `scope`, if given). That rule is
    the whole safety story: several of these anchors are lines that repeat across
    sibling node classes, and a blind "replace the first match" silently lands the
    edit in the wrong class the day upstream reorders them -- which reports as a
    successful repair while producing a subtly broken file. Ambiguity is therefore
    a hard failure: the script refuses rather than guessing.
    """

    def __init__(self, path):
        self.path = path
        self.text, self.crlf = read(path)
        self.text = norm(self.text)
        self.original = self.text

    def has(self, needle):
        return norm(needle) in self.text

    def _span(self, scope):
        """Character range of `class <scope>` up to the next top-level class."""
        if scope is None:
            return 0, len(self.text)
        m = re.search(r"^class " + re.escape(scope) + r"\b", self.text, re.M)
        if not m:
            raise LookupError(f"class {scope} not found in {os.path.basename(self.path)} "
                              f"-- upstream renamed or removed it")
        nxt = re.search(r"^class \w+", self.text[m.end():], re.M)
        return m.start(), (m.end() + nxt.start()) if nxt else len(self.text)

    def _locate(self, anchor, scope):
        anchor = norm(anchor)
        lo, hi = self._span(scope)
        region = self.text[lo:hi]
        n = region.count(anchor)
        where = os.path.basename(self.path) + (f" (class {scope})" if scope else "")
        if n == 0:
            raise LookupError(f"anchor not found in {where}:\n         {anchor.strip()[:90]}...")
        if n > 1:
            raise LookupError(f"anchor is ambiguous ({n} matches) in {where} -- refusing to guess:"
                              f"\n         {anchor.strip()[:90]}...")
        return lo + region.index(anchor), anchor

    def sub(self, old, new, scope=None):
        at, anchor = self._locate(old, scope)
        self.text = self.text[:at] + norm(new) + self.text[at + len(anchor):]

    def insert_after(self, anchor, block, scope=None):
        at, a = self._locate(anchor, scope)
        self.text = self.text[:at + len(a)] + norm(block) + self.text[at + len(a):]

    def insert_before(self, anchor, block, scope=None):
        at, a = self._locate(anchor, scope)
        self.text = self.text[:at] + norm(block) + self.text[at:]

    def commit(self):
        """Write, then byte-compile; restore the original if it broke."""
        if self.text == self.original:
            return True
        backup = self.original
        write(self.path, self.text, self.crlf)
        if self.path.endswith(".py") and not compiles(self.path):
            write(self.path, backup, self.crlf)
            raise RuntimeError(f"edit produced a syntax error in {self.path} -- rolled back")
        return True


# --------------------------------------------------------------------------
# the fixes
# --------------------------------------------------------------------------
class Fix:
    name = "unnamed"
    why = ""
    target = ""          # shown so you know what an update would revert

    def state(self):     # -> OK / FAIL(missing) ; raise for "not applicable"
        raise NotImplementedError

    def apply(self):
        raise NotImplementedError


# ---- 1. ID-V2V: VACE on a Wan 2.1 I2V base (ComfyUI core) -----------------
class IdV2V(Fix):
    name = "ID-V2V support (Wan 2.1 VACE+I2V)"
    why = ("ComfyUI's VACE path assumes a T2V base, so the ID-V2V model cannot load. "
           "Backport of open PR #15139.")
    target = "ComfyUI core -- reverted by update_comfyui*.bat (it git-stashes local edits)"

    def files(self):
        return {
            "model": os.path.join(COMFY, "comfy", "ldm", "wan", "model.py"),
            "detect": os.path.join(COMFY, "comfy", "model_detection.py"),
            "supported": os.path.join(COMFY, "comfy", "supported_models.py"),
            "nodes": os.path.join(COMFY, "comfy_extras", "nodes_wan.py"),
        }

    def state(self):
        f = self.files()
        for p in f.values():
            if not os.path.isfile(p):
                raise FileNotFoundError(p)
        d, _ = read(f["detect"])
        s, _ = read(f["supported"])
        m, _ = read(f["model"])
        # Check ref_pad_image landed inside WanImageToVideo specifically -- a
        # whole-file grep would also pass if the edit went into a sibling node.
        e = Edit(f["nodes"])
        lo, hi = e._span("WanImageToVideo")
        in_node = "ref_pad_image" in e.text[lo:hi]
        return OK if (in_node and "vace_image_input" in d
                      and "vace_image_input" in s and "vace_image_input" in m) else FAIL

    def apply(self):
        # This fix spans four files. Every edit is prepared in memory first and
        # only written once all four have succeeded, so a moved anchor leaves
        # the install exactly as it was instead of half-patched.
        f = self.files()
        pending = []

        # (a) comfy/ldm/wan/model.py -- VaceWanModel
        e = Edit(f["model"])
        if not e.has("vace_image_input"):
            e.sub("                 vace_in_dim=None,\n                 device=None,",
                  "                 vace_in_dim=None,\n                 vace_image_input=False,\n                 device=None,")
            # WanModel_S2V and HumoWanModel carry the identical super() line
            e.sub("super().__init__(model_type='t2v', patch_size=patch_size",
                  "super().__init__(model_type='i2v' if vace_image_input else 't2v', patch_size=patch_size",
                  scope="VaceWanModel")
            e.insert_before(
                "        orig_shape = list(vace_context.shape)",
                "        # vace blocks are t2v pretrained, they attend over text tokens only\n"
                "        if context_img_len is None:\n"
                "            context_vace = context\n"
                "        else:\n"
                "            context_vace = context[:, context_img_len:]\n\n")
            e.sub("self.vace_blocks[ii](c[iii], x=x_orig, e=e0, freqs=freqs, context=context, context_img_len=context_img_len,",
                  "self.vace_blocks[ii](c[iii], x=x_orig, e=e0, freqs=freqs, context=context_vace, context_img_len=None,")
            pending.append(e)

        # (b) comfy/model_detection.py -- recognise an ID-V2V checkpoint
        e = Edit(f["detect"])
        if not e.has("vace_image_input"):
            e.insert_after(
                '            dit_config["vace_layers"] = count_blocks(state_dict_keys, \'{}vace_blocks.\'.format(key_prefix) + \'{}.\')',
                "\n            if '{}img_emb.proj.0.bias'.format(key_prefix) in state_dict_keys:  # ID-V2V, vace on an i2v model\n"
                '                dit_config["vace_image_input"] = True')
            pending.append(e)

        # (c) comfy/supported_models.py -- build it as image-to-video
        e = Edit(f["supported"])
        if not e.has('image_to_video=self.unet_config.get("vace_image_input"'):
            e.sub("out = model_base.WAN21_Vace(self, image_to_video=False, device=device)",
                  'out = model_base.WAN21_Vace(self, image_to_video=self.unet_config.get("vace_image_input", False), device=device)')
            pending.append(e)

        # (d) comfy_extras/nodes_wan.py -- the ref_pad_image input
        e = Edit(f["nodes"])
        if not e.has("ref_pad_image"):
            # all seven Wan nodes declare this same start_image input
            e.insert_after(
                '                io.Image.Input("start_image", optional=True),',
                '\n                io.Image.Input("ref_pad_image", optional=True, tooltip="Fills the padding frames of the image conditioning with this image instead of gray, anchoring identity without pinning frames (SVI-style anti-drift padding, used by models such as ID-V2V)."),',
                scope="WanImageToVideo")
            e.sub("def execute(cls, positive, negative, vae, width, height, length, batch_size, start_image=None, clip_vision_output=None) -> io.NodeOutput:",
                  "def execute(cls, positive, negative, vae, width, height, length, batch_size, start_image=None, clip_vision_output=None, ref_pad_image=None) -> io.NodeOutput:")
            # WanFirstLastFrameToVideo builds the same gray canvas
            e.insert_after(
                "            image = torch.ones((length, height, width, start_image.shape[-1]), device=start_image.device, dtype=start_image.dtype) * 0.5",
                "\n            if ref_pad_image is not None:\n"
                '                ref_pad_image = comfy.utils.common_upscale(ref_pad_image[:1].movedim(-1, 1), width, height, "bilinear", "center").movedim(1, -1)\n'
                "                image[:, :, :, :3] = ref_pad_image[:, :, :, :3].to(device=image.device, dtype=image.dtype)",
                scope="WanImageToVideo")
            pending.append(e)

        # every transformation resolved -> now it is safe to write
        for e in pending:
            e.commit()


# ---- 2/3. TRELLIS2 -- delegate to the two existing scripts ----------------
class Trellis2Combos(Fix):
    name = "TRELLIS2 numeric dropdowns"
    why = ("The pack declares resolution dropdowns with INTEGER options, but the frontend "
           "submits them as strings -> every run fails with \"value not in list\".")
    target = "custom_nodes/ComfyUI-Trellis2/nodes.py -- reverted by a pack update"

    def nodes_py(self):
        return os.path.join(NODES, "ComfyUI-Trellis2", "nodes.py")

    def state(self):
        p = self.nodes_py()
        if not os.path.isfile(p):
            raise FileNotFoundError(p)
        t, _ = read(p)
        return OK if "resolution = int(resolution)" in t else FAIL

    def apply(self):
        run_helper("fix_resolution_combos.py")


class Trellis2Paths(Fix):
    name = "TRELLIS2 example-workflow paths"
    why = "The pack ships the author's own C:\\Git\\ComfyUI\\... mesh paths, which crash on this drive."
    target = "custom_nodes/ComfyUI-Trellis2/example_workflows/*.json -- reverted by a pack update"

    def folder(self):
        return os.path.join(NODES, "ComfyUI-Trellis2", "example_workflows")

    def state(self):
        d = self.folder()
        if not os.path.isdir(d):
            raise FileNotFoundError(d)
        for f in os.listdir(d):
            if f.endswith(".json"):
                t = open(os.path.join(d, f), "r", encoding="utf-8", errors="replace").read()
                if "C:\\\\Git" in t or "C:/Git" in t or "C:\\Git" in t:
                    return FAIL
        return OK

    def apply(self):
        run_helper("portablize_paths.py")


# ---- 4. Pixal3D background removal (a MODEL file) -------------------------
class Pixal3DRmbg(Fix):
    name = "Pixal3D RMBG transformers shim"
    why = ("BiRefNet was written for an older transformers; 4.57 calls config.get_text_config(), "
           "which it does not have -> crash on background removal.")
    target = "models/Pixal3D/briaai_RMBG-2.0/birefnet.py -- reverted if the model is re-downloaded"

    def file(self):
        return os.path.join(MODELS, "Pixal3D", "briaai_RMBG-2.0", "birefnet.py")

    def state(self):
        p = self.file()
        if not os.path.isfile(p):
            raise FileNotFoundError(p)
        t, _ = read(p)
        return OK if ("tie_word_embeddings" in t and "def get_text_config" in t) else FAIL

    def apply(self):
        e = Edit(self.file())
        if not e.has("tie_word_embeddings"):
            e.insert_after(
                "class Config():",
                "\n    # --- transformers >=4.49 compat shim ---\n"
                "    # This plain Config is set as model.config, but transformers' tie_weights()\n"
                "    # now calls config.get_text_config(). BiRefNet is a segmentation model with\n"
                "    # no text/embedding weights to tie, so return self and disable tying.\n"
                "    tie_word_embeddings = False\n\n"
                "    def get_text_config(self, decoder=False):\n"
                "        return self\n")
            e.commit()


# ---- 5. DepthAnythingV3 -- run in-process, not in a C: pixi env -----------
class DepthAnythingV3(Fix):
    name = "DepthAnythingV3 stays on this drive"
    why = ("The pack builds an isolated pixi environment on C:, which breaks portability. "
           "All of its dependencies are already in the embedded Python.")
    target = "custom_nodes/ComfyUI-DepthAnythingV3/*.toml -- reverted by a pack update"

    def root_toml(self):
        return os.path.join(NODES, "ComfyUI-DepthAnythingV3", "comfy-env-root.toml")

    def node_toml(self):
        return os.path.join(NODES, "ComfyUI-DepthAnythingV3", "nodes", "comfy-env.toml")

    def state(self):
        p = self.root_toml()
        if not os.path.isfile(p):
            raise FileNotFoundError(p)
        t, _ = read(p)
        isolated_off = re.search(r"isolate\s*=\s*false", t) and re.search(r"install_isolated\s*=\s*false", t)
        return OK if (isolated_off and not os.path.isfile(self.node_toml())) else FAIL

    def apply(self):
        e = Edit(self.root_toml())
        if not re.search(r"isolate\s*=\s*false", e.text):
            e.text = e.text.rstrip("\n") + (
                "\n\n# Run nodes in the main ComfyUI process instead of an isolated pixi env on C:.\n"
                "# All of this pack's deps are present in the embedded Python, so isolation is\n"
                "# unnecessary. This keeps the pack fully portable on the NVMe.\n"
                "[settings]\nisolate = false\ninstall_isolated = false\n")
            e.commit()
        # the per-node toml re-enables isolation; park it as .disabled
        nt = self.node_toml()
        if os.path.isfile(nt):
            os.replace(nt, nt + ".disabled")


# ---- 6. HR Endless Sampler -- import + encoding fixes ---------------------
class HrEndlessSampler(Fix):
    name = "HR-Endless-Sampler import + UTF-8 fixes"
    why = ("Three real bugs: a sibling import that cannot resolve (the pack folder name is not a "
           "valid Python identifier), and worker subprocesses writing JSON in the console codepage, "
           "so one smart quote aborts a render with UnicodeDecodeError.")
    target = "custom_nodes/ComfyUI-HR-Endless-Sampler/gemma4.py -- reverted by a pack update"

    def file(self):
        return os.path.join(NODES, "ComfyUI-HR-Endless-Sampler", "gemma4.py")

    def state(self):
        p = self.file()
        if not os.path.isfile(p):
            raise FileNotFoundError(p)
        t, _ = read(p)
        ok = ("_pkg_dir not in sys.path" in t
              and "PYTHONIOENCODING" in t
              and t.count('errors="replace"') >= 3)
        return OK if ok else FAIL

    def apply(self):
        e = Edit(self.file())

        if "_pkg_dir not in sys.path" not in e.text:
            e.insert_before(
                "        from gemma4_mtp import create_native_mtp_llama",
                "        # This module is loaded without package context (the folder name\n"
                "        # 'ComfyUI-HR-Endless-Sampler' is not a valid Python identifier), so\n"
                "        # neither the original bare import nor a relative one resolves. Put the\n"
                "        # pack's own directory on sys.path so the sibling is importable.\n"
                "        _pkg_dir = os.path.dirname(os.path.abspath(__file__))\n"
                "        if _pkg_dir not in sys.path:\n"
                "            sys.path.insert(0, _pkg_dir)\n")

        if "PYTHONIOENCODING" not in e.text:
            e.insert_before(
                "    return environment\n",
                "    # The parent decodes this worker's stdout as UTF-8 (see _observe_in_worker /\n"
                "    # _plan_timing_in_worker). On a non-UTF-8 Windows locale the child would\n"
                "    # otherwise write its JSON in the console codepage (cp1252 here), and a\n"
                "    # single smart quote aborts the whole render with UnicodeDecodeError.\n"
                '    environment["PYTHONIOENCODING"] = "utf-8"\n'
                '    environment["PYTHONUTF8"] = "1"\n')

        # Tolerate a decode error rather than losing the render.
        # Groups: 1 = the encoding line, 2 = its indent, 3 = the env= line.
        # (This referenced a group 4 that does not exist, so the whole fix threw
        # IndexError and silently never applied — hence the explicit test below.)
        e.text = re.sub(
            r'(\n([ \t]+)encoding="utf-8",\n)(?!\2errors=)(\2env=_worker_environment\(\),)',
            lambda m: m.group(1) + m.group(2) + 'errors="replace",\n' + m.group(3),
            e.text)
        e.commit()


# --------------------------------------------------------------------------
# health checks -- reported, never auto-"fixed" (they need a human decision)
# --------------------------------------------------------------------------
def check_torch():
    """The whole 3D stack is prebuilt against exactly torch 2.8.0+cu128."""
    try:
        out = subprocess.run([PYEXE, "-c", "import torch;print(torch.__version__)"],
                             capture_output=True, text=True, timeout=180)
        v = (out.stdout or "").strip()
    except Exception as exc:
        return WARN, f"could not run the embedded Python ({exc})"
    if v == "2.8.0+cu128":
        return OK, v
    return FAIL, (f"torch is {v or 'unreadable'}, expected 2.8.0+cu128 -- the compiled 3D kernels "
                  f"(Pixal3D / TRELLIS2) will not load. See notice.md section 1 to pin it back.")


def check_compiled_stack():
    code = ("import importlib\n"
            "bad=[]\n"
            "for m in ['triton','sageattention','flash_attn','nvdiffrast','torchvision','torchaudio']:\n"
            "    try: importlib.import_module(m)\n"
            "    except Exception: bad.append(m)\n"
            "print(','.join(bad))\n")
    try:
        out = subprocess.run([PYEXE, "-c", code], capture_output=True, text=True, timeout=300)
        bad = (out.stdout or "").strip()
    except Exception as exc:
        return WARN, f"could not run the embedded Python ({exc})"
    if not bad:
        return OK, "triton, sageattention, flash_attn, nvdiffrast all import"
    return FAIL, f"these no longer import: {bad} -- usually means torch was upgraded"


def check_crossdrive():
    p = os.path.join(NODES, "ComfyUI-CrossDriveViewFix")
    if os.path.isdir(p):
        return OK, "present (lives in custom_nodes, so a core update cannot remove it)"
    return FAIL, ("missing -- previews break when the drive mounts under a new letter. "
                  "Reinstall from https://github.com/b2renger/ComfyUI-CrossDriveViewFix")


def check_upstream_merged():
    """If PR #15139 lands upstream, the ID-V2V fix stops being ours to maintain."""
    p = os.path.join(COMFY, "comfy_extras", "nodes_wan.py")
    if not os.path.isfile(p):
        return SKIP, ""
    try:
        out = subprocess.run(["git", "-C", COMFY, "diff", "--name-only"],
                             capture_output=True, text=True, timeout=60)
        dirty = [l for l in (out.stdout or "").splitlines() if l.strip()]
    except Exception:
        return SKIP, ""
    t, _ = read(p)
    if "ref_pad_image" in t and "comfy_extras/nodes_wan.py" not in dirty:
        return WARN, ("ID-V2V is in ComfyUI itself now -- PR #15139 merged upstream. "
                      "You can delete the ID-V2V fix from this script.")
    return SKIP, ""


# --------------------------------------------------------------------------
def run_helper(script):
    """Run one of the standalone fix scripts that already live in this folder."""
    p = os.path.join(HERE, script)
    if not os.path.isfile(p):
        raise FileNotFoundError(p)
    out = subprocess.run([PYEXE, p], capture_output=True, text=True, timeout=600)
    if out.returncode != 0:
        raise RuntimeError((out.stderr or out.stdout or "").strip()[:400])
    return (out.stdout or "").strip()


FIXES = [IdV2V(), Trellis2Combos(), Trellis2Paths(), Pixal3DRmbg(),
         DepthAnythingV3(), HrEndlessSampler()]

CHECKS = [("PyTorch pin (2.8.0+cu128)", check_torch),
          ("Compiled CUDA extensions", check_compiled_stack),
          ("CrossDriveViewFix node", check_crossdrive)]


def main():
    dry = "--check" in sys.argv or "-c" in sys.argv
    print()
    print("=" * 74)
    print("  ComfyUI maintenance -- re-applying this install's hand-fixes")
    print("  " + PORTABLE)
    if dry:
        print("  (--check: reporting only, nothing will be written)")
    print("=" * 74)

    if not os.path.isdir(COMFY):
        print(f"\n  [FAIL] ComfyUI not found at {COMFY}")
        print("         Keep this script in <drive>\\_maintenance\\, next to ComfyUI_windows_portable\\.")
        return 2

    repaired, failed, already = [], [], []

    print("\n-- FIXES " + "-" * 65)
    for fix in FIXES:
        try:
            st = fix.state()
        except FileNotFoundError as exc:
            print(f"  [SKIP] {fix.name}")
            print(f"         not installed here ({os.path.basename(str(exc))})")
            continue
        except Exception as exc:
            print(f"  [FAIL] {fix.name}: could not inspect -- {exc}")
            failed.append(fix.name)
            continue

        if st == OK:
            print(f"  [ OK ] {fix.name}")
            already.append(fix.name)
            continue

        if dry:
            print(f"  [MISS] {fix.name}  <-- would be re-applied")
            print(f"         {fix.target}")
            repaired.append(fix.name)
            continue

        try:
            fix.apply()
            if fix.state() != OK:
                raise RuntimeError("still reports missing after applying")
            print(f"  [FIXED] {fix.name}")
            print(f"          {fix.why}")
            repaired.append(fix.name)
        except Exception as exc:
            print(f"  [FAIL] {fix.name}")
            print(f"         {exc}")
            print("         Nothing was changed. See notice.md for the manual steps.")
            failed.append(fix.name)

    print("\n-- HEALTH CHECKS " + "-" * 57)
    for label, fn in CHECKS:
        st, detail = fn()
        print(f"  [{st:^5}] {label}")
        if detail:
            print(f"          {detail}")
        if st == FAIL:
            failed.append(label)

    st, detail = check_upstream_merged()
    if st == WARN:
        print(f"\n  [NOTE ] {detail}")

    print("\n" + "=" * 74)
    print(f"  {len(already)} already fine   {len(repaired)} {'to repair' if dry else 'repaired'}   {len(failed)} need attention")
    if repaired and not dry:
        print("\n  >>> RESTART ComfyUI, then hard-refresh the browser (Ctrl+Shift+R).")
        print("      Node definitions are read at startup and cached by the browser.")
    if failed:
        print("\n  Needs a human: " + ", ".join(failed))
        print("  Read notice.md -- it explains every item and how to fix it by hand.")
    print("=" * 74)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
