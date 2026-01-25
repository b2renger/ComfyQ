import json
with open('workflows/flux_full_api.json') as f:
    data = json.load(f)

print(f"Node 69 (CLIPLoader): {json.dumps(data['69'], indent=2)}")
print(f"Node 70 (CLIPLoader): {json.dumps(data['70'], indent=2)}")
