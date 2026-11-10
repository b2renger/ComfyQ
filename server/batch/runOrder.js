'use strict';
/**
 * The run order of a batch: what its inputs require, then as few model loads
 * and ComfyUI restarts as they allow (owner, 2026-11-10: "a small decision model
 * to reorder the jobs in the batch feature list, dealing with dependencies and
 * optimizing loads and unloads of models and workflows").
 *
 * What a batch costs on the one ComfyUI that runs it (LaneManager._prepareRun):
 *   - a job on the card that ran last: nothing but its own time, since its models
 *     are still loaded;
 *   - a job on another card: every model is unloaded, and the card loads its
 *     own: its measured `modelLoadSec` (runtime.json), whatever the two cards
 *     share, because the unload takes all of them;
 *   - a card that runs with other speed-up flags (`disabledPerfFlags`): ComfyUI is
 *     relaunched as well, RESTART_SEC.
 * A job's own time does not depend on the order, so only these switches count.
 *
 * The decision. Running a ready job of the card that is loaded costs nothing and
 * never takes a choice away, so a run is a sequence of VISITS: a visit to a card
 * runs every job of it whose inputs are done, and the ones its own jobs unlock.
 * The only choice is which card to visit next. That is searched exactly (depth
 * first, branch and bound) up to SEARCH_BUDGET visits; past it, the best order
 * found so far is kept, the greedy one at worst. Inside a visit, and between
 * orders that cost the same, the table's own order wins. An order that saves
 * nothing is not used, so a table someone ordered on purpose is not shuffled.
 */

const { PERF_FLAG_KEYS, disabledPerfFlags } = require('../workers/perfFlags');

// A ComfyUI relaunch: the process boots again (30–90 s on this rig) before the
// next card's models load. An estimate, not a measurement.
const RESTART_SEC = 60;
// Visits the exact search may try before it keeps the best order found so far.
const SEARCH_BUDGET = 20000;
// Every switch unloads every model, so it costs something even for a card whose
// load time was never measured. Ranks orders only; never shown as time.
const SWITCH_WEIGHT_SEC = 1;

/**
 * The speed-up flags a card's ComfyUI runs with, as one string: the rig's flags
 * (`comfy_ui` in config; all of them when not given) less those the card disowns.
 */
function flagsKey(meta, comfyFlags = null) {
    const off = disabledPerfFlags(meta);
    return PERF_FLAG_KEYS.filter(k => (comfyFlags ? !!comfyFlags[k] : true) && !off.includes(k)).join('+');
}

/**
 * What runs before each job of a sequence.
 *   jobs   [{ workflowId, flags, modelLoadSec }]
 *   start  { workflowId, flags } — what the main lane has loaded now; null when
 *          nothing is (the batch starts serving its first card, so that first
 *          load comes with a boot that happens anyway, and is not a restart)
 * → { loads, restarts, setupSec, steps: [{ setup: null | 'load' | 'restart', setupSec }] }
 */
function costOf(jobs, { start = null, restartSec = RESTART_SEC } = {}) {
    let card = start ? start.workflowId ?? null : null;
    let flags = start ? start.flags ?? null : null;
    let loads = 0;
    let restarts = 0;
    let setupSec = 0;
    const steps = jobs.map(j => {
        if (j.workflowId === card) return { setup: null, setupSec: 0 };
        let sec = j.modelLoadSec || 0;
        let setup = 'load';
        loads++;
        if (flags !== null && j.flags !== flags) { sec += restartSec; setup = 'restart'; restarts++; }
        card = j.workflowId;
        flags = j.flags;
        setupSec += sec;
        return { setup, setupSec: sec };
    });
    return { loads, restarts, setupSec, steps };
}

// What the search minimises: the time, plus a little for every switch.
const scoreOf = (jobs, opts) => {
    const c = costOf(jobs, opts);
    return c.setupSec + c.loads * SWITCH_WEIGHT_SEC;
};

/**
 * Reorder a batch.
 *   jobs   [{ key, workflowId, flags, modelLoadSec, deps: [{ sourceKey? }] }], in the
 *          table's order with every source before the jobs that use it (planBatch's
 *          order). A dep without a sourceKey (an existing job) does not constrain.
 *   start, restartSec   as costOf; budget   visits the exact search may try
 * → { jobs, changed, exact, cost, written }   cost and written are costOf answers
 */
function orderRun(jobs, { start = null, restartSec = RESTART_SEC, budget = SEARCH_BUDGET } = {}) {
    const opts = { start, restartSec };
    const written = costOf(jobs, opts);
    const keep = (exact) => ({ jobs, changed: false, exact, cost: written, written });
    if (jobs.length < 2) return keep(true);

    const n = jobs.length;
    const index = new Map(jobs.map((j, i) => [j.key, i]));
    const deps = jobs.map(j => (j.deps || []).map(d => index.get(d.sourceKey)).filter(i => i !== undefined));
    const dependants = jobs.map(() => []);
    deps.forEach((list, i) => list.forEach(s => dependants[s].push(i)));

    const cards = [...new Set(jobs.map(j => j.workflowId))];
    const cardOf = jobs.map(j => cards.indexOf(j.workflowId));
    const jobsOf = cards.map(() => []);
    jobs.forEach((j, i) => jobsOf[cardOf[i]].push(i));
    const flagsOf = jobsOf.map(list => jobs[list[0]].flags);
    const weight = jobsOf.map(list => Math.max(...list.map(i => jobs[i].modelLoadSec || 0)) + SWITCH_WEIGHT_SEC);

    const pending = deps.map(list => list.length);
    const done = new Array(n).fill(false);
    const left = jobsOf.map(list => list.length);
    let leftTotal = n;
    const run = (i) => { done[i] = true; left[cardOf[i]]--; leftTotal--; for (const d of dependants[i]) pending[d]--; };
    const unrun = (i) => { done[i] = false; left[cardOf[i]]++; leftTotal++; for (const d of dependants[i]) pending[d]++; };
    const ready = (i) => !done[i] && pending[i] === 0;

    // A visit to card k: its ready jobs, in the table's order, and any its own
    // jobs unlock. → the jobs it ran.
    const visit = (k) => {
        const ran = [];
        for (let again = true; again;) {
            again = false;
            for (const i of jobsOf[k]) if (ready(i)) { run(i); ran.push(i); again = true; }
        }
        return ran;
    };
    const undo = (ran) => { for (let x = ran.length - 1; x >= 0; x--) unrun(ran[x]); };
    // The cards that have a job ready, the one the table names first first.
    const candidates = (cur) => {
        const out = [];
        for (let k = 0; k < cards.length; k++) {
            if (k === cur || !left[k]) continue;
            const first = jobsOf[k].find(ready);
            if (first !== undefined) out.push([first, k]);
        }
        return out.sort((a, b) => a[0] - b[0]).map(x => x[1]);
    };
    const step = (curFlags, k) => weight[k] + (curFlags !== null && flagsOf[k] !== curFlags ? restartSec : 0);
    // A lower bound on what is left: every card with jobs left loads at least
    // once more (the current one too, since a visit takes all it can, so the rest
    // of it waits on another card), and every other set of flags needs a restart.
    const bound = (curFlags) => {
        let lb = 0;
        const other = new Set();
        for (let k = 0; k < cards.length; k++) {
            if (!left[k]) continue;
            lb += weight[k];
            if (flagsOf[k] !== curFlags) other.add(flagsOf[k]);
        }
        return lb + (curFlags === null ? Math.max(0, other.size - 1) : other.size) * restartSec;
    };

    // The card already loaded goes first: its ready jobs cost nothing.
    const startCard = start?.workflowId != null ? cards.indexOf(start.workflowId) : -1;
    const startFlags = start ? start.flags ?? null : null;
    const head = startCard >= 0 ? visit(startCard) : [];

    // Greedy: the cheapest card next, the one named first on a tie.
    const greedy = () => {
        const seq = [];
        const visits = [];
        let cur = startCard;
        let flags = startFlags;
        let score = 0;
        for (;;) {
            const cands = candidates(cur);
            if (!cands.length) break;
            let k = cands[0];
            for (const c of cands) if (step(flags, c) < step(flags, k)) k = c;
            score += step(flags, k);
            const ran = visit(k);
            visits.push(ran);
            seq.push(...ran);
            cur = k;
            flags = flagsOf[k];
        }
        const complete = leftTotal === 0;
        for (let v = visits.length - 1; v >= 0; v--) undo(visits[v]);
        return complete ? { score, order: [...head, ...seq] } : null;
    };

    let best = greedy();
    if (!best) { undo(head); return keep(true); }     // a loop: planBatch refuses those first

    let nodes = 0;
    let exhausted = false;
    const seq = [...head];
    const dfs = (cur, curFlags, cost) => {
        if (leftTotal === 0) {
            if (cost < best.score) best = { score: cost, order: seq.slice() };
            return;
        }
        if (cost + bound(curFlags) >= best.score) return;
        if (++nodes > budget) { exhausted = true; return; }
        for (const k of candidates(cur)) {
            const ran = visit(k);
            seq.push(...ran);
            dfs(k, flagsOf[k], cost + step(curFlags, k));
            seq.length -= ran.length;
            undo(ran);
            if (exhausted) return;
        }
    };
    dfs(startCard, startFlags, 0);
    undo(head);

    const order = best.order.map(i => jobs[i]);
    if (scoreOf(order, opts) >= scoreOf(jobs, opts)) return keep(!exhausted);
    return { jobs: order, changed: true, exact: !exhausted, cost: costOf(order, opts), written };
}

module.exports = { orderRun, costOf, flagsKey, RESTART_SEC, SEARCH_BUDGET };
