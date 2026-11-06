# ui-to-api — turn an editable ComfyUI graph into the file ComfyQ runs

ComfyQ runs a bundle's `<id>.api.json`. A graph saved or exported from the
ComfyUI editor (a `_template.json`, or a workflow from the candidate folder) is
in a different format. This tool converts it the way ComfyUI itself does: it
loads the graph in ComfyUI's **own frontend** in headless Chrome and calls
`graphToPrompt()`, the code behind *Export (API)*. Subgraphs, bypassed nodes,
primitives and reroutes are flattened exactly as ComfyUI would.

```bash
npm install                                            # once, in this folder
node convert.mjs <scratch dir> <graph>.json [more.json ...]
```

- **ComfyUI must be running** (`COMFY_URL`, default `http://127.0.0.1:8188`) with
  every node pack the graph uses. `CHROME` sets the browser if it is not found.
- Each output is **named after its input file**: `<id>_template.json` becomes
  `<scratch dir>/<id>_template.api.json`. Nothing is written into a bundle.
- Always give a **scratch folder**, never a bundle folder: a `_report.json` is
  written there too.
- Exit code is 1 if any graph failed. Also read `_report.json`: a warning
  starting `[ExecutableNodeDTO.resolveOutput] No input types match` means a
  bypassed node sat in a live path and ComfyUI dropped the link, so the
  converted graph is missing an input.

To replace a bundle's `<id>.api.json` with an edited graph, follow
**After editing a graph in ComfyUI** in [../api-to-ui/README.md](../api-to-ui/README.md):
it covers checking that the card's settings still point at real nodes and not
losing hand edits that exist only in the api.json.
