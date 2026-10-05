r"""Build model-audit.csv -- the ONE file that decides what gets deleted.

    rescan.py        ->  inventory.json   what is on disk + who loads it
    rescan_nodes.py  ->  nodes.json       custom-node packs
    decisions.json                        the audit's verdict + reasoning
    build_csv.py     ->  model-audit.csv  <- you edit the ACTION column
    audit_ui.py                           a small editor for that file
    prune-models.ps1                      acts on it

Everything a decision needs is a column: what loads the model, whether another
build of the same model is already on disk, whether a copy exists in the
backup, and what it would take to get it back.

Deletes nothing.
"""
import json, io, os, re, csv, struct, sys
from collections import defaultdict

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

HERE = os.path.dirname(os.path.abspath(__file__))
import sys as _sys, os as _os
_sys.path.insert(0, _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
from comfyq_paths import comfy_root, labelled_workflow_dirs, repo_root
# ComfyQ's bundle folder, found by walking up to the repo root rather than
# by assuming it sits at <drive>\ComfyQ.
COMFYQ_WF = os.path.join(repo_root() or os.path.join(HERE, '..', '..', '..'), 'workflows')
OUT = os.path.join(HERE, 'model-audit.csv')




def previous_actions():
    """What the sheet already says, keyed by relpath, so a rebuild does not
    silently discard decisions that are already made."""
    if not os.path.exists(OUT):
        return {}
    try:
        with io.open(OUT, encoding='utf-8-sig', newline='') as fh:
            prev = {}
            for r in csv.DictReader(fh, delimiter=';'):
                act = (r.get('ACTION') or '').strip().upper()
                if act in ('DELETE', 'KEEP'):
                    prev[r['relpath']] = (act, r.get('status', ''))
            return prev
    except Exception:
        return {}


PREV = previous_actions()

inv = json.load(io.open(os.path.join(HERE, 'inventory.json'), encoding='utf-8'))
dec = json.load(io.open(os.path.join(HERE, 'decisions.json'), encoding='utf-8'))
DEC = {d['relpath']: d for d in dec['models']}
UNITS = inv['units']
FILES = [u for u in UNITS if u['kind'] == 'file']

# The audit prose predates the staging-folder move (2026-09-11), so a stored
# reason can still name the retired Downloads\workflows_a_tester collection.
STALE_LABEL = 'a_tester'


# ---------------------------------------------------------------------------
# Models a student can pick at run time from a ComfyQ dropdown. These appear in
# NO workflow -- ComfyQ lists the options from disk when the booking form opens
# -- so every file matching the filter is live. Deleting one breaks the menu.
# ---------------------------------------------------------------------------
def picker_rules():
    rules = []
    if not os.path.isdir(COMFYQ_WF):
        return rules
    for root, _d, files in os.walk(COMFYQ_WF):
        for f in files:
            if not f.endswith('.meta.json'):
                continue
            try:
                m = json.load(io.open(os.path.join(root, f), encoding='utf-8'))
            except Exception:
                continue
            for p in m.get('exposedParameters', []):
                if p.get('type') == 'lora' and p.get('optionsFilter'):
                    rules.append({'bundle': os.path.basename(root),
                                  'dir': (p.get('optionsDir') or 'loras').lower(),
                                  'prefix': p['optionsFilter'].lower()})
    return rules


RULES = picker_rules()


# ---------------------------------------------------------------------------
# Models renamed after download.
#
# A .safetensors header carries __metadata__, and trainers stamp the original
# output name in it. That survives a rename of the file, so a workflow asking
# for a name nobody has can still be matched to the file that IS it.
# ---------------------------------------------------------------------------
MISSING = {k.lower(): v for k, v in (inv.get('missing_refs') or {}).items()}


def _stem(s):
    return re.sub(r'\.(safetensors|ckpt|pt|pth|bin|gguf|onnx|sft)$', '',
                  os.path.basename(s.replace('\\', '/')).lower())


def _trained_names(relpath):
    """Names this file claims for itself, from its own header."""
    path = os.path.join(inv['models_root'], relpath.replace('/', os.sep))
    if not path.lower().endswith('.safetensors'):
        return []
    try:
        with io.open(path, 'rb') as fh:
            n = struct.unpack('<Q', fh.read(8))[0]
            if n > 50_000_000:
                return []
            meta = (json.loads(fh.read(n).decode('utf-8', 'replace'))
                    .get('__metadata__') or {})
    except Exception:
        return []
    out = []
    for key in ('ss_output_name', 'modelspec.title', 'name'):
        v = meta.get(key)
        if isinstance(v, str) and v.strip():
            out.append(_stem(v))
    return out


RENAMED = {}          # relpath -> (asked-for name, [workflows])
if MISSING:
    wanted = {_stem(k): k for k in MISSING}
    for u in FILES:
        if u['wf_loads'] or u['code_refs']:
            continue      # already accounted for; no need to open it
        for tn in _trained_names(u['relpath']):
            if tn in wanted:
                asked = wanted[tn]
                RENAMED[u['relpath']] = (asked, MISSING[asked])
                break


def picked_by(u):
    rel, name = u['relpath'].lower(), u['name'].lower()
    return sorted({r['bundle'] for r in RULES
                   if rel.split('/')[0] == r['dir'] and name.startswith(r['prefix'])})


# ---------------------------------------------------------------------------
# Variant detection lives in variants.py, shared with audit_ui.py so the sheet
# and the swap suggestions can never disagree about what is interchangeable.
#   COPY     byte-identical file in two folders
#   BUILD    same weights, different precision -- a safe swap
#   LINEAGE  same role and size, different weights -- NOT a drop-in
# Role tokens, parameter counts and model generations are all disqualifying:
# Wan 2.2 loads high_noise AND low_noise, and LTX 2.3 is not LTX 2.5.
# ---------------------------------------------------------------------------
import variants

build_clusters = variants.build_clusters

CLUSTERS = build_clusters(FILES)
CLUSTER_OF = {}
for kind, members in CLUSTERS:
    for u in members:
        CLUSTER_OF[u['relpath']] = (kind, members)


# ---------------------------------------------------------------------------
def bundle_of(org, wf):
    """One ComfyQ bundle is one workflow even though it lives in three files
    (<id>.api.json, <id>_template.json, <id>.meta.json)."""
    if org == 'comfyq' and '/' in wf:
        return wf.split('/')[0]
    if org == 'candidate':
        return wf.replace('_candidate_workflows/', '')
    return wf


def loaders(u):
    out = defaultdict(set)
    for r in u['wf_loads']:
        org, _, wf = r.partition(':')
        out[org].add(bundle_of(org, wf))
    return out


def used_by_text(u):
    """Readable, complete: exactly which workflows load this model."""
    parts = []
    for org in ('comfyq', 'candidate', 'comfyui_staged', 'demo'):
        got = loaders(u).get(org)
        if got:
            parts.append(org + ': ' + ', '.join(sorted(got)))
    for b in picked_by(u):
        parts.append('student dropdown in ' + b)
    if u['code_refs']:
        parts.append('auto-downloaded by ' + ', '.join(u['code_refs'][:4])
                     + ('' if len(u['code_refs']) <= 4 else ' +more'))
    got = RENAMED.get(u['relpath'])
    if got:
        asked, wfs = got
        parts.append('RENAMED: ' + ', '.join(w.partition(':')[2] or w for w in wfs)
                     + ' still asks for "' + asked + '" -- this file is that model '
                     '(its own metadata says so), just renamed on disk')
    if not parts and u['wf_mentions']:
        parts.append('only mentioned (note text / download hint) in '
                     + ', '.join(m.partition(':')[2] for m in u['wf_mentions'][:3]))
    return ' | '.join(parts)


def n_loaders(u):
    return sum(len(v) for v in loaders(u).values())


def status_of(u):
    if u['wf_loads'] or u['relpath'] in RENAMED:
        return 'LOADED'
    if picked_by(u):
        return 'PICKABLE'
    if u['code_refs']:
        return 'AUTO-DOWNLOAD'
    if u['wf_mentions']:
        return 'MENTIONED'
    return 'UNUSED'


CLUSTER_NOTE = {
    'COPY': 'identical copy of',
    'BUILD': 'same model, other build on disk:',
    'LINEAGE': 'different weights, same job:',
}


def duplicate_text(u):
    got = CLUSTER_OF.get(u['relpath'])
    if not got:
        return '', ''
    kind, members = got
    others = [m for m in members if m['relpath'] != u['relpath']]
    detail = ', '.join(m['name'] + ' (' + format(m['bytes'] / 2 ** 30, '.2f')
                       + ' GB, ' + str(n_loaders(m)) + ' wf)' for m in others)
    return kind, CLUSTER_NOTE[kind] + ' ' + detail


def clean(txt, n=400):
    t = ' '.join((txt or '').split()).replace(STALE_LABEL, 'candidate')
    return t if len(t) <= n else t[:n - 1] + '…'


rows = []
STALE = []          # marked DELETE, but the model is no longer in that state
for u in sorted(UNITS, key=lambda x: -x['bytes']):
    d = DEC.get(u['relpath'], {})
    st = status_of(u)
    kind, dup = duplicate_text(u)
    verdict = d.get('final') or d.get('classify') or ''
    note = ''

    # The scan is ground truth about usage; the verdict is judgement about value.
    if st in ('LOADED', 'PICKABLE') and verdict == 'DELETE':
        verdict, note = 'REVIEW', ('RE-OPENED by the rescan: this is in use, '
                                   'the old DELETE verdict was wrong')
    elif st == 'MENTIONED' and verdict not in ('DELETE', ''):
        note = ('named only in note text / download metadata -- nothing '
                'actually loads it')
    elif st == 'PICKABLE':
        note = 'never named in a workflow, but a student can select it'
    if u['relpath'] in RENAMED and not u['wf_loads']:
        asked = RENAMED[u['relpath']][0]
        verdict = 'KEEP'
        note = ('the workflow that needs this still points at the old name "'
                + asked + '" -- either rename the file back or fix the workflow')

    # carry the decision forward, unless the model's situation changed under it
    prev_act, prev_status = PREV.get('models/' + u['relpath'], ('', ''))
    if prev_act == 'DELETE' and prev_status and prev_status != st and st != 'UNUSED':
        STALE.append((u['name'], prev_status, st))
        prev_act = ''

    rows.append({
        'ACTION': prev_act,
        'gb': round(u['bytes'] / 2 ** 30, 2),
        'name': u['name'],
        'status': st,
        'verdict': verdict or ('KEEP' if st in ('LOADED', 'PICKABLE') else 'REVIEW'),
        'used_by': used_by_text(u),
        'workflows': n_loaders(u),
        'category': u['category'],
        'duplicate': kind,
        'duplicate_detail': dup,
        'backup': 'yes' if d.get('backup') else 'no',
        'risk': d.get('risk', ''),
        'note': note,
        'reason': clean(d.get('reason', '')),
        'redownload': clean(d.get('redownload', ''), 160),
        # prune-models.ps1 joins this against <ComfyUI>\ -- keep the prefix
        'relpath': 'models/' + u['relpath'],
    })

with io.open(OUT, 'w', encoding='utf-8-sig', newline='') as fh:
    w = csv.DictWriter(fh, fieldnames=list(rows[0].keys()), delimiter=';')
    w.writeheader()
    w.writerows(rows)

kept = len([r for r in rows if r['ACTION']])
if PREV:
    gone = [k for k in PREV if k not in {r['relpath'] for r in rows}]
    print('  carried over ' + str(kept) + ' of ' + str(len(PREV))
          + ' existing decision(s)')
    if gone:
        print('  ' + str(len(gone)) + ' marked row(s) are no longer on disk '
              '(already deleted?)')
if STALE:
    print('')
    print('  ' + str(len(STALE)) + ' DELETE mark(s) CLEARED -- the model is in use now:')
    for name, was, now in STALE:
        print('      ' + name + '   was ' + was + ', now ' + now)

agg = defaultdict(lambda: [0, 0.0])
for r in rows:
    agg[r['status']][0] += 1
    agg[r['status']][1] += r['gb']
print('model-audit.csv   ' + str(len(rows)) + ' models, '
      + format(sum(r['gb'] for r in rows), '.1f') + ' GB')
print('')
for k, (n, g) in sorted(agg.items(), key=lambda kv: -kv[1][1]):
    print('  ' + k.ljust(15) + str(n).rjust(4) + ' units ' + format(g, '9.1f') + ' GB')
print('')
if RENAMED:
    print('')
    print('  ' + str(len(RENAMED)) + ' model(s) matched a MISSING workflow reference '
          'by their own metadata:')
    for rel, (asked, wfs) in sorted(RENAMED.items()):
        print('      ' + os.path.basename(rel) + '  <- asked for as "' + asked + '"')
        print('        by ' + ', '.join(wfs))
unresolved = {k: v for k, v in MISSING.items()
              if not any(a == k for a, _w in RENAMED.values())}
if unresolved:
    print('')
    print('  ' + str(len(unresolved)) + ' workflow dependency(ies) genuinely absent:')
    for k in sorted(unresolved):
        print('      ' + k)
print('')
for kind in ('COPY', 'BUILD', 'LINEAGE'):
    sel = [c for c in CLUSTERS if c[0] == kind]
    save = sum(sum(m['bytes'] for m in ms) - min(m['bytes'] for m in ms)
               for _k, ms in sel) / 2 ** 30
    print('  ' + kind.ljust(9) + str(len(sel)).rjust(3) + ' clusters, up to '
          + format(save, '7.1f') + ' GB if each collapses to one file')
