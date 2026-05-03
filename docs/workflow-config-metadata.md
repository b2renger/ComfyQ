# Workflow Configuration Metadata Files

## Overview

ComfyQ now saves workflow parameter configurations to separate `.config.meta.json` files. This approach keeps the original workflow files intact and usable in ComfyUI while storing your specific parameter selections separately.

## File Structure

When you configure a workflow in the admin interface, ComfyQ creates two files:

1. **`<workflow_name>.json`** - The original ComfyUI workflow file (unchanged)
2. **`<workflow_name>.config.meta.json`** - Your parameter configuration

## Example

### Original Workflow File
`workflows/image_flux2_klein_image_edit_4b_distilled.json`
- This is the standard ComfyUI workflow JSON
- Can be opened and edited in ComfyUI
- Remains completely untouched by ComfyQ configuration

### Configuration Metadata File
`workflows/image_flux2_klein_image_edit_4b_distilled.config.meta.json`

```json
{
  "version": "1.0",
  "createdAt": "2026-02-08T19:00:00.000Z",
  "workflowFile": "image_flux2_klein_image_edit_4b_distilled.json",
  "warmupPrompt": "A simple test generation",
  "parameterMap": {
    "loadimage_image_76": {
      "node_id": "76",
      "field": "image",
      "type": "image",
      "label": "Image (LoadImage)",
      "default": "handbag_white.png",
      "enabled": true,
      "order": 0
    },
    "cliptextencode_text_7b34ab90_36f9_45ba_a665_71d418f0df18_74": {
      "node_id": "7b34ab90-36f9-45ba-a665-71d418f0df18_74",
      "field": "text",
      "type": "textarea",
      "label": "Prompt (CLIP Text Encode (Positive Prompt))",
      "default": "Change the woman's clothing...",
      "enabled": true,
      "order": 3
    }
  },
  "description": "Parameter configuration for ComfyQ workflow"
}
```

## Benefits

1. **ComfyUI Compatibility**: Original workflow files remain usable in ComfyUI
2. **Multiple Configurations**: You can create multiple `.config.meta.json` files for the same workflow with different parameter selections
3. **Version Control**: Easy to track changes to configurations separately from workflows
4. **Portability**: Share workflows without exposing your specific configurations

## config.json Reference

The main `config.json` file references both files:

```json
{
  "workflow": {
    "template_file": "./workflows/image_flux2_klein_image_edit_4b_distilled.json",
    "config_meta_file": "./workflows/image_flux2_klein_image_edit_4b_distilled.config.meta.json",
    "warmup_prompt": "A simple test generation",
    "parameter_map": { ... }
  }
}
```

## Usage

When you save a workflow configuration in the admin interface:

1. The workflow JSON is saved to `workflows/<name>.json`
2. Your parameter configuration is saved to `workflows/<name>.config.meta.json`
3. The `config.json` is updated to reference both files
4. The server switches to student mode

The original workflow file remains unchanged and can still be:
- Opened in ComfyUI
- Modified in ComfyUI
- Shared with others
- Version controlled independently
