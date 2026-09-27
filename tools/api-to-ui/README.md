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
  runs the api.json, so an admin who edits the graph knows to re-export through
  `../ui-to-api` to change what executes. `Note` is frontend-only and never
  reaches the prompt — the round-trip check proves that rather than assuming it.
