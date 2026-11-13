// How a card is named wherever the UI refers to it in a line of text: the title
// (what it does, in plain words) and the model it runs (`name` in the meta).
// Owner, 2026-11-12: "every time we give the reference to a workflow we need to
// also have the model name. If students work by use case, I do not: I need the
// model name everywhere." A title alone hides which model made a result; a name
// alone hides what the card is for. Same separator as the batch tab's CardName.
//
// `wf` is anything carrying { title?, name? } (a lane, a /workflows summary, a
// workflow_info, a batch card); `fallback` is used when it has neither, usually
// the workflow id.
export const cardLabel = (wf, fallback = '') => {
    const title = (wf?.title || '').trim();
    const name = (wf?.name || '').trim();
    if (title && name && title !== name) return `${title} · ${name}`;
    return title || name || fallback || wf?.workflow_id || wf?.id || '';
};
