// The box an uploaded image is downsized to before it leaves the browser.
//
// The server refuses any image larger than 1920×1080 in either orientation
// (server/routes/uploads.js, IMAGE_MAX_LONG × IMAGE_MAX_SHORT), so that box is a
// CEILING here, not just a default. A param's `maxInputEdge` can only make the
// box smaller: a card asking for 2048 still gets 1920×1080, because a 2048-px
// picture would be resized, sent, and then refused with "Image is too large" —
// and resizing again gives the same size, so the student could never book.
// uploadBox.test.mjs pins these two numbers to the server's.
export const IMAGE_MAX_LONG = 1920;
export const IMAGE_MAX_SHORT = 1080;

// → { maxLong, maxShort } for resizeImageFile(file, maxLong, { maxShort }).
// No maxInputEdge → the full 1920×1080 box. A maxInputEdge → a square long-edge
// cap of that size, clamped into the box (1024 → 1024×1024, 1376 → 1376×1080).
export function uploadBox(maxInputEdge) {
    return {
        maxLong: Math.min(maxInputEdge ?? IMAGE_MAX_LONG, IMAGE_MAX_LONG),
        maxShort: Math.min(maxInputEdge ?? IMAGE_MAX_SHORT, IMAGE_MAX_SHORT),
    };
}
