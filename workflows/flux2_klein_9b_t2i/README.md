# Flux2 Klein 9B — text to image (placeholder)

This folder is a slot reserved for the Flux2 Klein 9B text-to-image workflow.

To activate it:

1. Open Flux2 Klein 9B t2i in ComfyUI.
2. Enable **Settings → Dev mode Options**, then click **Save (API Format)**.
3. Save the file as `flux2_klein_9b_t2i.api.json` in this folder.
4. Adjust `flux2_klein_9b_t2i.meta.json` so that `exposedParameters` reference the right `nodeId` / `field` for your saved workflow (the node ids in API format depend on how you built the workflow).
5. Click **Refresh** in the ComfyQ admin "Workflow library" or restart the server. The workflow appears in the selector once `<id>.api.json` is present.

API format is required — ComfyQ v2 does not auto-convert the standard "Save" format.
