r"""Which models are variants of which, and which swaps are actually safe.

Three relationships, in descending order of how safe a swap is:

  COPY     byte-identical file in two folders          -- free
  BUILD    same weights, different precision/packaging -- safe, quality call
  LINEAGE  same role and size, different weights       -- NOT a drop-in

and one that is never offered as a swap at all: a different model GENERATION
(LTX 2.3 vs 2.5, Wan 2.1 vs 2.2). Those are not interchangeable, and the honest
answer to "can I just use the newer checkpoint everywhere" is no -- the rest of
the graph is locked to the old generation too. `version_lock()` says what else
would have to move.

Shared by build_csv.py (the sheet) and audit_ui.py (the swap suggestions).
"""
import re
from collections import defaultdict

# Packaging only: how the SAME weights are stored.
QUANT = (r'(fp8|fp16|fp32|bf16|int8|int4|nf4|fp4|nvfp4|awq|gguf|q\d(_k)?(_[smlx])?'
         r'|e4m3fn|e5m2|scaled|mixed|convrot|pruned|quant)')
NOISE = (r'(comfyui|comfy_?org|comfy|safetensors|model|weights|diffusion'
         r'|transformer_only|split_files|v\d+(\.\d+)*|version)')

# Tokens naming a JOB. Two files differing on any of these are complementary,
# not alternatives -- Wan 2.2 loads high_noise AND low_noise in one sampler.
ROLE = {
    'high', 'low', 'noise', 't2v', 'i2v', 'ti2v', 't2i', 'v2v', 'flf2v', 'ref2v',
    'ref2va', 'fl2v', 'fl2va', 'ref', 'edit', 'inpaint', 'control', 'controlnet',
    'camera', 'canny', 'depth', 'pose', 'openpose', 'blur', 'scribble', 'recolor',
    'sketch', 'normal', 'tile', 'union', 'layered', 'unconditional', 'base',
    'turbo', 'distill', 'distilled', 'lightning', 'sharp', 'ema', 'shape',
    'texture', 'video', 'audio', 'music', 'text', 'encoder', 'vae', '4step',
    '8step', '4steps', '8steps', 'faceid', 'plusv2', 'flux', 'flux2', 'klein',
    'qwenimage', 'qwen', 'sdxl', 'sd15', 'sd35', 'firered', 'wan', 'ltx',
    'minimax', 'lcm', 'lora', 'load',
}
RELEASE = re.compile(r'^\d{4}$')
# "14b", "19b", "22b" -- a different parameter count is a different model
PARAMS = re.compile(r'^\d+b$')


def param_size(name):
    m = re.search(r'\b(\d+)b\b', name.lower())
    return m.group(1) if m else None

# Families whose generation number must match across a whole workflow.
#
# The minor part may be written with a dot OR an underscore: wan2_1_vae,
# wan_2.1_vae and Wan2.1_VAE are all the same Wan 2.1 VAE. Reading the first as
# version "2" made identical files look like different generations.
#
# A hyphen is NOT a decimal separator -- "ltx-2-19b" is LTX 2 with 19B
# parameters, not LTX 2.19 -- so the minor group only accepts [._].
FAMILY = [
    ('ltx', re.compile(r'\bltx[-_ ]?v?[-_ ]?(\d+)(?:[._](\d+))?', re.I)),
    ('wan', re.compile(r'\bwan[-_ ]?v?[-_ ]?(\d+)(?:[._](\d+))?', re.I)),
    ('flux', re.compile(r'\bflux[-_ ]?v?[-_ ]?(\d+)(?:[._](\d+))?', re.I)),
    ('qwen-image',
     re.compile(r'\bqwen[-_ ]?image[-_ ]?(?:edit[-_ ]?)?(\d{4})(?:()) ?', re.I)),
    ('sd', re.compile(r'\bsd[-_ ]?v?[-_ ]?(\d+)(?:[._](\d+))?', re.I)),
]


def tokens(name):
    s = re.sub(r'\.(safetensors|ckpt|pt|pth|bin|gguf|onnx|sft)$', '', name.lower())
    s = re.sub(r'[^a-z0-9]+', ' ', s)
    s = re.sub(r'\b' + QUANT + r'\b', ' ', s)
    s = re.sub(r'\b' + NOISE + r'\b', ' ', s)
    return [t for t in s.split() if t]


def core(name):
    return ''.join(tokens(name))


def jaccard(a, b):
    a, b = set(a), set(b)
    return len(a & b) / len(a | b) if (a | b) else 0.0


def family_version(name):
    """('ltx', '2.3') for an LTX 2.3 file, else (None, None)."""
    n = name.lower()
    for fam, rx in FAMILY:
        m = rx.search(n)
        if m:
            minor = m.group(2) if m.re.groups >= 2 else None
            return fam, m.group(1) + ('.' + minor if minor else '')
    return None, None


def build_clusters(files):
    """files: inventory units with kind == 'file'. -> [(kind, [units])]"""
    clusters, seen = [], set()

    by_copy = defaultdict(list)
    for u in files:
        by_copy[(u['name'].lower(), u['bytes'])].append(u)
    for v in by_copy.values():
        if len(v) > 1:
            clusters.append(('COPY', v))
            seen.update(x['relpath'] for x in v)

    by_core = defaultdict(list)
    for u in files:
        if u['relpath'] not in seen:
            c = core(u['name'])
            if c:
                by_core[c].append(u)
    for v in by_core.values():
        if len(v) > 1:
            clusters.append(('BUILD', v))
            seen.update(x['relpath'] for x in v)

    by_cat = defaultdict(list)
    for u in files:
        if u['relpath'] not in seen:
            by_cat[u['category']].append(u)
    for group in by_cat.values():
        group.sort(key=lambda x: -x['bytes'])
        used = set()
        for i, a in enumerate(group):
            if a['relpath'] in used or a['bytes'] < 256 * 2 ** 20:
                continue
            ta, pack = set(tokens(a['name'])), [a]
            for b in group[i + 1:]:
                if b['relpath'] in used:
                    continue
                if abs(a['bytes'] - b['bytes']) > 0.01 * a['bytes']:
                    continue
                tb = set(tokens(b['name']))
                diff = ta ^ tb
                if diff & ROLE or any(RELEASE.match(t) for t in diff):
                    continue
                if any(PARAMS.match(t) for t in diff):
                    continue          # 19b vs 22b -- a different model
                fa, va = family_version(a['name'])
                fb, vb = family_version(b['name'])
                if fa and fb and fa == fb and va != vb:
                    continue          # LTX 2.3 vs 2.5 -- a different generation
                if jaccard(ta, tb) < 0.5:
                    continue
                pack.append(b)
            if len(pack) > 1:
                used.update(x['relpath'] for x in pack)
                clusters.append(('LINEAGE', pack))
    return clusters


SAFETY = {
    'COPY': ('safe', 'byte-identical file -- the swap changes nothing but the path'),
    'BUILD': ('safe', 'same weights at a different precision -- output shifts '
                      'slightly in quality, the graph keeps working'),
    'LINEAGE': ('risky', 'DIFFERENT weights with the same job -- the workflow will '
                         'run, but the result changes. Test before you rely on it'),
}


def value_for(unit):
    """What a ComfyUI loader widget should contain for this file: the path
    relative to its type folder, not the models/ root."""
    rel = unit['relpath'].replace('\\', '/')
    parts = rel.split('/', 1)
    return parts[1] if len(parts) > 1 else rel


def suggest(unit, clusters_by_rel, units_by_rel):
    """Swap candidates for one model, smaller-is-better first."""
    got = clusters_by_rel.get(unit['relpath'])
    if not got:
        return []
    kind, members = got
    level, why = SAFETY[kind]
    out = []
    for m in members:
        if m['relpath'] == unit['relpath']:
            continue
        saves = unit['bytes'] - m['bytes']
        out.append({
            'name': m['name'],
            'relpath': 'models/' + m['relpath'],
            'value': value_for(m),
            'gb': round(m['bytes'] / 2 ** 30, 2),
            'saves_gb': round(saves / 2 ** 30, 2),
            'kind': kind,
            'safety': level,
            'why': why,
            'same_folder': m['category'] == unit['category'],
        })
    out.sort(key=lambda c: -c['saves_gb'])
    return out


def version_lock(model_names):
    """Given every model a workflow loads, group by family+generation.

    A family with one generation is coherent. This is what makes "just point it
    at the newer checkpoint" wrong: the upscaler, the distilled LoRA and the VAE
    are usually pinned to the same generation, and moving one alone leaves a
    mismatched graph.
    """
    fams = defaultdict(lambda: defaultdict(list))
    for n in model_names:
        fam, ver = family_version(n)
        if fam:
            fams[fam][ver].append(n)
    return {f: dict(v) for f, v in fams.items()}
