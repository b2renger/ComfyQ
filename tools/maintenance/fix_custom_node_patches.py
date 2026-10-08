r"""Re-apply the local fixes this fleet needs inside ComfyUI's ``custom_nodes``.

Why this exists rather than a hand-edit on the rig
--------------------------------------------------
A node pack lives in the ComfyUI install, not in this repository, so a fix
typed into one by hand exists on exactly one machine. It is invisible to
ComfyQ's history, it is lost by a re-clone or a ComfyUI-Manager reinstall, and
no other rig imaged from this drive gets it. Every other change this project
makes to the install goes through ``tools/maintenance`` for that reason, and so
does this one: the patch text lives here, in the repo, and the install is
brought up to it.

Design rules, both learned the hard way on this fleet
----------------------------------------------------
* **Idempotent.** Running it twice is a no-op that says so. These are buttons in
  an admin panel and they get pressed twice.
* **It refuses loudly when the target is not what it expects.** A repair step
  that silently matches nothing reports success over a rig it did not fix --
  ComfyQ already carries a warning about exactly that shape (the ID-V2V repair
  step, whose target code later came to contain the fix already). So every
  patch below states the anchor it needs, and a missing anchor is a FAILURE with
  the reason, never a shrug.
* **The result is parsed before it is written.** A Python file is checked with
  ``ast.parse`` after patching, so a bad edit cannot leave a pack that breaks
  ComfyUI's import at the next boot.

~A patched pack reads as DIRTY to git, which is deliberate: ComfyQ's node-pack
updater refuses to pull over uncommitted changes, so a local fix cannot be
silently discarded by an update. If a pack here is ever updated on purpose,
commit or stash in that clone, pull, then run this again.

Standard library only: this runs under ComfyUI's bundled ``python_embeded``.
"""
import ast
import io
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import comfyq_paths  # noqa: E402


# --------------------------------------------------------------------------- #
# The fixes. Each is (pack folder, file, description, [(anchor, replacement)]).
# `marker` is the string whose presence means the fix is already applied.
# --------------------------------------------------------------------------- #

QWEN21_FUNCONTROL_IMPORT_ANCHOR = (
    "from .control_model import QwenImage21FunControlNet, detect_control_config\n"
)

QWEN21_FUNCONTROL_IMPORT_PATCH = QWEN21_FUNCONTROL_IMPORT_ANCHOR + '''
# ComfyUI's model compiler (comfy-aimdo) records ONE allocation pattern for the
# diffusion model's per-block scope and replays it for every block. Work that
# does not happen on every block has to step outside it. Guarded because the
# module does not exist on ComfyUI before the DynamicVRAM work (this pack was
# written against 0.37.0, which has no malloc graph to pause).
try:
    import comfy.model_prefetch

    _pause_malloc_graph = comfy.model_prefetch.pause_malloc_graph
except (ImportError, AttributeError):  # pragma: no cover - depends on the install
    def _pause_malloc_graph():
        return contextlib.nullcontext()
'''

QWEN21_FUNCONTROL_INJECT_ANCHOR = '''                idx = state["layer_to_hint"].get(args["block_index"])
                if idx is not None:
                    img = img + state["hints"][idx].to(img.dtype) * state["scale"]'''

QWEN21_FUNCONTROL_INJECT_PATCH = '''                idx = state["layer_to_hint"].get(args["block_index"])
                if idx is not None:
                    # Outside the malloc graph, deliberately. A hint lands on every
                    # SECOND block (control_layers = range(0, 32, 2)), so allocating
                    # here inside the block scope makes block 0 allocate what block 1
                    # does not -- the compiled pattern no longer matches and the next
                    # block's scope close fails with "aimdo memory compile error".
                    # The model's own forward uses the same escape for its
                    # prefix-cache work (comfy/ldm/qwen_image21/model.py).
                    with _pause_malloc_graph():
                        img = img + state["hints"][idx].to(img.dtype) * state["scale"]'''

FIXES = [
    {
        'pack': 'ComfyUI-QwenImage21-FunControlNet',
        'file': 'nodes.py',
        'label': 'Qwen-Image 2.1 Fun ControlNet: keep the hint injection out of the malloc graph',
        'why': (
            'Without it both image_qwen_image_2_1_control_canny and ..._control_depth die inside\n'
            '  sampling with "RuntimeError: aimdo memory compile error" on ComfyUI 0.39.x. A hint\n'
            '  exists on every SECOND block, so adding it inside the model\'s per-block malloc\n'
            '  scope makes block 0 allocate what block 1 does not; comfy-aimdo replays one\n'
            '  recorded pattern per block, so the next scope close fails. The traceback points at\n'
            '  ComfyUI\'s own model.py, which is why it reads as a ComfyUI bug.'
        ),
        'marker': '_pause_malloc_graph()',
        'edits': [
            ('import logging\n\nimport torch', 'import contextlib\nimport logging\n\nimport torch'),
            (QWEN21_FUNCONTROL_IMPORT_ANCHOR, QWEN21_FUNCONTROL_IMPORT_PATCH),
            (QWEN21_FUNCONTROL_INJECT_ANCHOR, QWEN21_FUNCONTROL_INJECT_PATCH),
        ],
    },
]


def apply_fix(custom_nodes, fix):
    """-> (state, message) where state is 'applied' | 'already' | 'absent' | 'failed'."""
    pack_dir = os.path.join(custom_nodes, fix['pack'])
    target = os.path.join(pack_dir, fix['file'])

    if not os.path.isdir(pack_dir):
        # Not an error: a rig that does not have the pack does not need the fix.
        return 'absent', 'custom_nodes/%s is not installed here, so nothing to fix' % fix['pack']
    if not os.path.isfile(target):
        return 'failed', '%s/%s is missing -- the pack is installed but not as expected' % (
            fix['pack'], fix['file'])

    with io.open(target, encoding='utf-8') as fh:
        src = fh.read()

    if fix['marker'] in src:
        return 'already', 'already applied'

    patched = src
    for anchor, replacement in fix['edits']:
        found = patched.count(anchor)
        if found != 1:
            # ** The loud refusal. ** Anything other than exactly one match means
            # the pack is not the version this patch was written against, and
            # guessing would either do nothing or corrupt it.
            return 'failed', (
                'the code this patch needs was found %d times, not once, in %s/%s.\n'
                '  The pack has changed since the fix was written, so it was NOT patched.\n'
                '  Anchor: %s' % (found, fix['pack'], fix['file'],
                                  anchor.strip().splitlines()[0][:90])
            )
        patched = patched.replace(anchor, replacement, 1)

    try:
        ast.parse(patched)
    except SyntaxError as exc:
        return 'failed', 'the patched file would not parse (%s) -- nothing was written' % exc

    with io.open(target, 'w', encoding='utf-8', newline='\n') as fh:
        fh.write(patched)
    return 'applied', 'patched %s/%s' % (fix['pack'], fix['file'])


def main():
    root = comfyq_paths.comfy_root()
    custom_nodes = os.path.join(root, 'custom_nodes')
    print('ComfyUI install: %s' % root)
    if not os.path.isdir(custom_nodes):
        print('FAILED: %s does not exist' % custom_nodes)
        return 1

    tally = {'applied': 0, 'already': 0, 'absent': 0, 'failed': 0}
    for fix in FIXES:
        print('')
        print('--- %s' % fix['label'])
        print('  why: %s' % fix['why'])
        state, message = apply_fix(custom_nodes, fix)
        tally[state] += 1
        print('  %s: %s' % (state.upper(), message))
        if state == 'applied':
            print('  NOTE: ComfyUI must be restarted before it runs the patched code.')

    print('')
    print('%d applied, %d already in place, %d not installed, %d FAILED'
          % (tally['applied'], tally['already'], tally['absent'], tally['failed']))
    if tally['failed']:
        print('')
        print('At least one fix could not be applied. Read the reason above: the usual cause is')
        print('that the pack was updated and the patch needs rewriting against the new code.')
        return 1
    if tally['applied']:
        print('ALL CHECKS PASSED -- restart ComfyUI to load the patched pack(s).')
    else:
        print('ALL CHECKS PASSED -- nothing needed changing.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
