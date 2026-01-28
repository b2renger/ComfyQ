# Admin Configuration Page - Implementation Plan

## Overview
Create an admin interface that allows teachers to configure ComfyUI workflows before launching the student-facing server.

## Architecture Changes

### Current Flow
```
Server starts → reads config.json → boots ComfyUI → serves student interface
```

### New Flow
```
Server starts in "config mode" 
  ↓
Admin uploads workflow JSON
  ↓
System parses workflow and extracts parameters
  ↓
Admin selects which parameters to expose
  ↓
Admin previews the student modal
  ↓
Admin clicks "Save and Serve"
  ↓
Server saves config.json and restarts in "student mode"
  ↓
ComfyUI boots with new workflow
  ↓
Students see configured interface
```

## Implementation Tasks

### Phase 1: Backend Infrastructure

#### 1.1 Server Mode Management
- [ ] Add `mode` field to config.json (`"admin"` or `"student"`)
- [ ] Create `configManager.js` to handle config operations
- [ ] Modify `server/index.js` to support two modes:
  - **Admin mode**: Serve admin interface, don't boot ComfyUI
  - **Student mode**: Current behavior (boot ComfyUI, serve student interface)

#### 1.2 Workflow Parser Service
- [ ] Create `server/workflowParser.js` to:
  - Parse ComfyUI workflow JSON
  - Extract all nodes and their inputs
  - Identify parameter types (text, number, image, select, etc.)
  - Return a structured parameter list

#### 1.3 Admin API Endpoints
- [ ] `POST /admin/upload-workflow` - Upload and parse workflow file
- [ ] `GET /admin/workflow-parameters` - Get extracted parameters
- [ ] `POST /admin/save-config` - Save configuration and switch to student mode
- [ ] `POST /admin/restart-server` - Restart server in student mode
- [ ] `GET /admin/preview-workflow` - Get current workflow config for preview

### Phase 2: Frontend - Admin Interface

#### 2.1 Admin Page Structure
- [ ] Create `client/src/pages/AdminConfig.jsx`
- [ ] Create workflow upload component with drag-and-drop
- [ ] Create parameter selection interface
- [ ] Create preview modal component
- [ ] Add "Save and Serve" button with confirmation

#### 2.2 Parameter Selection UI
Component: `ParameterSelector.jsx`
- [ ] Display all detected parameters in a table/list
- [ ] For each parameter show:
  - Node ID
  - Parameter name
  - Type (auto-detected)
  - Current value
  - Checkbox to expose to students
  - Custom label input
  - Type override dropdown
- [ ] Allow drag-to-reorder for parameter display order

#### 2.3 Preview Modal
Component: `ConfigPreview.jsx`
- [ ] Recreate BookingDialog appearance
- [ ] Show exactly how students will see the form
- [ ] Use selected parameters with their labels
- [ ] Interactive preview (can type/upload but doesn't submit)

#### 2.4 Workflow Upload Component
Component: `WorkflowUpload.jsx`
- [ ] Drag-and-drop zone
- [ ] File validation (must be valid JSON)
- [ ] Display workflow name and node count
- [ ] Show parsing errors if any

### Phase 3: Parameter Type Detection

#### 3.1 Type Detection Rules
Create intelligent type detection based on:
- **Image**: `LoadImage`, `VAEEncodeForInpaint` nodes, field name contains "image"
- **Textarea**: `CLIPTextEncode` nodes, field name is "text" and value is long
- **Number**: Fields like "steps", "cfg", "seed", "denoise"
- **Select**: Pre-defined options for sampler_name, scheduler
- **Text**: Default for string fields

#### 3.2 Editable Nodes List
Focus on commonly edited nodes:
- `CLIPTextEncode` (prompts)
- `LoadImage` (image uploads)
- `KSampler` / `KSamplerAdvanced` (steps, cfg, seed)
- `EmptyLatentImage` (width, height)
- `CheckpointLoaderSimple` (model selection)
- `LoraLoader` (lora selection, strength)

### Phase 4: Configuration Persistence

#### 4.1 Config Schema Update
Enhance `config.json` structure:
```json
{
  "mode": "admin" | "student",
  "server": {...},
  "comfy_ui": {...},
  "workflow": {
    "template_file": "./workflows/workflow.json",
    "warmup_prompt": "...",
    "parameter_map": {
      "param_name": {
        "node_id": "123",
        "field": "text",
        "type": "textarea",
        "label": "Your Prompt",
        "default": "...",
        "enabled": true,
        "order": 0
      }
    }
  }
}
```

#### 4.2 Save and Restart Logic
- [ ] Validate configuration before saving
- [ ] Save workflow file to `./workflows/`
- [ ] Update config.json with new parameter_map
- [ ] Set mode to "student"
- [ ] Trigger server restart (process.exit with restart wrapper)

### Phase 5: Routing and Navigation

#### 5.1 Route Structure
- **Admin mode**: 
  - `/` → AdminConfig page
  - Redirect all other routes to `/`
  
- **Student mode**:
  - `/` → Current Dashboard
  - `/scheduler` → Current Scheduler
  - No access to admin routes

#### 5.2 Mode Detection
- [ ] Create `useModeContext` to detect server mode
- [ ] Server sends mode in WebSocket state
- [ ] Frontend routes conditionally based on mode

### Phase 6: Polish and UX

#### 6.1 Admin Page UX
- [ ] Loading states during workflow parsing
- [ ] Error handling and validation messages
- [ ] Confirmation dialog before "Save and Serve"
- [ ] Progress indicator during server restart
- [ ] Success message with redirect countdown

#### 6.2 Visual Design
- [ ] Use existing design system
- [ ] Add admin-specific icons and colors
- [ ] Responsive layout for parameter selection
- [ ] Smooth transitions between steps

## File Structure

```
server/
  ├── index.js (modified - mode handling)
  ├── configManager.js (new)
  ├── workflowParser.js (new)
  └── routes/
      └── admin.js (new - admin endpoints)

client/src/
  ├── pages/
  │   ├── AdminConfig.jsx (new)
  │   └── ...existing
  ├── components/
  │   ├── admin/
  │   │   ├── WorkflowUpload.jsx (new)
  │   │   ├── ParameterSelector.jsx (new)
  │   │   └── ConfigPreview.jsx (new)
  │   └── ...existing
  └── context/
      └── ModeContext.jsx (new)

config.json (modified - add mode field)
```

## Implementation Order

1. ✅ **Phase 1.2**: Create workflow parser (core functionality)
2. ✅ **Phase 1.1**: Add mode management to server
3. ✅ **Phase 1.3**: Create admin API endpoints
4. ✅ **Phase 2.1**: Create basic admin page structure
5. ✅ **Phase 2.4**: Workflow upload component
6. ✅ **Phase 2.2**: Parameter selection interface
7. ✅ **Phase 2.3**: Preview modal
8. ✅ **Phase 4**: Save and restart functionality
9. ✅ **Phase 5**: Routing and mode detection
10. ✅ **Phase 6**: Polish and UX improvements

## Testing Checklist

- [ ] Upload valid workflow JSON
- [ ] Upload invalid JSON (error handling)
- [ ] Parameter detection works for various node types
- [ ] Type override works correctly
- [ ] Preview matches actual student view
- [ ] Save and restart works
- [ ] Server boots in correct mode after restart
- [ ] Students see correct parameters
- [ ] Workflow execution works with new config

## Security Considerations

- [ ] Validate uploaded JSON (prevent code injection)
- [ ] Limit file size for uploads
- [ ] Validate workflow structure before parsing
- [ ] Add optional admin password in config
- [ ] Prevent students from accessing admin routes
