# Workflow Configuration Metadata - Quick Reference

## What Changed?

ComfyQ now saves workflow parameter configurations to **separate `.config.meta.json` files** instead of modifying the original workflow files. This keeps your ComfyUI workflows intact and usable.

## Compatibility Note

**Group Nodes (Nested Workflows)**: If your workflow uses Group Nodes, you **MUST** save it in **API Format** from ComfyUI (enable Dev Mode Options to see this option). Standard save format (Litegraph) with Group Nodes cannot be automatically converted.

## File Structure

```
workflows/
├── my_workflow.json                    # Original ComfyUI workflow (UNCHANGED)
├── my_workflow.meta.json               # Workflow description (optional, for workflow registry)
└── my_workflow.config.meta.json        # Parameter configuration (NEW!)
```

## Example: `.config.meta.json`

```json
{
  "version": "1.0",
  "createdAt": "2026-02-08T19:00:00.000Z",
  "workflowFile": "my_workflow.json",
  "warmupPrompt": "Test generation",
  "parameterMap": {
    "prompt_param": {
      "node_id": "6",
      "field": "text",
      "type": "textarea",
      "label": "Prompt",
      "default": "a beautiful landscape",
      "enabled": true,
      "order": 0
    }
  },
  "description": "Parameter configuration for ComfyQ workflow"
}
```

## How It Works

### When You Save a Configuration (Admin Interface):

1. **Workflow saved**: `workflows/my_workflow.json` (original format)
2. **Config saved**: `workflows/my_workflow.config.meta.json` (parameters)
3. **config.json updated**:
   ```json
   {
     "workflow": {
       "template_file": "./workflows/my_workflow.json",
       "config_meta_file": "./workflows/my_workflow.config.meta.json",
       "parameter_map": { ... }
     }
   }
   ```

### Benefits:

✅ **ComfyUI Compatible** - Original workflows remain usable in ComfyUI  
✅ **Clean Separation** - Workflow definition vs. parameter configuration  
✅ **Multiple Configs** - Create different configs for the same workflow  
✅ **Version Control** - Track configuration changes separately  
✅ **Shareable** - Share workflows without exposing your configs  

## Files Modified

- `server/configManager.js` - Added `saveParameterConfig()` function
- `config.json` - Added `config_meta_file` field
- `README.md` - Added documentation section

## Files Created

- `workflows/*.config.meta.json` - Parameter configuration files
- `docs/workflow-config-metadata.md` - Detailed documentation
- `docs/workflow-config-metadata-implementation.md` - Implementation details

## Testing

✅ Tested with `test-config-metadata.js` - All tests passed!

## Next Steps

You can now:
1. Continue using the admin interface as before
2. Your workflows will automatically be saved with separate config files
3. Original workflow files remain untouched and ComfyUI-compatible
4. Create multiple configurations for the same workflow if needed

## Questions?

See the detailed documentation:
- [docs/workflow-config-metadata.md](./workflow-config-metadata.md) - User guide
- [docs/workflow-config-metadata-implementation.md](./workflow-config-metadata-implementation.md) - Technical details
