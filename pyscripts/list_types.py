import json
with open('workflows/image_flux2_klein_text_to_image-4B.json') as f:
    data = json.load(f)
types = set()
for n in data['nodes']:
    types.add(n['type'])
print(sorted(list(types)))
