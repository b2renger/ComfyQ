import json
with open('workflows/flux_full_api.json') as f:
    data = json.load(f)
for k, v in data.items():
    if 'text' in v.get('inputs', {}):
        print(f"Node {k} ({v['class_type']}) has 'text' input: '{v['inputs']['text']}'")
