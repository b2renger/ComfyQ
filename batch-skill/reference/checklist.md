# Check before you emit

Run every line against your draft. Fix failures **upstream** — a defect that
appears twice in the same place is a defect in one of the five locked blocks,
not in the prompt. Amend the block and let the change propagate.

## Grammar

1. Every `#` state id is identifier-shaped, **no spaces**, and its `role` is one
   of `library` / `idle` / `scene` / `ending` / `notes`.
2. Every `##` shot is followed by a `###` line and then a prompt paragraph. A
   shot missing either is a **parse error**: the admin UI refuses the document,
   but the API queues everything else **without it**. Check `parsed.errors`.
3. Exactly **one** `###` per `##`. A second silently replacing the first is an
   error; split into two `##` shots.
4. Every `###` names a workflow from
   [workflows.md](workflows.md) and carries its size (and its duration, for
   video and audio).
5. No `Prompt:` labels, no lists, no negative prompts, no seeds, no steps in any
   paragraph.
6. Nothing in a `notes` state is meant to generate — it never will.

## Wiring

7. Every `Video cut N` has a matching `Reference image N` **in the same state**.
8. Every `(ref Ax)` names an anchor that exists, and refs are written on the
   `##` line or as `| ref …` on the `###` line — never `(ref A2, A1)` in
   parentheses on `###`, which keeps only the first anchor. No two anchors
   share a number (a duplicate is only a *warning*; the later one wins).
9. Every shot on an **edit** workflow names its refs, and names **two** when the
   source and the reference differ (`ref <place>, <subject>`). One ref in two
   slots is a warning: the model edits the anchor instead of bringing it in.
10. Every media slot of every shot is fed. Count them against the slot table.
    **Every `ltx_2_3_flf2v` cut is either `(loop)` or names two refs** — only
    its first slot is wired by number, and the second silently takes the next
    unconsumed image in the state, which may be a choice card.
11. No block refers forward — a `ref` always points at an anchor defined earlier.

## Consistency

12. `STYLE SUFFIX` is **byte-identical** in every photographic prompt.
    `UI SUFFIX` is byte-identical in every card prompt. Count them and confirm.
13. **No video prompt mentions** the wardrobe, the set, the grade, the lens or
    the film stock. The start frame already decided all of it.
14. Every video prompt says what changes (*"Initially X, then Y"*) and ends its
    `Audio:` clause with `no music, no speech`.
15. Every music prompt uses the sound bible's one key and one BPM.
16. Every new location opens on a wide shot before any close-up of it.

## Screens

17. No card prompt contains imagery — no photograph, no illustration, no
    depicted object, no person. Each is under ~60 words.
18. Every option label is ≤ 8 words and appears in double quotes in its prompt.
19. Every card carries a size, so it renders 16:9 instead of the portrait
    default.

## Graph

20. Every scene offers 2–3 options; **every routing target exists**; every path
    lands on exactly one ending.
21. No choice is good-vs-bad. If swapping the two labels would not change what
    the film argues, rewrite the graph.
22. The last cut of every branching state shows all of its options as visible
    things in frame.
23. Any shared ending is motivated in `NOTES` — the paths converge in meaning.

## Content

24. No real people, brands, logos, copyrighted characters or lyrics. No
    on-screen text except the labels and the title.
25. No protagonist seen face-on in any film frame.

## Arithmetic

26. Count the shots by phase (images / videos / audio) and state the total and
    the rough GPU estimate **before** emitting a large document.
27. If something cannot be fixed, append a `# NOTES | notes | end` block saying
    what and why. **Never pass silently.**

---

## Verifying without a GPU

Plan the document offline — this catches every structural error in about a
second, with no ComfyUI running:

```bash
node -e "
const {WorkflowRegistry}=require('./server/workflows/workflowRegistry');
const {parseStoryboard}=require('./server/storyboard/storyboardParser');
const {planStoryboard}=require('./server/storyboard/storyboardPlanner');
const r=new WorkflowRegistry(require('path').resolve('workflows')); r.discover();
const parsed=parseStoryboard(require('fs').readFileSync(process.argv[1],'utf8'));
const p=planStoryboard(parsed,r,{});
console.log('shots',p.jobs.length,'| PARSE errors',parsed.errors.length,'| PLAN errors',p.errors.length,'| blocked',p.blockedReasons.length);
console.log('phases',p.phases.map(x=>x.count+' '+x.label).join(', '));
console.log('model loads',p.modelLoads);
for(const e of parsed.errors) console.log('PARSE',e);
for(const e of p.errors)      console.log('PLAN ',e);
for(const w of parsed.warnings.concat(p.warnings)) console.log('WARN ',w);
" path/to/story.md
```

**Both `PARSE errors` and `PLAN errors` must be 0 — they are different
arrays.** This matters more than it looks: a parse error (a `##` with no `###`,
a second `###` under one `##`, an empty prompt) **drops that shot from the
batch entirely**. The plan then looks perfectly clean while the film is missing
a shot — and if the dropped shot was an `## Anchor image N`, every `(ref Ax)`
pointing at it is gone too.

`POST /storyboard/queue` refuses only on **plan** errors, so a parse error
queues silently through the API. The admin UI does block it. Never trust a
report that printed only `p.errors`.

Warnings are worth reading — the common ones are "one ref in two slots" and "a
resolution was given for a workflow with no width/height", which is expected
for edit shots and cards.

Then queue it, either in the app (**/admin → Storyboard batch**) or:

```bash
curl -F file=@path/to/story.md -F folder=my-film \
     -H "X-Admin-Password: $PW" http://localhost:3000/storyboard/preview
```
