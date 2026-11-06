// The box an uploaded image is downsized to before it leaves the browser.
//
// The server refuses any image larger than 2048×2048 (server/routes/uploads.js,
// IMAGE_MAX_LONG × IMAGE_MAX_SHORT), so that box is a CEILING here. A picture
// resized above it would be sent and refused with "Image is too large", and
// resizing again gives the same size, so the student could never book.
// uploadBox.test.mjs pins these two numbers to the server's.
export const IMAGE_MAX_LONG = 2048;
export const IMAGE_MAX_SHORT = 2048;

// A card that declares nothing keeps the 1920×1080 box in either orientation:
// raising the ceiling for the cards that ask for more must not change the size,
// the time and the memory of every other card.
export const DEFAULT_MAX_LONG = 1920;
export const DEFAULT_MAX_SHORT = 1080;

// → { maxLong, maxShort } for resizeImageFile(file, maxLong, { maxShort }).
// No maxInputEdge → 1920×1080. A maxInputEdge → a square cap of that size, clamped
// into the ceiling (1024 → 1024×1024, 2048 → 2048×2048, 4096 → 2048×2048).
export function uploadBox(maxInputEdge) {
    if (maxInputEdge == null) return { maxLong: DEFAULT_MAX_LONG, maxShort: DEFAULT_MAX_SHORT };
    return {
        maxLong: Math.min(maxInputEdge, IMAGE_MAX_LONG),
        maxShort: Math.min(maxInputEdge, IMAGE_MAX_SHORT),
    };
}
