import json
with open('workflows/image_flux2_text_to_image_9b.json') as f:
    data = json.load(f)

for sg in data.get('definitions', {}).get('subgraphs', []):
    if 'nodes' in sg:
        for node in sg['nodes']:
            for out in node.get('outputs', []):
                if 140 in out.get('links', []):
                    print(f"Node {node['id']} ({node['type']}) outputs link 140")
