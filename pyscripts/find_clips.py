import json
with open('workflows/flux_full_api.json') as f:
    data = json.load(f)
for k, v in data.items():
    if v.get('class_type') == 'CLIPTextEncode':
        print(f"ID {k}: {v['class_type']} - text: '{v['inputs'].get('text')}'")
