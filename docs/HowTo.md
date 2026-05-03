# How to Test Phase 1: Multi-Workflow Support

This guide walks you through testing the new multi-workflow support system.

## Prerequisites

- Node.js installed
- ComfyQ dependencies installed (`npm install`)
- At least one workflow JSON in the `workflows/` folder

---

## Test 1: Workflow Registry (CLI)

Run from the ComfyQ root directory:

```bash
node -e "const wr = require('./server/workflowRegistry'); const workflows = wr.discoverWorkflows(); console.log('Found', workflows.length, 'workflows:'); workflows.forEach(w => console.log(' -', w.id, ':', w.metadata.name, '(' + w.metadata.category + ')'))"
```

**Expected output:**
```
[WorkflowRegistry] Discovering workflows...
[WorkflowRegistry] Found 1 workflow files
[WorkflowRegistry] Converting Litegraph format: image_flux2_klein_image_edit_9b_base.json
[WorkflowRegistry] Loaded: Image Flux2 Klein Image Edit 9b Base (image_flux2_klein_image_edit_9b_base)
[WorkflowRegistry] Successfully loaded 1 workflows
Found 1 workflows:
 - image_flux2_klein_image_edit_9b_base : Image Flux2 Klein Image Edit 9b Base (image-edit)
```

---

## Test 2: Workflow API Endpoints

### Start the server

```bash
npm run dev
```

### Test endpoints with curl or browser

1. **List all workflows:**
   ```
   GET http://localhost:3000/admin/workflows
   ```

2. **Get workflow details:**
   ```
   GET http://localhost:3000/admin/workflows/image_flux2_klein_image_edit_9b_base
   ```

3. **Get workflow parameters:**
   ```
   GET http://localhost:3000/admin/workflows/image_flux2_klein_image_edit_9b_base/parameters
   ```

4. **Get workflows by category:**
   ```
   GET http://localhost:3000/admin/workflows/categories
   ```

5. **Refresh workflow registry:**
   ```
   POST http://localhost:3000/admin/workflows/refresh
   ```

---

## Test 3: Adding a New Workflow

1. **Export a workflow from ComfyUI:**
   - In ComfyUI, create or load your workflow
   - Click the menu → Save (or Ctrl+S)
   - Save the JSON file to `ComfyQ/workflows/`

2. **Optional: Create metadata file**
   
   Create a `.meta.json` file with the same basename:
   
   ```json
   {
     "name": "My Text to Image",
     "description": "Generate images from text prompts",
     "category": "t2i",
     "tags": ["flux", "text2image"],
     "estimatedTime": 45,
     "presets": {
       "quick": {
         "label": "Quick",
         "description": "Faster generation",
         "values": { "steps": 20 }
       },
       "quality": {
         "label": "Quality", 
         "description": "Best quality",
         "values": { "steps": 50 }
       }
     },
     "exposedParameters": [
       {
         "nodeId": "6",
         "field": "text",
         "label": "Prompt",
         "type": "textarea",
         "required": true
       }
     ]
   }
   ```

3. **Refresh and verify:**
   ```bash
   curl -X POST http://localhost:3000/admin/workflows/refresh
   ```

---

## Test 4: WorkflowSelector Component

The `WorkflowSelector.jsx` component can be integrated into any React view. To test:

1. Import the component:
   ```jsx
   import WorkflowSelector from '../components/WorkflowSelector';
   ```

2. Use it in your component:
   ```jsx
   <WorkflowSelector 
     selectedWorkflowId={selectedId}
     onSelect={(workflow) => console.log('Selected:', workflow)}
     onPresetSelect={(name, values) => console.log('Preset:', name, values)}
   />
   ```

---

## Supported Workflow Formats

The system automatically detects and handles:

| Format | Source | Detection |
|--------|--------|-----------|
| **Litegraph** | ComfyUI UI export (Save) | Has `nodes` array |
| **API** | ComfyUI API format | Has `class_type` keys |

Litegraph format is automatically converted to API format for execution.

---

## Category Mapping

Categories are auto-detected from filenames:

| Filename Contains | Category |
|-------------------|----------|
| `t2i`, `text2image`, `txt2img` | `t2i` |
| `edit`, `i2i`, `img2img` | `image-edit` |
| `i2v`, `video`, `img2vid` | `i2v` |
| `audio`, `sound`, `music` | `audio` |
| `3d`, `mesh` | `3d` |
| (other) | `other` |

---

## Troubleshooting

### Workflow not loading
- Check the console for validation errors
- Ensure the file is valid JSON
- Verify it's a ComfyUI workflow (has nodes or class_type)

### Metadata not applying
- Ensure `.meta.json` has the exact same basename as the workflow
- Check JSON syntax in the metadata file

### Preset not working  
- Verify the preset name matches exactly
- Check that `values` object contains valid parameter keys

### Error: "missing_node_type" (Group Nodes)
If you see an error like `Node 'UUID...' not found` when running a workflow:
- Your workflow likely contains **Group Nodes** (nested workflows).
- These cannot be automatically converted from the standard save format.
- **Solution:** You must save the workflow in **API Format** from ComfyUI.
  1. In ComfyUI, go to **Settings (Gear Icon)** and enable **Dev mode Options**.
  2. Click **Save (API Format)** button.
  3. Use this .json file in ComfyQ.
  4. Note: You will need to re-map parameters in the Admin dashboard as Node IDs will change.
