import json
with open('workflows/flux_full_api.json') as f:
    data = json.load(f)

for nid, node in data.items():
    for k, v in node.get('inputs', {}).items():
        if isinstance(v, list) and len(v) == 2 and v[0] == "72":
            print(f"Node {nid} ({node['class_type']}) consumes Node 72 on input '{k}'")
        if isinstance(v, list) and len(v) == 2 and v[0] == "67":
            print(f"Node {nid} ({node['class_type']}) consumes Node 67 on input '{k}'")
