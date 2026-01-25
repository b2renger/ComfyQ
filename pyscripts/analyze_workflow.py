import json
with open('workflows/image_flux2_klein_text_to_image-4B.json') as f:
    data = json.load(f)
for n in data['nodes']:
    if n['type'] == 'CLIPTextEncode':
        print(f"ID {n['id']}: {n['type']}")
        for inp in n['inputs']:
            print(f"  Input: {inp}")
        if 'widgets_values' in n:
             print(f"  Text: {n['widgets_values'][0]}")
