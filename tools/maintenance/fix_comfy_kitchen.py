r"""Re-apply the local fixes this fleet needs inside comfy-kitchen.

comfy-kitchen is the pip package of fast kernels that ComfyUI pins in its
requirements (0.2.41 with ComfyUI 0.45.2). It lives in python_embeded's
site-packages, so every ComfyUI update that moves the pin reinstalls it and
throws a local fix away. That is why the fix text lives here, in the repo: the
admin panel runs this from Maintenance, and ComfyQ's own ComfyUI update runs it
again as soon as the update finishes.

The two fixes (found 2026-11-12, kitchen 0.2.41, torch 2.8.0+cu128, RTX 5090)
---------------------------------------------------------------------------
1. ``flash_attention_decode_gqa`` / ``flash_attention_decode_tree_merge``: the
   CUDA binding checks the strides of every dimension exactly, and PyTorch's
   DLPack export gives a size-1 dimension stride 1. With batch 1 (always, here)
   or a one-token decode the check fails: "Unsupported Flash Attention tensor
   strides". Every Qwen 3.5 prompt improver (TextGenerate) dies on it.
   Upstream: Comfy-Org/comfy-kitchen issue #274, fix PRs #269 and #279, all
   still open on 2026-11-12. The fix sends those calls to kitchen's own torch
   path, which the issue reports gives correct text.
2. ``backends/eager/na.py`` ``window_attention``: the per-axis key-table cache
   is keyed ``(q0, size, window)``, shared by the y and x axes. In a SQUARE
   frame cut into non-square tiles the x axis reads the y axis's table and the
   mask no longer matches the queries: "The size of tensor a (2312) must match
   the size of tensor b (1156)". RelayVSR's VSRDecode fails on every square
   video. This path runs because ComfyUI disables kitchen's CUDA backend below
   torch cu130. Not reported upstream as of 2026-11-12.

Rules, as in fix_custom_node_patches.py
---------------------------------------
* Idempotent: a second run says "already applied".
* A missing anchor is a FAILURE with the reason, never a silent no-op. When
  kitchen changes under a patch (an update that fixed it upstream, or moved the
  code), this says so and writes nothing.
* The patched file is parsed with ``ast.parse`` before it is written.

Usage (ComfyUI's python):
    python fix_comfy_kitchen.py           apply what is missing
    python fix_comfy_kitchen.py --check   report only, change nothing;
                                          exit 1 if a fix is missing or failed
Any other argument is refused, ``--help`` included.

Standard library only: this runs under ComfyUI's bundled ``python_embeded``.
"""
import ast
import importlib.util
import io
import os
import sys

MARK = 'ComfyQ fix (tools/maintenance/fix_comfy_kitchen.py)'

DECODE_GATE_ANCHOR = (
    "    if head_dim != 256 or not flash_attention_decode_gqa_is_available(q.device, q.dtype):\n"
)
DECODE_GATE_PATCH = (
    "    # " + MARK + ": the CUDA binding rejects the stride DLPack gives a size-1\n"
    "    # dimension, so batch 1 or a one-token decode takes the torch path (kitchen #274).\n"
    "    if head_dim != 256 or 1 in (batch, query_length) or not flash_attention_decode_gqa_is_available(q.device, q.dtype):\n"
)
MERGE_GATE_ANCHOR = (
    "    if q.shape[-1] != 256 or not flash_attention_decode_gqa_is_available(q.device, q.dtype):\n"
)
MERGE_GATE_PATCH = (
    "    # " + MARK + ": same size-1 stride rejection as decode_gqa (kitchen #274).\n"
    "    if q.shape[-1] != 256 or 1 in (q.shape[0], q.shape[2]) or not flash_attention_decode_gqa_is_available(q.device, q.dtype):\n"
)
AXIS_KEY_ANCHOR = "        key = (q0, size, window)\n"
AXIS_KEY_PATCH = (
    "        # " + MARK + ": q1 belongs in the key. Without it a square frame's x axis\n"
    "        # reads the y axis's table whenever the tiles are not square.\n"
    "        key = (q0, q1, size, window)\n"
)

FIXES = [
    {
        'file': 'flash_attention.py',
        'label': 'Decode attention: batch 1 and one-token decode take the torch path',
        'why': 'every Qwen 3.5 prompt improver fails with "Unsupported Flash Attention tensor strides"',
        'marker': '1 in (batch, query_length)',
        'edits': [(DECODE_GATE_ANCHOR, DECODE_GATE_PATCH), (MERGE_GATE_ANCHOR, MERGE_GATE_PATCH)],
    },
    {
        'file': os.path.join('backends', 'eager', 'na.py'),
        'label': 'Window attention (torch fallback): per-axis cache keyed on both ends of the tile',
        'why': 'RelayVSR fails on square videos: "The size of tensor a (...) must match the size of tensor b (...)"',
        'marker': 'key = (q0, q1, size, window)',
        'edits': [(AXIS_KEY_ANCHOR, AXIS_KEY_PATCH)],
    },
]


def kitchen_dir():
    # find_spec locates a top-level package without importing it (no torch load).
    spec = importlib.util.find_spec('comfy_kitchen')
    if spec is None or not spec.submodule_search_locations:
        return None
    return list(spec.submodule_search_locations)[0]


def kitchen_version():
    try:
        from importlib import metadata
        return metadata.version('comfy-kitchen')
    except Exception:  # noqa: BLE001 - informational only
        return 'unknown'


def plan_fix(root, fix):
    """-> (state, message, patched_text_or_None). state: 'missing' | 'already' | 'failed'."""
    target = os.path.join(root, fix['file'])
    if not os.path.isfile(target):
        return 'failed', '%s is missing from comfy_kitchen' % fix['file'], None
    # newline='' keeps the file's own line endings (kitchen ships CRLF): match on LF,
    # write back what was there, so the diff is only the patched lines.
    with io.open(target, encoding='utf-8', newline='') as fh:
        raw = fh.read()
    eol = '\r\n' if '\r\n' in raw else '\n'
    src = raw.replace('\r\n', '\n')
    if fix['marker'] in src:
        return 'already', 'already applied', None
    patched = src
    for anchor, replacement in fix['edits']:
        found = patched.count(anchor)
        if found != 1:
            return 'failed', (
                'the code this fix needs was found %d times, not once, in comfy_kitchen/%s.\n'
                '  kitchen has changed since the fix was written (perhaps fixed upstream), so it\n'
                '  was NOT patched. Check the bug it fixes before writing a new patch.\n'
                '  Anchor: %s' % (found, fix['file'], anchor.strip()[:100])
            ), None
        patched = patched.replace(anchor, replacement, 1)
    try:
        ast.parse(patched)
    except SyntaxError as exc:
        return 'failed', 'the patched file would not parse (%s), nothing was written' % exc, None
    return 'missing', 'not applied yet', patched.replace('\n', eol)


def main(argv):
    args = argv[1:]
    unknown = [a for a in args if a != '--check']
    if unknown:
        print('REFUSED: unknown argument(s) %s. The only option is --check (report, change nothing).'
              % ' '.join(unknown))
        return 2
    check = '--check' in args

    root = kitchen_dir()
    print('python: %s' % sys.executable)
    if not root:
        print('FAILED: comfy_kitchen is not installed in this python')
        return 1
    print('comfy-kitchen %s at %s' % (kitchen_version(), root))

    tally = {'applied': 0, 'already': 0, 'missing': 0, 'failed': 0}
    for fix in FIXES:
        print('')
        print('--- %s' % fix['label'])
        print('  why: %s' % fix['why'])
        state, message, patched = plan_fix(root, fix)
        if state == 'missing' and not check:
            with io.open(os.path.join(root, fix['file']), 'w', encoding='utf-8', newline='') as fh:
                fh.write(patched)
            state, message = 'applied', 'patched comfy_kitchen/%s' % fix['file'].replace(os.sep, '/')
        tally[state] += 1
        print('  %s: %s' % (state.upper(), message))

    print('')
    print('%d applied, %d already in place, %d missing, %d FAILED'
          % (tally['applied'], tally['already'], tally['missing'], tally['failed']))
    if tally['failed']:
        print('At least one fix could not be applied: read the reason above.')
        return 1
    if tally['missing']:
        print('CHECK ONLY: %d fix(es) not applied. Run without --check to apply.' % tally['missing'])
        return 1
    if tally['applied']:
        print('ALL CHECKS PASSED -- restart ComfyUI to load the patched comfy-kitchen.')
    else:
        print('ALL CHECKS PASSED -- nothing needed changing.')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
