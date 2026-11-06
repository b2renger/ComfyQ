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
  2. ``comfy_ui.root_path`` in ComfyQ's config.json, when it holds an install
  3. an install beside this checkout, in the two layouts ComfyQ's own boot
     looks for first (server/config/configManager.js, comfyCandidates):
     ``ComfyUI_windows_portable_nvidia\\ComfyUI_windows_portable\\ComfyUI``
     (the drive) and ``ComfyUI_windows_portable\\ComfyUI`` (a restored ISO).
     config.json is only rewritten when ComfyQ boots, so on a clone mounted
     under a new letter, or an ISO just restored, this is what lets REPAIR.bat
     and the audit find the install before ComfyQ has ever run there.

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


def _is_install(d):
    """A ComfyUI folder, by the same test ComfyQ's boot uses: main.py in it."""
    return bool(d) and os.path.isfile(os.path.join(d, 'main.py'))


def beside_checkout():
    """The installs ComfyQ's boot looks for beside its own checkout, in order.

    Keep in step with comfyCandidates in server/config/configManager.js (its
    first two entries) and with python-path.js.
    """
    root = repo_root()
    parent = os.path.dirname(root) if root else os.path.normpath(os.path.join(HERE, '..', '..', '..'))
    return [
        os.path.join(parent, 'ComfyUI_windows_portable_nvidia', 'ComfyUI_windows_portable', 'ComfyUI'),
        os.path.join(parent, 'ComfyUI_windows_portable', 'ComfyUI'),
    ]


def comfy_root(required=True):
    """The ComfyUI install directory."""
    env = os.environ.get('COMFY_ROOT')
    if env and os.path.isdir(env):
        return os.path.normpath(env)

    cfg = load_config()
    configured = (cfg.get('comfy_ui') or {}).get('root_path') or ''
    # A configured path with no main.py is a stale one (another drive letter):
    # ComfyQ itself repoints such a config at its next boot.
    if configured and _is_install(configured):
        return os.path.normpath(configured)

    for cand in beside_checkout():
        if _is_install(cand):
            return os.path.normpath(cand)

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


def _scan_off():
    """What the admin switched off in Maintenance → Folders scanned."""
    return set((load_config().get('maintenance') or {}).get('scanDirsOff') or [])


def excluded_workflow_dirs():
    """Folders the walkers must skip even when a parent is scanned.

    Only the candidates folder needs this: it lives INSIDE workflows/, which is
    always scanned because it holds the bundles.
    """
    root = repo_root()
    out = []
    if root and 'candidates' in _scan_off():
        out.append(os.path.normcase(os.path.normpath(os.path.join(root, 'workflows', '_candidate_workflows'))))
    return out


def walk_workflows(base):
    """os.walk over a workflow folder, minus anything switched off."""
    skip = excluded_workflow_dirs()
    for root, dirs, files in os.walk(base):
        dirs[:] = [d for d in dirs
                   if os.path.normcase(os.path.normpath(os.path.join(root, d))) not in skip]
        yield root, dirs, files


def workflow_dirs():
    """Every folder on this machine holding ComfyUI workflow JSON that counts.

    ★ Keep this in step with server/workflows/scanFolders.js, which decides the
    same thing for the admin panel's prune tool. A folder counted by one and not
    the other means the two tools disagree about whether a model is in use.
    Switched-off folders (config.maintenance.scanDirsOff) are left out here; the
    panel still reads them to say why a model is unprotected.
    """
    dirs = []
    root = repo_root()
    off = _scan_off()
    if root:
        dirs.append(os.path.join(root, 'workflows'))

    comfy = comfy_root(required=False)
    cfg = load_config()
    # Relative entries resolve against the ComfyUI root, so a config travels
    # between machines that mount the NVMe under different letters.
    for entry in (cfg.get('maintenance') or {}).get('workflowScanDirs') or []:
        if not entry or entry in off:
            continue
        p = entry if os.path.isabs(entry) else (os.path.join(comfy, entry) if comfy else None)
        if p:
            dirs.append(os.path.normpath(p))

    if comfy and 'comfyui-user' not in off:
        dirs.append(os.path.join(comfy, 'user', 'default', 'workflows'))

    # Each parallel lane's own ComfyUI saves graphs here, one folder per profile.
    if root and 'lanes' not in off:
        lanes = os.path.join(root, '.comfyq-lanes')
        if os.path.isdir(lanes):
            for wf in sorted(os.listdir(lanes)):
                user = os.path.join(lanes, wf, 'user')
                if os.path.isdir(user):
                    for prof in sorted(os.listdir(user)):
                        dirs.append(os.path.join(user, prof, 'workflows'))

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
        elif '.comfyq-lanes' in key:
            label = 'lane'
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
        # For running by hand. The .bat files (AUDIT.bat, REPAIR.bat) cannot use
        # this -- they need an interpreter before they can run any Python -- so
        # they ask python-path.js, which reads the same config.
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
