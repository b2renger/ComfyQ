import json
with open('workflows/image_flux2_text_to_image_9b.json') as f:
    data = json.load(f)

for sg in data.get('definitions', {}).get('subgraphs', []):
    if 'nodes' in sg:
        for node in sg['nodes']:
            if node['type'] == 'CFGGuider':
                print(f"CFGGuider node {node['id']} inputs:")
                for inp in node['inputs']:
                    print(f"  {inp}")
