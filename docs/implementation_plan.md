# ComfyQ Code Review and Cleanup Plan

This plan outlines a comprehensive code review, cleanup, and documentation effort for the ComfyQ application. The goal is to add thorough comments, remove unnecessary configuration files, and ensure all configuration happens at server startup.

## User Review Required

> [!IMPORTANT]
> **Configuration File Removal**
> 
> We will be removing the static configuration files (`config.json` and all files in `/configs/`). This is a breaking change - users will need to configure the application via the admin interface on each server startup. The workflow files in `/workflows/` will also be removed since they should be uploaded via the admin interface.
> 
> Please confirm this approach aligns with your requirements.

> [!NOTE]
> **Comment Strategy**
> 
> I will add comprehensive JSDoc-style comments to all server-side files and descriptive comments to client-side React components. This includes function documentation, parameter descriptions, and explanatory inline comments where logic is complex.

## Proposed Changes

### Server-Side Code Review and Documentation

Comprehensive commenting and cleanup of all server modules.

#### [MODIFY] [index.js](file:///c:/Users/b.recoules/Downloads/mini_projets/ComfyQ/server/index.js)
- Add file-level JSDoc describing the module's purpose
- Add detailed comments for route setup sections
- Document middleware configuration
- Add comments explaining admin vs student mode logic
- Clean up any console.log statements for consistency

#### [MODIFY] [bootManager.js](file:///c:/Users/b.recoules/Downloads/mini_projets/ComfyQ/server/bootManager.js)
- Add comprehensive JSDoc for the BootManager class
- Document the boot sequence steps
- Add comments explaining the validation process
- Document the benchmark/warmup logic
- Add error handling documentation

#### [MODIFY] [scheduler.js](file:///c:/Users/b.recoules/Downloads/mini_projets/ComfyQ/server/scheduler.js)
- Add detailed JSDoc for the Scheduler class
- Document job state machine (pending → running → completed/failed)
- Add comments explaining collision detection
- Document the scheduling algorithm
- Explain parameter mapping logic
- Add comments for time-slot management

#### [MODIFY] [configManager.js](file:///c:/Users/b.recoules/Downloads/mini_projets/ComfyQ/server/configManager.js)
- Add JSDoc for all exported functions
- Document the configuration schema
- Explain path resolution logic
- Add comments for mode switching logic
- Document workflow saving process

#### [MODIFY] [socketManager.js](file:///c:/Users/b.recoules/Downloads/mini_projets/ComfyQ/server/socketManager.js)
- Add class-level JSDoc
- Document all socket event handlers
- Explain broadcasting logic
- Add comments for user connection management
- Document the state synchronization mechanism

#### [MODIFY] [workflowParser.js](file:///c:/Users/b.recoules/Downloads/mini_projets/ComfyQ/server/workflowParser.js)
- Add comprehensive documentation for EDITABLE_NODE_TYPES
- Document the parameter inference algorithm
- Explain type detection logic
- Add comments for workflow validation
- Document parameter map generation

#### [MODIFY] [admin.js](file:///c:/Users/b.recoules/Downloads/mini_projets/ComfyQ/server/routes/admin.js)
- Add route-level documentation for each endpoint
- Document request/response schemas
- Add security considerations comments
- Explain workflow upload process
- Document configuration save flow

---

### Client-Side Code Review and Documentation

Add descriptive comments to React components explaining their purpose and key functionality.

#### [MODIFY] [App.jsx](file:///c:/Users/b.recoules/Downloads/mini_projets/ComfyQ/client/src/App.jsx)
- Add component documentation
- Document routing logic
- Explain mode detection and handling
- Add comments for navigation structure

#### [MODIFY] [AdminConfig.jsx](file:///c:/Users/b.recoules/Downloads/mini_projets/ComfyQ/client/src/pages/AdminConfig.jsx)
- Document the three-step configuration flow
- Add comments for workflow upload
- Explain parameter selection logic
- Document save and switch mode process

#### [MODIFY] [Scheduler.jsx](file:///c:/Users/b.recoules/Downloads/mini_projets/ComfyQ/client/src/pages/Scheduler.jsx)
- Document vis-timeline integration
- Explain job drag-and-drop logic
- Add comments for real-time updates
- Document booking dialog interaction
- Explain collision detection on client side

#### [MODIFY] [Dashboard.jsx](file:///c:/Users/b.recoules/Downloads/mini_projets/ComfyQ/client/src/pages/Dashboard.jsx)
- Document the job table structure
- Explain filtering and sorting logic
- Add comments for admin actions
- Document user management features

#### [MODIFY] [BookingDialog.jsx](file:///c:/Users/b.recoules/Downloads/mini_projets/ComfyQ/client/src/components/BookingDialog.jsx)
- Document form handling
- Explain parameter input rendering
- Add comments for image/video upload
- Document validation logic

#### [MODIFY] [MyJobsPanel.jsx](file:///c:/Users/b.recoules/Downloads/mini_projets/ComfyQ/client/src/components/MyJobsPanel.jsx)
- Document user job filtering
- Explain job status display
- Add comments for action buttons

---

### Configuration Cleanup

Remove static configuration files and update documentation.

#### [DELETE] [config.json](file:///c:/Users/b.recoules/Downloads/mini_projets/ComfyQ/config.json)
Remove the static configuration file. Configuration should be done via admin interface on startup.

#### [DELETE] configs directory
Remove all preset configuration files:
- `configs/flux2-image-edit.json`
- `configs/flux2-text-to-image.json`
- `configs/wan2-i2v.json`

#### [DELETE] workflows directory  
Remove example workflow files. Users should upload their own workflows:
- `workflows/image_flux2_klein_image_edit_9b_base.json`
- `workflows/image_flux2_text_to_image_9b.json`
- `workflows/video_wan2_2_14B_i2v.json`

#### [MODIFY] [package.json](file:///c:/Users/b.recoules/Downloads/mini_projets/ComfyQ/package.json)
Remove the preset workflow npm scripts:
- Remove `dev:t2i`, `dev:i2v`, `dev:edit` scripts
- Keep only `dev` script for standard startup

#### [MODIFY] [.gitignore](file:///c:/Users/b.recoules/Downloads/mini_projets/ComfyQ/.gitignore)
Add entries to ignore generated configuration:
- `config.json`
- `configs/`
- `workflows/`

---

### Documentation Updates

Improve project documentation to reflect the current state.

#### [MODIFY] [README.md](file:///c:/Users/b.recoules/Downloads/mini_projets/ComfyQ/README.md)
Expand the README with:
- Comprehensive feature list
- Installation instructions
- Startup flow documentation
- Admin configuration guide
- User interface guide
- Troubleshooting tips
- Architecture overview

#### [DELETE] [TODO.md](file:///c:/Users/b.recoules/Downloads/mini_projets/ComfyQ/TODO.md)
Remove TODO file since tasks should be tracked in issues or a project management tool.

---

## Verification Plan

### Automated Tests

Currently, there are no automated tests in the codebase. For this code review and cleanup task, we will verify changes through manual testing and code review.

### Manual Verification

#### 1. Server Startup in Admin Mode
```bash
# Start the development server
npm run dev

# Expected: Server should start in admin mode (no config.json present)
# Verify console output shows: [Server] Operating Mode: ADMIN
# Navigate to http://localhost:3000 and verify redirect to /admin
```

#### 2. Workflow Upload and Configuration
- Upload a valid ComfyUI workflow JSON file
- Verify parameters are extracted and displayed
- Select parameters to expose to users
- Enter admin password (optional)
- Click "Save and Launch for Students"
- Verify server restarts in student mode

#### 3. Student Mode Job Scheduling
```bash
# After configuration, server should restart in student mode
# Verify console output shows: [Server] Operating Mode: STUDENT

# Navigate to http://localhost:3000
# Verify redirect to /user
```
- Test job scheduling via timeline
- Test job reordering (drag and drop)
- Test job cancellation
- Test job completion and result viewing

#### 4. Code Comment Quality
- Review each modified file
- Verify all public functions have JSDoc comments
- Verify complex logic has explanatory inline comments
- Check that comments are clear and accurate

#### 5. Configuration File Removal
- Verify no `config.json` exists in project root after cleanup
- Verify `configs/` and `workflows/` directories are removed
- Verify `.gitignore` properly ignores generated configuration
- Verify npm scripts no longer reference preset configs
