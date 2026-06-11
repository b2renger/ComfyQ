// Client-side image downscaling for the upload pipeline.
//
// Why: phone cameras produce 12–48 megapixel JPEGs (3–15 MB). Sending those
// over the LAN is slow and ComfyUI then has to load+process the full
// resolution — the extra pixels are wasted upload bandwidth and VRAM, and a
// big enough image OOMs the GPU box. We downscale to fit a bounding box
// (default 1920×1080 in EITHER orientation: long edge ≤ 1920, short edge ≤
// 1080) before POST /upload. A per-parameter `maxInputEdge` overrides it with
// a single square long-edge cap.
//
// Failure policy (changed 2026-06-10): we no longer silently upload the
// original on failure. A genuinely too-big / undecodable / HEIC image now
// throws an ImageProcessError so the UI can tell the user to pick a smaller
// or standard-format image — better a clear message than a crashed rig. The
// server applies the same caps as a backstop (server/routes/uploads.js).
//
// Still a *successful pass-through* (returns the file unchanged) when the
// source is already within `maxInputEdge` or `maxEdge` is unset — those aren't
// failures.

export class ImageProcessError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'ImageProcessError';
        this.code = code; // 'UNSUPPORTED_HEIC' | 'DECODE_FAILED' | 'ENCODE_FAILED'
    }
}

const HEIC_RX = /\.(heic|heif)$/i;
function isHeic(file) {
    return /image\/(heic|heif)/i.test(file.type || '') || HEIC_RX.test(file.name || '');
}

const HEIC_MSG = 'HEIC/HEIF images aren’t supported. On iPhone, take a new photo with the camera (it saves as JPEG), or pick a JPEG/PNG/WebP.';

// Downscale so `file` fits a maxLong × maxShort box in either orientation
// (long edge ≤ maxLong, short edge ≤ maxShort). `maxShort` unset → long-edge
// cap only. Preserves aspect ratio; never upscales; honors EXIF orientation via
// createImageBitmap on modern browsers. Returns a Promise<File>. PNG/WebP keep
// an alpha-capable PNG output; everything else becomes JPEG. Throws
// ImageProcessError on HEIC or a hard decode/encode failure.
export async function resizeImageFile(file, maxLong, { maxShort = null, quality = 0.92 } = {}) {
    if (!file || typeof file !== 'object') return file;
    if (!file.type || !file.type.startsWith('image/')) return file; // not an image; caller decides
    if (isHeic(file)) throw new ImageProcessError('UNSUPPORTED_HEIC', HEIC_MSG);
    if (!maxLong || !Number.isFinite(maxLong) || maxLong <= 0) return file;

    let bitmap = null;
    try {
        // createImageBitmap reads EXIF orientation; fall back to an <img> element
        // (covers formats / browsers where createImageBitmap is unavailable or
        // rejects the options object, e.g. older Safari).
        if (typeof createImageBitmap === 'function') {
            try {
                bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
            } catch {
                bitmap = await createImageBitmap(file);
            }
        } else {
            bitmap = await _loadImageElement(file);
        }
    } catch {
        try {
            bitmap = await _loadImageElement(file);
        } catch {
            throw new ImageProcessError('DECODE_FAILED', 'Couldn’t read this image. Please use a standard JPEG, PNG, or WebP.');
        }
    }

    try {
        const sourceW = bitmap.width || bitmap.naturalWidth;
        const sourceH = bitmap.height || bitmap.naturalHeight;
        const longSide = Math.max(sourceW, sourceH);
        const shortSide = Math.min(sourceW, sourceH);
        // Fit within the maxLong × maxShort box in either orientation, preserving
        // aspect ratio, never upscaling. One uniform scale satisfies both edges.
        const shortLimit = (maxShort && Number.isFinite(maxShort) && maxShort > 0) ? maxShort : Infinity;
        const scale = Math.min(maxLong / longSide, shortLimit / shortSide, 1);
        if (scale >= 1) {
            // Already within the box — pass through untouched (saves a re-encode
            // and the tiny quality loss). Not a failure.
            return file;
        }
        const targetW = Math.round(sourceW * scale);
        const targetH = Math.round(sourceH * scale);
        const canvas = document.createElement('canvas');
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(bitmap, 0, 0, targetW, targetH);
        // Keep an alpha-capable PNG when the source could carry alpha; JPEG
        // otherwise (smaller, faster).
        const outputType = (file.type === 'image/png' || file.type === 'image/webp') ? 'image/png' : 'image/jpeg';
        const blob = await _canvasToBlob(canvas, outputType, quality);
        if (!blob) {
            throw new ImageProcessError('ENCODE_FAILED', 'Couldn’t process this image. Try a smaller JPEG or PNG.');
        }
        return new File(
            [blob],
            _renameForOutput(file.name, outputType),
            { type: outputType, lastModified: Date.now() }
        );
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
