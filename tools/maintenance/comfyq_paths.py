"""Where ComfyUI and the workflow folders are, read from ComfyQ's own config.

These scripts used to work it out from their own location: they lived at
``<nvme>\\_maintenance\\model-audit\\`` and walked two levels up to find
``ComfyUI_windows_portable\\ComfyUI``, or took the drive letter off their own
path and assumed ``<drive>\\ComfyQ\\workflows``. That made eight separate
assumptions about the layout of a disk, and moving the scripts into the repo
broke every one of them.

There is no need to guess: ComfyQ already knows where ComfyUI is, because an
admin sets it in the panel (Manage ComfyUI -> ComfyUI Settings) and it is
stored in ``config.json`` at the repo root. Reading it from there means the
scripts work wherever they sit, on whatever drive letter the NVMe happens to
mount under, and they agree with the app rather than drifting from it.

Resolution order, most explicit first:
  1. ``COMFY_ROOT`` in the environment  (one-off override)
  2. ``comfy_ui.root_path`` in ComfyQ's config.json
  3. the historical sibling layout, so a copy still sitting beside
     ``ComfyUI_windows_portable`` keeps working

Standard library only: these run under ComfyUI's bundled ``python_embeded``.
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))


def repo_root(start=None):
    """Walk up from `start` to ComfyQ's root (the folder holding workflows/)."""
    d = os.path.abspath(start or HERE)
    for _ in range(8):
        if os.path.isdir(os.path.join(d, 'workflows')) and os.path.exists(os.path.join(d, 'package.json')):
            return d
        parent = os.path.dirname(d)
        if parent == d:
            break
        d = parent
    return None


def load_config():
    """ComfyQ's config.json as a dict, or {} when it cannot be read.

    It is gitignored and per-machine, so a fresh clone has none — that is not
    an error, it just means falling through to the next resolution step.
    """
    root = repo_root()
    if not root:
        return {}
    try:
        with open(os.path.join(root, 'config.json'), encoding='utf-8') as fh:
            return json.load(fh)
    except Exception:
        return {}


def comfy_root(required=True):
    """The ComfyUI install directory."""
    env = os.environ.get('COMFY_ROOT')
    if env and os.path.isdir(env):
        return os.path.normpath(env)

    cfg = load_config()
    configured = (cfg.get('comfy_ui') or {}).get('root_path') or ''
    if configured and os.path.isdir(configured):
        return os.path.normpath(configured)

    # The layout these scripts were born in, kept so a copy left beside the
    # portable install still works.
    legacy = os.path.normpath(os.path.join(HERE, '..', '..', '..',
                                           'ComfyUI_windows_portable', 'ComfyUI'))
    if os.path.isdir(legacy):
        return legacy

    if not required:
        return None
    raise SystemExit(
        'Could not find the ComfyUI install.\n'
        '  Set it in ComfyQ (Manage ComfyUI -> ComfyUI Settings), which writes\n'
        '  comfy_ui.root_path into config.json at the repo root, or run this\n'
        '  with COMFY_ROOT=<path to ComfyUI>.\n'
        + (('  config.json says: %s\n' % configured) if configured else '')
    )


def models_root(required=True):
    root = comfy_root(required=required)
    return os.path.join(root, 'models') if root else None


def workflow_dirs():
    """Every folder on this machine holding ComfyUI workflow JSON.

    ★ Keep this in step with server/workflows/modelUsage.js, which decides what
    is safe to delete. A folder missing from one and present in the other means
    the two tools disagree about whether a model is in use.
    """
    dirs = []
    root = repo_root()
    if root:
        dirs.append(os.path.join(root, 'workflows'))

    comfy = comfy_root(required=False)
    cfg = load_config()
    # Relative entries resolve against the ComfyUI root, so a config travels
    # between machines that mount the NVMe under different letters.
    for entry in (cfg.get('maintenance') or {}).get('workflowScanDirs') or []:
        if not entry:
            continue
        p = entry if os.path.isabs(entry) else (os.path.join(comfy, entry) if comfy else None)
        if p:
            dirs.append(os.path.normpath(p))

    if comfy:
        dirs.append(os.path.join(comfy, 'user', 'default', 'workflows'))

    seen, out = set(), []
    for d in dirs:
        key = os.path.normcase(os.path.normpath(d))
        if key in seen or not os.path.isdir(d):
            continue
        seen.add(key)
        out.append(os.path.normpath(d))
    return out


def labelled_workflow_dirs():
    """workflow_dirs(), each tagged with the collection name the audit uses.

    The labels end up in model-audit.csv's `used_by` column, so they are kept
    stable rather than derived freely.
    """
    root = repo_root()
    comfy = comfy_root(required=False)
    repo_wf = os.path.normcase(os.path.normpath(os.path.join(root, 'workflows'))) if root else None
    staged = os.path.normcase(os.path.normpath(
        os.path.join(comfy, 'user', 'default', 'workflows'))) if comfy else None

    out = []
    for d in workflow_dirs():
        key = os.path.normcase(os.path.normpath(d))
        if key == repo_wf:
            label = 'comfyq'
        elif key == staged:
            label = 'comfyui_staged'
        else:
            base = os.path.basename(d.rstrip('\\/')).lstrip('_').lower()
            label = 'demo' if 'demo' in base else (base or 'extra')
        out.append((d, label))
    return out


def python_exe():
    """ComfyUI's bundled interpreter, which is what these scripts expect.

    Derived from the configured install, so it follows the admin panel rather
    than a drive letter.
    """
    comfy = comfy_root(required=False)
    if comfy:
        cand = os.path.normpath(os.path.join(comfy, '..', 'python_embeded', 'python.exe'))
        if os.path.isfile(cand):
            return cand
    return None


if __name__ == '__main__':
    import sys
    if '--python' in sys.argv:
        # Used by AUDIT.bat, which cannot read JSON itself.
        print(python_exe() or '')
        raise SystemExit(0)
    if '--models' in sys.argv:
        print(models_root(required=False) or '')
        raise SystemExit(0)
    print('repo root   :', repo_root())
    print('comfy root  :', comfy_root(required=False))
    print('models root :', models_root(required=False))
    print('workflow dirs:')
    for d in workflow_dirs():
        print('   ', d)
