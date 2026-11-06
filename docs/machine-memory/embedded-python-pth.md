---
name: embedded-python-pth
description: "ComfyUI's python_embeded has a python312._pth: sys.path is pinned, PYTHONPATH is ignored, and a script cannot import a module sitting beside it"
metadata:
  node_type: memory
  type: reference
  originSessionId: 72baea89-0e6e-4545-8b23-8587c89d636e
  modified: 2026-10-06T08:50:38.699Z
---

`python_embeded\python.exe` on this fleet is the Windows **embeddable** distribution, which
ships a `python312._pth`. That file bypasses the normal path calculation entirely:

- `sys.path` is **pinned** to what the `._pth` lists — on this rig that is the ComfyUI dir,
  `python312.zip`, `python_embeded`, and its `site-packages` (+ pywin32 dirs).
- **`PYTHONPATH` is ignored.** Verified directly: setting it to a folder and printing
  `sys.path` returns `PYTHONPATH IGNORED`.
- The **script's own directory is NOT prepended**, unlike a normal `python script.py`.

So `import variants` fails in a script whose `variants.py` sits right next to it, and no
environment variable can fix it. Symptom is a bare `ModuleNotFoundError` for a file you can
see on disk.

**How to apply:** launch through a bootstrap instead of passing the script directly —
`python.exe -c "import runpy,sys,os; p=sys.argv[1]; sys.path.insert(0, os.path.dirname(os.path.abspath(p))); sys.argv=sys.argv[1:]; runpy.run_path(p, run_name='__main__')" <script>`.
That is what `server/maintenance/scriptRunner.js` does. Scripts that already work by hand do
so because they insert their parent dir themselves.

Pair it with `PYTHONIOENCODING=utf-8` (and `PYTHONUTF8=1`) on every spawn: these scripts and
ComfyUI print `✓`, and Windows falls back to cp1252 the moment stdout is a pipe rather than a
terminal, so a captured run dies with `UnicodeEncodeError` where the same command works
interactively. Related: [[model-audit-usage-classes]], [[portable-no-drive-letters]].
