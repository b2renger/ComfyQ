import json
with open('workflows/flux_full_api.json') as f:
    data = json.load(f)
for k, v in data.items():
    print(f"{k}: {v['class_type']}")
