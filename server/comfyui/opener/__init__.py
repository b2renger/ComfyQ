# ComfyQ opener — a frontend-only ComfyUI extension.
#
# ComfyQ's admin panel stages a workflow into ComfyUI's user/default/workflows
# and opens ComfyUI with `?comfyq_open=<name>`. The bundled JS (WEB_DIRECTORY)
# reads that param on page load and loads the staged workflow onto the canvas,
# so "Open in ComfyUI" lands the admin directly on the editable graph.
#
# It defines no nodes — it exists purely to ship the web asset. ComfyQ's server
# installs/updates this folder automatically into <comfy_root>/custom_nodes.
WEB_DIRECTORY = "./js"
NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
