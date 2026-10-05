r"""A small local editor for model-audit.csv, with three views.

    Models      every model, what needs it, mark DELETE/KEEP
    Workflows   every workflow, its bill of materials, swap a model in place
    Leaderboard which models earn their disk space, by usage

Run it (or double-click AUDIT.bat), decide, press Save. It writes the same
model-audit.csv that prune-models.ps1 reads -- there is no second copy of the
truth anywhere. A swap edits the workflow file directly, keeping a .bak.

    python audit_ui.py            opens http://127.0.0.1:8765

Stdlib only, binds to localhost.
"""
import csv, io, json, os, shutil, sys, threading, webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import scan_links
import swap_model
import variants

HERE = os.path.dirname(os.path.abspath(__file__))
CSV_PATH = os.path.join(HERE, 'model-audit.csv')
INV_PATH = os.path.join(HERE, 'inventory.json')
PORT = 8765

# prune-models.ps1 reads this file, so the shape must not drift.
DELIM = ';'
ENCODING = 'utf-8-sig'

_lock = threading.Lock()
_cache = {}


def load_rows():
    with io.open(CSV_PATH, encoding=ENCODING, newline='') as fh:
        rd = csv.DictReader(fh, delimiter=DELIM)
        return list(rd), rd.fieldnames


def save_actions(actions):
    """Write ACTION back. Every other column is passed through untouched."""
    rows, fields = load_rows()
    changed = 0
    for r in rows:
        want = (actions.get(r['relpath']) or '').strip().upper()
        if want not in ('', 'DELETE', 'KEEP'):
            want = ''
        if (r.get('ACTION') or '').strip().upper() != want:
            changed += 1
        r['ACTION'] = want
    shutil.copyfile(CSV_PATH, CSV_PATH + '.bak')
    tmp = CSV_PATH + '.tmp'
    with io.open(tmp, 'w', encoding=ENCODING, newline='') as fh:
        w = csv.DictWriter(fh, fieldnames=fields, delimiter=DELIM)
        w.writeheader()
        w.writerows(rows)
    os.replace(tmp, CSV_PATH)
    return changed, len(rows)


def build_links(force=False):
    """The workflow view: bill of materials, swap candidates, version locks."""
    with _lock:
        if not force and 'links' in _cache:
            return _cache['links']
        inv = json.load(io.open(INV_PATH, encoding='utf-8'))
        units = {u['name'].lower(): u for u in inv['units']}
        files = [u for u in inv['units'] if u['kind'] == 'file']
        clusters = variants.build_clusters(files)
        by_rel = {}
        for kind, members in clusters:
            for m in members:
                by_rel[m['relpath']] = (kind, members)

        data = scan_links.build(HERE, inv['models_root'], units)

        rows, _f = load_rows()
        status_of = {r['relpath']: r['status'] for r in rows}

        for w in data['workflows']:
            for m in w['models']:
                unit = units.get(m['name'])
                m['status'] = status_of.get(m['relpath'], '')
                m['alts'] = (variants.suggest(unit, by_rel, units)
                             if unit is not None else [])
            w['locks'] = variants.version_lock([m['name'] for m in w['models']])

        # leaderboard: what each model earns its space with
        board = []
        for name, wids in data['by_model'].items():
            unit = units.get(name)
            sites = sum(len(m['sites']) for w in data['workflows']
                        for m in w['models'] if m['name'] == name)
            colls = sorted({wid.split(':')[0] for wid in wids})
            board.append({
                'name': name,
                'present': unit is not None,
                'relpath': ('models/' + unit['relpath']) if unit else '',
                'gb': round(unit['bytes'] / 2 ** 30, 2) if unit else 0.0,
                'category': unit['category'] if unit else '',
                'workflows': len(wids),
                'sites': sites,
                'collections': colls,
                'production': 1 if 'comfyq' in colls else 0,
                'used_by': sorted(wids),
                'status': status_of.get(('models/' + unit['relpath'])
                                        if unit else '', ''),
            })
        # models on disk that no workflow mentions at all
        named = set(data['by_model'])
        for u in files:
            if u['name'].lower() in named:
                continue
            rel = 'models/' + u['relpath']
            board.append({
                'name': u['name'].lower(), 'present': True, 'relpath': rel,
                'gb': round(u['bytes'] / 2 ** 30, 2), 'category': u['category'],
                'workflows': 0, 'sites': 0, 'collections': [], 'production': 0,
                'used_by': [], 'status': status_of.get(rel, ''),
            })
        board.sort(key=lambda b: (-b['workflows'], -b['gb']))
        data['leaderboard'] = board
        _cache['links'] = data
        return data


def do_swap(payload):
    inv = json.load(io.open(INV_PATH, encoding='utf-8'))
    units = {u['name'].lower(): u for u in inv['units']}
    target = units.get((payload.get('new') or '').lower())
    if target is None:
        return {'ok': False, 'error': 'replacement not on this drive'}
    links = build_links()
    p, err = swap_model.plan(links, payload['workflow'], payload['old'],
                             payload['new'], variants.value_for(target))
    if err:
        return {'ok': False, 'error': err}
    report = swap_model.apply(p, write=bool(payload.get('write')))
    if payload.get('write'):
        build_links(force=True)     # the graph just changed
    return {'ok': True, 'report': report,
            'wrote': bool(payload.get('write')),
            'value': variants.value_for(target)}


PAGE = r"""<!doctype html>
<meta charset="utf-8"><title>Model audit</title>
<style>
:root{--bg:#fff;--fg:#18181b;--mut:#71717a;--line:#e4e4e7;--surf:#fafafa;
--del:#dc2626;--keep:#16a34a;--warn:#b45309;--accent:#2563eb}
@media(prefers-color-scheme:dark){:root{--bg:#18181b;--fg:#e4e4e7;--mut:#a1a1aa;
--line:#3f3f46;--surf:#27272a;--del:#f87171;--keep:#4ade80;--warn:#fbbf24;--accent:#60a5fa}}
*{box-sizing:border-box}
body{margin:0;font:13px/1.45 ui-sans-serif,system-ui,Segoe UI,sans-serif;
background:var(--bg);color:var(--fg)}
header{position:sticky;top:0;z-index:5;background:var(--bg);
border-bottom:1px solid var(--line);padding:8px 14px}
.tabs{display:flex;gap:4px;margin-bottom:8px}
.tabs button{padding:5px 14px;border:1px solid var(--line);border-radius:6px;
background:var(--surf);color:var(--mut);font:inherit;font-weight:600;cursor:pointer}
.tabs button.on{background:var(--accent);color:#fff;border-color:var(--accent)}
.bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
input[type=search]{flex:1;min-width:180px;padding:6px 9px;border:1px solid var(--line);
border-radius:6px;background:var(--surf);color:var(--fg);font:inherit}
select,button{padding:6px 9px;border:1px solid var(--line);border-radius:6px;
background:var(--surf);color:var(--fg);font:inherit;cursor:pointer}
button:hover{border-color:var(--accent)}
button.primary{background:var(--accent);color:#fff;border-color:var(--accent);font-weight:600}
button.danger{color:var(--del);border-color:var(--del)}
.tot{margin-left:auto;display:flex;gap:12px;align-items:center;white-space:nowrap}
.tot b{font-size:15px}
table{border-collapse:collapse;width:100%}
th,td{padding:5px 8px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
th{position:sticky;top:0;background:var(--surf);cursor:pointer;user-select:none;
font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--mut);z-index:2}
th.num,td.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
tr.del{background:color-mix(in srgb,var(--del) 11%,transparent)}
tr.keep{background:color-mix(in srgb,var(--keep) 9%,transparent)}
td.nm{font-family:ui-monospace,Consolas,monospace;font-size:12px;word-break:break-all;max-width:330px}
.used{color:var(--mut);font-size:11.5px;max-width:380px}
.st{font-size:10.5px;font-weight:600}
.LOADED,.PICKABLE{color:var(--keep)}.AUTO-DOWNLOAD{color:var(--warn)}
.MENTIONED,.UNUSED{color:var(--mut)}
.act{display:flex;gap:3px}
.act button{padding:2px 7px;font-size:11px;line-height:1.5}
.act button.on[data-v=DELETE]{background:var(--del);color:#fff;border-color:var(--del)}
.act button.on[data-v=KEEP]{background:var(--keep);color:#fff;border-color:var(--keep)}
.more{color:var(--mut);cursor:pointer;font-size:11px;text-decoration:underline dotted}
.detail td{background:var(--surf);font-size:12px;color:var(--mut)}
.detail b{color:var(--fg)}
#msg{padding:6px 10px;border-radius:6px;font-weight:600;display:none}
#msg.show{display:block}
.warnbox{background:color-mix(in srgb,var(--warn) 15%,transparent);
border:1px solid var(--warn);padding:8px 10px;border-radius:6px;margin-top:8px;display:none}
.warnbox.show{display:block}
.alt{display:flex;gap:8px;align-items:center;padding:3px 0;flex-wrap:wrap}
.tag{font-size:10px;font-weight:700;padding:1px 6px;border-radius:99px;
border:1px solid var(--line)}
.tag.safe{color:var(--keep);border-color:var(--keep)}
.tag.risky{color:var(--warn);border-color:var(--warn)}
.lock{font-size:11.5px;color:var(--mut);margin:3px 0}
.lock b{color:var(--warn)}
.bom{font-family:ui-monospace,Consolas,monospace;font-size:11.5px}
.miss{color:var(--del)}
.hide{display:none!important}
</style>
<header>
<div class="tabs">
  <button data-tab="models" class="on">Models</button>
  <button data-tab="workflows">Workflows</button>
  <button data-tab="board">Leaderboard</button>
</div>
<div class="bar">
  <input type="search" id="q" placeholder="search...">
  <select id="f1"><option value="">all</option></select>
  <select id="f2"><option value="">all</option></select>
  <span id="modelonly">
    <button id="markdel" class="danger">mark shown DELETE</button>
    <button id="clear">clear shown</button>
  </span>
  <div class="tot">
    <span id="counts"></span>
    <button id="save" class="primary">Save</button>
    <span id="msg"></span>
  </div>
</div>
<div class="warnbox" id="warn"></div>
</header>
<div id="view"></div>
<script>
let ROWS=[], LINKS=null, TAB='models', sortK='gb', sortDir=-1, open=new Set();
const $=s=>document.querySelector(s);
const esc=s=>(s||'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const inUse=r=>['LOADED','PICKABLE','AUTO-DOWNLOAD'].includes(r.status);
const gb=n=>(+n).toFixed(2);

Promise.all([fetch('data').then(r=>r.json()), fetch('links').then(r=>r.json())])
  .then(([d,l])=>{ ROWS=d.rows; LINKS=l; setTab('models'); });

document.querySelectorAll('.tabs button').forEach(b=>b.onclick=()=>setTab(b.dataset.tab));
function setTab(t){
  TAB=t;
  document.querySelectorAll('.tabs button').forEach(b=>
    b.classList.toggle('on', b.dataset.tab===t));
  $('#modelonly').classList.toggle('hide', t!=='models');
  const f1=$('#f1'), f2=$('#f2');
  f1.innerHTML='<option value="">all</option>'; f2.innerHTML='<option value="">all</option>';
  if(t==='models'){
    sortK='gb'; sortDir=-1;
    fill(f1,[...new Set(ROWS.map(r=>r.status))].sort(),'status');
    fill(f2,['DELETE','KEEP','not decided'],'action');
  } else if(t==='workflows'){
    sortK='gb'; sortDir=-1;
    fill(f1,[...new Set(LINKS.workflows.map(w=>w.collection))].sort(),'collection');
    fill(f2,['has a swap available','missing a model'],'filter');
  } else {
    sortK='workflows'; sortDir=-1;
    fill(f1,['used by production','used somewhere','used nowhere'],'usage');
    fill(f2,[...new Set(LINKS.leaderboard.map(b=>b.category))].sort(),'folder');
  }
  open.clear(); render();
}
function fill(sel,vals,label){
  sel.options[0].textContent='all '+label;
  for(const v of vals){const o=document.createElement('option');o.value=v;o.textContent=v;sel.appendChild(o);}
}
function terms(){return $('#q').value.toLowerCase().split(/\s+/).filter(Boolean);}

/* ---------------- models ---------------- */
function shownModels(){
  const q=terms(), st=$('#f1').value, ac=$('#f2').value;
  return ROWS.filter(r=>{
    if(st&&r.status!==st)return false;
    if(ac==='not decided'&&r.ACTION)return false;
    if(ac&&ac!=='not decided'&&r.ACTION!==ac)return false;
    if(!q.length)return true;
    const hay=(r.name+' '+r.used_by+' '+r.category+' '+r.reason+' '+r.status+' '+
               r.duplicate_detail+' '+r.note).toLowerCase();
    return q.every(t=>hay.includes(t));
  });
}
function renderModels(){
  const rs=shownModels().slice().sort(cmp);
  let h='<table><thead><tr><th data-k="ACTION">action</th><th class="num" data-k="gb">GB</th>'+
    '<th data-k="name">model</th><th data-k="status">status</th>'+
    '<th data-k="used_by">what needs it</th><th data-k="duplicate">dup</th>'+
    '<th data-k="backup">bak</th><th></th></tr></thead><tbody>';
  for(const r of rs){
    const cls=r.ACTION==='DELETE'?'del':r.ACTION==='KEEP'?'keep':'';
    h+='<tr class="'+cls+'"><td><div class="act">'+btn(r,'DELETE')+btn(r,'KEEP')+'</div></td>'+
      '<td class="num">'+r.gb+'</td><td class="nm">'+esc(r.name)+'</td>'+
      '<td><span class="st '+r.status+'">'+r.status+'</span></td>'+
      '<td class="used">'+(esc(r.used_by)||'<i>nothing</i>')+'</td>'+
      '<td style="color:var(--warn);font-size:11px">'+(r.duplicate||'')+'</td>'+
      '<td>'+(r.backup==='yes'?'yes':'<span style="color:var(--warn)">no</span>')+'</td>'+
      '<td><span class="more" data-rp="'+esc(r.relpath)+'">'+(open.has(r.relpath)?'hide':'why')+'</span></td></tr>';
    if(open.has(r.relpath)){
      h+='<tr class="detail"><td></td><td colspan="7">'+
        (r.note?'<div><b>note:</b> '+esc(r.note)+'</div>':'')+
        (r.duplicate_detail?'<div><b>'+r.duplicate+':</b> '+esc(r.duplicate_detail)+'</div>':'')+
        '<div><b>verdict:</b> '+esc(r.verdict)+' &middot; <b>risk:</b> '+esc(r.risk)+
        ' &middot; <b>folder:</b> '+esc(r.category)+'</div>'+
        '<div><b>why:</b> '+esc(r.reason)+'</div>'+
        (r.redownload?'<div><b>get it back:</b> '+esc(r.redownload)+'</div>':'')+
        '<div><b>path:</b> '+esc(r.relpath)+'</div></td></tr>';
    }
  }
  return h+'</tbody></table>';
}
function btn(r,v){
  return '<button data-rp="'+esc(r.relpath)+'" data-v="'+v+'" class="'+
    (r.ACTION===v?'on':'')+'">'+(v==='DELETE'?'del':'keep')+'</button>';
}

/* ---------------- workflows ---------------- */
function shownWorkflows(){
  const q=terms(), c=$('#f1').value, f=$('#f2').value;
  return LINKS.workflows.filter(w=>{
    if(c&&w.collection!==c)return false;
    if(f==='missing a model'&&!w.missing.length)return false;
    if(f==='has a swap available'&&!w.models.some(m=>m.alts&&m.alts.length))return false;
    if(!q.length)return true;
    const hay=(w.id+' '+w.models.map(m=>m.name).join(' ')).toLowerCase();
    return q.every(t=>hay.includes(t));
  });
}
function renderWorkflows(){
  const ws=shownWorkflows().slice().sort(cmp);
  let h='<table><thead><tr><th data-k="name">workflow</th><th data-k="collection">where</th>'+
    '<th class="num" data-k="gb">GB of models</th><th class="num" data-k="nmodels">models</th>'+
    '<th>version lock</th><th></th></tr></thead><tbody>';
  for(const w of ws){
    const locks=Object.entries(w.locks||{}).map(([fam,vers])=>{
      const vs=Object.keys(vers);
      return '<span class="lock">'+fam+' <b>'+vs.join(' + ')+'</b></span>';
    }).join(' &middot; ');
    h+='<tr><td class="nm">'+esc(w.name)+'</td><td>'+w.collection+'</td>'+
      '<td class="num">'+gb(w.gb)+'</td>'+
      '<td class="num">'+w.models.length+(w.missing.length?' <span class="miss">('+w.missing.length+' missing)</span>':'')+'</td>'+
      '<td>'+locks+'</td>'+
      '<td><span class="more" data-wf="'+esc(w.id)+'">'+(open.has(w.id)?'hide':'models')+'</span></td></tr>';
    if(open.has(w.id)) h+=wfDetail(w);
  }
  return h+'</tbody></table>';
}
function wfDetail(w){
  let h='<tr class="detail"><td colspan="6">';
  h+='<div style="margin-bottom:6px"><b>files:</b> <span class="bom">'+
     w.files.map(esc).join(' &middot; ')+'</span></div>';
  for(const m of w.models){
    h+='<div style="padding:5px 0;border-top:1px solid var(--line)">';
    h+='<span class="bom">'+esc(m.name)+'</span> &nbsp;';
    h+=m.present?('<b>'+gb(m.gb)+' GB</b> <span class="st '+m.status+'">'+m.status+'</span>')
                :'<span class="miss">NOT ON DISK</span>';
    h+=' <span style="color:var(--mut)">&middot; '+m.sites.length+' site(s)</span>';
    for(const a of (m.alts||[])){
      h+='<div class="alt"><span class="tag '+a.safety+'">'+a.kind+'</span>'+
         '<span class="bom">'+esc(a.name)+'</span>'+
         '<span>'+gb(a.gb)+' GB</span>'+
         '<span style="color:'+(a.saves_gb>0?'var(--keep)':'var(--mut)')+'">'+
           (a.saves_gb>0?'saves '+gb(a.saves_gb)+' GB':'+'+gb(-a.saves_gb)+' GB')+'</span>'+
         '<button data-swap="1" data-wf="'+esc(w.id)+'" data-old="'+esc(m.name)+
           '" data-new="'+esc(a.name)+'" data-safety="'+a.safety+'">Replace</button>'+
         '<span style="color:var(--mut);font-size:11px">'+esc(a.why)+'</span></div>';
    }
    h+='</div>';
  }
  const multi=Object.entries(w.locks||{}).filter(([f,v])=>Object.keys(v).length>1);
  if(multi.length){
    h+='<div class="lock" style="margin-top:6px;color:var(--warn)"><b>mixed generations:</b> '+
       multi.map(([f,v])=>f+' '+Object.keys(v).join(' and ')).join('; ')+
       ' -- check this is deliberate.</div>';
  }
  return h+'</td></tr>';
}

/* ---------------- leaderboard ---------------- */
function shownBoard(){
  const q=terms(), u=$('#f1').value, c=$('#f2').value;
  return LINKS.leaderboard.filter(b=>{
    if(c&&b.category!==c)return false;
    if(u==='used by production'&&!b.production)return false;
    if(u==='used somewhere'&&!b.workflows)return false;
    if(u==='used nowhere'&&b.workflows)return false;
    if(!q.length)return true;
    const hay=(b.name+' '+b.category+' '+b.used_by.join(' ')).toLowerCase();
    return q.every(t=>hay.includes(t));
  });
}
function renderBoard(){
  const bs=shownBoard().slice().sort(cmp);
  let h='<table><thead><tr><th class="num" data-k="workflows">workflows</th>'+
    '<th class="num" data-k="sites">nodes</th><th class="num" data-k="gb">GB</th>'+
    '<th data-k="name">model</th><th data-k="category">folder</th>'+
    '<th data-k="status">status</th><th>used by</th><th></th></tr></thead><tbody>';
  for(const b of bs){
    h+='<tr><td class="num"><b>'+b.workflows+'</b></td><td class="num">'+b.sites+'</td>'+
      '<td class="num">'+gb(b.gb)+'</td><td class="nm">'+esc(b.name)+'</td>'+
      '<td>'+esc(b.category)+'</td>'+
      '<td><span class="st '+b.status+'">'+(b.status||'')+'</span></td>'+
      '<td class="used">'+esc(b.collections.join(', '))+'</td>'+
      '<td><span class="more" data-bd="'+esc(b.name)+'">'+(open.has(b.name)?'hide':'where')+'</span></td></tr>';
    if(open.has(b.name)){
      h+='<tr class="detail"><td colspan="8">'+
        (b.used_by.length? '<div class="bom">'+b.used_by.map(esc).join('<br>')+'</div>'
                         : '<i>no workflow loads this</i>')+'</td></tr>';
    }
  }
  return h+'</tbody></table>';
}

/* ---------------- shared ---------------- */
function cmp(a,b){
  let x=a[sortK],y=b[sortK];
  if(sortK==='nmodels'){x=a.models.length;y=b.models.length;}
  if(['gb','workflows','sites','nmodels'].includes(sortK)){x=+x;y=+y;}
  x=x===undefined?'':x; y=y===undefined?'':y;
  return x<y?-sortDir:x>y?sortDir:0;
}
function render(){
  $('#view').innerHTML = TAB==='models'?renderModels()
                       : TAB==='workflows'?renderWorkflows() : renderBoard();
  document.querySelectorAll('th[data-k]').forEach(th=>th.onclick=()=>{
    const k=th.dataset.k;
    sortDir=(sortK===k)?-sortDir:(['gb','workflows','sites','nmodels'].includes(k)?-1:1);
    sortK=k; render();});
  const del=ROWS.filter(r=>r.ACTION==='DELETE');
  $('#counts').innerHTML='<b>'+del.length+'</b> to delete &middot; <b>'+
    del.reduce((s,r)=>s+ +r.gb,0).toFixed(1)+'</b> GB';
  const risky=del.filter(inUse), w=$('#warn');
  if(risky.length&&TAB==='models'){w.classList.add('show');
    w.innerHTML='<b>'+risky.length+' still in use</b> and marked DELETE: '+
      risky.slice(0,6).map(r=>esc(r.name)).join(', ')+
      (risky.length>6?' and '+(risky.length-6)+' more':'')+
      '. prune-models.ps1 refuses these unless you pass -AllowInUse.';
  } else w.classList.remove('show');
}
document.addEventListener('click',e=>{
  const sw=e.target.closest('button[data-swap]');
  if(sw){ doSwap(sw); return; }
  const b=e.target.closest('button[data-rp]');
  if(b){const r=ROWS.find(x=>x.relpath===b.dataset.rp);
    r.ACTION=r.ACTION===b.dataset.v?'':b.dataset.v; render(); return;}
  const m=e.target.closest('.more');
  if(m){const k=m.dataset.rp||m.dataset.wf||m.dataset.bd;
    open.has(k)?open.delete(k):open.add(k); render();}
});
function doSwap(btn){
  const {wf,old,new:nu,safety}=btn.dataset;
  const q=(safety==='risky'
    ? 'These are DIFFERENT weights, not a repack. The workflow will run but the\n'+
      'result will change.\n\n' : '')+
    'Replace in '+wf+':\n\n  '+old+'\n    ->  '+btn.dataset.new+
    '\n\nThe workflow file is edited in place; a .bak is kept.';
  if(!confirm(q)) return;
  btn.disabled=true; btn.textContent='...';
  fetch('swap',{method:'POST',body:JSON.stringify(
      {workflow:wf,old:old,new:btn.dataset.new,write:true})})
    .then(r=>r.json()).then(d=>{
      if(!d.ok){ alert('Failed: '+d.error); btn.disabled=false; btn.textContent='Replace'; return; }
      const lines=d.report.map(r=>'  '+r.file+'  '+r.changed+'/'+r.expected+
        ' site(s)'+(r.backup?'  (backup: '+r.backup+')':'')+
        (r.note?'\n     '+r.note:'')).join('\n');
      alert('Replaced.\n\n'+lines);
      return fetch('links').then(r=>r.json()).then(l=>{LINKS=l; render();});
    }).catch(err=>{alert('Failed: '+err); btn.disabled=false; btn.textContent='Replace';});
}
['#q','#f1','#f2'].forEach(s=>$(s).oninput=render);
$('#markdel').onclick=()=>{const rs=shownModels();
  if(!confirm('Mark '+rs.length+' shown model(s) DELETE?'))return;
  rs.forEach(r=>r.ACTION='DELETE'); render();};
$('#clear').onclick=()=>{shownModels().forEach(r=>r.ACTION=''); render();};
$('#save').onclick=()=>{
  const a={}; ROWS.forEach(r=>a[r.relpath]=r.ACTION||'');
  fetch('save',{method:'POST',body:JSON.stringify(a)})
    .then(r=>r.json()).then(d=>{
      const m=$('#msg'); m.className='show';
      m.style.background='color-mix(in srgb,var(--keep) 25%,transparent)';
      m.textContent='saved '+d.changed+' change(s)';
      setTimeout(()=>m.className='',2500);
    }).catch(()=>{const m=$('#msg');m.className='show';
      m.style.background='color-mix(in srgb,var(--del) 25%,transparent)';
      m.textContent='save failed';});
};
</script>
"""


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, body, ctype):
        data = body.encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', ctype + '; charset=utf-8')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        path = self.path.split('?')[0].strip('/')
        if path in ('', 'index.html'):
            return self._send(200, PAGE, 'text/html')
        if path == 'data':
            rows, _f = load_rows()
            return self._send(200, json.dumps({'rows': rows, 'path': CSV_PATH}),
                              'application/json')
        if path == 'links':
            try:
                return self._send(200, json.dumps(build_links()), 'application/json')
            except Exception as exc:
                return self._send(500, json.dumps({'error': str(exc)}),
                                  'application/json')
        self._send(404, 'not found', 'text/plain')

    def do_POST(self):
        path = self.path.strip('/')
        n = int(self.headers.get('Content-Length') or 0)
        body = self.rfile.read(n).decode('utf-8')
        try:
            payload = json.loads(body)
        except Exception as exc:
            return self._send(400, json.dumps({'error': str(exc)}),
                              'application/json')
        if path == 'save':
            try:
                changed, total = save_actions(payload)
            except Exception as exc:
                return self._send(500, json.dumps({'error': str(exc)}),
                                  'application/json')
            print('  saved: ' + str(changed) + ' change(s) across '
                  + str(total) + ' rows')
            return self._send(200, json.dumps({'changed': changed}),
                              'application/json')
        if path == 'swap':
            try:
                res = do_swap(payload)
            except Exception as exc:
                return self._send(500, json.dumps({'ok': False, 'error': str(exc)}),
                                  'application/json')
            if res.get('ok') and res.get('wrote'):
                print('  swapped in ' + payload.get('workflow', '?') + ': '
                      + payload.get('old', '?') + ' -> ' + payload.get('new', '?'))
            return self._send(200, json.dumps(res), 'application/json')
        self._send(404, 'not found', 'text/plain')

    def log_message(self, *a):
        pass


def main():
    if not os.path.exists(CSV_PATH):
        print('Not found: ' + CSV_PATH)
        print('Run build_csv.py first.')
        return 1
    rows, _f = load_rows()
    print('model-audit.csv  ' + str(len(rows)) + ' models')
    print('indexing workflows ...', flush=True)
    try:
        data = build_links()
        print('  ' + str(len(data['workflows'])) + ' workflows, '
              + str(len(data['by_model'])) + ' models referenced')
    except Exception as exc:
        print('  link index failed: ' + str(exc))
    srv = ThreadingHTTPServer(('127.0.0.1', PORT), Handler)
    url = 'http://127.0.0.1:' + str(PORT) + '/'
    print('editing at ' + url + '   (Ctrl+C to stop)')
    threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print('\nstopped')
    return 0


if __name__ == '__main__':
    sys.exit(main())
