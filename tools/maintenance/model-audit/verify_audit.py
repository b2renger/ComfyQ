r"""Sanity-check model-audit.csv against the scan data and against disk.

Run it after build_csv.py, or any time before you prune.
Reads only; changes nothing.
"""
import json, io, os, csv, re, sys

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from comfyq_paths import models_root

# From ComfyQ's config rather than a hardcoded folder name on one disk image.
MODELS = models_root()

inv = json.load(io.open(os.path.join(HERE, 'inventory.json'), encoding='utf-8'))
rows = list(csv.DictReader(io.open(os.path.join(HERE, 'model-audit.csv'),
                                   encoding='utf-8-sig'), delimiter=';'))
fail = []


def check(cond, msg):
    print(('  OK   ' if cond else '  FAIL ') + msg)
    if not cond:
        fail.append(msg)


print('THE SHEET')
check(len(rows) == len(inv['units']),
      str(len(rows)) + ' rows == ' + str(len(inv['units'])) + ' models on disk')
check(inv['workflows_parsed'] > 0,
      str(inv['workflows_parsed']) + ' workflows cross-referenced')
check(not any('a_tester' in d for d in inv['workflow_dirs']),
      'no collection points at the retired Downloads staging folder')
check(all(os.path.splitdrive(d)[0].upper() == os.path.splitdrive(HERE)[0].upper()
          for d in inv['workflow_dirs']),
      'every collection scanned lives on this drive')

print('')
print('PATHS  (prune-models.ps1 joins relpath against <ComfyUI>\\)')
missing = [r['relpath'] for r in rows
           if not os.path.exists(os.path.join(os.path.dirname(MODELS),
                                              r['relpath'].replace('/', os.sep)))]
check(not missing, 'all ' + str(len(rows)) + ' paths resolve'
      + ('' if not missing else '  -> ' + '; '.join(missing[:3])))
check(all(r['relpath'].startswith('models/') for r in rows),
      'every relpath keeps the models/ prefix the pruner needs')

print('')
print('CONSISTENCY')
by_rel = {'models/' + u['relpath']: u for u in inv['units']}
bad = []
for r in rows:
    u = by_rel.get(r['relpath'])
    if u is None:
        bad.append(r['name'] + ': not in inventory')
        continue
    # a renamed file is LOADED without a matching wf_loads entry: the workflow
    # asks for its old name, and build_csv matched it by the file's metadata
    if (r['status'] == 'LOADED' and not u['wf_loads']
            and not r['used_by'].startswith('RENAMED:')):
        bad.append(r['name'] + ': LOADED but nothing loads it')
    if r['status'] == 'UNUSED' and (u['wf_loads'] or u['code_refs'] or u['wf_mentions']):
        bad.append(r['name'] + ': UNUSED but something claims it')
check(not bad, 'every status matches the scan'
      + ('' if not bad else '  -> ' + bad[0]))

tot_csv = sum(float(r['gb']) for r in rows)
tot_inv = sum(u['bytes'] for u in inv['units']) / 2 ** 30
check(abs(tot_csv - tot_inv) < 1.0,
      'sheet total ' + format(tot_csv, '.1f') + ' GB == disk '
      + format(tot_inv, '.1f') + ' GB')

print('')
print('YOUR DECISIONS')
acts = [r for r in rows if (r.get('ACTION') or '').strip()]
bad_act = [r['name'] for r in acts
           if r['ACTION'].strip().upper() not in ('DELETE', 'KEEP')]
check(not bad_act, str(len(acts)) + ' row(s) marked; only DELETE/KEEP used'
      + ('' if not bad_act else '  -> ' + bad_act[0]))

dele = [r for r in rows if (r.get('ACTION') or '').strip().upper() == 'DELETE']
print('       ' + str(len(dele)) + ' marked DELETE, '
      + format(sum(float(r['gb']) for r in dele), '.1f') + ' GB')

risky = [r for r in dele if r['status'] in ('LOADED', 'PICKABLE', 'AUTO-DOWNLOAD')]
if risky:
    print('  WARN ' + str(len(risky)) + ' of them are still in use '
          '(prune-models.ps1 refuses these without -AllowInUse):')
    for r in risky[:8]:
        print('         ' + r['status'].ljust(14) + r['name'])
elif dele:
    print('  OK   nothing marked DELETE is still in use')

nobak = [r for r in dele if r['backup'] != 'yes']
if nobak:
    print('  WARN ' + str(len(nobak)) + ' have no copy in the backup ('
          + format(sum(float(r['gb']) for r in nobak), '.1f')
          + ' GB would need re-downloading)')

print('')
print('JUNK THE SHEET CANNOT SEE')
# Partial downloads are not weight files, so no audit row ever covers them --
# they just sit there. Chrome leaves .crdownload, huggingface_hub leaves
# .incomplete under .cache. An abandoned one is pure reclaimable space.
import time
PARTIAL = ('.crdownload', '.incomplete', '.part', '.tmp', '.download')
junk, jb = [], 0
for root, _d, files in os.walk(MODELS):
    for f in files:
        if f.lower().endswith(PARTIAL):
            p = os.path.join(root, f)
            try:
                st_ = os.stat(p)
            except OSError:
                continue
            junk.append((st_.st_mtime, st_.st_size,
                         os.path.relpath(p, MODELS).replace(os.sep, '/')))
            jb += st_.st_size
if junk:
    junk.sort()
    age_d = (time.time() - junk[-1][0]) / 86400
    print('  ' + str(len(junk)) + ' unfinished download(s), '
          + format(jb / 2 ** 30, '.2f') + ' GB total')
    print('  newest is ' + format(age_d, '.0f') + ' days old'
          + ('  -- nothing is downloading now, so this is abandoned'
             if age_d > 1 else '  -- may still be in progress, leave it'))
    for mt, sz, rel in junk[-6:]:
        print('      ' + time.strftime('%Y-%m-%d', time.localtime(mt)) + '  '
              + format(sz / 2 ** 30, '6.2f') + ' GB  ' + rel[:74])
else:
    print('  OK   no partial downloads lying around')

print('')
print('WORKFLOW DEPENDENCIES')
missing = inv.get('missing_refs') or {}
renamed = [r for r in rows if r['used_by'].startswith('RENAMED:')]
if renamed:
    print('  ' + str(len(renamed)) + ' file(s) on disk answer a reference under a '
          'different name (matched by their own metadata):')
    for r in renamed:
        print('         ' + r['name'])
resolved = set()
for r in renamed:
    m = re.search(r'asks for "([^"]+)"', r['used_by'])
    if m:
        resolved.add(m.group(1).lower())
absent = {k: v for k, v in missing.items() if k.lower() not in resolved}
if absent:
    print('  ' + str(len(absent)) + ' model(s) a workflow loads are NOT on the drive '
          '-- those workflows cannot run as they stand:')
    for k in sorted(absent):
        who = ', '.join(w.partition(':')[2] or w for w in absent[k][:3])
        print('         ' + k)
        print('             needed by ' + who
              + ('' if len(absent[k]) <= 3 else ' +' + str(len(absent[k]) - 3) + ' more'))
else:
    print('  OK   every model a workflow loads is present')

print('')
print('=' * 60)
print('ALL CHECKS PASSED' if not fail else str(len(fail)) + ' FAILURES')
for f in fail:
    print('  - ' + f)
sys.exit(1 if fail else 0)
