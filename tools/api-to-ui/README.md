# api-to-ui — rebuild a bundle's editable ComfyUI graph

Every ComfyQ bundle ships **two** files for the same graph:

| file | who reads it |
|---|---|
| `<id>.api.json` | ComfyQ — this is what actually runs |
| `<id>_template.json` | a human, via **Open in ComfyUI** |

This tool makes the second from the first. It is the mirror of
[`../ui-to-api`](../ui-to-api), and works the same way: drive ComfyUI's **own
frontend** in headless Chrome, so widget order, input slots, node sizes and the
layout all come from ComfyUI rather than from our guesses.

```bash
npm install                                   # once — puppeteer-core only
node convert.mjs <bundle-id> [more ...]       # writes <id>_template.json in place
node convert.mjs --check <bundle-id>          # verify, write nothing
node convert.mjs --out <dir> <bundle-id>      # write somewhere else
```

`COMFY_URL` (default `http://127.0.0.1:8188`), `CHROME`, `WORKFLOWS` override the
defaults. **ComfyUI must be running with every node pack the bundle uses.**

## What it refuses to do

Both of these fail silently if you do the conversion by hand, which is why the
tool exists:

1. **An unknown `class_type` does not throw.** `loadApiJson` swaps in a
   placeholder node carrying `has_errors`, so a missing node pack yields a
   template that opens looking almost right and cannot run. Any unresolved node
   aborts that bundle and names it.
2. **A template that does not reproduce its own api.json is not a hand-off.**
   Every generated template is loaded straight back and exported through
   `graphToPrompt()` — the "Export (API)" path — and diffed against the
   api.json it came from, input by input. A mismatch is printed and nothing is
   written.

Exit code is 1 if any bundle failed, so it can gate a script.

## The rule this supports

`server/workflows/bundleCompleteness.test.js` (in `npm run test:storyboard`)
fails when a bundle has no template, when the filename is not canonical, when
the "template" is really a second copy of the api.json, or when it shares no
node class with the graph that runs. A missing template is otherwise invisible —
the registry just degrades **Open in ComfyUI** to download-and-drag, which
survives a green test run and a successful calibration.

## Caveats

- The layout is ComfyUI's `graph.arrange()`, so the result is tidy and readable
  but has **no groups, notes or subgraphs** — those exist only in a template
  that was hand-authored or exported from the editor. A bundle converted *from*
  a UI graph should keep its original template; use this for bundles built
  api-first.
- A generated template gets one `Note` naming the bundle and saying that ComfyQ
  runs the api.json, so an admin who edits the graph knows that saving it in
  ComfyUI changes nothing ComfyQ runs. `Note` is frontend-only and never reaches
  the prompt — the round-trip check proves that rather than assuming it.

## After editing a graph in ComfyUI: make ComfyQ run it

ComfyQ runs only `workflows/<id>/<id>.api.json`. Saving the graph in ComfyUI
changes nothing ComfyQ runs until that file is replaced:

1. Save the edited graph in ComfyUI (or *Export*), then convert it into a
   **scratch folder**, never the bundle folder (the converter also writes a
   `_report.json` there).

   Saving in the tab *Open in ComfyUI* opened writes
   `<ComfyUI>\user\default\workflows\<id>_template.json` (for a workflow served
   on a lane of its own:
   `.comfyq-lanes\<id>\user\default\workflows\<id>_template.json`). Pressing
   *Open in ComfyUI* again copies the bundle's template over that file, with no
   warning, so convert it or copy it somewhere else first (or use *Export*,
   which saves a separate file).

   ```bash
   node tools/ui-to-api/convert.mjs <scratch dir> <edited graph>.json
   ```

   (Once: run `npm install` in `tools/ui-to-api`. ComfyUI must be running with
   every node pack the graph uses, and Chrome or Edge must be installed; see
   [../ui-to-api/README.md](../ui-to-api/README.md).)

   The output is named after the input file: `<id>_template.json` becomes
   `<scratch dir>/<id>_template.api.json`, not `<id>.api.json`.
2. Open `<scratch dir>/_report.json`. A `"ok": false` entry failed (the converter
   exits 1 then). A console warning starting `[ExecutableNodeDTO.resolveOutput] No
   input types match` means a bypassed node sat in a live path and ComfyUI dropped
   the link, so the converted graph is missing an input: fix the graph, convert
   again.
3. Check that the card's settings still point at real nodes. ComfyUI renumbers
   nodes inside a subgraph on export, and a setting whose node is gone is silently
   ignored:

   ```bash
   node -e "const r=f=>JSON.parse(require('fs').readFileSync(f,'utf8')),a=r(process.argv[1]),m=r(process.argv[2]);for(const p of m.exposedParameters||[])if(!a[p.nodeId]||!(p.field in a[p.nodeId].inputs))console.log('gone:',p.key,p.nodeId+'.'+p.field)" <scratch dir>/<id>_template.api.json workflows/<id>/<id>.meta.json
   ```

   It prints nothing when all is well (it prints nothing for every bundle as
   shipped, checked 2026-11-05). `linkedValues` and `whenEmptySet` in the
   meta name nodes too; check those by eye.
4. Compare the new file with the old `<id>.api.json` before replacing it. Some
   bundles carry hand edits that exist only in the api.json (a pruned preview
   node, a rewired input); converting the template drops them.
5. Copy `<scratch dir>/<id>_template.api.json` over `workflows/<id>/<id>.api.json`,
   copy the edited graph over `workflows/<id>/<id>_template.json`, and run
   `node server/workflows/bundleCompleteness.test.js`.
