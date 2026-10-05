r"""The model <-> workflow link graph, with the exact spot each name sits in.

`rescan.py` answers "is this model used at all". This answers "where exactly",
which is what you need to (a) show a workflow's bill of materials and (b) edit
a model name in place without touching anything else.

A "site" is one editable location: a file, a node, and the widget slot or input
key holding the filename. Notes and ComfyUI's properties.models download hints
are deliberately NOT sites -- rewriting those would change documentation, not
what runs.

A ComfyQ bundle counts as ONE workflow spanning up to three files
(<id>.api.json runs, <id>_template.json is what opens in the editor,
<id>.meta.json holds the exposed parameters). A swap has to hit all of them or
the bundle silently disagrees with itself.

Imported by build_csv.py; can also be run directly to dump links.json.
"""
import json, io, os, re, sys
from collections import defaultdict

BS = chr(92)
WEIGHT_EXT = {'.safetensors', '.ckpt', '.pt', '.pth', '.bin', '.gguf', '.onnx',
              '.sft'}
NOTE_TYPES = {'Note', 'MarkdownNote', 'Note Plus (mtb)'}
LOADER_KEYS = ('widgets_values', 'widgets_values_named', 'inputs')


def collections(here):
    """The workflow folders to scan, from ComfyQ's config.

    This used to name 'ComfyUI_windows_portable_nvidia' outright, which is
    the folder name on one particular disk image.
    """
    import sys as _sys, os as _os
    _sys.path.insert(0, _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
    from comfyq_paths import comfy_root, labelled_workflow_dirs
    return labelled_workflow_dirs(), comfy_root(required=False)


def is_model_name(text):
    if not isinstance(text, str) or not text or len(text) > 400:
        return False
    return os.path.splitext(text.strip())[1].lower() in WEIGHT_EXT


def basename(text):
    return os.path.basename(text.replace(BS, '/').strip()).lower()


def _node_id(node, fallback):
    for k in ('id', 'ID'):
        if k in node:
            return str(node[k])
    return str(fallback)


def _node_type(node):
    return node.get('type') or node.get('class_type') or '?'


def sites_in_node(node, nid, relfile):
    """Every editable model-name slot on one node."""
    out = []
    if not isinstance(node, dict) or _node_type(node) in NOTE_TYPES:
        return out
    ntype = _node_type(node)
    title = (node.get('title')
             or (node.get('_meta') or {}).get('title') or '')
    for key in LOADER_KEYS:
        val = node.get(key)
        if isinstance(val, list):
            for i, v in enumerate(val):
                if is_model_name(v):
                    out.append({'file': relfile, 'node': nid, 'node_type': ntype,
                                'node_title': title, 'where': key, 'slot': i,
                                'value': v})
        elif isinstance(val, dict):
            for k, v in val.items():
                if is_model_name(v):
                    out.append({'file': relfile, 'node': nid, 'node_type': ntype,
                                'node_title': title, 'where': key, 'slot': k,
                                'value': v})
    return out


def walk_nodes(obj, relfile, out, seen_ids=None, path='root'):
    """Find nodes at any depth, including inside subgraph definitions."""
    if seen_ids is None:
        seen_ids = [0]
    if isinstance(obj, dict):
        if 'widgets_values' in obj or ('class_type' in obj and 'inputs' in obj):
            seen_ids[0] += 1
            out.extend(sites_in_node(obj, _node_id(obj, seen_ids[0]), relfile))
        for k, v in obj.items():
            if k == 'nodes' and isinstance(v, list):
                for n in v:
                    if isinstance(n, dict):
                        seen_ids[0] += 1
                        out.extend(sites_in_node(n, _node_id(n, seen_ids[0]), relfile))
                        walk_nodes(n, relfile, out, seen_ids, path + '/nodes')
            else:
                walk_nodes(v, relfile, out, seen_ids, path + '/' + str(k))
    elif isinstance(obj, list):
        for v in obj:
            walk_nodes(v, relfile, out, seen_ids, path)


def scan_file(path, relfile):
    try:
        doc = json.load(io.open(path, encoding='utf-8'))
    except Exception:
        return []
    out = []
    # API format: a flat {id: {class_type, inputs}} map with no "nodes" array
    if isinstance(doc, dict) and not doc.get('nodes'):
        for nid, v in doc.items():
            if isinstance(v, dict) and 'class_type' in v:
                out.extend(sites_in_node(v, str(nid), relfile))
    walk_nodes(doc, relfile, out)
    # de-duplicate: the flat pass and the walk can both reach a node
    seen, uniq = set(), []
    for s in out:
        k = (s['file'], s['node'], s['where'], str(s['slot']), s['value'])
        if k not in seen:
            seen.add(k)
            uniq.append(s)
    return uniq


def bundle_key(collection, relpath):
    """One workflow, however many files it is stored in."""
    rel = relpath.replace(BS, '/')
    if collection == 'comfyq' and '/' in rel:
        folder = rel.split('/')[0]
        if folder == '_candidate_workflows':
            return 'candidate', rel.split('/', 1)[1]
        return 'comfyq', folder
    if collection == 'comfyq':
        return 'comfyq', rel
    return collection, rel


def build(here, models_root, unit_by_name=None):
    """-> {"workflows": [...], "by_model": {basename: [workflow ids]}}"""
    dirs, _comfy = collections(here)
    unit_by_name = unit_by_name or {}

    groups = defaultdict(lambda: {'files': [], 'sites': []})
    for base, collection in dirs:
        if not os.path.isdir(base):
            continue
        for root, _d, files in os.walk(base):
            for f in files:
                if not f.lower().endswith('.json'):
                    continue
                p = os.path.join(root, f)
                rel = os.path.relpath(p, base).replace(BS, '/')
                coll, name = bundle_key(collection, rel)
                wid = coll + ':' + name
                g = groups[wid]
                g['collection'] = coll
                g['dir'] = base
                g['files'].append(rel)
                g['sites'].extend(scan_file(p, rel))

    workflows = []
    by_model = defaultdict(set)
    for wid, g in sorted(groups.items()):
        models = defaultdict(lambda: {'sites': []})
        for s in g['sites']:
            bn = basename(s['value'])
            models[bn]['sites'].append(s)
        entries = []
        for bn, m in sorted(models.items()):
            unit = unit_by_name.get(bn)
            entries.append({
                'name': bn,
                'present': unit is not None,
                'relpath': ('models/' + unit['relpath']) if unit else '',
                'gb': round(unit['bytes'] / 2 ** 30, 2) if unit else 0.0,
                'category': unit['category'] if unit else '',
                'sites': m['sites'],
            })
            by_model[bn].add(wid)
        if not entries:
            continue
        workflows.append({
            'id': wid,
            'collection': g['collection'],
            'name': wid.split(':', 1)[1],
            'dir': g['dir'],
            'files': sorted(set(g['files'])),
            'models': entries,
            'gb': round(sum(e['gb'] for e in entries), 2),
            'missing': sorted(e['name'] for e in entries if not e['present']),
        })
    return {'workflows': workflows,
            'by_model': {k: sorted(v) for k, v in by_model.items()}}


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    HERE = os.path.dirname(os.path.abspath(__file__))
    inv = json.load(io.open(os.path.join(HERE, 'inventory.json'), encoding='utf-8'))
    units = {u['name'].lower(): u for u in inv['units']}
    data = build(HERE, inv['models_root'], units)
    io.open(os.path.join(HERE, 'links.json'), 'w', encoding='utf-8').write(
        json.dumps(data, indent=1))
    nsites = sum(len(m['sites']) for w in data['workflows'] for m in w['models'])
    print(str(len(data['workflows'])) + ' workflows, '
          + str(len(data['by_model'])) + ' distinct models, '
          + str(nsites) + ' editable sites')
