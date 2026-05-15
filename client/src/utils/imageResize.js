// Client-side image downscaling for capture / upload pipelines.
//
// Why: phone cameras produce 12–48 megapixel JPEGs (3–15 MB). Sending
// those over the LAN is slow and ComfyUI then has to load+process the full
// resolution — most diffusion / i2v workflows internally clamp to ~1024px
// anyway, so the extra pixels are wasted upload bandwidth and VRAM.
// Downsizing to the workflow's `maxInputEdge` before the POST /upload call
// removes both problems.
//
// The resize is a no-op when:
//   - file is missing, not an image, or HEIC/HEIF (browser usually can't decode)
//   - maxEdge is unset / non-positive
//   - the source's longest edge is already ≤ maxEdge
//   - canvas.toBlob fails (some browsers / corrupt files)
// In every fallback path we return the ORIGINAL file unchanged — never an
// error. The user always gets to submit.

// Image types we know we can decode + re-encode safely. HEIC is intentionally
// excluded; phone OS camera capture (via input capture="environment") returns
// JPEG anyway, so HEIC only appears when a user picks from their gallery on
// iOS — at which point we hand it off untouched and the server-side path
// handles it (or doesn't, but at least we don't pretend to resize).
const RESIZABLE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

// Apply downscaling so the longer edge of `file` is ≤ maxEdge px. Preserves
// aspect ratio; never upscales; honors EXIF orientation via createImageBitmap
// (modern browsers — older Safari ignores the option and may end up rotated).
// Returns a Promise<File>. Output format mirrors input (PNG stays PNG so
// alpha survives; everything else becomes JPEG at the given quality).
export async function resizeImageFile(file, maxEdge, { quality = 0.92 } = {}) {
    if (!file || typeof file !== 'object') return file;
    if (!file.type || !file.type.startsWith('image/')) return file;
    if (!maxEdge || !Number.isFinite(maxEdge) || maxEdge <= 0) return file;
    if (!RESIZABLE_TYPES.has(file.type)) {
        console.info(`[imageResize] skip unsupported type: ${file.type}`);
        return file;
    }

    let bitmap = null;
    try {
        // createImageBitmap reads EXIF orientation when available; the fallback
        // path (URL.createObjectURL + Image) doesn't honor it on older browsers,
        // so prefer the bitmap path when present.
        if (typeof createImageBitmap === 'function') {
            try {
                bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
            } catch {
                // older Safari rejects the option object — retry without it
                bitmap = await createImageBitmap(file);
            }
        } else {
            bitmap = await _loadImageElement(file);
        }
        const sourceW = bitmap.width || bitmap.naturalWidth;
        const sourceH = bitmap.height || bitmap.naturalHeight;
        const longestEdge = Math.max(sourceW, sourceH);
        if (longestEdge <= maxEdge) {
            // Source is already small enough — pass through untouched. Saves a
            // re-encode round-trip (and a tiny quality loss on JPEG).
            console.info(`[imageResize] no-op: source ${sourceW}×${sourceH} ≤ ${maxEdge}px`);
            return file;
        }
        const scale = maxEdge / longestEdge;
        const targetW = Math.round(sourceW * scale);
        const targetH = Math.round(sourceH * scale);
        const canvas = document.createElement('canvas');
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(bitmap, 0, 0, targetW, targetH);
        // Keep PNG when source had alpha; JPEG otherwise (smaller, faster).
        const outputType = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
        const blob = await _canvasToBlob(canvas, outputType, quality);
        if (!blob) {
            console.warn('[imageResize] canvas.toBlob returned null — using original');
            return file;
        }
        const resized = new File(
            [blob],
            _renameForOutput(file.name, outputType),
            { type: outputType, lastModified: Date.now() }
        );
        const kbBefore = Math.round(file.size / 1024);
        const kbAfter = Math.round(blob.size / 1024);
        console.info(`[imageResize] ${sourceW}×${sourceH} → ${targetW}×${targetH} (${kbBefore} KB → ${kbAfter} KB)`);
        return resized;
    } catch (e) {
        console.warn('[imageResize] failed, using original:', e?.message || e);
        return file;
    } finally {
        if (bitmap && typeof bitmap.close === 'function') bitmap.close();
    }
}

function _loadImageElement(file) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
        img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
        img.src = url;
    });
}

function _canvasToBlob(canvas, type, quality) {
    return new Promise(resolve => canvas.toBlob(b => resolve(b), type, quality));
}

function _renameForOutput(name, type) {
    const ext = type === 'image/png' ? 'png' : 'jpg';
    if (!name) return `capture-${Date.now()}.${ext}`;
    const dot = name.lastIndexOf('.');
    return dot >= 0 ? `${name.slice(0, dot)}.${ext}` : `${name}.${ext}`;
}
