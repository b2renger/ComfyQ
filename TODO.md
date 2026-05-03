# ComfyQ v2 Development Roadmap

## Phase 0: Code Cleanup & Documentation
- [ ] Review and clean up existing codebase
- [ ] Add JSDoc comments to all server modules
- [ ] Add JSDoc comments to all client components  
- [ ] Remove unnecessary configuration files
- [ ] Update README.md for v2 features

---

## Phase 1: Multi-Workflow Support
- [ ] Create workflow registry system (workflowRegistry.js)
- [ ] Add workflow metadata schema with .meta.json files
- [ ] Create workflow selector UI component
- [ ] Add workflow-specific parameter presets
- [ ] Test with workflows: t2i, image edit, i2v, 3D, text2audio

---

## Phase 2: Enhanced Job Management
- [ ] Add user color coding for visual tracking
- [ ] Implement job search/filter by prompt text
- [ ] Add date range filtering for historical analysis
- [ ] Export job data to CSV or JSON
- [ ] Refactor Dashboard with JobFilters component

---

## Phase 3: Real-Time Enhancements  
- [ ] Real-time progress bars in notifications
- [ ] Step-by-step progress updates
- [ ] Node execution state visualization
- [ ] ETA display during generation

---

## Phase 4: Webcam/Camera Support
- [ ] Add webcam capture component (CameraCapture.jsx)
- [ ] Mobile-friendly camera interface
- [ ] Integrate with LoadImage parameter type
- [ ] Front/back camera toggle support

---

## Phase 5: Multi-Node Support (Future)
- [ ] Design node manager architecture
- [ ] Implement node discovery (mDNS/manual registration)
- [ ] Add parallel job execution across nodes
- [ ] Create node health monitoring
- [ ] Add node selection UI (NodeManager.jsx)
- [ ] Support for multiple ComfyUI instances on same machine

---

## Compatibility Goals
- [ ] Text-to-Image (t2i) workflows
- [ ] Image Edit workflows
- [ ] Image-to-Video (i2v) workflows
- [ ] 3D generation workflows
- [ ] Text-to-Audio workflows
- [ ] Multi-angle generation (qwen)

---

## Testing Checklist
- [ ] Manual feature testing
- [ ] Cross-browser testing (Chrome, Firefox, Safari)
- [ ] Mobile responsive testing (iOS, Android)
- [ ] Real ComfyUI workflow execution tests