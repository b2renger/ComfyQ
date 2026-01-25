import json
with open('workflows/flux_full_api.json') as f:
    data = json.load(f)

node_63 = data.get("63")
if node_63:
    print(f"Node 63 Inputs: {json.dumps(node_63['inputs'], indent=2)}")
    pos_id = node_63['inputs']['positive'][0]
    print(f"Positive Node ({pos_id}): {json.dumps(data[pos_id], indent=2)}")
    neg_id = node_63['inputs']['negative'][0]
    print(f"Negative Node ({neg_id}): {json.dumps(data[neg_id], indent=2)}")
