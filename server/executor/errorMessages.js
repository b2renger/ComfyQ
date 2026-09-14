// Turn raw ComfyUI execution errors into clearer, actionable messages for the
// student-facing failure reason. Falls back to the original message when nothing
// matches, so unknown errors are never hidden — they're just passed through.

// Detection-stage nodes for faces (LivePortrait cropper, InsightFace, MediaPipe).
// Deliberately NOT matching LivePortrait*Process*/*Composite* — those run AFTER a
// face is found, so an error there is more likely a real runtime fault we should
// surface verbatim, not a "no face" hint.
const FACE_NODE_RX = /cropper|insightface|mediapipe|facedetect|face_?align/i;
const FACE_MSG_RX = /no face|face.*(not|n['’]?t).*(found|detect)|could ?n['’]?t.*detect.*face|no.*face.*(found|detect)|0 faces?|face.*detection.*fail|faces?\[0\]/i;
// Don't mask a genuine OOM as a face problem.
const MEMORY_RX = /out of memory|cuda error|oom|cannot allocate|insufficient memory/i;

// Sage attention is an OPT-IN speed flag (Admin -> ComfyUI backend ->
// Performance). It only supports certain attention head dimensions, so a model
// outside that set dies with a message that says nothing about the flag being
// the cause — and the flag is global, so it takes down whichever workflows in a
// batch happen to use such a model while others succeed.
const SAGE_RX = /sage ?attention|headdim should be in/i;
const SAGE_MESSAGE =
    'This model is not compatible with Sage attention, the optional speed-up. ' +
    'Turn "Use Sage attention" off under Admin → ComfyUI backend → Performance, ' +
    'restart ComfyUI, and run this again.';

const NO_FACE_MESSAGE =
    'No face was detected in the image. Please upload a clear photo with a single, fully visible face — front-facing, well lit, and not too small in the frame.';

// Workflows that keep or re-encode the source soundtrack (e.g. the LTX 2.5 deblur
// upscaler) die in VAEEncodeAudio when the uploaded clip has no audio stream —
// screen recordings, GIF conversions and many exported renders are silent.
const NO_AUDIO_MSG_RX = /input audio is none|no audio (track|stream)/i;
const NO_AUDIO_NODE_RX = /encodeaudio/i;
const NONE_RX = /\bnone\b|nonetype/i;
const NO_AUDIO_MESSAGE =
    'Your video has no sound track, and this workflow keeps the original audio. Please upload a clip that has sound.';

// message: the raw exception text from ComfyUI; nodeType: the failing node's
// class_type (both available on the execution_error event and in history status).
function humanizeFailure(message, nodeType) {
    const msg = String(message ?? '').trim();
    const node = String(nodeType ?? '');
    if (SAGE_RX.test(msg)) return SAGE_MESSAGE;
    if (NO_AUDIO_MSG_RX.test(msg) || (NO_AUDIO_NODE_RX.test(node) && NONE_RX.test(msg) && !MEMORY_RX.test(msg))) {
        return NO_AUDIO_MESSAGE;
    }
    const faceMsg = FACE_MSG_RX.test(msg);
    const faceNode = FACE_NODE_RX.test(node) && !MEMORY_RX.test(msg);
    if (faceMsg || faceNode) return NO_FACE_MESSAGE;
    return msg || 'execution_error';
}

// True for the raw ComfyUI error AND for the humanized text above, so it works
// wherever in the pipeline the message is inspected.
function isSageIncompatibility(message) {
    const m = String(message ?? '');
    return SAGE_RX.test(m) || m === SAGE_MESSAGE;
}

// ---------------------------------------------------------------------------
// /prompt rejections
// ---------------------------------------------------------------------------
// ComfyUI validates the whole prompt before running any of it and answers a bad
// one with a nested JSON body. That body reaches the user verbatim today, which
// for a stale dropdown option means a screenful of node_errors instead of the
// one sentence that matters. This turns the structure into that sentence.
//
// `data` is the parsed response body from POST /prompt.
function humanizeSubmitRejection(data) {
    const nodeErrors = data && data.node_errors;
    const lines = [];
    if (nodeErrors && typeof nodeErrors === 'object') {
        for (const [nodeId, entry] of Object.entries(nodeErrors)) {
            const classType = entry?.class_type ? `${entry.class_type} ` : '';
            for (const err of entry?.errors || []) {
                const input = err?.extra_info?.input_name;
                const received = err?.extra_info?.received_value;
                const options = err?.extra_info?.input_config?.[1]?.options;
                if (err?.type === 'value_not_in_list' && input) {
                    lines.push(
                        `${classType}(node ${nodeId}): "${input}" was set to ${JSON.stringify(received)}, ` +
                        'which this ComfyUI does not offer.' +
                        (Array.isArray(options) ? ` Valid values: ${options.join(', ')}.` : '') +
                        ' The workflow\'s option list for that field is out of date.'
                    );
                } else {
                    // Unknown error type — say what ComfyUI said, still attributed
                    // to a node, rather than hiding it.
                    const detail = err?.details || err?.message || err?.type || 'invalid input';
                    lines.push(`${classType}(node ${nodeId}): ${detail}`.trim());
                }
            }
        }
    }
    if (lines.length > 0) return `ComfyUI rejected this job — ${lines.join(' · ')}`;
    // Unrecognised shape: never swallow it.
    const top = data?.error?.message;
    if (top) return `ComfyUI rejected this job — ${top}`;
    try { return `/prompt rejected: ${JSON.stringify(data)}`; }
    catch { return '/prompt rejected'; }
}

module.exports = {
    humanizeFailure, isSageIncompatibility, humanizeSubmitRejection,
    NO_FACE_MESSAGE, SAGE_MESSAGE, NO_AUDIO_MESSAGE
};
