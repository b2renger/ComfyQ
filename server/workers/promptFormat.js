// Prompt text that has to reach the model in a particular shape.
//
// An exposed textarea param can declare `format` in its meta (see schemas.js).
//   ideogram4-caption — Ideogram 4 was trained on its JSON caption serialized
//   compactly (Python's json.dumps with separators=(",", ":")). Measured on the
//   rig, 2026-09-17: the same caption and seed came back as the gray "Image
//   blocked by safety filter" picture when sent pretty-printed, and as the
//   picture when sent compact. Students paste and edit indented JSON, so valid
//   JSON is compacted here, just before it goes into the graph. Anything that
//   doesn't parse (plain text, broken JSON) is sent unchanged.

function formatPromptValue(value, format) {
    if (format !== 'ideogram4-caption' || typeof value !== 'string') return value;
    const trimmed = value.trim();
    if (!trimmed.startsWith('{')) return value;
    try {
        const parsed = JSON.parse(trimmed);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return value;
        // JSON.stringify keeps the authored key order and writes non-ASCII
        // characters as-is — the same as ensure_ascii=False on the Python side.
        return JSON.stringify(parsed);
    } catch {
        return value;
    }
}

module.exports = { formatPromptValue };
