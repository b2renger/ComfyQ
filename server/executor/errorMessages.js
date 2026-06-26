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

const NO_FACE_MESSAGE =
    'No face was detected in the image. Please upload a clear photo with a single, fully visible face — front-facing, well lit, and not too small in the frame.';

// message: the raw exception text from ComfyUI; nodeType: the failing node's
// class_type (both available on the execution_error event and in history status).
function humanizeFailure(message, nodeType) {
    const msg = String(message ?? '').trim();
    const node = String(nodeType ?? '');
    const faceMsg = FACE_MSG_RX.test(msg);
    const faceNode = FACE_NODE_RX.test(node) && !MEMORY_RX.test(msg);
    if (faceMsg || faceNode) return NO_FACE_MESSAGE;
    return msg || 'execution_error';
}

module.exports = { humanizeFailure, NO_FACE_MESSAGE };
