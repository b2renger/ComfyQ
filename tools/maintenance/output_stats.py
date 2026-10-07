"""Describe what a workflow actually produced, so a sweep can be audited.

Read-only. Takes a JSON list of absolute file paths on stdin and prints one JSON
object per file on stdout.

WHY THIS EXISTS. "The job succeeded" is not evidence that a workflow works. This
rig has twice shipped a bundle that reported success and saved black images --
Qwen-Image-Edit under --use-sage-attention, SeedVR2 7B under fp16 accumulation --
and once passed a 4-step Viggle default by comparing Laplacian variance, a
statistic that cannot tell detail from structured noise. The project's own note on
it reads: "an image metric is not a substitute for opening the picture."

So this does not try to judge quality. It reports the few things that catch a
RUN THAT PRODUCED NOTHING, and leaves everything else to a human looking at the
file:

  black      mean luminance below 2/255 -- the known failure mode
  flat       standard deviation below 1.0, i.e. a single colour
  tiny       fewer pixels than a thumbnail, or a suspiciously small file
  frames     how many a video really has, and stats for first/middle/last

Everything is best-effort: a file it cannot read is reported as unreadable rather
than raising, because a sweep must survive one odd output.

Uses ComfyUI's own python_embeded (PIL, numpy, cv2) -- never system python.
"""
import io
import json
import os
import sys

IMAGE_EXT = {'.png', '.jpg', '.jpeg', '.webp', '.bmp', '.tif', '.tiff'}
VIDEO_EXT = {'.mp4', '.webm', '.mkv', '.mov', '.avi', '.gif'}
AUDIO_EXT = {'.mp3', '.wav', '.flac', '.ogg', '.opus', '.m4a'}
MESH_EXT = {'.glb', '.gltf', '.obj', '.ply', '.spz', '.splat', '.ksplat', '.stl'}

# A still smaller than this is almost certainly a placeholder or an error tile.
MIN_PIXELS = 64 * 64
BLACK_MEAN = 2.0
FLAT_STD = 1.0


def _stats(arr):
    import numpy as np
    a = arr.astype('float32')
    if a.ndim == 3:
        # luminance, so a mid-grey and a saturated blue are not both "dark"
        if a.shape[2] >= 3:
            a = 0.2126 * a[:, :, 0] + 0.7152 * a[:, :, 1] + 0.0722 * a[:, :, 2]
        else:
            a = a[:, :, 0]
    return {
        'mean': round(float(a.mean()), 2),
        'std': round(float(a.std()), 2),
        'min': int(a.min()),
        'max': int(a.max()),
    }


def describe_image(path):
    from PIL import Image
    import numpy as np
    out = {'kind': 'image'}
    with Image.open(path) as im:
        im.load()
        out['width'], out['height'] = im.size
        out['mode'] = im.mode
        # An alpha channel is content too (a mask), so measure RGB and A apart.
        if im.mode in ('RGBA', 'LA'):
            rgb = np.asarray(im.convert('RGB'))
            alpha = np.asarray(im.getchannel('A'))
            out.update(_stats(rgb))
            out['alpha'] = _stats(alpha)
        else:
            out.update(_stats(np.asarray(im.convert('RGB'))))
    px = out['width'] * out['height']
    out['flags'] = _flags(out, px)
    return out


def _flags(s, pixels):
    f = []
    if s.get('mean', 99) < BLACK_MEAN:
        f.append('black')
    if s.get('std', 99) < FLAT_STD:
        f.append('flat')
    if pixels and pixels < MIN_PIXELS:
        f.append('tiny')
    return f


def describe_video(path):
    import cv2
    import numpy as np
    out = {'kind': 'video'}
    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        cap.release()
        return {'kind': 'video', 'error': 'could not open'}
    try:
        n = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        out['frames'] = n
        out['fps'] = round(float(cap.get(cv2.CAP_PROP_FPS) or 0), 2)
        out['width'] = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
        out['height'] = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
        # Three samples, because a clip can start black legitimately (a fade in)
        # and a pipeline that fails halfway leaves the tail black.
        picks = [0] if n <= 1 else [0, max(0, n // 2), max(0, n - 2)]
        samples = []
        for i in picks:
            cap.set(cv2.CAP_PROP_POS_FRAMES, i)
            ok, frame = cap.read()
            if not ok or frame is None:
                samples.append({'at': i, 'error': 'unreadable'})
                continue
            s = _stats(np.asarray(frame)[:, :, ::-1])   # cv2 is BGR
            s['at'] = i
            samples.append(s)
    finally:
        cap.release()
    out['samples'] = samples
    read = [s for s in samples if 'mean' in s]
    if read:
        out['mean'] = round(sum(s['mean'] for s in read) / len(read), 2)
        out['std'] = round(max(s['std'] for s in read), 2)
    px = out.get('width', 0) * out.get('height', 0)
    out['flags'] = _flags(out, px)
    # Every sampled frame black is a different statement from "the clip averages dark".
    if read and all(s['mean'] < BLACK_MEAN for s in read) and 'black' not in out['flags']:
        out['flags'].append('black')
    if out.get('frames', 0) <= 1:
        out['flags'].append('single-frame')
    return out


def describe_audio(path):
    out = {'kind': 'audio'}
    try:
        import av
        with av.open(path) as c:
            st = next((s for s in c.streams if s.type == 'audio'), None)
            if st is None:
                return {'kind': 'audio', 'error': 'no audio stream'}
            out['seconds'] = round(float(c.duration or 0) / 1_000_000, 2)
            out['sampleRate'] = st.rate
            out['channels'] = st.channels
            peak = 0.0
            for i, frame in enumerate(c.decode(st)):
                a = frame.to_ndarray()
                peak = max(peak, float(abs(a).max()) if a.size else 0.0)
                if i > 200:
                    break
            out['peak'] = round(peak, 5)
            out['flags'] = ['silent'] if peak < 1e-4 else []
    except Exception as e:
        out['error'] = f'{type(e).__name__}: {e}'
    return out


def describe_mesh(path):
    """Magic bytes only. Geometry is a human's job; an empty file is not."""
    out = {'kind': 'model3d', 'flags': []}
    with open(path, 'rb') as fh:
        head = fh.read(12)
    if head[:4] == b'glTF':
        out['format'] = 'glb'
    elif head[:3] == b'ply' or head[:3] == b'PLY':
        out['format'] = 'ply'
    elif path.lower().endswith('.spz'):
        out['format'] = 'spz'
    else:
        out['format'] = 'unknown'
        out['flags'].append('unrecognised-header')
    return out


def describe(path):
    rec = {'path': path}
    try:
        rec['bytes'] = os.path.getsize(path)
    except OSError as e:
        return {'path': path, 'error': f'missing: {e}'}
    if rec['bytes'] == 0:
        rec['flags'] = ['empty']
        return rec
    ext = os.path.splitext(path)[1].lower()
    try:
        if ext in IMAGE_EXT:
            rec.update(describe_image(path))
        elif ext in VIDEO_EXT:
            rec.update(describe_video(path))
        elif ext in AUDIO_EXT:
            rec.update(describe_audio(path))
        elif ext in MESH_EXT:
            rec.update(describe_mesh(path))
        else:
            rec['kind'] = 'other'
            rec['flags'] = []
    except Exception as e:
        rec['error'] = f'{type(e).__name__}: {e}'
        rec.setdefault('flags', []).append('unreadable')
    # A text output has no pixels; treat a very small media file as suspect.
    if rec.get('kind') in ('image', 'video') and rec['bytes'] < 2048:
        rec.setdefault('flags', []).append('tiny-file')
    return rec


def main():
    try:
        paths = json.loads(sys.stdin.read() or '[]')
    except Exception as e:
        print(json.dumps({'error': f'bad input: {e}'}))
        return 1
    out = [describe(p) for p in paths if isinstance(p, str)]
    print(json.dumps(out))
    return 0


if __name__ == '__main__':
    sys.exit(main())
