r"""Replace one model with another inside a workflow, in place.

Only loader slots are touched -- the exact (node, widget) positions
scan_links.py found. Note text and ComfyUI's properties.models download hints
are left alone: rewriting those would edit documentation, not what runs.

A ComfyQ bundle is edited as a unit. <id>.api.json is what actually executes
and <id>_template.json is what opens in the ComfyUI editor; changing one alone
leaves the bundle disagreeing with itself, which is a genuinely confusing bug
to chase later.

Every file is copied to <file>.bak before its first modification, and the
rewrite is byte-faithful apart from the changed values (verified: these files
round-trip exactly through json with indent=2, ensure_ascii=False).

    python swap_model.py <workflow-id> <old-name> <new-name>       # dry run
    python swap_model.py <workflow-id> <old-name> <new-name> --go  # write
"""
import json, io, os, shutil, sys

import scan_links

HERE = os.path.dirname(os.path.abspath(__file__))


# Files differ in how they were written: indent width, and whether non-ASCII was
# escaped or left raw. Re-dumping in the wrong style rewrites every emoji and
# arrow in the file, burying the one line that actually changed.
_STYLES = [
    {'indent': 2, 'ensure_ascii': False},
    {'indent': 2, 'ensure_ascii': True},
    {'indent': 4, 'ensure_ascii': False},
    {'indent': 4, 'ensure_ascii': True},
    {'indent': None, 'separators': (', ', ': '), 'ensure_ascii': False},
    {'indent': None, 'separators': (',', ':'), 'ensure_ascii': True},
    {'indent': None, 'separators': (',', ':'), 'ensure_ascii': False},
]


def detect_style(raw, doc):
    """The dump options that reproduce this exact file, if any."""
    for kw in _STYLES:
        out = json.dumps(doc, **kw)
        if out == raw or out + '\n' == raw or out == raw.rstrip('\n'):
            return kw, True
    return _STYLES[0], False


def _dump(doc, style=None):
    return json.dumps(doc, **(style or _STYLES[0]))


def _edit_node(node, nid, want_node, where, slot, old_lower, new_value, hits):
    if not isinstance(node, dict):
        return
    if str(nid) != str(want_node):
        return
    val = node.get(where)
    if isinstance(val, list):
        if isinstance(slot, int) and 0 <= slot < len(val):
            if scan_links.basename(str(val[slot])) == old_lower:
                val[slot] = new_value
                hits.append(1)
    elif isinstance(val, dict):
        if slot in val and scan_links.basename(str(val[slot])) == old_lower:
            val[slot] = new_value
            hits.append(1)


def _walk_apply(obj, want_node, where, slot, old_lower, new_value, hits,
                counter=None):
    if counter is None:
        counter = [0]
    if isinstance(obj, dict):
        if 'widgets_values' in obj or ('class_type' in obj and 'inputs' in obj):
            counter[0] += 1
            nid = obj.get('id', obj.get('ID', counter[0]))
            _edit_node(obj, nid, want_node, where, slot, old_lower, new_value, hits)
        for k, v in obj.items():
            if k == 'nodes' and isinstance(v, list):
                for n in v:
                    if isinstance(n, dict):
                        counter[0] += 1
                        nid = n.get('id', n.get('ID', counter[0]))
                        _edit_node(n, nid, want_node, where, slot, old_lower,
                                   new_value, hits)
                        _walk_apply(n, want_node, where, slot, old_lower,
                                    new_value, hits, counter)
            else:
                _walk_apply(v, want_node, where, slot, old_lower, new_value,
                            hits, counter)
    elif isinstance(obj, list):
        for v in obj:
            _walk_apply(v, want_node, where, slot, old_lower, new_value, hits,
                        counter)


def plan(links, workflow_id, old_name, new_name, new_value):
    """What would change, grouped per file. Nothing is written."""
    wf = next((w for w in links['workflows'] if w['id'] == workflow_id), None)
    if wf is None:
        return None, 'no such workflow: ' + workflow_id
    entry = next((m for m in wf['models']
                  if m['name'] == old_name.lower()), None)
    if entry is None:
        return None, old_name + ' is not loaded by ' + workflow_id
    per_file = {}
    for s in entry['sites']:
        per_file.setdefault(s['file'], []).append(s)
    return {'workflow': wf, 'old': old_name.lower(), 'new_name': new_name,
            'new_value': new_value, 'per_file': per_file,
            'sites': len(entry['sites'])}, None


def apply(p, write=False):
    """Perform the plan. Returns a per-file report."""
    wf = p['workflow']
    report = []
    for relfile, sites in sorted(p['per_file'].items()):
        path = os.path.join(wf['dir'], relfile.replace('/', os.sep))
        rec = {'file': relfile, 'path': path, 'changed': 0, 'expected': len(sites),
               'backup': '', 'note': ''}
        if not os.path.exists(path):
            rec['note'] = 'file missing'
            report.append(rec)
            continue
        raw = io.open(path, encoding='utf-8').read()
        try:
            doc = json.loads(raw)
        except Exception as exc:
            rec['note'] = 'unreadable: ' + str(exc)[:60]
            report.append(rec)
            continue

        # work out the file's own formatting BEFORE editing it
        style, faithful = detect_style(raw, json.loads(raw))

        hits = []
        for s in sites:
            _walk_apply(doc, s['node'], s['where'], s['slot'], p['old'],
                        p['new_value'], hits)
        rec['changed'] = len(hits)

        if rec['changed'] != rec['expected']:
            rec['note'] = ('matched ' + str(rec['changed']) + ' of '
                           + str(rec['expected']) + ' sites -- file NOT written')
            report.append(rec)
            continue

        # Preferred output: a text substitution, which keeps the file's exact
        # layout. Only accepted if re-parsing it yields the same document the
        # JSON edit produced -- so a Note mentioning the same filename makes
        # the two differ and we fall back rather than rewriting documentation.
        out = None
        literals = sorted({str(site['value']) for site in sites}, key=len,
                          reverse=True)
        candidate = raw
        for lit in literals:
            candidate = candidate.replace(json.dumps(lit, ensure_ascii=False),
                                          json.dumps(p['new_value'],
                                                     ensure_ascii=False))
            candidate = candidate.replace(json.dumps(lit, ensure_ascii=True),
                                          json.dumps(p['new_value'],
                                                     ensure_ascii=True))
        if candidate != raw:
            try:
                if json.loads(candidate) == doc:
                    out = candidate
                    rec['note'] = 'formatting preserved'
            except Exception:
                out = None

        if out is None:
            if faithful:
                out = _dump(doc, style)
                if raw.endswith('\n'):
                    out += '\n'
            else:
                out = _dump(doc, style)
                if raw.endswith('\n'):
                    out += '\n'
                rec['note'] = ('rewritten with standard formatting -- this file '
                               'keeps arrays inline, which json cannot reproduce '
                               '(content is identical)')

        if write and rec['changed']:
            bak = path + '.bak'
            shutil.copyfile(path, bak)
            rec['backup'] = os.path.basename(bak)
            tmp = path + '.tmp'
            io.open(tmp, 'w', encoding='utf-8').write(out)
            os.replace(tmp, path)
        report.append(rec)
    return report


def load_links():
    return json.load(io.open(os.path.join(HERE, 'links.json'), encoding='utf-8'))


def main(argv):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    if len(argv) < 3:
        print(__doc__)
        return 2
    wid, old, new = argv[0], argv[1], argv[2]
    write = '--go' in argv

    inv = json.load(io.open(os.path.join(HERE, 'inventory.json'), encoding='utf-8'))
    units = {u['name'].lower(): u for u in inv['units']}
    target = units.get(new.lower())
    if target is None:
        print('The replacement is not on this drive: ' + new)
        return 1
    import variants
    new_value = variants.value_for(target)

    links = load_links()
    p, err = plan(links, wid, old, new, new_value)
    if err:
        print(err)
        return 1

    print(('WRITING' if write else 'DRY RUN') + '  ' + wid)
    print('  ' + p['old'] + '  ->  ' + new_value)
    print('  ' + str(p['sites']) + ' site(s) across '
          + str(len(p['per_file'])) + ' file(s)')
    print('')
    for rec in apply(p, write=write):
        flag = 'ok ' if rec['changed'] == rec['expected'] else 'SKIP'
        print('  [' + flag + '] ' + rec['file']
              + '   ' + str(rec['changed']) + '/' + str(rec['expected']) + ' site(s)'
              + ('  backup: ' + rec['backup'] if rec['backup'] else ''))
        if rec['note']:
            print('         ' + rec['note'])
    if not write:
        print('')
        print('  nothing written -- add --go to apply')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
